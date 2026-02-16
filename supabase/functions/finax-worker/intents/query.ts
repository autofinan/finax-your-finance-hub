// ============================================================================
// 📊 INTENT: QUERY (Consultas) - v3.3 Data-First Architecture + YESTERDAY
// ============================================================================
// ✅ ADICIONADO: getYesterdayExpenses para suporte a "e ontem?"
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 TIPOS (Data-First)
// ============================================================================

export interface MonthlySummaryData {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  transactionCount: number;
}

export interface ExpensesByCategoryData {
  categories: { name: string; total: number; emoji: string }[];
  grandTotal: number;
}

export interface WeeklyExpensesData {
  transactions: { valor: number; descricao: string; categoria: string; data: string }[];
  total: number;
  startDate: string;
  endDate: string;
}

export interface TodayExpensesData {
  transactions: { valor: number; descricao: string; categoria: string }[];
  total: number;
  date: string;
}

// ✅ NOVO: Tipo para gastos de ontem
export interface YesterdayExpensesData {
  transactions: { valor: number; descricao: string; categoria: string }[];
  total: number;
  date: string;
}

export interface PendingExpensesData {
  pending: { id: string; content: string; created_at: string }[];
  count: number;
}

// ============================================================================
// 📊 RESUMO DO MÊS - DATA FUNCTION
// ============================================================================

export async function getMonthlySummaryData(userId: string): Promise<MonthlySummaryData> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const { data: transactions } = await supabase
    .from("transacoes")
    .select("valor, tipo")
    .eq("usuario_id", userId)
    .gte("data", startOfMonth.toISOString())
    .eq("status", "confirmada");
  
  let totalIncome = 0;
  let totalExpense = 0;
  
  (transactions || []).forEach((t) => {
    const value = Number(t.valor);
    if (t.tipo === "entrada") totalIncome += value;
    else totalExpense += value;
  });
  
  return {
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    transactionCount: transactions?.length || 0
  };
}

export async function getMonthlySummary(userId: string): Promise<string> {
  const data = await getMonthlySummaryData(userId);
  
  if (data.transactionCount === 0) {
    return "Você ainda não tem transações este mês 📊\n\nManda um gasto pra começar!";
  }
  
  const balanceEmoji = data.balance >= 0 ? "📈" : "📉";
  
  return `📊 *Resumo do Mês*\n\n` +
    `💵 Entradas: *R$ ${data.totalIncome.toFixed(2)}*\n` +
    `💸 Saídas: *R$ ${data.totalExpense.toFixed(2)}*\n` +
    `${balanceEmoji} Saldo: *R$ ${data.balance.toFixed(2)}*`;
}

// ============================================================================
// 📊 GASTOS POR CATEGORIA
// ============================================================================

const categoryEmojis: Record<string, string> = {
  alimentacao: "🍔",
  mercado: "🛒",
  transporte: "🚗",
  saude: "🏥",
  lazer: "🎮",
  moradia: "🏠",
  compras: "🛍️",
  servicos: "✂️",
  outros: "📦"
};

export async function getExpensesByCategoryData(userId: string): Promise<ExpensesByCategoryData> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const { data: transactions } = await supabase
    .from("transacoes")
    .select("valor, categoria")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", startOfMonth.toISOString())
    .eq("status", "confirmada");
  
  const byCategory: Record<string, number> = {};
  
  (transactions || []).forEach((t) => {
    const cat = t.categoria || "outros";
    byCategory[cat] = (byCategory[cat] || 0) + Number(t.valor);
  });
  
  const sorted = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([name, total]) => ({
      name,
      total,
      emoji: categoryEmojis[name] || "📦"
    }));
  
  return {
    categories: sorted,
    grandTotal: sorted.reduce((sum, c) => sum + c.total, 0)
  };
}

export async function getExpensesByCategory(userId: string): Promise<string> {
  const data = await getExpensesByCategoryData(userId);
  
  if (data.categories.length === 0) {
    return "Sem gastos este mês 🎉";
  }
  
  const list = data.categories.map(c => 
    `${c.emoji} ${c.name}: R$ ${c.total.toFixed(2)}`
  ).join("\n");
  
  return `📊 *Gastos por Categoria*\n\n${list}\n\n💸 Total: *R$ ${data.grandTotal.toFixed(2)}*`;
}

// ============================================================================
// 📊 GASTOS DA SEMANA
// ============================================================================

