import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  // Handle CORS preflight
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

    // Handle checkout.session.completed - Initial subscription or one-time payment
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log("Checkout session completed:", {
        customer_email: session.customer_email,
        customer_details: session.customer_details,
        metadata: session.metadata,
      });

      // Get customer phone and email
      const email = session.customer_email || session.customer_details?.email;
      const phone = session.customer_details?.phone || session.metadata?.phone;
      
      if (!email && !phone) {
        console.error("No email or phone in checkout session");
        return new Response(JSON.stringify({ received: true, warning: "No customer contact info" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Determine plan from price ID
      const priceBasico = Deno.env.get("STRIPE_PRICE_BASICO");
      const pricePro = Deno.env.get("STRIPE_PRICE_PRO");
      
      // Get line items to determine which plan was purchased
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      let planoPurchased = "basico"; // default
      
      for (const item of lineItems.data) {
        if (item.price?.id === pricePro) {
          planoPurchased = "pro";
          break;
        } else if (item.price?.id === priceBasico) {
          planoPurchased = "basico";
          break;
        }
      }

      console.log(`Plan purchased: ${planoPurchased} for ${email || phone}`);

      // Find user by email or phone
      let userQuery = supabase.from("usuarios").select("*");
      
      if (phone) {
        // Normalize phone number
        const normalizedPhone = phone.replace(/\D/g, "");
        userQuery = userQuery.or(`phone_number.eq.${phone},phone_number.ilike.%${normalizedPhone.slice(-9)}%`);
      } else if (email) {
        // Try to find by phone number stored with email pattern or metadata
        userQuery = userQuery.eq("phone_number", email);
      }

      const { data: users, error: userError } = await userQuery.maybeSingle();

      if (userError) {
        console.error("Error finding user:", userError);
      }

      if (users) {
        // Update existing user's plan
        const { error: updateError } = await supabase
          .from("usuarios")
          .update({
            plano: planoPurchased,
            trial_fim: null, // Clear trial end since they're now paying
            updated_at: new Date().toISOString(),
          })
          .eq("id", users.id);

        if (updateError) {
          console.error("Error updating user plan:", updateError);
        } else {
          console.log(`User ${users.id} upgraded to ${planoPurchased}`);
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
            phone_number_destino: phone,
            transaction_id: session.id,
            valido_ate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            origem: "stripe_checkout",
            valor_pago: session.amount_total ? session.amount_total / 100 : null,
          });

        if (codeError) {
          console.error("Error creating activation code:", codeError);
        } else {
          console.log(`Created activation code ${activationCode} for ${email || phone}`);
          // TODO: Send email/SMS with activation code
        }
      }
    }

    // Handle subscription updates
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      console.log("Subscription updated:", subscription.id);
      
      // Get customer email
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      if (!customer.deleted && customer.email) {
        const priceId = subscription.items.data[0]?.price.id;
        const pricePro = Deno.env.get("STRIPE_PRICE_PRO");
        
        const newPlan = priceId === pricePro ? "pro" : "basico";
        
        // Find and update user
        const { data: users } = await supabase
          .from("usuarios")
          .select("*")
          .ilike("phone_number", `%${customer.email}%`)
          .maybeSingle();

        if (users) {
          await supabase
            .from("usuarios")
            .update({ plano: newPlan, updated_at: new Date().toISOString() })
            .eq("id", users.id);
          console.log(`User ${users.id} subscription updated to ${newPlan}`);
        }
      }
    }

    // Handle subscription cancellation
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      console.log("Subscription canceled:", subscription.id);
      
      const customer = await stripe.customers.retrieve(subscription.customer as string);
      if (!customer.deleted && customer.email) {
        // Find and downgrade user to trial (expired)
        const { data: users } = await supabase
          .from("usuarios")
          .select("*")
          .ilike("phone_number", `%${customer.email}%`)
          .maybeSingle();

        if (users) {
          await supabase
            .from("usuarios")
            .update({
              plano: "trial",
              trial_fim: new Date().toISOString(), // Expired trial
              updated_at: new Date().toISOString(),
            })
            .eq("id", users.id);
          console.log(`User ${users.id} subscription canceled, set to expired trial`);
        }
      }
    }

    // Handle payment failures
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      console.log("Payment failed for invoice:", invoice.id);
      // Could send notification to user about failed payment
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
