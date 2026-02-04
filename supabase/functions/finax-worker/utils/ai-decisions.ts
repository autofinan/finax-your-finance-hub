// ============================================================================
// 🧠 AI DECISIONS TRACKER - Sistema Silencioso de Aprendizado
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "./logger.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export interface AIDecisionInput {
  userId: string;
  messageId: string;
  message: string;
  messageType: "text" | "audio" | "image";
  aiClassification: string;
  aiConfidence: number;
  aiSlots: Record;
  aiReasoning?: string;
  aiSource?: "ai" | "deterministic" | "contextual";
}

/**
 * Salva decisão da IA (silenciosamente, em background)
 * Retorna ID para atualizar depois
 */
export async function saveAIDecision(data: AIDecisionInput): Promise {
  try {
    const { data: record, error } = await supabase
      .from("ai_decisions")
      .insert({
        user_id: data.userId,
        message_id: data.messageId,
        message: data.message.slice(0, 500),
        message_type: data.messageType,
        ai_classification: data.aiClassification,
        ai_confidence: data.aiConfidence,
        ai_slots: data.aiSlots,
        ai_reasoning: data.aiReasoning?.slice(0, 500),
        ai_source: data.aiSource || "ai",
        model_version: "gemini-2.5-flash",
        execution_result: "pending"
      })
      .select("id")
      .single();
    
    if (error) return null;
    
    logger.debug({ 
      component: "ai_tracker", 
      userId: data.userId,
      decisionId: record.id
    }, "Decisão salva");
    
    return record.id;
  } catch {
    return null;
  }
}

/**
 * Marca decisão como executada (após sucesso)
 */
export async function markAsExecuted(
  decisionId: string | null,
  success: boolean
): Promise {
  if (!decisionId) return;
  
  try {
    await supabase
      .from("ai_decisions")
      .update({
        was_executed: true,
        execution_result: success ? "success" : "failed",
        executed_at: new Date().toISOString()
      })
      .eq("id", decisionId);
  } catch {}
}

/**
 * Marca como incorreto (quando usuário cancela ou corrige)
 */
export async function markAsIncorrect(
  decisionId: string | null,
  correctType: string,
  feedback: string
): Promise {
  if (!decisionId) return;
  
  try {
    await supabase
      .from("ai_decisions")
      .update({
        user_confirmed: false,
        correct_classification: correctType,
        user_feedback: feedback.slice(0, 500),
        confirmed_at: new Date().toISOString()
      })
      .eq("id", decisionId);
  } catch {}
}

/**
 * Dashboard de qualidade (métricas em tempo real)
 */
export async function getQualityMetrics(days: number = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  
  const { data } = await supabase
    .from("ai_decisions")
    .select("ai_classification, ai_confidence, was_executed, execution_result, user_confirmed")
    .gte("created_at", since);
  
  if (!data) return null;
  
  const stats = {
    total: data.length,
    executed: data.filter(d => d.was_executed).length,
    success_rate: 0,
    by_type: {} as Record
  };
  
  const successful = data.filter(d => d.execution_result === "success").length;
  stats.success_rate = stats.executed > 0 
    ? Math.round((successful / stats.executed) * 100) 
    : 0;
  
  data.forEach(d => {
    stats.by_type[d.ai_classification] = (stats.by_type[d.ai_classification] || 0) + 1;
  });
  
  return stats;
}
