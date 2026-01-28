// ============================================================================
// 📊 LOGGER ESTRUTURADO - Compatível com Deno, sem libs externas
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

function formatLog(level: LogLevel, context: LogContext, message: string): string {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    context,
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug: (context: LogContext, message: string) => {
    if (Deno.env.get('LOG_LEVEL') === 'debug') {
      console.log(formatLog('debug', context, message));
    }
  },

  info: (context: LogContext, message: string) => {
    console.log(formatLog('info', context, message));
  },

  warn: (context: LogContext, message: string) => {
    console.warn(formatLog('warn', context, message));
  },

  error: (context: LogContext, message: string) => {
    console.error(formatLog('error', context, message));
  },

  // Shorthand para tracking de performance
  track: (component: string, userId: string, data: Record<string, unknown>) => {
    console.log(formatLog('info', { component, userId, ...data }, 'metric'));
  },
};

export default logger;
