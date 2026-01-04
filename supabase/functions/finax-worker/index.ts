import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

// ============================================================================
// 🏭 FINAX WORKER v3.0 - SLOT FILLING INTELIGENTE
// ============================================================================
//
// ARQUITETURA:
// 1. IA INTERPRETA (extrai intent + slots) - NUNCA DECIDE
// 2. GERENCIADOR DE CONTEXTO (memória de curto prazo) 
// 3. SLOT FILLING INTELIGENTE (anti-robô)
// 4. EXECUTOR (só executa quando slots completos)
// 5. ANTI-DUPLICAÇÃO SEMÂNTICA
//
// REGRAS DE OURO:
// - Nenhum gasto é salvo sem: valor + forma_pagamento
// - "Anota um gasto" = INTENÇÃO, não dado
// - Número sozinho = tenta preencher contexto ativo
// - Nunca "como posso ajudar" com contexto ativo
// - Usuário pode falar em qualquer ordem
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
  buttonReplyId: string | null;
  // NOVO: Para cancelar por reply
  replyToMessageId?: string | null;
}

interface ExtractedItem {
  valor: number;
  descricao: string;
  categoria?: string;
  forma_pagamento?: string;
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
  // MÚLTIPLOS GASTOS
  itens?: ExtractedItem[];
  split_explicit?: boolean;
  aggregate_explicit?: boolean;
  // SLOT FILLING
  slots?: Record<string, any>;
  // MÚLTIPLAS AÇÕES
  acoes_detectadas?: Array<{ intent: string; slots: Record<string, any> }>;
}

// ============================================================================
// 🎰 SLOT FILLING ARCHITECTURE v2.0
// ============================================================================

interface SlotRequirement {
  required: string[];
  optional: string[];
}

// SLOTS OBRIGATÓRIOS E OPCIONAIS POR INTENT
const SLOT_REQUIREMENTS: Record<string, SlotRequirement> = {
  // CARTÕES
  update_card: { required: ["card", "field", "value"], optional: [] },
  add_card: { required: ["card_name", "limit", "due_day"], optional: ["closing_day"] },
  remove_card: { required: ["card"], optional: [] },
  view_cards: { required: [], optional: [] },
  gerenciar_cartoes: { required: [], optional: ["action"] },
  
  // TRANSAÇÕES - FORMA_PAGAMENTO agora é OBRIGATÓRIO
  registrar_gasto: { 
    required: ["amount", "payment_method"], 
    optional: ["description", "category", "card"] 
  },
  registrar_entrada: { 
    required: ["amount"], 
    optional: ["description", "category"] 
  },
  cancelar_transacao: { required: ["transaction_id"], optional: [] },
  
  // PARCELAMENTOS / RECORRENTES
  criar_parcelamento: { required: ["amount", "installments", "description"], optional: ["category", "card"] },
  criar_recorrente: { required: ["amount", "description", "recurrence_type"], optional: ["category", "day_of_month"] },
};

// PROMPTS PARA SOLICITAR SLOTS FALTANTES
const SLOT_PROMPTS: Record<string, { text: string; useButtons?: boolean; buttons?: Array<{ id: string; title: string }> }> = {
  // Cartões
  card: { text: "Qual cartão você quer gerenciar? 💳" },
  field: { text: "O que você quer atualizar? (limite, vencimento ou nome)" },
  value: { text: "Qual o novo valor?" },
  card_name: { text: "Qual é o nome do cartão? (Ex: Nubank, C6, Itaú...)" },
  limit: { text: "Qual o limite total do cartão? 💰" },
  due_day: { text: "Qual o dia de vencimento da fatura? (1-31)" },
  closing_day: { text: "Qual o dia de fechamento? (opcional, deixe vazio para pular)" },
  action: { text: "O que você deseja fazer?\n\n1️⃣ Ver cartões\n2️⃣ Adicionar cartão\n3️⃣ Atualizar cartão\n4️⃣ Remover cartão" },
  
  // Transações - Com botões para forma de pagamento
  amount: { text: "Qual foi o valor? 💸" },
  description: { text: "O que foi essa compra?" },
  category: { text: "Qual categoria se encaixa melhor?" },
  transaction_id: { text: "Qual transação você quer cancelar?" },
  payment_method: { 
    text: "Como você pagou?", 
    useButtons: true,
    buttons: [
      { id: "pay_pix", title: "📱 Pix" },
      { id: "pay_debito", title: "💳 Débito" },
      { id: "pay_credito", title: "💳 Crédito" }
    ]
  },
  
  // Parcelamentos
  installments: { text: "Em quantas vezes foi parcelado?" },
  recurrence_type: { text: "É mensal, semanal ou anual?" },
  day_of_month: { text: "Em qual dia do mês esse gasto se repete?" },
};

// MAPEAMENTO DE CAMPOS (normalização fuzzy)
const FIELD_ALIASES: Record<string, string> = {
  // Campos de cartão
  "limite": "limit", "limit": "limit", "lim": "limit",
  "vencimento": "due_day", "venc": "due_day", "dia vencimento": "due_day", "dia de vencimento": "due_day",
  "nome": "card_name", "name": "card_name",
  "fechamento": "closing_day", "dia fechamento": "closing_day",
  
  // Ações numéricas
  "1": "view", "ver": "view", "listar": "view",
  "2": "add", "adicionar": "add", "novo": "add", "criar": "add",
  "3": "update", "atualizar": "update", "alterar": "update", "mudar": "update",
  "4": "remove", "remover": "remove", "excluir": "remove", "apagar": "remove",
  
  // Formas de pagamento
  "pix": "pix", "débito": "debito", "debito": "debito", "crédito": "credito", "credito": "credito",
  "dinheiro": "dinheiro", "cartao": "credito", "cartão": "credito",
};

// ALIASES PARA FORMA DE PAGAMENTO (normalização)
const PAYMENT_METHOD_ALIASES: Record<string, string> = {
  "pix": "pix", "débito": "debito", "debito": "debito", "cartão de débito": "debito",
  "crédito": "credito", "credito": "credito", "cartão de crédito": "credito", "cartão": "credito",
  "dinheiro": "dinheiro", "cash": "dinheiro", "espécie": "dinheiro",
  "pay_pix": "pix", "pay_debito": "debito", "pay_credito": "credito", "pay_dinheiro": "dinheiro"
};

