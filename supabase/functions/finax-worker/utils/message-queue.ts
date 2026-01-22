// ============================================================================
// 📬 MESSAGE QUEUE - Sistema de fila de mensagens V2 (CORRIGIDO)
// ============================================================================
// Resolve o problema de mensagens múltiplas enviadas em sequência
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
  processing?: boolean; // Flag para evitar processamento duplicado
}

// ============================================================================
// 🔒 LOCK DE PROCESSAMENTO - Evita race conditions
// ============================================================================
const processingLocks = new Map<string, boolean>();

function acquireLock(userId: string): boolean {
  if (processingLocks.get(userId)) {
    return false; // Já está processando
  }
  processingLocks.set(userId, true);
  return true;
}

function releaseLock(userId: string): void {
  processingLocks.delete(userId);
}

// ============================================================================
// 📊 DETECÇÃO DE ESTADO DO USUÁRIO
// ============================================================================

/**
 * Verifica se o usuário está aguardando resposta de slot
 */
export async function isUserWaitingForSlot(userId: string): Promise<{
  waiting: boolean;
  slotType: string | null;
  transactionId: string | null;
}> {
  try {
    const { data, error } = await supabase
      .from("conversation_state")
      .select("pending_slot, current_transaction_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) {
      return { waiting: false, slotType: null, transactionId: null };
    }

    const waiting = !!data.pending_slot;
    
    return {
      waiting,
      slotType: data.pending_slot || null,
      transactionId: data.current_transaction_id || null
    };
  } catch (err) {
    console.error("❌ [QUEUE] Erro ao verificar estado:", err);
    return { waiting: false, slotType: null, transactionId: null };
  }
}

// ============================================================================
// 📬 GERENCIAMENTO DA FILA
// ============================================================================

/**
 * Enfileira uma mensagem para processamento posterior
 */
export async function queueMessage(
  userId: string,
  messageText: string,
  messageId: string
): Promise<boolean> {
  try {
    // Verificar se já existe na fila (evitar duplicatas)
    const { data: existing } = await supabase
      .from("pending_messages")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle();

    if (existing) {
      console.log(`⚠️ [QUEUE] Mensagem ${messageId} já está na fila`);
      return false;
    }

    const { error } = await supabase
      .from("pending_messages")
      .insert({
        user_id: userId,
        message_text: messageText,
        message_id: messageId,
        processed: false,
        processing: false,
      });
    
    if (error) {
      console.error("❌ [QUEUE] Erro ao enfileirar:", error);
      return false;
    }
    
    console.log(`📬 [QUEUE] Mensagem enfileirada para ${userId}: "${messageText.slice(0, 40)}..."`);
    return true;
  } catch (err) {
    console.error("❌ [QUEUE] Exceção ao enfileirar:", err);
    return false;
  }
}

/**
 * Busca próxima mensagem pendente (apenas UMA por vez)
 */
export async function getNextPendingMessage(userId: string): Promise<PendingMessage | null> {
  try {
    const { data, error } = await supabase
      .from("pending_messages")
      .select("*")
      .eq("user_id", userId)
      .eq("processed", false)
      .eq("processing", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    
    if (error) {
      console.error("❌ [QUEUE] Erro ao buscar próxima mensagem:", error);
      return null;
    }
    
    if (!data) {
      return null;
    }

    // Marcar como "em processamento" para evitar duplicação
    await supabase
      .from("pending_messages")
      .update({ processing: true })
      .eq("id", data.id);
    
    return data;
  } catch (err) {
    console.error("❌ [QUEUE] Exceção ao buscar próxima:", err);
    return null;
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
        processing: false,
        processed_at: new Date().toISOString() 
      })
      .eq("id", messageId);
    
    console.log(`✅ [QUEUE] Mensagem ${messageId} marcada como processada`);
  } catch (err) {
    console.error("❌ [QUEUE] Erro ao marcar processada:", err);
  }
}

