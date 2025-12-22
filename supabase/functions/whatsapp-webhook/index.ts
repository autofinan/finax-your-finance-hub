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
    | "saudacao"
    | "ajuda"
    | "outro";
  
  // Para transações simples
  valor?: number;
  categoria?: string;
  descricao?: string;
  
  // Para parcelamentos
  parcelas?: number;
  
  // Para recorrentes
  tipo_recorrencia?: "mensal" | "semanal" | "anual";
  dia_mes?: number;
  dia_semana?: string;
  
  // Para consultas
  periodo?: string; // "mes_atual", "dezembro", "semana", etc.
  categoria_consulta?: string;
}

// Interface para fluxo ativo (estado persistente)
interface FluxoAtivo {
  intent: string;
  dados_coletados: Partial<ExtractedIntent>;
  dados_faltantes: string[];
  created_at: string;
}

// ========== FIX 1 & 4: FUNÇÕES DE CONTROLE DE ESTADO ==========

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

    // Verifica se o fluxo não é muito antigo (máximo 10 minutos)
    const createdAt = new Date(data.created_at);
    const agora = new Date();
    const diffMinutos = (agora.getTime() - createdAt.getTime()) / 1000 / 60;
    
    if (diffMinutos > 10) {
      console.log("Fluxo ativo expirado (mais de 10 min)");
      return null;
    }

    return JSON.parse(data.resumo) as FluxoAtivo;
  } catch (error) {
    console.log("Nenhum fluxo ativo encontrado");
    return null;
  }
}

// Salva fluxo ativo para continuar depois
async function salvarFluxoAtivo(
  phoneNumber: string, 
  userId: string,
  intentOriginal: string,
  dadosColetados: Partial<ExtractedIntent>,
  dadosFaltantes: string[],
  mensagemUsuario: string,
  respostaBot: string
): Promise<void> {
  const fluxo: FluxoAtivo = {
    intent: intentOriginal,
    dados_coletados: dadosColetados,
    dados_faltantes: dadosFaltantes,
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

  console.log("Fluxo ativo salvo:", JSON.stringify(fluxo));
}

// Limpa fluxo ativo após conclusão
async function limparFluxoAtivo(phoneNumber: string): Promise<void> {
  // Marca fluxos ativos como concluídos
  await supabase
    .from("historico_conversas")
    .update({ tipo: "fluxo_concluido" })
    .eq("phone_number", phoneNumber)
    .like("tipo", "fluxo_ativo_%");
    
  console.log("Fluxo ativo limpo para:", phoneNumber);
}

// Extrai dados adicionais de uma mensagem de resposta
async function extractDadosResposta(message: string, dadosFaltantes: string[]): Promise<Partial<ExtractedIntent>> {
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
            content: `Você é um extrator de dados. O usuário está respondendo uma pergunta sobre dados financeiros.
Extraia APENAS os seguintes dados da mensagem: ${dadosFaltantes.join(", ")}

REGRAS:
- valor: números como "59,90", "R$ 100", "50 reais" → converter para number
- dia_mes: números de 1 a 31
- categoria: alimentação, transporte, lazer, moradia, saúde, educação, compras, tecnologia, assinaturas, outros
- descricao: texto descritivo do gasto
- tipo_recorrencia: "mensal", "semanal", "anual"

Responda APENAS com JSON válido com os campos encontrados:
{
  "valor": number ou null,
  "dia_mes": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "tipo_recorrencia": "string" ou null
}`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    console.log("Dados extraídos da resposta:", cleanJson);
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Erro ao extrair dados da resposta:", error);
    return {};
  }
}

