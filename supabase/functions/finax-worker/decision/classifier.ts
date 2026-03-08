// ============================================================================
// ⚡ FAST-TRACK ESTRUTURAL - PADRÕES NUMÉRICOS UNIVERSAIS
// ============================================================================
//
// Este módulo detecta APENAS padrões ESTRUTURAIS óbvios:
// - "[texto] [número]" → provavelmente transação
// - "[número] [texto]" → provavelmente transação  
// - "[número isolado]" → precisa perguntar
//
// NÃO TENTA interpretar semântica (gasto vs entrada vs cartão).
// A IA faz isso.
//
// OBJETIVO: Extrair slots numéricos rapidamente, sem gastar tokens de IA.
// ============================================================================

import type { ActionType, ExtractedSlots } from "./types.ts";

export interface FastTrackResult {
  hasStructure: boolean;          // Detectou padrão estrutural?
  slots: ExtractedSlots;          // Slots extraídos (amount, description, payment_method, card)
  needsAI: boolean;               // Precisa de IA para classificar intent?
  suggestedAction?: ActionType;   // Sugestão (só para casos óbvios como "cancela")
  confidence: number;             // Confiança na extração
  reason: string;                 // Explicação
}

// ============================================================================
// 🔤 NORMALIZAÇÃO
// ============================================================================

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// ============================================================================
// 💳 BANCOS/CARTÕES (para extração, não classificação)
// ============================================================================

const KNOWN_BANKS = [
  "nubank", "itau", "itaú", "bradesco", "santander", "c6", "inter", 
  "picpay", "next", "neon", "will", "xp", "banco do brasil", "caixa", "original"
];

// ============================================================================
// 💰 MÉTODOS DE PAGAMENTO (para extração, não classificação)
// ============================================================================

const PAYMENT_PATTERNS: Record<string, string> = {
  "pix": "pix",
  "debito": "debito",
  "débito": "debito",
  "credito": "credito",
  "crédito": "credito",
  "cartao": "credito",
  "cartão": "credito",
  "dinheiro": "dinheiro",
  "cash": "dinheiro",
  "especie": "dinheiro",
  "espécie": "dinheiro"
};

// ============================================================================
// 🚫 COMANDOS IMEDIATOS (não precisam de IA)
// ============================================================================

const CANCEL_TERMS = [
  "cancela", "cancelar", "desfaz", "desfazer", "apaga", "apagar",
  "remove", "remover", "deixa pra la", "deixa pra lá", "esquece", 
  "nao quero", "não quero"
];

// ============================================================================
// 💳 PADRÕES DE ADICIONAR CARTÃO (classificação determinística)
// ============================================================================

const ADD_CARD_PATTERNS = [
  /(?:adicionar|registrar|cadastrar|criar|novo)\s+cart[aã]o\s+(\w+)(?:\s+(?:limite|lim)\s+(\d+[.,]?\d*))?/i,
  /(?:meu\s+)?cart[aã]o\s+[eé]\s+(?:o\s+)?(\w+)(?:\s+(?:limite|lim)\s+(\d+[.,]?\d*))?/i,
  /cart[aã]o\s+(\w+)\s+(?:limite|lim)\s+(\d+[.,]?\d*)/i,
];

// ============================================================================
// 🚫 TERMOS QUE NUNCA SÃO GASTOS (proteger contra duplicata falsa)
// ============================================================================

const NON_EXPENSE_PREFIXES = [
  "me mande o", "me mande um", "me mande meu",
  "me envia o", "me envia um", "me envia meu",
  "manda o", "manda um", "manda meu",
  "envia o", "envia um",
  "quero ver", "quero saber",
  "relatorio", "relatório", "me manda o relatorio",
  "qual", "quais", "quanto", "como", "quando", "porque", "por que",
  "resumo", "saldo", "historico", "histórico", "extrato",
  "vou viajar", "viagem", "contexto", "evento", "vou estar",
  "bom dia", "boa tarde", "boa noite", "oi", "ola", "olá", "tudo bem",
  "ajuda", "help", "tutorial",
  "adicionar cartao", "adicionar cartão", "registrar cartao", "registrar cartão",
  "cadastrar cartao", "cadastrar cartão", "novo cartao", "novo cartão",
];

// ============================================================================
// ⚡ FUNÇÃO PRINCIPAL: EXTRAÇÃO ESTRUTURAL (NÃO CLASSIFICAÇÃO!)
// ============================================================================

