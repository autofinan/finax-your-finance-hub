import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ valid: false, error: "Token é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar sessão válida
    const { data: session, error: sessionError } = await supabase
      .from("user_sessions")
      .select(`
        id,
        usuario_id,
        phone_e164,
        expires_at,
        revoked,
        usuarios (
          id,
          nome,
          phone_number,
          phone_e164,
          plano,
          trial_inicio,
          trial_fim
        )
      `)
      .eq("token", token)
      .eq("revoked", false)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();

    if (sessionError) {
      console.error(`❌ [VALIDATE] Erro ao buscar sessão:`, sessionError);
      return new Response(
        JSON.stringify({ valid: false, error: "Erro interno" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!session) {
      return new Response(
        JSON.stringify({ valid: false, error: "Sessão inválida ou expirada" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar last_used_at
    await supabase
      .from("user_sessions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", session.id);

    const usuario = session.usuarios as any;

    // Calcular status do plano
    let planoStatus = "indefinido";
    let diasRestantesTrial = null;

    if (usuario.plano === "pro" || usuario.plano === "basico") {
      planoStatus = "ativo";
    } else if (usuario.plano === "trial" && usuario.trial_fim) {
      const trialFim = new Date(usuario.trial_fim);
      const agora = new Date();
      if (trialFim > agora) {
        planoStatus = "trial_ativo";
        diasRestantesTrial = Math.ceil((trialFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
      } else {
        planoStatus = "trial_expirado";
      }
    }

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: usuario.id,
          nome: usuario.nome,
          phone: usuario.phone_number,
          phoneE164: usuario.phone_e164,
          plano: usuario.plano,
          planoStatus,
          diasRestantesTrial,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`❌ [VALIDATE] Erro:`, error);
    return new Response(
      JSON.stringify({ valid: false, error: "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
