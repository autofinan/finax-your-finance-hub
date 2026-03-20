// ============================================================================
// 🔧 HELPERS - Utilidades extraídas do index.ts
// ============================================================================

import { parseBrazilianAmount } from "./parseAmount.ts";
import { logger } from "./logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ============================================================================
// 🔤 NORMALIZAÇÃO E DETECÇÃO
// ============================================================================

export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

export function detectQueryScope(normalized: string): string {
  // Relatórios
  if ((normalized.includes("relatorio") || normalized.includes("report")) && 
      (normalized.includes("semanal") || normalized.includes("semana"))) return "weekly_report";
  if (normalized.includes("relatorio") || normalized.includes("report")) return "report";
  
  // Faturas
  if (normalized.includes("fatura") && (normalized.includes("detalh") || normalized.includes("tem na") || normalized.includes("abrir") || normalized.includes("ver"))) return "invoice_detail";
  if (normalized.includes("detalh") && normalized.includes("fatura")) return "invoice_detail";
  if (normalized.includes("fatura") && (normalized.includes("futur") || normalized.includes("proximo") || normalized.includes("proxima") || normalized.includes("mes que vem") || normalized.includes("previsao"))) return "invoice_future";
  if (normalized.includes("fatura")) return "invoice_detail";
  
  // Cartões
  if (normalized.includes("cartao") || normalized.includes("cartoes") || normalized.includes("limite")) return "cards";
  
  // Contas a pagar
  if (normalized.includes("conta") && normalized.includes("pagar")) return "bills";
  if (normalized.includes("contas") && !normalized.includes("gastei")) return "bills";
  
  // Orçamentos
  if (normalized.includes("orcamento") || normalized.includes("orcamentos") || 
      normalized.includes("limite mensal") || normalized.includes("budget")) return "budgets";
  
  // Recorrentes
  if (normalized.includes("recorrente") || normalized.includes("recorrencia") || 
      normalized.includes("recorrencias") || normalized.includes("assinatura") || 
      normalized.includes("assinaturas") || normalized.includes("fixos") || 
      normalized.includes("gastos fixos") || normalized.includes("gastos mensais")) return "recurring";
  
  // Parcelamentos
  if (normalized.includes("parcelamento") || normalized.includes("parcela") || 
      normalized.includes("parcelado") || normalized.includes("parcelas")) return "installments";
  
  // Metas
  if (normalized.includes("meta") || normalized.includes("metas") || 
      normalized.includes("poupanca")) return "goals";
  
  // Pendentes
  if (normalized.includes("pendente") || normalized.includes("pendentes")) return "pending";
  
  // Categorias
  if (normalized.includes("categoria") || normalized.includes("categorias")) return "category";
  
  // Entradas
  if (normalized.includes("recebi") || normalized.includes("entrada") || 
      normalized.includes("entrou")) return "income";
  
  // Gastos
  if (normalized.includes("gastei") || normalized.includes("gasto") || 
      normalized.includes("gastos")) return "expenses";
  
  // Resumo
  if (normalized.includes("resumo")) return "summary";
  
  return "summary";
}

export function detectTimeRange(normalized: string): string {
  if (normalized.includes("hoje")) return "today";
  if (normalized.includes("semana") || normalized.includes("semanal")) return "week";
  if (normalized.includes("mes") || normalized.includes("mensal")) return "month";
  return "month";
}

export function isNumericOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[\d\.,]+$/.test(trimmed)) return false;
  const normalized = trimmed.replace(",", ".");
  const value = parseFloat(normalized);
  return !isNaN(value) && value > 0;
}

export function parseNumericValue(text: string): number | null {
  return parseBrazilianAmount(text);
}

export function logDecision(data: { messageId: string; decision: string; details?: any }) {
  logger.info({
    component: "decision",
    messageId: data.messageId,
    intent: data.decision,
    ...data.details
  }, "Decision logged");
}

export function extractPaymentMethodFromText(normalizedText: string): "pix" | "debito" | "credito" | "dinheiro" | null {
  const normalized = normalizeText(normalizedText);

  if (normalized.includes("pix")) return "pix";
  // Regra de negócio: texto explícito "débito" deve registrar como débito
  if (normalized.includes("debito") || normalized.includes("débito") || normalized.includes("debit")) return "debito";
  if (normalized.includes("credito") || normalized.includes("crédito") || normalized.includes("cartao") || normalized.includes("cartão")) return "credito";
  if (normalized.includes("dinheiro") || normalized.includes("cash") || normalized.includes("especie") || normalized.includes("espécie")) return "dinheiro";

  return null;
}

export function extractSlotValue(message: string, slotType: string): any {
  const normalized = normalizeText(message);

  switch (slotType) {
    case "amount":
    case "value": {
      const numMatch = message.match(/(\d+[.,]?\d*)/);
      if (numMatch) return parseBrazilianAmount(numMatch[1]);
      return null;
    }
    case "payment_method":
      return extractPaymentMethodFromText(normalized);

    case "source":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("dinheiro")) return "dinheiro";
      if (normalized.includes("transfer")) return "transferencia";
      return null;

    case "type_choice":
      if (normalized.includes("gasto") || normalized.includes("gastei") || normalized.includes("paguei")) return "expense";
      if (normalized.includes("entrada") || normalized.includes("recebi") || normalized.includes("ganhei")) return "income";
      return null;

    default:
      return message.trim() || null;
  }
}

// ============================================================================
// ✏️ EDIT - Buscar e corrigir última transação
// ============================================================================

export async function getLastTransaction(userId: string, withinMinutes: number = 2): Promise<any | null> {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("status", "confirmada")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data || null;
}

export async function updateTransactionPaymentMethod(
  txId: string,
  newMethod: string
): Promise<{ success: boolean; message: string }> {
  const { data: tx, error } = await supabase
    .from("transacoes")
    .update({ forma_pagamento: newMethod })
    .eq("id", txId)
    .select("valor, descricao, categoria")
    .single();

  if (error || !tx) {
    console.error("❌ [EDIT] Erro ao atualizar:", error);
    return { success: false, message: "Não consegui corrigir 😕" };
  }

  const paymentEmoji =
    newMethod === "pix" ? "📱" :
    newMethod === "dinheiro" ? "💵" :
    newMethod === "credito" ? "💳" : "💵";

  return {
    success: true,
    message: `✅ *Corrigido!*\n\n💸 R$ ${tx.valor?.toFixed(2)} agora é *${paymentEmoji} ${newMethod}*`
  };
}

// ============================================================================
// 📊 RESUMO MENSAL
// ============================================================================

export async function getMonthlySummary(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo")
    .eq("usuario_id", userId)
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada");

  let totalEntradas = 0, totalSaidas = 0;
  transacoes?.forEach((t: any) => {
    if (t.tipo === "entrada") totalEntradas += Number(t.valor);
    else totalSaidas += Number(t.valor);
  });

  const saldo = totalEntradas - totalSaidas;

  return !transacoes || transacoes.length === 0
    ? "Você ainda não tem transações este mês 📊\n\nManda um gasto!"
    : `📊 *Resumo do Mês*\n\n💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
}