// Extrai intent e entidades da mensagem usando AI
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
            content: `Você é um analisador de intenções financeiras. Analise a mensagem do usuário e extraia a intenção e entidades.

INTENTS POSSÍVEIS:
- "registrar_gasto": usuário quer registrar um gasto/despesa simples
- "registrar_entrada": usuário quer registrar uma receita/entrada de dinheiro
- "criar_parcelamento": usuário comprou algo parcelado (ex: "comprei TV em 12x", "parcelei em 6 vezes")
- "criar_recorrente": usuário quer cadastrar gasto que se repete (ex: "todo mês pago netflix", "semanalmente gasto X")
- "consultar_resumo": usuário quer ver resumo geral dos gastos
- "consultar_categoria": usuário quer ver gastos de uma categoria específica
- "consultar_detalhes": usuário quer ver detalhes/lista de transações
- "saudacao": apenas cumprimento (oi, olá, bom dia)
- "ajuda": pedindo ajuda sobre como usar
- "outro": não se encaixa em nenhum

REGRAS DE EXTRAÇÃO:
1. Se mencionar parcelas, vezes, "em Xx" → intent = "criar_parcelamento"
2. Se mencionar "todo mês", "mensal", "semanal", "recorrente" → intent = "criar_recorrente"
3. Se pedir resumo, quanto gastou, balanço → intent = "consultar_resumo"
4. Se perguntar sobre categoria específica (alimentação, transporte, etc) → intent = "consultar_categoria"
5. Se pedir detalhes, lista, o que comprou → intent = "consultar_detalhes"
6. Recebi, ganhei, entrou, pix recebido → intent = "registrar_entrada"
7. Gastei, paguei, comprei (sem parcela) → intent = "registrar_gasto"

CATEGORIAS VÁLIDAS:
alimentação, transporte, lazer, moradia, saúde, educação, compras, tecnologia, assinaturas, salário, freelance, investimentos, pix, outros

EXTRAÇÃO DE VALORES:
- "45 reais", "R$ 45", "45,00" → valor: 45
- "3000 em 12x" → valor: 3000 (total), parcelas: 12
- "20,90 todo mês no dia 10" → valor: 20.90, tipo_recorrencia: "mensal", dia_mes: 10

Responda APENAS com JSON válido:
{
  "intent": "string",
  "valor": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "parcelas": number ou null,
  "tipo_recorrencia": "string" ou null,
  "dia_mes": number ou null,
  "dia_semana": "string" ou null,
  "periodo": "string" ou null,
  "categoria_consulta": "string" ou null
}

${historicoRecente ? `CONTEXTO DA CONVERSA RECENTE:\n${historicoRecente}` : ""}
`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"intent": "outro"}';
    
    // Limpa o JSON de possíveis markdown
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    console.log("Intent extraído:", cleanJson);
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Erro ao extrair intent:", error);
    return { intent: "outro" };
  }
}

// Gera resposta conversacional com contexto completo
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
            content: `Você é o Finax, um assistente financeiro pessoal amigável e inteligente via WhatsApp.

PERSONALIDADE:
- Seja amigável, use emojis com moderação (1-2 por mensagem)
- Formate bem suas respostas com quebras de linha para facilitar leitura
- Seja conciso mas informativo
- Use linguagem natural, como se fosse um amigo ajudando

FORMATO DAS RESPOSTAS:
- Use linhas em branco para separar seções
- Liste itens com • ou -
- Destaque valores importantes com **negrito**
- Nunca envie tudo em um único parágrafo corrido

${acaoRealizada ? `AÇÃO REALIZADA:\n${acaoRealizada}\n` : ""}

${context ? `CONTEXTO FINANCEIRO:\n${context}` : ""}

Responda de forma natural e útil. Se uma transação foi registrada, confirme com detalhes.
Se é uma consulta, apresente os dados de forma clara e organizada.`
          },
          { role: "user", content: userMessage }
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";
  } catch (error) {
    console.error("Erro ao gerar resposta:", error);
    return "Ops! Tive um probleminha. Tente novamente em alguns segundos. 🔄";
  }
}

// Envia mensagem via WhatsApp Business API (Meta)
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

// Envia mensagem via Vonage (Sandbox)
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

// Envia mensagem usando a origem correta
async function sendWhatsAppMessage(to: string, text: string, source: MessageSource): Promise<boolean> {
  if (source === "vonage") {
    return sendWhatsAppVonage(to, text);
  }
  return sendWhatsAppMeta(to, text);
}

// ========== FIX 2: RESUMO MENSAL FILTRADO ==========
// Busca resumo financeiro do mês (APENAS transações do mês atual, não futuras)
async function getResumoMes(usuarioId: string) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  // FIX 2: Calcular fim do mês atual para não incluir parcelas futuras
  const fimMes = new Date(inicioMes);
  fimMes.setMonth(fimMes.getMonth() + 1);
  fimMes.setDate(0); // Último dia do mês atual
  fimMes.setHours(23, 59, 59, 999);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo, categoria, observacao, descricao, data, parcela")
    .eq("usuario_id", usuarioId)
    .gte("data", inicioMes.toISOString())
    .lte("data", fimMes.toISOString()); // FIX 2: Filtro superior

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

