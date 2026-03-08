// ============================================================================
// 🧠 AI ENGINE - Decision Engine v7.0 (UNIFIED + CoT + Tool Calling)
// ============================================================================
// CHANGELOG v7.0:
// - Unificado ai-classifier.ts (v5.0) + ai-engine.ts (v3.2)
// - Chain-of-Thought obrigatório (campo thinking)
// - Tool Calling para JSON garantido (0% parsing failures)
// - Sistema de 3 níveis de confiança
// - Flags: subject_change_detected, escape_detected
// - Intenções: skip, debt, list_debts, simulate_debts, query_freedom
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyDeterministic } from "./classifier.ts";
import { parseBrazilianAmount } from "../utils/parseAmount.ts";
import { logger } from "../utils/logger.ts";
import { saveAIDecision } from "../utils/ai-decisions.ts";
import { 
  hasAllRequiredSlots, getMissingSlots,
  type ActionType 
} from "../ui/slot-prompts.ts";
import { normalizeText, isNumericOnly, parseNumericValue, extractSlotValue } from "../utils/helpers.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// ============================================================================
// 📦 TIPOS
// ============================================================================

export type MessageSource = "meta" | "vonage";
export type TipoMidia = "text" | "audio" | "image";

export interface ExtractedSlots {
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

export interface SemanticResult {
  actionType: ActionType;
  confidence: number;
  slots: ExtractedSlots;
  reason: string;
  canExecuteDirectly: boolean;
  decisionId?: string | null;
  subjectChangeDetected?: boolean;
  escapeDetected?: boolean;
}

export interface ActiveAction {
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
  meta?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ============================================================================
// 🧠 FINAX PROMPT v7.0 - UNIFIED (CoT + Tool Calling)
// ============================================================================
export const PROMPT_FINAX_UNIVERSAL = `# FINAX v7.0 - INTÉRPRETE HUMANO DE LINGUAGEM NATURAL

## 🎯 QUEM VOCÊ É

Você é um intérprete HUMANO de linguagem financeira.
Você ENTENDE o que as pessoas QUEREM DIZER, mesmo com linguagem casual.

## 🧠 REGRA DE OURO: RACIOCINE ANTES DE DECIDIR

OBRIGATÓRIO: Use o campo "thinking" para raciocinar passo a passo ANTES de decidir.
Formato: "1. Usuário disse X → 2. Isso indica Y → 3. Conclusão: Z"
NUNCA pule o raciocínio. Seja BREVE (1-2 linhas).

## 📚 TIPOS DE INTENÇÃO

### expense - Gasto pontual
Dinheiro SAINDO em compra única.
Indicadores: "gastei", "paguei", "comprei", "custou"
Slots: amount, payment_method, description, category, card
Exemplos: "Mercado 180", "Uber 30 pix", "Dentista 360 débito"

**REGRA DE DESCRIÇÃO (CRÍTICA):**
O slot \`description\` DEVE conter APENAS o item/local/serviço comprado (1-4 palavras).
- ✅ Correto: "café da manhã", "uber", "mercado", "netflix", "casquinha", "pipoca"
- ❌ Errado: "Cara hoje cedo fui tomar café da manhã e gastei"
- ❌ Errado: "Eu paguei no mercado ontem"
- ❌ Errado: "Esqueci de registar um gasto de ontem, foi meu Uber paguei no débito"
**Como extrair:** Identificar o SUBSTANTIVO principal (o que foi comprado/pago). Remover verbos, conversação, contexto temporal.
Exemplos: "Cara fui tomar café da manhã e gastei 20" → "café da manhã" | "paguei meu uber" → "uber" | "comprei roupa na loja" → "roupa"

**REGRA DE PAYMENT_METHOD (CRÍTICA):**
Se o usuário mencionou forma de pagamento na mensagem, SEMPRE extrair para \`payment_method\`.
- "paguei 5 no débito" → payment_method: "debito"
- "gastei 30 no pix" → payment_method: "pix"
- "comprei no crédito" → payment_method: "credito"
NUNCA deixar payment_method vazio se o usuário informou.

### income - Entrada de dinheiro
Dinheiro CHEGANDO.
Indicadores: "recebi", "caiu", "entrou", "ganhei", "mandaram", "me mandaram", "pingou", "depositaram", "transferiram"
Slots: amount, source, description
Exemplos: "Recebi 1500", "Caiu 200 de freela", "Me mandaram 200", "Pingou 50 aqui"
⚠️ REGRA: "me mandaram X", "pingou X", "caiu X" = SEMPRE income com amount=X

### installment - Compra parcelada ⚠️ PRIORIDADE sobre expense se tiver "Nx"
Slots: amount (TOTAL), installments, description, card
Exemplos: "Celular 1200 em 12x", "Roupa 300 em 5x no Nubank"
REGRA: Valor informado = TOTAL!

### recurring - Gasto fixo mensal ⚠️ PRIORIDADE sobre expense se tiver periodicidade
Slots: amount, description, periodicity, day_of_month, payment_method
Exemplos: "Netflix 40 todo mês", "Academia 99 mensal"

### add_card - Cadastrar novo cartão ⚠️ PRIORIDADE sobre card_event
Indicadores: "registrar", "adicionar", "cadastrar", "novo cartão", "meu cartão é"
Slots: card_name, limit, due_day, closing_day

### card_event - Atualizar cartão existente
Indicadores: "limite do [banco]" (SEM "registrar/adicionar")
Slots: card, value

### bill - Conta com vencimento ⚠️ PRIORIDADE sobre recurring para utilidades
Slots: bill_name, due_day

### pay_bill - Pagar conta existente
Indicadores: "paguei a conta de", "foi", "deu"
Slots: bill_name, amount

### goal - Meta de economia ⚠️ PRIORIDADE sobre income para "guardei/juntei/poupei"
Indicadores: "meta", "juntar", "guardar", "economizar", "guardei", "juntei", "poupei", "depositei"
Slots: amount, description, deadline
Exemplos: 
  - "guardei 200" → goal (NÃO income!)
  - "juntei 300 pro carro" → goal
⚠️ REGRA CRITICA: "guardei/juntei/poupei/economizei" + valor = SEMPRE goal, NUNCA income!

### purchase - Consulta de compra
Indicadores: "vale a pena", "posso comprar", "devo gastar"
Slots: amount, description

### set_budget - Definir orçamento
Indicadores: "orçamento", "orcamento", "limite mensal", "gastar no máximo", "teto", "controlar gastos"
Slots: amount, category (opcional)
Exemplos: "Orçamento" → set_budget (0.95), "Meu limite mensal é 3000"

### query - Consultar informações
Indicadores: "quanto", "resumo", "saldo", "total", "meus", "quais", "cartões", "ver gastos", "como estão", "detalhe", "detalhado", "meus gastos", "gastos do mês", "me mostra"
Slots: query_scope (summary|cards|expenses|income|pending|recurring|category|budgets|debts|installments|goals|invoice_detail|invoice_future|weekly_report), time_range (today|yesterday|week|month|last_week|last_month), category
REGRAS IMPORTANTES:
- "ver gastos" / "meus gastos" / "como estão meus gastos" / "me mostra gastos" → query_scope: "expenses"
- "detalhe [categoria]" / "detalha outros" / "mais sobre alimentação" → query_scope: "expenses", category: "[categoria]"
- "detalhado" / "quero detalhado" / "por categoria" → query_scope: "category"
- "saude e alimentação" (múltiplas categorias) → query_scope: "expenses" (retornar TODAS, o sistema filtra)
- "relatório semanal" → query_scope: "weekly_report"
- "fatura" → query_scope: "invoice_detail"
- "meus parcelamentos" → query_scope: "installments"
- "minhas metas" → query_scope: "goals"

### query_alerts - Ver alertas
Indicadores: "alertas", "avisos"

### cancel - Cancelar algo
Indicadores: "cancela", "desfaz", "apaga", "remove", "esquece", "deixa pra lá"
Slots: cancel_target, target_name

### skip - Pular/Não responder ⚠️ PRIORIDADE MÁXIMA se detectar escape
Indicadores: "não sei", "nenhuma", "nenhum", "depois", "pula", "deixa pra lá"

### chat - Conversa/conselho financeiro
Exemplos: "Tô gastando muito?", "Como economizar?"
NUNCA retorne unknown para perguntas - use chat!

### set_context - Período especial (viagem/evento)
Slots: label, start_date, end_date, action (start|end)

### control - Saudações e controle
"Oi", "Bom dia", "Ajuda", "Vamos", "Bora", "Ok", "Tchau"

### edit - Correção rápida
Indicadores: "era", "errei", "corrige"

### debt - Registrar dívida
Indicadores: "registrar dívida", "tenho dívida", "empréstimo", "financiamento"
Slots: nome, saldo_devedor, tipo, taxa_juros, valor_minimo

### list_debts - Listar dívidas
Indicadores: "minhas dívidas", "quanto devo", "ver dívidas"

### simulate_debts - Simular quitação
Indicadores: "simular quitação", "quanto tempo pra quitar"

### query_freedom - Dias de liberdade financeira
Indicadores: "liberdade financeira", "quando vou quitar", "dias de liberdade"

### unknown - Último recurso (confidence < 0.5 E nenhuma categoria acima)

## ⚖️ PRIORIDADES

1. skip/cancel > qualquer (se escape)
2. set_budget/goal/debt > expense (se palavras-chave claras)
3. installment > expense (se "Nx")
4. recurring > expense (se periodicidade)
5. bill > recurring (se utilidades)
6. add_card > card_event (se "registrar/adicionar")
7. goal > income (se "guardei/juntei/poupei")
8. purchase > chat (se pergunta + valor)
9. chat > unknown (SEMPRE)

## 🚨 SLOTS: INGLÊS APENAS!
amount, description, payment_method (pix|debito|credito|dinheiro), card, source, installments, bill_name, due_day, closing_day, query_scope, time_range, cancel_target, target_name, label, deadline, periodicity, day_of_month, nome, saldo_devedor, tipo, taxa_juros, valor_minimo

## 🔄 CONTINUIDADE (FOLLOW-UP)
Se mensagem curta com "e " + categoria/período, copie intent anterior trocando apenas o campo mencionado.

## 📜 HISTÓRICO
Use histórico para desambiguar. Se Bot enviou lembrete de conta e usuário confirma valor → pay_bill (NÃO expense).

## 🔍 DETECÇÃO ESPECIAL
- Mudança de assunto → subject_change_detected: true
- Escape/desistência → escape_detected: true`;

// ============================================================================
// 🔧 TOOL CALLING SCHEMA - JSON GARANTIDO
// ============================================================================

const FINAX_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "classify_intent",
    description: "Classifica a intenção do usuário e extrai dados estruturados da mensagem financeira.",
    parameters: {
      type: "object",
      properties: {
        thinking: {
          type: "string",
          description: "Raciocínio breve passo a passo (1-2 linhas). Ex: '1. guardei = poupar → 2. goal com amount=200'"
        },
        actionType: {
          type: "string",
          enum: [
            "expense", "income", "installment", "recurring", "add_card", "card_event",
            "bill", "pay_bill", "goal", "purchase", "set_budget", "query", "query_alerts",
            "cancel", "skip", "chat", "set_context", "control", "edit",
            "debt", "list_debts", "simulate_debts", "query_freedom", "unknown"
          ],
          description: "Tipo de intenção identificada"
        },
        confidence: {
          type: "number",
          description: "Confiança de 0.0 a 1.0"
        },
        slots: {
          type: "object",
          description: "Dados extraídos da mensagem (amount, description, payment_method, etc.)",
          additionalProperties: true
        },
        reasoning: {
          type: "string",
          description: "Explicação concisa da decisão"
        },
        subject_change_detected: {
          type: "boolean",
          description: "True se o usuário mudou de assunto"
        },
        escape_detected: {
          type: "boolean",
          description: "True se o usuário quer desistir/pular"
        }
      },
      required: ["thinking", "actionType", "confidence", "slots", "reasoning"],
      additionalProperties: false
    }
  }
};

