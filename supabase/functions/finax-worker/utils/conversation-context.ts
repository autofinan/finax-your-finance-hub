// ============================================================================
// 💬 CONVERSATION CONTEXT V2 - Memória de Curto Prazo Profissional
// ============================================================================
// MELHORIAS:
// ✅ Cleanup automático de contextos expirados
// ✅ Busca por nome de cartão/meta (não só ID)
// ✅ Suporte a start_date/end_date (para queries dinâmicas)
// ✅ Contador de interações (métricas de uso)
// ✅ Helpers para resolver referências
// ✅ Métricas de uso do contexto
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "./logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CONTEXT_TTL_MINUTES = 1440; // 24 horas - garante contexto mesmo se usuário demora para responder

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
  lastCardName: string | null; // ✅ NOVO
  lastGoalId: string | null;
  lastGoalName: string | null; // ✅ NOVO
  lastCategory: string | null;
  lastStartDate: string | null; // ✅ NOVO (para queries dinâmicas)
  lastEndDate: string | null;   // ✅ NOVO (para queries dinâmicas)
  interactionCount: number;     // ✅ NOVO (métricas)
  expiresAt: string;
}

// ============================================================================
// 🔥 BUSCAR CONTEXTO (só se não expirado)
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
    
    if (!data) {
      logger.debug({ component: "context", userId }, "Nenhum contexto ativo");
      return null;
    }
    
    // ✅ Incrementar contador de uso (para métricas) - Fire-and-forget
    void supabase.from("conversation_context")
      .update({ interaction_count: (data.interaction_count || 0) + 1 })
      .eq("user_id", userId);
    
    logger.debug({ 
      component: "context", 
      userId,
      topic: data.current_topic,
      intent: data.last_intent
    }, "Contexto recuperado");
    
    return {
      userId: data.user_id,
      currentTopic: data.current_topic,
      lastIntent: data.last_intent,
      lastTimeRange: data.last_time_range,
      lastQueryScope: data.last_query_scope,
      lastCardId: data.last_card_id,
      lastCardName: data.last_card_name,
      lastGoalId: data.last_goal_id,
      lastGoalName: data.last_goal_name,
      lastCategory: data.last_category,
      lastStartDate: data.last_start_date,
      lastEndDate: data.last_end_date,
      interactionCount: data.interaction_count || 0,
      expiresAt: data.expires_at
    };
  } catch (error) {
    logger.error({ component: "context", userId }, "Erro ao buscar contexto");
    return null;
  }
}

// ============================================================================
// 📤 ATUALIZAR CONTEXTO (UPSERT atômico com merge)
// ============================================================================

export async function updateConversationContext(
  userId: string,
  updates: Partial<Omit<ConversationContext, 'userId' | 'expiresAt' | 'interactionCount'>>
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CONTEXT_TTL_MINUTES * 60 * 1000).toISOString();
    
    // Buscar contexto atual para fazer merge (não sobrescrever campos não enviados)
    const current = await getConversationContext(userId);
    
    const { error } = await supabase.from("conversation_context").upsert({
      user_id: userId,
      current_topic: updates.currentTopic ?? current?.currentTopic ?? null,
      last_intent: updates.lastIntent ?? current?.lastIntent ?? null,
      last_time_range: updates.lastTimeRange ?? current?.lastTimeRange ?? null,
      last_query_scope: updates.lastQueryScope ?? current?.lastQueryScope ?? null,
      last_card_id: updates.lastCardId ?? current?.lastCardId ?? null,
      last_card_name: updates.lastCardName ?? current?.lastCardName ?? null,
      last_goal_id: updates.lastGoalId ?? current?.lastGoalId ?? null,
      last_goal_name: updates.lastGoalName ?? current?.lastGoalName ?? null,
      last_category: updates.lastCategory ?? current?.lastCategory ?? null,
      last_start_date: updates.lastStartDate ?? current?.lastStartDate ?? null,
      last_end_date: updates.lastEndDate ?? current?.lastEndDate ?? null,
      last_interaction_at: new Date().toISOString(),
      interaction_count: (current?.interactionCount || 0) + 1,
      expires_at: expiresAt
    });
    
    if (error) throw error;
    
    logger.info({ 
      component: "context", 
      userId,
      topic: updates.currentTopic,
      intent: updates.lastIntent ?? undefined
    }, "Contexto atualizado");
  } catch (error) {
    logger.error({ component: "context", userId }, "Erro ao atualizar contexto");
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
    
    logger.info({ component: "context", userId }, "Contexto limpo manualmente");
  } catch (error) {
    logger.error({ component: "context", userId }, "Erro ao limpar contexto");
  }
}

