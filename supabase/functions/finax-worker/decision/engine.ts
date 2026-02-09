// ============================================================================
// 🧠 DECISION ENGINE - PEÇA CENTRAL DO FINAX
// ============================================================================
//
// PROTOCOLO COGNITIVO EM 3 ETAPAS:
// 1. CLASSIFICAÇÃO DETERMINÍSTICA (sem IA) - Resolve 80% dos casos
// 2. CLASSIFICAÇÃO SEMÂNTICA (padrões) - Fallback para casos médios
// 3. CLASSIFICAÇÃO IA (Gemini) - Apenas para casos complexos
//
// REGRAS DE OURO:
// - Determinístico primeiro, IA por último
// - Nunca perguntar algo que o usuário já disse
// - Nunca misturar tipos de ação (expense ≠ income ≠ card_event)
// - Durante coleta de slots, NUNCA entrar em modo chat
// ============================================================================

import { 
  ActionType, 
  DecisionInput, 
  DecisionOutput, 
  ExtractedSlots,
  SLOT_REQUIREMENTS,
  SLOT_PROMPTS 
} from "./types.ts";
import { classifyDeterministic } from "./classifier.ts";
import { getActivePrompt } from "../governance/config.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// ============================================================================
// 🔤 NORMALIZAÇÃO
// ============================================================================

export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

// ============================================================================
// 🎯 CLASSIFICAÇÃO SEMÂNTICA (PRÉ-IA)
// ============================================================================

const SEMANTIC_PATTERNS = {
  // 💳 ADICIONAR CARTÃO - PRIORIDADE MÁXIMA
  add_card: {
    verbs: ["registrar cartao", "registrar cartão", "adicionar cartao", "adicionar cartão", "cadastrar cartao", "cadastrar cartão", "novo cartao", "novo cartão", "criar cartao", "criar cartão"],
    contexts: ["cartao de credito", "cartão de crédito", "meu cartao", "meu cartão"],
    weight: 0.98
  },
  // 📄 FATURA/CONTA A PAGAR - PRIORIDADE ALTA
  bill: {
    verbs: ["conta de", "fatura de", "fatura", "vence dia", "vencimento dia", "criar fatura", "nova fatura", "me lembre", "me lembra", "lembrar de pagar", "avisar quando", "alerta de"],
    contexts: ["agua", "água", "luz", "energia", "internet", "gas", "gás", "telefone", "aluguel", "condominio", "condomínio", "academia"],
    weight: 0.96
  },
  // 🔄 GASTO RECORRENTE - Assinaturas fixas
  recurring: {
    verbs: ["assinatura", "todo mes pago", "todo mês pago", "mensalidade", "pago fixo", "desconto automatico", "desconto automático"],
    contexts: ["netflix", "spotify", "disney", "amazon", "gym", "academia mensal", "prime", "hbo", "youtube premium"],
    weight: 0.92
  },
  // 💸 PAGAR FATURA - Mais restrito (exige "conta de" ou "fatura de" explícito)
  pay_bill: {
    verbs: ["paguei a conta de", "paguei a fatura de", "paguei a conta da", "paguei a fatura da", "conta de luz", "conta de agua", "conta de energia", "conta de internet"],
    contexts: ["da energia", "da agua", "da água", "da luz", "da internet", "do gas", "do gás"],
    weight: 0.94
  },
  // ENTRADA - alta prioridade
  income: {
    verbs: ["recebi", "recebido", "receber", "ganhei", "caiu", "entrou", "entrada", "recebimento"],
    contexts: ["salario", "salário", "pagamento recebido", "pix recebido", "transferencia recebida"],
    weight: 0.95
  },
  // CARTÃO - atualização de limite
  card_event: {
    verbs: ["limite", "atualiza limite", "atualizar limite", "alterou limite", "aumentou limite"],
    contexts: [],
    weight: 0.9
  },
  // GASTO
  expense: {
    verbs: ["gastei", "comprei", "paguei", "foi", "custou", "pago"],
    contexts: [],
    weight: 0.85
  },
  // CANCELAR
  cancel: {
    verbs: ["cancela", "cancelar", "desfaz", "desfazer", "apaga", "apagar", "remove", "remover"],
    contexts: ["deixa pra la", "deixa pra lá", "esquece", "nao quero", "não quero"],
    weight: 0.95
  },
  // CONSULTA
  query: {
    verbs: ["quanto", "quanto gastei", "resumo", "saldo", "quanto tenho", "relatorio", "relatório"],
    contexts: ["esse mes", "este mês", "essa semana", "hoje"],
    weight: 0.9
  },
  // 📋 LISTAR METAS - PRIORIDADE ALTA
  list_goals: {
    verbs: ["quais metas", "minhas metas", "ver metas", "listar metas", "metas ativas", "tenho meta", "metas tenho"],
    contexts: [],
    weight: 0.98
  },
  // 💰 ADICIONAR À META
  add_goal_progress: {
    verbs: ["adicionar na meta", "adiciona na meta", "guardar na meta", "depositar na meta", "colocar na meta", "contribuir meta", "adicionar 200 na meta", "adicionar 100 na meta"],
    contexts: [],
    weight: 0.97
  },
  // 🎯 METAS DE ECONOMIA (criar nova)
  goal: {
    verbs: ["criar meta", "nova meta", "quero uma meta", "meta de"],
    contexts: ["economizar", "juntar", "guardar", "poupar", "objetivo"],
    weight: 0.9
  },
  // 🛒 ASSISTENTE DE COMPRAS
  purchase_advice: {
    verbs: ["vale a pena", "devo comprar", "posso comprar", "compensa comprar", "devo gastar"],
    contexts: ["compra", "comprar isso", "faz sentido comprar"],
    weight: 0.9
  },
  // 💰 DEFINIR ORÇAMENTO/LIMITE
  set_budget: {
    verbs: ["limite mensal", "meu limite", "definir limite", "definir orcamento", "definir orçamento", "teto mensal", "meu teto"],
    contexts: ["gastar no maximo", "gastar no máximo", "orcamento de", "orçamento de"],
    weight: 0.95
  }
};

