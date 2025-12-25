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
// 🧠 FINAX - IA FINANCEIRA ADAPTÁVEL E RESILIENTE
// ============================================================================
// 
// PRINCÍPIO FUNDAMENTAL:
// A Finax NÃO é um chatbot de regras fixas.
// É uma IA consciente de contexto, estado e objetivo do usuário.
//
// REGRA DE OURO:
// - Estado orienta, não engessa
// - Responder é mais importante que avançar etapa
// - SEMPRE pode registrar gastos, mesmo durante onboarding
// - Recuperação suave após desvios
//
// ETAPAS DO ONBOARDING (ordem sugerida, não obrigatória):
// renda → cartoes → cartoes_detalhe → recorrentes → dividas → organizar_mes → finalizado
//
// ============================================================================

// Estado completo do usuário
interface EstadoUsuario {
  modo: "onboarding" | "operacional";
  etapa_onboarding: "renda" | "cartoes" | "cartoes_detalhe" | "recorrentes" | "dividas" | "organizar_mes" | "finalizado" | null;
  onboarding_em_pausa: boolean;
  cartao_atual?: string;
}

// Interface para hipótese pendente
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
  multiplos_itens?: { descricao: string; valor: number }[];
  modo_registro?: "unico" | "separado";
  created_at: string;
}

// Interface para dados brutos de imagem
interface DadosImagemBrutos {
  tipo: "comprovante" | "fatura" | "extrato" | "outro";
  valor?: number;
  descricao?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  estabelecimento?: string;
  itens?: { descricao: string; valor: number }[];
  confianca: number;
}

// Tipos de intent
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

// ============================================================================
// 🎯 FUNÇÕES DE ESTADO (PRIORIDADE MÁXIMA)
// ============================================================================

// Busca estado completo do usuário
async function getEstadoUsuario(usuarioId: string): Promise<EstadoUsuario> {
  const { data } = await supabase
    .from("usuarios")
    .select("onboarding_status, onboarding_step")
    .eq("id", usuarioId)
    .single();
  
  // Se está em onboarding (status = "iniciado" e step não é "finalizado")
  if (data?.onboarding_status === "iniciado" && data?.onboarding_step !== "finalizado") {
    return {
      modo: "onboarding",
      etapa_onboarding: data.onboarding_step || "renda",
      onboarding_em_pausa: false
    };
  }
  
  // Usuário operacional
  return {
    modo: "operacional",
    etapa_onboarding: null,
    onboarding_em_pausa: false
  };
}

// Atualiza etapa do onboarding
async function setOnboardingStep(
  usuarioId: string, 
  step: "renda" | "cartoes" | "cartoes_detalhe" | "recorrentes" | "dividas" | "organizar_mes" | "finalizado"
): Promise<void> {
  const updates: Record<string, string> = { onboarding_step: step };
  
  if (step === "finalizado") {
    updates.onboarding_status = "concluido";
  }
  
  await supabase
    .from("usuarios")
    .update(updates)
    .eq("id", usuarioId);
  
  console.log(`📋 Onboarding step atualizado para: ${step}`);
}

// Inicia onboarding
async function iniciarOnboarding(usuarioId: string): Promise<void> {
  await supabase
    .from("usuarios")
    .update({ 
      onboarding_status: "iniciado",
      onboarding_step: "renda"
    })
    .eq("id", usuarioId);
  
  console.log(`🚀 Onboarding iniciado para: ${usuarioId}`);
}

// ============================================================================
// 🧠 PROCESSADOR DE ONBOARDING HUMANIZADO
// ============================================================================
// 
// Seguindo o Prompt Mestre:
// - Perguntas naturais, não robóticas
// - Sempre pode registrar gastos, mesmo durante onboarding
// - Recuperação suave após desvios
// - Não bloqueia, não força, não repete
//
// ============================================================================

interface OnboardingResult {
  mensagem: string;
  proxima_etapa: "renda" | "cartoes" | "cartoes_detalhe" | "recorrentes" | "dividas" | "organizar_mes" | "finalizado";
  dados_salvos?: any;
  desvio?: boolean; // Se o usuário desviou do fluxo (ex: registrou um gasto)
}

