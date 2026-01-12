// ============================================================================
// 💸 INTENT: EXPENSE (Registrar Gasto)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots, SLOT_REQUIREMENTS } from "../decision/types.ts";
import { 
  closeAction, 
  generateDedupeHash, 
  checkDuplicate,
  createAction,
  updateAction
} from "../context/manager.ts";
import { normalizeText } from "../decision/engine.ts";
import { learnMerchantPattern } from "../memory/patterns.ts";
import { checkImmediateAlerts } from "../intents/alerts.ts";
import { getDecisionConfig, recordMetric } from "../governance/config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 🏷️ INFERIR CATEGORIA
// ============================================================================

export function inferCategory(description: string, originalCategory?: string): string {
  if (originalCategory && originalCategory !== "outros") {
    return originalCategory;
  }
  
  const desc = normalizeText(description);
  
  const categoryMap: Record<string, string[]> = {
    alimentacao: ["cafe", "pao", "lanche", "agua", "refrigerante", "almoco", "jantar", "ifood", "rappi", "comida", "restaurante", "padaria", "pizza", "acai", "sorvete", "coca", "refri"],
    mercado: ["mercado", "supermercado", "feira", "hortifruti", "atacadao"],
    transporte: ["uber", "99", "taxi", "onibus", "gasolina", "combustivel", "estacionamento", "pedagio"],
    saude: ["farmacia", "remedio", "medico", "hospital", "consulta", "exame", "dentista"],
    lazer: ["cinema", "netflix", "spotify", "show", "festa", "bar", "jogo", "game"],
    moradia: ["aluguel", "condominio", "luz", "energia", "gas", "internet", "telefone"],
    compras: ["roupa", "sapato", "loja", "shopping", "presente", "celular"],
    servicos: ["salao", "barbearia", "manicure", "lavanderia", "faxina"]
  };
  
  for (const [category, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(kw => desc.includes(kw))) {
      return category;
    }
  }
  
  return originalCategory || "outros";
}

// ============================================================================
// 📝 REGISTRAR TRANSAÇÃO
// ============================================================================

export interface ExpenseResult {
  success: boolean;
  message: string;
  transactionId?: string;
  isDuplicate?: boolean;
}

export async function registerExpense(
  userId: string,
  slots: ExtractedSlots,
  eventoId: string | null,
  actionId?: string
): Promise<ExpenseResult> {
  console.log(`💸 [EXPENSE] Registrando: ${JSON.stringify(slots)}`);
  
  // Verificar slots obrigatórios
  const requirements = SLOT_REQUIREMENTS.expense;
  for (const required of requirements.required) {
    if (!slots[required]) {
      return {
        success: false,
        message: `Falta informar: ${required}`
      };
    }
  }
  
  // Gerar hash de deduplicação
  const dedupeHash = generateDedupeHash(
    userId,
    slots.amount,
    slots.description,
    slots.payment_method
  );
  
  // Verificar duplicação
  const { isDuplicate, existingTx, minutesAgo } = await checkDuplicate(userId, dedupeHash);
  
  if (isDuplicate) {
    // Criar action de confirmação de duplicado
    await createAction(userId, "duplicate_confirm", "duplicate_expense", {
      ...slots,
      original_tx_id: existingTx.id
    });
    
    return {
      success: false,
      isDuplicate: true,
      message: `⚠️ Parece duplicado!\n\nVi um gasto igual há ${minutesAgo} min.\n\nFoi repetição sem querer?`
    };
  }
  
  // Inferir categoria
  const category = inferCategory(slots.description || "", slots.category);
  
  // Registrar transação
  const now = new Date();
  
  const { data: transaction, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor: slots.amount,
    categoria: category,
    tipo: "saida",
    descricao: slots.description || category,
    data: now.toISOString(),
    data_transacao: now.toISOString(),
    hora_transacao: now.toTimeString().slice(0, 5),
    origem: "whatsapp",
    forma_pagamento: slots.payment_method,
    status: "confirmada",
    idempotency_key: dedupeHash,
    id_cartao: slots.card || null
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    return {
      success: false,
      message: "Ops, algo deu errado ao registrar 😕"
    };
  }
  
  // Fechar action se existir
  if (actionId) {
    await closeAction(actionId, transaction.id);
  }
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_gasto",
    entity_type: "transacao",
    entity_id: transaction.id,
    new_data: { ...slots, category }
  });
  
  // ========================================================================
  // 🧠 ELITE INTEGRATIONS (pós-registro)
  // ========================================================================
  
  const config = await getDecisionConfig();
  
  // 1. MEMORY LAYER: Aprender padrão do merchant (se habilitado)
  if (config.auto_apply_patterns && slots.description) {
    try {
      await learnMerchantPattern({
        userId,
        description: slots.description,
        category,
        paymentMethod: slots.payment_method || "pix",
        cardId: slots.card_id || slots.card || undefined,
        transactionId: transaction.id,
        wasUserCorrected: !!slots._corrected_by
      });
      console.log(`🧠 [MEMORY] Padrão aprendido: ${slots.description} → ${category}`);
    } catch (err) {
      console.error(`🧠 [MEMORY] Erro ao aprender padrão:`, err);
    }
  }
  
  // 2. PROACTIVE AI: Verificar alertas imediatos (silencioso)
  try {
    await checkImmediateAlerts(userId, {
      valor: slots.amount!,
      categoria: category,
      descricao: slots.description || category
    });
  } catch (err) {
    console.error(`🚨 [ALERTS] Erro ao verificar alertas:`, err);
  }
  
  // 3. Registrar métrica
  await recordMetric("expense_registered", slots.amount || 0, {
    category,
    payment_method: slots.payment_method || "unknown"
  });
  
  // Formatar resposta amigável
  const formattedDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const formattedTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const paymentEmojiMap: Record<string, string> = {
    pix: "📱",
    debito: "💳",
    credito: "💳",
    dinheiro: "💵"
  };
  const paymentEmoji = paymentEmojiMap[slots.payment_method || ""] || "💰";
  
  const message = `✅ *Gasto registrado!*\n\n` +
    `💸 *-R$ ${slots.amount?.toFixed(2)}*\n` +
    `📂 ${category}\n` +
    (slots.description ? `📝 ${slots.description}\n` : "") +
    `${paymentEmoji} ${slots.payment_method}\n` +
    `📅 ${formattedDate} às ${formattedTime}\n\n` +
    `_Responda "cancelar" se foi engano!_`;
  
  console.log(`✅ [EXPENSE] Registrado: ${transaction.id}`);
  
  return {
    success: true,
    message,
    transactionId: transaction.id
  };
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

export function getMissingExpenseSlots(slots: ExtractedSlots): string[] {
  const requirements = SLOT_REQUIREMENTS.expense;
  return requirements.required.filter(slot => !slots[slot]);
}
