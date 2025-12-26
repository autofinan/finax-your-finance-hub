import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// 🧠 FINAX - ARQUITETURA INQUEBRÁVEL v2.0
// ============================================================================
//
// CORREÇÕES APLICADAS:
// ✅ Guard clause em downloadWhatsAppMedia (nunca baixa 2x)
// ✅ Try/catch global sempre retorna 200
// ✅ Flag interpretado (uma interpretação por evento)
// ✅ Estado conversacional real com lock
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

// WhatsApp Business API (Meta)
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

// Vonage (Sandbox)
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 TIPOS E INTERFACES
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
}

interface ExtractedIntent {
  intent: 
    | "registrar_gasto" 
    | "registrar_entrada" 
    | "criar_parcelamento" 
    | "criar_recorrente"
    | "consultar_resumo"
    | "cancelar_transacao"
    | "iniciar_organizacao"
    | "saudacao"
    | "ajuda"
    | "outro";
  valor?: number;
  categoria?: string;
  descricao?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  parcelas?: number;
  tipo_recorrencia?: "mensal" | "semanal" | "anual";
  dia_mes?: number;
  transacao_alvo?: string;
}

interface DecisaoMotor {
  acao: "registrar_direto" | "criar_hipotese" | "perguntar" | "continuar_fluxo" | "responder_ia";
  dados?: any;
  pergunta?: string;
  motivo: string;
}

interface EstadoUsuario {
  modo: "onboarding" | "operacional";
  etapa_onboarding: string | null;
}

interface ConversaAtiva {
  id: string;
  tipo_operacao: string;
  estado: string;
  lock_acao: string | null;
  dados_coletados: any;
  ultimo_intent: string | null;
}

// ============================================================================
// 1️⃣ DEDUPE - NADA ACONTECE ANTES DISSO
// ============================================================================

async function verificarDedupe(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  
  const { data } = await supabase
    .from("processed_messages")
    .select("id")
    .eq("message_id", messageId)
    .maybeSingle();
  
  if (data) {
    console.log(`⚠️ [DEDUPE] Mensagem ${messageId} já processada - ignorando`);
    return true;
  }
  
  return false;
}

async function marcarProcessada(messageId: string, phoneNumber: string, source: string): Promise<void> {
  if (!messageId) return;
  
  try {
    await supabase.from("processed_messages").insert({
      message_id: messageId,
      phone_number: phoneNumber,
      source: source
    });
    console.log(`✅ [DEDUPE] Mensagem ${messageId} marcada como processada`);
  } catch (e) {
    // Ignora erro de duplicata (já existe)
    console.log(`⚠️ [DEDUPE] Mensagem ${messageId} já existe ou erro:`, e);
  }
}

// ============================================================================
// 2️⃣ EVENTO BRUTO - SALVAR TUDO SEM PENSAR
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
        interpretado: false
      })
      .select("id")
      .single();
    
    if (error) {
      console.error("❌ [EVENTO_BRUTO] Erro ao salvar:", error);
      return null;
    }
    
    console.log(`📝 [EVENTO_BRUTO] Salvo: ${data.id}`);
    return data.id;
  } catch (e) {
    console.error("❌ [EVENTO_BRUTO] Exceção:", e);
    return null;
  }
}

async function atualizarEventoBruto(eventoId: string, interpretacao: any): Promise<void> {
  await supabase
    .from("eventos_brutos")
    .update({ interpretacao, status: "interpretado", interpretado: true })
    .eq("id", eventoId);
}

// ============================================================================
// 3️⃣ INTERPRETAÇÃO - IA INTERPRETA, NÃO DECIDE (COM GUARD CLAUSE)
// ============================================================================

async function verificarJaInterpretado(eventoId: string): Promise<{ jaInterpretado: boolean; interpretacao?: any }> {
  if (!eventoId) return { jaInterpretado: false };
  
  try {
    const { data } = await supabase
      .from("eventos_brutos")
      .select("interpretado, interpretacao")
      .eq("id", eventoId)
      .single();
    
    if (data?.interpretado && data?.interpretacao) {
      console.log(`⚠️ [INTERPRETAÇÃO] Evento ${eventoId} já interpretado - reutilizando`);
      return { jaInterpretado: true, interpretacao: data.interpretacao };
    }
  } catch (e) {
    console.log(`⚠️ [INTERPRETAÇÃO] Erro ao verificar evento:`, e);
  }
  
  return { jaInterpretado: false };
}

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
- "registrar_gasto": gasto/despesa (ex: "gastei 50 no mercado")
- "registrar_entrada": receita/entrada
- "criar_parcelamento": compra parcelada (em Xx)
- "criar_recorrente": gasto repetitivo mensal
- "consultar_resumo": resumo geral
- "cancelar_transacao": apagar algo
- "iniciar_organizacao": organizar cartões/finanças
- "saudacao": oi, olá, bom dia
- "ajuda": como funciona
- "outro": não financeiro

FORMAS DE PAGAMENTO:
- pix, dinheiro, debito, credito

CONFIANÇA (0 a 1):
- 0.9+: muito claro
- 0.7-0.9: provável
- 0.5-0.7: possível
- <0.5: incerto

Responda APENAS JSON:
{
  "intent": "string",
  "valor": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "forma_pagamento": "pix"|"dinheiro"|"debito"|"credito" ou null,
  "parcelas": number ou null,
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
    
    console.log(`🧠 [INTERPRETAÇÃO] Intent: ${parsed.intent}, Confiança: ${parsed.confianca}`);
    
    return {
      intent: parsed as ExtractedIntent,
      confianca: parsed.confianca || 0.5
    };
  } catch (error) {
    console.error("❌ [INTERPRETAÇÃO] Erro:", error);
    return { intent: { intent: "outro" }, confianca: 0.3 };
  }
}

// ============================================================================
// 4️⃣ MOTOR DE DECISÃO - AS 4 PERGUNTAS (COM ESTADO REAL)
// ============================================================================

