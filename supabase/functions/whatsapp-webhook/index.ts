import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Tipo de origem da mensagem
type MessageSource = "meta" | "vonage";

// ============================================================================
// 🎯 ARQUITETURA FINAX: 5 CAMADAS
// ============================================================================
// 1. PERCEPÇÃO: Transcrição de áudio, OCR de imagem (sem interpretação)
// 2. INTERPRETAÇÃO: IA analisa e gera hipótese (tipo, valor, descrição)
// 3. HIPÓTESE: Sistema cria proposta de registro
// 4. VALIDAÇÃO: Usuário confirma ou corrige (OBRIGATÓRIO)
// 5. EXECUÇÃO: Só após confirmação explícita
// ============================================================================

// Interface para hipótese pendente (entre interpretação e execução)
interface HipotesePendente {
  origem: "audio" | "imagem" | "texto";
  tipo_operacao: "gasto" | "entrada" | "parcelamento" | "recorrente";
  valor?: number;
  descricao?: string;
  categoria?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  confianca: number;
  dados_faltantes: string[];
  mensagem_original?: string;
  // Para imagens com múltiplos itens
  multiplos_itens?: { descricao: string; valor: number }[];
  modo_registro?: "unico" | "separado";
  created_at: string;
}

// Tipos de intent que a IA pode detectar
interface ExtractedIntent {
  intent: 
    | "registrar_gasto" 
    | "registrar_entrada" 
    | "criar_parcelamento" 
    | "criar_recorrente"
    | "consultar_resumo"
    | "consultar_categoria"
    | "consultar_detalhes"
    | "cancelar_transacao"
    | "corrigir_transacao"
    | "apagar_transacao"
    | "iniciar_organizacao"
    | "saudacao"
    | "ajuda"
    | "outro";
  
  valor?: number;
  categoria?: string;
  descricao?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  cartao_id?: string;
  parcelas?: number;
  tipo_recorrencia?: "mensal" | "semanal" | "anual";
  dia_mes?: number;
  dia_semana?: string;
  periodo?: string;
  categoria_consulta?: string;
  transacao_alvo?: string;
}

// Interface para fluxo ativo
interface FluxoAtivo {
  intent: string;
  dados_coletados: Partial<ExtractedIntent>;
  dados_faltantes: string[];
  ultima_pergunta: string;
  created_at: string;
}

// Interface para resposta da IA cognitiva
interface InterpretacaoIA {
  campo?: string;
  valor?: any;
  confianca: number;
  intencao: "continuar_fluxo" | "cancelar" | "novo_comando" | "indefinida";
  mensagem_clarificacao?: string;
}

// ============================================================================
// 🧠 CAMADA 1: PERCEPÇÃO (SEM INTELIGÊNCIA)
// ============================================================================

// Baixa arquivo de mídia do WhatsApp
async function downloadWhatsAppMedia(mediaId: string): Promise<string | null> {
  try {
    console.log(`🎵 [PERCEPÇÃO] Baixando mídia ${mediaId}...`);
    
    const urlResponse = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        },
      }
    );
    
    if (!urlResponse.ok) {
      console.error("Erro ao obter URL da mídia:", await urlResponse.text());
      return null;
    }
    
    const urlData = await urlResponse.json();
    const mediaUrl = urlData.url;
    
    const mediaResponse = await fetch(mediaUrl, {
      headers: {
        "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      },
    });
    
    if (!mediaResponse.ok) {
      console.error("Erro ao baixar mídia:", await mediaResponse.text());
      return null;
    }
    
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    console.log(`✅ [PERCEPÇÃO] Mídia baixada: ${base64.length} chars`);
    return base64;
  } catch (error) {
    console.error("Erro ao baixar mídia:", error);
    return null;
  }
}

// Transcreve áudio via AssemblyAI (APENAS transcrição, sem interpretação)
async function transcreverAudioPuro(audioBase64: string, mimeType: string): Promise<string | null> {
  try {
    console.log("🎤 [PERCEPÇÃO] Transcrevendo áudio via AssemblyAI...");
    
    // Converter base64 para Uint8Array
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // 1. Upload do áudio para AssemblyAI
    console.log("📤 [ASSEMBLYAI] Fazendo upload do áudio...");
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        "Authorization": ASSEMBLYAI_API_KEY!,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("❌ [ASSEMBLYAI] Erro no upload:", errorText);
      return null;
    }
    
    const uploadData = await uploadResponse.json();
    const uploadUrl = uploadData.upload_url;
    console.log("✅ [ASSEMBLYAI] Upload concluído:", uploadUrl);
    
    // 2. Solicitar transcrição
    console.log("📝 [ASSEMBLYAI] Solicitando transcrição...");
    const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        "Authorization": ASSEMBLYAI_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio_url: uploadUrl,
        language_code: "pt",
        speech_model: "best",
      }),
    });
    
    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      console.error("❌ [ASSEMBLYAI] Erro ao solicitar transcrição:", errorText);
      return null;
    }
    
    const transcriptData = await transcriptResponse.json();
    const transcriptId = transcriptData.id;
    console.log("🆔 [ASSEMBLYAI] ID da transcrição:", transcriptId);
    
    // 3. Polling para aguardar resultado
    let status = "queued";
    let transcricaoFinal: string | null = null;
    let tentativas = 0;
    const maxTentativas = 30; // Máximo 30 segundos
    
    while ((status === "queued" || status === "processing") && tentativas < maxTentativas) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda 1 segundo
      
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: {
          "Authorization": ASSEMBLYAI_API_KEY!,
        },
      });
      
      if (!pollingResponse.ok) {
        console.error("❌ [ASSEMBLYAI] Erro no polling:", await pollingResponse.text());
        tentativas++;
        continue;
      }
      
      const pollingData = await pollingResponse.json();
      status = pollingData.status;
      
      console.log(`⏳ [ASSEMBLYAI] Status: ${status} (tentativa ${tentativas + 1})`);
      
      if (status === "completed") {
        transcricaoFinal = pollingData.text;
        break;
      } else if (status === "error") {
        console.error("❌ [ASSEMBLYAI] Erro na transcrição:", pollingData.error);
        return null;
      }
      
      tentativas++;
    }
    
    if (!transcricaoFinal) {
      console.error("❌ [ASSEMBLYAI] Timeout ou sem resultado");
      return null;
    }
    
    console.log(`✅ [PERCEPÇÃO] Transcrição AssemblyAI: "${transcricaoFinal}"`);
    return transcricaoFinal;
  } catch (error) {
    console.error("❌ [PERCEPÇÃO] Erro ao transcrever áudio:", error);
    return null;
  }
}

// Extrai dados brutos de imagem (OCR puro)
interface DadosImagemBrutos {
  tipo: "comprovante" | "fatura" | "extrato" | "outro";
  valor?: number;
  descricao?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  estabelecimento?: string;
  itens?: { descricao: string; valor: number }[];
  confianca: number;
}

