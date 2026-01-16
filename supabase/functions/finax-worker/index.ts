import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyDeterministic } from "./decision/classifier.ts";

// ============================================================================
// 🏭 FINAX WORKER v5.1 - ARQUITETURA MODULAR COM DECISION ENGINE + ELITE
// ============================================================================
//
// ARQUITETURA:
// 1. DECISION ENGINE: Classifica intenção ANTES de qualquer ação
// 2. CONTEXT MANAGER: Gerencia memória de curto prazo (actions)
// 3. INTENT HANDLERS: Módulos isolados por domínio (expense, income, card, cancel)
// 4. UI MESSAGES: Envio padronizado de mensagens
// 5. SELF-HEALING: Aprendizado com correções do usuário (ELITE)
// 6. MEMORY LAYER: Memória de longo prazo para padrões (ELITE)
// 7. PROACTIVE AI: Alertas silenciosos consultados sob demanda (ELITE)
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
type ActionType = "expense" | "income" | "card_event" | "cancel" | "query" | "query_alerts" | "control" | "recurring" | "set_context" | "chat" | "edit" | "unknown";

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
  cancel: { required: [], optional: ["transaction_id"] },
  query: { required: [], optional: [] },
  control: { required: [], optional: [] },
  recurring: { required: ["amount", "description", "payment_method"], optional: ["day_of_month", "category", "periodicity", "card", "card_id"] },
  set_context: { required: ["label", "start_date", "end_date"], optional: ["description"] },
  chat: { required: [], optional: [] },
  edit: { required: [], optional: ["transaction_id", "field", "new_value"] }, // Edição/correção rápida
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
// 🧠 DECISION ENGINE - ARQUITETURA CORRIGIDA
// ============================================================================
// REGRAS DE OURO:
// 1. Heurística NÃO decide - apenas ESTIMA confiança
// 2. Se confiança >= 0.90 E slots completos → EXECUTA DIRETO (sem perguntas!)
// 3. IA é fallback, não muleta
// 4. Fluxos legados são BLOQUEADOS quando decisão semântica foi tomada
// ============================================================================

interface SemanticResult {
  actionType: ActionType;
  confidence: number;
  slots: ExtractedSlots;
  reason: string;
  canExecuteDirectly: boolean; // NOVO: indica se pode executar sem perguntas
}

const SEMANTIC_PATTERNS = {
  // ✏️ EDIT/CORREÇÃO - Prioridade MÁXIMA (antes de tudo)
  edit: {
    verbs: ["errado", "errei", "corrigir", "corrige", "corrigi", "era pra ser", "devia ser", "na verdade"],
    contexts: ["nao foi", "não foi", "foi na verdade", "queria dizer", "me enganei", "errado era", "era debito", "era pix", "era credito", "era dinheiro"],
    weight: 0.98
  },
  // 🚨 QUERY_ALERTS - Alertas proativos (ELITE)
  query_alerts: {
    verbs: ["meus alertas", "ver alertas", "alertas", "avisos", "meus avisos"],
    contexts: ["alertas financeiros", "alertas do finax", "descartar alertas"],
    weight: 0.96
  },
  // 🔄 RECORRENTE - Prioridade ALTA (antes de expense)
  recurring: {
    verbs: [],
    contexts: [
      "todo mes", "todo mês", "mensal", "mensalmente", 
      "todo dia", "semanal", "semanalmente", 
      "anual", "anualmente", "assinatura",
      "todo começo de mes", "todo começo de mês",
      "todo fim de mes", "todo fim de mês",
      "por mes", "por mês", "ao mes", "ao mês",
      "cada mes", "cada mês", "cobrado mensal",
      "pago todo", "desconta todo"
    ],
    weight: 0.95
  },
  // 📍 CONTEXTO TEMPORÁRIO (viagem, evento, obra)
  set_context: {
    verbs: [
      "vou viajar", "viagem para", "fazer uma viagem",
      "vou fazer uma obra", "comecando obra", "começando obra", 
      "evento de", "vou para",
      "entre o dia", "entre dia", "entre os dias",
      "de hoje ate", "de hoje até", "a partir de",
      "comecando dia", "começando dia",
      "do dia", "partir do dia"
    ],
    contexts: [
      "viagem", "férias", "ferias", 
      "obra", "reforma", "casamento", "evento",
      "lua de mel", "excursao", "excursão",
      "congresso", "conferencia", "conferência"
    ],
    weight: 0.92
  },
  income: {
    verbs: ["recebi", "recebido", "ganhei", "caiu", "entrou", "entrada de", "me mandaram", "mandaram pra mim", "depositaram", "transferiram"],
    contexts: ["salario", "salário", "pagamento recebido", "pix recebido"],
    weight: 0.95
  },
  card_event: {
    verbs: ["limite"],
    contexts: [],
    weight: 0.92
  },
  expense: {
    verbs: ["gastei", "comprei", "paguei", "custou"],
    contexts: [],
    weight: 0.90
  },
  cancel: {
    verbs: ["cancela", "cancelar", "desfaz", "apaga"],
    contexts: ["deixa pra la", "esquece", "nao quero"],
    weight: 0.95
  },
  query: {
    verbs: ["quanto gastei", "resumo", "saldo", "quanto tenho"],
    contexts: [],
    weight: 0.92
  }
};

