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
    | "cancelar_transacao"
    | "corrigir_transacao"
    | "apagar_transacao"
    | "iniciar_organizacao"
    | "saudacao"
    | "ajuda"
    | "outro";
  
  // Para transações simples
  valor?: number;
  categoria?: string;
  descricao?: string;
  forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
  cartao_id?: string;
  
  // Para parcelamentos
  parcelas?: number;
  
  // Para recorrentes
  tipo_recorrencia?: "mensal" | "semanal" | "anual";
  dia_mes?: number;
  dia_semana?: string;
  
  // Para consultas
  periodo?: string; // "mes_atual", "dezembro", "semana", etc.
  categoria_consulta?: string;
  
  // Para cancelamentos/correções
  transacao_alvo?: string; // descrição da transação a ser alterada
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
- "cancelar_transacao": usuário quer cancelar/apagar/desfazer algo (ex: "cancela isso", "apaga", "registrei errado", "cancela a conta")
- "corrigir_transacao": usuário quer corrigir/editar algo já registrado
- "apagar_transacao": usuário quer deletar uma transação específica (ex: "apaga o gasto de 50 do mercado")
- "iniciar_organizacao": usuário quer organizar cartões, salário, contas fixas (ex: "quero organizar", "sim" após convite do onboarding)
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
8. "cancela", "apaga", "desfaz", "registrei errado", "deixa pra lá", "deleta" → intent = "cancelar_transacao" ou "apagar_transacao"
9. "errei", "corrige", "era X não Y", "valor errado" → intent = "corrigir_transacao"
10. "sim", "quero organizar", "vamos lá", "bora" (contexto de onboarding) → intent = "iniciar_organizacao"

FORMAS DE PAGAMENTO:
- "no pix", "via pix", "pix" → forma_pagamento = "pix"
- "dinheiro", "em espécie", "cash" → forma_pagamento = "dinheiro"
- "débito", "cartão de débito" → forma_pagamento = "debito"
- "crédito", "cartão de crédito", "no cartão" → forma_pagamento = "credito"

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
  "forma_pagamento": "pix" | "dinheiro" | "debito" | "credito" ou null,
  "parcelas": number ou null,
  "tipo_recorrencia": "string" ou null,
  "dia_mes": number ou null,
  "dia_semana": "string" ou null,
  "periodo": "string" ou null,
  "categoria_consulta": "string" ou null,
  "transacao_alvo": "string" ou null
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
            content: `Você é o Finax, um assistente financeiro pessoal via WhatsApp.

═══════════════════════════════════════════════════════════
📌 ESCOPO PERMITIDO (APENAS FINANÇAS PESSOAIS)
═══════════════════════════════════════════════════════════

VOCÊ PODE:
✅ Registrar gastos e entradas
✅ Entender descrições naturais de movimentações financeiras
✅ Gerenciar gastos recorrentes e parcelamentos
✅ Fornecer resumos e relatórios financeiros
✅ Ajudar a entender a situação financeira
✅ Dar dicas práticas sobre orçamento e organização
✅ Explicar como o Finax funciona

VOCÊ NÃO PODE:
❌ Responder perguntas de conhecimento geral
❌ Conversar sobre temas não relacionados a finanças
❌ Falar sobre política, notícias, entretenimento, receitas, piadas
❌ Atuar como assistente genérico

Se a mensagem estiver FORA do domínio financeiro:
"Meu foco é te ajudar a organizar suas finanças 💰
Posso registrar gastos, mostrar resumos ou ajudar com orçamento.
O que você gostaria de fazer?"

═══════════════════════════════════════════════════════════
🚨 REGRA CRÍTICA: A IA NÃO CALCULA
═══════════════════════════════════════════════════════════

🚫 NUNCA calcule valores financeiros
🚫 NUNCA some, subtraia, tire médias ou percentuais
🚫 NUNCA refaça cálculos que já foram fornecidos
✅ Todos os valores numéricos são PRÉ-CALCULADOS pelo sistema
✅ Apenas APRESENTE e INTERPRETE os dados fornecidos
✅ Confie 100% nos números que receber

═══════════════════════════════════════════════════════════
💬 COMPORTAMENTO CONSULTIVO
═══════════════════════════════════════════════════════════

Você é um CONSULTOR FINANCEIRO PESSOAL, não um robô.

VOCÊ PODE:
• Analisar padrões de gastos
• Apontar excessos com linguagem leve
• Sugerir ajustes simples
• Alertar riscos financeiros com cuidado

VOCÊ NÃO PODE:
• Julgar o usuário
• Usar tom agressivo ou crítico
• Dar conselhos técnicos ou complexos
• Fazer previsões absolutas (use "tende a", "pode indicar")

═══════════════════════════════════════════════════════════
📝 FORMATO DAS MENSAGENS (WHATSAPP)
═══════════════════════════════════════════════════════════

• Mensagens CURTAS e escaneáveis
• Emojis com MODERAÇÃO (2-3 no máximo)
• Blocos bem separados com linhas em branco
• Clareza > texto longo
• Linguagem simples para público geral
• Destaque valores importantes com *negrito*
• Use • ou - para listas

═══════════════════════════════════════════════════════════
📋 REGRA CRÍTICA SOBRE PLANOS
═══════════════════════════════════════════════════════════

🚫 VOCÊ NUNCA DEVE:
• Mencionar planos, pagamentos, assinaturas ou bloqueios
• Falar sobre trial, período de teste ou expiração
• Mencionar preços, valores de planos ou monetização
• Dizer que algo está bloqueado ou limitado

✅ SE O USUÁRIO PERGUNTAR SOBRE PLANOS:
"O controle de acesso é feito automaticamente pelo sistema.
Se precisar de ajuda com isso, entre em contato conosco pelo site."

O backend controla 100% do acesso. Você foca APENAS em finanças.

${acaoRealizada ? `\n═══════════════════════════════════════════════════════════\n✅ AÇÃO REALIZADA\n═══════════════════════════════════════════════════════════\n${acaoRealizada}\n` : ""}

${context ? `\n═══════════════════════════════════════════════════════════\n📊 CONTEXTO FINANCEIRO (PRÉ-CALCULADO - NÃO RECALCULE)\n═══════════════════════════════════════════════════════════\n${context}` : ""}

Responda de forma natural, amigável e consultiva.`
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

