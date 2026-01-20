import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📱 NORMALIZAÇÃO ROBUSTA DE TELEFONE
// ============================================================================
// Problema: Operadoras brasileiras adicionaram 9° dígito, mas nem todos atualizaram.
// Solução: Buscar por múltiplos formatos + usar últimos 8 dígitos como fallback.
// ============================================================================

function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  
  // Já tem +55 e tamanho correto
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return "+" + digits;
  }
  
  // DDD + número (10 ou 11 dígitos)
  if (digits.length >= 10 && digits.length <= 11) {
    return "+55" + digits;
  }
  
  // Só número local (8 ou 9 dígitos) - assumir DDD padrão
  if (digits.length >= 8 && digits.length <= 9) {
    return "+55" + digits;
  }
  
  return digits.startsWith("+") ? digits : "+" + digits;
}

// Extrair últimos 8 dígitos para matching flexível (ignora 9° dígito)
function extractPhoneLast8(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-8);
}

// Gerar código OTP de 6 dígitos
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Verificar se usuário mandou mensagem nas últimas 24h (janela WhatsApp)
async function checkWhatsAppWindow(userId: string): Promise<boolean> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data: recentMessages } = await supabase
    .from("eventos_brutos")
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", twentyFourHoursAgo)
    .limit(1);

  return !!(recentMessages && recentMessages.length > 0);
}

// ============================================================================
// 📤 ENVIO DIRETO VIA VONAGE (sem fila)
// ============================================================================
async function sendOTPDirectVonage(phoneE164: string, code: string): Promise<boolean> {
  const message = `🔐 *Código de acesso Finax*\n\nSeu código é: *${code}*\n\n⏰ Válido por 5 minutos.\n\n_Não compartilhe este código com ninguém._`;

  try {
    const cleanNumber = phoneE164.replace(/\D/g, "");
    const response = await fetch("https://messages-sandbox.nexmo.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`)}`,
      },
      body: JSON.stringify({
        from: VONAGE_WHATSAPP_NUMBER,
        to: cleanNumber,
        message_type: "text",
        text: message,
        channel: "whatsapp",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [OTP] Vonage falhou (${response.status}):`, errorText);
      return false;
    }

    console.log(`✅ [OTP] Código enviado via Vonage para ${phoneE164}`);
    return true;
  } catch (error) {
    console.error(`❌ [OTP] Erro ao enviar via Vonage:`, error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone } = await req.json();

    if (!phone) {
      return new Response(
        JSON.stringify({ error: "Número de telefone é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalizar telefone
    const phoneDigits = phone.replace(/\D/g, "");
    const phoneE164 = normalizePhoneE164(phone);
    const phoneLast8 = extractPhoneLast8(phone);

    console.log(`📱 [OTP] Solicitação para: ${phone} → E164: ${phoneE164}, últimos 8: ${phoneLast8}`);

    // Check rate limit
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentOTPs } = await supabase
      .from("otp_codes")
      .select("id, created_at")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneLast8}%`)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false });

    const recentInLastMinute = recentOTPs?.filter(otp => 
      new Date(otp.created_at) > new Date(oneMinuteAgo)
    ) || [];
    
    if (recentInLastMinute.length > 0) {
      console.log(`⚠️ [OTP] Rate limited (minute): ${phone}`);
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Se este número estiver cadastrado, você receberá um código.",
          expiresIn: 300,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (recentOTPs && recentOTPs.length >= 10) {
      console.log(`⚠️ [OTP] Rate limited (daily): ${phone}`);
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Se este número estiver cadastrado, você receberá um código.",
          expiresIn: 300,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // 🔍 BUSCA FLEXÍVEL DE USUÁRIO (múltiplos formatos de telefone)
    // ========================================================================
    // Buscar por:
    // 1. phone_e164 exato
    // 2. phone_number contendo últimos 8 dígitos (ignora 9° dígito)
    // ========================================================================
    const { data: usuario, error: userError } = await supabase
      .from("usuarios")
      .select("id, phone_number, phone_e164, nome, plano")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneLast8}%,phone_e164.ilike.%${phoneLast8}%`)
      .maybeSingle();

    if (userError) {
      console.error(`❌ [OTP] Erro ao buscar usuário:`, userError);
      return new Response(
        JSON.stringify({ error: "Erro interno" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Usuário não existe - retorna mensagem genérica
    if (!usuario) {
      console.log(`⚠️ [OTP] Usuário não encontrado: ${phone} (last8: ${phoneLast8})`);
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Se este número estiver cadastrado, você receberá um código.",
          expiresIn: 300,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ [OTP] Usuário encontrado: ${usuario.id} (${usuario.nome})`);

    // User exists - verificar janela de 24h
    const hasRecentMessage = await checkWhatsAppWindow(usuario.id);

    if (!hasRecentMessage) {
      console.log(`⚠️ [OTP] Fora da janela 24h: ${phone}`);
      // Retorna indicação de que precisa mandar mensagem primeiro
      return new Response(
        JSON.stringify({ 
          success: false,
          requiresWhatsApp: true,
          message: "Mande um 'oi' para o Finax no WhatsApp primeiro para receber seu código.",
          whatsappNumber: "5565981034588",
          whatsappLink: "https://wa.me/5565981034588?text=oi",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dentro da janela - gerar e enviar código
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Salvar código
    const { error: insertError } = await supabase
      .from("otp_codes")
      .insert({
        phone_number: phone,
        phone_e164: phoneE164,
        code,
        expires_at: expiresAt,
        used: false,
        attempts: 0,
      });

    if (insertError) {
      console.error(`❌ [OTP] Erro ao salvar código:`, insertError);
      return new Response(
        JSON.stringify({ error: "Erro ao gerar código" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // 📤 ENVIAR DIRETAMENTE VIA VONAGE (sem fila)
    // ========================================================================
    // Usar o phone_e164 do USUÁRIO (não o input) para garantir formato correto
    const userPhoneE164 = usuario.phone_e164 || phoneE164;
    const sent = await sendOTPDirectVonage(userPhoneE164, code);

    if (!sent) {
      console.log(`⚠️ [OTP] Código para ${phone}: ${code} (envio falhou, código gerado)`);
      // Não expor falha ao usuário - ele pode tentar novamente
    }

    // Atualizar phone_e164 do usuário se estava vazio ou diferente
    if (usuario.phone_e164 !== phoneE164) {
      await supabase
        .from("usuarios")
        .update({ phone_e164: phoneE164 })
        .eq("id", usuario.id);
      console.log(`📱 [OTP] Atualizado phone_e164 do usuário: ${phoneE164}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Código enviado! Verifique seu WhatsApp.",
        expiresIn: 300,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`❌ [OTP] Erro:`, error);
    return new Response(
      JSON.stringify({ error: "Erro interno do servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
