import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// 🚀 FINAX WEBHOOK v3.0 - ULTRA LEVE (< 300ms)
// ============================================================================
//
// ARQUITETURA:
// 1. Recebe webhook -> Parse payload
// 2. Dedupe atômico (processed_messages)
// 3. Salva evento_bruto
// 4. Cria job na fila (webhook_jobs)
// 5. Retorna 200 IMEDIATAMENTE
//
// Todo processamento pesado vai para o WORKER
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📱 RESPOSTA RÁPIDA (FEEDBACK IMEDIATO AO USUÁRIO)
// ============================================================================

async function enviarRespostaRapida(phoneNumber: string, tipo: TipoMidia): Promise<void> {
  if (tipo === "text") return; // Texto não precisa de resposta rápida
  
  const mensagens = {
    image: "📷 Recebi a imagem! Analisando... 🧠",
    audio: "🎤 Recebi o áudio! Transcrevendo... 🧠"
  };
  
  const texto = mensagens[tipo] || null;
  if (!texto) return;
  
  try {
    const cleanNumber = phoneNumber.replace(/\D/g, "");
    await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanNumber,
          type: "text",
          text: { body: texto }
        }),
      }
    );
    console.log(`⚡ [QUICK] Resposta rápida enviada para ${tipo}`);
  } catch (e) {
    console.log(`⚠️ [QUICK] Erro ao enviar resposta rápida:`, e);
    // Não bloqueia o fluxo se falhar
  }
}

// ============================================================================
// 📦 TIPOS
// ============================================================================

type MessageSource = "meta" | "vonage";
type TipoMidia = "text" | "audio" | "image";

interface PayloadParsed {
  phoneNumber: string;
  messageText: string;
  messageType: TipoMidia;
  messageId: string;
  mediaId: string | null;
  mediaMimeType: string;
  messageSource: MessageSource;
  nomeContato: string | null;
  rawPayload: any;
  buttonReplyId: string | null;
}

// ============================================================================
// 1️⃣ DEDUPE ATÔMICO - INSERT ÚNICO
// ============================================================================

async function tentarLockDedupe(messageId: string, phoneNumber: string, source: string): Promise<boolean> {
  if (!messageId) return true;
  
  try {
    const { error } = await supabase
      .from("processed_messages")
      .insert({
        message_id: messageId,
        phone_number: phoneNumber,
        source: source
      });
    
    if (error) {
      if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
        console.log(`🔒 [DEDUPE] Mensagem ${messageId} já processada - IGNORANDO`);
        return false;
      }
      console.error(`⚠️ [DEDUPE] Erro:`, error);
      return true;
    }
    
    console.log(`✅ [DEDUPE] Lock: ${messageId}`);
    return true;
  } catch (e) {
    console.error(`⚠️ [DEDUPE] Exceção:`, e);
    return true;
  }
}

// ============================================================================
// 2️⃣ EVENTO BRUTO - PERSIST IMEDIATO
// ============================================================================

async function salvarEventoBruto(
  userId: string | null,
  phoneNumber: string,
  tipoMidia: TipoMidia,
  conteudo: any,
  messageId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("eventos_brutos")
      .insert({
        user_id: userId,
        origem: tipoMidia,
        conteudo: conteudo,
        phone_number: phoneNumber,
        message_id: messageId,
        tipo_midia: tipoMidia,
        status: "novo",
        media_downloaded: false,
        interpretado: false,
        media_status: "pending",
        media_attempts: 0
      })
      .select("id")
      .single();
    
    if (error) {
      console.error("❌ [EVENTO] Erro:", error);
      return null;
    }
    
    console.log(`📝 [EVENTO] Salvo: ${data.id}`);
    return data.id;
  } catch (e) {
    console.error("❌ [EVENTO] Exceção:", e);
    return null;
  }
}

// ============================================================================
// 3️⃣ CRIAR JOB NA FILA
// ============================================================================

async function criarJob(
  messageId: string,
  userId: string | null,
  payload: PayloadParsed,
  eventoId: string | null
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("webhook_jobs")
      .insert({
        message_id: messageId,
        user_id: userId,
        payload: {
          ...payload,
          evento_id: eventoId
        },
        status: "pending",
        attempts: 0
      });
    
    if (error) {
      // Job duplicado = já inserido, ok
      if (error.code === '23505') {
        console.log(`⚠️ [JOB] Duplicado para ${messageId}`);
        return true;
      }
      console.error("❌ [JOB] Erro:", error);
      return false;
    }
    
    console.log(`📋 [JOB] Criado para ${messageId}`);
    return true;
  } catch (e) {
    console.error("❌ [JOB] Exceção:", e);
    return false;
  }
}

// ============================================================================
// 4️⃣ BUSCAR/CRIAR USUÁRIO (LEVE)
// ============================================================================

async function buscarOuCriarUsuario(phoneNumber: string, nome: string | null): Promise<string | null> {
  try {
    // Buscar existente
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("id")
      .eq("phone_number", phoneNumber)
      .single();
    
    if (usuario) return usuario.id;
    
    // Criar novo usuário com trial de 14 dias
    const trialFim = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: novoUsuario } = await supabase
      .from("usuarios")
      .insert({ 
        phone_number: phoneNumber,
        nome: nome,
        plano: "trial",
        trial_inicio: new Date().toISOString(),
        trial_fim: trialFim
      })
      .select("id")
      .single();
    
    if (novoUsuario) {
      console.log(`👤 [USUARIO] Novo: ${phoneNumber}`);
      return novoUsuario.id;
    }
    
    return null;
  } catch (e) {
    console.error("❌ [USUARIO] Erro:", e);
    return null;
  }
}

