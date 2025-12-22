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

// Interface ATUALIZADA para fluxo ativo com ultima_pergunta
interface FluxoAtivo {
  intent: string;
  dados_coletados: Partial<ExtractedIntent>;
  dados_faltantes: string[];
  ultima_pergunta: string;  // NOVO: Contexto da última pergunta
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

// ========== FUNÇÕES DE CONTROLE DE ESTADO ==========

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
      console.log("⏰ Fluxo ativo expirado (mais de 10 min)");
      return null;
    }

    return JSON.parse(data.resumo) as FluxoAtivo;
  } catch (error) {
    console.log("Nenhum fluxo ativo encontrado");
    return null;
  }
}

// Salva fluxo ativo ATUALIZADO com ultima_pergunta
async function salvarFluxoAtivo(
  phoneNumber: string, 
  userId: string,
  intentOriginal: string,
  dadosColetados: Partial<ExtractedIntent>,
  dadosFaltantes: string[],
  mensagemUsuario: string,
  respostaBot: string,
  ultimaPergunta: string  // NOVO parâmetro
): Promise<void> {
  const fluxo: FluxoAtivo = {
    intent: intentOriginal,
    dados_coletados: dadosColetados,
    dados_faltantes: dadosFaltantes,
    ultima_pergunta: ultimaPergunta,  // NOVO
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

// ========== NOVA FUNÇÃO: IA COMO ORQUESTRADORA COGNITIVA ==========
// Substitui extractDadosResposta - agora a IA interpreta com CONTEXTO COMPLETO
async function interpretarRespostaComContexto(
  mensagemUsuario: string, 
  fluxoAtivo: FluxoAtivo
): Promise<InterpretacaoIA> {
  console.log("🧠 Interpretando resposta com contexto completo...");
  console.log(`   Fluxo: ${fluxoAtivo.intent}`);
  console.log(`   Dados coletados: ${JSON.stringify(fluxoAtivo.dados_coletados)}`);
  console.log(`   Dados faltantes: ${fluxoAtivo.dados_faltantes.join(", ")}`);
  console.log(`   Última pergunta: ${fluxoAtivo.ultima_pergunta}`);
  console.log(`   Mensagem do usuário: ${mensagemUsuario}`);
  
  try {
    // Prompt dinâmico com CONTEXTO COMPLETO - IA como intérprete cognitivo
    const prompt = `Você é um assistente financeiro conversacional INTELIGENTE chamado Finax.
Sua tarefa é INTERPRETAR a resposta do usuário no contexto da conversa ativa.

═══════════════════════════════════════════════════════════
CONTEXTO DO FLUXO ATIVO
═══════════════════════════════════════════════════════════
Fluxo em andamento: ${fluxoAtivo.intent}
Dados já coletados: ${JSON.stringify(fluxoAtivo.dados_coletados, null, 2)}
Dados que ainda precisamos: ${fluxoAtivo.dados_faltantes.join(", ")}

═══════════════════════════════════════════════════════════
ÚLTIMA PERGUNTA FEITA AO USUÁRIO
═══════════════════════════════════════════════════════════
"${fluxoAtivo.ultima_pergunta}"

═══════════════════════════════════════════════════════════
MENSAGEM DO USUÁRIO (resposta à pergunta acima)
═══════════════════════════════════════════════════════════
"${mensagemUsuario}"

═══════════════════════════════════════════════════════════
REGRAS DE INTERPRETAÇÃO
═══════════════════════════════════════════════════════════

1. NÚMEROS POR EXTENSO - Converta para valor numérico:
   - "dez" → 10
   - "vinte" → 20
   - "vinte e três" → 23
   - "trinta e um" → 31
   - "quinze" → 15
   - "acho que vinte e três" → 23

2. PADRÕES DE DIA DO MÊS:
   - "dia 10" → dia_mes: 10
   - "no dia 15" → dia_mes: 15
   - "acho que dia vinte e três" → dia_mes: 23
   - "todo dia 5" → dia_mes: 5
   - "23" (número puro) → dia_mes: 23

3. VALORES MONETÁRIOS:
   - "59,90" → valor: 59.90
   - "R$ 100" → valor: 100
   - "cem reais" → valor: 100
   - "cinquenta e nove e noventa" → valor: 59.90

4. INTENÇÕES ESPECIAIS:
   - "cancelar", "cancela", "parar", "deixa pra lá", "esquece" → intencao: "cancelar"
   - Se o usuário menciona algo COMPLETAMENTE diferente (ex: "gastei 50 no mercado") → intencao: "novo_comando"
   - Se a mensagem responde à pergunta → intencao: "continuar_fluxo"
   - Se não faz sentido → intencao: "indefinida"

5. REGRA CRÍTICA:
   - Interprete a mensagem COMO RESPOSTA À PERGUNTA, não como comando novo
   - Se a pergunta era "qual dia do mês?" e o usuário disse "vinte e três", isso É o dia 23
   - Não peça confirmação, apenas extraia o valor

═══════════════════════════════════════════════════════════
FORMATO DE RESPOSTA (JSON OBRIGATÓRIO)
═══════════════════════════════════════════════════════════
{
  "campo": "dia_mes",           // ou "valor", "descricao", etc. - qual dado foi informado
  "valor": 23,                  // o valor extraído/convertido
  "confianca": 0.95,            // 0 a 1, quão certo você está
  "intencao": "continuar_fluxo" // "continuar_fluxo", "cancelar", "novo_comando" ou "indefinida"
}

Se intencao for "indefinida", adicione:
{
  "campo": null,
  "valor": null,
  "confianca": 0.2,
  "intencao": "indefinida",
  "mensagem_clarificacao": "Não entendi sua resposta. Você pode me dizer o dia do mês? Por exemplo: 10, dia 15, ou vinte e três."
}

RESPONDA APENAS COM O JSON, SEM EXPLICAÇÕES.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: mensagemUsuario }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"intencao": "indefinida", "confianca": 0}';
    
    // Limpa markdown do JSON
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    console.log("🧠 Interpretação da IA (raw):", cleanJson);
    
    const interpretacao: InterpretacaoIA = JSON.parse(cleanJson);
    console.log("🧠 Interpretação processada:", JSON.stringify(interpretacao));
    
    return interpretacao;
  } catch (error) {
    console.error("❌ Erro ao interpretar resposta:", error);
    return {
      confianca: 0,
      intencao: "indefinida",
      mensagem_clarificacao: "Desculpe, não consegui processar sua resposta. Pode tentar novamente?"
    };
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
            content: `You are Finax, a personal finance assistant operating via WhatsApp.

CRITICAL SCOPE RULE (NON-NEGOTIABLE):
You are NOT a general-purpose AI.
Your ONLY allowed domain is PERSONAL FINANCE.

You are allowed to:
- Register expenses and income
- Understand natural language descriptions of money movements
- Handle recurring expenses and installments
- Provide financial summaries and reports
- Help users understand their financial situation
- Give practical tips about budgeting and money organization
- Explain how Finax works

You are NOT allowed to:
- Answer general knowledge questions
- Engage in casual conversation unrelated to finance
- Talk about politics, news, entertainment, recipes, jokes, or personal topics
- Act as a generic assistant or chatbot

If a user message is OUTSIDE the finance domain:
- Politely refuse
- Explain that you are focused on financial organization
- Redirect the user back to a finance-related action

IMPORTANT:
- You must ALWAYS understand the user's message, even if it is informal or ambiguous.
- Do NOT rely on rigid patterns or keywords.
- Use reasoning and context to determine intent.
- If a message can reasonably relate to finances, treat it as finance.
- When in doubt, ask a clarifying question related to finances.
- ALWAYS respond in Portuguese (Brazilian).

REFUSAL TEMPLATE (use when message is outside finance domain):
"Meu foco é te ajudar a organizar suas finanças 💰
Posso registrar gastos, mostrar resumos ou ajudar com orçamento.
O que você gostaria de fazer?"

ABSOLUTE RULE:
You must NEVER calculate financial totals.
All monetary calculations are provided by the system and are always correct.
Just format and present the data provided.

FORMATTING RULES:
- Be friendly, use emojis sparingly (1-2 per message)
- Format responses with line breaks for readability
- Be concise but informative
- Use natural language, like a helpful friend
- Use blank lines to separate sections
- List items with • or -
- Highlight important values with *bold*

${acaoRealizada ? `ACTION PERFORMED:\n${acaoRealizada}\n` : ""}

${context ? `FINANCIAL CONTEXT (pre-calculated - DO NOT recalculate):\n${context}` : ""}

Respond naturally and helpfully. If a transaction was registered, confirm with details.
If it's a query, present the data clearly and organized.`
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

// Verificar limites do plano free
async function verificarLimitePlano(usuarioId: string): Promise<{ permitido: boolean; mensagem?: string }> {
  try {
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("plano, mensagens_hoje, ultima_mensagem_data, limite_mensagens_dia")
      .eq("id", usuarioId)
      .single();
    
    if (!usuario) return { permitido: true };
    
    // Plano pago = sem limites
    if (usuario.plano && usuario.plano !== "free") {
      return { permitido: true };
    }
    
    const hoje = new Date().toISOString().split("T")[0];
    const ultimaData = usuario.ultima_mensagem_data;
    
    // Reset contador se é um novo dia
    if (ultimaData !== hoje) {
      await supabase.from("usuarios").update({
        mensagens_hoje: 1,
        ultima_mensagem_data: hoje
      }).eq("id", usuarioId);
      return { permitido: true };
    }
    
    // Verificar limite
    const limite = usuario.limite_mensagens_dia || 20;
    if ((usuario.mensagens_hoje || 0) >= limite) {
      return {
        permitido: false,
        mensagem: `Você atingiu o limite de ${limite} mensagens do plano gratuito hoje! 🔒\n\n` +
          `Amanhã seu limite será renovado.\n\n` +
          `Para uso ilimitado, faça upgrade para o plano Premium! ⭐`
      };
    }
    
    // Incrementar contador
    await supabase.from("usuarios").update({
      mensagens_hoje: (usuario.mensagens_hoje || 0) + 1
    }).eq("id", usuarioId);
    
    return { permitido: true };
  } catch (error) {
    console.error("Erro ao verificar limite:", error);
    return { permitido: true }; // Em caso de erro, permite
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

// Busca transações por categoria
async function getTransacoesPorCategoria(usuarioId: string, categoria: string, periodo?: string) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
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
    .not("tipo", "like", "fluxo_ativo_%")
    .order("created_at", { ascending: false })
    .limit(3);

  if (!historico || historico.length === 0) return "";

  return historico.reverse().map(h => 
    `Usuário: ${h.user_message}\nAssistente: ${h.ai_response}`
  ).join("\n\n");
}

// Detectar múltiplos gastos
function detectarMultiplosGastos(mensagem: string): string[] {
  const linhas = mensagem.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const padraoGasto = /(?:gast[ei|ou]|pagu[ei|ou]|compr[ei|ou]|compra|gasto|pagamento)\s*(?:de\s*)?(?:R\$\s*)?\d+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?\s*(?:reais?|R\$)?\s*(?:em|no|na|de|com)/i;
  
  const gastosDetectados: string[] = [];
  
  for (const linha of linhas) {
    if (padraoGasto.test(linha)) {
      gastosDetectados.push(linha);
    }
  }
  
  if (gastosDetectados.length <= 1 && linhas.length === 1) {
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
    
    if (json.channel === "whatsapp" && json.from && json.text !== undefined) {
      console.log("📱 Detectado formato VONAGE");
      messageSource = "vonage";
      phoneNumber = json.from;
      messageText = json.text || "";
      
      if (json.message_type !== "text" || !messageText) {
        console.log(`Ignorando mensagem Vonage do tipo: ${json.message_type}`);
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
        console.log("Ignorando: não é uma mensagem de usuário (pode ser status update)");
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const message = value.messages[0];
      phoneNumber = message.from;
      messageText = message.text?.body || "";
      
      if (message.type !== "text" || !messageText) {
        console.log(`Ignorando mensagem Meta do tipo: ${message.type}`);
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
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

    // ========== VERIFICAR LIMITES DO PLANO FREE ==========
    const limiteCheck = await verificarLimitePlano(usuarioId);
    if (!limiteCheck.permitido) {
      console.log("🚫 Usuário atingiu limite do plano free");
      await sendWhatsAppMessage(phoneNumber, limiteCheck.mensagem!, messageSource);
      return new Response(
        JSON.stringify({ status: "ok", message: "rate_limited" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Busca histórico recente para contexto
    const historicoRecente = await getHistoricoRecente(phoneNumber);

    let acaoRealizada = "";
    let contextoDados = "";
    let intent: ExtractedIntent = { intent: "outro" };

    // ========== NOVA LÓGICA: VERIFICAR FLUXO ATIVO COM IA COGNITIVA ==========
    const fluxoAtivo = await getFluxoAtivo(phoneNumber);
    
    if (fluxoAtivo) {
      console.log("🔄 Fluxo ativo encontrado:", JSON.stringify(fluxoAtivo));
      
      // NOVA ARQUITETURA: Usar IA como orquestradora cognitiva
      const interpretacao = await interpretarRespostaComContexto(messageText, fluxoAtivo);
      
      console.log("🧠 Resultado da interpretação:", JSON.stringify(interpretacao));
      
      // ========== PROCESSAMENTO BASEADO NA INTENÇÃO ==========
      
      if (interpretacao.intencao === "cancelar") {
        // Usuário quer cancelar o fluxo
        console.log("❌ Usuário cancelou o fluxo");
        await limparFluxoAtivo(phoneNumber);
        
        const resposta = "Ok, cancelei a operação! 👍 Como posso te ajudar?";
        await sendWhatsAppMessage(phoneNumber, resposta, messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: messageText,
          ai_response: resposta,
          tipo: "fluxo_cancelado"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", message_sent: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (interpretacao.intencao === "novo_comando") {
        // Usuário quer fazer algo diferente - limpa fluxo e processa normalmente
        console.log("🔀 Usuário iniciou novo comando - limpando fluxo antigo");
        await limparFluxoAtivo(phoneNumber);
        // Continua para o fluxo normal abaixo (extractIntent)
      }
      
      else if (interpretacao.intencao === "continuar_fluxo") {
        // FLUXO PRINCIPAL: Continuar com os dados interpretados
        console.log("✅ Continuando fluxo com dados interpretados");
        
        // Mescla dados SEM sobrescrever com null/undefined
        const dadosMesclados = { ...fluxoAtivo.dados_coletados };
        if (interpretacao.campo && interpretacao.valor !== null && interpretacao.valor !== undefined) {
          (dadosMesclados as any)[interpretacao.campo] = interpretacao.valor;
          console.log(`✅ Adicionado ${interpretacao.campo}: ${interpretacao.valor}`);
        }
        console.log("📦 Dados mesclados:", JSON.stringify(dadosMesclados));
        
        // Atualiza lista de dados faltantes
        const dadosAindaFaltantes = fluxoAtivo.dados_faltantes.filter(campo => {
          const valor = dadosMesclados[campo as keyof ExtractedIntent];
          return valor === null || valor === undefined;
        });
        console.log("📋 Dados ainda faltantes:", dadosAindaFaltantes);
        
        if (fluxoAtivo.intent === "criar_recorrente") {
          const temValor = dadosMesclados.valor !== null && dadosMesclados.valor !== undefined && Number(dadosMesclados.valor) > 0;
          const temDiaMes = dadosMesclados.dia_mes !== null && dadosMesclados.dia_mes !== undefined && Number(dadosMesclados.dia_mes) > 0;
          
          console.log(`📊 Estado: temValor=${temValor} (${dadosMesclados.valor}), temDiaMes=${temDiaMes} (${dadosMesclados.dia_mes})`);
          
          if (temValor && temDiaMes) {
            // SUCESSO: Tem todos os dados para criar recorrente
            console.log("🎉 Todos os dados coletados - criando gasto recorrente!");
            
            const { error } = await supabase.from("gastos_recorrentes").insert({
              usuario_id: usuarioId,
              valor_parcela: dadosMesclados.valor,
              categoria: dadosMesclados.categoria || "assinaturas",
              tipo_recorrencia: "Mensal", // Maiúsculo para passar no check constraint
              dia_mes: dadosMesclados.dia_mes,
              descricao: dadosMesclados.descricao,
              ativo: true,
              proxima_execucao: null,
              origem: "whatsapp"
            });

            if (!error) {
              await limparFluxoAtivo(phoneNumber);
              acaoRealizada = `✅ Gasto recorrente cadastrado com sucesso!\n\n` +
                `🔄 ${dadosMesclados.descricao || dadosMesclados.categoria || "Gasto recorrente"}\n` +
                `💰 R$ ${Number(dadosMesclados.valor).toFixed(2)} todo dia ${dadosMesclados.dia_mes}\n\n` +
                `Vou registrar automaticamente quando a data chegar.`;
              console.log("✅ Gasto recorrente criado com sucesso!");
            } else {
              console.error("❌ Erro ao criar gasto recorrente:", error);
              acaoRealizada = "❌ Erro ao criar o gasto recorrente. Tente novamente.";
              await limparFluxoAtivo(phoneNumber);
            }
          } else if (temValor && !temDiaMes) {
            // Tem valor mas falta dia do mês
            const pergunta = `Qual o *dia do mês* que você costuma fazer esse pagamento de R$ ${Number(dadosMesclados.valor).toFixed(2)}? 📅`;
            
            const aiResponse = await generateResponse(messageText, "", pergunta);
            
            await salvarFluxoAtivo(
              phoneNumber,
              usuarioId,
              "criar_recorrente",
              dadosMesclados,
              ["dia_mes"],
              messageText,
              aiResponse,
              pergunta  // NOVO: Salva a pergunta para contexto
            );
            
            await sendWhatsAppMessage(phoneNumber, aiResponse, messageSource);
            
            return new Response(
              JSON.stringify({ status: "ok", message_sent: true }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else {
            // Falta valor
            const pergunta = "Qual o valor do gasto recorrente? 💰 (ex: 59,90)";
            
            const aiResponse = await generateResponse(messageText, "", pergunta);
            
            await salvarFluxoAtivo(
              phoneNumber,
              usuarioId,
              "criar_recorrente",
              dadosMesclados,
              ["valor"],
              messageText,
              aiResponse,
              pergunta
            );
            
            await sendWhatsAppMessage(phoneNumber, aiResponse, messageSource);
            
            return new Response(
              JSON.stringify({ status: "ok", message_sent: true }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }
      
      else if (interpretacao.intencao === "indefinida") {
        // REGRA CRÍTICA: NÃO dispara fallback genérico - pede clarificação
        console.log("❓ Intenção indefinida - pedindo clarificação (SEM fallback genérico)");
        
        const mensagemClarificacao = interpretacao.mensagem_clarificacao || 
          `Desculpe, não entendi sua resposta. ${fluxoAtivo.ultima_pergunta || "Pode tentar de outra forma?"}`;
        
        await sendWhatsAppMessage(phoneNumber, mensagemClarificacao, messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: messageText,
          ai_response: mensagemClarificacao,
          tipo: "clarificacao_fluxo"
        });
        
        return new Response(
          JSON.stringify({ status: "ok", message_sent: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    
    // ========== FLUXO NORMAL (SEM fluxo ativo ou após novo_comando) ==========
    if (!fluxoAtivo || (fluxoAtivo && acaoRealizada === "")) {
      // Verificar múltiplos gastos
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

        // Processa baseado no intent
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
                  `📅 ${intent.parcelas}x de R$ ${valorParcela.toFixed(2)}`;
              }
            }
            break;
          }

          case "criar_recorrente": {
            console.log(`criar_recorrente - temValor: ${intent.valor !== null && intent.valor !== undefined} (${intent.valor}), temDiaMes: ${intent.dia_mes !== null && intent.dia_mes !== undefined} (${intent.dia_mes})`);
            
            // Verifica se tem todos os dados necessários
            const temValor = intent.valor !== null && intent.valor !== undefined && Number(intent.valor) > 0;
            const temDiaMes = intent.dia_mes !== null && intent.dia_mes !== undefined && Number(intent.dia_mes) > 0;
            
            if (temValor && temDiaMes) {
              // Tem todos os dados - cria imediatamente
              const { error } = await supabase.from("gastos_recorrentes").insert({
                usuario_id: usuarioId,
                valor_parcela: intent.valor,
                categoria: intent.categoria || "assinaturas",
                tipo_recorrencia: "Mensal",
                dia_mes: intent.dia_mes,
                descricao: intent.descricao,
                ativo: true,
                proxima_execucao: null,
                origem: "whatsapp"
              });

              if (!error) {
                acaoRealizada = `✅ Gasto recorrente cadastrado!\n\n` +
                  `🔄 ${intent.descricao || intent.categoria || "Gasto recorrente"}\n` +
                  `💰 R$ ${Number(intent.valor).toFixed(2)} todo dia ${intent.dia_mes}\n\n` +
                  `Vou registrar automaticamente quando a data chegar.`;
              } else {
                console.error("Erro ao criar gasto recorrente:", error);
                acaoRealizada = "❌ Erro ao criar o gasto recorrente. Tente novamente.";
              }
            } else if (temValor && !temDiaMes) {
              // Tem valor mas falta dia - pergunta e salva fluxo
              const pergunta = `Qual o *dia do mês* que você costuma fazer esse pagamento de R$ ${Number(intent.valor).toFixed(2)}? 📅`;
              
              const aiResponse = await generateResponse(messageText, "", pergunta);
              
              await salvarFluxoAtivo(
                phoneNumber,
                usuarioId,
                "criar_recorrente",
                {
                  valor: intent.valor,
                  categoria: intent.categoria,
                  descricao: intent.descricao,
                  tipo_recorrencia: intent.tipo_recorrencia || "mensal"
                },
                ["dia_mes"],
                messageText,
                aiResponse,
                pergunta
              );
              
              await sendWhatsAppMessage(phoneNumber, aiResponse, messageSource);
              
              return new Response(
                JSON.stringify({ status: "ok", message_sent: true }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            } else {
              // Falta valor - pergunta
              const pergunta = "Para cadastrar esse gasto recorrente, preciso saber o valor. Quanto você paga? 💰 (ex: 59,90)";
              
              const aiResponse = await generateResponse(messageText, "", pergunta);
              
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
                ["valor"],
                messageText,
                aiResponse,
                pergunta
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

            // TOTAIS PRÉ-CALCULADOS - a IA NÃO deve recalcular
            contextoDados = `📅 Resumo do mês atual:\n\n` +
              `💵 Entradas: *R$ ${resumo.totalEntradas.toFixed(2)}*\n` +
              `💸 Saídas: *R$ ${resumo.totalSaidas.toFixed(2)}*\n` +
              `📈 Saldo: *R$ ${resumo.saldo.toFixed(2)}*` +
              categoriasTexto +
              `\n\n⚠️ IMPORTANTE: Estes valores são EXATOS e pré-calculados. NÃO recalcule.`;
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

              // TOTAIS PRÉ-CALCULADOS
              contextoDados = `📋 Suas transações do mês:\n\n${transacoesFormatadas}\n\n` +
                `═══════════════════════════════\n` +
                `📊 *TOTAIS (pré-calculados - não recalcule):*\n` +
                `💵 Entradas: *R$ ${resumo.totalEntradas.toFixed(2)}*\n` +
                `💸 Saídas: *R$ ${resumo.totalSaidas.toFixed(2)}*\n` +
                `📈 Saldo: *R$ ${resumo.saldo.toFixed(2)}*\n` +
                `═══════════════════════════════\n` +
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
            const resumo = await getResumoMes(usuarioId);
            contextoDados = `Resumo atual: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, ` +
              `Saídas R$ ${resumo.totalSaidas.toFixed(2)}, Saldo R$ ${resumo.saldo.toFixed(2)}`;
            break;
          }
        }
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

    // Envia resposta via WhatsApp
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