// ========== FUNÇÕES PARA RELATÓRIOS USANDO BACKEND ==========

// Busca relatório semanal calculado no backend
// tipoPeriodo: "semana_atual" (segunda até hoje) ou "semana_passada" (segunda a domingo anterior)
async function getRelatorioSemanal(usuarioId: string, tipoPeriodo: "semana_atual" | "semana_passada" = "semana_atual"): Promise<any> {
  try {
    console.log(`📊 Buscando relatório semanal: ${tipoPeriodo} para usuário ${usuarioId}`);
    
    const { data, error } = await supabase.rpc("fn_relatorio_semanal", { 
      p_usuario_id: usuarioId,
      p_tipo_periodo: tipoPeriodo
    });
    
    if (error) {
      console.error("Erro ao buscar relatório semanal:", error);
      return null;
    }
    console.log("📊 Relatório semanal obtido:", JSON.stringify(data));
    return data;
  } catch (error) {
    console.error("Erro no relatório semanal:", error);
    return null;
  }
}

// Busca relatório mensal calculado no backend
async function getRelatorioMensal(usuarioId: string, mes?: number, ano?: number): Promise<any> {
  try {
    const params: any = { p_usuario_id: usuarioId };
    if (mes) params.p_mes = mes;
    if (ano) params.p_ano = ano;
    
    const { data, error } = await supabase.rpc("fn_relatorio_mensal", params);
    
    if (error) {
      console.error("Erro ao buscar relatório mensal:", error);
      return null;
    }
    return data;
  } catch (error) {
    console.error("Erro no relatório mensal:", error);
    return null;
  }
}

// Busca análise consultiva do backend
async function getAnaliseConsultiva(usuarioId: string): Promise<any> {
  try {
    const { data, error } = await supabase.rpc("fn_analise_consultiva", { 
      p_usuario_id: usuarioId 
    });
    
    if (error) {
      console.error("Erro ao buscar análise consultiva:", error);
      return null;
    }
    return data;
  } catch (error) {
    console.error("Erro na análise consultiva:", error);
    return null;
  }
}

// Detecta tipo de relatório solicitado na mensagem
interface TipoRelatorioDetectado {
  tipo: "semanal" | "mensal" | "hoje" | "resumo";
  periodo: "atual" | "passado";
}

function detectarTipoRelatorio(mensagem: string): TipoRelatorioDetectado | null {
  const msg = mensagem.toLowerCase();
  
  // Detecta relatório semanal
  if (msg.includes("semana") || msg.includes("semanal") || msg.includes("últimos 7 dias") || 
      msg.includes("essa semana") || msg.includes("desta semana") || msg.includes("essa semana") ||
      msg.includes("relatório da semana") || msg.includes("relatorio da semana")) {
    
    // Verifica se é semana passada
    if (msg.includes("passada") || msg.includes("anterior") || msg.includes("última semana") ||
        msg.includes("ultima semana") || msg.includes("semana passada")) {
      return { tipo: "semanal", periodo: "passado" };
    }
    // Default: semana atual (dessa semana)
    return { tipo: "semanal", periodo: "atual" };
  }
  
  // Detecta relatório mensal
  if (msg.includes("mês") || msg.includes("mensal") || msg.includes("esse mês") || 
      msg.includes("mes") || msg.includes("esse mes")) {
    if (msg.includes("passado") || msg.includes("anterior")) {
      return { tipo: "mensal", periodo: "passado" };
    }
    return { tipo: "mensal", periodo: "atual" };
  }
  
  if (msg.includes("hoje") || msg.includes("dia")) {
    return { tipo: "hoje", periodo: "atual" };
  }
  
  if (msg.includes("resumo") || msg.includes("balanço") || msg.includes("como estou") || msg.includes("situação")) {
    return { tipo: "resumo", periodo: "atual" };
  }
  
  return null;
}

// ========== ONBOARDING: SEQUÊNCIA DE BOAS-VINDAS HUMANIZADA ==========

interface OnboardingConfig {
  nome: string;
  urlPainel: string;
}

async function enviarOnboarding(
  phoneNumber: string, 
  messageSource: MessageSource,
  config: OnboardingConfig
): Promise<void> {
  const nome = config.nome?.split(" ")[0] || "amigo(a)"; // Usa só primeiro nome
  const urlPainel = config.urlPainel || "finax.app";
  
  // Delay entre mensagens para parecer natural
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // 1️⃣ BOAS-VINDAS (humanizada, curta)
  const msg1 = `Oi, ${nome}! 👋

Prazer, eu sou o *Finax* — seu assistente financeiro pessoal.

Estou aqui pra te ajudar a organizar suas finanças de um jeito simples, direto pelo WhatsApp.`;

  await sendWhatsAppMessage(phoneNumber, msg1, messageSource);
  await delay(2500);
  
  // 2️⃣ VALOR, NÃO FEATURES
  const msg2 = `Comigo você organiza tudo em um só lugar: gastos do dia a dia, cartões, dívidas e salário.

Sem planilha. Sem complicação. Só mandar mensagem como se fosse um amigo.`;

  await sendWhatsAppMessage(phoneNumber, msg2, messageSource);
  await delay(2000);
  
  // 3️⃣ DICA: FIXAR CONTATO
  const msg3 = `💡 *Dica importante*

Fixa o Finax no WhatsApp pra não perder seus registros no dia a dia.

Assim seu controle financeiro fica sempre a um toque.`;

  await sendWhatsAppMessage(phoneNumber, msg3, messageSource);
  await delay(2500);
  
  // 4️⃣ ACESSO PRO LIBERADO
  const msg4 = `🎁 *Acesso liberado*

Você tem acesso completo ao Finax — todas as funcionalidades estão liberadas.

Pode registrar gastos, entradas, parcelamentos, ver resumos...

Mais pra frente te aviso sobre a continuidade 😊`;

  await sendWhatsAppMessage(phoneNumber, msg4, messageSource);
  await delay(2500);
  
  // 5️⃣ CONVITE PARA CENTRALIZAR (com consentimento)
  const msg5 = `Quer que eu te ajude agora a organizar seus cartões, dívidas e salário?

Fazendo isso, fica muito mais fácil registrar gastos depois.

Responde *sim* se quiser começar, ou pode mandar direto seu primeiro gasto 💰`;

  await sendWhatsAppMessage(phoneNumber, msg5, messageSource);
  
  console.log(`✅ Onboarding completo enviado para ${phoneNumber}`);
}

