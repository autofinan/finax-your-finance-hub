import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// 🏭 FINAX WORKER v5.0 - ARQUITETURA MODULAR COM DECISION ENGINE
// ============================================================================
//
// ARQUITETURA:
// 1. DECISION ENGINE: Classifica intenção ANTES de qualquer ação
// 2. CONTEXT MANAGER: Gerencia memória de curto prazo (actions)
// 3. INTENT HANDLERS: Módulos isolados por domínio (expense, income, card, cancel)
// 4. UI MESSAGES: Envio padronizado de mensagens
//
// REGRAS DE OURO:
// - IA decide intenção, regras validam, fluxos executam
// - Slot filling NUNCA decide intenção
// - Contexto ativo é descartado automaticamente ao mudar domínio
// - Nunca perguntar algo que foi dito explicitamente
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
// 📦 TIPOS (inline para edge function)
// ============================================================================

type MessageSource = "meta" | "vonage";
type TipoMidia = "text" | "audio" | "image";
type ActionType = "expense" | "income" | "card_event" | "cancel" | "query" | "control" | "unknown";

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

interface ExtractedSlots {
  amount?: number;
  description?: string;
  category?: string;
  payment_method?: string;
  source?: string;
  card?: string;
  value?: number;
  installments?: number;
  recurrence_type?: string;
  transaction_id?: string;
  [key: string]: any;
}

interface DecisionOutput {
  actionType: ActionType;
  confidence: number;
  reasoning: string;
  slots: ExtractedSlots;
  missingSlots: string[];
  shouldExecute: boolean;
  shouldAsk: boolean;
  question: string | null;
  buttons: Array<{ id: string; title: string }> | null;
}

interface ActiveAction {
  id: string;
  user_id: string;
  type: string;
  intent: string;
  slots: Record<string, any>;
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
// 🎰 CONSTANTS
// ============================================================================

const SLOT_REQUIREMENTS: Record<string, { required: string[]; optional: string[] }> = {
  expense: { required: ["amount", "payment_method"], optional: ["description", "category", "card"] },
  income: { required: ["amount"], optional: ["description", "source"] },
  card_event: { required: ["card", "value"], optional: ["field"] },
  cancel: { required: ["transaction_id"], optional: [] },
};

const SLOT_PROMPTS: Record<string, { text: string; useButtons?: boolean; buttons?: Array<{ id: string; title: string }> }> = {
  amount: { text: "Qual foi o valor? 💸" },
  amount_income: { text: "Qual foi o valor que entrou? 💰" },
  description: { text: "O que foi essa compra?" },
  description_income: { text: "De onde veio esse dinheiro?" },
  source: { 
    text: "Como você recebeu?", 
    useButtons: true, 
    buttons: [
      { id: "src_pix", title: "📱 Pix" },
      { id: "src_dinheiro", title: "💵 Dinheiro" },
      { id: "src_transf", title: "🏦 Transferência" }
    ]
  },
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
// 🔧 UTILITIES
// ============================================================================

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
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

function logDecision(data: { messageId: string; decision: string; details?: any }) {
  console.log(`📊 [DECISION] ${JSON.stringify({ msg_id: data.messageId?.slice(-8), decision: data.decision, ...data.details })}`);
}

// ============================================================================
// 🧠 DECISION ENGINE - CLASSIFICAÇÃO SEMÂNTICA
// ============================================================================

function classifySemanticIntent(message: string): { actionType: ActionType; confidence: number; slots: ExtractedSlots } | null {
  const normalized = normalizeText(message);
  
  // 🟢 ENTRADA - Prioridade ALTA
  const incomePatterns = ["recebi", "recebimento", "entrada", "ganhei", "caiu", "pix recebido", "salario", "salário", "pagamento recebido"];
  if (incomePatterns.some(p => normalized.includes(p))) {
    const amount = extractAmount(message);
    const source = extractSource(normalized);
    return { actionType: "income", confidence: 0.95, slots: { amount, source } };
  }
  
  // 🟡 CARTÃO - Prioridade ALTA  
  const cardPatterns = ["limite", "atualiza cartao", "atualiza cartão", "atualizar limite"];
  if (cardPatterns.some(p => normalized.includes(p))) {
    const amount = extractAmount(message);
    const card = extractCardName(normalized);
    return { actionType: "card_event", confidence: 0.9, slots: { value: amount, card } };
  }
  
  // 🔴 GASTO - Padrões claros
  const expensePatterns = ["gastei", "comprei", "paguei", "custou", "foi"];
  if (expensePatterns.some(p => normalized.includes(p))) {
    const amount = extractAmount(message);
    const paymentMethod = extractPaymentMethod(normalized);
    const description = extractDescription(message);
    return { actionType: "expense", confidence: 0.9, slots: { amount, payment_method: paymentMethod, description } };
  }
  
  // 🗑️ CANCELAR
  const cancelPatterns = ["cancela", "cancelar", "desfaz", "desfazer", "remove", "apaga"];
  if (cancelPatterns.some(p => normalized.includes(p))) {
    return { actionType: "cancel", confidence: 0.9, slots: {} };
  }
  
  // 📊 CONSULTA
  const queryPatterns = ["quanto gastei", "resumo", "saldo", "extrato", "quanto tenho"];
  if (queryPatterns.some(p => normalized.includes(p))) {
    return { actionType: "query", confidence: 0.9, slots: {} };
  }
  
  return null; // Não classificado por keywords
}

function extractAmount(text: string): number | undefined {
  const patterns = [
    /r\$\s*([\d.,]+)/i,
    /([\d.,]+)\s*(?:reais|real)/i,
    /(?:gastei|recebi|paguei|comprei|custou|foi|caiu|entrada de|limite)\s*([\d.,]+)/i,
    /([\d.,]+)/
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1].replace(",", "."));
      if (!isNaN(value) && value > 0) return value;
    }
  }
  return undefined;
}

