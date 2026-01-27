import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyDeterministic } from "./decision/classifier.ts";
import { detectMultipleExpenses, formatExpensesList, calculateTotal } from "./utils/multiple-expenses.ts";
import { parseRelativeDate, getBrasiliaDate } from "./utils/date-helpers.ts";
import { queueMessage, markMessageProcessed, countPendingMessages } from "./utils/message-queue.ts";

// ============================================================================
// 🏭 FINAX WORKER v6.0 - IA-FIRST ARCHITECTURE
// ============================================================================
//
// NOVA ARQUITETURA (v6.0):
// 1. FAST-TRACK: Extrai estrutura (números, pagamento) SEM classificar intent
// 2. IA: Classifica 100% das intenções semânticas (gasto, entrada, recorrente)
// 3. EXECUTORS: Módulos que APENAS executam ações baseado na IA
//
// MUDANÇAS DA v5.x → v6.0:
// - REMOVIDO: Keywords/heurísticas para classificação (quebrava muito)
// - REMOVIDO: classifySemanticHeuristic e SEMANTIC_PATTERNS
// - ADICIONADO: Fast-track estrutural que só extrai slots
// - MELHORADO: IA agora é fonte única de verdade para intent
//
// REGRAS DE OURO:
// - IA interpreta linguagem natural (não keywords)
// - Fast-track apenas acelera extração, não classifica
// - Código apenas EXECUTA o que a IA decidiu
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
type ActionType = "expense" | "income" | "card_event" | "add_card" | "bill" | "pay_bill" | "cancel" | "query" | "query_alerts" | "control" | "recurring" | "set_context" | "chat" | "edit" | "goal" | "installment" | "purchase" | "unknown";

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

// ============================================================================
// 📜 CONTRATOS DE SLOT (FONTE ÚNICA DE VERDADE)
// ============================================================================
// Cada intenção tem slots OBRIGATÓRIOS e opcionais.
// Execução direta SÓ acontece quando TODOS os obrigatórios estão preenchidos.
// Perguntas SÓ são feitas para slots obrigatórios faltantes.
// ============================================================================

const SLOT_REQUIREMENTS: Record<string, { required: string[]; optional: string[] }> = {
  expense: { required: ["amount", "payment_method"], optional: ["description", "category", "card", "card_id"] },
  income: { required: ["amount"], optional: ["description", "source"] },
  card_event: { required: ["card", "value"], optional: ["field"] },
  add_card: { required: ["card_name", "limit"], optional: ["due_day", "closing_day"] },
  bill: { required: ["bill_name", "due_day"], optional: ["estimated_value"] },
  pay_bill: { required: ["bill_name", "amount"], optional: [] },
  cancel: { required: [], optional: ["transaction_id"] },
  query: { required: [], optional: [] },
  control: { required: [], optional: [] },
  recurring: { required: ["amount", "description", "payment_method"], optional: ["day_of_month", "category", "periodicity", "card", "card_id"] },
  installment: { required: ["amount", "installments"], optional: ["description", "card", "card_id", "category"] },
  set_context: { required: ["label", "start_date", "end_date"], optional: ["description"] },
  chat: { required: [], optional: [] },
  edit: { required: [], optional: ["transaction_id", "field", "new_value"] },
  goal: { required: ["amount", "description"], optional: ["deadline", "category"] },
  purchase: { required: ["amount"], optional: ["description", "category"] },
  unknown: { required: [], optional: [] },
};

// ============================================================================
// ✅ hasAllRequiredSlots - FUNÇÃO CANÔNICA
// ============================================================================
// Retorna true SOMENTE se TODOS os slots obrigatórios estão preenchidos.
// Não usa heurística. Não infere dados ausentes.
// ============================================================================

function hasAllRequiredSlots(actionType: ActionType, slots: Record<string, any>): boolean {
  const requirements = SLOT_REQUIREMENTS[actionType];
  if (!requirements) return true; // Tipo desconhecido = sem requisitos
  
  for (const required of requirements.required) {
    const value = slots[required];
    if (value === null || value === undefined || value === "") {
      return false;
    }
  }
  return true;
}

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
  card_name: { text: "Qual o nome do cartão? (ex: Nubank, Inter, Bradesco...)" },
  limit: { text: "Qual o limite total? 💰" },
  due_day: { text: "Qual o dia de vencimento? (1-31)" },
  closing_day: { text: "Qual o dia de fechamento?" },
  bill_name: { text: "Qual o nome da conta? (ex: Energia, Internet, Água...)" },
  estimated_value: { text: "Qual o valor estimado? (opcional)" },
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

// v3.2: Detecta query_scope a partir do texto normalizado
function detectQueryScope(normalized: string): string {
  if (normalized.includes("cartao") || normalized.includes("cartoes") || normalized.includes("limite")) return "cards";
  if (normalized.includes("pendente") || normalized.includes("pendentes")) return "pending";
  if (normalized.includes("categoria") || normalized.includes("categorias")) return "category";
  if (normalized.includes("recebi") || normalized.includes("entrada") || normalized.includes("entrou")) return "income";
  if (normalized.includes("recorrente") || normalized.includes("assinatura")) return "recurring";
  if (normalized.includes("gastei") || normalized.includes("gasto")) return "expenses";
  return "summary";
}

// v3.2: Detecta time_range a partir do texto normalizado
function detectTimeRange(normalized: string): string {
  if (normalized.includes("hoje")) return "today";
  if (normalized.includes("semana") || normalized.includes("semanal")) return "week";
  if (normalized.includes("mes") || normalized.includes("mensal")) return "month";
  return "month";
}

function isNumericOnly(text: string): boolean {
  // REGEX ESTRITA: A string ORIGINAL deve conter APENAS números/vírgula/ponto
  // "50" → true | "50,00" → true | "50.00" → true
  // "Gastei 50" → false | "50 reais" → false
  const trimmed = text.trim();
  if (!/^[\d\.,]+$/.test(trimmed)) return false;
  
  const normalized = trimmed.replace(",", ".");
  const value = parseFloat(normalized);
  return !isNaN(value) && value > 0;
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
// 📷 ANÁLISE DE IMAGEM COM GEMINI VISION
// ============================================================================

interface OCRResult {
  valor?: number;
  descricao?: string;
  forma_pagamento?: string;
  data?: string;
  confidence: number;
  raw?: string;
}

// Analisa imagem com Gemini Vision para extrair dados financeiros
async function analyzeImageWithGemini(base64Image: string): Promise<OCRResult> {
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
            role: "user",
            content: [
              {
                type: "text",
                text: `Analise esta imagem de um cupom fiscal, recibo ou comprovante de pagamento.

EXTRAIA APENAS as seguintes informações (se visíveis):
1. VALOR TOTAL (número em reais)
2. DESCRIÇÃO (o que foi comprado - resumo curto)
3. FORMA DE PAGAMENTO (pix, débito, crédito, dinheiro - se identificável)
4. DATA (se visível)

REGRAS:
- Retorne APENAS JSON válido, sem texto adicional
- Se não encontrar um campo, não inclua no JSON
- Para valor, retorne apenas o número (ex: 45.90)
- Para descrição, seja breve (máximo 30 caracteres)
- Se não conseguir identificar NADA útil, retorne {"confidence": 0}

Formato de resposta:
{
  "valor": 45.90,
  "descricao": "Supermercado",
  "forma_pagamento": "pix",
  "data": "15/01/2024",
  "confidence": 0.85
}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
      }),
    });
    
    if (!response.ok) {
      console.error(`📷 [GEMINI] Erro na API:`, response.status);
      return { confidence: 0 };
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"confidence": 0}';
    
    // Limpar resposta (remover markdown se houver)
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
      const parsed = JSON.parse(cleanJson);
      
      // Validar e normalizar resultado
      const result: OCRResult = {
        confidence: parsed.confidence || 0,
        raw: cleanJson
      };
      
      if (parsed.valor && typeof parsed.valor === "number" && parsed.valor > 0) {
        result.valor = parsed.valor;
      }
      
      if (parsed.descricao && typeof parsed.descricao === "string" && parsed.descricao.length > 0) {
        result.descricao = parsed.descricao.slice(0, 50); // Limitar tamanho
      }
      
      if (parsed.forma_pagamento) {
        const paymentMap: Record<string, string> = {
          "pix": "pix",
          "débito": "debito", 
          "debito": "debito",
          "crédito": "credito",
          "credito": "credito",
          "cartão": "credito",
          "cartao": "credito",
          "dinheiro": "dinheiro",
          "espécie": "dinheiro"
        };
        const normalized = String(parsed.forma_pagamento).toLowerCase();
        result.forma_pagamento = paymentMap[normalized] || undefined;
      }
      
      if (parsed.data) {
        result.data = String(parsed.data);
      }
      
      console.log(`📷 [GEMINI] Análise concluída: valor=${result.valor}, desc=${result.descricao}, conf=${result.confidence}`);
      return result;
      
    } catch (parseError) {
      console.error(`📷 [GEMINI] Erro ao parsear JSON:`, cleanJson.slice(0, 200));
      return { confidence: 0, raw: cleanJson };
    }
    
  } catch (error) {
    console.error(`📷 [GEMINI] Erro:`, error);
    return { confidence: 0 };
  }
}

// ============================================================================
// 💰 VERIFICAÇÃO DE ORÇAMENTOS
// ============================================================================

// Verifica orçamentos após registrar um gasto
async function checkBudgetAfterExpense(userId: string, categoria: string, valorGasto: number): Promise<string | null> {
  try {
    // Buscar orçamentos ativos para esta categoria ou global
    const { data: orcamentos } = await supabase
      .from("orcamentos")
      .select("*")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .or(`tipo.eq.global,and(tipo.eq.categoria,categoria.eq.${categoria})`);
    
    if (!orcamentos || orcamentos.length === 0) return null;
    
    const alerts: string[] = [];
    
    for (const orcamento of orcamentos) {
      const percentual = ((orcamento.gasto_atual + valorGasto) / orcamento.limite) * 100;
      
      // Verificar cada nível de alerta
      if (percentual >= 100 && !orcamento.alerta_100_enviado) {
        // Alerta crítico - estourou o limite
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`🚨 *Atenção!* Você atingiu 100% do ${tipo}!\n\nLimite: R$ ${orcamento.limite.toFixed(2)}\nGasto: R$ ${(orcamento.gasto_atual + valorGasto).toFixed(2)}`);
        
        await supabase.from("orcamentos")
          .update({ alerta_100_enviado: true })
          .eq("id", orcamento.id);
          
      } else if (percentual >= 80 && percentual < 100 && !orcamento.alerta_80_enviado) {
        // Alerta de 80%
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`⚠️ Você usou 80% do ${tipo}.\n\nRestam R$ ${(orcamento.limite - orcamento.gasto_atual - valorGasto).toFixed(2)}`);
        
        await supabase.from("orcamentos")
          .update({ alerta_80_enviado: true })
          .eq("id", orcamento.id);
          
      } else if (percentual >= 50 && percentual < 80 && !orcamento.alerta_50_enviado) {
        // Alerta de 50%
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`💡 Você atingiu 50% do ${tipo}.`);
        
        await supabase.from("orcamentos")
          .update({ alerta_50_enviado: true })
          .eq("id", orcamento.id);
      }
    }
    
    return alerts.length > 0 ? alerts.join("\n\n") : null;
    
  } catch (error) {
    console.error("❌ [BUDGET] Erro ao verificar orçamentos:", error);
    return null;
  }
}

// ============================================================================
// 📊 VERIFICAÇÃO E ENVIO DE RELATÓRIOS PENDENTES
// ============================================================================

// Verifica se há relatório pendente e envia após interação do usuário
async function checkAndSendPendingReport(userId: string, phoneNumber: string, source: MessageSource): Promise<void> {
  try {
    // Buscar usuário com flags de relatório pendente
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("relatorio_semanal_pendente, relatorio_mensal_pendente, nome")
      .eq("id", userId)
      .single();
    
    if (!usuario) return;
    
    // Verificar relatório semanal pendente
    if (usuario.relatorio_semanal_pendente) {
      console.log(`📊 [REPORT] Relatório semanal pendente para ${userId} - enviando...`);
      
      // Buscar dados do relatório
      const { data: relatorio } = await supabase.rpc("fn_relatorio_semanal", { 
        p_usuario_id: userId 
      });
      
      if (relatorio && relatorio.totais && (relatorio.totais.entradas > 0 || relatorio.totais.saidas > 0)) {
        // Gerar texto do relatório com IA
        const textoRelatorio = await gerarTextoRelatorioInline(relatorio, usuario.nome);
        
        // Enviar
        await sendMessage(phoneNumber, textoRelatorio, source);
        
        // Marcar como enviado
        await supabase.from("usuarios")
          .update({ 
            relatorio_semanal_pendente: false,
            ultimo_relatorio_semanal: new Date().toISOString()
          })
          .eq("id", userId);
        
        // Salvar no histórico
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: userId,
          user_message: "[RELATÓRIO PENDENTE - ENVIADO]",
          ai_response: textoRelatorio,
          tipo: "relatorio_semanal"
        });
        
        console.log(`✅ [REPORT] Relatório semanal enviado para ${userId}`);
      } else {
        // Limpar flag se não há dados
        await supabase.from("usuarios")
          .update({ relatorio_semanal_pendente: false })
          .eq("id", userId);
      }
    }
  } catch (error) {
    console.error("❌ [REPORT] Erro ao verificar relatórios pendentes:", error);
  }
}

// Gera texto do relatório inline (versão simplificada)
async function gerarTextoRelatorioInline(dados: any, nomeUsuario: string | null): Promise<string> {
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
            content: `Você é o Finax, um assistente financeiro via WhatsApp.
Escreva um RELATÓRIO SEMANAL curto e amigável.

REGRAS:
- Use APENAS os números fornecidos
- Máximo 10 linhas
- 2-3 emojis
- Uma dica prática curta no final
- Português brasileiro informal`
          },
          {
            role: "user",
            content: `Relatório para ${nomeUsuario || "Usuário"}:\n${JSON.stringify(dados, null, 2)}`
          }
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "📊 Não foi possível gerar o relatório.";
  } catch (error) {
    console.error("Erro ao gerar relatório inline:", error);
    return "📊 Erro ao gerar relatório.";
  }
}

// ============================================================================
// 🧠 DECISION ENGINE v3.0 - IA-FIRST ARCHITECTURE
// ============================================================================
// NOVA FILOSOFIA:
// 1. Fast-Track: Extrai estrutura (números, pagamento) SEM classificar intent
// 2. IA: Classifica 100% das intenções (gasto, entrada, recorrente, consulta)
// 3. Código: Apenas EXECUTA ações baseado na classificação da IA
//
// REGRAS:
// - Não usar keywords para decidir intent
// - IA interpreta linguagem natural
// - Fast-track apenas acelera extração de slots
// ============================================================================

interface SemanticResult {
  actionType: ActionType;
  confidence: number;
  slots: ExtractedSlots;
  reason: string;
  canExecuteDirectly: boolean;
}

// ============================================================================
// 🧠 FINAX PROMPT v3.2 - INTERPRETADOR SEMÂNTICO
// ============================================================================
const PROMPT_FINAX_UNIVERSAL = `# FINAX - INTERPRETADOR SEMÂNTICO v3.2

## 🎯 SEU PAPEL
Você é um **intérprete**, não um tomador de decisões.
- Você INTERPRETA a mensagem e identifica a intenção MAIS PROVÁVEL
- Você EXTRAI dados estruturados (slots) do texto
- Você ADMITE DÚVIDA quando não tem certeza (confidence baixo)
- Você NÃO valida slots nem decide fluxo - isso é do código

## 📚 TIPOS DE INTENÇÃO

### expense - Gasto pontual
Dinheiro SAINDO em compra única.
Indicadores: "gastei", "paguei", "comprei", "custou"
Slots: amount, payment_method, description, category, card
Exemplos: "Mercado 180", "Uber 30 pix", "Dentista 360 débito"

### income - Entrada de dinheiro
Dinheiro CHEGANDO.
Indicadores: "recebi", "caiu", "entrou", "ganhei"
Slots: amount, source, description
Exemplos: "Recebi 1500", "Caiu 200 de freela"

### installment - Compra parcelada ⚠️ PRIORIDADE sobre expense se tiver "Nx"
Compra dividida em parcelas no crédito.
Indicadores: "em Nx", "x vezes", "parcelei", "parcelado"
Slots: amount (TOTAL), installments, description, card
Exemplos: "Celular 1200 em 12x", "Roupa 300 em 5x no Nubank"
REGRA: Valor informado = TOTAL, não calcular parcela!

### recurring - Gasto fixo mensal ⚠️ PRIORIDADE sobre expense se tiver periodicidade
Assinatura ou conta de valor FIXO que repete.
Indicadores: "todo mês", "mensal", "assinatura"
Slots: amount, description, periodicity, day_of_month
Exemplos: "Netflix 40 todo mês", "Academia 99 mensal"

### add_card - Cadastrar novo cartão ⚠️ PRIORIDADE sobre card_event
Registrar cartão que NÃO existe no sistema.
Indicadores: "registrar", "adicionar", "cadastrar", "novo cartão", "meu cartão é"
Slots: card_name, limit, due_day, closing_day
Exemplos: "Registrar cartão Bradesco limite 2000 vence dia 16"

### card_event - Atualizar cartão existente
Mudar limite de cartão JÁ cadastrado.
Indicadores: "limite do [banco]" (SEM "registrar/adicionar")
Slots: card, value
Exemplos: "Limite do Nubank agora é 8000"

### bill - Conta com vencimento ⚠️ PRIORIDADE sobre recurring para utilidades
Criar lembrete de conta VARIÁVEL (água, luz, internet).
Indicadores: "conta de", "vence dia", "fatura"
Slots: bill_name, due_day
Exemplos: "Conta de água vence dia 10"
Diferença: bill = valor varia | recurring = valor fixo

### pay_bill - Pagar conta existente
Registrar pagamento JÁ feito.
Indicadores: "paguei a conta de", "foi", "deu"
Slots: bill_name, amount
Exemplos: "Paguei energia, deu 184"

### goal - Meta de economia ⚠️ PRIORIDADE sobre set_context se tiver valor
Guardar dinheiro para objetivo.
Indicadores: "meta", "juntar", "guardar", "economizar"
Slots: amount, description, deadline
Exemplos: "Criar meta de 5000 para viagem"

### purchase - Consulta de compra ⚠️ PRIORIDADE sobre chat se for pergunta com valor
Perguntar se DEVE comprar algo específico.
Indicadores: "vale a pena", "posso comprar", "devo gastar", "consigo comprar"
Slots: amount, description
Exemplos: "Vale a pena comprar celular de 2000?"

### query - Consultar informações
Ver dados, não modificar.
Indicadores: "quanto", "resumo", "saldo", "total", "meus", "quais", "cartões", "pendentes"
Slots: query_scope, time_range
- query_scope: summary | cards | expenses | income | pending | recurring | category
- time_range: today | week | month | custom
Exemplos: 
  - "Quanto gastei esse mês?" → query_scope: expenses, time_range: month
  - "Meus cartões" → query_scope: cards
  - "Quais cartões tenho?" → query_scope: cards
  - "Gastos pendentes" → query_scope: pending
  - "Gastos da semana" → query_scope: expenses, time_range: week
  - "Quanto gastei hoje?" → query_scope: expenses, time_range: today
  - "Resumo" → query_scope: summary

### query_alerts - Ver alertas
Indicadores: "alertas", "avisos"
Exemplos: "Meus alertas"

### cancel - Cancelar algo
Indicadores: "cancela", "desfaz", "apaga", "remove", "para de", "pausa"
Slots: cancel_target, target_name
- cancel_target: transaction | recurring | goal | context
- target_name: nome do item (Netflix, viagem, etc.)
Exemplos:
  - "Cancela minha Netflix" → cancel_target: recurring, target_name: Netflix
  - "Pausa meta viagem" → cancel_target: goal, target_name: viagem
  - "Cancela esse gasto" → cancel_target: transaction
  - "Terminei a viagem" → cancel_target: context, target_name: viagem

### chat - Conversa/conselho
Pergunta reflexiva sobre finanças.
Exemplos: "Tô gastando muito?", "Como economizar?", "Analise meus gastos"
NUNCA retorne unknown para perguntas - use chat!

### set_context - Período especial
Viagem ou evento COM ciclo de vida.
Indicadores: 
  - Iniciar: "vou viajar", "começando", "início" + datas
  - Encerrar: "terminei", "voltei", "acabou", "fim da"
Slots: label, start_date, end_date, action (start|end)
Exemplos: 
  - "Vou viajar de 10/01 até 15/01" → action: start
  - "Terminei a viagem" → action: end, label: viagem
  - "Voltei da viagem" → action: end, label: viagem

### control - Saudações
Exemplos: "Oi", "Bom dia", "Ajuda"

### edit - Correção rápida
Indicadores: "era", "errei", "corrige"
Exemplos: "Era pix, não débito"

### unknown - Último recurso
Só quando confidence < 0.5.
Exemplo: "50" (número isolado sem contexto)

## 🎯 NÍVEIS DE CONFIANÇA

| Nível | Quando usar |
|-------|-------------|
| 0.9-1.0 | Intenção inequívoca, indicadores claros |
| 0.7-0.89 | Padrão reconhecível, contexto implícito |
| 0.5-0.69 | Ambiguidade presente mas há favorito |
| < 0.5 | Retornar unknown |

## ⚖️ PRIORIDADES (quando há conflito)

1. installment > expense (se tem "Nx" ou "vezes")
2. recurring > expense (se tem periodicidade)
3. bill > recurring (se é conta de utilidades)
4. add_card > card_event (se tem "registrar/adicionar")
5. goal > set_context (se tem valor objetivo)
6. purchase > chat (se é pergunta com valor específico)

## 📦 SLOTS (extraia apenas o que está claro)

Valores: amount, limit, value, installments, due_day, closing_day
Textos: description, card, card_name, bill_name, source, category
Pagamento: payment_method (pix|debito|credito|dinheiro)
Datas: deadline, periodicity (monthly|weekly|yearly), day_of_month
Query: query_scope (summary|cards|expenses|income|pending|recurring|category)
Tempo: time_range (today|week|month|custom) - SEPARADO de query_scope!
Cancel: cancel_target (transaction|recurring|goal|context), target_name
Context: action (start|end)

## 📤 RESPOSTA (JSON PURO, SEM MARKDOWN)

{
  "actionType": "expense|income|installment|recurring|add_card|card_event|bill|pay_bill|goal|purchase|query|query_alerts|cancel|chat|set_context|control|edit|unknown",
  "confidence": 0.0-1.0,
  "slots": { },
  "reasoning": "Explicação concisa"
}

## ✅ CHECKLIST

1. Li a mensagem COMPLETA?
2. Identifiquei indicadores de intent?
3. Apliquei prioridades se há conflito?
4. Extraí APENAS slots claros?
5. Confidence reflete minha certeza?
6. Se ambíguo (< 0.5), retornei unknown?

RESPONDA APENAS COM JSON. SEM MARKDOWN. SEM EXPLICAÇÕES ADICIONAIS.`;

// ============================================================================
// 🔧 NORMALIZAÇÃO DE SLOTS DA IA
// ============================================================================
function normalizeAISlots(slots: Record<string, any>): ExtractedSlots {
  const normalized: ExtractedSlots = {};
  
  // Copiar slots válidos
  if (slots.amount !== undefined) normalized.amount = Number(slots.amount);
  if (slots.description) normalized.description = String(slots.description);
  if (slots.payment_method) normalized.payment_method = String(slots.payment_method).toLowerCase();
  if (slots.source) normalized.source = String(slots.source).toLowerCase();
  if (slots.card) normalized.card = String(slots.card);
  if (slots.value !== undefined) normalized.value = Number(slots.value);
  if (slots.label) normalized.label = String(slots.label);
  if (slots.start_date) normalized.start_date = String(slots.start_date);
  if (slots.end_date) normalized.end_date = String(slots.end_date);
  if (slots.day_of_month !== undefined) normalized.day_of_month = Number(slots.day_of_month);
  if (slots.date_range) normalized.date_range = slots.date_range;
  if (slots.category) normalized.category = String(slots.category);
  
  // Novos slots v3.1
  if (slots.installments !== undefined) normalized.installments = Number(slots.installments);
  if (slots.bill_name) normalized.bill_name = String(slots.bill_name);
  if (slots.card_name) normalized.card_name = String(slots.card_name);
  if (slots.limit !== undefined) normalized.limit = Number(slots.limit);
  if (slots.due_day !== undefined) normalized.due_day = Number(slots.due_day);
  if (slots.closing_day !== undefined) normalized.closing_day = Number(slots.closing_day);
  if (slots.deadline) normalized.deadline = String(slots.deadline);
  
  // Normalizar periodicity (corrigir se IA retornar em português)
  if (slots.periodicity) {
    const periodicityMap: Record<string, string> = {
      "mensal": "monthly",
      "semanal": "weekly", 
      "anual": "yearly",
      "monthly": "monthly",
      "weekly": "weekly",
      "yearly": "yearly"
    };
    normalized.periodicity = periodicityMap[String(slots.periodicity).toLowerCase()] || "monthly";
  }
  
  // Normalizar frequency → periodicity (caso IA use nome errado)
  if (slots.frequency && !normalized.periodicity) {
    const freqMap: Record<string, string> = {
      "mensal": "monthly",
      "semanal": "weekly",
      "anual": "yearly"
    };
    normalized.periodicity = freqMap[String(slots.frequency).toLowerCase()] || "monthly";
  }
  
  // Normalizar valor → amount
  if (slots.valor && !normalized.amount) {
    normalized.amount = Number(slots.valor);
  }
  
  // Normalizar descricao → description
  if (slots.descricao && !normalized.description) {
    normalized.description = String(slots.descricao);
  }
  
  // Normalizar parcelas → installments
  if (slots.parcelas && !normalized.installments) {
    normalized.installments = Number(slots.parcelas);
  }
  
  // Normalizar nome_conta → bill_name
  if (slots.nome_conta && !normalized.bill_name) {
    normalized.bill_name = String(slots.nome_conta);
  }
  
  // Normalizar nome_cartao → card_name
  if (slots.nome_cartao && !normalized.card_name) {
    normalized.card_name = String(slots.nome_cartao);
  }
  
  // Normalizar limite → limit
  if (slots.limite && !normalized.limit) {
    normalized.limit = Number(slots.limite);
  }
  
  // Normalizar dia_vencimento → due_day
  if (slots.dia_vencimento && !normalized.due_day) {
    normalized.due_day = Number(slots.dia_vencimento);
  }
  
  // Normalizar dia_fechamento → closing_day
  if (slots.dia_fechamento && !normalized.closing_day) {
    normalized.closing_day = Number(slots.dia_fechamento);
  }
  
  // v3.2: Novos slots para query, cancel e context
  if (slots.query_scope) normalized.query_scope = String(slots.query_scope).toLowerCase();
  if (slots.time_range) normalized.time_range = String(slots.time_range).toLowerCase();
  if (slots.cancel_target) normalized.cancel_target = String(slots.cancel_target).toLowerCase();
  if (slots.target_name) normalized.target_name = String(slots.target_name);
  if (slots.action) normalized.action = String(slots.action).toLowerCase();
  
  return normalized;
}

async function callAIForDecision(
  message: string, 
  context: { hasActiveAction: boolean; activeActionType?: string; activeActionSlots?: Record<string, any>; pendingSlot?: string | null },
  history?: string
): Promise<SemanticResult> {
  try {
    let contextInfo = "";
    if (context.hasActiveAction) {
      contextInfo = `
CONTEXTO ATIVO (usuário está no meio de uma ação):
- Tipo: ${context.activeActionType}
- Slots já preenchidos: ${JSON.stringify(context.activeActionSlots)}
- Slot pendente: ${context.pendingSlot || "nenhum"}
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
          { role: "system", content: PROMPT_FINAX_UNIVERSAL + "\n\n" + contextInfo },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"actionType": "unknown", "confidence": 0.3}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error("❌ [AI] JSON inválido:", cleanJson.slice(0, 200));
      return {
        actionType: "unknown",
        confidence: 0.3,
        slots: {},
        reason: "JSON inválido da IA",
        canExecuteDirectly: false
      };
    }
    
    // Normalizar slots
    const normalizedSlots = normalizeAISlots(parsed.slots || {});
    
    // Determinar se pode executar diretamente
    const actionType = parsed.actionType || "unknown";
    const canExecute = hasAllRequiredSlots(actionType, normalizedSlots);
    
    console.log(`🤖 [AI] ${actionType} | Conf: ${parsed.confidence} | Slots: ${JSON.stringify(normalizedSlots)} | Exec: ${canExecute}`);
    
    return {
      actionType,
      confidence: parsed.confidence || 0.5,
      slots: normalizedSlots,
      reason: parsed.reasoning || "",
      canExecuteDirectly: canExecute
    };
  } catch (error) {
    console.error("❌ [AI] Erro:", error);
    return {
      actionType: "unknown",
      confidence: 0.3,
      slots: {},
      reason: "Erro na IA",
      canExecuteDirectly: false
    };
  }
}

