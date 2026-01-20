import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 🔥 CONFIGURAÇÃO API OFICIAL WHATSAPP
const WHATSAPP_API_URL = Deno.env.get("WHATSAPP_API_URL")!; // Ex: https://graph.facebook.com/v18.0/SEU_PHONE_NUMBER_ID/messages
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📱 NORMALIZAÇÃO DE TELEFONE
// ============================================================================
function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }
  
  if (digits.length >= 10 && digits.length <= 11) {
    return "55" + digits;
  }
  
  if (digits.length >= 8 && digits.length <= 9) {
    return "55" + digits;
  }
  
  return digits.startsWith("55") ? digits : "55" + digits;
}

function extractPhoneLast8(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-8);
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================================
// 📤 ENVIO VIA API OFICIAL DO WHATSAPP
// ============================================================================
async function sendOTPWhatsApp(phoneE164: string, code: string): Promise<boolean> {
  const message = `🔐 *Código de acesso Finax*\n\nSeu código é: *${code}*\n\n⏰ Válido por 5 minutos.\n\n_Não compartilhe este código com ninguém._`;

  try {
    // Garantir que o número está no formato correto (sem +)
    const cleanNumber = phoneE164.replace(/\D/g, "");
    
    const response = await fetch(WHATSAPP_API_URL, {
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
      console.error(`❌ [OTP] WhatsApp API falhou (${response.status}):`, errorText);
      
      // Tentar parsear o erro
      try {
        const errorJson = JSON.parse(errorText);
        console.error(`❌ [OTP] Erro detalhado:`, JSON.stringify(errorJson, null, 2));
      } catch {}
      
      return false;
    }

    const result = await response.json();
    console.log(`✅ [OTP] Código enviado via WhatsApp para ${cleanNumber}`, result);
    return true;
    
  } catch (error) {
    console.error(`❌ [OTP] Erro ao enviar via WhatsApp API:`, error);
    return false;
  }
}

// Verificar janela de 24h
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

    // Rate limit
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

    // Buscar usuário
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

    // Verificar janela de 24h
    const hasRecentMessage = await checkWhatsAppWindow(usuario.id);

    if (!hasRecentMessage) {
      console.log(`⚠️ [OTP] Fora da janela 24h: ${phone}`);
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

    // Gerar código
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

    // 🔥 ENVIAR VIA API OFICIAL DO WHATSAPP
    const userPhoneE164 = usuario.phone_e164 || phoneE164;
    const sent = await sendOTPWhatsApp(userPhoneE164, code);

    if (!sent) {
      console.error(`⚠️ [OTP] FALHA NO ENVIO para ${userPhoneE164}. Código: ${code}`);
      // Não expor falha ao usuário
    } else {
      console.log(`✅ [OTP] Código enviado com sucesso para ${userPhoneE164}: ${code}`);
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