function classifySemanticHeuristic(message: string): SemanticResult {
  const normalized = normalizeText(message);
  const original = message;
  
  // Extrair slots básicos primeiro
  const slots: ExtractedSlots = {};
  
  // 1. EXTRAIR VALOR
  const valuePatterns = [
    /r\$\s*([\d.,]+)/i,
    /([\d.,]+)\s*(?:reais|real)/i,
    /(?:recebi|gastei|paguei|comprei|caiu|entrada de|limite)\s*([\d.,]+)/i,
  ];
  for (const pattern of valuePatterns) {
    const match = original.match(pattern);
    if (match) {
      slots.amount = parseFloat(match[1].replace(",", "."));
      break;
    }
  }
  // Fallback: qualquer número na mensagem
  if (!slots.amount) {
    const numMatch = original.match(/(\d+[.,]?\d*)/);
    if (numMatch) slots.amount = parseFloat(numMatch[1].replace(",", "."));
  }
  
  // 2. EXTRAIR FONTE/PAGAMENTO
  if (normalized.includes("pix")) {
    slots.source = "pix";
    slots.payment_method = "pix";
  } else if (normalized.includes("dinheiro")) {
    slots.source = "dinheiro";
    slots.payment_method = "dinheiro";
  } else if (normalized.includes("transferencia") || normalized.includes("transf")) {
    slots.source = "transferencia";
  } else if (normalized.includes("debito") || normalized.includes("débito")) {
    slots.payment_method = "debito";
  } else if (normalized.includes("credito") || normalized.includes("crédito") || normalized.includes("cartao") || normalized.includes("cartão")) {
    slots.payment_method = "credito";
  }
  
  // 3. EXTRAIR CARTÃO (para card_event)
  const banks = ["nubank", "itau", "itaú", "bradesco", "santander", "c6", "inter", "picpay", "next"];
  for (const bank of banks) {
    if (normalized.includes(bank)) {
      slots.card = bank;
      break;
    }
  }
  if (slots.amount && normalized.includes("limite")) {
    slots.value = slots.amount;
  }
  
  // 4. EXTRAIR PERIODICIDADE E DIA (para recorrente)
  if (normalized.includes("todo mes") || normalized.includes("mensal") || normalized.includes("por mes") || normalized.includes("ao mes") || normalized.includes("cada mes")) {
    slots.periodicity = "monthly";
  } else if (normalized.includes("semanal") || normalized.includes("por semana")) {
    slots.periodicity = "weekly";
  } else if (normalized.includes("anual") || normalized.includes("por ano")) {
    slots.periodicity = "yearly";
  }
  
  // Extrair dia do mês (ex: "todo dia 10", "dia 5")
  const dayMatch = original.match(/(?:todo\s*)?dia\s*(\d{1,2})/i);
  if (dayMatch) {
    slots.day_of_month = parseInt(dayMatch[1]);
  }
  
  // 5. EXTRAIR DATAS (para set_context) - MELHORADO
  const datePatterns = [
    // "de 09/01 até 10/01" ou "de 9/1 a 10/1"
    /de\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s*(?:a|até|ate)\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    // "entre o dia 09/01 e 10/01" ou "entre dia 9 e 10"
    /entre\s*(?:o\s*)?(?:dia\s*)?(\d{1,2}(?:[\/\-]\d{1,2})?(?:[\/\-]\d{2,4})?)\s*(?:e|a|até|ate)\s*(?:dia\s*)?(\d{1,2}(?:[\/\-]\d{1,2})?(?:[\/\-]\d{2,4})?)/i,
    // "do dia 09 ao 10" 
    /do\s*dia\s*(\d{1,2}(?:[\/\-]\d{1,2})?)\s*(?:ao?|até|ate)\s*(?:dia\s*)?(\d{1,2}(?:[\/\-]\d{1,2})?)/i,
    // "de hoje até dia X"
    /(?:de\s*)?hoje\s*(?:a|até|ate)\s*(?:dia\s*)?(\d{1,2})/i,
  ];
  for (const pattern of datePatterns) {
    const match = original.match(pattern);
    if (match) {
      // Normalizar datas (adicionar mês atual se não especificado)
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      
      let startStr = match[1] || "";
      let endStr = match[2] || match[1] || "";
      
      // Se é só um número (dia), adicionar mês atual
      if (/^\d{1,2}$/.test(startStr)) {
        startStr = `${startStr}/${currentMonth}`;
      }
      if (/^\d{1,2}$/.test(endStr)) {
        endStr = `${endStr}/${currentMonth}`;
      }
      
      slots.date_range = { start: startStr, end: endStr };
      break;
    }
  }
  
  // 6. EXTRAIR LABEL DO CONTEXTO
  const contextLabelPatterns = [
    /viagem\s+(?:para|pra|a)\s+([A-Za-zÀ-ú\s]+?)(?:\s+de|\s+entre|\s+do|\s*$)/i,
    /vou\s+(?:para|pra|a)\s+([A-Za-zÀ-ú\s]+?)(?:\s+de|\s+entre|\s+do|\s*$)/i,
    /(?:viagem|evento|obra|reforma)\s+(?:em|no|na)\s+([A-Za-zÀ-ú\s]+)/i,
  ];
  for (const pattern of contextLabelPatterns) {
    const match = original.match(pattern);
    if (match && match[1]) {
      slots.label = match[1].trim();
      break;
    }
  }
  
  // 7. EXTRAIR DESCRIÇÃO GENÉRICA (para expenses/income não recorrentes)
  // Exemplo: "gastei 50 no mercado" → description = "mercado"
  // Exemplo: "recebi 200 do freelance" → description = "freelance"
  if (!slots.description) {
    const descPatterns = [
      /(?:gastei|paguei|comprei)\s+[\d.,]+\s*(?:reais?)?\s*(?:no?|na?|em|de|com)\s+(.+?)(?:\s+(?:no\s+)?(?:pix|debito|credito|dinheiro|cartao)|\s*$)/i,
      /(?:recebi|caiu|entrou|ganhei)\s+[\d.,]+\s*(?:reais?)?\s*(?:do?|da?|de|com)\s+(.+?)(?:\s*$)/i,
      /(.+?)\s+[\d.,]+\s*(?:reais?)?(?:\s+(?:pix|debito|credito|dinheiro))?\s*$/i,
    ];
    for (const pattern of descPatterns) {
      const match = original.match(pattern);
      if (match && match[1]) {
        const desc = match[1]
          .replace(/\b(pix|debito|débito|credito|crédito|dinheiro|cartao|cartão|todo|mes|mês)\b/gi, "")
          .trim();
        if (desc.length > 1) {
          slots.description = desc;
          break;
        }
      }
    }
  }
  
  // ========================================================================
  // CLASSIFICAÇÃO POR PADRÕES (HEURÍSTICA - NÃO DECISÃO!)
  // ========================================================================
  
  // 🚨 QUERY_ALERTS - Alertas proativos (ELITE)
  for (const verb of SEMANTIC_PATTERNS.query_alerts.verbs) {
    if (normalized.includes(verb)) {
      // Verificar se é descarte
      const isDismiss = normalized.includes("descartar");
      return {
        actionType: "query_alerts" as ActionType,
        confidence: SEMANTIC_PATTERNS.query_alerts.weight,
        slots: { dismiss: isDismiss },
        reason: `Comando de alertas: "${verb}"`,
        canExecuteDirectly: true
      };
    }
  }
  
  // ✏️ EDIT/CORREÇÃO - Prioridade MÁXIMA (antes de qualquer coisa)
  for (const verb of SEMANTIC_PATTERNS.edit.verbs) {
    if (normalized.includes(verb)) {
      // Detectar nova forma de pagamento mencionada
      let newPaymentMethod: string | undefined;
      if (normalized.includes("pix")) newPaymentMethod = "pix";
      else if (normalized.includes("debito") || normalized.includes("débito")) newPaymentMethod = "debito";
      else if (normalized.includes("credito") || normalized.includes("crédito")) newPaymentMethod = "credito";
      else if (normalized.includes("dinheiro")) newPaymentMethod = "dinheiro";
      
      return {
        actionType: "edit",
        confidence: SEMANTIC_PATTERNS.edit.weight,
        slots: { new_payment_method: newPaymentMethod },
        reason: `Correção detectada: "${verb}"`,
        canExecuteDirectly: !!newPaymentMethod // Pode executar direto se mencionou o método correto
      };
    }
  }
  for (const ctx of SEMANTIC_PATTERNS.edit.contexts) {
    if (normalized.includes(ctx)) {
      let newPaymentMethod: string | undefined;
      if (normalized.includes("pix")) newPaymentMethod = "pix";
      else if (normalized.includes("debito") || normalized.includes("débito")) newPaymentMethod = "debito";
      else if (normalized.includes("credito") || normalized.includes("crédito")) newPaymentMethod = "credito";
      else if (normalized.includes("dinheiro")) newPaymentMethod = "dinheiro";
      
      return {
        actionType: "edit",
        confidence: SEMANTIC_PATTERNS.edit.weight * 0.95,
        slots: { new_payment_method: newPaymentMethod },
        reason: `Contexto de correção: "${ctx}"`,
        canExecuteDirectly: !!newPaymentMethod
      };
    }
  }
  
  // 🔄 RECURRING - Prioridade ALTA (antes de expense)
  for (const ctx of SEMANTIC_PATTERNS.recurring.contexts) {
    if (normalized.includes(ctx)) {
      // EXTRAÇÃO ESPECIAL DE DESCRIÇÃO PARA RECORRENTE
      // Exemplo: "Netflix todo mês 40 reais" → description = "Netflix"
      // Exemplo: "Aluguel 1500 todo dia 10" → description = "Aluguel"
      if (!slots.description) {
        // Tentar extrair nome do serviço/gasto ANTES do termo de recorrência
        const recurringTerms = ["todo mes", "todo mês", "mensal", "mensalmente", "todo dia", "semanal", "anual", "assinatura", "por mes", "por mês", "ao mes", "ao mês", "cada mes", "cada mês"];
        let descMatch: string | null = null;
        
        for (const term of recurringTerms) {
          const termIndex = normalized.indexOf(term);
          if (termIndex > 0) {
            // Pegar texto antes do termo
            const beforeTerm = original.substring(0, termIndex).trim();
            // Remover valor numérico e palavras de pagamento
            const cleanDesc = beforeTerm
              .replace(/r\$\s*[\d.,]+|[\d.,]+\s*reais?/gi, "")
              .replace(/\b(pix|debito|débito|credito|crédito|dinheiro|cartao|cartão)\b/gi, "")
              .replace(/[\d.,]+/g, "")
              .trim();
            if (cleanDesc.length > 1) {
              descMatch = cleanDesc;
              break;
            }
          }
        }
        
        // Se não achou antes, tentar achar depois (ex: "todo mês pago Netflix 40")
        if (!descMatch) {
          const afterMatch = original.match(/(?:todo\s*m[êe]s|mensal|semanal|anual)\s+(?:pago\s+)?([A-Za-zÀ-ú\s]+?)(?:\s+\d|$)/i);
          if (afterMatch && afterMatch[1]) {
            descMatch = afterMatch[1].trim();
          }
        }
        
        if (descMatch) {
          slots.description = descMatch;
        }
      }
      
      const canExecute = !!(slots.amount && slots.description);
      console.log(`🔄 [HEURISTIC] Recurring detectado: amount=${slots.amount}, description="${slots.description}", canExecute=${canExecute}`);
      
      return {
        actionType: "recurring",
        confidence: SEMANTIC_PATTERNS.recurring.weight,
        slots,
        reason: `Termo de recorrência: "${ctx}"`,
        canExecuteDirectly: canExecute
      };
    }
  }
  
  // 📍 SET_CONTEXT - Viagem/Evento
  // Detectar menção a datas/períodos junto com palavras de contexto
  const hasDateRange = !!slots.date_range;
  const hasContextWord = SEMANTIC_PATTERNS.set_context.contexts.some(ctx => normalized.includes(ctx));
  
  // Se tem intervalo de datas E palavra de contexto → é set_context
  if (hasDateRange && hasContextWord) {
    if (!slots.label) {
      // Tentar extrair label das palavras de contexto
      for (const ctx of SEMANTIC_PATTERNS.set_context.contexts) {
        if (normalized.includes(ctx)) {
          slots.label = ctx.charAt(0).toUpperCase() + ctx.slice(1);
          break;
        }
      }
    }
    console.log(`📍 [HEURISTIC] set_context detectado com datas: ${JSON.stringify(slots.date_range)}, label="${slots.label}"`);
    return {
      actionType: "set_context",
      confidence: SEMANTIC_PATTERNS.set_context.weight,
      slots,
      reason: `Contexto com período: ${slots.label}`,
      canExecuteDirectly: true // Tem datas = pode criar
    };
  }
  
  for (const verb of SEMANTIC_PATTERNS.set_context.verbs) {
    if (normalized.includes(verb)) {
      return {
        actionType: "set_context",
        confidence: SEMANTIC_PATTERNS.set_context.weight,
        slots,
        reason: `Criação de contexto: "${verb}"`,
        canExecuteDirectly: hasDateRange // Pode executar se tem datas
      };
    }
  }
  
  for (const ctx of SEMANTIC_PATTERNS.set_context.contexts) {
    if (normalized.includes(ctx)) {
      // Verificar se é criação de contexto (vou fazer, vou para, começando, etc)
      if (normalized.includes("vou") || normalized.includes("comec") || normalized.includes("inicio") || normalized.includes("início") || normalized.includes("fazer") || normalized.includes("entre")) {
        if (!slots.label) slots.label = ctx.charAt(0).toUpperCase() + ctx.slice(1);
        return {
          actionType: "set_context",
          confidence: SEMANTIC_PATTERNS.set_context.weight * 0.9,
          slots,
          reason: `Contexto detectado: "${ctx}"`,
          canExecuteDirectly: hasDateRange
        };
      }
    }
  }
  
  // 🟢 INCOME - Prioridade ALTA
  for (const verb of SEMANTIC_PATTERNS.income.verbs) {
    if (normalized.includes(verb)) {
      // Verificar se pode executar diretamente (tem amount)
      const canExecute = !!slots.amount;
      return {
        actionType: "income",
        confidence: SEMANTIC_PATTERNS.income.weight,
        slots,
        reason: `Verbo de entrada: "${verb}"`,
        canExecuteDirectly: canExecute
      };
    }
  }
  
  // 🔴 EXPENSE - PRIORIDADE ANTES DE CARD_EVENT (se tem "gastei" é sempre expense)
  for (const verb of SEMANTIC_PATTERNS.expense.verbs) {
    if (normalized.includes(verb)) {
      const canExecute = !!(slots.amount && slots.payment_method);
      return {
        actionType: "expense",
        confidence: SEMANTIC_PATTERNS.expense.weight,
        slots,
        reason: `Verbo de gasto: "${verb}" (prioridade sobre limite)`,
        canExecuteDirectly: canExecute
      };
    }
  }
  
  // 🟡 CARD_EVENT - SÓ se NÃO tem verbo de gasto
  if (normalized.includes("limite") && !normalized.includes("gastei") && !normalized.includes("paguei") && !normalized.includes("comprei")) {
    const canExecute = !!(slots.card && slots.value);
    return {
      actionType: "card_event",
      confidence: SEMANTIC_PATTERNS.card_event.weight,
      slots,
      reason: `Atualização de limite detectada`,
      canExecuteDirectly: canExecute
    };
  }
  
  // 🗑️ CANCEL
  for (const verb of SEMANTIC_PATTERNS.cancel.verbs) {
    if (normalized.includes(verb)) {
      return {
        actionType: "cancel",
        confidence: SEMANTIC_PATTERNS.cancel.weight,
        slots,
        reason: `Cancelamento: "${verb}"`,
        canExecuteDirectly: true
      };
    }
  }
  for (const ctx of SEMANTIC_PATTERNS.cancel.contexts) {
    if (normalized.includes(ctx)) {
      return {
        actionType: "cancel",
        confidence: 0.9,
        slots,
        reason: `Contexto de cancelamento: "${ctx}"`,
        canExecuteDirectly: true
      };
    }
  }
  
  // 📊 QUERY
  for (const verb of SEMANTIC_PATTERNS.query.verbs) {
    if (normalized.includes(verb)) {
      return {
        actionType: "query",
        confidence: SEMANTIC_PATTERNS.query.weight,
        slots,
        reason: `Consulta: "${verb}"`,
        canExecuteDirectly: true
      };
    }
  }
  
  // ❓ UNKNOWN
  return {
    actionType: "unknown",
    confidence: 0.2,
    slots,
    reason: "Não classificado por heurística",
    canExecuteDirectly: false
  };
}