async function salvarEstadoConversa(
  usuarioId: string,
  fluxo: string,
  etapa: string,
  dadosParciais: any
): Promise<void> {
  const expiraEm = new Date(Date.now() + 30 * 60 * 1000); // 30 min
  
  try {
    // Primeiro tenta atualizar
    const { data: existing } = await supabase
      .from("conversas_ativas")
      .select("id")
      .eq("usuario_id", usuarioId)
      .maybeSingle();
    
    if (existing) {
      await supabase.from("conversas_ativas")
        .update({
          tipo_operacao: fluxo,
          estado: etapa,
          lock_acao: fluxo,
          dados_coletados: dadosParciais,
          ultimo_intent: fluxo,
          expira_em: expiraEm.toISOString(),
          atualizado_em: new Date().toISOString()
        })
        .eq("usuario_id", usuarioId);
    } else {
      await supabase.from("conversas_ativas")
        .insert({
          usuario_id: usuarioId,
          tipo_operacao: fluxo,
          estado: etapa,
          lock_acao: fluxo,
          dados_coletados: dadosParciais,
          ultimo_intent: fluxo,
          expira_em: expiraEm.toISOString(),
          atualizado_em: new Date().toISOString()
        });
    }
    console.log(`💾 [ESTADO] Salvo: ${fluxo} -> ${etapa}`);
  } catch (e) {
    console.error(`❌ [ESTADO] Erro ao salvar:`, e);
  }
}

async function limparEstadoConversa(usuarioId: string): Promise<void> {
  try {
    await supabase.from("conversas_ativas")
      .delete()
      .eq("usuario_id", usuarioId);
    console.log(`🧹 [ESTADO] Limpo para ${usuarioId}`);
  } catch (e) {
    console.error(`❌ [ESTADO] Erro ao limpar:`, e);
  }
}

async function motorDecisao(
  interpretacao: ExtractedIntent,
  confianca: number,
  origem: TipoMidia,
  estadoUsuario: EstadoUsuario,
  conversaAtiva: ConversaAtiva | null,
  usuarioId: string
): Promise<DecisaoMotor> {
  
  // PERGUNTA 1: O que o usuário quer?
  const intencao = interpretacao.intent;
  console.log(`🔍 [MOTOR] P1 - Intenção: ${intencao}`);
  
  // PERGUNTA 2: Tenho informação suficiente?
  const temValor = !!interpretacao.valor && interpretacao.valor > 0;
  const temDescricao = !!interpretacao.descricao;
  let dadosCompletos = temValor && temDescricao;
  console.log(`🔍 [MOTOR] P2 - Dados completos: ${dadosCompletos} (valor: ${temValor}, desc: ${temDescricao})`);
  
  // PERGUNTA 3: É continuidade ou novo? (COM MERGE DE DADOS)
  const temLock = !!conversaAtiva?.lock_acao;
  const mesmoFluxo = conversaAtiva?.tipo_operacao?.includes("registrar") && 
                     (intencao === "registrar_gasto" || intencao === "registrar_entrada");
  const ehContinuidade = temLock && mesmoFluxo;
  console.log(`🔍 [MOTOR] P3 - Continuidade: ${ehContinuidade} (lock: ${temLock}, mesmoFluxo: ${mesmoFluxo})`);
  
  // Se é continuidade, mesclar dados antigos com novos
  let dadosMesclados = { ...interpretacao };
  if (ehContinuidade && conversaAtiva?.dados_coletados) {
    const dadosAntigos = conversaAtiva.dados_coletados;
    dadosMesclados = {
      ...dadosAntigos,
      ...interpretacao,
      // Preservar valor/descricao antigos se novos estão vazios
      valor: interpretacao.valor || dadosAntigos.valor,
      descricao: interpretacao.descricao || dadosAntigos.descricao,
      categoria: interpretacao.categoria || dadosAntigos.categoria,
      forma_pagamento: interpretacao.forma_pagamento || dadosAntigos.forma_pagamento
    };
    console.log(`🔄 [MOTOR] Dados mesclados:`, JSON.stringify(dadosMesclados));
    
    // Recalcular se dados estão completos
    const temValorMesclado = !!dadosMesclados.valor && dadosMesclados.valor > 0;
    const temDescricaoMesclada = !!dadosMesclados.descricao;
    dadosCompletos = temValorMesclado && temDescricaoMesclada;
    console.log(`🔍 [MOTOR] P2 (mesclado) - Dados completos: ${dadosCompletos}`);
  }
  
  // PERGUNTA 4: O que ajuda MAIS agora?
  
  // Intents que não são de registro
  if (["saudacao", "ajuda", "consultar_resumo", "cancelar_transacao", "iniciar_organizacao", "outro"].includes(intencao)) {
    // Limpar estado de conversa se existir
    if (temLock) {
      await limparEstadoConversa(usuarioId);
    }
    return {
      acao: "responder_ia",
      dados: interpretacao,
      motivo: `intent_${intencao}`
    };
  }
  
  // TEXTO DIGITADO - CONFIANÇA ALTA POR PADRÃO
  if (origem === "text") {
    // Dados completos → REGISTRA DIRETO
    if (dadosCompletos && confianca >= 0.7) {
      await limparEstadoConversa(usuarioId);
      return {
        acao: "registrar_direto",
        dados: dadosMesclados,
        motivo: ehContinuidade ? "texto_continuidade_completa" : "texto_completo_alta_confianca"
      };
    }
    
    // Falta dados → PERGUNTA UMA COISA SÓ + SALVAR ESTADO
    if (!dadosCompletos) {
      const faltando = !dadosMesclados.valor ? "valor" : "descricao";
      
      // Salvar estado para continuidade
      await salvarEstadoConversa(usuarioId, intencao, `aguardando_${faltando}`, dadosMesclados);
      
      return {
        acao: "perguntar",
        dados: dadosMesclados,
        pergunta: faltando === "valor" 
          ? `Entendi: *${dadosMesclados.descricao}* 👍\n\n👉 Qual foi o valor?`
          : `Vi *R$ ${dadosMesclados.valor?.toFixed(2)}* 💰\n\n👉 O que foi essa compra?`,
        motivo: `texto_falta_${faltando}`
      };
    }
    
    // Confiança média → CONFIRMA
    return {
      acao: "criar_hipotese",
      dados: dadosMesclados,
      motivo: "texto_confianca_media"
    };
  }
  
  // ÁUDIO - CONFIANÇA MÉDIA
  if (origem === "audio") {
    // Confiança alta + dados completos → REGISTRA
    if (confianca >= 0.85 && dadosCompletos) {
      await limparEstadoConversa(usuarioId);
      return {
        acao: "registrar_direto",
        dados: dadosMesclados,
        motivo: "audio_alta_confianca"
      };
    }
    
    // Confiança média → CONFIRMA
    if (confianca >= 0.5 && dadosCompletos) {
      return {
        acao: "criar_hipotese",
        dados: dadosMesclados,
        motivo: "audio_media_confianca"
      };
    }
    
    // Falta dados → PERGUNTA + SALVAR ESTADO
    if (!dadosCompletos) {
      const faltando = !dadosMesclados.valor ? "valor" : "descricao";
      
      await salvarEstadoConversa(usuarioId, intencao, `aguardando_${faltando}`, dadosMesclados);
      
      return {
        acao: "perguntar",
        dados: dadosMesclados,
        pergunta: faltando === "valor"
          ? `Ouvi: *${dadosMesclados.descricao}* 🎤\n\n👉 Qual foi o valor?`
          : `Ouvi *R$ ${dadosMesclados.valor?.toFixed(2)}* 🎤\n\n👉 O que foi?`,
        motivo: `audio_falta_${faltando}`
      };
    }
    
    return {
      acao: "criar_hipotese",
      dados: dadosMesclados,
      motivo: "audio_fallback"
    };
  }
  
  // IMAGEM - CONFIANÇA BAIXA POR PADRÃO
  if (origem === "image") {
    // Confiança alta → CONFIRMA (nunca registra direto de imagem)
    if (confianca >= 0.7 && dadosCompletos) {
      return {
        acao: "criar_hipotese",
        dados: dadosMesclados,
        motivo: "imagem_alta_confianca"
      };
    }
    
    // Confiança baixa ou dados incompletos → PERGUNTA
    return {
      acao: "perguntar",
      dados: dadosMesclados,
      pergunta: "Vi a imagem 📷\n\n👉 Me conta: *quanto foi* e *o que era*?",
      motivo: "imagem_baixa_confianca"
    };
  }
  
  // Fallback seguro
  return {
    acao: "criar_hipotese",
    dados: dadosMesclados,
    motivo: "fallback_seguro"
  };
}