async function extrairDadosImagemPuro(imageBase64: string, mimeType: string): Promise<DadosImagemBrutos | null> {
  try {
    console.log("📷 [PERCEPÇÃO] Extraindo dados da imagem (OCR)...");
    
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
            role: "user",
            content: [
              {
                type: "text",
                text: `Extraia dados visuais desta imagem. NÃO tome decisões, apenas extraia.

IDENTIFIQUE:
- tipo: "comprovante" (pagamento), "fatura" (cartão), "extrato" (banco), "outro"
- valor: número principal se visível
- descricao: texto descritivo se visível
- forma_pagamento: "pix", "dinheiro", "debito", "credito" se identificável
- estabelecimento: nome do local se visível
- itens: lista de produtos/itens se for nota fiscal

Responda APENAS JSON:
{
  "tipo": "comprovante" | "fatura" | "extrato" | "outro",
  "valor": number ou null,
  "descricao": "string" ou null,
  "forma_pagamento": "pix" | "dinheiro" | "debito" | "credito" ou null,
  "estabelecimento": "string" ou null,
  "itens": [{"descricao": "string", "valor": number}] ou null,
  "confianca": 0.0 a 1.0
}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`
                }
              }
            ]
          }
        ]
      }),
    });

    if (!response.ok) {
      console.error("Erro na análise de imagem:", await response.text());
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"tipo": "outro", "confianca": 0}';
    
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    console.log("📷 [PERCEPÇÃO] Dados extraídos:", cleanJson);
    
    return JSON.parse(cleanJson) as DadosImagemBrutos;
  } catch (error) {
    console.error("Erro ao analisar imagem:", error);
    return null;
  }
}

// ============================================================================
// 🧠 CAMADA 2: INTERPRETAÇÃO (IA ANALISA E CRIA HIPÓTESE)
// ============================================================================

interface InterpretacaoFinanceira {
  eh_financeiro: boolean;
  tipo_operacao?: "gasto" | "entrada" | "parcelamento" | "recorrente" | "consulta";
  valor?: number;
  descricao?: string;
  categoria?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  confianca: number;
  motivo?: string;
}

async function interpretarMensagem(mensagem: string): Promise<InterpretacaoFinanceira> {
  try {
    console.log("🧠 [INTERPRETAÇÃO] Analisando mensagem...");
    
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
            content: `Você é um intérprete financeiro do Finax.
Analise a mensagem e identifique se é sobre finanças pessoais.

EXEMPLOS DE MENSAGENS FINANCEIRAS:
- "gastei 50 no mercado" → gasto
- "comprei açaí de 25 reais" → gasto
- "recebi 1500 hoje" → entrada
- "paguei 100 de luz" → gasto
- "parcelei TV em 10x" → parcelamento

NÚMEROS POR EXTENSO:
- "vinte e cinco" = 25
- "cem reais" = 100
- "mil e quinhentos" = 1500

CATEGORIAS: alimentação, transporte, lazer, moradia, saúde, educação, compras, tecnologia, assinaturas, salário, outros

FORMAS DE PAGAMENTO:
- "pix", "via pix" → pix
- "dinheiro", "espécie" → dinheiro
- "débito" → debito
- "crédito", "cartão" → credito

Se NÃO for sobre finanças (receita de comida, conversa aleatória, etc), marque eh_financeiro: false

Responda APENAS JSON:
{
  "eh_financeiro": boolean,
  "tipo_operacao": "gasto" | "entrada" | "parcelamento" | "recorrente" | "consulta" | null,
  "valor": number ou null,
  "descricao": "string" ou null,
  "categoria": "string" ou null,
  "forma_pagamento": "pix" | "dinheiro" | "debito" | "credito" ou null,
  "confianca": 0.0 a 1.0,
  "motivo": "explicação breve" ou null
}`
          },
          { role: "user", content: mensagem }
        ]
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"eh_financeiro": false, "confianca": 0}';
    
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    console.log("🧠 [INTERPRETAÇÃO] Resultado:", cleanJson);
    
    return JSON.parse(cleanJson) as InterpretacaoFinanceira;
  } catch (error) {
    console.error("Erro ao interpretar mensagem:", error);
    return { eh_financeiro: false, confianca: 0 };
  }
}

// ============================================================================
// 🎯 CAMADA 3: HIPÓTESE (SISTEMA CRIA PROPOSTA)
// ============================================================================

// Salva hipótese pendente de confirmação
async function salvarHipotesePendente(
  phoneNumber: string,
  userId: string,
  hipotese: HipotesePendente
): Promise<void> {
  await supabase.from("historico_conversas").insert({
    phone_number: phoneNumber,
    user_id: userId,
    user_message: `[HIPÓTESE] ${hipotese.origem}`,
    ai_response: "[AGUARDANDO VALIDAÇÃO]",
    tipo: "hipotese_pendente",
    resumo: JSON.stringify(hipotese)
  });

  console.log(`💡 [HIPÓTESE] Salva para validação: ${JSON.stringify(hipotese)}`);
}

// Busca hipótese pendente
async function getHipotesePendente(phoneNumber: string): Promise<HipotesePendente | null> {
  try {
    const { data } = await supabase
      .from("historico_conversas")
      .select("resumo, created_at")
      .eq("phone_number", phoneNumber)
      .eq("tipo", "hipotese_pendente")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!data || !data.resumo) return null;

    // Verifica validade (máximo 15 minutos)
    const createdAt = new Date(data.created_at);
    const agora = new Date();
    const diffMinutos = (agora.getTime() - createdAt.getTime()) / 1000 / 60;
    
    if (diffMinutos > 15) return null;

    return JSON.parse(data.resumo) as HipotesePendente;
  } catch {
    return null;
  }
}

// Limpa hipótese pendente (após confirmação, cancelamento ou novo comando)
async function limparHipotesePendente(phoneNumber: string): Promise<void> {
  await supabase
    .from("historico_conversas")
    .update({ tipo: "hipotese_processada" })
    .eq("phone_number", phoneNumber)
    .eq("tipo", "hipotese_pendente");
    
  console.log("🧹 [HIPÓTESE] Limpa");
}

// ============================================================================
// ✅ CAMADA 4: VALIDAÇÃO (DETECÇÃO DE RESPOSTA DO USUÁRIO)
// ============================================================================

interface RespostaValidacao {
  tipo: "confirmar" | "cancelar" | "corrigir" | "dados_novos" | "indefinido";
  dados_corrigidos?: Partial<HipotesePendente>;
}