// Detecta se a mensagem é um gasto ou algo fora do onboarding
async function detectarDesvio(mensagem: string): Promise<{ ehDesvio: boolean; tipoDesvio?: string; dados?: any }> {
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
            content: `Analise se esta mensagem é:
1. Uma resposta de onboarding (sobre renda, cartões, gastos fixos, dívidas)
2. Um registro de gasto/entrada (ex: "gastei 50 no mercado")
3. Uma pergunta/conversa fora do contexto

Responda APENAS JSON:
{
  "tipo": "resposta_onboarding" | "registro_gasto" | "registro_entrada" | "pergunta" | "outro",
  "valor": number ou null (se for gasto/entrada),
  "descricao": "string" ou null
}`
          },
          { role: "user", content: mensagem }
        ]
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"tipo": "resposta_onboarding"}';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
    
    if (parsed.tipo === "registro_gasto" || parsed.tipo === "registro_entrada") {
      return { ehDesvio: true, tipoDesvio: parsed.tipo, dados: parsed };
    }
    
    return { ehDesvio: false };
  } catch {
    return { ehDesvio: false };
  }
}

async function processarEtapaOnboarding(
  etapaAtual: string,
  mensagemUsuario: string,
  usuarioId: string
): Promise<OnboardingResult> {
  console.log(`🔄 [ONBOARDING] Processando etapa: ${etapaAtual}`);
  console.log(`💬 [ONBOARDING] Mensagem: ${mensagemUsuario}`);
  
  // Detectar se é um desvio (gasto, pergunta, etc)
  const desvio = await detectarDesvio(mensagemUsuario);
  
  if (desvio.ehDesvio && desvio.tipoDesvio?.includes("registro")) {
    console.log(`↪️ [ONBOARDING] Desvio detectado: ${desvio.tipoDesvio}`);
    // Não bloqueia - vamos processar o gasto e depois retomar suavemente
    return {
      mensagem: "", // Será tratado pelo fluxo de gastos
      proxima_etapa: etapaAtual as any, // Mantém a mesma etapa
      desvio: true,
      dados_salvos: desvio.dados
    };
  }
  
  switch (etapaAtual) {
    case "renda": {
      const dados = await extrairDadosOnboarding(mensagemUsuario, "renda");
      console.log(`💰 [ONBOARDING] Renda extraída:`, dados);
      
      // Salva saldo mensal se informado
      if (dados.valor) {
        await supabase.from("usuarios")
          .update({ saldo_mensal: dados.valor })
          .eq("id", usuarioId);
      }
      
      const temValor = dados.valor && dados.valor > 0;
      const msgRenda = temValor
        ? `Entendi, cerca de R$ ${dados.valor.toLocaleString('pt-BR')} por mês 👍`
        : `Tranquilo, podemos ver isso depois`;
      
      return {
        mensagem: `${msgRenda}\n\nVocê usa cartão de crédito? Se sim, de quais bancos?`,
        proxima_etapa: "cartoes"
      };
    }
    
    case "cartoes": {
      const cartoes = await extrairDadosOnboarding(mensagemUsuario, "cartoes");
      console.log(`💳 [ONBOARDING] Cartões extraídos:`, cartoes);
      
      // Salva cartões
      if (cartoes.items && cartoes.items.length > 0) {
        for (const cartao of cartoes.items) {
          await supabase.from("cartoes_credito").insert({
            usuario_id: usuarioId,
            nome: cartao,
            ativo: true
          });
        }
        
        const primeiroCartao = cartoes.items[0];
        return {
          mensagem: `Anotei ${cartoes.items.length} cartão(ões) 💳\n\nVamos ver os detalhes do *${primeiroCartao}*:\nQual é o limite dele?`,
          proxima_etapa: "cartoes_detalhe",
          dados_salvos: { cartoes: cartoes.items, cartao_atual: primeiroCartao }
        };
      }
      
      // Não tem cartões - pula para recorrentes
      return {
        mensagem: `Sem cartões, entendi 👍\n\nQuais gastos fixos você tem todo mês?\n\n_Por exemplo: aluguel, internet, celular, Netflix..._`,
        proxima_etapa: "recorrentes"
      };
    }
    
    case "cartoes_detalhe": {
      const detalhes = await extrairDadosOnboarding(mensagemUsuario, "cartao_detalhe");
      console.log(`💳 [ONBOARDING] Detalhes cartão:`, detalhes);
      
      // Atualiza o último cartão com limite
      if (detalhes.limite) {
        await supabase.from("cartoes_credito")
          .update({ 
            limite_total: detalhes.limite,
            limite_disponivel: detalhes.limite,
            dia_fechamento: detalhes.dia_fechamento || null,
            dia_vencimento: detalhes.dia_vencimento || null
          })
          .eq("usuario_id", usuarioId)
          .order("created_at", { ascending: false })
          .limit(1);
      }
      
      return {
        mensagem: `Anotado! 👍\n\nAgora me conta: quais gastos fixos você tem todo mês?\n\n_Tipo aluguel, internet, celular, streaming..._`,
        proxima_etapa: "recorrentes"
      };
    }
    
    case "recorrentes": {
      const gastos = await extrairDadosOnboarding(mensagemUsuario, "gastos_fixos");
      console.log(`🔄 [ONBOARDING] Gastos fixos extraídos:`, gastos);
      
      // Salva gastos recorrentes
      if (gastos.recorrentes && gastos.recorrentes.length > 0) {
        for (const gasto of gastos.recorrentes) {
          await supabase.from("gastos_recorrentes").insert({
            usuario_id: usuarioId,
            descricao: gasto.descricao,
            categoria: gasto.categoria || "outros",
            valor_parcela: gasto.valor || 0,
            tipo_recorrencia: "mensal",
            ativo: true
          });
        }
      }
      
      const temGastos = gastos.recorrentes && gastos.recorrentes.length > 0;
      const msgGastos = temGastos
        ? `Salvei ${gastos.recorrentes.length} gasto(s) fixo(s) 📌`
        : `Ok, sem gastos fixos por enquanto`;
      
      return {
        mensagem: `${msgGastos}\n\nHoje você tem alguma dívida ou parcelamento ativo?`,
        proxima_etapa: "dividas"
      };
    }
    
    case "dividas": {
      const dividas = await extrairDadosOnboarding(mensagemUsuario, "dividas");
      console.log(`💸 [ONBOARDING] Dívidas extraídas:`, dividas);
      
      // Salva parcelamentos
      if (dividas.parcelamentos && dividas.parcelamentos.length > 0) {
        for (const parc of dividas.parcelamentos) {
          await supabase.from("parcelamentos").insert({
            usuario_id: usuarioId,
            descricao: parc.descricao,
            valor_total: parc.valor_total || 0,
            num_parcelas: parc.num_parcelas || 1,
            parcela_atual: 1,
            ativa: true
          });
        }
      }
      
      const temDividas = dividas.parcelamentos && dividas.parcelamentos.length > 0;
      const msgDividas = temDividas
        ? `Registrei ${dividas.parcelamentos.length} parcelamento(s) 📝`
        : `Ótimo, sem dívidas ativas!`;
      
      return {
        mensagem: `${msgDividas}\n\nPerfeito! Agora eu já consigo te ajudar de verdade no dia a dia 😊\n\nA partir de agora, pode me mandar gastos, dúvidas ou pedir análises.`,
        proxima_etapa: "finalizado"
      };
    }
    
    case "organizar_mes": {
      // Etapa final opcional
      return {
        mensagem: `Perfeito! Sua organização está pronta 🎉\n\nAgora é só ir mandando seus gastos no dia a dia que eu cuido do resto.`,
        proxima_etapa: "finalizado"
      };
    }
    
    default:
      return {
        mensagem: "Vamos continuar? Me conta sua renda mensal aproximada 💰",
        proxima_etapa: "renda"
      };
  }
}

