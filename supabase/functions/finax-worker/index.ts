import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// 🏭 FINAX WORKER v5.0 - ARQUITETURA MODULAR COM DECISION ENGINE
// ============================================================================
//
// ARQUITETURA:
// 1. DECISION ENGINE: Classifica intenção ANTES de qualquer ação
// 2. CONTEXT MANAGER: Gerencia memória de curto prazo (actions)
// 3. INTENT HANDLERS: Módulos isolados por domínio (expense, income, card, cancel)
// 4. UI MESSAGES: Envio padronizado de mensagens
//
// REGRAS DE OURO:
// - IA decide intenção, regras validam, fluxos executam
// - Slot filling NUNCA decide intenção
// - Contexto ativo é descartado automaticamente ao mudar domínio
// - Nunca perguntar algo que foi dito explicitamente
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Credentials
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 TIPOS (inline para edge function)
// ============================================================================

type MessageSource = "meta" | "vonage";
type TipoMidia = "text" | "audio" | "image";
type ActionType = "expense" | "income" | "card_event" | "cancel" | "query" | "control" | "recurring" | "set_context" | "unknown";

interface JobPayload {
  phoneNumber: string;
  messageText: string;
  messageType: TipoMidia;
  messageId: string;
  mediaId: string | null;
  mediaMimeType: string;
  messageSource: MessageSource;
  nomeContato: string | null;
  evento_id: string | null;
  buttonReplyId: string | null;
  replyToMessageId?: string | null;
}

interface ExtractedSlots {
  amount?: number;
  description?: string;
  category?: string;
  payment_method?: string;
  source?: string;
  card?: string;
  value?: number;
  installments?: number;
  recurrence_type?: string;
  transaction_id?: string;
  [key: string]: any;
}

interface DecisionOutput {
  actionType: ActionType;
  confidence: number;
  reasoning: string;
  slots: ExtractedSlots;
  missingSlots: string[];
  shouldExecute: boolean;
  shouldAsk: boolean;
  question: string | null;
  buttons: Array<{ id: string; title: string }> | null;
}

interface ActiveAction {
  id: string;
  user_id: string;
  type: string;
  intent: string;
  slots: Record<string, any>;
  status: string;
  pending_slot?: string | null;
  pending_selection_id?: string | null;
  origin_message_id?: string | null;
  last_message_id?: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ============================================================================
// 🎰 CONSTANTS
// ============================================================================

// ============================================================================
// 📜 CONTRATOS DE SLOT (FONTE ÚNICA DE VERDADE)
// ============================================================================
// Cada intenção tem slots OBRIGATÓRIOS e opcionais.
// Execução direta SÓ acontece quando TODOS os obrigatórios estão preenchidos.
// Perguntas SÓ são feitas para slots obrigatórios faltantes.
// ============================================================================

const SLOT_REQUIREMENTS: Record<string, { required: string[]; optional: string[] }> = {
  expense: { required: ["amount", "payment_method"], optional: ["description", "category", "card"] },
  income: { required: ["amount"], optional: ["description", "source"] },
  card_event: { required: ["card", "value"], optional: ["field"] },
  cancel: { required: [], optional: ["transaction_id"] },
  query: { required: [], optional: [] },
  control: { required: [], optional: [] },
  recurring: { required: ["amount", "description"], optional: ["day_of_month", "category", "periodicity"] },
  set_context: { required: ["label", "start_date", "end_date"], optional: ["description"] },
  unknown: { required: [], optional: [] },
};

// ============================================================================
// ✅ hasAllRequiredSlots - FUNÇÃO CANÔNICA
// ============================================================================
// Retorna true SOMENTE se TODOS os slots obrigatórios estão preenchidos.
// Não usa heurística. Não infere dados ausentes.
// ============================================================================

function hasAllRequiredSlots(actionType: ActionType, slots: Record<string, any>): boolean {
  const requirements = SLOT_REQUIREMENTS[actionType];
  if (!requirements) return true; // Tipo desconhecido = sem requisitos
  
  for (const required of requirements.required) {
    const value = slots[required];
    if (value === null || value === undefined || value === "") {
      return false;
    }
  }
  return true;
}

const SLOT_PROMPTS: Record<string, { text: string; useButtons?: boolean; buttons?: Array<{ id: string; title: string }> }> = {
  amount: { text: "Qual foi o valor? 💸" },
  amount_income: { text: "Qual foi o valor que entrou? 💰" },
  description: { text: "O que foi essa compra?" },
  description_income: { text: "De onde veio esse dinheiro?" },
  source: { 
    text: "Como você recebeu?", 
    useButtons: true, 
    buttons: [
      { id: "src_pix", title: "📱 Pix" },
      { id: "src_dinheiro", title: "💵 Dinheiro" },
      { id: "src_transf", title: "🏦 Transferência" }
    ]
  },
  payment_method: { 
    text: "Como você pagou?", 
    useButtons: true,
    buttons: [
      { id: "pay_pix", title: "📱 Pix" },
      { id: "pay_debito", title: "💳 Débito" },
      { id: "pay_credito", title: "💳 Crédito" }
    ]
  },
  card: { text: "Qual cartão?" },
};

const PAYMENT_ALIASES: Record<string, string> = {
  "pix": "pix", "débito": "debito", "debito": "debito", 
  "crédito": "credito", "credito": "credito", "cartão": "credito",
  "dinheiro": "dinheiro", "cash": "dinheiro",
  "pay_pix": "pix", "pay_debito": "debito", "pay_credito": "credito", "pay_dinheiro": "dinheiro"
};

const SOURCE_ALIASES: Record<string, string> = {
  "pix": "pix", "dinheiro": "dinheiro", "transferencia": "transferencia",
  "src_pix": "pix", "src_dinheiro": "dinheiro", "src_transf": "transferencia"
};

// ============================================================================
// 🔧 UTILITIES
// ============================================================================

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function isNumericOnly(text: string): boolean {
  const cleaned = text.replace(/[^\d.,]/g, "").replace(",", ".");
  return /^\d+([.,]\d+)?$/.test(cleaned) && parseFloat(cleaned) > 0;
}

function parseNumericValue(text: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, "").replace(",", ".");
  const value = parseFloat(cleaned);
  return isNaN(value) || value <= 0 ? null : value;
}

function logDecision(data: { messageId: string; decision: string; details?: any }) {
  console.log(`📊 [DECISION] ${JSON.stringify({ msg_id: data.messageId?.slice(-8), decision: data.decision, ...data.details })}`);
}

// ============================================================================
// 🧠 DECISION ENGINE - ARQUITETURA CORRIGIDA
// ============================================================================
// REGRAS DE OURO:
// 1. Heurística NÃO decide - apenas ESTIMA confiança
// 2. Se confiança >= 0.90 E slots completos → EXECUTA DIRETO (sem perguntas!)
// 3. IA é fallback, não muleta
// 4. Fluxos legados são BLOQUEADOS quando decisão semântica foi tomada
// ============================================================================

interface SemanticResult {
  actionType: ActionType;
  confidence: number;
  slots: ExtractedSlots;
  reason: string;
  canExecuteDirectly: boolean; // NOVO: indica se pode executar sem perguntas
}

const SEMANTIC_PATTERNS = {
  // 🔄 RECORRENTE - Prioridade MÁXIMA (antes de expense)
  recurring: {
    verbs: [],
    contexts: [
      "todo mes", "todo mês", "mensal", "mensalmente", 
      "todo dia", "semanal", "semanalmente", 
      "anual", "anualmente", "assinatura",
      "todo começo de mes", "todo começo de mês",
      "todo fim de mes", "todo fim de mês",
      "por mes", "por mês", "ao mes", "ao mês",
      "cada mes", "cada mês", "cobrado mensal",
      "pago todo", "desconta todo"
    ],
    weight: 0.95
  },
  // 📍 CONTEXTO TEMPORÁRIO (viagem, evento, obra)
  set_context: {
    verbs: [
      "vou viajar", "viagem para", "fazer uma viagem",
      "vou fazer uma obra", "comecando obra", "começando obra", 
      "evento de", "vou para",
      "entre o dia", "entre dia", "entre os dias",
      "de hoje ate", "de hoje até", "a partir de",
      "comecando dia", "começando dia",
      "do dia", "partir do dia"
    ],
    contexts: [
      "viagem", "férias", "ferias", 
      "obra", "reforma", "casamento", "evento",
      "lua de mel", "excursao", "excursão",
      "congresso", "conferencia", "conferência"
    ],
    weight: 0.92
  },
  income: {
    verbs: ["recebi", "recebido", "ganhei", "caiu", "entrou", "entrada de", "me mandaram", "mandaram pra mim", "depositaram", "transferiram"],
    contexts: ["salario", "salário", "pagamento recebido", "pix recebido"],
    weight: 0.95
  },
  card_event: {
    verbs: ["limite"],
    contexts: [],
    weight: 0.92
  },
  expense: {
    verbs: ["gastei", "comprei", "paguei", "custou"],
    contexts: [],
    weight: 0.90
  },
  cancel: {
    verbs: ["cancela", "cancelar", "desfaz", "apaga"],
    contexts: ["deixa pra la", "esquece", "nao quero"],
    weight: 0.95
  },
  query: {
    verbs: ["quanto gastei", "resumo", "saldo", "quanto tenho"],
    contexts: [],
    weight: 0.92
  }
};

