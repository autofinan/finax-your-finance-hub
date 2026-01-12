// ============================================================================
// 🏥 HEALTH CHECK - ENDPOINT DE MONITORAMENTO
// ============================================================================
// Retorna status de saúde do sistema Finax:
// - Quantidade de jobs pendentes
// - Jobs na dead letter queue
// - Status geral (healthy/degraded)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ========================================================================
    // 📊 COLETAR MÉTRICAS
    // ========================================================================
    
    // Jobs pendentes
    const { count: pendingJobs, error: pendingError } = await supabase
      .from("webhook_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    
    // Dead letters (jobs que falharam após todas retries)
    const { count: deadLetters, error: deadError } = await supabase
      .from("webhook_jobs")
      .select("*", { count: "exact", head: true })
      .eq("dead_letter", true);
    
    // Jobs em processamento
    const { count: processingJobs } = await supabase
      .from("webhook_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "processing");
    
    // Jobs com erro (para retry)
    const { count: retryingJobs } = await supabase
      .from("webhook_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .gt("retry_count", 0);
    
    // Alertas pendentes nas últimas 24h
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentAlerts } = await supabase
      .from("spending_alerts")
      .select("*", { count: "exact", head: true })
      .eq("status", "detected")
      .gte("created_at", yesterday);
    
    // ========================================================================
    // 🏥 CALCULAR STATUS
    // ========================================================================
    
    const checks = {
      pending_jobs: pendingJobs || 0,
      processing_jobs: processingJobs || 0,
      retrying_jobs: retryingJobs || 0,
      dead_letters: deadLetters || 0,
      recent_alerts: recentAlerts || 0
    };
    
    // Critérios de saúde:
    // - healthy: dead_letters < 10 E pending_jobs < 100
    // - degraded: dead_letters >= 10 OU pending_jobs >= 100
    // - critical: dead_letters >= 50 OU pending_jobs >= 500
    
    let status: "healthy" | "degraded" | "critical" = "healthy";
    const issues: string[] = [];
    
    if ((deadLetters || 0) >= 50) {
      status = "critical";
      issues.push("Muitos jobs na dead letter queue");
    } else if ((deadLetters || 0) >= 10) {
      status = "degraded";
      issues.push("Jobs na dead letter queue");
    }
    
    if ((pendingJobs || 0) >= 500) {
      status = "critical";
      issues.push("Fila de jobs muito grande");
    } else if ((pendingJobs || 0) >= 100) {
      if (status !== "critical") status = "degraded";
      issues.push("Fila de jobs crescendo");
    }
    
    const httpStatus = status === "healthy" ? 200 : status === "degraded" ? 200 : 503;
    
    return new Response(JSON.stringify({
      status,
      issues: issues.length > 0 ? issues : undefined,
      checks,
      version: "v5.1",
      timestamp: new Date().toISOString()
    }), {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("❌ [HEALTH] Erro:", error);
    
    return new Response(JSON.stringify({
      status: "critical",
      issues: ["Erro ao verificar saúde do sistema"],
      error: error instanceof Error ? error.message : "Erro desconhecido",
      timestamp: new Date().toISOString()
    }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
