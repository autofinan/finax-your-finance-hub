// ============================================================================
// 🔄 RECURRING HANDLER - Extraído de index.ts para modularização
// ============================================================================
// registerRecurring, tryRegisterRecurring, findRecurringByName,
// listActiveRecurrings, cancelRecurring
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { categorizeDescription } from "../ai/categorizer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface ExtractedSlots {
  amount?: number;
  description?: string;
  category?: string;
  periodicity?: string;
  day_of_month?: number;
  payment_method?: string;
  card?: string;
  card_id?: string;
  [key: string]: any;
}

// ============================================================================
// 📦 CONTRATO DE RECORRÊNCIA
// ============================================================================

interface RecurringContract {
  user_id: string;
  transaction_id: string;
  amount: number;
  description: string;
  periodicity: "monthly" | "weekly" | "yearly";
  day_of_month?: number;
  categoria?: string;
}

function validateRecurringContract(contract: Partial<RecurringContract>): string | null {
  if (!contract.user_id) return "user_id ausente";
  if (!contract.transaction_id) return "transaction_id ausente";
  if (typeof contract.amount !== "number" || isNaN(contract.amount) || contract.amount <= 0) return `amount inválido: ${contract.amount}`;
  if (!contract.description || contract.description.trim() === "") return "description ausente ou vazia";
  if (!["monthly", "weekly", "yearly"].includes(contract.periodicity || "")) return `periodicity inválido: ${contract.periodicity}`;
  return null;
}

function normalizePeriodicityForDB(periodicity: string): string {
  const map: Record<string, string> = {
    "monthly": "Mensal",
    "weekly": "Semanal",
    "yearly": "Mensal",
    "mensal": "Mensal",
    "semanal": "Semanal",
    "anual": "Mensal"
  };
  return map[periodicity.toLowerCase()] || "Mensal";
}

// ============================================================================
// 🛡️ FUNÇÃO DEFENSIVA - NUNCA lança exceção
// ============================================================================

export async function tryRegisterRecurring(contract: Partial<RecurringContract>): Promise<{ success: boolean; reason?: string; recurrenceId?: string }> {
  const validationError = validateRecurringContract(contract);
  if (validationError) {
    console.log(`🔄 [RECURRING][SKIP] Contrato inválido: ${validationError}`, JSON.stringify(contract));
    return { success: false, reason: validationError };
  }
  
  const tipoRecorrencia = normalizePeriodicityForDB(contract.periodicity!);
  const dayOfMonth = contract.day_of_month || new Date().getDate();
  
  console.log(`🔄 [RECURRING][ATTEMPT] Criando recorrência: ${contract.description} - R$ ${contract.amount} (${tipoRecorrencia}, dia ${dayOfMonth})`);
  
  try {
    const { data: recorrencia, error: recError } = await supabase.from("gastos_recorrentes").insert({
      usuario_id: contract.user_id,
      valor_parcela: contract.amount,
      categoria: contract.categoria || "outros",
      descricao: contract.description,
      tipo_recorrencia: tipoRecorrencia,
      dia_mes: dayOfMonth,
      ativo: true,
      origem: "whatsapp"
    }).select("id").single();
    
    if (recError) {
      console.error(`🔄 [RECURRING][DB_ERROR] Falha no insert:`, recError.message, recError.details, recError.hint);
      return { success: false, reason: `DB: ${recError.message}` };
    }
    
    await supabase.from("transacoes").update({ id_recorrente: recorrencia.id }).eq("id", contract.transaction_id);
    
    console.log(`🔄 [RECURRING][SUCCESS] Recorrência criada: ${recorrencia.id}`);
    return { success: true, recurrenceId: recorrencia.id };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`🔄 [RECURRING][EXCEPTION] Erro inesperado:`, errorMsg);
    return { success: false, reason: `Exception: ${errorMsg}` };
  }
}

// ============================================================================
// 🔄 REGISTRAR RECORRÊNCIA (FUNÇÃO PRINCIPAL)
// ============================================================================

export async function registerRecurring(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount;
  const descricao = slots.description || "";
  const periodicity = (slots.periodicity || "monthly") as "monthly" | "weekly" | "yearly";
  const dayOfMonth = slots.day_of_month || new Date().getDate();
  
  if (!valor || typeof valor !== "number" || valor <= 0) {
    console.error(`🔄 [RECURRING][GUARD] Valor inválido: ${valor}`);
    return { success: false, message: "Falta informar o valor 💰" };
  }
  
  const categoryResult = await categorizeDescription(descricao, slots.category);
  const categoria = categoryResult.category;
  
  console.log(`🔄 [RECURRING] Iniciando: R$ ${valor} - ${descricao} (${periodicity})`);
  console.log(`📂 [RECURRING] Categorização: "${descricao}" → ${categoria} (fonte: ${categoryResult.source})`);
  
  const agora = new Date();
  
  const { data: tx, error: txError } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    recorrente: true,
    status: "confirmada"
  }).select("id").single();
  
  if (txError) {
    console.error("❌ [RECURRING] Erro ao criar transação:", txError);
    return { success: false, message: "Algo deu errado ao registrar 😕" };
  }
  
  console.log(`🔄 [RECURRING] Transação criada: ${tx.id}`);
  
  const recurringResult = await tryRegisterRecurring({
    user_id: userId,
    transaction_id: tx.id,
    amount: valor,
    description: descricao,
    periodicity: periodicity,
    day_of_month: dayOfMonth,
    categoria: categoria
  });
  
  if (actionId) {
    await supabase.from("actions").update({ status: "done", entity_id: tx.id, updated_at: new Date().toISOString() }).eq("id", actionId);
  }
  
  const diaLabel = dayOfMonth === 1 ? "início" : dayOfMonth >= 25 ? "fim" : `dia ${dayOfMonth}`;
  
  if (recurringResult.success) {
    return {
      success: true,
      message: `🔄 *Gasto recorrente salvo!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n📅 Todo ${diaLabel} do mês\n\n✅ _Registrei o gasto de hoje e agendei os próximos!_`
    };
  } else {
    console.log(`🔄 [RECURRING][PARTIAL] Transação OK, recorrência falhou: ${recurringResult.reason}`);
    return { 
      success: true, 
      message: `✅ *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n\n⚠️ _Não consegui agendar os próximos meses (${recurringResult.reason})_`
    };
  }
}

// ============================================================================
// 🔍 BUSCA E LISTAGEM DE RECORRENTES
// ============================================================================

export async function findRecurringByName(userId: string, searchTerm: string): Promise<any[]> {
  const { data: recorrentes } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .ilike("descricao", `%${searchTerm}%`);
  
  return recorrentes || [];
}

export async function listActiveRecurrings(userId: string): Promise<any[]> {
  const { data: recorrentes } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .order("created_at", { ascending: false })
    .limit(10);
  
  return recorrentes || [];
}

export async function cancelRecurring(userId: string, recurringId: string): Promise<{ success: boolean; message: string }> {
  const { data: recorrente } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("id", recurringId)
    .eq("usuario_id", userId)
    .single();
  
  if (!recorrente) {
    return { success: false, message: "Recorrente não encontrado 🤔" };
  }
  
  await supabase
    .from("gastos_recorrentes")
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq("id", recurringId);
  
  return {
    success: true,
    message: `✅ *Recorrente cancelado!*\n\n🗑️ ${recorrente.descricao} - R$ ${recorrente.valor_parcela?.toFixed(2)}/mês\n\n_Não será mais cobrado automaticamente._`
  };
}