function classifySemanticHeuristic(message: string): SemanticResult {
  const normalized = normalizeText(message);
  const original = message;
  
  // Extrair slots básicos primeiro
  const slots: ExtractedSlots = {};
  
  // 1. EXTRAIR VALOR
  const valuePatterns = [
    /r\$\s*([\d.,]+)/i,
    /([\d.,]+)\s*(?:reais|real)/i,
    /(?:recebi|gastei|paguei|comprei|caiu|entrada de|limite)\s*([\d.,]+)/i,
  ];
  for (const pattern of valuePatterns) {
    const match = original.match(pattern);
    if (match) {
      slots.amount = parseFloat(match[1].replace(",", "."));
      break;
    }
  }
  // Fallback: qualquer número na mensagem
  if (!slots.amount) {
    const numMatch = original.match(/(\d+[.,]?\d*)/);
    if (numMatch) slots.amount = parseFloat(numMatch[1].replace(",", "."));
  }
  
  // 2. EXTRAIR FONTE/PAGAMENTO
  if (normalized.includes("pix")) {
    slots.source = "pix";
    slots.payment_method = "pix";
  } else if (normalized.includes("dinheiro")) {
    slots.source = "dinheiro";
    slots.payment_method = "dinheiro";
  } else if (normalized.includes("transferencia") || normalized.includes("transf")) {
    slots.source = "transferencia";
  } else if (normalized.includes("debito") || normalized.includes("débito")) {
    slots.payment_method = "debito";
  } else if (normalized.includes("credito") || normalized.includes("crédito") || normalized.includes("cartao") || normalized.includes("cartão")) {
    slots.payment_method = "credito";
  }
  
  // 3. EXTRAIR CARTÃO (para card_event)
  const banks = ["nubank", "itau", "itaú", "bradesco", "santander", "c6", "inter", "picpay", "next"];
  for (const bank of banks) {
    if (normalized.includes(bank)) {
      slots.card = bank;
      break;
    }
  }
  if (slots.amount && normalized.includes("limite")) {
    slots.value = slots.amount;
  }
  
  // 4. EXTRAIR PERIODICIDADE E DIA (para recorrente)
  if (normalized.includes("todo mes") || normalized.includes("mensal") || normalized.includes("por mes") || normalized.includes("ao mes") || normalized.includes("cada mes")) {
    slots.periodicity = "monthly";
  } else if (normalized.includes("semanal") || normalized.includes("por semana")) {
    slots.periodicity = "weekly";
  } else if (normalized.includes("anual") || normalized.includes("por ano")) {
    slots.periodicity = "yearly";
  }
  
  // Extrair dia do mês (ex: "todo dia 10", "dia 5")
  const dayMatch = original.match(/(?:todo\s*)?dia\s*(\d{1,2})/i);
  if (dayMatch) {
    slots.day_of_month = parseInt(dayMatch[1]);
  }
  
  // 5. EXTRAIR DATAS (para set_context) - MELHORADO
  const datePatterns = [
    // "de 09/01 até 10/01" ou "de 9/1 a 10/1"
    /de\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s*(?:a|até|ate)\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "entre o dia 09/01 e 10/01" ou "entre dia 9 e 10"
    /entre\s*(?:o\s*)?(?:dia\s*)?(\d{1,2}(?:[\/\-]\d{1,2})?(?:[\/\-]\d{2,4})?)\s*(?:e|a|até|ate)\s*(?:dia\s*)?(\d{1,2}(?:[\/\-]\d{1,2})?(?:[\/\-]\d{2,4})?)/i,
    // "do dia 09 ao 10" 
    /do\s*dia\s*(\d{1,2}(?:[\/\-]\d{1,2})?)\s*(?:ao?|até|ate)\s*(?:dia\s*)?(\d{1,2}(?:[\/\-]\d{1,2})?)/i,
    // "de hoje até dia X"
    /(?:de\s*)?hoje\s*(?:a|até|ate)\s*(?:dia\s*)?(\d{1,2})/i,
  ];
  for (const pattern of datePatterns) {
    const match = original.match(pattern);
    if (match) {
      // Normalizar datas (adicionar mês atual se não especificado)
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      
      let startStr = match[1] || "";
      let endStr = match[2] || match[1] || "";
      
      // Se é só um número (dia), adicionar mês atual
      if (/^\d{1,2}$/.test(startStr)) {
        startStr = `${startStr}/${currentMonth}`;
      }
      if (/^\d{1,2}$/.test(endStr)) {
        endStr = `${endStr}/${currentMonth}`;
      }
      
      slots.date_range = { start: startStr, end: endStr };
      break;
    }
  }
  
  // 6. EXTRAIR LABEL DO CONTEXTO
  const contextLabelPatterns = [
    /viagem\s+(?:para|pra|a)\s+([A-Za-zÀ-ú\s]+?)(?:\s+de|\s+entre|\s+do|\s*$)/i,
    /vou\s+(?:para|pra|a)\s+([A-Za-zÀ-ú\s]+?)(?:\s+de|\s+entre|\s+do|\s*$)/i,
    /(?:viagem|evento|obra|reforma)\s+(?:em|no|na)\s+([A-Za-zÀ-ú\s]+)/i,
  ];
  for (const pattern of contextLabelPatterns) {
    const match = original.match(pattern);
    if (match && match[1]) {
      slots.label = match[1].trim();
      break;
    }
  }
  
  // 7. EXTRAIR DESCRIÇÃO GENÉRICA (para expenses/income não recorrentes)
  // Exemplo: "gastei 50 no mercado" → description = "mercado"
  // Exemplo: "recebi 200 do freelance" → description = "freelance"
  if (!slots.description) {
    const descPatterns = [
      /(?:gastei|paguei|comprei)\s+[\d.,]+\s*(?:reais?)?\s*(?:no?|na?|em|de|com)\s+(.+?)(?:\s+(?:no\s+)?(?:pix|debito|credito|dinheiro|cartao)|\s*$)/i,
      /(?:recebi|caiu|entrou|ganhei)\s+[\d.,]+\s*(?:reais?)?\s*(?:do?|da?|de|com)\s+(.+?)(?:\s*$)/i,
      /(.+?)\s+[\d.,]+\s*(?:reais?)?(?:\s+(?:pix|debito|credito|dinheiro))?\s*$/i,
    ];
    for (const pattern of descPatterns) {
      const match = original.match(pattern);
      if (match && match[1]) {
        const desc = match[1]
          .replace(/\b(pix|debito|débito|credito|crédito|dinheiro|cartao|cartão|todo|mes|mês)\b/gi, "")
          .trim();
        if (desc.length > 1) {
          slots.description = desc;
          break;
        }
      }
    }
  }
  
  // ========================================================================
  // CLASSIFICAÇÃO POR PADRÕES (HEURÍSTICA - NÃO DECISÃO!)
  // ========================================================================
  
  // 🔄 RECURRING - Prioridade MÁXIMA (antes de expense)
  for (const ctx of SEMANTIC_PATTERNS.recurring.contexts) {
    if (normalized.includes(ctx)) {
      // EXTRAÇÃO ESPECIAL DE DESCRIÇÃO PARA RECORRENTE
      // Exemplo: "Netflix todo mês 40 reais" → description = "Netflix"
      // Exemplo: "Aluguel 1500 todo dia 10" → description = "Aluguel"
      if (!slots.description) {
        // Tentar extrair nome do serviço/gasto ANTES do termo de recorrência
        const recurringTerms = ["todo mes", "todo mês", "mensal", "mensalmente", "todo dia", "semanal", "anual", "assinatura", "por mes", "por mês", "ao mes", "ao mês", "cada mes", "cada mês"];
        let descMatch: string | null = null;
        
        for (const term of recurringTerms) {
          const termIndex = normalized.indexOf(term);
          if (termIndex > 0) {
            // Pegar texto antes do termo
            const beforeTerm = original.substring(0, termIndex).trim();
            // Remover valor numérico e palavras de pagamento
            const cleanDesc = beforeTerm
              .replace(/r\$\s*[\d.,]+|[\d.,]+\s*reais?/gi, "")
              .replace(/\b(pix|debito|débito|credito|crédito|dinheiro|cartao|cartão)\b/gi, "")
              .replace(/[\d.,]+/g, "")
              .trim();
            if (cleanDesc.length > 1) {
              descMatch = cleanDesc;
              break;
            }
          }
        }
        
        // Se não achou antes, tentar achar depois (ex: "todo mês pago Netflix 40")
        if (!descMatch) {
          const afterMatch = original.match(/(?:todo\s*m[êe]s|mensal|semanal|anual)\s+(?:pago\s+)?([A-Za-zÀ-ú\s]+?)(?:\s+\d|$)/i);
          if (afterMatch && afterMatch[1]) {
            descMatch = afterMatch[1].trim();
          }
        }
        
        if (descMatch) {
          slots.description = descMatch;
        }
      }
      
      const canExecute = !!(slots.amount && slots.description);
      console.log(`🔄 [HEURISTIC] Recurring detectado: amount=${slots.amount}, description="${slots.description}", canExecute=${canExecute}`);
      
      return {
        actionType: "recurring",
        confidence: SEMANTIC_PATTERNS.recurring.weight,
        slots,
        reason: `Termo de recorrência: "${ctx}"`,
        canExecuteDirectly: canExecute
      };
    }
  }
  
  // 📍 SET_CONTEXT - Viagem/Evento
  // Detectar menção a datas/períodos junto com palavras de contexto
  const hasDateRange = !!slots.date_range;
  const hasContextWord = SEMANTIC_PATTERNS.set_context.contexts.some(ctx => normalized.includes(ctx));
  
  // Se tem intervalo de datas E palavra de contexto → é set_context
  if (hasDateRange && hasContextWord) {
    if (!slots.label) {
      // Tentar extrair label das palavras de contexto
      for (const ctx of SEMANTIC_PATTERNS.set_context.contexts) {
        if (normalized.includes(ctx)) {
          slots.label = ctx.charAt(0).toUpperCase() + ctx.slice(1);
          break;
        }
      }
    }
    console.log(`📍 [HEURISTIC] set_context detectado com datas: ${JSON.stringify(slots.date_range)}, label="${slots.label}"`);
    return {
      actionType: "set_context",
      confidence: SEMANTIC_PATTERNS.set_context.weight,
      slots,
      reason: `Contexto com período: ${slots.label}`,
      canExecuteDirectly: true // Tem datas = pode criar
    };
  }
  
  for (const verb of SEMANTIC_PATTERNS.set_context.verbs) {
    if (normalized.includes(verb)) {
      return {
        actionType: "set_context",
        confidence: SEMANTIC_PATTERNS.set_context.weight,
        slots,
        reason: `Criação de contexto: "${verb}"`,
        canExecuteDirectly: hasDateRange // Pode executar se tem datas
      };
    }
  }
  
  for (const ctx of SEMANTIC_PATTERNS.set_context.contexts) {
    if (normalized.includes(ctx)) {
      // Verificar se é criação de contexto (vou fazer, vou para, começando, etc)
      if (normalized.includes("vou") || normalized.includes("comec") || normalized.includes("inicio") || normalized.includes("início") || normalized.includes("fazer") || normalized.includes("entre")) {
        if (!slots.label) slots.label = ctx.charAt(0).toUpperCase() + ctx.slice(1);
        return {
          actionType: "set_context",
          confidence: SEMANTIC_PATTERNS.set_context.weight * 0.9,
          slots,
          reason: `Contexto detectado: "${ctx}"`,
          canExecuteDirectly: hasDateRange
        };
      }
    }
  }
  
  // 🟢 INCOME - Prioridade ALTA
  for (const verb of SEMANTIC_PATTERNS.income.verbs) {
    if (normalized.includes(verb)) {
      // Verificar se pode executar diretamente (tem amount)
      const canExecute = !!slots.amount;
      return {
        actionType: "income",
        confidence: SEMANTIC_PATTERNS.income.weight,
        slots,
        reason: `Verbo de entrada: "${verb}"`,
        canExecuteDirectly: canExecute
      };
    }
  }
  
  // 🟡 CARD_EVENT
  if (normalized.includes("limite")) {
    const canExecute = !!(slots.card && slots.value);
    return {
      actionType: "card_event",
      confidence: SEMANTIC_PATTERNS.card_event.weight,
      slots,
      reason: `Atualização de limite detectada`,
      canExecuteDirectly: canExecute
    };
  }
  
  // 🔴 EXPENSE
  for (const verb of SEMANTIC_PATTERNS.expense.verbs) {
    if (normalized.includes(verb)) {
      const canExecute = !!(slots.amount && slots.payment_method);
      return {
        actionType: "expense",
        confidence: SEMANTIC_PATTERNS.expense.weight,
        slots,
        reason: `Verbo de gasto: "${verb}"`,
        canExecuteDirectly: canExecute
      };
    }
  }
  
  // 🗑️ CANCEL
  for (const verb of SEMANTIC_PATTERNS.cancel.verbs) {
    if (normalized.includes(verb)) {
      return {
        actionType: "cancel",
        confidence: SEMANTIC_PATTERNS.cancel.weight,
        slots,
        reason: `Cancelamento: "${verb}"`,
        canExecuteDirectly: true
      };
    }
  }
  for (const ctx of SEMANTIC_PATTERNS.cancel.contexts) {
    if (normalized.includes(ctx)) {
      return {
        actionType: "cancel",
        confidence: 0.9,
        slots,
        reason: `Contexto de cancelamento: "${ctx}"`,
        canExecuteDirectly: true
      };
    }
  }
  
  // 📊 QUERY
  for (const verb of SEMANTIC_PATTERNS.query.verbs) {
    if (normalized.includes(verb)) {
      return {
        actionType: "query",
        confidence: SEMANTIC_PATTERNS.query.weight,
        slots,
        reason: `Consulta: "${verb}"`,
        canExecuteDirectly: true
      };
    }
  }
  
  // ❓ UNKNOWN
  return {
    actionType: "unknown",
    confidence: 0.2,
    slots,
    reason: "Não classificado por heurística",
    canExecuteDirectly: false
  };
}