function analisarRespostaValidacao(mensagem: string, hipotese: HipotesePendente): RespostaValidacao {
  const msg = mensagem.toLowerCase().trim();
  
  // 🚨 REGRA CRÍTICA: Cancelamentos SEMPRE limpam contexto
  const padroesCancel = [
    /^(não|nao|n)$/,
    /^cancela/,
    /^para/,
    /^desiste/,
    /^deixa/,
    /^errado/,
    /não é isso/,
    /nao e isso/,
    /não era/,
    /nao era/,
    /^esquece/,
    /deixa pra l[áa]/
  ];
  
  if (padroesCancel.some(p => p.test(msg))) {
    console.log("❌ [VALIDAÇÃO] Usuário CANCELOU - descartando hipótese");
    return { tipo: "cancelar" };
  }
  
  // Confirmações positivas
  const padroesConfirm = [
    /^(sim|s|ok|pode|confirma|isso|certo|exato|t[áa]|blz|beleza)$/,
    /isso mesmo/,
    /pode salvar/,
    /^salva$/,
    /^registra$/,
    /pode registrar/,
    /manda ver/,
    /^perfeito$/
  ];
  
  if (padroesConfirm.some(p => p.test(msg))) {
    console.log("✅ [VALIDAÇÃO] Usuário CONFIRMOU");
    return { tipo: "confirmar" };
  }
  
  // Detecta correções
  const correcoes: Partial<HipotesePendente> = {};
  let temCorrecao = false;
  
  // Correção de valor
  const valorMatch = msg.match(/(?:era|foi|valor[:]?\s*)?r?\$?\s*(\d+(?:[.,]\d{2})?)/);
  if (valorMatch && hipotese.valor) {
    const novoValor = parseFloat(valorMatch[1].replace(",", "."));
    if (novoValor !== hipotese.valor) {
      correcoes.valor = novoValor;
      temCorrecao = true;
    }
  }
  
  // Correção de forma de pagamento
  if (msg.includes("pix") && hipotese.forma_pagamento !== "pix") {
    correcoes.forma_pagamento = "pix";
    temCorrecao = true;
  } else if ((msg.includes("débito") || msg.includes("debito")) && hipotese.forma_pagamento !== "debito") {
    correcoes.forma_pagamento = "debito";
    temCorrecao = true;
  } else if ((msg.includes("crédito") || msg.includes("credito") || msg.includes("cartão")) && hipotese.forma_pagamento !== "credito") {
    correcoes.forma_pagamento = "credito";
    temCorrecao = true;
  } else if (msg.includes("dinheiro") && hipotese.forma_pagamento !== "dinheiro") {
    correcoes.forma_pagamento = "dinheiro";
    temCorrecao = true;
  }
  
  // Seleção de forma de pagamento por número
  if (hipotese.dados_faltantes?.includes("forma_pagamento")) {
    if (msg === "1") correcoes.forma_pagamento = "pix";
    else if (msg === "2") correcoes.forma_pagamento = "dinheiro";
    else if (msg === "3") correcoes.forma_pagamento = "debito";
    else if (msg === "4") correcoes.forma_pagamento = "credito";
    
    if (correcoes.forma_pagamento) temCorrecao = true;
  }
  
  // Se está fornecendo descrição faltante
  if (hipotese.dados_faltantes?.includes("descricao") && msg.length > 2 && !temCorrecao) {
    correcoes.descricao = mensagem.trim();
    temCorrecao = true;
  }
  
  // Se está fornecendo valor faltante
  if (hipotese.dados_faltantes?.includes("valor")) {
    const valorPuro = msg.match(/(\d+(?:[.,]\d{2})?)/);
    if (valorPuro) {
      correcoes.valor = parseFloat(valorPuro[1].replace(",", "."));
      temCorrecao = true;
    }
  }
  
  // Seleção de modo de registro para múltiplos itens
  if (hipotese.multiplos_itens && hipotese.multiplos_itens.length > 1) {
    if (msg === "1" || msg.includes("único") || msg.includes("unico") || msg.includes("junto")) {
      correcoes.modo_registro = "unico";
      temCorrecao = true;
    } else if (msg === "2" || msg.includes("separado") || msg.includes("cada")) {
      correcoes.modo_registro = "separado";
      temCorrecao = true;
    }
  }
  
  if (temCorrecao) {
    console.log("🔄 [VALIDAÇÃO] Correção/dados detectados:", JSON.stringify(correcoes));
    return { tipo: "corrigir", dados_corrigidos: correcoes };
  }
  
  // Se a mensagem parece ser dados novos (descrição)
  if (msg.length > 3 && !msg.includes("?")) {
    return { tipo: "dados_novos", dados_corrigidos: { descricao: mensagem.trim() } };
  }
  
  return { tipo: "indefinido" };
}

// ============================================================================
// 🚀 CAMADA 5: EXECUÇÃO (SOMENTE APÓS CONFIRMAÇÃO)
// ============================================================================

async function executarRegistro(
  usuarioId: string,
  hipotese: HipotesePendente
): Promise<{ sucesso: boolean; mensagem: string }> {
  console.log("🚀 [EXECUÇÃO] Registrando após confirmação...");
  
  // Múltiplos itens registrados separadamente
  if (hipotese.multiplos_itens && hipotese.modo_registro === "separado") {
    const transacoes = hipotese.multiplos_itens.map(item => ({
      usuario_id: usuarioId,
      valor: item.valor,
      categoria: hipotese.categoria || "outros",
      tipo: "saida",
      descricao: item.descricao,
      observacao: item.descricao,
      data: new Date().toISOString(),
      origem: "whatsapp"
    }));
    
    const { error } = await supabase.from("transacoes").insert(transacoes);
    
    if (error) {
      console.error("Erro ao registrar múltiplos:", error);
      return { sucesso: false, mensagem: "Erro ao salvar os registros 😕" };
    }
    
    const total = hipotese.multiplos_itens.reduce((s, i) => s + i.valor, 0);
    return {
      sucesso: true,
      mensagem: `✅ ${hipotese.multiplos_itens.length} itens registrados!\n\n` +
        hipotese.multiplos_itens.map(i => `• R$ ${i.valor.toFixed(2)} - ${i.descricao}`).join("\n") +
        `\n\n💰 Total: R$ ${total.toFixed(2)}`
    };
  }
  
  // Registro único
  const tipoTransacao = hipotese.tipo_operacao === "entrada" ? "entrada" : "saida";
  
  const { error } = await supabase.from("transacoes").insert({
    usuario_id: usuarioId,
    valor: hipotese.valor,
    categoria: hipotese.categoria || "outros",
    tipo: tipoTransacao,
    descricao: hipotese.descricao,
    observacao: hipotese.descricao,
    data: new Date().toISOString(),
    origem: "whatsapp"
  });
  
  if (error) {
    console.error("Erro ao registrar:", error);
    return { sucesso: false, mensagem: "Erro ao salvar o registro 😕" };
  }
  
  const emoji = tipoTransacao === "entrada" ? "📈" : "💸";
  const sinal = tipoTransacao === "entrada" ? "+" : "-";
  
  return {
    sucesso: true,
    mensagem: `✅ Registrado!\n\n` +
      `${emoji} ${sinal}R$ ${hipotese.valor?.toFixed(2)}\n` +
      `📂 ${hipotese.categoria || "outros"}\n` +
      (hipotese.descricao ? `📝 ${hipotese.descricao}\n` : "") +
      (hipotese.forma_pagamento ? `💳 ${hipotese.forma_pagamento.toUpperCase()}\n` : "") +
      `\nAssim fica tudo organizado aqui 😉`
  };
}

