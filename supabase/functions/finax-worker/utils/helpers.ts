// ============================================================================
// 🔧 HELPERS - Utilidades extraídas do index.ts
// ============================================================================

import { parseBrazilianAmount } from "./parseAmount.ts";
import { logger } from "./logger.ts";

export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

export function detectQueryScope(normalized: string): string {
  if ((normalized.includes("relatorio") || normalized.includes("report")) && normalized.includes("semanal")) return "weekly_report";
  if (normalized.includes("fatura") && (normalized.includes("detalh") || normalized.includes("tem na") || normalized.includes("abrir") || normalized.includes("ver"))) return "invoice_detail";
  if (normalized.includes("detalh") && normalized.includes("fatura")) return "invoice_detail";
  if (normalized.includes("fatura") && (normalized.includes("futur") || normalized.includes("proximo") || normalized.includes("proxima") || normalized.includes("mes que vem") || normalized.includes("previsao"))) return "invoice_future";
  if (normalized.includes("cartao") || normalized.includes("cartoes") || normalized.includes("limite")) return "cards";
  if (normalized.includes("pendente") || normalized.includes("pendentes")) return "pending";
  if (normalized.includes("categoria") || normalized.includes("categorias")) return "category";
  if (normalized.includes("recebi") || normalized.includes("entrada") || normalized.includes("entrou")) return "income";
  if (normalized.includes("recorrente") || normalized.includes("assinatura")) return "recurring";
  if (normalized.includes("parcelamento") || normalized.includes("parcela") || normalized.includes("parcelado")) return "installments";
  if (normalized.includes("meta") || normalized.includes("metas") || normalized.includes("poupanca")) return "goals";
  if (normalized.includes("gastei") || normalized.includes("gasto")) return "expenses";
  if (normalized.includes("fatura")) return "invoice_detail";
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

export function extractSlotValue(message: string, slotType: string): any {
  const normalized = normalizeText(message);
  
  switch (slotType) {
    case "amount":
    case "value":
      const numMatch = message.match(/(\d+[.,]?\d*)/);
      if (numMatch) return parseBrazilianAmount(numMatch[1]);
      return null;
      
    case "payment_method":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("debito") || normalized.includes("débito")) return "debito";
      if (normalized.includes("credito") || normalized.includes("crédito")) return "credito";
      if (normalized.includes("dinheiro")) return "dinheiro";
      return null;
      
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
