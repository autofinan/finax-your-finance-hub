import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

// ============================================================================
// 🏭 FINAX WORKER v1.0 - PROCESSAMENTO PESADO
// ============================================================================
//
// Consome webhook_jobs e processa:
// 1. Download de mídia (guarded)
// 2. OCR/Transcrição -> persist media_analysis
// 3. Interpretação IA -> hipoteses_registro
// 4. Motor de decisão -> ações
// 5. Registro com idempotência (action_hash)
// 6. Envio de mensagens
//
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Credentials
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 TIPOS
// ============================================================================

type MessageSource = "meta" | "vonage";
type TipoMidia = "text" | "audio" | "image";

interface JobPayload {
  phoneNumber: string;
  messageText: string;
  messageType: TipoMidia;
  messageId: string;
  mediaId: string | null;
  mediaMimeType: string;
  messageSource: MessageSource;
  nomeContato: string | null;
  evento_id: string | null;
}

interface ExtractedIntent {
  intent: string;
  valor?: number;
  categoria?: string;
  descricao?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  parcelas?: number;
  tipo_recorrencia?: "mensal" | "semanal" | "anual";
  confianca?: number;
}

// ============================================================================
// 🔐 IDEMPOTÊNCIA - ACTION HASH
// ============================================================================

function gerarActionHash(
  userId: string,
  actionType: string,
  canonicalData: Record<string, any>
): string {
  const dateBucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dataString = JSON.stringify({ userId, actionType, ...canonicalData, dateBucket });
  
  // Hash simples - em produção usar crypto.subtle
  let hash = 0;
  for (let i = 0; i < dataString.length; i++) {
    const char = dataString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return `${actionType}_${userId.slice(0, 8)}_${Math.abs(hash).toString(36)}`;
}

async function verificarOuCriarAction(
  userId: string,
  actionType: string,
  actionHash: string,
  entityId?: string,
  meta?: Record<string, any>
): Promise<{ created: boolean; actionId?: string }> {
  try {
    // Tenta inserir - se já existe, falha com unique constraint
    const { data, error } = await supabase
      .from("actions")
      .insert({
        user_id: userId,
        action_type: actionType,
        action_hash: actionHash,
        entity_id: entityId,
        status: "pending",
        meta: meta || {}
      })
      .select("id")
      .single();
    
    if (error) {
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        console.log(`🔒 [ACTION] Hash ${actionHash} já existe - idempotente`);
        return { created: false };
      }
      console.error("❌ [ACTION] Erro:", error);
      return { created: false };
    }
    
    console.log(`✅ [ACTION] Criada: ${data.id}`);
    return { created: true, actionId: data.id };
  } catch (e) {
    console.error("❌ [ACTION] Exceção:", e);
    return { created: false };
  }
}

async function marcarActionDone(actionHash: string): Promise<void> {
  await supabase
    .from("actions")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("action_hash", actionHash);
}

// ============================================================================
// 📱 ENVIO DE MENSAGENS
// ============================================================================

async function sendWhatsAppMeta(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(
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
          text: { body: text }
        }),
      }
    );
    return response.ok;
  } catch (error) {
    console.error("[Meta] Erro:", error);
    return false;
  }
}

async function sendWhatsAppVonage(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
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
        text: text,
        channel: "whatsapp",
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Vonage] Erro:", error);
    return false;
  }
}

async function sendWhatsAppMessage(to: string, text: string, source: MessageSource): Promise<boolean> {
  if (source === "vonage") return sendWhatsAppVonage(to, text);
  return sendWhatsAppMeta(to, text);
}

// Enviar mensagem com botões interativos (Meta)
async function sendWhatsAppButtons(
  to: string, 
  bodyText: string, 
  buttons: Array<{ id: string; title: string }>,
  source: MessageSource
): Promise<boolean> {
  if (source !== "meta") {
    // Fallback para texto com opções numeradas
    const fallbackText = bodyText + "\n\n" + buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    return sendWhatsAppMessage(to, fallbackText, source);
  }

  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(
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
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: bodyText },
            action: {
              buttons: buttons.slice(0, 3).map(b => ({
                type: "reply",
                reply: { id: b.id, title: b.title.slice(0, 20) }
              }))
            }
          }
        }),
      }
    );
    return response.ok;
  } catch (error) {
    console.error("[Meta Buttons] Erro:", error);
    return sendWhatsAppMessage(to, bodyText, source);
  }
}