// ========== FLUXO DE CENTRALIZAÇÃO (ORGANIZAÇÃO INICIAL) ==========

interface FluxoCentralizacao {
  etapa: "cartoes" | "salario" | "contas_fixas" | "concluido";
  dados: {
    cartoes?: string[];
    salario?: number;
    dia_salario?: number;
    contas_fixas?: { descricao: string; valor: number; dia: number }[];
  };
}

async function iniciarFluxoCentralizacao(
  phoneNumber: string,
  usuarioId: string,
  messageSource: MessageSource
): Promise<void> {
  const msg = `Ótimo! Vamos organizar sua base financeira 🎯

Primeiro: você usa *cartão de crédito*?

Se sim, me fala o nome do cartão (ex: "Nubank", "Inter", "C6")
Se não, responde *não uso*`;

  await sendWhatsAppMessage(phoneNumber, msg, messageSource);
  
  // Salva fluxo de centralização ativo
  const fluxo: FluxoCentralizacao = {
    etapa: "cartoes",
    dados: {}
  };
  
  await supabase.from("historico_conversas").insert({
    phone_number: phoneNumber,
    user_id: usuarioId,
    user_message: "[INICIOU CENTRALIZAÇÃO]",
    ai_response: msg,
    tipo: "fluxo_ativo_centralizacao",
    resumo: JSON.stringify(fluxo)
  });
}

async function processarFluxoCentralizacao(
  phoneNumber: string,
  usuarioId: string,
  messageSource: MessageSource,
  mensagem: string,
  fluxoAtual: FluxoCentralizacao
): Promise<boolean> {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const msgLower = mensagem.toLowerCase().trim();
  
  // Detecta se quer pular/cancelar
  if (msgLower.includes("pular") || msgLower.includes("depois") || msgLower.includes("deixa") || msgLower.includes("cancela")) {
    await sendWhatsAppMessage(phoneNumber, 
      "Sem problema! Você pode organizar isso depois.\n\nQuando quiser, é só me mandar seu primeiro gasto 💰", 
      messageSource
    );
    await limparFluxoAtivo(phoneNumber);
    return true;
  }
  
  switch (fluxoAtual.etapa) {
    case "cartoes": {
      if (msgLower.includes("não uso") || msgLower.includes("nao uso") || msgLower === "não" || msgLower === "nao") {
        // Pula para salário
        fluxoAtual.etapa = "salario";
        fluxoAtual.dados.cartoes = [];
      } else {
        // Registra cartão
        const nomeCartao = mensagem.trim();
        
        await supabase.from("cartoes_credito").insert({
          usuario_id: usuarioId,
          nome: nomeCartao,
          ativo: true
        });
        
        await sendWhatsAppMessage(phoneNumber, 
          `✅ *${nomeCartao}* cadastrado!\n\nTem mais algum cartão? Me fala o nome ou responde *pronto* pra continuar.`, 
          messageSource
        );
        
        // Mantém na etapa cartões
        fluxoAtual.dados.cartoes = [...(fluxoAtual.dados.cartoes || []), nomeCartao];
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: mensagem,
          ai_response: `Cartão ${nomeCartao} cadastrado`,
          tipo: "fluxo_ativo_centralizacao",
          resumo: JSON.stringify(fluxoAtual)
        });
        
        return true;
      }
      
      if (msgLower === "pronto" || msgLower.includes("só isso") || msgLower.includes("so isso")) {
        fluxoAtual.etapa = "salario";
      }
      
      // Pergunta sobre salário
      await delay(1000);
      await sendWhatsAppMessage(phoneNumber, 
        `Agora me conta: você recebe um salário fixo todo mês?\n\nSe sim, me fala o valor (ex: "3500") e o dia que costuma cair (ex: "dia 5")\n\nSe não, responde *não tenho*`, 
        messageSource
      );
      
      fluxoAtual.etapa = "salario";
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: mensagem,
        ai_response: "Perguntou sobre salário",
        tipo: "fluxo_ativo_centralizacao",
        resumo: JSON.stringify(fluxoAtual)
      });
      
      return true;
    }
    
    case "salario": {
      if (msgLower.includes("não tenho") || msgLower.includes("nao tenho") || msgLower === "não" || msgLower === "nao") {
        fluxoAtual.etapa = "contas_fixas";
      } else {
        // Tenta extrair valor e dia
        const valorMatch = mensagem.match(/(\d+(?:[.,]\d{2})?)/);
        const diaMatch = mensagem.match(/dia\s*(\d{1,2})/i) || mensagem.match(/(\d{1,2})(?:\s*de\s*cada)?/);
        
        if (valorMatch) {
          const valor = parseFloat(valorMatch[1].replace(",", "."));
          const dia = diaMatch ? parseInt(diaMatch[1]) : 5; // Default dia 5
          
          // Cria entrada recorrente de salário
          await supabase.from("gastos_recorrentes").insert({
            usuario_id: usuarioId,
            valor_parcela: valor,
            categoria: "salário",
            tipo_recorrencia: "Mensal",
            dia_mes: dia,
            descricao: "Salário",
            ativo: true,
            origem: "whatsapp"
          });
          
          fluxoAtual.dados.salario = valor;
          fluxoAtual.dados.dia_salario = dia;
          
          await sendWhatsAppMessage(phoneNumber, 
            `✅ Salário de *R$ ${valor.toFixed(2)}* no dia *${dia}* registrado!\n\nVou lembrar automaticamente todo mês.`, 
            messageSource
          );
        }
      }
      
      // Pergunta sobre contas fixas
      await delay(1500);
      await sendWhatsAppMessage(phoneNumber, 
        `Última etapa: você tem contas fixas todo mês? (aluguel, internet, luz...)\n\nMe fala uma por uma (ex: "aluguel 1200 dia 10") ou responde *não tenho*`, 
        messageSource
      );
      
      fluxoAtual.etapa = "contas_fixas";
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: mensagem,
        ai_response: "Perguntou sobre contas fixas",
        tipo: "fluxo_ativo_centralizacao",
        resumo: JSON.stringify(fluxoAtual)
      });
      
      return true;
    }
    
    case "contas_fixas": {
      if (msgLower.includes("não tenho") || msgLower.includes("nao tenho") || msgLower === "não" || msgLower === "nao" || 
          msgLower === "pronto" || msgLower.includes("só isso")) {
        // Finaliza centralização
        fluxoAtual.etapa = "concluido";
        
        await sendWhatsAppMessage(phoneNumber, 
          `🎉 *Pronto!* Sua base financeira está organizada.\n\nAgora registrar gastos vai ser muito mais fácil.\n\nQuando gastar algo, só me manda: _"Gastei 50 no mercado"_\n\nBora começar? 💰`, 
          messageSource
        );
        
        await limparFluxoAtivo(phoneNumber);
        return true;
      }
      
      // Tenta extrair conta fixa
      const valorMatch = mensagem.match(/(\d+(?:[.,]\d{2})?)/);
      const diaMatch = mensagem.match(/dia\s*(\d{1,2})/i);
      const descricao = mensagem.replace(/\d+(?:[.,]\d{2})?/g, "").replace(/dia\s*\d{1,2}/gi, "").trim();
      
      if (valorMatch && descricao) {
        const valor = parseFloat(valorMatch[1].replace(",", "."));
        const dia = diaMatch ? parseInt(diaMatch[1]) : 1;
        
        await supabase.from("gastos_recorrentes").insert({
          usuario_id: usuarioId,
          valor_parcela: valor,
          categoria: "moradia",
          tipo_recorrencia: "Mensal",
          dia_mes: dia,
          descricao: descricao || "Conta fixa",
          ativo: true,
          origem: "whatsapp"
        });
        
        await sendWhatsAppMessage(phoneNumber, 
          `✅ *${descricao || "Conta fixa"}* de R$ ${valor.toFixed(2)} registrada!\n\nTem mais alguma? Me fala ou responde *pronto*`, 
          messageSource
        );
        
        fluxoAtual.dados.contas_fixas = [...(fluxoAtual.dados.contas_fixas || []), { descricao, valor, dia }];
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: usuarioId,
          user_message: mensagem,
          ai_response: `Conta ${descricao} cadastrada`,
          tipo: "fluxo_ativo_centralizacao",
          resumo: JSON.stringify(fluxoAtual)
        });
        
        return true;
      }
      
      // Não conseguiu extrair
      await sendWhatsAppMessage(phoneNumber, 
        `Não consegui entender 🤔\n\nMe fala assim: "aluguel 1200 dia 10" ou "internet 100 dia 15"\n\nOu responde *pronto* se já terminou`, 
        messageSource
      );
      return true;
    }
  }
  
  return false;
}

