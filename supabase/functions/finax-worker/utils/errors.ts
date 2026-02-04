// ============================================================================
// 🚨 FINAX ERROR V2 - Tratamento Profissional de Erros
// ============================================================================
// MELHORIAS:
// ✅ Log automático ao criar erro
// ✅ Severidade (low, medium, high, critical)
// ✅ isRetryable (para retry logic)
// ✅ Detecção automática de tipo de erro
// ✅ Mensagens específicas para imagem/áudio
// ✅ Estatísticas de erros
// ============================================================================

import { logger, LogAnalytics } from "./logger.ts";

export enum FinaxErrorCode {
  // User errors
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_INACTIVE = 'USER_INACTIVE',
  
  // Auth errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  
  // Rate limiting
  RATE_LIMITED = 'RATE_LIMITED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  
  // External services
  AI_TIMEOUT = 'AI_TIMEOUT',
  AI_ERROR = 'AI_ERROR',
  WHATSAPP_ERROR = 'WHATSAPP_ERROR',
  TRANSCRIPTION_ERROR = 'TRANSCRIPTION_ERROR', // ✅ NOVO
  IMAGE_PROCESSING_ERROR = 'IMAGE_PROCESSING_ERROR', // ✅ NOVO
  
  // Data errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  RECORD_NOT_FOUND = 'RECORD_NOT_FOUND', // ✅ NOVO
  
  // Business logic
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE', // ✅ NOVO
  INVALID_AMOUNT = 'INVALID_AMOUNT', // ✅ NOVO
  INVALID_DATE = 'INVALID_DATE', // ✅ NOVO
  
  // Generic
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN = 'UNKNOWN',
}

// ============================================================================
// 💬 MENSAGENS PARA O USUÁRIO
// ============================================================================

const USER_MESSAGES: Record<FinaxErrorCode, string> = {
  // User
  [FinaxErrorCode.USER_NOT_FOUND]: 'Não encontrei seus dados ainda 🔍\n\nDigite *oi* para começar.',
  [FinaxErrorCode.USER_INACTIVE]: 'Sua conta está desativada. Entre em contato com o suporte.',
  
  // Auth
  [FinaxErrorCode.UNAUTHORIZED]: 'Sessão expirada. Faça login novamente.',
  [FinaxErrorCode.SESSION_EXPIRED]: 'Sua sessão expirou. Digite *oi* para reconectar.',
  
  // Rate limiting
  [FinaxErrorCode.RATE_LIMITED]: 'Muitas mensagens de uma vez 🐢\n\nAguarda uns segundos e tenta de novo.',
  [FinaxErrorCode.TOO_MANY_REQUESTS]: 'Calma aí! 😅\n\nEstou processando suas mensagens. Aguarde um momento.',
  
  // External services
  [FinaxErrorCode.AI_TIMEOUT]: 'Demorou demais para responder ⏱️\n\nTenta de novo em alguns segundos?',
  [FinaxErrorCode.AI_ERROR]: 'Tive um problema ao processar sua mensagem 🤔\n\nPode reformular?',
  [FinaxErrorCode.WHATSAPP_ERROR]: 'Problema ao enviar a resposta. Tenta de novo?',
  [FinaxErrorCode.TRANSCRIPTION_ERROR]: 'Não consegui entender o áudio 🎤\n\nPode falar de novo mais devagar?',
  [FinaxErrorCode.IMAGE_PROCESSING_ERROR]: 'Não consegui ler a imagem 📷\n\nPode enviar uma foto mais nítida?',
  
  // Data errors
  [FinaxErrorCode.INVALID_INPUT]: 'Não entendi essa informação 🤔\n\nPode reformular?',
  [FinaxErrorCode.MISSING_REQUIRED_FIELD]: 'Faltam informações. Pode completar?',
  [FinaxErrorCode.DUPLICATE_ENTRY]: 'Esse registro já existe!',
  [FinaxErrorCode.RECORD_NOT_FOUND]: 'Não encontrei esse registro 🔍',
  
  // Business logic
  [FinaxErrorCode.INSUFFICIENT_BALANCE]: 'Saldo insuficiente 💸',
  [FinaxErrorCode.INVALID_AMOUNT]: 'Valor inválido. Use números positivos.',
  [FinaxErrorCode.INVALID_DATE]: 'Data inválida. Use formato DD/MM/AAAA.',
  
  // Generic
  [FinaxErrorCode.INTERNAL_ERROR]: 'Ops, algo deu errado 😕\n\nTenta de novo?',
  [FinaxErrorCode.UNKNOWN]: 'Ops, algo deu errado 😕\n\nTenta de novo?',
};

