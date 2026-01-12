// ============================================================================
// 🛒 INTENT: PURCHASE ADVISOR (Assistente de Compras Contextual)
// ============================================================================
// Comandos:
// - "vale a pena comprar um tênis de 500?"
// - "posso comprar um iphone de 4000?"
// - "devo gastar 200 numa jaqueta?"
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordMetric } from "../governance/config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📊 ANÁLISE DE CONTEXTO FINANCEIRO
// ============================================================================

interface FinancialContext {
  currentBalance: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  activeGoals: Array<{ name: string; remaining: number; deadline?: Date }>;
  recentSimilarExpenses: Array<{ description: string; valor: number; data: Date }>;
  categorySpending: number;
  creditCardUsage: number;
  creditCardLimit: number;
}

async function getFinancialContext(userId: string, category?: string): Promise<FinancialContext> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Buscar usuário
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("saldo_atual, limite_mensal")
    .eq("id", userId)
    .single();

  // Transações do mês
  const { data: transactions } = await supabase
    .from("transacoes")
    .select("valor, tipo, categoria, descricao, data")
    .eq("usuario_id", userId)
    .gte("data", startOfMonth.toISOString())
    .eq("status", "confirmada");

  // Metas ativas
  const { data: goals } = await supabase
    .from("savings_goals")
    .select("name, target_amount, current_amount, deadline")
    .eq("user_id", userId)
    .eq("status", "active");

  // Cartões
  const { data: cards } = await supabase
    .from("cartoes_credito")
    .select("limite, limite_utilizado")
    .eq("usuario_id", userId)
    .eq("ativo", true);

  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  let categorySpending = 0;
  const recentSimilar: Array<{ description: string; valor: number; data: Date }> = [];

  transactions?.forEach(t => {
    const valor = Number(t.valor);
    if (t.tipo === "entrada") {
      monthlyIncome += valor;
    } else {
      monthlyExpenses += valor;
      if (category && t.categoria === category) {
        categorySpending += valor;
        recentSimilar.push({
          description: t.descricao || "",
          valor,
          data: new Date(t.data)
        });
      }
    }
  });

  let creditCardUsage = 0;
  let creditCardLimit = 0;
  cards?.forEach(card => {
    creditCardLimit += Number(card.limite);
    creditCardUsage += Number(card.limite_utilizado);
  });

  const activeGoals = (goals || []).map(g => ({
    name: g.name,
    remaining: Number(g.target_amount) - Number(g.current_amount),
    deadline: g.deadline ? new Date(g.deadline) : undefined
  }));

  return {
    currentBalance: Number(usuario?.saldo_atual || 0),
    monthlyIncome,
    monthlyExpenses,
    activeGoals,
    recentSimilarExpenses: recentSimilar.slice(0, 5),
    categorySpending,
    creditCardUsage,
    creditCardLimit
  };
}

// ============================================================================
// 🎯 ANÁLISE DE COMPRA
// ============================================================================

export interface PurchaseAdviceParams {
  userId: string;
  itemDescription: string;
  itemValue: number;
  category?: string;
}

export interface PurchaseAdvice {
  recommendation: "buy" | "wait" | "avoid" | "consider";
  reasoning: string[];
  alternatives?: string[];
  impactOnGoals?: string;
  confidenceScore: number;
}

export async function analyzePurchase(params: PurchaseAdviceParams): Promise<string> {
  const { userId, itemDescription, itemValue, category } = params;

  console.log(`🛒 [PURCHASE] Analisando: ${itemDescription} - R$ ${itemValue}`);

  try {
    const ctx = await getFinancialContext(userId, category);
    const advice = generateAdvice(itemValue, itemDescription, ctx);

    // Registrar métrica
    await recordMetric("purchase_advice_given", 1, {
      user_id: userId,
      recommendation: advice.recommendation,
      item_value: itemValue.toString()
    });

    return formatAdvice(itemDescription, itemValue, advice, ctx);

  } catch (err) {
    console.error("❌ [PURCHASE] Erro na análise:", err);
    return "❌ Não consegui analisar essa compra. Tenta novamente!";
  }
}

// ============================================================================
// 🧠 LÓGICA DE RECOMENDAÇÃO
// ============================================================================