function extractPaymentMethod(text: string): string | undefined {
  const normalized = normalizeText(text);
  if (normalized.includes("pix")) return "pix";
  if (normalized.includes("debito") || normalized.includes("débito")) return "debito";
  if (normalized.includes("credito") || normalized.includes("crédito") || normalized.includes("cartao")) return "credito";
  if (normalized.includes("dinheiro") || normalized.includes("cash")) return "dinheiro";
  return undefined;
}

function extractSource(text: string): string | undefined {
  if (text.includes("pix")) return "pix";
  if (text.includes("dinheiro")) return "dinheiro";
  if (text.includes("transferencia") || text.includes("transf")) return "transferencia";
  return undefined;
}

function extractCardName(text: string): string | undefined {
  const banks = ["nubank", "itau", "itaú", "bradesco", "santander", "c6", "inter", "picpay", "next", "original"];
  for (const bank of banks) {
    if (text.includes(bank)) return bank;
  }
  return undefined;
}

function extractDescription(text: string): string | undefined {
  // Remove patterns conhecidos para extrair descrição
  const cleaned = text
    .replace(/gastei|comprei|paguei|r\$|reais|real|no|na|em|com|de|pix|débito|crédito|cartão|dinheiro/gi, "")
    .replace(/[\d.,]+/g, "")
    .trim();
  
  return cleaned.length > 2 ? cleaned : undefined;
}

