// ============================================================================
// 👋 SAUDAÇÕES INTELIGENTES E VARIÁVEIS
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📝 POOLS DE TEMPLATES
// ============================================================================

const SAUDACOES_MANHA = [
  "Bom dia, {nome}! ☀️ Como posso ajudar?",
  "Bom dia! 👋 Quer registrar algo?",
  "Oi, {nome}! Bom dia! 🌅 No que posso ajudar?",
  "Bom dia! ☕ Me conta um gasto ou pergunta seu resumo.",
];

const SAUDACOES_TARDE = [
  "Boa tarde, {nome}! 👋 Como posso ajudar?",
  "Oi! Boa tarde! ☀️ Registrar algo ou ver resumo?",
  "E aí, {nome}! 👋 Boa tarde! No que posso ajudar?",
  "Boa tarde! 📊 Me conta o que precisa.",
];

const SAUDACOES_NOITE = [
  "Boa noite, {nome}! 🌙 Como posso ajudar?",
  "Oi! Boa noite! 🌟 No que posso ajudar?",
  "E aí, {nome}! Boa noite! 🌙 Registrar algo?",
  "Boa noite! ✨ Me conta um gasto ou pergunta seu resumo.",
];

const SAUDACOES_RETORNO = [
  "Oi, {nome}! Faz tempo! 👋 Quer ver como andam suas finanças?",
  "E aí, {nome}! Sumiu! 😊 Quer um resumo do mês?",
  "Oi! Bom te ver de volta! 👋 Posso te mostrar um resumo?",
  "Voltou, {nome}! 🎉 Quer ver como estão os gastos?",
];

const SAUDACOES_FREQUENTE = [
  "E aí, {nome}! 👋 Registrar algo?",
  "Oi! 👋 Mais um gasto ou quer ver o resumo?",
  "Fala, {nome}! 👋 No que posso ajudar?",
  "Oi! 📊 Me conta.",
];

const SAUDACOES_PENDENTE = [
  "Oi, {nome}! 👋 Ontem você registrou {qtd} gastos. Quer ver o resumo?",
  "E aí! 👋 Vi que você registrou gastos ontem. Resumo?",
  "Oi, {nome}! 📊 Você tem {qtd} transações recentes. Ver resumo?",
];

const CONFIRMACOES_GASTO = [
  "✅ Registrado! {emoji} R$ {valor} em {categoria}",
  "Anotei! ✅ {emoji} {descricao}: R$ {valor}",
  "Pronto! ✅ R$ {valor} no {categoria}",
  "✅ Feito! {emoji} -{valor} em {categoria}",
  "Registrado! ✅ {descricao} R$ {valor}",
];

const CONFIRMACOES_ENTRADA = [
  "✅ Entrada registrada! 💰 +R$ {valor}",
  "Anotei! ✅ 💰 +R$ {valor} ({descricao})",
  "Pronto! ✅ +R$ {valor} entrou",
  "✅ Recebi! 💰 {descricao}: R$ {valor}",
];

const CONFIRMACOES_CANCELAMENTO = [
  "✅ Cancelado! {emoji} {descricao} foi removido.",
  "Pronto! ✅ Cancelei o registro de {descricao}.",
  "✅ Feito! {descricao} não conta mais.",
  "Removido! ✅ {descricao} foi cancelado.",
];

// ============================================================================
// 🎲 SELEÇÃO ALEATÓRIA
// ============================================================================

function pickTemplate(templates: string[]): string {
  return templates[Math.floor(Math.random() * templates.length)];
}