// Busca fluxo de centralização ativo
async function getFluxoCentralizacao(phoneNumber: string): Promise<FluxoCentralizacao | null> {
  try {
    const { data } = await supabase
      .from("historico_conversas")
      .select("resumo, created_at")
      .eq("phone_number", phoneNumber)
      .eq("tipo", "fluxo_ativo_centralizacao")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!data || !data.resumo) return null;

    // Verifica se o fluxo não é muito antigo (máximo 30 minutos)
    const createdAt = new Date(data.created_at);
    const agora = new Date();
    const diffMinutos = (agora.getTime() - createdAt.getTime()) / 1000 / 60;
    
    if (diffMinutos > 30) return null;

    return JSON.parse(data.resumo) as FluxoCentralizacao;
  } catch {
    return null;
  }
}

// Verifica se usuário precisa de onboarding (primeira mensagem)
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

// ========== MODELO DE PLANOS: TRIAL → EXPIRED → PRO ==========
// Status possíveis: trial (7 dias), expired, pro

interface StatusPlano {
  status: "trial" | "expired" | "pro";
  permitido: boolean;
  diasRestantes?: number;
  mensagem?: string;
  bloqueiaEscrita: boolean;  // true = só consultas permitidas
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
    
    // Plano Pro ativo = acesso total
    if (plano === "pro") {
      return { status: "pro", permitido: true, bloqueiaEscrita: false };
    }
    
    // Verifica se está no período de trial
    const trialFim = usuario.trial_fim ? new Date(usuario.trial_fim) : null;
    
    if (trialFim) {
      const diasRestantes = Math.ceil((trialFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diasRestantes > 0) {
        // Trial ainda ativo
        return { 
          status: "trial", 
          permitido: true, 
          diasRestantes,
          bloqueiaEscrita: false 
        };
      } else {
        // Trial expirado - atualiza status se necessário
        if (plano !== "expired") {
          await supabase.from("usuarios").update({ plano: "expired" }).eq("id", usuarioId);
        }
        
        return { 
          status: "expired", 
          permitido: true,  // Permite consultas
          bloqueiaEscrita: true,  // Bloqueia registros
          mensagem: `Seu período de teste do Finax Pro terminou 😔\n\n` +
            `Você ainda pode consultar seus resumos, mas para registrar novos gastos, ` +
            `ative sua assinatura no site e envie o código de ativação aqui no WhatsApp.`
        };
      }
    }
    
    // Fallback: considera como trial ativo
    return { status: "trial", permitido: true, bloqueiaEscrita: false };
  } catch (error) {
    console.error("Erro ao verificar status do plano:", error);
    return { status: "trial", permitido: true, bloqueiaEscrita: false };
  }
}

