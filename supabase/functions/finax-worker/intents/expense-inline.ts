// ============================================================================
// 💸 EXPENSE INLINE - Extraído de index.ts para modularização
// ============================================================================
// registerExpense (versão inline do index.ts) e handleExpenseResult
// NOTA: Esta é a versão USADA pelo index.ts, diferente de intents/expense.ts
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { categorizeDescription } from "../ai/categorizer.ts";
import { getBrasiliaISO } from "../utils/date-helpers.ts";
import { learnMerchantPattern } from "../memory/patterns.ts";
import { parseBrazilianAmount } from "../utils/parseAmount.ts";
import { countPendingMessages } from "../utils/message-queue.ts";
import { ensurePerfilCliente } from "../utils/profile.ts";
import { checkBudgetAfterExpense } from "./budget.ts";
import { linkTransactionToContext, getActiveContext } from "./context-handler.ts";
import { getFreedomMicroInsight } from "./freedom-insights.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 🏷️ CLASSIFICAÇÃO AUTOMÁTICA DE EXPENSE_TYPE
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
  // flexivel é o default (delivery, restaurante, streaming, lazer, etc.)
};

export function classifyExpenseType(descricao: string, categoria?: string): string {
  const text = `${descricao} ${categoria || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  for (const [expenseType, keywords] of Object.entries(EXPENSE_TYPE_RULES)) {
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (text.includes(normalizedKeyword)) {
        return expenseType;
      }
    }
  }
  return "flexivel";
}

type MessageSource = "meta" | "vonage";

interface ExtractedSlots {
  amount?: number;
  description?: string;
  category?: string;
  payment_method?: string;
  card?: string;
  card_id?: string;
  fatura_id?: string;
  transaction_date?: string;
  _skip_duplicate?: boolean;
  [key: string]: any;
}

// ============================================================================
// 💸 REGISTRAR GASTO (versão inline completa do index.ts)
// ============================================================================

// ============================================================================
// 🧹 LIMPAR DESCRIÇÃO VERBOSA DA IA
// ============================================================================
// Transforma frases longas em rótulos curtos
// "Cara, hoje cedo eu fui tomar café da manhã e gastei" → "Café da manhã"
// ============================================================================

const FILLER_WORDS = new Set([
  "cara", "olha", "entao", "então", "tipo", "assim", "ne", "né", "hj", "hoje",
  "cedo", "agora", "ontem", "anteontem", "la", "lá", "aqui", "ali",
  "eu", "fui", "fiz", "tava", "estava", "tive", "dei", "deu",
  "gastei", "paguei", "comprei", "peguei", "custou", "desembolsei",
  "registrar", "registra", "anotar", "anota", "lanca", "lançar",
  "um", "uma", "uns", "umas", "o", "a", "os", "as",
  "esse", "essa", "este", "esta", "aquele", "aquela",
  "gasto", "despesa", "valor", "coisa",
  "por", "com", "sem", "mais", "menos",
  "meu", "minha", "nosso", "nossa",
  "muito", "pouco", "bem", "mal",
  "so", "só", "ja", "já", "ainda",
  "esqueci", "desculpa", "errei",
]);

// Verbos/expressões conversacionais que devem ser removidas por completo
const FILLER_PHRASES = [
  /\b(?:fui|fomos)\s+(?:tomar|comer|beber|fazer|comprar|pegar|pagar)\s+/gi,
  /\b(?:eu|a gente|nós)\s+(?:gastei|gastamos|paguei|pagamos|comprei|compramos)\s+/gi,
  /\b(?:e\s+)?gastei\b/gi,
  /\b(?:e\s+)?paguei\b/gi,
  /\bregistrar?\s+(?:um\s+)?gasto\s+(?:de\s+)?/gi,
  /\bde\s+(?:ontem|hoje|agora)\b/gi,
  /\bhoje\s+cedo\b/gi,
  /\besqueci\s+de\s+registrar?\b/gi,
];

export function cleanDescriptionFromAI(rawDesc: string): string {
  if (!rawDesc || rawDesc.length < 2) return rawDesc;
  
  let cleaned = rawDesc;
  
  // 1. Remover frases filler por padrão de regex
  for (const phrase of FILLER_PHRASES) {
    cleaned = cleaned.replace(phrase, " ");
  }
  
  // 2. Remover palavras filler individuais do início e fim
  let words = cleaned.split(/\s+/).filter(w => w.length > 0);
  
  // Remover filler words do início
  while (words.length > 0 && FILLER_WORDS.has(words[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
    words.shift();
  }
  
  // Remover filler words do fim
  while (words.length > 0 && FILLER_WORDS.has(words[words.length - 1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
    words.pop();
  }
  
  cleaned = words.join(" ").trim();
  
  // 3. Remover valores monetários residuais
  cleaned = cleaned.replace(/r?\$?\s*\d+[.,]?\d*/gi, "").trim();
  
  // 4. Remover preposições soltas no início/fim após limpeza
  cleaned = cleaned.replace(/^(?:de|do|da|no|na|em|por|pro|pra|para)\s+/i, "");
  cleaned = cleaned.replace(/\s+(?:de|do|da|no|na|em|por)$/i, "");
  
  // 5. Limpar espaços
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  
  // 6. Capitalizar
  if (cleaned.length > 1) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  // 7. Cap em 50 chars
  if (cleaned.length > 50) {
    cleaned = cleaned.substring(0, 50).trim();
  }
  
  return cleaned || rawDesc;
}

export async function registerExpenseInline(
  userId: string, 
  slots: ExtractedSlots, 
  actionId?: string,
  createActionFn?: (userId: string, type: string, intent: string, slots: Record<string, any>, pendingSlot?: string | null, messageId?: string | null) => Promise<any>,
  closeActionFn?: (actionId: string, entityId?: string) => Promise<void>
): Promise<{ success: boolean; message: string; isDuplicate?: boolean }> {
  const valor = slots.amount!;
  // 🧹 Limpar descrição verbosa ANTES de categorizar
  const descricao = cleanDescriptionFromAI(slots.description || "");
  
  // 🧠 CATEGORIZAÇÃO IA-FIRST COM AUTOAPRENDIZADO
  const categoryResult = await categorizeDescription(descricao, slots.category);
  const categoria = categoryResult.category;
  
  console.log(`📂 [EXPENSE] Categorização: "${descricao}" → ${categoria} (fonte: ${categoryResult.source}, conf: ${categoryResult.confidence})`);
  if (categoryResult.learned) {
    console.log(`   └─ 🧠 Termo "${categoryResult.keyTerm}" aprendido para futuras transações!`);
  }
  
  const formaPagamento = (slots.payment_method && slots.payment_method !== "unknown" && slots.payment_method !== "outro") 
    ? slots.payment_method 
    : "outro";
  
  // ✅ DEDUPLICAÇÃO
  if (!slots._skip_duplicate) {
    const normalizedDesc = descricao.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const { data: recentTx } = await supabase
      .from("transacoes")
      .select("id, descricao, valor, created_at")
      .eq("usuario_id", userId)
      .eq("tipo", "saida")
      .eq("valor", valor)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (recentTx && recentTx.length > 0) {
      const existingDesc = (recentTx[0].descricao || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (existingDesc === normalizedDesc || normalizedDesc.includes(existingDesc) || existingDesc.includes(normalizedDesc)) {
        console.log(`⚠️ [DEDUPE] Possível duplicata detectada: ${recentTx[0].id}`);
        if (createActionFn) {
          await createActionFn(userId, "duplicate_confirm", "duplicate_expense", {
            ...slots,
            original_tx_id: recentTx[0].id
          }, null, null);
        }
        
        const minutesAgo = Math.round((Date.now() - new Date(recentTx[0].created_at).getTime()) / 60000);
        return {
          success: false,
          isDuplicate: true,
          message: `⚠️ *Possível duplicata!*\n\nVi um gasto igual há ${minutesAgo} min:\n📝 ${recentTx[0].descricao} - R$ ${(recentTx[0].valor ?? 0).toFixed(2)}\n\nQuer registrar mesmo assim?`
        };
      }
    }
  }
  
  // 💳 BUSCAR CARTÃO POR NOME
  let cardId = slots.card_id || null;
  let cardName = slots.card || null;
  
  if (formaPagamento === "credito" && cardName && !cardId) {
    console.log(`💳 [EXPENSE] Buscando cartão por nome: "${cardName}"`);
    
    const { data: foundCard } = await supabase
      .from("cartoes_credito")
      .select("id, nome, limite_disponivel")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .ilike("nome", `%${cardName}%`)
      .limit(1)
      .single();
    
    if (foundCard) {
      cardId = foundCard.id;
      cardName = foundCard.nome;
    } else {
      const { data: firstCard } = await supabase
        .from("cartoes_credito")
        .select("id, nome, limite_disponivel")
        .eq("usuario_id", userId)
        .eq("ativo", true)
        .limit(1)
        .single();
      
      if (firstCard) {
        cardId = firstCard.id;
        cardName = firstCard.nome;
      }
    }
  }
  
  // ✅ DATA
  let dateISO: string;
  let timeString: string;

  if (slots.transaction_date) {
    dateISO = slots.transaction_date;
    timeString = dateISO.substring(11, 16);
  } else {
    const result = getBrasiliaISO();
    dateISO = result.dateISO;
    timeString = result.timeString;
  }

  // 🏷️ AUTO-CLASSIFICAR EXPENSE TYPE
  const expenseType = classifyExpenseType(descricao, categoria);
  console.log(`🏷️ [EXPENSE] expense_type: "${descricao}" → ${expenseType}`);

  const { data: tx, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: dateISO,
    data_transacao: dateISO,
    hora_transacao: timeString,
    origem: "whatsapp",
    forma_pagamento: formaPagamento,
    cartao_id: cardId,
    status: "confirmada",
    expense_type: expenseType
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  // 💳 ATUALIZAR LIMITE DO CARTÃO
  let cardInfo = "";
  if (formaPagamento === "credito" && cardId) {
    const { data: card } = await supabase
      .from("cartoes_credito")
      .select("limite_disponivel, nome")
      .eq("id", cardId)
      .single();
    
    if (card && card.limite_disponivel !== null) {
      const novoLimite = Math.max(0, card.limite_disponivel - valor);
      
      await supabase
        .from("cartoes_credito")
        .update({ limite_disponivel: novoLimite })
        .eq("id", cardId);
      
      cardInfo = `\n💳 ${card.nome || cardName} (disponível: R$ ${novoLimite.toFixed(2)})`;
    }
  } else if (cardName) {
    cardInfo = `\n💳 ${cardName}`;
  }
  
  // 📍 VINCULAR A CONTEXTO ATIVO
  await linkTransactionToContext(userId, tx.id);
  
  const activeCtx = await getActiveContext(userId);
  let contextInfo = "";
  if (activeCtx) {
    contextInfo = `\n📍 _Vinculado a: ${activeCtx.label}_`;
  }
  
  if (actionId && closeActionFn) await closeActionFn(actionId, tx.id);
  
  // 🧠 MEMORY LAYER
  try {
    await learnMerchantPattern({
      userId,
      description: descricao,
      category: categoria,
      paymentMethod: formaPagamento,
      cardId: cardId || undefined,
      transactionId: tx.id,
      wasUserCorrected: false
    });
  } catch (memErr) {
    console.error("⚠️ [MEMORY] Erro não-bloqueante:", memErr);
  }
  
  // 👤 PERFIL
  try {
    await ensurePerfilCliente(userId);
  } catch (perfilErr) {
    console.error("⚠️ [PERFIL] Erro não-bloqueante:", perfilErr);
  }
  
  // 💰 VERIFICAR ORÇAMENTO
  const budgetAlert = await checkBudgetAfterExpense(userId, categoria, valor);
  
  // 📬 FILA
  const pendingCount = await countPendingMessages(userId);
  let queueInfo = "";
  if (pendingCount > 0) {
    queueInfo = `\n\n📬 _Você tem ${pendingCount} gasto(s) pendente(s) que anotei!_`;
  }
  
  // ✅ FORMATAR DATA/HORA
  const [_dp] = dateISO.split('T');
  const [_yy, _mm, _dd] = _dp.split('-');
  const dataFormatada = `${_dd}/${_mm}/${_yy}`;
  const horaFormatada = dateISO.substring(11, 16);
  
  const emoji = categoria === "alimentacao" ? "🍽️" : categoria === "mercado" ? "🛒" : categoria === "transporte" ? "🚗" : "💸";
  
  let message = `${emoji} *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${formaPagamento}${cardInfo}\n📅 ${dataFormatada} às ${horaFormatada}${contextInfo}`;
  
  if (budgetAlert) {
    message += `\n\n${budgetAlert}`;
  }
  
  // 🏁 FREEDOM MICRO-INSIGHT
  const freedomInsight = await getFreedomMicroInsight(userId, valor);
  if (freedomInsight) {
    message += freedomInsight;
  }
  
  if (queueInfo) {
    message += queueInfo;
  }
  
  return { success: true, message };
}

// ============================================================================
// 🔘 HELPER: ENVIAR RESULTADO COM BOTÕES SE DUPLICATA
// ============================================================================

export async function handleExpenseResult(
  result: { success: boolean; message: string; isDuplicate?: boolean },
  phoneNumber: string,
  messageSource: MessageSource,
  sendMessageFn: (to: string, text: string, src: MessageSource) => Promise<boolean>,
  sendButtonsFn: (to: string, bodyText: string, buttons: Array<{ id: string; title: string }>, src: MessageSource) => Promise<boolean>
): Promise<void> {
  if (result.isDuplicate) {
    await sendButtonsFn(phoneNumber, result.message, [
      { id: "duplicate_confirm_yes", title: "✅ Sim, registrar" },
      { id: "duplicate_confirm_no", title: "❌ Não, era erro" }
    ], messageSource);
  } else {
    await sendMessageFn(phoneNumber, result.message, messageSource);
  }
}

// ============================================================================
// 💰 RESUMO MENSAL (versão inline do index.ts)
// ============================================================================

export async function getMonthlySummaryInline(userId: string): Promise<string> {
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
  transacoes?.forEach((t) => {
    if (t.tipo === "entrada") totalEntradas += Number(t.valor);
    else totalSaidas += Number(t.valor);
  });
  
  const saldo = totalEntradas - totalSaidas;
  
  return !transacoes || transacoes.length === 0
    ? "Você ainda não tem transações este mês 📊\n\nManda um gasto!"
    : `📊 *Resumo do Mês*\n\n💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
}
