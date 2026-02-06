// ============================================================================
// 💸 INTENT: EXPENSE (Registrar Gasto) - VERSÃO CORRIGIDA
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots, SLOT_REQUIREMENTS } from "../decision/types.ts";
import { 
  closeAction, 
  generateDedupeHash, 
  checkDuplicate,
  createAction
} from "../context/manager.ts";
import { learnMerchantPattern } from "../memory/patterns.ts";
import { checkImmediateAlerts } from "../intents/alerts.ts";
import { getDecisionConfig, recordMetric } from "../governance/config.ts";
import { categorizeDescription } from "../ai/categorizer.ts";
import { 
  getBrasiliaDate, 
  getBrasiliaISO, 
  formatBrasiliaDateTime, 
  getPaymentEmoji,
  getCategoryEmoji 
} from "../utils/date-helpers.ts";
import { markAsExecuted } from "../utils/ai-decisions.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
  console.log(`💸 [EXPENSE] ============================================`);
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
  
  // Categorização IA-First
  const categoryResult = await categorizeDescription(
    slots.description || "",
    slots.category
  );
  const category = categoryResult.category;
  
  console.log(`📂 [EXPENSE] Categorização: "${slots.description}" → ${category}`);
  console.log(`   └─ Fonte: ${categoryResult.source}, Confiança: ${categoryResult.confidence}`);
  if (categoryResult.learned) {
    console.log(`   └─ 🧠 Termo "${categoryResult.keyTerm}" aprendido!`);
  }
  
  // Buscar contexto ativo
  const { data: activeContext } = await supabase
    .from("user_contexts")
    .select("id, label")
    .eq("user_id", userId)
    .eq("status", "active")
    .single();
  
  if (activeContext) {
    console.log(`📍 [EXPENSE] Contexto ativo: ${activeContext.label}`);
  }
  
  // ========================================================================
  // ✅ CORREÇÃO DEFINITIVA: Processar data corretamente
  // ========================================================================
  let finalDate: Date;
  let dateISO: string;
  let timeString: string;
  
  if (slots.transaction_date) {
    // ✅ Usuário especificou data ("ontem", "dia 15", etc)
    console.log(`📅 [EXPENSE] ========================================`);
    console.log(`📅 [EXPENSE] SLOTS TEM TRANSACTION_DATE!`);
    console.log(`📅 [EXPENSE] Valor recebido: ${slots.transaction_date}`);
    
    // Converter string ISO para Date
    finalDate = new Date(slots.transaction_date);
    console.log(`📅 [EXPENSE] Convertido para Date: ${finalDate.toISOString()}`);
    
    // Converter para ISO Brasília
    const result = getBrasiliaISO(finalDate);
    dateISO = result.dateISO;
    timeString = result.timeString;
    
    console.log(`📅 [EXPENSE] Final ISO: ${dateISO}`);
    console.log(`📅 [EXPENSE] Final Time: ${timeString}`);
    console.log(`📅 [EXPENSE] ========================================`);
    
  } else {
    // ✅ Usuário NÃO especificou data → usar AGORA
    console.log(`📅 [EXPENSE] ========================================`);
    console.log(`📅 [EXPENSE] SEM TRANSACTION_DATE - usando data atual`);
    
    finalDate = getBrasiliaDate();
    const result = getBrasiliaISO(finalDate);
    dateISO = result.dateISO;
    timeString = result.timeString;
    
    console.log(`📅 [EXPENSE] Data atual Brasília: ${dateISO}`);
    console.log(`📅 [EXPENSE] Hora atual: ${timeString}`);
    console.log(`📅 [EXPENSE] ========================================`);
  }
  
  // Salvar no banco
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
    console.error("❌ [EXPENSE] Erro ao salvar:", error);
    
    if (actionId) {
      const { data: action } = await supabase
        .from("actions")
        .select("meta")
        .eq("id", actionId)
        .single();
      
      const decisionId = action?.meta?.decision_id;
      await markAsExecuted(decisionId, false);
    }
    
    return {
      success: false,
      message: "Ops, algo deu errado ao registrar 😕"
    };
  }
  
  // Marcar decisão como executada
  if (actionId) {
    const { data: action } = await supabase
      .from("actions")
      .select("meta")
      .eq("id", actionId)
      .single();
    
    const decisionId = action?.meta?.decision_id;
    await markAsExecuted(decisionId, true);
  }
  
  // Fechar action
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
  
  // Elite integrations
  const config = await getDecisionConfig();
  
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
  
  try {
    await checkImmediateAlerts(userId, {
      valor: slots.amount!,
      categoria: category,
      descricao: slots.description || category
    });
  } catch (err) {
    console.error(`🚨 [ALERTS] Erro ao verificar alertas:`, err);
  }
  
  await recordMetric("expense_registered", slots.amount || 0, {
    category,
    payment_method: slots.payment_method || "unknown"
  });
  
  // ========================================================================
  // ✅ FORMATAR MENSAGEM COM DATA CORRETA
  // ========================================================================
  const formattedDateTime = formatBrasiliaDateTime(finalDate);
  const paymentEmoji = getPaymentEmoji(slots.payment_method || "");
  const categoryEmoji = getCategoryEmoji(category);
  
  const message = `${categoryEmoji} *Gasto registrado!*\n\n` +
    `💸 *-R$ ${slots.amount?.toFixed(2)}*\n` +
    `📂 ${category}\n` +
    (slots.description ? `📝 ${slots.description}\n` : "") +
    `${paymentEmoji} ${slots.payment_method}\n` +
    `📅 ${formattedDateTime}\n\n` +
    `_Responda "cancelar" se foi engano!_`;
  
  console.log(`✅ [EXPENSE] ============================================`);
  console.log(`✅ [EXPENSE] Registrado: ${transaction.id}`);
  console.log(`✅ [EXPENSE] Salvo no banco: ${dateISO}`);
  console.log(`✅ [EXPENSE] Mostrado ao usuário: ${formattedDateTime}`);
  console.log(`✅ [EXPENSE] ============================================`);
  
  return {
    success: true,
    message,
    transactionId: transaction.id
  };
}

export function getMissingExpenseSlots(slots: ExtractedSlots): string[] {
  const requirements = SLOT_REQUIREMENTS.expense;
  return requirements.required.filter(slot => !slots[slot]);
}