// ========== VALIDAÇÃO DE CÓDIGO DE ATIVAÇÃO PRO ==========
async function validarCodigoAtivacao(codigo: string, usuarioId: string): Promise<{ valido: boolean; mensagem: string }> {
  try {
    console.log(`🔑 Tentando validar código: ${codigo} para usuário: ${usuarioId}`);
    
    const { data, error } = await supabase.rpc("validar_codigo_ativacao", {
      p_codigo: codigo,
      p_usuario_id: usuarioId
    });
    
    if (error) {
      console.error("Erro ao validar código:", error);
      return { 
        valido: false, 
        mensagem: "Ocorreu um erro ao validar o código. Tente novamente." 
      };
    }
    
    if (data?.valido) {
      return { 
        valido: true, 
        mensagem: "🎉 Perfeito! Seu Finax Pro foi ativado com sucesso.\n\n" +
          "Agora você tem acesso ilimitado a todas as funcionalidades!" 
      };
    } else {
      const erro = data?.erro;
      let msg = "Esse código não é válido ou já foi utilizado 😕\n\n" +
        "Por favor, verifique no site ou gere um novo código.";
      
      if (erro === "codigo_expirado") {
        msg = "Esse código expirou 😕\n\nPor favor, gere um novo código no site.";
      } else if (erro === "codigo_usado") {
        msg = "Esse código já foi utilizado 😕\n\nCada código só pode ser usado uma vez.";
      }
      
      return { valido: false, mensagem: msg };
    }
  } catch (error) {
    console.error("Erro na validação:", error);
    return { 
      valido: false, 
      mensagem: "Ocorreu um erro ao validar o código. Tente novamente." 
    };
  }
}

