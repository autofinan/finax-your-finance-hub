import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

// ============================================================================
// 🏭 FINAX WORKER v2.0 - ANTI-DUPLICAÇÃO TOTAL
// ============================================================================
//
// REGRAS FUNDAMENTAIS:
// 1. IA INTERPRETA, NUNCA DECIDE SE GRAVA
// 2. action_hash = user_id + action_type + valor + categoria + janela_60s
// 3. descrição NÃO entra no hash
// 4. Mensagem duplicada em < 60s = MESMA action = NÃO grava de novo
// 5. Transação SÓ é criada se action foi criada agora
//
// FLUXO: Mensagem → IA Interpreta → ACTION (idempotente) → Transação
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
}

interface ExtractedItem {
  valor: number;
  descricao: string;
  categoria?: string;
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
  // NOVOS CAMPOS PARA MÚLTIPLOS GASTOS
  itens?: ExtractedItem[];
  split_explicit?: boolean;    // Usuário pediu "registre separadamente"
  aggregate_explicit?: boolean; // Usuário indicou como único gasto
}

// ============================================================================
// 🔐 IDEMPOTÊNCIA - ACTION HASH (JANELA DE 60 SEGUNDOS)
// ============================================================================

/**
 * REGRA DE OURO: action_hash baseado em:
 * - user_id
 * - action_type (registrar_gasto, registrar_entrada)
 * - valor ARREDONDADO (centavos)
 * - categoria NORMALIZADA (lowercase, sem acentos)
 * - JANELA DE TEMPO (60 segundos)
 * 
 * ⚠️ DESCRIÇÃO NÃO ENTRA NO HASH ⚠️
 */
function gerarActionHash(
  userId: string,
  actionType: string,
  valor: number | undefined,
  categoria: string | undefined
): string {
  // Janela de 60 segundos: timestamp arredondado para minuto
  const now = new Date();
  const timeBucket = Math.floor(now.getTime() / 60000); // Minuto atual
  
  // Valor em centavos (arredondado para evitar float issues)
  const valorCentavos = Math.round((valor || 0) * 100);
  
  // Categoria normalizada
  const categoriaNorm = (categoria || "outros")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  
  // Hash string: user + type + valor + categoria + janela
  const hashInput = `${userId}|${actionType}|${valorCentavos}|${categoriaNorm}|${timeBucket}`;
  
  // Gerar hash simples mas único
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return `${actionType}_${userId.slice(0, 8)}_${Math.abs(hash).toString(36)}_${timeBucket}`;
}

/**
 * Verifica se action já existe ou cria nova.
 * RETORNA: { created: true } se é uma NOVA action (deve registrar)
 * RETORNA: { created: false } se action JÁ EXISTE (NÃO registrar)
 */
async function verificarOuCriarAction(
  userId: string,
  actionType: string,
  actionHash: string,
  meta?: Record<string, any>
): Promise<{ created: boolean; actionId?: string; existingAction?: any }> {
  try {
    // 1. Primeiro verificar se já existe
    const { data: existing } = await supabase
      .from("actions")
      .select("id, status, created_at")
      .eq("action_hash", actionHash)
      .single();
    
    if (existing) {
      console.log(`🔒 [ACTION] Hash ${actionHash} JÁ EXISTE - duplicação bloqueada`);
      return { created: false, existingAction: existing };
    }
    
    // 2. Tentar inserir (com constraint unique)
    const { data, error } = await supabase
      .from("actions")
      .insert({
        user_id: userId,
        action_type: actionType,
        action_hash: actionHash,
        status: "pending",
        meta: meta || {}
      })
      .select("id")
      .single();
    
    if (error) {
      // Constraint violation = duplicação
      if (error.code === '23505' || error.message?.includes('duplicate')) {
        console.log(`🔒 [ACTION] Constraint bloqueou duplicação: ${actionHash}`);
        return { created: false };
      }
      console.error("❌ [ACTION] Erro inesperado:", error);
      return { created: false };
    }
    
    console.log(`✅ [ACTION] Nova action criada: ${data.id} (${actionHash})`);
    return { created: true, actionId: data.id };
    
  } catch (e) {
    console.error("❌ [ACTION] Exceção:", e);
    return { created: false };
  }
}

