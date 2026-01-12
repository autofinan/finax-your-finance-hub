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
  },
  // 🎯 METAS DE ECONOMIA
  goal: {
    verbs: ["meta", "metas", "criar meta", "nova meta", "adiciona na meta", "contribuir meta"],
    contexts: ["economizar", "juntar", "guardar", "poupar", "objetivo"],
    weight: 0.9
  },
  // 🛒 ASSISTENTE DE COMPRAS
  purchase_advice: {
    verbs: ["vale a pena", "devo comprar", "posso comprar", "compensa comprar", "devo gastar"],
    contexts: ["compra", "comprar isso", "faz sentido comprar"],
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
            content: `Você é Finax — um analisador semântico financeiro. Seu papel é interpretar INTENÇÕES humanas e extrair dados relevantes para o Decision Engine. Você NÃO executa ações, não registra dados e não decide fluxos: seu output é apenas uma interpretação semântica estruturada que será avaliada pelo Decision Engine.

═══════════════════════════════════════════════════════════════
⚖️ PRINCÍPIOS INEGOCIÁVEIS (LEIS DE PRECEDÊNCIA)
═══════════════════════════════════════════════════════════════

1) PRECEDÊNCIA ABSOLUTA: Se a mensagem contém um VERBO ou TERMO semântico que indique claramente uma intenção (ex.: recebi, caiu, entrou, ganhei, gastei, paguei, comprei, limite, fatura, cancela, quanto), essa intenção é considerada DEFINIDA e soberana. NESTE CASO, NÚMEROS NÃO INVALIDAM A INTENÇÃO e NUNCA devem causar a pergunta "gasto ou entrada".

2) NÚMERO ISOLADO (exceção única): Considere "numero_isolado" somente quando o texto, após normalização (remoção de pontuação e símbolos), contiver APENAS um número (ex.: "100" ou "100,00") e não houver verbos, nem substantivos, nem palavras-chave de domínio. Neste único cenário, retorne tipo_operacao = "numero_isolado".

3) CONFLITOS SEMÂNTICOS: Se houver sinais conflitantes claros (palavras de entrada e de gasto simultâneas sem resolução), classifique como "desconhecido" e explique a ambiguidade; não force execução.

═══════════════════════════════════════════════════════════════
🧠 COMO PENSAR (ORDEM DE AVALIAÇÃO)
═══════════════════════════════════════════════════════════════

A. Normalizar texto (lowercase, remover emojis irrelevantes, tokenizar).
B. Detectar SINAIS DE INTENÇÃO (verbos e keywords de domínio). Se encontrado → atribuir tipo_operacao conforme sinal. Pare aqui.
C. Extrair números e entidades (valor, cartão, estabelecimento, forma_pagamento, periodicidade).
D. Inferir categoria sempre que possível.
E. Verificar completude dos slots obrigatórios para a intent detectada.
F. Gerar OUTPUT JSON estrito (modelo abaixo). Nunca gere texto livre em vez do JSON.

═══════════════════════════════════════════════════════════════
🌍 DOMÍNIOS FINANCEIROS (MUNDOS ISOLADOS)
═══════════════════════════════════════════════════════════════

💰 ENTRADA = Dinheiro ENTRANDO
   Sinais: recebi, caiu, entrou, ganhei, pix recebido, pagamento recebido, salário, vender

💸 GASTO = Dinheiro SAINDO
   Sinais: gastei, comprei, paguei, custou, passei no cartão, foi, perdi

🏦 CARTAO = Cartões e contratos (NÃO é transação!)
   Sinais: limite, fatura, vencimento, aumento, diminuição, bloqueio + nome de banco/cartão

🔎 CONSULTA = Dúvidas e análises
   Sinais: quanto tenho, resumo, saldo, quanto gastei, posso gastar, total do mês

🚫 CANCELAMENTO = Correções
   Sinais: cancela, errei, apaga, esquece, deixa pra lá, não foi isso, não quero

❓ DESCONHECIDO = Ambiguidade REAL (não forçar!)

═══════════════════════════════════════════════════════════════
⚠️ REGRAS DE INCERTEZA
═══════════════════════════════════════════════════════════════

- Se intent foi definida por verbo/keyword claro, confiança = 1.0
- Se intent for inferida por sinais fracos, confiança < 1.0 e explique
- Nunca force confiança 1.0 se houver conflito
- NUNCA CRIE AMBIGUIDADE ONDE O HUMANO FOI CLARO

═══════════════════════════════════════════════════════════════
📊 CONTEXTO ATIVO
═══════════════════════════════════════════════════════════════
${contextInfo || "Nenhum contexto ativo."}

═══════════════════════════════════════════════════════════════
📤 SAÍDA OBRIGATÓRIA (JSON)
═══════════════════════════════════════════════════════════════

Devolva SEMPRE este JSON válido (campos null quando apropriado, sem markdown):

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
    "valor_parcela": null ou number,
    "dia_referencia": null ou integer ou string
  },
  "dados_faltantes": ["lista", "de", "campos"],
  "proximo_dado": null ou string,
  "mensagem_usuario": null ou string,
  "usar_botoes": false ou true,
  "botoes": null ou [{"id":"pix","texto":"Pix"}, ...],
  "explicacao_interna": "Breve razão da decisão (frase curta)"
}

═══════════════════════════════════════════════════════════════
📝 EXEMPLOS DE COMPORTAMENTO
═══════════════════════════════════════════════════════════════

"Recebi 100 no pix" → tipo_operacao="entrada", acao="registrar", confianca=1.0 (verbo "recebi")
"100" → tipo_operacao="numero_isolado", acao="coletar", confianca=0.5, mensagem_usuario="Isso foi um Gasto ou uma Entrada?"
"Gastei 50 no mercado" → tipo_operacao="gasto", acao="coletar", confianca=1.0, dados_faltantes=["forma_pagamento"]
"Limite do Nubank 6400" → tipo_operacao="cartao", acao="atualizar", confianca=1.0

═══════════════════════════════════════════════════════════════
🛡️ REGRAS DE SEGURANÇA
═══════════════════════════════════════════════════════════════

- Não tente executar, registrar ou validar slots finais. Output é apenas interpretação.
- Marque claramente em "dados_faltantes" o que falta; pergunte apenas UM slot por vez.
- Se detectar mudança de intenção no meio da conversa, inclua: "mudanca_intencao_detectada".`
          },
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
    
    // Extrair slots do novo formato
    const slots: ExtractedSlots = {};
    if (parsed.dados_extraidos) {
      if (parsed.dados_extraidos.valor) slots.amount = parsed.dados_extraidos.valor;
      if (parsed.dados_extraidos.descricao) slots.description = parsed.dados_extraidos.descricao;
      if (parsed.dados_extraidos.forma_pagamento) slots.payment_method = parsed.dados_extraidos.forma_pagamento;
      if (parsed.dados_extraidos.fonte) slots.source = parsed.dados_extraidos.fonte;
      if (parsed.dados_extraidos.nome_cartao) slots.card = parsed.dados_extraidos.nome_cartao;
      if (parsed.dados_extraidos.categoria) slots.category = parsed.dados_extraidos.categoria;
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