// ============================================================================
// 5️⃣ EXECUÇÃO - AÇÕES DO SISTEMA
// ============================================================================

// Gera ID premium
function gerarIdTransacao(): string {
  const agora = new Date();
  const data = agora.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.floor(Math.random() * 9999).toString().padStart(4, "0");
  return `TRX-${data}-${random}`;
}

// Emoji por categoria
function getEmojiCategoria(categoria: string): string {
  const emojis: Record<string, string> = {
    alimentacao: "🍔", transporte: "🚗", moradia: "🏠", saude: "💊",
    educacao: "📚", lazer: "🎮", compras: "🛒", servicos: "🔧",
    mercado: "🛒", restaurante: "🍽️", uber: "🚕", ifood: "🍕",
    streaming: "📺", salario: "💼", freelance: "💻", investimentos: "📈",
    outros: "📦"
  };
  return emojis[categoria?.toLowerCase()] || "📦";
}

// Formata pagamento
function formatarFormaPagamento(forma?: string): string {
  if (!forma) return "";
  const formas: Record<string, string> = {
    pix: "Pix", dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito"
  };
  return formas[forma] || forma;
}

// Registra transação DIRETAMENTE
async function registrarTransacaoDireto(
  usuarioId: string,
  dados: ExtractedIntent,
  eventoId: string | null
): Promise<{ sucesso: boolean; mensagem: string }> {
  const transacaoId = gerarIdTransacao();
  const agora = new Date();
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const tipoTransacao = dados.intent === "registrar_entrada" ? "entrada" : "saida";
  const categoria = dados.categoria || "outros";
  
  const { error } = await supabase.from("transacoes").insert({
    usuario_id: usuarioId,
    valor: dados.valor,
    categoria: categoria,
    tipo: tipoTransacao,
    descricao: dados.descricao,
    observacao: dados.descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    forma_pagamento: dados.forma_pagamento
  });
  
  if (error) {
    console.error("❌ [REGISTRO] Erro:", error);
    return {
      sucesso: false,
      mensagem: "Hmm, algo deu errado ao salvar 😕\n\nVamos tentar de novo? Me conta o gasto novamente."
    };
  }
  
  // Atualiza evento bruto
  if (eventoId) {
    await supabase.from("eventos_brutos")
      .update({ status: "registrado" })
      .eq("id", eventoId);
  }
  
  const emojiCategoria = getEmojiCategoria(categoria);
  const formaPagamento = formatarFormaPagamento(dados.forma_pagamento);
  const sinal = tipoTransacao === "entrada" ? "+" : "-";
  const tipoTexto = tipoTransacao === "entrada" ? "Entrada registrada" : "Gasto registrado";
  
  return {
    sucesso: true,
    mensagem: `✅ *${tipoTexto}!*\n\n` +
      `🧾 *Detalhes da transação #${transacaoId}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💸 Valor: *${sinal}R$ ${dados.valor?.toFixed(2)}*\n` +
      `📂 Categoria: ${emojiCategoria} ${categoria}\n` +
      (dados.descricao ? `📝 Descrição: ${dados.descricao}\n` : "") +
      (formaPagamento ? `💳 Pagamento: ${formaPagamento}\n` : "") +
      `📅 Data: ${dataFormatada} às ${horaFormatada}\n` +
      `🆔 ID: ${transacaoId}\n\n` +
      `_Se precisar corrigir algo, é só avisar 🙂_`
  };
}