// ============================================================================
// 🎤 DOWNLOAD E PROCESSAMENTO DE MÍDIA
// ============================================================================

async function downloadWhatsAppMedia(mediaId: string, eventoId?: string): Promise<string | null> {
  // Guard clause - verificar estado no banco
  if (eventoId) {
    const { data: evento } = await supabase
      .from("eventos_brutos")
      .select("media_status, media_attempts, media_downloaded")
      .eq("id", eventoId)
      .single();
    
    if (evento?.media_status === 'done' || evento?.media_downloaded) {
      console.log(`🛑 [MÍDIA] Já baixada: ${eventoId}`);
      return null;
    }
    
    if ((evento?.media_attempts || 0) >= 2) {
      console.log(`🛑 [MÍDIA] Max tentativas: ${eventoId}`);
      return null;
    }
    
    await supabase.from("eventos_brutos")
      .update({ 
        media_status: 'processing', 
        media_attempts: (evento?.media_attempts || 0) + 1 
      })
      .eq("id", eventoId);
  }
  
  try {
    console.log(`🎵 [MÍDIA] Baixando ${mediaId}...`);
    
    const urlResponse = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } }
    );
    
    if (!urlResponse.ok) {
      if (eventoId) {
        await supabase.from("eventos_brutos")
          .update({ media_status: 'error', media_error: `URL fetch: ${urlResponse.status}` })
          .eq("id", eventoId);
      }
      return null;
    }
    
    const urlData = await urlResponse.json();
    const mediaResponse = await fetch(urlData.url, {
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
    });
    
    if (!mediaResponse.ok) {
      if (eventoId) {
        await supabase.from("eventos_brutos")
          .update({ media_status: 'error', media_error: `Media fetch: ${mediaResponse.status}` })
          .eq("id", eventoId);
      }
      return null;
    }
    
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    if (eventoId) {
      await supabase.from("eventos_brutos")
        .update({ media_status: 'done', media_downloaded: true })
        .eq("id", eventoId);
    }
    
    console.log(`✅ [MÍDIA] OK: ${base64.length} chars`);
    return base64;
    
  } catch (error) {
    console.error("❌ [MÍDIA] Erro:", error);
    if (eventoId) {
      await supabase.from("eventos_brutos")
        .update({ media_status: 'error', media_error: String(error) })
        .eq("id", eventoId);
    }
    return null;
  }
}

async function transcreverAudio(audioBase64: string): Promise<{ texto: string | null; confianca: number }> {
  try {
    console.log("🎤 [AUDIO] Transcrevendo...");
    
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { "Authorization": ASSEMBLYAI_API_KEY!, "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    
    if (!uploadResponse.ok) return { texto: null, confianca: 0 };
    
    const uploadData = await uploadResponse.json();
    
    const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "Authorization": ASSEMBLYAI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: uploadData.upload_url, language_code: "pt", speech_model: "best" }),
    });
    
    if (!transcriptResponse.ok) return { texto: null, confianca: 0 };
    
    const transcriptData = await transcriptResponse.json();
    const transcriptId = transcriptData.id;
    
    let status = "queued";
    let transcricao: string | null = null;
    let audioConfianca = 0;
    let tentativas = 0;
    
    while ((status === "queued" || status === "processing") && tentativas < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { "Authorization": ASSEMBLYAI_API_KEY! },
      });
      
      if (!pollingResponse.ok) { tentativas++; continue; }
      
      const pollingData = await pollingResponse.json();
      status = pollingData.status;
      
      if (status === "completed") {
        transcricao = pollingData.text;
        audioConfianca = pollingData.confidence || 0.7;
        break;
      } else if (status === "error") {
        return { texto: null, confianca: 0 };
      }
      
      tentativas++;
    }
    
    console.log(`✅ [AUDIO] "${transcricao}" (${audioConfianca})`);
    return { texto: transcricao, confianca: audioConfianca };
  } catch (error) {
    console.error("❌ [AUDIO] Erro:", error);
    return { texto: null, confianca: 0 };
  }
}

