// ============================================================================
// 📅 DATE HELPERS - Timezone Brasília + Datas Relativas
// ============================================================================

/**
 * Retorna a data/hora atual no horário de Brasília (UTC-3)
 * CORRIGIDO: Agora retorna o Date correto considerando o offset
 */
export function getBrasiliaDate(): Date {
  const now = new Date();
  
  // Converter para string no timezone de Brasília
  const brasiliaString = now.toLocaleString("en-US", { 
    timeZone: "America/Sao_Paulo",
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parsear a string de volta para Date
  const [date, time] = brasiliaString.split(', ');
  const [month, day, year] = date.split('/');
  const [hour, minute, second] = time.split(':');
  
  // Criar Date no timezone local mas com valores de Brasília
  return new Date(
    parseInt(year),
    parseInt(month) - 1, // Mês é 0-indexed
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  );
}

/**
 * Formata data/hora para exibição em português brasileiro
 * @returns String formatada "DD/MM/YYYY às HH:mm"
 */
export function formatBrasiliaDateTime(date: Date | string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(d);
    
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2024';
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    
    return `${day}/${month}/${year} às ${hour}:${minute}`;
  } catch (error) {
    console.error('❌ [DATE] Erro ao formatar data:', error);
    return 'Data inválida';
  }
}

/**
 * Formata apenas a data (sem hora)
 * @returns String formatada "DD/MM/YYYY"
 */
export function formatBrasiliaDate(date: Date | string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    
    return formatter.format(d);
  } catch (error) {
    console.error('❌ [DATE] Erro ao formatar data:', error);
    return 'Data inválida';
  }
}

/**
 * Formata apenas a hora
 * @returns String formatada "HH:mm"
 */
export function formatBrasiliaTime(date: Date | string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    return formatter.format(d);
  } catch (error) {
    console.error('❌ [DATE] Erro ao formatar hora:', error);
    return '00:00';
  }
}

/**
 * Extrai partes da data formatadas para Brasília
 */
export function getBrasiliaDateParts(date?: Date | string): { 
  data: string; 
  hora: string; 
  dataISO: string;
  timestamp: number;
} {
  try {
    const d = date ? (typeof date === 'string' ? new Date(date) : date) : getBrasiliaDate();
    
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(d);
    
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2024';
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    const second = parts.find(p => p.type === 'second')?.value || '00';
    
    return {
      data: `${day}/${month}/${year}`,
      hora: `${hour}:${minute}`,
      dataISO: `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`,
      timestamp: d.getTime()
    };
  } catch (error) {
    console.error('❌ [DATE] Erro ao extrair partes da data:', error);
    const now = new Date();
    return {
      data: '01/01/2024',
      hora: '00:00',
      dataISO: now.toISOString(),
      timestamp: now.getTime()
    };
  }
}

/**
 * Extrai data/hora ISO ajustada para Brasília
 * @returns Objeto com dateISO e timeString
 */
export function getBrasiliaISO(date?: Date | string): { dateISO: string; timeString: string } {
  const result = getBrasiliaDateParts(date);
  return {
    dateISO: result.dataISO,
    timeString: result.hora
  };
}

/**
 * Início do mês atual (dia 01 às 00:00)
 */
export function getStartOfMonth(baseDate?: Date): Date {
  const d = baseDate || getBrasiliaDate();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Fim do mês atual (último dia às 23:59:59)
 */
export function getEndOfMonth(baseDate?: Date): Date {
  const d = baseDate || getBrasiliaDate();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Início do mês passado
 */
export function getStartOfLastMonth(baseDate?: Date): Date {
  const d = baseDate || getBrasiliaDate();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1, 0, 0, 0, 0);
}

/**
 * Fim do mês passado
 */
export function getEndOfLastMonth(baseDate?: Date): Date {
  const d = baseDate || getBrasiliaDate();
  return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);
}

/**
 * Interpreta datas relativas como "ontem", "anteontem", "semana passada"
 * 
 * @param message - Texto da mensagem do usuário
 * @param baseDate - Data base para cálculo (default: agora em Brasília)
 * @returns Data interpretada ou null se não encontrar padrão
 */
