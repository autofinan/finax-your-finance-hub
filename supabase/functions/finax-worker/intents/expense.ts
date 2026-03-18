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
    // ✅ A data dos slots JÁ VEM CORRETA do parseRelativeDate()
    // NÃO chamar getBrasiliaISO() - evita double-shift de -3h!
    dateISO = slots.transaction_date;
    transactionDate = new Date(slots.transaction_date);
    
    // Extrair só a hora (HH:mm) da string ISO
    timeString = dateISO.substring(11, 16);
    
    console.log(`📅 [EXPENSE] Data dos slots (SEM CONVERTER): ${dateISO}`);
    console.log(`📅 [EXPENSE] Hora extraída: ${timeString}`);
  } else {
    // ✅ CORREÇÃO: getBrasiliaISO() sem argumento — usa new Date() internamente
    transactionDate = new Date();
    const result = getBrasiliaISO();
    dateISO = result.dateISO;
    timeString = result.timeString;
    
    console.log(`📅 [EXPENSE] Data atual: ${dateISO} (${timeString})`);
  }
  
  const resolvedCardId = slots.card_id || (
    typeof slots.card === "string" && /^[0-9a-fA-F-]{36}$/.test(slots.card)
      ? slots.card
      : null
  );

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
    id_cartao: resolvedCardId,
    context_id: activeContext?.id || null
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    
    // Handle duplicate idempotency_key gracefully (error 23505)
    if (error.code === "23505" && error.message?.includes("idempotency_key")) {
      console.log(`⚠️ [EXPENSE] Duplicate idempotency_key, retrying without it`);
      
      // Retry insert without idempotency_key
      const { data: retryTx, error: retryError } = await supabase.from("transacoes").insert({
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
        id_cartao: resolvedCardId,
        context_id: activeContext?.id || null
      }).select("id").single();
      
      if (retryError) {
        console.error("❌ [EXPENSE] Retry also failed:", retryError);
        if (actionId) {
          const { data: action } = await supabase.from("actions").select("meta").eq("id", actionId).single();
          await markAsExecuted(action?.meta?.decision_id, false);
        }
        return { success: false, message: "Ops, algo deu errado ao registrar 😕" };
      }
      
      // Use retry result - continue flow below with retryTx
      (transaction as any) = retryTx;
    } else {
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
  // ✅ FORMATAR DATA/HORA DIRETO DA STRING ISO (SEM converter Date)
  // ========================================================================
  // dateISO já contém data/hora corretas de Brasília (ex: "2026-02-06T15:33:52-03:00")
  // NUNCA usar new Date() + Intl/toLocaleString — causa double-shift de timezone
  const [_datePart] = dateISO.split('T');
  const [_y, _m, _d] = _datePart.split('-');
  const _time = dateISO.substring(11, 16); // "15:33"
  const formattedDateTime = `${_d}/${_m}/${_y} às ${_time}`;
  
  const paymentEmoji = getPaymentEmoji(slots.payment_method || "");
  
  console.log(`✅ [EXPENSE] Registrado: ${transaction.id}`);
  console.log(`📅 [EXPENSE] Salvo no banco: ${dateISO}`);
  console.log(`📅 [EXPENSE] Mostrado ao usuário: ${formattedDateTime}`);
  
  const message = `✅ Gasto registrado!\n\n📝 ${slots.description || category}\n💰 R$ ${(slots.amount || 0).toFixed(2)}\n${paymentEmoji} ${slots.payment_method || "pix"}\n📅 ${formattedDateTime}`;

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