// Busca transações por categoria
async function getTransacoesPorCategoria(usuarioId: string, categoria: string, periodo?: string) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  // FIX 2: Também aplicar filtro de fim de mês aqui
  const fimMes = new Date(inicioMes);
  fimMes.setMonth(fimMes.getMonth() + 1);
  fimMes.setDate(0);
  fimMes.setHours(23, 59, 59, 999);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", usuarioId)
    .ilike("categoria", `%${categoria}%`)
    .gte("data", inicioMes.toISOString())
    .lte("data", fimMes.toISOString())
    .order("data", { ascending: false });

  return transacoes || [];
}

// Busca histórico recente de conversa
async function getHistoricoRecente(phoneNumber: string): Promise<string> {
  const { data: historico } = await supabase
    .from("historico_conversas")
    .select("user_message, ai_response")
    .eq("phone_number", phoneNumber)
    .not("tipo", "like", "fluxo_ativo_%") // Ignora fluxos ativos no histórico
    .order("created_at", { ascending: false })
    .limit(3);

  if (!historico || historico.length === 0) return "";

  return historico.reverse().map(h => 
    `Usuário: ${h.user_message}\nAssistente: ${h.ai_response}`
  ).join("\n\n");
}

// ========== FIX 3: DETECTAR E PROCESSAR MÚLTIPLOS GASTOS ==========
function detectarMultiplosGastos(mensagem: string): string[] {
  // Divide por quebras de linha
  const linhas = mensagem.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Padrões que indicam um gasto
  const padraoGasto = /(?:gast[ei|ou]|pagu[ei|ou]|compr[ei|ou]|compra|gasto|pagamento)\s*(?:de\s*)?(?:R\$\s*)?\d+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?\s*(?:reais?|R\$)?\s*(?:em|no|na|de|com)/i;
  
  const gastosDetectados: string[] = [];
  
  for (const linha of linhas) {
    if (padraoGasto.test(linha)) {
      gastosDetectados.push(linha);
    }
  }
  
  // Se não detectou múltiplos por linha, tenta detectar padrões consecutivos na mesma linha
  if (gastosDetectados.length <= 1 && linhas.length === 1) {
    // Tenta separar por "e" ou "," quando há múltiplos valores
    const padraoMultiplo = /(?:gast[ei|ou]|pagu[ei|ou])\s*(?:R\$\s*)?\d+(?:[.,]\d{2})?\s*(?:em|no|na|de|com)\s*\w+/gi;
    const matches = mensagem.match(padraoMultiplo);
    if (matches && matches.length > 1) {
      return matches;
    }
  }
  
  return gastosDetectados.length > 1 ? gastosDetectados : [];
}