async function analisarImagem(
  imageBase64: string, 
  mimeType: string,
  eventoId: string | null,
  messageId: string
): Promise<{ dados: ExtractedIntent | null; confianca: number; rawOcr: string | null }> {
  try {
    console.log("📷 [IMAGEM] Analisando com OCR+IA...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analise esta imagem financeira. PRIMEIRO extraia todo texto visível (OCR), depois interprete.

Retorne JSON:
{
  "raw_ocr": "todo texto extraído da imagem",
  "intent": "registrar_gasto" ou "registrar_entrada" ou "outro",
  "valor": número ou null,
  "descricao": "descrição curta",
  "categoria": "alimentacao/transporte/moradia/saude/lazer/compras/servicos/outros",
  "forma_pagamento": "pix/credito/debito/dinheiro" ou null,
  "confianca": 0 a 1,
  "itens_detectados": [{ "descricao": "...", "valor": ... }] // se múltiplos itens
}

Se não for financeiro: {"intent": "outro", "confianca": 0.1}`
              },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` }
              }
            ]
          }
        ]
      }),
    });

    if (!response.ok) return { dados: null, confianca: 0, rawOcr: null };

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"intent": "outro", "confianca": 0}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    // Persistir media_analysis
    await supabase.from("media_analysis").insert({
      evento_bruto_id: eventoId,
      message_id: messageId,
      source: "image",
      raw_ocr: parsed.raw_ocr || null,
      parsed: parsed,
      confidence: parsed.confianca || 0,
      processed: false
    });
    
    console.log(`📷 [IMAGEM] Parsed:`, JSON.stringify(parsed));
    return { 
      dados: parsed as ExtractedIntent, 
      confianca: parsed.confianca || 0.3,
      rawOcr: parsed.raw_ocr || null
    };
  } catch (error) {
    console.error("❌ [IMAGEM] Erro:", error);
    return { dados: null, confianca: 0, rawOcr: null };
  }
}

// ============================================================================
// 🧠 INTERPRETAÇÃO IA
// ============================================================================

async function interpretarMensagem(mensagem: string, historicoRecente: string): Promise<{ intent: ExtractedIntent; confianca: number }> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Você é um analisador de intenções financeiras. APENAS interprete, não tome decisões.

INTENTS:
- "registrar_gasto": gasto/despesa
- "registrar_entrada": receita/entrada
- "criar_parcelamento": compra parcelada
- "criar_recorrente": gasto repetitivo mensal
- "consultar_resumo": resumo geral
- "cancelar_transacao": apagar algo
- "saudacao": oi, olá, bom dia
- "ajuda": como funciona
- "confirmar_hipotese": sim, pode registrar
- "negar_hipotese": não, cancela
- "selecionar_opcao": números (1, 2, 3...)
- "outro": não financeiro

Responda APENAS JSON:
{
  "intent": "string",
  "valor": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "forma_pagamento": "pix"|"dinheiro"|"debito"|"credito" ou null,
  "parcelas": number ou null,
  "opcao_selecionada": number ou null,
  "confianca": number
}