export function classifySemanticIntent(text: string): { 
  type: ActionType; 
  confidence: number; 
  reason: string 
} {
  const normalized = normalizeText(text);
  
  // Verificar cada padrão em ordem de prioridade
  for (const [intentType, patterns] of Object.entries(SEMANTIC_PATTERNS)) {
    // Verificar verbos
    for (const verb of patterns.verbs) {
      if (normalized.includes(verb)) {
        return {
          type: intentType as ActionType,
          confidence: patterns.weight,
          reason: `Verbo "${verb}" detectado`
        };
      }
    }
    
    // Verificar contextos
    for (const ctx of patterns.contexts) {
      if (normalized.includes(ctx)) {
        // Contexto de cartão precisa verificar se é gasto ou atualização
        if (intentType === "card_event") {
          // Se tem "limite" é card_event, se não, pode ser gasto no crédito
          if (normalized.includes("limite") || normalized.includes("atualiz")) {
            return {
              type: "card_event",
              confidence: patterns.weight,
              reason: `Contexto de atualização de cartão: "${ctx}"`
            };
          }
          // Continua para verificar se é gasto
          continue;
        }
        
        return {
          type: intentType as ActionType,
          confidence: patterns.weight * 0.9, // Contexto tem um pouco menos confiança que verbo
          reason: `Contexto "${ctx}" detectado`
        };
      }
    }
  }
  
  // Verificar se é número isolado
  const numericMatch = normalized.match(/^[\d\s,.]+$/);
  if (numericMatch) {
    return {
      type: "unknown",
      confidence: 0.3,
      reason: "Número isolado - precisa de contexto"
    };
  }
  
  return {
    type: "unknown",
    confidence: 0.2,
    reason: "Não foi possível classificar automaticamente"
  };
}

// ============================================================================
// 🧠 DECISION ENGINE PRINCIPAL
// ============================================================================

