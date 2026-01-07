// ============================================================================
// 🧠 DECISION ENGINE - PEÇA CENTRAL DO FINAX
// ============================================================================
//
// O Decision Engine é responsável por:
// 1. Classificar a intenção da mensagem ANTES de qualquer slot filling
// 2. Determinar se temos confiança suficiente para agir
// 3. Decidir exatamente O QUE perguntar (se necessário)
//
// REGRAS DE OURO:
// - IA DECIDE, regras VALIDAM, fluxo EXECUTA
// - Nunca perguntar algo que o usuário já disse
// - Nunca misturar tipos de ação (expense ≠ income ≠ card_event)
// ============================================================================

import { 
  ActionType, 
  DecisionInput, 
  DecisionOutput, 
  ExtractedSlots,
  SLOT_REQUIREMENTS,
  SLOT_PROMPTS 
} from "./types.ts";

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
  // ENTRADA - alta prioridade
  income: {
    verbs: ["recebi", "recebido", "receber", "ganhei", "caiu", "entrou", "entrada", "recebimento"],
    contexts: ["salario", "salário", "pagamento recebido", "pix recebido", "transferencia recebida"],
    weight: 0.95
  },
  // CARTÃO - alta prioridade
  card_event: {
    verbs: ["limite", "atualiza", "atualizar", "alterou", "aumentou"],
    contexts: ["nubank", "itau", "itaú", "bradesco", "santander", "c6", "inter", "picpay", "cartao", "cartão"],
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
  
  // PASSO 1: Classificação semântica rápida (sem IA)
  const semanticResult = classifySemanticIntent(message);
  console.log(`🏷️ [DE] Semântico: ${semanticResult.type} (${(semanticResult.confidence * 100).toFixed(0)}%) - ${semanticResult.reason}`);
  
  // PASSO 2: Se confiança alta E tipo claro → decidir sem IA
  if (semanticResult.confidence >= 0.9 && semanticResult.type !== "unknown") {
    console.log(`⚡ [DE] Decisão rápida: ${semanticResult.type}`);
    
    // Extrair slots básicos do texto
    const quickSlots = extractQuickSlots(message, semanticResult.type);
    
    return buildDecision(semanticResult.type, semanticResult.confidence, quickSlots, context);
  }
  
  // PASSO 3: Se há contexto ativo e mensagem parece resposta
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
  
  // PASSO 4: Chamar IA para casos complexos
  const aiResult = await callAIForDecision(message, context);
  
  return buildDecision(aiResult.type, aiResult.confidence, aiResult.slots, context);
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

async function callAIForDecision(
  message: string, 
  context: DecisionInput["context"]
): Promise<{ type: ActionType; confidence: number; slots: ExtractedSlots }> {
  try {
    let contextInfo = "";
    if (context.hasActiveAction) {
      contextInfo = `
CONTEXTO ATIVO:
- Tipo: ${context.activeActionType}
- Intent: ${context.activeActionIntent}
- Slots: ${JSON.stringify(context.activeActionSlots)}
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
          {
            role: "system",
            content: `Você é o Decision Engine do Finax. Classifique a intenção do usuário.

${contextInfo}

TIPOS DE AÇÃO (escolha UM):
- "expense" = gasto (verbos: gastei, comprei, paguei)
- "income" = entrada (verbos: recebi, ganhei, caiu)
- "card_event" = cartão (limite, atualização)
- "cancel" = cancelar algo
- "query" = consulta/resumo
- "unknown" = não identificado

REGRAS ABSOLUTAS:
1. "Recebi X" = SEMPRE "income", NUNCA "expense"
2. "Limite do cartão X" = SEMPRE "card_event", NUNCA "expense"
3. Número sozinho sem verbo = "unknown" (perguntar se é gasto ou entrada)
4. Verbos de ENTRADA: recebi, ganhei, caiu, entrou
5. Verbos de SAÍDA: gastei, comprei, paguei, custou

Responda APENAS JSON:
{
  "type": "expense|income|card_event|cancel|query|unknown",
  "confidence": 0.0-1.0,
  "slots": {
    "amount": número ou null,
    "description": "string" ou null,
    "payment_method": "pix|debito|credito|dinheiro" ou null,
    "source": "pix|dinheiro|transferencia" ou null,
    "card": "nome do cartão" ou null,
    "value": número (para limite) ou null
  }
}`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"type": "unknown", "confidence": 0.3}';
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    console.log(`🤖 [DE AI] ${parsed.type} (${(parsed.confidence * 100).toFixed(0)}%)`);
    
    return {
      type: parsed.type as ActionType,
      confidence: parsed.confidence || 0.5,
      slots: parsed.slots || {}
    };
  } catch (error) {
    console.error("❌ [DE AI] Erro:", error);
    return { type: "unknown", confidence: 0.2, slots: {} };
  }
}