/**
 * Remove flag de processamento (em caso de erro)
 */
export async function releaseMessage(messageId: string): Promise<void> {
  try {
    await supabase
      .from("pending_messages")
      .update({ processing: false })
      .eq("id", messageId);
  } catch (err) {
    console.error("❌ [QUEUE] Erro ao liberar mensagem:", err);
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
 * Limpa todas as mensagens pendentes de um usuário (emergência)
 */
export async function clearUserQueue(userId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("pending_messages")
      .delete()
      .eq("user_id", userId)
      .eq("processed", false)
      .select("id");
    
    if (error) {
      console.error("❌ [QUEUE] Erro ao limpar fila:", error);
      return 0;
    }
    
    const count = data?.length || 0;
    if (count > 0) {
      console.log(`🧹 [QUEUE] Limpas ${count} mensagens da fila de ${userId}`);
    }
    
    return count;
  } catch (err) {
    console.error("❌ [QUEUE] Exceção ao limpar:", err);
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
      console.error("❌ [QUEUE] Erro ao limpar antigas:", error);
      return 0;
    }
    
    const count = data?.length || 0;
    if (count > 0) {
      console.log(`🧹 [QUEUE] Removidas ${count} mensagens antigas`);
    }
    
    return count;
  } catch (err) {
    console.error("❌ [QUEUE] Exceção ao limpar antigas:", err);
    return 0;
  }
}

// ============================================================================
// 🧠 LÓGICA DE DECISÃO - Quando enfileirar vs processar
// ============================================================================

/**
 * Detecta se a mensagem é uma RESPOSTA ao slot atual ou um NOVO gasto
 * @returns "process" = processar agora | "queue" = enfileirar | "ignore" = ignorar
 */
export function analyzeMessage(
  messageText: string,
  pendingSlot: string | null
): "process" | "queue" | "ignore" {
  if (!pendingSlot) {
    return "process"; // Não está aguardando nada, processar normalmente
  }

  const normalized = messageText.toLowerCase().trim();
  
  // ========================================================================
  // AGUARDANDO FORMA DE PAGAMENTO
  // ========================================================================
  if (pendingSlot === "payment_method") {
    const paymentKeywords = [
      "pix", "debito", "débito", "credito", "crédito", 
      "dinheiro", "cartao", "cartão", "boleto", "transferencia"
    ];
    
    // Se menciona forma de pagamento = resposta ao slot
    if (paymentKeywords.some(kw => normalized.includes(kw))) {
      console.log(`✅ [QUEUE] Resposta ao slot payment_method: "${messageText}"`);
      return "process";
    }
    
    // Se tem valor numérico = provavelmente novo gasto
    if (/\d+/.test(normalized)) {
      console.log(`📬 [QUEUE] Detectado novo gasto durante slot: "${messageText}"`);
      return "queue";
    }
    
    // Se tem apenas emojis de pagamento
    if (/^[\p{Emoji}\s]*$/u.test(normalized) && normalized.length < 10) {
      console.log(`✅ [QUEUE] Emoji de pagamento: "${messageText}"`);
      return "process";
    }
    
    // Caso contrário, é resposta genérica ao slot
    console.log(`✅ [QUEUE] Texto genérico como resposta ao slot: "${messageText}"`);
    return "process";
  }
  
  // ========================================================================
  // AGUARDANDO VALOR
  // ========================================================================
  if (pendingSlot === "amount") {
    // Se é apenas número = resposta ao slot
    if (/^\s*\d+([.,]\d{1,2})?\s*$/.test(normalized)) {
      console.log(`✅ [QUEUE] Valor numérico para slot: "${messageText}"`);
      return "process";
    }
    
    // Se tem verbos de gasto + número = novo gasto
    const expenseVerbs = ["gastei", "comprei", "paguei", "custou", "pago"];
    if (expenseVerbs.some(v => normalized.includes(v)) && /\d+/.test(normalized)) {
      console.log(`📬 [QUEUE] Novo gasto detectado durante slot de valor: "${messageText}"`);
      return "queue";
    }
    
    // Se tem descrição + número = novo gasto (ex: "açaí 20")
    if (/[a-záàâãéèêíïóôõöúçñ]+\s+\d+/.test(normalized)) {
      console.log(`📬 [QUEUE] Gasto com descrição durante slot: "${messageText}"`);
      return "queue";
    }
    
    return "process";
  }
  
  // ========================================================================
  // AGUARDANDO DESCRIÇÃO
  // ========================================================================
  if (pendingSlot === "description") {
    // Se tem número = provavelmente novo gasto
    if (/\d+/.test(normalized)) {
      console.log(`📬 [QUEUE] Novo gasto com valor durante slot de descrição: "${messageText}"`);
      return "queue";
    }
    
    // Texto puro = resposta ao slot
    console.log(`✅ [QUEUE] Descrição fornecida: "${messageText}"`);
    return "process";
  }
  
  // ========================================================================
  // AGUARDANDO CATEGORIA
  // ========================================================================
  if (pendingSlot === "category") {
    const categories = [
      "alimentacao", "mercado", "transporte", "lazer", "saude",
      "educacao", "moradia", "vestuario", "tecnologia", "outros"
    ];
    
    // Se menciona categoria = resposta ao slot
    if (categories.some(cat => normalized.includes(cat))) {
      console.log(`✅ [QUEUE] Categoria fornecida: "${messageText}"`);
      return "process";
    }
    
    // Se tem número = novo gasto
    if (/\d+/.test(normalized)) {
      console.log(`📬 [QUEUE] Novo gasto durante slot de categoria: "${messageText}"`);
      return "queue";
    }
    
    return "process";
  }
  
  // Default: processar
  return "process";
}

