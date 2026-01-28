// ============================================================================
// 🚨 FINAX ERROR - Tratamento de erros por código
// ============================================================================

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
  
  // Data errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  
  // Generic
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN = 'UNKNOWN',
}

// Mensagens amigáveis para o usuário (português BR)
const USER_MESSAGES: Record<FinaxErrorCode, string> = {
  [FinaxErrorCode.USER_NOT_FOUND]: 'Não encontrei seus dados ainda 🔍\n\nDigite *oi* para começar.',
  [FinaxErrorCode.USER_INACTIVE]: 'Sua conta está desativada. Entre em contato com o suporte.',
  [FinaxErrorCode.UNAUTHORIZED]: 'Sessão expirada. Faça login novamente.',
  [FinaxErrorCode.SESSION_EXPIRED]: 'Sua sessão expirou. Digite *oi* para reconectar.',
  [FinaxErrorCode.RATE_LIMITED]: 'Muitas mensagens de uma vez 🐢\n\nAguarda uns segundos e tenta de novo.',
  [FinaxErrorCode.TOO_MANY_REQUESTS]: 'Calma aí! 😅\n\nEstou processando suas mensagens. Aguarde um momento.',
  [FinaxErrorCode.AI_TIMEOUT]: 'Demorou demais para responder ⏱️\n\nTenta de novo em alguns segundos?',
  [FinaxErrorCode.AI_ERROR]: 'Tive um problema ao processar sua mensagem 🤔\n\nPode reformular?',
  [FinaxErrorCode.WHATSAPP_ERROR]: 'Problema ao enviar a resposta. Tenta de novo?',
  [FinaxErrorCode.INVALID_INPUT]: 'Não entendi essa informação 🤔\n\nPode reformular?',
  [FinaxErrorCode.MISSING_REQUIRED_FIELD]: 'Faltam informações. Pode completar?',
  [FinaxErrorCode.DUPLICATE_ENTRY]: 'Esse registro já existe!',
  [FinaxErrorCode.INTERNAL_ERROR]: 'Ops, algo deu errado 😕\n\nTenta de novo?',
  [FinaxErrorCode.UNKNOWN]: 'Ops, algo deu errado 😕\n\nTenta de novo?',
};

export class FinaxError extends Error {
  public readonly code: FinaxErrorCode;
  public readonly userMessage: string;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: FinaxErrorCode,
    developerMessage?: string,
    context?: Record<string, unknown>
  ) {
    super(developerMessage || code);
    this.name = 'FinaxError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code] || USER_MESSAGES[FinaxErrorCode.UNKNOWN];
    this.context = context;
  }

  // Cria a partir de um erro genérico
  static fromError(error: unknown, fallbackCode = FinaxErrorCode.UNKNOWN): FinaxError {
    if (error instanceof FinaxError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    
    // Detectar tipo de erro pelo conteúdo
    const detectedCode = FinaxError.detectErrorCode(message);
    
    return new FinaxError(
      detectedCode || fallbackCode,
      message,
      { originalError: message }
    );
  }

  // Detecta código de erro baseado na mensagem
  private static detectErrorCode(message: string): FinaxErrorCode | null {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('timeout') || lowerMessage.includes('deadline')) {
      return FinaxErrorCode.AI_TIMEOUT;
    }
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
      return FinaxErrorCode.RATE_LIMITED;
    }
    if (lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
      return FinaxErrorCode.UNAUTHORIZED;
    }
    if (lowerMessage.includes('user not found') || lowerMessage.includes('usuario nao encontrado')) {
      return FinaxErrorCode.USER_NOT_FOUND;
    }
    if (lowerMessage.includes('duplicate') || lowerMessage.includes('already exists')) {
      return FinaxErrorCode.DUPLICATE_ENTRY;
    }
    
    return null;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      context: this.context,
    };
  }
}

export default FinaxError;