// ============================================================================
// 🧹 CLEANUP AUTOMÁTICO (rodar via cron job)
// ============================================================================

/**
 * Remove contextos expirados
 * Chamar periodicamente (ex: a cada 1 hora)
 */
export async function cleanupExpiredContexts(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("conversation_context")
      .delete()
      .lt("expires_at", new Date().toISOString())
      .select();
    
    if (error) throw error;
    
    const count = data?.length || 0;
    
    if (count > 0) {
      logger.info({ component: "context_cleanup", count }, `Removidos ${count} contextos expirados`);
    }
    
    return count;
  } catch (error) {
    logger.error({ component: "context_cleanup" }, "Erro ao limpar contextos expirados");
    return 0;
  }
}

// ============================================================================
// 📊 MÉTRICAS DE USO DO CONTEXTO
// ============================================================================

/**
 * Estatísticas de uso do contexto (últimas 24h)
 */
export async function getContextStats() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data } = await supabase
      .from("conversation_context")
      .select("current_topic, last_intent, interaction_count")
      .gte("last_interaction_at", since);
    
    if (!data) return null;
    
    const stats = {
      total: data.length,
      byTopic: {} as Record<string, number>,
      byIntent: {} as Record<string, number>,
      avgInteractions: 0,
      totalInteractions: 0
    };
    
    data.forEach(ctx => {
      // Contar por tópico
      const topic = ctx.current_topic || "unknown";
      stats.byTopic[topic] = (stats.byTopic[topic] || 0) + 1;
      
      // Contar por intent
      const intent = ctx.last_intent || "unknown";
      stats.byIntent[intent] = (stats.byIntent[intent] || 0) + 1;
      
      // Somar interações
      stats.totalInteractions += ctx.interaction_count || 0;
    });
    
    stats.avgInteractions = stats.total > 0 
      ? Math.round(stats.totalInteractions / stats.total) 
      : 0;
    
    return stats;
  } catch (error) {
    logger.error({ component: "context_stats" }, "Erro ao buscar estatísticas");
    return null;
  }
}

// ============================================================================
// 🔍 HELPERS - Resolver nomes para IDs
// ============================================================================

/**
 * Resolver nome de cartão para ID
 */
export async function resolveCardByName(userId: string, cardName: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("cartoes_credito")
      .select("id")
      .eq("usuario_id", userId)
      .ilike("nome", `%${cardName}%`)
      .maybeSingle();
    
    return data?.id || null;
  } catch (error) {
    logger.error({ component: "context", userId }, "Erro ao resolver cartão");
    return null;
  }
}

/**
 * Resolver nome de meta para ID
 */
export async function resolveGoalByName(userId: string, goalName: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("metas")
      .select("id")
      .eq("usuario_id", userId)
      .ilike("nome", `%${goalName}%`)
      .eq("status", "ativa")
      .maybeSingle();
    
    return data?.id || null;
  } catch (error) {
    logger.error({ component: "context", userId }, "Erro ao resolver meta");
    return null;
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

// ============================================================================
// 📋 HELPER: Verificar se contexto está "fresco" (< 5 min)
// ============================================================================

/**
 * Contexto é "fresco" se foi usado recentemente (< 5 min atrás)
 * Útil para decidir se deve confiar no contexto ou pedir confirmação
 */
export function isContextFresh(context: ConversationContext | null): boolean {
  if (!context) return false;
  
  const expiresAt = new Date(context.expiresAt).getTime();
  const now = Date.now();
  const timeLeft = expiresAt - now;
  
  // Considera "fresco" se ainda tem mais de 25 minutos (de 30 total)
  // Ou seja, foi usado há menos de 5 minutos
  return timeLeft > 25 * 60 * 1000;
}

// ============================================================================
// 📦 EXPORT DEFAULT
// ============================================================================

export default {
  getConversationContext,
  updateConversationContext,
  clearConversationContext,
  cleanupExpiredContexts,
  getContextStats,
  resolveCardByName,
  resolveGoalByName,
  scopeToTopic,
  isContextFresh
};
