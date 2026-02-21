// ============================================================================
// 🧠 AI CLASSIFIER - Extraído de index.ts para modularização
// ============================================================================
// Contém o prompt universal, normalização de slots e chamada à IA.
// ============================================================================

import { parseBrazilianAmount } from "../utils/parseAmount.ts";
import { 
  hasAllRequiredSlots, getMissingSlots,
  type ActionType 
} from "../ui/slot-prompts.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// ============================================================================
// 📦 TIPOS
// ============================================================================

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
}

// ============================================================================
// 🧠 FINAX PROMPT v3.2 - INTERPRETADOR SEMÂNTICO
// ============================================================================
export const PROMPT_FINAX_UNIVERSAL = `# FINAX - INTERPRETADOR SEMÂNTICO v3.2

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
Guardar dinheiro para objetivo OU adicionar progresso a meta existente.
Indicadores: "meta", "juntar", "guardar", "economizar", "guardei", "juntei", "tenho X para Y", "poupei", "depositei"
Slots: amount, description, deadline
Exemplos: 
  - "Criar meta de 5000 para viagem"
  - "guardei 200" → goal (NÃO income!) - slots: {amount: 200}
  - "ja tenho 500 para o trafego pago" → goal - slots: {amount: 500, description: "trafego pago"}
  - "juntei 300 pro carro" → goal - slots: {amount: 300, description: "carro"}
  - "poupei 150" → goal - slots: {amount: 150}

⚠️ REGRA CRITICA: "guardei", "juntei", "poupei", "economizei" + valor = SEMPRE goal, NUNCA income!
"guardar dinheiro" é sobre METAS, não sobre receber dinheiro.

### purchase - Consulta de compra ⚠️ PRIORIDADE sobre chat se for pergunta com valor
Perguntar se DEVE comprar algo específico.
Indicadores: "vale a pena", "posso comprar", "devo gastar", "consigo comprar"
Slots: amount, description
Exemplos: "Vale a pena comprar celular de 2000?"

### set_budget - Definir orçamento/limite de gastos
Definir limite mensal geral ou por categoria.
Indicadores: "limite mensal", "orçamento", "gastar no máximo", "teto de", "definir limite"
Slots: amount, category (opcional - se não informar, é global)
Exemplos: 
  - "Meu limite mensal é 3000" → amount: 3000 (global)
  - "Quero gastar no máximo 500 com alimentação" → amount: 500, category: alimentacao
  - "Definir orçamento de 2000 para lazer" → amount: 2000, category: lazer
  - "Meu teto é 4000 por mês" → amount: 4000 (global)

### query - Consultar informações
Ver dados, não modificar.
Indicadores: "quanto", "resumo", "saldo", "total", "meus", "quais", "cartões", "pendentes", "detalhe", "detalhar"
Slots: query_scope, time_range, category
- query_scope: summary | cards | expenses | income | pending | recurring | category | budgets
- time_range: today | week | month | custom
- category: alimentacao | transporte | moradia | lazer | saude | educacao | mercado | servicos | compras | outros
Exemplos: 
  - "Quanto gastei esse mês?" → query_scope: expenses, time_range: month
  - "Meus cartões" → query_scope: cards
  - "Quais cartões tenho?" → query_scope: cards
  - "Gastos pendentes" → query_scope: pending
  - "Gastos da semana" → query_scope: expenses, time_range: week
  - "Quanto gastei hoje?" → query_scope: expenses, time_range: today
  - "Resumo" → query_scope: summary
  - "Detalhe alimentação" → query_scope: expenses, category: alimentacao, time_range: month
  - "Gastos com transporte" → query_scope: expenses, category: transporte, time_range: month
  - "Ver lazer" → query_scope: expenses, category: lazer, time_range: month
  - "Quanto gastei com alimentação?" → query_scope: expenses, category: alimentacao, time_range: month
  - "Quais meus orçamentos?" → query_scope: budgets
  - "Ver meus limites" → query_scope: budgets
  - "Meus orçamentos" → query_scope: budgets

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

### debt - Registrar dívida
Cadastrar nova dívida (cartão, empréstimo, financiamento).
Indicadores: "registrar dívida", "tenho dívida", "adicionar dívida", "minha dívida"
Slots: nome, saldo_devedor, tipo (cartao|emprestimo|financiamento|cheque_especial), taxa_juros, valor_minimo
Exemplos: "Registrar dívida Nubank 5000", "Tenho dívida de 10000 no banco"

### list_debts - Listar dívidas
Consultar dívidas ativas.
Indicadores: "minhas dívidas", "quanto devo", "listar dívidas", "ver dívidas"
Exemplos: "Quais minhas dívidas?", "Quanto eu devo?"

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

## 🚨 NOMENCLATURA OBRIGATÓRIA DE SLOTS (INGLÊS APENAS!)

SEMPRE use estes nomes EXATOS em inglês. NUNCA traduza para português.

| Intent | Slots Obrigatórios | Opcional |
|--------|-------------------|----------|
| expense | amount, payment_method | description, category, card |
| income | amount | description, source |
| recurring | amount, description, payment_method | day_of_month, periodicity |
| installment | amount, installments | description, card |
| goal | amount, description | deadline |
| query | query_scope | time_range |
| cancel | | cancel_target, target_name |

### Exemplo CORRETO:
{
  "actionType": "expense",
  "confidence": 0.92,
  "slots": {
    "amount": 50,
    "description": "cafe",
    "payment_method": "pix"
  }
}

### ERRADO (NUNCA FAÇA):
{
  "slots": {
    "valor": 50,
    "descricao": "cafe",
    "forma_pagamento": "pix"
  }
}

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
  "actionType": "expense|income|installment|recurring|add_card|card_event|bill|pay_bill|goal|purchase|set_budget|query|query_alerts|cancel|chat|set_context|control|edit|debt|list_debts|unknown",
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

## REGRA CRITICA: HISTORICO DA CONVERSA

Quando o HISTORICO mostra que voce (Bot) enviou:
- Lembrete de conta (agua, luz, gas, internet, aluguel, condominio, energia)
- Alerta de fatura de cartao
- Confirmacao de recorrente processada

E o usuario responde com valor ou confirma pagamento:
- Classifique como pay_bill (NAO expense)
- Categoria: moradia (para contas de consumo)
- "agua", "luz", "gas", "internet" = conta de consumo, NUNCA alimentacao
- Use o historico para desambiguar

Quando o HISTORICO mostra conversa sobre um topico especifico:
- Mantenha o contexto da conversa
- NAO mude de assunto a menos que o usuario mude explicitamente
- Se o usuario diz "paguei" + nome que aparece no historico recente = pay_bill

## REGRA CRITICA: CONTINUIDADE DE CONVERSA (FOLLOW-UP)

Quando o usuario envia mensagem CURTA que parece continuar a conversa anterior:
- "e transporte" → Se a ultima pergunta foi "quanto gastei com alimentação", entenda como "quanto gastei com transporte"
- "e lazer" → mesma logica: repete a consulta anterior trocando a categoria
- "e esse mes?" → repete a ultima consulta com periodo = mes atual
- "e na semana?" → repete a ultima consulta com periodo = semana

REGRA: Se a mensagem comeca com "e " ou "e o/a " seguido de categoria/periodo, copie o actionType e slots da ultima interacao e substitua apenas o campo mencionado.
- actionType: query (mesmo tipo da consulta anterior)
- Mantenha time_range, query_scope do historico
- Troque apenas: category, card, ou time_range conforme a mensagem

NUNCA classifique follow-ups como "set_budget", "expense" ou "unknown". Se o historico mostra query, o follow-up e query.

RESPONDA APENAS COM JSON. SEM MARKDOWN. SEM EXPLICAÇÕES ADICIONAIS.`;

