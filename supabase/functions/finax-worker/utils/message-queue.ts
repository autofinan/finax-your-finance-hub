// ============================================================================
// 📬 MESSAGE QUEUE - Fila de mensagens para evitar conflito de estados
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export interface PendingMessage {
  id: string;
  user_id: string;
  message_text: string;
  message_id: string;
  created_at: string;
  processed: boolean;
}

/**
 * Enfileira uma mensagem para processamento posterior
 * Usado quando o usuário envia nova mensagem enquanto aguarda resposta de slot
 */
export async function queueMessage(
  userId: string,
  messageText: string,
  messageId: string
): Promise<boolean> {
  try {
    const { error } = await supabase.from("pending_messages").insert({
      user_id: userId,
      message_text: messageText,
      message_id: messageId,
      processed: false,
    });
    
    if (error) {
      console.error("❌ [QUEUE] Erro ao enfileirar:", error);
      return false;
    }
    
    console.log(`📬 [QUEUE] Mensagem enfileirada para ${userId}: "${messageText.slice(0, 30)}..."`);
    return true;
  } catch (err) {
    console.error("❌ [QUEUE] Exceção:", err);
    return false;
  }
}

/**
 * Busca mensagens pendentes para um usuário
 */
export async function getPendingMessages(userId: string, limit: number = 5): Promise<PendingMessage[]> {
  try {
    const { data, error } = await supabase
      .from("pending_messages")
      .select("*")
      .eq("user_id", userId)
      .eq("processed", false)
      .order("created_at", { ascending: true })
      .limit(limit);
    
    if (error) {
      console.error("❌ [QUEUE] Erro ao buscar pendentes:", error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    console.error("❌ [QUEUE] Exceção ao buscar:", err);
    return [];
  }
}

/**
 * Marca uma mensagem como processada
 */
export async function markMessageProcessed(messageId: string): Promise<void> {
  try {
    await supabase
      .from("pending_messages")
      .update({ 
        processed: true, 
        processed_at: new Date().toISOString() 
      })
      .eq("id", messageId);
    
    console.log(`✅ [QUEUE] Mensagem ${messageId} marcada como processada`);
  } catch (err) {
    console.error("❌ [QUEUE] Erro ao marcar processada:", err);
  }
}

/**
 * Conta mensagens pendentes para um usuário
 */
export async function countPendingMessages(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("pending_messages")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("processed", false);
    
    if (error) {
      console.error("❌ [QUEUE] Erro ao contar:", error);
      return 0;
    }
    
    return count || 0;
  } catch (err) {
    console.error("❌ [QUEUE] Exceção ao contar:", err);
    return 0;
  }
}

/**
 * Limpa mensagens antigas processadas (housekeeping)
 */
export async function cleanupOldMessages(olderThanHours: number = 24): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from("pending_messages")
      .delete()
      .eq("processed", true)
      .lt("processed_at", cutoff)
      .select("id");
    
    if (error) {
      console.error("❌ [QUEUE] Erro ao limpar:", error);
      return 0;
    }
    
    const count = data?.length || 0;
    if (count > 0) {
      console.log(`🧹 [QUEUE] Removidas ${count} mensagens antigas`);
    }
    
    return count;
  } catch (err) {
    console.error("❌ [QUEUE] Exceção ao limpar:", err);
    return 0;
  }
}

/**
 * Verifica se deve enfileirar uma mensagem ou processar normalmente
 * Retorna true se a mensagem parece ser um novo gasto (não resposta a slot)
 */
export function shouldQueueMessage(
  messageText: string,
  pendingSlot: string | null
): boolean {
  if (!pendingSlot) return false;
  
  const normalized = messageText.toLowerCase().trim();
  
  // Se está aguardando forma de pagamento
  if (pendingSlot === "payment_method") {
    // Palavras que são respostas válidas ao slot
    const validResponses = ["pix", "debito", "débito", "credito", "crédito", "dinheiro", "cartao", "cartão"];
    if (validResponses.some(r => normalized.includes(r))) {
      return false; // É resposta ao slot, processar normalmente
    }
    
    // Se tem número, provavelmente é novo gasto → enfileirar
    if (/\d+/.test(normalized)) {
      return true;
    }
  }
  
  // Se está aguardando valor
  if (pendingSlot === "amount") {
    // Se é só número, é resposta ao slot
    if (/^\d+[.,]?\d*$/.test(normalized.replace(/\s/g, ""))) {
      return false;
    }
    
    // Se tem palavras de gasto + número, é novo gasto → enfileirar
    const expenseVerbs = ["gastei", "comprei", "paguei", "custou"];
    if (expenseVerbs.some(v => normalized.includes(v)) && /\d+/.test(normalized)) {
      return true;
    }
  }
  
  // Se está aguardando descrição
  if (pendingSlot === "description") {
    // Se tem número, pode ser novo gasto → enfileirar
    if (/\d+/.test(normalized)) {
      return true;
    }
  }
  
  return false;
}