// ============================================================================
// 🎯 SEVERIDADE (para alertas e métricas)
// ============================================================================

type Severity = 'low' | 'medium' | 'high' | 'critical';

const ERROR_SEVERITY: Record<FinaxErrorCode, Severity> = {
  // User errors (baixa - normal acontecer)
  [FinaxErrorCode.USER_NOT_FOUND]: 'low',
  [FinaxErrorCode.USER_INACTIVE]: 'medium',
  
  // Auth (média - pode ser sessão expirada)
  [FinaxErrorCode.UNAUTHORIZED]: 'medium',
  [FinaxErrorCode.SESSION_EXPIRED]: 'medium',
  
  // Rate limiting (média - proteção funcionando)
  [FinaxErrorCode.RATE_LIMITED]: 'medium',
  [FinaxErrorCode.TOO_MANY_REQUESTS]: 'medium',
  
  // External services (alta - serviço externo falhando)
  [FinaxErrorCode.AI_TIMEOUT]: 'high',
  [FinaxErrorCode.AI_ERROR]: 'high',
  [FinaxErrorCode.WHATSAPP_ERROR]: 'critical',
  [FinaxErrorCode.TRANSCRIPTION_ERROR]: 'medium',
  [FinaxErrorCode.IMAGE_PROCESSING_ERROR]: 'medium',
  
  // Data errors (baixa - input inválido é esperado)
  [FinaxErrorCode.INVALID_INPUT]: 'low',
  [FinaxErrorCode.MISSING_REQUIRED_FIELD]: 'low',
  [FinaxErrorCode.DUPLICATE_ENTRY]: 'low',
  [FinaxErrorCode.RECORD_NOT_FOUND]: 'low',
  
  // Business logic (baixa - lógica de negócio)
  [FinaxErrorCode.INSUFFICIENT_BALANCE]: 'low',
  [FinaxErrorCode.INVALID_AMOUNT]: 'low',
  [FinaxErrorCode.INVALID_DATE]: 'low',
  
  // Generic (alta - não deveria acontecer)
  [FinaxErrorCode.INTERNAL_ERROR]: 'high',
  [FinaxErrorCode.UNKNOWN]: 'high',
};

// ============================================================================
// 🚨 FINAX ERROR CLASS
// ============================================================================

export class FinaxError extends Error {
  public readonly code: FinaxErrorCode;
  public readonly userMessage: string;
  public readonly severity: Severity;
  public readonly context?: Record<string, unknown>;
  public readonly isRetryable: boolean;

  constructor(
    code: FinaxErrorCode,
    developerMessage?: string,
    context?: Record<string, unknown>
  ) {
    super(developerMessage || code);
    this.name = 'FinaxError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code] || USER_MESSAGES[FinaxErrorCode.UNKNOWN];
    this.severity = ERROR_SEVERITY[code] || 'high';
    this.context = context;
    this.isRetryable = this.determineRetryable(code);
    
    // ✅ LOG AUTOMÁTICO
    this.logError();
  }

  // ========================================================================
  // 📝 LOG AUTOMÁTICO
  // ========================================================================
  private logError() {
    const component = (this.context?.component as string) || "unknown";
    
    logger.error({
      component,
      userId: this.context?.userId as string,
      messageId: this.context?.messageId as string,
      error: this.code,
      stack: this.stack,
      severity: this.severity
    }, this.message);
  }

  // ========================================================================
  // 🔄 DETERMINAR SE É RETRYABLE
  // ========================================================================
  private determineRetryable(code: FinaxErrorCode): boolean {
    const retryableCodes = [
      FinaxErrorCode.AI_TIMEOUT,
      FinaxErrorCode.WHATSAPP_ERROR,
      FinaxErrorCode.RATE_LIMITED,
      FinaxErrorCode.TOO_MANY_REQUESTS,
      FinaxErrorCode.INTERNAL_ERROR,
      FinaxErrorCode.TRANSCRIPTION_ERROR,
      FinaxErrorCode.IMAGE_PROCESSING_ERROR
    ];
    return retryableCodes.includes(code);
  }

