// ============================================================================
// 🎮 INTENT: CONTROL (Saudação, ajuda, negação)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeText } from "../utils/helpers.ts";
import { cancelAction } from "../fsm/action-manager.ts";
import { getConversationContext, updateConversationContext } from "../utils/conversation-context.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function handleControl(
  userId: string,
  slots: Record<string, any>,
  nomeUsuario: string,
  conteudoProcessado: string,
  isProUser: boolean,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  const normalized = normalizeText(conteudoProcessado);

  // Cancelar ação pendente
  if (normalized.includes("cancela") || normalized.includes("deixa") || normalized.includes("nao")) {
    const cancelled = await cancelAction(userId);
    await sendMessage(phoneNumber, cancelled ? "Ok, descartei! 👍" : "Não tinha nada pendente 🤔", messageSource);
    return;
  }

  // ================================================================
  // 🔍 VERIFICAR SE É FOLLOW-UP DE AJUDA
  // ================================================================
  const helpCtx = await getConversationContext(userId);
  if (helpCtx?.lastIntent === "help") {
    const helpResponse = _getHelpFollowUp(conteudoProcessado);

    if (helpResponse) {
      await updateConversationContext(userId, { lastIntent: null });
      await sendMessage(phoneNumber, helpResponse, messageSource);
      return;
    }

    // Não entendeu o tópico
    await sendMessage(phoneNumber,
      `Não entendi bem... 🤔\n\n` +
      `Você quer ajuda com:\n` +
      `• Registrar gastos?\n` +
      `• Cartões?\n` +
      `• Ver resumo?\n` +
      `• Metas?\n` +
      `• Parcelamentos?\n\n` +
      `Me diz qual!`, messageSource);
    return;
  }

  // ================================================================
  // 📖 AJUDA CONVERSACIONAL (sem botões!)
  // ================================================================
  if (normalized.includes("ajuda") || normalized.includes("help") ||
      normalized.includes("como usar") || normalized.includes("como funciona") ||
      normalized.includes("tutorial") || normalized.includes("comandos")) {

    await updateConversationContext(userId, { lastIntent: "help" });

    await sendMessage(phoneNumber,
      `🤖 *Claro! Estou aqui pra te ajudar!*\n\n` +
      `Precisa de ajuda com o quê?\n\n` +
      `💸 Registrar gastos?\n` +
      `💳 Cartões de crédito?\n` +
      `📊 Ver resumo/saldo?\n` +
      `🎯 Metas de economia?\n` +
      `🔄 Gastos recorrentes?\n` +
      `📦 Parcelamentos?\n\n` +
      `Me diz que eu te explico! 😊`, messageSource);
    return;
  }

  // ================================================================
  // 👋 SAUDAÇÃO CONTEXTUAL (sem botões!)
  // ================================================================
  try {
    const primeiroNome = nomeUsuario.split(" ")[0] || "você";

    // Buscar atividade recente para contexto
    const { data: recentActivity } = await supabase
      .from("transacoes")
      .select("tipo, valor, descricao, created_at")
      .eq("usuario_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Determinar período do dia (Brasília UTC-3)
    const now = new Date();
    const brasiliaHour = (now.getUTCHours() - 3 + 24) % 24;
    let greeting = "Oi";
    if (brasiliaHour >= 5 && brasiliaHour < 12) greeting = "Bom dia";
    else if (brasiliaHour >= 12 && brasiliaHour < 18) greeting = "Boa tarde";
    else greeting = "Boa noite";

    let contextMessage = "";

    if (recentActivity) {
      const hoursAgo = (Date.now() - new Date(recentActivity.created_at).getTime()) / (1000 * 60 * 60);

      if (hoursAgo < 1) {
        if (recentActivity.tipo === "saida") {
          contextMessage = `\n\nVi que você acabou de registrar *${recentActivity.descricao}*. Quer adicionar mais algo?`;
        } else {
          contextMessage = `\n\nVi que entrou dinheiro! 💰 Tudo certo?`;
        }
      } else if (hoursAgo < 12) {
        contextMessage = `\n\nComo vai o dia? Tudo tranquilo com as finanças? 📊`;
      }
    } else {
      contextMessage = `\n\nSou seu assistente financeiro! 💰\n\nPode me dizer seus gastos assim:\n"café 5 pix" ou "almoço 30 dinheiro"\n\nEu cuido do resto!`;
    }

    await sendMessage(phoneNumber, `${greeting}, ${primeiroNome}! 👋${contextMessage}`, messageSource);
  } catch (err) {
    const primeiroNome = nomeUsuario.split(" ")[0];
    await sendMessage(phoneNumber, `Oi, ${primeiroNome}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`, messageSource);
  }
}

