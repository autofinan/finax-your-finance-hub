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
// 🧹 LIMPAR DESCRIÇÃO DE MULTI-GASTO
// ============================================================================

const DESCRIPTION_NOISE = [
  "comprei", "paguei", "gastei", "custou", "saiu", "deu", "foi",
  "peguei", "tomei", "comi", "bebi",
  "uma", "um", "uns", "umas", "a", "o", "as", "os",
  "do", "da", "dos", "das", "no", "na", "nos", "nas",
  "de", "por", "meu", "minha", "meus", "minhas",
  "eu", "e", "que", "pra", "para", "com",
  "r$", "reais", "real", "conto",
];

function cleanMultiDescription(text: string): string {
  let cleaned = text.toLowerCase().trim();
  
  // Remover cada palavra de ruído APENAS como palavras inteiras
  for (const word of DESCRIPTION_NOISE) {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, "gi"), " ");
  }
  
  // Remover números residuais
  cleaned = cleaned.replace(/\d+[.,]?\d*/g, " ");
  
  // Limpar espaços
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  
  // Capitalizar
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

// ============================================================================
// 🔍 ESTRATÉGIA PRINCIPAL: Extrair pares (descrição, valor) de texto natural
// ============================================================================

/**
 * Detecta múltiplos gastos em uma única mensagem
 * 
 * Exemplos:
 * - "casquinha 5, cinema 25, pipoca 30, coca 10, uber 20"
 * - "comprei casquinha por 5, entrada do cinema 25, pipoca 30"
 * - Áudio: "fui no shopping comprei uma casquinha por r$ 5 a entrada do cinema paguei r$ 25..."
 */
export function detectMultipleExpenses(message: string): DetectedExpense[] {
  const original = message.trim();
  
  // ========================================================================
  // ESTRATÉGIA 1: Padrões valor+descrição intercalados no texto natural
  // Captura: "[contexto] item [por/paguei/R$] valor [item valor...]"
  // ========================================================================
  
  const expenses: DetectedExpense[] = [];
  
  // Padrão A: "item por/paguei R$ valor" ou "item R$ valor" ou "item valor reais"
  // Captura segmentos entre valores monetários
  const valuePattern = /(?:r\$\s*|por\s+(?:r\$\s*)?|paguei\s+(?:r\$\s*)?|custou\s+(?:r\$\s*)?|deu\s+(?:r\$\s*)?|saiu\s+(?:r\$\s*)?)(\d+(?:[.,]\d{1,2})?)/gi;
  
  const valueMatches: Array<{ amount: number; index: number; fullMatchEnd: number }> = [];
  let match;
  
  while ((match = valuePattern.exec(original)) !== null) {
    const amount = parseBrazilianAmount(match[1]);
    if (amount !== null && amount > 0 && amount < 100000) {
      valueMatches.push({
        amount,
        index: match.index,
        fullMatchEnd: match.index + match[0].length
      });
    }
  }
  
  // Se encontrou 2+ valores, extrair descrições entre eles
  if (valueMatches.length >= 2) {
    for (let i = 0; i < valueMatches.length; i++) {
      let descStart: number;
      let descEnd: number;
      
      if (i === 0) {
        descStart = 0;
        descEnd = valueMatches[i].index;
      } else {
        descStart = valueMatches[i - 1].fullMatchEnd;
        descEnd = valueMatches[i].index;
      }
      
      let rawDesc = original.substring(descStart, descEnd).trim();
      const cleanedDesc = cleanMultiDescription(rawDesc);
      
      if (cleanedDesc.length >= 2 && cleanedDesc.length < 50) {
        expenses.push({
          amount: valueMatches[i].amount,
          description: cleanedDesc,
          confidence: 0.85
        });
      } else if (cleanedDesc.length < 2) {
        // Sem descrição válida → usar placeholder
        expenses.push({
          amount: valueMatches[i].amount,
          description: `Gasto R$ ${valueMatches[i].amount.toFixed(2)}`,
          confidence: 0.6
        });
      }
    }
    
    if (expenses.length >= 2) {
      return deduplicateExpenses(expenses);
    }
  }
  
  // ========================================================================
  // ESTRATÉGIA 2: Separar por delimitadores (vírgula, "e", quebra de linha)
  // ========================================================================
  const separators = /,(?!\d)|\n|\s+e\s+/gi;
  const parts = original.split(separators).filter(p => p.trim().length > 2);
  
  if (parts.length >= 2) {
    const partExpenses: DetectedExpense[] = [];
    
    for (const part of parts) {
      const trimmed = part.trim();
      
      // Extrair valor do segmento
      const valPatterns = [
        /(?:r\$\s*)([\d.,]+)/i,
        /(\d+[.,]?\d*)\s*(?:reais?|conto)/i,
        /(?:por|paguei|custou|deu)\s+(?:r\$\s*)?([\d.,]+)/i,
        /([\d.,]+)\s*$/,
        /^([\d.,]+)\s+/,
      ];
      
      let amount: number | null = null;
      let matchedStr = "";
      
      for (const pat of valPatterns) {
        const m = trimmed.match(pat);
        if (m) {
          const val = m[1] || m[2];
          if (val) {
            const parsed = parseBrazilianAmount(val);
            if (parsed !== null && parsed > 0 && parsed < 100000) {
              amount = parsed;
              matchedStr = m[0];
              break;
            }
          }
        }
      }
      
      if (amount === null) continue;
      
      // Extrair descrição removendo o valor
      let rawDesc = trimmed.replace(matchedStr, " ");
      const cleaned = cleanMultiDescription(rawDesc);
      
      if (cleaned.length >= 2) {
        partExpenses.push({ amount, description: cleaned, confidence: 0.8 });
      } else {
        partExpenses.push({ amount, description: `Gasto R$ ${amount.toFixed(2)}`, confidence: 0.6 });
      }
    }
    
    if (partExpenses.length >= 2) {
      return deduplicateExpenses(partExpenses);
    }
  }
  
  // ========================================================================
  // ESTRATÉGIA 3: Padrão intercalado "desc valor desc valor"
  // ========================================================================
  const intercalatedPattern = /([a-záàâãéèêíïóôõöúçñ\s]{2,30}?)\s+(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/gi;
  const fallbackExpenses: DetectedExpense[] = [];
  
  while ((match = intercalatedPattern.exec(original)) !== null) {
    const amount = parseBrazilianAmount(match[2]);
    if (amount === null || amount <= 0 || amount >= 100000) continue;
    
    const cleaned = cleanMultiDescription(match[1]);
    if (cleaned.length >= 2) {
      fallbackExpenses.push({ amount, description: cleaned, confidence: 0.7 });
    }
  }
  
  if (fallbackExpenses.length >= 2) {
    return deduplicateExpenses(fallbackExpenses);
  }
  
  // Não é múltiplo
  return [];
}

// ============================================================================
// 🔁 DEDUPLICAR
// ============================================================================

function deduplicateExpenses(expenses: DetectedExpense[]): DetectedExpense[] {
  const unique = expenses.reduce((acc, curr) => {
    const exists = acc.some(e => 
      e.amount === curr.amount && 
      e.description.toLowerCase() === curr.description.toLowerCase()
    );
    if (!exists) acc.push(curr);
    return acc;
  }, [] as DetectedExpense[]);
  
  if (unique.length <= 1) return [];
  
  console.log(`💸 [MULTI] Detectados ${unique.length} gastos:`, unique.map(e => `${e.description}=${e.amount}`).join(", "));
  return unique;
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