export function fastTrackExtract(message: string): FastTrackResult {
  const original = message.trim();
  const normalized = normalizeText(message);
  
  // ========================================================================
  // CASO 0: ADICIONAR CARTÃO (classificação determinística - não precisa IA)
  // ========================================================================
  for (const pattern of ADD_CARD_PATTERNS) {
    const match = original.match(pattern);
    if (match) {
      const cardName = match[1];
      const limit = match[2] ? parseFloat(match[2].replace(",", ".")) : undefined;
      const slots: ExtractedSlots = { card_name: cardName };
      if (limit) slots.limit = limit;
      
      console.log(`⚡ [FAST-TRACK] Adicionar cartão detectado: ${cardName}${limit ? ` limite ${limit}` : ''}`);
      
      return {
        hasStructure: true,
        slots,
        needsAI: false,
        suggestedAction: "add_card" as ActionType,
        confidence: 0.98,
        reason: `Adicionar cartão: ${cardName}`
      };
    }
  }
  
  // ========================================================================
  // PROTEÇÃO: Verificar se começa com termos que NUNCA são gastos
  // ========================================================================
  for (const prefix of NON_EXPENSE_PREFIXES) {
    if (normalized.startsWith(prefix) || normalized.includes(prefix)) {
      return {
        hasStructure: false,
        slots: {},
        needsAI: true,
        confidence: 0.0,
        reason: `Termo não-gasto detectado: "${prefix}" → delegando para IA`
      };
    }
  }
  
  // ========================================================================
  // CASO 1: CANCELAMENTO (não precisa de IA)
  // ========================================================================
  for (const term of CANCEL_TERMS) {
    if (normalized.includes(term)) {
      return {
        hasStructure: true,
        slots: {},
        needsAI: false,
        suggestedAction: "cancel",
        confidence: 0.95,
        reason: `Cancelamento detectado: "${term}"`
      };
    }
  }
  
  // ========================================================================
  // CASO 2: NÚMERO ISOLADO (precisa perguntar gasto/entrada)
  // ========================================================================
  if (/^[\d.,]+$/.test(original.trim())) {
    const amount = parseFloat(original.replace(",", "."));
    if (!isNaN(amount) && amount > 0) {
      return {
        hasStructure: true,
        slots: { amount },
        needsAI: false,  // Não precisa IA, precisa pergunta ao usuário
        suggestedAction: "unknown",
        confidence: 0.5,
        reason: `Número isolado: ${amount} → perguntar tipo`
      };
    }
  }
  
  // ========================================================================
  // CASO 3: PADRÃO "[texto] [número] [contexto?]"
  // Ex: "dentista 360", "uber 50 pix", "mercado 180 nubank"
  // ========================================================================
  const patternTextFirst = original.match(
    /^(.+?)\s+(\d+[.,]?\d*)(?:\s+(?:reais?|no?|na?|de|com|pelo|via)?\s*(.+))?$/i
  );
  
  if (patternTextFirst) {
    const description = patternTextFirst[1].trim();
    const amount = parseFloat(patternTextFirst[2].replace(",", "."));
    const context = patternTextFirst[3]?.trim() || null;
    
    // Não classificar descrições muito curtas (1 letra) ou números
    if (description.length < 2 || /^\d+$/.test(description)) {
      // Fallback para próximo padrão
    } else {
      const slots: ExtractedSlots = { amount, description };
      
      // Extrair método de pagamento e cartão do contexto
      if (context) {
        const extracted = extractPaymentAndCard(context);
        if (extracted.payment_method) slots.payment_method = extracted.payment_method;
        if (extracted.card) slots.card = extracted.card;
      }
      
      // Também verificar na descrição original
      const fromDesc = extractPaymentAndCard(description);
      if (fromDesc.payment_method && !slots.payment_method) slots.payment_method = fromDesc.payment_method;
      if (fromDesc.card && !slots.card) slots.card = fromDesc.card;
      
      // Limpar descrição (remover termos de pagamento)
      slots.description = cleanDescription(description);
      
      console.log(`⚡ [FAST-TRACK] Padrão [texto][número]: desc="${slots.description}", amount=${amount}`);
      
      return {
        hasStructure: true,
        slots,
        needsAI: true,  // IA decide se é gasto, entrada, recorrente, etc.
        confidence: 0.9,
        reason: `Padrão estrutural: "${slots.description}" + ${amount}`
      };
    }
  }
  
  // ========================================================================
  // CASO 4: PADRÃO "[número] [texto] [contexto?]"
  // Ex: "360 dentista", "50 uber pix"
  // ========================================================================
  const patternNumberFirst = original.match(/^(\d+[.,]?\d*)\s+(.+)$/i);
  
  if (patternNumberFirst) {
    const amount = parseFloat(patternNumberFirst[1].replace(",", "."));
    const fullText = patternNumberFirst[2].trim();
    
    const slots: ExtractedSlots = { amount };
    
    // Extrair pagamento e cartão
    const extracted = extractPaymentAndCard(fullText);
    if (extracted.payment_method) slots.payment_method = extracted.payment_method;
    if (extracted.card) slots.card = extracted.card;
    
    // Descrição = texto sem termos de pagamento
    slots.description = cleanDescription(fullText);
    
    // Se sobrou descrição válida
    if (slots.description && slots.description.length >= 2) {
      console.log(`⚡ [FAST-TRACK] Padrão [número][texto]: amount=${amount}, desc="${slots.description}"`);
      
      return {
        hasStructure: true,
        slots,
        needsAI: true,
        confidence: 0.9,
        reason: `Padrão estrutural: ${amount} + "${slots.description}"`
      };
    }
  }
  
  // ========================================================================
  // CASO 5: TEXTO COM NÚMERO EMBUTIDO (ex: "gastei 50 no mercado")
  // Extrair número mesmo que precise de IA para classificar
  // ========================================================================
  const embeddedNumber = original.match(/(\d+[.,]?\d*)/);
  if (embeddedNumber) {
    const amount = parseFloat(embeddedNumber[1].replace(",", "."));
    if (!isNaN(amount) && amount > 0) {
      const slots: ExtractedSlots = { amount };
      
      // Extrair pagamento e cartão
      const extracted = extractPaymentAndCard(original);
      if (extracted.payment_method) slots.payment_method = extracted.payment_method;
      if (extracted.card) slots.card = extracted.card;
      
      console.log(`⚡ [FAST-TRACK] Número embutido: amount=${amount}`);
      
      return {
        hasStructure: true,
        slots,
        needsAI: true,
        confidence: 0.7,
        reason: `Número embutido no texto: ${amount}`
      };
    }
  }
  
  // ========================================================================
  // CASO 6: SEM ESTRUTURA NUMÉRICA → 100% IA
  // ========================================================================
  console.log(`⚡ [FAST-TRACK] Sem padrão estrutural → delegando para IA`);
  
  return {
    hasStructure: false,
    slots: {},
    needsAI: true,
    confidence: 0.0,
    reason: "Sem padrão numérico detectado"
  };
}

