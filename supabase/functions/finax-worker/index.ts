import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

// ============================================================================
// 🏭 FINAX WORKER v4.0 - MOTOR DE DECISÃO DETERMINÍSTICO
// ============================================================================
//
// ARQUITETURA:
// 1. PRIORIDADE: Reply → Pending Selection → Active Action → Nova Intent
// 2. ISOLAMENTO: Cada tipo de action (slot_filling, cancel_selection, card_update)
// 3. NUMERIC ROUTING: Número isolado → preenche slot OU pergunta contexto
// 4. ANTI-DUPLICAÇÃO: Hash semântico + janela temporal (3 min)
// 5. MULTI-ITEM: Detecta N itens e pergunta [Separado] [Único]
//
// REGRAS DE OURO:
// - Nenhum gasto é salvo sem: valor + forma_pagamento
// - Número sozinho → tenta preencher contexto ativo, senão pergunta
// - Nunca "como posso ajudar" com contexto ativo
// - Cancel selection: número = seleção (não slot de gasto)
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
type ActionType = "slot_filling" | "cancel_selection" | "card_update" | "batch_confirm" | "duplicate_confirm";

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
  itens?: ExtractedItem[];
  split_explicit?: boolean;
  aggregate_explicit?: boolean;
  slots?: Record<string, any>;
  acoes_detectadas?: Array<{ intent: string; slots: Record<string, any> }>;
}

interface ActiveAction {
  id: string;
  user_id: string;
  type: ActionType;
  intent: string;
  slots: Record<string, any> & { card?: string };
  status: string;
  pending_slot?: string | null;
  pending_selection_id?: string | null;
  origin_message_id?: string | null;
  last_message_id?: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ============================================================================
// 🎰 SLOT REQUIREMENTS & PROMPTS
// ============================================================================

const SLOT_REQUIREMENTS: Record<string, { required: string[]; optional: string[] }> = {
  registrar_gasto: { required: ["amount", "payment_method"], optional: ["description", "category", "card"] },
  // ENTRADA: amount é obrigatório, source/description são opcionais mas preferíveis
  registrar_entrada: { required: ["amount"], optional: ["description", "source"] },
  update_card: { required: ["card", "value"], optional: ["field"] },
  add_card: { required: ["card_name", "limit", "due_day"], optional: ["closing_day"] },
  remove_card: { required: ["card"], optional: [] },
  criar_parcelamento: { required: ["amount", "installments", "description"], optional: ["category", "card"] },
  criar_recorrente: { required: ["amount", "description", "recurrence_type"], optional: ["category", "day_of_month"] },
  numero_isolado: { required: ["amount", "type_choice"], optional: [] },
};

const SLOT_PROMPTS: Record<string, { text: string; useButtons?: boolean; buttons?: Array<{ id: string; title: string }> }> = {
  amount: { text: "Qual foi o valor? 💸" },
  amount_entrada: { text: "Qual foi o valor que entrou? 💰" },
  description: { text: "O que foi essa compra?" },
  description_entrada: { text: "De onde veio esse dinheiro?" },
  source: { text: "Como você recebeu?", useButtons: true, buttons: [
    { id: "src_pix", title: "📱 Pix" },
    { id: "src_dinheiro", title: "💵 Dinheiro" },
    { id: "src_transf", title: "🏦 Transferência" }
  ]},
  category: { text: "Qual categoria?" },
  payment_method: { 
    text: "Como você pagou?", 
    useButtons: true,
    buttons: [
      { id: "pay_pix", title: "📱 Pix" },
      { id: "pay_debito", title: "💳 Débito" },
      { id: "pay_credito", title: "💳 Crédito" }
    ]
  },
  card: { text: "Qual cartão?" },
  card_name: { text: "Qual o nome do cartão? (Ex: Nubank, C6...)" },
  limit: { text: "Qual o limite total? 💰" },
  due_day: { text: "Qual o dia de vencimento? (1-31)" },
  closing_day: { text: "Qual o dia de fechamento?" },
  field: { text: "O que quer atualizar? (limite, vencimento ou nome)" },
  value: { text: "Qual o novo valor do limite?" },
  installments: { text: "Em quantas vezes?" },
  recurrence_type: { text: "É mensal, semanal ou anual?" },
};

const PAYMENT_ALIASES: Record<string, string> = {
  "pix": "pix", "débito": "debito", "debito": "debito", 
  "crédito": "credito", "credito": "credito", "cartão": "credito",
  "dinheiro": "dinheiro", "cash": "dinheiro",
  "pay_pix": "pix", "pay_debito": "debito", "pay_credito": "credito", "pay_dinheiro": "dinheiro"
};

const SOURCE_ALIASES: Record<string, string> = {
  "pix": "pix", "dinheiro": "dinheiro", "transferencia": "transferencia",
  "src_pix": "pix", "src_dinheiro": "dinheiro", "src_transf": "transferencia"
};

// ============================================================================
// 🎯 DOMÍNIOS - Classificação por palavras-chave (ANTES da IA)
// ============================================================================

const DOMAIN_KEYWORDS = {
  entrada: ["recebi", "recebimento", "entrada", "ganhei", "caiu", "pix recebido", "salario", "salário", "pagamento recebido", "receita"],
  cartao: ["limite", "cartão", "cartao", "credito", "crédito", "nubank", "itau", "itaú", "bradesco", "santander", "c6", "inter", "picpay"],
  cancelar: ["cancela", "cancelar", "desfaz", "desfazer", "remove", "remover"]
};

function detectDomainFromText(text: string): "entrada" | "cartao" | "gasto" | "cancelar" | null {
  const normalized = normalizeText(text);
  
  // Verificar entradas (PRIORIDADE ALTA)
  if (DOMAIN_KEYWORDS.entrada.some(kw => normalized.includes(kw))) {
    return "entrada";
  }
  
  // Verificar cartão/limite
  if (DOMAIN_KEYWORDS.cartao.some(kw => normalized.includes(kw))) {
    // Verificar se é gasto no crédito vs atualização de cartão
    if (normalized.includes("limite") || normalized.includes("atualiz") || normalized.includes("alter")) {
      return "cartao";
    }
  }
  
  // Verificar cancelamento
  if (DOMAIN_KEYWORDS.cancelar.some(kw => normalized.includes(kw))) {
    return "cancelar";
  }
  
  return null; // Não detectado por keywords, deixar para IA
}

function shouldAutoDiscardContext(activeAction: ActiveAction | null, newDomain: string | null): boolean {
  if (!activeAction || !newDomain) return false;
  
  const currentDomain = activeAction.intent.includes("entrada") ? "entrada" 
    : activeAction.intent.includes("card") ? "cartao"
    : activeAction.intent.includes("gasto") ? "gasto"
    : null;
  
  // Se domínios são claramente diferentes, descartar
  if (currentDomain && newDomain !== currentDomain && newDomain !== "cancelar") {
    console.log(`🔄 [CONTEXT] Auto-descarte: ${currentDomain} → ${newDomain}`);
    return true;
  }
  
  return false;
}

// ============================================================================
// 📊 LOGGING ESTRUTURADO
// ============================================================================

function logDecision(data: {
  messageId: string;
  referencedMessageId?: string | null;
  activeActionId?: string | null;
  activeActionType?: string | null;
  dedupeHash?: string | null;
  decision: string;
  details?: any;
}) {
  console.log(`📊 [DECISION] ${JSON.stringify({
    msg_id: data.messageId?.slice(-8),
    ref_msg: data.referencedMessageId?.slice(-8) || null,
    action_id: data.activeActionId?.slice(-8) || null,
    action_type: data.activeActionType || null,
    hash: data.dedupeHash?.slice(-12) || null,
    decision: data.decision,
    ...data.details
  })}`);
}

// ============================================================================
// 🔐 HASH SEMÂNTICO + ANTI-DUPLICAÇÃO (3 MIN WINDOW)
// ============================================================================

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function gerarDedupeHash(
  userId: string,
  valor: number | undefined,
  descricao: string | undefined,
  formaPagamento: string | undefined
): string {
  const valorCentavos = Math.round((valor || 0) * 100);
  const descNorm = normalizeText(descricao || "");
  const pagamento = (formaPagamento || "unknown").toLowerCase();
  
  const hashInput = `${userId}|${valorCentavos}|${descNorm}|${pagamento}`;
  
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    hash = ((hash << 5) - hash) + hashInput.charCodeAt(i);
    hash = hash & hash;
  }
  