  // ========================================================================
  // 🏭 FACTORY: Criar a partir de erro genérico
  // ========================================================================
  static fromError(
    error: unknown,
    fallbackCode = FinaxErrorCode.UNKNOWN,
    context?: Record<string, unknown>
  ): FinaxError {
    if (error instanceof FinaxError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    
    // Detectar tipo de erro pelo conteúdo
    const detectedCode = FinaxError.detectErrorCode(message);
    
    return new FinaxError(
      detectedCode || fallbackCode,
      message,
      { ...context, originalError: message, stack }
    );
  }

  // ========================================================================
  // 🔍 DETECTAR CÓDIGO DE ERRO (padrões na mensagem)
  // ========================================================================
  private static detectErrorCode(message: string): FinaxErrorCode | null {
    const lowerMessage = message.toLowerCase();
    
    // Timeouts
    if (lowerMessage.includes('timeout') || lowerMessage.includes('deadline')) {
      return FinaxErrorCode.AI_TIMEOUT;
    }
    
    // Rate limiting
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
      return FinaxErrorCode.RATE_LIMITED;
    }
    
    // Auth
    if (lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
      return FinaxErrorCode.UNAUTHORIZED;
    }
    
    // User not found
    if (lowerMessage.includes('user not found') || lowerMessage.includes('usuario nao encontrado')) {
      return FinaxErrorCode.USER_NOT_FOUND;
    }
    
    // Duplicate
    if (lowerMessage.includes('duplicate') || lowerMessage.includes('already exists') || lowerMessage.includes('unique constraint')) {
      return FinaxErrorCode.DUPLICATE_ENTRY;
    }
    
    // Not found
    if (lowerMessage.includes('not found') || lowerMessage.includes('no rows')) {
      return FinaxErrorCode.RECORD_NOT_FOUND;
    }
    
    // WhatsApp
    if (lowerMessage.includes('whatsapp') || lowerMessage.includes('waba')) {
      return FinaxErrorCode.WHATSAPP_ERROR;
    }
    
    // AI
    if (lowerMessage.includes('openai') || lowerMessage.includes('anthropic') || lowerMessage.includes('ai') && lowerMessage.includes('error')) {
      return FinaxErrorCode.AI_ERROR;
    }
    
    // Transcrição
    if (lowerMessage.includes('transcription') || lowerMessage.includes('whisper')) {
      return FinaxErrorCode.TRANSCRIPTION_ERROR;
    }
    
    // Image processing
    if (lowerMessage.includes('image') || lowerMessage.includes('gemini') || lowerMessage.includes('vision')) {
      return FinaxErrorCode.IMAGE_PROCESSING_ERROR;
    }
    
    return null;
  }

  // ========================================================================
  // 📊 SERIALIZAÇÃO
  // ========================================================================
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      severity: this.severity,
      isRetryable: this.isRetryable,
      context: this.context,
    };
  }

  // ========================================================================
  // 🚨 DEVE ACIONAR ALERTA? (severity high ou critical)
  // ========================================================================
  static shouldAlert(error: FinaxError): boolean {
    return error.severity === 'high' || error.severity === 'critical';
  }

  // ========================================================================
  // 📈 ESTATÍSTICAS DE ERROS (últimas 24h)
  // ========================================================================
  static async getErrorStats(hours: number = 24): Promise<Record<string, number>> {
    const errors = await LogAnalytics.getRecentErrors(1000);
    
    const since = Date.now() - hours * 60 * 60 * 1000;
    const recentErrors = errors.filter((log: any) => 
      new Date(log.timestamp).getTime() > since
    );
    
    const stats: Record<string, number> = {};
    recentErrors.forEach((log: any) => {
      const code = log.error_name || 'UNKNOWN';
      stats[code] = (stats[code] || 0) + 1;
    });
    
    return stats;
  }
}

export default FinaxError;
