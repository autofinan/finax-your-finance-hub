// ============================================================================
// 💬 CONVERSATION CONTEXT - Memória de Curto Prazo (TTL 30min)
// ============================================================================
// Sistema simplificado de contexto conversacional para resolver referências
// implícitas como "e ontem?", "no mesmo cartão", "essa categoria".
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CONTEXT_TTL_MINUTES = 30;

// ============================================================================
// 📦 TIPOS
// ============================================================================

export interface ConversationContext {
  userId: string;
  currentTopic: string | null;
  lastIntent: string | null;
  lastTimeRange: string | null;
  lastQueryScope: string | null;
  lastCardId: string | null;
  lastGoalId: string | null;
  lastCategory: string | null;
  expiresAt: string;
}

// ============================================================================
// 📥 BUSCAR CONTEXTO (só se não expirado)
// ============================================================================

export async function getConversationContext(
  userId: string
): Promise<ConversationContext | null> {
  try {
    const { data } = await supabase
      .from("conversation_context")
      .select("*")
      .eq("user_id", userId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    
    if (!data) return null;
    
    return {
      userId: data.user_id,
      currentTopic: data.current_topic,
      lastIntent: data.last_intent,
      lastTimeRange: data.last_time_range,
      lastQueryScope: data.last_query_scope,
      lastCardId: data.last_card_id,
      lastGoalId: data.last_goal_id,
      lastCategory: data.last_category,
      expiresAt: data.expires_at
    };
  } catch (error) {
    console.error("❌ [CONTEXT] Erro ao buscar contexto:", error);
    return null;
  }
}

// ============================================================================
// 📤 ATUALIZAR CONTEXTO (UPSERT atômico)
// ============================================================================

export async function updateConversationContext(
  userId: string,
  updates: Partial<Omit<ConversationContext, 'userId' | 'expiresAt'>>
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CONTEXT_TTL_MINUTES * 60 * 1000).toISOString();
    
    const { error } = await supabase.from("conversation_context").upsert({
      user_id: userId,
      current_topic: updates.currentTopic ?? null,
      last_intent: updates.lastIntent ?? null,
      last_time_range: updates.lastTimeRange ?? null,
      last_query_scope: updates.lastQueryScope ?? null,
      last_card_id: updates.lastCardId ?? null,
      last_goal_id: updates.lastGoalId ?? null,
      last_category: updates.lastCategory ?? null,
      last_interaction_at: new Date().toISOString(),
      expires_at: expiresAt
    });
    
    if (error) throw error;
    
    console.log(`💬 [CONTEXT] Atualizado: topic=${updates.currentTopic}, intent=${updates.lastIntent}, timeRange=${updates.lastTimeRange}`);
  } catch (error) {
    console.error("❌ [CONTEXT] Erro ao atualizar contexto:", error);
  }
}

// ============================================================================
// 🗑️ LIMPAR CONTEXTO (comando "esquece")
// ============================================================================

export async function clearConversationContext(userId: string): Promise<void> {
  try {
    await supabase
      .from("conversation_context")
      .delete()
      .eq("user_id", userId);
    
    console.log(`💬 [CONTEXT] Limpo para user ${userId.slice(0, 8)}`);
  } catch (error) {
    console.error("❌ [CONTEXT] Erro ao limpar contexto:", error);
  }
}

// ============================================================================
// 🔄 HELPER: Mapear query_scope para topic
// ============================================================================

export function scopeToTopic(scope: string): string {
  switch (scope) {
    case "cards": return "cards";
    case "income": return "income";
    case "recurring": return "recurring";
    case "goals": return "goals";
    case "pending": return "pending";
    default: return "expenses";
  }
}
