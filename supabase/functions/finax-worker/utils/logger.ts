// ============================================================================
// 📊 LOGGER ESTRUTURADO V2 - Com Persistência e Métricas
// ============================================================================
// MELHORIAS:
// ✅ Salva logs no Supabase (análise posterior)
// ✅ Métricas de performance automáticas
// ✅ Rastreamento de erros com contexto completo
// ✅ Queries de análise prontas
// ✅ Fire-and-forget (não bloqueia execução)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ============================================================================
// 📦 TIPOS
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  component: string;
  userId?: string;
  messageId?: string;
  jobId?: string;
  intent?: string;
  actionType?: string;
  confidence?: number;
  slots?: Record<string, unknown>;
  error?: string;
  stack?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context: LogContext;
}

// ============================================================================
// 🎨 CONFIG
// ============================================================================

const LOG_LEVEL = Deno.env.get('LOG_LEVEL') || 'info';
const PERSIST_LOGS = Deno.env.get('PERSIST_LOGS') !== 'false'; // Default: true

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL as LogLevel];
}

// Emojis para console (facilita debug visual)
const EMOJI: Record<LogLevel, string> = {
  debug: '🔍',
  info: '📝',
  warn: '⚠️',
  error: '❌'
};

// ============================================================================
// 🎨 FORMATAÇÃO
// ============================================================================

function formatLog(level: LogLevel, context: LogContext, message: string): string {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    context,
  };
  return JSON.stringify(entry);
}

// ============================================================================
// 💾 PERSISTÊNCIA NO SUPABASE (Fire-and-forget)
// ============================================================================

function persistLog(
  level: LogLevel,
  context: LogContext,
  message: string
): void {
  if (!supabase || !PERSIST_LOGS) return;
  
  // Só persiste info, warn e error (debug é muito verboso)
  if (level === 'debug') return;
  
  // Fire-and-forget: não bloqueia execução
  supabase.from("logs_sistema").insert({
    level,
    component: context.component,
    message,
    user_id: context.userId || null,
    message_id: context.messageId || null,
    action_type: context.actionType || null,
    confidence: context.confidence || null,
    slots: context.slots || null,
    duration_ms: context.duration_ms || null,
    error_name: context.error || null,
    error_message: context.error || null,
    error_stack: context.stack || null,
    metadata: context
  }).then(({ error }) => {
    if (error) console.error("❌ [LOGGER] Falha ao salvar:", error);
  }).catch(() => {
    // Silencioso - não quebrar aplicação
  });
}

// ============================================================================
// 🚀 API PRINCIPAL
// ============================================================================