export function parseRelativeDate(message: string, baseDate?: Date): Date | null {
  const base = baseDate || getBrasiliaDate();
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  
  console.log(`🔍 [DATE] Tentando parsear: "${message}" (normalizado: "${normalized}")`);
  
  // Padrões de datas relativas (ordem importa - mais específicos primeiro)
  const patterns: Array<{ 
    name: string;
    regex: RegExp; 
    transform: (d: Date, match?: RegExpMatchArray) => Date 
  }> = [
    // Datas absolutas - DD/MM ou DD/MM/YYYY
    {
      name: "data_absoluta_completa",
      regex: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/,
      transform: (d, match) => {
        if (!match) return d;
        const day = parseInt(match[1]);
        const month = parseInt(match[2]) - 1; // 0-indexed
        const year = parseInt(match[3]);
        const result = new Date(year, month, day, d.getHours(), d.getMinutes(), d.getSeconds());
        console.log(`📅 [DATE] Data absoluta completa: ${day}/${month+1}/${year}`);
        return result;
      }
    },
    {
      name: "data_absoluta_curta",
      regex: /\b(\d{1,2})\/(\d{1,2})\b/,
      transform: (d, match) => {
        if (!match) return d;
        const day = parseInt(match[1]);
        const month = parseInt(match[2]) - 1; // 0-indexed
        const year = d.getFullYear();
        const result = new Date(year, month, day, d.getHours(), d.getMinutes(), d.getSeconds());
        console.log(`📅 [DATE] Data absoluta curta: ${day}/${month+1}`);
        return result;
      }
    },
    // "dia 15", "dia 1"
    {
      name: "dia_numero",
      regex: /\bdia\s+(\d{1,2})\b/,
      transform: (d, match) => {
        if (!match) return d;
        const day = parseInt(match[1]);
        const result = new Date(d.getFullYear(), d.getMonth(), day, d.getHours(), d.getMinutes(), d.getSeconds());
        console.log(`📅 [DATE] Dia do mês: ${day}`);
        return result;
      }
    },
    // Anteontem
    {
      name: "anteontem",
      regex: /\banteontem\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setDate(result.getDate() - 2);
        console.log(`📅 [DATE] Anteontem: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    // Ontem
    {
      name: "ontem",
      regex: /\bontem\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setDate(result.getDate() - 1);
        console.log(`📅 [DATE] Ontem: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    // Hoje (explícito)
    {
      name: "hoje",
      regex: /\bhoje\b/,
      transform: (d) => {
        console.log(`📅 [DATE] Hoje: ${formatBrasiliaDate(d)}`);
        return new Date(d);
      }
    },
    // Início do mês
    {
      name: "inicio_mes",
      regex: /\binicio\s+do\s+mes\b/,
      transform: (d) => {
        const result = getStartOfMonth(d);
        console.log(`📅 [DATE] Início do mês: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    // Fim do mês passado
    {
      name: "fim_mes_passado",
      regex: /\bfim\s+do\s+mes\s+passado\b/,
      transform: (d) => {
        const result = getEndOfLastMonth(d);
        console.log(`📅 [DATE] Fim do mês passado: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    // Semana passada
    {
      name: "semana_passada",
      regex: /\bsemana\s*passada\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setDate(result.getDate() - 7);
        console.log(`📅 [DATE] Semana passada: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    // Mês passado (mesmo dia)
    {
      name: "mes_passado",
      regex: /\bmes\s*passado\b/,
      transform: (d) => {
        const result = new Date(d);
        result.setMonth(result.getMonth() - 1);
        console.log(`📅 [DATE] Mês passado: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    // Dias da semana passados - CORRIGIDO
    {
      name: "segunda_passada",
      regex: /\bsegunda\s*(?:passada|feira\s+passada)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const today = result.getDay(); // 0=domingo, 1=segunda, etc
        const daysAgo = today === 0 ? 6 : (today === 1 ? 7 : today - 1);
        result.setDate(result.getDate() - daysAgo);
        console.log(`📅 [DATE] Segunda passada: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    {
      name: "terca_passada",
      regex: /\bterca\s*(?:passada|feira\s+passada)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const today = result.getDay();
        const daysAgo = today === 0 ? 5 : (today <= 2 ? 7 - (2 - today) : today - 2);
        result.setDate(result.getDate() - daysAgo);
        console.log(`📅 [DATE] Terça passada: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    {
      name: "quarta_passada",
      regex: /\bquarta\s*(?:passada|feira\s+passada)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const today = result.getDay();
        const daysAgo = today === 0 ? 4 : (today <= 3 ? 7 - (3 - today) : today - 3);
        result.setDate(result.getDate() - daysAgo);
        console.log(`📅 [DATE] Quarta passada: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    {
      name: "quinta_passada",
      regex: /\bquinta\s*(?:passada|feira\s+passada)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const today = result.getDay();
        const daysAgo = today === 0 ? 3 : (today <= 4 ? 7 - (4 - today) : today - 4);
        result.setDate(result.getDate() - daysAgo);
        console.log(`📅 [DATE] Quinta passada: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    {
      name: "sexta_passada",
      regex: /\bsexta\s*(?:passada|feira\s+passada)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const today = result.getDay();
        const daysAgo = today === 0 ? 2 : (today <= 5 ? 7 - (5 - today) : today - 5);
        result.setDate(result.getDate() - daysAgo);
        console.log(`📅 [DATE] Sexta passada: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    {
      name: "sabado_passado",
      regex: /\bsabado\s*(?:passado)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const today = result.getDay();
        const daysAgo = today === 0 ? 1 : (today === 6 ? 7 : 7 - (6 - today));
        result.setDate(result.getDate() - daysAgo);
        console.log(`📅 [DATE] Sábado passado: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    {
      name: "domingo_passado",
      regex: /\bdomingo\s*(?:passado)?\b/,
      transform: (d) => {
        const result = new Date(d);
        const today = result.getDay();
        const daysAgo = today === 0 ? 7 : today;
        result.setDate(result.getDate() - daysAgo);
        console.log(`📅 [DATE] Domingo passado: ${formatBrasiliaDate(result)}`);
        return result;
      }
    },
    // "há X dias" / "X dias atrás"
    {
      name: "dias_atras",
      regex: /(?:ha|há)\s*(\d+)\s*dias?|(\d+)\s*dias?\s*atras/,
      transform: (d, match) => {
        const result = new Date(d);
        const days = parseInt(match?.[1] || match?.[2] || "0");
        if (days > 0) {
          result.setDate(result.getDate() - days);
          console.log(`📅 [DATE] Há ${days} dias: ${formatBrasiliaDate(result)}`);
        }
        return result;
      }
    },
  ];
  
  for (const { name, regex, transform } of patterns) {
    const match = normalized.match(regex);
    if (match) {
      try {
        const result = transform(base, match);
        console.log(`✅ [DATE] Padrão "${name}" aplicado com sucesso`);
        return result;
      } catch (error) {
        console.error(`❌ [DATE] Erro ao aplicar padrão "${name}":`, error);
      }
    }
  }
  
  console.log(`⚠️ [DATE] Nenhum padrão encontrado para: "${message}"`);
  return null;
}

// ============================================================================
// ⏱️ FORMATAR TEMPO RELATIVO ("há 2h", "ontem", etc.)
// ============================================================================

export function formatTimeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "agora";
  if (diffMins < 60) return `${diffMins} min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  if (diffDays === 1) return "ontem";
  if (diffDays < 7) return `${diffDays} dias atrás`;
  
  return d.toLocaleDateString("pt-BR");
}

/**
 * Formata valor monetário em R$
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
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
    taxi: "🚕",
    combustivel: "⛽",
    lazer: "🎮",
    entretenimento: "🎬",
    saude: "🏥",
    farmacia: "💊",
    educacao: "📚",
    moradia: "🏠",
    aluguel: "🏠",
    condominio: "🏢",
    vestuario: "👕",
    roupa: "👕",
    tecnologia: "💻",
    assinatura: "📱",
    streaming: "📺",
    pets: "🐕",
    beleza: "💇",
    viagem: "✈️",
    hotel: "🏨",
    entrada: "💰",
    salario: "💵",
    investimento: "📈",
    poupanca: "🐷",
    outros: "💸",
  };
  
  const key = categoria.toLowerCase().trim();
  return emojiMap[key] || "💸";
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
    boleto: "🧾",
  };
  
  const key = paymentMethod.toLowerCase().trim();
  return emojiMap[key] || "💰";
}

/**
 * Calcula diferença entre duas datas em dias
 */
export function daysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Verifica se uma data é hoje
 */
export function isToday(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = getBrasiliaDate();
  
  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
}

/**
 * Verifica se uma data é ontem
 */
export function isYesterday(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const yesterday = getBrasiliaDate();
  yesterday.setDate(yesterday.getDate() - 1);
  
  return d.getDate() === yesterday.getDate() &&
         d.getMonth() === yesterday.getMonth() &&
         d.getFullYear() === yesterday.getFullYear();
}

/**
 * Formata data de forma inteligente (hoje, ontem, ou data completa)
 */
export function formatSmartDate(date: Date | string): string {
  if (isToday(date)) {
    return `Hoje às ${formatBrasiliaTime(date)}`;
  }
  
  if (isYesterday(date)) {
    return `Ontem às ${formatBrasiliaTime(date)}`;
  }
  
  return formatBrasiliaDateTime(date);
}
