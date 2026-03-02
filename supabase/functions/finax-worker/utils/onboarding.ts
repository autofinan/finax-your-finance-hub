// ============================================================================
// 🎯 ONBOARDING FINAX v4.0 - APRESENTAÇÃO VISUAL + DESCOBERTA GRADUAL
// ============================================================================
// FILOSOFIA:
// 1. APRESENTAÇÃO REAL: Mostra o QUE FAZ, não lista comandos
// 2. ESPECÍFICO POR PLANO: Mostra só o que o usuário TEM acesso
// 3. SEM PRESSÃO: "Explore no seu ritmo"
// 4. CERTEIRO: Foca no essencial primeiro (80/20)
// 5. AJUDA CONTEXTUAL: Quando usar → explica ali
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📱 FUNÇÕES DE ENVIO
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
      console.error(`[ONBOARDING] Erro:`, await response.text());
    }
  } catch (err) {
    console.error(`[ONBOARDING] Erro:`, err);
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
      console.error(`[ONBOARDING] Erro:`, await response.text());
    }
  } catch (err) {
    console.error(`[ONBOARDING] Erro:`, err);
  }
}

export interface OnboardingState {
  userId: string;
  step: "welcome" | "showcase_1" | "showcase_2" | "showcase_3" | "first_name" | "ready" | "done";
  planType?: "trial" | "basic" | "pro";
  firstName?: string;
}

// ============================================================================
// 🚀 ONBOARDING v4.0 - APRESENTAÇÃO + DESCOBERTA
// ============================================================================

