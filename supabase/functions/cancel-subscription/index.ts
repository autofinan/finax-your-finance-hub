import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ================================================================
    // 🔐 AUTHENTICATION: Validate session token
    // ================================================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Token de autenticação obrigatório" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const { data: session, error: sessionError } = await supabase
      .from("user_sessions")
      .select("usuario_id")
      .eq("token", token)
      .eq("revoked", false)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ error: "Sessão inválida ou expirada" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authenticatedUserId = session.usuario_id;

    // ================================================================
    // 📦 Parse body (motivo/detalhes only - userId comes from session)
    // ================================================================
    const { motivo, detalhes, ofertaRecusada } = await req.json();

    console.log(`🚫 [CANCEL] Iniciando cancelamento para: ${authenticatedUserId}`);

    // Buscar usuário autenticado
    const { data: usuario, error: userError } = await supabase
      .from("usuarios")
      .select("*")
      .eq("id", authenticatedUserId)
      .maybeSingle();

    if (userError || !usuario) {
      console.error(`❌ [CANCEL] Usuário não encontrado:`, userError);
      return new Response(
        JSON.stringify({ error: "Usuário não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calcular meses como assinante
    let mesesAssinante = 0;
    if (usuario.created_at) {
      const criado = new Date(usuario.created_at);
      const agora = new Date();
      mesesAssinante = Math.floor((agora.getTime() - criado.getTime()) / (1000 * 60 * 60 * 24 * 30));
    }

    // Registrar cancelamento
    const { error: cancelError } = await supabase
      .from("cancelamentos")
      .insert({
        usuario_id: usuario.id,
        phone_number: usuario.phone_number,
        motivo: motivo || "Não informado",
        detalhes: detalhes || null,
        plano_anterior: usuario.plano,
        meses_assinante: mesesAssinante,
        ofertas_recusadas: ofertaRecusada ? [ofertaRecusada] : null,
      });

    if (cancelError) {
      console.error(`❌ [CANCEL] Erro ao registrar cancelamento:`, cancelError);
    }

    // Tentar cancelar no Stripe se tiver chave configurada
    let stripeCanceled = false;
    if (STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(STRIPE_SECRET_KEY, {
          apiVersion: "2023-10-16",
          httpClient: Stripe.createFetchHttpClient(),
        });

        // Buscar customer pelo phone
        const customers = await stripe.customers.search({
          query: `phone:'${usuario.phone_e164 || usuario.phone_number}'`,
        });

        if (customers.data.length > 0) {
          const customerId = customers.data[0].id;
          
          const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: "active",
          });

          for (const sub of subscriptions.data) {
            await stripe.subscriptions.cancel(sub.id);
            console.log(`✅ [CANCEL] Assinatura Stripe cancelada: ${sub.id}`);
            stripeCanceled = true;
          }
        }
      } catch (stripeError) {
        console.error(`⚠️ [CANCEL] Erro no Stripe:`, stripeError);
      }
    }

    // Atualizar usuário para trial expirado
    const { error: updateError } = await supabase
      .from("usuarios")
      .update({
        plano: "trial",
        trial_fim: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", usuario.id);

    if (updateError) {
      console.error(`❌ [CANCEL] Erro ao atualizar usuário:`, updateError);
      return new Response(
        JSON.stringify({ error: "Erro ao processar cancelamento" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ [CANCEL] Cancelamento concluído para ${usuario.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Assinatura cancelada com sucesso",
        stripeCanceled,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`❌ [CANCEL] Erro:`, error);
    return new Response(
      JSON.stringify({ error: "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
