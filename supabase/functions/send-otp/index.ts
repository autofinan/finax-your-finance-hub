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
  
  if (digits.length >= 8 && digits.length <= 9) {
    return "+55" + digits;
  }
  
  return digits.startsWith("+") ? digits : "+" + digits;
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

// Enviar OTP via fila de mensagens do Finax (usando messages_outbox)
async function sendOTPViaFinax(userId: string, phoneE164: string, code: string): Promise<boolean> {
  const message = `🔐 *Código de acesso Finax*\n\nSeu código é: *${code}*\n\n⏰ Válido por 5 minutos.\n\n_Não compartilhe este código com ninguém._`;

  try {
    const { error } = await supabase
      .from("messages_outbox")
      .insert({
        user_id: userId,
        phone: phoneE164.replace("+", ""),
        message: message,
        status: "pending",
      });

    if (error) {
      console.error(`❌ [OTP] Erro ao inserir na fila:`, error);
      return false;
    }

    console.log(`✅ [OTP] Código inserido na fila para ${phoneE164}`);
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
    const phoneDigits = phone.replace(/\D/g, "");
    const phoneE164 = normalizePhoneE164(phone);
    const phoneLast9 = phoneDigits.slice(-9);

    console.log(`📱 [OTP] Solicitação para: ${phone} → ${phoneE164}`);

    // Check rate limit
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentOTPs } = await supabase
      .from("otp_codes")
      .select("id, created_at")
      .or(`phone_e164.eq.${phoneE164},phone_number.ilike.%${phoneLast9}%`)
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

    // Usuário não existe - retorna mensagem genérica
    if (!usuario) {
      console.log(`⚠️ [OTP] Usuário não encontrado: ${phone}`);
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Se este número estiver cadastrado, você receberá um código.",
          expiresIn: 300,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Enviar via fila do Finax
    const sent = await sendOTPViaFinax(usuario.id, phoneE164, code);

    if (!sent) {
      console.log(`⚠️ [OTP] Código para ${phone}: ${code} (fila falhou, código gerado)`);
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
