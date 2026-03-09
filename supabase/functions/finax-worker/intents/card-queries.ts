// ============================================================================
// 💳 CARD QUERIES - Extraído de index.ts para modularização
// ============================================================================
// listCardsForUser, updateCardLimit, queryCardLimits, queryCardExpenses
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// ============================================================================
// 💳 LISTAR CARTÕES
// ============================================================================

export async function listCardsForUser(userId: string): Promise<any[]> {
  const { data } = await supabase.from("cartoes_credito").select("*").eq("usuario_id", userId).eq("ativo", true);
  return data || [];
}

// ============================================================================
// 💳 ATUALIZAR LIMITE
// ============================================================================

export async function updateCardLimit(userId: string, cardName: string, newLimit: number): Promise<{ success: boolean; message: string }> {
  const cards = await listCardsForUser(userId);
  const card = cards.find(c => normalizeText(c.nome || "").includes(normalizeText(cardName)));
  
  if (!card) {
    return { success: false, message: `Não encontrei o cartão "${cardName}" 💳\n\nQuer ver seus cartões? Manda "ver cartões"` };
  }
  
  await supabase.from("cartoes_credito").update({ limite_total: newLimit, limite_disponivel: newLimit }).eq("id", card.id);
  
  return { success: true, message: `✅ Limite do *${card.nome}* atualizado para R$ ${newLimit.toFixed(2)}` };
}

// ============================================================================
// 💳 CONSULTAR LIMITES DE CARTÕES
// ============================================================================

export async function queryCardLimits(userId: string): Promise<string> {
  const { data: cards } = await supabase
    .from("cartoes_credito")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true);
  
  if (!cards || cards.length === 0) {
    return "Você não tem cartões cadastrados 💳";
  }
  
  const lista = cards.map(c => {
    const total = c.limite_total || 0;
    const disponivel = c.limite_disponivel || 0;
    const usado = total - disponivel;
    return `💳 *${c.nome}*\n   Total: R$ ${total.toFixed(2)}\n   Disponível: R$ ${disponivel.toFixed(2)}\n   Usado: R$ ${usado.toFixed(2)}`;
  }).join("\n\n");
  
  return `💳 *Seus Cartões*\n\n${lista}`;
}

// ============================================================================
// 💳 GASTOS POR CARTÃO
// ============================================================================

export async function queryCardExpenses(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: gastos } = await supabase
    .from("transacoes")
    .select("valor, cartao_id")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .eq("forma_pagamento", "credito")
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada")
    .limit(10000);
  
  if (!gastos || gastos.length === 0) {
    return "Nenhum gasto no crédito este mês 💳";
  }
  
  const cardIds = [...new Set(gastos.map(g => g.cartao_id).filter(Boolean))];
  const { data: cards } = await supabase
    .from("cartoes_credito")
    .select("id, nome")
    .in("id", cardIds.length > 0 ? cardIds : ["none"]);
  
  const cardMap = new Map(cards?.map(c => [c.id, c.nome]) || []);
  
  const byCard: Record<string, { nome: string; total: number; count: number }> = {};
  gastos.forEach(g => {
    const cardName = g.cartao_id ? (cardMap.get(g.cartao_id) || "Outro") : "Sem cartão";
    if (!byCard[cardName]) byCard[cardName] = { nome: cardName, total: 0, count: 0 };
    byCard[cardName].total += Number(g.valor);
    byCard[cardName].count += 1;
  });
  
  const lista = Object.values(byCard)
    .map(c => `💳 ${c.nome}: R$ ${c.total.toFixed(2)} (${c.count} gastos)`)
    .join("\n");
  
  return `💳 *Gastos por Cartão (este mês)*\n\n${lista}`;
}

// ============================================================================
// 📍 GASTOS POR CONTEXTO
// ============================================================================

export async function queryContextExpenses(userId: string, contextId: string): Promise<{ total: number; count: number }> {
  const { data: gastos } = await supabase
    .from("transacoes")
    .select("valor")
    .eq("context_id", contextId)
    .eq("status", "confirmada")
    .limit(10000);
  
  const total = gastos?.reduce((sum, g) => sum + Number(g.valor), 0) || 0;
  return { total, count: gastos?.length || 0 };
}