// ============================================================================
// 🧠 GERENCIADOR DE CONTEXTO (MEMÓRIA DE CURTO PRAZO)
// ============================================================================

interface PendingContext {
  id: string;
  user_id: string;
  intent: string;
  slots: Record<string, any>;
  status: "collecting" | "confirming" | "done" | "expired";
  last_message_id: string | null;
  pending_slot: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

/**
 * Busca contexto ativo do usuário (máximo 1)
 * Expira contextos antigos (> 5 minutos)
 */
async function getActiveContext(userId: string): Promise<PendingContext | null> {
  // Expirar contextos antigos
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  await supabase
    .from("actions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input"])
    .lt("updated_at", fiveMinutesAgo);
  
  // Buscar contexto ativo
  const { data: action } = await supabase
    .from("actions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!action) return null;
  
  const meta = action.meta as Record<string, any> || {};
  
  return {
    id: action.id,
    user_id: action.user_id,
    intent: action.action_type,
    slots: (action.slots || {}) as Record<string, any>,
    status: action.status as "collecting" | "confirming" | "done" | "expired",
    last_message_id: meta.last_message_id || null,
    pending_slot: meta.pending_slot || null,
    created_at: action.created_at,
    updated_at: action.updated_at || action.created_at,
    expires_at: meta.expires_at || new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
}

/**
 * Cria ou atualiza contexto ativo
 */
async function upsertContext(
  userId: string,
  intent: string,
  slots: Record<string, any>,
  pendingSlot?: string | null,
  messageId?: string | null
): Promise<PendingContext> {
  const existing = await getActiveContext(userId);
  
  if (existing && existing.intent === intent) {
    // Merge slots
    const mergedSlots = { ...existing.slots };
    for (const [key, value] of Object.entries(slots)) {
      if (value !== null && value !== undefined && value !== "") {
        mergedSlots[key] = value;
      }
    }
    
    await supabase
      .from("actions")
      .update({
        slots: mergedSlots,
        status: "collecting",
        meta: { 
          pending_slot: pendingSlot || null,
          last_message_id: messageId 
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.id);
    
    console.log(`🔄 [CONTEXT] Atualizado: ${intent} | Slots: ${JSON.stringify(mergedSlots)}`);
    
    return {
      ...existing,
      slots: mergedSlots,
      pending_slot: pendingSlot || null,
      last_message_id: messageId || null,
      updated_at: new Date().toISOString()
    };
  }
  
  // Expirar contexto anterior se diferente
  if (existing) {
    await supabase
      .from("actions")
      .update({ status: "expired" })
      .eq("id", existing.id);
  }
  
  // Criar novo
  const actionHash = `ctx_${userId.slice(0, 8)}_${Date.now()}`;
  
  const { data: newAction, error } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: intent,
      action_hash: actionHash,
      status: "collecting",
      slots: slots,
      meta: { 
        pending_slot: pendingSlot || null,
        last_message_id: messageId,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }
    })
    .select()
    .single();
  
  if (error) {
    console.error("❌ [CONTEXT] Erro ao criar:", error);
    throw error;
  }
  
  console.log(`✨ [CONTEXT] Criado: ${intent} | Slots: ${JSON.stringify(slots)}`);
  
  return {
    id: newAction.id,
    user_id: userId,
    intent: intent,
    slots: slots,
    status: "collecting",
    last_message_id: messageId || null,
    pending_slot: pendingSlot || null,
    created_at: newAction.created_at,
    updated_at: newAction.created_at,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
}

/**
 * Fecha contexto (marca como done)
 */
async function closeContext(contextId: string, entityId?: string): Promise<void> {
  await supabase
    .from("actions")
    .update({ 
      status: "done", 
      entity_id: entityId,
      updated_at: new Date().toISOString() 
    })
    .eq("id", contextId);
  
  console.log(`✅ [CONTEXT] Fechado: ${contextId}`);
}

/**
 * Cancela contexto ativo
 */
async function cancelContext(userId: string): Promise<boolean> {
  const context = await getActiveContext(userId);
  
  if (!context) return false;
  
  await supabase
    .from("actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", context.id);
  
  console.log(`🗑️ [CONTEXT] Cancelado: ${context.id}`);
  return true;
}

// ============================================================================
// 🔐 IDEMPOTÊNCIA - HASH SEMÂNTICO
// ============================================================================

/**
 * Hash semântico baseado em:
 * - user_id
 * - action_type
 * - valor arredondado
 * - categoria normalizada
 * - forma_pagamento
 * - janela de 60 segundos
 */
function gerarHashSemantico(
  userId: string,
  actionType: string,
  valor: number | undefined,
  categoria: string | undefined,
  formaPagamento?: string
): string {
  const now = new Date();
  const timeBucket = Math.floor(now.getTime() / 60000);
  const valorCentavos = Math.round((valor || 0) * 100);
  const categoriaNorm = (categoria || "outros").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const pagamento = (formaPagamento || "unknown").toLowerCase();
  
  const hashInput = `${userId}|${actionType}|${valorCentavos}|${categoriaNorm}|${pagamento}|${timeBucket}`;
  
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return `${actionType}_${userId.slice(0, 8)}_${Math.abs(hash).toString(36)}_${timeBucket}`;
}

/**
 * Verifica duplicação antes de registrar
 */
async function verificarDuplicacao(
  userId: string,
  actionHash: string
): Promise<{ isDuplicate: boolean; existingId?: string }> {
  const { data: existing } = await supabase
    .from("actions")
    .select("id, status")
    .eq("action_hash", actionHash)
    .single();
  
  if (existing) {
    console.log(`🔒 [DEDUPE] Hash ${actionHash} JÁ EXISTE`);
    return { isDuplicate: true, existingId: existing.id };
  }
  
  return { isDuplicate: false };
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

async function sendWhatsAppButtons(
  to: string, 
  bodyText: string, 
  buttons: Array<{ id: string; title: string }>,
  source: MessageSource
): Promise<boolean> {
  if (source !== "meta") {
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
  "categoria": "alimentacao/transporte/moradia/saude/lazer/compras/servicos/mercado/outros",
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
// 🧠 INTERPRETAÇÃO IA v3.0 - SLOT FILLING INTELIGENTE
// ============================================================================

async function interpretarMensagem(
  mensagem: string, 
  historicoRecente: string,
  contextoAtivo?: PendingContext | null
): Promise<{ intent: ExtractedIntent; confianca: number }> {
  try {
    // Construir contexto para IA
    let contextoInfo = "";
    if (contextoAtivo) {
      contextoInfo = `
⚠️ CONTEXTO ATIVO:
Intent: ${contextoAtivo.intent}
Slots preenchidos: ${JSON.stringify(contextoAtivo.slots)}
Slot aguardando: ${contextoAtivo.pending_slot || "nenhum"}

A mensagem pode ser uma resposta ao slot pendente ou uma nova intenção.
`;
    }
    
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
            content: `Você é um analisador de intenções financeiras com SLOT FILLING INTELIGENTE.

⚠️ REGRA FUNDAMENTAL: APENAS EXTRAIA DADOS, NUNCA DECIDA SE REGISTRA.

${contextoInfo}

🎯 INTENTS E SLOTS:

📱 CARTÕES:
- "update_card": atualizar cartão (slots: card, field, value)
- "add_card": adicionar cartão (slots: card_name, limit, due_day)
- "remove_card": remover cartão (slots: card)
- "view_cards": ver cartões cadastrados
- "gerenciar_cartoes": intenção genérica de cartões

💸 TRANSAÇÕES:
- "registrar_gasto": gasto/despesa (slots: amount, description, category, payment_method)
- "registrar_entrada": receita/entrada (slots: amount, description, category)
- "cancelar_transacao": cancelar gasto
- "criar_parcelamento": compra parcelada
- "criar_recorrente": gasto repetitivo

📊 OUTROS:
- "consultar_resumo": resumo/quanto gastei
- "saudacao": oi, olá, bom dia
- "ajuda": como funciona
- "confirmar": sim, pode registrar
- "negar": não, cancela, deixa pra lá
- "fornecer_slot": quando usuário responde uma pergunta de slot

🔴 REGRAS CRÍTICAS:

1. "Anota um gasto" ou "Registra uma despesa" = INTENÇÃO SEM DADOS
   Retorne intent="registrar_gasto" com slots={} vazios
   
2. Número sozinho (ex: "39,08"):
   - Se há contexto ativo esperando amount → slots: { amount: 39.08 }
   - Se não há contexto → intent="fornecer_slot" com slots: { amount: 39.08 }

3. Forma de pagamento:
   - "pix", "no pix", "via pix" → payment_method: "pix"
   - "débito", "no débito" → payment_method: "debito"
   - "crédito", "no crédito", "cartão" → payment_method: "credito"
   - "dinheiro", "cash" → payment_method: "dinheiro"

4. MÚLTIPLOS GASTOS: Se houver MAIS DE UM gasto com valores distintos:
   Retorne acoes_detectadas: [{intent, slots}, {intent, slots}]

5. CATEGORIZAÇÃO (nunca "outros" se inferível):
   café/pão/lanche/água/almoço/jantar/ifood → "alimentacao"
   mercado/supermercado/feira → "mercado"
   uber/99/táxi/ônibus/gasolina → "transporte"
   farmácia/remédio/médico → "saude"
   cinema/netflix/spotify → "lazer"
   aluguel/luz/internet → "moradia"
   roupa/loja → "compras"

6. CANCELAR:
   "cancela", "deixa pra lá", "esquece" = intent="negar"

Responda APENAS JSON:
{
  "intent": "string",
  "slots": { ... } ou null,
  "valor": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "forma_pagamento": "pix"|"dinheiro"|"debito"|"credito" ou null,
  "confianca": number,
  "acoes_detectadas": [{...}] ou null
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
    
    console.log(`🧠 [IA] ${parsed.intent} | Slots: ${JSON.stringify(parsed.slots || {})} | Conf: ${parsed.confianca}`);
    
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
// 🏷️ MAPEAMENTO SEMÂNTICO DE CATEGORIAS
// ============================================================================

function inferirCategoria(descricao: string, categoriaOriginal?: string): string {
  const desc = (descricao || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Se já tem categoria válida e não é "outros", usar
  if (categoriaOriginal && categoriaOriginal !== "outros") {
    return categoriaOriginal;
  }
  
  // Mapeamento semântico
  const mapa: Record<string, string[]> = {
    alimentacao: ["cafe", "pao", "lanche", "agua", "refrigerante", "almoço", "almoco", "jantar", "ifood", "rappi", "comida", "restaurante", "padaria", "salgado", "pizza", "hamburguer", "acai", "sorvete", "doce"],
    mercado: ["mercado", "supermercado", "feira", "hortifruti", "acougue", "peixaria", "atacadao", "atacado"],
    transporte: ["uber", "99", "taxi", "onibus", "metro", "gasolina", "combustivel", "estacionamento", "pedagio", "passagem"],
    saude: ["farmacia", "remedio", "medico", "hospital", "consulta", "exame", "dentista", "otica", "oculos"],
    lazer: ["cinema", "netflix", "spotify", "show", "festa", "bar", "balada", "jogo", "game", "livro", "museu"],
    moradia: ["aluguel", "condominio", "luz", "energia", "agua", "gas", "internet", "telefone", "iptu"],
    compras: ["roupa", "sapato", "loja", "shopping", "presente", "eletronico", "celular"],
    servicos: ["salao", "barbearia", "manicure", "lavanderia", "faxina", "conserto"]
  };
  
  for (const [categoria, palavras] of Object.entries(mapa)) {
    if (palavras.some(p => desc.includes(p))) {
      return categoria;
    }
  }
  
  return categoriaOriginal || "outros";
}

// ============================================================================
// 📋 PENDING SELECTIONS (PARA BATCH/CANCELAMENTO)
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
  
  console.log(`📋 [PENDING] Criado: ${awaitingField}`);
  return token;
}

async function consumirPendingSelection(
  userId: string,
  awaitingField: string
): Promise<{ options: any[]; id: string } | null> {
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
  
  if (error || !data) return null;
  
  await supabase
    .from("pending_selections")
    .update({ consumed: true })
    .eq("id", data.id);
  
  return { options: data.options as any[], id: data.id };
}

// ============================================================================
// 💾 HIPÓTESES (PARA CONFIRMAÇÃO COM BOTÕES)
// ============================================================================

async function criarHipotese(
  userId: string,
  eventoId: string | null,
  dados: ExtractedIntent,
  confianca: number
): Promise<{ hipoteseId: string | null; actionId: string | null }> {
  try {
    // Expirar hipóteses antigas
    await supabase
      .from("hipoteses_registro")
      .update({ status: "expirada" })
      .eq("user_id", userId)
      .eq("status", "pendente");
    
    // Criar ACTION
    const actionHash = `hipotese_${userId.slice(0,8)}_${Date.now()}`;
    
    const { data: actionData, error: actionError } = await supabase
      .from("actions")
      .insert({
        user_id: userId,
        action_type: dados.intent === "registrar_entrada" ? "registrar_entrada" : "registrar_gasto",
        action_hash: actionHash,
        status: "pending_confirmation",
        slots: {
          amount: dados.valor,
          description: dados.descricao,
          category: dados.categoria,
          payment_method: dados.forma_pagamento
        },
        meta: {
          valor: dados.valor,
          categoria: dados.categoria || "outros",
          descricao: dados.descricao,
          forma_pagamento: dados.forma_pagamento,
          evento_id: eventoId,
          confianca
        }
      })
      .select("id")
      .single();
    
    if (actionError) {
      console.error("❌ [HIPOTESE] Erro action:", actionError);
      return { hipoteseId: null, actionId: null };
    }
    
    // Criar hipótese
    const { data: hipoteseData, error: hipoteseError } = await supabase
      .from("hipoteses_registro")
      .insert({
        user_id: userId,
        evento_id: eventoId,
        tipo: dados.intent,
        dados: { ...dados, action_id: actionData.id },
        confianca,
        status: "pendente",
        idempotency_key: actionHash
      })
      .select("id")
      .single();
    
    if (hipoteseError) {
      console.error("❌ [HIPOTESE] Erro:", hipoteseError);
      return { hipoteseId: null, actionId: actionData.id };
    }
    
    console.log(`💡 [HIPOTESE] Criada: ${hipoteseData.id} -> Action: ${actionData.id}`);
    return { hipoteseId: hipoteseData.id, actionId: actionData.id };
  } catch (e) {
    console.error("❌ [HIPOTESE] Exceção:", e);
    return { hipoteseId: null, actionId: null };
  }
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
  
  // Verificar expiração (5 min)
  const createdAt = new Date(data.created_at);
  const diffMinutos = (Date.now() - createdAt.getTime()) / 1000 / 60;
  
  if (diffMinutos > 5) {
    await supabase
      .from("hipoteses_registro")
      .update({ status: "expirada" })
      .eq("id", data.id);
    return null;
  }
  
  return data;
}

async function executarActionConfirmada(
  actionId: string,
  userId: string
): Promise<{ sucesso: boolean; mensagem: string; jaDuplicado?: boolean }> {
  try {
    const { data: action } = await supabase
      .from("actions")
      .select("*")
      .eq("id", actionId)
      .eq("user_id", userId)
      .single();
    
    if (!action) {
      return { sucesso: false, mensagem: "Essa confirmação expirou 😕\n\nMe conta de novo o gasto." };
    }
    
    if (action.status === "done") {
      return { sucesso: false, jaDuplicado: true, mensagem: "Esse gasto já foi registrado 👍" };
    }
    
    if (action.status !== "pending_confirmation") {
      return { sucesso: false, mensagem: "Essa confirmação não está mais disponível." };
    }
    
    const slots = action.slots as Record<string, any> || {};
    const meta = action.meta as Record<string, any> || {};
    const tipoTransacao = action.action_type === "registrar_entrada" ? "entrada" : "saida";
    
    const valor = slots.amount || meta.valor;
    const categoria = inferirCategoria(slots.description || meta.descricao || "", slots.category || meta.categoria);
    const descricao = slots.description || meta.descricao;
    const formaPagamento = slots.payment_method || meta.forma_pagamento;
    
    const agora = new Date();
    
    const { data: transacao, error: txError } = await supabase.from("transacoes").insert({
      usuario_id: userId,
      valor: valor,
      categoria: categoria,
      tipo: tipoTransacao,
      descricao: descricao,
      observacao: descricao,
      data: agora.toISOString(),
      origem: "whatsapp",
      forma_pagamento: formaPagamento,
      status: "confirmada",
      idempotency_key: action.action_hash
    }).select("id").single();
    
    if (txError) {
      console.error("❌ [ACTION] Erro transação:", txError);
      return { sucesso: false, mensagem: "Algo deu errado ao salvar 😕\n\nTenta de novo?" };
    }
    
    await supabase
      .from("actions")
      .update({ status: "done", entity_id: transacao.id, updated_at: new Date().toISOString() })
      .eq("id", actionId);
    
    await supabase.from("finax_logs").insert({
      user_id: userId,
      action_type: "confirmar_registro",
      entity_type: "transacao",
      entity_id: transacao.id,
      new_data: { action_id: actionId, valor, categoria, descricao, formaPagamento }
    });
    
    const dataFormatada = agora.toLocaleDateString("pt-BR");
    const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const sinal = tipoTransacao === "entrada" ? "+" : "-";
    const tipoTexto = tipoTransacao === "entrada" ? "Entrada registrada" : "Gasto registrado";
    
    return {
      sucesso: true,
      mensagem: `✅ *${tipoTexto}!*\n\n` +
        `💸 *${sinal}R$ ${valor?.toFixed(2)}*\n` +
        `📂 ${categoria}\n` +
        (descricao ? `📝 ${descricao}\n` : "") +
        (formaPagamento ? `💳 ${formaPagamento}\n` : "") +
        `📅 ${dataFormatada} às ${horaFormatada}`
    };
    
  } catch (e) {
    console.error("❌ [ACTION] Exceção:", e);
    return { sucesso: false, mensagem: "Erro ao processar confirmação 😕" };
  }
}

async function cancelarActionPendente(actionId: string, userId: string): Promise<void> {
  await supabase
    .from("actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("user_id", userId);
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

async function registrarTransacaoComSlots(
  userId: string,
  slots: Record<string, any>,
  eventoId: string | null,
  contextId?: string
): Promise<{ sucesso: boolean; mensagem: string; transacaoId?: string; jaDuplicado?: boolean }> {
  
  const tipoTransacao = "saida"; // Por enquanto só gastos usam isso
  const categoria = inferirCategoria(slots.description || "", slots.category);
  const valor = slots.amount;
  const formaPagamento = slots.payment_method;
  
  // Hash semântico
  const actionHash = gerarHashSemantico(userId, "registrar_gasto", valor, categoria, formaPagamento);
  
  console.log(`🔐 [REGISTRO] Hash: ${actionHash} | Valor: ${valor} | Cat: ${categoria} | Pag: ${formaPagamento}`);
  
  // Verificar duplicação
  const { isDuplicate } = await verificarDuplicacao(userId, actionHash);
  
  if (isDuplicate) {
    console.log(`🛑 [REGISTRO] Bloqueado - duplicação: ${actionHash}`);
    if (contextId) await closeContext(contextId);
    return {
      sucesso: false,
      jaDuplicado: true,
      mensagem: "Esse gasto já foi registrado há instantes 👍"
    };
  }
  
  // Criar action para idempotência
  const { error: actionError } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: "registrar_gasto",
      action_hash: actionHash,
      status: "done",
      slots: slots,
      meta: { valor, categoria, formaPagamento, descricao: slots.description }
    });
  
  if (actionError && actionError.code === '23505') {
    if (contextId) await closeContext(contextId);
    return { sucesso: false, jaDuplicado: true, mensagem: "Esse gasto já foi registrado 👍" };
  }
  
  // Criar transação
  const transacaoId = gerarIdTransacao();
  const agora = new Date();
  
  const { data: transacao, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor: valor,
    categoria: categoria,
    tipo: tipoTransacao,
    descricao: slots.description,
    observacao: slots.description,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: formaPagamento,
    status: "confirmada",
    idempotency_key: actionHash
  }).select("id").single();
  
  if (error) {
    console.error("❌ [REGISTRO] Erro:", error);
    return { sucesso: false, mensagem: "Algo deu errado ao salvar 😕\n\nTenta de novo?" };
  }
  
  // Fechar contexto
  if (contextId) await closeContext(contextId, transacao.id);
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_transacao",
    entity_type: "transacao",
    entity_id: transacao.id,
    new_data: { ...slots, action_hash: actionHash }
  });
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  console.log(`✅ [REGISTRO] Sucesso: ${transacaoId}`);
  
  return {
    sucesso: true,
    transacaoId,
    mensagem: `✅ *Gasto registrado!*\n\n` +
      `💸 *-R$ ${valor?.toFixed(2)}*\n` +
      `📂 ${categoria}\n` +
      (slots.description ? `📝 ${slots.description}\n` : "") +
      `💳 ${formaPagamento || "não informado"}\n` +
      `📅 ${dataFormatada} às ${horaFormatada}`
  };
}

// ============================================================================
// 🗑️ CANCELAMENTO
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

async function buscarTransacaoPorMensagem(
  userId: string,
  messageId: string
): Promise<any | null> {
  // Buscar evento bruto vinculado à mensagem
  const { data: evento } = await supabase
    .from("eventos_brutos")
    .select("id")
    .eq("message_id", messageId)
    .single();
  
  if (!evento) return null;
  
  // Buscar transação vinculada ao evento
  const { data: hipotese } = await supabase
    .from("hipoteses_registro")
    .select("dados")
    .eq("evento_id", evento.id)
    .eq("status", "confirmada")
    .single();
  
  if (hipotese?.dados?.action_id) {
    const { data: action } = await supabase
      .from("actions")
      .select("entity_id")
      .eq("id", hipotese.dados.action_id)
      .single();
    
    if (action?.entity_id) {
      const { data: transacao } = await supabase
        .from("transacoes")
        .select("*")
        .eq("id", action.entity_id)
        .eq("usuario_id", userId)
        .single();
      
      return transacao;
    }
  }
  
  return null;
}

async function cancelarTransacao(
  userId: string,
  transacaoId: string
): Promise<{ sucesso: boolean; mensagem: string }> {
  
  const { data: transacao } = await supabase
    .from("transacoes")
    .select("*")
    .eq("id", transacaoId)
    .eq("usuario_id", userId)
    .single();
  
  if (!transacao) {
    return { sucesso: false, mensagem: "Transação não encontrada 🤔" };
  }
  
  if (transacao.status === "cancelada") {
    return { sucesso: false, mensagem: "Essa transação já foi cancelada 👍" };
  }
  
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "cancelar_transacao",
    entity_type: "transacao",
    entity_id: transacaoId,
    old_data: transacao,
    new_data: { status: "cancelada" }
  });
  
  const { error } = await supabase
    .from("transacoes")
    .update({ status: "cancelada" })
    .eq("id", transacaoId);
  
  if (error) {
    return { sucesso: false, mensagem: "Erro ao cancelar 😕" };
  }
  
  return {
    sucesso: true,
    mensagem: `✅ *Transação cancelada!*\n\n` +
      `🗑️ R$ ${transacao.valor?.toFixed(2)} - ${transacao.descricao || transacao.categoria}\n\n` +
      `_Se foi um engano, manda de novo que eu registro!_`
  };
}

// ============================================================================
// 🔧 SLOT FILLING - FUNÇÕES AUXILIARES
// ============================================================================

function getMissingSlots(intent: string, currentSlots: Record<string, any>): string[] {
  const requirements = SLOT_REQUIREMENTS[intent];
  if (!requirements) return [];
  
  return requirements.required.filter(slot => {
    const value = currentSlots[slot];
    return value === null || value === undefined || value === "";
  });
}

function normalizePaymentMethod(value: string): string | null {
  const normalized = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return PAYMENT_METHOD_ALIASES[normalized] || null;
}

function extractSlotsFromMessage(
  message: string,
  pendingSlot: string | null
): Record<string, any> {
  const msg = message.trim();
  const slots: Record<string, any> = {};
  
  // Número puro
  const numMatch = msg.replace(/[^\d.,]/g, "").replace(",", ".");
  const numValue = parseFloat(numMatch);
  
  if (!isNaN(numValue) && numValue > 0) {
    if (pendingSlot === "amount" || !pendingSlot) {
      slots.amount = numValue;
    } else if (["limit", "value", "due_day", "closing_day", "installments"].includes(pendingSlot)) {
      slots[pendingSlot] = numValue;
    }
  }
  
  // Forma de pagamento
  const paymentMethod = normalizePaymentMethod(msg);
  if (paymentMethod) {
    slots.payment_method = paymentMethod;
  }
  
  // Texto para descrição
  if (pendingSlot === "description" && !slots.amount) {
    slots.description = msg;
  }
  
  return slots;
}

// ============================================================================
// 🔄 PROCESSAMENTO DO JOB PRINCIPAL
// ============================================================================

async function processarJob(job: any): Promise<void> {
  const payload: JobPayload = job.payload;
  const userId = job.user_id;
  const eventoId = payload.evento_id;
  
  console.log(`🔄 [WORKER] Job ${job.id} | ${payload.messageType} | User: ${userId?.slice(0,8)}`);
  
  try {
    // Buscar usuário
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("id", userId)
      .single();
    
    const nomeUsuario = usuario?.nome || "amigo(a)";
    
    // Verificar se é novo usuário
    const { count: historicoCount } = await supabase
      .from("historico_conversas")
      .select("id", { count: "exact", head: true })
      .eq("phone_number", payload.phoneNumber);
    
    const isNovoUsuario = (historicoCount || 0) === 0;
    
    // ONBOARDING
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
    // 🧠 BUSCAR CONTEXTO ATIVO (MEMÓRIA DE CURTO PRAZO)
    // ========================================================================
    const contextoAtivo = await getActiveContext(userId);
    
    console.log(`📋 [CONTEXT] Ativo: ${contextoAtivo ? contextoAtivo.intent : "nenhum"} | Slots: ${JSON.stringify(contextoAtivo?.slots || {})}`);
    
    // ========================================================================
    // 🔘 TRATAR CALLBACK DE BOTÃO (PRIORIDADE MÁXIMA)
    // ========================================================================
    if (payload.buttonReplyId) {
      console.log(`🔘 [BUTTON] Callback: ${payload.buttonReplyId}`);
      
      // FORMA DE PAGAMENTO via botão
      if (payload.buttonReplyId.startsWith("pay_")) {
        const paymentMethod = PAYMENT_METHOD_ALIASES[payload.buttonReplyId];
        
        if (paymentMethod && contextoAtivo) {
          const updatedSlots = { ...contextoAtivo.slots, payment_method: paymentMethod };
          const missing = getMissingSlots(contextoAtivo.intent, updatedSlots);
          
          if (missing.length === 0) {
            // TODOS OS SLOTS COMPLETOS → REGISTRAR
            const resultado = await registrarTransacaoComSlots(userId, updatedSlots, eventoId, contextoAtivo.id);
            await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
            
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: `[BOTÃO ${paymentMethod.toUpperCase()}]`,
              ai_response: resultado.mensagem,
              tipo: resultado.jaDuplicado ? "duplicado_bloqueado" : "registro_slot_filling"
            });
            
            return;
          } else {
            // Atualizar contexto e pedir próximo slot
            await upsertContext(userId, contextoAtivo.intent, updatedSlots, missing[0], payload.messageId);
            
            const prompt = SLOT_PROMPTS[missing[0]];
            if (prompt.useButtons && prompt.buttons) {
              await sendWhatsAppButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
            } else {
              await sendWhatsAppMessage(payload.phoneNumber, prompt.text, payload.messageSource);
            }
            return;
          }
        }
      }
      
      // CONFIRMAR HIPÓTESE
      if (payload.buttonReplyId === "confirm_yes") {
        const hipotesePendente = await buscarHipotesePendente(userId);
        
        if (hipotesePendente?.dados?.action_id) {
          const resultado = await executarActionConfirmada(hipotesePendente.dados.action_id, userId);
          
          await supabase.from("hipoteses_registro")
            .update({ status: resultado.sucesso ? "confirmada" : "erro" })
            .eq("id", hipotesePendente.id);
          
          await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          return;
        }
        
        await sendWhatsAppMessage(payload.phoneNumber, "Essa confirmação expirou 😕\n\nMe conta de novo o gasto.", payload.messageSource);
        return;
      }
      
      // NEGAR HIPÓTESE
      if (payload.buttonReplyId === "confirm_no") {
        const hipotesePendente = await buscarHipotesePendente(userId);
        
        if (hipotesePendente) {
          await supabase.from("hipoteses_registro")
            .update({ status: "cancelada" })
            .eq("id", hipotesePendente.id);
          
          if (hipotesePendente.dados?.action_id) {
            await cancelarActionPendente(hipotesePendente.dados.action_id, userId);
          }
        }
        
        // Cancelar contexto ativo também
        await cancelContext(userId);
        
        await sendWhatsAppMessage(payload.phoneNumber, "Sem problemas! 👍 Já descartei.\n\nMe conta novamente como foi.", payload.messageSource);
        return;
      }
      
      // BATCH SEPARATE
      if (payload.buttonReplyId === "batch_separate") {
        const pending = await consumirPendingSelection(userId, "batch_expense");
        
        if (!pending || pending.options.length === 0) {
          await sendWhatsAppMessage(payload.phoneNumber, "Essa seleção expirou 😕", payload.messageSource);
          return;
        }
        
        const resultados: string[] = [];
        
        for (const opt of pending.options) {
          const meta = opt.meta as { valor: number; descricao: string; categoria: string; forma_pagamento?: string };
          const slots = {
            amount: meta.valor,
            description: meta.descricao,
            category: inferirCategoria(meta.descricao, meta.categoria),
            payment_method: meta.forma_pagamento || "pix"
          };
          
          const resultado = await registrarTransacaoComSlots(userId, slots, eventoId);
          if (resultado.sucesso) {
            resultados.push(`✅ R$ ${meta.valor.toFixed(2)} - ${meta.descricao}`);
          }
        }
        
        await sendWhatsAppMessage(payload.phoneNumber, `*${pending.options.length} gastos registrados!*\n\n${resultados.join("\n")}`, payload.messageSource);
        return;
      }
      
      // BATCH SINGLE
      if (payload.buttonReplyId === "batch_single") {
        const pending = await consumirPendingSelection(userId, "batch_expense");
        
        if (!pending || pending.options.length === 0) {
          await sendWhatsAppMessage(payload.phoneNumber, "Essa seleção expirou 😕", payload.messageSource);
          return;
        }
        
        const somaTotal = pending.options.reduce((sum, o) => sum + (o.meta?.valor || 0), 0);
        const descricoes = pending.options.map(o => o.meta?.descricao).filter(Boolean).join(", ");
        
        const slots = {
          amount: somaTotal,
          description: descricoes,
          category: "outros",
          payment_method: "pix"
        };
        
        const resultado = await registrarTransacaoComSlots(userId, slots, eventoId);
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        return;
      }
    }
    
    // ========================================================================
    // 📷 PROCESSAR MÍDIA (ÁUDIO / IMAGEM)
    // ========================================================================
    let conteudoProcessado = payload.messageText;
    let confiancaMidia = 0.9;
    
    // ÁUDIO
    if (payload.messageType === "audio" && payload.mediaId) {
      const audioBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!audioBase64) {
        await sendWhatsAppMessage(payload.phoneNumber, "Não peguei o áudio direito 🎤\n\n👉 Pode escrever rapidinho o que você disse?", payload.messageSource);
        return;
      }
      
      const transcricao = await transcreverAudio(audioBase64);
      
      if (!transcricao.texto) {
        await sendWhatsAppMessage(payload.phoneNumber, "Não peguei o áudio direito 🎤\n\n👉 Pode escrever rapidinho o que você disse?", payload.messageSource);
        return;
      }
      
      conteudoProcessado = transcricao.texto;
      confiancaMidia = transcricao.confianca * 0.9;
    }
    
    // IMAGEM
    if (payload.messageType === "image" && payload.mediaId) {
      const imageBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!imageBase64) {
        await sendWhatsAppMessage(payload.phoneNumber, "Não consegui baixar a imagem 📷\n\n👉 Pode tentar enviar de novo?", payload.messageSource);
        return;
      }
      
      const analise = await analisarImagem(imageBase64, payload.mediaMimeType, eventoId, payload.messageId);
      
      if (!analise.dados || analise.dados.intent === "outro" || analise.confianca < 0.3) {
        await sendWhatsAppMessage(payload.phoneNumber, "Vi a imagem 📷\n\n👉 Me conta: *quanto foi* e *o que era*?", payload.messageSource);
        return;
      }
      
      // Imagem cria hipótese para confirmação
      const { hipoteseId } = await criarHipotese(userId, eventoId, analise.dados, analise.confianca);
      
      if (!hipoteseId) {
        await sendWhatsAppMessage(payload.phoneNumber, "Algo deu errado 😕\n\n👉 Tenta de novo?", payload.messageSource);
        return;
      }
      
      const msgConfirmacao = `Entendi assim 👇\n\n` +
        `💸 *Gasto*: R$ ${analise.dados.valor?.toFixed(2)}\n` +
        (analise.dados.descricao ? `📝 *O quê*: ${analise.dados.descricao}\n` : "") +
        (analise.dados.categoria ? `📂 *Categoria*: ${analise.dados.categoria}\n` : "") +
        (analise.dados.forma_pagamento ? `💳 *Pagamento*: ${analise.dados.forma_pagamento}\n` : "") +
        `\nPosso registrar?`;
      
      await sendWhatsAppButtons(
        payload.phoneNumber,
        msgConfirmacao,
        [
          { id: "confirm_yes", title: "✅ Sim" },
          { id: "confirm_no", title: "❌ Não" }
        ],
        payload.messageSource
      );
      
      return;
    }
    
    // ========================================================================
    // 🧠 INTERPRETAR MENSAGEM COM IA (CONSIDERANDO CONTEXTO)
    // ========================================================================
    
    // Buscar histórico recente
    const { data: historico } = await supabase
      .from("historico_conversas")
      .select("user_message, ai_response, tipo")
      .eq("phone_number", payload.phoneNumber)
      .order("created_at", { ascending: false })
      .limit(3);
    
    const historicoFormatado = historico?.map(h => 
      `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 100)}...`
    ).reverse().join("\n") || "";
    
    const { intent: interpretacao, confianca: confIA } = await interpretarMensagem(
      conteudoProcessado, 
      historicoFormatado,
      contextoAtivo
    );
    
    console.log(`🎯 [INTENT] ${interpretacao.intent} | Conf: ${confIA} | Slots: ${JSON.stringify(interpretacao.slots || {})}`);
    
    // ========================================================================
    // 🚫 NEGAR / CANCELAR
    // ========================================================================
    if (interpretacao.intent === "negar") {
      const cancelled = await cancelContext(userId);
      
      if (cancelled) {
        await sendWhatsAppMessage(payload.phoneNumber, "Ok, descartei! 👍\n\nO que você gostaria de fazer?", payload.messageSource);
      } else {
        await sendWhatsAppMessage(payload.phoneNumber, "Não tinha nada pendente 🤔\n\nComo posso te ajudar?", payload.messageSource);
      }
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: "[CANCELADO]",
        tipo: "cancelamento"
      });
      
      return;
    }
    
    // ========================================================================
    // 💸 REGISTRAR GASTO (SLOT FILLING INTELIGENTE)
    // ========================================================================
    if (interpretacao.intent === "registrar_gasto" || interpretacao.intent === "fornecer_slot") {
      
      // Extrair slots da mensagem
      let novoSlots: Record<string, any> = interpretacao.slots || {};
      
      // Adicionar valor e descrição do nível superior se existirem
      if (interpretacao.valor) novoSlots.amount = interpretacao.valor;
      if (interpretacao.descricao) novoSlots.description = interpretacao.descricao;
      if (interpretacao.categoria) novoSlots.category = interpretacao.categoria;
      if (interpretacao.forma_pagamento) novoSlots.payment_method = interpretacao.forma_pagamento;
      
      // Se é uma resposta de slot (número sozinho, etc)
      if (contextoAtivo && contextoAtivo.intent === "registrar_gasto") {
        const extracted = extractSlotsFromMessage(conteudoProcessado, contextoAtivo.pending_slot);
        novoSlots = { ...novoSlots, ...extracted };
      }
      
      // Merge com contexto ativo
      let slotsAtuais = contextoAtivo?.intent === "registrar_gasto" 
        ? { ...contextoAtivo.slots, ...novoSlots }
        : novoSlots;
      
      // Verificar slots faltantes
      const missing = getMissingSlots("registrar_gasto", slotsAtuais);
      
      console.log(`📊 [SLOTS] Atuais: ${JSON.stringify(slotsAtuais)} | Faltando: ${missing.join(", ")}`);
      
      if (missing.length === 0) {
        // TODOS OS SLOTS COMPLETOS → REGISTRAR
        const contextId = contextoAtivo?.intent === "registrar_gasto" ? contextoAtivo.id : undefined;
        const resultado = await registrarTransacaoComSlots(userId, slotsAtuais, eventoId, contextId);
        
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: conteudoProcessado,
          ai_response: resultado.mensagem,
          tipo: resultado.jaDuplicado ? "duplicado_bloqueado" : "registro_slot_filling"
        });
        
        return;
      }
      
      // SLOTS FALTANDO → PERGUNTAR
      const nextSlot = missing[0];
      
      // Criar/atualizar contexto
      await upsertContext(userId, "registrar_gasto", slotsAtuais, nextSlot, payload.messageId);
      
      const prompt = SLOT_PROMPTS[nextSlot];
      
      if (prompt.useButtons && prompt.buttons) {
        await sendWhatsAppButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
      } else {
        await sendWhatsAppMessage(payload.phoneNumber, prompt.text, payload.messageSource);
      }
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: prompt.text,
        tipo: "slot_filling"
      });
      
      return;
    }
    
    // ========================================================================
    // 📊 CONSULTAR RESUMO
    // ========================================================================
    if (interpretacao.intent === "consultar_resumo") {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);
      
      const { data: transacoes } = await supabase
        .from("transacoes")
        .select("valor, tipo, categoria")
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
          `💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n` +
          `💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n` +
          `📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
      }
      
      await sendWhatsAppMessage(payload.phoneNumber, resposta, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🗑️ CANCELAR TRANSAÇÃO
    // ========================================================================
    if (interpretacao.intent === "cancelar_transacao") {
      const transacoes = await listarTransacoesParaCancelar(userId);
      
      if (transacoes.length === 0) {
        await sendWhatsAppMessage(payload.phoneNumber, "Você não tem transações para cancelar 🤔", payload.messageSource);
        return;
      }
      
      const lista = transacoes.map((t, i) => ({
        index: i + 1,
        tx_id: t.id,
        label: `R$ ${t.valor?.toFixed(2)} - ${t.descricao || t.categoria}`,
        meta: { tx_id: t.id }
      }));
      
      await criarPendingSelection(userId, lista, "cancel_transaction", 2);
      
      const msgLista = `Qual transação você quer cancelar?\n\n` +
        lista.map(l => `${l.index}. ${l.label}`).join("\n") +
        `\n\n_Responde com o número_`;
      
      await sendWhatsAppMessage(payload.phoneNumber, msgLista, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 💳 GERENCIAR CARTÕES (SLOT FILLING)
    // ========================================================================
    if (["gerenciar_cartoes", "update_card", "add_card", "remove_card", "view_cards"].includes(interpretacao.intent)) {
      // [Mantém a lógica existente de cartões - simplificado aqui]
      
      if (interpretacao.intent === "view_cards") {
        const { data: cartoes } = await supabase
          .from("cartoes_credito")
          .select("*")
          .eq("usuario_id", userId)
          .eq("ativo", true);
        
        if (!cartoes || cartoes.length === 0) {
          await sendWhatsAppMessage(payload.phoneNumber, "Você ainda não tem cartões cadastrados 💳\n\nQuer adicionar um?", payload.messageSource);
          return;
        }
        
        const lista = cartoes.map((c, i) => 
          `${i + 1}. *${c.nome}*\n   Limite: R$ ${Number(c.limite_total || 0).toFixed(2)}\n   Vencimento: dia ${c.dia_vencimento}`
        ).join("\n\n");
        
        await sendWhatsAppMessage(payload.phoneNumber, `*Seus cartões* 💳\n\n${lista}`, payload.messageSource);
        return;
      }
      
      // Outros casos de cartão...
      await sendWhatsAppMessage(
        payload.phoneNumber,
        "O que você quer fazer com cartões?\n\n1️⃣ Ver cartões\n2️⃣ Adicionar cartão\n3️⃣ Atualizar cartão\n4️⃣ Remover cartão",
        payload.messageSource
      );
      return;
    }
    
    // ========================================================================
    // 👋 SAUDAÇÃO / AJUDA / OUTRO
    // ========================================================================
    
    // REGRA: Nunca "como posso ajudar" se há contexto ativo
    if (contextoAtivo && contextoAtivo.intent === "registrar_gasto") {
      const missing = getMissingSlots("registrar_gasto", contextoAtivo.slots);
      
      if (missing.length > 0) {
        const nextSlot = missing[0];
        const prompt = SLOT_PROMPTS[nextSlot];
        
        // Re-perguntar slot pendente
        const rePrompt = `Desculpa, não entendi 🤔\n\n${prompt.text}`;
        
        if (prompt.useButtons && prompt.buttons) {
          await sendWhatsAppButtons(payload.phoneNumber, rePrompt, prompt.buttons, payload.messageSource);
        } else {
          await sendWhatsAppMessage(payload.phoneNumber, rePrompt, payload.messageSource);
        }
        
        return;
      }
    }
    
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
    console.error(`❌ [WORKER] Erro job ${job.id}:`, error);
    throw error;
  }
}

// ============================================================================
// 🚀 ENDPOINT
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { data: jobs, error: fetchError } = await supabase
      .from("webhook_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);
    
    if (fetchError) {
      console.error("❌ [WORKER] Erro fetch jobs:", fetchError);
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
      await supabase
        .from("webhook_jobs")
        .update({ status: "processing", attempts: job.attempts + 1 })
        .eq("id", job.id)
        .eq("status", "pending");
      
      try {
        await processarJob(job);
        
        await supabase
          .from("webhook_jobs")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", job.id);
        
        processed++;
        console.log(`✅ [WORKER] Job ${job.id} concluído`);
        
      } catch (error) {
        console.error(`❌ [WORKER] Job ${job.id} falhou:`, error);
        
        const newAttempts = job.attempts + 1;
        
        if (newAttempts >= 3) {
          await supabase
            .from("webhook_jobs")
            .update({ 
              status: "error", 
              last_error: String(error),
              error: String(error)
            })
            .eq("id", job.id);
        } else {
          const nextRetry = new Date(Date.now() + Math.pow(2, newAttempts) * 1000);
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
