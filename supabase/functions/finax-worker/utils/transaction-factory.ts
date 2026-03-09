// ============================================================================
// 🏭 TRANSACTION FACTORY - Unified Transaction Creation
// ============================================================================
// Centraliza a criação de transações para evitar duplicação de código.
// Usado por: expense-inline.ts, expense.ts, recurring-handler.ts, income.ts
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { categorizeDescription, type CategorizationResult } from "../ai/categorizer.ts";
import { getBrasiliaISO } from "./date-helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 TIPOS
// ============================================================================

export interface TransactionParams {
  userId: string;
  valor: number;
  tipo: "entrada" | "saida";
  descricao?: string;
  categoria?: string;
  formaPagamento?: string;
  cartaoId?: string;
  origem?: string;
  recorrente?: boolean;
  idRecorrente?: string;
  contextId?: string;
  expenseType?: string;
  dataISO?: string;
  horaString?: string;
  idempotencyKey?: string;
  parcelaInfo?: string;
  isParcelado?: boolean;
  totalParcelas?: number;
}

export interface TransactionResult {
  success: boolean;
  transactionId?: string;
  categoria?: string;
  categorizationResult?: CategorizationResult;
  error?: string;
}

// ============================================================================
// 🏷️ CLASSIFICAÇÃO DE EXPENSE_TYPE
// ============================================================================

const EXPENSE_TYPE_RULES: Record<string, string[]> = {
  essencial_fixo: [
    "aluguel", "condominio", "condomínio", "iptu", "internet", "agua", "água",
    "luz", "energia", "gas", "gás", "seguro", "plano de saude", "plano de saúde"
  ],
  essencial_variavel: [
    "mercado", "supermercado", "feira", "farmacia", "farmácia", "combustivel",
    "combustível", "gasolina", "etanol", "remedio", "remédio", "hortifruti"
  ],
  estrategico: [
    "academia", "curso", "faculdade", "escola", "livro", "educacao", "educação",
    "saude", "saúde", "dentista", "medico", "médico", "terapia", "investimento"
  ],
  divida: [
    "fatura", "emprestimo", "empréstimo", "financiamento", "juros",
    "parcela", "cheque especial", "quitação", "quitacao"
  ],
};

