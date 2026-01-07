// ============================================================================
// 🗑️ INTENT: CANCEL (Cancelar Transação)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📋 LISTAR TRANSAÇÕES PARA CANCELAR
// ============================================================================

export async function listTransactionsForCancel(userId: string, limit: number = 5): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, categoria, data, created_at")
    .eq("usuario_id", userId)
    .eq("status", "confirmada")
    .order("created_at", { ascending: false })
    .limit(limit);
  
  return data || [];
}

// ============================================================================
// 🗑️ CANCELAR TRANSAÇÃO
// ============================================================================

export interface CancelResult {
  success: boolean;
  message: string;
}

export async function cancelTransaction(
  userId: string,
  transactionId: string
): Promise<CancelResult> {
  console.log(`🗑️ [CANCEL] Cancelando: ${transactionId}`);
  
  // Buscar transação
  const { data: transaction } = await supabase
    .from("transacoes")
    .select("*")
    .eq("id", transactionId)
    .eq("usuario_id", userId)
    .single();
  
  if (!transaction) {
    return {
      success: false,
      message: "Transação não encontrada 🤔"
    };
  }
  
  if (transaction.status === "cancelada") {
    return {
      success: false,
      message: "Essa transação já foi cancelada 👍"
    };
  }
  
  // Log antes de cancelar
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "cancelar_transacao",
    entity_type: "transacao",
    entity_id: transactionId,
    old_data: transaction,
    new_data: { status: "cancelada" }
  });
  
  // Cancelar
  const { error } = await supabase
    .from("transacoes")
    .update({ status: "cancelada" })
    .eq("id", transactionId);
  
  if (error) {
    console.error("❌ [CANCEL] Erro:", error);
    return {
      success: false,
      message: "Ops, algo deu errado ao cancelar 😕"
    };
  }
  
  console.log(`✅ [CANCEL] Transação cancelada: ${transactionId}`);
  
  return {
    success: true,
    message: `✅ *Transação cancelada!*\n\n` +
      `🗑️ R$ ${transaction.valor?.toFixed(2)} - ${transaction.descricao || transaction.categoria}\n\n` +
      `_Se foi engano, manda de novo!_`
  };
}

// ============================================================================
// 🔍 BUSCAR TRANSAÇÃO POR REPLY
// ============================================================================

export async function findTransactionByReply(
  userId: string, 
  replyMessageId: string
): Promise<any | null> {
  // Buscar evento bruto pela message_id
  const { data: evento } = await supabase
    .from("eventos_brutos")
    .select("id")
    .eq("message_id", replyMessageId)
    .single();
  
  if (!evento) return null;
  
  // Buscar actions relacionadas
  const { data: actions } = await supabase
    .from("actions")
    .select("entity_id")
    .eq("status", "done")
    .not("entity_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (!actions || actions.length === 0) return null;
  
  // Buscar transação
  for (const action of actions) {
    if (action.entity_id) {
      const { data: tx } = await supabase
        .from("transacoes")
        .select("*")
        .eq("id", action.entity_id)
        .eq("usuario_id", userId)
        .single();
      
      if (tx) return tx;
    }
  }
  
  return null;
}