// ============================================================================
// 📨 FUNÇÕES DE MENSAGEM
// ============================================================================

// Monta mensagem de confirmação (SEMPRE antes de registrar)
function montarMensagemConfirmacao(hipotese: HipotesePendente): string {
  let msg = "";
  
  // Se tem múltiplos itens na imagem
  if (hipotese.multiplos_itens && hipotese.multiplos_itens.length > 1) {
    const total = hipotese.multiplos_itens.reduce((s, i) => s + i.valor, 0);
    msg = `📋 Identifiquei ${hipotese.multiplos_itens.length} itens nesse comprovante:\n\n`;
    msg += hipotese.multiplos_itens.map(i => `• R$ ${i.valor.toFixed(2)} - ${i.descricao}`).join("\n");
    msg += `\n\n💰 Total: R$ ${total.toFixed(2)}`;
    msg += `\n\nVocê prefere:\n1️⃣ Registrar tudo como um único gasto de R$ ${total.toFixed(2)}\n2️⃣ Registrar cada item separadamente`;
    return msg;
  }
  
  // Se falta dados
  if (hipotese.dados_faltantes.length > 0) {
    if (hipotese.dados_faltantes.includes("descricao")) {
      if (hipotese.valor) {
        msg = `Vi o valor de *R$ ${hipotese.valor.toFixed(2)}* 💰\n\nMe conta: o que você comprou?`;
      } else {
        msg = `Não consegui identificar bem 🤔\n\nO que foi essa compra e quanto custou?`;
      }
      return msg;
    }
    
    if (hipotese.dados_faltantes.includes("valor")) {
      if (hipotese.descricao) {
        msg = `Entendi que foi *${hipotese.descricao}*\n\nQuanto custou?`;
      } else {
        msg = `Quanto foi esse gasto? 💰`;
      }
      return msg;
    }
    
    if (hipotese.dados_faltantes.includes("forma_pagamento")) {
      msg = `Vi *R$ ${hipotese.valor?.toFixed(2)}* - ${hipotese.descricao}\n\n`;
      msg += `Como você pagou?\n1️⃣ Pix\n2️⃣ Dinheiro\n3️⃣ Débito\n4️⃣ Crédito`;
      return msg;
    }
  }
  
  // Tem todos os dados - pede confirmação final
  const tipoTexto = hipotese.tipo_operacao === "entrada" ? "Entrada" : "Gasto";
  const emoji = hipotese.tipo_operacao === "entrada" ? "📈" : "💸";
  
  msg = `Entendi assim 👇\n\n`;
  msg += `${emoji} ${tipoTexto} de *R$ ${hipotese.valor?.toFixed(2)}*\n`;
  if (hipotese.descricao) msg += `📝 ${hipotese.descricao}\n`;
  if (hipotese.categoria) msg += `📂 ${hipotese.categoria}\n`;
  if (hipotese.forma_pagamento) msg += `💳 ${hipotese.forma_pagamento.toUpperCase()}\n`;
  
  msg += `\nPosso registrar assim? 😊`;
  
  return msg;
}

// Mensagem após cancelamento (empática, sem insistir)
function mensagemPosCancelamento(): string {
  const respostas = [
    "Sem problemas! 👍 Já descartei.\n\nMe conta novamente como foi, ou faz outra coisa.",
    "Ok, ignorei! 👍\n\nO que você gostaria de fazer?",
    "Entendido! Descartei isso. 👍\n\nComo posso te ajudar?",
    "Beleza, já apaguei! 👍\n\nPode me contar de novo ou fazer outra coisa."
  ];
  return respostas[Math.floor(Math.random() * respostas.length)];
}

// ============================================================================
// 📱 FUNÇÕES DE ENVIO
// ============================================================================

async function sendWhatsAppMeta(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    console.log(`[Meta] Enviando mensagem para ${cleanNumber}...`);
    
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

    const result = await response.json();
    console.log("[Meta] Response:", JSON.stringify(result));
    
    if (!response.ok) {
      console.error("[Meta] Erro na API:", result);
    }

    return response.ok;
  } catch (error) {
    console.error("[Meta] Erro ao enviar:", error);
    return false;
  }
}

async function sendWhatsAppVonage(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    console.log(`[Vonage] Enviando mensagem para ${cleanNumber}...`);
    
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

    const result = await response.json();
    console.log("[Vonage] Response:", JSON.stringify(result));

    if (!response.ok) {
      console.error("[Vonage] Erro na API:", result);
    }

    return response.ok;
  } catch (error) {
    console.error("[Vonage] Erro ao enviar:", error);
    return false;
  }
}

async function sendWhatsAppMessage(to: string, text: string, source: MessageSource): Promise<boolean> {
  if (source === "vonage") {
    return sendWhatsAppVonage(to, text);
  }
  return sendWhatsAppMeta(to, text);
}

// ============================================================================
// 🔧 FUNÇÕES AUXILIARES
// ============================================================================

// Busca fluxo ativo para o usuário
async function getFluxoAtivo(phoneNumber: string): Promise<FluxoAtivo | null> {
  try {
    const { data } = await supabase
      .from("historico_conversas")
      .select("resumo, created_at")
      .eq("phone_number", phoneNumber)
      .like("tipo", "fluxo_ativo_%")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!data || !data.resumo) return null;

    const createdAt = new Date(data.created_at);
    const agora = new Date();
    const diffMinutos = (agora.getTime() - createdAt.getTime()) / 1000 / 60;
    
    if (diffMinutos > 10) {
      console.log("⏰ Fluxo ativo expirado (mais de 10 min)");
      return null;
    }

    return JSON.parse(data.resumo) as FluxoAtivo;
  } catch {
    return null;
  }
}

// Salva fluxo ativo
async function salvarFluxoAtivo(
  phoneNumber: string, 
  userId: string,
  intentOriginal: string,
  dadosColetados: Partial<ExtractedIntent>,
  dadosFaltantes: string[],
  mensagemUsuario: string,
  respostaBot: string,
  ultimaPergunta: string
): Promise<void> {
  const fluxo: FluxoAtivo = {
    intent: intentOriginal,
    dados_coletados: dadosColetados,
    dados_faltantes: dadosFaltantes,
    ultima_pergunta: ultimaPergunta,
    created_at: new Date().toISOString()
  };

  await supabase.from("historico_conversas").insert({
    phone_number: phoneNumber,
    user_id: userId,
    user_message: mensagemUsuario,
    ai_response: respostaBot,
    tipo: `fluxo_ativo_${intentOriginal}`,
    resumo: JSON.stringify(fluxo)
  });

  console.log("💾 Fluxo ativo salvo:", JSON.stringify(fluxo));
}

// Limpa fluxo ativo após conclusão
async function limparFluxoAtivo(phoneNumber: string): Promise<void> {
  await supabase
    .from("historico_conversas")
    .update({ tipo: "fluxo_concluido" })
    .eq("phone_number", phoneNumber)
    .like("tipo", "fluxo_ativo_%");
    
  console.log("🧹 Fluxo ativo limpo para:", phoneNumber);
}