// ============================================================================
// 🧠 PROMPT UNIVERSAL FINAX - IA COMO EXTRATORA SEMÂNTICA PRINCIPAL
// ============================================================================
const PROMPT_FINAX_UNIVERSAL = `# FINAX - EXTRATOR SEMÂNTICO FINANCEIRO

Você é o cérebro do Finax. Sua função é INTERPRETAR a intenção do usuário e extrair dados estruturados.

## REGRA ABSOLUTA
- NÃO seja literal. Interprete o SENTIDO, não as palavras.
- Entenda variações naturais da língua portuguesa.

## TIPOS DE AÇÃO (em ordem de prioridade)

| Tipo | Quando usar | Evidências | Slots obrigatórios |
|------|-------------|------------|-------------------|
| recurring | Gasto que se REPETE | "todo mês", "mensal", "assinatura", "por mês", "mensalmente" | amount, description |
| set_context | Período ESPECIAL temporário | "viagem", "obra", "entre dia X e Y", "vou viajar" | label, start_date, end_date |
| income | Dinheiro ENTRANDO | "recebi", "caiu", "entrou", "me mandaram", "ganhei" | amount |
| expense | Gasto ÚNICO (sem recorrência) | "gastei", "paguei", "comprei", "custou" | amount, payment_method |
| card_event | Atualização de CARTÃO | "limite", "fatura" | card, value |
| cancel | Cancelar/desfazer | "cancela", "desfaz", "apaga" | - |
| query | Consultar resumo/saldo | "resumo", "quanto gastei", "saldo" | - |
| unknown | Não identificado | - | - |

## REGRAS DE CLASSIFICAÇÃO

### RECURRING (Prioridade Máxima)
SE a mensagem menciona periodicidade → É RECURRING, nunca expense!
- "Netflix todo mês 40" → recurring (amount=40, description="Netflix", periodicity="monthly")
- "Aluguel 1500 todo dia 5" → recurring (amount=1500, description="Aluguel", periodicity="monthly", day_of_month=5)
- "Academia 99 mensal" → recurring (amount=99, description="Academia", periodicity="monthly")
- "Assinatura Spotify 20" → recurring (amount=20, description="Spotify", periodicity="monthly")

### SET_CONTEXT (Segundo Prioridade)
SE menciona período/datas + viagem/obra/evento → set_context
- "Vou viajar pra SP de 15/01 até 20/01" → set_context (label="Viagem SP", start_date="15/01", end_date="20/01")
- "Entre o dia 09 e 10 vou fazer uma viagem" → set_context (label="Viagem", start_date="09/01", end_date="10/01")
- "Começando obra semana que vem" → set_context (label="Obra", start_date=<próximo dia>, end_date=<+7 dias>)

### INCOME
SE dinheiro está ENTRANDO → income
- "Recebi 200 do pix" → income (amount=200, source="pix")
- "Caiu 1500 do salário" → income (amount=1500, description="salário")
- "Me mandaram 77 do tigrinho" → income (amount=77, description="tigrinho")

### EXPENSE (Somente quando NÃO é recurring)
- "Gastei 50 no uber" → expense (amount=50, description="uber")
- "Paguei 30 de estacionamento" → expense (amount=30, description="estacionamento")

## NOMES DOS SLOTS (USE EXATAMENTE ESTES)
- amount: number (valor em reais)
- description: string (nome do serviço/produto)
- payment_method: "pix" | "debito" | "credito" | "dinheiro"
- source: "pix" | "dinheiro" | "transferencia"
- periodicity: "monthly" | "weekly" | "yearly"
- day_of_month: number (1-31)
- label: string (nome do evento/viagem)
- start_date: "DD/MM"
- end_date: "DD/MM"
- card: string (nome do banco)
- value: number (valor do limite)

## RESPOSTA
Responda APENAS JSON válido, sem texto adicional:
{
  "actionType": "recurring|set_context|income|expense|card_event|cancel|query|unknown",
  "confidence": 0.0-1.0,
  "slots": { ... },
  "shouldExecute": true|false,
  "reasoning": "explicação curta"
}`;