async function marcarActionDone(actionHash: string, entityId?: string): Promise<void> {
  await supabase
    .from("actions")
    .update({ 
      status: "done", 
      entity_id: entityId,
      updated_at: new Date().toISOString() 
    })
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
// 🧠 INTERPRETAÇÃO IA (APENAS INTERPRETA, NÃO DECIDE)
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
            content: `Você é um analisador de intenções financeiras. APENAS interprete, NÃO tome decisões.

⚠️ SUA FUNÇÃO: Extrair dados da mensagem. Você NÃO decide se deve registrar ou não.

INTENTS:
- "registrar_gasto": gasto/despesa/compra (ÚNICO ou MÚLTIPLOS)
- "registrar_entrada": receita/entrada/salário
- "criar_parcelamento": compra parcelada
- "criar_recorrente": gasto repetitivo mensal
- "consultar_resumo": resumo/quanto gastei
- "cancelar_transacao": apagar/cancelar/desfazer
- "gerenciar_cartoes": atualizar/adicionar/remover/ver cartões ("meus cartões", "atualizar cartão", "adicionar cartão", "remover cartão", "quais cartões")
- "saudacao": oi, olá, bom dia
- "ajuda": como funciona
- "confirmar_hipotese": sim, pode registrar
- "negar_hipotese": não, cancela
- "selecionar_opcao": números (1, 2, 3...)
- "outro": não financeiro

🔴 REGRA CRUCIAL PARA MÚLTIPLOS GASTOS:
Se a mensagem contiver MAIS DE UM gasto/item COM VALORES DISTINTOS:
1. Retorne "itens" como array de cada item
2. Defina split_explicit=true se o usuário disse "separadamente", "cada um", "separado"
3. Defina aggregate_explicit=true se o usuário falou como um único gasto ("gastei 10 no mercado com pão e leite")

🔴 REGRA ABSOLUTA DE CATEGORIZAÇÃO (OBRIGATÓRIA):
"outros" é SEMPRE o ÚLTIMO RECURSO. Você TEM conhecimento semântico. USE-O.

MAPEAMENTO OBRIGATÓRIO:
- café, pão, pão de queijo, água, refrigerante, suco, lanche, açaí, pizza, hambúrguer, almoço, jantar, padaria, restaurante, bar, ifood, delivery, paçoca, chocolate, doce, sorvete → "alimentacao"
- mercado, supermercado, compras, feira → "mercado"
- uber, 99, táxi, ônibus, metrô, gasolina, combustível, estacionamento, pedágio → "transporte"
- farmácia, remédio, médico, hospital, consulta, exame, dentista, plano de saúde → "saude"
- cinema, netflix, spotify, show, festa, bar (lazer), jogo, passeio, viagem → "lazer"
- aluguel, condomínio, luz, água (conta), gás, internet, telefone → "moradia"
- roupa, calçado, maquiagem, perfume, acessório, loja → "compras"

SE o item combinar com QUALQUER palavra acima → USE essa categoria (confiança alta).
"outros" SÓ se for algo totalmente desconhecido como "xyz123".

CADA ITEM no array "itens" DEVE ter sua própria categoria correta.
Exemplo: "café 1,50 e uber 10" → [{valor:1.50,descricao:"café",categoria:"alimentacao"},{valor:10,descricao:"uber",categoria:"transporte"}]

Responda APENAS JSON:
{
  "intent": "string",
  "valor": number ou null (se único gasto),
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "forma_pagamento": "pix"|"dinheiro"|"debito"|"credito" ou null,
  "parcelas": number ou null,
  "opcao_selecionada": number ou null,
  "confianca": number,
  "itens": [{"valor": number, "descricao": "string", "categoria": "string"}] ou null,
  "split_explicit": boolean ou null,
  "aggregate_explicit": boolean ou null
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
    
    console.log(`🧠 [IA] ${parsed.intent} | Itens: ${parsed.itens?.length || 0} | Split: ${parsed.split_explicit} | Conf: ${parsed.confianca}`);
    
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
  
  const { error: updateError } = await supabase
    .from("pending_selections")
    .update({ consumed: true })
    .eq("id", data.id)
    .eq("consumed", false);
  
  if (updateError) {
    console.log(`⚠️ [PENDING] Race condition ao consumir`);
    return null;
  }
  
  console.log(`✅ [PENDING] Consumido: ${data.id}`);
  return { options: data.options as any[], id: data.id };
}

// ============================================================================
// 💾 HIPÓTESES (PARA CONFIRMAÇÃO DO USUÁRIO)
// ============================================================================

/**
 * CRIA HIPÓTESE COM ACTION PRÉ-REGISTRADA
 * 
 * REGRA DE OURO DOS BOTÕES:
 * - Botão NUNCA decide nada
 * - Ele apenas EXECUTA algo que já está pré-registrado (action)
 * 
 * Ao criar hipótese, já cria a ACTION com status "pending_confirmation"
 * Quando usuário clica "Sim", apenas muda status para "pending" e executa
 */
async function criarHipotese(
  userId: string,
  eventoId: string | null,
  dados: ExtractedIntent,
  confianca: number
): Promise<{ hipoteseId: string | null; actionId: string | null }> {
  try {
    // 1. Expirar hipóteses antigas do mesmo usuário
    await supabase
      .from("hipoteses_registro")
      .update({ status: "expirada" })
      .eq("user_id", userId)
      .eq("status", "pendente");
    
    // 2. Criar ACTION com status "pending_confirmation" (aguardando botão)
    const actionHash = `hipotese_${userId.slice(0,8)}_${Date.now()}`;
    
    const { data: actionData, error: actionError } = await supabase
      .from("actions")
      .insert({
        user_id: userId,
        action_type: dados.intent === "registrar_entrada" ? "registrar_entrada" : "registrar_gasto",
        action_hash: actionHash,
        status: "pending_confirmation", // Aguardando confirmação do usuário
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
      console.error("❌ [HIPOTESE] Erro ao criar action:", actionError);
      return { hipoteseId: null, actionId: null };
    }
    
    console.log(`🔐 [ACTION] Pré-registrada: ${actionData.id} (${actionHash})`);
    
    // 3. Criar hipótese vinculada à action
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

/**
 * EXECUTAR ACTION PRÉ-REGISTRADA (CHAMADO QUANDO USUÁRIO CLICA "SIM")
 * 
 * 1. Busca action pelo ID
 * 2. Valida se ainda está "pending_confirmation"
 * 3. Executa (cria transação)
 * 4. Marca como "done"
 */
async function executarActionConfirmada(
  actionId: string,
  userId: string
): Promise<{ sucesso: boolean; mensagem: string; jaDuplicado?: boolean }> {
  try {
    // 1. Buscar action
    const { data: action } = await supabase
      .from("actions")
      .select("*")
      .eq("id", actionId)
      .eq("user_id", userId)
      .single();
    
    if (!action) {
      console.log(`❌ [ACTION] Não encontrada: ${actionId}`);
      return { sucesso: false, mensagem: "Essa confirmação expirou 😕\n\nMe conta de novo o gasto." };
    }
    
    // 2. Verificar status
    if (action.status === "done") {
      console.log(`🔒 [ACTION] Já executada: ${actionId}`);
      return { sucesso: false, jaDuplicado: true, mensagem: "Esse gasto já foi registrado 👍" };
    }
    
    if (action.status !== "pending_confirmation") {
      console.log(`⚠️ [ACTION] Status inválido: ${action.status}`);
      return { sucesso: false, mensagem: "Essa confirmação não está mais disponível." };
    }
    
    // 3. Extrair dados do meta
    const meta = action.meta as { valor: number; categoria: string; descricao?: string; forma_pagamento?: string };
    const tipoTransacao = action.action_type === "registrar_entrada" ? "entrada" : "saida";
    
    // 4. Criar transação
    const transacaoId = gerarIdTransacao();
    const agora = new Date();
    
    const { data: transacao, error: txError } = await supabase.from("transacoes").insert({
      usuario_id: userId,
      valor: meta.valor,
      categoria: meta.categoria || "outros",
      tipo: tipoTransacao,
      descricao: meta.descricao,
      observacao: meta.descricao,
      data: agora.toISOString(),
      origem: "whatsapp",
      forma_pagamento: meta.forma_pagamento,
      status: "confirmada",
      idempotency_key: action.action_hash
    }).select("id").single();
    
    if (txError) {
      console.error("❌ [ACTION] Erro ao criar transação:", txError);
      return { sucesso: false, mensagem: "Algo deu errado ao salvar 😕\n\nTenta de novo?" };
    }
    
    // 5. Marcar action como done
    await supabase
      .from("actions")
      .update({ status: "done", entity_id: transacao.id, updated_at: new Date().toISOString() })
      .eq("id", actionId);
    
    // 6. Log
    await supabase.from("finax_logs").insert({
      user_id: userId,
      action_type: "confirmar_registro",
      entity_type: "transacao",
      entity_id: transacao.id,
      new_data: { action_id: actionId, ...meta }
    });
    
    // 7. Formatar resposta
    const dataFormatada = agora.toLocaleDateString("pt-BR");
    const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const sinal = tipoTransacao === "entrada" ? "+" : "-";
    const tipoTexto = tipoTransacao === "entrada" ? "Entrada registrada" : "Gasto registrado";
    
    console.log(`✅ [ACTION] Executada: ${actionId} -> ${transacao.id}`);
    
    return {
      sucesso: true,
      mensagem: `✅ *${tipoTexto}!*\n\n` +
        `🧾 *ID: ${transacaoId}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💸 *${sinal}R$ ${meta.valor?.toFixed(2)}*\n` +
        `📂 ${meta.categoria}\n` +
        (meta.descricao ? `📝 ${meta.descricao}\n` : "") +
        `📅 ${dataFormatada} às ${horaFormatada}`
    };
    
  } catch (e) {
    console.error("❌ [ACTION] Exceção:", e);
    return { sucesso: false, mensagem: "Erro ao processar confirmação 😕" };
  }
}

/**
 * CANCELAR ACTION PRÉ-REGISTRADA (CHAMADO QUANDO USUÁRIO CLICA "NÃO")
 */
async function cancelarActionPendente(actionId: string, userId: string): Promise<void> {
  await supabase
    .from("actions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("user_id", userId);
  
  console.log(`🗑️ [ACTION] Cancelada: ${actionId}`);
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
  
  // Verificar se não expirou (5 min para hipóteses)
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

// ============================================================================
// 🏷️ MAPEAMENTO SEMÂNTICO DE CATEGORIAS (FALLBACK OBRIGATÓRIO)
// ============================================================================

/**
 * REGRA ABSOLUTA: "outros" é SEMPRE o ÚLTIMO RECURSO.
 * Esta função garante que itens claramente inferíveis NUNCA caiam em "outros".
 */
function inferirCategoria(descricao: string, categoriaIA?: string): string {
  // Se IA já retornou uma categoria válida diferente de "outros", usar ela
  if (categoriaIA && categoriaIA !== "outros" && categoriaIA !== "other") {
    return categoriaIA;
  }
  
  const desc = descricao.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  
  // ALIMENTAÇÃO
  if (/cafe|café|pao|pão|padaria|lanche|almoco|almoço|jantar|janta|agua|água|refrigerante|refri|suco|acai|açai|pizza|hamburguer|hamburger|burger|pastel|coxinha|salgado|paçoca|pacoca|chocolate|doce|sorvete|bolo|biscoito|ifood|delivery|restaurante|mcdonald|mc donald|burger king|subway|starbucks|bar\s|bar$|boteco|cerveja|bebida|comida|refeicao|refeição|snack|lanchonete|cantina|cafeteria/.test(desc)) {
    return "alimentacao";
  }
  
  // MERCADO
  if (/mercado|supermercado|feira|hortifruti|atacado|atacadao|carrefour|extra|pao de acucar|assai|compras mercado/.test(desc)) {
    return "mercado";
  }
  
  // TRANSPORTE
  if (/uber|99|taxi|táxi|onibus|ônibus|metro|metrô|trem|gasolina|combustivel|combustível|alcool|álcool|etanol|estacionamento|pedagio|pedágio|bilhete|passagem|cabify|moto|bike|bicicleta|patinete|carro|veiculo|veiculo/.test(desc)) {
    return "transporte";
  }
  
  // SAÚDE
  if (/farmacia|farmácia|remedio|remédio|medicamento|medico|médico|hospital|clinica|clínica|consulta|exame|dentista|fisioterapia|psicolog|plano de saude|plano de saúde|drogaria|droga raia|drogasil|pague menos|laboratorio|laboratório/.test(desc)) {
    return "saude";
  }
  
  // MORADIA
  if (/aluguel|condominio|condomínio|luz|energia|eletrica|elétrica|gas|gás|agua conta|água conta|conta de agua|conta de água|internet|wifi|telefone|celular|iptu|seguro casa|seguro residencial/.test(desc)) {
    return "moradia";
  }
  
  // LAZER
  if (/cinema|netflix|spotify|amazon prime|disney|hbo|show|festa|ingresso|teatro|museu|parque|viagem|hotel|hospedagem|airbnb|passeio|jogo|game|steam|playstation|xbox|diversao|diversão|entretenimento/.test(desc)) {
    return "lazer";
  }
  
  // COMPRAS
  if (/roupa|calca|calça|camisa|vestido|sapato|tenis|tênis|bolsa|maquiagem|perfume|cosmetico|cosmético|acessorio|acessório|loja|shopping|renner|riachuelo|cea|marisa|zara|h&m|shein|mercado livre|amazon|magalu/.test(desc)) {
    return "compras";
  }
  
  // SERVIÇOS
  if (/servico|serviço|manutencao|manutenção|conserto|reparo|mecanico|mecânico|eletricista|encanador|faxina|limpeza|lavanderia|costura|barbeiro|cabeleireiro|salao|salão/.test(desc)) {
    return "servicos";
  }
  
  // Se nada bateu e IA disse "outros", mantém
  return categoriaIA || "outros";
}

// ============================================================================
// 💰 REGISTRO DE TRANSAÇÃO (IDEMPOTENTE COM ACTION HASH)
// ============================================================================

function gerarIdTransacao(): string {
  const agora = new Date();
  const data = agora.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.floor(Math.random() * 9999).toString().padStart(4, "0");
  return `TRX-${data}-${random}`;
}

/**
 * FUNÇÃO PRINCIPAL DE REGISTRO - ANTI-DUPLICAÇÃO
 * 
 * 1. Gera action_hash baseado em: user_id + tipo + valor + categoria + janela_60s
 * 2. Tenta criar action (idempotente)
 * 3. SE action já existe → NÃO registra, retorna "já registrado"
 * 4. SE action criada → Cria transação + marca action como done
 */
async function registrarTransacaoIdempotente(
  userId: string,
  dados: ExtractedIntent,
  eventoId: string | null,
  hipoteseId?: string
): Promise<{ sucesso: boolean; mensagem: string; transacaoId?: string; jaDuplicado?: boolean }> {
  
  const tipoTransacao = dados.intent === "registrar_entrada" ? "entrada" : "saida";
  // APLICAR INFERÊNCIA SEMÂNTICA - "outros" é último recurso
  const categoria = inferirCategoria(dados.descricao || "", dados.categoria);
  
  // 1. GERAR ACTION HASH (SEM DESCRIÇÃO!)
  const actionHash = gerarActionHash(
    userId,
    dados.intent === "registrar_entrada" ? "registrar_entrada" : "registrar_gasto",
    dados.valor,
    categoria
  );
  
  console.log(`🔐 [REGISTRO] Hash: ${actionHash} | Valor: ${dados.valor} | Cat: ${categoria}`);
  
  // 2. VERIFICAR/CRIAR ACTION (IDEMPOTENTE)
  const { created, actionId } = await verificarOuCriarAction(
    userId, 
    dados.intent === "registrar_entrada" ? "registrar_entrada" : "registrar_gasto",
    actionHash,
    { valor: dados.valor, categoria, descricao: dados.descricao }
  );
  
  // 3. SE JÁ EXISTE → NÃO DUPLICAR
  if (!created) {
    console.log(`🛑 [REGISTRO] Bloqueado - duplicação detectada: ${actionHash}`);
    return {
      sucesso: false,
      jaDuplicado: true,
      mensagem: "Esse gasto já foi registrado há instantes 👍"
    };
  }
  
  // 4. CRIAR TRANSAÇÃO (ÚNICA VEZ)
  const transacaoId = gerarIdTransacao();
  const agora = new Date();
  
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
    console.error("❌ [REGISTRO] Erro ao criar transação:", error);
    // Reverter action
    await supabase.from("actions").delete().eq("action_hash", actionHash);
    return {
      sucesso: false,
      mensagem: "Algo deu errado ao salvar 😕\n\nTenta de novo?"
    };
  }
  
  // 5. MARCAR ACTION COMO DONE
  await marcarActionDone(actionHash, transacao.id);
  
  // 6. CONFIRMAR HIPÓTESE SE EXISTIR
  if (hipoteseId) {
    await confirmarHipotese(hipoteseId);
  }
  
  // 7. LOG
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_transacao",
    entity_type: "transacao",
    entity_id: transacao.id,
    new_data: { ...dados, action_hash: actionHash }
  });
  
  // 8. FORMATAR RESPOSTA
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sinal = tipoTransacao === "entrada" ? "+" : "-";
  const tipoTexto = tipoTransacao === "entrada" ? "Entrada registrada" : "Gasto registrado";
  
  console.log(`✅ [REGISTRO] Sucesso: ${transacaoId} | ${actionHash}`);
  
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
// 🗑️ CANCELAMENTO (IDEMPOTENTE)
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
  
  const actionHash = gerarActionHash(userId, "cancelar_transacao", 0, transacaoId);
  
  const { created } = await verificarOuCriarAction(
    userId, 
    "cancelar_transacao", 
    actionHash,
    { transacao_id: transacaoId }
  );
  
  if (!created) {
    return { sucesso: false, mensagem: "Essa transação já foi cancelada 👍" };
  }
  
  const { data: transacao } = await supabase
    .from("transacoes")
    .select("*")
    .eq("id", transacaoId)
    .eq("usuario_id", userId)
    .single();
  
  if (!transacao) {
    return { sucesso: false, mensagem: "Transação não encontrada 🤔" };
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
    .eq("id", transacaoId)
    .eq("usuario_id", userId);
  
  if (error) {
    console.error("❌ [CANCEL] Erro:", error);
    return { sucesso: false, mensagem: "Erro ao cancelar 😕" };
  }
  
  await marcarActionDone(actionHash, transacaoId);
  
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
    // 🔘 TRATAR CALLBACK DE BOTÃO INTERATIVO (PRIORIDADE MÁXIMA)
    // ========================================================================
    if (payload.buttonReplyId) {
      console.log(`🔘 [BUTTON] Processando callback: ${payload.buttonReplyId}`);
      
      const hipotesePendente = await buscarHipotesePendente(userId);
      
      if (payload.buttonReplyId === "confirm_yes") {
        // CONFIRMAR - Buscar action vinculada à hipótese
        if (hipotesePendente?.dados?.action_id) {
          const resultado = await executarActionConfirmada(hipotesePendente.dados.action_id, userId);
          
          // Atualizar hipótese
          await supabase.from("hipoteses_registro")
            .update({ status: resultado.sucesso ? "confirmada" : "erro" })
            .eq("id", hipotesePendente.id);
          
          await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber,
            user_id: userId,
            user_message: "[BOTÃO SIM]",
            ai_response: resultado.mensagem,
            tipo: resultado.jaDuplicado ? "duplicado_bloqueado" : "registro_botao"
          });
          
          return;
        } else {
          // Fallback: hipótese sem action (compatibilidade)
          if (hipotesePendente) {
            const resultado = await registrarTransacaoIdempotente(
              userId,
              hipotesePendente.dados,
              eventoId,
              hipotesePendente.id
            );
            
            await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
            return;
          }
        }
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Essa confirmação expirou 😕\n\nMe conta de novo o gasto.",
          payload.messageSource
        );
        return;
      }
      
      if (payload.buttonReplyId === "confirm_no") {
        // CANCELAR
        if (hipotesePendente) {
          // Cancelar hipótese
          await supabase.from("hipoteses_registro")
            .update({ status: "cancelada" })
            .eq("id", hipotesePendente.id);
          
          // Cancelar action vinculada
          if (hipotesePendente.dados?.action_id) {
            await cancelarActionPendente(hipotesePendente.dados.action_id, userId);
          }
        }
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Sem problemas! 👍 Já descartei.\n\nMe conta novamente como foi.",
          payload.messageSource
        );
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: "[BOTÃO NÃO]",
          ai_response: "[CANCELADO_BOTAO]",
          tipo: "cancelamento_botao"
        });
        
        return;
      }
      
      // ====================================================================
      // BATCH_SEPARATE - Registrar gastos separadamente
      // ====================================================================
      if (payload.buttonReplyId === "batch_separate") {
        const pending = await consumirPendingSelection(userId, "batch_expense");
        
        if (!pending || pending.options.length === 0) {
          await sendWhatsAppMessage(
            payload.phoneNumber,
            "Essa seleção expirou 😕\n\nMe conta de novo os gastos.",
            payload.messageSource
          );
          return;
        }
        
        console.log(`✂️ [BATCH] Registrando ${pending.options.length} itens SEPARADOS`);
        
        const resultados: string[] = [];
        
        for (const opt of pending.options) {
          const meta = opt.meta as { valor: number; descricao: string; categoria: string };
          // APLICAR INFERÊNCIA SEMÂNTICA - "outros" é último recurso
          const categoriaInferida = inferirCategoria(meta.descricao, meta.categoria);
          const intentItem: ExtractedIntent = {
            intent: "registrar_gasto",
            valor: meta.valor,
            descricao: meta.descricao,
            categoria: categoriaInferida
          };
          
          const resultado = await registrarTransacaoIdempotente(userId, intentItem, eventoId);
          if (resultado.sucesso) {
            resultados.push(`✅ R$ ${meta.valor.toFixed(2)} - ${meta.descricao}`);
          } else if (resultado.jaDuplicado) {
            resultados.push(`🔒 R$ ${meta.valor.toFixed(2)} - ${meta.descricao} (já registrado)`);
          }
        }
        
        const msgFinal = `*${pending.options.length} gastos registrados!*\n\n${resultados.join("\n")}`;
        await sendWhatsAppMessage(payload.phoneNumber, msgFinal, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: "[BOTÃO SEPARADOS]",
          ai_response: msgFinal,
          tipo: "batch_separate"
        });
        
        return;
      }
      
      // ====================================================================
      // BATCH_SINGLE - Registrar como gasto único
      // ====================================================================
      if (payload.buttonReplyId === "batch_single") {
        const pending = await consumirPendingSelection(userId, "batch_expense");
        
        if (!pending || pending.options.length === 0) {
          await sendWhatsAppMessage(
            payload.phoneNumber,
            "Essa seleção expirou 😕\n\nMe conta de novo os gastos.",
            payload.messageSource
          );
          return;
        }
        
        console.log(`➕ [BATCH] Registrando como ÚNICO`);
        
        // Somar todos os valores e juntar descrições
        let somaTotal = 0;
        const descricoes: string[] = [];
        
        for (const opt of pending.options) {
          const meta = opt.meta as { valor: number; descricao: string; categoria: string };
          somaTotal += meta.valor;
          descricoes.push(meta.descricao);
        }
        
        // Inferir categoria do gasto combinado
        const categoriaInferida = inferirCategoria(descricoes.join(" "), "outros");
        
        const intentUnico: ExtractedIntent = {
          intent: "registrar_gasto",
          valor: somaTotal,
          descricao: descricoes.join(" + "),
          categoria: categoriaInferida
        };
        
        const resultado = await registrarTransacaoIdempotente(userId, intentUnico, eventoId);
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: "[BOTÃO ÚNICO]",
          ai_response: resultado.mensagem,
          tipo: "batch_single"
        });
        
        return;
      }
      
      // Outro botão não reconhecido
      console.log(`⚠️ [BUTTON] Botão não reconhecido: ${payload.buttonReplyId}`);
    }
    
    // ========================================================================
    // VERIFICAR HIPÓTESE PENDENTE (TEXTO)
    // ========================================================================
    const hipotesePendente = await buscarHipotesePendente(userId);
    
    if (hipotesePendente && payload.messageType === "text" && !payload.buttonReplyId) {
      const msg = payload.messageText.toLowerCase().trim();
      
      // Confirmar via texto
      if (/^(sim|s|ok|pode|isso|certo|exato|blz|beleza|perfeito)$/.test(msg) || /isso mesmo|pode salvar|^registra$/.test(msg)) {
        // Verificar se tem action vinculada
        if (hipotesePendente.dados?.action_id) {
          const resultado = await executarActionConfirmada(hipotesePendente.dados.action_id, userId);
          
          await supabase.from("hipoteses_registro")
            .update({ status: resultado.sucesso ? "confirmada" : "erro" })
            .eq("id", hipotesePendente.id);
          
          await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber,
            user_id: userId,
            user_message: payload.messageText,
            ai_response: resultado.mensagem,
            tipo: resultado.jaDuplicado ? "duplicado_bloqueado" : "registro_confirmado"
          });
          
          return;
        }
        
        // Fallback: registrar diretamente (compatibilidade)
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
          tipo: resultado.jaDuplicado ? "duplicado_bloqueado" : "registro_confirmado"
        });
        
        return;
      }
      
      // Cancelar via texto
      if (/^(não|nao|n)$/.test(msg) || /^cancela|^para|^deixa|deixa pra l/.test(msg)) {
        await supabase.from("hipoteses_registro")
          .update({ status: "cancelada" })
          .eq("id", hipotesePendente.id);
        
        // Cancelar action vinculada se existir
        if (hipotesePendente.dados?.action_id) {
          await cancelarActionPendente(hipotesePendente.dados.action_id, userId);
        }
        
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
    // VERIFICAR ACTION ATIVA DE CARTÕES (PRIORIDADE SOBRE INTERPRETAÇÃO)
    // ========================================================================
    const { data: cardActionActive } = await supabase
      .from("actions")
      .select("*")
      .eq("user_id", userId)
      .eq("action_type", "card_management")
      .in("status", ["awaiting_decision", "awaiting_input"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    if (cardActionActive && payload.messageType === "text") {
      console.log(`🃏 [CARD] Action ativa encontrada: ${cardActionActive.id} - step: ${(cardActionActive.meta as any)?.step}`);
      
      const meta = cardActionActive.meta as { step?: string; card_id?: string; card_name?: string };
      const msg = payload.messageText.trim();
      const opcao = parseInt(msg);
      
      // STEP: choose_action - Usuário responde com número
      if (meta.step === "choose_action") {
        if (opcao === 1) {
          // Ver cartões cadastrados
          const { data: cartoes } = await supabase
            .from("cartoes_credito")
            .select("*")
            .eq("usuario_id", userId)
            .eq("ativo", true);
          
          if (!cartoes || cartoes.length === 0) {
            await sendWhatsAppMessage(
              payload.phoneNumber,
              "Você ainda não tem cartões cadastrados 💳\n\n👉 Quer adicionar um agora? Me diz o nome do cartão.",
              payload.messageSource
            );
            
            await supabase.from("actions")
              .update({ 
                meta: { step: "awaiting_card_name" }, 
                status: "awaiting_input",
                updated_at: new Date().toISOString() 
              })
              .eq("id", cardActionActive.id);
            
            return;
          }
          
          const listaCartoes = cartoes.map((c, i) => 
            `${i + 1}. *${c.nome}*\n   Limite: R$ ${Number(c.limite_total || 0).toFixed(2)}\n   Disponível: R$ ${Number(c.limite_disponivel || 0).toFixed(2)}\n   Vencimento: dia ${c.dia_vencimento}`
          ).join("\n\n");
          
          await sendWhatsAppMessage(
            payload.phoneNumber,
            `*Seus cartões* 💳\n\n${listaCartoes}`,
            payload.messageSource
          );
          
          // Marcar action como done
          await supabase.from("actions")
            .update({ status: "done", updated_at: new Date().toISOString() })
            .eq("id", cardActionActive.id);
          
          return;
          
        } else if (opcao === 2) {
          // Adicionar novo cartão
          await sendWhatsAppMessage(
            payload.phoneNumber,
            "Legal! 💳 Qual é o nome do cartão? (Ex: Nubank, C6, Itaú...)",
            payload.messageSource
          );
          
          await supabase.from("actions")
            .update({ 
              meta: { step: "awaiting_card_name" }, 
              status: "awaiting_input",
              updated_at: new Date().toISOString() 
            })
            .eq("id", cardActionActive.id);
          
          return;
          
        } else if (opcao === 3) {
          // Atualizar cartão
          const { data: cartoes } = await supabase
            .from("cartoes_credito")
            .select("*")
            .eq("usuario_id", userId)
            .eq("ativo", true);
          
          if (!cartoes || cartoes.length === 0) {
            await sendWhatsAppMessage(
              payload.phoneNumber,
              "Você não tem cartões para atualizar 🤔\n\n👉 Quer adicionar um? Me diz o nome.",
              payload.messageSource
            );
            
            await supabase.from("actions")
              .update({ 
                meta: { step: "awaiting_card_name" }, 
                status: "awaiting_input",
                updated_at: new Date().toISOString() 
              })
              .eq("id", cardActionActive.id);
            
            return;
          }
          
          const listaCartoes = cartoes.map((c, i) => `${i + 1}. ${c.nome}`).join("\n");
          
          // Criar pending selection para escolha
          const cardOptions = cartoes.map((c, i) => ({
            index: i + 1,
            tx_id: c.id,
            label: c.nome || "Sem nome",
            meta: { card_id: c.id, card_name: c.nome }
          }));
          
          await criarPendingSelection(userId, cardOptions, "card_update_selection", 3);
          
          await sendWhatsAppMessage(
            payload.phoneNumber,
            `Qual cartão você quer atualizar?\n\n${listaCartoes}\n\n_Responde com o número_`,
            payload.messageSource
          );
          
          await supabase.from("actions")
            .update({ 
              meta: { step: "awaiting_card_selection_update" }, 
              status: "awaiting_input",
              updated_at: new Date().toISOString() 
            })
            .eq("id", cardActionActive.id);
          
          return;
          
        } else if (opcao === 4) {
          // Remover cartão
          const { data: cartoes } = await supabase
            .from("cartoes_credito")
            .select("*")
            .eq("usuario_id", userId)
            .eq("ativo", true);
          
          if (!cartoes || cartoes.length === 0) {
            await sendWhatsAppMessage(
              payload.phoneNumber,
              "Você não tem cartões para remover 🤔",
              payload.messageSource
            );
            
            await supabase.from("actions")
              .update({ status: "done", updated_at: new Date().toISOString() })
              .eq("id", cardActionActive.id);
            
            return;
          }
          
          const listaCartoes = cartoes.map((c, i) => `${i + 1}. ${c.nome}`).join("\n");
          
          const cardOptions = cartoes.map((c, i) => ({
            index: i + 1,
            tx_id: c.id,
            label: c.nome || "Sem nome",
            meta: { card_id: c.id, card_name: c.nome }
          }));
          
          await criarPendingSelection(userId, cardOptions, "card_remove_selection", 3);
          
          await sendWhatsAppMessage(
            payload.phoneNumber,
            `Qual cartão você quer remover?\n\n${listaCartoes}\n\n_Responde com o número_`,
            payload.messageSource
          );
          
          await supabase.from("actions")
            .update({ 
              meta: { step: "awaiting_card_selection_remove" }, 
              status: "awaiting_input",
              updated_at: new Date().toISOString() 
            })
            .eq("id", cardActionActive.id);
          
          return;
        }
        
        // Opção inválida
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Responde com 1, 2, 3 ou 4 😊",
          payload.messageSource
        );
        return;
      }
      
      // STEP: awaiting_card_name - Usuário digitou nome do cartão
      if (meta.step === "awaiting_card_name") {
        const nomeCarto = msg;
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          `*${nomeCarto}* 👍\n\nAgora me diz o limite total do cartão.\n\n_Ex: 5000_`,
          payload.messageSource
        );
        
        await supabase.from("actions")
          .update({ 
            meta: { step: "awaiting_card_limit", card_name: nomeCarto }, 
            updated_at: new Date().toISOString() 
          })
          .eq("id", cardActionActive.id);
        
        return;
      }
      
      // STEP: awaiting_card_limit - Usuário digitou limite
      if (meta.step === "awaiting_card_limit") {
        const limiteStr = msg.replace(/[^\d.,]/g, "").replace(",", ".");
        const limite = parseFloat(limiteStr);
        
        if (isNaN(limite) || limite <= 0) {
          await sendWhatsAppMessage(
            payload.phoneNumber,
            "Não entendi o limite 🤔\n\nDigita só o número. Ex: 5000",
            payload.messageSource
          );
          return;
        }
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          `Limite de R$ ${limite.toFixed(2)} 💳\n\nQual o dia de vencimento da fatura?\n\n_Ex: 10_`,
          payload.messageSource
        );
        
        await supabase.from("actions")
          .update({ 
            meta: { ...meta, step: "awaiting_card_due_day", card_limit: limite }, 
            updated_at: new Date().toISOString() 
          })
          .eq("id", cardActionActive.id);
        
        return;
      }
      
      // STEP: awaiting_card_due_day - Usuário digitou dia de vencimento
      if (meta.step === "awaiting_card_due_day") {
        const diaVenc = parseInt(msg);
        
        if (isNaN(diaVenc) || diaVenc < 1 || diaVenc > 31) {
          await sendWhatsAppMessage(
            payload.phoneNumber,
            "Dia inválido 🤔\n\nDigita um número de 1 a 31.",
            payload.messageSource
          );
          return;
        }
        
        // Criar cartão
        const metaAtual = cardActionActive.meta as any;
        
        const { data: novoCartao, error: cardError } = await supabase
          .from("cartoes_credito")
          .insert({
            usuario_id: userId,
            nome: metaAtual.card_name,
            limite_total: metaAtual.card_limit,
            limite_disponivel: metaAtual.card_limit,
            dia_vencimento: diaVenc,
            dia_fechamento: diaVenc > 5 ? diaVenc - 5 : 25,
            ativo: true
          })
          .select("id")
          .single();
        
        if (cardError) {
          console.error("❌ [CARD] Erro ao criar:", cardError);
          await sendWhatsAppMessage(
            payload.phoneNumber,
            "Algo deu errado ao criar o cartão 😕\n\nTenta de novo?",
            payload.messageSource
          );
          return;
        }
        
        await supabase.from("actions")
          .update({ 
            status: "done", 
            entity_id: novoCartao.id,
            updated_at: new Date().toISOString() 
          })
          .eq("id", cardActionActive.id);
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          `✅ *Cartão adicionado!*\n\n` +
          `💳 *${metaAtual.card_name}*\n` +
          `💰 Limite: R$ ${metaAtual.card_limit.toFixed(2)}\n` +
          `📅 Vencimento: dia ${diaVenc}`,
          payload.messageSource
        );
        
        return;
      }
      
      // Se chegou aqui com action ativa mas não tratou, encerrar
      await supabase.from("actions")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", cardActionActive.id);
    }
    
    // ========================================================================
    // VERIFICAR PENDING SELECTION (CARTÕES - UPDATE)
    // ========================================================================
    const pendingCardUpdate = await consumirPendingSelection(userId, "card_update_selection");
    
    if (pendingCardUpdate && payload.messageType === "text") {
      const opcao = parseInt(payload.messageText.trim());
      
      if (!isNaN(opcao) && opcao >= 1 && opcao <= pendingCardUpdate.options.length) {
        const selected = pendingCardUpdate.options[opcao - 1];
        const cardMeta = selected.meta as { card_id: string; card_name: string };
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          `O que você quer atualizar no *${cardMeta.card_name}*?\n\n1. Limite\n2. Dia de vencimento\n3. Nome\n\n_Responde com o número_`,
          payload.messageSource
        );
        
        // Criar nova pending selection para escolha de campo
        await criarPendingSelection(userId, [
          { index: 1, label: "Limite", meta: { card_id: cardMeta.card_id, field: "limite" } },
          { index: 2, label: "Dia de vencimento", meta: { card_id: cardMeta.card_id, field: "vencimento" } },
          { index: 3, label: "Nome", meta: { card_id: cardMeta.card_id, field: "nome" } },
        ], "card_field_selection", 3);
        
        return;
      }
    }
    
    // ========================================================================
    // VERIFICAR PENDING SELECTION (CARTÕES - REMOVER)
    // ========================================================================
    const pendingCardRemove = await consumirPendingSelection(userId, "card_remove_selection");
    
    if (pendingCardRemove && payload.messageType === "text") {
      const opcao = parseInt(payload.messageText.trim());
      
      if (!isNaN(opcao) && opcao >= 1 && opcao <= pendingCardRemove.options.length) {
        const selected = pendingCardRemove.options[opcao - 1];
        const cardMeta = selected.meta as { card_id: string; card_name: string };
        
        // Desativar cartão
        await supabase
          .from("cartoes_credito")
          .update({ ativo: false })
          .eq("id", cardMeta.card_id);
        
        await sendWhatsAppMessage(
          payload.phoneNumber,
          `✅ Cartão *${cardMeta.card_name}* removido!`,
          payload.messageSource
        );
        
        return;
      }
    }
    
    // ========================================================================
    // PROCESSAR MÍDIA
    // ========================================================================
    let conteudoProcessado = payload.messageText;
    let confianca = 0.9;
    
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
    
    // IMAGEM
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
      
      // Imagem sempre cria hipótese + action para confirmação
      const { hipoteseId, actionId } = await criarHipotese(userId, eventoId, analise.dados, analise.confianca);
      
      if (!hipoteseId) {
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Algo deu errado ao processar a imagem 😕\n\n👉 Tenta de novo?",
          payload.messageSource
        );
        return;
      }
      
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
    // INTERPRETAÇÃO IA (APENAS INTERPRETA)
    // ========================================================================
    const { intent: interpretacao, confianca: confIA } = await interpretarMensagem(conteudoProcessado, "");
    
    console.log(`🎯 [WORKER] Intent: ${interpretacao.intent} | Valor: ${interpretacao.valor} | Conf: ${confIA}`);
    
    // ========================================================================
    // MOTOR DE DECISÃO
    // ========================================================================
    
    // CANCELAR TRANSAÇÃO
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
    
    // ========================================================================
    // GERENCIAR CARTÕES (CRIAR ACTION PERSISTENTE)
    // ========================================================================
    if (interpretacao.intent === "gerenciar_cartoes") {
      console.log("🃏 [CARD] Intent gerenciar_cartoes detectado");
      
      // Expirar actions de cartões antigas do usuário
      await supabase
        .from("actions")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("action_type", "card_management")
        .in("status", ["awaiting_decision", "awaiting_input"]);
      
      // Criar NOVA action para gerenciamento de cartões
      const actionHash = `card_mgmt_${userId.slice(0,8)}_${Date.now()}`;
      
      const { data: actionData, error: actionError } = await supabase
        .from("actions")
        .insert({
          user_id: userId,
          action_type: "card_management",
          action_hash: actionHash,
          status: "awaiting_decision",
          meta: { step: "choose_action" }
        })
        .select("id")
        .single();
      
      if (actionError) {
        console.error("❌ [CARD] Erro ao criar action:", actionError);
        await sendWhatsAppMessage(
          payload.phoneNumber,
          "Algo deu errado ao iniciar o gerenciamento de cartões 😕\n\nTenta de novo?",
          payload.messageSource
        );
        return;
      }
      
      console.log(`✅ [CARD] Action criada: ${actionData.id}`);
      
      const msgCartoes = `Claro! O que você deseja fazer com seus cartões? 💳\n\n` +
        `1️⃣ Ver cartões cadastrados\n` +
        `2️⃣ Adicionar novo cartão\n` +
        `3️⃣ Atualizar cartão existente\n` +
        `4️⃣ Remover cartão\n\n` +
        `_Responde com o número_`;
      
      await sendWhatsAppMessage(payload.phoneNumber, msgCartoes, payload.messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: payload.messageText,
        ai_response: msgCartoes,
        tipo: "card_management"
      });
      
      return;
    }
    
    // REGISTRAR GASTO/ENTRADA
    if (["registrar_gasto", "registrar_entrada"].includes(interpretacao.intent)) {
      const temValor = interpretacao.valor && interpretacao.valor > 0;
      const temItens = interpretacao.itens && interpretacao.itens.length > 1;
      const splitExplicit = interpretacao.split_explicit === true;
      const aggregateExplicit = interpretacao.aggregate_explicit === true;
      
      // ====================================================================
      // CASO 1: MÚLTIPLOS ITENS DETECTADOS
      // ====================================================================
      if (temItens) {
        const itens = interpretacao.itens!;
        const somaTotal = itens.reduce((acc, i) => acc + i.valor, 0);
        
        console.log(`📦 [MULTI] ${itens.length} itens | Split: ${splitExplicit} | Aggregate: ${aggregateExplicit}`);
        
        // CASO 1A: Usuário pediu explicitamente "registre separadamente"
        if (splitExplicit) {
          console.log(`✂️ [MULTI] Registrando ${itens.length} itens SEPARADOS (explícito)`);
          
          let todosOk = true;
          const resultados: string[] = [];
          
          for (const item of itens) {
            const intentItem: ExtractedIntent = {
              intent: "registrar_gasto",
              valor: item.valor,
              descricao: item.descricao,
              categoria: item.categoria || "outros"
            };
            
            const resultado = await registrarTransacaoIdempotente(userId, intentItem, eventoId);
            if (resultado.sucesso) {
              resultados.push(`✅ R$ ${item.valor.toFixed(2)} - ${item.descricao}`);
            } else if (resultado.jaDuplicado) {
              resultados.push(`🔒 R$ ${item.valor.toFixed(2)} - ${item.descricao} (já registrado)`);
            } else {
              todosOk = false;
            }
          }
          
          const msgFinal = `*${itens.length} gastos registrados!*\n\n${resultados.join("\n")}`;
          await sendWhatsAppMessage(payload.phoneNumber, msgFinal, payload.messageSource);
          
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber,
            user_id: userId,
            user_message: conteudoProcessado,
            ai_response: msgFinal,
            tipo: "registro_multiplo_separado"
          });
          
          return;
        }
        
        // CASO 1B: Usuário indicou como um único gasto
        if (aggregateExplicit) {
          console.log(`➕ [MULTI] Registrando como ÚNICO (explícito)`);
          
          const descricaoComposta = itens.map(i => i.descricao).join(" + ");
          const intentUnico: ExtractedIntent = {
            intent: "registrar_gasto",
            valor: somaTotal,
            descricao: descricaoComposta,
            categoria: interpretacao.categoria || "outros"
          };
          
          const resultado = await registrarTransacaoIdempotente(userId, intentUnico, eventoId);
          await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
          
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber,
            user_id: userId,
            user_message: conteudoProcessado,
            ai_response: resultado.mensagem,
            tipo: resultado.jaDuplicado ? "duplicado_bloqueado" : "registro_unico_agregado"
          });
          
          return;
        }
        
        // CASO 1C: AMBÍGUO → Pedir confirmação em lote
        console.log(`❓ [MULTI] Ambíguo - pedindo confirmação em lote`);
        
        // Criar pending selection para os itens
        const batchOptions = itens.map((item, idx) => ({
          index: idx + 1,
          label: `R$ ${item.valor.toFixed(2)} - ${item.descricao}`,
          meta: { valor: item.valor, descricao: item.descricao, categoria: item.categoria || "outros" }
        }));
        
        await criarPendingSelection(userId, batchOptions, "batch_expense", 3);
        
        // Montar lista de itens
        const listaItens = itens.map((item, idx) => 
          `${idx + 1}️⃣ ${item.descricao} — R$ ${item.valor.toFixed(2)}`
        ).join("\n");
        
        const msgBatch = `Identifiquei *${itens.length} gastos* 👇\n\n` +
          `${listaItens}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `*Total: R$ ${somaTotal.toFixed(2)}*\n\n` +
          `Como você prefere registrar?`;
        
        // WhatsApp só permite 3 botões, então adaptamos
        await sendWhatsAppButtons(
          payload.phoneNumber,
          msgBatch,
          [
            { id: "batch_separate", title: "✂️ Separados" },
            { id: "batch_single", title: `➕ Único (R$ ${somaTotal.toFixed(2)})`.slice(0, 20) },
            { id: "confirm_no", title: "❌ Cancelar" }
          ],
          payload.messageSource
        );
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: conteudoProcessado,
          ai_response: msgBatch,
          tipo: "batch_confirmation"
        });
        
        return;
      }
      
      // ====================================================================
      // CASO 2: GASTO ÚNICO (FLUXO NORMAL)
      // ====================================================================
      
      // DADOS SUFICIENTES + ALTA CONFIANÇA → REGISTRA DIRETO
      if (temValor && confIA >= 0.7) {
        const resultado = await registrarTransacaoIdempotente(userId, interpretacao, eventoId);
        
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: conteudoProcessado,
          ai_response: resultado.mensagem,
          tipo: resultado.jaDuplicado ? "duplicado_bloqueado" : "registro_direto"
        });
        
        return;
      }
      
      // DADOS COMPLETOS + MÉDIA CONFIANÇA → CRIAR HIPÓTESE COM ACTION
      if (temValor && confIA >= 0.5) {
        const { hipoteseId, actionId } = await criarHipotese(userId, eventoId, interpretacao, confIA);
        
        const msgConfirmacao = `Entendi assim 👇\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💸 *Gasto*: R$ ${interpretacao.valor?.toFixed(2)}\n` +
          (interpretacao.descricao ? `📝 *O quê*: ${interpretacao.descricao}\n` : "") +
          (interpretacao.categoria ? `📂 *Categoria*: ${interpretacao.categoria}\n` : "") +
          `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Posso registrar?`;
        
        // Enviar com botões se Meta, senão texto
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
          user_message: conteudoProcessado,
          ai_response: msgConfirmacao,
          tipo: "hipotese_pendente"
        });
        
        return;
      }
      
      // FALTA DADOS → PERGUNTAR
      const pergunta = !temValor
        ? `Entendi: *${interpretacao.descricao || "um gasto"}* 👍\n\n👉 Qual foi o valor?`
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
        const nextRetry = new Date(Date.now() + Math.pow(2, newAttempts) * 1000);
        
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