// ============================================================================
// 🔧 NORMALIZAÇÃO DE SLOTS DA IA
// ============================================================================
export function normalizeAISlots(slots: Record<string, any>): ExtractedSlots {
  const normalized: ExtractedSlots = {};
  
  if (slots.amount !== undefined) {
    if (typeof slots.amount === 'string') {
      normalized.amount = parseBrazilianAmount(slots.amount) || 0;
    } else {
      normalized.amount = Number(slots.amount);
    }
  }
  
  if (slots.value !== undefined) {
    if (typeof slots.value === 'string') {
      normalized.value = parseBrazilianAmount(slots.value) || 0;
    } else {
      normalized.value = Number(slots.value);
    }
  }
  if (slots.installments !== undefined) normalized.installments = Number(slots.installments);
  if (slots.limit !== undefined) normalized.limit = Number(slots.limit);
  if (slots.due_day !== undefined) normalized.due_day = Number(slots.due_day);
  if (slots.closing_day !== undefined) normalized.closing_day = Number(slots.closing_day);
  if (slots.day_of_month !== undefined) normalized.day_of_month = Number(slots.day_of_month);
  
  if (slots.description) normalized.description = String(slots.description);
  if (slots.category) normalized.category = String(slots.category);
  if (slots.card) normalized.card = String(slots.card);
  if (slots.card_name) normalized.card_name = String(slots.card_name);
  if (slots.bill_name) normalized.bill_name = String(slots.bill_name);
  if (slots.source) normalized.source = String(slots.source).toLowerCase();
  if (slots.label) normalized.label = String(slots.label);
  if (slots.deadline) normalized.deadline = String(slots.deadline);
  if (slots.start_date) normalized.start_date = String(slots.start_date);
  if (slots.end_date) normalized.end_date = String(slots.end_date);
  if (slots.date_range) normalized.date_range = slots.date_range;
  
  if (slots.payment_method) {
    const pm = String(slots.payment_method).toLowerCase();
    const paymentMap: Record<string, string> = {
      "pix": "pix", "débito": "debito", "debito": "debito",
      "crédito": "credito", "credito": "credito", "cartão": "credito",
      "dinheiro": "dinheiro",
    };
    normalized.payment_method = paymentMap[pm] || pm;
  }
  
  if (slots.periodicity) {
    const periodicityMap: Record<string, string> = {
      "mensal": "monthly", "semanal": "weekly", "anual": "yearly",
      "monthly": "monthly", "weekly": "weekly", "yearly": "yearly",
    };
    normalized.periodicity = periodicityMap[String(slots.periodicity).toLowerCase()] || "monthly";
  }
  
  if (slots.query_scope) normalized.query_scope = String(slots.query_scope).toLowerCase();
  if (slots.time_range) normalized.time_range = String(slots.time_range).toLowerCase();
  if (slots.cancel_target) normalized.cancel_target = String(slots.cancel_target).toLowerCase();
  if (slots.target_name) normalized.target_name = String(slots.target_name);
  if (slots.action) normalized.action = String(slots.action).toLowerCase();
  
  Object.keys(slots).forEach(key => {
    if (!(key in normalized) && slots[key] !== undefined && slots[key] !== null) {
      normalized[key] = slots[key];
    }
  });
  
  return normalized;
}

