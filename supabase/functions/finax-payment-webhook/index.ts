import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) {
    // Already has country code
  } else if (digits.length === 11 || digits.length === 10) {
    digits = "55" + digits;
  }
  return "+" + digits;
}

function getLast9Digits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

// ============================================================================
// 📱 ENVIAR NOTIFICAÇÃO WHATSAPP DE ATIVAÇÃO
// ============================================================================
async function sendWhatsAppActivation(phone: string, plano: string, nomeUsuario: string): Promise<void> {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn("[WEBHOOK] Missing WhatsApp config, skipping notification");
    return;
  }

  const primeiroNome = nomeUsuario.split(" ")[0] || "amigo(a)";
  const isPro = plano === "pro";

  const features = isPro
    ? `✅ Simulador de quitação de dívidas\n✅ Insights preditivos com IA\n✅ Cartões e metas ilimitados\n✅ Relatórios avançados com IA\n✅ Suporte prioritário`
    : `✅ Registro ilimitado via WhatsApp\n✅ Relatórios semanais e mensais\n✅ Controle de gastos recorrentes\n✅ Orçamentos por categoria\n✅ Até 2 cartões e 5 metas`;

  const message = `🎉 *Plano ${isPro ? "Pro" : "Básico"} ativado, ${primeiroNome}!*\n\nSeu pagamento foi confirmado e seu plano já está ativo.\n\n*O que você tem acesso agora:*\n${features}\n\n━━━━━━━━━━━━━━━━━━\n\nPode usar normalmente! Me manda algo pra testar 👇`;

  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone.replace("+", ""),
        type: "text",
        text: { body: message },
      }),
    });

    if (!response.ok) {
      console.error("[WEBHOOK] WhatsApp send failed:", await response.text());
    } else {
      console.log(`[WEBHOOK] ✅ WhatsApp notification sent to ${phone}`);
    }
  } catch (err) {
    console.error("[WEBHOOK] WhatsApp send error:", err);
  }
}