// Limpa TUDO (hipótese + fluxo) - usado em cancelamentos
async function limparTodoContexto(phoneNumber: string): Promise<void> {
  await Promise.all([
    limparHipotesePendente(phoneNumber),
    limparFluxoAtivo(phoneNumber)
  ]);
  console.log("🧹 Todo contexto limpo para:", phoneNumber);
}

// Busca histórico recente de conversa
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

// Verifica se usuário precisa de onboarding
async function verificarSeNovoUsuario(phoneNumber: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("historico_conversas")
    .select("id", { count: "exact", head: true })
    .eq("phone_number", phoneNumber);
  
  if (error) {
    console.error("Erro ao verificar histórico:", error);
    return false;
  }
  
  return count === 0;
}

// Onboarding para novos usuários
async function enviarOnboarding(
  phoneNumber: string, 
  messageSource: MessageSource, 
  dados: { nome: string; urlPainel: string }
): Promise<void> {
  const primeiroNome = dados.nome.split(" ")[0];
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  const msg1 = `Oi, ${primeiroNome}! 👋

Prazer, eu sou o *Finax* — seu assistente financeiro pessoal.

Estou aqui pra te ajudar a organizar suas finanças de um jeito simples, direto pelo WhatsApp.`;

  await sendWhatsAppMessage(phoneNumber, msg1, messageSource);
  await delay(2500);
  
  const msg2 = `Comigo você organiza tudo em um só lugar: gastos do dia a dia, cartões, dívidas e salário.

Sem planilha. Sem complicação. Só mandar mensagem como se fosse um amigo.`;

  await sendWhatsAppMessage(phoneNumber, msg2, messageSource);
  await delay(2000);
  
  const msg3 = `💡 *Dica importante*

Fixa o Finax no WhatsApp pra não perder seus registros no dia a dia.

Assim seu controle financeiro fica sempre a um toque.`;

  await sendWhatsAppMessage(phoneNumber, msg3, messageSource);
  await delay(2500);
  
  const msg4 = `🎁 *Acesso liberado*

Você tem acesso completo ao Finax — todas as funcionalidades estão liberadas.

Pode registrar gastos, entradas, parcelamentos, ver resumos...

Mais pra frente te aviso sobre a continuidade 😊`;

  await sendWhatsAppMessage(phoneNumber, msg4, messageSource);
  await delay(2500);
  
  const msg5 = `Quer que eu te ajude agora a organizar seus cartões, dívidas e salário?

Fazendo isso, fica muito mais fácil registrar gastos depois.

Responde *sim* se quiser começar, ou pode mandar direto seu primeiro gasto 💰`;

  await sendWhatsAppMessage(phoneNumber, msg5, messageSource);
  
  console.log(`✅ Onboarding completo enviado para ${phoneNumber}`);
}

// Verificar status do plano
interface StatusPlano {
  status: "trial" | "expired" | "pro";
  permitido: boolean;
  bloqueiaEscrita: boolean;
  mensagem?: string;
}

async function verificarStatusPlano(usuarioId: string): Promise<StatusPlano> {
  try {
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("plano, trial_inicio, trial_fim")
      .eq("id", usuarioId)
      .single();
    
    if (!usuario) {
      return { status: "trial", permitido: true, bloqueiaEscrita: false };
    }
    
    const plano = usuario.plano || "trial";
    const agora = new Date();
    
    if (plano === "pro") {
      return { status: "pro", permitido: true, bloqueiaEscrita: false };
    }
    
    const trialFim = usuario.trial_fim ? new Date(usuario.trial_fim) : null;
    
    if (trialFim) {
      const diasRestantes = Math.ceil((trialFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diasRestantes > 0) {
        return { 
          status: "trial", 
          permitido: true, 
          bloqueiaEscrita: false 
        };
      } else {
        if (plano !== "expired") {
          await supabase.from("usuarios").update({ plano: "expired" }).eq("id", usuarioId);
        }
        
        return { 
          status: "expired", 
          permitido: true,
          bloqueiaEscrita: true,
          mensagem: `Seu período de teste do Finax Pro terminou 😔\n\n` +
            `Você ainda pode consultar seus resumos, mas para registrar novos gastos, ` +
            `ative sua assinatura no site.`
        };
      }
    }
    
    return { status: "trial", permitido: true, bloqueiaEscrita: false };
  } catch (error) {
    console.error("Erro ao verificar status do plano:", error);
    return { status: "trial", permitido: true, bloqueiaEscrita: false };
  }
}

// Busca resumo financeiro do mês
async function getResumoMes(usuarioId: string) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const fimMes = new Date(inicioMes);
  fimMes.setMonth(fimMes.getMonth() + 1);
  fimMes.setDate(0);
  fimMes.setHours(23, 59, 59, 999);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo, categoria, observacao, descricao, data, parcela")
    .eq("usuario_id", usuarioId)
    .gte("data", inicioMes.toISOString())
    .lte("data", fimMes.toISOString());

  let totalEntradas = 0;
  let totalSaidas = 0;
  const porCategoria: Record<string, number> = {};
  
  transacoes?.forEach((t) => {
    const valor = Number(t.valor);
    if (t.tipo === "entrada") {
      totalEntradas += valor;
    } else {
      totalSaidas += valor;
      porCategoria[t.categoria] = (porCategoria[t.categoria] || 0) + valor;
    }
  });

  return {
    totalEntradas,
    totalSaidas,
    saldo: totalEntradas - totalSaidas,
    porCategoria,
    transacoes: transacoes || []
  };
}

// Gera resposta conversacional com contexto
async function generateResponse(
  userMessage: string, 
  context: string, 
  acaoRealizada: string
): Promise<string> {
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
            content: `Você é o Finax, um assistente financeiro pessoal via WhatsApp.

PERSONALIDADE:
- Calmo, humano, seguro
- Sem pressa, sem culpa, sem julgamento
- Consultor financeiro, não robô

ESCOPO (APENAS FINANÇAS):
✅ Registrar gastos e entradas
✅ Gerenciar recorrentes e parcelamentos
✅ Fornecer resumos e relatórios
✅ Dar dicas práticas de orçamento

❌ Não responda sobre outros temas
❌ Não calcule valores (use os fornecidos)
❌ Não mencione planos ou pagamentos

Se fora do escopo:
"Meu foco é te ajudar a organizar suas finanças 💰
Posso registrar gastos, mostrar resumos ou ajudar com orçamento."

FORMATO:
- Mensagens CURTAS
- Emojis com MODERAÇÃO (2-3)
- Linguagem simples

${acaoRealizada ? `\n✅ AÇÃO REALIZADA:\n${acaoRealizada}` : ""}
${context ? `\n📊 CONTEXTO:\n${context}` : ""}`
          },
          { role: "user", content: userMessage }
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";
  } catch (error) {
    console.error("Erro ao gerar resposta:", error);
    return "Desculpe, ocorreu um erro. Tente novamente.";
  }
}