export async function getWeeklyExpensesData(userId: string): Promise<WeeklyExpensesData> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const { data: transactions } = await supabase
    .from("transacoes")
    .select("valor, descricao, categoria, data")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", startOfWeek.toISOString())
    .eq("status", "confirmada")
    .order("data", { ascending: false });
  
  const txList = (transactions || []).map(t => ({
    valor: Number(t.valor),
    descricao: t.descricao || t.categoria || "Gasto",
    categoria: t.categoria || "outros",
    data: t.data
  }));
  
  return {
    transactions: txList,
    total: txList.reduce((s, t) => s + t.valor, 0),
    startDate: startOfWeek.toISOString(),
    endDate: now.toISOString()
  };
}

export async function getWeeklyExpenses(userId: string): Promise<string> {
  const data = await getWeeklyExpensesData(userId);
  
  if (data.transactions.length === 0) {
    return "📊 Nenhum gasto esta semana! 🎉";
  }
  
  const list = data.transactions.slice(0, 10).map(t => 
    `💸 R$ ${t.valor.toFixed(2)} - ${t.descricao}`
  ).join("\n");
  
  return `📊 *Gastos da Semana*\n\n${list}\n\n💸 Total: *R$ ${data.total.toFixed(2)}*`;
}

// ============================================================================
// 📊 GASTOS DE HOJE
// ============================================================================

export async function getTodayExpensesData(userId: string): Promise<TodayExpensesData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { data } = await supabase
    .from("transacoes")
    .select("valor, descricao, categoria")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", today.toISOString())
    .eq("status", "confirmada");
  
  const txList = (data || []).map(t => ({
    valor: Number(t.valor),
    descricao: t.descricao || t.categoria || "Gasto",
    categoria: t.categoria || "outros"
  }));
  
  return {
    transactions: txList,
    total: txList.reduce((s, t) => s + t.valor, 0),
    date: today.toISOString()
  };
}

export async function getTodayExpenses(userId: string): Promise<string> {
  const data = await getTodayExpensesData(userId);
  
  if (data.transactions.length === 0) {
    return "📊 Nenhum gasto hoje! 🎉";
  }
  
  const list = data.transactions.map(t => 
    `💸 R$ ${t.valor.toFixed(2)} - ${t.descricao}`
  ).join("\n");
  
  return `📊 *Gastos de Hoje*\n\n${list}\n\n💸 Total: *R$ ${data.total.toFixed(2)}*`;
}

// ============================================================================
// ✅ NOVO: 📊 GASTOS DE ONTEM
// ============================================================================

export async function getYesterdayExpensesData(userId: string): Promise<YesterdayExpensesData> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);
  
  const { data } = await supabase
    .from("transacoes")
    .select("valor, descricao, categoria")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", yesterday.toISOString())
    .lte("data", endOfYesterday.toISOString())
    .eq("status", "confirmada");
  
  const txList = (data || []).map(t => ({
    valor: Number(t.valor),
    descricao: t.descricao || t.categoria || "Gasto",
    categoria: t.categoria || "outros"
  }));
  
  return {
    transactions: txList,
    total: txList.reduce((s, t) => s + t.valor, 0),
    date: yesterday.toISOString()
  };
}

export async function getYesterdayExpenses(userId: string): Promise<string> {
  const data = await getYesterdayExpensesData(userId);
  
  if (data.transactions.length === 0) {
    return "📊 Nenhum gasto ontem! 🎉";
  }
  
  const list = data.transactions.map(t => 
    `💸 R$ ${t.valor.toFixed(2)} - ${t.descricao}`
  ).join("\n");
  
  return `📊 *Gastos de Ontem*\n\n${list}\n\n💸 Total: *R$ ${data.total.toFixed(2)}*`;
}

// ============================================================================
// 📬 GASTOS PENDENTES
// ============================================================================

export async function getPendingExpensesData(userId: string): Promise<PendingExpensesData> {
  const { data } = await supabase
    .from("pending_messages")
    .select("id, message_text, created_at")
    .eq("user_id", userId)
    .eq("processed", false)
    .order("created_at", { ascending: false })
    .limit(10);
  
  return {
    pending: (data || []).map(p => ({
      id: p.id,
      content: p.message_text,
      created_at: p.created_at
    })),
    count: data?.length || 0
  };
}

export async function listPendingExpenses(userId: string): Promise<string> {
  const data = await getPendingExpensesData(userId);
  
  if (data.count === 0) {
    return "📬 Nenhum gasto pendente! Tudo registrado ✅";
  }
  
  const list = data.pending.map((p, i) => `${i + 1}. ${p.content}`).join("\n");
  return `📬 *Gastos Pendentes*\n\n${list}\n\n_Quer que eu registre algum desses? Responde com o número._`;
}

