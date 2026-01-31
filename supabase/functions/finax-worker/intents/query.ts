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
