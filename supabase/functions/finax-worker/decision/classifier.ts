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
  
  // PADRÃO A: "[texto] [número]" (ex: "dentista 360", "mercado 150")
  const patternTextNumber = original.match(/^(.+?)\s+(\d+[.,]?\d*)(?:\s*(?:reais?)?)?$/i);
  
  if (patternTextNumber) {
    const description = patternTextNumber[1].trim();
    const amount = parseFloat(patternTextNumber[2].replace(",", "."));
    const descNormalized = normalizeText(description);
    
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
        slots: { amount, description },
        source: "deterministic",
        reason: `Padrão entrada: "${description}" + ${amount}`
      };
    }
    
    // Se é recorrente, marcar como recurring
    if (isRecurring) {
      return {
        actionType: "recurring",
        confidence: 1.0,
        slots: { amount, description },
        source: "deterministic",
        reason: `Padrão recorrente: "${description}" + ${amount}`
      };
    }
    
    // Default: é gasto
    return {
      actionType: "expense",
      confidence: 1.0,
      slots: { amount, description },
      source: "deterministic",
      reason: `Padrão gasto: "${description}" + ${amount}`
    };
  }
  
  // PADRÃO B: "[número] [texto]" (ex: "360 dentista", "150 mercado")
  const patternNumberText = original.match(/^(\d+[.,]?\d*)\s+(.+)$/i);
  
  if (patternNumberText) {
    const amount = parseFloat(patternNumberText[1].replace(",", "."));
    const description = patternNumberText[2].trim();
    const descNormalized = normalizeText(description);
    
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
        slots: { amount, description },
        source: "deterministic",
        reason: `Padrão entrada: ${amount} + "${description}"`
      };
    }
    
    // Se é recorrente, marcar como recurring
    if (isRecurring) {
      return {
        actionType: "recurring",
        confidence: 1.0,
        slots: { amount, description },
        source: "deterministic",
        reason: `Padrão recorrente: ${amount} + "${description}"`
      };
    }
    
    // Default: é gasto
    return {
      actionType: "expense",
      confidence: 1.0,
      slots: { amount, description },
      source: "deterministic",
      reason: `Padrão gasto: ${amount} + "${description}"`
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