// ============================================================================
// 📨 PARSE PAYLOAD (META/VONAGE)
// ============================================================================

function parsePayload(json: any): PayloadParsed | null {
  // Vonage
  if (json.channel === "whatsapp" && json.from && json.text !== undefined) {
    return {
      messageSource: "vonage",
      phoneNumber: json.from,
      messageText: json.text || "",
      messageId: json.message_uuid || `vonage_${Date.now()}`,
      messageType: "text",
      mediaId: null,
      mediaMimeType: "",
      nomeContato: null,
      rawPayload: json,
      buttonReplyId: null
    };
  }
  
  // Meta
  if (json.entry?.[0]?.changes?.[0]?.value) {
    const value = json.entry[0].changes[0].value;
    
    if (!value.messages || value.messages.length === 0) {
      return null; // Status update, não mensagem
    }

    const message = value.messages[0];
    const phoneNumber = message.from;
    const messageId = message.id || `meta_${Date.now()}`;
    const nomeContato = value.contacts?.[0]?.profile?.name || null;
    
    let messageType: TipoMidia = "text";
    let messageText = "";
    let mediaId: string | null = null;
    let mediaMimeType = "";
    let buttonReplyId: string | null = null;
    
    if (message.type === "text") {
      messageType = "text";
      messageText = message.text?.body || "";
    } else if (message.type === "audio") {
      messageType = "audio";
      mediaId = message.audio?.id || null;
      mediaMimeType = message.audio?.mime_type || "audio/ogg";
    } else if (message.type === "image") {
      messageType = "image";
      mediaId = message.image?.id || null;
      mediaMimeType = message.image?.mime_type || "image/jpeg";
    } else if (message.type === "interactive") {
      // 🔘 CALLBACK DE BOTÃO INTERATIVO
      messageType = "text";
      buttonReplyId = message.interactive?.button_reply?.id || null;
      messageText = buttonReplyId || message.interactive?.button_reply?.title || "";
      console.log(`🔘 [BUTTON] Callback: ${buttonReplyId}`);
    } else {
      return null; // Tipo não suportado
    }
    
    return {
      messageSource: "meta",
      phoneNumber,
      messageText,
      messageId,
      messageType,
      mediaId,
      mediaMimeType,
      nomeContato,
      rawPayload: json,
      buttonReplyId
    };
  }
  
  return null;
}

// ============================================================================
// 🚀 WEBHOOK PRINCIPAL - ULTRA LEVE
// ============================================================================

serve(async (req) => {
  const startTime = Date.now();
  
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verificação GET (Meta Webhook)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ Webhook verificado");
      return new Response(challenge, { status: 200 });
    }
    
    return new Response("Forbidden", { status: 403 });
  }

  // ============================================================================
  // TRY/CATCH GLOBAL - SEMPRE 200
  // ============================================================================
  try {
    const json = await req.json();
    console.log("📨 [WEBHOOK] Payload recebido");

    // 1. Parse payload
    const payload = parsePayload(json);
    
    if (!payload || !payload.phoneNumber) {
      console.log("⚠️ [WEBHOOK] Payload inválido ou status update");
      return new Response(JSON.stringify({ status: "ok", skipped: true }), {
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`📱 [${payload.messageSource.toUpperCase()}] ${payload.messageType} | ${payload.phoneNumber} | ${payload.messageId}`);

    // 2. Dedupe atômico
    const conseguiuLock = await tentarLockDedupe(
      payload.messageId, 
      payload.phoneNumber, 
      payload.messageSource
    );
    
    if (!conseguiuLock) {
      console.log(`⏭️ [WEBHOOK] Dedupe - ${Date.now() - startTime}ms`);
      return new Response(JSON.stringify({ status: "ok", dedupe: true }), {
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Buscar/criar usuário
    const usuarioId = await buscarOuCriarUsuario(payload.phoneNumber, payload.nomeContato);

    // 3.5 RESPOSTA RÁPIDA PARA MÍDIA (não bloqueia)
    if (payload.messageType === "image" || payload.messageType === "audio") {
      enviarRespostaRapida(payload.phoneNumber, payload.messageType);
    }

    // 4. Salvar evento bruto
    const eventoId = await salvarEventoBruto(
      usuarioId,
      payload.phoneNumber,
      payload.messageType,
      { 
        text: payload.messageText, 
        mediaId: payload.mediaId, 
        mimeType: payload.mediaMimeType,
        raw: payload.messageType === "text" ? payload.messageText : "[MÍDIA]"
      },
      payload.messageId
    );

    // 5. Criar job na fila
    await criarJob(payload.messageId, usuarioId, payload, eventoId);

    const duration = Date.now() - startTime;
    console.log(`✅ [WEBHOOK] Completo - ${duration}ms`);

    return new Response(
      JSON.stringify({ 
        status: "ok", 
        job_created: true,
        evento_id: eventoId,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ [WEBHOOK] Erro fatal:", error);
    
    return new Response(
      JSON.stringify({ status: "ok", error: "internal_error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
