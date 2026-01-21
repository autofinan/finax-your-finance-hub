// ============================================================================
// 📅 DATE HELPERS - Timezone Brasília + Datas Relativas
// ============================================================================

/**
 * Retorna a data atual no horário de Brasília (UTC-3)
 */
export function getBrasiliaDate(): Date {
  const now = new Date();
  // Converter para horário de Brasília usando Intl
  const brasiliaString = now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  return new Date(brasiliaString);
}

/**
 * Formata data/hora para exibição em português brasileiro
 */
export function formatBrasiliaDateTime(date: Date): { data: string; hora: string; dataISO: string } {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  
  const day = parts.find(p => p.type === 'day')?.value || '01';
  const month = parts.find(p => p.type === 'month')?.value || '01';
  const year = parts.find(p => p.type === 'year')?.value || '2024';
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  
  return {
    data: `${day}/${month}/${year}`,
    hora: `${hour}:${minute}`,
    dataISO: `${year}-${month}-${day}T${hour}:${minute}:00-03:00`
  };
}

/**
 * Extrai data/hora ISO ajustada para Brasília
 */
export function getBrasiliaISO(date?: Date): string {
  const d = date || new Date();
  const { dataISO } = formatBrasiliaDateTime(d);
  return dataISO;
}

/**
 * Interpreta datas relativas como "ontem", "anteontem", "semana passada"
 * 
 * @param message - Texto da mensagem do usuário
 * @param baseDate - Data base para cálculo (default: agora)
 * @returns Data interpretada ou null se não encontrar padrão
 */
export function parseRelativeDate(message: string, baseDate?: Date): Date | null {
  const base = baseDate || getBrasiliaDate();
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  
  // Padrões de datas relativas (ordem importa - mais específicos primeiro)
  const patterns: Array<{ regex: RegExp; transform: (d: Date) => Date }> = [
    // Anteontem
    {
      regex: /\banteontem\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setDate(result.getDate() - 2);
        return result;
      }
    },
    // Ontem
    {
      regex: /\bontem\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setDate(result.getDate() - 1);
        return result;
      }
    },
    // Hoje (explícito)
    {
      regex: /\bhoje\b/,
      transform: (d) => new Date(d)
    },
    // Semana passada
    {
      regex: /\bsemana\s*passada\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setDate(result.getDate() - 7);
        return result;
      }
    },
    // Mês passado
    {
      regex: /\bmes\s*passado\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setMonth(result.getMonth() - 1);
        return result;
      }
    },
    // Segunda passada
    {
      regex: /\bsegunda\s*(?:passada|feira)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const dayOfWeek = result.getDay();
        // Se hoje é segunda (1), voltar 7 dias
        // Se hoje é terça (2), voltar 1 dia
        // etc.
        const daysToSubtract = dayOfWeek === 1 ? 7 : (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
        result.setDate(result.getDate() - daysToSubtract);
        return result;
      }
    },
    // Terça passada
    {
      regex: /\bterca\s*(?:passada|feira)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const dayOfWeek = result.getDay();
        const daysToSubtract = dayOfWeek === 2 ? 7 : (dayOfWeek < 2 ? dayOfWeek + 5 : dayOfWeek - 2);
        result.setDate(result.getDate() - daysToSubtract);
        return result;
      }
    },
    // Quarta passada
    {
      regex: /\bquarta\s*(?:passada|feira)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const dayOfWeek = result.getDay();
        const daysToSubtract = dayOfWeek === 3 ? 7 : (dayOfWeek < 3 ? dayOfWeek + 4 : dayOfWeek - 3);
        result.setDate(result.getDate() - daysToSubtract);
        return result;
      }
    },
    // Quinta passada
    {
      regex: /\bquinta\s*(?:passada|feira)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const dayOfWeek = result.getDay();
        const daysToSubtract = dayOfWeek === 4 ? 7 : (dayOfWeek < 4 ? dayOfWeek + 3 : dayOfWeek - 4);
        result.setDate(result.getDate() - daysToSubtract);
        return result;
      }
    },
    // Sexta passada
    {
      regex: /\bsexta\s*(?:passada|feira)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const dayOfWeek = result.getDay();
        const daysToSubtract = dayOfWeek === 5 ? 7 : (dayOfWeek < 5 ? dayOfWeek + 2 : dayOfWeek - 5);
        result.setDate(result.getDate() - daysToSubtract);
        return result;
      }
    },
    // Sábado passado
    {
      regex: /\bsabado\s*(?:passado)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const dayOfWeek = result.getDay();
        const daysToSubtract = dayOfWeek === 6 ? 7 : (dayOfWeek < 6 ? dayOfWeek + 1 : 7);
        result.setDate(result.getDate() - daysToSubtract);
        return result;
      }
    },
    // Domingo passado
    {
      regex: /\bdomingo\s*(?:passado)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const dayOfWeek = result.getDay();
        const daysToSubtract = dayOfWeek === 0 ? 7 : dayOfWeek;
        result.setDate(result.getDate() - daysToSubtract);
        return result;
      }
    },
    // "há X dias" / "X dias atrás"
    {
      regex: /(?:ha|há)\s*(\d+)\s*dias?|(\d+)\s*dias?\s*atras/,
      transform: (d) => {
        const result = new Date(d);
        const match = normalized.match(/(?:ha|há)\s*(\d+)\s*dias?|(\d+)\s*dias?\s*atras/);
        const days = parseInt(match?.[1] || match?.[2] || "0");
        if (days > 0) {
          result.setDate(result.getDate() - days);
        }
        return result;
      }
    },
  ];
  
  for (const { regex, transform } of patterns) {
    if (regex.test(normalized)) {
      const result = transform(base);
      console.log(`📅 [DATE] Parsed "${normalized}" → ${result.toISOString().split('T')[0]}`);
      return result;
    }
  }
  
  return null;
}

/**
 * Formata valor monetário em R$
 */
export function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

/**
 * Extrai emoji apropriado para categoria
 */
export function getCategoryEmoji(categoria: string): string {
  const emojiMap: Record<string, string> = {
    alimentacao: "🍽️",
    mercado: "🛒",
    transporte: "🚗",
    uber: "🚙",
    combustivel: "⛽",
    lazer: "🎮",
    saude: "🏥",
    educacao: "📚",
    moradia: "🏠",
    vestuario: "👕",
    tecnologia: "💻",
    assinatura: "📱",
    pets: "🐕",
    beleza: "💇",
    viagem: "✈️",
    entrada: "💰",
    outros: "💸",
  };
  
  return emojiMap[categoria.toLowerCase()] || "💸";
}

/**
 * Extrai emoji para forma de pagamento
 */
export function getPaymentEmoji(paymentMethod: string): string {
  const emojiMap: Record<string, string> = {
    pix: "📱",
    debito: "💳",
    credito: "💳",
    dinheiro: "💵",
    transferencia: "🏦",
  };
  
  return emojiMap[paymentMethod.toLowerCase()] || "💰";
}