export async function decisionEngine(input: DecisionInput): Promise<DecisionOutput> {
  const { message, userId, context } = input;
  
  console.log(`\n🧠 [DECISION ENGINE] ━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📩 [DE] Mensagem: "${message.slice(0, 50)}..."`);
  console.log(`📊 [DE] Contexto ativo: ${context.hasActiveAction ? context.activeActionIntent : "nenhum"}`);
  
  // ========================================================================
  // ETAPA 1: CLASSIFICAÇÃO DETERMINÍSTICA (sem IA!)
  // ========================================================================
  const deterministicResult = classifyDeterministic(message);
  console.log(`⚡ [DE] Determinístico: ${deterministicResult.actionType} (${(deterministicResult.confidence * 100).toFixed(0)}%) - ${deterministicResult.reason}`);
  
  // Se classificou com alta confiança E não precisa de IA → usar diretamente
  if (deterministicResult.source === "deterministic" && deterministicResult.confidence >= 0.9) {
    console.log(`✅ [DE] Usando classificação determinística: ${deterministicResult.actionType}`);
    return buildDecision(
      deterministicResult.actionType, 
      deterministicResult.confidence, 
      deterministicResult.slots, 
      context
    );
  }
  
  // ========================================================================
  // ETAPA 2: CLASSIFICAÇÃO SEMÂNTICA (padrões de verbos/contextos)
  // ========================================================================
  const semanticResult = classifySemanticIntent(message);
  console.log(`🏷️ [DE] Semântico: ${semanticResult.type} (${(semanticResult.confidence * 100).toFixed(0)}%) - ${semanticResult.reason}`);
  
  // Se confiança alta E tipo claro → decidir sem IA
  if (semanticResult.confidence >= 0.9 && semanticResult.type !== "unknown") {
    console.log(`⚡ [DE] Decisão semântica: ${semanticResult.type}`);
    
    // Extrair slots básicos do texto
    const quickSlots = extractQuickSlots(message, semanticResult.type);
    
    // Merge com slots do determinístico se houver
    const mergedSlots = { ...deterministicResult.slots, ...quickSlots };
    
    return buildDecision(semanticResult.type, semanticResult.confidence, mergedSlots, context);
  }
  
  // ========================================================================
  // ETAPA 2.5: CONTEXTO ATIVO - preencher slot pendente
  // ========================================================================
  if (context.hasActiveAction && context.pendingSlot) {
    const slotValue = extractSlotValue(message, context.pendingSlot);
    
    if (slotValue !== null) {
      console.log(`📥 [DE] Preenchendo slot "${context.pendingSlot}": ${slotValue}`);
      
      // Mapear intent do contexto para ActionType
      const actionType = mapIntentToActionType(context.activeActionIntent || "");
      
      return {
        actionType,
        confidence: 0.95,
        reasoning: `Preenchendo slot ${context.pendingSlot} do contexto ativo`,
        slots: { [context.pendingSlot]: slotValue },
        missingSlots: [],
        shouldExecute: false, // Deixar o executor verificar se tem tudo
        shouldAsk: false,
        question: null,
        buttons: null
      };
    }
  }
  
  // ========================================================================
  // ETAPA 3: CHAMADA À IA (apenas casos complexos)
  // ========================================================================
  console.log(`🤖 [DE] Chamando IA para caso complexo...`);
  const aiResult = await callAIForDecision(message, context);
  
  // Merge com slots do determinístico se houver
  const finalSlots = { ...deterministicResult.slots, ...aiResult.slots };
  
  return buildDecision(aiResult.type, aiResult.confidence, finalSlots, context);
}

// ============================================================================
// 🔧 FUNÇÕES AUXILIARES
// ============================================================================

function extractQuickSlots(message: string, actionType: ActionType): ExtractedSlots {
  const normalized = normalizeText(message);
  const slots: ExtractedSlots = {};
  
  // Extrair valor numérico
  const valueMatch = message.match(/(\d+[.,]?\d*)/);
  if (valueMatch) {
    slots.amount = parseFloat(valueMatch[1].replace(",", "."));
  }
  
  // Extrair forma de pagamento
  if (normalized.includes("pix")) slots.payment_method = "pix";
  else if (normalized.includes("debito") || normalized.includes("débito")) slots.payment_method = "debito";
  else if (normalized.includes("credito") || normalized.includes("crédito") || normalized.includes("cartao") || normalized.includes("cartão")) slots.payment_method = "credito";
  else if (normalized.includes("dinheiro") || normalized.includes("cash")) slots.payment_method = "dinheiro";
  
  // Extrair source (para entradas)
  if (actionType === "income") {
    if (normalized.includes("pix")) slots.source = "pix";
    else if (normalized.includes("dinheiro")) slots.source = "dinheiro";
    else if (normalized.includes("transferencia") || normalized.includes("transferência")) slots.source = "transferencia";
  }
  
  // Extrair descrição (remover palavras-chave conhecidas)
  let description = message;
  const removeWords = ["gastei", "comprei", "paguei", "recebi", "ganhei", "caiu", "reais", "real", "no", "na", "de", "pix", "debito", "credito", "dinheiro"];
  for (const word of removeWords) {
    description = description.replace(new RegExp(`\\b${word}\\b`, "gi"), "");
  }
  description = description.replace(/\d+[.,]?\d*/g, "").trim();
  if (description.length > 2) {
    slots.description = description;
  }
  
  return slots;
}

