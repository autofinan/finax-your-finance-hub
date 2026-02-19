// ============================================================================
// 🧠 SISTEMA DE CONTEXTO INTELIGENTE - v2.0
// ============================================================================
// PRINCÍPIO: A IA resolve o contexto, o sistema executa dinamicamente
// NÃO usar switch/case hardcoded - usar parâmetros da IA
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatBrasiliaDate, getBrasiliaDate } from "./date-helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📊 EXECUTOR DINÂMICO DE QUERIES
// ============================================================================

interface QueryParams {
  userId: string;
  query_scope: "expenses" | "income" | "all";
  start_date?: string;  // ISO format
  end_date?: string;    // ISO format
  category?: string;
  card_id?: string;
  time_range?: string;  // "today", "yesterday", "week", etc (apenas para formatação)
}

export interface QueryResultWithMeta {
  message: string;
  hasMore: boolean;
  totalItems: number;
  scope: string;
  category?: string;
  timeRange: string;
}

/**
 * ✅ QUERY DINÂMICA - Funciona para QUALQUER período
 * A IA calcula as datas, nós só executamos
 */
export async function executeDynamicQuery(params: QueryParams): Promise<QueryResultWithMeta> {
  const { userId, query_scope, start_date, end_date, category, card_id, time_range } = params;
  
  console.log(`📊 [DYNAMIC_QUERY] Executando query dinâmica:`, {
    scope: query_scope,
    periodo: start_date && end_date ? `${start_date} até ${end_date}` : "mês atual",
    categoria: category || "todas",
    cartao: card_id || "todos"
  });
  
  // ============================================================================
  // 1️⃣ CALCULAR PERÍODO (se IA não passou datas)
  // ============================================================================
  let queryStartDate: string;
  let queryEndDate: string;
  
  if (start_date && end_date) {
    // ✅ IA JÁ CALCULOU - usar direto
    queryStartDate = start_date;
    queryEndDate = end_date;
  } else {
    // ✅ BUG #3 FIX: Calcular período baseado em time_range quando IA não passou datas
    const brasiliaNow = getBrasiliaDate();
    
    if (time_range === "week" || time_range === "weekly" || time_range === "semana" || time_range === "semanal") {
      // Últimos 7 dias
      const startOfWeek = new Date(brasiliaNow);
      startOfWeek.setDate(brasiliaNow.getDate() - 7);
      startOfWeek.setHours(0, 0, 0, 0);
      queryStartDate = startOfWeek.toISOString();
      queryEndDate = brasiliaNow.toISOString();
      console.log(`📊 [DYNAMIC_QUERY] Week fallback: ${queryStartDate} → ${queryEndDate}`);
    } else if (time_range === "today" || time_range === "hoje") {
      const startOfDay = new Date(brasiliaNow);
      startOfDay.setHours(0, 0, 0, 0);
      queryStartDate = startOfDay.toISOString();
      queryEndDate = brasiliaNow.toISOString();
    } else if (time_range === "yesterday" || time_range === "ontem") {
      const yesterday = new Date(brasiliaNow);
      yesterday.setDate(brasiliaNow.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const endYesterday = new Date(yesterday);
      endYesterday.setHours(23, 59, 59, 999);
      queryStartDate = yesterday.toISOString();
      queryEndDate = endYesterday.toISOString();
    } else {
      // Fallback: mês atual
      const startOfMonth = new Date(brasiliaNow.getFullYear(), brasiliaNow.getMonth(), 1, 0, 0, 0, 0);
      queryStartDate = startOfMonth.toISOString();
      queryEndDate = brasiliaNow.toISOString();
    }
  }
  
  // ============================================================================
  // 2️⃣ MONTAR QUERY DINÂMICA
  // ============================================================================
  let query = supabase
    .from("transacoes")
    .select("valor, descricao, categoria, data, forma_pagamento")
    .eq("usuario_id", userId)
    .gte("data", queryStartDate)
    .lte("data", queryEndDate)
    .eq("status", "confirmada");
  
  // Filtro de tipo (entrada/saída)
  if (query_scope === "expenses") {
    query = query.eq("tipo", "saida");
  } else if (query_scope === "income") {
    query = query.eq("tipo", "entrada");
  }
  
  // Filtro de categoria
  if (category) {
    query = query.eq("categoria", category);
  }
  
  // Filtro de cartão
  if (card_id) {
    query = query.eq("cartao_id", card_id);
  }
  
  const { data: transactions, error } = await query.order("data", { ascending: false });
  
  if (error) {
    console.error(`❌ [DYNAMIC_QUERY] Erro:`, error);
    return { 
      message: "Ops! Tive um problema ao buscar seus dados 😕", 
      hasMore: false, totalItems: 0, scope: query_scope, timeRange: time_range || "período" 
    };
  }
  
  // ============================================================================
  // 3️⃣ FORMATAR RESULTADO
  // ============================================================================
  return formatQueryResult(transactions || [], {
    scope: query_scope,
    timeRange: time_range || "período",
    category,
    startDate: queryStartDate,
    endDate: queryEndDate
  });
}

// ============================================================================
// 📝 FORMATADOR DE RESULTADOS
// ============================================================================

interface FormatOptions {
  scope: string;
  timeRange: string;
  category?: string;
  startDate: string;
  endDate: string;
}

function formatQueryResult(transactions: any[], options: FormatOptions): QueryResultWithMeta {
  const { scope, timeRange, category } = options;
  
  // ============================================================================
  // CASO 1: Nenhuma transação
  // ============================================================================
  if (transactions.length === 0) {
    const periodoTexto = getPeriodoTexto(timeRange);
    const scopeTexto = scope === "expenses" ? "gastos" : scope === "income" ? "entradas" : "transações";
    
    return {
      message: `📊 Nenhum ${scopeTexto} ${periodoTexto}! 🎉`,
      hasMore: false,
      totalItems: 0,
      scope,
      category,
      timeRange
    };
  }
  
  // ============================================================================
  // CASO 2: Listar transações
  // ============================================================================
  const total = transactions.reduce((sum, t) => sum + Number(t.valor), 0);
  const maxItems = 15; // Máximo de itens para exibir
  
  const lista = transactions.slice(0, maxItems).map(t => {
    const emoji = scope === "expenses" ? "💸" : "💰";
    const descricao = t.descricao || t.categoria || "Sem descrição";
    const dataFormatada = t.data ? formatBrasiliaDate(t.data) : "";
    return `${emoji} R$ ${Number(t.valor).toFixed(2)} - ${descricao}${dataFormatada ? ` (${dataFormatada})` : ""}`;
  }).join("\n");
  
  const remaining = transactions.length - maxItems;
  const textoAdicional = remaining > 0
    ? `\n\n_...e mais ${remaining} ${scope === "expenses" ? "gastos" : "transações"}_` 
    : "";
  
  // ============================================================================
  // TÍTULO DINÂMICO
  // ============================================================================
  const periodoTexto = getPeriodoTexto(timeRange);
  const scopeTexto = scope === "expenses" ? "Gastos" : scope === "income" ? "Entradas" : "Transações";
  const categoriaTexto = category ? ` em ${category}` : "";
  
  const titulo = `📊 *${scopeTexto}${categoriaTexto} ${periodoTexto}*`;
  
  return {
    message: `${titulo}\n\n${lista}${textoAdicional}\n\n💸 *Total: R$ ${total.toFixed(2)}*`,
    hasMore: remaining > 0,
    totalItems: transactions.length,
    scope,
    category,
    timeRange
  };
}

// ============================================================================
// 🗓️ HELPER: Texto do período
// ============================================================================

function getPeriodoTexto(timeRange: string): string {
  const mapa: Record<string, string> = {
    "today": "de Hoje",
    "yesterday": "de Ontem",
    "week": "da Semana",
    "last_week": "da Semana Passada",
    "month": "do Mês",
    "last_month": "do Mês Passado",
    "custom": "do Período"
  };
  
  return mapa[timeRange] || "do Período";
}

// ============================================================================
// 🤖 PROMPT DA IA - ATUALIZADO
// ============================================================================

/**
 * ✅ PROMPT PARA A IA CALCULAR DATAS DINAMICAMENTE
 * 
 * A IA deve retornar SEMPRE:
 * - query_scope: "expenses" | "income" | "all"
 * - start_date: "2026-01-30T00:00:00.000Z" (ISO format)
 * - end_date: "2026-01-30T23:59:59.999Z" (ISO format)
 * - time_range: "yesterday" | "today" | "week" | etc (para formatação)
 * 
 * EXEMPLOS:
 * 
 * Usuário: "Quanto gastei ontem?"
 * IA retorna: {
 *   intent: "query",
 *   query_scope: "expenses",
 *   start_date: "2026-01-30T00:00:00.000Z",
 *   end_date: "2026-01-30T23:59:59.999Z",
 *   time_range: "yesterday"
 * }
 * 
 * Contexto: { lastTimeRange: "today" }
 * Usuário: "e ontem?"
 * IA retorna: {
 *   intent: "query",
 *   query_scope: "expenses",  // MANTÉM do contexto
 *   start_date: "2026-01-30T00:00:00.000Z",  // CALCULA ontem
 *   end_date: "2026-01-30T23:59:59.999Z",
 *   time_range: "yesterday"
 * }
 * 
 * Contexto: { lastTimeRange: "yesterday" }
 * Usuário: "e anteontem?"
 * IA retorna: {
 *   intent: "query",
 *   query_scope: "expenses",
 *   start_date: "2026-01-29T00:00:00.000Z",  // CALCULA anteontem
 *   end_date: "2026-01-29T23:59:59.999Z",
 *   time_range: "custom"
 * }
 * 
 * Usuário: "Quanto gastei nos últimos 3 dias?"
 * IA retorna: {
 *   intent: "query",
 *   query_scope: "expenses",
 *   start_date: "2026-01-28T00:00:00.000Z",  // 3 dias atrás
 *   end_date: "2026-01-31T23:59:59.999Z",    // hoje
 *   time_range: "custom"
 * }
 */

export const AI_QUERY_PROMPT = `
CONTEXTO CONVERSACIONAL - REGRAS:

1. Quando usuário perguntar algo com referência ao contexto anterior:
   - "e ontem?" → usar lastQueryScope, mas calcular data de ontem
   - "e semana passada?" → usar lastQueryScope, calcular semana passada
   - "e no cartão X?" → manter período, mudar filtro de cartão
   
2. SEMPRE retornar start_date e end_date em ISO format:
   - Hoje: start = 2026-01-31T00:00:00.000Z, end = 2026-01-31T23:59:59.999Z
   - Ontem: start = 2026-01-30T00:00:00.000Z, end = 2026-01-30T23:59:59.999Z
   - Semana: start = domingo desta semana, end = agora
   
3. time_range serve APENAS para formatação da resposta. Os filtros reais são start_date/end_date.

EXEMPLOS:
- "quanto gastei hoje?" → { query_scope: "expenses", start_date: "2026-01-31T00:00:00Z", end_date: "2026-01-31T23:59:59Z", time_range: "today" }
- [contexto: today] "e ontem?" → { query_scope: "expenses", start_date: "2026-01-30T00:00:00Z", end_date: "2026-01-30T23:59:59Z", time_range: "yesterday" }
- "últimos 5 dias" → { query_scope: "expenses", start_date: "2026-01-26T00:00:00Z", end_date: "2026-01-31T23:59:59Z", time_range: "custom" }
`;