// ============================================================================
// 📧 ENVIAR CÓDIGO DE ATIVAÇÃO VIA WHATSAPP
// ============================================================================
async function sendActivationCode(phone: string, code: string, plano: string): Promise<void> {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !phone) return;

  const normalizedPhone = normalizePhone(phone).replace("+", "");

  const message = `🔑 *Código de Ativação Finax*\n\nSeu pagamento foi confirmado!\n\nPara ativar seu plano *${plano === "pro" ? "Pro" : "Básico"}*, envie este código para o Finax no WhatsApp:\n\n*${code}*\n\nOu salve o número do Finax e mande "oi" para começar! 💙`;

  try {
    await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizedPhone,
        type: "text",
        text: { body: message },
      }),
    });
    console.log(`[WEBHOOK] Activation code sent to ${normalizedPhone}`);
  } catch (err) {
    console.error("[WEBHOOK] Error sending activation code:", err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!stripeSecretKey || !webhookSecret) {
    console.error("Missing Stripe configuration");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response(JSON.stringify({ error: "No signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Webhook signature verification failed:", message);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing Stripe event: ${event.type}`);

    // ========================================================================
    // ✅ CHECKOUT COMPLETED
    // ========================================================================
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const email = session.customer_email || session.customer_details?.email;
      const rawPhone = session.customer_details?.phone || session.metadata?.phone;

      if (!email && !rawPhone) {
        console.error("No email or phone in checkout session");
        return new Response(JSON.stringify({ received: true, warning: "No contact info" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const phoneE164 = rawPhone ? normalizePhone(rawPhone) : null;
      const phoneLast9 = rawPhone ? getLast9Digits(rawPhone) : null;

      console.log(`Phone: raw=${rawPhone}, E164=${phoneE164}, last9=${phoneLast9}`);

      // Determine plan
      const priceBasico = Deno.env.get("STRIPE_PRICE_BASICO");
      const pricePro = Deno.env.get("STRIPE_PRICE_PRO");
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      let planoPurchased = "basico";
      for (const item of lineItems.data) {
        if (item.price?.id === pricePro) { planoPurchased = "pro"; break; }
        else if (item.price?.id === priceBasico) { planoPurchased = "basico"; break; }
      }

      console.log(`Plan purchased: ${planoPurchased}`);

      // ====================================================================
      // 🔍 FIND USER - Multiple matching strategies
      // ====================================================================
      let user = null;

      // Strategy 1: phone_e164 exact match
      if (phoneE164) {
        const { data: u } = await supabase.from("usuarios").select("*").eq("phone_e164", phoneE164).maybeSingle();
        if (u) { user = u; console.log(`Found by phone_e164: ${user.id}`); }
      }

      // Strategy 2: last 9 digits
      if (!user && phoneLast9) {
        const { data: users } = await supabase.from("usuarios").select("*").ilike("phone_number", `%${phoneLast9}`);
        if (users?.length === 1) { user = users[0]; console.log(`Found by last9: ${user.id}`); }
      }

      // Strategy 3: phone_number contains last 8 digits (broader)
      if (!user && phoneLast9) {
        const last8 = phoneLast9.slice(-8);
        const { data: users } = await supabase.from("usuarios").select("*").ilike("phone_number", `%${last8}`);
        if (users?.length === 1) { user = users[0]; console.log(`Found by last8: ${user.id}`); }
      }

      // ====================================================================
      // ✅ USER FOUND → Activate directly + WhatsApp notification
      // ====================================================================
      if (user) {
        const { error: updateError } = await supabase
          .from("usuarios")
          .update({
            plano: planoPurchased,
            trial_fim: null,
            updated_at: new Date().toISOString(),
            ...(phoneE164 && !user.phone_e164 ? { phone_e164: phoneE164 } : {}),
          })
          .eq("id", user.id);

        if (updateError) {
          console.error("Error updating user plan:", updateError);
        } else {
          console.log(`✅ User ${user.id} upgraded to ${planoPurchased}`);

          // 📱 Send WhatsApp notification
          const userPhone = user.phone_number || user.phone_e164 || phoneE164;
          if (userPhone) {
            await sendWhatsAppActivation(
              userPhone.startsWith("+") ? userPhone : normalizePhone(userPhone),
              planoPurchased,
              user.nome || "amigo(a)"
            );
          }

          // Log activation
          await supabase.from("historico_conversas").insert({
            phone_number: userPhone || "",
            user_id: user.id,
            user_message: `[STRIPE CHECKOUT - ${planoPurchased}]`,
            ai_response: `Plano ${planoPurchased} ativado automaticamente via Stripe`,
            tipo: "ativacao"
          });
        }
      } else {
        // ====================================================================
        // 🔑 USER NOT FOUND → Create activation code + send via WhatsApp
        // ====================================================================
        const activationCode = `FINAX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        const { error: codeError } = await supabase.from("codigos_ativacao").insert({
          codigo: activationCode,
          plano_destino: planoPurchased,
          email_comprador: email,
          phone_number_destino: rawPhone,
          transaction_id: session.id,
          valido_ate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          origem: "stripe_checkout",
          valor_pago: session.amount_total ? session.amount_total / 100 : null,
        });

        if (codeError) {
          console.error("Error creating activation code:", codeError);
        } else {
          console.log(`Created activation code ${activationCode} for ${email || rawPhone}`);

          // Send code via WhatsApp if phone available
          if (rawPhone) {
            await sendActivationCode(rawPhone, activationCode, planoPurchased);
          }
        }
      }
    }

    // ========================================================================
    // 🔄 SUBSCRIPTION UPDATED
    // ========================================================================
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      if (!customer.deleted && customer.phone) {
        const phoneE164 = normalizePhone(customer.phone);
        const priceId = subscription.items.data[0]?.price.id;
        const pricePro = Deno.env.get("STRIPE_PRICE_PRO");
        const newPlan = priceId === pricePro ? "pro" : "basico";

        const { data: user } = await supabase.from("usuarios").select("*").eq("phone_e164", phoneE164).maybeSingle();
        if (user) {
          await supabase.from("usuarios").update({ plano: newPlan, updated_at: new Date().toISOString() }).eq("id", user.id);
          console.log(`User ${user.id} subscription updated to ${newPlan}`);
        }
      }
    }

    // ========================================================================
    // ❌ SUBSCRIPTION CANCELED
    // ========================================================================
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      if (!customer.deleted && customer.phone) {
        const phoneE164 = normalizePhone(customer.phone);
        const { data: user } = await supabase.from("usuarios").select("*").eq("phone_e164", phoneE164).maybeSingle();
        if (user) {
          await supabase.from("usuarios").update({
            plano: "expired",
            trial_fim: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", user.id);
          console.log(`User ${user.id} subscription canceled`);
        }
      }
    }

    // Handle payment failures
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      console.log("Payment failed for invoice:", invoice.id);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
