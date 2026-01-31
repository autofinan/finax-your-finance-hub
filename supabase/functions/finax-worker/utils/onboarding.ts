// ============================================================================
// 🎯 ONBOARDING DO FINAX - CONSULTOR FINANCEIRO
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📱 FUNÇÕES DE ENVIO (duplicadas localmente para evitar imports circulares)
// ============================================================================

async function sendMessage(to: string, message: string, _source: string = "whatsapp"): Promise<void> {
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });
    if (!response.ok) {
      console.error(`[ONBOARDING] Erro ao enviar mensagem:`, await response.text());
    }
  } catch (err) {
    console.error(`[ONBOARDING] Erro ao enviar mensagem:`, err);
  }
}

async function sendButtons(to: string, message: string, buttons: Array<{ id: string; title: string }>, _source: string = "whatsapp"): Promise<void> {
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message },
          action: {
            buttons: buttons.slice(0, 3).map(b => ({
              type: "reply",
              reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
          },
        },
      }),
    });
    if (!response.ok) {
      console.error(`[ONBOARDING] Erro ao enviar botões:`, await response.text());
    }
  } catch (err) {
    console.error(`[ONBOARDING] Erro ao enviar botões:`, err);
  }
}

function parseBrazilianAmount(text: string): number | null {
  const cleaned = text.replace(/[^\d,.]/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export interface OnboardingState {
  userId: string;
  step: "emotional" | "problem" | "goal_setup" | "name" | "done";
  financialState?: "stressed" | "ok" | "good";
  mainProblem?: string;
  problemDetails?: Record<string, any>;
  goalType?: string;
  goalAmount?: number;
  goalDeadline?: string;
  monthlyIncome?: number;
  firstName?: string;
}

export async function startOnboarding(userId: string, phone: string): Promise<void> {
  await supabase.from("user_onboarding").insert({
    user_id: userId,
    current_step: "emotional"
  });
  
  await sendButtons(phone, 
    `Oi! Sou o Finax 👋\n\nNão sou só um app de gastos.\nSou o cara que vai te ajudar a:\n• Sair de dívidas\n• Juntar grana pra algo importante\n• Entender pra onde seu dinheiro vai\n\nMas antes, me diz:\nComo está sua vida financeira HOJE?`,
    [
      { id: "onb_stressed", title: "😰 Tô apertado(a)" },
      { id: "onb_ok", title: "😐 Tá indo" },
      { id: "onb_good", title: "😊 Tranquila" }
    ],
    "whatsapp"
  );
}

export async function handleOnboardingStep(
  userId: string,
  phone: string,
  message: string,
  buttonId?: string
): Promise<boolean> {
  const { data: onboarding } = await supabase
    .from("user_onboarding")
    .select("*")
    .eq("user_id", userId)
    .single();
  
  if (!onboarding) return false;
  
  // STEP 1: Estado emocional
  if (onboarding.current_step === "emotional" && buttonId) {
    const stateMap: Record<string, string> = {
      "onb_stressed": "stressed",
      "onb_ok": "ok",
      "onb_good": "good"
    };
    
    const state = stateMap[buttonId] || "ok";
    await supabase.from("user_onboarding").update({
      financial_state: state,
      current_step: "problem"
    }).eq("user_id", userId);
    
    // Enviar próxima pergunta baseada no estado
    if (state === "stressed") {
      await sendButtons(phone,
        `Entendo. A maioria das pessoas que me procuram tá assim também.\n\nMe conta: qual o maior problema hoje?`,
        [
          { id: "prob_debt", title: "💳 Dívida no cartão" },
          { id: "prob_overspend", title: "📉 Gasto mais do que ganho" },
          { id: "prob_bills", title: "🏦 Boletos atrasados" },
          { id: "prob_notsaving", title: "💸 Não sobra nada" }
        ],
        "whatsapp"
      );
    } else if (state === "ok") {
      await sendButtons(phone,
        `Saquei. Tá controlado mas podia estar melhor, né?\n\nO que você quer melhorar?`,
        [
          { id: "goal_save", title: "🎯 Juntar uma grana" },
          { id: "goal_track", title: "📊 Ver pra onde vai o $" },
          { id: "goal_optimize", title: "💰 Aumentar o que sobra" }
        ],
        "whatsapp"
      );
    } else {
      await sendButtons(phone,
        `Que top! Então vamos elevar o nível.\n\nO que você quer fazer agora?`,
        [
          { id: "goal_biggoal", title: "🎯 Criar uma meta" },
          { id: "goal_invest", title: "📈 Investir melhor" },
          { id: "goal_optimize", title: "🔍 Otimizar gastos" }
        ],
        "whatsapp"
      );
    }
    
    return true;
  }
  
  // STEP 2: Problema/Objetivo
  if (onboarding.current_step === "problem" && buttonId) {
    await supabase.from("user_onboarding").update({
      main_problem: buttonId,
      current_step: "goal_setup"
    }).eq("user_id", userId);
    
    // Customizar próxima pergunta
    if (buttonId === "prob_debt") {
      await sendMessage(phone,
        `Beleza. Vou te ajudar a sair disso.\n\nQuanto você deve no cartão hoje?\n(pode ser aproximado)`,
        "whatsapp"
      );
    } else if (buttonId === "prob_overspend") {
      await sendMessage(phone,
        `Entendi. Isso é mais comum do que você imagina.\n\nPrimeiro: quanto você ganha por mês?`,
        "whatsapp"
      );
    } else if (buttonId === "goal_save") {
      await sendMessage(phone,
        `Massa! Pra que você quer juntar?\n(pode ser qualquer coisa: viagem, carro, segurança...)`,
        "whatsapp"
      );
    }
    
    return true;
  }
  
  // STEP 3: Coletar detalhes do objetivo
  if (onboarding.current_step === "goal_setup") {
    // Processar resposta baseada no problema
    const amount = parseBrazilianAmount(message);
    
    if (amount) {
      await supabase.from("user_onboarding").update({
        problem_details: { amount },
        current_step: "name"
      }).eq("user_id", userId);
      
      await sendMessage(phone,
        `Pronto! Você já tá no sistema.\n\nAgora, só uma coisa rápida:\nqual seu primeiro nome?\n(pra eu te chamar direito)`,
        "whatsapp"
      );
    } else {
      // Salvar resposta textual
      await supabase.from("user_onboarding").update({
        problem_details: { text: message },
        current_step: "name"
      }).eq("user_id", userId);
      
      await sendMessage(phone,
        `Anotado!\n\nAgora me diz: qual seu primeiro nome?`,
        "whatsapp"
      );
    }
    
    return true;
  }
  
  // STEP 4: Nome e finalização
  if (onboarding.current_step === "name") {
    const firstName = message.trim().split(" ")[0];
    
    await supabase.from("user_onboarding").update({
      first_name: firstName,
      current_step: "done",
      completed_at: new Date().toISOString()
    }).eq("user_id", userId);
    
    // Mensagem de fechamento personalizada
    const summary = buildOnboardingSummary(onboarding, firstName);
    
    await sendButtons(phone, summary, [
      { id: "onb_start", title: "🎯 Vamos" },
      { id: "onb_plan", title: "📋 Ver meu plano" }
    ], "whatsapp");
    
    return true;
  }
  
  return false;
}

function buildOnboardingSummary(onboarding: any, firstName: string): string {
  let summary = `Show, ${firstName}!\n\n`;
  
  if (onboarding.main_problem === "prob_debt") {
    summary += `📌 Seu objetivo: Sair da dívida de R$ ${onboarding.problem_details?.amount}\n\n`;
  } else if (onboarding.main_problem === "goal_save") {
    summary += `📌 Seu objetivo: Juntar grana pra ${onboarding.problem_details?.text}\n\n`;
  }
  
  summary += `A partir de agora, pode me mandar:\n`;
  summary += `• "Gastei X no Y" (pra registrar)\n`;
  summary += `• "Quanto gastei?" (pra consultar)\n`;
  summary += `• "Me ajuda" (quando travar)\n\n`;
  summary += `Ah, e se eu perguntar alguma coisa que você não souber, só diz "não sei" — a gente descobre junto.\n\n`;
  summary += `Bora começar? 🚀`;
  
  return summary;
}