// Extrai intent da mensagem
async function extractIntent(message: string, historicoRecente: string): Promise<ExtractedIntent> {
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
            content: `Você é um analisador de intenções financeiras.

INTENTS:
- "registrar_gasto": gasto/despesa simples
- "registrar_entrada": receita/entrada de dinheiro
- "criar_parcelamento": compra parcelada (em Xx)
- "criar_recorrente": gasto repetitivo (todo mês)
- "consultar_resumo": resumo geral
- "consultar_categoria": gastos de categoria específica
- "cancelar_transacao": cancelar/apagar algo
- "corrigir_transacao": corrigir algo registrado
- "iniciar_organizacao": organizar cartões/salário
- "saudacao": cumprimento
- "ajuda": pedindo ajuda
- "outro": não se encaixa

FORMAS DE PAGAMENTO:
- "pix" → pix
- "dinheiro" → dinheiro
- "débito" → debito
- "crédito", "cartão" → credito

Responda APENAS JSON:
{
  "intent": "string",
  "valor": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "forma_pagamento": "pix" | "dinheiro" | "debito" | "credito" ou null,
  "parcelas": number ou null,
  "tipo_recorrencia": "string" ou null,
  "dia_mes": number ou null,
  "transacao_alvo": "string" ou null
}

${historicoRecente ? `CONTEXTO:\n${historicoRecente}` : ""}`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"intent": "outro"}';
    
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    console.log("Intent extraído:", cleanJson);
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Erro ao extrair intent:", error);
    return { intent: "outro" };
  }
}

