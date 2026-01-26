import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📱 NORMALIZAÇÃO ROBUSTA DE TELEFONE
// ============================================================================

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

// Extrair últimos 8 dígitos para matching flexível (ignora 9° dígito)
function extractPhoneLast8(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-8);
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
    const phoneLast8 = extractPhoneLast8(phone);

    console.log(`🔐 [VERIFY] Verificando código para: ${phoneE164} (last8: ${phoneLast8})`);

    // ========================================================================
    // 🔍 BUSCA FLEXÍVEL DE CÓDIGO OTP
    // ========================================================================
    // Buscar por phone_e164 OU últimos 8 dígitos para maior flexibilidade
    // ========================================================================
    const { data: otpRecord, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneLast8}%`)
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

    // ========================================================================
    // 🔍 BUSCA FLEXÍVEL DE USUÁRIO
    // ========================================================================
    const { data: usuario, error: userError } = await supabase
      .from("usuarios")
      .select("id, phone_number, phone_e164, nome, plano, trial_inicio, trial_fim")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneLast8}%,phone_e164.ilike.%${phoneLast8}%`)
      .maybeSingle();

    if (userError || !usuario) {
      console.error(`❌ [VERIFY] Usuário não encontrado:`, userError);
      return new Response(
        JSON.stringify({ error: "Usuário não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ [VERIFY] Usuário encontrado: ${usuario.id} (${usuario.nome})`);

    // ========================================================================
    // 🔗 CRIAR/ATUALIZAR AUTH.USER E VINCULAR AUTH_ID
    // ========================================================================
    // Isso permite que o site use auth.uid() para filtrar dados do WhatsApp
    // ========================================================================
    let authUserId: string | null = null;
    
    try {
      // Verificar se já existe auth.user para este telefone
      const { data: existingAuthUsers } = await supabase.auth.admin.listUsers();
      const existingAuthUser = existingAuthUsers?.users?.find(
        u => u.phone === phoneE164 || u.email === `${phoneE164.replace("+", "")}@finax.app`
      );
      
      if (existingAuthUser) {
        authUserId = existingAuthUser.id;
        console.log(`🔗 [VERIFY] Auth user existente: ${authUserId}`);
      } else {
        // Criar novo auth.user usando o telefone como identificador
        const { data: newAuthUser, error: authError } = await supabase.auth.admin.createUser({
          email: `${phoneE164.replace("+", "")}@finax.app`,
          phone: phoneE164,
          email_confirm: true,
          phone_confirm: true,
        });
        
        if (!authError && newAuthUser?.user) {
          authUserId = newAuthUser.user.id;
          console.log(`✅ [VERIFY] Novo auth user criado: ${authUserId}`);
        } else {
          console.warn(`⚠️ [VERIFY] Não foi possível criar auth user:`, authError);
        }
      }
      
      // Atualizar usuarios.auth_id para vincular
      if (authUserId) {
        await supabase
          .from("usuarios")
          .update({ auth_id: authUserId, phone_e164: phoneE164 })
          .eq("id", usuario.id);
        console.log(`🔗 [VERIFY] Vinculado: usuarios.${usuario.id} → auth.${authUserId}`);
      }
    } catch (authLinkError) {
      console.error(`⚠️ [VERIFY] Erro ao vincular auth_id (não-bloqueante):`, authLinkError);
    }

    // Atualizar phone_e164 se necessário (fallback se auth_id falhou)
    if (usuario.phone_e164 !== phoneE164 && !authUserId) {
      await supabase
        .from("usuarios")
        .update({ phone_e164: phoneE164 })
        .eq("id", usuario.id);
      console.log(`📱 [VERIFY] Atualizado phone_e164: ${phoneE164}`);
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
