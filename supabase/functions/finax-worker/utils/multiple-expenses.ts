// ============================================================================
// 💸 MULTIPLE EXPENSES DETECTOR - Detectar múltiplos gastos na mesma mensagem
// ============================================================================

import { parseBrazilianAmount } from "./parseAmount.ts";

export interface DetectedExpense {
  amount: number;
  description: string;
  confidence: number;
}

// ============================================================================
// 🧹 PALAVRAS INVÁLIDAS PARA DESCRIÇÃO
// ============================================================================
const INVALID_DESC_WORDS = new Set([
  "de", "por", "no", "na", "em", "um", "uma", "o", "a", "do", "da",
  "meu", "minha", "com", "para", "pra", "que", "foi", "fui", "eu",
  "paguei", "comprei", "peguei", "gastei", "custou", "dei", "deu",
  "mais", "uns", "umas", "os", "as", "ao", "dos", "das", "pelo", "pela",
  "r$", "reais", "conto", "pila",
]);

/**
 * Limpa descrição removendo artigos, verbos e preposições do início
 */
function cleanExpenseDescription(desc: string): string {
  let words = desc.trim().split(/\s+/);
  
  // Remover palavras inválidas do INÍCIO
  while (words.length > 0 && INVALID_DESC_WORDS.has(words[0].toLowerCase())) {
    words.shift();
  }
  
  // Remover palavras inválidas do FIM
  while (words.length > 0 && INVALID_DESC_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  
  let cleaned = words.join(" ").trim();
  
  // Capitalizar
  if (cleaned.length > 1) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

/**
 * Detecta múltiplos gastos em uma única mensagem usando padrões de linguagem natural.
 * 
 * Exemplos suportados:
 * - "casquinha por r$ 5 a entrada do cinema paguei r$ 25 a pipoca eu paguei 30"
 * - "café 20, almoço 15 e uber 18"
 * - "20 café, 15 almoço, 18 uber"
 * - "gastei 20 no café e 15 no almoço"
 */
export function detectMultipleExpenses(message: string): DetectedExpense[] {
  const original = message.trim();
  
  // ========================================================================
  // ESTRATÉGIA 1: Padrão de linguagem natural com valores explícitos
  // Captura: "[desc] [R$/por/paguei] [valor]" ou "[valor] [desc]"
  // ========================================================================
  const nlpExpenses = extractNLPExpenses(original);
  if (nlpExpenses.length > 1) {
    console.log(`💸 [MULTI-NLP] Detectados ${nlpExpenses.length} gastos via NLP`);
    return deduplicateExpenses(nlpExpenses);
  }
  
  // ========================================================================
  // ESTRATÉGIA 2: Separar por delimitadores (vírgula, "e", quebra de linha)
  // IMPORTANTE: Vírgula SÓ separa se NÃO for decimal
  // ========================================================================
  const separatorExpenses = extractBySeparators(original);
  if (separatorExpenses.length > 1) {
    console.log(`💸 [MULTI-SEP] Detectados ${separatorExpenses.length} gastos via separadores`);
    return deduplicateExpenses(separatorExpenses);
  }
  
  return [];
}

/**
 * Extrai gastos via análise de linguagem natural
 * Procura pares [descrição + valor] em texto corrido
 */
function extractNLPExpenses(text: string): DetectedExpense[] {
  const expenses: DetectedExpense[] = [];
  
  // Padrão 1: "[desc] [por/paguei/R$/de] [valor]"
  // Ex: "casquinha por r$ 5", "entrada do cinema paguei r$ 25", "pipoca 30"
  const pattern1 = /([a-záéíóúãõâêîôûçà\s]{2,40}?)\s+(?:(?:por|paguei|custou|deu|de|r\$)\s*)?r?\$?\s*(\d+[.,]?\d*)/gi;
  
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    const rawDesc = match[1].trim();
    const amount = parseBrazilianAmount(match[2]);
    
    if (amount === null || amount <= 0 || amount >= 100000) continue;
    
    const description = cleanExpenseDescription(rawDesc);
    if (description.length < 2 || description.length > 50) continue;
    
    expenses.push({ amount, description, confidence: 0.8 });
  }
  
  // Se found < 2 via pattern1, try pattern2: "[valor] [desc]"
  if (expenses.length < 2) {
    const pattern2Expenses: DetectedExpense[] = [];
    const pattern2 = /(?:^|\s)r?\$?\s*(\d+[.,]?\d*)\s+(?:(?:no|na|de|do|da|pro|pra)\s+)?([a-záéíóúãõâêîôûçà]+(?:\s+[a-záéíóúãõâêîôûçà]+){0,3})/gi;
    
    while ((match = pattern2.exec(text)) !== null) {
      const amount = parseBrazilianAmount(match[1]);
      const rawDesc = match[2].trim();
      
      if (amount === null || amount <= 0 || amount >= 100000) continue;
      
      const description = cleanExpenseDescription(rawDesc);
      if (description.length < 2 || description.length > 50) continue;
      
      pattern2Expenses.push({ amount, description, confidence: 0.7 });
    }
    
    if (pattern2Expenses.length > 1) {
      return pattern2Expenses;
    }
  }
  
  return expenses;
}

/**
 * Extrai gastos separando por delimitadores (vírgula, "e", newline)
 */
function extractBySeparators(text: string): DetectedExpense[] {
  const expenses: DetectedExpense[] = [];
  
  // Separar por: vírgula (não decimal), quebra de linha, " e "
  const separators = /,(?!\d)|\n|\s+e\s+/gi;
  const parts = text.split(separators).filter(p => p.trim().length > 2);
  
  if (parts.length <= 1) return [];
  
  for (const part of parts) {
    const trimmed = part.trim();
    
    // Tentar extrair valor
    const valuePatterns = [
      /r\$\s*([\d.,]+)/i,
      /(\d+[.,]?\d*)\s*(?:reais?|conto|pila)/i,
      /(?:de|por|:)\s*([\d.,]+)/i,
      /([\d.,]+)\s*$/,
      /^([\d.,]+)\s+/,
    ];
    
    let amount: number | null = null;
    let matchedValue = "";
    
    for (const pattern of valuePatterns) {
      const m = trimmed.match(pattern);
      if (m && m[1]) {
        const parsed = parseBrazilianAmount(m[1]);
        if (parsed !== null && parsed > 0 && parsed < 100000) {
          amount = parsed;
          matchedValue = m[0];
          break;
        }
      }
    }
    
    if (amount === null) continue;
    
    // Extrair descrição
    let description = trimmed
      .replace(matchedValue, "")
      .replace(/\d+[.,]?\d*/g, "")
      .trim();
    
    description = cleanExpenseDescription(description);
    
    if (description.length > 1 && description.length < 50) {
      expenses.push({ amount, description, confidence: 0.8 });
    } else if (description.length === 0) {
      expenses.push({
        amount,
        description: `Gasto de R$ ${amount.toFixed(2)}`,
        confidence: 0.6
      });
    }
  }
  
  return expenses;
}

/**
 * Remove duplicatas (mesmo valor + descrição similar)
 */
function deduplicateExpenses(expenses: DetectedExpense[]): DetectedExpense[] {
  const unique = expenses.reduce((acc, curr) => {
    const exists = acc.some(e => 
      e.amount === curr.amount && 
      e.description.toLowerCase() === curr.description.toLowerCase()
    );
    if (!exists) acc.push(curr);
    return acc;
  }, [] as DetectedExpense[]);
  
  console.log(`💸 [MULTI] ${unique.length} gastos únicos:`, unique.map(e => `${e.description}=${e.amount}`).join(", "));
  
  return unique.length > 1 ? unique : [];
}

/**
 * Formata lista de gastos para exibição
 */
export function formatExpensesList(expenses: DetectedExpense[]): string {
  return expenses.map((e, i) => 
    `${i + 1}. ${e.description}: R$ ${e.amount.toFixed(2)}`
  ).join("\n");
}

/**
 * Calcula total dos gastos
 */
export function calculateTotal(expenses: DetectedExpense[]): number {
  return expenses.reduce((sum, e) => sum + e.amount, 0);
}