async function callAIForDecision(
  message: string, 
  context: { hasActiveAction: boolean; activeActionType?: string; activeActionSlots?: Record<string, any>; pendingSlot?: string | null },
  history?: string
): Promise<DecisionOutput> {
  try {
    let contextInfo = "";
    if (context.hasActiveAction) {
      contextInfo = `
CONTEXTO ATIVO:
- Tipo: ${context.activeActionType}
- Slots preenchidos: ${JSON.stringify(context.activeActionSlots)}
- Slot pendente: ${context.pendingSlot || "nenhum"}

Se a mensagem responde ao slot pendente, extraia o valor.
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
            content: `Você é o motor de decisão do Finax, um assistente financeiro inteligente.

${contextInfo}

🎯 SUA TAREFA:
Classifique a mensagem do usuário e extraia informações.

📋 TIPOS DE AÇÃO (escolha UM):
- expense: gasto/compra/pagamento
- income: entrada/recebimento de dinheiro
- card_event: atualização de cartão/limite
- cancel: cancelar transação
- query: consulta/resumo
- control: saudação, ajuda, negação
- unknown: não identificado

🔒 REGRAS ABSOLUTAS:
1. "Recebi X" ou "Caiu X" = SEMPRE income (NUNCA expense)
2. "Limite" + banco/valor = SEMPRE card_event (NUNCA expense)  
3. "Gastei/Comprei/Paguei X" = expense
4. Número isolado SEM verbo e SEM contexto = unknown (perguntar)
5. Se há contexto ativo de income e recebe valor → preencher slot de income

Responda APENAS JSON:
{
  "actionType": "expense|income|card_event|cancel|query|control|unknown",
  "confidence": 0.0-1.0,
  "reasoning": "explicação curta",
  "slots": {"amount": num, "description": "str", "payment_method": "str", "source": "str"},
  "shouldExecute": true/false,
  "shouldAsk": true/false,
  "question": "pergunta se shouldAsk=true",
  "buttons": [{"id": "x", "title": "Y"}] ou null
}

${history ? `HISTÓRICO:\n${history}` : ""}`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"actionType": "unknown", "confidence": 0.3}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    console.log(`🧠 [AI DECISION] ${parsed.actionType} | Conf: ${parsed.confidence} | ${parsed.reasoning}`);
    
    return {
      actionType: parsed.actionType || "unknown",
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning || "",
      slots: parsed.slots || {},
      missingSlots: [],
      shouldExecute: parsed.shouldExecute || false,
      shouldAsk: parsed.shouldAsk || false,
      question: parsed.question || null,
      buttons: parsed.buttons || null
    };
  } catch (error) {
    console.error("❌ [AI DECISION] Erro:", error);
    return {
      actionType: "unknown",
      confidence: 0.3,
      reasoning: "Erro na IA",
      slots: {},
      missingSlots: [],
      shouldExecute: false,
      shouldAsk: true,
      question: "Não entendi. Pode reformular?",
      buttons: null
    };
  }
}

function getMissingSlots(actionType: ActionType, currentSlots: Record<string, any>): string[] {
  const requirements = SLOT_REQUIREMENTS[actionType];
  if (!requirements) return [];
  
  return requirements.required.filter(slot => {
    const value = currentSlots[slot];
    return value === null || value === undefined || value === "";
  });
}

function buildDecision(
  actionType: ActionType,
  confidence: number,
  slots: ExtractedSlots,
  context: { hasActiveAction: boolean; activeActionType?: string; activeActionSlots?: Record<string, any> }
): DecisionOutput {
  // Merge com slots do contexto se mesmo tipo
  let finalSlots = { ...slots };
  if (context.hasActiveAction && context.activeActionSlots) {
    finalSlots = { ...context.activeActionSlots, ...Object.fromEntries(Object.entries(slots).filter(([_, v]) => v != null)) };
  }
  
  const missingSlots = getMissingSlots(actionType, finalSlots);
  const shouldExecute = missingSlots.length === 0 && confidence >= 0.7;
  const shouldAsk = missingSlots.length > 0;
  
  let question: string | null = null;
  let buttons: Array<{ id: string; title: string }> | null = null;
  
  if (shouldAsk && missingSlots[0]) {
    const promptKey = actionType === "income" && missingSlots[0] === "amount" ? "amount_income" 
      : actionType === "income" && missingSlots[0] === "description" ? "description_income"
      : missingSlots[0];
    
    const prompt = SLOT_PROMPTS[promptKey] || SLOT_PROMPTS[missingSlots[0]];
    if (prompt) {
      question = prompt.text;
      if (prompt.useButtons && prompt.buttons) {
        buttons = prompt.buttons;
      }
    }
  }
  
  return {
    actionType,
    confidence,
    reasoning: "",
    slots: finalSlots,
    missingSlots,
    shouldExecute,
    shouldAsk,
    question,
    buttons
  };
}

// ============================================================================
// 🎯 CONTEXT MANAGER
// ============================================================================

async function getActiveAction(userId: string): Promise<ActiveAction | null> {
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
  type: string,
  intent: string,
  slots: Record<string, any>,
  pendingSlot?: string | null,
  messageId?: string | null
): Promise<ActiveAction> {
  const actionHash = `action_${userId.slice(0, 8)}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  
  const { data: newAction, error } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: intent,
      action_hash: actionHash,
      status: "collecting",
      slots,
      meta: { 
        action_type: type,
        pending_slot: pendingSlot || undefined,
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
    origin_message_id: messageId || undefined,
    last_message_id: messageId || undefined,
    created_at: newAction.created_at,
    updated_at: newAction.created_at,
    expires_at: expiresAt
  };
}

async function updateAction(
  actionId: string,
  updates: { slots?: Record<string, any>; status?: string; pending_slot?: string | null }
): Promise<void> {
  const { data: existing } = await supabase.from("actions").select("meta").eq("id", actionId).single();
  const meta = { ...(existing?.meta as Record<string, any> || {}) };
  
  if (updates.pending_slot !== undefined) meta.pending_slot = updates.pending_slot;
  
  const updateData: Record<string, any> = { meta, updated_at: new Date().toISOString() };
  if (updates.slots) updateData.slots = updates.slots;
  if (updates.status) updateData.status = updates.status;
  
  await supabase.from("actions").update(updateData).eq("id", actionId);
  console.log(`🔄 [ACTION] Atualizado: ${actionId.slice(-8)}`);
}

async function closeAction(actionId: string, entityId?: string): Promise<void> {
  await supabase.from("actions").update({ status: "done", entity_id: entityId, updated_at: new Date().toISOString() }).eq("id", actionId);
  console.log(`✅ [ACTION] Fechado: ${actionId.slice(-8)}`);
}

async function cancelAction(userId: string): Promise<boolean> {
  const action = await getActiveAction(userId);
  if (!action) return false;
  
  await supabase.from("actions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", action.id);
  console.log(`🗑️ [ACTION] Cancelado: ${action.id.slice(-8)}`);
  return true;
}

function shouldAutoDiscardContext(activeAction: ActiveAction | null, newActionType: ActionType): boolean {
  if (!activeAction) return false;
  
  const currentType = activeAction.intent.includes("entrada") || activeAction.intent === "income" ? "income"
    : activeAction.intent.includes("card") || activeAction.intent === "card_event" ? "card_event"
    : activeAction.intent.includes("gasto") || activeAction.intent === "expense" ? "expense"
    : null;
  
  // Se domínios são claramente diferentes, descartar
  if (currentType && newActionType !== currentType && newActionType !== "cancel" && newActionType !== "unknown") {
    console.log(`🔄 [CONTEXT] Auto-descarte: ${currentType} → ${newActionType}`);
    return true;
  }
  
  return false;
}

// ============================================================================
// 📱 MESSAGING
// ============================================================================

async function sendWhatsAppMeta(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: cleanNumber, type: "text", text: { body: text } }),
    });
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
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`)}` },
      body: JSON.stringify({ from: VONAGE_WHATSAPP_NUMBER, to: cleanNumber, message_type: "text", text: text, channel: "whatsapp" }),
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

