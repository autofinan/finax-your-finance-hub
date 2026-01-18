import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Normalizar telefone para formato E.164
function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return "+" + digits;
  }
  
  if (digits.length >= 10 && digits.length <= 11) {
    return "+55" + digits;
  }
  
  return digits.startsWith("+") ? digits : "+" + digits;
}

// Gerar token de sessão seguro
function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, "0")).join("");
}

// Gerar refresh token
function generateRefreshToken(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, code } = await req.json();

    if (!phone || !code) {
      return new Response(
        JSON.stringify({ error: "Telefone e código são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const phoneE164 = normalizePhoneE164(phone);

    console.log(`🔐 [VERIFY] Verificando código para: ${phoneE164}`);

    // Buscar código válido
    const { data: otpRecord, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("phone_e164", phoneE164)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError) {
      console.error(`❌ [VERIFY] Erro ao buscar OTP:`, otpError);
      return new Response(
        JSON.stringify({ error: "Erro interno" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!otpRecord) {
      return new Response(
        JSON.stringify({ 
          error: "Código expirado ou inválido",
          message: "Solicite um novo código."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar tentativas (máximo 3)
    if (otpRecord.attempts >= 3) {
      // Marcar como usado para bloquear
      await supabase
        .from("otp_codes")
        .update({ used: true })
        .eq("id", otpRecord.id);

      return new Response(
        JSON.stringify({ 
          error: "Muitas tentativas",
          message: "Você excedeu o limite de tentativas. Solicite um novo código."
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar código
    if (otpRecord.code !== code) {
      // Incrementar tentativas
      await supabase
        .from("otp_codes")
        .update({ attempts: otpRecord.attempts + 1 })
        .eq("id", otpRecord.id);

      const attemptsLeft = 3 - (otpRecord.attempts + 1);
      return new Response(
        JSON.stringify({ 
          error: "Código incorreto",
          message: `Código inválido. ${attemptsLeft} tentativa${attemptsLeft !== 1 ? 's' : ''} restante${attemptsLeft !== 1 ? 's' : ''}.`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Código correto! Marcar como usado
    await supabase
      .from("otp_codes")
      .update({ used: true })
      .eq("id", otpRecord.id);

    // Buscar usuário
    const phoneDigits = phone.replace(/\D/g, "");
    const { data: usuario, error: userError } = await supabase
      .from("usuarios")
      .select("id, phone_number, phone_e164, nome, plano, trial_inicio, trial_fim")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneDigits.slice(-9)}%`)
      .maybeSingle();

    if (userError || !usuario) {
      console.error(`❌ [VERIFY] Usuário não encontrado:`, userError);
      return new Response(
        JSON.stringify({ error: "Usuário não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar phone_e164 se necessário
    if (!usuario.phone_e164) {
      await supabase
        .from("usuarios")
        .update({ phone_e164: phoneE164 })
        .eq("id", usuario.id);
    }

    // Revogar sessões antigas
    await supabase
      .from("user_sessions")
      .update({ revoked: true })
      .eq("usuario_id", usuario.id)
      .eq("revoked", false);

    // Criar nova sessão
    const token = generateSessionToken();
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 dias

    const { error: sessionError } = await supabase
      .from("user_sessions")
      .insert({
        usuario_id: usuario.id,
        phone_e164: phoneE164,
        token,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        user_agent: req.headers.get("user-agent") || null,
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null,
      });

    if (sessionError) {
      console.error(`❌ [VERIFY] Erro ao criar sessão:`, sessionError);
      return new Response(
        JSON.stringify({ error: "Erro ao criar sessão" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ [VERIFY] Sessão criada para ${usuario.id}`);

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
        success: true,
        token,
        refreshToken,
        expiresAt,
        user: {
          id: usuario.id,
          nome: usuario.nome,
          phone: usuario.phone_number,
          phoneE164: phoneE164,
          plano: usuario.plano,
          planoStatus,
          diasRestantesTrial,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`❌ [VERIFY] Erro:`, error);
    return new Response(
      JSON.stringify({ error: "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
