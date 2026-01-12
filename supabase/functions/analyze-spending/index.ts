// ============================================================================
// 📊 ANALYZE-SPENDING - CRON DIÁRIO (FASE 3 FINAX ELITE)
// ============================================================================
// Edge function executada via CRON às 18h para detectar alertas proativos.
// 
// REGRA DE OURO: Apenas DETECTA e SALVA alertas. NUNCA envia mensagens.
// Os alertas só são "enviados" quando o usuário pergunta explicitamente.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DECISION_VERSION = "v5.1";

// ============================================================================
// 📊 TIPOS
// ============================================================================

interface Alert {
  type: string;
  category?: string;
  data: Record<string, any>;
  message: string;
  severity: "info" | "warning" | "critical";
  utilityScore: number;
}

// ============================================================================
// 🔍 DETECTORES DE ALERTA
// ============================================================================

async function detectCategorySpike(userId: string): Promise<Alert | null> {
  try {
    // Gastos da semana atual
    const weekStart = getWeekStart();
    const { data: currentWeek } = await supabase
      .from("transacoes")
      .select("categoria, valor")
      .eq("usuario_id", userId)
      .eq("tipo", "saida")
      .eq("status", "confirmada")
      .gte("data", weekStart.toISOString());
    
    if (!currentWeek?.length) return null;
    
    // Agrupar por categoria
    const byCategory: Record<string, number> = {};
    for (const tx of currentWeek) {
      byCategory[tx.categoria] = (byCategory[tx.categoria] || 0) + tx.valor;
    }
    
    // Calcular média das últimas 4 semanas
    const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 24 * 60 * 60 * 1000);
    const { data: history } = await supabase
      .from("transacoes")
      .select("categoria, valor")
      .eq("usuario_id", userId)
      .eq("tipo", "saida")
      .eq("status", "confirmada")
      .gte("data", fourWeeksAgo.toISOString())
      .lt("data", weekStart.toISOString());
    
    const avgByCategory: Record<string, number> = {};
    for (const tx of history || []) {
      avgByCategory[tx.categoria] = (avgByCategory[tx.categoria] || 0) + tx.valor;
    }
    for (const cat of Object.keys(avgByCategory)) {
      avgByCategory[cat] = avgByCategory[cat] / 4;
    }
    
    // Verificar spikes (>20% acima da média)
    for (const [cat, total] of Object.entries(byCategory)) {
      const avg = avgByCategory[cat] || 0;
      if (avg > 0 && total > avg * 1.2) {
        const percentIncrease = ((total / avg - 1) * 100);
        return {
          type: "category_spike",
          category: cat,
          data: { current: total, average: avg, percentIncrease: percentIncrease.toFixed(1) },
          message: `Você gastou ${percentIncrease.toFixed(0)}% a mais em *${cat}* esta semana.`,
          severity: total > avg * 1.5 ? "warning" : "info",
          utilityScore: Math.min(0.9, 0.5 + percentIncrease / 200)
        };
      }
    }
    return null;
  } catch (error) {
    console.error("Erro detectCategorySpike:", error);
    return null;
  }
}

async function detectMissedRecurring(userId: string): Promise<Alert[]> {
  try {
    const today = new Date();
    const dayOfMonth = today.getDate();
    
    const { data: recorrentes } = await supabase
      .from("gastos_recorrentes")
      .select("*")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .lt("dia_mes", dayOfMonth);
    
    const alerts: Alert[] = [];
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    
    for (const r of recorrentes || []) {
      const { data: transactions } = await supabase
        .from("transacoes")
        .select("id")
        .eq("usuario_id", userId)
        .eq("id_recorrente", r.id)
        .gte("data", monthStart.toISOString())
        .limit(1);
      
      if (!transactions?.length) {
        alerts.push({
          type: "recurring_missed",
          category: r.categoria,
          data: { name: r.descricao, day: r.dia_mes, value: r.valor_parcela },
          message: `*${r.descricao}* (R$ ${r.valor_parcela?.toFixed(2)}) deveria ter sido pago dia ${r.dia_mes}.`,
          severity: "info",
          utilityScore: 0.7
        });
      }
    }
    return alerts;
  } catch (error) {
    console.error("Erro detectMissedRecurring:", error);
    return [];
  }
}

