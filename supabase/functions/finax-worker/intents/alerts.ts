// ============================================================================
// 🚨 INTENT: ALERTS (IA Proativa - MODO SILENCIOSO)
// ============================================================================
// FASE 3 FINAX ELITE
// 
// REGRAS DE OURO:
// 1. Todos os alertas são DETECTADOS e SALVOS, mas NUNCA enviados automaticamente
// 2. Usuário PUXA a proatividade através do comando "meus alertas"
// 3. Alertas são marcados como "sent" somente quando consultados explicitamente
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DECISION_VERSION = "v5.1";

// ============================================================================
// 📊 TIPOS DE ALERTA
// ============================================================================

export type AlertType = 
  | "category_spike"      // Gasto acima da média em categoria
  | "recurring_missed"    // Recorrente não pago
  | "goal_risk"           // Meta em risco (>80% do limite)
  | "unusual_spending"    // Gasto fora do padrão
  | "budget_exceeded";    // Orçamento excedido

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "detected" | "eligible" | "sent" | "dismissed";

export interface Alert {
  type: AlertType;
  category?: string;
  data: Record<string, any>;
  message: string;
  severity: AlertSeverity;
  utilityScore: number;
}

// ============================================================================
// 💾 SALVAR ALERTA (MODO SILENCIOSO)
// ============================================================================

export async function saveAlert(userId: string, alert: Alert): Promise<string | null> {
  console.log(`🚨 [ALERT] Salvando alerta ${alert.type} (SILENCIOSO)`);
  
  try {
    const { data, error } = await supabase
      .from("spending_alerts")
      .insert({
        user_id: userId,
        alert_type: alert.type,
        category: alert.category,
        trigger_data: alert.data,
        message: alert.message,
        severity: alert.severity,
        utility_score: alert.utilityScore,
        delivery_mode: "silent",  // SEMPRE silencioso
        status: "detected",       // Detectado, não enviado
        decision_version: DECISION_VERSION
        // sent_at: NULL - NUNCA preenchido automaticamente
      })
      .select("id")
      .single();
    
    if (error) {
      console.error("❌ [ALERT] Erro ao salvar:", error);
      return null;
    }
    
    console.log(`✅ [ALERT] Salvo: ${data.id}`);
    return data.id;
  } catch (error) {
    console.error("❌ [ALERT] Erro:", error);
    return null;
  }
}

// ============================================================================
// 🔍 DETECTAR SPIKE DE CATEGORIA
// ============================================================================

export async function detectCategorySpike(userId: string): Promise<Alert | null> {
  console.log(`📊 [ALERT] Detectando spikes de categoria...`);
  
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
    
    // Calcular média das últimas 4 semanas por categoria
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
    const countByCategory: Record<string, number> = {};
    
    for (const tx of history || []) {
      avgByCategory[tx.categoria] = (avgByCategory[tx.categoria] || 0) + tx.valor;
      countByCategory[tx.categoria] = (countByCategory[tx.categoria] || 0) + 1;
    }
    
    // Dividir por 4 semanas para obter média semanal
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
          data: { 
            current: total, 
            average: avg, 
            percentIncrease: percentIncrease.toFixed(1) 
          },
          message: `Você gastou ${percentIncrease.toFixed(0)}% a mais em *${cat}* esta semana (R$ ${total.toFixed(2)} vs média de R$ ${avg.toFixed(2)}).`,
          severity: total > avg * 1.5 ? "warning" : "info",
          utilityScore: Math.min(0.9, 0.5 + percentIncrease / 200)
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error("❌ [ALERT] Erro ao detectar spike:", error);
    return null;
  }
}

// ============================================================================
// 🔍 DETECTAR RECORRENTES NÃO PAGOS
// ============================================================================

export async function detectMissedRecurring(userId: string): Promise<Alert[]> {
  console.log(`📊 [ALERT] Detectando recorrentes não pagos...`);
  
  try {
    const today = new Date();
    const dayOfMonth = today.getDate();
    
    // Buscar recorrentes que deveriam ter sido pagas
    const { data: recorrentes } = await supabase
      .from("gastos_recorrentes")
      .select("*")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .lt("dia_mes", dayOfMonth);
    
    const alerts: Alert[] = [];
    
    for (const r of recorrentes || []) {
      // Verificar se já foi paga este mês
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      
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
          data: { 
            name: r.descricao, 
            day: r.dia_mes, 
            value: r.valor_parcela,
            recurringId: r.id
          },
          message: `*${r.descricao}* (R$ ${r.valor_parcela?.toFixed(2)}) deveria ter sido pago dia ${r.dia_mes}. Esqueceu ou já pagou?`,
          severity: "info",
          utilityScore: 0.7
        });
      }
    }
    
    return alerts;
  } catch (error) {
    console.error("❌ [ALERT] Erro ao detectar recorrentes:", error);
    return [];
  }
}

// ============================================================================
// 🔍 DETECTAR RISCO DE META
// ============================================================================