// ============================================================================
// 🔍 getMissingSlots - LISTA SLOTS OBRIGATÓRIOS FALTANTES
// ============================================================================

function getMissingSlots(actionType: ActionType, currentSlots: Record<string, any>): string[] {
  const requirements = SLOT_REQUIREMENTS[actionType];
  if (!requirements) return [];
  
  return requirements.required.filter(slot => {
    const value = currentSlots[slot];
    return value === null || value === undefined || value === "";
  });
}

// ============================================================================
// 🚫 GUARD CLAUSES DE DOMÍNIO
// ============================================================================
// Depois que o Decision Engine decide uma intenção, é PROIBIDO:
// - card_event cair em expense/income
// - income perguntar se é gasto
// - expense perguntar se é entrada
// - Número isolado em card_event disparar slot de valor financeiro
// ============================================================================

function assertDomainIsolation(
  decidedType: ActionType, 
  activeAction: ActiveAction | null
): { valid: boolean; shouldDiscard: boolean } {
  if (!activeAction) return { valid: true, shouldDiscard: false };
  
  const currentType = activeAction.intent.includes("entrada") || activeAction.intent === "income" ? "income"
    : activeAction.intent.includes("card") || activeAction.intent === "card_event" ? "card_event"
    : activeAction.intent.includes("gasto") || activeAction.intent === "expense" ? "expense"
    : activeAction.intent;
  
  // Se domínios são diferentes e o novo não é cancel/control → descartar contexto
  if (decidedType !== "unknown" && decidedType !== "cancel" && decidedType !== "control") {
    if (decidedType !== currentType) {
      console.log(`🚫 [GUARD] Domínio incompatível: contexto=${currentType}, decisão=${decidedType} → descartando`);
      return { valid: true, shouldDiscard: true };
    }
  }
  
  return { valid: true, shouldDiscard: false };
}

// ============================================================================
// 🎯 DECISION ENGINE PRINCIPAL - IA PRIMEIRO, HEURÍSTICA FALLBACK
// ============================================================================
// NOVA ARQUITETURA:
// 1. IA SEMPRE é chamada primeiro para classificar e extrair
// 2. Heurística só é usada como fallback quando IA falha
// 3. Slots são mesclados: IA tem prioridade
// ============================================================================

async function decisionEngine(
  message: string,
  activeAction: ActiveAction | null,
  history?: string,
  payloadType?: string  // NOVO: tipo do payload (text, interactive, audio, image)
): Promise<{ result: SemanticResult; shouldBlockLegacyFlow: boolean }> {
  
  console.log(`\n🧠 [DECISION ENGINE v6.0 - IA-FIRST] ━━━━━━━━━━━━━━━━`);
  console.log(`📩 Mensagem: "${message.slice(0, 60)}..." | Tipo: ${payloadType || 'unknown'}`);
  console.log(`📋 Arquitetura: Fast-Track → IA → Execução (sem keywords)`)
  
  // ========================================================================
  // 🔢 PRIORIDADE MÁXIMA: SELEÇÃO NUMÉRICA (quando há pending_slot = "selection")
  // ========================================================================
  // CORREÇÃO CRÍTICA: Antes de interpretar como valor monetário, verificar se
  // o usuário está respondendo a uma lista de seleção (ex: "Qual cancelar? 1-6")
  // ========================================================================
  if (activeAction && activeAction.pending_slot === "selection" && isNumericOnly(message)) {
    const index = parseInt(message.trim()) - 1; // Usuário escolhe 1-based
    const options = activeAction.slots.options as string[];
    
    console.log(`🔢 [SELEÇÃO] Número "${message}" detectado com pending_slot=selection`);
    console.log(`🔢 [SELEÇÃO] Options disponíveis: ${options?.length || 0}, índice: ${index}`);
    
    if (options && index >= 0 && index < options.length) {
      const selectedId = options[index];
      console.log(`✅ [SELEÇÃO] Selecionado item ${index + 1}: ${selectedId}`);
      
      // Retornar com informação para processamento posterior
      return {
        result: {
          actionType: "cancel" as ActionType, // Será refinado no processamento
          confidence: 0.99,
          slots: { 
            ...activeAction.slots,
            selected_id: selectedId,
            selection_index: index,
            selection_intent: activeAction.intent
          },
          reason: `Seleção numérica: item ${index + 1}`,
          canExecuteDirectly: true
        },
        shouldBlockLegacyFlow: true
      };
    } else {
      // Índice inválido
      console.log(`❌ [SELEÇÃO] Índice inválido: ${index + 1} (opções: 1-${options?.length || 0})`);
      return {
        result: {
          actionType: "unknown" as ActionType,
          confidence: 0.3,
          slots: { error: "invalid_selection", message: `Escolhe um número de 1 a ${options?.length || 0}` },
          reason: "Seleção inválida",
          canExecuteDirectly: false
        },
        shouldBlockLegacyFlow: true
      };
    }
  }
  
  // ========================================================================
  // PRIORIDADE ABSOLUTA: NÚMERO ISOLADO → NUNCA chamar IA, perguntar direto
  // BLINDAGEM: SÓ verifica se for mensagem de TEXTO (não botão/interativo)
  // ========================================================================
  if (payloadType === 'text' && isNumericOnly(message)) {
    const numValue = parseNumericValue(message);
    console.log(`🔢 [NÚMERO ISOLADO] Detectado: ${numValue} → Verificando contexto`);
    
    // Se tem contexto esperando amount, preencher
    if (activeAction && activeAction.pending_slot === "amount" && numValue) {
      const actionType = activeAction.intent as ActionType;
      const mergedSlots = { ...activeAction.slots, amount: numValue };
      const missing = getMissingSlots(actionType, mergedSlots);
      
      console.log(`📥 [NÚMERO] Preenchendo slot amount no contexto ${actionType}: ${numValue}`);
      
      return {
        result: {
          actionType,
          confidence: 0.95,
          slots: mergedSlots,
          reason: "Número preencheu slot pendente",
          canExecuteDirectly: missing.length === 0
        },
        shouldBlockLegacyFlow: true
      };
    }
    
    // SEM contexto → forçar pergunta "gasto ou entrada?" (retorna unknown)
    console.log(`🔢 [NÚMERO] Sem contexto → forçar pergunta gasto/entrada`);
    return {
      result: {
        actionType: "unknown",
        confidence: 0.1, // Baixa confiança força fallback de número
        slots: { amount: numValue || undefined },
        reason: "Número isolado sem contexto",
        canExecuteDirectly: false
      },
      shouldBlockLegacyFlow: false // Permite fallback de número
    };
  }
  
  // ========================================================================
  // PRIORIDADE 1: Se há slot pendente, tentar extrair valor simples
  // ========================================================================
  if (activeAction && activeAction.pending_slot) {
    const slotValue = extractSlotValue(message, activeAction.pending_slot);
    
    if (slotValue !== null) {
      console.log(`📥 Preenchendo slot pendente "${activeAction.pending_slot}": ${slotValue}`);
      
      const actionType = activeAction.intent.includes("income") ? "income" 
        : activeAction.intent.includes("expense") ? "expense"
        : activeAction.intent.includes("recurring") ? "recurring"
        : activeAction.intent as ActionType;
      
      const mergedSlots = { ...activeAction.slots, [activeAction.pending_slot]: slotValue };
      
      return {
        result: {
          actionType,
          confidence: 0.95,
          slots: mergedSlots,
          reason: `Slot ${activeAction.pending_slot} preenchido`,
          canExecuteDirectly: getMissingSlots(actionType, mergedSlots).length === 0
        },
        shouldBlockLegacyFlow: true
      };
    }
  }
  
  // ========================================================================
  // PRIORIDADE 2: CLASSIFICAÇÃO DETERMINÍSTICA (antes de IA!)
  // ========================================================================
  // Importação já feita no topo: classifyDeterministic
  const deterministicResult = classifyDeterministic(message);
  console.log(`⚡ [DETERMINÍSTICO] ${deterministicResult.actionType} (${(deterministicResult.confidence * 100).toFixed(0)}%) - ${deterministicResult.reason}`);

  // Se determinístico detectou palavra solta → NÃO chamar IA, forçar clarificação
  if (deterministicResult.source === "deterministic" && 
      deterministicResult.actionType === "unknown" && 
      deterministicResult.slots.possible_description) {
    console.log(`🔤 [WORD GUARD] Palavra solta "${deterministicResult.slots.possible_description}" → forçar clarificação`);
    
    return {
      result: {
        actionType: "unknown",
        confidence: 0.4,
        slots: deterministicResult.slots,
        reason: deterministicResult.reason,
        canExecuteDirectly: false
      },
      shouldBlockLegacyFlow: false
    };
  }

  // Se determinístico tem alta confiança (>= 0.9) → usar diretamente
  if (deterministicResult.source === "deterministic" && deterministicResult.confidence >= 0.9) {
    // Cast para ActionType local (goal não existe aqui, mas nunca terá conf 0.9)
    const detActionType = deterministicResult.actionType as ActionType;
    const missing = getMissingSlots(detActionType, deterministicResult.slots);
    console.log(`✅ [DETERMINÍSTICO] Usando resultado direto: ${detActionType}`);
    
    return {
      result: {
        actionType: detActionType,
        confidence: deterministicResult.confidence,
        slots: deterministicResult.slots,
        reason: deterministicResult.reason,
        canExecuteDirectly: missing.length === 0
      },
      shouldBlockLegacyFlow: true
    };
  }

  // ========================================================================
  // PRIORIDADE 3: IA EXTRAI E CLASSIFICA (quando determinístico incerto)
  // ========================================================================
  console.log(`🤖 [IA] Chamando IA para classificar (determinístico incerto)...`);
  
  const aiResult = await callAIForDecision(
    message,
    {
      hasActiveAction: !!activeAction,
      activeActionType: activeAction?.intent,
      activeActionSlots: activeAction?.slots,
      pendingSlot: activeAction?.pending_slot
    },
    history
  );
  
  console.log(`🤖 [IA] Resultado: ${aiResult.actionType} | Conf: ${(aiResult.confidence * 100).toFixed(0)}% | Slots: ${JSON.stringify(aiResult.slots)}`);
  
  // ========================================================================
  // Se IA tem boa confiança (>= 0.75), USAR resultado da IA
  // ========================================================================
  if (aiResult.confidence >= 0.75 && aiResult.actionType !== "unknown") {
    const missing = getMissingSlots(aiResult.actionType, aiResult.slots);
    
    console.log(`✅ [IA] Confiança alta (${(aiResult.confidence * 100).toFixed(0)}%) | Faltam: ${missing.join(", ") || "nenhum"}`);
    
    return {
      result: {
        ...aiResult,
        canExecuteDirectly: missing.length === 0
      },
      shouldBlockLegacyFlow: true
    };
  }
  
  // ========================================================================
  // IA INCERTA → Usar resultado da IA mesmo assim (sem fallback de keywords)
  // A IA é a fonte única de verdade para classificação
  // ========================================================================
  console.log(`⚠️ [IA] Confiança baixa (${(aiResult.confidence * 100).toFixed(0)}%) → usando resultado da IA mesmo assim`);
  
  const missing = getMissingSlots(aiResult.actionType, aiResult.slots);
  
  return {
    result: {
      ...aiResult,
      canExecuteDirectly: missing.length === 0
    },
    shouldBlockLegacyFlow: aiResult.confidence >= 0.5
  };
}