function extractSlotValue(message: string, slotType: string): any {
  const normalized = normalizeText(message);
  
  switch (slotType) {
    case "amount":
    case "value":
    case "limit":
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
      
    case "description":
      // Qualquer texto é válido como descrição
      if (message.trim().length > 0) return message.trim();
      return null;
      
    default:
      return message.trim() || null;
  }
}

function mapIntentToActionType(intent: string): ActionType {
  if (intent.includes("gasto") || intent === "registrar_gasto" || intent === "expense") return "expense";
  if (intent.includes("entrada") || intent === "registrar_entrada" || intent === "income") return "income";
  if (intent.includes("card") || intent === "update_card") return "card_event";
  if (intent.includes("cancel")) return "cancel";
  if (intent.includes("resumo") || intent.includes("query")) return "query";
  if (intent.includes("list_goals") || intent.includes("listar_metas")) return "list_goals";
  if (intent.includes("add_goal") || intent.includes("adicionar_meta")) return "add_goal_progress";
  if (intent.includes("meta") || intent.includes("goal")) return "goal";
  if (intent.includes("comprar") || intent.includes("purchase") || intent.includes("vale a pena")) return "purchase_advice";
  return "unknown";
}

function buildDecision(
  actionType: ActionType, 
  confidence: number, 
  slots: ExtractedSlots,
  context: DecisionInput["context"]
): DecisionOutput {
  // Determinar slots obrigatórios para o tipo de ação
  const requirements = SLOT_REQUIREMENTS[actionType];
  const missingSlots: string[] = [];
  
  if (requirements) {
    for (const required of requirements.required) {
      if (!slots[required]) {
        missingSlots.push(required);
      }
    }
  }
  
  // Se temos contexto ativo do mesmo tipo, fazer merge
  if (context.hasActiveAction && context.activeActionSlots) {
    const contextType = mapIntentToActionType(context.activeActionIntent || "");
    if (contextType === actionType) {
      // Merge: slots novos têm prioridade
      slots = { ...context.activeActionSlots, ...slots };
      
      // Recalcular missing slots após merge
      missingSlots.length = 0;
      if (requirements) {
        for (const required of requirements.required) {
          if (!slots[required]) {
            missingSlots.push(required);
          }
        }
      }
    }
  }
  
  // Determinar se deve executar ou perguntar
  const shouldExecute = missingSlots.length === 0 && confidence >= 0.7;
  const shouldAsk = missingSlots.length > 0 || confidence < 0.7;
  
  let question: string | null = null;
  let buttons: Array<{ id: string; title: string }> | null = null;
  
  if (shouldAsk && missingSlots.length > 0) {
    const nextSlot = missingSlots[0];
    const prompt = SLOT_PROMPTS[nextSlot];
    
    if (prompt) {
      question = prompt.text;
      if (prompt.useButtons && prompt.buttons) {
        buttons = prompt.buttons;
      }
    }
  }
  
  // Caso especial: número isolado sem contexto
  if (actionType === "unknown" && slots.amount && !context.hasActiveAction) {
    question = "Esse valor foi um gasto ou uma entrada?";
    buttons = [
      { id: "num_gasto", title: "💸 Gasto" },
      { id: "num_entrada", title: "💰 Entrada" }
    ];
  }
  
  console.log(`📋 [DE] Decisão final: ${actionType} | Exec: ${shouldExecute} | Ask: ${shouldAsk} | Missing: ${missingSlots.join(", ")}`);
  
  return {
    actionType,
    confidence,
    reasoning: `Classificado como ${actionType} com confiança ${(confidence * 100).toFixed(0)}%`,
    slots,
    missingSlots,
    shouldExecute,
    shouldAsk,
    question,
    buttons
  };
}