// Cria hipótese e pede confirmação
async function criarHipoteseConfirmacao(
  phoneNumber: string,
  usuarioId: string,
  dados: ExtractedIntent,
  origem: TipoMidia,
  confianca: number
): Promise<string> {
  // Salva hipótese no histórico
  const hipotese = {
    origem,
    tipo_operacao: dados.intent === "registrar_entrada" ? "entrada" : "gasto",
    valor: dados.valor,
    descricao: dados.descricao,
    categoria: dados.categoria || "outros",
    forma_pagamento: dados.forma_pagamento,
    confianca,
    dados_faltantes: [],
    created_at: new Date().toISOString()
  };
  
  await supabase.from("historico_conversas").insert({
    phone_number: phoneNumber,
    user_id: usuarioId,
    user_message: `[HIPÓTESE] ${origem}`,
    ai_response: "[AGUARDANDO VALIDAÇÃO]",
    tipo: "hipotese_pendente",
    resumo: JSON.stringify(hipotese)
  });
  
  // Monta mensagem de confirmação premium
  const tipoTexto = dados.intent === "registrar_entrada" ? "Entrada" : "Gasto";
  const emoji = dados.intent === "registrar_entrada" ? "📈" : "💸";
  const emojiCategoria = getEmojiCategoria(dados.categoria || "outros");
  const formaPagamento = formatarFormaPagamento(dados.forma_pagamento);
  
  let msg = `Entendi assim 👇\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${emoji} *${tipoTexto}*: R$ ${dados.valor?.toFixed(2)}\n`;
  if (dados.descricao) msg += `📝 *O quê*: ${dados.descricao}\n`;
  if (dados.categoria) msg += `📂 *Categoria*: ${emojiCategoria} ${dados.categoria}\n`;
  if (formaPagamento) msg += `💳 *Pagamento*: ${formaPagamento}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Posso registrar? *Sim* ou *Não*`;
  
  return msg;
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
    console.error("[Meta] Erro ao enviar:", error);
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
    console.error("[Vonage] Erro ao enviar:", error);
    return false;
  }
}

async function sendWhatsAppMessage(to: string, text: string, source: MessageSource): Promise<boolean> {
  if (source === "vonage") return sendWhatsAppVonage(to, text);
  return sendWhatsAppMeta(to, text);
}

// ============================================================================
// 🎤 PROCESSAMENTO DE MÍDIA (COM GUARD CLAUSE - NUNCA BAIXA 2X)
// ============================================================================

async function downloadWhatsAppMedia(mediaId: string, eventoId?: string): Promise<string | null> {
  // GUARD CLAUSE 1: Verificar se já baixou
  if (eventoId) {
    try {
      const { data: evento } = await supabase
        .from("eventos_brutos")
        .select("media_downloaded, media_error")
        .eq("id", eventoId)
        .single();
      
      if (evento?.media_downloaded) {
        console.log(`⚠️ [MÍDIA] Evento ${eventoId} já teve mídia baixada anteriormente`);
        return null;
      }
      
      if (evento?.media_error) {
        console.log(`⚠️ [MÍDIA] Evento ${eventoId} teve erro anterior: ${evento.media_error}`);
        return null;
      }
    } catch (e) {
      console.log(`⚠️ [MÍDIA] Erro ao verificar evento:`, e);
    }
  }
  
  try {
    console.log(`🎵 [MÍDIA] Baixando ${mediaId}...`);
    
    const urlResponse = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } }
    );
    
    if (!urlResponse.ok) {
      const errorMsg = `URL fetch failed: ${urlResponse.status}`;
      if (eventoId) {
        await supabase.from("eventos_brutos")
          .update({ media_error: errorMsg })
          .eq("id", eventoId);
      }
      return null;
    }
    
    const urlData = await urlResponse.json();
    const mediaResponse = await fetch(urlData.url, {
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
    });
    
    if (!mediaResponse.ok) {
      const errorMsg = `Media fetch failed: ${mediaResponse.status}`;
      if (eventoId) {
        await supabase.from("eventos_brutos")
          .update({ media_error: errorMsg })
          .eq("id", eventoId);
      }
      return null;
    }
    
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    // SUCESSO: Marcar como baixada
    if (eventoId) {
      await supabase.from("eventos_brutos")
        .update({ media_downloaded: true })
        .eq("id", eventoId);
    }
    
    console.log(`✅ [MÍDIA] Baixada: ${base64.length} chars`);
    return base64;
  } catch (error) {
    // ERRO: Marcar o erro e NUNCA tentar de novo
    console.error("❌ [MÍDIA] Erro:", error);
    if (eventoId) {
      await supabase.from("eventos_brutos")
        .update({ media_error: String(error) })
        .eq("id", eventoId);
    }
    return null;
  }
}

async function transcreverAudio(audioBase64: string, mimeType: string): Promise<{ texto: string | null; confianca: number }> {
  try {
    console.log("🎤 [AUDIO] Transcrevendo via AssemblyAI...");
    
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
    
    console.log(`✅ [AUDIO] Transcrição: "${transcricao}" (conf: ${audioConfianca})`);
    return { texto: transcricao, confianca: audioConfianca };
  } catch (error) {
    console.error("❌ [AUDIO] Erro:", error);
    return { texto: null, confianca: 0 };
  }
}

async function extrairDadosImagem(imageBase64: string, mimeType: string): Promise<{ dados: ExtractedIntent | null; confianca: number }> {
  try {
    console.log("📷 [IMAGEM] Analisando...");
    
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
                text: `Analise esta imagem financeira e extraia:
- tipo: comprovante, fatura, nota_fiscal, extrato, outro
- valor: número
- descricao: o que foi
- forma_pagamento: pix, credito, debito, dinheiro
- confianca: 0 a 1

Responda APENAS JSON:
{
  "intent": "registrar_gasto",
  "valor": 150.00,
  "descricao": "Pagamento XYZ",
  "categoria": "outros",
  "forma_pagamento": "pix",
  "confianca": 0.85
}

Se não conseguir identificar como financeiro:
{"intent": "outro", "confianca": 0.1}`
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

    if (!response.ok) return { dados: null, confianca: 0 };

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"intent": "outro", "confianca": 0}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    console.log(`📷 [IMAGEM] Extraído:`, JSON.stringify(parsed));
    return { dados: parsed as ExtractedIntent, confianca: parsed.confianca || 0.3 };
  } catch (error) {
    console.error("❌ [IMAGEM] Erro:", error);
    return { dados: null, confianca: 0 };
  }
}

// ============================================================================
// 🧭 FUNÇÕES DE ESTADO E CONTEXTO
// ============================================================================

async function getEstadoUsuario(usuarioId: string): Promise<EstadoUsuario> {
  const { data } = await supabase
    .from("usuarios")
    .select("onboarding_status, onboarding_step")
    .eq("id", usuarioId)
    .single();
  
  if (data?.onboarding_status === "iniciado" && data?.onboarding_step !== "finalizado") {
    return { modo: "onboarding", etapa_onboarding: data.onboarding_step || "renda" };
  }
  
  return { modo: "operacional", etapa_onboarding: null };
}

