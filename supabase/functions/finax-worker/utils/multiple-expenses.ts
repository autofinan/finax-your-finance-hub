// ============================================================================
// 💸 MULTIPLE EXPENSES DETECTOR - Detectar múltiplos gastos na mesma mensagem
// ============================================================================

import { parseBrazilianAmount } from "./parseAmount.ts";

export interface DetectedExpense {
  amount: number;
  description: string;
  confidence: number;
}

/**
 * Detecta múltiplos gastos em uma única mensagem
 * 
 * Exemplos:
 * - "X de 20, Y de 15 e Z de 18" → 3 gastos
 * - "20 café, 15 almoço, 18 uber" → 3 gastos
 * - "gastei 20 no café e 15 no almoço" → 2 gastos
 * - "X 20\nY 15\nZ 18" → 3 gastos
 * 
 * IMPORTANTE: NÃO separar por vírgula quando seguida de dígitos (8,54 é um valor, não dois)
 * 
 * @param message - Texto da mensagem do usuário
 * @returns Array de gastos detectados (vazio se apenas 1 ou nenhum)
 */
export function detectMultipleExpenses(message: string): DetectedExpense[] {
  const expenses: DetectedExpense[] = [];
  const original = message;
  const normalized = original.toLowerCase();
  
  // ========================================================================
  // ESTRATÉGIA 1: Separar por delimitadores
  // IMPORTANTE: Vírgula SÓ separa se NÃO for decimal (não tem dígito logo depois)
  // ========================================================================
  // Regex: vírgula seguida de espaço OU quebra de linha OU " e " (conjunção)
  const separators = /,(?!\d)|\n|\s+e\s+/gi;
  const parts = original.split(separators).filter(p => p.trim().length > 0);
  
  // Se só tem 1 parte, não há múltiplos
  if (parts.length <= 1) {
    // Tentar estratégia 2: múltiplos valores na mesma frase
    const allValues = original.match(/\d+[.,]?\d*/g);
    if (!allValues || allValues.length <= 1) {
      return []; // Apenas 1 valor = não é múltiplo
    }
  }
  
  // ========================================================================
  // ESTRATÉGIA 2: Extrair pares (descrição + valor) de cada parte
  // ========================================================================
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < 2) continue;
    
    // Padrões para extrair valor
    const valuePatterns = [
      /r\$\s*([\d.,]+)/i,                           // R$ 20
      /(\d+[.,]?\d*)\s*(?:reais?|conto|pila)/i,    // 20 reais
      /([\d.,]+)\s*$/,                              // termina com número
      /(?:de|por|:)\s*([\d.,]+)/i,                 // de 20, por 20
      /^([\d.,]+)\s+/,                              // começa com número
    ];
    
    let amount: number | null = null;
    let matchedValue = "";
    
    for (const pattern of valuePatterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        // USAR parseBrazilianAmount para lidar com vírgula decimal
        const parsed = parseBrazilianAmount(match[1]);
        if (parsed !== null && parsed > 0 && parsed < 100000) {
          amount = parsed;
          matchedValue = match[0];
          break;
        }
      }
    }
    
    if (amount === null) continue;
    
    // Extrair descrição (remover o valor e palavras de ligação)
    let description = trimmed
      .replace(matchedValue, "")
      .replace(/\b(r\$|reais?|conto|pila|de|por|no|na|em|um|uma|o|a|com|para|pra)\b/gi, "")
      .replace(/\d+[.,]?\d*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    
    // Capitalizar primeira letra
    if (description.length > 1) {
      description = description.charAt(0).toUpperCase() + description.slice(1);
    }
    
    // Só adicionar se tiver descrição razoável
    if (description.length > 1 && description.length < 50) {
      expenses.push({
        amount,
        description,
        confidence: 0.8
      });
    } else if (description.length === 0) {
      // Sem descrição, usar placeholder
      expenses.push({
        amount,
        description: `Gasto de R$ ${amount.toFixed(2)}`,
        confidence: 0.6
      });
    }
  }
  
  // ========================================================================
  // ESTRATÉGIA 3: Fallback para padrões específicos
  // ========================================================================
  if (expenses.length <= 1) {
    // Padrão: "20 café 15 almoço 18 uber" (valores intercalados)
    const intercalatedPattern = /(\d+[.,]?\d*)\s+([a-záéíóúãõâêîôûç]+(?:\s+[a-záéíóúãõâêîôûç]+)?)/gi;
    let match;
    const fallbackExpenses: DetectedExpense[] = [];
    
    while ((match = intercalatedPattern.exec(original)) !== null) {
      const amount = parseBrazilianAmount(match[1]);
      const description = match[2].trim();
      
      if (amount === null) continue;
      
      if (amount > 0 && amount < 100000 && description.length > 1) {
        fallbackExpenses.push({
          amount,
          description: description.charAt(0).toUpperCase() + description.slice(1),
          confidence: 0.7
        });
      }
    }
    
    if (fallbackExpenses.length > 1) {
      return fallbackExpenses;
    }
    
    // Padrão: "café 20 almoço 15 uber 18" (descrição antes do valor)
    const reversedPattern = /([a-záéíóúãõâêîôûç]+(?:\s+[a-záéíóúãõâêîôûç]+)?)\s+(\d+[.,]?\d*)/gi;
    const reversedExpenses: DetectedExpense[] = [];
    
    while ((match = reversedPattern.exec(original)) !== null) {
      const description = match[1].trim();
      const amount = parseBrazilianAmount(match[2]);
      
      if (amount === null) continue;
      
      if (amount > 0 && amount < 100000 && description.length > 1) {
        // Filtrar palavras que não são descrições válidas
        const invalidWords = ["de", "por", "no", "na", "em", "um", "uma", "gastei", "comprei", "paguei"];
        if (!invalidWords.includes(description.toLowerCase())) {
          reversedExpenses.push({
            amount,
            description: description.charAt(0).toUpperCase() + description.slice(1),
            confidence: 0.7
          });
        }
      }
    }
    
    if (reversedExpenses.length > 1) {
      return reversedExpenses;
    }
  }
  
  // ========================================================================
  // VALIDAÇÃO FINAL
  // ========================================================================
  // Só retornar se tiver MAIS de 1 gasto detectado
  if (expenses.length <= 1) {
    return [];
  }
  
  // Remover duplicatas (mesmo valor + descrição similar)
  const unique = expenses.reduce((acc, curr) => {
    const exists = acc.some(e => 
      e.amount === curr.amount && 
      e.description.toLowerCase() === curr.description.toLowerCase()
    );
    if (!exists) acc.push(curr);
    return acc;
  }, [] as DetectedExpense[]);
  
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