// Extrai dados estruturados da mensagem de onboarding usando IA
async function extrairDadosOnboarding(mensagem: string, tipo: string): Promise<any> {
  try {
    const prompts: Record<string, string> = {
      renda: `Extraia o valor de renda/salário mencionado.
Responda APENAS JSON: {"valor": number ou null}
Exemplos válidos: "ganho 3000", "minha renda é 5k", "recebo 4.500"`,

      cartoes: `Extraia os cartões de crédito ou bancos mencionados.
Se a pessoa disser que não tem cartão, "não", ou "nenhum", retorne lista vazia.
Responda APENAS JSON: {"items": ["nome1", "nome2"]}
Exemplos: Nubank, Itaú, Bradesco, C6, Inter, Santander, etc.`,
      
      cartao_detalhe: `Extraia detalhes do cartão: limite, dia de fechamento, dia de vencimento.
Responda APENAS JSON: {
  "limite": number ou null,
  "dia_fechamento": number ou null,
  "dia_vencimento": number ou null
}`,
      
      gastos_fixos: `Extraia gastos fixos mensais mencionados.
Se a pessoa disser "não" ou "nenhum", retorne lista vazia.
Responda APENAS JSON: {"recorrentes": [{"descricao": "nome", "categoria": "categoria", "valor": number ou null}]}
Categorias: moradia, transporte, alimentacao, lazer, saude, educacao, servicos, outros`,
      
      dividas: `Extraia dívidas/parcelamentos mencionados.
Se a pessoa disser "não" ou "nenhum", retorne lista vazia.
Responda APENAS JSON: {"parcelamentos": [{"descricao": "nome", "valor_total": number ou null, "num_parcelas": number ou null}]}`
    };
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: prompts[tipo] || prompts.renda },
          { role: "user", content: mensagem }
        ]
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    
    console.log(`🤖 [ONBOARDING] Extração ${tipo}:`, cleanJson);
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error(`❌ [ONBOARDING] Erro ao extrair ${tipo}:`, error);
    return {};
  }
}

