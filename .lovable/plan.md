

# Plano de Correcoes Completas - Finax index.ts e Sistema de Datas

## Resumo Executivo

Este plano cobre **4 areas criticas** que faltaram ser implementadas:

1. **Integracao do Sistema AI Decisions Tracking** no index.ts
2. **Correcao do salvamento inline** (substituir por funcoes do modulo)
3. **Padronizacao de datas para timezone Brasilia** em todas as respostas
4. **Imports faltantes** no index.ts

---

## PARTE 1: IMPORTS FALTANTES NO INDEX.TS

### 1.1 Adicionar Import do Modulo AI Decisions

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Linha:** Apos linha 24 (proximo aos outros imports de utils)

**Adicionar:**
```typescript
import { saveAIDecision, markAsExecuted, markAsIncorrect } from "./utils/ai-decisions.ts";
```

### 1.2 Adicionar Imports de Date Helpers Faltantes

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Linha 18:** Atualizar import existente

**De:**
```typescript
import { parseRelativeDate, getBrasiliaDate } from "./utils/date-helpers.ts";
```

**Para:**
```typescript
import { 
  parseRelativeDate, 
  getBrasiliaDate, 
  formatBrasiliaDateTime, 
  formatBrasiliaDate,
  getBrasiliaISO,
  getPaymentEmoji 
} from "./utils/date-helpers.ts";
```

---

## PARTE 2: SUBSTITUIR SALVAMENTO INLINE POR FUNCAO MODULAR

### 2.1 Substituir Bloco de Salvamento (Linhas 1236-1250)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Linhas:** 1236-1250

**DELETAR:**
```typescript
// SALVAR DECISÃO DA IA PARA ANALYTICS
try {
  await supabase.from("ai_decisions").insert({
    user_id: userId,
    message: message.slice(0, 500),
    message_type: "text",
    ai_classification: aiResult.actionType,
    ai_confidence: aiResult.confidence,
    ai_slots: aiResult.slots,
    ai_reasoning: aiResult.reason?.slice(0, 500),
    model_version: "gemini-2.5-flash"
  });
} catch (trackError) {
  logger.warn({ component: "ai_tracker" }, "Falha ao salvar decisao IA");
}
```

**SUBSTITUIR POR:**
```typescript
// ✅ SALVAR DECISÃO DA IA COM SISTEMA MODULAR
const decisionId = await saveAIDecision({
  userId,
  messageId: messageId || `msg_${Date.now()}`,
  message,
  messageType: "text",
  aiClassification: aiResult.actionType,
  aiConfidence: aiResult.confidence,
  aiSlots: aiResult.slots,
  aiReasoning: aiResult.reason,
  aiSource: "ai"
});
```

**NOTA:** O `messageId` precisa ser passado para a funcao `getDecisionFromMessage`. Verificar se ja esta disponivel no escopo.

---

## PARTE 3: INTEGRAR markAsExecuted APOS OPERACOES BEM-SUCEDIDAS

### 3.1 No Handler de EXPENSE (Linha ~3705)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Localizacao:** Apos `registerExpense` retornar sucesso

**Adicionar apos linha 3710:**
```typescript
// ✅ Marcar decisao como executada
if (typeof decisionId !== 'undefined' && decisionId) {
  await markAsExecuted(decisionId, result.success ?? true);
}
```

### 3.2 No Handler de INCOME (Linha ~3617)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Localizacao:** Apos `registerIncome` retornar sucesso

**Adicionar apos linha 3622:**
```typescript
// ✅ Marcar decisao como executada
if (typeof decisionId !== 'undefined' && decisionId) {
  await markAsExecuted(decisionId, true);
}
```

### 3.3 No Handler de RECURRING (Linha ~4037)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Localizacao:** Apos `registerRecurring` retornar sucesso

**Adicionar apos linha 4038:**
```typescript
// ✅ Marcar decisao como executada
if (typeof decisionId !== 'undefined' && decisionId) {
  await markAsExecuted(decisionId, result.success ?? true);
}
```

### 3.4 No Handler de INSTALLMENT (Linha ~4099)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Localizacao:** Apos `registerInstallment` retornar sucesso

**Adicionar apos linha 4104:**
```typescript
// ✅ Marcar decisao como executada
if (typeof decisionId !== 'undefined' && decisionId) {
  await markAsExecuted(decisionId, true);
}
```

---

## PARTE 4: INTEGRAR markAsIncorrect QUANDO USUARIO CANCELA

### 4.1 No Handler de CANCELAMENTO (procurar `cancelAction`)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Localizacao:** Onde o usuario cancela uma acao ativa

**Adicionar antes de `cancelAction(userId)`:**
```typescript
// ✅ Marcar decisao como incorreta (usuario cancelou)
if (activeAction && typeof decisionId !== 'undefined' && decisionId) {
  await markAsIncorrect(
    decisionId,
    "cancelled_by_user",
    `Usuario cancelou ${activeAction.intent}`
  );
}
```

---

## PARTE 5: CORRECAO DE DATAS - PADRONIZAR PARA BRASILIA

### 5.1 Corrigir Formatacao de Data no Query de INCOME (Linha 4552)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Linha:** 4552

**De:**
```typescript
const dataStr = new Date(e.data).toLocaleDateString("pt-BR");
```

**Para:**
```typescript
const dataStr = formatBrasiliaDate(e.data);
```

### 5.2 Corrigir dynamic-query.ts - Usar Timezone Brasilia