async function sendButtons(to: string, bodyText: string, buttons: Array<{ id: string; title: string }>, source: MessageSource): Promise<boolean> {
  if (source !== "meta") {
    const fallbackText = bodyText + "\n\n" + buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    return sendMessage(to, fallbackText, source);
  }

  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: { buttons: buttons.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) }
        }
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Meta Buttons] Erro:", error);
    return sendMessage(to, bodyText, source);
  }
}

// ============================================================================
// 🎤 MÍDIA (AUDIO/IMAGEM)
// ============================================================================

async function downloadWhatsAppMedia(mediaId: string, eventoId?: string): Promise<string | null> {
  if (eventoId) {
    const { data: evento } = await supabase.from("eventos_brutos").select("media_status, media_attempts, media_downloaded").eq("id", eventoId).single();
    if (evento?.media_status === 'done' || evento?.media_downloaded) return null;
    if ((evento?.media_attempts || 0) >= 2) return null;
    await supabase.from("eventos_brutos").update({ media_status: 'processing', media_attempts: (evento?.media_attempts || 0) + 1 }).eq("id", eventoId);
  }
  
  try {
    const urlResponse = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } });
    if (!urlResponse.ok) return null;
    
    const urlData = await urlResponse.json();
    const mediaResponse = await fetch(urlData.url, { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } });
    if (!mediaResponse.ok) return null;
    
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    if (eventoId) await supabase.from("eventos_brutos").update({ media_status: 'done', media_downloaded: true }).eq("id", eventoId);
    return base64;
  } catch (error) {
    console.error("❌ [MÍDIA] Erro:", error);
    return null;
  }
}

