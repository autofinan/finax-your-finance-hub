import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// Normalize phone to E.164 format
function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, "");
  
  // Handle Brazilian numbers
  if (digits.startsWith("55")) {
    // Already has country code
  } else if (digits.length === 11 || digits.length === 10) {
    // Add country code
    digits = "55" + digits;
  }
  
  return "+" + digits;
}

// Get last 9 digits for fallback matching
function getLast9Digits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
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
      console.error("No Stripe signature found");
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

    // Handle checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log("Checkout session completed:", {
        customer_email: session.customer_email,
        customer_details: session.customer_details,
        metadata: session.metadata,
      });

      // Get customer phone and email
      const email = session.customer_email || session.customer_details?.email;
      const rawPhone = session.customer_details?.phone || session.metadata?.phone;
      
      if (!email && !rawPhone) {
        console.error("No email or phone in checkout session");
        return new Response(JSON.stringify({ received: true, warning: "No customer contact info" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Normalize phone number
      const phoneE164 = rawPhone ? normalizePhone(rawPhone) : null;
      const phoneLast9 = rawPhone ? getLast9Digits(rawPhone) : null;

      console.log(`Phone normalization: raw=${rawPhone}, E164=${phoneE164}, last9=${phoneLast9}`);

      // Determine plan from price ID
      const priceBasico = Deno.env.get("STRIPE_PRICE_BASICO");
      const pricePro = Deno.env.get("STRIPE_PRICE_PRO");
      
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      let planoPurchased = "basico";
      
      for (const item of lineItems.data) {
        if (item.price?.id === pricePro) {
          planoPurchased = "pro";
          break;
        } else if (item.price?.id === priceBasico) {
          planoPurchased = "basico";
          break;
        }
      }

      console.log(`Plan purchased: ${planoPurchased}`);

      // Try to find user with multiple matching strategies
      let user = null;

      // Strategy 1: Try phone_e164 exact match
      if (phoneE164) {
        const { data: userByE164 } = await supabase
          .from("usuarios")
          .select("*")
          .eq("phone_e164", phoneE164)
          .maybeSingle();
        
        if (userByE164) {
          user = userByE164;
          console.log(`Found user by phone_e164: ${user.id}`);
        }
      }

      // Strategy 2: Try last 9 digits fallback
      if (!user && phoneLast9) {
        const { data: usersByPartial } = await supabase
          .from("usuarios")
          .select("*")
          .ilike("phone_number", `%${phoneLast9}`);
        
        if (usersByPartial && usersByPartial.length === 1) {
          user = usersByPartial[0];
          console.log(`Found user by last 9 digits: ${user.id}`);
        } else if (usersByPartial && usersByPartial.length > 1) {
          console.warn(`Multiple users found with last 9 digits: ${phoneLast9}`);
        }
      }

      // Strategy 3: Try email-like phone_number
      if (!user && email) {
        const { data: userByEmail } = await supabase
          .from("usuarios")
          .select("*")
          .eq("phone_number", email)
          .maybeSingle();
        
        if (userByEmail) {
          user = userByEmail;
          console.log(`Found user by email in phone_number: ${user.id}`);
        }
      }

      if (user) {
        // Update existing user's plan
        const { error: updateError } = await supabase
          .from("usuarios")
          .update({
            plano: planoPurchased,
            trial_fim: null,
            updated_at: new Date().toISOString(),
            // Also update phone_e164 if we have it
            ...(phoneE164 && !user.phone_e164 ? { phone_e164: phoneE164 } : {}),
          })
          .eq("id", user.id);

        if (updateError) {
          console.error("Error updating user plan:", updateError);
        } else {
          console.log(`User ${user.id} upgraded to ${planoPurchased}`);
          
          // TODO: Send WhatsApp confirmation message
          // This would use the messages_outbox table
        }
      } else {
        // Create activation code for user to claim later
        const activationCode = `FINAX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        
        const { error: codeError } = await supabase
          .from("codigos_ativacao")
          .insert({
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
          
          // TODO: Send code via WhatsApp/Email
        }
      }
    }

    // Handle subscription updates
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      console.log("Subscription updated:", subscription.id);
      
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      if (!customer.deleted && customer.phone) {
        const phoneE164 = normalizePhone(customer.phone);
        const priceId = subscription.items.data[0]?.price.id;
        const pricePro = Deno.env.get("STRIPE_PRICE_PRO");
        
        const newPlan = priceId === pricePro ? "pro" : "basico";
        
        const { data: user } = await supabase
          .from("usuarios")
          .select("*")
          .eq("phone_e164", phoneE164)
          .maybeSingle();

        if (user) {
          await supabase
            .from("usuarios")
            .update({ plano: newPlan, updated_at: new Date().toISOString() })
            .eq("id", user.id);
          console.log(`User ${user.id} subscription updated to ${newPlan}`);
        }
      }
    }

    // Handle subscription cancellation
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      console.log("Subscription canceled:", subscription.id);
      
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      if (!customer.deleted && customer.phone) {
        const phoneE164 = normalizePhone(customer.phone);
        
        const { data: user } = await supabase
          .from("usuarios")
          .select("*")
          .eq("phone_e164", phoneE164)
          .maybeSingle();

        if (user) {
          await supabase
            .from("usuarios")
            .update({
              plano: "expired",
              trial_fim: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", user.id);
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
