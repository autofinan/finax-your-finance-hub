// ============================================================================
// 🧠 VENDEDOR ESPECIALISTA FINAX — IA Persuasiva Personalizada
// ============================================================================
// Módulo dedicado ao Finax agir como vendedor especialista nele mesmo.
// Responde QUALQUER pergunta de forma persuasiva e personalizada.
// SEM cupons/descontos por enquanto.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📊 DADOS DO USUÁRIO PARA PERSONALIZAÇÃO
// ============================================================================

interface UserSalesData {
  id: string;
  nome: string;
  phone_number: string;
  totalTransactions: number;
  totalEntradas: number;
  totalSaidas: number;
  totalCartoes: number;
  totalMetas: number;
  totalDividas: number;
  totalRecorrentes: number;
  valorAjustavel: number;
  diasUsados: number;
}

async function getUserSalesData(userId: string): Promise<UserSalesData | null> {
  const { data: user } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", userId)
    .single();

  if (!user) return null;

  // Fetch all stats in parallel
  const [transResult, cartoesResult, metasResult, dividasResult, recorrentesResult] = await Promise.all([
    supabase.from("transacoes").select("valor, tipo, expense_type, created_at").eq("usuario_id", userId).neq("status", "cancelada"),
    supabase.from("cartoes_credito").select("id", { count: "exact", head: true }).eq("usuario_id", userId),
    supabase.from("orcamentos").select("id", { count: "exact", head: true }).eq("usuario_id", userId).eq("ativo", true),
    supabase.from("dividas").select("id", { count: "exact", head: true }).eq("usuario_id", userId).eq("ativa", true),
    supabase.from("gastos_recorrentes").select("id", { count: "exact", head: true }).eq("usuario_id", userId).eq("ativo", true),
  ]);

  const transacoes = transResult.data || [];
  const totalEntradas = transacoes.filter(t => t.tipo === "entrada").reduce((s, t) => s + Math.abs(t.valor || 0), 0);
  const totalSaidas = transacoes.filter(t => t.tipo === "saida").reduce((s, t) => s + Math.abs(t.valor || 0), 0);
  const valorAjustavel = transacoes
    .filter(t => ["flexivel", "lazer_social", "impulso"].includes(t.expense_type || ""))
    .reduce((s, t) => s + Math.abs(t.valor || 0), 0);

  // Calculate days used
  const firstTx = transacoes.length > 0
    ? new Date(transacoes.reduce((min, t) => t.created_at < min ? t.created_at : min, transacoes[0].created_at))
    : new Date();
  const diasUsados = Math.max(1, Math.ceil((Date.now() - firstTx.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    id: user.id,
    nome: user.nome || "amigo(a)",
    phone_number: user.phone_number,
    totalTransactions: transacoes.length,
    totalEntradas,
    totalSaidas,
    totalCartoes: cartoesResult.count || 0,
    totalMetas: metasResult.count || 0,
    totalDividas: dividasResult.count || 0,
    totalRecorrentes: recorrentesResult.count || 0,
    valorAjustavel,
    diasUsados,
  };
}

// ============================================================================
// 🤖 VENDEDOR IA — Responde qualquer pergunta como vendedor do Finax
// ============================================================================

export async function finaxSalesResponse(
  userId: string,
  userMessage: string,
  checkoutUrlBasico: string,
  checkoutUrlPro: string,
): Promise<string> {
  const userData = await getUserSalesData(userId);
  const firstName = userData?.nome?.split(" ")[0] || "amigo(a)";

  // Build context about user usage
  let usageContext = "";
  if (userData && userData.totalTransactions > 0) {
    usageContext = `
DADOS REAIS DO TRIAL DESSE USUÁRIO:
- ${userData.totalTransactions} transações registradas em ${userData.diasUsados} dias
- R$ ${userData.totalEntradas.toFixed(0)} em entradas, R$ ${userData.totalSaidas.toFixed(0)} em saídas
- ${userData.totalCartoes} cartão(ões), ${userData.totalMetas} orçamento(s), ${userData.totalDividas} dívida(s)
- ${userData.totalRecorrentes} gasto(s) recorrente(s) mapeados
- R$ ${userData.valorAjustavel.toFixed(0)} em gastos ajustáveis identificados
`;
  } else {
    usageContext = `
O USUÁRIO AINDA NÃO USOU MUITO O FINAX NO TRIAL.
Foque em mostrar o potencial e criar curiosidade.
`;
  }

  const systemPrompt = `Você é o Finax, um consultor financeiro pessoal que também é o VENDEDOR ESPECIALISTA do próprio produto.

## CONTEXTO
O trial Pro de 14 dias do ${firstName} ACABOU. Ele está bloqueado e só pode:
1. Fazer perguntas sobre os planos
2. Enviar código de ativação
3. Assinar um plano

## SEUS PLANOS
📱 **Básico** — R$ 19,90/mês
- Registro ilimitado de transações
- Orçamentos e alertas
- Relatórios semanais/mensais
- Controle de contas a pagar
- Até 2 cartões, 5 metas

⭐ **Pro** — R$ 29,90/mês _(mais popular)_
- TUDO do Básico
- Simulador de quitação de dívidas
- Insights preditivos com IA
- Cartões e metas ILIMITADOS
- Consultor IA semanal
- Detector de padrões de gastos
- Suporte prioritário

${usageContext}

## LINKS DE CHECKOUT (SEMPRE INCLUA)
📱 Básico: ${checkoutUrlBasico}
⭐ Pro: ${checkoutUrlPro}
🌐 Site: https://finaxai.vercel.app

## TOM DE VOZ OBRIGATÓRIO
- Seja CONSULTIVO, não agressivo
- Use dados REAIS do trial para persuadir (se disponíveis)
- Mostre o que o usuário PERDE se não assinar (loss aversion)
- Responda a QUALQUER pergunta (preço, funcionalidades, comparação, dúvidas)
- SEMPRE inclua pelo menos 1 link de checkout na resposta
- Máximo 3 parágrafos curtos
- Use emojis com moderação (2-3 por mensagem)
- Se a pessoa perguntar algo que não é sobre o Finax, redirecione gentilmente

## OBJEÇÕES COMUNS E COMO RESPONDER
- "É caro" → R$ 29,90 = R$ 1/dia. Menos que 1 café. E você já identificou R$ X em gastos ajustáveis.
- "Preciso pensar" → Enquanto pensa, seus gastos continuam sem controle. Quanto custa NÃO saber?
- "Vou usar planilha" → Planilha não te avisa quando gasta demais. Não simula quitação de dívidas. Não manda relatório por WhatsApp.
- "Não tenho dinheiro" → O Básico custa R$ 19,90. É o preço de 2 lanches. E vai te ECONOMIZAR muito mais.
- "Depois eu assino" → Não tem compromisso, cancela quando quiser. Mas seus dados do trial estão salvos - assine e continue de onde parou.

## O QUE NUNCA FAZER
- NÃO ofereça desconto ou cupom
- NÃO prometa funcionalidades que não existem
- NÃO seja desesperado ou insistente
- NÃO ignore a pergunta do usuário
- NÃO mande mensagem longa demais`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error(`[SELLER] AI error: ${response.status}`);
      return fallbackSalesMessage(firstName, checkoutUrlBasico, checkoutUrlPro);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content;

    if (!aiResponse) {
      return fallbackSalesMessage(firstName, checkoutUrlBasico, checkoutUrlPro);
    }

    return aiResponse;
  } catch (err) {
    console.error("[SELLER] Exception:", err);
    return fallbackSalesMessage(firstName, checkoutUrlBasico, checkoutUrlPro);
  }
}

function fallbackSalesMessage(name: string, urlBasico: string, urlPro: string): string {
  return `${name}, posso te ajudar a escolher o melhor plano! 😊\n\n📱 *Básico* — R$ 19,90/mês\n👉 ${urlBasico}\n\n⭐ *Pro* — R$ 29,90/mês\n👉 ${urlPro}\n\n🌐 Mais detalhes: https://finaxai.vercel.app`;
}

// ============================================================================
// 📅 MENSAGENS DE VENDAS — SEQUÊNCIA DE 4 TOQUES (SEM CUPONS)
// ============================================================================

type SalesStage = "d_minus_2" | "d_minus_1" | "d_plus_1" | "d_plus_7";

export async function getSalesMessage(
  userId: string,
  stage: SalesStage,
  checkoutUrlBasico: string,
  checkoutUrlPro: string,
): Promise<string | null> {
  const userData = await getUserSalesData(userId);
  if (!userData) return null;

  const firstName = userData.nome.split(" ")[0];

  // ========================================================================
  // DIA -2: ALERTA SUAVE
  // ========================================================================
  if (stage === "d_minus_2") {
    if (userData.totalTransactions > 20) {
      return `${firstName}, seu trial acaba em *2 dias*. ⏳\n\nVocê já registrou *${userData.totalTransactions} transações*${userData.valorAjustavel > 0 ? ` e identificou R$ ${userData.valorAjustavel.toFixed(0)} em gastos ajustáveis` : ""}.\n\nPra manter tudo funcionando:\n\n📱 Básico: ${checkoutUrlBasico}\n⭐ Pro: ${checkoutUrlPro}\n\nQualquer dúvida, só chamar!`;
    }
    return `${firstName}, seu trial Pro acaba em *2 dias*! ⏰\n\n💡 Quem usa o Finax nos primeiros 30 dias economiza em média 20%.\n\nGarante seu plano:\n📱 Básico — R$ 19,90: ${checkoutUrlBasico}\n⭐ Pro — R$ 29,90: ${checkoutUrlPro}`;
  }

  // ========================================================================
  // DIA -1: URGÊNCIA
  // ========================================================================
  if (stage === "d_minus_1") {
    let featureHook = "";
    if (userData.totalDividas > 0) {
      featureHook = `\n\nVocê tem *${userData.totalDividas} dívida(s)*. Sem o Pro, você perde o simulador de quitação.`;
    } else if (userData.totalMetas > 0) {
      featureHook = `\n\nVocê tem *${userData.totalMetas} orçamento(s)* ativos. No Básico, o limite é 5.`;
    }

    return `🚨 *${firstName}, AMANHÃ seu trial acaba!*${featureHook}\n\nSe não assinar, você perde:\n❌ Simulador de dívidas\n❌ Insights com IA\n❌ Cartões ilimitados\n\nDecide agora:\n📱 Básico: ${checkoutUrlBasico}\n⭐ Pro: ${checkoutUrlPro}\n\n(R$ 29,90/mês = menos de R$ 1/dia)`;
  }

  // ========================================================================
  // DIA +1: TRIAL ACABOU
  // ========================================================================
  if (stage === "d_plus_1") {
    if (userData.totalTransactions > 30) {
      return `${firstName}, seu trial acabou. 😔\n\nMas olha: você registrou *${userData.totalTransactions} transações* em ${userData.diasUsados} dias.\n\nTudo isso continua salvo. Assine e retome de onde parou:\n\n📱 Básico: ${checkoutUrlBasico}\n⭐ Pro: ${checkoutUrlPro}\n\nSeus dados estão esperando! 📊`;
    }
    return `${firstName}, seu trial acabou.\n\nVocê ainda não experimentou tudo.\n\n💡 *Quem usa o Finax Pro:*\n• Quita dívidas 3x mais rápido\n• Economiza R$ 300/mês em média\n\nAssine e comece de verdade:\n📱 Básico: ${checkoutUrlBasico}\n⭐ Pro: ${checkoutUrlPro}`;
  }

  // ========================================================================
  // DIA +7: ÚLTIMA CARTADA (SEM CUPOM)
  // ========================================================================
  if (stage === "d_plus_7") {
    return `${firstName}, faz 1 semana que seu trial acabou.\n\nSeus dados ainda estão salvos, mas não por muito tempo.\n\nÚltima chance de reativar:\n📱 Básico — R$ 19,90/mês: ${checkoutUrlBasico}\n⭐ Pro — R$ 29,90/mês: ${checkoutUrlPro}\n\nDepois disso, não vou mais te mandar mensagem sobre isso. A decisão é sua. 🤝`;
  }

  return null;
}

// ============================================================================
// 🔗 ENCURTADOR DE LINKS (usa edge function redirect)
// ============================================================================

export async function shortenURL(
  longURL: string,
  userId?: string,
  campaign?: string,
): Promise<string> {
  try {
    const shortCode = Math.random().toString(36).substring(2, 8).toLowerCase();

    const { error } = await supabase.from("short_links").insert({
      short_code: shortCode,
      long_url: longURL,
      user_id: userId || null,
      campaign: campaign || "unknown",
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });

    if (error) {
      console.error("[SHORTEN] Error:", error);
      return longURL;
    }

    return `${SUPABASE_URL}/functions/v1/redirect?c=${shortCode}`;
  } catch {
    return longURL;
  }
}