// ============================================================================
// 🔧 NORMALIZAÇÃO DE SLOTS DA IA
// ============================================================================
function normalizeAISlots(slots: Record<string, any>): ExtractedSlots {
  const normalized: ExtractedSlots = {};
  
  // Copiar slots válidos
  if (slots.amount !== undefined) normalized.amount = Number(slots.amount);
  if (slots.description) normalized.description = String(slots.description);
  if (slots.payment_method) normalized.payment_method = String(slots.payment_method).toLowerCase();
  if (slots.source) normalized.source = String(slots.source).toLowerCase();
  if (slots.card) normalized.card = String(slots.card);
  if (slots.value !== undefined) normalized.value = Number(slots.value);
  if (slots.label) normalized.label = String(slots.label);
  if (slots.start_date) normalized.start_date = String(slots.start_date);
  if (slots.end_date) normalized.end_date = String(slots.end_date);
  if (slots.day_of_month !== undefined) normalized.day_of_month = Number(slots.day_of_month);
  if (slots.date_range) normalized.date_range = slots.date_range;
  
  // Normalizar periodicity (corrigir se IA retornar em português)
  if (slots.periodicity) {
    const periodicityMap: Record<string, string> = {
      "mensal": "monthly",
      "semanal": "weekly", 
      "anual": "yearly",
      "monthly": "monthly",
      "weekly": "weekly",
      "yearly": "yearly"
    };
    normalized.periodicity = periodicityMap[String(slots.periodicity).toLowerCase()] || "monthly";
  }
  
  // Normalizar frequency → periodicity (caso IA use nome errado)
  if (slots.frequency && !normalized.periodicity) {
    const freqMap: Record<string, string> = {
      "mensal": "monthly",
      "semanal": "weekly",
      "anual": "yearly"
    };
    normalized.periodicity = freqMap[String(slots.frequency).toLowerCase()] || "monthly";
  }
  
  // Normalizar valor → amount
  if (slots.valor && !normalized.amount) {
    normalized.amount = Number(slots.valor);
  }
  
  // Normalizar descricao → description
  if (slots.descricao && !normalized.description) {
    normalized.description = String(slots.descricao);
  }
  
  return normalized;
}

async function callAIForDecision(
  message: string, 
  context: { hasActiveAction: boolean; activeActionType?: string; activeActionSlots?: Record<string, any>; pendingSlot?: string | null },
  history?: string
): Promise<SemanticResult> {
  try {
    let contextInfo = "";
    if (context.hasActiveAction) {
      contextInfo = `
CONTEXTO ATIVO (usuário está no meio de uma ação):
- Tipo: ${context.activeActionType}
- Slots já preenchidos: ${JSON.stringify(context.activeActionSlots)}
- Slot pendente: ${context.pendingSlot || "nenhum"}
`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: PROMPT_FINAX_UNIVERSAL + "\n\n" + contextInfo },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"actionType": "unknown", "confidence": 0.3}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error("❌ [AI] JSON inválido:", cleanJson.slice(0, 200));
      return {
        actionType: "unknown",
        confidence: 0.3,
        slots: {},
        reason: "JSON inválido da IA",
        canExecuteDirectly: false
      };
    }
    
    // Normalizar slots
    const normalizedSlots = normalizeAISlots(parsed.slots || {});
    
    // Determinar se pode executar diretamente
    const actionType = parsed.actionType || "unknown";
    const canExecute = hasAllRequiredSlots(actionType, normalizedSlots);
    
    console.log(`🤖 [AI] ${actionType} | Conf: ${parsed.confidence} | Slots: ${JSON.stringify(normalizedSlots)} | Exec: ${canExecute}`);
    
    return {
      actionType,
      confidence: parsed.confidence || 0.5,
      slots: normalizedSlots,
      reason: parsed.reasoning || "",
      canExecuteDirectly: canExecute
    };
  } catch (error) {
    console.error("❌ [AI] Erro:", error);
    return {
      actionType: "unknown",
      confidence: 0.3,
      slots: {},
      reason: "Erro na IA",
      canExecuteDirectly: false
    };
  }
}

// ============================================================================
// 🔍 getMissingSlots - LISTA SLOTS OBRIGATÓRIOS FALTANTES
// ============================================================================

function getMissingSlots(actionType: ActionType, currentSlots: Record<string, any>): string[] {
  const requirements = SLOT_REQUIREMENTS[actionType];
  if (!requirements) return [];
  
  return requirements.required.filter(slot => {
    const value = currentSlots[slot];
    return value === null || value === undefined || value === "";
  });
}

// ============================================================================
// 🚫 GUARD CLAUSES DE DOMÍNIO
// ============================================================================
// Depois que o Decision Engine decide uma intenção, é PROIBIDO:
// - card_event cair em expense/income
// - income perguntar se é gasto
// - expense perguntar se é entrada
// - Número isolado em card_event disparar slot de valor financeiro
// ============================================================================

function assertDomainIsolation(
  decidedType: ActionType, 
  activeAction: ActiveAction | null
): { valid: boolean; shouldDiscard: boolean } {
  if (!activeAction) return { valid: true, shouldDiscard: false };
  
  const currentType = activeAction.intent.includes("entrada") || activeAction.intent === "income" ? "income"
    : activeAction.intent.includes("card") || activeAction.intent === "card_event" ? "card_event"
    : activeAction.intent.includes("gasto") || activeAction.intent === "expense" ? "expense"
    : activeAction.intent;
  
  // Se domínios são diferentes e o novo não é cancel/control → descartar contexto
  if (decidedType !== "unknown" && decidedType !== "cancel" && decidedType !== "control") {
    if (decidedType !== currentType) {
      console.log(`🚫 [GUARD] Domínio incompatível: contexto=${currentType}, decisão=${decidedType} → descartando`);
      return { valid: true, shouldDiscard: true };
    }
  }
  
  return { valid: true, shouldDiscard: false };
}

// ============================================================================
// 🎯 DECISION ENGINE PRINCIPAL - IA PRIMEIRO, HEURÍSTICA FALLBACK
// ============================================================================
// NOVA ARQUITETURA:
// 1. IA SEMPRE é chamada primeiro para classificar e extrair
// 2. Heurística só é usada como fallback quando IA falha
// 3. Slots são mesclados: IA tem prioridade
// ============================================================================

async function decisionEngine(
  message: string,
  activeAction: ActiveAction | null,
  history?: string
): Promise<{ result: SemanticResult; shouldBlockLegacyFlow: boolean }> {
  
  console.log(`\n🧠 [DECISION ENGINE v2.0 - IA PRIMEIRO] ━━━━━━━━━━━━━━━━`);
  console.log(`📩 Mensagem: "${message.slice(0, 60)}..."`);
  
  // ========================================================================
  // PRIORIDADE 1: Se há slot pendente, tentar extrair valor simples
  // ========================================================================
  if (activeAction && activeAction.pending_slot) {
    const slotValue = extractSlotValue(message, activeAction.pending_slot);
    
    if (slotValue !== null) {
      console.log(`📥 Preenchendo slot pendente "${activeAction.pending_slot}": ${slotValue}`);
      
      const actionType = activeAction.intent.includes("income") ? "income" 
        : activeAction.intent.includes("expense") ? "expense"
        : activeAction.intent.includes("recurring") ? "recurring"
        : activeAction.intent as ActionType;
      
      const mergedSlots = { ...activeAction.slots, [activeAction.pending_slot]: slotValue };
      
      return {
        result: {
          actionType,
          confidence: 0.95,
          slots: mergedSlots,
          reason: `Slot ${activeAction.pending_slot} preenchido`,
          canExecuteDirectly: getMissingSlots(actionType, mergedSlots).length === 0
        },
        shouldBlockLegacyFlow: true
      };
    }
  }
  
  // ========================================================================
  // PRIORIDADE 2: IA EXTRAI E CLASSIFICA (Sempre!)
  // ========================================================================
  console.log(`🤖 [IA PRIMEIRO] Chamando IA para classificar...`);
  
  const aiResult = await callAIForDecision(
    message,
    {
      hasActiveAction: !!activeAction,
      activeActionType: activeAction?.intent,
      activeActionSlots: activeAction?.slots,
      pendingSlot: activeAction?.pending_slot
    },
    history
  );
  
  console.log(`🤖 [IA] Resultado: ${aiResult.actionType} | Conf: ${(aiResult.confidence * 100).toFixed(0)}% | Slots: ${JSON.stringify(aiResult.slots)}`);
  
  // ========================================================================
  // Se IA tem boa confiança (>= 0.75), USAR resultado da IA
  // ========================================================================
  if (aiResult.confidence >= 0.75 && aiResult.actionType !== "unknown") {
    const missing = getMissingSlots(aiResult.actionType, aiResult.slots);
    
    console.log(`✅ [IA] Confiança alta (${(aiResult.confidence * 100).toFixed(0)}%) | Faltam: ${missing.join(", ") || "nenhum"}`);
    
    return {
      result: {
        ...aiResult,
        canExecuteDirectly: missing.length === 0
      },
      shouldBlockLegacyFlow: true
    };
  }
  
  // ========================================================================
  // FALLBACK: IA incerta → usar heurística para ajudar
  // ========================================================================
  console.log(`⚠️ [IA] Confiança baixa, usando heurística como fallback...`);
  
  const heuristic = classifySemanticHeuristic(message);
  console.log(`🏷️ [HEURÍSTICA] ${heuristic.actionType} | Conf: ${(heuristic.confidence * 100).toFixed(0)}%`);
  
  // Escolher o melhor resultado entre IA e heurística
  const bestResult = heuristic.confidence > aiResult.confidence ? heuristic : aiResult;
  
  // Mesclar slots: IA tem prioridade sobre heurística
  const mergedSlots = { ...heuristic.slots, ...aiResult.slots };
  const mergedMissing = getMissingSlots(bestResult.actionType, mergedSlots);
  
  console.log(`🔀 [MERGE] Tipo: ${bestResult.actionType} | Slots: ${JSON.stringify(mergedSlots)} | Faltam: ${mergedMissing.join(", ") || "nenhum"}`);
  
  return {
    result: {
      actionType: bestResult.actionType,
      confidence: Math.max(aiResult.confidence, heuristic.confidence),
      slots: mergedSlots,
      reason: `IA + Heurística: ${bestResult.reason}`,
      canExecuteDirectly: mergedMissing.length === 0
    },
    shouldBlockLegacyFlow: bestResult.confidence >= 0.70
  };
}