export const logger = {
  debug: (context: LogContext, message: string) => {
    if (shouldLog('debug')) {
      console.log(`${EMOJI.debug} ${formatLog('debug', context, message)}`);
    }
  },

  info: (context: LogContext, message: string) => {
    if (shouldLog('info')) {
      console.log(`${EMOJI.info} ${formatLog('info', context, message)}`);
      persistLog('info', context, message);
    }
  },

  warn: (context: LogContext, message: string) => {
    if (shouldLog('warn')) {
      console.warn(`${EMOJI.warn} ${formatLog('warn', context, message)}`);
      persistLog('warn', context, message);
    }
  },

  error: (context: LogContext, message: string) => {
    if (shouldLog('error')) {
      console.error(`${EMOJI.error} ${formatLog('error', context, message)}`);
      persistLog('error', context, message);
    }
  },

  // ========================================================================
  // 🧠 DECISION - Log de decisões da IA (com métricas)
  // ========================================================================
  decision: (
    userId: string,
    messageId: string,
    decision: {
      actionType: string;
      confidence: number;
      slots: Record<string, unknown>;
      source: "ai" | "deterministic" | "contextual";
      durationMs: number;
    }
  ) => {
    const context: LogContext = {
      component: "decision",
      userId,
      messageId,
      actionType: decision.actionType,
      confidence: decision.confidence,
      slots: decision.slots,
      duration_ms: decision.durationMs
    };
    
    const msg = `${decision.actionType} (${decision.source}, conf=${decision.confidence.toFixed(2)})`;
    
    console.log(`🧠 ${formatLog('info', context, msg)}`);
    persistLog('info', context, msg);
    
    // ⚠️ WARN se confiança baixa
    if (decision.confidence < 0.7) {
      logger.warn(context, `Baixa confiança: ${decision.confidence.toFixed(2)}`);
    }
  },

  // ========================================================================
  // ⚡ PERFORMANCE - Rastreamento de tempo
  // ========================================================================
  performance: (
    component: string,
    operation: string,
    durationMs: number,
    data?: {
      userId?: string;
      messageId?: string;
      metadata?: Record<string, unknown>;
    }
  ) => {
    const level: LogLevel = durationMs > 5000 ? 'warn' : 'info';
    const emoji = durationMs > 5000 ? '🐌' : '⚡';
    
    const context: LogContext = {
      component: `perf_${component}`,
      userId: data?.userId,
      messageId: data?.messageId,
      duration_ms: durationMs,
      ...data?.metadata
    };
    
    const msg = `${operation} (${durationMs}ms)`;
    
    console.log(`${emoji} ${formatLog(level, context, msg)}`);
    persistLog(level, context, msg);
  },

  // ========================================================================
  // 🎯 TRACK - Tracking de métricas customizadas
  // ========================================================================
  track: (component: string, userId: string, data: Record<string, unknown>) => {
    const context: LogContext = {
      component,
      userId,
      ...data
    };
    
    console.log(`📊 ${formatLog('info', context, 'metric')}`);
    persistLog('info', context, 'metric');
  },

  // ========================================================================
  // 🚨 FROM_ERROR - Log a partir de exceção
  // ========================================================================
  fromError: (
    component: string,
    error: Error,
    data?: {
      userId?: string;
      messageId?: string;
      metadata?: Record<string, unknown>;
    }
  ) => {
    const context: LogContext = {
      component,
      userId: data?.userId,
      messageId: data?.messageId,
      error: error.name,
      stack: error.stack,
      ...data?.metadata
    };
    
    console.error(`${EMOJI.error} ${formatLog('error', context, error.message)}`);
    persistLog('error', context, error.message);
  }
};

// ============================================================================
// 📈 ANALYTICS - Queries de análise
// ============================================================================

export class LogAnalytics {
  /**
   * Buscar erros recentes
   */
  static async getRecentErrors(limit: number = 50): Promise<any[]> {
    if (!supabase) return [];
    
    const { data } = await supabase
      .from("logs_sistema")
      .select("*")
      .eq("level", "error")
      .order("timestamp", { ascending: false })
      .limit(limit);
    
    return data || [];
  }

  /**
   * Erros por componente (últimas 24h)
   */
  static async getErrorsByComponent(): Promise<Record<string, number>> {
    if (!supabase) return {};
    
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data } = await supabase
      .from("logs_sistema")
      .select("component")
      .eq("level", "error")
      .gte("timestamp", since);
    
    const counts: Record<string, number> = {};
    (data || []).forEach(log => {
      counts[log.component] = (counts[log.component] || 0) + 1;
    });
    
    return counts;
  }

  /**
   * Performance média (última hora)
   */
  static async getAveragePerformance(): Promise<Record<string, { avg: number; max: number; count: number }>> {
    if (!supabase) return {};
    
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data } = await supabase
      .from("logs_sistema")
      .select("component, duration_ms")
      .not("duration_ms", "is", null)
      .gte("timestamp", since);
    
    const stats: Record<string, { total: number; max: number; count: number; avg: number }> = {};
    
    (data || []).forEach(log => {
      if (!stats[log.component]) {
        stats[log.component] = { total: 0, max: 0, count: 0, avg: 0 };
      }
      stats[log.component].total += log.duration_ms;
      stats[log.component].max = Math.max(stats[log.component].max, log.duration_ms);
      stats[log.component].count++;
    });
    
    Object.keys(stats).forEach(component => {
      stats[component].avg = Math.round(stats[component].total / stats[component].count);
    });
    
    return stats;
  }

  /**
   * Logs de usuário específico
   */
  static async getUserLogs(userId: string, limit: number = 100): Promise<any[]> {
    if (!supabase) return [];
    
    const { data } = await supabase
      .from("logs_sistema")
      .select("*")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false })
      .limit(limit);
    
    return data || [];
  }

  /**
   * Componentes mais lentos (top 10)
   */
  static async getSlowestComponents(): Promise<Array<{ component: string; avgMs: number }>> {
    const perfStats = await this.getAveragePerformance();
    
    return Object.entries(perfStats)
      .map(([component, stats]) => ({
        component,
        avgMs: stats.avg
      }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 10);
  }
}

export default logger;