// ============================================================================
// 🤖 CHAMADA À IA - COM TOOL CALLING + CoT
// ============================================================================
export async function callAIForDecision(
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

⚠️ Se a mensagem é sobre OUTRO ASSUNTO, marque subject_change_detected: true
`;
    }

    const systemContent = PROMPT_FINAX_UNIVERSAL + "\n\n" + contextInfo +
      (history ? "\n\n--- HISTORICO ---\n" + history + "\n--- FIM ---\n\n" +
      "Use o historico para desambiguar. Lembrete de conta + valor = pay_bill (moradia)." : "");

    // Tentar Tool Calling primeiro (JSON garantido)
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: message }
        ],
        tools: [FINAX_TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "classify_intent" } },
      }),
    });

    const data = await response.json();
    
    // Extrair resultado do Tool Calling
    let parsed: any = null;
    
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        parsed = JSON.parse(toolCall.function.arguments);
        logger.info({ component: "ai-engine", method: "tool_calling" }, "Tool Calling success");
      } catch (e) {
        logger.warn({ component: "ai-engine", error: String(e) }, "Tool Calling parse failed, trying fallback");
      }
    }
    
    // Fallback: extrair do content (caso Tool Calling não funcione)
    if (!parsed) {
      const content = data.choices?.[0]?.message?.content || '{"actionType": "unknown", "confidence": 0.3}';
      const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
      try {
        parsed = JSON.parse(cleanJson);
        logger.info({ component: "ai-engine", method: "content_fallback" }, "Content fallback success");
      } catch (e) {
        console.error("❌ [AI] JSON inválido em ambos métodos:", cleanJson.slice(0, 200));
        return { actionType: "unknown", confidence: 0.3, slots: {}, reason: "JSON inválido da IA", canExecuteDirectly: false };
      }
    }
    
    // Log do raciocínio CoT
    if (parsed.thinking) {
      console.log(`💭 [CoT] ${parsed.thinking}`);
    }
    
    const normalizedSlots = normalizeAISlots(parsed.slots || {});
    const actionType = parsed.actionType || "unknown";
    const canExecute = hasAllRequiredSlots(actionType, normalizedSlots);
    
    const subjectChangeDetected = parsed.subject_change_detected === true;
    const escapeDetected = parsed.escape_detected === true;
    
    console.log(`🤖 [AI v7] ${actionType} | Conf: ${parsed.confidence} | Slots: ${JSON.stringify(normalizedSlots)} | Exec: ${canExecute}${subjectChangeDetected ? " | 🔄 MUDANÇA" : ""}${escapeDetected ? " | 🚪 ESCAPE" : ""}`);
    
    return {
      actionType,
      confidence: parsed.confidence || 0.5,
      slots: normalizedSlots,
      reason: parsed.reasoning || "",
      canExecuteDirectly: canExecute,
      subjectChangeDetected,
      escapeDetected
    };
  } catch (error) {
    console.error("❌ [AI] Erro:", error);
    return { actionType: "unknown", confidence: 0.3, slots: {}, reason: "Erro na IA", canExecuteDirectly: false };
  }
}

// ============================================================================
// 🚫 GUARD CLAUSES DE DOMÍNIO
// ============================================================================
export function assertDomainIsolation(
  decidedType: ActionType, 
  activeAction: ActiveAction | null
): { valid: boolean; shouldDiscard: boolean } {
  if (!activeAction) return { valid: true, shouldDiscard: false };
  
  const currentType = activeAction.intent.includes("entrada") || activeAction.intent === "income" ? "income"
    : activeAction.intent.includes("card") || activeAction.intent === "card_event" ? "card_event"
    : activeAction.intent.includes("gasto") || activeAction.intent === "expense" ? "expense"
    : activeAction.intent;
  
  if (decidedType !== "unknown" && decidedType !== "cancel" && decidedType !== "control") {
    if (decidedType !== currentType) {
      console.log(`🚫 [GUARD] Domínio incompatível: contexto=${currentType}, decisão=${decidedType} → descartando`);
      return { valid: true, shouldDiscard: true };
    }
  }
  
  return { valid: true, shouldDiscard: false };
}

// ============================================================================
// 🎯 DECISION ENGINE PRINCIPAL v7.0 - 3 NÍVEIS DE CONFIANÇA
// ============================================================================
// High (≥0.8): Executa direto
// Medium (0.5-0.79): Confirma ("Você quis X?")
// Low (<0.5): Clarify ("Você quis X ou Y?")
// ============================================================================
export async function decisionEngine(
  message: string,
  activeAction: ActiveAction | null,
  userId: string,
  history?: string,
  payloadType?: string
): Promise<{ result: SemanticResult; shouldBlockLegacyFlow: boolean }> {
  
  console.log(`\n🧠 [DECISION ENGINE v7.0 - UNIFIED] ━━━━━━━━━━━━━━━━`);
  console.log(`📩 Mensagem: "${message.slice(0, 60)}..." | Tipo: ${payloadType || 'unknown'}`);
  console.log(`📋 Arquitetura: Fast-Track → IA (Tool Calling + CoT) → 3 Níveis`)
  
  // PRIORIDADE MÁXIMA: SELEÇÃO NUMÉRICA
  if (activeAction && activeAction.pending_slot === "selection" && isNumericOnly(message)) {
    const index = parseInt(message.trim()) - 1;
    const options = activeAction.slots.options as string[];
    
    if (options && index >= 0 && index < options.length) {
      return {
        result: {
          actionType: "cancel" as ActionType,
          confidence: 0.99,
          slots: { ...activeAction.slots, selected_id: options[index], selection_index: index, selection_intent: activeAction.intent },
          reason: `Seleção numérica: item ${index + 1}`,
          canExecuteDirectly: true
        },
        shouldBlockLegacyFlow: true
      };
    } else {
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
  
  // NÚMERO ISOLADO
  if (payloadType === 'text' && isNumericOnly(message)) {
    const numValue = parseNumericValue(message);
    
    if (activeAction && activeAction.pending_slot === "amount" && numValue) {
      const actionType = activeAction.intent as ActionType;
      const mergedSlots = { ...activeAction.slots, amount: numValue };
      const missing = getMissingSlots(actionType, mergedSlots);
      
      return {
        result: { actionType, confidence: 0.95, slots: mergedSlots, reason: "Número preencheu slot pendente", canExecuteDirectly: missing.length === 0 },
        shouldBlockLegacyFlow: true
      };
    }
    
    return {
      result: { actionType: "unknown", confidence: 0.1, slots: { amount: numValue || undefined }, reason: "Número isolado sem contexto", canExecuteDirectly: false },
      shouldBlockLegacyFlow: false
    };
  }
  
  // SLOT PENDENTE
  if (activeAction && activeAction.pending_slot) {
    const slotValue = extractSlotValue(message, activeAction.pending_slot);
    
    if (slotValue !== null) {
      const actionType = activeAction.intent.includes("income") ? "income" 
        : activeAction.intent.includes("expense") ? "expense"
        : activeAction.intent.includes("recurring") ? "recurring"
        : activeAction.intent as ActionType;
      
      const mergedSlots = { ...activeAction.slots, [activeAction.pending_slot]: slotValue };
      
      return {
        result: { actionType, confidence: 0.95, slots: mergedSlots, reason: `Slot ${activeAction.pending_slot} preenchido`, canExecuteDirectly: getMissingSlots(actionType, mergedSlots).length === 0 },
        shouldBlockLegacyFlow: true
      };
    }
  }
  
  // CLASSIFICAÇÃO DETERMINÍSTICA
  const deterministicResult = classifyDeterministic(message);
  logger.info({ component: "classifier", actionType: deterministicResult.actionType, confidence: deterministicResult.confidence, source: deterministicResult.source }, "Classificacao deterministica concluida");

  if (deterministicResult.source === "deterministic" && deterministicResult.actionType === "unknown" && deterministicResult.slots.possible_description) {
    return {
      result: { actionType: "unknown", confidence: 0.4, slots: deterministicResult.slots, reason: deterministicResult.reason, canExecuteDirectly: false },
      shouldBlockLegacyFlow: false
    };
  }

  if (deterministicResult.source === "deterministic" && deterministicResult.confidence >= 0.9) {
    const detActionType = deterministicResult.actionType as ActionType;
    const missing = getMissingSlots(detActionType, deterministicResult.slots);
    
    return {
      result: { actionType: detActionType, confidence: deterministicResult.confidence, slots: deterministicResult.slots, reason: deterministicResult.reason, canExecuteDirectly: missing.length === 0 },
      shouldBlockLegacyFlow: true
    };
  }

  // IA CLASSIFICA (com Tool Calling + CoT)
  const aiResult = await callAIForDecision(
    message,
    { hasActiveAction: !!activeAction, activeActionType: activeAction?.intent, activeActionSlots: activeAction?.slots, pendingSlot: activeAction?.pending_slot },
    history
  );
  
  // ================================================================
  // ✅ CRITICAL FIX v2: Merge fast-track slots com AI slots
  // REGRA: Fast-track slots são SEMPRE a base. AI slots SOMENTE
  // sobrescrevem se têm valor REAL (não vazio/null/undefined).
  // Isso previne que a IA perca dados estruturais do fast-track.
  // ================================================================
  const mergedSlots: Record<string, any> = {};
  
  // 1. Copiar TODOS os slots do fast-track como base
  const ftSlots = deterministicResult.slots || {};
  for (const key of Object.keys(ftSlots)) {
    if (ftSlots[key] !== undefined && ftSlots[key] !== null && ftSlots[key] !== '') {
      mergedSlots[key] = ftSlots[key];
    }
  }
  
  // 2. Sobrescrever SOMENTE com slots da IA que têm valor real
  const aiSlots = aiResult.slots || {};
  for (const key of Object.keys(aiSlots)) {
    if (aiSlots[key] !== undefined && aiSlots[key] !== null && aiSlots[key] !== '') {
      mergedSlots[key] = aiSlots[key];
    }
  }
  
  // 3. Garantir que slots numéricos do fast-track não foram perdidos
  if (ftSlots.amount && !mergedSlots.amount) mergedSlots.amount = ftSlots.amount;
  if (ftSlots.description && !mergedSlots.description) mergedSlots.description = ftSlots.description;
  if (ftSlots.payment_method && !mergedSlots.payment_method) mergedSlots.payment_method = ftSlots.payment_method;
  if (ftSlots.card && !mergedSlots.card) mergedSlots.card = ftSlots.card;
  
  // Normalizar os slots merged
  const finalSlots = normalizeAISlots(mergedSlots);
  
  // Atualizar aiResult com slots merged para logging correto
  const mergedAiResult = { ...aiResult, slots: finalSlots };
  
  console.log(`🔗 [MERGE] FT: ${JSON.stringify(ftSlots)} | AI: ${JSON.stringify(aiSlots)} | FINAL: ${JSON.stringify(finalSlots)}`);
  
  const decisionId = await saveAIDecision({
    userId,
    messageId: `msg_${Date.now()}`,
    message,
    messageType: "text",
    aiClassification: mergedAiResult.actionType,
    aiConfidence: mergedAiResult.confidence,
    aiSlots: mergedAiResult.slots,
    aiReasoning: mergedAiResult.reason,
    aiSource: "ai_v7_tool_calling"
  });
  
  // ================================================================
  // 🎯 SISTEMA DE 3 NÍVEIS DE CONFIANÇA
  // ================================================================
  
  const confidence = mergedAiResult.confidence;
  const missing = getMissingSlots(mergedAiResult.actionType, mergedAiResult.slots);
  
  // NÍVEL 1: HIGH CONFIDENCE (≥0.8) → Executa direto
  if (confidence >= 0.8 && mergedAiResult.actionType !== "unknown") {
    console.log(`✅ [CONFIDENCE] HIGH (${confidence}) → Execução direta`);
    return {
      result: { ...mergedAiResult, canExecuteDirectly: missing.length === 0, decisionId },
      shouldBlockLegacyFlow: true
    };
  }
  
  // NÍVEL 2: MEDIUM CONFIDENCE (0.5-0.79) → Confirma
  if (confidence >= 0.5 && mergedAiResult.actionType !== "unknown") {
    console.log(`⚠️ [CONFIDENCE] MEDIUM (${confidence}) → Confirmação sugerida`);
    return {
      result: { ...mergedAiResult, canExecuteDirectly: missing.length === 0, decisionId },
      shouldBlockLegacyFlow: true
    };
  }
  
  // NÍVEL 3: LOW CONFIDENCE (<0.5) → Clarify
  console.log(`❓ [CONFIDENCE] LOW (${confidence}) → Clarificação necessária`);
  return {
    result: { ...mergedAiResult, canExecuteDirectly: false, decisionId },
    shouldBlockLegacyFlow: confidence >= 0.3
  };
}