async function detectGoalRisk(userId: string): Promise<Alert | null> {
  try {
    const { data: perfil } = await supabase
      .from("perfil_cliente")
      .select("limites")
      .eq("usuario_id", userId)
      .single();
    
    const limiteMensal = perfil?.limites?.mensal || 0;
    if (limiteMensal === 0) return null;
    
    const { data: summary } = await supabase
      .from("vw_resumo_mes_atual")
      .select("total_saidas")
      .eq("usuario_id", userId)
      .single();
    
    const totalGasto = summary?.total_saidas || 0;
    const percentUsed = (totalGasto / limiteMensal) * 100;
    
    if (percentUsed >= 80) {
      return {
        type: "goal_risk",
        category: undefined,
        data: { spent: totalGasto, limit: limiteMensal, percentUsed: percentUsed.toFixed(1) },
        message: `Você já usou *${percentUsed.toFixed(0)}%* do seu limite mensal de R$ ${limiteMensal.toFixed(2)}.`,
        severity: percentUsed >= 95 ? "critical" : "warning",
        utilityScore: 0.9
      };
    }
    return null;
  } catch (error) {
    console.error("Erro detectGoalRisk:", error);
    return null;
  }
}

// ============================================================================
// 💾 SALVAR ALERTAS (COM COOLDOWN E FILTRO) - PRODUÇÃO
// ============================================================================

const ALERT_COOLDOWN_DAYS: Record<string, number> = {
  goal_risk: 7,
  category_spike: 5,
  recurring_missed: 3,
  unusual_spending: 2,
  budget_exceeded: 7,
};

const MIN_UTILITY_SCORE = 0.4;

async function saveAlert(userId: string, alert: Alert): Promise<boolean> {
  try {
    // REGRA 1: Verificar utilityScore mínimo
    if (alert.utilityScore < MIN_UTILITY_SCORE) {
      console.log(`⏭️ Descartado por utilityScore baixo: ${alert.type} (${alert.utilityScore})`);
      
      await supabase.from("finax_logs").insert({
        action_type: "alert_discarded",
        user_id: userId,
        entity_type: "spending_alert",
        new_data: {
          alert_type: alert.type,
          utility_score: alert.utilityScore,
          reason: "low_utility_score",
          discarded_at: new Date().toISOString()
        }
      });
      
      return false;
    }
    
    // REGRA 2: Verificar cooldown por tipo
    const cooldownDays = ALERT_COOLDOWN_DAYS[alert.type] || 3;
    const cooldownDate = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
    
    const { data: recentAlert } = await supabase
      .from("spending_alerts")
      .select("id")
      .eq("user_id", userId)
      .eq("alert_type", alert.type)
      .eq("category", alert.category || null)
      .gte("created_at", cooldownDate.toISOString())
      .limit(1);
    
    if (recentAlert?.length) {
      console.log(`⏭️ Descartado por cooldown: ${alert.type} (${cooldownDays} dias)`);
      
      await supabase.from("finax_logs").insert({
        action_type: "alert_discarded",
        user_id: userId,
        entity_type: "spending_alert",
        new_data: {
          alert_type: alert.type,
          utility_score: alert.utilityScore,
          reason: "cooldown_active",
          cooldown_days: cooldownDays,
          discarded_at: new Date().toISOString()
        }
      });
      
      return false;
    }
    
    // REGRA 3: Salvar alerta
    await supabase.from("spending_alerts").insert({
      user_id: userId,
      alert_type: alert.type,
      category: alert.category,
      trigger_data: alert.data,
      message: alert.message,
      severity: alert.severity,
      utility_score: alert.utilityScore,
      delivery_mode: "silent",
      status: "detected",
      decision_version: DECISION_VERSION
    });
    
    console.log(`✅ Alerta ${alert.type} salvo para ${userId} (score: ${alert.utilityScore})`);
    return true;
  } catch (error) {
    console.error("Erro ao salvar alerta:", error);
    return false;
  }
}

