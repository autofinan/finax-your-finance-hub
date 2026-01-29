// ============================================================================
// 💵 PARSER DE VALORES MONETÁRIOS FORMATO BRASILEIRO
// ============================================================================
// Resolve o bug onde "8,54" era parseado como 8 e 54 separadamente
// ============================================================================

/**
 * Parseia valores monetários em formato brasileiro
 * 
 * Suporta:
 * - 8,54 → 8.54
 * - 101,31 → 101.31
 * - 1.234,56 → 1234.56
 * - R$ 50,00 → 50.00
 * - 100 → 100
 * 
 * @param input String com valor monetário
 * @returns Número parseado ou null se inválido
 */
export function parseBrazilianAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  
  // Se já for número, validar e retornar
  if (typeof input === 'number') {
    if (isNaN(input) || input <= 0 || input >= 1000000) return null;
    return Math.round(input * 100) / 100;
  }
  
  if (typeof input !== 'string') return null;
  
  // Limpar espaços e símbolos de moeda
  let raw = input.trim().replace(/[R$\s]/gi, "");
  
  // Se vazio, retornar null
  if (!raw || raw.length === 0) return null;
  
  // Detectar formato: se tem vírgula DEPOIS de ponto, é BR (1.234,56)
  // Se tem ponto DEPOIS de vírgula, é US (1,234.56)
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  
  if (lastComma > lastDot && lastComma !== -1) {
    // Formato brasileiro: 1.234,56 ou 8,54
    raw = raw.replace(/\./g, "");  // Remove separadores de milhar
    raw = raw.replace(",", ".");    // Troca vírgula decimal por ponto
  } else if (lastDot > lastComma && lastDot !== -1) {
    // Formato americano ou só com ponto: 1,234.56 ou 8.54
    raw = raw.replace(/,/g, "");   // Remove separadores de milhar
  }
  // Se não tem nem vírgula nem ponto, é número inteiro
  
  const value = Number(raw);
  
  if (isNaN(value) || value <= 0 || value >= 1000000) return null;
  
  // Arredondar para 2 casas decimais
  return Math.round(value * 100) / 100;
}

/**
 * Verifica se uma string contém um valor monetário brasileiro
 * Útil para validação antes de parsing
 */
export function containsBrazilianAmount(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  
  // Padrões de valores monetários brasileiros
  const patterns = [
    /\d+,\d{1,2}(?!\d)/,           // 8,54 (vírgula decimal, não seguida de mais dígitos)
    /\d+\.\d{3},\d{2}/,            // 1.234,56 (milhar + decimal)
    /R\$\s*\d/i,                    // R$ seguido de número
    /\d+(?:\s*reais?|\s*conto)/i,  // 50 reais, 50 conto
  ];
  
  return patterns.some(p => p.test(input));
}

/**
 * Extrai todos os valores monetários de uma string
 * Retorna array de números encontrados
 */
export function extractBrazilianAmounts(input: string): number[] {
  if (!input || typeof input !== 'string') return [];
  
  const amounts: number[] = [];
  
  // Padrão para capturar valores
  const pattern = /(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)/gi;
  
  let match;
  while ((match = pattern.exec(input)) !== null) {
    const parsed = parseBrazilianAmount(match[1]);
    if (parsed !== null) {
      amounts.push(parsed);
    }
  }
  
  return amounts;
}