async function processarMultiplosGastos(
  linhas: string[], 
  usuarioId: string, 
  historicoRecente: string
): Promise<{ sucesso: number; detalhes: string[] }> {
  const resultados: { sucesso: number; detalhes: string[] } = { sucesso: 0, detalhes: [] };
  const transacoesParaInserir: any[] = [];
  
  // Primeiro, extrai todos os intents
  for (const linha of linhas) {
    const intent = await extractIntent(linha, historicoRecente);
    console.log(`Processando linha: "${linha}" -> intent: ${JSON.stringify(intent)}`);
    
    if (intent.intent === "registrar_gasto" && intent.valor) {
      transacoesParaInserir.push({
        usuario_id: usuarioId,
        valor: intent.valor,
        categoria: intent.categoria || "outros",
        tipo: "saida",
        observacao: intent.descricao || linha,
        descricao: intent.descricao || linha,
        data: new Date().toISOString(),
        origem: "whatsapp"
      });
      resultados.detalhes.push(`R$ ${intent.valor.toFixed(2)} em ${intent.categoria || "outros"}`);
    }
  }
  
  // FIX 3: Insere todos de uma vez (atomicidade)
  if (transacoesParaInserir.length > 0) {
    const { error } = await supabase.from("transacoes").insert(transacoesParaInserir);
    
    if (!error) {
      resultados.sucesso = transacoesParaInserir.length;
      console.log(`✅ ${transacoesParaInserir.length} gastos inseridos com sucesso`);
    } else {
      console.error("Erro ao inserir múltiplos gastos:", error);
      resultados.sucesso = 0;
      resultados.detalhes = [];
    }
  }
  
  return resultados;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ========== VERIFICAÇÃO GET (Meta Webhook Verification) ==========
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    
    console.log("Verificação webhook recebida:", { mode, token, challenge: challenge?.substring(0, 20) });
    
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ Webhook verificado com sucesso!");
      return new Response(challenge, { 
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    console.log("❌ Verificação falhou - token inválido");
    return new Response("Forbidden", { status: 403 });
  }

  // ========== PROCESSAMENTO POST (Mensagens recebidas) ==========
  try {
    const json = await req.json();
    console.log("Webhook payload:", JSON.stringify(json));

    let phoneNumber: string;
    let messageText: string;
    let messageSource: MessageSource;

    // ========== DETECTAR ORIGEM: VONAGE ou META ==========
    
    // Formato Vonage: { from, to, text, channel, message_type, ... }
    if (json.channel === "whatsapp" && json.from && json.text !== undefined) {
      console.log("📱 Detectado formato VONAGE");
      messageSource = "vonage";
      phoneNumber = json.from;
      messageText = json.text || "";
      
      // Ignora se não for mensagem de texto
      if (json.message_type !== "text" || !messageText) {
        console.log(`Ignorando mensagem Vonage do tipo: ${json.message_type}`);
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Formato Meta: { entry: [{ changes: [{ value: { messages: [...] } }] }] }
    else if (json.entry?.[0]?.changes?.[0]?.value) {
      console.log("📱 Detectado formato META");
      messageSource = "meta";
      
      const value = json.entry[0].changes[0].value;
      
      // Ignora notificações que não são mensagens (ex: status updates)
      if (!value.messages || value.messages.length === 0) {
        console.log("Ignorando: não é uma mensagem de usuário (pode ser status update)");
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const message = value.messages[0];
      phoneNumber = message.from;
      messageText = message.text?.body || "";
      
      // Só processa mensagens de texto
      if (message.type !== "text" || !messageText) {
        console.log(`Ignorando mensagem Meta do tipo: ${message.type}`);
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Formato desconhecido
    else {
      console.log("❌ Formato de mensagem não reconhecido");
      return new Response(JSON.stringify({ status: "ok", message: "Unknown format" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${messageSource.toUpperCase()}] Mensagem de ${phoneNumber}: ${messageText}`);

    if (!phoneNumber || !messageText) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Busca ou cria usuário
    let { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("phone_number", phoneNumber)
      .single();

    if (!usuario) {
      const { data: newUser } = await supabase
        .from("usuarios")
        .insert({ phone_number: phoneNumber })
        .select()
        .single();
      usuario = newUser;
    }

    const usuarioId = usuario?.id;

    // 2. Busca histórico recente para contexto
    const historicoRecente = await getHistoricoRecente(phoneNumber);

    let acaoRealizada = "";
    let contextoDados = "";
    let intent: ExtractedIntent = { intent: "outro" };

    // ========== FIX 1 & 4: VERIFICAR FLUXO ATIVO ==========
    const fluxoAtivo = await getFluxoAtivo(phoneNumber);
    
    if (fluxoAtivo) {
      console.log("🔄 Fluxo ativo encontrado:", JSON.stringify(fluxoAtivo));
      
      // Extrai dados da resposta do usuário
      const novosDados = await extractDadosResposta(messageText, fluxoAtivo.dados_faltantes);
      
      // Mescla dados coletados anteriormente com os novos
      const dadosMesclados = { ...fluxoAtivo.dados_coletados, ...novosDados };
      console.log("Dados mesclados:", JSON.stringify(dadosMesclados));
      
      // Atualiza lista de dados faltantes
      const dadosAindaFaltantes = fluxoAtivo.dados_faltantes.filter(campo => {
        const valor = dadosMesclados[campo as keyof ExtractedIntent];
        return valor === null || valor === undefined;
      });
      
      if (fluxoAtivo.intent === "criar_recorrente") {
        // Verifica se tem todos os dados necessários para criar recorrente
        const temValor = dadosMesclados.valor !== null && dadosMesclados.valor !== undefined;
        const temDiaMes = dadosMesclados.dia_mes !== null && dadosMesclados.dia_mes !== undefined;
        
        if (temValor) {
          // FIX 1: CRIAR GASTO RECORRENTE COM SUCESSO
          const { error } = await supabase.from("gastos_recorrentes").insert({
            usuario_id: usuarioId,
            valor_parcela: dadosMesclados.valor,
            categoria: dadosMesclados.categoria || "assinaturas",
            tipo_recorrencia: dadosMesclados.tipo_recorrencia || "mensal",
            dia_mes: dadosMesclados.dia_mes || new Date().getDate(),
            descricao: dadosMesclados.descricao,
            ativo: true,
            proxima_execucao: null,
            origem: "whatsapp"
          });

          if (!error) {
            await limparFluxoAtivo(phoneNumber);
            const diaTexto = dadosMesclados.dia_mes ? `todo dia ${dadosMesclados.dia_mes}` : "mensalmente";
            acaoRealizada = `✅ Gasto recorrente cadastrado com sucesso!\n\n` +
              `🔄 ${dadosMesclados.descricao || dadosMesclados.categoria || "Gasto recorrente"}\n` +
              `💰 R$ ${Number(dadosMesclados.valor).toFixed(2)} ${diaTexto}\n\n` +
              `Vou registrar automaticamente quando a data chegar.`;
            console.log("✅ Gasto recorrente criado com sucesso!");
          } else {
            console.error("Erro ao criar gasto recorrente:", error);
            acaoRealizada = "❌ Erro ao criar o gasto recorrente. Tente novamente.";
            await limparFluxoAtivo(phoneNumber);
          }
        } else {
          // Ainda faltam dados - perguntar novamente
          let pergunta = "";
          if (!temValor) {
            pergunta = "Qual o valor do gasto recorrente? (ex: 59,90)";
          }
          
          const aiResponse = await generateResponse(messageText, "", pergunta);
          
          // Salva estado atualizado
          await salvarFluxoAtivo(
            phoneNumber,
            usuarioId,
            "criar_recorrente",
            dadosMesclados,
            dadosAindaFaltantes,
            messageText,
            aiResponse
          );
          
          await sendWhatsAppMessage(phoneNumber, aiResponse, messageSource);
          
          return new Response(
            JSON.stringify({ status: "ok", message_sent: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } else {
      // ========== FIX 3: VERIFICAR MÚLTIPLOS GASTOS ==========
      const gastosDetectados = detectarMultiplosGastos(messageText);
      
      if (gastosDetectados.length > 1) {
        console.log(`🔢 Detectados ${gastosDetectados.length} gastos na mensagem`);
        
        const resultado = await processarMultiplosGastos(gastosDetectados, usuarioId, historicoRecente);
        
        if (resultado.sucesso > 0) {
          acaoRealizada = `✅ ${resultado.sucesso} gastos registrados!\n\n` +
            resultado.detalhes.map(d => `• ${d}`).join("\n");
        } else {
          acaoRealizada = "❌ Não consegui processar os gastos. Tente enviar um por um.";
        }
      } else {
        // Fluxo normal - extrai intent
        intent = await extractIntent(messageText, historicoRecente);
        console.log("Intent detectado:", JSON.stringify(intent));

        // 4. Processa baseado no intent
        switch (intent.intent) {
          case "registrar_gasto": {
            if (intent.valor) {
              const { error } = await supabase.from("transacoes").insert({
                usuario_id: usuarioId,
                valor: intent.valor,
                categoria: intent.categoria || "outros",
                tipo: "saida",
                observacao: intent.descricao,
                descricao: intent.descricao,
                data: new Date().toISOString(),
                origem: "whatsapp"
              });

              if (!error) {
                acaoRealizada = `✅ Gasto registrado: -R$ ${intent.valor.toFixed(2)} em ${intent.categoria || "outros"}${intent.descricao ? ` (${intent.descricao})` : ""}`;
              }
            }
            break;
          }

          case "registrar_entrada": {
            if (intent.valor) {
              const { error } = await supabase.from("transacoes").insert({
                usuario_id: usuarioId,
                valor: intent.valor,
                categoria: intent.categoria || "outros",
                tipo: "entrada",
                observacao: intent.descricao,
                descricao: intent.descricao,
                data: new Date().toISOString(),
                origem: "whatsapp"
              });

              if (!error) {
                acaoRealizada = `✅ Entrada registrada: +R$ ${intent.valor.toFixed(2)} em ${intent.categoria || "outros"}${intent.descricao ? ` (${intent.descricao})` : ""}`;
              }
            }
            break;
          }

          case "criar_parcelamento": {
            if (intent.valor && intent.parcelas && intent.parcelas > 1) {
              const valorParcela = intent.valor / intent.parcelas;
              
              // Cria o parcelamento
              const { data: parcelamento, error: errParc } = await supabase
                .from("parcelamentos")
                .insert({
                  usuario_id: usuarioId,
                  valor_total: intent.valor,
                  num_parcelas: intent.parcelas,
                  parcela_atual: 1,
                  valor_parcela: valorParcela,
                  ativa: true,
                  descricao: intent.descricao || "Compra parcelada"
                })
                .select()
                .single();

              if (!errParc && parcelamento) {
                // Cria as transações para cada parcela
                const hoje = new Date();
                const transacoesParcelas = [];
                
                for (let i = 0; i < intent.parcelas; i++) {
                  const dataParcela = new Date(hoje);
                  dataParcela.setMonth(dataParcela.getMonth() + i);
                  
                  transacoesParcelas.push({
                    usuario_id: usuarioId,
                    valor: valorParcela,
                    categoria: intent.categoria || "compras",
                    tipo: "saida",
                    observacao: intent.descricao,
                    descricao: intent.descricao,
                    parcela: `${i + 1}/${intent.parcelas}`,
                    parcela_atual: i + 1,
                    total_parcelas: intent.parcelas,
                    parcelamento_id: parcelamento.id,
                    data: dataParcela.toISOString(),
                    status: i === 0 ? "confirmada" : "prevista",
                    origem: "whatsapp"
                  });
                }

                await supabase.from("transacoes").insert(transacoesParcelas);

                acaoRealizada = `✅ Parcelamento criado!\n\n` +
                  `📦 ${intent.descricao || "Compra"}\n` +
                  `💰 Valor total: R$ ${intent.valor.toFixed(2)}\n` +
                  `📅 ${intent.parcelas}x de R$ ${valorParcela.toFixed(2)}\n\n` +
                  `A primeira parcela já foi registrada neste mês. As próximas serão lançadas automaticamente.`;
              }
            }
            break;
          }

          case "criar_recorrente": {
            // FIX 1 & 4: Verificar se tem todos os dados necessários
            const temValor = intent.valor !== null && intent.valor !== undefined;
            
            if (temValor) {
              // Tem todos os dados - criar direto
              const { error } = await supabase.from("gastos_recorrentes").insert({
                usuario_id: usuarioId,
                valor_parcela: intent.valor,
                categoria: intent.categoria || "assinaturas",
                tipo_recorrencia: intent.tipo_recorrencia || "mensal",
                dia_mes: intent.dia_mes || new Date().getDate(),
                descricao: intent.descricao,
                ativo: true,
                proxima_execucao: null,
                origem: "whatsapp"
              });

              if (!error) {
                const diaTexto = intent.dia_mes ? `todo dia ${intent.dia_mes}` : "mensalmente";
                acaoRealizada = `✅ Gasto recorrente cadastrado!\n\n` +
                  `🔄 ${intent.descricao || intent.categoria}\n` +
                  `💰 R$ ${Number(intent.valor).toFixed(2)} ${diaTexto}\n\n` +
                  `Vou registrar automaticamente quando a data chegar.`;
                console.log("✅ Gasto recorrente criado com sucesso (fluxo direto)!");
              } else {
                console.error("Erro ao criar gasto recorrente:", error);
              }
            } else {
              // Faltam dados - iniciar fluxo multi-mensagem
              const dadosFaltantes: string[] = [];
              if (!temValor) dadosFaltantes.push("valor");
              
              const pergunta = "Para cadastrar esse gasto recorrente, preciso saber o valor. Quanto você paga? (ex: 59,90)";
              
              const aiResponse = await generateResponse(messageText, "", pergunta);
              
              // Salva estado do fluxo
              await salvarFluxoAtivo(
                phoneNumber,
                usuarioId,
                "criar_recorrente",
                {
                  categoria: intent.categoria,
                  descricao: intent.descricao,
                  tipo_recorrencia: intent.tipo_recorrencia,
                  dia_mes: intent.dia_mes
                },
                dadosFaltantes,
                messageText,
                aiResponse
              );
              
              await sendWhatsAppMessage(phoneNumber, aiResponse, messageSource);
              
              return new Response(
                JSON.stringify({ status: "ok", message_sent: true }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            break;
          }

          case "consultar_resumo": {
            const resumo = await getResumoMes(usuarioId);
            
            let categoriasTexto = "";
            const categoriasOrdenadas = Object.entries(resumo.porCategoria)
              .sort(([,a], [,b]) => b - a)
              .slice(0, 5);
            
            if (categoriasOrdenadas.length > 0) {
              categoriasTexto = "\n\n📊 Maiores gastos por categoria:\n" +
                categoriasOrdenadas.map(([cat, val]) => 
                  `• ${cat}: R$ ${val.toFixed(2)}`
                ).join("\n");
            }

            contextoDados = `📅 Resumo do mês atual:\n\n` +
              `💵 Entradas: R$ ${resumo.totalEntradas.toFixed(2)}\n` +
              `💸 Saídas: R$ ${resumo.totalSaidas.toFixed(2)}\n` +
              `📈 Saldo: R$ ${resumo.saldo.toFixed(2)}` +
              categoriasTexto;
            break;
          }

          case "consultar_categoria": {
            if (intent.categoria_consulta) {
              const transacoes = await getTransacoesPorCategoria(usuarioId, intent.categoria_consulta);
              const total = transacoes.reduce((sum, t) => sum + Number(t.valor), 0);
              
              if (transacoes.length > 0) {
                const listaTransacoes = transacoes.slice(0, 10).map(t => {
                  const data = new Date(t.data).toLocaleDateString("pt-BR");
                  const desc = t.descricao || t.observacao || t.categoria;
                  return `• ${data}: R$ ${Number(t.valor).toFixed(2)} - ${desc}`;
                }).join("\n");

                contextoDados = `📊 Gastos em ${intent.categoria_consulta} este mês:\n\n` +
                  `💰 Total: R$ ${total.toFixed(2)}\n` +
                  `📝 ${transacoes.length} transação(ões)\n\n` +
                  `Detalhes:\n${listaTransacoes}`;
              } else {
                contextoDados = `Você não teve gastos em ${intent.categoria_consulta} este mês.`;
              }
            }
            break;
          }

          case "consultar_detalhes": {
            const resumo = await getResumoMes(usuarioId);
            
            if (resumo.transacoes.length > 0) {
              const transacoesFormatadas = resumo.transacoes
                .slice(0, 15)
                .map(t => {
                  const data = new Date(t.data).toLocaleDateString("pt-BR");
                  const sinal = t.tipo === "entrada" ? "+" : "-";
                  const desc = t.descricao || t.observacao || t.categoria;
                  const parcela = t.parcela ? ` (${t.parcela})` : "";
                  return `• ${data}: ${sinal}R$ ${Number(t.valor).toFixed(2)} - ${desc}${parcela}`;
                }).join("\n");

              contextoDados = `📋 Suas transações do mês:\n\n${transacoesFormatadas}\n\n` +
                `Total: ${resumo.transacoes.length} transações`;
            } else {
              contextoDados = "Você ainda não tem transações registradas este mês.";
            }
            break;
          }

          case "saudacao":
          case "ajuda":
          case "outro":
          default: {
            // Apenas busca contexto para a resposta
            const resumo = await getResumoMes(usuarioId);
            contextoDados = `Resumo atual: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, ` +
              `Saídas R$ ${resumo.totalSaidas.toFixed(2)}, Saldo R$ ${resumo.saldo.toFixed(2)}`;
            break;
          }
        }
      }
    }

    // 5. Gera resposta com AI
    const contextoCompleto = contextoDados || acaoRealizada 
      ? `${acaoRealizada}\n\n${contextoDados}`.trim() 
      : "";
    
    const aiResponse = await generateResponse(messageText, contextoCompleto, acaoRealizada);

    // 6. Salva histórico
    await supabase.from("historico_conversas").insert({
      phone_number: phoneNumber,
      user_id: usuarioId,
      user_message: messageText,
      ai_response: aiResponse,
      tipo: intent.intent
    });

    // 7. Envia resposta via WhatsApp (usando a mesma origem que recebeu)
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