function extractSlotValue(message: string, slotType: string): any {
  const normalized = normalizeText(message);
  
  switch (slotType) {
    case "amount":
    case "value":
      const numMatch = message.match(/(\d+[.,]?\d*)/);
      if (numMatch) return parseFloat(numMatch[1].replace(",", "."));
      return null;
      
    case "payment_method":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("debito") || normalized.includes("débito")) return "debito";
      if (normalized.includes("credito") || normalized.includes("crédito")) return "credito";
      if (normalized.includes("dinheiro")) return "dinheiro";
      return null;
      
    case "source":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("dinheiro")) return "dinheiro";
      if (normalized.includes("transfer")) return "transferencia";
      return null;
      
    case "type_choice":
      if (normalized.includes("gasto") || normalized.includes("gastei") || normalized.includes("paguei")) return "expense";
      if (normalized.includes("entrada") || normalized.includes("recebi") || normalized.includes("ganhei")) return "income";
      return null;
      
    default:
      return message.trim() || null;
  }
}

// ============================================================================
// 🎯 CONTEXT MANAGER
// ============================================================================

async function getActiveAction(userId: string): Promise<ActiveAction | null> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  await supabase
    .from("actions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection"])
    .lt("updated_at", fiveMinutesAgo);
  
  const { data: action } = await supabase
    .from("actions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!action) return null;
  
  const meta = (action.meta || {}) as Record<string, any>;
  const slots = (action.slots || {}) as Record<string, any>;
  
  return {
    id: action.id,
    user_id: action.user_id,
    type: meta.action_type || "slot_filling",
    intent: action.action_type,
    slots,
    status: action.status,
    pending_slot: meta.pending_slot || null,
    pending_selection_id: meta.pending_selection_id || null,
    origin_message_id: meta.origin_message_id || null,
    last_message_id: meta.last_message_id || null,
    created_at: action.created_at,
    updated_at: action.updated_at || action.created_at,
    expires_at: meta.expires_at || new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
}

async function createAction(
  userId: string,
  type: string,
  intent: string,
  slots: Record<string, any>,
  pendingSlot?: string | null,
  messageId?: string | null
): Promise<ActiveAction> {
  const actionHash = `action_${userId.slice(0, 8)}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  
  const { data: newAction, error } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: intent,
      action_hash: actionHash,
      status: "collecting",
      slots,
      meta: { 
        action_type: type,
        pending_slot: pendingSlot || undefined,
        origin_message_id: messageId || undefined,
        last_message_id: messageId || undefined,
        expires_at: expiresAt
      }
    })
    .select()
    .single();
  
  if (error) {
    console.error("❌ [ACTION] Erro ao criar:", error);
    throw error;
  }
  
  console.log(`✨ [ACTION] Criado: ${type} | ${intent} | Slots: ${JSON.stringify(slots)}`);
  
  return {
    id: newAction.id,
    user_id: userId,
    type,
    intent,
    slots,
    status: "collecting",
    pending_slot: pendingSlot || undefined,
    origin_message_id: messageId || undefined,
    last_message_id: messageId || undefined,
    created_at: newAction.created_at,
    updated_at: newAction.created_at,
    expires_at: expiresAt
  };
}

async function updateAction(
  actionId: string,
  updates: { slots?: Record<string, any>; status?: string; pending_slot?: string | null }
): Promise<void> {
  const { data: existing } = await supabase.from("actions").select("meta").eq("id", actionId).single();
  const meta = { ...(existing?.meta as Record<string, any> || {}) };
  
  if (updates.pending_slot !== undefined) meta.pending_slot = updates.pending_slot;
  
  const updateData: Record<string, any> = { meta, updated_at: new Date().toISOString() };
  if (updates.slots) updateData.slots = updates.slots;
  if (updates.status) updateData.status = updates.status;
  
  await supabase.from("actions").update(updateData).eq("id", actionId);
  console.log(`🔄 [ACTION] Atualizado: ${actionId.slice(-8)}`);
}

async function closeAction(actionId: string, entityId?: string): Promise<void> {
  await supabase.from("actions").update({ status: "done", entity_id: entityId, updated_at: new Date().toISOString() }).eq("id", actionId);
  console.log(`✅ [ACTION] Fechado: ${actionId.slice(-8)}`);
}

async function cancelAction(userId: string): Promise<boolean> {
  const action = await getActiveAction(userId);
  if (!action) return false;
  
  await supabase.from("actions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", action.id);
  console.log(`🗑️ [ACTION] Cancelado: ${action.id.slice(-8)}`);
  return true;
}

// Função removida - substituída por assertDomainIsolation()

// ============================================================================
// 📱 MESSAGING
// ============================================================================

async function sendWhatsAppMeta(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: cleanNumber, type: "text", text: { body: text } }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Meta] Erro:", error);
    return false;
  }
}

async function sendWhatsAppVonage(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch("https://messages-sandbox.nexmo.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`)}` },
      body: JSON.stringify({ from: VONAGE_WHATSAPP_NUMBER, to: cleanNumber, message_type: "text", text: text, channel: "whatsapp" }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Vonage] Erro:", error);
    return false;
  }
}

async function sendMessage(to: string, text: string, source: MessageSource): Promise<boolean> {
  if (source === "vonage") return sendWhatsAppVonage(to, text);
  return sendWhatsAppMeta(to, text);
}

async function sendButtons(to: string, bodyText: string, buttons: Array<{ id: string; title: string }>, source: MessageSource): Promise<boolean> {
  if (source !== "meta") {
    const fallbackText = bodyText + "\n\n" + buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    return sendMessage(to, fallbackText, source);
  }

  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: { buttons: buttons.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) }
        }
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Meta Buttons] Erro:", error);
    return sendMessage(to, bodyText, source);
  }
}

// ============================================================================
// 🎤 MÍDIA (AUDIO/IMAGEM)
// ============================================================================

async function downloadWhatsAppMedia(mediaId: string, eventoId?: string): Promise<string | null> {
  if (eventoId) {
    const { data: evento } = await supabase.from("eventos_brutos").select("media_status, media_attempts, media_downloaded").eq("id", eventoId).single();
    if (evento?.media_status === 'done' || evento?.media_downloaded) return null;
    if ((evento?.media_attempts || 0) >= 2) return null;
    await supabase.from("eventos_brutos").update({ media_status: 'processing', media_attempts: (evento?.media_attempts || 0) + 1 }).eq("id", eventoId);
  }
  
  try {
    const urlResponse = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } });
    if (!urlResponse.ok) return null;
    
    const urlData = await urlResponse.json();
    const mediaResponse = await fetch(urlData.url, { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } });
    if (!mediaResponse.ok) return null;
    
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    if (eventoId) await supabase.from("eventos_brutos").update({ media_status: 'done', media_downloaded: true }).eq("id", eventoId);
    return base64;
  } catch (error) {
    console.error("❌ [MÍDIA] Erro:", error);
    return null;
  }
}

async function transcreverAudio(audioBase64: string): Promise<{ texto: string | null; confianca: number }> {
  try {
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { "Authorization": ASSEMBLYAI_API_KEY!, "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!uploadResponse.ok) return { texto: null, confianca: 0 };
    
    const uploadData = await uploadResponse.json();
    const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "Authorization": ASSEMBLYAI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: uploadData.upload_url, language_code: "pt", speech_model: "best" }),
    });
    if (!transcriptResponse.ok) return { texto: null, confianca: 0 };
    
    const transcriptData = await transcriptResponse.json();
    let status = "queued";
    let transcricao: string | null = null;
    let audioConfianca = 0;
    let tentativas = 0;
    
    while ((status === "queued" || status === "processing") && tentativas < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}`, { headers: { "Authorization": ASSEMBLYAI_API_KEY! } });
      if (!pollingResponse.ok) { tentativas++; continue; }
      const pollingData = await pollingResponse.json();
      status = pollingData.status;
      if (status === "completed") { transcricao = pollingData.text; audioConfianca = pollingData.confidence || 0.7; break; }
      tentativas++;
    }
    
    return { texto: transcricao, confianca: audioConfianca };
  } catch (error) {
    console.error("❌ [AUDIO] Erro:", error);
    return { texto: null, confianca: 0 };
  }
}

// ============================================================================
// 💾 INTENT HANDLERS
// ============================================================================

function inferCategory(description: string): string {
  const desc = normalizeText(description);
  const map: Record<string, string[]> = {
    alimentacao: ["cafe", "pao", "lanche", "almoco", "jantar", "ifood", "rappi", "restaurante", "pizza"],
    mercado: ["mercado", "supermercado", "feira"],
    transporte: ["uber", "99", "taxi", "gasolina", "estacionamento"],
    saude: ["farmacia", "remedio", "medico", "hospital"],
    lazer: ["cinema", "netflix", "spotify", "bar", "festa"],
  };
  
  for (const [cat, words] of Object.entries(map)) {
    if (words.some(w => desc.includes(w))) return cat;
  }
  return "outros";
}