export async function detectGoalRisk(userId: string): Promise<Alert | null> {
  console.log(`📊 [ALERT] Detectando risco de meta...`);
  
  try {
    // Buscar limite mensal do perfil
    const { data: perfil } = await supabase
      .from("perfil_cliente")
      .select("limites")
      .eq("usuario_id", userId)
      .single();
    
    const limiteMensal = perfil?.limites?.mensal || 0;
    
    if (limiteMensal === 0) return null;
    
    // Buscar total gasto no mês
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
        data: { 
          spent: totalGasto, 
          limit: limiteMensal, 
          percentUsed: percentUsed.toFixed(1) 
        },
        message: `⚠️ Você já usou *${percentUsed.toFixed(0)}%* do seu limite mensal de R$ ${limiteMensal.toFixed(2)}.`,
        severity: percentUsed >= 95 ? "critical" : "warning",
        utilityScore: 0.9
      };
    }
    
    return null;
  } catch (error) {
    console.error("❌ [ALERT] Erro ao detectar risco:", error);
    return null;
  }
}

// ============================================================================
// 🔍 DETECTAR GASTO INCOMUM
// ============================================================================

export async function detectUnusualSpending(
  userId: string, 
  transaction: { valor: number; categoria: string; descricao: string }
): Promise<Alert | null> {
  console.log(`📊 [ALERT] Verificando gasto incomum...`);
  
  try {
    // Buscar gastos anteriores na mesma categoria
    const { data: history } = await supabase
      .from("transacoes")
      .select("valor")
      .eq("usuario_id", userId)
      .eq("tipo", "saida")
      .eq("categoria", transaction.categoria)
      .order("data", { ascending: false })
      .limit(20);
    
    if (!history?.length || history.length < 5) return null;
    
    const values = history.map(t => t.valor);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length);
    
    // Se o gasto atual está mais de 2 desvios padrão acima da média
    if (transaction.valor > avg + 2 * stdDev) {
      const percentAbove = ((transaction.valor / avg - 1) * 100);
      
      return {
        type: "unusual_spending",
        category: transaction.categoria,
        data: { 
          value: transaction.valor,
          average: avg.toFixed(2),
          description: transaction.descricao,
          percentAbove: percentAbove.toFixed(1)
        },
        message: `Esse gasto de R$ ${transaction.valor.toFixed(2)} em *${transaction.categoria}* está ${percentAbove.toFixed(0)}% acima da sua média (R$ ${avg.toFixed(2)}).`,
        severity: "info",
        utilityScore: Math.min(0.8, 0.4 + percentAbove / 200)
      };
    }
    
    return null;
  } catch (error) {
    console.error("❌ [ALERT] Erro ao detectar gasto incomum:", error);
    return null;
  }
}

// ============================================================================
// 📋 BUSCAR ALERTAS PENDENTES (COMANDO "meus alertas")
// ============================================================================

export async function getAlerts(userId: string): Promise<string> {
  console.log(`📋 [ALERT] Buscando alertas para usuário: ${userId}`);
  
  try {
    const { data: alerts } = await supabase
      .from("spending_alerts")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["detected", "eligible"])
      .is("sent_at", null)
      .order("utility_score", { ascending: false })
      .limit(5);
    
    if (!alerts?.length) {
      return "✨ *Tudo tranquilo!*\n\nNão há nada fora do normal nos seus gastos. Continue assim! 💪";
    }
    
    // Marcar como enviados
    await supabase
      .from("spending_alerts")
      .update({ 
        sent_at: new Date().toISOString(), 
        status: "sent" 
      })
      .in("id", alerts.map(a => a.id));
    
    // Formatar resposta
    const severityEmoji: Record<string, string> = {
      critical: "🚨",
      warning: "⚠️",
      info: "💡"
    };
    
    let response = `📊 *Seus Alertas* (${alerts.length})\n\n`;
    
    for (const alert of alerts) {
      const emoji = severityEmoji[alert.severity] || "💡";
      response += `${emoji} ${alert.message}\n\n`;
    }
    
    response += `_Responda "descartar" para limpar os alertas._`;
    
    return response;
  } catch (error) {
    console.error("❌ [ALERT] Erro ao buscar alertas:", error);
    return "Ops, algo deu errado ao buscar seus alertas. Tente novamente!";
  }
}

// ============================================================================
// 🧹 DESCARTAR ALERTAS
// ============================================================================

export async function dismissAlerts(userId: string): Promise<void> {
  console.log(`🧹 [ALERT] Descartando alertas do usuário: ${userId}`);
  
  try {
    await supabase
      .from("spending_alerts")
      .update({ 
        status: "dismissed",
        dismissed_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .in("status", ["detected", "eligible", "sent"]);
  } catch (error) {
    console.error("❌ [ALERT] Erro ao descartar:", error);
  }
}

// ============================================================================
// 📊 VERIFICAR E SALVAR ALERTAS IMEDIATOS (PÓS-GASTO)
// ============================================================================

export async function checkImmediateAlerts(
  userId: string, 
  transaction: { valor: number; categoria: string; descricao: string }
): Promise<void> {
  console.log(`📊 [ALERT] Verificando alertas imediatos...`);
  
  try {
    // 1. Verificar risco de meta
    const goalRisk = await detectGoalRisk(userId);
    if (goalRisk) {
      await saveAlert(userId, goalRisk);
    }
    
    // 2. Verificar gasto incomum
    const unusual = await detectUnusualSpending(userId, transaction);
    if (unusual) {
      await saveAlert(userId, unusual);
    }
  } catch (error) {
    console.error("❌ [ALERT] Erro nos alertas imediatos:", error);
  }
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

function getWeekStart(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust for Sunday
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}