async function getConversaAtiva(usuarioId: string): Promise<ConversaAtiva | null> {
  const { data } = await supabase
    .from("conversas_ativas")
    .select("*")
    .eq("usuario_id", usuarioId)
    .gt("expira_em", new Date().toISOString())
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  return data as ConversaAtiva | null;
}

async function getHistoricoRecente(phoneNumber: string): Promise<string> {
  const { data: historico } = await supabase
    .from("historico_conversas")
    .select("user_message, ai_response")
    .eq("phone_number", phoneNumber)
    .not("tipo", "like", "fluxo_%")
    .not("tipo", "eq", "hipotese_pendente")
    .order("created_at", { ascending: false })
    .limit(3);

  if (!historico || historico.length === 0) return "";

  return historico.reverse().map(h => 
    `Usuário: ${h.user_message}\nAssistente: ${h.ai_response}`
  ).join("\n\n");
}

async function getHipotesePendente(phoneNumber: string): Promise<any | null> {
  try {
    const { data } = await supabase
      .from("historico_conversas")
      .select("resumo, created_at")
      .eq("phone_number", phoneNumber)
      .eq("tipo", "hipotese_pendente")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.resumo) return null;

    const createdAt = new Date(data.created_at);
    const agora = new Date();
    const diffMinutos = (agora.getTime() - createdAt.getTime()) / 1000 / 60;
    
    if (diffMinutos > 15) return null;

    return JSON.parse(data.resumo);
  } catch {
    return null;
  }
}

async function limparHipotesePendente(phoneNumber: string): Promise<void> {
  await supabase
    .from("historico_conversas")
    .update({ tipo: "hipotese_processada" })
    .eq("phone_number", phoneNumber)
    .eq("tipo", "hipotese_pendente");
}

async function verificarSeNovoUsuario(phoneNumber: string): Promise<boolean> {
  const { count } = await supabase
    .from("historico_conversas")
    .select("id", { count: "exact", head: true })
    .eq("phone_number", phoneNumber);
  
  return count === 0;
}

// ============================================================================
// 🎯 PROCESSAMENTO DE VALIDAÇÃO (HIPÓTESE PENDENTE)
// ============================================================================

function analisarRespostaValidacao(mensagem: string, hipotese: any): { tipo: string; dados?: any } {
  const msg = mensagem.toLowerCase().trim();
  
  // Cancelar
  const padroesCancel = [/^(não|nao|n)$/, /^cancela/, /^para/, /^deixa/, /deixa pra l/];
  if (padroesCancel.some(p => p.test(msg))) return { tipo: "cancelar" };
  
  // Confirmar
  const padroesConfirm = [/^(sim|s|ok|pode|isso|certo|exato|blz|beleza|perfeito)$/, /isso mesmo/, /pode salvar/, /^registra$/];
  if (padroesConfirm.some(p => p.test(msg))) return { tipo: "confirmar" };
  
  // Correção de valor
  const valorMatch = msg.match(/r?\$?\s*(\d+(?:[.,]\d{2})?)/);
  if (valorMatch) {
    return { tipo: "corrigir", dados: { valor: parseFloat(valorMatch[1].replace(",", ".")) } };
  }
  
  // Forma de pagamento por número
  if (hipotese.dados_faltantes?.includes("forma_pagamento")) {
    if (msg === "1") return { tipo: "corrigir", dados: { forma_pagamento: "pix" } };
    if (msg === "2") return { tipo: "corrigir", dados: { forma_pagamento: "dinheiro" } };
    if (msg === "3") return { tipo: "corrigir", dados: { forma_pagamento: "debito" } };
    if (msg === "4") return { tipo: "corrigir", dados: { forma_pagamento: "credito" } };
  }
  
  return { tipo: "indefinido" };
}

// ============================================================================
// 🚀 ONBOARDING
// ============================================================================

async function enviarOnboardingNovoUsuario(
  phoneNumber: string,
  messageSource: MessageSource,
  nome: string
): Promise<void> {
  const primeiroNome = nome.split(" ")[0];
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  const msg1 = `Oi, ${primeiroNome}! 👋\n\nPrazer, eu sou o *Finax* — seu assistente financeiro pessoal.\n\nVou te ajudar a organizar suas finanças de um jeito leve e sem complicação.`;
  await sendWhatsAppMessage(phoneNumber, msg1, messageSource);
  await delay(2000);
  
  const msg2 = `Pode me mandar gastos por texto, áudio ou foto de comprovante.\n\nEu organizo tudo pra você — é só ir vivendo a vida e mandando os gastos quando lembrar 😊`;
  await sendWhatsAppMessage(phoneNumber, msg2, messageSource);
  await delay(2000);
  
  const msg3 = `Pra eu te conhecer melhor...\n\nMe conta: quanto você costuma ganhar por mês? 💰\n\n_Pode ser aproximado, tipo "uns 3 mil" ou "varia entre 4 e 5k"_`;
  await sendWhatsAppMessage(phoneNumber, msg3, messageSource);
}

// ============================================================================
// 🎯 RESPOSTAS INTELIGENTES (PARA INTENTS NÃO DE REGISTRO)
// ============================================================================