function extractSlotValue(message: string, slotType: string): any {
  const normalized = normalizeText(message);
  
  switch (slotType) {
    case "amount":
    case "value":
      const numMatch = message.match(/(\d+[.,]?\d*)/);
      if (numMatch) return parseFloat(numMatch[1].replace(",", "."));
      return null;
      
    case "payment_method":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("debito") || normalized.includes("débito")) return "debito";
      if (normalized.includes("credito") || normalized.includes("crédito")) return "credito";
      if (normalized.includes("dinheiro")) return "dinheiro";
      return null;
      
    case "source":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("dinheiro")) return "dinheiro";
      if (normalized.includes("transfer")) return "transferencia";
      return null;
      
    case "type_choice":
      if (normalized.includes("gasto") || normalized.includes("gastei") || normalized.includes("paguei")) return "expense";
      if (normalized.includes("entrada") || normalized.includes("recebi") || normalized.includes("ganhei")) return "income";
      return null;
      
    default:
      return message.trim() || null;
  }
}

// ============================================================================
// 🎯 CONTEXT MANAGER
// ============================================================================

// ============================================================================
// ⏱️ TTL CONFIGURÁVEL PARA ACTIONS (15 minutos)
// ============================================================================
const ACTION_TTL_MINUTES = 15;

async function getActiveAction(userId: string): Promise<ActiveAction | null> {
  const ttlAgo = new Date(Date.now() - ACTION_TTL_MINUTES * 60 * 1000).toISOString();
  
  await supabase
    .from("actions")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection"])
    .lt("updated_at", ttlAgo);
  
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
  const expiresAt = new Date(Date.now() + ACTION_TTL_MINUTES * 60 * 1000).toISOString();
  
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

// Função removida - substituída por assertDomainIsolation()

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

// 🧠 Categorização agora é feita via ai/categorizer.ts com IA-First + autoaprendizado
import { categorizeDescription } from "./ai/categorizer.ts";

// 📊 Query handlers
import { getExpensesByCategory } from "./intents/query.ts";

async function registerExpense(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  
  // 🧠 CATEGORIZAÇÃO IA-FIRST COM AUTOAPRENDIZADO
  const categoryResult = await categorizeDescription(descricao, slots.category);
  const categoria = categoryResult.category;
  
  console.log(`📂 [EXPENSE] Categorização: "${descricao}" → ${categoria} (fonte: ${categoryResult.source}, conf: ${categoryResult.confidence})`);
  if (categoryResult.learned) {
    console.log(`   └─ 🧠 Termo "${categoryResult.keyTerm}" aprendido para futuras transações!`);
  }
  
  const formaPagamento = slots.payment_method || "outro";
  
  // ========================================================================
  // 💳 CORREÇÃO CRÍTICA: BUSCAR CARTÃO POR NOME E OBTER ID
  // ========================================================================
  let cardId = slots.card_id || null;
  let cardName = slots.card || null;
  
  // Se é crédito e temos nome do cartão mas não ID, buscar ID
  if (formaPagamento === "credito" && cardName && !cardId) {
    console.log(`💳 [EXPENSE] Buscando cartão por nome: "${cardName}"`);
    
    const { data: foundCard } = await supabase
      .from("cartoes_credito")
      .select("id, nome, limite_disponivel")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .ilike("nome", `%${cardName}%`)
      .limit(1)
      .single();
    
    if (foundCard) {
      cardId = foundCard.id;
      cardName = foundCard.nome;
      console.log(`💳 [EXPENSE] Cartão encontrado: ${cardName} (${cardId})`);
    } else {
      console.log(`💳 [EXPENSE] Cartão "${cardName}" não encontrado, buscando primeiro cartão ativo...`);
      // Fallback: usar primeiro cartão ativo
      const { data: firstCard } = await supabase
        .from("cartoes_credito")
        .select("id, nome, limite_disponivel")
        .eq("usuario_id", userId)
        .eq("ativo", true)
        .limit(1)
        .single();
      
      if (firstCard) {
        cardId = firstCard.id;
        cardName = firstCard.nome;
        console.log(`💳 [EXPENSE] Usando cartão padrão: ${cardName} (${cardId})`);
      }
    }
  }
  
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
    cartao_id: cardId,  // Agora sempre será UUID válido ou null
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  // ========================================================================
  // 💳 ATUALIZAR LIMITE DO CARTÃO SE FOR CRÉDITO
  // ========================================================================
  let cardInfo = "";
  if (formaPagamento === "credito" && cardId) {
    const { data: card } = await supabase
      .from("cartoes_credito")
      .select("limite_disponivel, nome")
      .eq("id", cardId)
      .single();
    
    if (card && card.limite_disponivel !== null) {
      const novoLimite = Math.max(0, card.limite_disponivel - valor);
      
      await supabase
        .from("cartoes_credito")
        .update({ limite_disponivel: novoLimite })
        .eq("id", cardId);
      
      console.log(`💳 [CARD] Limite atualizado: ${card.limite_disponivel} → ${novoLimite}`);
      cardInfo = `\n💳 ${card.nome || cardName} (disponível: R$ ${novoLimite.toFixed(2)})`;
    }
  } else if (cardName) {
    cardInfo = `\n💳 ${cardName}`;
  }
  
  // 📍 INTERCEPTADOR: Vincular a contexto ativo (viagem/evento)
  await linkTransactionToContext(userId, tx.id);
  
  // Verificar se há contexto ativo para informar o usuário
  const activeContext = await getActiveContext(userId);
  let contextInfo = "";
  if (activeContext) {
    contextInfo = `\n📍 _Vinculado a: ${activeContext.label}_`;
  }
  
  if (actionId) await closeAction(actionId, tx.id);
  
  // ========================================================================
  // 💰 VERIFICAR ALERTAS DE ORÇAMENTO APÓS REGISTRO
  // ========================================================================
  const budgetAlert = await checkBudgetAfterExpense(userId, categoria, valor);
  
  // ========================================================================
  // 📬 PROCESSAR PRÓXIMA MENSAGEM DA FILA (SE HOUVER)
  // ========================================================================
  const pendingCount = await countPendingMessages(userId);
  let queueInfo = "";
  if (pendingCount > 0) {
    queueInfo = `\n\n📬 _Você tem ${pendingCount} gasto(s) pendente(s) que anotei!_`;
    console.log(`📬 [QUEUE] ${pendingCount} mensagem(ns) pendente(s) para ${userId}`);
  }
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const emoji = categoria === "alimentacao" ? "🍽️" : categoria === "mercado" ? "🛒" : categoria === "transporte" ? "🚗" : "💸";
  
  // Montar mensagem com alerta de orçamento se houver
  let message = `${emoji} *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${formaPagamento}${cardInfo}\n📅 ${dataFormatada} às ${horaFormatada}${contextInfo}`;
  
  if (budgetAlert) {
    message += `\n\n${budgetAlert}`;
  }
  
  if (queueInfo) {
    message += queueInfo;
  }
  
  return {
    success: true,
    message
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
// ✏️ EDIT/CORREÇÃO RÁPIDA - Buscar última transação e permitir correção
// ============================================================================

async function getLastTransaction(userId: string, withinMinutes: number = 2): Promise<any | null> {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  
  const { data } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("status", "confirmada")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  return data || null;
}

async function updateTransactionPaymentMethod(txId: string, newMethod: string): Promise<{ success: boolean; message: string }> {
  const { data: tx, error } = await supabase
    .from("transacoes")
    .update({ forma_pagamento: newMethod })
    .eq("id", txId)
    .select("valor, descricao, categoria")
    .single();
  
  if (error || !tx) {
    console.error("❌ [EDIT] Erro ao atualizar:", error);
    return { success: false, message: "Não consegui corrigir 😕" };
  }
  
  const paymentEmoji = newMethod === "pix" ? "📱" : newMethod === "debito" ? "💳" : newMethod === "credito" ? "💳" : "💵";
  
  return {
    success: true,
    message: `✅ *Corrigido!*\n\n💸 R$ ${tx.valor?.toFixed(2)} agora é *${paymentEmoji} ${newMethod}*`
  };
}

// ============================================================================
// 🔄 RECURRING HANDLER - Gastos Recorrentes (ARQUITETURA DEFENSIVA)
// ============================================================================
// 🔍 BUSCA INTELIGENTE DE RECORRENTES
// ============================================================================

async function findRecurringByName(userId: string, searchTerm: string): Promise<any[]> {
  // Busca case-insensitive usando ilike
  const { data: recorrentes } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .ilike("descricao", `%${searchTerm}%`);
  
  return recorrentes || [];
}

async function listActiveRecurrings(userId: string): Promise<any[]> {
  const { data: recorrentes } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .order("created_at", { ascending: false })
    .limit(10);
  
  return recorrentes || [];
}

async function cancelRecurring(userId: string, recurringId: string): Promise<{ success: boolean; message: string }> {
  const { data: recorrente } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("id", recurringId)
    .eq("usuario_id", userId)
    .single();
  
  if (!recorrente) {
    return { success: false, message: "Recorrente não encontrado 🤔" };
  }
  
  await supabase
    .from("gastos_recorrentes")
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq("id", recurringId);
  
  return {
    success: true,
    message: `✅ *Recorrente cancelado!*\n\n🗑️ ${recorrente.descricao} - R$ ${recorrente.valor_parcela?.toFixed(2)}/mês\n\n_Não será mais cobrado automaticamente._`
  };
}

// ============================================================================
// 💳 QUERIES ANALÍTICAS DE CARTÕES
// ============================================================================

async function queryCardLimits(userId: string): Promise<string> {
  const { data: cards } = await supabase
    .from("cartoes_credito")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true);
  
  if (!cards || cards.length === 0) {
    return "Você não tem cartões cadastrados 💳";
  }
  
  const lista = cards.map(c => {
    const total = c.limite_total || 0;
    const disponivel = c.limite_disponivel || 0;
    const usado = total - disponivel;
    return `💳 *${c.nome}*\n   Total: R$ ${total.toFixed(2)}\n   Disponível: R$ ${disponivel.toFixed(2)}\n   Usado: R$ ${usado.toFixed(2)}`;
  }).join("\n\n");
  
  return `💳 *Seus Cartões*\n\n${lista}`;
}

async function queryExpensesByCard(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: gastos } = await supabase
    .from("transacoes")
    .select("valor, cartao_id")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .eq("forma_pagamento", "credito")
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada");
  
  if (!gastos || gastos.length === 0) {
    return "Nenhum gasto no crédito este mês 💳";
  }
  
  // Buscar nomes dos cartões
  const cardIds = [...new Set(gastos.map(g => g.cartao_id).filter(Boolean))];
  const { data: cards } = await supabase
    .from("cartoes_credito")
    .select("id, nome")
    .in("id", cardIds.length > 0 ? cardIds : ["none"]);
  
  const cardMap = new Map(cards?.map(c => [c.id, c.nome]) || []);
  
  // Agrupar por cartão
  const byCard: Record<string, { nome: string; total: number; count: number }> = {};
  gastos.forEach(g => {
    const cardName = g.cartao_id ? (cardMap.get(g.cartao_id) || "Outro") : "Sem cartão";
    if (!byCard[cardName]) byCard[cardName] = { nome: cardName, total: 0, count: 0 };
    byCard[cardName].total += Number(g.valor);
    byCard[cardName].count += 1;
  });
  
  const lista = Object.values(byCard)
    .map(c => `💳 ${c.nome}: R$ ${c.total.toFixed(2)} (${c.count} gastos)`)
    .join("\n");
  
  return `💳 *Gastos por Cartão (este mês)*\n\n${lista}`;
}

async function queryContextExpenses(userId: string, contextId: string): Promise<{ total: number; count: number }> {
  const { data: gastos } = await supabase
    .from("transacoes")
    .select("valor")
    .eq("context_id", contextId)
    .eq("status", "confirmada");
  
  const total = gastos?.reduce((sum, g) => sum + Number(g.valor), 0) || 0;
  return { total, count: gastos?.length || 0 };
}

// ============================================================================

// Interface do contrato de recorrência
interface RecurringContract {
  user_id: string;
  transaction_id: string;
  amount: number;
  description: string;
  periodicity: "monthly" | "weekly" | "yearly";
  day_of_month?: number;
  categoria?: string;
}

// Validador do contrato - retorna null se válido, ou string com motivo se inválido
function validateRecurringContract(contract: Partial<RecurringContract>): string | null {
  if (!contract.user_id) return "user_id ausente";
  if (!contract.transaction_id) return "transaction_id ausente";
  if (typeof contract.amount !== "number" || isNaN(contract.amount) || contract.amount <= 0) return `amount inválido: ${contract.amount}`;
  if (!contract.description || contract.description.trim() === "") return "description ausente ou vazia";
  if (!["monthly", "weekly", "yearly"].includes(contract.periodicity || "")) return `periodicity inválido: ${contract.periodicity}`;
  return null; // Contrato válido
}

// Normalizador de periodicity para o formato do banco (capitalizado conforme constraint)
function normalizePeriodicityForDB(periodicity: string): string {
  const map: Record<string, string> = {
    "monthly": "Mensal",
    "weekly": "Semanal",
    "yearly": "Mensal", // Banco não tem "Anual", usar Mensal como fallback
    "mensal": "Mensal",
    "semanal": "Semanal",
    "anual": "Mensal"
  };
  return map[periodicity.toLowerCase()] || "Mensal";
}

// 🛡️ FUNÇÃO DEFENSIVA - NUNCA lança exceção, NUNCA interrompe fluxo principal
async function tryRegisterRecurring(contract: Partial<RecurringContract>): Promise<{ success: boolean; reason?: string; recurrenceId?: string }> {
  // GUARD 1: Validar contrato
  const validationError = validateRecurringContract(contract);
  if (validationError) {
    console.log(`🔄 [RECURRING][SKIP] Contrato inválido: ${validationError}`, JSON.stringify(contract));
    return { success: false, reason: validationError };
  }
  
  // GUARD 2: Contrato válido, prosseguir com insert
  const tipoRecorrencia = normalizePeriodicityForDB(contract.periodicity!);
  const dayOfMonth = contract.day_of_month || new Date().getDate();
  
  console.log(`🔄 [RECURRING][ATTEMPT] Criando recorrência: ${contract.description} - R$ ${contract.amount} (${tipoRecorrencia}, dia ${dayOfMonth})`);
  
  try {
    const { data: recorrencia, error: recError } = await supabase.from("gastos_recorrentes").insert({
      usuario_id: contract.user_id,
      valor_parcela: contract.amount,
      categoria: contract.categoria || "outros",
      descricao: contract.description,
      tipo_recorrencia: tipoRecorrencia,
      dia_mes: dayOfMonth,
      ativo: true,
      origem: "whatsapp"
    }).select("id").single();
    
    if (recError) {
      console.error(`🔄 [RECURRING][DB_ERROR] Falha no insert:`, recError.message, recError.details, recError.hint);
      return { success: false, reason: `DB: ${recError.message}` };
    }
    
    // Vincular transação à recorrência
    await supabase.from("transacoes").update({ id_recorrente: recorrencia.id }).eq("id", contract.transaction_id);
    
    console.log(`🔄 [RECURRING][SUCCESS] Recorrência criada: ${recorrencia.id}`);
    return { success: true, recurrenceId: recorrencia.id };
    
  } catch (err) {
    // FALLBACK: Captura qualquer exceção inesperada
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`🔄 [RECURRING][EXCEPTION] Erro inesperado:`, errorMsg);
    return { success: false, reason: `Exception: ${errorMsg}` };
  }
}