// ============================================================================
// 📊 ANALISAR USUÁRIO
// ============================================================================

async function analyzeUserSpending(userId: string): Promise<{ generated: number; discarded: number }> {
  console.log(`📊 Analisando usuário: ${userId}`);
  let generated = 0;
  let discarded = 0;
  
  // ========================================================================
  // 🔕 GUARD: VERIFICAR OPERATION_MODE (RESPEITAR MODO SILENCIOSO)
  // ========================================================================
  const { data: perfil } = await supabase
    .from("perfil_cliente")
    .select("operation_mode")
    .eq("usuario_id", userId)
    .single();
  
  const operationMode = perfil?.operation_mode || "normal";
  
  // Se usuário está em modo silencioso, NÃO gerar alertas proativos
  if (operationMode === "silent") {
    console.log(`🔕 [ANALYZE] Usuário ${userId.slice(0, 8)} em modo silencioso - pulando análise`);
    return { generated: 0, discarded: 0 };
  }
  
  // 1. Spike de categoria
  const categorySpike = await detectCategorySpike(userId);
  if (categorySpike) {
    if (await saveAlert(userId, categorySpike)) generated++;
    else discarded++;
  }
  
  // 2. Recorrentes não pagos
  const missedRecurring = await detectMissedRecurring(userId);
  for (const alert of missedRecurring) {
    if (await saveAlert(userId, alert)) generated++;
    else discarded++;
  }
  
  // 3. Risco de meta
  const goalRisk = await detectGoalRisk(userId);
  if (goalRisk) {
    if (await saveAlert(userId, goalRisk)) generated++;
    else discarded++;
  }
  
  return { generated, discarded };
}

// ============================================================================
// 📊 REGISTRAR MÉTRICAS
// ============================================================================

async function trackAlertMetrics(totalUsers: number, totalGenerated: number, totalDiscarded: number): Promise<void> {
  try {
    await supabase.from("finax_logs").insert({
      action_type: "alert_metrics",
      entity_type: "system",
      new_data: {
        total_users_analyzed: totalUsers,
        total_alerts_generated: totalGenerated,
        total_alerts_discarded: totalDiscarded,
        run_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Erro ao registrar métricas:", error);
  }
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

function getWeekStart(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

// ============================================================================
// 🚀 HANDLER PRINCIPAL
// ============================================================================

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("📊 ANALYZE-SPENDING - CRON DIÁRIO (PRODUÇÃO)");
  console.log("═══════════════════════════════════════════════════════════════");
  
  try {
    // Buscar todos usuários ativos
    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id")
      .eq("ativo", true);
    
    if (usersError) {
      throw new Error(`Erro ao buscar usuários: ${usersError.message}`);
    }
    
    console.log(`👥 ${users?.length || 0} usuários ativos encontrados`);
    
    let totalGenerated = 0;
    let totalDiscarded = 0;
    
    for (const user of users || []) {
      const result = await analyzeUserSpending(user.id);
      totalGenerated += result.generated;
      totalDiscarded += result.discarded;
    }
    
    // Registrar métricas
    await trackAlertMetrics(users?.length || 0, totalGenerated, totalDiscarded);
    
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`✅ CONCLUÍDO: ${users?.length || 0} usuários, ${totalGenerated} gerados, ${totalDiscarded} descartados`);
    console.log("═══════════════════════════════════════════════════════════════");
    
    return new Response(
      JSON.stringify({
        success: true,
        usersProcessed: users?.length || 0,
        alertsGenerated: totalGenerated,
        alertsDiscarded: totalDiscarded,
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    );
  } catch (error: unknown) {
    console.error("❌ Erro no analyze-spending:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500
      }
    );
  }
});