// ============================================================================
// 🤖 CHAMADA À IA (CASOS COMPLEXOS)
// ============================================================================

// Prompt fallback (hardcoded como backup se não houver no banco)
const FALLBACK_CLASSIFIER_PROMPT = `Você é Finax — um analisador semântico financeiro. Seu papel é interpretar INTENÇÕES humanas e extrair dados relevantes para o Decision Engine. Você NÃO executa ações, não registra dados e não decide fluxos: seu output é apenas uma interpretação semântica estruturada que será avaliada pelo Decision Engine.

⚖️ PRINCÍPIOS INEGOCIÁVEIS:
1) PRECEDÊNCIA ABSOLUTA: Se a mensagem contém um VERBO ou TERMO semântico que indique claramente uma intenção (ex.: recebi, caiu, entrou, ganhei, gastei, paguei, comprei, limite, fatura, cancela, quanto), essa intenção é considerada DEFINIDA e soberana.
2) NÚMERO ISOLADO: Considere "numero_isolado" somente quando o texto contiver APENAS um número.
3) CONFLITOS SEMÂNTICOS: Se houver sinais conflitantes claros, classifique como "desconhecido".

Retorne SEMPRE JSON válido com: tipo_operacao, acao, confianca, dados_extraidos, dados_faltantes, explicacao_interna.`;

