// ============================================================================
// 📦 CONTEXT MANAGER - Gerenciamento de Estado
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ActiveAction, InternalActionType } from "../decision/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ACTION_TTL_MINUTES = 5;

// ============================================================================
// 🎯 ACTIVE ACTIONS
// ============================================================================

export async function getActiveAction(userId: string): Promise<ActiveAction | null> {
  // Expirar actions antigas
  const expireTime = new Date(Date.now() - ACTION_TTL_MINUTES * 60 * 1000).toISOString();
  
  await supabase
    .from("actions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection"])
    .lt("updated_at", expireTime);
  
  const { data: action } = await supabase
    .from("actions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection", "awaiting_confirmation"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!action) return null;
  
  const meta = (action.meta || {}) as Record<string, any>;
  const slots = (action.slots || {}) as Record<string, any>;
  
  return {
    id: action.id,
    user_id: action.user_id,
    type: meta.action_type || "slot_filling",
    intent: action.action_type,
    slots,
    status: action.status,
    pending_slot: meta.pending_slot || null,
    pending_selection_id: meta.pending_selection_id || null,
    origin_message_id: meta.origin_message_id || null,
    last_message_id: meta.last_message_id || null,
    created_at: action.created_at,
    updated_at: action.updated_at || action.created_at,
    expires_at: meta.expires_at || new Date(Date.now() + ACTION_TTL_MINUTES * 60 * 1000).toISOString()
  };
}