// ============================================================================
// 🔧 NORMALIZAÇÃO DE SLOTS DA IA
// ============================================================================

export function normalizeAISlots(slots: Record<string, any>): ExtractedSlots {
  const normalized: ExtractedSlots = {};
  
  // Amount
  if (slots.amount !== undefined) {
    if (typeof slots.amount === 'string') {
      normalized.amount = parseBrazilianAmount(slots.amount) || 0;
    } else {
      normalized.amount = Number(slots.amount);
    }
  }
  
  // Outros valores numéricos
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
  
  // Strings
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
  
  // Payment method
  if (slots.payment_method) {
    const pm = String(slots.payment_method).toLowerCase();
    const paymentMap: Record<string, string> = {
      "pix": "pix",
      "débito": "debito",
      "debito": "debito",
      "crédito": "credito",
      "credito": "credito",
      "cartão": "credito",
      "dinheiro": "dinheiro",
    };
    normalized.payment_method = paymentMap[pm] || pm;
  }
  
  // Periodicity
  if (slots.periodicity) {
    const periodicityMap: Record<string, string> = {
      "mensal": "monthly",
      "semanal": "weekly",
      "anual": "yearly",
      "monthly": "monthly",
      "weekly": "weekly",
      "yearly": "yearly",
    };
    normalized.periodicity = periodicityMap[String(slots.periodicity).toLowerCase()] || "monthly";
  }
  
  // Query e cancel slots
  if (slots.query_scope) normalized.query_scope = String(slots.query_scope).toLowerCase();
  if (slots.time_range) normalized.time_range = String(slots.time_range).toLowerCase();
  if (slots.cancel_target) normalized.cancel_target = String(slots.cancel_target).toLowerCase();
  if (slots.target_name) normalized.target_name = String(slots.target_name);
  if (slots.action) normalized.action = String(slots.action).toLowerCase();
  
  // Fallback: Copiar slots não processados
  Object.keys(slots).forEach(key => {
    if (!(key in normalized) && slots[key] !== undefined && slots[key] !== null) {
      normalized[key] = slots[key];
    }
  });
  
  return normalized;
}

// ============================================================================
// 🤖 CHAMADA À IA PARA CLASSIFICAÇÃO
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
          { role: "system", content: PROMPT_FINAX_UNIVERSAL + "\n\n" + contextInfo +
            (history ? "\n\n--- HISTORICO RECENTE DA CONVERSA (use para entender contexto) ---\n" + history + "\n--- FIM DO HISTORICO ---\n\n" +
            "REGRA CRITICA: Use o historico acima para entender o contexto da conversa. " +
            "Se o Bot enviou lembrete de conta (agua, luz, gas, internet, aluguel, condominio, energia) " +
            "e o usuario confirma pagamento ou informa valor, classifique como pay_bill, " +
            "categoria moradia, NAO alimentacao. 'agua', 'luz', 'gas' no contexto de contas = moradia." : "")
          },
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
    
    const normalizedSlots = normalizeAISlots(parsed.slots || {});
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
// 🚫 GUARD CLAUSE DE DOMÍNIO
// ============================================================================

export function assertDomainIsolation(
  decidedType: ActionType, 
  activeAction: { intent: string } | null
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
// 🔧 EXTRATOR DE SLOT SIMPLES
// ============================================================================

export function extractSlotValue(message: string, slotType: string): any {
  const normalized = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "").trim();
  
  switch (slotType) {
    case "amount":
    case "value":
      const numMatch = message.match(/(\d+[.,]?\d*)/);
      if (numMatch) return parseBrazilianAmount(numMatch[1]);
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