function generateAdvice(
  value: number,
  description: string,
  ctx: FinancialContext
): PurchaseAdvice {
  const reasoning: string[] = [];
  const alternatives: string[] = [];
  let score = 50; // Começa neutro

  const availableBudget = ctx.monthlyIncome - ctx.monthlyExpenses;
  const balanceAfterPurchase = ctx.currentBalance - value;
  const valueAsPercentOfIncome = (value / ctx.monthlyIncome) * 100;
  const creditAvailable = ctx.creditCardLimit - ctx.creditCardUsage;

  // ============= FATORES POSITIVOS =============

  // Tem saldo confortável
  if (balanceAfterPurchase > ctx.monthlyExpenses * 0.5) {
    score += 15;
    reasoning.push("✅ Sobra saldo confortável após a compra");
  }

  // Valor baixo em relação à renda
  if (valueAsPercentOfIncome < 5) {
    score += 20;
    reasoning.push("✅ Valor representa menos de 5% da sua renda mensal");
  } else if (valueAsPercentOfIncome < 10) {
    score += 10;
    reasoning.push("💡 Valor representa ~" + valueAsPercentOfIncome.toFixed(0) + "% da sua renda");
  }

  // Orçamento disponível
  if (availableBudget > value * 1.5) {
    score += 15;
    reasoning.push("✅ Você tem margem no orçamento do mês");
  }

  // ============= FATORES NEGATIVOS =============

  // Saldo ficaria negativo
  if (balanceAfterPurchase < 0) {
    score -= 40;
    reasoning.push("❌ Seu saldo ficaria negativo");
    alternatives.push("Parcelar pode ser uma opção se for necessário");
  }

  // Valor alto em relação à renda
  if (valueAsPercentOfIncome > 30) {
    score -= 25;
    reasoning.push("⚠️ Valor representa " + valueAsPercentOfIncome.toFixed(0) + "% da sua renda mensal");
    alternatives.push("Considere esperar ou buscar uma opção mais barata");
  }

  // Já gastou muito na categoria
  if (ctx.categorySpending > 0 && ctx.categorySpending + value > ctx.monthlyExpenses * 0.3) {
    score -= 15;
    reasoning.push("⚠️ Já tem gastos significativos nessa categoria este mês");
  }

  // Metas em risco
  let impactOnGoals: string | undefined;
  for (const goal of ctx.activeGoals) {
    if (goal.remaining < value * 2 && goal.deadline) {
      const daysToDeadline = Math.ceil((goal.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysToDeadline < 90) {
        score -= 20;
        impactOnGoals = `⚠️ Pode atrasar sua meta "${goal.name}" (faltam R$ ${goal.remaining.toFixed(2)})`;
        reasoning.push(impactOnGoals);
        alternatives.push(`Contribuir R$ ${(value * 0.3).toFixed(2)} pra meta antes de comprar`);
      }
    }
  }

  // Cartão muito usado
  if (ctx.creditCardUsage > ctx.creditCardLimit * 0.8) {
    score -= 10;
    reasoning.push("⚠️ Seu cartão já está com uso alto");
    alternatives.push("Evite parcelar para não comprometer mais o limite");
  }

  // ============= CLASSIFICAÇÃO FINAL =============

  let recommendation: PurchaseAdvice["recommendation"];
  
  if (score >= 70) {
    recommendation = "buy";
  } else if (score >= 50) {
    recommendation = "consider";
  } else if (score >= 30) {
    recommendation = "wait";
  } else {
    recommendation = "avoid";
  }

  // Normalizar score para 0-100
  const confidenceScore = Math.max(0, Math.min(100, score + 20));

  return {
    recommendation,
    reasoning,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    impactOnGoals,
    confidenceScore
  };
}

// ============================================================================
// 📝 FORMATAR RESPOSTA
// ============================================================================

function formatAdvice(
  item: string,
  value: number,
  advice: PurchaseAdvice,
  ctx: FinancialContext
): string {
  const recommendationEmojis: Record<string, string> = {
    buy: "✅",
    consider: "🤔",
    wait: "⏳",
    avoid: "❌"
  };

  const recommendationTexts: Record<string, string> = {
    buy: "Pode comprar!",
    consider: "Pense bem antes",
    wait: "Melhor esperar",
    avoid: "Não recomendo agora"
  };

  let response = `🛒 *Análise: ${item}*\n`;
  response += `💰 Valor: R$ ${value.toFixed(2)}\n\n`;

  response += `${recommendationEmojis[advice.recommendation]} *${recommendationTexts[advice.recommendation]}*\n\n`;

  // Contexto financeiro rápido
  response += `📊 *Seu momento:*\n`;
  response += `   💵 Saldo: R$ ${ctx.currentBalance.toFixed(2)}\n`;
  response += `   📈 Disponível no mês: R$ ${(ctx.monthlyIncome - ctx.monthlyExpenses).toFixed(2)}\n\n`;

  // Reasoning
  if (advice.reasoning.length > 0) {
    response += `*Por que?*\n`;
    advice.reasoning.slice(0, 4).forEach(r => {
      response += `${r}\n`;
    });
    response += "\n";
  }

  // Alternatives
  if (advice.alternatives && advice.alternatives.length > 0) {
    response += `💡 *Sugestões:*\n`;
    advice.alternatives.slice(0, 2).forEach(a => {
      response += `• ${a}\n`;
    });
  }

  // Score visual
  const scoreBar = generateScoreBar(advice.confidenceScore);
  response += `\n📊 Score: ${scoreBar} ${advice.confidenceScore}%`;

  return response;
}

function generateScoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