// ============================================================================
// 🔄 PROCESSADOR DA FILA - Chame após completar um gasto
// ============================================================================

/**
 * Processa a próxima mensagem da fila (se houver)
 * @returns A mensagem processada ou null se não houver
 */
export async function processNextInQueue(
  userId: string
): Promise<PendingMessage | null> {
  // Verificar lock
  if (!acquireLock(userId)) {
    console.log(`⚠️ [QUEUE] Já está processando fila para ${userId}`);
    return null;
  }

  try {
    // Verificar se usuário ainda está aguardando slot
    const state = await isUserWaitingForSlot(userId);
    if (state.waiting) {
      console.log(`⚠️ [QUEUE] Usuário ainda aguardando slot, não processar fila`);
      releaseLock(userId);
      return null;
    }

    // Buscar próxima mensagem
    const nextMessage = await getNextPendingMessage(userId);
    
    if (!nextMessage) {
      console.log(`✅ [QUEUE] Fila vazia para ${userId}`);
      releaseLock(userId);
      return null;
    }

    console.log(`🔄 [QUEUE] Processando próxima da fila: "${nextMessage.message_text}"`);
    
    releaseLock(userId);
    return nextMessage;
    
  } catch (err) {
    console.error(`❌ [QUEUE] Erro ao processar fila:`, err);
    releaseLock(userId);
    return null;
  }
}

// ============================================================================
// 📊 STATUS DA FILA - Para debugging
// ============================================================================

export async function getQueueStatus(userId: string): Promise<{
  pending: number;
  processing: number;
  total: number;
}> {
  try {
    const { data, error } = await supabase
      .from("pending_messages")
      .select("processed, processing")
      .eq("user_id", userId);

    if (error || !data) {
      return { pending: 0, processing: 0, total: 0 };
    }

    const pending = data.filter(m => !m.processed && !m.processing).length;
    const processing = data.filter(m => !m.processed && m.processing).length;
    const total = data.length;

    return { pending, processing, total };
  } catch (err) {
    console.error("❌ [QUEUE] Erro ao obter status:", err);
    return { pending: 0, processing: 0, total: 0 };
  }
}
