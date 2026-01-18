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

    // Normalizar telefone
    const phoneE164 = normalizePhoneE164(phone);
    const phoneDigits = phone.replace(/\D/g, "");

    console.log(`📱 [OTP] Solicitação para: ${phone} → ${phoneE164}`);

    // Verificar se usuário existe
    const { data: usuario, error: userError } = await supabase
      .from("usuarios")
      .select("id, phone_number, phone_e164, nome, plano")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneDigits.slice(-9)}%`)
      .maybeSingle();

    if (userError) {
      console.error(`❌ [OTP] Erro ao buscar usuário:`, userError);
      return new Response(
        JSON.stringify({ error: "Erro interno" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!usuario) {
      console.log(`❌ [OTP] Usuário não encontrado: ${phone}`);
      return new Response(
        JSON.stringify({ 
          error: "Número não cadastrado",
          message: "Este número ainda não usa o Finax. Envie uma mensagem para (65) 9 8103-4588 para começar!"
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar rate limit (1 OTP por minuto)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: recentOTP } = await supabase
      .from("otp_codes")
      .select("id")
      .eq("phone_e164", phoneE164)
      .gte("created_at", oneMinuteAgo)
      .limit(1);

    if (recentOTP && recentOTP.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: "Aguarde um momento",
          message: "Você já solicitou um código recentemente. Aguarde 1 minuto."
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Gerar novo código
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

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Código enviado! Verifique seu WhatsApp.",
        expiresIn: 300, // 5 minutos em segundos
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
