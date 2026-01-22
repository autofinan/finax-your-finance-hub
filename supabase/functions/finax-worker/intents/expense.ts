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
import { learnMerchantPattern } from "../memory/patterns.ts";
import { checkImmediateAlerts } from "../intents/alerts.ts";
import { getDecisionConfig, recordMetric } from "../governance/config.ts";
import { categorizeDescription, type CategorizationResult } from "../ai/categorizer.ts";
import { getBrasiliaDate, getBrasiliaISO, formatBrasiliaDateTime, getPaymentEmoji } from "../utils/date-helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  
  // ========================================================================
  // 🧠 CATEGORIZAÇÃO IA-FIRST COM AUTOAPRENDIZADO
  // ========================================================================
  const categoryResult = await categorizeDescription(
    slots.description || "",
    slots.category
  );
  const category = categoryResult.category;
  
  console.log(`📂 [EXPENSE] Categorização: "${slots.description}" → ${category}`);
  console.log(`   └─ Fonte: ${categoryResult.source}, Confiança: ${categoryResult.confidence}`);
  if (categoryResult.learned) {
    console.log(`   └─ 🧠 Termo "${categoryResult.keyTerm}" aprendido para futuras transações!`);
  }
  
  // ========================================================================
  // 📍 BUSCAR CONTEXTO ATIVO (viagem, evento, etc.)
  // ========================================================================
  const { data: activeContext } = await supabase
    .from("user_contexts")
    .select("id, label")
    .eq("user_id", userId)
    .eq("status", "active")
    .single();
  
  if (activeContext) {
    console.log(`📍 [EXPENSE] Contexto ativo: ${activeContext.label} (${activeContext.id})`);
  }
  
  // ========================================================================
  // 🕒 USAR TIMEZONE BRASÍLIA PARA DATA/HORA
  // ========================================================================
  // Se o usuário disse "ontem", usar a data passada via slots.transaction_date
  // Caso contrário, usar a data/hora atual de Brasília
  // ========================================================================
  const transactionDate = slots.transaction_date 
    ? new Date(slots.transaction_date) 
    : getBrasiliaDate();
  
  const { dateISO, timeString } = getBrasiliaISO(transactionDate);
  
  const { data: transaction, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor: slots.amount,
    categoria: category,
    tipo: "saida",
    descricao: slots.description || category,
    data: dateISO,
    data_transacao: dateISO,
    hora_transacao: timeString,
    origem: "whatsapp",
    forma_pagamento: slots.payment_method,
    status: "confirmada",
    idempotency_key: dedupeHash,
    id_cartao: slots.card || null,
    context_id: activeContext?.id || null
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
  
  // Formatar resposta amigável usando timezone Brasília
  const formattedDateTime = formatBrasiliaDateTime(transactionDate);
  const paymentEmoji = getPaymentEmoji(slots.payment_method || "");
  
  const message = `✅ *Gasto registrado!*\n\n` +
    `💸 *-R$ ${slots.amount?.toFixed(2)}*\n` +
    `📂 ${category}\n` +
    (slots.description ? `📝 ${slots.description}\n` : "") +
    `${paymentEmoji} ${slots.payment_method}\n` +
    `📅 ${formattedDateTime}\n\n` +
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