// Mensagem inicial do onboarding
function getMensagemInicialOnboarding(nome: string): string[] {
  const primeiroNome = nome.split(" ")[0];
  
  return [
    `Perfeito, ${primeiroNome}! 🎯\n\nSe a ideia é centralizar tudo aqui, eu consigo te ajudar a organizar cartões, bancos, gastos e recorrências em um só lugar.\n\nVou te guiar passo a passo — nada é registrado sem sua confirmação.`,
    `💡 *Dica importante*\n\nFixa o Finax no WhatsApp pra não perder seus registros no dia a dia.\n\nAssim seu controle financeiro fica sempre a um toque. 📌`,
    `Vamos começar? 🚀\n\nQuais bancos ou instituições você usa hoje?\n\nPode me contar naturalmente, tipo:\n_"Uso Nubank e Itaú"_ ou _"Tenho conta no Inter"_`
  ];
}

// ============================================================================
// 🎤 CAMADA 1: PERCEPÇÃO (SEM INTELIGÊNCIA)
// ============================================================================

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

async function transcreverAudioPuro(audioBase64: string, mimeType: string): Promise<string | null> {
  try {
    console.log("🎤 [PERCEPÇÃO] Transcrevendo áudio via AssemblyAI...");
    
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
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
      console.error("❌ [ASSEMBLYAI] Erro no upload:", await uploadResponse.text());
      return null;
    }
    
    const uploadData = await uploadResponse.json();
    const uploadUrl = uploadData.upload_url;
    
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
      console.error("❌ [ASSEMBLYAI] Erro ao solicitar transcrição:", await transcriptResponse.text());
      return null;
    }
    
    const transcriptData = await transcriptResponse.json();
    const transcriptId = transcriptData.id;
    
    let status = "queued";
    let transcricaoFinal: string | null = null;
    let tentativas = 0;
    
    while ((status === "queued" || status === "processing") && tentativas < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { "Authorization": ASSEMBLYAI_API_KEY! },
      });
      
      if (!pollingResponse.ok) {
        tentativas++;
        continue;
      }
      
      const pollingData = await pollingResponse.json();
      status = pollingData.status;
      
      if (status === "completed") {
        transcricaoFinal = pollingData.text;
        break;
      } else if (status === "error") {
        return null;
      }
      
      tentativas++;
    }
    
    console.log(`✅ [PERCEPÇÃO] Transcrição: "${transcricaoFinal}"`);
    return transcricaoFinal;
  } catch (error) {
    console.error("❌ [PERCEPÇÃO] Erro ao transcrever:", error);
    return null;
  }
}

async function extrairDadosImagemPuro(imageBase64: string, mimeType: string): Promise<DadosImagemBrutos | null> {
  try {
    console.log("📷 [PERCEPÇÃO] Extraindo dados da imagem...");
    console.log(`📷 [PERCEPÇÃO] MimeType: ${mimeType}, Base64 length: ${imageBase64.length}`);
    
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
                text: `Analise esta imagem e extraia informações financeiras.

TIPOS DE IMAGEM:
- "comprovante": comprovante de Pix, transferência, pagamento
- "fatura": fatura de cartão de crédito
- "extrato": extrato bancário
- "nota_fiscal": cupom fiscal, nota de compra
- "outro": não é documento financeiro

EXTRAIA O QUE CONSEGUIR VER:
- valor: o valor principal (R$)
- descricao: o que foi comprado ou a quem foi pago
- forma_pagamento: "pix", "dinheiro", "debito" ou "credito"
- estabelecimento: nome da loja/local
- itens: lista de produtos se for nota fiscal

RESPONDA APENAS EM JSON:
{
  "tipo": "comprovante",
  "valor": 150.00,
  "descricao": "Pagamento fulano",
  "forma_pagamento": "pix",
  "estabelecimento": "Mercado XYZ",
  "itens": null,
  "confianca": 0.9
}

Se não conseguir identificar, responda:
{"tipo": "outro", "confianca": 0.1}`
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
      console.error("❌ [PERCEPÇÃO] Erro na API:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    console.log("📷 [PERCEPÇÃO] Resposta bruta:", JSON.stringify(data).substring(0, 500));
    
    const content = data.choices?.[0]?.message?.content || '{"tipo": "outro", "confianca": 0}';
    console.log("📷 [PERCEPÇÃO] Content:", content);
    
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson) as DadosImagemBrutos;
    
    console.log(`📷 [PERCEPÇÃO] Dados extraídos:`, JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    console.error("❌ [PERCEPÇÃO] Erro ao analisar imagem:", error);
    return null;
  }
}

// ============================================================================
// 💡 HIPÓTESE E VALIDAÇÃO
// ============================================================================

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
}

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

    const createdAt = new Date(data.created_at);
    const agora = new Date();
    const diffMinutos = (agora.getTime() - createdAt.getTime()) / 1000 / 60;
    
    if (diffMinutos > 15) return null;

    return JSON.parse(data.resumo) as HipotesePendente;
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