// ============================================================================
// Helper: Resposta de follow-up para ajuda contextual
// ============================================================================
function _getHelpFollowUp(text: string): string | null {
  if (/\b(gasto|registr|anotar|lanc|compra|despesa)\b/i.test(text)) {
    return `💸 *Registrar gastos é simples!*\n\n` +
      `É só me dizer assim:\n\n` +
      `• "café 5 pix"\n` +
      `• "almoço 30 dinheiro"\n` +
      `• "uber 15 crédito"\n\n` +
      `Eu pergunto o que faltar!\n\n` +
      `Também dá pra mandar:\n` +
      `• "ontem jantar 80 cartão"\n` +
      `• "dia 05/02 mercado 150 dinheiro"\n\n` +
      `Quer testar agora? 😊`;
  }
  if (/\b(cartao|cartões|credito|limite)\b/i.test(text)) {
    return `💳 *Sobre cartões de crédito:*\n\n` +
      `Ver seus cartões:\n` +
      `• "meus cartões"\n\n` +
      `Adicionar novo:\n` +
      `• "adicionar cartão Nubank limite 5000"\n\n` +
      `Gasto no crédito:\n` +
      `• "uber 15 crédito"\n\n` +
      `O que quer fazer?`;
  }
  if (/\b(resumo|saldo|quanto|gastei|relatorio)\b/i.test(text)) {
    return `📊 *Ver seu resumo:*\n\n` +
      `• "quanto gastei esse mês?"\n` +
      `• "saldo"\n` +
      `• "gastos da semana"\n` +
      `• "detalhe alimentação"\n\n` +
      `Quer ver algum desses agora?`;
  }
  if (/\b(meta|metas|economia|economizar|poupar)\b/i.test(text)) {
    return `🎯 *Metas de economia:*\n\n` +
      `Criar meta:\n` +
      `• "meta viagem 5000"\n\n` +
      `Adicionar valor:\n` +
      `• "guardei 200 pra viagem"\n\n` +
      `Ver metas:\n` +
      `• "minhas metas"\n\n` +
      `Quer criar uma meta?`;
  }
  if (/\b(recorrente|fixo|mensal|conta)\b/i.test(text)) {
    return `🔄 *Gastos recorrentes:*\n\n` +
      `Criar recorrente:\n` +
      `• "spotify 22 todo mês"\n` +
      `• "academia 99 mensal"\n\n` +
      `Ver recorrentes:\n` +
      `• "meus gastos fixos"\n\n` +
      `O que quer fazer?`;
  }
  if (/\b(parcel|parcela)\b/i.test(text)) {
    return `📦 *Parcelamentos:*\n\n` +
      `Registrar:\n` +
      `• "tv 3000 crédito 12x"\n\n` +
      `Ver parcelamentos:\n` +
      `• "meus parcelamentos"\n\n` +
      `Quer registrar um?`;
  }
  if (/\b(exemplo|como|registrar)\b/i.test(text)) {
    return `💡 *Exemplos de uso do Finax:*\n\n` +
      `💸 *Gastos:*\n` +
      `• "café 5 pix"\n` +
      `• "uber 15 crédito"\n` +
      `• "mercado 200 dinheiro"\n\n` +
      `💰 *Receitas:*\n` +
      `• "recebi 3000 pix"\n` +
      `• "salário 5000"\n\n` +
      `📊 *Consultas:*\n` +
      `• "quanto gastei esse mês?"\n` +
      `• "saldo"\n\n` +
      `Quer testar agora? 😊`;
  }
  return null;
}