export async function createAction(
  userId: string,
  type: InternalActionType,
  intent: string,
  slots: Record<string, any>,
  pendingSlot?: string | null,
  messageId?: string | null,
  pendingSelectionId?: string | null
): Promise<ActiveAction> {
  // ========================================================================
  // 🔒 ACTION LOCK: GARANTIR APENAS 1 ACTION ATIVA POR USUÁRIO
  // ========================================================================
  // REGRA ABSOLUTA: Antes de criar nova action, fechar TODAS as anteriores.
  // Isso previne "actions zumbis" e conflitos de contexto.
  // ========================================================================
  
  const { data: closedActions } = await supabase
    .from("actions")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection", "awaiting_confirmation"])
    .select("id");
  
  const closedCount = closedActions?.length || 0;
  if (closedCount && closedCount > 0) {
    console.log(`🔒 [LOCK] ${closedCount} actions anteriores fechadas (superseded)`);
  }
  
  // ========================================================================
  // CRIAR NOVA ACTION (ÚNICA ATIVA)
  // ========================================================================
  
  const actionHash = `action_${userId.slice(0, 8)}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + ACTION_TTL_MINUTES * 60 * 1000).toISOString();
  
  const { data: newAction, error } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: intent,
      action_hash: actionHash,
      status: pendingSelectionId ? "pending_selection" : "collecting",
      slots,
      meta: { 
        action_type: type,
        pending_slot: pendingSlot || undefined,
        pending_selection_id: pendingSelectionId || undefined,
        origin_message_id: messageId || undefined,
        last_message_id: messageId || undefined,
        expires_at: expiresAt
      }
    })
    .select()
    .single();
  
  if (error) {
    console.error("❌ [CONTEXT] Erro ao criar action:", error);
    throw error;
  }
  
  console.log(`✨ [CONTEXT] Action criada (ÚNICA): ${type} | ${intent}`);
  
  return {
    id: newAction.id,
    user_id: userId,
    type,
    intent,
    slots,
    status: pendingSelectionId ? "pending_selection" : "collecting",
    pending_slot: pendingSlot || undefined,
    pending_selection_id: pendingSelectionId || undefined,
    origin_message_id: messageId || undefined,
    last_message_id: messageId || undefined,
    created_at: newAction.created_at,
    updated_at: newAction.created_at,
    expires_at: expiresAt
  };
}

export async function updateAction(
  actionId: string,
  updates: {
    slots?: Record<string, any>;
    status?: string;
    pending_slot?: string | null;
    pending_selection_id?: string | null;
    last_message_id?: string | null;
  }
): Promise<void> {
  const { data: existing } = await supabase
    .from("actions")
    .select("meta, slots")
    .eq("id", actionId)
    .single();
  
  const meta = { ...(existing?.meta as Record<string, any> || {}) };
  
  if (updates.pending_slot !== undefined) meta.pending_slot = updates.pending_slot;
  if (updates.pending_selection_id !== undefined) meta.pending_selection_id = updates.pending_selection_id;
  if (updates.last_message_id) meta.last_message_id = updates.last_message_id;
  
  const updateData: Record<string, any> = {
    meta,
    updated_at: new Date().toISOString()
  };
  
  // Merge slots ao invés de substituir
  if (updates.slots) {
    const existingSlots = (existing?.slots as Record<string, any>) || {};
    updateData.slots = { ...existingSlots, ...updates.slots };
  }
  if (updates.status) updateData.status = updates.status;
  
  await supabase
    .from("actions")
    .update(updateData)
    .eq("id", actionId);
  
  console.log(`🔄 [CONTEXT] Action atualizada: ${actionId.slice(-8)}`);
}

export async function closeAction(actionId: string, entityId?: string): Promise<void> {
  await supabase
    .from("actions")
    .update({ 
      status: "done", 
      entity_id: entityId,
      updated_at: new Date().toISOString() 
    })
    .eq("id", actionId);
  
  console.log(`✅ [CONTEXT] Action fechada: ${actionId.slice(-8)}`);
}

export async function cancelActiveAction(userId: string): Promise<boolean> {
  const action = await getActiveAction(userId);
  if (!action) return false;
  
  await supabase
    .from("actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", action.id);
  
  console.log(`🗑️ [CONTEXT] Action cancelada: ${action.id.slice(-8)}`);
  return true;
}

// ============================================================================
// 📋 PENDING SELECTIONS
// ============================================================================

export async function createPendingSelection(
  userId: string,
  options: Array<{ index: number; tx_id?: string; label: string; meta?: any }>,
  awaitingField: string,
  ttlMinutes: number = 2
): Promise<string> {
  const { crypto } = await import("https://deno.land/std@0.168.0/crypto/mod.ts");
  
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const token = crypto.randomUUID();
  
  const { data } = await supabase.from("pending_selections").insert({
    user_id: userId,
    token,
    options,
    awaiting_field: awaitingField,
    consumed: false,
    expires_at: expiresAt.toISOString()
  }).select("id").single();
  
  console.log(`📋 [CONTEXT] Pending selection criada: ${awaitingField}`);
  return data?.id || token;
}

export async function getPendingSelection(
  userId: string,
  awaitingField: string
): Promise<{ id: string; options: any[] } | null> {
  const { data } = await supabase
    .from("pending_selections")
    .select("id, options")
    .eq("user_id", userId)
    .eq("awaiting_field", awaitingField)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!data) return null;
  return { id: data.id, options: data.options as any[] };
}

export async function consumePendingSelection(pendingId: string): Promise<void> {
  await supabase
    .from("pending_selections")
    .update({ consumed: true })
    .eq("id", pendingId);
}

// ============================================================================
// 🔒 ANTI-DUPLICAÇÃO
// ============================================================================

export function generateDedupeHash(
  userId: string,
  amount: number | undefined,
  description: string | undefined,
  paymentMethod: string | undefined
): string {
  const amountCents = Math.round((amount || 0) * 100);
  const descNorm = (description || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
  const payment = (paymentMethod || "unknown").toLowerCase();
  
  const hashInput = `${userId}|${amountCents}|${descNorm}|${payment}`;
  
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    hash = ((hash << 5) - hash) + hashInput.charCodeAt(i);
    hash = hash & hash;
  }
  
  return `dedupe_${userId.slice(0, 8)}_${Math.abs(hash).toString(36)}`;
}

export async function checkDuplicate(
  userId: string,
  dedupeHash: string,
  windowMinutes: number = 3
): Promise<{ isDuplicate: boolean; existingTx?: any; minutesAgo?: number }> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  
  const { data: existing } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, created_at")
    .eq("usuario_id", userId)
    .eq("idempotency_key", dedupeHash)
    .gte("created_at", windowStart)
    .eq("status", "confirmada")
    .limit(1)
    .single();
  
  if (existing) {
    const minutesAgo = Math.round((Date.now() - new Date(existing.created_at).getTime()) / 60000);
    console.log(`🔒 [CONTEXT] Duplicado detectado há ${minutesAgo} min`);
    return { isDuplicate: true, existingTx: existing, minutesAgo };
  }
  
  return { isDuplicate: false };
}

// ============================================================================
// 📊 HISTÓRICO
// ============================================================================

export async function getRecentHistory(userId: string, limit: number = 5): Promise<string> {
  const { data } = await supabase
    .from("historico_conversas")
    .select("user_message, ai_response, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  
  if (!data || data.length === 0) return "";
  
  return data.reverse().map(h => 
    `[${new Date(h.created_at).toLocaleTimeString("pt-BR")}] User: ${h.user_message?.slice(0, 50)}`
  ).join("\n");
}

export async function saveHistory(
  phoneNumber: string,
  userId: string,
  userMessage: string,
  aiResponse: string,
  tipo: string
): Promise<void> {
  await supabase.from("historico_conversas").insert({
    phone_number: phoneNumber,
    user_id: userId,
    user_message: userMessage,
    ai_response: aiResponse,
    tipo
  });
}

// ============================================================================
// 👤 USUÁRIO
// ============================================================================

export async function getUser(userId: string): Promise<any | null> {
  const { data } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", userId)
    .single();
  
  return data;
}

export async function getHistoryCount(phoneNumber: string): Promise<number> {
  const { count } = await supabase
    .from("historico_conversas")
    .select("id", { count: "exact", head: true })
    .eq("phone_number", phoneNumber);
  
  return count || 0;
}
