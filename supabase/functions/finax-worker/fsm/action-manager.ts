// ============================================================================
// 🎯 ACTION MANAGER - Extraído de index.ts para modularização
// ============================================================================
// Gerencia o ciclo de vida das actions (slot filling, confirmação, etc.)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 TIPOS
// ============================================================================

export interface ActiveAction {
  id: string;
  user_id: string;
  type: string;
  intent: string;
  slots: Record<string, any>;
  status: string;
  pending_slot?: string | null;
  pending_selection_id?: string | null;
  origin_message_id?: string | null;
  last_message_id?: string | null;
  meta?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ============================================================================
// ⏱️ TTL CONFIGURÁVEL PARA ACTIONS (60 minutos)
// ============================================================================
export const ACTION_TTL_MINUTES = 60;

// ============================================================================
// 🔍 BUSCAR ACTION ATIVA
// ============================================================================

export async function getActiveAction(userId: string): Promise<ActiveAction | null> {
  const ttlAgo = new Date(Date.now() - ACTION_TTL_MINUTES * 60 * 1000).toISOString();
  
  await supabase
    .from("actions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection", "awaiting_confirmation"])
    .lt("updated_at", ttlAgo);
  
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
    expires_at: meta.expires_at || new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
}

// ============================================================================
// ✨ CRIAR ACTION
// ============================================================================

export async function createAction(
  userId: string,
  type: string,
  intent: string,
  slots: Record<string, any>,
  pendingSlot?: string | null,
  messageId?: string | null
): Promise<ActiveAction> {
  const actionHash = `action_${userId.slice(0, 8)}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + ACTION_TTL_MINUTES * 60 * 1000).toISOString();
  
  const { data: newAction, error } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: intent,
      action_hash: actionHash,
      status: "collecting",
      slots,
      meta: { 
        action_type: type,
        pending_slot: pendingSlot || undefined,
        origin_message_id: messageId || undefined,
        last_message_id: messageId || undefined,
        expires_at: expiresAt
      }
    })
    .select()
    .single();
  
  if (error) {
    console.error("❌ [ACTION] Erro ao criar:", error);
    throw error;
  }
  
  console.log(`✨ [ACTION] Criado: ${type} | ${intent} | Slots: ${JSON.stringify(slots)}`);
  
  return {
    id: newAction.id,
    user_id: userId,
    type,
    intent,
    slots,
    status: "collecting",
    pending_slot: pendingSlot || undefined,
    origin_message_id: messageId || undefined,
    last_message_id: messageId || undefined,
    created_at: newAction.created_at,
    updated_at: newAction.created_at,
    expires_at: expiresAt
  };
}

// ============================================================================
// 🔄 ATUALIZAR ACTION
// ============================================================================

export async function updateAction(
  actionId: string,
  updates: { slots?: Record<string, any>; status?: string; pending_slot?: string | null }
): Promise<void> {
  const { data: existing } = await supabase.from("actions").select("meta").eq("id", actionId).single();
  const meta = { ...(existing?.meta as Record<string, any> || {}) };
  
  if (updates.pending_slot !== undefined) meta.pending_slot = updates.pending_slot;
  
  const updateData: Record<string, any> = { meta, updated_at: new Date().toISOString() };
  if (updates.slots) updateData.slots = updates.slots;
  if (updates.status) updateData.status = updates.status;
  
  await supabase.from("actions").update(updateData).eq("id", actionId);
  console.log(`🔄 [ACTION] Atualizado: ${actionId.slice(-8)}`);
}

// ============================================================================
// ✅ FECHAR ACTION
// ============================================================================

export async function closeAction(actionId: string, entityId?: string): Promise<void> {
  await supabase.from("actions").update({ status: "done", entity_id: entityId, updated_at: new Date().toISOString() }).eq("id", actionId);
  console.log(`✅ [ACTION] Fechado: ${actionId.slice(-8)}`);
}

// ============================================================================
// 🗑️ CANCELAR ACTION
// ============================================================================

export async function cancelAction(userId: string): Promise<boolean> {
  const action = await getActiveAction(userId);
  if (!action) return false;
  
  await supabase.from("actions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", action.id);
  console.log(`🗑️ [ACTION] Cancelado: ${action.id.slice(-8)}`);
  return true;
}