// Detecta se a mensagem parece um código de ativação
function pareceCodigoAtivacao(mensagem: string): boolean {
  const msg = mensagem.trim().toUpperCase();
  // Padrões comuns de código: FINAX-XXXX, PRO-XXXX, códigos alfanuméricos de 6-20 chars
  const padroes = [
    /^FINAX-[A-Z0-9]{4,10}$/,
    /^PRO-[A-Z0-9]{4,10}$/,
    /^[A-Z0-9]{6,12}$/,  // Código simples alfanumérico
    /^[A-Z]{2,4}-[A-Z0-9]{4,8}$/  // Padrão PREFIX-CODE
  ];
  
  return padroes.some(p => p.test(msg));
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

    let isNovoUsuario = false;
    
    if (!usuario) {
      // Extrai nome do contato (Meta envia em contacts[0].profile.name)
      let nomeContato: string | null = null;
      if (messageSource === "meta" && json.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
        nomeContato = json.entry[0].changes[0].value.contacts[0].profile.name;
      }
      
      const { data: newUser } = await supabase
        .from("usuarios")
        .insert({ 
          phone_number: phoneNumber,
          nome: nomeContato,
          plano: "pro"  // Novos usuários começam como PRO (fase de testes)
        })
        .select()
        .single();
      usuario = newUser;
      isNovoUsuario = true;
      console.log(`👤 Novo usuário criado: ${phoneNumber} - ${nomeContato || 'sem nome'}`);
    } else {
      // Verifica se é a primeira mensagem (sem histórico)
      isNovoUsuario = await verificarSeNovoUsuario(phoneNumber);
    }

    const usuarioId = usuario?.id;

    // ========== ONBOARDING PARA NOVOS USUÁRIOS ==========
    if (isNovoUsuario) {
      console.log(`🎉 Iniciando onboarding para ${phoneNumber}`);
      
      const nomeUsuario = usuario?.nome || "amigo(a)";
      
      await enviarOnboarding(phoneNumber, messageSource, {
        nome: nomeUsuario,
        urlPainel: "finax.app"
      });
      
      // Registra onboarding no histórico
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

    // ========== VERIFICAR STATUS DO PLANO (TRIAL/EXPIRED/PRO) ==========
    const statusPlano = await verificarStatusPlano(usuarioId);
    console.log(`📋 Status do plano: ${statusPlano.status}, bloqueiaEscrita: ${statusPlano.bloqueiaEscrita}`);
    
    // ========== VERIFICAR SE MENSAGEM É CÓDIGO DE ATIVAÇÃO ==========
    if (pareceCodigoAtivacao(messageText)) {
      console.log("🔑 Detectado possível código de ativação");
      const resultado = await validarCodigoAtivacao(messageText.trim(), usuarioId);
      await sendWhatsAppMessage(phoneNumber, resultado.mensagem, messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: phoneNumber,
        user_id: usuarioId,
        user_message: messageText,
        ai_response: resultado.mensagem,
        tipo: resultado.valido ? "ativacao_pro" : "codigo_invalido"
      });
      
      return new Response(
        JSON.stringify({ status: "ok", activation_result: resultado.valido }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // 2. Busca histórico recente para contexto
    const historicoRecente = await getHistoricoRecente(phoneNumber);

    let acaoRealizada = "";
    let contextoDados = "";
    let intent: ExtractedIntent = { intent: "outro" };

    // ========== VERIFICAR FLUXO DE CENTRALIZAÇÃO (ONBOARDING GUIADO) ==========
    const fluxoCentralizacao = await getFluxoCentralizacao(phoneNumber);
    
    if (fluxoCentralizacao && fluxoCentralizacao.etapa !== "concluido") {
      console.log("🏗️ Fluxo de centralização ativo:", fluxoCentralizacao.etapa);
      
      const processado = await processarFluxoCentralizacao(
        phoneNumber, 
        usuarioId, 
        messageSource, 
        messageText, 
        fluxoCentralizacao
      );
      
      if (processado) {
        return new Response(
          JSON.stringify({ status: "ok", centralizacao: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

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
        
        // ========== BLOQUEIO DE ESCRITA PARA EXPIRED ==========
        if (statusPlano.bloqueiaEscrita) {
          console.log("🚫 Usuário com trial expirado tentando registrar gastos");
          await sendWhatsAppMessage(phoneNumber, statusPlano.mensagem!, messageSource);
          return new Response(
            JSON.stringify({ status: "ok", message: "trial_expired" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
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
            // ========== BLOQUEIO DE ESCRITA PARA EXPIRED ==========
            if (statusPlano.bloqueiaEscrita) {
              console.log("🚫 Usuário com trial expirado tentando registrar gasto");
              await sendWhatsAppMessage(phoneNumber, statusPlano.mensagem!, messageSource);
              return new Response(
                JSON.stringify({ status: "ok", message: "trial_expired" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            
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
            // ========== BLOQUEIO DE ESCRITA PARA EXPIRED ==========
            if (statusPlano.bloqueiaEscrita) {
              console.log("🚫 Usuário com trial expirado tentando registrar entrada");
              await sendWhatsAppMessage(phoneNumber, statusPlano.mensagem!, messageSource);
              return new Response(
                JSON.stringify({ status: "ok", message: "trial_expired" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            
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
            // ========== BLOQUEIO DE ESCRITA PARA EXPIRED ==========
            if (statusPlano.bloqueiaEscrita) {
              console.log("🚫 Usuário com trial expirado tentando criar parcelamento");
              await sendWhatsAppMessage(phoneNumber, statusPlano.mensagem!, messageSource);
              return new Response(
                JSON.stringify({ status: "ok", message: "trial_expired" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            
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
            // ========== BLOQUEIO DE ESCRITA PARA EXPIRED ==========
            if (statusPlano.bloqueiaEscrita) {
              console.log("🚫 Usuário com trial expirado tentando criar recorrente");
              await sendWhatsAppMessage(phoneNumber, statusPlano.mensagem!, messageSource);
              return new Response(
                JSON.stringify({ status: "ok", message: "trial_expired" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            
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
            // Detecta tipo de relatório solicitado
            const tipoRelatorio = detectarTipoRelatorio(messageText);
            
            if (tipoRelatorio && tipoRelatorio.tipo === "semanal") {
              // Relatório semanal calculado no backend
              const tipoPeriodo = tipoRelatorio.periodo === "passado" ? "semana_passada" : "semana_atual";
              const relatorioSemanal = await getRelatorioSemanal(usuarioId, tipoPeriodo);
              
              if (relatorioSemanal && relatorioSemanal.totais) {
                const totais = relatorioSemanal.totais;
                const comparativo = relatorioSemanal.comparativo;
                const categorias = relatorioSemanal.categorias || [];
                const periodo = relatorioSemanal.periodo;
                
                let categoriasTexto = "";
                if (categorias.length > 0) {
                  categoriasTexto = "\n\n📊 Categorias:\n" + 
                    categorias.slice(0, 5).map((c: any) => 
                      `• ${c.categoria}: R$ ${Number(c.total).toFixed(2)}`
                    ).join("\n");
                }
                
                const variacaoTexto = comparativo.variacao_gastos_percentual > 0 
                  ? `📈 Gastos ${comparativo.variacao_gastos_percentual.toFixed(1)}% MAIORES que semana anterior`
                  : comparativo.variacao_gastos_percentual < 0
                    ? `📉 Gastos ${Math.abs(comparativo.variacao_gastos_percentual).toFixed(1)}% MENORES que semana anterior`
                    : `➡️ Gastos estáveis em relação à semana anterior`;
                
                const tituloSemana = tipoPeriodo === "semana_atual" ? "Semana Atual" : "Semana Passada";
                
                contextoDados = `📅 *Relatório ${tituloSemana}*\n` +
                  `📆 Período: ${periodo.inicio} a ${periodo.fim}\n\n` +
                  `💵 Entradas: *R$ ${Number(totais.entradas).toFixed(2)}*\n` +
                  `💸 Saídas: *R$ ${Number(totais.saidas).toFixed(2)}*\n` +
                  `📈 Saldo: *R$ ${Number(totais.saldo).toFixed(2)}*\n\n` +
                  `${variacaoTexto}` +
                  categoriasTexto +
                  `\n\n⚠️ VALORES PRÉ-CALCULADOS - NÃO RECALCULE`;
              } else {
                const resumo = await getResumoMes(usuarioId);
                contextoDados = `Sem dados suficientes para relatório semanal.\n\n` +
                  `Resumo do mês: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, Saídas R$ ${resumo.totalSaidas.toFixed(2)}`;
              }
            } else if (tipoRelatorio && tipoRelatorio.tipo === "mensal") {
              // Relatório mensal calculado no backend
              const relatorioMensal = await getRelatorioMensal(usuarioId);
              
              if (relatorioMensal && relatorioMensal.totais) {
                const periodo = relatorioMensal.periodo;
                const totais = relatorioMensal.totais;
                const categorias = relatorioMensal.categorias || [];
                const maioresGastos = relatorioMensal.maiores_gastos || [];
                
                let categoriasTexto = "";
                if (categorias.length > 0) {
                  categoriasTexto = "\n\n📊 Por categoria:\n" + 
                    categorias.slice(0, 5).map((c: any) => 
                      `• ${c.categoria}: R$ ${Number(c.total).toFixed(2)} (${c.percentual}%)`
                    ).join("\n");
                }
                
                let maioresTexto = "";
                if (maioresGastos.length > 0) {
                  maioresTexto = "\n\n💰 Maiores gastos:\n" + 
                    maioresGastos.slice(0, 3).map((g: any) => 
                      `• ${g.descricao}: R$ ${Number(g.valor).toFixed(2)}`
                    ).join("\n");
                }
                
                contextoDados = `📅 *Relatório de ${periodo.nome_mes}/${periodo.ano}*\n\n` +
                  `💵 Entradas: *R$ ${Number(totais.entradas).toFixed(2)}*\n` +
                  `💸 Saídas: *R$ ${Number(totais.saidas).toFixed(2)}*\n` +
                  `📈 Saldo: *R$ ${Number(totais.saldo).toFixed(2)}*\n` +
                  `📊 Média diária: R$ ${Number(totais.media_diaria).toFixed(2)}\n` +
                  `🔁 Despesas fixas: R$ ${Number(totais.despesas_fixas).toFixed(2)}` +
                  categoriasTexto +
                  maioresTexto +
                  `\n\n⚠️ VALORES PRÉ-CALCULADOS - NÃO RECALCULE`;
              } else {
                const resumo = await getResumoMes(usuarioId);
                contextoDados = `Sem dados suficientes para relatório mensal detalhado.\n\n` +
                  `Resumo atual: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, Saídas R$ ${resumo.totalSaidas.toFixed(2)}`;
              }
            } else {
              // Resumo padrão do mês atual
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
                `💵 Entradas: *R$ ${resumo.totalEntradas.toFixed(2)}*\n` +
                `💸 Saídas: *R$ ${resumo.totalSaidas.toFixed(2)}*\n` +
                `📈 Saldo: *R$ ${resumo.saldo.toFixed(2)}*` +
                categoriasTexto +
                `\n\n⚠️ VALORES PRÉ-CALCULADOS - NÃO RECALCULE`;
            }
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
                  `💰 Total: *R$ ${total.toFixed(2)}*\n` +
                  `📝 ${transacoes.length} transação(ões)\n\n` +
                  `Detalhes:\n${listaTransacoes}\n\n` +
                  `⚠️ TOTAL PRÉ-CALCULADO - NÃO RECALCULE`;
              } else {
                contextoDados = `Você não teve gastos em ${intent.categoria_consulta} este mês.`;
              }
            }
            break;
          }

          case "consultar_detalhes": {
            // PRIMEIRO: Verifica se pediu relatório semanal/mensal
            const tipoRelatorioDetalhes = detectarTipoRelatorio(messageText);
            
            if (tipoRelatorioDetalhes && tipoRelatorioDetalhes.tipo === "semanal") {
              // Relatório semanal solicitado
              const tipoPeriodo = tipoRelatorioDetalhes.periodo === "passado" ? "semana_passada" : "semana_atual";
              console.log(`📊 Detectado pedido de relatório semanal (${tipoPeriodo}) em consultar_detalhes`);
              
              const relatorioSemanal = await getRelatorioSemanal(usuarioId, tipoPeriodo);
              
              if (relatorioSemanal && relatorioSemanal.totais) {
                const totais = relatorioSemanal.totais;
                const comparativo = relatorioSemanal.comparativo;
                const categorias = relatorioSemanal.categorias || [];
                const periodo = relatorioSemanal.periodo;
                
                let categoriasTexto = "";
                if (categorias.length > 0) {
                  categoriasTexto = "\n\n📊 Categorias:\n" + 
                    categorias.slice(0, 5).map((c: any) => 
                      `• ${c.categoria}: R$ ${Number(c.total).toFixed(2)}`
                    ).join("\n");
                }
                
                const variacaoTexto = comparativo.variacao_gastos_percentual > 0 
                  ? `📈 Gastos ${comparativo.variacao_gastos_percentual.toFixed(1)}% MAIORES que semana anterior`
                  : comparativo.variacao_gastos_percentual < 0
                    ? `📉 Gastos ${Math.abs(comparativo.variacao_gastos_percentual).toFixed(1)}% MENORES que semana anterior`
                    : `➡️ Gastos estáveis em relação à semana anterior`;
                
                const tituloSemana = tipoPeriodo === "semana_atual" ? "Semana Atual" : "Semana Passada";
                
                contextoDados = `📅 *Relatório ${tituloSemana}*\n` +
                  `📆 Período: ${periodo.inicio} a ${periodo.fim}\n\n` +
                  `💵 Entradas: *R$ ${Number(totais.entradas).toFixed(2)}*\n` +
                  `💸 Saídas: *R$ ${Number(totais.saidas).toFixed(2)}*\n` +
                  `📈 Saldo: *R$ ${Number(totais.saldo).toFixed(2)}*\n\n` +
                  `${variacaoTexto}` +
                  categoriasTexto +
                  `\n\n⚠️ VALORES PRÉ-CALCULADOS - NÃO RECALCULE`;
              } else {
                const resumo = await getResumoMes(usuarioId);
                contextoDados = `Sem dados suficientes para relatório semanal.\n\n` +
                  `Resumo do mês: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, Saídas R$ ${resumo.totalSaidas.toFixed(2)}`;
              }
            } else if (tipoRelatorioDetalhes && tipoRelatorioDetalhes.tipo === "mensal") {
              // Relatório mensal solicitado
              console.log(`📊 Detectado pedido de relatório mensal em consultar_detalhes`);
              
              const relatorioMensal = await getRelatorioMensal(usuarioId);
              
              if (relatorioMensal && relatorioMensal.totais) {
                const periodo = relatorioMensal.periodo;
                const totais = relatorioMensal.totais;
                const categorias = relatorioMensal.categorias || [];
                const maioresGastos = relatorioMensal.maiores_gastos || [];
                
                let categoriasTexto = "";
                if (categorias.length > 0) {
                  categoriasTexto = "\n\n📊 Por categoria:\n" + 
                    categorias.slice(0, 5).map((c: any) => 
                      `• ${c.categoria}: R$ ${Number(c.total).toFixed(2)} (${c.percentual}%)`
                    ).join("\n");
                }
                
                let maioresTexto = "";
                if (maioresGastos.length > 0) {
                  maioresTexto = "\n\n💰 Maiores gastos:\n" + 
                    maioresGastos.slice(0, 3).map((g: any) => 
                      `• ${g.descricao}: R$ ${Number(g.valor).toFixed(2)}`
                    ).join("\n");
                }
                
                contextoDados = `📅 *Relatório de ${periodo.nome_mes}/${periodo.ano}*\n\n` +
                  `💵 Entradas: *R$ ${Number(totais.entradas).toFixed(2)}*\n` +
                  `💸 Saídas: *R$ ${Number(totais.saidas).toFixed(2)}*\n` +
                  `📈 Saldo: *R$ ${Number(totais.saldo).toFixed(2)}*\n` +
                  `📊 Média diária: R$ ${Number(totais.media_diaria).toFixed(2)}\n` +
                  `🔁 Despesas fixas: R$ ${Number(totais.despesas_fixas).toFixed(2)}` +
                  categoriasTexto +
                  maioresTexto +
                  `\n\n⚠️ VALORES PRÉ-CALCULADOS - NÃO RECALCULE`;
              } else {
                const resumo = await getResumoMes(usuarioId);
                contextoDados = `Sem dados suficientes para relatório mensal.\n\n` +
                  `Resumo atual: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, Saídas R$ ${resumo.totalSaidas.toFixed(2)}`;
              }
            } else {
              // Detalhes das transações do mês (comportamento original)
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
                  `═══════════════════════════════\n` +
                  `📊 *TOTAIS PRÉ-CALCULADOS:*\n` +
                  `💵 Entradas: *R$ ${resumo.totalEntradas.toFixed(2)}*\n` +
                  `💸 Saídas: *R$ ${resumo.totalSaidas.toFixed(2)}*\n` +
                  `📈 Saldo: *R$ ${resumo.saldo.toFixed(2)}*\n` +
                  `═══════════════════════════════\n` +
                  `Total: ${resumo.transacoes.length} transações\n\n` +
                  `⚠️ NÃO RECALCULE ESTES VALORES`;
              } else {
                contextoDados = "Você ainda não tem transações registradas este mês.";
              }
            }
            break;
          }

          case "iniciar_organizacao": {
            // Usuário quer organizar cartões/salário/contas
            console.log("🏗️ Iniciando fluxo de centralização");
            await iniciarFluxoCentralizacao(phoneNumber, usuarioId, messageSource);
            
            return new Response(
              JSON.stringify({ status: "ok", centralizacao_iniciada: true }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          case "cancelar_transacao":
          case "apagar_transacao": {
            // Busca últimas transações do usuário para mostrar opções
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
            
            // Mostra opções para confirmar qual apagar
            const listaOpcoes = ultimasTransacoes.map((t, i) => {
              const data = new Date(t.data).toLocaleDateString("pt-BR");
              const desc = t.descricao || t.categoria;
              return `${i + 1}. R$ ${Number(t.valor).toFixed(2)} - ${desc} (${data})`;
            }).join("\n");
            
            // Se o intent.transacao_alvo estiver definido, tenta encontrar a transação
            if (intent.transacao_alvo) {
              const alvo = intent.transacao_alvo.toLowerCase();
              const transacaoEncontrada = ultimasTransacoes.find(t => 
                (t.descricao?.toLowerCase().includes(alvo)) ||
                (t.categoria?.toLowerCase().includes(alvo)) ||
                (t.valor && alvo.includes(t.valor.toString()))
              );
              
              if (transacaoEncontrada) {
                // Deleta a transação encontrada
                const { error } = await supabase
                  .from("transacoes")
                  .delete()
                  .eq("id", transacaoEncontrada.id);
                
                if (!error) {
                  acaoRealizada = `✅ Transação apagada!\n\n` +
                    `❌ R$ ${Number(transacaoEncontrada.valor).toFixed(2)} - ${transacaoEncontrada.descricao || transacaoEncontrada.categoria}\n\n` +
                    `Se errei, me avisa que a gente resolve 👍`;
                } else {
                  acaoRealizada = "❌ Erro ao apagar a transação. Tente novamente.";
                }
                break;
              }
            }
            
            // Se não encontrou específica, mostra lista
            contextoDados = `🗑️ *Qual transação você quer apagar?*\n\n${listaOpcoes}\n\n` +
              `Responde com o número ou me descreve melhor qual é.`;
            break;
          }

          case "corrigir_transacao": {
            // Busca última transação para oferecer correção
            const { data: ultimaTransacao } = await supabase
              .from("transacoes")
              .select("id, valor, categoria, descricao, data")
              .eq("usuario_id", usuarioId)
              .order("created_at", { ascending: false })
              .limit(1)
              .single();
            
            if (!ultimaTransacao) {
              acaoRealizada = "Você não tem transações recentes para corrigir.";
              break;
            }
            
            const data = new Date(ultimaTransacao.data).toLocaleDateString("pt-BR");
            contextoDados = `📝 *Última transação registrada:*\n\n` +
              `💰 R$ ${Number(ultimaTransacao.valor).toFixed(2)}\n` +
              `📂 Categoria: ${ultimaTransacao.categoria}\n` +
              `📝 Descrição: ${ultimaTransacao.descricao || "sem descrição"}\n` +
              `📅 Data: ${data}\n\n` +
              `O que você quer corrigir? Me fala o valor certo, a categoria certa, ou "apaga" pra deletar.`;
            break;
          }

          case "saudacao":
          case "ajuda":
          case "outro":
          default: {
            // Para saudações e ajuda, busca análise consultiva se disponível
            const analise = await getAnaliseConsultiva(usuarioId);
            const resumo = await getResumoMes(usuarioId);
            
            let alertaConsultivo = "";
            if (analise && analise.gerar_alerta && analise.alertas?.length > 0) {
              const alerta = analise.alertas[0];
              alertaConsultivo = `\n\n💡 Insight: ${alerta.mensagem}`;
              
              // Salva que enviou alerta consultivo
              await supabase.from("historico_conversas").insert({
                phone_number: phoneNumber,
                user_id: usuarioId,
                user_message: "[ANÁLISE CONSULTIVA]",
                ai_response: alerta.mensagem,
                tipo: "alerta_consultivo"
              });
            }
            
            contextoDados = `Resumo atual: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, ` +
              `Saídas R$ ${resumo.totalSaidas.toFixed(2)}, Saldo R$ ${resumo.saldo.toFixed(2)}` +
              alertaConsultivo;
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