// ============================================================================
// 💳 DETALHAMENTO DE FATURA
// ============================================================================

export interface InvoiceDetailData {
  cardName: string;
  mes: number;
  ano: number;
  valorTotal: number;
  valorPago: number;
  status: string;
  transactions: { descricao: string; valor: number; categoria: string; data: string; parcela: string | null }[];
  parcelas: { descricao: string; valor: number; numeroParcela: number; totalParcelas: number }[];
}

export async function getInvoiceDetail(userId: string, cardName?: string, mes?: number, ano?: number): Promise<string> {
  // Determine target month/year using Brasilia time
  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const brasiliaTime = new Date(now.getTime() + (brasiliaOffset - now.getTimezoneOffset()) * 60000);
  
  const targetMes = mes || (brasiliaTime.getMonth() + 1);
  const targetAno = ano || brasiliaTime.getFullYear();
  
  // Find card if specified
  let cardFilter: string | null = null;
  if (cardName) {
    const { data: cards } = await supabase
      .from("cartoes_credito")
      .select("id, nome")
      .eq("usuario_id", userId);
    
    const normalized = cardName.toLowerCase().trim();
    const match = (cards || []).find(c => 
      (c.nome || "").toLowerCase().includes(normalized)
    );
    if (match) cardFilter = match.id;
  }
  
  // Get invoice(s)
  let query = supabase
    .from("faturas_cartao")
    .select("id, cartao_id, mes, ano, valor_total, valor_pago, status")
    .eq("usuario_id", userId)
    .eq("mes", targetMes)
    .eq("ano", targetAno);
  
  if (cardFilter) query = query.eq("cartao_id", cardFilter);
  
  const { data: faturas } = await query;
  
  if (!faturas || faturas.length === 0) {
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    return `📄 Não encontrei fatura de *${meses[targetMes - 1]}/${targetAno}*${cardName ? ` no ${cardName}` : ""}.\n\nTente: "detalhar fatura março" ou "fatura do nubank"`;
  }
  
  let response = "";
  
  for (const fatura of faturas) {
    // Get card name
    const { data: card } = await supabase
      .from("cartoes_credito")
      .select("nome")
      .eq("id", fatura.cartao_id)
      .single();
    
    const cartaoNome = card?.nome || "Cartão";
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    
    response += `💳 *Fatura ${cartaoNome} - ${meses[fatura.mes! - 1]}/${fatura.ano}*\n`;
    response += `📊 Status: *${fatura.status}*\n\n`;
    
    // Get transactions for this invoice
    const { data: txs } = await supabase
      .from("transacoes")
      .select("descricao, valor, categoria, data, parcela")
      .eq("fatura_id", fatura.id)
      .eq("tipo", "saida")
      .order("data", { ascending: false });
    
    // Get parcelas for this invoice
    const { data: parcelas } = await supabase
      .from("parcelas")
      .select("descricao, valor, numero_parcela, total_parcelas")
      .eq("fatura_id", fatura.id)
      .order("numero_parcela", { ascending: true });
    
    const items: string[] = [];
    const categoryEmojis: Record<string, string> = {
      alimentacao: "🍔", mercado: "🛒", transporte: "🚗", saude: "🏥",
      lazer: "🎮", moradia: "🏠", compras: "🛍️", servicos: "✂️", outros: "📦"
    };
    
    // Transactions
    for (const tx of (txs || [])) {
      const emoji = categoryEmojis[tx.categoria || "outros"] || "📦";
      const parcelaTag = tx.parcela ? ` (${tx.parcela})` : "";
      items.push(`${emoji} ${tx.descricao || tx.categoria}${parcelaTag} — R$ ${Number(tx.valor).toFixed(2)}`);
    }
    
    // Parcelas without matching transaction
    for (const p of (parcelas || [])) {
      const hasTx = (txs || []).some(t => t.descricao === p.descricao && t.parcela === `${p.numero_parcela}/${p.total_parcelas}`);
      if (!hasTx) {
        items.push(`📦 ${p.descricao} (${p.numero_parcela}/${p.total_parcelas}) — R$ ${Number(p.valor).toFixed(2)}`);
      }
    }
    
    if (items.length === 0) {
      response += "_Nenhuma compra registrada_\n\n";
    } else {
      response += items.join("\n") + "\n\n";
    }
    
    const pago = Number(fatura.valor_pago || 0);
    const total = Number(fatura.valor_total || 0);
    response += `💰 *Total: R$ ${total.toFixed(2)}*\n`;
    if (pago > 0) {
      response += `✅ Pago: R$ ${pago.toFixed(2)}\n`;
      if (pago < total) {
        response += `⚠️ Restante: R$ ${(total - pago).toFixed(2)}\n`;
      }
    }
    response += "\n";
  }
  
  return response.trim();
}