function replaceVariables(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

// ============================================================================
// 🕐 HELPERS DE HORA
// ============================================================================

function getHoraBrasilia(): number {
  const now = new Date();
  // Ajustar para Brasília (UTC-3)
  const brasiliaOffset = -3;
  const utcHour = now.getUTCHours();
  const brasiliaHour = (utcHour + brasiliaOffset + 24) % 24;
  return brasiliaHour;
}

function getPeriodoDia(): "manha" | "tarde" | "noite" {
  const hora = getHoraBrasilia();
  if (hora >= 5 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  return "noite";
}

// ============================================================================
// 📊 CONTEXTO DO USUÁRIO
// ============================================================================

interface UserContext {
  nome: string;
  ultimaInteracao: Date | null;
  interacoesHoje: number;
  estadoFinanceiro: "neutro" | "apertado" | "tranquilo";
  transacoesRecentes: number;
}

async function getUserContext(userId: string): Promise<UserContext> {
  // Buscar dados do usuário
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nome, ultima_interacao, interacoes_hoje, estado_financeiro")
    .eq("id", userId)
    .single();

  // Contar transações recentes (últimas 24h)
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  
  const { count: transacoesRecentes } = await supabase
    .from("transacoes")
    .select("*", { count: "exact", head: true })
    .eq("usuario_id", userId)
    .gte("created_at", ontem.toISOString());

  return {
    nome: usuario?.nome?.split(" ")[0] || "você",
    ultimaInteracao: usuario?.ultima_interacao ? new Date(usuario.ultima_interacao) : null,
    interacoesHoje: usuario?.interacoes_hoje || 0,
    estadoFinanceiro: usuario?.estado_financeiro || "neutro",
    transacoesRecentes: transacoesRecentes || 0
  };
}

// ============================================================================
// 👋 GERAR SAUDAÇÃO INTELIGENTE
// ============================================================================

export async function gerarSaudacao(userId: string): Promise<string> {
  const context = await getUserContext(userId);
  const periodo = getPeriodoDia();
  
  // Atualizar última interação
  await supabase.rpc("fn_atualizar_interacao", { p_usuario_id: userId });

  // Determinar tipo de saudação
  let templates: string[];
  let vars: Record<string, string | number> = { nome: context.nome };

  // 1. Retorno após muito tempo (> 3 dias)
  if (context.ultimaInteracao) {
    const diasSemInteracao = Math.floor(
      (Date.now() - context.ultimaInteracao.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    if (diasSemInteracao >= 3) {
      templates = SAUDACOES_RETORNO;
      return replaceVariables(pickTemplate(templates), vars);
    }
  }

  // 2. Tem transações pendentes/recentes
  if (context.transacoesRecentes > 0 && context.interacoesHoje === 0) {
    templates = SAUDACOES_PENDENTE;
    vars.qtd = context.transacoesRecentes;
    return replaceVariables(pickTemplate(templates), vars);
  }

  // 3. Usuário frequente (> 3 interações hoje)
  if (context.interacoesHoje >= 3) {
    templates = SAUDACOES_FREQUENTE;
    return replaceVariables(pickTemplate(templates), vars);
  }

  // 4. Saudação por período do dia
  switch (periodo) {
    case "manha":
      templates = SAUDACOES_MANHA;
      break;
    case "tarde":
      templates = SAUDACOES_TARDE;
      break;
    default:
      templates = SAUDACOES_NOITE;
  }

  return replaceVariables(pickTemplate(templates), vars);
}

// ============================================================================
// ✅ CONFIRMAÇÕES VARIÁVEIS
// ============================================================================

export interface ConfirmacaoVars {
  valor: number;
  categoria?: string;
  descricao?: string;
  emoji?: string;
}

export function gerarConfirmacaoGasto(vars: ConfirmacaoVars): string {
  const template = pickTemplate(CONFIRMACOES_GASTO);
  return replaceVariables(template, {
    valor: vars.valor.toFixed(2),
    categoria: vars.categoria || "Outros",
    descricao: vars.descricao || vars.categoria || "Gasto",
    emoji: vars.emoji || "💸"
  });
}

export function gerarConfirmacaoEntrada(vars: ConfirmacaoVars): string {
  const template = pickTemplate(CONFIRMACOES_ENTRADA);
  return replaceVariables(template, {
    valor: vars.valor.toFixed(2),
    descricao: vars.descricao || "Entrada"
  });
}

export function gerarConfirmacaoCancelamento(vars: { descricao: string; emoji?: string }): string {
  const template = pickTemplate(CONFIRMACOES_CANCELAMENTO);
  return replaceVariables(template, {
    descricao: vars.descricao,
    emoji: vars.emoji || "🗑️"
  });
}

// ============================================================================
// 🎯 EXPORTAR POOLS (para uso direto se necessário)
// ============================================================================

export const TEMPLATE_POOLS = {
  SAUDACOES_MANHA,
  SAUDACOES_TARDE,
  SAUDACOES_NOITE,
  SAUDACOES_RETORNO,
  SAUDACOES_FREQUENTE,
  SAUDACOES_PENDENTE,
  CONFIRMACOES_GASTO,
  CONFIRMACOES_ENTRADA,
  CONFIRMACOES_CANCELAMENTO,
  pickTemplate,
  replaceVariables
};