// ============================================================================
// 🚀 WEBHOOK PRINCIPAL
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
      return new Response(challenge, { 
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    return new Response("Forbidden", { status: 403 });
  }

  // Processamento POST
  try {
    const json = await req.json();
    console.log("Webhook payload:", JSON.stringify(json));

    let phoneNumber: string = "";
    let messageText: string = "";
    let messageSource: MessageSource = "meta";
    let messageType: "text" | "audio" | "image" = "text";
    let mediaId: string | null = null;
    let mediaMimeType: string = "";

    // Detectar origem: Vonage ou Meta
    if (json.channel === "whatsapp" && json.from && json.text !== undefined) {
      console.log("📱 Detectado formato VONAGE");
      messageSource = "vonage";
      phoneNumber = json.from;
      messageText = json.text || "";
      
      if (json.message_type !== "text" || !messageText) {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    else if (json.entry?.[0]?.changes?.[0]?.value) {
      console.log("📱 Detectado formato META");
      messageSource = "meta";
      
      const value = json.entry[0].changes[0].value;
      
      if (!value.messages || value.messages.length === 0) {
        console.log("Ignorando: não é mensagem de usuário");
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const message = value.messages[0];
      phoneNumber = message.from;
      
      if (message.type === "text") {
        messageType = "text";
        messageText = message.text?.body || "";
      } else if (message.type === "audio") {
        messageType = "audio";
        mediaId = message.audio?.id || null;
        mediaMimeType = message.audio?.mime_type || "audio/ogg";
        console.log(`🎵 Áudio recebido: ${mediaId}`);
      } else if (message.type === "image") {
        messageType = "image";
        mediaId = message.image?.id || null;
        mediaMimeType = message.image?.mime_type || "image/jpeg";
        console.log(`📷 Imagem recebida: ${mediaId}`);
      } else {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    else {
      return new Response(JSON.stringify({ status: "ok", message: "Unknown format" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${messageSource.toUpperCase()}] Tipo: ${messageType} | De: ${phoneNumber}`);

    if (!phoneNumber) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca ou cria usuário
    let { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("phone_number", phoneNumber)
      .single();

    let isNovoUsuario = false;
    
    if (!usuario) {
      let nomeContato: string | null = null;
      if (messageSource === "meta" && json.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
        nomeContato = json.entry[0].changes[0].value.contacts[0].profile.name;
      }
      
      const { data: newUser } = await supabase
        .from("usuarios")
        .insert({ 
          phone_number: phoneNumber,
          nome: nomeContato,
          plano: "pro"
        })
        .select()
        .single();
      usuario = newUser;
      isNovoUsuario = true;
      console.log(`👤 Novo usuário: ${phoneNumber} - ${nomeContato || 'sem nome'}`);
    } else {
      isNovoUsuario = await verificarSeNovoUsuario(phoneNumber);
    }

    const usuarioId = usuario?.id;

    // Onboarding para novos usuários
    if (isNovoUsuario) {
      console.log(`🎉 Iniciando onboarding para ${phoneNumber}`);
      
      await enviarOnboarding(phoneNumber, messageSource, {
        nome: usuario?.nome || "amigo(a)",
        urlPainel: "finax.app"
      });
      
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: messageText,
        ai_response: "[ONBOARDING ENVIADO]",
        tipo: "onboarding"
      });
      
      return new Response(
        JSON.stringify({ status: "ok", onboarding: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar status do plano
    const statusPlano = await verificarStatusPlano(usuarioId);
    console.log(`📋 Plano: ${statusPlano.status}, bloqueiaEscrita: ${statusPlano.bloqueiaEscrita}`);

    // ========================================================================
    // 🎯 VERIFICAR HIPÓTESE PENDENTE (ANTES DE TUDO)
    // ========================================================================
    const hipotesePendente = await getHipotesePendente(phoneNumber);
    
    if (hipotesePendente && messageType === "text") {
      console.log("💡 Hipótese pendente encontrada:", JSON.stringify(hipotesePendente));
      
      const resposta = analisarRespostaValidacao(messageText, hipotesePendente);
      
      // 🚨 CANCELAMENTO: Limpa tudo e responde empaticamente
      if (resposta.tipo === "cancelar") {
        await limparTodoContexto(phoneNumber);
        const msg = mensagemPosCancelamento();
        await sendWhatsAppMessage(phoneNumber, msg, messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: messageText,
          ai_response: msg,
          tipo: "cancelamento"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", cancelled: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // ✅ CONFIRMAÇÃO: Executa o registro
      if (resposta.tipo === "confirmar") {
        // Verifica bloqueio de escrita
        if (statusPlano.bloqueiaEscrita) {
          await limparHipotesePendente(phoneNumber);
          await sendWhatsAppMessage(phoneNumber, statusPlano.mensagem!, messageSource);
          return new Response(
            JSON.stringify({ status: "ok", blocked: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        const resultado = await executarRegistro(usuarioId, hipotesePendente);
        await limparHipotesePendente(phoneNumber);
        await sendWhatsAppMessage(phoneNumber, resultado.mensagem, messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: messageText,
          ai_response: resultado.mensagem,
          tipo: "registro_confirmado"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", registered: resultado.sucesso }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // 🔄 CORREÇÃO/DADOS: Atualiza hipótese e pede confirmação novamente
      if (resposta.tipo === "corrigir" || resposta.tipo === "dados_novos") {
        const novaHipotese: HipotesePendente = {
          ...hipotesePendente,
          ...resposta.dados_corrigidos,
          dados_faltantes: hipotesePendente.dados_faltantes.filter(d => {
            if (d === "descricao" && resposta.dados_corrigidos?.descricao) return false;
            if (d === "valor" && resposta.dados_corrigidos?.valor) return false;
            if (d === "forma_pagamento" && resposta.dados_corrigidos?.forma_pagamento) return false;
            return true;
          })
        };
        
        // Se escolheu modo de registro para múltiplos itens
        if (novaHipotese.multiplos_itens && novaHipotese.modo_registro) {
          if (novaHipotese.modo_registro === "unico") {
            const total = novaHipotese.multiplos_itens.reduce((s, i) => s + i.valor, 0);
            novaHipotese.valor = total;
            novaHipotese.descricao = novaHipotese.multiplos_itens.map(i => i.descricao).join(", ");
            novaHipotese.multiplos_itens = undefined;
          }
          novaHipotese.dados_faltantes = [];
        }
        
        await salvarHipotesePendente(phoneNumber, usuarioId, novaHipotese);
        const msgConfirmacao = montarMensagemConfirmacao(novaHipotese);
        await sendWhatsAppMessage(phoneNumber, msgConfirmacao, messageSource);
        
        return new Response(
          JSON.stringify({ status: "ok", updated: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // ❓ INDEFINIDO: Repete a pergunta
      const msgRepete = montarMensagemConfirmacao(hipotesePendente);
      await sendWhatsAppMessage(phoneNumber, 
        `Não entendi 🤔\n\n${msgRepete}`,
        messageSource
      );
      
      return new Response(
        JSON.stringify({ status: "ok", awaiting: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // 🎤 PROCESSAMENTO DE ÁUDIO (CAMADAS 1-3)
    // ========================================================================
    if (messageType === "audio" && mediaId) {
      console.log("🎵 [PIPELINE] Processando áudio...");
      
      // CAMADA 1: Percepção - Download e transcrição pura
      const audioBase64 = await downloadWhatsAppMedia(mediaId);
      
      if (!audioBase64) {
        await sendWhatsAppMessage(phoneNumber, 
          "Não consegui baixar o áudio 😕\nPode tentar enviar de novo?", 
          messageSource
        );
        return new Response(
          JSON.stringify({ status: "ok", error: "download_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const transcricao = await transcreverAudioPuro(audioBase64, mediaMimeType);
      
      if (!transcricao) {
        await sendWhatsAppMessage(phoneNumber, 
          "Não consegui entender o áudio 😕\nPode tentar falar mais devagar ou escrever?", 
          messageSource
        );
        return new Response(
          JSON.stringify({ status: "ok", error: "transcription_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // CAMADA 2: Interpretação
      const interpretacao = await interpretarMensagem(transcricao);
      
      if (!interpretacao.eh_financeiro) {
        await sendWhatsAppMessage(phoneNumber, 
          "Hmm, parece que esse áudio não é sobre finanças 🤔\n\n" +
          "Eu sou focado em te ajudar com dinheiro! 💰\n" +
          "Quer registrar um gasto, ver seu resumo ou organizar algo?", 
          messageSource
        );
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: `[ÁUDIO] ${transcricao}`,
          ai_response: "Áudio não financeiro",
          tipo: "audio_nao_financeiro"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", not_financial: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // CAMADA 3: Hipótese
      const hipotese: HipotesePendente = {
        origem: "audio",
        tipo_operacao: interpretacao.tipo_operacao === "entrada" ? "entrada" : "gasto",
        valor: interpretacao.valor,
        descricao: interpretacao.descricao,
        categoria: interpretacao.categoria,
        forma_pagamento: interpretacao.forma_pagamento,
        confianca: interpretacao.confianca,
        dados_faltantes: [],
        mensagem_original: transcricao,
        created_at: new Date().toISOString()
      };
      
      if (!hipotese.valor) hipotese.dados_faltantes.push("valor");
      if (!hipotese.descricao) hipotese.dados_faltantes.push("descricao");
      
      await salvarHipotesePendente(phoneNumber, usuarioId, hipotese);
      
      // CAMADA 4: Pedir validação (NUNCA registra direto)
      const msgConfirmacao = montarMensagemConfirmacao(hipotese);
      await sendWhatsAppMessage(phoneNumber, msgConfirmacao, messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: `[ÁUDIO] ${transcricao}`,
        ai_response: msgConfirmacao,
        tipo: "audio_aguardando_validacao"
      });
      
      return new Response(
        JSON.stringify({ status: "ok", awaiting_validation: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // 📷 PROCESSAMENTO DE IMAGEM (CAMADAS 1-3)
    // ========================================================================
    if (messageType === "image" && mediaId) {
      console.log("📷 [PIPELINE] Processando imagem...");
      
      // CAMADA 1: Percepção - Download e OCR
      const imageBase64 = await downloadWhatsAppMedia(mediaId);
      
      if (!imageBase64) {
        await sendWhatsAppMessage(phoneNumber, 
          "Não consegui baixar a imagem 😕\nPode tentar enviar de novo?", 
          messageSource
        );
        return new Response(
          JSON.stringify({ status: "ok", error: "download_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const dadosImagem = await extrairDadosImagemPuro(imageBase64, mediaMimeType);
      
      if (!dadosImagem || dadosImagem.tipo === "outro") {
        await sendWhatsAppMessage(phoneNumber, 
          "Não consegui identificar informações financeiras nessa imagem 🤔\n\n" +
          "Pode me contar o que era? Por exemplo:\n" +
          "_\"Gastei 50 no mercado\"_", 
          messageSource
        );
        return new Response(
          JSON.stringify({ status: "ok", image_type: "outro" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // CAMADA 3: Hipótese
      const hipotese: HipotesePendente = {
        origem: "imagem",
        tipo_operacao: "gasto",
        valor: dadosImagem.valor,
        descricao: dadosImagem.descricao || dadosImagem.estabelecimento,
        categoria: "outros",
        forma_pagamento: dadosImagem.forma_pagamento,
        confianca: dadosImagem.confianca,
        dados_faltantes: [],
        multiplos_itens: dadosImagem.itens && dadosImagem.itens.length > 1 ? dadosImagem.itens : undefined,
        created_at: new Date().toISOString()
      };
      
      if (!hipotese.valor && !hipotese.multiplos_itens) hipotese.dados_faltantes.push("valor");
      if (!hipotese.descricao && !hipotese.multiplos_itens) hipotese.dados_faltantes.push("descricao");
      
      // Se é fatura, oferece ajuda diferente
      if (dadosImagem.tipo === "fatura") {
        await sendWhatsAppMessage(phoneNumber, 
          "Percebi que isso é um print da fatura do cartão 📄\n\n" +
          "Quer que eu te ajude a organizar esses gastos aqui no Finax?\n\n" +
          "Responde *sim* se quiser começar, ou me manda os gastos que quer registrar.", 
          messageSource
        );
        return new Response(
          JSON.stringify({ status: "ok", image_type: "fatura" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Se é extrato
      if (dadosImagem.tipo === "extrato") {
        await sendWhatsAppMessage(phoneNumber, 
          "Recebi um print do extrato 📊\n\n" +
          "Me diz: qual transação desse extrato você quer registrar?", 
          messageSource
        );
        return new Response(
          JSON.stringify({ status: "ok", image_type: "extrato" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      await salvarHipotesePendente(phoneNumber, usuarioId, hipotese);
      
      // CAMADA 4: Pedir validação
      const msgConfirmacao = montarMensagemConfirmacao(hipotese);
      await sendWhatsAppMessage(phoneNumber, msgConfirmacao, messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: "[IMAGEM RECEBIDA]",
        ai_response: msgConfirmacao,
        tipo: "imagem_aguardando_validacao"
      });
      
      return new Response(
        JSON.stringify({ status: "ok", awaiting_validation: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // 💬 PROCESSAMENTO DE TEXTO (CAMADAS 2-4)
    // ========================================================================
    if (!messageText) {
      return new Response(
        JSON.stringify({ status: "ok" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Busca histórico para contexto
    const historicoRecente = await getHistoricoRecente(phoneNumber);
    
    // Extrai intent
    const intent = await extractIntent(messageText, historicoRecente);
    console.log("Intent:", JSON.stringify(intent));

    let acaoRealizada = "";
    let contextoDados = "";

    // Processa baseado no intent
    switch (intent.intent) {
      case "registrar_gasto":
      case "registrar_entrada": {
        // CAMADA 2: Interpretação já feita pelo extractIntent
        // CAMADA 3: Criar hipótese
        const hipotese: HipotesePendente = {
          origem: "texto",
          tipo_operacao: intent.intent === "registrar_entrada" ? "entrada" : "gasto",
          valor: intent.valor,
          descricao: intent.descricao,
          categoria: intent.categoria,
          forma_pagamento: intent.forma_pagamento,
          confianca: 0.8,
          dados_faltantes: [],
          mensagem_original: messageText,
          created_at: new Date().toISOString()
        };
        
        if (!hipotese.valor) hipotese.dados_faltantes.push("valor");
        if (!hipotese.descricao) hipotese.dados_faltantes.push("descricao");
        
        // Se falta dados críticos
        if (hipotese.dados_faltantes.length > 0) {
          await salvarHipotesePendente(phoneNumber, usuarioId, hipotese);
          const msgConfirmacao = montarMensagemConfirmacao(hipotese);
          await sendWhatsAppMessage(phoneNumber, msgConfirmacao, messageSource);
          
          await supabase.from("historico_conversas").insert({
            phone_number: phoneNumber,
            user_id: usuarioId,
            user_message: messageText,
            ai_response: msgConfirmacao,
            tipo: "texto_aguardando_dados"
          });
          
          return new Response(
            JSON.stringify({ status: "ok", awaiting_data: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // Tem todos os dados - pede confirmação (NUNCA registra direto)
        await salvarHipotesePendente(phoneNumber, usuarioId, hipotese);
        const msgConfirmacao = montarMensagemConfirmacao(hipotese);
        await sendWhatsAppMessage(phoneNumber, msgConfirmacao, messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: messageText,
          ai_response: msgConfirmacao,
          tipo: "texto_aguardando_validacao"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", awaiting_validation: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "consultar_resumo": {
        const resumo = await getResumoMes(usuarioId);
        
        if (resumo.transacoes.length > 0) {
          const transacoesFormatadas = resumo.transacoes
            .slice(0, 10)
            .map(t => {
              const data = new Date(t.data).toLocaleDateString("pt-BR");
              const sinal = t.tipo === "entrada" ? "+" : "-";
              const desc = t.descricao || t.observacao || t.categoria;
              return `• ${data}: ${sinal}R$ ${Number(t.valor).toFixed(2)} - ${desc}`;
            }).join("\n");

          contextoDados = `📋 Suas transações do mês:\n\n${transacoesFormatadas}\n\n` +
            `═════════════════════════\n` +
            `📊 *TOTAIS:*\n` +
            `💵 Entradas: *R$ ${resumo.totalEntradas.toFixed(2)}*\n` +
            `💸 Saídas: *R$ ${resumo.totalSaidas.toFixed(2)}*\n` +
            `📈 Saldo: *R$ ${resumo.saldo.toFixed(2)}*`;
        } else {
          contextoDados = "Você ainda não tem transações registradas este mês.";
        }
        break;
      }

      case "cancelar_transacao":
      case "apagar_transacao": {
        const { data: ultimasTransacoes } = await supabase
          .from("transacoes")
          .select("id, valor, categoria, descricao, data")
          .eq("usuario_id", usuarioId)
          .order("created_at", { ascending: false })
          .limit(5);
        
        if (!ultimasTransacoes || ultimasTransacoes.length === 0) {
          acaoRealizada = "Você não tem transações recentes para apagar.";
          break;
        }
        
        const listaOpcoes = ultimasTransacoes.map((t, i) => {
          const data = new Date(t.data).toLocaleDateString("pt-BR");
          const desc = t.descricao || t.categoria;
          return `${i + 1}. R$ ${Number(t.valor).toFixed(2)} - ${desc} (${data})`;
        }).join("\n");
        
        if (intent.transacao_alvo) {
          const alvo = intent.transacao_alvo.toLowerCase();
          const transacaoEncontrada = ultimasTransacoes.find(t => 
            (t.descricao?.toLowerCase().includes(alvo)) ||
            (t.categoria?.toLowerCase().includes(alvo))
          );
          
          if (transacaoEncontrada) {
            const { error } = await supabase
              .from("transacoes")
              .delete()
              .eq("id", transacaoEncontrada.id);
            
            if (!error) {
              acaoRealizada = `✅ Transação apagada!\n\n` +
                `❌ R$ ${Number(transacaoEncontrada.valor).toFixed(2)} - ${transacaoEncontrada.descricao || transacaoEncontrada.categoria}`;
            }
            break;
          }
        }
        
        contextoDados = `🗑️ *Qual transação você quer apagar?*\n\n${listaOpcoes}\n\n` +
          `Responde com o número ou me descreve melhor.`;
        break;
      }

      case "saudacao":
      case "ajuda":
      case "outro":
      default: {
        const resumo = await getResumoMes(usuarioId);
        contextoDados = `Resumo atual: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, ` +
          `Saídas R$ ${resumo.totalSaidas.toFixed(2)}, Saldo R$ ${resumo.saldo.toFixed(2)}`;
        break;
      }
    }

    // Gera resposta com AI
    const contextoCompleto = contextoDados || acaoRealizada 
      ? `${acaoRealizada}\n\n${contextoDados}`.trim() 
      : "";
    
    const aiResponse = await generateResponse(messageText, contextoCompleto, acaoRealizada);

    // Salva histórico
    await supabase.from("historico_conversas").insert({
      phone_number: phoneNumber,
      user_id: usuarioId,
      user_message: messageText,
      ai_response: aiResponse,
      tipo: intent.intent
    });

    // Envia resposta
    await sendWhatsAppMessage(phoneNumber, aiResponse, messageSource);

    return new Response(
      JSON.stringify({ status: "ok", message_sent: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