async function transcreverAudio(audioBase64: string): Promise<{ texto: string | null; confianca: number }> {
  try {
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    
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
    let status = "queued";
    let transcricao: string | null = null;
    let audioConfianca = 0;
    let tentativas = 0;
    
    while ((status === "queued" || status === "processing") && tentativas < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptData.id}`, { headers: { "Authorization": ASSEMBLYAI_API_KEY! } });
      if (!pollingResponse.ok) { tentativas++; continue; }
      const pollingData = await pollingResponse.json();
      status = pollingData.status;
      if (status === "completed") { transcricao = pollingData.text; audioConfianca = pollingData.confidence || 0.7; break; }
      tentativas++;
    }
    
    return { texto: transcricao, confianca: audioConfianca };
  } catch (error) {
    console.error("❌ [AUDIO] Erro:", error);
    return { texto: null, confianca: 0 };
  }
}

// ============================================================================
// 💾 INTENT HANDLERS
// ============================================================================

function inferCategory(description: string): string {
  const desc = normalizeText(description);
  const map: Record<string, string[]> = {
    alimentacao: ["cafe", "pao", "lanche", "almoco", "jantar", "ifood", "rappi", "restaurante", "pizza"],
    mercado: ["mercado", "supermercado", "feira"],
    transporte: ["uber", "99", "taxi", "gasolina", "estacionamento"],
    saude: ["farmacia", "remedio", "medico", "hospital"],
    lazer: ["cinema", "netflix", "spotify", "bar", "festa"],
  };
  
  for (const [cat, words] of Object.entries(map)) {
    if (words.some(w => desc.includes(w))) return cat;
  }
  return "outros";
}

async function registerExpense(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  const categoria = inferCategory(descricao);
  const formaPagamento = slots.payment_method || "outro";
  
  const agora = new Date();
  const { data: tx, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: formaPagamento,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  if (actionId) await closeAction(actionId, tx.id);
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const emoji = categoria === "alimentacao" ? "🍽️" : categoria === "mercado" ? "🛒" : categoria === "transporte" ? "🚗" : "💸";
  
  return {
    success: true,
    message: `${emoji} *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${formaPagamento}\n📅 ${dataFormatada} às ${horaFormatada}`
  };
}

async function registerIncome(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  const source = slots.source || "outro";
  
  const agora = new Date();
  const { data: tx, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria: "entrada",
    tipo: "entrada",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: source,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [INCOME] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  if (actionId) await closeAction(actionId, tx.id);
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  return {
    success: true,
    message: `💰 *Entrada registrada!*\n\n✅ *+R$ ${valor.toFixed(2)}*\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${source}\n📅 ${dataFormatada} às ${horaFormatada}`
  };
}

async function getMonthlySummary(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo")
    .eq("usuario_id", userId)
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada");

  let totalEntradas = 0, totalSaidas = 0;
  transacoes?.forEach((t) => {
    if (t.tipo === "entrada") totalEntradas += Number(t.valor);
    else totalSaidas += Number(t.valor);
  });
  
  const saldo = totalEntradas - totalSaidas;
  
  return !transacoes || transacoes.length === 0
    ? "Você ainda não tem transações este mês 📊\n\nManda um gasto!"
    : `📊 *Resumo do Mês*\n\n💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
}

async function listCardsForUser(userId: string): Promise<any[]> {
  const { data } = await supabase.from("cartoes_credito").select("*").eq("usuario_id", userId).eq("ativo", true);
  return data || [];
}

async function updateCardLimit(userId: string, cardName: string, newLimit: number): Promise<{ success: boolean; message: string }> {
  const cards = await listCardsForUser(userId);
  const card = cards.find(c => normalizeText(c.nome || "").includes(normalizeText(cardName)));
  
  if (!card) {
    return { success: false, message: `Não encontrei o cartão "${cardName}" 💳\n\nQuer ver seus cartões? Manda "ver cartões"` };
  }
  
  await supabase.from("cartoes_credito").update({ limite_total: newLimit, limite_disponivel: newLimit }).eq("id", card.id);
  
  return { success: true, message: `✅ Limite do *${card.nome}* atualizado para R$ ${newLimit.toFixed(2)}` };
}

async function listTransactionsForCancel(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, categoria, data, status")
    .eq("usuario_id", userId)
    .in("status", ["confirmada", "prevista"])
    .order("created_at", { ascending: false })
    .limit(5);
  return data || [];
}

async function cancelTransaction(userId: string, txId: string): Promise<{ success: boolean; message: string }> {
  const { data: tx } = await supabase.from("transacoes").select("*").eq("id", txId).eq("usuario_id", userId).single();
  if (!tx) return { success: false, message: "Transação não encontrada 🤔" };
  if (tx.status === "cancelada") return { success: false, message: "Já foi cancelada 👍" };
  
  await supabase.from("transacoes").update({ status: "cancelada" }).eq("id", txId);
  return { success: true, message: `✅ *Transação cancelada!*\n\n🗑️ R$ ${tx.valor?.toFixed(2)} - ${tx.descricao || tx.categoria}` };
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
    const { data: usuario } = await supabase.from("usuarios").select("*").eq("id", userId).single();
    const nomeUsuario = usuario?.nome || "amigo(a)";
    
    // Verificar novo usuário (onboarding)
    const { count: historicoCount } = await supabase
      .from("historico_conversas")
      .select("id", { count: "exact", head: true })
      .eq("phone_number", payload.phoneNumber);
    
    if ((historicoCount || 0) === 0) {
      console.log(`🎉 [WORKER] Novo usuário: ${payload.phoneNumber}`);
      await sendMessage(payload.phoneNumber, `Oi, ${nomeUsuario.split(" ")[0]}! 👋\n\nSou o *Finax* — seu assistente financeiro.\n\nPode me mandar gastos por texto, áudio ou foto.\n\nPra começar, me conta: quanto você costuma ganhar por mês? 💰`, payload.messageSource);
      await supabase.from("historico_conversas").insert({ phone_number: payload.phoneNumber, user_id: userId, user_message: payload.messageText || "[MÍDIA]", ai_response: "[ONBOARDING]", tipo: "onboarding" });
      return;
    }
    
    // ========================================================================
    // 🎯 BUSCAR CONTEXTO ATIVO
    // ========================================================================
    const activeAction = await getActiveAction(userId);
    
    logDecision({ messageId: payload.messageId, decision: "start", details: { hasContext: !!activeAction, contextType: activeAction?.intent } });
    
    // ========================================================================
    // 🔘 PRIORIDADE 1: CALLBACK DE BOTÃO
    // ========================================================================
    if (payload.buttonReplyId) {
      console.log(`🔘 [BUTTON] Callback: ${payload.buttonReplyId}`);
      
      // FORMA DE PAGAMENTO
      if (payload.buttonReplyId.startsWith("pay_")) {
        const paymentMethod = PAYMENT_ALIASES[payload.buttonReplyId];
        if (paymentMethod && activeAction && activeAction.intent === "expense") {
          const updatedSlots = { ...activeAction.slots, payment_method: paymentMethod };
          const missing = getMissingSlots("expense", updatedSlots);
          
          if (missing.length === 0) {
            const result = await registerExpense(userId, updatedSlots, activeAction.id);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
            return;
          }
          
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
          const prompt = SLOT_PROMPTS[missing[0]];
          if (prompt?.useButtons && prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
          }
          return;
        }
      }
      
      // SOURCE DE ENTRADA
      if (payload.buttonReplyId.startsWith("src_")) {
        const source = SOURCE_ALIASES[payload.buttonReplyId];
        if (source && activeAction && activeAction.intent === "income") {
          const updatedSlots: ExtractedSlots = { ...activeAction.slots, source };
          
          if (!updatedSlots.amount) {
            await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "amount" });
            await sendMessage(payload.phoneNumber, SLOT_PROMPTS.amount_income.text, payload.messageSource);
            return;
          }
          
          const result = await registerIncome(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
      
      // NÚMERO ISOLADO - GASTO
      if (payload.buttonReplyId === "num_gasto" && activeAction?.slots?.amount) {
        await closeAction(activeAction.id);
        await createAction(userId, "expense", "expense", { amount: activeAction.slots.amount }, "payment_method", payload.messageId);
        await sendButtons(payload.phoneNumber, "Como você pagou?", SLOT_PROMPTS.payment_method.buttons!, payload.messageSource);
        return;
      }
      
      // NÚMERO ISOLADO - ENTRADA
      if (payload.buttonReplyId === "num_entrada" && activeAction?.slots?.amount) {
        await closeAction(activeAction.id);
        await createAction(userId, "income", "income", { amount: activeAction.slots.amount }, "source", payload.messageId);
        await sendButtons(payload.phoneNumber, "Como você recebeu?", SLOT_PROMPTS.source.buttons!, payload.messageSource);
        return;
      }
      
      // CONFIRMAR CANCELAMENTO
      if (payload.buttonReplyId === "cancel_confirm_yes" && activeAction?.slots?.transaction_id) {
        const result = await cancelTransaction(userId, activeAction.slots.transaction_id);
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      if (payload.buttonReplyId === "cancel_confirm_no") {
        if (activeAction) await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, "Ok, mantido! 👍", payload.messageSource);
        return;
      }
    }
    
    // ========================================================================
    // 📷 PROCESSAR MÍDIA (AUDIO/IMAGEM)
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
    
    // ========================================================================
    // 🔢 NÚMERO ISOLADO
    // ========================================================================
    if (isNumericOnly(conteudoProcessado)) {
      const numValue = parseNumericValue(conteudoProcessado);
      
      logDecision({ messageId: payload.messageId, decision: "numeric_routing", details: { value: numValue, hasContext: !!activeAction } });
      
      // Se há contexto ativo esperando amount
      if (activeAction && (activeAction.pending_slot === "amount" || !activeAction.slots.amount) && numValue) {
        const updatedSlots: ExtractedSlots = { ...activeAction.slots, amount: numValue };
        const actionType = activeAction.intent === "income" ? "income" : "expense";
        const missing = getMissingSlots(actionType as ActionType, updatedSlots);
        
        if (missing.length === 0) {
          const result = actionType === "income" 
            ? await registerIncome(userId, updatedSlots, activeAction.id)
            : await registerExpense(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
        const promptKey = actionType === "income" && missing[0] === "source" ? "source" : missing[0];
        const prompt = SLOT_PROMPTS[promptKey];
        if (prompt?.useButtons && prompt.buttons) {
          await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
        }
        return;
      }
      
      // Número sem contexto → PERGUNTAR (não assumir!)
      await sendButtons(payload.phoneNumber, `💰 R$ ${numValue?.toFixed(2)}\n\nEsse valor foi um gasto ou uma entrada?`, [
        { id: "num_gasto", title: "💸 Gasto" },
        { id: "num_entrada", title: "💰 Entrada" }
      ], payload.messageSource);
      
      await createAction(userId, "unknown", "numero_isolado", { amount: numValue }, "type_choice", payload.messageId);
      return;
    }
    
    // ========================================================================
    // 🧠 DECISION ENGINE - CLASSIFICAÇÃO
    // ========================================================================
    
    // Passo 1: Tentar classificação rápida por keywords
    const quickClassification = classifySemanticIntent(conteudoProcessado);
    
    let decision: DecisionOutput;
    
    if (quickClassification && quickClassification.confidence >= 0.9) {
      // Alta confiança → usar classificação rápida
      console.log(`⚡ [QUICK] ${quickClassification.actionType} | Conf: ${quickClassification.confidence}`);
      decision = buildDecision(
        quickClassification.actionType,
        quickClassification.confidence,
        quickClassification.slots,
        { hasActiveAction: !!activeAction, activeActionType: activeAction?.intent, activeActionSlots: activeAction?.slots }
      );
    } else {
      // Baixa confiança → chamar IA
      const { data: historico } = await supabase
        .from("historico_conversas")
        .select("user_message, ai_response")
        .eq("phone_number", payload.phoneNumber)
        .order("created_at", { ascending: false })
        .limit(3);
      
      const historicoFormatado = historico?.map(h => `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 80)}...`).reverse().join("\n") || "";
      
      decision = await callAIForDecision(
        conteudoProcessado,
        { 
          hasActiveAction: !!activeAction, 
          activeActionType: activeAction?.intent, 
          activeActionSlots: activeAction?.slots,
          pendingSlot: activeAction?.pending_slot
        },
        historicoFormatado
      );
    }
    
    logDecision({ messageId: payload.messageId, decision: "classified", details: { type: decision.actionType, conf: decision.confidence, slots: decision.slots } });
    
    // ========================================================================
    // 🔄 AUTO-DESCARTE DE CONTEXTO
    // ========================================================================
    if (shouldAutoDiscardContext(activeAction, decision.actionType)) {
      await cancelAction(userId);
    }
    
    // ========================================================================
    // 🎯 ROTEAMENTO POR TIPO DE AÇÃO
    // ========================================================================
    
    // 💰 INCOME
    if (decision.actionType === "income") {
      const slots = decision.slots;
      
      if (!slots.amount) {
        if (activeAction && activeAction.intent === "income") {
          await updateAction(activeAction.id, { pending_slot: "amount" });
        } else {
          await createAction(userId, "income", "income", slots, "amount", payload.messageId);
        }
        await sendMessage(payload.phoneNumber, SLOT_PROMPTS.amount_income.text, payload.messageSource);
        return;
      }
      
      if (!slots.source) {
        if (activeAction && activeAction.intent === "income") {
          await updateAction(activeAction.id, { slots, pending_slot: "source" });
        } else {
          await createAction(userId, "income", "income", slots, "source", payload.messageId);
        }
        await sendButtons(payload.phoneNumber, `💰 R$ ${slots.amount?.toFixed(2)}\n\nComo você recebeu?`, SLOT_PROMPTS.source.buttons!, payload.messageSource);
        return;
      }
      
      // Tudo pronto → registrar
      const actionId = activeAction?.intent === "income" ? activeAction.id : undefined;
      const result = await registerIncome(userId, slots, actionId);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // 💸 EXPENSE
    if (decision.actionType === "expense") {
      const slots = decision.slots;
      
      if (!slots.amount) {
        if (activeAction && activeAction.intent === "expense") {
          await updateAction(activeAction.id, { pending_slot: "amount" });
        } else {
          await createAction(userId, "expense", "expense", slots, "amount", payload.messageId);
        }
        await sendMessage(payload.phoneNumber, SLOT_PROMPTS.amount.text, payload.messageSource);
        return;
      }
      
      if (!slots.payment_method) {
        if (activeAction && activeAction.intent === "expense") {
          await updateAction(activeAction.id, { slots, pending_slot: "payment_method" });
        } else {
          await createAction(userId, "expense", "expense", slots, "payment_method", payload.messageId);
        }
        await sendButtons(payload.phoneNumber, "Como você pagou?", SLOT_PROMPTS.payment_method.buttons!, payload.messageSource);
        return;
      }
      
      // Tudo pronto → registrar
      const actionId = activeAction?.intent === "expense" ? activeAction.id : undefined;
      const result = await registerExpense(userId, slots, actionId);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // 💳 CARD EVENT
    if (decision.actionType === "card_event") {
      const { card, value } = decision.slots;
      
      if (card && value) {
        const result = await updateCardLimit(userId, card, value);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // Falta informação
      const cards = await listCardsForUser(userId);
      if (cards.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem cartões cadastrados 💳", payload.messageSource);
        return;
      }
      
      const cardList = cards.map((c, i) => `${i + 1}. ${c.nome}`).join("\n");
      await sendMessage(payload.phoneNumber, `Qual cartão atualizar?\n\n${cardList}`, payload.messageSource);
      return;
    }
    
    // 🗑️ CANCEL
    if (decision.actionType === "cancel") {
      const txs = await listTransactionsForCancel(userId);
      
      if (txs.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem transações para cancelar 🤔", payload.messageSource);
        return;
      }
      
      const lista = txs.map((t, i) => `${i + 1}. R$ ${t.valor?.toFixed(2)} - ${t.descricao || t.categoria}`).join("\n");
      await sendMessage(payload.phoneNumber, `Qual transação cancelar?\n\n${lista}\n\n_Responde com o número_`, payload.messageSource);
      return;
    }
    
    // 📊 QUERY
    if (decision.actionType === "query") {
      const summary = await getMonthlySummary(userId);
      await sendMessage(payload.phoneNumber, summary, payload.messageSource);
      return;
    }
    
    // 🎮 CONTROL (saudação, ajuda, negação)
    if (decision.actionType === "control") {
      const normalized = normalizeText(conteudoProcessado);
      
      if (normalized.includes("cancela") || normalized.includes("deixa") || normalized.includes("nao")) {
        const cancelled = await cancelAction(userId);
        await sendMessage(payload.phoneNumber, cancelled ? "Ok, descartei! 👍" : "Não tinha nada pendente 🤔", payload.messageSource);
        return;
      }
      
      if (normalized.includes("ajuda") || normalized.includes("help")) {
        await sendMessage(payload.phoneNumber, `*Como usar o Finax* 📊\n\n💸 *Registrar gasto:*\n"Gastei 50 no mercado"\n\n💰 *Registrar entrada:*\n"Recebi 200 de pix"\n\n📊 *Ver resumo:*\n"Quanto gastei?"`, payload.messageSource);
        return;
      }
      
      // Saudação
      const primeiroNome = nomeUsuario.split(" ")[0];
      await sendMessage(payload.phoneNumber, `Oi, ${primeiroNome}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`, payload.messageSource);
      return;
    }
    
    // ❓ UNKNOWN / FALLBACK
    if (activeAction && activeAction.pending_slot) {
      // Re-perguntar o slot pendente
      const prompt = SLOT_PROMPTS[activeAction.pending_slot];
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `Não entendi 🤔\n\n${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `Não entendi 🤔\n\n${prompt?.text || "Continue..."}`, payload.messageSource);
      }
      return;
    }
    
    await sendMessage(payload.phoneNumber, `Não entendi 🤔\n\nPode me dizer:\n• Um gasto (ex: "café 8 reais pix")\n• Uma entrada (ex: "recebi 200")\n• "Resumo" pra ver seus gastos`, payload.messageSource);
    
  } catch (error) {
    console.error("❌ [WORKER] Erro:", error);
    await sendMessage(payload.phoneNumber, "Ops, algo deu errado 😕\n\nTenta de novo?", payload.messageSource);
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
    const { data: jobs, error } = await supabase
      .from("webhook_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) {
      console.error("Erro ao buscar jobs:", error);
      return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`📋 [WORKER] ${jobs.length} job(s) para processar`);

    const jobIds = jobs.map(j => j.id);
    await supabase.from("webhook_jobs").update({ status: "processing" }).in("id", jobIds);

    for (const job of jobs) {
      try {
        await processarJob(job);
        await supabase.from("webhook_jobs").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", job.id);
      } catch (jobError) {
        console.error(`❌ [JOB ${job.id}] Erro:`, jobError);
        await supabase.from("webhook_jobs").update({ status: "error", last_error: String(jobError), attempts: (job.attempts || 0) + 1 }).eq("id", job.id);
      }
    }

    return new Response(JSON.stringify({ processed: jobs.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Erro geral:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
