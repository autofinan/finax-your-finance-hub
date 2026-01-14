// ============================================================================
// ⚡ CLASSIFICADOR DETERMINÍSTICO - ETAPA 1 DO PROTOCOLO COGNITIVO
// ============================================================================
//
// Este classificador aplica REGRAS DETERMINÍSTICAS antes de qualquer IA.
// Objetivo: Resolver 80% dos casos comuns sem usar tokens de IA.
//
// PADRÕES UNIVERSAIS:
// - "[texto] [número]" → SEMPRE é gasto (ex: "dentista 360")
// - "[número] [texto]" → SEMPRE é gasto (ex: "360 dentista")
// - "[verbo entrada] [número]" → SEMPRE é entrada (ex: "recebi 200")
// - "[número] [contexto entrada]" → SEMPRE é entrada (ex: "200 salário")
//
// REGRA DE OURO: Se o padrão bate, confidence = 1.0 (determinístico!)
// ============================================================================

import type { ActionType, ExtractedSlots } from "./types.ts";

export interface DeterministicResult {
  actionType: ActionType;
  confidence: number;
  slots: ExtractedSlots;
  source: "deterministic" | "needs_ai";
  reason: string;
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
// 🎯 KEYWORDS DE ENTRADA (para não confundir com gasto)
// ============================================================================

const INCOME_KEYWORDS = new Set([
  "recebi", "recebido", "receber", "ganhei", "ganho", 
  "caiu", "entrou", "entrada", "recebimento",
  "salario", "salário", "freelance", "pagamento recebido",
  "pix recebido", "transferencia recebida", "bônus", "bonus",
  "comissao", "comissão", "presente", "reembolso"
]);

const INCOME_DESCRIPTION_KEYWORDS = new Set([
  "salario", "salário", "freelance", "trabalho", "emprego",
  "bonus", "bônus", "comissao", "comissão", "presente",
  "reembolso", "venda", "vendas", "cliente", "projeto"
]);

// ============================================================================
// 🎯 KEYWORDS DE RECORRÊNCIA
// ============================================================================

const RECURRING_KEYWORDS = [
  "todo mes", "todo mês", "mensal", "mensalmente",
  "todo dia", "semanal", "semanalmente", 
  "anual", "anualmente", "assinatura",
  "por mes", "por mês", "ao mes", "ao mês",
  "cada mes", "cada mês", "cobrado mensal"
];

// ============================================================================
// 🎯 KEYWORDS DE CONTROLE (não são transações)
// ============================================================================

const CONTROL_KEYWORDS = [
  "oi", "olá", "ola", "bom dia", "boa tarde", "boa noite",
  "ajuda", "help", "como funciona", "o que voce faz"
];

// ============================================================================
// 🎯 KEYWORDS DE CONSULTA
// ============================================================================

const QUERY_KEYWORDS = [
  "quanto gastei", "quanto tenho", "resumo", "saldo",
  "como estou", "como to", "como tou", "meu mes", "meu mês",
  "relatorio", "relatório", "total do mes", "total do mês"
];

// ============================================================================
// 🎯 KEYWORDS DE CANCELAMENTO
// ============================================================================

const CANCEL_KEYWORDS = [
  "cancela", "cancelar", "desfaz", "desfazer",
  "apaga", "apagar", "remove", "remover",
  "deixa pra la", "deixa pra lá", "esquece", "nao quero", "não quero"
];

// ============================================================================
// ⚡ FUNÇÃO PRINCIPAL: CLASSIFICAR DETERMINISTICAMENTE
// ============================================================================

export function classifyDeterministic(message: string): DeterministicResult {
  const original = message.trim();
  const normalized = normalizeText(message);
  
  // 1. CONTROLE (saudações, ajuda) - sem número
  for (const keyword of CONTROL_KEYWORDS) {
    if (normalized === keyword || normalized.startsWith(keyword + " ")) {
      return {
        actionType: "control",
        confidence: 0.95,
        slots: {},
        source: "deterministic",
        reason: `Controle detectado: "${keyword}"`
      };
    }
  }
  
  // 2. CONSULTA (resumo, saldo)
  for (const keyword of QUERY_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return {
        actionType: "query",
        confidence: 0.95,
        slots: {},
        source: "deterministic",
        reason: `Consulta detectada: "${keyword}"`
      };
    }
  }
  