interface RespostaValidacao {
  tipo: "confirmar" | "cancelar" | "corrigir" | "dados_novos" | "indefinido";
  dados_corrigidos?: Partial<HipotesePendente>;
}

function analisarRespostaValidacao(mensagem: string, hipotese: HipotesePendente): RespostaValidacao {
  const msg = mensagem.toLowerCase().trim();
  
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
    return { tipo: "cancelar" };
  }
  
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
    return { tipo: "confirmar" };
  }
  
  const correcoes: Partial<HipotesePendente> = {};
  let temCorrecao = false;
  
  const valorMatch = msg.match(/(?:era|foi|valor[:]?\s*)?r?\$?\s*(\d+(?:[.,]\d{2})?)/);
  if (valorMatch && hipotese.valor) {
    const novoValor = parseFloat(valorMatch[1].replace(",", "."));
    if (novoValor !== hipotese.valor) {
      correcoes.valor = novoValor;
      temCorrecao = true;
    }
  }
  
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
  
  if (hipotese.dados_faltantes?.includes("forma_pagamento")) {
    if (msg === "1") correcoes.forma_pagamento = "pix";
    else if (msg === "2") correcoes.forma_pagamento = "dinheiro";
    else if (msg === "3") correcoes.forma_pagamento = "debito";
    else if (msg === "4") correcoes.forma_pagamento = "credito";
    
    if (correcoes.forma_pagamento) temCorrecao = true;
  }
  
  if (hipotese.dados_faltantes?.includes("descricao") && msg.length > 2 && !temCorrecao) {
    correcoes.descricao = mensagem.trim();
    temCorrecao = true;
  }
  
  if (hipotese.dados_faltantes?.includes("valor")) {
    const valorPuro = msg.match(/(\d+(?:[.,]\d{2})?)/);
    if (valorPuro) {
      correcoes.valor = parseFloat(valorPuro[1].replace(",", "."));
      temCorrecao = true;
    }
  }
  
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
    return { tipo: "corrigir", dados_corrigidos: correcoes };
  }
  
  if (msg.length > 3 && !msg.includes("?")) {
    return { tipo: "dados_novos", dados_corrigidos: { descricao: mensagem.trim() } };
  }
  
  return { tipo: "indefinido" };
}

// ============================================================================
// 🚀 EXECUÇÃO
// ============================================================================

async function executarRegistro(
  usuarioId: string,
  hipotese: HipotesePendente
): Promise<{ sucesso: boolean; mensagem: string }> {
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

function montarMensagemConfirmacao(hipotese: HipotesePendente): string {
  let msg = "";
  
  if (hipotese.multiplos_itens && hipotese.multiplos_itens.length > 1) {
    const total = hipotese.multiplos_itens.reduce((s, i) => s + i.valor, 0);
    msg = `📋 Identifiquei ${hipotese.multiplos_itens.length} itens nesse comprovante:\n\n`;
    msg += hipotese.multiplos_itens.map(i => `• R$ ${i.valor.toFixed(2)} - ${i.descricao}`).join("\n");
    msg += `\n\n💰 Total: R$ ${total.toFixed(2)}`;
    msg += `\n\nVocê prefere:\n1️⃣ Registrar tudo como um único gasto de R$ ${total.toFixed(2)}\n2️⃣ Registrar cada item separadamente`;
    return msg;
  }
  
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
  if (source === "vonage") {
    return sendWhatsAppVonage(to, text);
  }
  return sendWhatsAppMeta(to, text);
}

// ============================================================================
// 🔧 FUNÇÕES AUXILIARES
// ============================================================================

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

async function verificarSeNovoUsuario(phoneNumber: string): Promise<boolean> {
  const { count } = await supabase
    .from("historico_conversas")
    .select("id", { count: "exact", head: true })
    .eq("phone_number", phoneNumber);
  
  return count === 0;
}

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
    
    if (plano === "pro") {
      return { status: "pro", permitido: true, bloqueiaEscrita: false };
    }
    
    const trialFim = usuario.trial_fim ? new Date(usuario.trial_fim) : null;
    const agora = new Date();
    
    if (trialFim) {
      const diasRestantes = Math.ceil((trialFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diasRestantes > 0) {
        return { status: "trial", permitido: true, bloqueiaEscrita: false };
      } else {
        if (plano !== "expired") {
          await supabase.from("usuarios").update({ plano: "expired" }).eq("id", usuarioId);
        }
        
        return { 
          status: "expired", 
          permitido: true,
          bloqueiaEscrita: true,
          mensagem: `Seu período de teste do Finax Pro terminou 😔\n\nVocê ainda pode consultar seus resumos, mas para registrar novos gastos, ative sua assinatura.`
        };
      }
    }
    
    return { status: "trial", permitido: true, bloqueiaEscrita: false };
  } catch (error) {
    return { status: "trial", permitido: true, bloqueiaEscrita: false };
  }
}

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
    return data.choices?.[0]?.message?.content || "Desculpe, não consegui processar.";
  } catch (error) {
    return "Desculpe, ocorreu um erro. Tente novamente.";
  }
}

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
- "iniciar_organizacao": organizar cartões/salário/centralizar
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
    return JSON.parse(cleanJson);
  } catch (error) {
    return { intent: "outro" };
  }
}