async function processarIntentNaoRegistro(
  intent: ExtractedIntent,
  usuarioId: string,
  nomeUsuario: string,
  phoneNumber: string,
  messageSource: MessageSource,
  messageText: string
): Promise<string> {
  
  switch (intent.intent) {
    case "saudacao": {
      const primeiroNome = nomeUsuario.split(" ")[0];
      const saudacoes = [
        `E aí, ${primeiroNome}! 👋\n\nO que você precisa?\n\n💸 Registrar gasto\n📊 Ver resumo\n🎤 Manda um áudio que eu entendo`,
        `Fala, ${primeiroNome}! 👋\n\nComo posso ajudar?\n\n💰 Manda um gasto\n📊 Quer ver o resumo do mês?\n📷 Manda print de comprovante`,
        `Opa, ${primeiroNome}! 🙂\n\nPode mandar gasto, áudio ou foto que eu organizo pra você.`
      ];
      return saudacoes[Math.floor(Math.random() * saudacoes.length)];
    }
    
    case "ajuda": {
      return `*Como usar o Finax* 📱\n\n` +
        `💸 *Registrar gasto*\n` +
        `   _"Gastei 50 no mercado"_\n` +
        `   _"120 reais de uber"_\n\n` +
        `📷 *Enviar comprovante*\n` +
        `   _Manda foto do Pix, fatura ou cupom_\n\n` +
        `🎤 *Áudio funciona*\n` +
        `   _Manda áudio contando o gasto_\n\n` +
        `📊 *Ver resumo*\n` +
        `   _"Quanto gastei esse mês?"_\n\n` +
        `É só mandar naturalmente que eu entendo! 🙂`;
    }
    
    case "consultar_resumo": {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);
      
      const { data: transacoes } = await supabase
        .from("transacoes")
        .select("valor, tipo, categoria, descricao, data")
        .eq("usuario_id", usuarioId)
        .gte("data", inicioMes.toISOString());

      let totalEntradas = 0;
      let totalSaidas = 0;
      
      transacoes?.forEach((t) => {
        const valor = Number(t.valor);
        if (t.tipo === "entrada") totalEntradas += valor;
        else totalSaidas += valor;
      });
      
      const saldo = totalEntradas - totalSaidas;
      
      if (!transacoes || transacoes.length === 0) {
        return "Você ainda não tem transações registradas este mês 📊\n\nManda um gasto que eu começo a organizar pra você!";
      }
      
      const ultimas = transacoes.slice(-5).map(t => {
        const sinal = t.tipo === "entrada" ? "+" : "-";
        const desc = t.descricao || t.categoria;
        return `• ${sinal}R$ ${Number(t.valor).toFixed(2)} - ${desc}`;
      }).join("\n");
      
      return `📊 *Resumo do Mês*\n\n` +
        `${ultimas}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n` +
        `💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n` +
        `📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
    }
    
    case "cancelar_transacao": {
      const { data: ultimasTransacoes } = await supabase
        .from("transacoes")
        .select("id, valor, descricao, categoria, data")
        .eq("usuario_id", usuarioId)
        .order("created_at", { ascending: false })
        .limit(5);
      
      if (!ultimasTransacoes || ultimasTransacoes.length === 0) {
        return "Você não tem transações recentes para cancelar 🤔";
      }
      
      const listaOpcoes = ultimasTransacoes.map((t, i) => {
        const data = new Date(t.data).toLocaleDateString("pt-BR");
        const desc = t.descricao || t.categoria;
        return `${i + 1}. R$ ${Number(t.valor).toFixed(2)} - ${desc} (${data})`;
      }).join("\n");
      
      return `Qual transação você quer apagar?\n\n${listaOpcoes}\n\nResponde com o número.`;
    }
    
    case "iniciar_organizacao": {
      const { data: usuario } = await supabase
        .from("usuarios")
        .select("onboarding_status")
        .eq("id", usuarioId)
        .single();
      
      if (usuario?.onboarding_status === "concluido") {
        return `Você já organizou comigo antes 👍\n\nO que quer fazer agora?\n\n💳 *Atualizar cartões*\n📌 *Adicionar gasto fixo*\n🔄 *Recomeçar do zero*\n\n_Ou me manda um gasto que eu registro!_`;
      }
      
      // Inicia onboarding
      await supabase.from("usuarios")
        .update({ onboarding_status: "iniciado", onboarding_step: "renda" })
        .eq("id", usuarioId);
      
      return `Vamos organizar suas finanças! 🎯\n\nPra começar, me conta: quanto você costuma ganhar por mês? 💰`;
    }
    
    default: {
      return `Como posso te ajudar? 🤔\n\n💸 Registrar gasto\n📊 Ver resumo\n🎤 Manda áudio ou foto\n\n_Exemplo: "Gastei 50 no mercado"_`;
    }
  }
}

// ============================================================================
// 🚀 WEBHOOK PRINCIPAL (COM TRY/CATCH GLOBAL SEMPRE 200)
// ============================================================================

serve(async (req) => {
  // CORS preflight
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
      console.log("✅ Webhook verificado!");
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    
    return new Response("Forbidden", { status: 403 });
  }

  // ============================================================================
  // TRY/CATCH GLOBAL - SEMPRE RETORNA 200
  // ============================================================================
  try {
    const json = await req.json();
    console.log("📨 Webhook payload recebido");

    // ========================================================================
    // PARSE PAYLOAD
    // ========================================================================
    let payload: PayloadParsed = {
      phoneNumber: "",
      messageText: "",
      messageType: "text",
      messageId: "",
      mediaId: null,
      mediaMimeType: "",
      messageSource: "meta",
      nomeContato: null
    };

    // Vonage
    if (json.channel === "whatsapp" && json.from && json.text !== undefined) {
      payload.messageSource = "vonage";
      payload.phoneNumber = json.from;
      payload.messageText = json.text || "";
      payload.messageId = json.message_uuid || `vonage_${Date.now()}`;
      
      if (json.message_type !== "text" || !payload.messageText) {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Meta
    else if (json.entry?.[0]?.changes?.[0]?.value) {
      payload.messageSource = "meta";
      const value = json.entry[0].changes[0].value;
      
      if (!value.messages || value.messages.length === 0) {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const message = value.messages[0];
      payload.phoneNumber = message.from;
      payload.messageId = message.id || `meta_${Date.now()}`;
      payload.nomeContato = value.contacts?.[0]?.profile?.name || null;
      
      if (message.type === "text") {
        payload.messageType = "text";
        payload.messageText = message.text?.body || "";
      } else if (message.type === "audio") {
        payload.messageType = "audio";
        payload.mediaId = message.audio?.id || null;
        payload.mediaMimeType = message.audio?.mime_type || "audio/ogg";
      } else if (message.type === "image") {
        payload.messageType = "image";
        payload.mediaId = message.image?.id || null;
        payload.mediaMimeType = message.image?.mime_type || "image/jpeg";
      } else {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    else {
      return new Response(JSON.stringify({ status: "ok", message: "Unknown format" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${payload.messageSource.toUpperCase()}] Tipo: ${payload.messageType} | De: ${payload.phoneNumber} | ID: ${payload.messageId}`);

    if (!payload.phoneNumber) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================================================
    // 1️⃣ DEDUPE - NADA ACONTECE ANTES DISSO
    // ========================================================================
    if (await verificarDedupe(payload.messageId)) {
      return new Response(JSON.stringify({ status: "ok", dedupe: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await marcarProcessada(payload.messageId, payload.phoneNumber, payload.messageSource);

    // ========================================================================
    // BUSCAR OU CRIAR USUÁRIO
    // ========================================================================
    let { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("phone_number", payload.phoneNumber)
      .single();

    let isNovoUsuario = false;
    
    if (!usuario) {
      const { data: newUser } = await supabase
        .from("usuarios")
        .insert({ 
          phone_number: payload.phoneNumber,
          nome: payload.nomeContato,
          plano: "pro"
        })
        .select()
        .single();
      usuario = newUser;
      isNovoUsuario = true;
      console.log(`👤 Novo usuário: ${payload.phoneNumber}`);
    } else {
      isNovoUsuario = await verificarSeNovoUsuario(payload.phoneNumber);
    }

    const usuarioId = usuario?.id;
    const nomeUsuario = usuario?.nome || "amigo(a)";

    // ========================================================================
    // 2️⃣ EVENTO BRUTO - SALVAR TUDO SEM PENSAR
    // ========================================================================
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

    // ========================================================================
    // ONBOARDING PARA NOVOS USUÁRIOS
    // ========================================================================
    if (isNovoUsuario) {
      console.log(`🎉 Enviando boas-vindas para ${payload.phoneNumber}`);
      await enviarOnboardingNovoUsuario(payload.phoneNumber, payload.messageSource, nomeUsuario);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: usuarioId,
        user_message: payload.messageText || "[MÍDIA]",
        ai_response: "[ONBOARDING NOVO USUÁRIO]",
        tipo: "onboarding"
      });
      
      return new Response(
        JSON.stringify({ status: "ok", onboarding: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // BUSCAR ESTADO E CONTEXTO
    // ========================================================================
    const estadoUsuario = await getEstadoUsuario(usuarioId);
    const conversaAtiva = await getConversaAtiva(usuarioId);
    const historicoRecente = await getHistoricoRecente(payload.phoneNumber);
    
    console.log(`🎯 [ESTADO] Modo: ${estadoUsuario.modo} | Etapa: ${estadoUsuario.etapa_onboarding}`);
    if (conversaAtiva) {
      console.log(`🔄 [CONVERSA_ATIVA] Fluxo: ${conversaAtiva.tipo_operacao} | Estado: ${conversaAtiva.estado} | Lock: ${conversaAtiva.lock_acao}`);
    }

    // ========================================================================
    // VERIFICAR HIPÓTESE PENDENTE
    // ========================================================================
    const hipotesePendente = await getHipotesePendente(payload.phoneNumber);
    
    if (hipotesePendente && payload.messageType === "text") {
      console.log("💡 [HIPÓTESE] Processando validação...");
      
      const resposta = analisarRespostaValidacao(payload.messageText, hipotesePendente);
      
      if (resposta.tipo === "cancelar") {
        await limparHipotesePendente(payload.phoneNumber);
        await limparEstadoConversa(usuarioId);
        const msg = "Sem problemas! 👍 Já descartei.\n\nMe conta novamente como foi, ou faz outra coisa.";
        await sendWhatsAppMessage(payload.phoneNumber, msg, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber, user_id: usuarioId,
          user_message: payload.messageText, ai_response: msg, tipo: "cancelamento"
        });
        
        return new Response(JSON.stringify({ status: "ok", cancelled: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (resposta.tipo === "confirmar") {
        const resultado = await registrarTransacaoDireto(usuarioId, {
          intent: hipotesePendente.tipo_operacao === "entrada" ? "registrar_entrada" : "registrar_gasto",
          valor: hipotesePendente.valor,
          descricao: hipotesePendente.descricao,
          categoria: hipotesePendente.categoria,
          forma_pagamento: hipotesePendente.forma_pagamento
        }, eventoId);
        
        await limparHipotesePendente(payload.phoneNumber);
        await limparEstadoConversa(usuarioId);
        await sendWhatsAppMessage(payload.phoneNumber, resultado.mensagem, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber, user_id: usuarioId,
          user_message: payload.messageText, ai_response: resultado.mensagem, tipo: "registro_confirmado"
        });
        
        return new Response(JSON.stringify({ status: "ok", registered: resultado.sucesso }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (resposta.tipo === "corrigir" && resposta.dados) {
        const novaHipotese = { ...hipotesePendente, ...resposta.dados };
        const msgConfirmacao = await criarHipoteseConfirmacao(
          payload.phoneNumber, usuarioId, 
          { ...novaHipotese, intent: novaHipotese.tipo_operacao === "entrada" ? "registrar_entrada" : "registrar_gasto" },
          novaHipotese.origem, novaHipotese.confianca
        );
        await sendWhatsAppMessage(payload.phoneNumber, msgConfirmacao, payload.messageSource);
        
        return new Response(JSON.stringify({ status: "ok", updated: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Não entendeu - repete confirmação
      const msgConfirmacao = await criarHipoteseConfirmacao(
        payload.phoneNumber, usuarioId,
        { ...hipotesePendente, intent: hipotesePendente.tipo_operacao === "entrada" ? "registrar_entrada" : "registrar_gasto" },
        hipotesePendente.origem, hipotesePendente.confianca
      );
      const msgFinal = `Hmm, não entendi 🤔\n\n${msgConfirmacao}`;
      await sendWhatsAppMessage(payload.phoneNumber, msgFinal, payload.messageSource);
      
      return new Response(JSON.stringify({ status: "ok", awaiting: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================================================
    // PROCESSAR MÍDIA (ÁUDIO/IMAGEM) - COM GUARD CLAUSE
    // ========================================================================
    let conteudoProcessado = payload.messageText;
    let confiancaOrigem = 0.9; // Texto tem alta confiança
    let tipoOrigem: TipoMidia = payload.messageType;
    
    if (payload.messageType === "audio" && payload.mediaId) {
      // PASSA eventoId para guard clause funcionar
      const audioBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!audioBase64) {
        const msg = "Não peguei o áudio direito 🎤\n\n👉 Pode escrever rapidinho o que você disse?";
        await sendWhatsAppMessage(payload.phoneNumber, msg, payload.messageSource);
        return new Response(JSON.stringify({ status: "ok", error: "audio_download_failed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      const transcricao = await transcreverAudio(audioBase64, payload.mediaMimeType);
      
      if (!transcricao.texto) {
        const msg = "Não peguei o áudio direito 🎤\n\n👉 Pode escrever rapidinho o que você disse?";
        await sendWhatsAppMessage(payload.phoneNumber, msg, payload.messageSource);
        return new Response(JSON.stringify({ status: "ok", error: "transcription_failed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      conteudoProcessado = transcricao.texto;
      confiancaOrigem = transcricao.confianca * 0.9; // Penaliza um pouco por ser áudio
      tipoOrigem = "audio";
    }
    
    if (payload.messageType === "image" && payload.mediaId) {
      // PASSA eventoId para guard clause funcionar
      const imageBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      
      if (!imageBase64) {
        const msg = "Não consegui baixar a imagem 📷\n\n👉 Pode tentar enviar de novo?";
        await sendWhatsAppMessage(payload.phoneNumber, msg, payload.messageSource);
        return new Response(JSON.stringify({ status: "ok", error: "image_download_failed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      const dadosImagem = await extrairDadosImagem(imageBase64, payload.mediaMimeType);
      
      if (!dadosImagem.dados || dadosImagem.dados.intent === "outro" || dadosImagem.confianca < 0.3) {
        const msg = "Vi a imagem 📷\n\n👉 Me conta: *quanto foi* e *o que era*?";
        await sendWhatsAppMessage(payload.phoneNumber, msg, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber, user_id: usuarioId,
          user_message: "[IMAGEM]", ai_response: msg, tipo: "imagem_fallback"
        });
        
        return new Response(JSON.stringify({ status: "ok", image_fallback: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Imagem com dados - vai para motor de decisão
      const decisao = await motorDecisao(
        dadosImagem.dados, dadosImagem.confianca, "image", estadoUsuario, conversaAtiva, usuarioId
      );
      
      console.log(`⚙️ [MOTOR] Decisão imagem: ${decisao.acao} (${decisao.motivo})`);
      
      // Imagem SEMPRE cria hipótese (nunca registra direto)
      const msgConfirmacao = await criarHipoteseConfirmacao(
        payload.phoneNumber, usuarioId, dadosImagem.dados, "image", dadosImagem.confianca
      );
      await sendWhatsAppMessage(payload.phoneNumber, msgConfirmacao, payload.messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber, user_id: usuarioId,
        user_message: "[IMAGEM]", ai_response: msgConfirmacao, tipo: "imagem_hipotese"
      });
      
      // Atualiza evento como interpretado
      if (eventoId) {
        await atualizarEventoBruto(eventoId, dadosImagem.dados);
      }
      
      return new Response(JSON.stringify({ status: "ok", awaiting_validation: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================================================
    // 3️⃣ INTERPRETAÇÃO - IA INTERPRETA (COM GUARD CLAUSE)
    // ========================================================================
    let interpretacao: ExtractedIntent;
    let confianca: number;
    
    // Verificar se já foi interpretado (guard clause)
    if (eventoId) {
      const { jaInterpretado, interpretacao: intCached } = await verificarJaInterpretado(eventoId);
      if (jaInterpretado && intCached) {
        interpretacao = intCached as ExtractedIntent;
        confianca = intCached.confianca || 0.5;
        console.log(`♻️ [INTERPRETAÇÃO] Usando cache do evento ${eventoId}`);
      } else {
        const resultado = await interpretarMensagem(conteudoProcessado, historicoRecente);
        interpretacao = resultado.intent;
        confianca = resultado.confianca;
        
        // Salva interpretação no evento bruto
        await atualizarEventoBruto(eventoId, interpretacao);
      }
    } else {
      const resultado = await interpretarMensagem(conteudoProcessado, historicoRecente);
      interpretacao = resultado.intent;
      confianca = resultado.confianca;
    }
    
    console.log(`🎯 [INTERPRETAÇÃO] Intent: ${JSON.stringify(interpretacao)}`);

    // ========================================================================
    // 4️⃣ MOTOR DE DECISÃO - CÓDIGO DECIDE
    // ========================================================================
    const decisao = await motorDecisao(
      interpretacao, 
      confianca * confiancaOrigem, 
      tipoOrigem, 
      estadoUsuario, 
      conversaAtiva,
      usuarioId
    );
    
    console.log(`⚙️ [MOTOR] Decisão: ${decisao.acao} (${decisao.motivo})`);

    // ========================================================================
    // 5️⃣ EXECUTAR DECISÃO
    // ========================================================================
    let mensagemResposta = "";
    
    switch (decisao.acao) {
      case "registrar_direto": {
        const resultado = await registrarTransacaoDireto(usuarioId, decisao.dados, eventoId);
        mensagemResposta = resultado.mensagem;
        break;
      }
      
      case "criar_hipotese": {
        mensagemResposta = await criarHipoteseConfirmacao(
          payload.phoneNumber, usuarioId, decisao.dados, tipoOrigem, confianca
        );
        break;
      }
      
      case "perguntar": {
        mensagemResposta = decisao.pergunta || "O que você precisa? 🤔";
        break;
      }
      
      case "responder_ia": {
        mensagemResposta = await processarIntentNaoRegistro(
          interpretacao, usuarioId, nomeUsuario, 
          payload.phoneNumber, payload.messageSource, conteudoProcessado
        );
        break;
      }
      
      default: {
        mensagemResposta = "Como posso te ajudar? 🤔\n\n💸 Registrar gasto\n📊 Ver resumo";
      }
    }

    // ========================================================================
    // 6️⃣ ENVIAR RESPOSTA E SALVAR NO HISTÓRICO
    // ========================================================================
    await sendWhatsAppMessage(payload.phoneNumber, mensagemResposta, payload.messageSource);
    
    await supabase.from("historico_conversas").insert({
      phone_number: payload.phoneNumber,
      user_id: usuarioId,
      user_message: conteudoProcessado,
      ai_response: mensagemResposta,
      tipo: decisao.acao
    });

    return new Response(
      JSON.stringify({ status: "ok", action: decisao.acao, motivo: decisao.motivo }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    // ========================================================================
    // CRITICAL: SEMPRE RETORNA 200 - NUNCA 500
    // ========================================================================
    console.error("❌ [WEBHOOK] Erro fatal:", error);
    
    // Retorna 200 para WhatsApp não reenviar a mensagem
    return new Response(
      JSON.stringify({ status: "ok", error: "internal_error", details: String(error) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
