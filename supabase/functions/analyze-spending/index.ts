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
// 💾 SALVAR ALERTAS
// ============================================================================

async function saveAlert(userId: string, alert: Alert): Promise<void> {
  try {
    // Verificar se já existe alerta similar recente (24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { data: existing } = await supabase
      .from("spending_alerts")
      .select("id")
      .eq("user_id", userId)
      .eq("alert_type", alert.type)
      .eq("category", alert.category || null)
      .gte("created_at", oneDayAgo.toISOString())
      .limit(1);
    
    if (existing?.length) {
      console.log(`⏭️ Alerta ${alert.type} já existe para ${userId}`);
      return;
    }
    
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
    
    console.log(`✅ Alerta ${alert.type} salvo para ${userId}`);
  } catch (error) {
    console.error("Erro ao salvar alerta:", error);
  }
}

// ============================================================================
// 📊 ANALISAR USUÁRIO
// ============================================================================

async function analyzeUserSpending(userId: string): Promise<number> {
  console.log(`📊 Analisando usuário: ${userId}`);
  let alertCount = 0;
  
  // 1. Spike de categoria
  const categorySpike = await detectCategorySpike(userId);
  if (categorySpike) {
    await saveAlert(userId, categorySpike);
    alertCount++;
  }
  
  // 2. Recorrentes não pagos
  const missedRecurring = await detectMissedRecurring(userId);
  for (const alert of missedRecurring) {
    await saveAlert(userId, alert);
    alertCount++;
  }
  
  // 3. Risco de meta
  const goalRisk = await detectGoalRisk(userId);
  if (goalRisk) {
    await saveAlert(userId, goalRisk);
    alertCount++;
  }
  
  return alertCount;
}

// ============================================================================
// 📊 REGISTRAR MÉTRICAS
// ============================================================================

async function trackAlertMetrics(totalUsers: number, totalAlerts: number): Promise<void> {
  try {
    await supabase.from("finax_logs").insert({
      action_type: "alert_metrics",
      entity_type: "system",
      new_data: {
        total_users_analyzed: totalUsers,
        total_alerts_generated: totalAlerts,
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
  console.log("📊 ANALYZE-SPENDING - CRON DIÁRIO");
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
    
    let totalAlerts = 0;
    
    for (const user of users || []) {
      const alertCount = await analyzeUserSpending(user.id);
      totalAlerts += alertCount;
    }
    
    // Registrar métricas
    await trackAlertMetrics(users?.length || 0, totalAlerts);
    
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`✅ CONCLUÍDO: ${users?.length || 0} usuários, ${totalAlerts} alertas`);
    console.log("═══════════════════════════════════════════════════════════════");
    
    return new Response(
      JSON.stringify({
        success: true,
        usersProcessed: users?.length || 0,
        alertsGenerated: totalAlerts,
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