// Função principal de registro de recorrência (usa a defensiva internamente)
async function registerRecurring(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount;
  const descricao = slots.description || "";
  const periodicity = (slots.periodicity || "monthly") as "monthly" | "weekly" | "yearly";
  const dayOfMonth = slots.day_of_month || new Date().getDate();
  
  // GUARD: Validar valor antes de qualquer operação
  if (!valor || typeof valor !== "number" || valor <= 0) {
    console.error(`🔄 [RECURRING][GUARD] Valor inválido: ${valor}`);
    return { success: false, message: "Falta informar o valor 💰" };
  }
  
  // 🧠 CATEGORIZAÇÃO IA-FIRST COM AUTOAPRENDIZADO
  const categoryResult = await categorizeDescription(descricao, slots.category);
  const categoria = categoryResult.category;
  
  console.log(`🔄 [RECURRING] Iniciando: R$ ${valor} - ${descricao} (${periodicity})`);
  console.log(`📂 [RECURRING] Categorização: "${descricao}" → ${categoria} (fonte: ${categoryResult.source})`);
  
  const agora = new Date();
  
  // PASSO 1: Registrar a transação de HOJE (SEMPRE executa)
  const { data: tx, error: txError } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    recorrente: true,
    status: "confirmada"
  }).select("id").single();
  
  if (txError) {
    console.error("❌ [RECURRING] Erro ao criar transação:", txError);
    return { success: false, message: "Algo deu errado ao registrar 😕" };
  }
  
  console.log(`🔄 [RECURRING] Transação criada: ${tx.id}`);
  
  // PASSO 2: Tentar criar recorrência (ISOLADO - nunca afeta o passo 1)
  const recurringResult = await tryRegisterRecurring({
    user_id: userId,
    transaction_id: tx.id,
    amount: valor,
    description: descricao,
    periodicity: periodicity,
    day_of_month: dayOfMonth,
    categoria: categoria
  });
  
  // PASSO 3: Fechar action se existir
  if (actionId) await closeAction(actionId, tx.id);
  
  // PASSO 4: Retornar mensagem apropriada
  const diaLabel = dayOfMonth === 1 ? "início" : dayOfMonth >= 25 ? "fim" : `dia ${dayOfMonth}`;
  
  if (recurringResult.success) {
    return {
      success: true,
      message: `🔄 *Gasto recorrente salvo!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n📅 Todo ${diaLabel} do mês\n\n✅ _Registrei o gasto de hoje e agendei os próximos!_`
    };
  } else {
    // Transação foi salva, mas recorrência falhou
    console.log(`🔄 [RECURRING][PARTIAL] Transação OK, recorrência falhou: ${recurringResult.reason}`);
    return { 
      success: true, 
      message: `✅ *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n\n⚠️ _Não consegui agendar os próximos meses (${recurringResult.reason})_`
    };
  }
}

// ============================================================================
// 📍 CONTEXT HANDLER - Viagens/Eventos
// ============================================================================