// ============================================================================
// 🔧 EXTRAÇÃO DE PAGAMENTO E CARTÃO
// ============================================================================

type PaymentMethod = "pix" | "debito" | "credito" | "dinheiro";

function extractPaymentAndCard(text: string): { payment_method?: PaymentMethod; card?: string } {
  const normalized = normalizeText(text);
  const result: { payment_method?: PaymentMethod; card?: string } = {};
  
  // Extrair método de pagamento
  for (const [term, method] of Object.entries(PAYMENT_PATTERNS)) {
    if (normalized.includes(term)) {
      result.payment_method = method as PaymentMethod;
      break;
    }
  }
  
  // Extrair cartão/banco
  for (const bank of KNOWN_BANKS) {
    if (normalized.includes(bank)) {
      result.card = bank;
      // Se mencionou banco e não tem método, assume crédito
      if (!result.payment_method) {
        result.payment_method = "credito";
      }
      break;
    }
  }
  
  return result;
}

// ============================================================================
// 🧹 LIMPAR DESCRIÇÃO
// ============================================================================

function cleanDescription(text: string): string {
  let cleaned = text;
  
  // Remover APENAS termos de pagamento e bancos (NÃO preposições comuns)
  // Preposições são parte natural de descrições como "café da manhã", "almoço no trabalho"
  const removeTerms = [
    "pix", "débito", "debito", "crédito", "credito", "cartão", "cartao",
    "dinheiro", "cash", "espécie", "especie",
    ...KNOWN_BANKS
  ];
  
  // Remover preposições SOMENTE se estão no FINAL e seguidas de banco/pagamento
  // Ex: "uber no nubank" → remover "no nubank", manter "café da manhã"
  for (const bank of KNOWN_BANKS) {
    cleaned = cleaned.replace(new RegExp(`\\s+(?:no|na|do|da|pelo|via)\\s+${bank}`, "gi"), "");
    cleaned = cleaned.replace(new RegExp(`\\b${bank}\\b`, "gi"), "");
  }
  
  for (const term of removeTerms) {
    if (!KNOWN_BANKS.includes(term)) {
      // Remover termos de pagamento somente como palavras isoladas no final ou início
      cleaned = cleaned.replace(new RegExp(`\\s+(?:no|na|via|pelo)?\\s*\\b${term}\\b\\s*$`, "gi"), "");
      cleaned = cleaned.replace(new RegExp(`^\\b${term}\\b\\s+`, "gi"), "");
    }
  }
  
  // Limpar espaços extras
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  
  // Capitalizar primeira letra
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

// ============================================================================
// EXPORT PARA COMPATIBILIDADE (manter import existente funcionando)
// ============================================================================

export function classifyDeterministic(message: string): {
  actionType: ActionType;
  confidence: number;
  slots: ExtractedSlots;
  source: "deterministic" | "needs_ai";
  reason: string;
} {
  const result = fastTrackExtract(message);
  
  return {
    actionType: result.suggestedAction || "unknown",
    confidence: result.confidence,
    slots: result.slots,
    source: result.needsAI ? "needs_ai" : "deterministic",
    reason: result.reason
  };
}