**Arquivo:** `supabase/functions/finax-worker/utils/dynamic-query.ts`
**Linha 54-59:** Calcular datas com timezone correto

**De:**
```typescript
} else {
  // ⚠️ IA não passou - calcular mês atual como fallback
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  queryStartDate = startOfMonth.toISOString();
  queryEndDate = new Date().toISOString();
}
```

**Para:**
```typescript
} else {
  // ⚠️ IA não passou - calcular mês atual como fallback (BRASILIA)
  const now = new Date();
  // Ajustar para Brasília (UTC-3)
  const brasiliaOffset = -3 * 60; // -3 horas em minutos
  const localOffset = now.getTimezoneOffset();
  const diff = brasiliaOffset - localOffset;
  now.setMinutes(now.getMinutes() + diff);
  
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  
  queryStartDate = startOfMonth.toISOString();
  queryEndDate = now.toISOString();
}
```

### 5.3 Adicionar Import no dynamic-query.ts

**Arquivo:** `supabase/functions/finax-worker/utils/dynamic-query.ts`
**Linha 8:** Adicionar import

**Adicionar:**
```typescript
import { formatBrasiliaDate, formatBrasiliaDateTime } from "./date-helpers.ts";
```

### 5.4 Usar formatBrasiliaDate na Formatacao de Resultados

**Arquivo:** `supabase/functions/finax-worker/utils/dynamic-query.ts`
**Linha 143:** Melhorar formatacao da lista

**De:**
```typescript
const lista = transactions.slice(0, maxItems).map(t => {
  const emoji = scope === "expenses" ? "💸" : "💰";
  const descricao = t.descricao || t.categoria || "Sem descrição";
  return `${emoji} R$ ${Number(t.valor).toFixed(2)} - ${descricao}`;
}).join("\n");
```

**Para:**
```typescript
const lista = transactions.slice(0, maxItems).map(t => {
  const emoji = scope === "expenses" ? "💸" : "💰";
  const descricao = t.descricao || t.categoria || "Sem descrição";
  const dataFormatada = t.data ? formatBrasiliaDate(t.data) : "";
  return `${emoji} R$ ${Number(t.valor).toFixed(2)} - ${descricao}${dataFormatada ? ` (${dataFormatada})` : ""}`;
}).join("\n");
```

---

## PARTE 6: PROPAGAR decisionId PARA TODO O FLUXO

### 6.1 Problema Identificado

O `decisionId` e gerado dentro da funcao `getDecisionFromMessage`, mas precisa ser acessivel em todo o fluxo principal para chamar `markAsExecuted` e `markAsIncorrect`.

### 6.2 Solucao: Retornar decisionId no Resultado

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Modificar a interface de retorno de `getDecisionFromMessage`:**

**Na linha ~1267-1273, modificar o retorno:**
```typescript
return {
  result: {
    ...aiResult,
    canExecuteDirectly: missing.length === 0,
    decisionId  // ← ADICIONAR
  },
  shouldBlockLegacyFlow: true
};
```

**E na linha ~1284-1290:**
```typescript
return {
  result: {
    ...aiResult,
    canExecuteDirectly: missingLowConf.length === 0,
    decisionId  // ← ADICIONAR
  },
  shouldBlockLegacyFlow: aiResult.confidence >= 0.5
};
```

### 6.3 Usar decisionId no Fluxo Principal

**No fluxo principal (onde chama `getDecisionFromMessage`), extrair o decisionId:**

**Procurar onde `getDecisionFromMessage` e chamado e adicionar:**
```typescript
const { result: decision, shouldBlockLegacyFlow } = await getDecisionFromMessage(...);
const decisionId = decision.decisionId; // ← EXTRAIR
```

---

## RESUMO DAS ALTERACOES

| Arquivo | Alteracao | Linhas |
|---------|-----------|--------|
| index.ts | Adicionar import ai-decisions | ~25 |
| index.ts | Atualizar import date-helpers | 18 |
| index.ts | Substituir salvamento inline | 1236-1250 |
| index.ts | Retornar decisionId | 1267, 1284 |
| index.ts | markAsExecuted em expense | ~3710 |
| index.ts | markAsExecuted em income | ~3622 |
| index.ts | markAsExecuted em recurring | ~4038 |
| index.ts | markAsExecuted em installment | ~4104 |
| index.ts | markAsIncorrect em cancel | Onde cancela |
| index.ts | Formatar data income | 4552 |
| dynamic-query.ts | Import date-helpers | 8 |
| dynamic-query.ts | Timezone Brasilia | 54-59 |
| dynamic-query.ts | Formatar datas na lista | 143 |

---

## ORDEM DE EXECUCAO

1. Adicionar imports no index.ts
2. Modificar retorno de getDecisionFromMessage para incluir decisionId
3. Substituir salvamento inline por saveAIDecision
4. Adicionar markAsExecuted em cada handler de sucesso
5. Adicionar markAsIncorrect no handler de cancel
6. Corrigir formatacao de datas no index.ts e dynamic-query.ts
7. Deploy e testar

---

## TESTES DE VALIDACAO

| Cenario | Resultado Esperado |
|---------|-------------------|
| "Pizza 30 pix" | ai_decisions salva com was_executed=true |
| "Cancelar" apos registrar | ai_decisions atualiza user_confirmed=false |
| "Quanto gastei ontem?" | Datas no formato DD/MM/YYYY |
| "Recebi 500 pix" | Data no timezone Brasilia (nao UTC) |

