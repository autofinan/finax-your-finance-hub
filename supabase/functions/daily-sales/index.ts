// ============================================================================
// 📅 DAILY SALES — Cron job para sequência de vendas automática
// ============================================================================
// Executa diariamente e envia mensagens de venda personalizadas
// baseadas no estágio do trial de cada usuário.
// Toques: D-2, D-1, D+1, D+7
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📤 ENVIO WHATSAPP (simplificado — usa Meta diretamente)
// ============================================================================

async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error("[DAILY-SALES] WhatsApp credentials missing");
    return false;
  }

  try {
    const cleanNumber = phone.replace(/\D/g, "");
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanNumber,
          type: "text",
          text: { body: message },
        }),
      }
    );
    if (!response.ok) {
      console.error(`[DAILY-SALES] WhatsApp error: ${response.status}`, await response.text());
    }
    return response.ok;
  } catch (err) {
    console.error("[DAILY-SALES] WhatsApp exception:", err);
    return false;
  }
}

// ============================================================================
// 💰 CHECKOUT URL GENERATOR
// ============================================================================

async function generateCheckoutUrl(planType: "basico" | "pro", phone: string): Promise<string> {
  const SITE_URL = "https://finaxai.vercel.app";
  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId = planType === "pro"
      ? Deno.env.get("STRIPE_PRICE_PRO")
      : Deno.env.get("STRIPE_PRICE_BASICO");

    if (!stripeSecretKey || !priceId) {
      return `${SITE_URL}/?plan=${planType}`;
    }

    const { default: Stripe } = await import("https://esm.sh/stripe@14.21.0?target=deno");
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/dashboard?success=true&plan=${planType}`,
      cancel_url: `${SITE_URL}/?canceled=true`,
      metadata: { plan: planType, phone },
      subscription_data: { metadata: { plan: planType } },
      allow_promotion_codes: true,
      phone_number_collection: { enabled: true },
    });

    return session.url || `${SITE_URL}/?plan=${planType}`;
  } catch (err) {
    console.error("[DAILY-SALES] Stripe error:", err);
    return `${SITE_URL}/?plan=${planType}`;
  }
}

// ============================================================================
// 🔗 ENCURTADOR
// ============================================================================

async function shortenURL(longURL: string, userId?: string, campaign?: string): Promise<string> {
  try {
    const shortCode = Math.random().toString(36).substring(2, 8).toLowerCase();
    const { error } = await supabase.from("short_links").insert({
      short_code: shortCode,
      long_url: longURL,
      user_id: userId || null,
      campaign: campaign || "daily_sales",
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) return longURL;
    return `${SUPABASE_URL}/functions/v1/redirect?c=${shortCode}`;
  } catch {
    return longURL;
  }
}

// ============================================================================
// 📊 USER STATS
// ============================================================================

async function getUserStats(userId: string) {
  const [transResult, dividasResult, metasResult, recResult] = await Promise.all([
    supabase.from("transacoes").select("valor, tipo, expense_type").eq("usuario_id", userId).neq("status", "cancelada").limit(10000),
    supabase.from("dividas").select("id", { count: "exact", head: true }).eq("usuario_id", userId).eq("ativa", true),
    supabase.from("orcamentos").select("id", { count: "exact", head: true }).eq("usuario_id", userId).eq("ativo", true),
    supabase.from("gastos_recorrentes").select("id", { count: "exact", head: true }).eq("usuario_id", userId).eq("ativo", true),
  ]);

  const tx = transResult.data || [];
  const ajustavel = tx
    .filter(t => ["flexivel", "lazer_social", "impulso"].includes(t.expense_type || ""))
    .reduce((s, t) => s + Math.abs(t.valor || 0), 0);

  return {
    totalTx: tx.length,
    totalDividas: dividasResult.count || 0,
    totalMetas: metasResult.count || 0,
    totalRec: recResult.count || 0,
    ajustavel,
  };
}

// ============================================================================
// 📧 MENSAGENS POR ESTÁGIO
// ============================================================================

function buildMessage(
  stage: string,
  firstName: string,
  stats: Awaited<ReturnType<typeof getUserStats>>,
  urlBasico: string,
  urlPro: string,
): string | null {
  if (stage === "d_minus_2") {
    if (stats.totalTx > 20) {
      return `${firstName}, seu trial acaba em *2 dias*. ⏳\n\nVocê já registrou *${stats.totalTx} transações*${stats.ajustavel > 0 ? ` e identificou R$ ${stats.ajustavel.toFixed(0)} em gastos ajustáveis` : ""}.\n\nPra manter tudo:\n📱 Básico: ${urlBasico}\n⭐ Pro: ${urlPro}\n\nQualquer dúvida, só chamar!`;
    }
    return `${firstName}, seu trial Pro acaba em *2 dias*! ⏰\n\n💡 Quem usa o Finax nos primeiros 30 dias economiza em média 20%.\n\n📱 Básico — R$ 19,90: ${urlBasico}\n⭐ Pro — R$ 29,90: ${urlPro}`;
  }

  if (stage === "d_minus_1") {
    let hook = "";
    if (stats.totalDividas > 0) hook = `\n\nVocê tem *${stats.totalDividas} dívida(s)*. Sem o Pro, perde o simulador de quitação.`;
    else if (stats.totalMetas > 0) hook = `\n\nVocê tem *${stats.totalMetas} orçamento(s)* ativos. No Básico, limite é 5.`;
    return `🚨 *${firstName}, AMANHÃ seu trial acaba!*${hook}\n\nSe não assinar, perde:\n❌ Simulador de dívidas\n❌ Insights com IA\n❌ Cartões ilimitados\n\n📱 Básico: ${urlBasico}\n⭐ Pro: ${urlPro}\n\n(R$ 29,90/mês = menos de R$ 1/dia)`;
  }

  if (stage === "d_plus_1") {
    if (stats.totalTx > 30) {
      return `${firstName}, seu trial acabou. 😔\n\nVocê registrou *${stats.totalTx} transações*. Tudo continua salvo.\n\nAssine e retome:\n📱 Básico: ${urlBasico}\n⭐ Pro: ${urlPro}\n\nSeus dados estão esperando! 📊`;
    }
    return `${firstName}, seu trial acabou.\n\n💡 Quem usa o Finax Pro economiza R$ 300/mês em média.\n\n📱 Básico: ${urlBasico}\n⭐ Pro: ${urlPro}`;
  }

  if (stage === "d_plus_7") {
    return `${firstName}, faz 1 semana que seu trial acabou.\n\nSeus dados ainda estão salvos, mas não por muito tempo.\n\nÚltima chance:\n📱 Básico — R$ 19,90: ${urlBasico}\n⭐ Pro — R$ 29,90: ${urlPro}\n\nDepois disso, não vou mais insistir. A decisão é sua. 🤝`;
  }

  return null;
}

// ============================================================================
// 🏭 MAIN: PROCESSAR TODOS OS USUÁRIOS
// ============================================================================

async function runDailySales(): Promise<{ processed: number; sent: number; errors: number }> {
  const now = new Date();
  let processed = 0;
  let sent = 0;
  let errors = 0;

  // Fetch ALL users with trial_fim set
  const { data: users, error } = await supabase
    .from("usuarios")
    .select("id, nome, phone_number, trial_fim, plano")
    .not("trial_fim", "is", null)
    .eq("ativo", true);

  if (error || !users) {
    console.error("[DAILY-SALES] Error fetching users:", error);
    return { processed: 0, sent: 0, errors: 1 };
  }

  console.log(`[DAILY-SALES] Found ${users.length} users with trial_fim`);

  for (const user of users) {
    // Skip users who already have a paid plan
    if (user.plano && !["trial"].includes(user.plano)) continue;

    const trialEnd = new Date(user.trial_fim);
    const daysUntilEnd = Math.round((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    let stage: string | null = null;
    if (daysUntilEnd === 2) stage = "d_minus_2";
    else if (daysUntilEnd === 1) stage = "d_minus_1";
    else if (daysUntilEnd === -1) stage = "d_plus_1";
    else if (daysUntilEnd === -7) stage = "d_plus_7";

    if (!stage) continue;

    processed++;

    // Check if we already sent this stage
    const { data: alreadySent } = await supabase
      .from("historico_conversas")
      .select("id")
      .eq("user_id", user.id)
      .eq("tipo", `venda_${stage}`)
      .limit(1);

    if (alreadySent && alreadySent.length > 0) {
      console.log(`[DAILY-SALES] Skipping ${user.nome} — ${stage} already sent`);
      continue;
    }

    try {
      const firstName = (user.nome || "amigo(a)").split(" ")[0];
      const stats = await getUserStats(user.id);

      // Generate checkout URLs
      const rawBasico = await generateCheckoutUrl("basico", user.phone_number);
      const rawPro = await generateCheckoutUrl("pro", user.phone_number);

      // Shorten URLs
      const urlBasico = await shortenURL(rawBasico, user.id, `${stage}_basico`);
      const urlPro = await shortenURL(rawPro, user.id, `${stage}_pro`);

      const message = buildMessage(stage, firstName, stats, urlBasico, urlPro);

      if (message) {
        const success = await sendWhatsApp(user.phone_number, message);
        if (success) {
          sent++;
          console.log(`✅ [DAILY-SALES] ${stage} → ${firstName}`);
        } else {
          errors++;
        }

        // Log regardless of success
        await supabase.from("historico_conversas").insert({
          phone_number: user.phone_number,
          user_id: user.id,
          user_message: `[CRON ${stage}]`,
          ai_response: message.substring(0, 200),
          tipo: `venda_${stage}`,
        });
      }
    } catch (err) {
      errors++;
      console.error(`[DAILY-SALES] Error for user ${user.id}:`, err);
    }
  }

  return { processed, sent, errors };
}

// ============================================================================
// 🚀 SERVE
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log(`\n📅 [DAILY-SALES] Starting daily sales sequence...`);

  try {
    const result = await runDailySales();
    console.log(`📅 [DAILY-SALES] Done: ${result.processed} processed, ${result.sent} sent, ${result.errors} errors`);

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[DAILY-SALES] Fatal error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
