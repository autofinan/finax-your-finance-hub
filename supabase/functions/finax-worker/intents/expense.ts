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
  console.log(`💸 [EXPENSE] Registrando: ${JSON.stringify(slots)}`);
  
  const requirements = SLOT_REQUIREMENTS.expense;
  for (const required of requirements.required) {
    if (!slots[required]) {
      return {
        success: false,
        message: `Falta informar: ${required}`
      };
    }
  }
  
  const dedupeHash = generateDedupeHash(
    userId,
    slots.amount,
    slots.description,
    slots.payment_method
  );
  
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
  // ✅ CORREÇÃO CRÍTICA: Preservar timezone ao converter transaction_date
  // ========================================================================
  let transactionDate: Date;
  let dateISO: string;
  let timeString: string;
  
  if (slots.transaction_date) {
    // Veio dos slots (ex: "uber 10 ontem")
    // NÃO converter para new Date() diretamente pois perde timezone
    const slotDate = new Date(slots.transaction_date);
    
    // Forçar interpretação como horário de Brasília
    const result = getBrasiliaISO(slotDate);
    dateISO = result.dateISO;
    timeString = result.timeString;
    transactionDate = slotDate;
    
    console.log(`📅 [EXPENSE] Data dos slots: ${slots.transaction_date}`);
    console.log(`📅 [EXPENSE] Convertido para: ${dateISO} (${timeString})`);
  } else {
    // Data atual de Brasília
    transactionDate = getBrasiliaDate();
    const result = getBrasiliaISO(transactionDate);
    dateISO = result.dateISO;
    timeString = result.timeString;
    
    console.log(`📅 [EXPENSE] Data atual: ${dateISO} (${timeString})`);
  }
  
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
  
  if (actionId) {
    const { data: action } = await supabase
      .from("actions")
      .select("meta")
      .eq("id", actionId)
      .single();
    
    const decisionId = action?.meta?.decision_id;
    await markAsExecuted(decisionId, true);
  }
  
  if (actionId) {
    await closeAction(actionId, transaction.id);
  }
  
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_gasto",
    entity_type: "transacao",
    entity_id: transaction.id,
    new_data: { ...slots, category }
  });
  
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
  // ✅ USAR DATA CORRETA NA MENSAGEM
  // ========================================================================
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
  console.log(`📅 [EXPENSE] Salvo no banco: ${dateISO}`);
  console.log(`📅 [EXPENSE] Mostrado ao usuário: ${formattedDateTime}`);
  
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
