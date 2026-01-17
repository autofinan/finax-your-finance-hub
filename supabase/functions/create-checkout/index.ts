import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  if (!stripeSecretKey) {
    console.error("Missing STRIPE_SECRET_KEY");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const { plan, successUrl, cancelUrl, email, phone } = await req.json();

    console.log("Creating checkout session:", { plan, email, phone });

    // Get price ID based on plan
    const priceBasico = Deno.env.get("STRIPE_PRICE_BASICO");
    const pricePro = Deno.env.get("STRIPE_PRICE_PRO");

    if (!priceBasico || !pricePro) {
      console.error("Missing Stripe price IDs");
      return new Response(JSON.stringify({ error: "Price configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceId = plan === "pro" ? pricePro : priceBasico;

    // Check if customer exists
    let customerId: string | undefined;
    
    if (email) {
      const existingCustomers = await stripe.customers.list({
        email: email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
        console.log("Found existing customer:", customerId);
      }
    }

    // Create Stripe Checkout session
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl || "https://finaxassistente.lovable.app/dashboard?success=true",
      cancel_url: cancelUrl || "https://finaxassistente.lovable.app/dashboard?canceled=true",
      metadata: {
        plan: plan,
        phone: phone || "",
      },
      subscription_data: {
        metadata: {
          plan: plan,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      phone_number_collection: {
        enabled: true,
      },
    };

    // Add customer info
    if (customerId) {
      sessionConfig.customer = customerId;
    } else if (email) {
      sessionConfig.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log("Checkout session created:", session.id);

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error creating checkout session:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