  // 3. CANCELAMENTO
  for (const keyword of CANCEL_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return {
        actionType: "cancel",
        confidence: 0.95,
        slots: {},
        source: "deterministic",
        reason: `Cancelamento detectado: "${keyword}"`
      };
    }
  }
  
  // 4. VERIFICAR SE TEM KEYWORDS DE ENTRADA EXPLÍCITOS
  let isExplicitIncome = false;
  for (const keyword of INCOME_KEYWORDS) {
    if (normalized.includes(keyword)) {
      isExplicitIncome = true;
      break;
    }
  }
  
  // 5. VERIFICAR SE É RECORRENTE
  let isRecurring = false;
  for (const keyword of RECURRING_KEYWORDS) {
    if (normalized.includes(keyword)) {
      isRecurring = true;
      break;
    }
  }
  
  // ========================================================================
  // 🎯 PADRÃO UNIVERSAL DE GASTO/ENTRADA: [texto] + [número]
  // ========================================================================
  
  // ========================================================================
  // PADRÃO F: "[texto] [número] [contexto]" (ex: "dentista 360 no crédito nubank")
  // REGRA: Intenção DOMINANTE é sempre TRANSACIONAL, contexto adicional preenche slots
  // ========================================================================
  const patternWithContext = original.match(
    /^(.+?)\s+(\d+[.,]?\d*)(?:\s+(?:reais?|no?|na?|de|com|pelo|via)?\s*(.+))?$/i
  );
  
  if (patternWithContext) {
    const description = patternWithContext[1].trim();
    const amount = parseFloat(patternWithContext[2].replace(",", "."));
    const context = patternWithContext[3]?.trim() || null;
    const descNormalized = normalizeText(description);
    
    // Iniciar slots
    const slots: ExtractedSlots = { amount, description };
    
    // Verificar se é entrada pela descrição
    let isDescriptionIncome = false;
    for (const keyword of INCOME_DESCRIPTION_KEYWORDS) {
      if (descNormalized.includes(keyword)) {
        isDescriptionIncome = true;
        break;
      }
    }
    
    // ========================================================================
    // 🏦 EXTRAIR CONTEXTO ADICIONAL (cartão, método de pagamento)
    // ========================================================================
    if (context) {
      const ctxNorm = normalizeText(context);
      
      // Detectar método de pagamento
      if (ctxNorm.includes("pix")) slots.payment_method = "pix";
      else if (ctxNorm.includes("debito")) slots.payment_method = "debito";
      else if (ctxNorm.includes("credito") || ctxNorm.includes("cartao")) slots.payment_method = "credito";
      else if (ctxNorm.includes("dinheiro")) slots.payment_method = "dinheiro";
      
      // Detectar cartão (bancos/fintechs)
      const banks = ["nubank", "itau", "bradesco", "santander", "c6", "inter", "picpay", "banco do brasil", "caixa", "original", "next", "neon", "will", "xp"];
      for (const bank of banks) {
        if (ctxNorm.includes(bank)) {
          slots.card = bank;
          // Se mencionou cartão, provavelmente é crédito
          if (!slots.payment_method) slots.payment_method = "credito";
          break;
        }
      }
      
      console.log(`⚡ [CLASSIFIER] Contexto extraído: payment=${slots.payment_method}, card=${slots.card}`);
    }
    
    if (isExplicitIncome || isDescriptionIncome) {
      return {
        actionType: "income",
        confidence: 1.0,
        slots,
        source: "deterministic",
        reason: `Padrão entrada completo: "${description}" + ${amount}${context ? ` + ctx: "${context}"` : ""}`
      };
    }
    
    // Se é recorrente, marcar como recurring
    if (isRecurring) {
      return {
        actionType: "recurring",
        confidence: 1.0,
        slots,
        source: "deterministic",
        reason: `Padrão recorrente completo: "${description}" + ${amount}`
      };
    }
    
    // Default: é gasto
    return {
      actionType: "expense",
      confidence: 1.0,
      slots,
      source: "deterministic",
      reason: `Padrão gasto completo: "${description}" + ${amount}${context ? ` + ctx: "${context}"` : ""}`
    };
  }
  
  // PADRÃO B: "[número] [texto/contexto]" (ex: "360 dentista", "360 dentista pix nubank")
  const patternNumberTextContext = original.match(/^(\d+[.,]?\d*)\s+(.+)$/i);
  
  if (patternNumberTextContext) {
    const amount = parseFloat(patternNumberTextContext[1].replace(",", "."));
    const fullText = patternNumberTextContext[2].trim();
    const fullNormalized = normalizeText(fullText);
    
    // Tentar separar descrição de contexto (ex: "dentista pix nubank" → desc="dentista", ctx="pix nubank")
    const slots: ExtractedSlots = { amount };
    
    // Detectar método de pagamento e extrair
    let description = fullText;
    if (fullNormalized.includes("pix")) {
      slots.payment_method = "pix";
      description = description.replace(/\b(no?\s+)?pix\b/gi, "").trim();
    } else if (fullNormalized.includes("debito")) {
      slots.payment_method = "debito";
      description = description.replace(/\b(no?\s+)?d[eé]bito\b/gi, "").trim();
    } else if (fullNormalized.includes("credito") || fullNormalized.includes("cartao")) {
      slots.payment_method = "credito";
      description = description.replace(/\b(no?\s+)?cr[eé]dito\b/gi, "").replace(/\b(no?\s+)?cart[aã]o\b/gi, "").trim();
    } else if (fullNormalized.includes("dinheiro")) {
      slots.payment_method = "dinheiro";
      description = description.replace(/\b(em\s+)?dinheiro\b/gi, "").trim();
    }
    
    // Detectar cartão
    const banks = ["nubank", "itau", "bradesco", "santander", "c6", "inter", "picpay", "banco do brasil", "caixa", "original", "next", "neon", "will", "xp"];
    for (const bank of banks) {
      if (fullNormalized.includes(bank)) {
        slots.card = bank;
        if (!slots.payment_method) slots.payment_method = "credito";
        description = description.replace(new RegExp(`\\b(no?\\s+)?${bank}\\b`, "gi"), "").trim();
        break;
      }
    }
    
    // Limpar descrição final
    slots.description = description
      .replace(/\b(no|na|de|com|pelo|via)\b\s*$/gi, "")
      .trim() || fullText;
    
    const descNormalized = normalizeText(slots.description);
    
    // Verificar se é entrada pela descrição
    let isDescriptionIncome = false;
    for (const keyword of INCOME_DESCRIPTION_KEYWORDS) {
      if (descNormalized.includes(keyword)) {
        isDescriptionIncome = true;
        break;
      }
    }
    
    if (isExplicitIncome || isDescriptionIncome) {
      return {
        actionType: "income",
        confidence: 1.0,
        slots,
        source: "deterministic",
        reason: `Padrão entrada: ${amount} + "${slots.description}"${slots.payment_method ? ` (${slots.payment_method})` : ""}`
      };
    }
    
    // Se é recorrente, marcar como recurring
    if (isRecurring) {
      return {
        actionType: "recurring",
        confidence: 1.0,
        slots,
        source: "deterministic",
        reason: `Padrão recorrente: ${amount} + "${slots.description}"`
      };
    }
    
    // Default: é gasto
    return {
      actionType: "expense",
      confidence: 1.0,
      slots,
      source: "deterministic",
      reason: `Padrão gasto: ${amount} + "${slots.description}"${slots.payment_method ? ` (${slots.payment_method})` : ""}`
    };
  }
  
  // PADRÃO C: Verbo de entrada + número (ex: "recebi 200", "caiu 500")
  const incomeVerbPattern = original.match(/^(recebi|ganhei|caiu|entrou|entrada)\s+(\d+[.,]?\d*)(?:\s+(.+))?$/i);
  
  if (incomeVerbPattern) {
    const amount = parseFloat(incomeVerbPattern[2].replace(",", "."));
    const description = incomeVerbPattern[3]?.trim() || null;
    
    return {
      actionType: "income",
      confidence: 1.0,
      slots: { 
        amount, 
        ...(description && { description }) 
      },
      source: "deterministic",
      reason: `Entrada explícita: ${incomeVerbPattern[1]} + ${amount}`
    };
  }
  
  // PADRÃO D: Verbo de gasto + número (ex: "gastei 50", "paguei 100")
  const expenseVerbPattern = original.match(/^(gastei|comprei|paguei|custou)\s+(\d+[.,]?\d*)(?:\s+(.+))?$/i);
  
  if (expenseVerbPattern) {
    const amount = parseFloat(expenseVerbPattern[2].replace(",", "."));
    const rest = expenseVerbPattern[3]?.trim() || null;
    
    // Extrair descrição e método de pagamento do "resto"
    let description: string | null = null;
    let payment_method: "pix" | "dinheiro" | "debito" | "credito" | null = null;
    
    if (rest) {
      const restNormalized = normalizeText(rest);
      
      // Detectar método de pagamento
      if (restNormalized.includes("pix")) payment_method = "pix";
      else if (restNormalized.includes("debito")) payment_method = "debito";
      else if (restNormalized.includes("credito")) payment_method = "credito";
      else if (restNormalized.includes("dinheiro")) payment_method = "dinheiro";
      
      // Extrair descrição (remover palavras de pagamento)
      description = rest
        .replace(/\b(no?|na?|com|pix|debito|débito|credito|crédito|dinheiro|cartao|cartão)\b/gi, "")
        .trim() || null;
    }
    
    const slots: ExtractedSlots = { amount };
    if (description) slots.description = description;
    if (payment_method) slots.payment_method = payment_method;
    
    return {
      actionType: "expense",
      confidence: 1.0,
      slots,
      source: "deterministic",
      reason: `Gasto explícito: ${expenseVerbPattern[1]} + ${amount}`
    };
  }
  
  // PADRÃO E: Número isolado (ex: "100", "50,00")
  if (/^[\d.,]+$/.test(original.trim())) {
    const amount = parseFloat(original.replace(",", "."));
    if (!isNaN(amount) && amount > 0) {
      return {
        actionType: "unknown",
        confidence: 0.5,
        slots: { amount },
        source: "deterministic",
        reason: `Número isolado: ${amount} (precisa pergunta)`
      };
    }
  }
  
  // ========================================================================
  // PADRÃO G: PALAVRA SOLTA (possível descrição de gasto)
  // Ex: "Dentista", "Mercado", "Uber" (sem número)
  // → Guardar como possible_description e perguntar clarificação
  // ========================================================================
  
  // Limpar e verificar se é palavra solta (2-30 chars, sem números)
  const singleWordPattern = original.match(/^([A-Za-zÀ-ú\s]{2,30})$/i);
  
  if (singleWordPattern) {
    const possibleDesc = singleWordPattern[1].trim();
    const descNormalized = normalizeText(possibleDesc);
    
    // Verificar se NÃO é saudação/controle
    const isControl = CONTROL_KEYWORDS.some(k => descNormalized === k || descNormalized.startsWith(k + " "));
    
    // Verificar se NÃO é query
    const isQuery = QUERY_KEYWORDS.some(k => descNormalized.includes(k));
    
    // Se não é controle nem query, é possível descrição de gasto
    if (!isControl && !isQuery && possibleDesc.length >= 2) {
      console.log(`⚡ [CLASSIFIER] Palavra solta detectada: "${possibleDesc}" → precisa clarificação`);
      
      return {
        actionType: "unknown",
        confidence: 0.4,
        slots: { possible_description: possibleDesc },
        source: "deterministic",
        reason: `Palavra solta detectada: "${possibleDesc}" → perguntar se é gasto ou consulta`
      };
    }
  }
  
  // ========================================================================
  // 🤖 NÃO CONSEGUIU CLASSIFICAR → PRECISA DE IA
  // ========================================================================
  
  return {
    actionType: "unknown",
    confidence: 0.3,
    slots: {},
    source: "needs_ai",
    reason: "Não conseguiu classificar deterministicamente"
  };
}

// ============================================================================
// 🧹 LIMPAR DESCRIÇÃO (remover palavras comuns)
// ============================================================================

export function cleanDescription(description: string): string {
  const stopWords = [
    "no", "na", "de", "do", "da", "com", "em", "para", "pra",
    "hoje", "ontem", "agora", "aqui"
  ];
  
  let cleaned = description.toLowerCase();
  for (const word of stopWords) {
    cleaned = cleaned.replace(new RegExp(`^${word}\\s+`, "i"), "");
  }
  
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