async function getActiveContext(userId: string): Promise<any | null> {
  const now = new Date().toISOString();
  
  const { data } = await supabase
    .from("user_contexts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("start_date", now)
    .gte("end_date", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  return data || null;
}

async function createUserContext(userId: string, slots: ExtractedSlots): Promise<{ success: boolean; message: string; contextId?: string }> {
  const label = slots.label || "Evento";
  const description = slots.description || null;
  const CURRENT_YEAR = 2026; // ANO ATUAL EXPLÍCITO
  
  // Parsear datas
  let startDate = new Date();
  let endDate = new Date();
  endDate.setDate(endDate.getDate() + 7); // Default: 7 dias
  
  if (slots.date_range) {
    // Tentar parsear datas do formato brasileiro
    const parseDate = (str: string): Date => {
      const parts = str.split(/[\/\-]/);
      if (parts.length >= 2) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        // USAR ANO ATUAL (2026) SE NÃO ESPECIFICADO
        let year = parts[2] ? parseInt(parts[2]) : CURRENT_YEAR;
        if (year < 100) year = 2000 + year;
        
        const date = new Date(year, month, day);
        
        // VALIDAÇÃO: Se data é no passado distante (mais de 30 dias), ajustar
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (date < thirtyDaysAgo) {
          // Data muito antiga, provavelmente ano errado - usar ano atual
          date.setFullYear(CURRENT_YEAR);
          console.log(`📍 [CONTEXT] Data ajustada para ano ${CURRENT_YEAR}: ${date.toISOString()}`);
        }
        
        return date;
      }
      return new Date();
    };
    
    startDate = parseDate(slots.date_range.start);
    endDate = parseDate(slots.date_range.end);
    
    // Garantir que endDate é depois de startDate
    if (endDate <= startDate) {
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    }
  } else if (slots.start_date && slots.end_date) {
    startDate = new Date(slots.start_date);
    endDate = new Date(slots.end_date);
  }
  
  console.log(`📍 [CONTEXT] Criando: ${label} de ${startDate.toISOString()} até ${endDate.toISOString()}`);
  
  const { data: context, error } = await supabase.from("user_contexts").insert({
    user_id: userId,
    label,
    description,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    status: "active",
    auto_tag: true
  }).select("id").single();
  
  if (error) {
    console.error("❌ [CONTEXT] Erro:", error);
    return { success: false, message: "Não consegui criar o contexto 😕" };
  }
  
  const startFormatted = startDate.toLocaleDateString("pt-BR");
  const endFormatted = endDate.toLocaleDateString("pt-BR");
  const diasRestantes = Math.ceil((endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    success: true,
    contextId: context.id,
    message: `📍 *Modo Contexto Ativado!*\n\n🏷️ *${label}*\n📅 ${startFormatted} até ${endFormatted}\n⏰ ${diasRestantes} dias\n\n✅ _Todos os seus gastos serão marcados como parte de "${label}" automaticamente!_\n\n_Quando terminar, mande "terminei a viagem" ou "fim do evento"_`
  };
}

async function closeUserContext(userId: string): Promise<{ success: boolean; message: string }> {
  const activeContext = await getActiveContext(userId);
  
  if (!activeContext) {
    return { success: false, message: "Você não tem nenhum evento ativo no momento 🤔" };
  }
  
  await supabase.from("user_contexts").update({ 
    status: "completed",
    end_date: new Date().toISOString()
  }).eq("id", activeContext.id);
  
  return {
    success: true,
    message: `✅ *Evento "${activeContext.label}" encerrado!*\n\n📊 Total gasto: R$ ${(activeContext.total_spent || 0).toFixed(2)}\n🧾 ${activeContext.transaction_count || 0} transações\n\n_Voltando ao modo normal!_`
  };
}

// Função para vincular transação a contexto ativo (interceptador)
async function linkTransactionToContext(userId: string, transactionId: string): Promise<void> {
  const activeContext = await getActiveContext(userId);
  
  if (activeContext && activeContext.auto_tag) {
    await supabase.from("transacoes").update({ context_id: activeContext.id }).eq("id", transactionId);
    console.log(`📍 [CONTEXT] Transação ${transactionId.slice(-8)} vinculada ao contexto ${activeContext.label}`);
  }
}

// ============================================================================
// 💬 CHAT HANDLER - Consultor Financeiro Conversacional
// ============================================================================

async function generateChatResponse(
  userMessage: string,
  financialSummary: string,
  activeContext: string | null,
  userName: string
): Promise<string> {
  const contextInfo = activeContext 
    ? `O usuário está no meio de: ${activeContext}` 
    : "";
  
  const systemPrompt = `Você é o Finax, consultor financeiro pessoal do ${userName}.

## TOM DE VOZ (OBRIGATÓRIO)
- Seja: objetivo, claro, respeitoso, profissional.
- Use português brasileiro natural, mas SEM exageros emocionais.
- Seja direto e útil, sem ser frio ou robótico.

## O QUE NUNCA FAZER
- NÃO use gírias como "Putz", "Cara", "Mano", "Nossa"
- NÃO seja excessivamente emotivo ou dramático
- NÃO use frases como "a gente precisa dar um jeito"
- NÃO assuma que a situação é ruim sem dados claros
- NÃO personifique demais ("eu também fico preocupado")
- NÃO use mais de 2-3 emojis por resposta

## O QUE SEMPRE FAZER
- Cite dados CONCRETOS quando disponíveis
- Seja direto nas recomendações
- Use linguagem profissional mas acessível
- Limite resposta a 2-3 parágrafos curtos
- Se não tiver dados suficientes, sugira que registre mais gastos
- Se a mensagem for ambígua, pergunte em vez de adivinhar

CONTEXTO FINANCEIRO DO USUÁRIO:
${financialSummary}
${contextInfo}

VOCÊ PODE:
- Analisar a situação financeira com base nos dados
- Dar dicas práticas de economia
- Sugerir estratégias de orçamento
- Responder perguntas sobre finanças pessoais
- Identificar padrões de gastos`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
      }),
    });

    if (!response.ok) {
      console.error(`💬 [CHAT] API Error: ${response.status}`);
      return "Puxa, tive um problema aqui 😅 Mas me conta: o que você quer saber sobre suas finanças?";
    }

    const data = await response.json();
    const chatResponse = data.choices?.[0]?.message?.content;
    
    if (!chatResponse) {
      return "Vou analisar isso pra você! 📊 Me conta mais detalhes?";
    }
    
    return chatResponse;
  } catch (err) {
    console.error(`💬 [CHAT] Exception:`, err);
    return "Ops, algo deu errado por aqui 😕 Mas pode me perguntar de novo!";
  }
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
    
    // ========================================================================
    // 🔒 BLOQUEIO COGNITIVO: VERIFICAR PLANO DO USUÁRIO
    // ========================================================================
    // Antes de qualquer processamento, verificar se o trial expirou.
    // Se expirou, bloquear e direcionar para ativação.
    // ========================================================================
    if (usuario) {
      const plano = usuario.plano || "trial";
      const trialFim = usuario.trial_fim ? new Date(usuario.trial_fim) : null;
      const agora = new Date();
      
      // Verificar se trial expirou
      if (plano === "trial" && trialFim && trialFim < agora) {
        console.log(`🔒 [BLOQUEIO] Trial expirado para usuário ${userId}`);
        
        // Verificar se a mensagem é um código de ativação (FINAX-XXXXXX)
        const msgText = payload.messageText?.trim().toUpperCase() || "";
        const codigoMatch = msgText.match(/^(FINAX[-\s]?)?([A-Z0-9]{6,12})$/);
        
        if (codigoMatch) {
          // Tentar validar código
          const codigo = codigoMatch[2] || codigoMatch[0];
          console.log(`🔑 [ATIVAÇÃO] Tentando validar código: ${codigo}`);
          
          const { data: resultado } = await supabase.rpc("validar_codigo_ativacao", {
            p_codigo: codigo,
            p_usuario_id: userId
          });
          
          if (resultado?.valido) {
            await sendMessage(payload.phoneNumber, 
              `✅ *Plano ${resultado.plano === 'pro' ? 'Pro' : 'Básico'} ativado com sucesso!*\n\nAgora você tem acesso completo ao Finax. 🎉\n\nMe conta: o que posso te ajudar hoje?`, 
              payload.messageSource
            );
            
            // Salvar no histórico
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: `[CÓDIGO: ${codigo}]`,
              ai_response: `Plano ${resultado.plano} ativado`,
              tipo: "ativacao"
            });
            return;
          } else {
            const erroMsgs: Record<string, string> = {
              codigo_inexistente: "Hmm, não encontrei esse código. Confere se digitou certinho? 🤔",
              codigo_usado: "Esse código já foi usado anteriormente.",
              codigo_expirado: "Esse código expirou. Entre em contato para ajuda."
            };
            
            await sendMessage(payload.phoneNumber, 
              erroMsgs[resultado?.erro] || "Código inválido. Tenta de novo?", 
              payload.messageSource
            );
            return;
          }
        }
        
        // Se não é código, enviar mensagem de trial expirado
        const primeiroNome = nomeUsuario.split(" ")[0];
        await sendMessage(payload.phoneNumber, 
          `⏰ Oi ${primeiroNome}! Seu período de teste de 14 dias acabou.\n\nO Finax te ajudou a organizar suas finanças. Quer continuar?\n\n📱 *Básico* - Registros, orçamentos e relatórios\n⭐ *Pro* - Tudo + cartões, metas e insights\n\n👉 Acesse: [link do checkout]\n\nOu envie seu código de ativação aqui!`, 
          payload.messageSource
        );
        
        // Salvar no histórico
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: payload.messageText || "[MÍDIA]",
          ai_response: "[TRIAL EXPIRADO - BLOQUEIO]",
          tipo: "bloqueio_trial"
        });
        return;
      }
      
      // Verificar alerta de trial expirando (dias 10, 12, 14)
      if (plano === "trial" && trialFim) {
        const diasRestantes = Math.ceil((trialFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
        
        // Verificar se já enviamos alerta hoje
        const { data: alertaHoje } = await supabase
          .from("historico_conversas")
          .select("id")
          .eq("user_id", userId)
          .eq("tipo", "alerta_trial")
          .gte("created_at", new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString())
          .limit(1);
        
        if (!alertaHoje || alertaHoje.length === 0) {
          if (diasRestantes === 4) {
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: "[ALERTA TRIAL]",
              ai_response: "4 dias restantes",
              tipo: "alerta_trial"
            });
            // Alerta sutil no próximo processamento (não bloqueia)
            console.log(`⚠️ [TRIAL] Usuário ${userId} tem 4 dias restantes`);
          } else if (diasRestantes === 2) {
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: "[ALERTA TRIAL]",
              ai_response: "2 dias restantes",
              tipo: "alerta_trial"
            });
            console.log(`⚠️ [TRIAL] Usuário ${userId} tem 2 dias restantes`);
          } else if (diasRestantes === 1) {
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: "[ALERTA TRIAL]",
              ai_response: "1 dia restante",
              tipo: "alerta_trial"
            });
            console.log(`🚨 [TRIAL] Usuário ${userId} tem 1 dia restante`);
          }
        }
      }
      
      // Verificar e enviar relatórios pendentes
      await checkAndSendPendingReport(userId, payload.phoneNumber, payload.messageSource);
    }
    
    // ========================================================================
    // 📷 PROCESSAMENTO INTELIGENTE DE IMAGENS (OCR com Gemini Vision)
    // ========================================================================
    // Em vez de ignorar imagens, analisamos com IA para extrair dados.
    // Se não encontrar informação completa, fazemos perguntas inteligentes.
    // ========================================================================
    if (payload.messageType === "image") {
      console.log(`📷 [WORKER] Imagem recebida - iniciando análise com Gemini Vision`);
      
      try {
        // 1. Baixar imagem do WhatsApp
        const imageBase64 = await downloadWhatsAppMedia(payload.mediaId || "", eventoId || "");
        
        if (!imageBase64) {
          console.log(`📷 [WORKER] Não foi possível baixar a imagem`);
          await sendMessage(payload.phoneNumber, "Não consegui baixar a imagem 😕 Pode tentar enviar novamente?", payload.messageSource);
          return;
        }
        
        // 2. Analisar imagem com Gemini Vision
        const ocrResult = await analyzeImageWithGemini(imageBase64);
        console.log(`📷 [OCR] Resultado: ${JSON.stringify(ocrResult)}`);
        
        // 3. Salvar análise na tabela media_analysis
        await supabase.from("media_analysis").insert({
          message_id: payload.messageId,
          evento_bruto_id: eventoId || null,
          raw_ocr: ocrResult.raw || null,
          parsed: ocrResult,
          confidence: ocrResult.confidence || 0,
          source: "gemini_vision"
        });
        
        // 4. Fluxo baseado no resultado
        if (ocrResult.valor && ocrResult.descricao) {
          // Caso perfeito: tem valor E descrição → processar como expense
          console.log(`📷 [OCR] Dados completos: R$ ${ocrResult.valor} - ${ocrResult.descricao}`);
          
          const slots: ExtractedSlots = {
            amount: ocrResult.valor,
            description: ocrResult.descricao,
            payment_method: ocrResult.forma_pagamento || undefined
          };
          
          // Se tem forma de pagamento, pode executar direto
          if (slots.payment_method) {
            const result = await registerExpense(userId, slots, undefined);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          } else {
            // Falta forma de pagamento → perguntar
            await createAction(userId, "expense", "expense", slots, "payment_method", payload.messageId);
            await sendButtons(
              payload.phoneNumber, 
              `📷 Vi na imagem:\n\n💰 *Valor:* R$ ${ocrResult.valor.toFixed(2)}\n📝 *Descrição:* ${ocrResult.descricao}\n\nComo você pagou?`,
              SLOT_PROMPTS.payment_method.buttons!,
              payload.messageSource
            );
          }
          
        } else if (ocrResult.valor) {
          // Só valor: perguntar descrição
          console.log(`📷 [OCR] Só valor encontrado: R$ ${ocrResult.valor}`);
          
          await createAction(userId, "expense", "expense", { amount: ocrResult.valor }, "description", payload.messageId);
          await sendMessage(
            payload.phoneNumber, 
            `📷 Vi que o valor é *R$ ${ocrResult.valor.toFixed(2)}*.\n\nO que você comprou?`,
            payload.messageSource
          );
          
        } else {
          // Nada identificado: perguntar valor primeiro (de forma amigável)
          console.log(`📷 [OCR] Nenhum dado identificado na imagem`);
          
          await createAction(userId, "expense", "expense", { from_image: true }, "amount", payload.messageId);
          await sendMessage(
            payload.phoneNumber, 
            "📷 Recebi a imagem!\n\nVamos registrar juntos. Qual foi o valor?",
            payload.messageSource
          );
        }
        
        // Salvar no histórico
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: "[IMAGEM]",
          ai_response: `OCR processado: valor=${ocrResult.valor || 'N/A'}, desc=${ocrResult.descricao || 'N/A'}`,
          tipo: "image_ocr"
        });
        
        return;
        
      } catch (ocrError) {
        console.error(`📷 [OCR] Erro no processamento:`, ocrError);
        
        // Fallback amigável
        await createAction(userId, "expense", "expense", { from_image: true }, "amount", payload.messageId);
        await sendMessage(
          payload.phoneNumber, 
          "📷 Recebi a imagem!\n\nVamos registrar juntos. Qual foi o valor?",
          payload.messageSource
        );
        
        return;
      }
    }
    
    // ========================================================================
    // 🔕 GUARD: VERIFICAR OPERATION_MODE
    // ========================================================================
    const { data: perfil } = await supabase
      .from("perfil_cliente")
      .select("operation_mode")
      .eq("usuario_id", userId)
      .single();
    
    const operationMode = perfil?.operation_mode || "normal";
    console.log(`🔕 [WORKER] operation_mode: ${operationMode}`);
    
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
    // 🤝 PRIORIDADE 0: ACK DETECTION (Cortesia)
    // ========================================================================
    // Mensagens de cortesia como "Obrigado", "Valeu", "Ok" não devem disparar
    // nenhum fluxo de registro. Apenas responder amigavelmente.
    // ========================================================================
    const ACK_TOKENS = [
      "obrigado", "obrigada", "obg", "brigado", "brigada",
      "valeu", "vlw", "thanks", "thank you", "thx",
      "ok", "okay", "blz", "beleza", "entendi", "entendido",
      "certo", "fechou", "combinado", "perfeito", "massa",
      "top", "show", "dahora", "legal", "ótimo", "otimo",
      "maravilha", "excelente", "tranquilo", "suave"
    ];
    
    function isAcknowledgement(text: string): boolean {
      const normalized = normalizeText(text);
      const words = normalized.split(/\s+/);
      
      // Se tem mais de 3 palavras, provavelmente não é só cortesia
      if (words.length > 3) return false;
      
      // Verificar se algum token de ACK está presente
      return ACK_TOKENS.some(token => normalized.includes(token));
    }
    
    if (isAcknowledgement(payload.messageText || "")) {
      console.log(`🤝 [ACK] Mensagem de cortesia detectada: "${payload.messageText}"`);
      
      // Se há action pendente, manter estado (não interromper coleta)
      if (activeAction && activeAction.pending_slot) {
        console.log(`🤝 [ACK] Action pendente - mantendo estado, não respondendo`);
        // Silêncio - apenas manter o fluxo
        return;
      }
      
      // Responder amigavelmente
      const ackResponses = [
        "De nada! 😊 Me chama se precisar de algo.",
        "Por nada! Tô aqui quando precisar 💪",
        "Sempre às ordens! 🙌"
      ];
      const randomResponse = ackResponses[Math.floor(Math.random() * ackResponses.length)];
      
      await sendMessage(payload.phoneNumber, randomResponse, payload.messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: payload.messageText,
        ai_response: randomResponse,
        tipo: "ack"
      });
      
      return;
    }
    
    // ========================================================================
    // 🔘 PRIORIDADE 1: CALLBACK DE BOTÃO
    // ========================================================================
    if (payload.buttonReplyId) {
      console.log(`🔘 [BUTTON] Callback: ${payload.buttonReplyId}`);
      
      // ====================================================================
      // 📦 MÚLTIPLOS GASTOS - Separado ou Junto
      // ====================================================================
      if (payload.buttonReplyId === "multi_separado" && activeAction?.intent === "multi_expense") {
        const detectedExpenses = activeAction.slots.detected_expenses as Array<{amount: number; description: string}>;
        console.log(`📦 [MULTI] Registrando ${detectedExpenses?.length} gastos separadamente`);
        
        if (!detectedExpenses || detectedExpenses.length === 0) {
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, "Ops, perdi os dados. Pode repetir?", payload.messageSource);
          return;
        }
        
        // Registrar cada gasto separadamente (pedir pagamento para o primeiro)
        const firstExpense = detectedExpenses[0];
        await closeAction(activeAction.id);
        await createAction(userId, "multi_expense_queue", "expense", { 
          amount: firstExpense.amount,
          description: firstExpense.description,
          remaining_expenses: detectedExpenses.slice(1)
        }, "payment_method", payload.messageId);
        
        await sendButtons(
          payload.phoneNumber,
          `💸 R$ ${firstExpense.amount.toFixed(2)} - ${firstExpense.description}\n\nComo você pagou?`,
          SLOT_PROMPTS.payment_method.buttons!,
          payload.messageSource
        );
        return;
      }
      
      if (payload.buttonReplyId === "multi_junto" && activeAction?.intent === "multi_expense") {
        const total = activeAction.slots.total as number;
        const originalMessage = activeAction.slots.original_message as string;
        console.log(`📦 [MULTI] Registrando tudo junto: R$ ${total}`);
        
        await closeAction(activeAction.id);
        await createAction(userId, "expense", "expense", { 
          amount: total,
          description: originalMessage?.slice(0, 50) || "Múltiplos itens"
        }, "payment_method", payload.messageId);
        
        await sendButtons(
          payload.phoneNumber,
          `💸 R$ ${total.toFixed(2)}\n\nComo você pagou?`,
          SLOT_PROMPTS.payment_method.buttons!,
          payload.messageSource
        );
        return;
      }
      
      // ====================================================================
      // 🛡️ GUARD: BOTÃO EXPIRADO (sem contexto ativo)
      // ====================================================================
      // Se recebemos um botão mas não há activeAction, significa que o
      // contexto expirou. Responder amigavelmente pedindo para repetir.
      // ====================================================================
      if (!activeAction) {
        console.log(`⏰ [EXPIRED_BUTTON] Botão clicado sem contexto ativo: ${payload.buttonReplyId}`);
        
        // Botões de clarificação de palavra solta
        if (payload.buttonReplyId === "word_gasto" || payload.buttonReplyId === "word_consulta") {
          await sendMessage(payload.phoneNumber, 
            "⏰ Ops, demorei demais e perdi o contexto!\n\nPode repetir o que você quer registrar ou consultar?", 
            payload.messageSource
          );
          return;
        }
        
        // Botões de número isolado
        if (payload.buttonReplyId === "num_gasto" || payload.buttonReplyId === "num_entrada") {
          await sendMessage(payload.phoneNumber, 
            "⏰ Hmm, perdi o fio da meada!\n\nPode mandar o valor de novo?", 
            payload.messageSource
          );
          return;
        }
        
        // Outros botões (pagamento, cartão, etc.)
        await sendMessage(payload.phoneNumber, 
          "⏰ Opa, o tempo passou e perdi o contexto.\n\nPode me mandar de novo o que você quer fazer?", 
          payload.messageSource
        );
        return;
      }
      
      // ✏️ EDIT - Correção de forma de pagamento
      if (payload.buttonReplyId.startsWith("edit_") && activeAction?.intent === "edit") {
        const editAliases: Record<string, string> = {
          "edit_pix": "pix",
          "edit_debito": "debito",
          "edit_credito": "credito",
          "edit_dinheiro": "dinheiro"
        };
        const newMethod = editAliases[payload.buttonReplyId];
        
        if (newMethod && activeAction.slots.transaction_id) {
          const result = await updateTransactionPaymentMethod(activeAction.slots.transaction_id, newMethod);
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
      
      // FORMA DE PAGAMENTO
      if (payload.buttonReplyId.startsWith("pay_")) {
        const paymentMethod = PAYMENT_ALIASES[payload.buttonReplyId];
        if (paymentMethod && activeAction && activeAction.intent === "expense") {
          const updatedSlots = { ...activeAction.slots, payment_method: paymentMethod };
          const missing = getMissingSlots("expense", updatedSlots);
          
          if (missing.length === 0) {
            // 🔒 CRÍTICO: Registrar E fechar action imediatamente
            const result = await registerExpense(userId, updatedSlots, activeAction.id);
            // Limpar TODAS as actions pendentes do usuário (fim do loop)
            await supabase.from("actions")
              .update({ status: "done" })
              .eq("user_id", userId)
              .in("status", ["collecting", "awaiting_input"]);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
            console.log(`✅ [BUTTON] Expense registrado, todas actions fechadas`);
            return; // FIM - sem mais processamento
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
          
          // 🔒 CRÍTICO: Registrar E fechar todas as actions
          const result = await registerIncome(userId, updatedSlots, activeAction.id);
          await supabase.from("actions")
            .update({ status: "done" })
            .eq("user_id", userId)
            .in("status", ["collecting", "awaiting_input"]);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          console.log(`✅ [BUTTON] Income registrado, todas actions fechadas`);
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
      
      // ========================================================================
      // 🔤 PALAVRA SOLTA - GASTO
      // ========================================================================
      if (payload.buttonReplyId === "word_gasto" && activeAction?.intent === "clarify_word") {
        const possibleDesc = activeAction.slots.possible_description || "";
        console.log(`🔤 [BUTTON] Palavra "${possibleDesc}" é um GASTO`);
        
        await closeAction(activeAction.id);
        
        // Criar action de expense com a descrição preenchida
        await createAction(userId, "expense", "expense", { description: possibleDesc }, "amount", payload.messageId);
        await sendMessage(payload.phoneNumber, `💸 ${possibleDesc}\n\nQual foi o valor?`, payload.messageSource);
        return;
      }
      
      // ========================================================================
      // 🔤 PALAVRA SOLTA - CONSULTA
      // ========================================================================
      if (payload.buttonReplyId === "word_consulta" && activeAction?.intent === "clarify_word") {
        const possibleDesc = activeAction.slots.possible_description || "";
        console.log(`🔤 [BUTTON] Palavra "${possibleDesc}" é uma CONSULTA`);
        
        await closeAction(activeAction.id);
        
        // Buscar gastos relacionados a esse termo
        const { data: relatedTx } = await supabase
          .from("transacoes")
          .select("valor, categoria, descricao, data")
          .eq("usuario_id", userId)
          .eq("status", "confirmada")
          .ilike("descricao", `%${possibleDesc}%`)
          .order("data", { ascending: false })
          .limit(5);
        
        if (relatedTx && relatedTx.length > 0) {
          const total = relatedTx.reduce((sum, t) => sum + Number(t.valor), 0);
          const list = relatedTx.map(t => 
            `💸 R$ ${Number(t.valor).toFixed(2)} - ${new Date(t.data).toLocaleDateString("pt-BR")}`
          ).join("\n");
          
          await sendMessage(payload.phoneNumber, 
            `📊 *Gastos com "${possibleDesc}"*\n\n${list}\n\n💰 Total: R$ ${total.toFixed(2)}`,
            payload.messageSource
          );
        } else {
          await sendMessage(payload.phoneNumber, 
            `Não encontrei gastos com "${possibleDesc}" 🤔\n\nSe quiser registrar, manda o valor!`,
            payload.messageSource
          );
        }
        return;
      }
      
      // SELEÇÃO DE CARTÃO PARA EXPENSE
      if (payload.buttonReplyId.startsWith("card_") && activeAction) {
        const cardId = payload.buttonReplyId.replace("card_", "");
        
        const { data: card } = await supabase
          .from("cartoes_credito")
          .select("*")
          .eq("id", cardId)
          .single();
        
        if (card && activeAction.intent === "expense") {
          const updatedSlots = { 
            ...activeAction.slots, 
            card: card.nome,
            card_id: card.id
          };
          
          const result = await registerExpense(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
      
      // SELEÇÃO DE CARTÃO PARA RECURRING
      if (payload.buttonReplyId.startsWith("rec_card_") && activeAction) {
        const cardId = payload.buttonReplyId.replace("rec_card_", "");
        
        const { data: card } = await supabase
          .from("cartoes_credito")
          .select("*")
          .eq("id", cardId)
          .single();
        
        if (card && activeAction.intent === "recurring") {
          const updatedSlots = { 
            ...activeAction.slots, 
            card: card.nome,
            card_id: card.id
          };
          
          const result = await registerRecurring(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
      
      // PAGAMENTO DE RECORRENTE
      if (payload.buttonReplyId.startsWith("rec_pay_") && activeAction?.intent === "recurring") {
        const paymentAliases: Record<string, string> = {
          "rec_pay_pix": "pix",
          "rec_pay_debito": "debito",
          "rec_pay_credito": "credito"
        };
        const paymentMethod = paymentAliases[payload.buttonReplyId];
        
        if (paymentMethod) {
          const updatedSlots: ExtractedSlots = { ...activeAction.slots, payment_method: paymentMethod };
          
          // Se é crédito e tem múltiplos cartões, perguntar qual
          if (paymentMethod === "credito") {
            const cards = await listCardsForUser(userId);
            if (cards.length > 1) {
              const cardButtons = cards.slice(0, 3).map((c) => ({
                id: `rec_card_${c.id}`,
                title: (c.nome || "Cartão").slice(0, 20)
              }));
              
              await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "card" });
              await sendButtons(
                payload.phoneNumber,
                `🔄 ${updatedSlots.description || "Recorrente"} - R$ ${updatedSlots.amount?.toFixed(2)}/mês\n\nQual cartão?`,
                cardButtons,
                payload.messageSource
              );
              return;
            } else if (cards.length === 1) {
              updatedSlots.card = cards[0].nome;
              updatedSlots.card_id = cards[0].id;
            }
          }
          
          const result = await registerRecurring(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
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
    // 🔒 PRIORIDADE ABSOLUTA: CONTEXTO ATIVO (FSM STATE MACHINE)
    // ========================================================================
    // REGRA DE OURO v7.0: Action ativa tem prioridade TOTAL.
    // Isso inclui:
    // - pending_slot: aguardando slot específico
    // - awaiting_confirmation: aguardando sim/não/cancelar
    // ========================================================================
    if (activeAction && (activeAction.pending_slot || activeAction.status === "awaiting_confirmation")) {
      console.log(`🔒 [FSM] Ação ativa: ${activeAction.intent} | status: ${activeAction.status} | pending_slot: ${activeAction.pending_slot}`);
      
      const { handleActiveContext } = await import("./fsm/context-handler.ts");
      
      const contextResult = await handleActiveContext(
        userId,
        activeAction,
        conteudoProcessado
      );
      
      // ========================================================================
      // CASO 1: CONFIRMAÇÃO RECEBIDA → EXECUTAR
      // ========================================================================
      if (contextResult.readyToExecute && activeAction.status === "awaiting_confirmation") {
        console.log(`✅ [FSM] Confirmação recebida - executando ${activeAction.intent}`);
        
        const slots = activeAction.slots as ExtractedSlots;
        let result: { message: string; success?: boolean };
        
        switch (activeAction.intent) {
          case "expense":
            result = await registerExpense(userId, slots, activeAction.id);
            break;
          case "income":
            result = await registerIncome(userId, slots, activeAction.id);
            break;
          case "recurring":
            result = await registerRecurring(userId, slots, activeAction.id);
            break;
          case "installment":
            const { registerInstallment } = await import("./intents/installment.ts");
            result = await registerInstallment(userId, slots as any, activeAction.id);
            break;
          case "add_card":
            const { createCard } = await import("./intents/card.ts");
            result = await createCard(userId, slots as any);
            break;
          case "bill": {
            const { createBill } = await import("./intents/bills.ts");
            const billResult = await createBill({
              userId,
              nome: slots.bill_name || slots.description || "Conta",
              diaVencimento: Number(slots.due_day || 1),
              valorEstimado: slots.estimated_value ? Number(slots.estimated_value) : undefined,
              tipo: "fixa"
            });
            result = { message: billResult, success: true };
            break;
          }
          case "pay_bill": {
            const { payBill } = await import("./intents/bills.ts");
            const payResult = await payBill({
              userId,
              contaNome: slots.bill_name || slots.description || "Conta",
              valorPago: Number(slots.amount)
            });
            result = { message: payResult, success: true };
            break;
          }
          default:
            result = { message: "✅ Feito!", success: true };
        }
        
        // Limpar actions
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
        
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ========================================================================
      // CASO 2: CANCELAMENTO
      // ========================================================================
      if (contextResult.cancelled) {
        await cancelAction(userId);
        await sendMessage(payload.phoneNumber, contextResult.message || "👍 Cancelado!", payload.messageSource);
        return;
      }
      
      // ========================================================================
      // CASO 3: SLOT PREENCHIDO → VERIFICAR SE PRONTO PARA CONFIRMAR
      // ========================================================================
      if (contextResult.handled && contextResult.filledSlot) {
        console.log(`✅ [FSM] Slot preenchido: ${contextResult.filledSlot} = ${contextResult.slotValue}`);
        
        // Atualizar action com novos slots
        await updateAction(activeAction.id, { 
          slots: contextResult.updatedSlots,
          pending_slot: null
        });
        
        // Se pronto para confirmar → pedir confirmação
        if (contextResult.readyToConfirm) {
          const { generateConfirmationMessage, setActionAwaitingConfirmation } = await import("./fsm/context-handler.ts");
          
          await setActionAwaitingConfirmation(activeAction.id, contextResult.updatedSlots!);
          
          const confirmMsg = generateConfirmationMessage(activeAction.intent, contextResult.updatedSlots!);
          await sendMessage(payload.phoneNumber, confirmMsg, payload.messageSource);
          return;
        }
        
        // Ainda falta slot → perguntar próximo
        const { getNextMissingSlot, getSlotPrompt } = await import("./fsm/context-handler.ts");
        const nextMissing = getNextMissingSlot(activeAction.intent, contextResult.updatedSlots!);
        
        if (nextMissing) {
          await updateAction(activeAction.id, { pending_slot: nextMissing });
          const prompt = getSlotPrompt(nextMissing);
          
          if (prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt.text, payload.messageSource);
          }
          return;
        }
      }
      
      // ========================================================================
      // CASO 4: HANDLED MAS SEM SLOT PREENCHIDO (erro de entrada)
      // ========================================================================
      if (contextResult.handled && contextResult.message) {
        await sendMessage(payload.phoneNumber, contextResult.message, payload.messageSource);
        return;
      }
      
      // ========================================================================
      // CASO 5: MUDANÇA DE ASSUNTO → CANCELAR E CONTINUAR
      // ========================================================================
      if (contextResult.shouldCancel) {
        console.log(`🔄 [FSM] Mudança de assunto detectada, cancelando action`);
        await cancelAction(userId);
        // Continuar para classificar nova intenção
      }
    }
    
    // ========================================================================
    // 📦 DETECÇÃO DE MÚLTIPLOS GASTOS (antes do decision engine)
    // ========================================================================
    // Se a mensagem contém múltiplos valores, perguntar ao usuário se quer
    // registrar separado ou junto, ANTES de classificar.
    // ========================================================================
    // ========================================================================
    // 🛡️ GUARDS: Proteger parcelamentos, cartões e contas de detectMultipleExpenses
    // ========================================================================
    const INSTALLMENT_PATTERN = /\d+\s*(x|vezes|parcelas?)\s*(de\s*\d+)?/i;
    const CARD_PATTERN = /(adicionar|registrar|cadastrar|novo|meu)\s*cart[aã]o/i;
    const BILL_PATTERN = /(conta\s+de|fatura|vence\s+dia|vencimento)/i;
    
    const shouldSkipMultiDetection = 
      INSTALLMENT_PATTERN.test(conteudoProcessado) ||
      CARD_PATTERN.test(conteudoProcessado) ||
      BILL_PATTERN.test(conteudoProcessado);
    
    if (payload.messageType === "text" && !activeAction && !shouldSkipMultiDetection) {
      const multipleExpenses = detectMultipleExpenses(conteudoProcessado);
      
      if (multipleExpenses.length > 1) {
        console.log(`📦 [MULTI] Detectados ${multipleExpenses.length} gastos na mensagem`);
        
        const lista = formatExpensesList(multipleExpenses);
        const total = calculateTotal(multipleExpenses);
        
        await sendButtons(
          payload.phoneNumber,
          `Vi ${multipleExpenses.length} gastos:\n\n${lista}\n\n💰 Total: R$ ${total.toFixed(2)}\n\nComo quer registrar?`,
          [
            { id: "multi_separado", title: "📝 Separado" },
            { id: "multi_junto", title: "📦 Tudo junto" }
          ],
          payload.messageSource
        );
        
        // Salvar estado pendente com os gastos detectados
        await createAction(userId, "multi_expense", "multi_expense", { 
          detected_expenses: multipleExpenses,
          total,
          original_message: conteudoProcessado
        }, "selection", payload.messageId);
        
        return;
      }
    }
    
    // ========================================================================
    // 📅 DETECÇÃO DE DATAS RELATIVAS ("ontem", "anteontem", etc.)
    // ========================================================================
    let transactionDate: Date | null = null;
    if (payload.messageType === "text") {
      transactionDate = parseRelativeDate(conteudoProcessado);
      if (transactionDate) {
        console.log(`📅 [DATE] Data relativa detectada: ${transactionDate.toISOString().split('T')[0]}`);
      }
    }
    
    // ========================================================================
    // 🧠 DECISION ENGINE PRIMEIRO - CLASSIFICAÇÃO UNIFICADA
    // ========================================================================
    // REGRA ABSOLUTA: A IA analisa a mensagem PRIMEIRO, antes de qualquer
    // verificação de número. Se a IA identificar intenção, números NÃO invalidam.
    // ========================================================================
    
    // Buscar histórico para contexto da IA
    const { data: historico } = await supabase
      .from("historico_conversas")
      .select("user_message, ai_response")
      .eq("phone_number", payload.phoneNumber)
      .order("created_at", { ascending: false })
      .limit(3);
    
    const historicoFormatado = historico?.map(h => `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 80)}...`).reverse().join("\n") || "";
    
    // 🔒 DECISION ENGINE - Única fonte de verdade
    const { result: decision, shouldBlockLegacyFlow } = await decisionEngine(
      conteudoProcessado,
      activeAction,
      historicoFormatado,
      payload.messageType  // Passa o tipo: 'text', 'interactive', 'audio', etc.
    );
    
    logDecision({ 
      messageId: payload.messageId, 
      decision: "classified", 
      details: { 
        type: decision.actionType, 
        conf: decision.confidence, 
        slots: decision.slots,
        canExec: decision.canExecuteDirectly,
        blocked: shouldBlockLegacyFlow
      } 
    });
    
    // ========================================================================
    // 🧠 ELITE: SELF-HEALING CHECK (Verificar correções anteriores)
    // ========================================================================
    // Antes de prosseguir, verificar se já temos correções aprendidas para 
    // este tipo de mensagem. Se sim, aplicar aos slots ou sugerir.
    // ========================================================================
    let elitePatternApplied = false;
    
    if (payload.messageType === "text" && conteudoProcessado && 
        ["expense", "income", "recurring"].includes(decision.actionType)) {
      try {
        // 1. Verificar correções self-healing
        const { checkPreviousCorrections, applyCorrectionToSlots } = await import("./learning/corrections.ts");
        const correctionCheck = await checkPreviousCorrections(userId, conteudoProcessado);
        
        if (correctionCheck.hasSuggestion && correctionCheck.suggestion) {
          console.log(`🔄 [ELITE] Correção encontrada: ${correctionCheck.suggestion.correctedField}=${correctionCheck.suggestion.correctedValue}`);
          
          if (correctionCheck.shouldAutoApply) {
            // Aplicar correção automaticamente (cast para any para compatibilidade de tipos)
            const correctedSlots = applyCorrectionToSlots(
              decision.slots as any, 
              correctionCheck.suggestion.correctedField, 
              correctionCheck.suggestion.correctedValue
            );
            decision.slots = correctedSlots as ExtractedSlots;
            console.log(`✅ [ELITE] Correção auto-aplicada`);
          }
        }
        
        // 2. Aplicar padrões de memória (Memory Layer)
        if (decision.actionType === "expense" && decision.slots.description) {
          const { applyUserPatterns } = await import("./memory/patterns.ts");
          const patternResult = await applyUserPatterns(userId, decision.slots as any, conteudoProcessado);
          
          if (patternResult.patternApplied) {
            decision.slots = patternResult.slots as ExtractedSlots;
            elitePatternApplied = true;
            console.log(`🧠 [ELITE] Padrão de memória aplicado para: ${decision.slots.description}`);
          }
        }
      } catch (eliteErr) {
        // Elite modules não devem bloquear fluxo principal
        console.error(`⚠️ [ELITE] Erro (não-bloqueante):`, eliteErr);
      }
    }
    
    // ========================================================================
    // 🚫 GUARD CLAUSE DE DOMÍNIO + AUTO-DESCARTE
    // ========================================================================
    const domainCheck = assertDomainIsolation(decision.actionType, activeAction);
    if (domainCheck.shouldDiscard) {
      await cancelAction(userId);
    }
    
    // ========================================================================
    // 🎯 ROTEAMENTO POR TIPO DE AÇÃO
    // ========================================================================
    
    // ========================================================================
    // ✏️ EDIT - Correção rápida (dentro de 2 minutos)
    // ========================================================================
    if (decision.actionType === "edit") {
      console.log(`✏️ [EDIT] Correção detectada: ${JSON.stringify(decision.slots)}`);
      
      const lastTx = await getLastTransaction(userId, 2);
      
      if (!lastTx) {
        await sendMessage(payload.phoneNumber, "Não encontrei registro recente para corrigir 🤔\n\n_A correção funciona até 2 min após o registro_", payload.messageSource);
        return;
      }
      
      // Se o usuário já mencionou a forma de pagamento correta → corrigir direto
      if (decision.slots.new_payment_method) {
        const result = await updateTransactionPaymentMethod(lastTx.id, decision.slots.new_payment_method);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // Se não mencionou → oferecer opções
      await sendButtons(
        payload.phoneNumber,
        `📝 *Corrigir:* R$ ${lastTx.valor?.toFixed(2)} - ${lastTx.descricao || lastTx.categoria}\n\nQual a forma correta?`,
        [
          { id: "edit_pix", title: "📱 Pix" },
          { id: "edit_debito", title: "💳 Débito" },
          { id: "edit_credito", title: "💳 Crédito" }
        ],
        payload.messageSource
      );
      
      await createAction(userId, "edit", "edit", { transaction_id: lastTx.id }, "payment_method", payload.messageId);
      return;
    }
    
    // ========================================================================
    // 💰 INCOME - Contrato: required = ["amount"]
    // ========================================================================
    if (decision.actionType === "income") {
      const slots = decision.slots;
      const missing = getMissingSlots("income", slots);
      
      // ✅ TODOS OS SLOTS → EXECUTAR DIRETO (texto claro não precisa confirmação)
      if (hasAllRequiredSlots("income", slots)) {
        console.log(`💰 [INCOME] Slots completos - executando direto (sem confirmação para texto)`);
        
        const result = await registerIncome(userId, slots as any, undefined);
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO → perguntar APENAS o que falta
      const nextMissing = missing[0]; // Só pergunta UM por vez
      
      if (activeAction?.intent === "income") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "income", "income", slots, nextMissing, payload.messageId);
      }
      
      // Usar prompt específico para income
      const promptKey = nextMissing === "amount" ? "amount_income" : nextMissing;
      const prompt = SLOT_PROMPTS[promptKey] || SLOT_PROMPTS[nextMissing];
      
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, prompt?.text || `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💸 EXPENSE - Contrato: required = ["amount", "payment_method"]
    // ========================================================================
    if (decision.actionType === "expense") {
      const slots = decision.slots;
      
      // ========================================================================
      // 📅 ADICIONAR DATA RELATIVA AOS SLOTS (se detectada)
      // ========================================================================
      if (transactionDate) {
        slots.transaction_date = transactionDate.toISOString();
        console.log(`📅 [EXPENSE] Data relativa aplicada: ${transactionDate.toISOString().split('T')[0]}`);
      }
      
      const missing = getMissingSlots("expense", slots);
      
      // ✅ TODOS OS SLOTS → EXECUTAR DIRETO (texto claro não precisa confirmação)
      if (hasAllRequiredSlots("expense", slots)) {
        console.log(`💸 [EXPENSE] Slots completos - executando direto (sem confirmação para texto)`);
        
        // ========================================================================
        // 💳 VINCULAR CRÉDITO AO CARTÃO/FATURA (FSM MÓDULO 2)
        // ========================================================================
        if (slots.payment_method === "credito" || slots.payment_method === "crédito") {
          const { resolveCreditCard } = await import("./intents/credit-flow.ts");
          
          const creditResult = await resolveCreditCard(userId, slots);
          
          if (!creditResult.success) {
            // Precisa perguntar qual cartão ou não tem cartões
            if (creditResult.missingSlot === "card") {
              await createAction(userId, "expense", "expense", slots, "card", payload.messageId);
              
              if (creditResult.cardButtons) {
                await sendButtons(payload.phoneNumber, creditResult.message, creditResult.cardButtons, payload.messageSource);
              } else {
                await sendMessage(payload.phoneNumber, creditResult.message, payload.messageSource);
              }
              return;
            }
            
            await sendMessage(payload.phoneNumber, creditResult.message, payload.messageSource);
            return;
          }
          
          // Atualizar slots com cartão/fatura vinculados
          slots.card_id = creditResult.cardId;
          slots.fatura_id = creditResult.invoiceId;
          slots.card = creditResult.cardName;
          console.log(`💳 [CREDIT] Vinculado: ${creditResult.cardName}, fatura: ${creditResult.invoiceId}`);
        }
        
        // Executar diretamente
        const result = await registerExpense(userId, slots as any, undefined);
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        
        // Processar fila de mensagens pendentes
        const pendingCount = await countPendingMessages(userId);
        if (pendingCount > 0) {
          console.log(`📬 [QUEUE] ${pendingCount} mensagens pendentes`);
          await sendMessage(payload.phoneNumber, 
            `📬 Você tem ${pendingCount} gasto${pendingCount > 1 ? 's' : ''} pendente${pendingCount > 1 ? 's' : ''} que anotei!`,
            payload.messageSource
          );
        }
        return;
      }
      
      // ========================================================================
      // 📬 FILA DE MENSAGENS: Se já há ação pendente de expense, enfileirar nova
      // ========================================================================
      if (activeAction?.intent === "expense" && activeAction.pending_slot === "payment_method") {
        // Nova mensagem parece ser novo gasto
        const hasNewAmount = slots.amount && slots.amount !== activeAction.slots.amount;
        const hasNewDescription = slots.description && slots.description !== activeAction.slots.description;
        
        if (hasNewAmount || hasNewDescription) {
          console.log(`📬 [QUEUE] Enfileirando novo gasto enquanto aguarda pagamento do anterior`);
          await queueMessage(userId, conteudoProcessado, payload.messageId);
          
          await sendMessage(payload.phoneNumber, 
            `📝 Anotei! Vou registrar isso assim que terminar o gasto anterior.\n\n` +
            `💸 R$ ${activeAction.slots.amount?.toFixed(2)}\n\nComo você pagou?`,
            payload.messageSource
          );
          return;
        }
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO → perguntar APENAS o que falta
      const nextMissing = missing[0]; // Só pergunta UM por vez
      
      if (activeAction?.intent === "expense") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "expense", "expense", slots, nextMissing, payload.messageId);
      }
      
      const prompt = SLOT_PROMPTS[nextMissing];
      
      // Contexto amigável com valor se já temos
      const prefix = slots.amount ? `💸 R$ ${slots.amount.toFixed(2)}\n\n` : "";
      
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `${prefix}${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `${prefix}${prompt?.text || `Qual o ${nextMissing}?`}`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💳 CARD EVENT - Contrato: required = ["card", "value"]
    // ========================================================================
    // REGRA ABSOLUTA: card_event NUNCA entra em fluxo de expense/income
    // ========================================================================
    if (decision.actionType === "card_event") {
      const slots = decision.slots;
      
      // ✅ EXECUÇÃO DIRETA: hasAllRequiredSlots = true
      if (hasAllRequiredSlots("card_event", slots)) {
        const result = await updateCardLimit(userId, slots.card!, slots.value!);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const missing = getMissingSlots("card_event", slots);
      
      // Se falta cartão, listar opções
      if (missing.includes("card")) {
        const cards = await listCardsForUser(userId);
        if (cards.length === 0) {
          await sendMessage(payload.phoneNumber, "Você não tem cartões cadastrados 💳", payload.messageSource);
          return;
        }
        const cardList = cards.map((c, i) => `${i + 1}. ${c.nome}`).join("\n");
        await sendMessage(payload.phoneNumber, `Qual cartão atualizar?\n\n${cardList}`, payload.messageSource);
        return;
      }
      
      // Se falta valor
      if (missing.includes("value")) {
        await sendMessage(payload.phoneNumber, `Qual o novo limite do *${slots.card}*?`, payload.messageSource);
        return;
      }
      
      return;
    }
    
    // ========================================================================
    // 💳 ADD_CARD - Registrar NOVO cartão de crédito
    // ========================================================================
    if (decision.actionType === "add_card") {
      const slots = decision.slots;
      const { createCard } = await import("./intents/card.ts");
      
      // Normalizar slots (IA pode enviar de várias formas) - usar Record para flexibilidade
      const normalizedSlots: Record<string, any> = {
        ...slots,
        card_name: slots.card_name || slots.card || slots.description,
        limit: slots.limit || slots.amount || slots.value,
        due_day: slots.due_day || slots.day_of_month,
      };
      
      const result = await createCard(userId, normalizedSlots as any);
      
      // Se criou com sucesso ou erro definitivo
      if (result.success || !result.missingSlot) {
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // Se faltou slot, criar action para coletar
      if (result.missingSlot) {
        if (activeAction?.intent === "add_card") {
          await updateAction(activeAction.id, { slots: normalizedSlots, pending_slot: result.missingSlot });
        } else {
          await createAction(userId, "add_card", "add_card", normalizedSlots, result.missingSlot, payload.messageId);
        }
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 📄 BILL - Criar fatura/conta a pagar
    // ========================================================================
    if (decision.actionType === "bill") {
      const slots = decision.slots;
      const { createBill } = await import("./intents/bills.ts");
      
      const billName = slots.bill_name || slots.description;
      const dueDay = slots.due_day || slots.day_of_month;
      const estimatedValue = slots.estimated_value || slots.amount;
      
      if (!billName) {
        await sendMessage(payload.phoneNumber, "Qual o nome da conta? (ex: Energia, Internet, Água...)", payload.messageSource);
        await createAction(userId, "bill", "bill", slots, "bill_name", payload.messageId);
        return;
      }
      
      if (!dueDay) {
        await sendMessage(payload.phoneNumber, `Em qual dia do mês vence a conta de *${billName}*? (1-31)`, payload.messageSource);
        await createAction(userId, "bill", "bill", { ...slots, bill_name: billName }, "due_day", payload.messageId);
        return;
      }
      
      const result = await createBill({
        userId,
        nome: billName,
        diaVencimento: Number(dueDay),
        valorEstimado: estimatedValue ? Number(estimatedValue) : undefined,
        tipo: "fixa",
      });
      
      await sendMessage(payload.phoneNumber, result, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 💸 PAY_BILL - Pagar fatura existente
    // ========================================================================
    if (decision.actionType === "pay_bill") {
      const slots = decision.slots;
      const { payBill } = await import("./intents/bills.ts");
      
      const billName = slots.bill_name || slots.description;
      const amount = slots.amount;
      
      if (!billName) {
        await sendMessage(payload.phoneNumber, "Qual conta você pagou? (ex: Energia, Água, Internet...)", payload.messageSource);
        return;
      }
      
      if (!amount) {
        await sendMessage(payload.phoneNumber, `Quanto foi a conta de *${billName}*? 💸`, payload.messageSource);
        await createAction(userId, "pay_bill", "pay_bill", { ...slots, bill_name: billName }, "amount", payload.messageId);
        return;
      }
      
      const result = await payBill({
        userId,
        contaNome: billName,
        valorPago: Number(amount),
      });
      
      await sendMessage(payload.phoneNumber, result, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🔄 RECURRING - Gastos Recorrentes
    // ========================================================================
    if (decision.actionType === "recurring") {
      const slots = decision.slots;
      const missing = getMissingSlots("recurring", slots);
      
      // ✅ EXECUÇÃO DIRETA: tem amount e description
      if (hasAllRequiredSlots("recurring", slots)) {
        console.log(`🔄 [RECURRING] Execução direta: R$ ${slots.amount} - ${slots.description}`);
        const actionId = activeAction?.intent === "recurring" ? activeAction.id : undefined;
        const result = await registerRecurring(userId, slots, actionId);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const nextMissing = missing[0];
      
      if (activeAction?.intent === "recurring") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "recurring", "recurring", slots, nextMissing, payload.messageId);
      }
      
      // Perguntas específicas para recorrente
      if (nextMissing === "amount") {
        await sendMessage(payload.phoneNumber, "Qual o valor mensal? 💸", payload.messageSource);
      } else if (nextMissing === "description") {
        await sendMessage(payload.phoneNumber, "Qual gasto é esse? (ex: Netflix, Aluguel, Academia...)", payload.messageSource);
      } else if (nextMissing === "payment_method") {
        await sendButtons(payload.phoneNumber, 
          `🔄 ${slots.description || "Recorrente"} - R$ ${slots.amount?.toFixed(2)}/mês\n\nComo você paga?`, 
          [
            { id: "rec_pay_pix", title: "📱 Pix" },
            { id: "rec_pay_debito", title: "💳 Débito" },
            { id: "rec_pay_credito", title: "💳 Crédito" }
          ], 
          payload.messageSource
        );
      } else {
        await sendMessage(payload.phoneNumber, `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 📦 INSTALLMENT - Parcelamento no Crédito (NOVO!)
    // ========================================================================
    if (decision.actionType === "installment") {
      const slots = decision.slots;
      console.log(`📦 [INSTALLMENT] Processando: ${JSON.stringify(slots)}`);
      
      const { registerInstallment, getMissingInstallmentSlots, hasAllRequiredInstallmentSlots } = 
        await import("./intents/installment.ts");
      
      // ✅ TODOS OS SLOTS → PEDIR CONFIRMAÇÃO
      if (hasAllRequiredInstallmentSlots(slots as any)) {
        console.log(`🔒 [INSTALLMENT] Slots completos - solicitando confirmação`);
        
        const { requireConfirmation } = await import("./fsm/confirmation-gate.ts");
        const { generateConfirmationMessage } = await import("./fsm/context-handler.ts");
        
        const gateResult = await requireConfirmation(
          userId,
          "installment",
          slots as any,
          activeAction as any,
          payload.messageId
        );
        
        if (gateResult.canExecute) {
          // Já confirmado anteriormente → executar
          const result = await registerInstallment(userId, slots as any, gateResult.actionId);
          await supabase.from("actions")
            .update({ status: "done" })
            .eq("user_id", userId)
            .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        // Precisa confirmar → enviar mensagem de confirmação
        // Mensagem customizada para parcelamento
        const valorParcela = (slots.amount || 0) / (slots.installments || 1);
        const confirmMsg = `*Confirmar parcelamento:*\n\n` +
          `📦 ${slots.description || "Compra"}\n` +
          `💰 R$ ${(slots.amount || 0).toFixed(2)} em *${slots.installments}x* de R$ ${valorParcela.toFixed(2)}\n` +
          (slots.card ? `💳 ${slots.card}\n` : "") +
          `\n✅ *Tudo certo?*`;
        
        await sendMessage(payload.phoneNumber, confirmMsg, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const missingSlots = getMissingInstallmentSlots(slots as any);
      const nextMissing = missingSlots[0];
      
      if (activeAction?.intent === "installment") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "installment", "installment", slots, nextMissing, payload.messageId);
      }
      
      // Perguntas específicas
      if (nextMissing === "amount") {
        await sendMessage(payload.phoneNumber, "Qual o valor total da compra? 💰", payload.messageSource);
      } else if (nextMissing === "installments") {
        const prefix = slots.amount ? `💰 R$ ${slots.amount.toFixed(2)}\n\n` : "";
        await sendMessage(payload.phoneNumber, `${prefix}Em quantas vezes? (ex: 3x, 12x)`, payload.messageSource);
      } else if (nextMissing === "description") {
        await sendMessage(payload.phoneNumber, "O que você comprou?", payload.messageSource);
      } else if (nextMissing === "card") {
        const { listUserCards } = await import("./intents/credit-flow.ts");
        const cards = await listUserCards(userId);
        
        if (cards.length === 0) {
          await sendMessage(payload.phoneNumber, 
            "Você não tem cartões cadastrados 💳\n\nAdicione um: *Adicionar cartão Nubank limite 5000*", 
            payload.messageSource
          );
        } else {
          const cardButtons = cards.slice(0, 3).map(c => ({ 
            id: `card_${c.id}`, 
            title: (c.nome || "Cartão").slice(0, 20) 
          }));
          await sendButtons(payload.phoneNumber, 
            "💳 Qual cartão?", 
            cardButtons, 
            payload.messageSource
          );
        }
      } else {
        await sendMessage(payload.phoneNumber, `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 🎯 GOAL - Metas de Poupança (savings_goals)
    // ========================================================================
    if (decision.actionType === "goal") {
      const slots = decision.slots;
      console.log(`🎯 [GOAL] Processando meta: ${JSON.stringify(slots)}`);
      
      // Importar funções de goals
      const { createGoal, listGoals, addToGoal } = await import("./intents/goals.ts");
      
      const normalized = normalizeText(conteudoProcessado);
      
      // Listar metas
      if (normalized.includes("minhas metas") || normalized.includes("ver metas") || 
          (normalized.includes("meta") && !slots.amount)) {
        const result = await listGoals(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Adicionar à meta existente
      if (normalized.includes("adiciona") || normalized.includes("guardar") || normalized.includes("deposita")) {
        if (slots.amount && slots.description) {
          const result = await addToGoal(userId, slots.description, slots.amount);
          await sendMessage(payload.phoneNumber, result, payload.messageSource);
          return;
        }
      }
      
      // Criar nova meta
      if (slots.amount && slots.description) {
        const result = await createGoal({
          userId,
          name: slots.description,
          targetAmount: slots.amount,
          deadline: slots.deadline ? new Date(slots.deadline) : undefined,
          category: slots.category
        });
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Falta informação
      if (!slots.amount) {
        await sendMessage(payload.phoneNumber, "🎯 Qual o valor da meta?", payload.messageSource);
        return;
      }
      if (!slots.description) {
        await sendMessage(payload.phoneNumber, "🎯 Qual o nome da meta? (ex: Viagem, Carro, Emergência...)", payload.messageSource);
        return;
      }
      
      return;
    }
    
    // ========================================================================
    // 🛒 PURCHASE - Consultor de Compras
    // ========================================================================
    if (decision.actionType === "purchase") {
      const slots = decision.slots;
      console.log(`🛒 [PURCHASE] Analisando compra: ${JSON.stringify(slots)}`);
      
      const { analyzePurchase } = await import("./intents/purchase.ts");
      const result = await analyzePurchase({
        userId,
        itemDescription: slots.description || "item",
        itemValue: slots.amount || 0,
        category: slots.category
      });
      await sendMessage(payload.phoneNumber, result, payload.messageSource);
      return;
    }
    
    // ========================================================================
    if (decision.actionType === "set_context") {
      const slots = decision.slots;
      
      // Verificar se é encerramento de contexto
      const normalized = normalizeText(conteudoProcessado);
      if (normalized.includes("terminei") || normalized.includes("fim do") || normalized.includes("acabou") || normalized.includes("encerr")) {
        const result = await closeUserContext(userId);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // Criar novo contexto
      const result = await createUserContext(userId, slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // 🗑️ CANCEL - BUSCA INTELIGENTE DE RECORRENTES + HANDLER DE SELEÇÃO
    if (decision.actionType === "cancel") {
      const normalized = normalizeText(conteudoProcessado);
      
      // ========================================================================
      // 🔢 HANDLER DE SELEÇÃO NUMÉRICA (veio do decision engine)
      // ========================================================================
      if (decision.slots.selected_id && decision.slots.selection_intent) {
        const selectedId = decision.slots.selected_id as string;
        const selectionIntent = decision.slots.selection_intent as string;
        
        console.log(`🔢 [CANCEL] Processando seleção: intent=${selectionIntent}, id=${selectedId}`);
        
        // Fechar action de seleção
        if (activeAction) {
          await closeAction(activeAction.id);
        }
        
        // Executar baseado no intent
        if (selectionIntent === "cancel_recurring") {
          const result = await cancelRecurring(userId, selectedId);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        if (selectionIntent === "cancel" || selectionIntent === "cancel_transaction") {
          const result = await cancelTransaction(userId, selectedId);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        // Fallback para outros tipos
        await sendMessage(payload.phoneNumber, "Ação processada! ✅", payload.messageSource);
        return;
      }
      
      // ========================================================================
      // 🔢 HANDLER DE SELEÇÃO INVÁLIDA
      // ========================================================================
      if (decision.slots.error === "invalid_selection") {
        await sendMessage(payload.phoneNumber, decision.slots.message as string || "Escolha inválida 🤔", payload.messageSource);
        return;
      }
      
      // Detectar se é cancelamento de recorrente
      const isRecurringCancel = normalized.includes("cancela") && 
        (normalized.includes("assinatura") || normalized.includes("recorrente") ||
         normalized.includes("netflix") || normalized.includes("spotify") ||
         normalized.includes("aluguel") || normalized.includes("academia") ||
         normalized.includes("mensal") || normalized.includes("todo mes") ||
         normalized.includes("para de cobrar") || normalized.includes("parar"));
      
      // Extrair termo de busca
      const cancelPatterns = [
        /cancela(?:r)?\s+(?:a|o|meu|minha)?\s*(.+)/i,
        /para(?:r)?\s+(?:de\s+)?(?:cobrar|pagar)\s+(?:a|o)?\s*(.+)/i,
      ];
      
      let searchTerm = "";
      for (const pattern of cancelPatterns) {
        const matchResult = conteudoProcessado.match(pattern);
        if (matchResult && matchResult[1]) {
          searchTerm = matchResult[1].trim().split(" ")[0]; // Primeira palavra
          break;
        }
      }
      
      // Se parece cancelamento de recorrente OU tem termo de busca
      if (isRecurringCancel || searchTerm) {
        let recorrentes: any[] = [];
        
        if (searchTerm) {
          recorrentes = await findRecurringByName(userId, searchTerm);
        }
        
        if (recorrentes.length === 0) {
          recorrentes = await listActiveRecurrings(userId);
        }
        
        if (recorrentes.length === 0) {
          // Fallback: tentar transações
          const txs = await listTransactionsForCancel(userId);
          if (txs.length === 0) {
            await sendMessage(payload.phoneNumber, "Você não tem gastos recorrentes nem transações recentes para cancelar 🤔", payload.messageSource);
            return;
          }
          const lista = txs.map((t, i) => `${i + 1}. R$ ${t.valor?.toFixed(2)} - ${t.descricao || t.categoria}`).join("\n");
          await createAction(userId, "cancel_transaction", "cancel", 
            { options: txs.map(t => t.id) }, "selection", payload.messageId);
          await sendMessage(payload.phoneNumber, `Qual transação cancelar?\n\n${lista}\n\n_Responde com o número_`, payload.messageSource);
          return;
        }
        
        if (recorrentes.length === 1) {
          // Match único → cancelar direto
          const result = await cancelRecurring(userId, recorrentes[0].id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        // Múltiplos matches → pedir confirmação
        const lista = recorrentes.map((r, i) => 
          `${i + 1}. ${r.descricao} - R$ ${r.valor_parcela?.toFixed(2)}/mês`
        ).join("\n");
        
        await sendMessage(payload.phoneNumber, 
          `Encontrei ${recorrentes.length} recorrentes:\n\n${lista}\n\n_Qual você quer cancelar? Responde com o número._`, 
          payload.messageSource
        );
        
        // Salvar seleção pendente
        await createAction(userId, "cancel_recurring", "cancel_recurring", 
          { options: recorrentes.map(r => r.id) }, "selection", payload.messageId);
        return;
      }
      
      // Fallback: listar transações para cancelar
      const txs = await listTransactionsForCancel(userId);
      
      if (txs.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem transações para cancelar 🤔", payload.messageSource);
        return;
      }
      
      const lista = txs.map((t, i) => `${i + 1}. R$ ${t.valor?.toFixed(2)} - ${t.descricao || t.categoria}`).join("\n");
      await createAction(userId, "cancel_transaction", "cancel", 
        { options: txs.map(t => t.id) }, "selection", payload.messageId);
      await sendMessage(payload.phoneNumber, `Qual transação cancelar?\n\n${lista}\n\n_Responde com o número_`, payload.messageSource);
      return;
    }
    
    // 📊 QUERY - COM QUERIES ANALÍTICAS (v3.2: ROTEAMENTO POR SCOPE)
    if (decision.actionType === "query") {
      const normalized = normalizeText(conteudoProcessado);
      
      // ========================================================================
      // v3.2: ROTEAMENTO PRIORITÁRIO POR query_scope DA IA
      // ========================================================================
      const queryScope = decision.slots.query_scope || detectQueryScope(normalized);
      const timeRange = decision.slots.time_range || detectTimeRange(normalized);
      
      console.log(`📊 [QUERY] Scope: ${queryScope}, TimeRange: ${timeRange}`);
      
      // Importar funções de query
      const { getWeeklyExpenses, getTodayExpenses, listPendingExpenses, getExpensesByCategory, getMonthlySummary } = await import("./intents/query.ts");
      
      switch (queryScope) {
        case "cards":
          console.log(`📊 [QUERY] Roteando para: CARDS`);
          const cardsResult = await queryCardLimits(userId);
          await sendMessage(payload.phoneNumber, cardsResult, payload.messageSource);
          return;
        
        case "pending":
          console.log(`📊 [QUERY] Roteando para: PENDING`);
          const pendingResult = await listPendingExpenses(userId);
          await sendMessage(payload.phoneNumber, pendingResult, payload.messageSource);
          return;
        
        case "expenses":
          if (timeRange === "week") {
            console.log(`📊 [QUERY] Roteando para: EXPENSES WEEK`);
            const weekResult = await getWeeklyExpenses(userId);
            await sendMessage(payload.phoneNumber, weekResult, payload.messageSource);
            return;
          }
          if (timeRange === "today") {
            console.log(`📊 [QUERY] Roteando para: EXPENSES TODAY`);
            const todayResult = await getTodayExpenses(userId);
            await sendMessage(payload.phoneNumber, todayResult, payload.messageSource);
            return;
          }
          // Default: continua para checar categorias ou resumo
          break;
        
        case "income":
          console.log(`📊 [QUERY] Roteando para: INCOME`);
          const inicioMes = new Date();
          inicioMes.setDate(1);
          inicioMes.setHours(0, 0, 0, 0);
          
          const { data: entradas } = await supabase
            .from("transacoes")
            .select("valor, descricao, data, forma_pagamento")
            .eq("usuario_id", userId)
            .eq("tipo", "entrada")
            .gte("data", inicioMes.toISOString())
            .eq("status", "confirmada")
            .order("data", { ascending: false });
          
          if (!entradas || entradas.length === 0) {
            await sendMessage(payload.phoneNumber, "💰 Nenhuma entrada registrada este mês.\n\n_Manda \"recebi 1500\" pra registrar!_", payload.messageSource);
            return;
          }
          
          const totalEntradas = entradas.reduce((sum: number, e: any) => sum + Number(e.valor), 0);
          const listaEntradas = entradas.slice(0, 10).map((e: any) => {
            const dataStr = new Date(e.data).toLocaleDateString("pt-BR");
            return `💰 R$ ${Number(e.valor).toFixed(2)} - ${e.descricao || "Entrada"} (${dataStr})`;
          }).join("\n");
          
          await sendMessage(payload.phoneNumber, 
            `💰 *Entradas do Mês*\n\n${listaEntradas}\n\n✅ *Total: R$ ${totalEntradas.toFixed(2)}*`,
            payload.messageSource
          );
          return;
        
        case "category":
          console.log(`📊 [QUERY] Roteando para: CATEGORY`);
          const catResult = await getExpensesByCategory(userId);
          await sendMessage(payload.phoneNumber, catResult, payload.messageSource);
          return;
        
        case "recurring":
          console.log(`📊 [QUERY] Roteando para: RECURRING`);
          const recorrentes = await listActiveRecurrings(userId);
          if (recorrentes.length === 0) {
            await sendMessage(payload.phoneNumber, "Você não tem gastos recorrentes ativos 📋", payload.messageSource);
            return;
          }
          const listaRec = recorrentes.map((r: any) => 
            `🔄 ${r.descricao} - R$ ${Number(r.valor_parcela).toFixed(2)}/mês`
          ).join("\n");
          await sendMessage(payload.phoneNumber, `🔄 *Seus Recorrentes*\n\n${listaRec}`, payload.messageSource);
          return;
        
        case "summary":
        default:
          // Continua para fallback checks
          break;
      }
      
      // ========================================================================
      // FALLBACK: Detecção por keywords (para compatibilidade)
      // ========================================================================
      
      // Query de ENTRADAS
      if (normalized.includes("recebi") || normalized.includes("entrada") || 
          normalized.includes("entrou") || normalized.includes("renda") ||
          normalized.includes("quanto ganhei") || normalized.includes("minhas entradas")) {
        console.log(`📊 [QUERY] Query de ENTRADAS detectada (fallback)`);
        
        const inicioMes2 = new Date();
        inicioMes2.setDate(1);
        inicioMes2.setHours(0, 0, 0, 0);
        
        const { data: entradas2 } = await supabase
          .from("transacoes")
          .select("valor, descricao, data, forma_pagamento")
          .eq("usuario_id", userId)
          .eq("tipo", "entrada")
          .gte("data", inicioMes2.toISOString())
          .eq("status", "confirmada")
          .order("data", { ascending: false });
        
        if (!entradas2 || entradas2.length === 0) {
          await sendMessage(payload.phoneNumber, "💰 Nenhuma entrada registrada este mês.\n\n_Manda \"recebi 1500\" pra registrar!_", payload.messageSource);
          return;
        }
        
        const total2 = entradas2.reduce((sum: number, e: any) => sum + Number(e.valor), 0);
        const lista2 = entradas2.slice(0, 10).map((e: any) => {
          const dataStr = new Date(e.data).toLocaleDateString("pt-BR");
          return `💰 R$ ${Number(e.valor).toFixed(2)} - ${e.descricao || "Entrada"} (${dataStr})`;
        }).join("\n");
        
        await sendMessage(payload.phoneNumber, 
          `💰 *Entradas do Mês*\n\n${lista2}\n\n✅ *Total: R$ ${total2.toFixed(2)}*`,
          payload.messageSource
        );
        return;
      }
      
      // Query por CARTÃO específico
      const cardMatch = normalized.match(/(?:gastei|quanto)\s+(?:no|na|do|da)\s+(\w+)/);
      if (cardMatch && cardMatch[1]) {
        const cardName = cardMatch[1];
        console.log(`📊 [QUERY] Query de gastos no cartão: "${cardName}"`);
        
        const { data: card } = await supabase
          .from("cartoes_credito")
          .select("id, nome, limite_disponivel, limite_total")
          .eq("usuario_id", userId)
          .ilike("nome", `%${cardName}%`)
          .limit(1)
          .maybeSingle();
        
        if (card) {
          const inicioMes3 = new Date();
          inicioMes3.setDate(1);
          inicioMes3.setHours(0, 0, 0, 0);
          
          const { data: gastos } = await supabase
            .from("transacoes")
            .select("valor, descricao, data")
            .eq("usuario_id", userId)
            .eq("cartao_id", card.id)
            .eq("tipo", "saida")
            .gte("data", inicioMes3.toISOString())
            .eq("status", "confirmada")
            .order("data", { ascending: false });
          
          if (!gastos || gastos.length === 0) {
            await sendMessage(payload.phoneNumber, 
              `💳 *${card.nome}*\n\nNenhum gasto este mês.\n\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
              payload.messageSource
            );
            return;
          }
          
          const totalCard = gastos.reduce((sum: number, g: any) => sum + Number(g.valor), 0);
          const listaCard = gastos.slice(0, 8).map((g: any) => {
            const dataStr = new Date(g.data).toLocaleDateString("pt-BR");
            return `💸 R$ ${Number(g.valor).toFixed(2)} - ${g.descricao || "Gasto"} (${dataStr})`;
          }).join("\n");
          
          await sendMessage(payload.phoneNumber, 
            `💳 *Gastos no ${card.nome}*\n\n${listaCard}\n\n💸 Total: R$ ${totalCard.toFixed(2)}\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
            payload.messageSource
          );
          return;
        }
      }
      
      // Gastos por CATEGORIA
      if (normalized.includes("categoria") || normalized.includes("categorias") ||
          (normalized.includes("gasto") && normalized.includes("por")) ||
          normalized.includes("breakdown") || normalized.includes("detalha")) {
        console.log(`📊 [QUERY] Gastos por categoria detectado (fallback)`);
        const { getExpensesByCategory: getCat } = await import("./intents/query.ts");
        const result = await getCat(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Perguntas sobre cartão/limite
      if ((normalized.includes("limite") && (normalized.includes("disponivel") || normalized.includes("cartao") || normalized.includes("cartoes"))) ||
          (normalized.includes("quanto") && normalized.includes("limite"))) {
        const result = await queryCardLimits(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Perguntas sobre gastos por cartão
      if ((normalized.includes("gastei") || normalized.includes("gasto")) && 
          (normalized.includes("cartao") || normalized.includes("credito") || normalized.includes("cada cartao"))) {
        const result = await queryExpensesByCard(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Query de viagem/contexto
      if (normalized.includes("viagem") && (normalized.includes("quanto") || normalized.includes("gastei"))) {
        const activeContext = await getActiveContext(userId);
        if (activeContext) {
          const { total, count } = await queryContextExpenses(userId, activeContext.id);
          await sendMessage(payload.phoneNumber, 
            `📍 *Gastos na ${activeContext.label}*\n\n💸 Total: R$ ${total.toFixed(2)}\n🧾 ${count} transações`,
            payload.messageSource
          );
          return;
        } else {
          await sendMessage(payload.phoneNumber, "Você não tem nenhuma viagem ativa no momento 🤔\n\nPra começar uma viagem, manda: \"Viagem pra SP de 09/01 a 15/01\"", payload.messageSource);
          return;
        }
      }
      
      // Fallback: resumo mensal
      const summary = await getMonthlySummary(userId);
      await sendMessage(payload.phoneNumber, summary, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🚨 QUERY_ALERTS - Alertas Proativos (ELITE)
    // ========================================================================
    if (decision.actionType === "query_alerts") {
      console.log(`🚨 [ALERTS] Buscando alertas para usuário: ${userId}`);
      
      const { data: alerts } = await supabase
        .from("spending_alerts")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["detected", "eligible"])
        .is("sent_at", null)
        .order("utility_score", { ascending: false })
        .limit(5);
      
      if (!alerts || alerts.length === 0) {
        await sendMessage(payload.phoneNumber, "✨ *Tudo tranquilo!*\n\nNão há nada fora do normal nos seus gastos. Continue assim! 💪", payload.messageSource);
        return;
      }
      
      // Marcar como enviados
      const alertIds = alerts.map((a: any) => a.id);
      await supabase
        .from("spending_alerts")
        .update({ 
          sent_at: new Date().toISOString(), 
          status: "sent" 
        })
        .in("id", alertIds);
      
      // Formatar resposta
      const severityEmoji: Record<string, string> = {
        critical: "🚨",
        warning: "⚠️",
        info: "💡"
      };
      
      let response = `📊 *Seus Alertas* (${alerts.length})\n\n`;
      
      for (const alert of alerts) {
        const emoji = severityEmoji[alert.severity] || "💡";
        response += `${emoji} ${alert.message}\n\n`;
      }
      
      response += `_Responda "descartar alertas" para limpar._`;
      
      await sendMessage(payload.phoneNumber, response, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🛡️ GUARD: SE HÁ EXPENSE/INCOME ATIVO, NUNCA ENTRAR EM CHAT
    // ========================================================================
    // Este guard protege contra a IA classificar erroneamente como "chat"
    // quando o usuário está no meio de um fluxo de registro.
    // ========================================================================
    if ((decision.actionType === "chat" || decision.actionType === "unknown") &&
        activeAction !== null && 
        (activeAction.intent === "expense" || activeAction.intent === "income") &&
        activeAction.pending_slot) {
      console.log(`🛡️ [GUARD] Bloqueando chat - action ativa: ${activeAction.intent} aguardando ${activeAction.pending_slot}`);
      
      // Tentar extrair o slot pendente da mensagem atual
      const pendingSlot: string = activeAction.pending_slot;
      let slotValue: any = null;
      
      if (pendingSlot === "payment_method") {
        const normalizedGuard = normalizeText(conteudoProcessado);
        if (normalizedGuard.includes("pix")) slotValue = "pix";
        else if (normalizedGuard.includes("debito") || normalizedGuard.includes("débito")) slotValue = "debito";
        else if (normalizedGuard.includes("credito") || normalizedGuard.includes("crédito")) slotValue = "credito";
        else if (normalizedGuard.includes("dinheiro")) slotValue = "dinheiro";
      } else if (pendingSlot === "amount") {
        const numMatch = conteudoProcessado.match(/(\d+[.,]?\d*)/);
        if (numMatch && numMatch[1]) slotValue = parseFloat(numMatch[1].replace(",", "."));
      } else if (pendingSlot === "description") {
        slotValue = conteudoProcessado.trim();
      }
      
      if (slotValue !== null) {
        // Preencher o slot e continuar o fluxo
        const updatedSlots: Record<string, any> = { ...activeAction.slots, [pendingSlot]: slotValue };
        const actionType = activeAction.intent as ActionType;
        const missing = getMissingSlots(actionType, updatedSlots);
        
        if (hasAllRequiredSlots(actionType, updatedSlots)) {
          // Executar!
          const result = actionType === "income" 
            ? await registerIncome(userId, updatedSlots, activeAction.id)
            : await registerExpense(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        // Ainda falta slot → perguntar próximo
        await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
        const nextSlotKey = missing[0];
        const prompt = SLOT_PROMPTS[nextSlotKey];
        if (prompt?.useButtons && prompt.buttons) {
          await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, prompt?.text || `Qual o ${nextSlotKey}?`, payload.messageSource);
        }
        return;
      }
      
      // Não conseguiu extrair → re-perguntar
      const promptKey = pendingSlot;
      const prompt = SLOT_PROMPTS[promptKey];
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `Hmm, não entendi 🤔\n\n${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `Hmm, não entendi 🤔\n\n${prompt?.text || "Continue..."}`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 🛡️ CHAT GUARD - ÚLTIMA LINHA DE DEFESA CONTRA ALUCINAÇÃO
    // ========================================================================
    // Chat só entra se houver INTENÇÃO EXPLÍCITA de conversa.
    // Mensagens curtas/ambíguas NUNCA devem entrar em chat.
    // THRESHOLD elevado para chat: precisa 0.85+ de confiança da IA
    // ========================================================================
    function isExplicitChatIntent(text: string): boolean {
      const t = text.toLowerCase().trim();
      const normalizedT = normalizeText(text);
      const words = t.split(/\s+/);
      
      // Regra 0: Se é token de ACK, NUNCA é chat (já tratado antes, mas double-check)
      const ackTokensLocal = ["obrigado", "obrigada", "valeu", "ok", "blz", "beleza", "entendi", "certo"];
      if (words.length <= 2 && ackTokensLocal.some(tok => normalizedT.includes(tok))) {
        return false;
      }
      
      // Regra 1: Mensagem tem "?" → é pergunta explícita
      if (t.includes("?")) return true;
      
      // Regra 2: Mais de 6 palavras → frase completa (provavelmente contexto)
      if (words.length > 6) return true;
      
      // Regra 3: Contém verbo de consulta/opinião/conselho
      const chatVerbs = [
        "como", "onde", "por que", "porque", "o que", "qual",
        "me ajuda", "me diga", "acho", "devo", "vale a pena",
        "dica", "opinião", "melhorar", "economizar", "gastando",
        "posso", "consigo", "tenho", "tô", "estou", "será"
      ];
      
      return chatVerbs.some(v => t.includes(v));
    }
    
    // Threshold elevado para chat: precisa de alta confiança
    const CHAT_CONFIDENCE_THRESHOLD = 0.85;

    // ========================================================================
    // 💬 CHAT - Consultor Financeiro Conversacional
    // ========================================================================
    if (decision.actionType === "chat") {
      // 🛡️ CHAT GUARD: Verificar se realmente é intenção de chat
      // Dupla verificação: confiança alta E intenção explícita
      const hasExplicitIntent = isExplicitChatIntent(conteudoProcessado);
      const hasHighConfidence = decision.confidence >= CHAT_CONFIDENCE_THRESHOLD;
      
      if (!hasExplicitIntent && !hasHighConfidence) {
        console.log(`🛑 [CHAT_GUARD] Chat bloqueado → mensagem ambígua: "${conteudoProcessado}" (conf: ${decision.confidence.toFixed(2)})`);
        
        // Tratar como palavra solta → pedir clarificação
        await sendButtons(payload.phoneNumber, 
          `"${conteudoProcessado}"\n\nVocê quer registrar um gasto ou consultar algo?`, 
          [
            { id: "word_gasto", title: "💸 Registrar gasto" },
            { id: "word_consulta", title: "📊 Consultar" }
          ], 
          payload.messageSource
        );
        
        await createAction(userId, "clarify", "clarify_word", 
          { possible_description: conteudoProcessado }, 
          "clarify_type", 
          payload.messageId
        );
        return;
      }
      
      console.log(`💬 [CHAT] Permitido → explícito: ${hasExplicitIntent}, confiança: ${decision.confidence.toFixed(2)}`);
      console.log(`💬 [CHAT] Ativando modo consultor para: "${conteudoProcessado.slice(0, 50)}..."`);
      
      // Buscar contexto financeiro do usuário
      const summary = await getMonthlySummary(userId);
      const activeCtx = await getActiveContext(userId);
      
      // Chamar IA com contexto para resposta conversacional
      const chatResponse = await generateChatResponse(
        conteudoProcessado, 
        summary,
        activeCtx?.label || null,
        nomeUsuario
      );
      
      await sendMessage(payload.phoneNumber, chatResponse, payload.messageSource);
      
      // Salvar no histórico
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: chatResponse,
        tipo: "chat"
      });
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
        await sendMessage(payload.phoneNumber, `*Como usar o Finax* 📊\n\n💸 *Registrar gasto:*\n"Gastei 50 no mercado"\n\n💰 *Registrar entrada:*\n"Recebi 200 de pix"\n\n📊 *Ver resumo:*\n"Quanto gastei?"\n\n📄 *Contas a pagar:*\n"Criar fatura energia dia 15"\n"Paguei energia, deu 180"`, payload.messageSource);
        return;
      }
      
      // Saudação inteligente com variação
      try {
        const { gerarSaudacao } = await import("./greetings/smart-greeting.ts");
        const saudacao = await gerarSaudacao(userId);
        await sendMessage(payload.phoneNumber, saudacao, payload.messageSource);
      } catch (err) {
        // Fallback para saudação simples
        const primeiroNome = nomeUsuario.split(" ")[0];
        await sendMessage(payload.phoneNumber, `Oi, ${primeiroNome}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 🔢 FALLBACK: NÚMERO ISOLADO (só chega aqui se Decision Engine disse "unknown")
    // ========================================================================
    // Este é o "fundo do poço" da lógica. SÓ pergunta "gasto ou entrada?"
    // quando a IA NÃO conseguiu classificar a intenção.
    // ========================================================================
    if (decision.actionType === "unknown" && payload.messageType === 'text' && isNumericOnly(conteudoProcessado)) {
      const numValue = parseNumericValue(conteudoProcessado);
      
      logDecision({ messageId: payload.messageId, decision: "numeric_fallback", details: { value: numValue } });
      
      // CASO 1: Há contexto ativo esperando amount → preencher slot
      if (activeAction !== null && activeAction.pending_slot === "amount" && numValue !== null) {
        const updatedSlots: Record<string, any> = { ...activeAction.slots, amount: numValue };
        const actionType = activeAction.intent === "income" ? "income" : activeAction.intent === "expense" ? "expense" : null;
        
        if (actionType) {
          const missing = getMissingSlots(actionType as ActionType, updatedSlots);
          
          // Todos slots preenchidos → executar
          if (hasAllRequiredSlots(actionType as ActionType, updatedSlots)) {
            const result = actionType === "income" 
              ? await registerIncome(userId, updatedSlots, activeAction.id)
              : await registerExpense(userId, updatedSlots, activeAction.id);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
            return;
          }
          
          // Falta slot → perguntar APENAS o próximo obrigatório
          const nextSlotKey = missing[0];
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: nextSlotKey });
          const prompt = SLOT_PROMPTS[nextSlotKey];
          if (prompt?.useButtons && prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
          }
          return;
        }
      }
      
      // CASO 2: Número SEM contexto → PERGUNTAR
      await sendButtons(payload.phoneNumber, `💰 R$ ${numValue?.toFixed(2)}\n\nEsse valor foi um gasto ou uma entrada?`, [
        { id: "num_gasto", title: "💸 Gasto" },
        { id: "num_entrada", title: "💰 Entrada" }
      ], payload.messageSource);
      
      if (activeAction) {
        await cancelAction(userId);
      }
      
      await createAction(userId, "unknown", "numero_isolado", { amount: numValue }, "type_choice", payload.messageId);
      return;
    }
    
    // ========================================================================
    // 🔤 FALLBACK: PALAVRA SOLTA (possível descrição)
    // ========================================================================
    // Se o classificador detectou uma palavra solta, perguntar clarificação
    // ========================================================================
    if (decision.actionType === "unknown" && decision.slots.possible_description) {
      const possibleDesc = decision.slots.possible_description;
      console.log(`🔤 [WORD] Palavra solta detectada: "${possibleDesc}" → perguntando clarificação`);
      
      await sendButtons(payload.phoneNumber, 
        `"${possibleDesc}"\n\nVocê quer registrar um gasto ou consultar algo?`, 
        [
          { id: "word_gasto", title: "💸 Registrar gasto" },
          { id: "word_consulta", title: "📊 Consultar" }
        ], 
        payload.messageSource
      );
      
      // Salvar contexto para continuar o fluxo
      await createAction(userId, "clarify", "clarify_word", 
        { possible_description: possibleDesc }, 
        "clarify_type", 
        payload.messageId
      );
      return;
    }
    
    // ❓ UNKNOWN / FALLBACK → TENTAR CHAT (nunca travar!)
    if (activeAction !== null && activeAction.pending_slot) {
      // Re-perguntar o slot pendente
      const slotKey = activeAction.pending_slot;
      const prompt = SLOT_PROMPTS[slotKey];
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `Hmm, não entendi bem 🤔\n\n${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `Hmm, não entendi bem 🤔\n\n${prompt?.text || "Continue..."}`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💡 FALLBACK INTELIGENTE: Se parece pergunta → responder como chat
    // ========================================================================
    const normalizedFallback = normalizeText(conteudoProcessado);
    const parecePerguntar = conteudoProcessado.includes("?") || 
                            normalizedFallback.match(/^(como|quando|quanto|qual|por que|o que|sera|devo|posso|tenho|to |tou |estou |consigo)/);
    
    if (parecePerguntar) {
      console.log(`💬 [FALLBACK→CHAT] Redirecionando para chat: "${conteudoProcessado.slice(0, 50)}..."`);
      
      const summary = await getMonthlySummary(userId);
      const chatResponse = await generateChatResponse(
        conteudoProcessado,
        summary,
        null,
        nomeUsuario
      );
      await sendMessage(payload.phoneNumber, chatResponse, payload.messageSource);
      
      // Salvar no histórico
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: chatResponse,
        tipo: "chat_fallback"
      });
      return;
    }
    
    // Fallback gentil para mensagens que realmente não fazem sentido
    const primeiroNome = nomeUsuario.split(" ")[0];
    await sendMessage(payload.phoneNumber, `Oi ${primeiroNome}! 👋\n\nNão entendi bem essa. Você pode:\n\n💸 *Registrar gasto:* "café 8 pix"\n💰 *Registrar entrada:* "recebi 200"\n📊 *Ver resumo:* "resumo"\n💬 *Conversar:* "tô gastando demais?"`, payload.messageSource);
    
  } catch (error: unknown) {
    console.error("❌ [WORKER] Erro no processamento:", error);
    
    // Retry com backoff exponencial
    const retryCount = (job.retry_count || 0) + 1;
    const maxRetries = job.max_retries || 3;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (retryCount < maxRetries) {
      // Calcular backoff exponencial (1s, 2s, 4s, max 30s)
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, retryCount));
      const nextRetry = new Date(Date.now() + backoffMs);
      
      await supabase.from("webhook_jobs").update({
        status: "pending",
        retry_count: retryCount,
        last_error: errorMessage,
        next_retry_at: nextRetry.toISOString()
      }).eq("id", job.id);
      
      console.log(`🔄 [WORKER] Retry ${retryCount}/${maxRetries} agendado para ${nextRetry.toISOString()}`);
    } else {
      // Mover para dead letter queue
      await supabase.from("webhook_jobs").update({
        status: "failed",
        dead_letter: true,
        last_error: errorMessage
      }).eq("id", job.id);
      
      console.log(`💀 [WORKER] Job ${job.id} movido para dead letter queue após ${maxRetries} tentativas`);
    }
    
    // Ainda tenta enviar mensagem de erro ao usuário
    try {
      await sendMessage(payload.phoneNumber, "Ops, algo deu errado 😕\n\nTenta de novo?", payload.messageSource);
    } catch {}
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
    // ========================================================================
    // 🔒 BUSCAR JOBS COM IDEMPOTÊNCIA E PRIORIDADE
    // ========================================================================
    // Buscar jobs pendentes OU que têm retry agendado para agora
    const now = new Date().toISOString();
    
    const { data: jobs, error } = await supabase
      .from("webhook_jobs")
      .select("*")
      .or(`status.eq.pending,and(status.eq.pending,next_retry_at.lte.${now})`)
      .eq("dead_letter", false)
      .order("priority", { ascending: true })
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

    let processedCount = 0;
    
    for (const job of jobs) {
      // ========================================================================
      // 🔒 LOCK OTIMISTA: Tentar marcar como processing
      // ========================================================================
      const { error: lockError, count } = await supabase
        .from("webhook_jobs")
        .update({ status: "processing", processed_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "pending");
      
      if (lockError || count === 0) {
        console.log(`⏭️ [WORKER] Job ${job.id?.slice(-8)} já em processamento por outra instância`);
        continue;
      }
      
      try {
        await processarJob(job);
        await supabase.from("webhook_jobs").update({ 
          status: "done", 
          processed_at: new Date().toISOString() 
        }).eq("id", job.id);
        processedCount++;
      } catch (jobError) {
        // O erro já é tratado dentro de processarJob com retry
        console.error(`❌ [JOB ${job.id?.slice(-8)}] Erro não tratado:`, jobError);
      }
    }

    return new Response(JSON.stringify({ processed: processedCount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Erro geral:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