// ============================================================================
// 🧠 PROMPT UNIVERSAL FINAX - NÚCLEO COGNITIVO (CONSULTOR FINANCEIRO)
// ============================================================================
const PROMPT_FINAX_UNIVERSAL = `# FINAX - NÚCLEO COGNITIVO FINANCEIRO

Você é Finax, um Consultor Financeiro Conversacional Inteligente.
Não é um robô de formulários. Você é um analista financeiro pessoal capaz de:
- Interpretar linguagem natural, gírias e contexto
- Registrar eventos financeiros
- Conversar, orientar e analisar situação financeira
- Manter diálogo fluido MESMO quando dados estão faltando

## PRINCÍPIO FUNDAMENTAL (LEI ZERO)
INTENÇÃO HUMANA VEM ANTES DE QUALQUER EXTRAÇÃO DE DADOS.
Nunca tente extrair valores antes de entender: "O que o usuário realmente quer fazer agora?"

## DOMÍNIOS COGNITIVOS (escolha EXATAMENTE UM)

### 1. TRANSACTIONAL (expense, income, recurring)
Registro financeiro. Extrair dados + registrar.
- "Gastei 50 no uber" → expense
- "Netflix todo mês 40" → recurring
- "Recebi 200" → income

### 2. QUERY
Consulta de dados: resumo, saldo, gastos por período.
- "Quanto gastei?" → query
- "Me mostra meus recorrentes" → query
- "Qual meu saldo?" → query

### 3. CHAT (PRIORIDADE QUANDO NÃO FOR OPERACIONAL)
Conversa financeira, dúvidas, análises, conselhos, reflexões sobre dinheiro.
- "Tô gastando demais?" → chat
- "Como economizar?" → chat  
- "Vale a pena parcelar?" → chat
- "O que acha das minhas finanças?" → chat
- "Tenho dinheiro pra fazer X?" → chat
- Qualquer pergunta reflexiva sobre dinheiro → chat
- Comentários sobre situação financeira → chat

### 4. CONTROL
Edição/cancelamento: "cancela", "apaga", "muda", "deixa pra lá"

### 5. CARD_EVENT
Atualização de cartão: limite, fatura.

### 6. SET_CONTEXT
Período especial: viagem, obra, evento temporário com datas.

## REGRAS DE CLASSIFICAÇÃO

### RECURRING (Prioridade Máxima para gastos)
SE a mensagem menciona periodicidade → É RECURRING, nunca expense!
- "Netflix todo mês 40" → recurring (amount=40, description="Netflix", periodicity="monthly")
- "Academia 99 mensal" → recurring (amount=99, description="Academia", periodicity="monthly")

### CHAT (Prioridade para perguntas reflexivas)
SE a mensagem é uma PERGUNTA sobre finanças SEM dados concretos → chat
SE a mensagem pede OPINIÃO, ANÁLISE ou CONSELHO → chat
SE não é registro, consulta de dados nem cancelamento → chat

NUNCA retorne "unknown" para perguntas sobre dinheiro. Use "chat".

### INCOME
SE dinheiro está ENTRANDO → income
- "Recebi 200" → income

### EXPENSE (Somente quando NÃO é recurring)
- "Gastei 50 no uber" → expense

## NOMES DOS SLOTS (USE EXATAMENTE ESTES)
- amount: number (valor em reais)
- description: string (nome do serviço/produto)
- payment_method: "pix" | "debito" | "credito" | "dinheiro"
- source: "pix" | "dinheiro" | "transferencia"
- periodicity: "monthly" | "weekly" | "yearly"
- day_of_month: number (1-31)
- label: string (nome do evento/viagem)
- start_date: "DD/MM"
- end_date: "DD/MM"
- card: string (nome do banco)
- value: number (valor do limite)

## RESPOSTA
Responda APENAS JSON válido:
{
  "actionType": "recurring|set_context|income|expense|card_event|cancel|query|chat|control|unknown",
  "confidence": 0.0-1.0,
  "slots": { ... },
  "shouldExecute": true|false,
  "reasoning": "explicação curta"
}`;

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
  
  console.log(`\n🧠 [DECISION ENGINE v2.0 - IA PRIMEIRO] ━━━━━━━━━━━━━━━━`);
  console.log(`📩 Mensagem: "${message.slice(0, 60)}..." | Tipo: ${payloadType || 'unknown'}`);
  
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
  // FALLBACK: IA incerta → usar heurística para ajudar
  // ========================================================================
  console.log(`⚠️ [IA] Confiança baixa, usando heurística como fallback...`);
  
  const heuristic = classifySemanticHeuristic(message);
  console.log(`🏷️ [HEURÍSTICA] ${heuristic.actionType} | Conf: ${(heuristic.confidence * 100).toFixed(0)}%`);
  
  // Escolher o melhor resultado entre IA e heurística
  const bestResult = heuristic.confidence > aiResult.confidence ? heuristic : aiResult;
  
  // Mesclar slots: IA tem prioridade sobre heurística
  const mergedSlots = { ...heuristic.slots, ...aiResult.slots };
  const mergedMissing = getMissingSlots(bestResult.actionType, mergedSlots);
  
  console.log(`🔀 [MERGE] Tipo: ${bestResult.actionType} | Slots: ${JSON.stringify(mergedSlots)} | Faltam: ${mergedMissing.join(", ") || "nenhum"}`);
  
  return {
    result: {
      actionType: bestResult.actionType,
      confidence: Math.max(aiResult.confidence, heuristic.confidence),
      slots: mergedSlots,
      reason: `IA + Heurística: ${bestResult.reason}`,
      canExecuteDirectly: mergedMissing.length === 0
    },
    shouldBlockLegacyFlow: bestResult.confidence >= 0.70
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
  const cardId = slots.card_id || null;
  
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
    cartao_id: cardId,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  // 💳 ATUALIZAR LIMITE DO CARTÃO SE FOR CRÉDITO
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
      cardInfo = `\n💳 ${card.nome || slots.card} (disponível: R$ ${novoLimite.toFixed(2)})`;
    }
  } else if (slots.card) {
    cardInfo = `\n💳 ${slots.card}`;
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
  
  const dataFormatada = agora.toLocaleDateString("pt-BR");
  const horaFormatada = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const emoji = categoria === "alimentacao" ? "🍽️" : categoria === "mercado" ? "🛒" : categoria === "transporte" ? "🚗" : "💸";
  
  // Montar mensagem com alerta de orçamento se houver
  let message = `${emoji} *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${formaPagamento}${cardInfo}\n📅 ${dataFormatada} às ${horaFormatada}${contextInfo}`;
  
  if (budgetAlert) {
    message += `\n\n${budgetAlert}`;
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
      
      // ✅ EXECUÇÃO DIRETA: hasAllRequiredSlots = true
      if (hasAllRequiredSlots("income", slots)) {
        console.log(`⚡ [INCOME] Execução direta: R$ ${slots.amount}`);
        const actionId = activeAction?.intent === "income" ? activeAction.id : undefined;
        const result = await registerIncome(userId, slots, actionId);
        // 🔒 Limpar todas as actions pendentes
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input"]);
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
      const missing = getMissingSlots("expense", slots);
      
      // ✅ EXECUÇÃO DIRETA: hasAllRequiredSlots = true
      if (hasAllRequiredSlots("expense", slots)) {
        console.log(`⚡ [EXPENSE] Execução direta: R$ ${slots.amount} via ${slots.payment_method}`);
        const actionId = activeAction?.intent === "expense" ? activeAction.id : undefined;
        const result = await registerExpense(userId, slots, actionId);
        // 🔒 Limpar todas as actions pendentes
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input"]);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
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
    // 📍 SET_CONTEXT - Viagens/Eventos
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
    
    // 🗑️ CANCEL - BUSCA INTELIGENTE DE RECORRENTES
    if (decision.actionType === "cancel") {
      const normalized = normalizeText(conteudoProcessado);
      
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
        const match = conteudoProcessado.match(pattern);
        if (match && match[1]) {
          searchTerm = match[1].trim().split(" ")[0]; // Primeira palavra
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
      await sendMessage(payload.phoneNumber, `Qual transação cancelar?\n\n${lista}\n\n_Responde com o número_`, payload.messageSource);
      return;
    }
    
    // 📊 QUERY - COM QUERIES ANALÍTICAS
    if (decision.actionType === "query") {
      const normalized = normalizeText(conteudoProcessado);
      
      // ========================================================================
      // 📊 GASTOS POR CATEGORIA - Handler específico
      // ========================================================================
      if (normalized.includes("categoria") || normalized.includes("categorias") ||
          (normalized.includes("gasto") && normalized.includes("por")) ||
          normalized.includes("breakdown") || normalized.includes("detalha")) {
        console.log(`📊 [QUERY] Gastos por categoria detectado`);
        const result = await getExpensesByCategory(userId);
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
      
      if (!alerts?.length) {
        await sendMessage(payload.phoneNumber, "✨ *Tudo tranquilo!*\n\nNão há nada fora do normal nos seus gastos. Continue assim! 💪", payload.messageSource);
        return;
      }
      
      // Marcar como enviados
      await supabase
        .from("spending_alerts")
        .update({ 
          sent_at: new Date().toISOString(), 
          status: "sent" 
        })
        .in("id", alerts.map(a => a.id));
      
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
        activeAction && 
        (activeAction.intent === "expense" || activeAction.intent === "income") &&
        activeAction.pending_slot) {
      console.log(`🛡️ [GUARD] Bloqueando chat - action ativa: ${activeAction.intent} aguardando ${activeAction.pending_slot}`);
      
      // Tentar extrair o slot pendente da mensagem atual
      const pendingSlot = activeAction.pending_slot;
      let slotValue: any = null;
      
      if (pendingSlot === "payment_method") {
        const normalizedGuard = normalizeText(conteudoProcessado);
        if (normalizedGuard.includes("pix")) slotValue = "pix";
        else if (normalizedGuard.includes("debito") || normalizedGuard.includes("débito")) slotValue = "debito";
        else if (normalizedGuard.includes("credito") || normalizedGuard.includes("crédito")) slotValue = "credito";
        else if (normalizedGuard.includes("dinheiro")) slotValue = "dinheiro";
      } else if (pendingSlot === "amount") {
        const numMatch = conteudoProcessado.match(/(\d+[.,]?\d*)/);
        if (numMatch) slotValue = parseFloat(numMatch[1].replace(",", "."));
      } else if (pendingSlot === "description") {
        slotValue = conteudoProcessado.trim();
      }
      
      if (slotValue !== null) {
        // Preencher o slot e continuar o fluxo
        const updatedSlots = { ...activeAction.slots, [pendingSlot]: slotValue };
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
        const prompt = SLOT_PROMPTS[missing[0]];
        if (prompt?.useButtons && prompt.buttons) {
          await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, prompt?.text || `Qual o ${missing[0]}?`, payload.messageSource);
        }
        return;
      }
      
      // Não conseguiu extrair → re-perguntar
      const prompt = SLOT_PROMPTS[pendingSlot];
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
        await sendMessage(payload.phoneNumber, `*Como usar o Finax* 📊\n\n💸 *Registrar gasto:*\n"Gastei 50 no mercado"\n\n💰 *Registrar entrada:*\n"Recebi 200 de pix"\n\n📊 *Ver resumo:*\n"Quanto gastei?"`, payload.messageSource);
        return;
      }
      
      // Saudação
      const primeiroNome = nomeUsuario.split(" ")[0];
      await sendMessage(payload.phoneNumber, `Oi, ${primeiroNome}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`, payload.messageSource);
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
      if (activeAction && activeAction.pending_slot === "amount" && numValue) {
        const updatedSlots: ExtractedSlots = { ...activeAction.slots, amount: numValue };
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
    if (activeAction && activeAction.pending_slot) {
      // Re-perguntar o slot pendente
      const prompt = SLOT_PROMPTS[activeAction.pending_slot];
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