export async function startOnboarding(userId: string, phone: string): Promise<void> {
  // Detectar plano do usuário
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan_type, trial_active")
    .eq("user_id", userId)
    .single();
  
  let planType = "basic";
  if (subscription?.trial_active) {
    planType = "trial";
  } else if (subscription?.plan_type === "pro") {
    planType = "pro";
  }
  
  await supabase.from("user_onboarding").insert({
    user_id: userId,
    current_step: "welcome",
    plan_type: planType
  });
  
  // ========================================================================
  // MENSAGEM 1: Boas-vindas humanizadas
  // ========================================================================
  
  await sendMessage(phone, 
    `Opa! 👋\n\nVocê acabou de entrar no Finax.\n\nEu sou seu assistente financeiro que funciona aqui no WhatsApp mesmo.`,
    "whatsapp"
  );
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // ========================================================================
  // MENSAGEM 2: Oferecer apresentação
  // ========================================================================
  
  const trialMessage = planType === "trial" 
    ? `\n\n(você está no trial de 14 dias Pro — tudo liberado! 🎉)` 
    : "";
  
  await sendButtons(phone,
    `Antes de começar, quer que eu te mostre as 3 coisas principais que você pode fazer comigo?${trialMessage}\n\n(leva 1 minuto)`,
    [
      { id: "onb_show", title: "📱 Sim, me mostra" },
      { id: "onb_skip", title: "⚡ Já começa" }
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
  
  const planType = onboarding.plan_type || "basic";
  
  // ========================================================================
  // STEP 1: ESCOLHA (welcome)
  // ========================================================================
  
  if (onboarding.current_step === "welcome") {
    let choice = "";
    
    if (buttonId === "onb_show") {
      choice = "show";
    } else if (buttonId === "onb_skip") {
      choice = "skip";
    } else {
      const normalized = message.toLowerCase();
      if (normalized.includes("sim") || normalized.includes("mostra") || normalized.includes("ver")) {
        choice = "show";
      } else if (normalized.includes("não") || normalized.includes("nao") || normalized.includes("começa") || normalized.includes("pular")) {
        choice = "skip";
      }
    }
    
    if (!choice) {
      await sendMessage(phone, "Você quer que eu te mostre ou já começar?", "whatsapp");
      return true;
    }
    
    if (choice === "show") {
      // INICIAR APRESENTAÇÃO
      await supabase.from("user_onboarding").update({
        current_step: "showcase_1"
      }).eq("user_id", userId);
      
      await sendMessage(phone,
        `Beleza! São só 3 coisas principais:\n\n1️⃣ Registrar (gastos e entradas)\n2️⃣ Consultar (ver pra onde vai)\n3️⃣ Controlar (orçamentos e metas)\n\nVamos lá 👇`,
        "whatsapp"
      );
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // ====================================================================
      // SHOWCASE 1: REGISTRAR
      // ====================================================================
      
      await sendMessage(phone,
        `📊 1️⃣ REGISTRAR\n\nVocê manda assim:\n\n💬 "gastei 50 no uber pix"\n💬 "café 8 dinheiro"\n💬 "recebi 200"\n\nEu entendo e registro automaticamente.\n\nSimples assim.`,
        "whatsapp"
      );
      
      await sendButtons(phone,
        `Testa comigo. Manda um gasto de exemplo:`,
        [
          { id: "show_next_1", title: "➡️ Próximo" }
        ],
        "whatsapp"
      );
      
    } else {
      // PULAR → Nome e começar
      await supabase.from("user_onboarding").update({
        current_step: "first_name"
      }).eq("user_id", userId);
      
      await sendMessage(phone,
        `Tranquilo!\n\nVou te ajudando conforme você usar.\n\nQual seu nome?`,
        "whatsapp"
      );
    }
    
    return true;
  }
  
  // ========================================================================
  // SHOWCASE 1: Registrar (showcase_1)
  // ========================================================================
  
  if (onboarding.current_step === "showcase_1") {
    // Se usuário mandou gasto de exemplo
    if (message && !buttonId) {
      await sendMessage(phone,
        `✅ Perfeito! Eu registrei.\n\nViu? É só falar naturalmente.`,
        "whatsapp"
      );
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // SHOWCASE 2: CONSULTAR
    await supabase.from("user_onboarding").update({
      current_step: "showcase_2"
    }).eq("user_id", userId);
    
    await sendMessage(phone,
      `💬 2️⃣ CONSULTAR\n\nVocê pergunta:\n\n💬 "quanto gastei esse mês?"\n💬 "resumo"\n💬 "gastos com alimentação"\n\nEu te respondo na hora com o resumo.`,
      "whatsapp"
    );
    
    await sendButtons(phone,
      `Testa. Pergunta qualquer coisa:`,
      [
        { id: "show_next_2", title: "➡️ Próximo" }
      ],
      "whatsapp"
    );
    
    return true;
  }
  
  // ========================================================================
  // SHOWCASE 2: Consultar (showcase_2)
  // ========================================================================
  
  if (onboarding.current_step === "showcase_2") {
    // Se usuário fez consulta de exemplo
    if (message && !buttonId) {
      await sendMessage(phone,
        `✅ Boa! É assim mesmo.\n\nAgora a última parte...`,
        "whatsapp"
      );
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // SHOWCASE 3: CONTROLAR (específico por plano)
    await supabase.from("user_onboarding").update({
      current_step: "showcase_3"
    }).eq("user_id", userId);
    
    if (planType === "trial" || planType === "pro") {
      // PRO: Mostrar recursos avançados
      await sendMessage(phone,
        `🎯 3️⃣ CONTROLAR (você tem acesso Pro!)\n\nVocê pode:\n\n💰 Orçamentos\n"meu limite mensal é 3000"\n\n🎯 Metas\n"quero juntar 5000 pra viagem"\n\n💳 Dívidas + Simulação\n"registrar dívida Inter 5000"\n"simular quitação"\n\n📊 Insights de IA\nEu analiso e te dou dicas personalizadas.`,
        "whatsapp"
      );
    } else {
      // BÁSICO: Mostrar o que tem + teaser Pro
      await sendMessage(phone,
        `🎯 3️⃣ CONTROLAR (seu plano Básico)\n\nVocê pode:\n\n💰 Orçamentos\n"meu limite mensal é 3000"\n\n🎯 Metas (até 5)\n"quero juntar 5000 pra viagem"\n\n💳 Dívidas (básico)\n"registrar dívida Inter 5000"\n\n🔒 No Pro você ganha:\n• Simulação de cenários\n• Insights de IA\n• Metas ilimitadas`,
        "whatsapp"
      );
    }
    
    await sendButtons(phone,
      `E tem muito mais! Mas vou te mostrando conforme você usar.`,
      [
        { id: "show_finish", title: "✅ Entendi!" }
      ],
      "whatsapp"
    );
    
    return true;
  }
  
  // ========================================================================
  // SHOWCASE 3: Controlar (showcase_3)
  // ========================================================================
  
  if (onboarding.current_step === "showcase_3") {
    await supabase.from("user_onboarding").update({
      current_step: "first_name"
    }).eq("user_id", userId);
    
    await sendMessage(phone,
      `Pronto! 🎉\n\nAgora você sabe o essencial.\n\nQual seu nome?`,
      "whatsapp"
    );
    
    return true;
  }
  
  // ========================================================================
  // STEP FINAL: Nome (first_name)
  // ========================================================================
  
  if (onboarding.current_step === "first_name") {
    const firstName = message.trim().split(" ")[0];
    
    await supabase.from("user_onboarding").update({
      first_name: firstName,
      current_step: "ready"
    }).eq("user_id", userId);
    
    // Criar perfil
    await supabase.from("perfil_cliente").upsert({
      usuario_id: userId,
      operation_mode: "normal",
      preferencias: { 
        first_name: firstName,
        onboarding_completed: true,
        features_shown: [] // Para ajuda contextual
      },
      insights: {}
    }, { onConflict: "usuario_id" });
    
    console.log(`👤 [ONBOARDING] ${firstName} completou - Plano: ${planType}`);
    
    // MENSAGEM FINAL: Certificeira
    await sendMessage(phone,
      `Pronto, ${firstName}! 🚀\n\nVocê tá dentro.\n\nAgora pode:\n• Mandar gastos → "gastei 50 uber"\n• Perguntar → "resumo" / "quanto gastei"\n• Definir metas → "quero juntar 5000"\n\nSe tiver dúvida, só mandar "ajuda".\n\nBora! Manda algo pra testar 👇`,
      "whatsapp"
    );
    
    await supabase.from("user_onboarding").update({
      current_step: "done",
      completed_at: new Date().toISOString()
    }).eq("user_id", userId);
    
    return true;
  }
  
  // ========================================================================
  // DONE: Não interferir mais
  // ========================================================================
  
  if (onboarding.current_step === "done" || onboarding.current_step === "ready") {
    return false; // Deixar fluxo normal processar
  }
  
  return false;
}

// ============================================================================
// 🎓 AJUDA CONTEXTUAL - Chamada automaticamente quando necessário
// ============================================================================

export async function shouldShowContextualHelp(
  userId: string,
  feature: "budget" | "goal" | "debt" | "recurring" | "installment" | "card" | "query" | "report"
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("perfil_cliente")
    .select("preferencias")
    .eq("usuario_id", userId)
    .single();
  
  const featuresShown = (profile?.preferencias?.features_shown || []) as string[];
  
  // Só mostra se nunca mostrou antes
  return !featuresShown.includes(feature);
}

export async function showContextualHelp(
  userId: string,
  phone: string,
  feature: "budget" | "goal" | "debt" | "recurring" | "installment" | "card" | "query" | "report",
  planType: "trial" | "basic" | "pro" = "basic"
): Promise<void> {
  // Mensagens específicas por plano
  const helps: Record<string, { basic: string; pro: string }> = {
    budget: {
      basic: `💡 Dica: Orçamentos\n\nDefina limites:\n"meu limite mensal é 3000"\n"máximo 500 com alimentação"\n\nEu te aviso quando chegar em 50%, 80% e 100%.`,
      pro: `💡 Dica: Orçamentos (Pro)\n\nDefina limites:\n"meu limite mensal é 3000"\n\nEu te aviso E ainda te mostro insights:\n• "Você tá 20% acima do normal"\n• "Dá pra economizar R$ 300 aqui"`
    },
    
    goal: {
      basic: `💡 Dica: Metas (máximo 5)\n\nCrie:\n"quero juntar 5000 pra viagem"\n\nAtualize:\n"guardei 200"\n\nEu acompanho e te aviso quanto falta.`,
      pro: `💡 Dica: Metas (ilimitadas)\n\nCrie quantas quiser:\n"quero juntar 5000 pra viagem"\n\nEu te mostro:\n• Quanto falta\n• Impacto em dias\n• Projeção de quando alcança`
    },
    
    debt: {
      basic: `💡 Dica: Dívidas (básico)\n\nRegistre:\n"registrar dívida Inter 5000"\n\nVeja:\n"minhas dívidas"\n\nEu mostro o total e quando quita.`,
      pro: `💡 Dica: Dívidas (Pro)\n\nRegistre:\n"registrar dívida Inter 5000"\n\nSimule:\n"simular quitação"\n\nEu te mostro 3 cenários:\n• Pagando mínimo\n• Cenário conservador\n• Cenário agressivo\n\n+ Impacto em juros economizados!`
    },
    
    recurring: {
      basic: `💡 Dica: Recorrentes\n\nRegistre gastos mensais:\n"Netflix 40 todo mês"\n\nEu lembro você antes de vencer!`,
      pro: `💡 Dica: Recorrentes (Pro)\n\nRegistre:\n"Netflix 40 todo mês cartão Nubank"\n\nEu vinculo ao cartão e incluo na fatura automaticamente!`
    },
    
    installment: {
      basic: `💡 Dica: Parcelamentos\n\nRegistre:\n"celular 1200 em 12x"\n\nEu rastreio as parcelas e te aviso.`,
      pro: `💡 Dica: Parcelamentos (Pro)\n\nRegistre:\n"celular 1200 em 12x Nubank"\n\nEu incluo na fatura do cartão automaticamente!`
    },
    
    card: {
      basic: `💡 Dica: Cartões (máximo 2)\n\nAdicione:\n"registrar cartão Nubank limite 5000"\n\nEu controlo e aviso quando tá no limite.`,
      pro: `💡 Dica: Cartões (ilimitados)\n\nAdicione quantos quiser:\n"registrar cartão Nubank limite 5000"\n\nEu gero fatura detalhada e te aviso sobre:\n• Limite chegando\n• Gastos atípicos\n• Melhor cartão pra usar`
    },
    
    query: {
      basic: `💡 Dica: Consultas\n\nPergunte:\n"quanto gastei esse mês?"\n"gastos com alimentação"\n"resumo"\n\nEu respondo na hora!`,
      pro: `💡 Dica: Consultas (Pro)\n\nPergunte:\n"quanto gastei com alimentação"\n\nEu respondo + insights:\n• Comparativo mês passado\n• Padrões detectados\n• Sugestões de economia`
    },
    
    report: {
      basic: `💡 Dica: Relatórios\n\nPeça:\n"relatório semanal"\n"relatório mensal"\n\nEu te mando um resumo completo!`,
      pro: `💡 Dica: Relatórios (Pro)\n\nPeça:\n"relatório mensal"\n\nEu te mando:\n• Breakdown completo\n• Insights de IA\n• Progresso de metas\n• Recomendações personalizadas`
    }
  };
  
  const isPro = planType === "trial" || planType === "pro";
  const message = helps[feature]?.[isPro ? "pro" : "basic"];
  
  if (message) {
    await sendMessage(phone, message, "whatsapp");
    
    // Marcar que já mostrou
    const { data: profile } = await supabase
      .from("perfil_cliente")
      .select("preferencias")
      .eq("usuario_id", userId)
      .single();
    
    const featuresShown = (profile?.preferencias?.features_shown || []) as string[];
    
    await supabase
      .from("perfil_cliente")
      .update({
        preferencias: {
          ...profile?.preferencias,
          features_shown: [...featuresShown, feature]
        }
      })
      .eq("usuario_id", userId);
  }
}

// ============================================================================
// 🔔 QUANDO CHAMAR A AJUDA CONTEXTUAL (INTEGRAÇÃO COM INDEX.TS)
// ============================================================================
// 
// No index.ts, chamar assim:
//
// // Quando usuário cria primeiro orçamento
// if (actionType === "set_budget" && await shouldShowContextualHelp(userId, "budget")) {
//   await showContextualHelp(userId, phone, "budget", planType);
// }
//
// // Quando cria primeira meta
// if (actionType === "goal" && await shouldShowContextualHelp(userId, "goal")) {
//   await showContextualHelp(userId, phone, "goal", planType);
// }
//
// // E assim por diante para cada feature
// ============================================================================