// ============================================================================
// 💳 PREVISÃO DE FATURA FUTURA (com recorrentes + parcelas)
// ============================================================================

export async function getFutureInvoicePreview(userId: string, cardName?: string, mes?: number, ano?: number): Promise<string> {
  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const brasiliaTime = new Date(now.getTime() + (brasiliaOffset - now.getTimezoneOffset()) * 60000);
  
  const targetMes = mes || (brasiliaTime.getMonth() + 2); // next month by default
  let targetAno = ano || brasiliaTime.getFullYear();
  let adjustedMes = targetMes;
  if (adjustedMes > 12) { adjustedMes -= 12; targetAno += 1; }
  
  // Find card
  let cardId: string | null = null;
  let resolvedCardName = cardName || "Todos cartões";
  
  if (cardName) {
    const { data: cards } = await supabase
      .from("cartoes_credito")
      .select("id, nome")
      .eq("usuario_id", userId);
    const match = (cards || []).find(c => (c.nome || "").toLowerCase().includes(cardName.toLowerCase()));
    if (match) { cardId = match.id; resolvedCardName = match.nome || cardName; }
  }
  
  // Existing invoice data
  let invoiceQuery = supabase
    .from("faturas_cartao")
    .select("id, valor_total, cartao_id")
    .eq("usuario_id", userId)
    .eq("mes", adjustedMes)
    .eq("ano", targetAno);
  if (cardId) invoiceQuery = invoiceQuery.eq("cartao_id", cardId);
  const { data: existingInvoices } = await invoiceQuery;
  
  let totalExisting = 0;
  for (const inv of (existingInvoices || [])) {
    totalExisting += Number(inv.valor_total || 0);
  }
  
  // Future parcelas for that month
  let parcelaQuery = supabase
    .from("parcelas")
    .select("descricao, valor, numero_parcela, total_parcelas")
    .eq("usuario_id", userId)
    .eq("status", "futura")
    .gte("mes_referencia", `${targetAno}-${String(adjustedMes).padStart(2, "0")}-01`)
    .lt("mes_referencia", `${targetAno}-${String(adjustedMes + 1 > 12 ? 1 : adjustedMes + 1).padStart(2, "0")}-01`);
  if (cardId) parcelaQuery = parcelaQuery.eq("cartao_id", cardId);
  const { data: futureParcelas } = await parcelaQuery;
  
  // Active recurrentes on credit
  let recQuery = supabase
    .from("gastos_recorrentes")
    .select("descricao, valor_parcela, categoria")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .eq("tipo_recorrencia", "mensal");
  const { data: recorrentes } = await recQuery;
  
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let response = `🔮 *Previsão Fatura ${resolvedCardName} - ${meses[adjustedMes - 1]}/${targetAno}*\n\n`;
  
  if (totalExisting > 0) {
    response += `📊 Já registrado: R$ ${totalExisting.toFixed(2)}\n`;
  }
  
  let totalParcelas = 0;
  if (futureParcelas && futureParcelas.length > 0) {
    response += `\n📦 *Parcelas:*\n`;
    for (const p of futureParcelas) {
      response += `  • ${p.descricao} (${p.numero_parcela}/${p.total_parcelas}) — R$ ${Number(p.valor).toFixed(2)}\n`;
      totalParcelas += Number(p.valor);
    }
  }
  
  let totalRecorrentes = 0;
  if (recorrentes && recorrentes.length > 0) {
    response += `\n🔄 *Recorrentes:*\n`;
    for (const r of recorrentes) {
      response += `  • ${r.descricao || r.categoria} — R$ ${Number(r.valor_parcela).toFixed(2)}\n`;
      totalRecorrentes += Number(r.valor_parcela);
    }
  }
  
  const grandTotal = totalExisting + totalParcelas + totalRecorrentes;
  response += `\n💰 *Previsão total: R$ ${grandTotal.toFixed(2)}*`;
  
  return response;
}
