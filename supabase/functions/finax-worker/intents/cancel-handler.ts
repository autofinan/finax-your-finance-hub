// ============================================================================
// 🗑️ CANCEL HANDLER - Extraído de index.ts para modularização
// ============================================================================
// listTransactionsForCancel, cancelTransaction, getLastTransaction,
// updateTransactionPaymentMethod
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📋 LISTAR TRANSAÇÕES PARA CANCELAMENTO
// ============================================================================

export async function listTransactionsForCancel(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, categoria, data, status")
    .eq("usuario_id", userId)
    .in("status", ["confirmada", "prevista"])
    .order("created_at", { ascending: false })
    .limit(5);
  return data || [];
}

// ============================================================================
// ❌ CANCELAR TRANSAÇÃO
// ============================================================================

export async function cancelTransaction(userId: string, txId: string): Promise<{ success: boolean; message: string }> {
  const { data: tx } = await supabase.from("transacoes").select("*").eq("id", txId).eq("usuario_id", userId).single();
  if (!tx) return { success: false, message: "Transação não encontrada 🤔" };
  if (tx.status === "cancelada") return { success: false, message: "Já foi cancelada 👍" };
  
  await supabase.from("transacoes").update({ status: "cancelada" }).eq("id", txId);
  return { success: true, message: `✅ *Transação cancelada!*\n\n🗑️ R$ ${tx.valor?.toFixed(2)} - ${tx.descricao || tx.categoria}` };
}

// ============================================================================
// 🔍 BUSCAR ÚLTIMA TRANSAÇÃO
// ============================================================================

export async function getLastTransaction(userId: string, withinMinutes: number = 5): Promise<any | null> {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  
  const { data } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("status", "confirmada")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  return data || null;
}

// ============================================================================
// ✏️ ATUALIZAR FORMA DE PAGAMENTO
// ============================================================================

export async function updateTransactionPaymentMethod(txId: string, newMethod: string): Promise<{ success: boolean; message: string }> {
  const { data: tx, error } = await supabase
    .from("transacoes")
    .update({ forma_pagamento: newMethod })
    .eq("id", txId)
    .select("valor, descricao, categoria")
    .single();
  
  if (error || !tx) {
    console.error("❌ [EDIT] Erro ao atualizar:", error);
    return { success: false, message: "Não consegui corrigir 😕" };
  }
  
  const paymentEmoji = newMethod === "pix" ? "📱" : newMethod === "debito" ? "💳" : newMethod === "credito" ? "💳" : "💵";
  
  return {
    success: true,
    message: `✅ *Corrigido!*\n\n💸 R$ ${tx.valor?.toFixed(2)} agora é *${paymentEmoji} ${newMethod}*`
  };
}