export function classifyExpenseType(descricao: string, categoria?: string): string {
  const text = `${descricao} ${categoria || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  for (const [expenseType, keywords] of Object.entries(EXPENSE_TYPE_RULES)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return expenseType;
      }
    }
  }
  return "flexivel"; // default
}

// ============================================================================
// 🧹 LIMPAR DESCRIÇÃO
// ============================================================================

export function cleanDescription(text: string): string {
  if (!text) return "";
  
  let cleaned = text.trim();
  const wordCount = cleaned.split(/\s+/).length;
  
  if (wordCount <= 4) {
    cleaned = cleaned
      .replace(/\b(gastei|paguei|comprei|custou|saiu|foi|deu)\b/gi, "")
      .replace(/\b(r\$|reais?|conto)\b/gi, "")
      .replace(/\d+[.,]?\d*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    
    if (cleaned.length > 0) {
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return "";
  }
  
  // Para textos longos: extrair apenas o substantivo principal
  const removePatterns = [
    /\b(cara|mano|irmao|irma|entao|tipo|bom|olha|ai)\b/gi,
    /\b(hoje|ontem|amanha|cedo|tarde|noite|agora|depois|antes)\b/gi,
    /\b(eu|meu|minha|fui|tava|estava|estou|to|tou)\b/gi,
    /\b(gastei|paguei|comprei|custou|fui|saiu|foi|deu|peguei)\b/gi,
    /\b(um|uma|uns|umas|esse|essa|aquele|aquela)\b/gi,
    /\b(r\$|reais?|conto|pila)\b/gi,
    /\b(no|na|do|da|pelo|pela|via|com|para|pra|por|em|de|que|e)\b/gi,
    /\d+[.,]?\d*/g,
    /\b(pix|debito|débito|credito|crédito|dinheiro|cartao|cartão)\b/gi,
  ];
  
  for (const pattern of removePatterns) {
    cleaned = cleaned.replace(pattern, " ");
  }
  
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  
  if (cleaned.length > 50) {
    cleaned = cleaned.substring(0, 50).trim();
  }
  
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned || "";
}

// ============================================================================
// 🏭 CRIAR TRANSAÇÃO
// ============================================================================

export async function createTransaction(params: TransactionParams): Promise<TransactionResult> {
  console.log(`🏭 [FACTORY] Criando transação: ${params.tipo} R$ ${params.valor}`);
  
  // Validação de valor
  if (!params.valor || typeof params.valor !== "number" || params.valor <= 0 || isNaN(params.valor)) {
    console.error(`❌ [FACTORY] Valor inválido: ${params.valor}`);
    return { success: false, error: "Valor inválido" };
  }
  
  // Limpar e categorizar descrição
  let descricao = params.descricao ? cleanDescription(params.descricao) : "";
  
  // Categorização IA
  let categorizationResult: CategorizationResult | undefined;
  let categoria = params.categoria || "outros";
  
  if (descricao && !params.categoria) {
    categorizationResult = await categorizeDescription(descricao);
    categoria = categorizationResult.category;
    console.log(`📂 [FACTORY] Categorização: "${descricao}" → ${categoria} (${categorizationResult.source})`);
  }
  
  // Data e hora
  let dateISO: string;
  let timeString: string;
  
  if (params.dataISO && params.horaString) {
    dateISO = params.dataISO;
    timeString = params.horaString;
  } else if (params.dataISO) {
    dateISO = params.dataISO;
    timeString = params.dataISO.substring(11, 16);
  } else {
    const result = getBrasiliaISO();
    dateISO = result.dateISO;
    timeString = result.timeString;
  }
  
  // Expense type (apenas para saídas)
  const expenseType = params.tipo === "saida" 
    ? (params.expenseType || classifyExpenseType(descricao, categoria))
    : null;
  
  // Forma de pagamento
  const formaPagamento = (params.formaPagamento && params.formaPagamento !== "unknown" && params.formaPagamento !== "outro") 
    ? params.formaPagamento 
    : "outro";
  
  // Insert
  const insertData: Record<string, any> = {
    usuario_id: params.userId,
    valor: params.valor,
    tipo: params.tipo,
    categoria,
    descricao: descricao || categoria,
    data: dateISO,
    data_transacao: dateISO,
    hora_transacao: timeString,
    origem: params.origem || "whatsapp",
    forma_pagamento: formaPagamento,
    status: "confirmada"
  };
  
  // Campos opcionais
  if (params.cartaoId) insertData.cartao_id = params.cartaoId;
  if (params.recorrente) insertData.recorrente = true;
  if (params.idRecorrente) insertData.id_recorrente = params.idRecorrente;
  if (params.contextId) insertData.context_id = params.contextId;
  if (expenseType) insertData.expense_type = expenseType;
  if (params.idempotencyKey) insertData.idempotency_key = params.idempotencyKey;
  if (params.parcelaInfo) insertData.parcela = params.parcelaInfo;
  if (params.isParcelado !== undefined) insertData.is_parcelado = params.isParcelado;
  if (params.totalParcelas) insertData.total_parcelas = params.totalParcelas;
  
  const { data: tx, error } = await supabase
    .from("transacoes")
    .insert(insertData)
    .select("id")
    .single();
  
  if (error) {
    console.error("❌ [FACTORY] Erro ao criar transação:", error);
    return { success: false, error: error.message };
  }
  
  console.log(`✅ [FACTORY] Transação criada: ${tx.id}`);
  
  return {
    success: true,
    transactionId: tx.id,
    categoria,
    categorizationResult
  };
}

// ============================================================================
// 🔄 ATUALIZAR TRANSAÇÃO
// ============================================================================

export async function updateTransaction(
  transactionId: string,
  updates: Partial<{
    categoria: string;
    descricao: string;
    forma_pagamento: string;
    cartao_id: string;
    status: string;
    id_recorrente: string;
    context_id: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("transacoes")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", transactionId);
  
  if (error) {
    console.error(`❌ [FACTORY] Erro ao atualizar transação ${transactionId}:`, error);
    return { success: false, error: error.message };
  }
  
  console.log(`✅ [FACTORY] Transação ${transactionId} atualizada`);
  return { success: true };
}

// ============================================================================
// 📊 HELPERS DE FORMATAÇÃO
// ============================================================================

export function formatTransactionConfirmation(params: {
  valor: number;
  categoria: string;
  descricao?: string;
  formaPagamento?: string;
  cartaoNome?: string;
  dateISO: string;
  tipo: "entrada" | "saida";
}): string {
  const { valor, categoria, descricao, formaPagamento, cartaoNome, dateISO, tipo } = params;
  
  // Extrair data/hora do ISO
  const [datePart] = dateISO.split('T');
  const [y, m, d] = datePart.split('-');
  const dataFormatada = `${d}/${m}/${y}`;
  const horaFormatada = dateISO.substring(11, 16);
  
  // Emoji por categoria
  const catEmojis: Record<string, string> = {
    alimentacao: "🍽️",
    mercado: "🛒",
    transporte: "🚗",
    moradia: "🏠",
    lazer: "🎮",
    saude: "💊",
    educacao: "📚",
    outros: "📦"
  };
  
  const emoji = tipo === "entrada" ? "💰" : (catEmojis[categoria] || "💸");
  const sinal = tipo === "entrada" ? "+" : "-";
  const label = tipo === "entrada" ? "Entrada registrada!" : "Gasto registrado!";
  
  let message = `${emoji} *${label}*\n\n${sinal}R$ ${valor.toFixed(2)}\n📂 ${categoria}`;
  
  if (descricao) {
    message += `\n📝 ${descricao}`;
  }
  
  if (formaPagamento) {
    message += `\n💳 ${formaPagamento}`;
    if (cartaoNome) {
      message += ` (${cartaoNome})`;
    }
  }
  
  message += `\n📅 ${dataFormatada} às ${horaFormatada}`;
  
  return message;
}