  return `dedupe_${userId.slice(0, 8)}_${Math.abs(hash).toString(36)}`;
}

async function verificarDuplicacao(
  userId: string,
  dedupeHash: string,
  windowMinutes: number = 3
): Promise<{ isDuplicate: boolean; existingTx?: any; minutesAgo?: number }> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  
  // Buscar transação com mesmo hash criada recentemente
  const { data: existing } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, created_at")
    .eq("usuario_id", userId)
    .eq("idempotency_key", dedupeHash)
    .gte("created_at", windowStart)
    .eq("status", "confirmada")
    .limit(1)
    .single();
  
  if (existing) {
    const minutesAgo = Math.round((Date.now() - new Date(existing.created_at).getTime()) / 60000);
    console.log(`🔒 [DEDUPE] Hash ${dedupeHash} existe há ${minutesAgo} min`);
    return { isDuplicate: true, existingTx: existing, minutesAgo };
  }
  
  return { isDuplicate: false };
}

// ============================================================================
// 🎯 GERENCIADOR DE ACTIVE ACTIONS (MEMÓRIA DE CURTO PRAZO)
// ============================================================================

async function getActiveAction(userId: string): Promise<ActiveAction | null> {
  // Expirar actions antigas (5 min)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  await supabase
    .from("actions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection"])
    .lt("updated_at", fiveMinutesAgo);
  
  const { data: action } = await supabase
    .from("actions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!action) return null;
  
  const meta = (action.meta || {}) as Record<string, any>;
  const slots = (action.slots || {}) as Record<string, any>;
  
  return {
    id: action.id,
    user_id: action.user_id,
    type: meta.action_type || "slot_filling",
    intent: action.action_type,
    slots,
    status: action.status,
    pending_slot: meta.pending_slot || null,
    pending_selection_id: meta.pending_selection_id || null,
    origin_message_id: meta.origin_message_id || null,
    last_message_id: meta.last_message_id || null,
    created_at: action.created_at,
    updated_at: action.updated_at || action.created_at,
    expires_at: meta.expires_at || new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
}

async function createAction(
  userId: string,
  type: ActionType,
  intent: string,
  slots: Record<string, any>,
  pendingSlot?: string | null,
  messageId?: string | null,
  pendingSelectionId?: string | null
): Promise<ActiveAction> {
  const actionHash = `action_${userId.slice(0, 8)}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  
  const { data: newAction, error } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: intent,
      action_hash: actionHash,
      status: pendingSelectionId ? "pending_selection" : "collecting",
      slots,
      meta: { 
        action_type: type,
        pending_slot: pendingSlot || undefined,
        pending_selection_id: pendingSelectionId || undefined,
        origin_message_id: messageId || undefined,
        last_message_id: messageId || undefined,
        expires_at: expiresAt
      }
    })
    .select()
    .single();
  
  if (error) {
    console.error("❌ [ACTION] Erro ao criar:", error);
    throw error;
  }
  
  console.log(`✨ [ACTION] Criado: ${type} | ${intent} | Slots: ${JSON.stringify(slots)}`);
  
  return {
    id: newAction.id,
    user_id: userId,
    type,
    intent,
    slots,
    status: "collecting",
    pending_slot: pendingSlot || undefined,
    pending_selection_id: pendingSelectionId || undefined,
    origin_message_id: messageId || undefined,
    last_message_id: messageId || undefined,
    created_at: newAction.created_at,
    updated_at: newAction.created_at,
    expires_at: expiresAt
  };
}

async function updateAction(
  actionId: string,
  updates: {
    slots?: Record<string, any>;
    status?: string;
    pending_slot?: string | null;
    pending_selection_id?: string | null;
    last_message_id?: string | null;
  }
): Promise<void> {
  const { data: existing } = await supabase
    .from("actions")
    .select("meta")
    .eq("id", actionId)
    .single();
  
  const meta = { ...(existing?.meta as Record<string, any> || {}) };
  
  if (updates.pending_slot !== undefined) meta.pending_slot = updates.pending_slot;
  if (updates.pending_selection_id !== undefined) meta.pending_selection_id = updates.pending_selection_id;
  if (updates.last_message_id) meta.last_message_id = updates.last_message_id;
  
  const updateData: Record<string, any> = {
    meta,
    updated_at: new Date().toISOString()
  };
  
  if (updates.slots) updateData.slots = updates.slots;
  if (updates.status) updateData.status = updates.status;
  
  await supabase
    .from("actions")
    .update(updateData)
    .eq("id", actionId);
  
  console.log(`🔄 [ACTION] Atualizado: ${actionId.slice(-8)}`);
}

async function closeAction(actionId: string, entityId?: string): Promise<void> {
  await supabase
    .from("actions")
    .update({ 
      status: "done", 
      entity_id: entityId,
      updated_at: new Date().toISOString() 
    })
    .eq("id", actionId);
  
  console.log(`✅ [ACTION] Fechado: ${actionId.slice(-8)}`);
}

async function cancelAction(userId: string): Promise<boolean> {
  const action = await getActiveAction(userId);
  if (!action) return false;
  
  await supabase
    .from("actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", action.id);
  
  console.log(`🗑️ [ACTION] Cancelado: ${action.id.slice(-8)}`);
  return true;
}

// ============================================================================
// 📋 PENDING SELECTIONS
// ============================================================================

async function createPendingSelection(
  userId: string,
  options: Array<{ index: number; tx_id?: string; label: string; meta?: any }>,
  awaitingField: string,
  ttlMinutes: number = 2
): Promise<string> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const token = crypto.randomUUID();
  
  const { data } = await supabase.from("pending_selections").insert({
    user_id: userId,
    token,
    options,
    awaiting_field: awaitingField,
    consumed: false,
    expires_at: expiresAt.toISOString()
  }).select("id").single();
  
  console.log(`📋 [PENDING] Criado: ${awaitingField} | ${options.length} opções`);
  return data?.id || token;
}

async function getPendingSelection(
  userId: string,
  awaitingField: string
): Promise<{ id: string; options: any[] } | null> {
  const { data } = await supabase
    .from("pending_selections")
    .select("id, options")
    .eq("user_id", userId)
    .eq("awaiting_field", awaitingField)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!data) return null;
  return { id: data.id, options: data.options as any[] };
}

async function consumePendingSelection(pendingId: string): Promise<void> {
  await supabase
    .from("pending_selections")
    .update({ consumed: true })
    .eq("id", pendingId);
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

async function sendMessage(to: string, text: string, source: MessageSource): Promise<boolean> {
  if (source === "vonage") return sendWhatsAppVonage(to, text);
  return sendWhatsAppMeta(to, text);
}

async function sendButtons(
  to: string, 
  bodyText: string, 
  buttons: Array<{ id: string; title: string }>,
  source: MessageSource
): Promise<boolean> {
  if (source !== "meta") {
    const fallbackText = bodyText + "\n\n" + buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    return sendMessage(to, fallbackText, source);
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
    return sendMessage(to, bodyText, source);
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
// 🧠 INTERPRETAÇÃO IA
// ============================================================================

async function interpretarMensagem(
  mensagem: string, 
  historicoRecente: string,
  activeAction?: ActiveAction | null
): Promise<{ intent: ExtractedIntent; confianca: number }> {
  try {
    let contextoInfo = "";
    if (activeAction) {
      contextoInfo = `
⚠️ ACTIVE ACTION:
Type: ${activeAction.type}
Intent: ${activeAction.intent}
Slots: ${JSON.stringify(activeAction.slots)}
Pending slot: ${activeAction.pending_slot || "none"}

Se a mensagem parece responder ao slot pendente, extraia o valor para esse slot.
Se a mensagem é uma nova intenção clara, retorne a nova intenção.
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
            content: `Você é um analisador de intenções financeiras INTELIGENTE.

${contextoInfo}

🎯 REGRAS ABSOLUTAS (ORDEM DE PRIORIDADE):

1. 🟢 ENTRADA = "recebi", "caiu", "entrada", "ganhei", "salário", "pagamento recebido"
   - "Recebi 200" → intent="registrar_entrada", slots={amount: 200}
   - "Caiu 500 de pix" → intent="registrar_entrada", slots={amount: 500, source: "pix"}
   - NUNCA perguntar se é gasto quando verbo indica entrada!

2. 🟡 CARTÃO = "limite", "atualiza cartão", nome de banco + número
   - "Limite do nubank 6400" → intent="update_card", slots={card: "nubank", value: 6400}
   - "O limite foi atualizado para 5000" → intent="update_card", slots={value: 5000}

3. 🔴 GASTO = "gastei", "comprei", "paguei", "foi", "custou"
   - "Gastei 50 no mercado" → intent="registrar_gasto", slots={amount: 50, description: "mercado"}
   - "Comprei um café" → intent="registrar_gasto", slots={description: "café"}

4. ⚪ NÚMERO ISOLADO (SEM VERBO):
   - Se há active action pendente de amount → intent="fornecer_slot", slots={amount: X}
   - Se NÃO há active action → intent="numero_isolado", slots={amount: X}
   - NUNCA assumir gasto ou entrada sem verbo!

5. ✅ RESPOSTAS A PERGUNTAS (quando active action existe):
   - Texto simples (ex: "café", "mercado") → intent="fornecer_slot", slots={description: "café"}
   - Forma pagamento → intent="fornecer_slot", slots={payment_method: "pix"}
   - Fonte entrada (pix, dinheiro) → intent="fornecer_slot", slots={source: "pix"}

🔒 REGRA DE OURO:
Se a mensagem TEM VERBO indicando direção do dinheiro, INFIRA automaticamente:
- Verbos de ENTRADA: recebi, ganhei, caiu, entrou
- Verbos de SAÍDA: gastei, paguei, comprei, custou

📊 CATEGORIZAÇÃO (gastos):
café/pão/lanche → alimentacao
mercado/super → mercado
uber/táxi → transporte

Responda APENAS JSON:
{
  "intent": "string",
  "slots": {"amount": num, "description": "str", "payment_method": "str", "source": "str"} ou {},
  "valor": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "forma_pagamento": "pix"|"dinheiro"|"debito"|"credito" ou null,
  "confianca": 0.0-1.0,
  "itens": [{descricao, valor}] ou null,
  "acoes_detectadas": [{intent, slots}] ou null
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
// 🏷️ INFERIR CATEGORIA
// ============================================================================

function inferirCategoria(descricao: string, categoriaOriginal?: string): string {
  const desc = normalizeText(descricao);
  
  if (categoriaOriginal && categoriaOriginal !== "outros") {
    return categoriaOriginal;
  }
  
  const mapa: Record<string, string[]> = {
    alimentacao: ["cafe", "pao", "lanche", "agua", "refrigerante", "almoco", "jantar", "ifood", "rappi", "comida", "restaurante", "padaria", "pizza", "acai", "sorvete"],
    mercado: ["mercado", "supermercado", "feira", "hortifruti", "atacadao"],
    transporte: ["uber", "99", "taxi", "onibus", "gasolina", "combustivel", "estacionamento", "pedagio"],
    saude: ["farmacia", "remedio", "medico", "hospital", "consulta", "exame", "dentista"],
    lazer: ["cinema", "netflix", "spotify", "show", "festa", "bar", "jogo", "game"],
    moradia: ["aluguel", "condominio", "luz", "energia", "gas", "internet", "telefone"],
    compras: ["roupa", "sapato", "loja", "shopping", "presente", "celular"],
    servicos: ["salao", "barbearia", "manicure", "lavanderia", "faxina"]
  };
  
  for (const [categoria, palavras] of Object.entries(mapa)) {
    if (palavras.some(p => desc.includes(p))) {
      return categoria;
    }
  }
  
  return categoriaOriginal || "outros";
}

// ============================================================================
// 🔧 SLOT HELPERS
// ============================================================================

function getMissingSlots(intent: string, currentSlots: Record<string, any>): string[] {
  const requirements = SLOT_REQUIREMENTS[intent];
  if (!requirements) return [];
  
  return requirements.required.filter(slot => {
    const value = currentSlots[slot];
    return value === null || value === undefined || value === "";
  });
}

function isNumericOnly(text: string): boolean {
  const cleaned = text.replace(/[^\d.,]/g, "").replace(",", ".");
  return /^\d+([.,]\d+)?$/.test(cleaned) && parseFloat(cleaned) > 0;
}

function parseNumericValue(text: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, "").replace(",", ".");
  const value = parseFloat(cleaned);
  return isNaN(value) || value <= 0 ? null : value;
}

function normalizePaymentMethod(text: string): string | null {
  const normalized = normalizeText(text);
  return PAYMENT_ALIASES[normalized] || null;
}

// ============================================================================
// 💾 REGISTRAR TRANSAÇÃO
// ============================================================================

async function registrarTransacao(
  userId: string,
  slots: Record<string, any>,
  eventoId: string | null,
  actionId?: string
): Promise<{ sucesso: boolean; mensagem: string; transacaoId?: string; isDuplicate?: boolean }> {
  
  const valor = slots.amount;
  const descricao = slots.description || "";
  const categoria = inferirCategoria(descricao, slots.category);
  const formaPagamento = slots.payment_method;
  
  // Gerar hash para dedup
  const dedupeHash = gerarDedupeHash(userId, valor, descricao, formaPagamento);
  
  console.log(`🔐 [REGISTRO] Hash: ${dedupeHash} | Valor: ${valor} | Pag: ${formaPagamento}`);
  
  // Verificar duplicação (janela de 3 min)
  const { isDuplicate, existingTx, minutesAgo } = await verificarDuplicacao(userId, dedupeHash, 3);
  
  if (isDuplicate) {
    console.log(`🛑 [REGISTRO] Duplicado detectado`);
    
    // Criar pending selection para confirmar
    const options = [
      { index: 1, label: "Registrar outro igual", meta: { action: "register_another" } },
      { index: 2, label: "Cancelar", meta: { action: "cancel" } }
    ];
    
    await createPendingSelection(userId, options, "duplicate_confirm", 2);
    
    // Criar action para aguardar resposta
    await createAction(userId, "duplicate_confirm", "registrar_gasto", slots, null, null, null);
    
    if (actionId) await closeAction(actionId);
    
    return {
      sucesso: false,
      isDuplicate: true,
      mensagem: `⚠️ Parece duplicado!\n\nVi um gasto igual há ${minutesAgo || 1} minuto(s).\n\nFoi repetido sem querer?`
    };
  }
  
  // Criar transação
  const agora = new Date();
  
  const { data: transacao, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor: valor,
    categoria: categoria,
    tipo: "saida",
    descricao: descricao,
    observacao: descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: formaPagamento,
    status: "confirmada",
    idempotency_key: dedupeHash
  }).select("id").single();
  
  if (error) {
    console.error("❌ [REGISTRO] Erro:", error);
    return { sucesso: false, mensagem: "Algo deu errado 😕\n\nTenta de novo?" };
  }
  
  // Fechar action
  if (actionId) await closeAction(actionId, transacao.id);
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_transacao",
    entity_type: "transacao",
    entity_id: transacao.id,
    new_data: { ...slots, dedupe_hash: dedupeHash }
  });
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  console.log(`✅ [REGISTRO] Sucesso: ${transacao.id}`);
  
  return {
    sucesso: true,
    transacaoId: transacao.id,
    mensagem: `✅ *Gasto registrado!*\n\n` +
      `💸 *-R$ ${valor?.toFixed(2)}*\n` +
      `📂 ${categoria}\n` +
      (descricao ? `📝 ${descricao}\n` : "") +
      `💳 ${formaPagamento}\n` +
      `📅 ${dataFormatada} às ${horaFormatada}\n\n` +
      `_Se quiser corrigir, responda com "corrigir"._`
  };
}

// ============================================================================
// 💰 REGISTRAR ENTRADA
// ============================================================================

async function registrarEntrada(
  userId: string,
  slots: Record<string, any>,
  eventoId: string | null,
  actionId?: string
): Promise<{ sucesso: boolean; mensagem: string; transacaoId?: string }> {
  
  const valor = slots.amount;
  const descricao = slots.description || "";
  const source = slots.source || "outro";
  
  const agora = new Date();
  
  const { data: transacao, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor: valor,
    categoria: "entrada",
    tipo: "entrada",
    descricao: descricao,
    observacao: descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: source,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [ENTRADA] Erro:", error);
    return { sucesso: false, mensagem: "Algo deu errado 😕\n\nTenta de novo?" };
  }
  
  if (actionId) await closeAction(actionId, transacao.id);
  
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_entrada",
    entity_type: "transacao",
    entity_id: transacao.id,
    new_data: slots
  });
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  console.log(`✅ [ENTRADA] Sucesso: ${transacao.id}`);
  
  return {
    sucesso: true,
    transacaoId: transacao.id,
    mensagem: `✅ *Entrada registrada!*\n\n` +
      `💰 *+R$ ${valor?.toFixed(2)}*\n` +
      (descricao ? `📝 ${descricao}\n` : "") +
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

async function cancelarTransacao(userId: string, transacaoId: string): Promise<{ sucesso: boolean; mensagem: string }> {
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
    return { sucesso: false, mensagem: "Já foi cancelada 👍" };
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
      `_Se foi engano, manda de novo!_`
  };
}

async function buscarTransacaoPorReply(userId: string, replyMessageId: string): Promise<any | null> {
  // Buscar evento bruto pela message_id
  const { data: evento } = await supabase
    .from("eventos_brutos")
    .select("id")
    .eq("message_id", replyMessageId)
    .single();
  
  if (!evento) return null;
  
  // Buscar action relacionada
  const { data: action } = await supabase
    .from("actions")
    .select("entity_id")
    .eq("status", "done")
    .not("entity_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (!action || action.length === 0) return null;
  
  // Buscar transação mais recente
  for (const a of action) {
    if (a.entity_id) {
      const { data: tx } = await supabase
        .from("transacoes")
        .select("*")
        .eq("id", a.entity_id)
        .eq("usuario_id", userId)
        .single();
      
      if (tx) return tx;
    }
  }
  
  return null;
}

// ============================================================================
// 💳 CARTÕES
// ============================================================================

async function listarCartoes(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from("cartoes_credito")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true);
  
  return data || [];
}

async function encontrarCartao(userId: string, nomeCartao: string): Promise<any | null> {
  const cartoes = await listarCartoes(userId);
  
  const nomeLower = normalizeText(nomeCartao);
  
  return cartoes.find(c => 
    normalizeText(c.nome || "").includes(nomeLower) ||
    nomeLower.includes(normalizeText(c.nome || ""))
  ) || null;
}

// ============================================================================
// 🔄 PROCESSAMENTO PRINCIPAL
// ============================================================================

async function processarJob(job: any): Promise<void> {
  const payload: JobPayload = job.payload;
  const userId = job.user_id;
  const eventoId = payload.evento_id;
  
  console.log(`\n🔄 [WORKER] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📩 [WORKER] Job ${job.id?.slice(-8)} | ${payload.messageType} | User: ${userId?.slice(0, 8)}`);
  console.log(`💬 [WORKER] Msg: "${payload.messageText?.slice(0, 50)}${payload.messageText?.length > 50 ? '...' : ''}"`);
  
  try {
    // Buscar usuário
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("id", userId)
      .single();
    
    const nomeUsuario = usuario?.nome || "amigo(a)";
    
    // Verificar novo usuário
    const { count: historicoCount } = await supabase
      .from("historico_conversas")
      .select("id", { count: "exact", head: true })
      .eq("phone_number", payload.phoneNumber);
    
    // ONBOARDING
    if ((historicoCount || 0) === 0) {
      console.log(`🎉 [WORKER] Novo usuário: ${payload.phoneNumber}`);
      
      await sendMessage(
        payload.phoneNumber,
        `Oi, ${nomeUsuario.split(" ")[0]}! 👋\n\nSou o *Finax* — seu assistente financeiro.\n\nPode me mandar gastos por texto, áudio ou foto.\n\nPra começar, me conta: quanto você costuma ganhar por mês? 💰`,
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
    // 🎯 BUSCAR ACTIVE ACTION (MEMÓRIA)
    // ========================================================================
    const activeAction = await getActiveAction(userId);
    
    logDecision({
      messageId: payload.messageId,
      referencedMessageId: payload.replyToMessageId,
      activeActionId: activeAction?.id,
      activeActionType: activeAction?.type,
      decision: "checking_priority"
    });
    
    // ========================================================================
    // 📩 PRIORIDADE 1: CANCELAR VIA REPLY
    // ========================================================================
    if (payload.replyToMessageId) {
      console.log(`↩️ [REPLY] Detectado reply para: ${payload.replyToMessageId?.slice(-8)}`);
      
      const msgLower = payload.messageText.toLowerCase();
      if (msgLower.includes("cancela") || msgLower.includes("apaga") || msgLower.includes("remove")) {
        const transacao = await buscarTransacaoPorReply(userId, payload.replyToMessageId);
        
        if (transacao) {
          await sendButtons(
            payload.phoneNumber,
            `Confirmar cancelamento?\n\n💸 R$ ${transacao.valor?.toFixed(2)} - ${transacao.descricao || transacao.categoria}`,
            [
              { id: "cancel_confirm_yes", title: "✅ Sim, cancelar" },
              { id: "cancel_confirm_no", title: "❌ Não" }
            ],
            payload.messageSource
          );
          
          // Criar action para aguardar confirmação
          await createAction(userId, "cancel_selection", "cancelar_transacao", { transaction_id: transacao.id });
          return;
        }
      }
    }
    
    // ========================================================================
    // 🔘 PRIORIDADE 2: CALLBACK DE BOTÃO
    // ========================================================================
    if (payload.buttonReplyId) {
      console.log(`🔘 [BUTTON] Callback: ${payload.buttonReplyId}`);
      
      // NÚMERO ISOLADO - GASTO
      if (payload.buttonReplyId === "num_gasto") {
        if (activeAction && activeAction.intent === "numero_isolado") {
          const amount = activeAction.slots.amount;
          await closeAction(activeAction.id);
          
          // Criar nova action para gasto
          await createAction(userId, "slot_filling", "registrar_gasto", { amount }, "description");
          await sendMessage(payload.phoneNumber, "Esse valor foi gasto com o quê?", payload.messageSource);
          return;
        }
      }
      
      // NÚMERO ISOLADO - ENTRADA
      if (payload.buttonReplyId === "num_entrada") {
        if (activeAction && activeAction.intent === "numero_isolado") {
          const amount = activeAction.slots.amount;
          await closeAction(activeAction.id);
          
          // Criar nova action para entrada
          await createAction(userId, "slot_filling", "registrar_entrada", { amount }, "description");
          await sendMessage(payload.phoneNumber, "De onde veio esse dinheiro?", payload.messageSource);
          return;
        }
      }
      
      // SOURCE DE ENTRADA (Pix, Dinheiro, Transferência)
      if (payload.buttonReplyId.startsWith("src_")) {
        const source = SOURCE_ALIASES[payload.buttonReplyId];
        
        if (source && activeAction && activeAction.intent === "registrar_entrada") {
          // MERGE: preservar slots existentes, adicionar source
          const updatedSlots: Record<string, any> = { ...activeAction.slots, source };
          
          console.log(`📊 [SRC BUTTON] Slots antes: ${JSON.stringify(activeAction.slots)} | Depois: ${JSON.stringify(updatedSlots)}`);
          
          // Verificar se temos amount (obrigatório)
          if (!updatedSlots.amount) {
            await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "amount" });
            await sendMessage(payload.phoneNumber, SLOT_PROMPTS.amount_entrada.text, payload.messageSource);
            return;
          }
          
          // Temos tudo → registrar!
          const resultado = await registrarEntrada(userId, updatedSlots, eventoId, activeAction.id);
          await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          return;
        }
      }
      
      // FORMA DE PAGAMENTO
      if (payload.buttonReplyId.startsWith("pay_")) {
        const paymentMethod = PAYMENT_ALIASES[payload.buttonReplyId];
        
        if (paymentMethod && activeAction && activeAction.type === "slot_filling") {
          const updatedSlots = { ...activeAction.slots, payment_method: paymentMethod };
          
          // Se crédito e múltiplos cartões, perguntar qual
          if (paymentMethod === "credito") {
            const cartoes = await listarCartoes(userId);
            
            if (cartoes.length > 1) {
              const options = cartoes.map((c, i) => ({
                index: i + 1,
                tx_id: c.id,
                label: c.nome,
                meta: { card_id: c.id }
              }));
              
              const pendingId = await createPendingSelection(userId, options, "card_selection", 2);
              
              await updateAction(activeAction.id, {
                slots: updatedSlots,
                pending_slot: "card",
                pending_selection_id: pendingId,
                status: "pending_selection"
              });
              
              const msgCartoes = `Qual cartão?\n\n${cartoes.map((c, i) => `${i + 1}. ${c.nome}`).join("\n")}\n\n_Responde com o número_`;
              await sendMessage(payload.phoneNumber, msgCartoes, payload.messageSource);
              return;
            } else if (cartoes.length === 1) {
              // Apenas 1 cartão: associar automaticamente
              updatedSlots.card = cartoes[0].id;
            }
          }
          
          const missing = getMissingSlots(activeAction.intent, updatedSlots);
          
          if (missing.length === 0) {
            const resultado = await registrarTransacao(userId, updatedSlots, eventoId, activeAction.id);
            await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
            
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: `[BOTÃO ${paymentMethod.toUpperCase()}]`,
              ai_response: resultado.mensagem,
              tipo: resultado.isDuplicate ? "duplicado" : "registro"
            });
            return;
          }
          
          // Ainda faltam slots
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
          
          const prompt = SLOT_PROMPTS[missing[0]];
          if (prompt.useButtons && prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt.text, payload.messageSource);
          }
          return;
        }
      }
      
      // CONFIRMAR CANCELAMENTO
      if (payload.buttonReplyId === "cancel_confirm_yes") {
        if (activeAction && activeAction.type === "cancel_selection") {
          const txId = activeAction.slots.transaction_id;
          const resultado = await cancelarTransacao(userId, txId);
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          return;
        }
      }
      
      if (payload.buttonReplyId === "cancel_confirm_no") {
        if (activeAction) {
          await closeAction(activeAction.id);
        }
        await sendMessage(payload.phoneNumber, "Ok, mantido! 👍", payload.messageSource);
        return;
      }
      
      // BATCH SEPARADO
      if (payload.buttonReplyId === "batch_separate") {
        const pending = await getPendingSelection(userId, "batch_expense");
        
        if (pending) {
          await consumePendingSelection(pending.id);
          
          const resultados: string[] = [];
          for (const opt of pending.options) {
            const meta = opt.meta as { valor: number; descricao: string; categoria?: string };
            
            // Cada item precisa de payment_method - criar action para o primeiro
            if (resultados.length === 0) {
              await createAction(userId, "slot_filling", "registrar_gasto", {
                amount: meta.valor,
                description: meta.descricao,
                category: inferirCategoria(meta.descricao, meta.categoria),
                batch_remaining: pending.options.slice(1)
              }, "payment_method");
              
              await sendButtons(
                payload.phoneNumber,
                `Primeiro: R$ ${meta.valor.toFixed(2)} - ${meta.descricao}\n\nComo pagou?`,
                SLOT_PROMPTS.payment_method.buttons!,
                payload.messageSource
              );
              return;
            }
          }
        }
        return;
      }
      
      // BATCH ÚNICO
      if (payload.buttonReplyId === "batch_single") {
        const pending = await getPendingSelection(userId, "batch_expense");
        
        if (pending) {
          await consumePendingSelection(pending.id);
          
          const somaTotal = pending.options.reduce((sum, o) => sum + (o.meta?.valor || 0), 0);
          const descricoes = pending.options.map(o => o.meta?.descricao).filter(Boolean).join(" + ");
          
          await createAction(userId, "slot_filling", "registrar_gasto", {
            amount: somaTotal,
            description: descricoes,
            category: "outros"
          }, "payment_method");
          
          await sendButtons(
            payload.phoneNumber,
            `Total: R$ ${somaTotal.toFixed(2)}\n\nComo pagou?`,
            SLOT_PROMPTS.payment_method.buttons!,
            payload.messageSource
          );
          return;
        }
      }
      
      // DUPLICADO - REGISTRAR OUTRO
      if (payload.buttonReplyId === "dup_register") {
        if (activeAction && activeAction.type === "duplicate_confirm") {
          // Forçar registro
          const dedupeHash = `forced_${userId.slice(0, 8)}_${Date.now()}`;
          
          const agora = new Date();
          const slots = activeAction.slots;
          
          const { data: transacao, error } = await supabase.from("transacoes").insert({
            usuario_id: userId,
            valor: slots.amount,
            categoria: inferirCategoria(slots.description, slots.category),
            tipo: "saida",
            descricao: slots.description,
            data: agora.toISOString(),
            origem: "whatsapp",
            forma_pagamento: slots.payment_method,
            status: "confirmada",
            idempotency_key: dedupeHash
          }).select("id").single();
          
          if (!error && transacao) {
            await closeAction(activeAction.id, transacao.id);
            
            await sendMessage(
              payload.phoneNumber,
              `✅ *Outro gasto registrado!*\n\n💸 *-R$ ${slots.amount?.toFixed(2)}*\n📂 ${inferirCategoria(slots.description, slots.category)}\n💳 ${slots.payment_method}`,
              payload.messageSource
            );
          }
          return;
        }
      }
      
      // DUPLICADO - CANCELAR
      if (payload.buttonReplyId === "dup_cancel") {
        if (activeAction) {
          await closeAction(activeAction.id);
        }
        await sendMessage(payload.phoneNumber, "Ok, descartado! 👍", payload.messageSource);
        return;
      }
    }
    
    // ========================================================================
    // 📋 PRIORIDADE 3: PENDING SELECTION (SELEÇÃO NUMÉRICA)
    // ========================================================================
    if (activeAction && activeAction.type === "cancel_selection") {
      const pending = await getPendingSelection(userId, "cancel_transaction");
      
      if (pending && isNumericOnly(payload.messageText)) {
        const index = parseInt(payload.messageText.trim());
        const option = pending.options.find(o => o.index === index);
        
        if (option && option.tx_id) {
          await consumePendingSelection(pending.id);
          
          const resultado = await cancelarTransacao(userId, option.tx_id);
          await closeAction(activeAction.id);
          
          await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          
          logDecision({
            messageId: payload.messageId,
            activeActionId: activeAction.id,
            activeActionType: "cancel_selection",
            decision: "cancel_by_number",
            details: { selected_index: index, tx_id: option.tx_id }
          });
          return;
        }
        
        await sendMessage(payload.phoneNumber, `Número inválido. Escolha entre 1 e ${pending.options.length}.`, payload.messageSource);
        return;
      }
    }
    
    // Card selection
    if (activeAction && activeAction.pending_slot === "card") {
      const pending = await getPendingSelection(userId, "card_selection");
      
      if (pending && isNumericOnly(payload.messageText)) {
        const index = parseInt(payload.messageText.trim());
        const option = pending.options.find(o => o.index === index);
        
        if (option && option.meta?.card_id) {
          await consumePendingSelection(pending.id);
          
          const updatedSlots = { ...activeAction.slots, card: option.meta.card_id };
          const missing = getMissingSlots(activeAction.intent, updatedSlots);
          
          if (missing.length === 0) {
            const resultado = await registrarTransacao(userId, updatedSlots, eventoId, activeAction.id);
            await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
            return;
          }
          
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
          const prompt = SLOT_PROMPTS[missing[0]];
          await sendMessage(payload.phoneNumber, prompt.text, payload.messageSource);
          return;
        }
      }
    }
    
    // ========================================================================
    // 📷 PROCESSAR MÍDIA
    // ========================================================================
    let conteudoProcessado = payload.messageText;
    
    if (payload.messageType === "audio" && payload.mediaId) {
      const audioBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!audioBase64) {
        await sendMessage(payload.phoneNumber, "Não peguei o áudio 🎤\n\n👉 Pode escrever?", payload.messageSource);
        return;
      }
      
      const transcricao = await transcreverAudio(audioBase64);
      
      if (!transcricao.texto) {
        await sendMessage(payload.phoneNumber, "Não entendi o áudio 🎤\n\n👉 Pode escrever?", payload.messageSource);
        return;
      }
      
      conteudoProcessado = transcricao.texto;
    }
    
    if (payload.messageType === "image" && payload.mediaId) {
      const imageBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!imageBase64) {
        await sendMessage(payload.phoneNumber, "Não baixei a imagem 📷\n\n👉 Tenta de novo?", payload.messageSource);
        return;
      }
      
      const analise = await analisarImagem(imageBase64, payload.mediaMimeType, eventoId, payload.messageId);
      
      if (!analise.dados || analise.dados.intent === "outro") {
        await sendMessage(payload.phoneNumber, "Vi a imagem 📷\n\n👉 Me conta: *quanto foi* e *o que era*?", payload.messageSource);
        return;
      }
      
      // Criar action para confirmar
      await createAction(userId, "slot_filling", "registrar_gasto", {
        amount: analise.dados.valor,
        description: analise.dados.descricao,
        category: analise.dados.categoria,
        payment_method: analise.dados.forma_pagamento
      });
      
      await sendButtons(
        payload.phoneNumber,
        `Entendi assim 👇\n\n💸 R$ ${analise.dados.valor?.toFixed(2)}\n${analise.dados.descricao ? `📝 ${analise.dados.descricao}` : ""}\n\nPosso registrar?`,
        [
          { id: "confirm_yes", title: "✅ Sim" },
          { id: "confirm_no", title: "❌ Não" }
        ],
        payload.messageSource
      );
      return;
    }
    
    // ========================================================================
    // 🔢 PRIORIDADE 4: NÚMERO ISOLADO
    // ========================================================================
    if (isNumericOnly(conteudoProcessado)) {
      const numValue = parseNumericValue(conteudoProcessado);
      
      logDecision({
        messageId: payload.messageId,
        activeActionId: activeAction?.id,
        activeActionType: activeAction?.type,
        decision: "numeric_routing",
        details: { value: numValue, pending_slot: activeAction?.pending_slot }
      });
      
      // Se há action ativa de slot_filling esperando amount OU valor não preenchido
      if (activeAction && activeAction.type === "slot_filling" && 
          (activeAction.pending_slot === "amount" || !activeAction.slots.amount)) {
        
        const updatedSlots = { ...activeAction.slots, amount: numValue };
        const missing = getMissingSlots(activeAction.intent, updatedSlots);
        
        if (missing.length === 0) {
          // Verificar se é gasto ou entrada
          if (activeAction.intent === "registrar_entrada") {
            const resultado = await registrarEntrada(userId, updatedSlots, eventoId, activeAction.id);
            await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          } else {
            const resultado = await registrarTransacao(userId, updatedSlots, eventoId, activeAction.id);
            await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          }
          return;
        }
        
        await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
        
        // Usar prompt específico para entrada ou gasto
        const promptKey = activeAction.intent === "registrar_entrada" && missing[0] === "description" 
          ? "description_entrada" 
          : missing[0];
        const prompt = SLOT_PROMPTS[promptKey] || SLOT_PROMPTS[missing[0]];
        
        if (prompt?.useButtons && prompt.buttons) {
          await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
        }
        return;
      }
      
      // Número sem contexto → PERGUNTAR SE É GASTO OU ENTRADA (NÃO ASSUMIR!)
      await sendButtons(
        payload.phoneNumber,
        `💰 R$ ${numValue?.toFixed(2)}\n\nEsse valor foi um gasto ou uma entrada?`,
        [
          { id: "num_gasto", title: "💸 Gasto" },
          { id: "num_entrada", title: "💰 Entrada" }
        ],
        payload.messageSource
      );
      
      // Criar action aguardando escolha
      await createAction(userId, "slot_filling", "numero_isolado", { amount: numValue }, "type_choice");
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: "Esse valor foi um gasto ou uma entrada?",
        tipo: "slot_filling"
      });
      return;
    }
    
    // ========================================================================
    // 🎯 DETECÇÃO DE DOMÍNIO (ANTES DA IA) - Auto-descarte de contexto
    // ========================================================================
    const detectedDomain = detectDomainFromText(conteudoProcessado);
    
    if (detectedDomain) {
      console.log(`🎯 [DOMAIN] Detectado: ${detectedDomain} por keywords`);
      
      // Se há contexto ativo de domínio diferente, descartar automaticamente
      if (shouldAutoDiscardContext(activeAction, detectedDomain)) {
        console.log(`🗑️ [CONTEXT] Auto-descartando contexto de ${activeAction?.intent} → ${detectedDomain}`);
        await cancelAction(userId);
        // Não podemos reatribuir const, mas cancelAction já limpa no banco
      }
    }
    
    // ========================================================================
    // 🧠 INTERPRETAÇÃO IA
    // ========================================================================
    const { data: historico } = await supabase
      .from("historico_conversas")
      .select("user_message, ai_response")
      .eq("phone_number", payload.phoneNumber)
      .order("created_at", { ascending: false })
      .limit(3);
    
    const historicoFormatado = historico?.map(h => 
      `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 80)}...`
    ).reverse().join("\n") || "";
    
    const { intent: interpretacao, confianca } = await interpretarMensagem(
      conteudoProcessado, 
      historicoFormatado,
      activeAction
    );
    
    logDecision({
      messageId: payload.messageId,
      activeActionId: activeAction?.id,
      decision: "ai_interpretation",
      details: { intent: interpretacao.intent, confianca }
    });
    
    // ========================================================================
    // 🚫 NEGAR / CANCELAR
    // ========================================================================
    if (interpretacao.intent === "negar") {
      const cancelled = await cancelAction(userId);
      
      await sendMessage(
        payload.phoneNumber, 
        cancelled ? "Ok, descartei! 👍\n\nO que você gostaria de fazer?" : "Não tinha nada pendente 🤔\n\nComo posso ajudar?",
        payload.messageSource
      );
      return;
    }
    
    // ========================================================================
    // 📦 MÚLTIPLOS ITENS
    // ========================================================================
    if (interpretacao.itens && interpretacao.itens.length > 1) {
      const total = interpretacao.itens.reduce((sum, i) => sum + i.valor, 0);
      
      const options = interpretacao.itens.map((item, i) => ({
        index: i + 1,
        label: `R$ ${item.valor.toFixed(2)} - ${item.descricao}`,
        meta: { valor: item.valor, descricao: item.descricao, categoria: item.categoria }
      }));
      
      await createPendingSelection(userId, options, "batch_expense", 3);
      
      const listaItens = interpretacao.itens
        .map((item, i) => `${i + 1}) ${item.descricao} — R$ ${item.valor.toFixed(2)}`)
        .join("\n");
      
      await sendButtons(
        payload.phoneNumber,
        `Identifiquei ${interpretacao.itens.length} itens:\n\n${listaItens}\n\nComo prefere registrar?`,
        [
          { id: "batch_separate", title: "📋 Separado" },
          { id: "batch_single", title: `💰 Único (R$ ${total.toFixed(2)})` }
        ],
        payload.messageSource
      );
      return;
    }
    
    // ========================================================================
    // 💸 REGISTRAR GASTO / FORNECER SLOT
    // ========================================================================
    if (interpretacao.intent === "registrar_gasto" || interpretacao.intent === "fornecer_slot") {
      
      let slots: Record<string, any> = interpretacao.slots || {};
      
      // Pegar valores do nível superior
      if (interpretacao.valor) slots.amount = interpretacao.valor;
      if (interpretacao.descricao) slots.description = interpretacao.descricao;
      if (interpretacao.categoria) slots.category = interpretacao.categoria;
      if (interpretacao.forma_pagamento) slots.payment_method = interpretacao.forma_pagamento;
      
      // Se há action ativa, fazer merge
      if (activeAction && activeAction.type === "slot_filling" && activeAction.intent === "registrar_gasto") {
        slots = { ...activeAction.slots, ...slots };
        
        // Se esperando description e recebeu texto
        if (activeAction.pending_slot === "description" && !slots.description) {
          slots.description = conteudoProcessado;
        }
        
        // Se esperando payment_method e texto tem forma de pagamento
        if (activeAction.pending_slot === "payment_method") {
          const pm = normalizePaymentMethod(conteudoProcessado);
          if (pm) slots.payment_method = pm;
        }
      }
      
      // Verificar slots faltantes
      const missing = getMissingSlots("registrar_gasto", slots);
      
      console.log(`📊 [SLOTS] Atuais: ${JSON.stringify(slots)} | Faltando: ${missing.join(", ")}`);
      
      if (missing.length === 0) {
        // Tudo completo → registrar
        const actionId = activeAction?.type === "slot_filling" ? activeAction.id : undefined;
        const resultado = await registrarTransacao(userId, slots, eventoId, actionId);
        
        // Se duplicado, mostra botões
        if (resultado.isDuplicate) {
          await sendButtons(
            payload.phoneNumber,
            resultado.mensagem,
            [
              { id: "dup_register", title: "📋 Registrar outro" },
              { id: "dup_cancel", title: "❌ Cancelar" }
            ],
            payload.messageSource
          );
        } else {
          await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        }
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: conteudoProcessado,
          ai_response: resultado.mensagem,
          tipo: resultado.isDuplicate ? "duplicado" : "registro"
        });
        return;
      }
      
      // Faltam slots → criar/atualizar action e perguntar
      const nextSlot = missing[0];
      
      if (activeAction && activeAction.type === "slot_filling") {
        await updateAction(activeAction.id, { slots, pending_slot: nextSlot });
      } else {
        await createAction(userId, "slot_filling", "registrar_gasto", slots, nextSlot, payload.messageId);
      }
      
      const prompt = SLOT_PROMPTS[nextSlot];
      
      if (prompt.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, prompt.text, payload.messageSource);
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
    // 💰 REGISTRAR ENTRADA
    // ========================================================================
    if (interpretacao.intent === "registrar_entrada") {
      let slots: Record<string, any> = {};
      
      // Primeiro: pegar slots do nível superior da interpretação (IA já extraiu)
      if (interpretacao.valor) slots.amount = interpretacao.valor;
      if (interpretacao.descricao) slots.description = interpretacao.descricao;
      if (interpretacao.slots?.amount) slots.amount = interpretacao.slots.amount;
      if (interpretacao.slots?.source) slots.source = interpretacao.slots.source;
      if (interpretacao.slots?.description) slots.description = interpretacao.slots.description;
      
      // Depois: fazer merge com action ativa (se existir) - NÃO sobrescrever slots já preenchidos
      if (activeAction && activeAction.intent === "registrar_entrada") {
        // Merge: slots novos têm prioridade, mas não apagam slots existentes
        slots = { 
          ...activeAction.slots, // slots existentes
          ...Object.fromEntries(Object.entries(slots).filter(([_, v]) => v != null)) // novos não-nulos
        };
        
        // Se estava esperando description e recebeu texto livre
        if (activeAction.pending_slot === "description" && !slots.description && conteudoProcessado) {
          slots.description = conteudoProcessado;
        }
        
        // Se estava esperando source e recebeu texto
        if (activeAction.pending_slot === "source") {
          const sourceNorm = SOURCE_ALIASES[normalizeText(conteudoProcessado)];
          if (sourceNorm) slots.source = sourceNorm;
        }
      }
      
      console.log(`📊 [ENTRADA SLOTS] ${JSON.stringify(slots)}`);
      
      // Verificar se amount está presente (OBRIGATÓRIO)
      if (!slots.amount) {
        // Não temos valor → perguntar
        if (activeAction && activeAction.intent === "registrar_entrada") {
          await updateAction(activeAction.id, { pending_slot: "amount" });
        } else {
          await createAction(userId, "slot_filling", "registrar_entrada", slots, "amount", payload.messageId);
        }
        await sendMessage(payload.phoneNumber, SLOT_PROMPTS.amount_entrada.text, payload.messageSource);
        return;
      }
      
      // Temos amount! Perguntar source se não tiver (OPCIONAL mas perguntamos uma vez)
      if (!slots.source) {
        if (activeAction && activeAction.intent === "registrar_entrada") {
          await updateAction(activeAction.id, { slots, pending_slot: "source" });
        } else {
          await createAction(userId, "slot_filling", "registrar_entrada", slots, "source", payload.messageId);
        }
        
        await sendButtons(
          payload.phoneNumber, 
          `💰 R$ ${slots.amount?.toFixed(2)}\n\nComo você recebeu?`,
          SLOT_PROMPTS.source.buttons!,
          payload.messageSource
        );
        return;
      }
      
      // Temos tudo → registrar!
      const actionId = activeAction?.intent === "registrar_entrada" ? activeAction.id : undefined;
      const resultado = await registrarEntrada(userId, slots, eventoId, actionId);
      await sendMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
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
        .select("valor, tipo")
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
      
      const resposta = !transacoes || transacoes.length === 0
        ? "Você ainda não tem transações este mês 📊\n\nManda um gasto!"
        : `📊 *Resumo do Mês*\n\n💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
      
      await sendMessage(payload.phoneNumber, resposta, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🗑️ CANCELAR TRANSAÇÃO
    // ========================================================================
    if (interpretacao.intent === "cancelar_transacao") {
      const transacoes = await listarTransacoesParaCancelar(userId);
      
      if (transacoes.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem transações para cancelar 🤔", payload.messageSource);
        return;
      }
      
      const lista = transacoes.map((t, i) => ({
        index: i + 1,
        tx_id: t.id,
        label: `R$ ${t.valor?.toFixed(2)} - ${t.descricao || t.categoria}`,
        meta: { tx_id: t.id }
      }));
      
      const pendingId = await createPendingSelection(userId, lista, "cancel_transaction", 2);
      
      await createAction(userId, "cancel_selection", "cancelar_transacao", {}, null, payload.messageId, pendingId);
      
      const msgLista = `Qual transação cancelar?\n\n${lista.map(l => `${l.index}. ${l.label}`).join("\n")}\n\n_Responde com o número_`;
      
      await sendMessage(payload.phoneNumber, msgLista, payload.messageSource);
      
      logDecision({
        messageId: payload.messageId,
        decision: "show_cancel_list",
        details: { count: lista.length }
      });
      return;
    }
    
    // ========================================================================
    // 💳 CARTÕES
    // ========================================================================
    if (interpretacao.intent === "view_cards") {
      const cartoes = await listarCartoes(userId);
      
      if (cartoes.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem cartões cadastrados 💳\n\nPra adicionar: \"Adicionar cartão Nubank limite 5000\"", payload.messageSource);
        return;
      }
      
      const lista = cartoes.map(c => 
        `💳 *${c.nome}*\n   Limite: R$ ${c.limite_total?.toFixed(2) || "não informado"}\n   Venc: dia ${c.dia_vencimento || "?"}`
      ).join("\n\n");
      
      await sendMessage(payload.phoneNumber, `Seus cartões:\n\n${lista}`, payload.messageSource);
      return;
    }
    
    if (interpretacao.intent === "update_card") {
      const slots = interpretacao.slots || {};
      
      // Tentar encontrar o cartão
      if (slots.card) {
        const cartao = await encontrarCartao(userId, slots.card);
        
        if (cartao && slots.value) {
          // Atualizar limite diretamente
          await supabase
            .from("cartoes_credito")
            .update({ limite_total: slots.value, limite_disponivel: slots.value })
            .eq("id", cartao.id);
          
          await sendMessage(
            payload.phoneNumber,
            `✅ Limite do *${cartao.nome}* atualizado para R$ ${slots.value.toFixed(2)}`,
            payload.messageSource
          );
          return;
        }
      }
      
      // Listar cartões para escolher
      const cartoes = await listarCartoes(userId);
      
      if (cartoes.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem cartões cadastrados 💳", payload.messageSource);
        return;
      }
      
      const options = cartoes.map((c, i) => ({
        index: i + 1,
        tx_id: c.id,
        label: c.nome,
        meta: { card_id: c.id }
      }));
      
      await createPendingSelection(userId, options, "card_update_selection", 2);
      await createAction(userId, "card_update", "update_card", slots || {}, "card", payload.messageId);
      
      const msgCartoes = `Qual cartão atualizar?\n\n${cartoes.map((c, i) => `${i + 1}. ${c.nome}`).join("\n")}`;
      await sendMessage(payload.phoneNumber, msgCartoes, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 👋 SAUDAÇÃO
    // ========================================================================
    if (interpretacao.intent === "saudacao") {
      const primeiroNome = nomeUsuario.split(" ")[0];
      await sendMessage(payload.phoneNumber, `Oi, ${primeiroNome}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // ❓ AJUDA
    // ========================================================================
    if (interpretacao.intent === "ajuda") {
      await sendMessage(
        payload.phoneNumber,
        `*Como usar o Finax* 📊\n\n` +
        `💸 *Registrar gasto:*\n"Gastei 50 no mercado"\n"Café 8 reais pix"\n\n` +
        `📊 *Ver resumo:*\n"Quanto gastei?"\n"Resumo"\n\n` +
        `🗑️ *Cancelar:*\n"Cancela" ou responda uma mensagem antiga\n\n` +
        `💳 *Cartões:*\n"Ver cartões"\n"Atualiza limite Nubank 5000"`,
        payload.messageSource
      );
      return;
    }
    
    // ========================================================================
    // 🔄 RESPOSTA GENÉRICA (COM CONTEXTO ATIVO)
    // ========================================================================
    if (activeAction && activeAction.type === "slot_filling") {
      // Re-perguntar o slot pendente
      const pendingSlot = activeAction.pending_slot || getMissingSlots(activeAction.intent, activeAction.slots)[0];
      
      if (pendingSlot) {
        const prompt = SLOT_PROMPTS[pendingSlot];
        
        if (prompt.useButtons && prompt.buttons) {
          await sendButtons(payload.phoneNumber, `Não entendi 🤔\n\n${prompt.text}`, prompt.buttons, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, `Não entendi 🤔\n\n${prompt.text}`, payload.messageSource);
        }
        return;
      }
    }
    
    // ========================================================================
    // ❓ RESPOSTA GENÉRICA FINAL
    // ========================================================================
    await sendMessage(
      payload.phoneNumber,
      `Não entendi 🤔\n\nPode me dizer:\n• Um gasto (ex: "café 8 reais pix")\n• "Resumo" pra ver seus gastos\n• "Cancelar" pra desfazer algo`,
      payload.messageSource
    );
    
  } catch (error) {
    console.error("❌ [WORKER] Erro:", error);
    
    await sendMessage(
      payload.phoneNumber,
      "Ops, algo deu errado 😕\n\nTenta de novo?",
      payload.messageSource
    );
  }
}

// ============================================================================
// 🚀 SERVE
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Buscar jobs pendentes
    const { data: jobs, error } = await supabase
      .from("webhook_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) {
      console.error("Erro ao buscar jobs:", error);
      return new Response(JSON.stringify({ error: "Erro interno" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`📋 [WORKER] ${jobs.length} job(s) para processar`);

    // Marcar como processando
    const jobIds = jobs.map(j => j.id);
    await supabase
      .from("webhook_jobs")
      .update({ status: "processing" })
      .in("id", jobIds);

    // Processar cada job
    for (const job of jobs) {
      try {
        await processarJob(job);
        
        await supabase
          .from("webhook_jobs")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("id", job.id);
          
      } catch (jobError) {
        console.error(`❌ [JOB ${job.id}] Erro:`, jobError);
        
        await supabase
          .from("webhook_jobs")
          .update({ 
            status: "error", 
            last_error: String(jobError),
            attempts: (job.attempts || 0) + 1 
          })
          .eq("id", job.id);
      }
    }

    return new Response(JSON.stringify({ processed: jobs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Erro geral:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
