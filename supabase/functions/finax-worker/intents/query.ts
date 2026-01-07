// ============================================================================
// 📊 INTENT: QUERY (Consultas)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📊 RESUMO DO MÊS
// ============================================================================

export async function getMonthlySummary(userId: string): Promise<string> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const { data: transactions } = await supabase
    .from("transacoes")
    .select("valor, tipo")
    .eq("usuario_id", userId)
    .gte("data", startOfMonth.toISOString())
    .eq("status", "confirmada");
  
  if (!transactions || transactions.length === 0) {
    return "Você ainda não tem transações este mês 📊\n\nManda um gasto pra começar!";
  }
  
  let totalIncome = 0;
  let totalExpense = 0;
  
  transactions.forEach((t) => {
    const value = Number(t.valor);
    if (t.tipo === "entrada") totalIncome += value;
    else totalExpense += value;
  });
  
  const balance = totalIncome - totalExpense;
  
  const balanceEmoji = balance >= 0 ? "📈" : "📉";
  
  return `📊 *Resumo do Mês*\n\n` +
    `💵 Entradas: *R$ ${totalIncome.toFixed(2)}*\n` +
    `💸 Saídas: *R$ ${totalExpense.toFixed(2)}*\n` +
    `${balanceEmoji} Saldo: *R$ ${balance.toFixed(2)}*`;
}

// ============================================================================
// 📊 GASTOS POR CATEGORIA
// ============================================================================

export async function getExpensesByCategory(userId: string): Promise<string> {
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
  
  if (!transactions || transactions.length === 0) {
    return "Sem gastos este mês 🎉";
  }
  
  // Agrupar por categoria
  const byCategory: Record<string, number> = {};
  
  transactions.forEach((t) => {
    const cat = t.categoria || "outros";
    byCategory[cat] = (byCategory[cat] || 0) + Number(t.valor);
  });
  
  // Ordenar por valor
  const sorted = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a);
  
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
  
  const list = sorted.map(([cat, value]) => 
    `${categoryEmojis[cat] || "📦"} ${cat}: R$ ${value.toFixed(2)}`
  ).join("\n");
  
  const total = sorted.reduce((sum, [, value]) => sum + value, 0);
  
  return `📊 *Gastos por Categoria*\n\n${list}\n\n💸 Total: *R$ ${total.toFixed(2)}*`;
}