// Envia onboarding para novo usuário (humanizado)
async function enviarOnboardingNovoUsuario(
  phoneNumber: string,
  messageSource: MessageSource,
  nome: string
): Promise<void> {
  const primeiroNome = nome.split(" ")[0];
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // Mensagem 1 - Apresentação calorosa
  const msg1 = `Oi, ${primeiroNome}! 👋

Prazer, eu sou a *Finax* — sua assistente financeira pessoal.

Vou te ajudar a organizar suas finanças de um jeito leve, sem complicação.`;

  await sendWhatsAppMessage(phoneNumber, msg1, messageSource);
  await delay(2000);
  
  // Mensagem 2 - Proposta de valor
  const msg2 = `Pode me mandar gastos por texto, áudio ou foto de comprovante.

Eu organizo tudo pra você — é só ir vivendo a vida e mandando os gastos quando lembrar 😊`;

  await sendWhatsAppMessage(phoneNumber, msg2, messageSource);
  await delay(2000);
  
  // Mensagem 3 - Início do onboarding de forma natural
  const msg3 = `Pra eu te conhecer melhor e conseguir te ajudar de verdade...

Me conta: quanto você costuma ganhar por mês? 💰

_Pode ser aproximado, tipo "uns 3 mil" ou "varia entre 4 e 5k"_`;

  await sendWhatsAppMessage(phoneNumber, msg3, messageSource);
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
    console.log("📨 Webhook payload recebido");

    let phoneNumber: string = "";
    let messageText: string = "";
    let messageSource: MessageSource = "meta";
    let messageType: "text" | "audio" | "image" = "text";
    let mediaId: string | null = null;
    let mediaMimeType: string = "";

    // Detectar origem: Vonage ou Meta
    if (json.channel === "whatsapp" && json.from && json.text !== undefined) {
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
      messageSource = "meta";
      
      const value = json.entry[0].changes[0].value;
      
      if (!value.messages || value.messages.length === 0) {
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
      } else if (message.type === "image") {
        messageType = "image";
        mediaId = message.image?.id || null;
        mediaMimeType = message.image?.mime_type || "image/jpeg";
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

    // ========================================================================
    // BUSCAR OU CRIAR USUÁRIO
    // ========================================================================
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
      console.log(`👤 Novo usuário: ${phoneNumber}`);
    } else {
      isNovoUsuario = await verificarSeNovoUsuario(phoneNumber);
    }

    const usuarioId = usuario?.id;
    const nomeUsuario = usuario?.nome || "amigo(a)";

    // ========================================================================
    // ONBOARDING PARA NOVOS USUÁRIOS
    // ========================================================================
    if (isNovoUsuario) {
      console.log(`🎉 Enviando boas-vindas para ${phoneNumber}`);
      
      await enviarOnboardingNovoUsuario(phoneNumber, messageSource, nomeUsuario);
      
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: messageText,
        ai_response: "[ONBOARDING NOVO USUÁRIO]",
        tipo: "onboarding"
      });
      
      return new Response(
        JSON.stringify({ status: "ok", onboarding: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // 🧠 VERIFICAR ESTADO DO USUÁRIO (PRIORIDADE MÁXIMA)
    // ========================================================================
    const estadoUsuario = await getEstadoUsuario(usuarioId);
    console.log(`🎯 [ESTADO] Modo: ${estadoUsuario.modo} | Etapa: ${estadoUsuario.etapa_onboarding}`);

    // ========================================================================
    // MODO ONBOARDING - FLEXÍVEL (PERMITE DESVIOS)
    // ========================================================================
    if (estadoUsuario.modo === "onboarding" && messageType === "text") {
      console.log(`📋 [ONBOARDING] Processando etapa: ${estadoUsuario.etapa_onboarding}`);
      
      // Processa a etapa atual
      const resultado = await processarEtapaOnboarding(
        estadoUsuario.etapa_onboarding || "renda",
        messageText,
        usuarioId
      );
      
      // Se houve desvio (usuário mandou gasto no meio do onboarding)
      if (resultado.desvio && resultado.dados_salvos) {
        console.log(`↪️ [ONBOARDING] Tratando desvio - registro de gasto`);
        
        // Cria hipótese para o gasto
        const hipotese: HipotesePendente = {
          origem: "texto",
          tipo_operacao: resultado.dados_salvos.tipo === "registro_entrada" ? "entrada" : "gasto",
          valor: resultado.dados_salvos.valor,
          descricao: resultado.dados_salvos.descricao,
          categoria: "outros",
          confianca: 0.7,
          dados_faltantes: [],
          mensagem_original: messageText,
          created_at: new Date().toISOString()
        };
        
        if (!hipotese.valor) hipotese.dados_faltantes.push("valor");
        if (!hipotese.descricao) hipotese.dados_faltantes.push("descricao");
        
        await salvarHipotesePendente(phoneNumber, usuarioId, hipotese);
        const msgConfirmacao = montarMensagemConfirmacao(hipotese);
        await sendWhatsAppMessage(phoneNumber, msgConfirmacao, messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: messageText,
          ai_response: msgConfirmacao,
          tipo: "onboarding_desvio_gasto"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", desvio: true, awaiting_validation: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Atualiza para próxima etapa
      await setOnboardingStep(usuarioId, resultado.proxima_etapa);
      
      // Envia resposta
      await sendWhatsAppMessage(phoneNumber, resultado.mensagem, messageSource);
      
      // Salva no histórico
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: messageText,
        ai_response: resultado.mensagem,
        tipo: `onboarding_${estadoUsuario.etapa_onboarding}`
      });
      
      return new Response(
        JSON.stringify({ status: "ok", onboarding_step: resultado.proxima_etapa }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // MODO OPERACIONAL - VERIFICAR HIPÓTESE PENDENTE
    // ========================================================================
    const statusPlano = await verificarStatusPlano(usuarioId);
    const hipotesePendente = await getHipotesePendente(phoneNumber);
    
    if (hipotesePendente && messageType === "text") {
      console.log("💡 Processando hipótese pendente...");
      
      const resposta = analisarRespostaValidacao(messageText, hipotesePendente);
      
      if (resposta.tipo === "cancelar") {
        await limparHipotesePendente(phoneNumber);
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
      
      if (resposta.tipo === "confirmar") {
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
      
      const msgRepete = montarMensagemConfirmacao(hipotesePendente);
      await sendWhatsAppMessage(phoneNumber, `Não entendi 🤔\n\n${msgRepete}`, messageSource);
      
      return new Response(
        JSON.stringify({ status: "ok", awaiting: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // PROCESSAMENTO DE ÁUDIO
    // ========================================================================
    if (messageType === "audio" && mediaId) {
      const audioBase64 = await downloadWhatsAppMedia(mediaId);
      
      if (!audioBase64) {
        await sendWhatsAppMessage(phoneNumber, "Não consegui baixar o áudio 😕\nPode tentar enviar de novo?", messageSource);
        return new Response(JSON.stringify({ status: "ok", error: "download_failed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      const transcricao = await transcreverAudioPuro(audioBase64, mediaMimeType);
      
      if (!transcricao) {
        await sendWhatsAppMessage(phoneNumber, "Não consegui entender o áudio 😕\nPode tentar falar mais devagar ou escrever?", messageSource);
        return new Response(JSON.stringify({ status: "ok", error: "transcription_failed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Usa o texto transcrito como mensagem
      messageText = transcricao;
      messageType = "text";
    }

    // ========================================================================
    // PROCESSAMENTO DE IMAGEM
    // ========================================================================
    if (messageType === "image" && mediaId) {
      const imageBase64 = await downloadWhatsAppMedia(mediaId);
      
      if (!imageBase64) {
        await sendWhatsAppMessage(phoneNumber, "Não consegui baixar a imagem 😕\nPode tentar enviar de novo?", messageSource);
        return new Response(JSON.stringify({ status: "ok", error: "download_failed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      const dadosImagem = await extrairDadosImagemPuro(imageBase64, mediaMimeType);
      
      if (!dadosImagem || dadosImagem.tipo === "outro") {
        await sendWhatsAppMessage(phoneNumber, 
          "Não consegui identificar informações financeiras nessa imagem 🤔\n\nPode me contar o que era?", 
          messageSource
        );
        return new Response(JSON.stringify({ status: "ok", image_type: "outro" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
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
      
      await salvarHipotesePendente(phoneNumber, usuarioId, hipotese);
      const msgConfirmacao = montarMensagemConfirmacao(hipotese);
      await sendWhatsAppMessage(phoneNumber, msgConfirmacao, messageSource);
      
      return new Response(JSON.stringify({ status: "ok", awaiting_validation: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================================================
    // PROCESSAMENTO DE TEXTO (MODO OPERACIONAL)
    // ========================================================================
    if (!messageText) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const historicoRecente = await getHistoricoRecente(phoneNumber);
    const intent = await extractIntent(messageText, historicoRecente);
    console.log("🎯 Intent:", JSON.stringify(intent));

    let acaoRealizada = "";
    let contextoDados = "";

    switch (intent.intent) {
      // ========================================================================
      // INICIAR ORGANIZAÇÃO (DISPARA ONBOARDING)
      // ========================================================================
      case "iniciar_organizacao": {
        // Verifica se já completou onboarding
        const { data: usr } = await supabase
          .from("usuarios")
          .select("onboarding_status")
          .eq("id", usuarioId)
          .single();
        
        if (usr?.onboarding_status === "concluido") {
          const msg = "Você já fez a organização inicial comigo 😊\n\nQuer adicionar mais alguma coisa? Me conta o que você precisa.";
          await sendWhatsAppMessage(phoneNumber, msg, messageSource);
          
          await supabase.from("historico_conversas").insert({
            phone_number: phoneNumber,
            user_id: usuarioId,
            user_message: messageText,
            ai_response: msg,
            tipo: "onboarding_ja_concluido"
          });
          
          return new Response(
            JSON.stringify({ status: "ok", onboarding_already_done: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // Inicia onboarding
        await iniciarOnboarding(usuarioId);
        
        const mensagens = getMensagemInicialOnboarding(nomeUsuario);
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        
        for (let i = 0; i < mensagens.length; i++) {
          await sendWhatsAppMessage(phoneNumber, mensagens[i], messageSource);
          if (i < mensagens.length - 1) await delay(2500);
        }
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: messageText,
          ai_response: "[ONBOARDING INICIADO]",
          tipo: "onboarding_contextual"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", onboarding_started: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "registrar_gasto":
      case "registrar_entrada": {
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
              acaoRealizada = `✅ Transação apagada!\n\nR$ ${Number(transacaoEncontrada.valor).toFixed(2)} - ${transacaoEncontrada.descricao || transacaoEncontrada.categoria}`;
            }
          }
        } else {
          const listaOpcoes = ultimasTransacoes.map((t, i) => {
            const data = new Date(t.data).toLocaleDateString("pt-BR");
            const desc = t.descricao || t.categoria;
            return `${i + 1}. R$ ${Number(t.valor).toFixed(2)} - ${desc} (${data})`;
          }).join("\n");
          
          acaoRealizada = `Qual transação você quer apagar?\n\n${listaOpcoes}\n\nResponde com o número ou descreve qual é.`;
        }
        break;
      }

      case "saudacao": {
        const primeiroNome = nomeUsuario.split(" ")[0];
        acaoRealizada = `Olá, ${primeiroNome}! 👋\n\nComo posso te ajudar hoje?\n\n💰 Registrar um gasto\n📊 Ver resumo do mês\n🔄 Organizar finanças`;
        break;
      }

      case "ajuda": {
        acaoRealizada = `Posso te ajudar com:\n\n💸 *Registrar gastos*\n_"Gastei 50 no mercado"_\n\n📊 *Ver resumo*\n_"Quanto gastei esse mês?"_\n\n🔄 *Organizar tudo*\n_"Quero centralizar minhas finanças"_\n\nÉ só me contar naturalmente! 😊`;
        break;
      }

      default:
        break;
    }

    // Gera resposta com contexto
    const resposta = await generateResponse(
      messageText,
      contextoDados,
      acaoRealizada
    );

    await sendWhatsAppMessage(phoneNumber, resposta, messageSource);

    await supabase.from("historico_conversas").insert({
      phone_number: phoneNumber,
      user_id: usuarioId,
      user_message: messageText,
      ai_response: resposta,
      tipo: "mensagem"
    });

    return new Response(
      JSON.stringify({ status: "ok" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Erro no webhook:", error);
    return new Response(
      JSON.stringify({ status: "error", message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