async function registerExpense(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  const categoria = inferCategory(descricao);
  const formaPagamento = slots.payment_method || "outro";
  
  const agora = new Date();
  const { data: tx, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: formaPagamento,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  // 📍 INTERCEPTADOR: Vincular a contexto ativo (viagem/evento)
  await linkTransactionToContext(userId, tx.id);
  
  // Verificar se há contexto ativo para informar o usuário
  const activeContext = await getActiveContext(userId);
  let contextInfo = "";
  if (activeContext) {
    contextInfo = `\n📍 _Vinculado a: ${activeContext.label}_`;
  }
  
  if (actionId) await closeAction(actionId, tx.id);
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const emoji = categoria === "alimentacao" ? "🍽️" : categoria === "mercado" ? "🛒" : categoria === "transporte" ? "🚗" : "💸";
  
  return {
    success: true,
    message: `${emoji} *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${formaPagamento}\n📅 ${dataFormatada} às ${horaFormatada}${contextInfo}`
  };
}

async function registerIncome(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  const source = slots.source || "outro";
  
  const agora = new Date();
  const { data: tx, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria: "entrada",
    tipo: "entrada",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: source,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [INCOME] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  if (actionId) await closeAction(actionId, tx.id);
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  return {
    success: true,
    message: `💰 *Entrada registrada!*\n\n✅ *+R$ ${valor.toFixed(2)}*\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${source}\n📅 ${dataFormatada} às ${horaFormatada}`
  };
}

async function getMonthlySummary(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo")
    .eq("usuario_id", userId)
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada");

  let totalEntradas = 0, totalSaidas = 0;
  transacoes?.forEach((t) => {
    if (t.tipo === "entrada") totalEntradas += Number(t.valor);
    else totalSaidas += Number(t.valor);
  });
  
  const saldo = totalEntradas - totalSaidas;
  
  return !transacoes || transacoes.length === 0
    ? "Você ainda não tem transações este mês 📊\n\nManda um gasto!"
    : `📊 *Resumo do Mês*\n\n💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
}

async function listCardsForUser(userId: string): Promise<any[]> {
  const { data } = await supabase.from("cartoes_credito").select("*").eq("usuario_id", userId).eq("ativo", true);
  return data || [];
}

async function updateCardLimit(userId: string, cardName: string, newLimit: number): Promise<{ success: boolean; message: string }> {
  const cards = await listCardsForUser(userId);
  const card = cards.find(c => normalizeText(c.nome || "").includes(normalizeText(cardName)));
  
  if (!card) {
    return { success: false, message: `Não encontrei o cartão "${cardName}" 💳\n\nQuer ver seus cartões? Manda "ver cartões"` };
  }
  
  await supabase.from("cartoes_credito").update({ limite_total: newLimit, limite_disponivel: newLimit }).eq("id", card.id);
  
  return { success: true, message: `✅ Limite do *${card.nome}* atualizado para R$ ${newLimit.toFixed(2)}` };
}

async function listTransactionsForCancel(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, categoria, data, status")
    .eq("usuario_id", userId)
    .in("status", ["confirmada", "prevista"])
    .order("created_at", { ascending: false })
    .limit(5);
  return data || [];
}

async function cancelTransaction(userId: string, txId: string): Promise<{ success: boolean; message: string }> {
  const { data: tx } = await supabase.from("transacoes").select("*").eq("id", txId).eq("usuario_id", userId).single();
  if (!tx) return { success: false, message: "Transação não encontrada 🤔" };
  if (tx.status === "cancelada") return { success: false, message: "Já foi cancelada 👍" };
  
  await supabase.from("transacoes").update({ status: "cancelada" }).eq("id", txId);
  return { success: true, message: `✅ *Transação cancelada!*\n\n🗑️ R$ ${tx.valor?.toFixed(2)} - ${tx.descricao || tx.categoria}` };
}

// ============================================================================
// 🔄 RECURRING HANDLER - Gastos Recorrentes
// ============================================================================

async function registerRecurring(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  const categoria = inferCategory(descricao);
  const periodicity = slots.periodicity || "monthly";
  const dayOfMonth = slots.day_of_month || new Date().getDate();
  
  console.log(`🔄 [RECURRING] Registrando: R$ ${valor} - ${descricao} (${periodicity})`);
  
  const agora = new Date();
  
  // 1. Registrar o gasto de HOJE como transação normal
  const { data: tx, error: txError } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    recorrente: true,
    status: "confirmada"
  }).select("id").single();
  
  if (txError) {
    console.error("❌ [RECURRING] Erro ao criar transação:", txError);
    return { success: false, message: "Algo deu errado ao registrar 😕" };
  }
  
  // 2. Criar registro na tabela de recorrências
  const tipoRecorrencia = periodicity === "weekly" ? "semanal" : periodicity === "yearly" ? "anual" : "mensal";
  
  const { data: recorrencia, error: recError } = await supabase.from("gastos_recorrentes").insert({
    usuario_id: userId,
    valor_parcela: valor,
    categoria,
    descricao,
    tipo_recorrencia: tipoRecorrencia,
    dia_mes: dayOfMonth,
    ativo: true,
    origem: "whatsapp"
  }).select("id").single();
  
  if (recError) {
    console.error("❌ [RECURRING] Erro ao criar recorrência:", recError);
    // Ainda retorna sucesso para a transação
    return { 
      success: true, 
      message: `✅ *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n\n⚠️ _Não consegui agendar os próximos meses_`
    };
  }
  
  // Vincular transação à recorrência
  await supabase.from("transacoes").update({ id_recorrente: recorrencia.id }).eq("id", tx.id);
  
  if (actionId) await closeAction(actionId, tx.id);
  
  const diaLabel = dayOfMonth === 1 ? "início" : dayOfMonth >= 25 ? "fim" : `dia ${dayOfMonth}`;
  
  return {
    success: true,
    message: `🔄 *Gasto recorrente salvo!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n📅 Todo ${diaLabel} do mês\n\n✅ _Registrei o gasto de hoje e agendei os próximos!_`
  };
}

// ============================================================================
// 📍 CONTEXT HANDLER - Viagens/Eventos
// ============================================================================

async function getActiveContext(userId: string): Promise<any | null> {
  const now = new Date().toISOString();
  
  const { data } = await supabase
    .from("user_contexts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("start_date", now)
    .gte("end_date", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  return data || null;
}

async function createUserContext(userId: string, slots: ExtractedSlots): Promise<{ success: boolean; message: string; contextId?: string }> {
  const label = slots.label || "Evento";
  const description = slots.description || null;
  
  // Parsear datas
  let startDate = new Date();
  let endDate = new Date();
  endDate.setDate(endDate.getDate() + 7); // Default: 7 dias
  
  if (slots.date_range) {
    // Tentar parsear datas do formato brasileiro
    const parseDate = (str: string): Date => {
      const parts = str.split(/[\/\-]/);
      if (parts.length >= 2) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const year = parts[2] ? parseInt(parts[2]) : new Date().getFullYear();
        return new Date(year < 100 ? 2000 + year : year, month, day);
      }
      return new Date();
    };
    
    startDate = parseDate(slots.date_range.start);
    endDate = parseDate(slots.date_range.end);
  } else if (slots.start_date && slots.end_date) {
    startDate = new Date(slots.start_date);
    endDate = new Date(slots.end_date);
  }
  
  console.log(`📍 [CONTEXT] Criando: ${label} de ${startDate.toISOString()} até ${endDate.toISOString()}`);
  
  const { data: context, error } = await supabase.from("user_contexts").insert({
    user_id: userId,
    label,
    description,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    status: "active",
    auto_tag: true
  }).select("id").single();
  
  if (error) {
    console.error("❌ [CONTEXT] Erro:", error);
    return { success: false, message: "Não consegui criar o contexto 😕" };
  }
  
  const startFormatted = startDate.toLocaleDateString("pt-BR");
  const endFormatted = endDate.toLocaleDateString("pt-BR");
  const diasRestantes = Math.ceil((endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    success: true,
    contextId: context.id,
    message: `📍 *Modo Contexto Ativado!*\n\n🏷️ *${label}*\n📅 ${startFormatted} até ${endFormatted}\n⏰ ${diasRestantes} dias\n\n✅ _Todos os seus gastos serão marcados como parte de "${label}" automaticamente!_\n\n_Quando terminar, mande "terminei a viagem" ou "fim do evento"_`
  };
}

async function closeUserContext(userId: string): Promise<{ success: boolean; message: string }> {
  const activeContext = await getActiveContext(userId);
  
  if (!activeContext) {
    return { success: false, message: "Você não tem nenhum evento ativo no momento 🤔" };
  }
  
  await supabase.from("user_contexts").update({ 
    status: "completed",
    end_date: new Date().toISOString()
  }).eq("id", activeContext.id);
  
  return {
    success: true,
    message: `✅ *Evento "${activeContext.label}" encerrado!*\n\n📊 Total gasto: R$ ${(activeContext.total_spent || 0).toFixed(2)}\n🧾 ${activeContext.transaction_count || 0} transações\n\n_Voltando ao modo normal!_`
  };
}

// Função para vincular transação a contexto ativo (interceptador)
async function linkTransactionToContext(userId: string, transactionId: string): Promise<void> {
  const activeContext = await getActiveContext(userId);
  
  if (activeContext && activeContext.auto_tag) {
    await supabase.from("transacoes").update({ context_id: activeContext.id }).eq("id", transactionId);
    console.log(`📍 [CONTEXT] Transação ${transactionId.slice(-8)} vinculada ao contexto ${activeContext.label}`);
  }
}

// ============================================================================
// 🔄 PROCESSAMENTO PRINCIPAL
// ============================================================================

async function processarJob(job: any): Promise<void> {
  const payload: JobPayload = job.payload;
  const userId = job.user_id;
  const eventoId = payload.evento_id;
  
  console.log(`\n🔄 [WORKER] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📩 [WORKER] Job ${job.id?.slice(-8)} | ${payload.messageType} | User: ${userId?.slice(0, 8)}`);
  console.log(`💬 [WORKER] Msg: "${payload.messageText?.slice(0, 50)}${payload.messageText?.length > 50 ? '...' : ''}"`);
  
  try {
    // Buscar usuário
    const { data: usuario } = await supabase.from("usuarios").select("*").eq("id", userId).single();
    const nomeUsuario = usuario?.nome || "amigo(a)";
    
    // Verificar novo usuário (onboarding)
    const { count: historicoCount } = await supabase
      .from("historico_conversas")
      .select("id", { count: "exact", head: true })
      .eq("phone_number", payload.phoneNumber);
    
    if ((historicoCount || 0) === 0) {
      console.log(`🎉 [WORKER] Novo usuário: ${payload.phoneNumber}`);
      await sendMessage(payload.phoneNumber, `Oi, ${nomeUsuario.split(" ")[0]}! 👋\n\nSou o *Finax* — seu assistente financeiro.\n\nPode me mandar gastos por texto, áudio ou foto.\n\nPra começar, me conta: quanto você costuma ganhar por mês? 💰`, payload.messageSource);
      await supabase.from("historico_conversas").insert({ phone_number: payload.phoneNumber, user_id: userId, user_message: payload.messageText || "[MÍDIA]", ai_response: "[ONBOARDING]", tipo: "onboarding" });
      return;
    }
    
    // ========================================================================
    // 🎯 BUSCAR CONTEXTO ATIVO
    // ========================================================================
    const activeAction = await getActiveAction(userId);
    
    logDecision({ messageId: payload.messageId, decision: "start", details: { hasContext: !!activeAction, contextType: activeAction?.intent } });
    
    // ========================================================================
    // 🔘 PRIORIDADE 1: CALLBACK DE BOTÃO
    // ========================================================================
    if (payload.buttonReplyId) {
      console.log(`🔘 [BUTTON] Callback: ${payload.buttonReplyId}`);
      
      // FORMA DE PAGAMENTO
      if (payload.buttonReplyId.startsWith("pay_")) {
        const paymentMethod = PAYMENT_ALIASES[payload.buttonReplyId];
        if (paymentMethod && activeAction && activeAction.intent === "expense") {
          const updatedSlots = { ...activeAction.slots, payment_method: paymentMethod };
          const missing = getMissingSlots("expense", updatedSlots);
          
          if (missing.length === 0) {
            const result = await registerExpense(userId, updatedSlots, activeAction.id);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
            return;
          }
          
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
          const prompt = SLOT_PROMPTS[missing[0]];
          if (prompt?.useButtons && prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
          }
          return;
        }
      }
      
      // SOURCE DE ENTRADA
      if (payload.buttonReplyId.startsWith("src_")) {
        const source = SOURCE_ALIASES[payload.buttonReplyId];
        if (source && activeAction && activeAction.intent === "income") {
          const updatedSlots: ExtractedSlots = { ...activeAction.slots, source };
          
          if (!updatedSlots.amount) {
            await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "amount" });
            await sendMessage(payload.phoneNumber, SLOT_PROMPTS.amount_income.text, payload.messageSource);
            return;
          }
          
          const result = await registerIncome(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
      
      // NÚMERO ISOLADO - GASTO
      if (payload.buttonReplyId === "num_gasto" && activeAction?.slots?.amount) {
        await closeAction(activeAction.id);
        await createAction(userId, "expense", "expense", { amount: activeAction.slots.amount }, "payment_method", payload.messageId);
        await sendButtons(payload.phoneNumber, "Como você pagou?", SLOT_PROMPTS.payment_method.buttons!, payload.messageSource);
        return;
      }
      
      // NÚMERO ISOLADO - ENTRADA
      if (payload.buttonReplyId === "num_entrada" && activeAction?.slots?.amount) {
        await closeAction(activeAction.id);
        await createAction(userId, "income", "income", { amount: activeAction.slots.amount }, "source", payload.messageId);
        await sendButtons(payload.phoneNumber, "Como você recebeu?", SLOT_PROMPTS.source.buttons!, payload.messageSource);
        return;
      }
      
      // CONFIRMAR CANCELAMENTO
      if (payload.buttonReplyId === "cancel_confirm_yes" && activeAction?.slots?.transaction_id) {
        const result = await cancelTransaction(userId, activeAction.slots.transaction_id);
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      if (payload.buttonReplyId === "cancel_confirm_no") {
        if (activeAction) await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, "Ok, mantido! 👍", payload.messageSource);
        return;
      }
    }
    
    // ========================================================================
    // 📷 PROCESSAR MÍDIA (AUDIO/IMAGEM)
    // ========================================================================
    let conteudoProcessado = payload.messageText;
    
    if (payload.messageType === "audio" && payload.mediaId) {
      const audioBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      if (!audioBase64) {
        await sendMessage(payload.phoneNumber, "Não peguei o áudio 🎤\n\n👉 Pode escrever?", payload.messageSource);
        return;
      }
      const transcricao = await transcreverAudio(audioBase64);
      if (!transcricao.texto) {
        await sendMessage(payload.phoneNumber, "Não entendi o áudio 🎤\n\n👉 Pode escrever?", payload.messageSource);
        return;
      }
      conteudoProcessado = transcricao.texto;
    }
    
    // ========================================================================
    // 🧠 DECISION ENGINE PRIMEIRO - CLASSIFICAÇÃO UNIFICADA
    // ========================================================================
    // REGRA ABSOLUTA: A IA analisa a mensagem PRIMEIRO, antes de qualquer
    // verificação de número. Se a IA identificar intenção, números NÃO invalidam.
    // ========================================================================
    
    // Buscar histórico para contexto da IA
    const { data: historico } = await supabase
      .from("historico_conversas")
      .select("user_message, ai_response")
      .eq("phone_number", payload.phoneNumber)
      .order("created_at", { ascending: false })
      .limit(3);
    
    const historicoFormatado = historico?.map(h => `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 80)}...`).reverse().join("\n") || "";
    
    // 🔒 DECISION ENGINE - Única fonte de verdade
    const { result: decision, shouldBlockLegacyFlow } = await decisionEngine(
      conteudoProcessado,
      activeAction,
      historicoFormatado
    );
    
    logDecision({ 
      messageId: payload.messageId, 
      decision: "classified", 
      details: { 
        type: decision.actionType, 
        conf: decision.confidence, 
        slots: decision.slots,
        canExec: decision.canExecuteDirectly,
        blocked: shouldBlockLegacyFlow
      } 
    });
    
    // ========================================================================
    // 🚫 GUARD CLAUSE DE DOMÍNIO + AUTO-DESCARTE
    // ========================================================================
    const domainCheck = assertDomainIsolation(decision.actionType, activeAction);
    if (domainCheck.shouldDiscard) {
      await cancelAction(userId);
    }
    
    // ========================================================================
    // 🎯 ROTEAMENTO POR TIPO DE AÇÃO
    // ========================================================================
    
    // ========================================================================
    // 💰 INCOME - Contrato: required = ["amount"]
    // ========================================================================
    if (decision.actionType === "income") {
      const slots = decision.slots;
      const missing = getMissingSlots("income", slots);
      
      // ✅ EXECUÇÃO DIRETA: hasAllRequiredSlots = true
      if (hasAllRequiredSlots("income", slots)) {
        console.log(`⚡ [INCOME] Execução direta: R$ ${slots.amount}`);
        const actionId = activeAction?.intent === "income" ? activeAction.id : undefined;
        const result = await registerIncome(userId, slots, actionId);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO → perguntar APENAS o que falta
      const nextMissing = missing[0]; // Só pergunta UM por vez
      
      if (activeAction?.intent === "income") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "income", "income", slots, nextMissing, payload.messageId);
      }
      
      // Usar prompt específico para income
      const promptKey = nextMissing === "amount" ? "amount_income" : nextMissing;
      const prompt = SLOT_PROMPTS[promptKey] || SLOT_PROMPTS[nextMissing];
      
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, prompt?.text || `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💸 EXPENSE - Contrato: required = ["amount", "payment_method"]
    // ========================================================================
    if (decision.actionType === "expense") {
      const slots = decision.slots;
      const missing = getMissingSlots("expense", slots);
      
      // ✅ EXECUÇÃO DIRETA: hasAllRequiredSlots = true
      if (hasAllRequiredSlots("expense", slots)) {
        console.log(`⚡ [EXPENSE] Execução direta: R$ ${slots.amount} via ${slots.payment_method}`);
        const actionId = activeAction?.intent === "expense" ? activeAction.id : undefined;
        const result = await registerExpense(userId, slots, actionId);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO → perguntar APENAS o que falta
      const nextMissing = missing[0]; // Só pergunta UM por vez
      
      if (activeAction?.intent === "expense") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "expense", "expense", slots, nextMissing, payload.messageId);
      }
      
      const prompt = SLOT_PROMPTS[nextMissing];
      
      // Contexto amigável com valor se já temos
      const prefix = slots.amount ? `💸 R$ ${slots.amount.toFixed(2)}\n\n` : "";
      
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `${prefix}${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `${prefix}${prompt?.text || `Qual o ${nextMissing}?`}`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💳 CARD EVENT - Contrato: required = ["card", "value"]
    // ========================================================================
    // REGRA ABSOLUTA: card_event NUNCA entra em fluxo de expense/income
    // ========================================================================
    if (decision.actionType === "card_event") {
      const slots = decision.slots;
      
      // ✅ EXECUÇÃO DIRETA: hasAllRequiredSlots = true
      if (hasAllRequiredSlots("card_event", slots)) {
        const result = await updateCardLimit(userId, slots.card!, slots.value!);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const missing = getMissingSlots("card_event", slots);
      
      // Se falta cartão, listar opções
      if (missing.includes("card")) {
        const cards = await listCardsForUser(userId);
        if (cards.length === 0) {
          await sendMessage(payload.phoneNumber, "Você não tem cartões cadastrados 💳", payload.messageSource);
          return;
        }
        const cardList = cards.map((c, i) => `${i + 1}. ${c.nome}`).join("\n");
        await sendMessage(payload.phoneNumber, `Qual cartão atualizar?\n\n${cardList}`, payload.messageSource);
        return;
      }
      
      // Se falta valor
      if (missing.includes("value")) {
        await sendMessage(payload.phoneNumber, `Qual o novo limite do *${slots.card}*?`, payload.messageSource);
        return;
      }
      
      return;
    }
    
    // ========================================================================
    // 🔄 RECURRING - Gastos Recorrentes
    // ========================================================================
    if (decision.actionType === "recurring") {
      const slots = decision.slots;
      const missing = getMissingSlots("recurring", slots);
      
      // ✅ EXECUÇÃO DIRETA: tem amount e description
      if (hasAllRequiredSlots("recurring", slots)) {
        console.log(`🔄 [RECURRING] Execução direta: R$ ${slots.amount} - ${slots.description}`);
        const actionId = activeAction?.intent === "recurring" ? activeAction.id : undefined;
        const result = await registerRecurring(userId, slots, actionId);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const nextMissing = missing[0];
      
      if (activeAction?.intent === "recurring") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "recurring", "recurring", slots, nextMissing, payload.messageId);
      }
      
      // Perguntas específicas para recorrente
      if (nextMissing === "amount") {
        await sendMessage(payload.phoneNumber, "Qual o valor mensal? 💸", payload.messageSource);
      } else if (nextMissing === "description") {
        await sendMessage(payload.phoneNumber, "Qual gasto é esse? (ex: Netflix, Aluguel, Academia...)", payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 📍 SET_CONTEXT - Viagens/Eventos
    // ========================================================================
    if (decision.actionType === "set_context") {
      const slots = decision.slots;
      
      // Verificar se é encerramento de contexto
      const normalized = normalizeText(conteudoProcessado);
      if (normalized.includes("terminei") || normalized.includes("fim do") || normalized.includes("acabou") || normalized.includes("encerr")) {
        const result = await closeUserContext(userId);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // Criar novo contexto
      const result = await createUserContext(userId, slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // 🗑️ CANCEL
    if (decision.actionType === "cancel") {
      const txs = await listTransactionsForCancel(userId);
      
      if (txs.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem transações para cancelar 🤔", payload.messageSource);
        return;
      }
      
      const lista = txs.map((t, i) => `${i + 1}. R$ ${t.valor?.toFixed(2)} - ${t.descricao || t.categoria}`).join("\n");
      await sendMessage(payload.phoneNumber, `Qual transação cancelar?\n\n${lista}\n\n_Responde com o número_`, payload.messageSource);
      return;
    }
    
    // 📊 QUERY
    if (decision.actionType === "query") {
      const summary = await getMonthlySummary(userId);
      await sendMessage(payload.phoneNumber, summary, payload.messageSource);
      return;
    }
    
    // 🎮 CONTROL (saudação, ajuda, negação)
    if (decision.actionType === "control") {
      const normalized = normalizeText(conteudoProcessado);
      
      if (normalized.includes("cancela") || normalized.includes("deixa") || normalized.includes("nao")) {
        const cancelled = await cancelAction(userId);
        await sendMessage(payload.phoneNumber, cancelled ? "Ok, descartei! 👍" : "Não tinha nada pendente 🤔", payload.messageSource);
        return;
      }
      
      if (normalized.includes("ajuda") || normalized.includes("help")) {
        await sendMessage(payload.phoneNumber, `*Como usar o Finax* 📊\n\n💸 *Registrar gasto:*\n"Gastei 50 no mercado"\n\n💰 *Registrar entrada:*\n"Recebi 200 de pix"\n\n📊 *Ver resumo:*\n"Quanto gastei?"`, payload.messageSource);
        return;
      }
      
      // Saudação
      const primeiroNome = nomeUsuario.split(" ")[0];
      await sendMessage(payload.phoneNumber, `Oi, ${primeiroNome}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🔢 FALLBACK: NÚMERO ISOLADO (só chega aqui se Decision Engine disse "unknown")
    // ========================================================================
    // Este é o "fundo do poço" da lógica. SÓ pergunta "gasto ou entrada?"
    // quando a IA NÃO conseguiu classificar a intenção.
    // ========================================================================
    if (decision.actionType === "unknown" && isNumericOnly(conteudoProcessado)) {
      const numValue = parseNumericValue(conteudoProcessado);
      
      logDecision({ messageId: payload.messageId, decision: "numeric_fallback", details: { value: numValue } });
      
      // CASO 1: Há contexto ativo esperando amount → preencher slot
      if (activeAction && activeAction.pending_slot === "amount" && numValue) {
        const updatedSlots: ExtractedSlots = { ...activeAction.slots, amount: numValue };
        const actionType = activeAction.intent === "income" ? "income" : activeAction.intent === "expense" ? "expense" : null;
        
        if (actionType) {
          const missing = getMissingSlots(actionType as ActionType, updatedSlots);
          
          // Todos slots preenchidos → executar
          if (hasAllRequiredSlots(actionType as ActionType, updatedSlots)) {
            const result = actionType === "income" 
              ? await registerIncome(userId, updatedSlots, activeAction.id)
              : await registerExpense(userId, updatedSlots, activeAction.id);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
            return;
          }
          
          // Falta slot → perguntar APENAS o próximo obrigatório
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
          const prompt = SLOT_PROMPTS[missing[0]];
          if (prompt?.useButtons && prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
          }
          return;
        }
      }
      
      // CASO 2: Número SEM contexto → PERGUNTAR
      await sendButtons(payload.phoneNumber, `💰 R$ ${numValue?.toFixed(2)}\n\nEsse valor foi um gasto ou uma entrada?`, [
        { id: "num_gasto", title: "💸 Gasto" },
        { id: "num_entrada", title: "💰 Entrada" }
      ], payload.messageSource);
      
      if (activeAction) {
        await cancelAction(userId);
      }
      
      await createAction(userId, "unknown", "numero_isolado", { amount: numValue }, "type_choice", payload.messageId);
      return;
    }
    
    // ❓ UNKNOWN / FALLBACK GENÉRICO
    if (activeAction && activeAction.pending_slot) {
      // Re-perguntar o slot pendente
      const prompt = SLOT_PROMPTS[activeAction.pending_slot];
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `Não entendi 🤔\n\n${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `Não entendi 🤔\n\n${prompt?.text || "Continue..."}`, payload.messageSource);
      }
      return;
    }
    
    await sendMessage(payload.phoneNumber, `Não entendi 🤔\n\nPode me dizer:\n• Um gasto (ex: "café 8 reais pix")\n• Uma entrada (ex: "recebi 200")\n• "Resumo" pra ver seus gastos`, payload.messageSource);
    
  } catch (error) {
    console.error("❌ [WORKER] Erro:", error);
    await sendMessage(payload.phoneNumber, "Ops, algo deu errado 😕\n\nTenta de novo?", payload.messageSource);
  }
}

// ============================================================================
// 🚀 SERVE
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { data: jobs, error } = await supabase
      .from("webhook_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) {
      console.error("Erro ao buscar jobs:", error);
      return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`📋 [WORKER] ${jobs.length} job(s) para processar`);

    const jobIds = jobs.map(j => j.id);
    await supabase.from("webhook_jobs").update({ status: "processing" }).in("id", jobIds);

    for (const job of jobs) {
      try {
        await processarJob(job);
        await supabase.from("webhook_jobs").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", job.id);
      } catch (jobError) {
        console.error(`❌ [JOB ${job.id}] Erro:`, jobError);
        await supabase.from("webhook_jobs").update({ status: "error", last_error: String(jobError), attempts: (job.attempts || 0) + 1 }).eq("id", job.id);
      }
    }

    return new Response(JSON.stringify({ processed: jobs.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Erro geral:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
