import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WhatsApp API (Meta)
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

// Vonage (Fallback)
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📱 NORMALIZAÇÃO DE TELEFONE - SEMPRE COM + NO INÍCIO
// ============================================================================
function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  
  // Já tem código do Brasil
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return "+" + digits;
  }
  
  // Número brasileiro sem código do país
  if (digits.length >= 10 && digits.length <= 11) {
    return "+55" + digits;
  }
  
  // Fallback
  return "+" + (digits.startsWith("55") ? digits : "55" + digits);
}

// Extrair últimos 8 dígitos para matching flexível (ignora 9° dígito extra)
function extractPhoneLast8(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-8);
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================================
// 📤 ENVIO VIA META WHATSAPP API (PRINCIPAL)
// ============================================================================
async function sendOTPWhatsApp(phoneE164: string, code: string): Promise<boolean> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log("⚠️ [OTP] Credenciais Meta não configuradas, usando fallback");
    return false;
  }

  const message = `🔐 *Código de acesso Finax*\n\nSeu código é: *${code}*\n\n⏰ Válido por 5 minutos.\n\n_Não compartilhe este código com ninguém._`;

  try {
    const cleanNumber = phoneE164.replace(/\D/g, "");
    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    console.log(`📤 [OTP] Enviando via Meta para: ${cleanNumber}`);
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanNumber,
        type: "text",
        text: {
          preview_url: false,
          body: message
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [OTP] Meta API falhou (${response.status}):`, errorText);
      return false;
    }

    const result = await response.json();
    console.log(`✅ [OTP] Meta: Código enviado para ${cleanNumber}`, result.messages?.[0]?.id);
    return true;
    
  } catch (error) {
    console.error(`❌ [OTP] Erro Meta:`, error);
    return false;
  }
}

// ============================================================================
// 📤 ENVIO VIA VONAGE (FALLBACK)
// ============================================================================
async function sendOTPVonage(phoneE164: string, code: string): Promise<boolean> {
  if (!VONAGE_API_KEY || !VONAGE_API_SECRET || !VONAGE_WHATSAPP_NUMBER) {
    console.error("❌ [OTP] Credenciais Vonage não configuradas");
    return false;
  }

  const message = `🔐 *Código de acesso Finax*\n\nSeu código é: *${code}*\n\n⏰ Válido por 5 minutos.`;
  const cleanNumber = phoneE164.replace(/^\+/, "");

  try {
    console.log(`📤 [OTP] Enviando via Vonage para: ${cleanNumber}`);
    
    const response = await fetch("https://messages-sandbox.nexmo.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`),
      },
      body: JSON.stringify({
        message_type: "text",
        text: message,
        to: cleanNumber,
        from: VONAGE_WHATSAPP_NUMBER,
        channel: "whatsapp"
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [OTP] Vonage falhou (${response.status}):`, errorText);
      return false;
    }

    const result = await response.json();
    console.log(`✅ [OTP] Vonage: Código enviado para ${cleanNumber}`, result.message_uuid);
    return true;
    
  } catch (error) {
    console.error(`❌ [OTP] Erro Vonage:`, error);
    return false;
  }
}

// ============================================================================
// 🕐 VERIFICAR JANELA DE 24H DO WHATSAPP
// ============================================================================
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

serve(async (req) => {
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

    const phoneE164 = normalizePhoneE164(phone);
    const phoneLast8 = extractPhoneLast8(phone);

    console.log(`📱 [OTP] Solicitação para: ${phone} → E164: ${phoneE164}, últimos 8: ${phoneLast8}`);

    // ========================================================================
    // 🔒 RATE LIMIT
    // ========================================================================
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
    // 🔍 BUSCAR USUÁRIO COM FLEXIBILIDADE
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

    console.log(`✅ [OTP] Usuário encontrado: ${usuario.id} (${usuario.nome})`);

    // ========================================================================
    // 🕐 VERIFICAR JANELA DE 24H - CRÍTICO PARA EVITAR CUSTOS
    // ========================================================================
    const hasRecentMessage = await checkWhatsAppWindow(usuario.id);

    if (!hasRecentMessage) {
      console.log(`⚠️ [OTP] Fora da janela 24h: ${phone}`);
      return new Response(
        JSON.stringify({ 
          success: false,
          requiresWhatsApp: true,
          message: "Para receber o código, envie um 'oi' para o Finax no WhatsApp primeiro.",
          whatsappNumber: "5565981034588",
          whatsappLink: "https://wa.me/5565981034588?text=oi",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // 🔐 GERAR E SALVAR CÓDIGO
    // ========================================================================
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

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
    // 📤 ENVIAR VIA WHATSAPP (META → VONAGE FALLBACK)
    // ========================================================================
    const userPhoneE164 = usuario.phone_e164 || phoneE164;
    
    // Tentar Meta primeiro
    let sent = await sendOTPWhatsApp(userPhoneE164, code);
    
    // Fallback para Vonage se Meta falhar
    if (!sent) {
      console.log(`⚠️ [OTP] Meta falhou, tentando Vonage...`);
      sent = await sendOTPVonage(userPhoneE164, code);
    }

    if (!sent) {
      console.error(`❌ [OTP] FALHA TOTAL NO ENVIO para ${userPhoneE164}. Código: ${code}`);
      // Log para debug - código está no banco, usuário pode pegar manualmente se for teste
    } else {
      console.log(`✅ [OTP] Código enviado com sucesso para ${userPhoneE164}`);
    }

    // Atualizar phone_e164 do usuário se necessário
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
        message: sent 
          ? "Código enviado! Verifique seu WhatsApp." 
          : "Código gerado. Verifique seu WhatsApp ou tente novamente.",
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