${historicoRecente ? `HISTÓRICO:\n${historicoRecente}` : ""}`
          },
          { role: "user", content: mensagem }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"intent": "outro", "confianca": 0.3}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    console.log(`🧠 [IA] ${parsed.intent} (${parsed.confianca})`);
    
    return {
      intent: parsed as ExtractedIntent,
      confianca: parsed.confianca || 0.5
    };
  } catch (error) {
    console.error("❌ [IA] Erro:", error);
    return { intent: { intent: "outro" }, confianca: 0.3 };
  }
}

// ============================================================================
// 📋 PENDING SELECTIONS
// ============================================================================

async function criarPendingSelection(
  userId: string,
  options: Array<{ index: number; tx_id?: string; label: string; meta?: any }>,
  awaitingField: string,
  ttlMinutes: number = 2
): Promise<string> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const token = crypto.randomUUID();
  
  await supabase.from("pending_selections").insert({
    user_id: userId,
    token,
    options,
    awaiting_field: awaitingField,
    consumed: false,
    expires_at: expiresAt.toISOString()
  });
  
  console.log(`📋 [PENDING] Criado: ${awaitingField} (expires: ${ttlMinutes}min)`);
  return token;
}

async function consumirPendingSelection(
  userId: string,
  awaitingField: string
): Promise<{ options: any[]; id: string } | null> {
  // FOR UPDATE com lock atômico
  const { data, error } = await supabase
    .from("pending_selections")
    .select("id, options")
    .eq("user_id", userId)
    .eq("awaiting_field", awaitingField)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (error || !data) {
    console.log(`⚠️ [PENDING] Não encontrado ou expirado: ${awaitingField}`);
    return null;
  }
  
  // Marcar como consumido atomicamente
  const { error: updateError } = await supabase
    .from("pending_selections")
    .update({ consumed: true })
    .eq("id", data.id)
    .eq("consumed", false); // Garantia de lock
  
  if (updateError) {
    console.log(`⚠️ [PENDING] Race condition ao consumir`);
    return null;
  }
  
  console.log(`✅ [PENDING] Consumido: ${data.id}`);
  return { options: data.options as any[], id: data.id };
}

// ============================================================================
// 💾 HIPÓTESES
// ============================================================================

async function criarHipotese(
  userId: string,
  eventoId: string | null,
  dados: ExtractedIntent,
  confianca: number,
  mediaAnalysisId?: string
): Promise<string | null> {
  try {
    const idempotencyKey = `hyp_${userId}_${Date.now()}`;
    
    const { data, error } = await supabase
      .from("hipoteses_registro")
      .insert({
        user_id: userId,
        evento_id: eventoId,
        tipo: dados.intent,
        dados: dados,
        confianca,
        status: "pendente",
        idempotency_key: idempotencyKey,
        media_analysis_id: mediaAnalysisId
      })
      .select("id")
      .single();
    
    if (error) {
      console.error("❌ [HIPOTESE] Erro:", error);
      return null;
    }
    
    console.log(`💡 [HIPOTESE] Criada: ${data.id}`);
    return data.id;
  } catch (e) {
    console.error("❌ [HIPOTESE] Exceção:", e);
    return null;
  }
}

async function confirmarHipotese(hipoteseId: string): Promise<void> {
  await supabase
    .from("hipoteses_registro")
    .update({ status: "confirmada" })
    .eq("id", hipoteseId);
}

async function buscarHipotesePendente(userId: string): Promise<any | null> {
  const { data } = await supabase
    .from("hipoteses_registro")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pendente")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!data) return null;
  
  // Verificar se não expirou (15 min)
  const createdAt = new Date(data.created_at);
  const diffMinutos = (Date.now() - createdAt.getTime()) / 1000 / 60;
  
  if (diffMinutos > 15) return null;
  
  return data;
}

// ============================================================================
// 💰 REGISTRO DE TRANSAÇÃO (IDEMPOTENTE)
// ============================================================================

function gerarIdTransacao(): string {
  const agora = new Date();
  const data = agora.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.floor(Math.random() * 9999).toString().padStart(4, "0");
  return `TRX-${data}-${random}`;
}

async function registrarTransacaoIdempotente(
  userId: string,
  dados: ExtractedIntent,
  eventoId: string | null,
  hipoteseId?: string
): Promise<{ sucesso: boolean; mensagem: string; transacaoId?: string }> {
  
  // Gerar action hash
  const actionHash = gerarActionHash(userId, "registrar_transacao", {
    valor: dados.valor,
    descricao: dados.descricao,
    categoria: dados.categoria
  });
  
  // Verificar idempotência
  const { created, actionId } = await verificarOuCriarAction(
    userId, 
    "registrar_transacao", 
    actionHash
  );
  
  if (!created) {
    return {
      sucesso: false,
      mensagem: "Essa transação já foi registrada 👍"
    };
  }
  
  const transacaoId = gerarIdTransacao();
  const agora = new Date();
  const tipoTransacao = dados.intent === "registrar_entrada" ? "entrada" : "saida";
  const categoria = dados.categoria || "outros";
  
  const { data: transacao, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor: dados.valor,
    categoria: categoria,
    tipo: tipoTransacao,
    descricao: dados.descricao,
    observacao: dados.descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: dados.forma_pagamento,
    status: "confirmada",
    idempotency_key: actionHash
  }).select("id").single();
  
  if (error) {
    console.error("❌ [REGISTRO] Erro:", error);
    // Reverter action
    await supabase.from("actions").delete().eq("action_hash", actionHash);
    return {
      sucesso: false,
      mensagem: "Algo deu errado ao salvar 😕\n\nTenta de novo?"
    };
  }
  
  // Marcar action como done
  await marcarActionDone(actionHash);
  
  // Marcar hipótese como confirmada
  if (hipoteseId) {
    await confirmarHipotese(hipoteseId);
  }
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_transacao",
    entity_type: "transacao",
    entity_id: transacao.id,
    new_data: dados
  });
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sinal = tipoTransacao === "entrada" ? "+" : "-";
  const tipoTexto = tipoTransacao === "entrada" ? "Entrada registrada" : "Gasto registrado";
  
  return {
    sucesso: true,
    transacaoId,
    mensagem: `✅ *${tipoTexto}!*\n\n` +
      `🧾 *ID: ${transacaoId}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💸 *${sinal}R$ ${dados.valor?.toFixed(2)}*\n` +
      `📂 ${categoria}\n` +
      (dados.descricao ? `📝 ${dados.descricao}\n` : "") +
      `📅 ${dataFormatada} às ${horaFormatada}`
  };
}

// ============================================================================
// 🗑️ CANCELAMENTO (IDEMPOTENTE COM UNDO)
// ============================================================================

async function listarTransacoesParaCancelar(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, categoria, data, status")
    .eq("usuario_id", userId)
    .in("status", ["confirmada", "prevista"])
    .order("created_at", { ascending: false })
    .limit(5);
  
  return data || [];
}

async function cancelarTransacaoIdempotente(
  userId: string,
  transacaoId: string
): Promise<{ sucesso: boolean; mensagem: string }> {
  
  const actionHash = gerarActionHash(userId, "cancelar_transacao", { transacao_id: transacaoId });
  
  const { created } = await verificarOuCriarAction(
    userId, 
    "cancelar_transacao", 
    actionHash,
    transacaoId
  );
  
  if (!created) {
    return { sucesso: false, mensagem: "Essa transação já foi cancelada 👍" };
  }
  
  // Buscar transação
  const { data: transacao } = await supabase
    .from("transacoes")
    .select("*")
    .eq("id", transacaoId)
    .eq("usuario_id", userId)
    .single();
  
  if (!transacao) {
    return { sucesso: false, mensagem: "Transação não encontrada 🤔" };
  }
  
  // Log antes de cancelar
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "cancelar_transacao",
    entity_type: "transacao",
    entity_id: transacaoId,
    old_data: transacao,
    new_data: { status: "cancelled" }
  });
  
  // Cancelar
  const { error } = await supabase
    .from("transacoes")
    .update({ status: "cancelled" })
    .eq("id", transacaoId)
    .eq("usuario_id", userId);
  
  if (error) {
    console.error("❌ [CANCEL] Erro:", error);
    return { sucesso: false, mensagem: "Erro ao cancelar 😕" };
  }
  
  await marcarActionDone(actionHash);
  
  return {
    sucesso: true,
    mensagem: `✅ *Transação cancelada!*\n\n` +
      `🗑️ R$ ${transacao.valor?.toFixed(2)} - ${transacao.descricao || transacao.categoria}\n\n` +
      `_Se foi um engano, manda de novo que eu registro!_`
  };
}

// ============================================================================
// 🔄 PROCESSAMENTO DO JOB
// ============================================================================

async function processarJob(job: any): Promise<void> {
  const payload: JobPayload = job.payload;
  const userId = job.user_id;
  const eventoId = payload.evento_id;
  
  console.log(`🔄 [WORKER] Processando job ${job.id} | ${payload.messageType}`);
  
  try {
    // Buscar usuário
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("id", userId)
      .single();
    
    const nomeUsuario = usuario?.nome || "amigo(a)";
    
    // Verificar se é novo usuário (sem histórico)
    const { count: historicoCount } = await supabase
      .from("historico_conversas")
      .select("id", { count: "exact", head: true })
      .eq("phone_number", payload.phoneNumber);
    
    const isNovoUsuario = (historicoCount || 0) === 0;
    
    // ONBOARDING NOVO USUÁRIO
    if (isNovoUsuario) {
      console.log(`🎉 [WORKER] Novo usuário: ${payload.phoneNumber}`);
      
      const primeiroNome = nomeUsuario.split(" ")[0];
      
      await sendWhatsAppMessage(
        payload.phoneNumber,
        `Oi, ${primeiroNome}! 👋\n\nPrazer, eu sou o *Finax* — seu assistente financeiro pessoal.\n\nPode me mandar gastos por texto, áudio ou foto de comprovante.\n\nPra começar, me conta: quanto você costuma ganhar por mês? 💰`,
        payload.messageSource
      );
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: payload.messageText || "[MÍDIA]",
        ai_response: "[ONBOARDING]",
        tipo: "onboarding"
      });
      
      return;
    }
    
    // ========================================================================
    // VERIFICAR HIPÓTESE PENDENTE
    // ========================================================================
    const hipotesePendente = await buscarHipotesePendente(userId);
    
    if (hipotesePendente && payload.messageType === "text") {
      const msg = payload.messageText.toLowerCase().trim();
      
      // Confirmar
      if (/^(sim|s|ok|pode|isso|certo|exato|blz|beleza|perfeito)$/.test(msg) || /isso mesmo|pode salvar|^registra$/.test(msg)) {
        const resultado = await registrarTransacaoIdempotente(
          userId,
          hipotesePendente.dados,
          eventoId,
          hipotesePendente.id
        );
        
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: payload.messageText,
          ai_response: resultado.mensagem,
          tipo: "registro_confirmado"
        });
        
        return;
      }
      
      // Cancelar
      if (/^(não|nao|n)$/.test(msg) || /^cancela|^para|^deixa|deixa pra l/.test(msg)) {
        await supabase.from("hipoteses_registro")
          .update({ status: "cancelada" })
          .eq("id", hipotesePendente.id);
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Sem problemas! 👍 Já descartei.\n\nMe conta novamente como foi.",
          payload.messageSource
        );
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: payload.messageText,
          ai_response: "[CANCELADO]",
          tipo: "cancelamento"
        });
        
        return;
      }
    }
    
    // ========================================================================
    // VERIFICAR PENDING SELECTION (CANCELAMENTO)
    // ========================================================================
    const pendingCancel = await consumirPendingSelection(userId, "cancel_selection");
    
    if (pendingCancel && payload.messageType === "text") {
      const opcao = parseInt(payload.messageText.trim());
      
      if (!isNaN(opcao) && opcao >= 1 && opcao <= pendingCancel.options.length) {
        const selected = pendingCancel.options[opcao - 1];
        
        const resultado = await cancelarTransacaoIdempotente(userId, selected.tx_id);
        
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: payload.messageText,
          ai_response: resultado.mensagem,
          tipo: "cancelamento_executado"
        });
        
        return;
      }
    }
    
    // ========================================================================
    // PROCESSAR MÍDIA
    // ========================================================================
    let conteudoProcessado = payload.messageText;
    let confianca = 0.9;
    let tipoOrigem = payload.messageType;
    
    // ÁUDIO
    if (payload.messageType === "audio" && payload.mediaId) {
      const audioBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!audioBase64) {
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Não peguei o áudio direito 🎤\n\n👉 Pode escrever rapidinho o que você disse?",
          payload.messageSource
        );
        return;
      }
      
      const transcricao = await transcreverAudio(audioBase64);
      
      if (!transcricao.texto) {
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Não peguei o áudio direito 🎤\n\n👉 Pode escrever rapidinho o que você disse?",
          payload.messageSource
        );
        return;
      }
      
      conteudoProcessado = transcricao.texto;
      confianca = transcricao.confianca * 0.9;
      
      // Persistir media_analysis
      await supabase.from("media_analysis").insert({
        evento_bruto_id: eventoId,
        message_id: payload.messageId,
        source: "audio",
        raw_ocr: transcricao.texto,
        parsed: { transcricao: transcricao.texto },
        confidence: transcricao.confianca,
        processed: true
      });
    }
    
    // IMAGEM - FLUXO PERFEITO
    if (payload.messageType === "image" && payload.mediaId) {
      const imageBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!imageBase64) {
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Não consegui baixar a imagem 📷\n\n👉 Pode tentar enviar de novo?",
          payload.messageSource
        );
        return;
      }
      
      const analise = await analisarImagem(imageBase64, payload.mediaMimeType, eventoId, payload.messageId);
      
      if (!analise.dados || analise.dados.intent === "outro" || analise.confianca < 0.3) {
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Vi a imagem 📷\n\n👉 Me conta: *quanto foi* e *o que era*?",
          payload.messageSource
        );
        return;
      }
      
      // CRIAR HIPÓTESE (imagem SEMPRE cria hipótese)
      const hipoteseId = await criarHipotese(userId, eventoId, analise.dados, analise.confianca);
      
      // Montar mensagem de confirmação com botões
      const msgConfirmacao = `Entendi assim 👇\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💸 *Gasto*: R$ ${analise.dados.valor?.toFixed(2)}\n` +
        (analise.dados.descricao ? `📝 *O quê*: ${analise.dados.descricao}\n` : "") +
        (analise.dados.categoria ? `📂 *Categoria*: ${analise.dados.categoria}\n` : "") +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Posso registrar?`;
      
      await sendWhatsAppButtons(
        payload.phoneNumber,
        msgConfirmacao,
        [
          { id: "confirm_yes", title: "✅ Sim" },
          { id: "confirm_no", title: "❌ Não" }
        ],
        payload.messageSource
      );
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: "[IMAGEM]",
        ai_response: msgConfirmacao,
        tipo: "imagem_hipotese"
      });
      
      return;
    }
    
    // ========================================================================
    // INTERPRETAÇÃO IA
    // ========================================================================
    const historicoRecente = ""; // Simplificado
    const { intent: interpretacao, confianca: confIA } = await interpretarMensagem(conteudoProcessado, historicoRecente);
    
    console.log(`🎯 [WORKER] Intent: ${interpretacao.intent} (${confIA})`);
    
    // ========================================================================
    // MOTOR DE DECISÃO
    // ========================================================================
    
    // CANCELAR TRANSAÇÃO - FLUXO PERFEITO
    if (interpretacao.intent === "cancelar_transacao") {
      const transacoes = await listarTransacoesParaCancelar(userId);
      
      if (transacoes.length === 0) {
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Você não tem transações recentes para cancelar 🤔",
          payload.messageSource
        );
        return;
      }
      
      // Criar pending_selection
      const options = transacoes.map((t, i) => ({
        index: i + 1,
        tx_id: t.id,
        label: `R$ ${Number(t.valor).toFixed(2)} - ${t.descricao || t.categoria}`,
        meta: { valor: t.valor, data: t.data }
      }));
      
      await criarPendingSelection(userId, options, "cancel_selection", 2);
      
      const listaOpcoes = options.map(o => 
        `${o.index}. ${o.label}`
      ).join("\n");
      
      await sendWhatsAppMessage(
        payload.phoneNumber,
        `Qual transação você quer apagar?\n\n${listaOpcoes}\n\n_Responde com o número (expira em 2 min)_`,
        payload.messageSource
      );
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: payload.messageText,
        ai_response: "[CANCEL_LIST]",
        tipo: "cancel_selection"
      });
      
      return;
    }
    
    // REGISTRAR GASTO/ENTRADA
    if (["registrar_gasto", "registrar_entrada"].includes(interpretacao.intent)) {
      const temValor = interpretacao.valor && interpretacao.valor > 0;
      const temDescricao = !!interpretacao.descricao;
      
      // Dados completos + alta confiança → REGISTRA DIRETO
      if (temValor && temDescricao && confIA >= 0.8) {
        const resultado = await registrarTransacaoIdempotente(userId, interpretacao, eventoId);
        
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: conteudoProcessado,
          ai_response: resultado.mensagem,
          tipo: "registro_direto"
        });
        
        return;
      }
      
      // Dados completos + média confiança → CRIAR HIPÓTESE
      if (temValor && temDescricao) {
        await criarHipotese(userId, eventoId, interpretacao, confIA);
        
        const msgConfirmacao = `Entendi assim 👇\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💸 *Gasto*: R$ ${interpretacao.valor?.toFixed(2)}\n` +
          (interpretacao.descricao ? `📝 *O quê*: ${interpretacao.descricao}\n` : "") +
          `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Posso registrar? *Sim* ou *Não*`;
        
        await sendWhatsAppMessage(payload.phoneNumber, msgConfirmacao, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: conteudoProcessado,
          ai_response: msgConfirmacao,
          tipo: "hipotese_pendente"
        });
        
        return;
      }
      
      // Falta dados → PERGUNTAR
      const faltando = !temValor ? "valor" : "descricao";
      const pergunta = faltando === "valor"
        ? `Entendi: *${interpretacao.descricao}* 👍\n\n👉 Qual foi o valor?`
        : `Vi *R$ ${interpretacao.valor?.toFixed(2)}* 💰\n\n👉 O que foi essa compra?`;
      
      await sendWhatsAppMessage(payload.phoneNumber, pergunta, payload.messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: pergunta,
        tipo: "perguntar"
      });
      
      return;
    }
    
    // CONSULTAR RESUMO
    if (interpretacao.intent === "consultar_resumo") {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);
      
      const { data: transacoes } = await supabase
        .from("transacoes")
        .select("valor, tipo, categoria, descricao, data")
        .eq("usuario_id", userId)
        .gte("data", inicioMes.toISOString())
        .eq("status", "confirmada");

      let totalEntradas = 0;
      let totalSaidas = 0;
      
      transacoes?.forEach((t) => {
        const valor = Number(t.valor);
        if (t.tipo === "entrada") totalEntradas += valor;
        else totalSaidas += valor;
      });
      
      const saldo = totalEntradas - totalSaidas;
      
      let resposta = "";
      if (!transacoes || transacoes.length === 0) {
        resposta = "Você ainda não tem transações este mês 📊\n\nManda um gasto que eu começo a organizar!";
      } else {
        resposta = `📊 *Resumo do Mês*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n` +
          `💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n` +
          `📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
      }
      
      await sendWhatsAppMessage(payload.phoneNumber, resposta, payload.messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: resposta,
        tipo: "resumo"
      });
      
      return;
    }
    
    // SAUDAÇÃO / AJUDA / OUTRO
    let respostaGenerica = "";
    
    if (interpretacao.intent === "saudacao") {
      const primeiroNome = nomeUsuario.split(" ")[0];
      respostaGenerica = `Fala, ${primeiroNome}! 👋\n\nComo posso ajudar?\n\n💸 Registrar gasto\n📊 Ver resumo\n📷 Manda foto de comprovante`;
    } else if (interpretacao.intent === "ajuda") {
      respostaGenerica = `*Como usar o Finax* 📱\n\n` +
        `💸 *Registrar gasto*: "Gastei 50 no mercado"\n` +
        `📷 *Comprovante*: Manda foto do Pix\n` +
        `🎤 *Áudio*: Manda áudio falando o gasto\n` +
        `📊 *Resumo*: "Quanto gastei esse mês?"`;
    } else {
      respostaGenerica = `Como posso te ajudar? 🤔\n\n💸 Registrar gasto\n📊 Ver resumo\n\n_Exemplo: "Gastei 50 no mercado"_`;
    }
    
    await sendWhatsAppMessage(payload.phoneNumber, respostaGenerica, payload.messageSource);
    
    await supabase.from("historico_conversas").insert({
      phone_number: payload.phoneNumber,
      user_id: userId,
      user_message: conteudoProcessado,
      ai_response: respostaGenerica,
      tipo: interpretacao.intent
    });
    
  } catch (error) {
    console.error(`❌ [WORKER] Erro processando job ${job.id}:`, error);
    throw error; // Propagar para marcar job como erro
  }
}

// ============================================================================
// 🚀 ENDPOINT - PODE SER CHAMADO POR CRON OU WEBHOOK
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Buscar próximo job pendente
    const { data: jobs, error: fetchError } = await supabase
      .from("webhook_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);
    
    if (fetchError) {
      console.error("❌ [WORKER] Erro ao buscar jobs:", fetchError);
      return new Response(JSON.stringify({ error: "fetch_error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ status: "ok", jobs_processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    let processed = 0;
    let errors = 0;
    
    for (const job of jobs) {
      // Marcar como processing
      await supabase
        .from("webhook_jobs")
        .update({ status: "processing", attempts: job.attempts + 1 })
        .eq("id", job.id)
        .eq("status", "pending"); // Lock otimista
      
      try {
        await processarJob(job);
        
        // Marcar como done
        await supabase
          .from("webhook_jobs")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", job.id);
        
        processed++;
        console.log(`✅ [WORKER] Job ${job.id} concluído`);
        
      } catch (error) {
        console.error(`❌ [WORKER] Job ${job.id} falhou:`, error);
        
        const newAttempts = job.attempts + 1;
        const nextRetry = new Date(Date.now() + Math.pow(2, newAttempts) * 1000); // Exponential backoff
        
        if (newAttempts >= 3) {
          // Dead letter
          await supabase
            .from("webhook_jobs")
            .update({ 
              status: "error", 
              last_error: String(error),
              error: String(error)
            })
            .eq("id", job.id);
        } else {
          // Retry
          await supabase
            .from("webhook_jobs")
            .update({ 
              status: "pending", 
              last_error: String(error),
              next_retry_at: nextRetry.toISOString()
            })
            .eq("id", job.id);
        }
        
        errors++;
      }
    }
    
    return new Response(
      JSON.stringify({ 
        status: "ok", 
        jobs_processed: processed,
        jobs_failed: errors,
        total_jobs: jobs.length
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ [WORKER] Erro fatal:", error);
    return new Response(
      JSON.stringify({ error: "internal_error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