async function callAIForDecision(
  message: string, 
  context: DecisionInput["context"]
): Promise<{ type: ActionType; confidence: number; slots: ExtractedSlots }> {
  try {
    let contextInfo = "";
    
    // Contexto de ação ativa
    if (context.hasActiveAction) {
      contextInfo = `
CONTEXTO ATIVO:
- Tipo: ${context.activeActionType}
- Intent: ${context.activeActionIntent}
- Slots: ${JSON.stringify(context.activeActionSlots)}
- Slot pendente: ${context.pendingSlot || "nenhum"}
`;
    }
    
    // ✅ Contexto conversacional (memória de curto prazo)
    if (context.conversationContext) {
      const cc = context.conversationContext;
      contextInfo += `
CONTEXTO DA CONVERSA ANTERIOR (memória de 30 min):
- Tópico atual: ${cc.currentTopic || "nenhum"}
- Última intenção: ${cc.lastIntent || "nenhuma"}
- Período consultado: ${cc.lastTimeRange || "mês (padrão)"}
- Tipo de consulta: ${cc.lastQueryScope || "resumo"}
${cc.lastCardName ? `- Último cartão citado: ${cc.lastCardName}` : ""}
${cc.lastCategory ? `- Última categoria: ${cc.lastCategory}` : ""}

⚠️ IMPORTANTE: O usuário pode fazer referências implícitas como:
- "e ontem?" → quer a MESMA query (${cc.lastQueryScope || "resumo"}) com período ONTEM
- "e hoje?" → quer a MESMA query com período HOJE
- "e semana passada?" → quer a MESMA query com período SEMANA_PASSADA
- "no primeiro cartão" / "no ${cc.lastCardName || "cartão anterior"}" → refere-se ao cartão anterior
- "mesma categoria" → usar categoria ${cc.lastCategory || "anterior"}

Você DEVE interpretar essas referências com base no contexto.
`;
    }
    
    // =========================================================================
    // 📝 BUSCAR PROMPT DO BANCO (COM FALLBACK)
    // =========================================================================
    const basePrompt = await getActivePrompt("finax_classifier", FALLBACK_CLASSIFIER_PROMPT);
    
    // Construir prompt final com contexto dinâmico
    const systemPrompt = `${basePrompt}

═══════════════════════════════════════════════════════════════
📊 CONTEXTO ATIVO
═══════════════════════════════════════════════════════════════
${contextInfo || "Nenhum contexto ativo."}

═══════════════════════════════════════════════════════════════
📊 REGRAS PARA QUERIES (CONSULTAS)
═══════════════════════════════════════════════════════════════

Quando tipo_operacao = "consulta", você DEVE SEMPRE retornar no dados_extraidos:
- query_scope: "expenses" | "income" | "all"
- start_date: data inicial em formato ISO 8601
- end_date: data final em formato ISO 8601
- time_range: "today" | "yesterday" | "week" | "month" | "custom"

DATA ATUAL DE REFERÊNCIA: ${new Date().toISOString()}

═══════════════════════════════════════════════════════════════
📤 SAÍDA OBRIGATÓRIA (JSON)
═══════════════════════════════════════════════════════════════

{
  "tipo_operacao": "entrada|gasto|recorrente|parcelamento|cartao|consulta|cancelamento|numero_isolado|desconhecido",
  "acao": "registrar|coletar|consultar|listar|atualizar|nenhuma",
  "confianca": 0.0-1.0,
  "evidencias_encontradas": ["lista", "de", "tokens"],
  "dados_extraidos": {
    "valor": null ou number,
    "descricao": null ou string,
    "categoria": null ou string,
    "forma_pagamento": null ou "pix" ou "debito" ou "credito" ou "dinheiro",
    "fonte": null ou string,
    "nome_cartao": null ou string,
    "num_parcelas": null ou integer,
    "query_scope": null ou string,
    "start_date": null ou string,
    "end_date": null ou string,
    "time_range": null ou string
  },
  "dados_faltantes": ["lista", "de", "campos"],
  "explicacao_interna": "Breve razão da decisão"
}`;

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
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"tipo_operacao": "desconhecido", "confianca": 0.3}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    // Mapear novo formato para ActionType
    const typeMap: Record<string, ActionType> = {
      "entrada": "income",
      "gasto": "expense",
      "cartao": "card_event",
      "consulta": "query",
      "cancelamento": "cancel",
      "numero_isolado": "unknown",
      "desconhecido": "unknown",
      "recorrente": "expense",
      "parcelamento": "expense"
    };
    
    const actionType = typeMap[parsed.tipo_operacao] || parsed.type || "unknown";
    
    const slots: ExtractedSlots = {};
    if (parsed.dados_extraidos) {
      if (parsed.dados_extraidos.valor) slots.amount = parsed.dados_extraidos.valor;
      if (parsed.dados_extraidos.descricao) slots.description = parsed.dados_extraidos.descricao;
      if (parsed.dados_extraidos.forma_pagamento) slots.payment_method = parsed.dados_extraidos.forma_pagamento;
      if (parsed.dados_extraidos.fonte) slots.source = parsed.dados_extraidos.fonte;
      if (parsed.dados_extraidos.nome_cartao) slots.card = parsed.dados_extraidos.nome_cartao;
      if (parsed.dados_extraidos.categoria) slots.category = parsed.dados_extraidos.categoria;
      
      // ✅ Mapear campos de query dinâmica
      if (parsed.dados_extraidos.query_scope) slots.query_scope = parsed.dados_extraidos.query_scope;
      if (parsed.dados_extraidos.start_date) slots.start_date = parsed.dados_extraidos.start_date;
      if (parsed.dados_extraidos.end_date) slots.end_date = parsed.dados_extraidos.end_date;
      if (parsed.dados_extraidos.time_range) slots.time_range = parsed.dados_extraidos.time_range;
    } else if (parsed.slots) {
      Object.assign(slots, parsed.slots);
    }
    
    console.log(`🤖 [DE AI] ${parsed.tipo_operacao || parsed.type} → ${actionType} (${((parsed.confianca || parsed.confidence || 0.5) * 100).toFixed(0)}%)`);
    console.log(`📋 [DE AI] Evidências: ${JSON.stringify(parsed.evidencias_encontradas || [])}`);
    console.log(`💡 [DE AI] Explicação: ${parsed.explicacao_interna || parsed.reasoning || "N/A"}`);
    
    return {
      type: actionType as ActionType,
      confidence: parsed.confianca || parsed.confidence || 0.5,
      slots
    };
  } catch (error) {
    console.error("❌ [DE AI] Erro:", error);
    return { type: "unknown", confidence: 0.2, slots: {} };
  }
}
