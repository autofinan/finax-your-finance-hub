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

// Normalizar telefone para formato E.164
function normalizePhoneE164(phone: string): string {
  // Remove tudo que não é dígito
  const digits = phone.replace(/\D/g, "");
  
  // Se já começa com 55 e tem 12-13 dígitos, assume que está correto
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return "+" + digits;
  }
  
  // Se tem 10-11 dígitos (DDD + número), adiciona +55
  if (digits.length >= 10 && digits.length <= 11) {
    return "+55" + digits;
  }
  
  // Se tem 8-9 dígitos (só número), não conseguimos saber o DDD
  // Retorna com +55 mas pode estar incompleto
  if (digits.length >= 8 && digits.length <= 9) {
    return "+55" + digits;
  }
  
  // Fallback: retorna com + se não tem
  return digits.startsWith("+") ? digits : "+" + digits;
}

// Gerar código OTP de 6 dígitos
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Enviar mensagem via Vonage WhatsApp
async function sendWhatsAppOTP(phone: string, code: string): Promise<boolean> {
  if (!VONAGE_API_KEY || !VONAGE_API_SECRET || !VONAGE_WHATSAPP_NUMBER) {
    console.error("❌ [OTP] Vonage credentials not configured");
    return false;
  }

  const message = `🔐 *Código de acesso Finax*\n\nSeu código é: *${code}*\n\n⏰ Válido por 5 minutos.\n\n_Não compartilhe este código com ninguém._`;

  try {
    const response = await fetch("https://messages-sandbox.nexmo.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`),
      },
      body: JSON.stringify({
        message_type: "text",
        text: message,
        to: phone.replace("+", ""),
        from: VONAGE_WHATSAPP_NUMBER,
        channel: "whatsapp",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ [OTP] Vonage error:`, error);
      return false;
    }

    console.log(`✅ [OTP] Código enviado para ${phone}`);
    return true;
  } catch (error) {
    console.error(`❌ [OTP] Erro ao enviar:`, error);
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

    // Normalizar telefone - extract digits first for consistent normalization
    const phoneDigits = phone.replace(/\D/g, "");
    const phoneE164 = normalizePhoneE164(phone);
    // Also get digits-only for rate limit check (last 9 digits)
    const phoneLast9 = phoneDigits.slice(-9);

    console.log(`📱 [OTP] Solicitação para: ${phone} → ${phoneE164}`);

    // SECURITY: Check rate limit FIRST using multiple formats to prevent bypass
    // Check both the normalized E.164 and the last 9 digits
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentOTPs, error: rateError } = await supabase
      .from("otp_codes")
      .select("id, created_at")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneLast9}%`)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false });

    if (rateError) {
      console.error(`❌ [OTP] Rate limit check error:`, rateError);
    }

    // Check per-minute rate limit
    const recentInLastMinute = recentOTPs?.filter(otp => 
      new Date(otp.created_at) > new Date(oneMinuteAgo)
    ) || [];
    
    if (recentInLastMinute.length > 0) {
      // SECURITY: Return same message format as success to prevent timing attacks
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

    // Check daily rate limit (max 10 per day)
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

    // Verificar se usuário existe
    const { data: usuario, error: userError } = await supabase
      .from("usuarios")
      .select("id, phone_number, phone_e164, nome, plano")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneLast9}%`)
      .maybeSingle();

    if (userError) {
      console.error(`❌ [OTP] Erro ao buscar usuário:`, userError);
      return new Response(
        JSON.stringify({ error: "Erro interno" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY FIX: Don't reveal if user exists or not
    // Return same successful response regardless of user existence
    if (!usuario) {
      console.log(`⚠️ [OTP] Non-existent user attempted: ${phone}`);
      // Return success to prevent user enumeration attacks
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Se este número estiver cadastrado, você receberá um código.",
          expiresIn: 300,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User exists - generate and send code
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutos

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

    // Enviar via WhatsApp
    const sent = await sendWhatsAppOTP(phoneE164, code);

    if (!sent) {
      // Fallback: log do código para desenvolvimento
      console.log(`⚠️ [OTP] Código para ${phone}: ${code} (WhatsApp falhou)`);
    }

    // SECURITY: Return same message as non-existent user
    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Se este número estiver cadastrado, você receberá um código.",
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
