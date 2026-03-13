# SPRINT 3 — Extrair Intents Inline para /intents/

## STATUS DO SPRINT 2 ✅

Mudanças concluídas:
1. ✅ Import de `defaultCloseAction` e `defaultCreateAction` em `expense-inline.ts`
2. ✅ `closeAction` usa fallback default (linha 327-330)
3. ✅ `createAction` usa fallback default na deduplicação (linha 206)
4. ✅ 3 `as any` removidos nos call sites de `registerExpense` (linhas 1780, 2940, 3196)
5. ✅ Fix de chaves quebradas no `expense-inline.ts`

---

## TESTES DO SPRINT 2 (faça ANTES de começar Sprint 3)

| # | Mensagem WhatsApp | Resultado esperado |
|---|-------------------|--------------------|
| 1 | "café 15 pix" | ✅ Registra gasto R$15 |
| 2 | "café 15 pix" (de novo em 30s) | ⚠️ Detecta duplicata, pergunta se quer registrar |
| 3 | Clicar "Sim, registrar" na duplicata | ✅ Registra a 2ª transação |
| 4 | Clicar "Não, era erro" na duplicata | ❌ Não registra nada |
| 5 | "almoço 30" → clicar "Pix" no botão | ✅ Registra gasto R$30 via pix |
| 6 | "uber 25 crédito" (com 2+ cartões) → selecionar cartão | ✅ Registra com cartão selecionado |
| 7 | Verificar no banco: `SELECT count(*) FROM transacoes WHERE valor = 15 AND created_at > now() - interval '5 minutes'` | Deve ter exatamente o número de vezes que você confirmou |

---

## OBJETIVO DO SPRINT 3

Extrair intents que ainda estão **inline no `index.ts`** para arquivos próprios em `/intents/`.

**Ordem de execução** (do mais simples ao mais complexo):

---

## TAREFA 3.1 — Extrair `set_context`

**O que é:** Quando o usuário diz "tô na praia" ou "viagem SP", cria um contexto ativo.
**Complexidade:** BAIXA (23 linhas)

### Onde está no index.ts

**Linhas 3811-3834** — bloco `else if (decision.actionType === "set_context")`

### O que fazer

**1. Criar arquivo** `supabase/functions/finax-worker/intents/set-context.ts`:

```typescript
// ============================================================================
// 📍 INTENT: SET_CONTEXT (Criar contexto de gastos)
// ============================================================================

import { createUserContext, getActiveContext, closeUserContext } from "./context-handler.ts";

export interface SetContextResult {
  success: boolean;
  message: string;
}

export async function handleSetContext(
  userId: string,
  slots: { context_label?: string; description?: string },
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<SetContextResult> {
  const label = slots.context_label || slots.description || "Contexto";
  
  // Fechar contexto ativo anterior
  const activeCtx = await getActiveContext(userId);
  if (activeCtx) {
    await closeUserContext(userId);
  }
  
  await createUserContext(userId, label);
  
  const message = `📍 *Contexto ativado: ${label}*\n\nA partir de agora, seus gastos serão vinculados a "${label}".\n\nQuando terminar, diga "encerrar contexto".`;
  
  return { success: true, message };
}
```

**2. No index.ts, substituir linhas 3811-3834** por:

```typescript
    } else if (decision.actionType === "set_context") {
      const { handleSetContext } = await import("./intents/set-context.ts");
      const result = await handleSetContext(userId, decision.slots, sendMessage, payload.phoneNumber, payload.messageSource);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
```

**3. Teste:** Enviar "tô na praia" → deve ativar contexto "praia"

---

## TAREFA 3.2 — Extrair `purchase`

**O que é:** Consultor de compras Pro-only ("devo comprar um iPhone?")
**Complexidade:** BAIXA (13 linhas, já tem arquivo `purchase.ts`)

### Onde está no index.ts

**Linhas 3795-3808** — bloco `else if (decision.actionType === "purchase")`

### O que fazer

**Nenhum arquivo novo** — `intents/purchase.ts` já existe com `analyzePurchase()`.

O bloco no index.ts **já faz dynamic import**:
```typescript
const { analyzePurchase } = await import("./intents/purchase.ts");
```

**Status:** ✅ JÁ EXTRAÍDO. Nada a fazer.

---

## TAREFA 3.3 — Extrair `goal` e `add_goal_progress`

**O que é:** Criar meta financeira / adicionar progresso
**Complexidade:** MÉDIA

### Onde está no index.ts

- **`goal`** — Linhas 3691-3790 (~100 linhas)
- **`add_goal_progress`** — Linhas 3604-3686 (~82 linhas)
- **`list_goals`** — Linhas 3549-3555 (~6 linhas)

### O que fazer

**Nenhum arquivo novo** — `intents/goals.ts` já existe com `createGoal()`, `listGoals()`, `addToGoal()`.

Os blocos no index.ts **já fazem dynamic import**. A lógica extra é:
- `goal`: slot filling + confirmação de nome/valor
- `add_goal_progress`: buscar meta por nome, pedir seleção se múltiplas

**Status:** ✅ JÁ EXTRAÍDO (lógica de orquestração fica no routing, ok).

---

## TAREFA 3.4 — Extrair `debt`, `list_debts`, `simulate_debts`

**Mesma situação** — `intents/debt-handler.ts` já existe. Dynamic import no index.ts.

**Status:** ✅ JÁ EXTRAÍDO.

---

## TAREFA 3.5 — Extrair `edit` (intent de edição)

**O que é:** Corrigir forma de pagamento de transação recente
**Complexidade:** MÉDIA (88 linhas)

### Onde está no index.ts

**Linhas 2665-2752** — bloco `if (decision.actionType === "edit")`

### Conteúdo atual (resumo)

```
1. Busca última transação do usuário
2. Se slot "new_payment_method" presente → atualiza direto
3. Se não → envia botões (Pix / Dinheiro / Crédito)
4. Chama updateTransactionPaymentMethod()
```

### O que fazer

**1. Criar arquivo** `supabase/functions/finax-worker/intents/edit.ts`:

```typescript
// ============================================================================
// ✏️ INTENT: EDIT (Corrigir transação)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { updateTransactionPaymentMethod } from "./cancel-handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export interface EditResult {
  success: boolean;
  message: string;
  needsSelection?: boolean;
  buttons?: Array<{ id: string; title: string }>;
}

export async function handleEdit(
  userId: string,
  slots: Record<string, any>,
  conteudoProcessado: string
): Promise<EditResult> {
  // Buscar última transação
  const { data: lastTx } = await supabase
    .from("transacoes")
    .select("id, descricao, valor, forma_pagamento, created_at")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  if (!lastTx) {
    return { success: false, message: "Não encontrei nenhuma transação recente para corrigir 🤔" };
  }
  
  const newPayment = slots.new_payment_method || slots.payment_method;
  
  if (newPayment && ["pix", "dinheiro", "credito", "debito"].includes(newPayment)) {
    const result = await updateTransactionPaymentMethod(lastTx.id, newPayment);
    if (result.success) {
      return {
        success: true,
        message: `✅ *Corrigido!*\n\n📝 ${lastTx.descricao}\n💰 R$ ${(lastTx.valor ?? 0).toFixed(2)}\n💳 ${lastTx.forma_pagamento} → ${newPayment}`
      };
    }
    return { success: false, message: "Erro ao corrigir 😕" };
  }
  
  // Precisa seleção
  return {
    success: false,
    needsSelection: true,
    message: `Qual a forma de pagamento correta para:\n📝 ${lastTx.descricao} - R$ ${(lastTx.valor ?? 0).toFixed(2)}?`,
    buttons: [
      { id: `edit_pix`, title: "Pix" },
      { id: `edit_dinheiro`, title: "Dinheiro" },
      { id: `edit_credito`, title: "Crédito" }
    ]
  };
}
```

**2. No index.ts, substituir linhas 2665-2752** por:

```typescript
    if (decision.actionType === "edit") {
      const { handleEdit } = await import("./intents/edit.ts");
      const editResult = await handleEdit(userId, decision.slots, conteudoProcessado);
      
      if (editResult.needsSelection && editResult.buttons) {
        await sendButtons(payload.phoneNumber, editResult.message, editResult.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, editResult.message, payload.messageSource);
      }
      return;
```

**3. Teste:** Enviar "café 15 pix", depois "corrigir para crédito" → deve corrigir

---

## TAREFA 3.6 — Extrair `set_budget`

**O que é:** Definir orçamento mensal por categoria
**Complexidade:** BAIXA (28 linhas)

### Onde está no index.ts

**Linhas 4667-4695** — bloco `else if (decision.actionType === "set_budget")`

### O que fazer

**Nenhum arquivo novo** — `intents/budget.ts` já existe com `setBudget()`.

O bloco **já faz import direto** de `setBudget`. Apenas orquestração.

**Status:** ✅ JÁ EXTRAÍDO.

---

## TAREFA 3.7 — Extrair `cancel` (routing completo)

**O que é:** Cancelar transação ou recorrente
**Complexidade:** ALTA (182 linhas)

### Onde está no index.ts

**Linhas 3837-4019** — bloco `else if (decision.actionType === "cancel")`

### Conteúdo atual (resumo)

```
1. Se slot "cancel_target" é "recorrente" → listActiveRecurrings → lista/botões
2. Se slot "cancel_target" é "transacao" → listTransactionsForCancel → lista/botões  
3. Se slot "description" presente → busca fuzzy → confirma cancelamento
4. Se nada identificado → pergunta "O que quer cancelar?"
```

### O que fazer

**1. Criar arquivo** `supabase/functions/finax-worker/intents/cancel-routing.ts`:

Copiar as linhas 3837-4019 do index.ts para este arquivo, encapsulando em:

```typescript
export async function handleCancelRouting(
  userId: string,
  slots: Record<string, any>,
  sendMessage: (...) => Promise<void>,
  sendButtons: (...) => Promise<void>,
  sendListMessage: (...) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  // [colar lógica das linhas 3837-4019 aqui]
}
```

**2. No index.ts, substituir 3837-4019** por:

```typescript
    } else if (decision.actionType === "cancel") {
      const { handleCancelRouting } = await import("./intents/cancel-routing.ts");
      await handleCancelRouting(userId, decision.slots, sendMessage, sendButtons, sendListMessage, payload.phoneNumber, payload.messageSource);
      return;
```

**3. Teste:** Enviar "cancelar café" → deve mostrar transação e confirmar

---

## TAREFA 3.8 — Extrair `query` (routing de consultas)

**O que é:** Todas as consultas de gastos (por período, categoria, etc.)
**Complexidade:** MUITO ALTA (590 linhas)

### Onde está no index.ts

**Linhas 4022-4612** — bloco `else if (decision.actionType === "query")`

### ATENÇÃO

Este é o maior bloco. **NÃO extrair tudo de uma vez.** Fazer em 2 etapas:

#### Etapa A: Criar `intents/query-routing.ts`

Copiar as linhas 4022-4612 para arquivo separado:

```typescript
export async function handleQueryRouting(
  userId: string,
  slots: Record<string, any>,
  nomeUsuario: string,
  sendMessage: (...) => Promise<void>,
  sendButtons: (...) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  // [colar lógica das linhas 4022-4612 aqui]
  // Manter todos os dynamic imports internos como estão
}
```

#### Etapa B: Substituir no index.ts

```typescript
    } else if (decision.actionType === "query") {
      const { handleQueryRouting } = await import("./intents/query-routing.ts");
      await handleQueryRouting(userId, decision.slots, nomeUsuario, sendMessage, sendButtons, payload.phoneNumber, payload.messageSource);
      return;
```

**Teste:** "quanto gastei esse mês" → resumo do mês

---

## TAREFA 3.9 — Extrair `control` (saudação/ajuda/negação)

**O que é:** "oi", "obrigado", "ajuda", "não"
**Complexidade:** MÉDIA (160 linhas)

### Onde está no index.ts

**Linhas 5008-5168** — bloco `else if (decision.actionType === "control")`

### O que fazer

**1. Criar arquivo** `supabase/functions/finax-worker/intents/control.ts`:

```typescript
export async function handleControl(
  userId: string,
  slots: Record<string, any>,
  nomeUsuario: string,
  conteudoProcessado: string,
  isProUser: boolean,
  sendMessage: (...) => Promise<void>,
  sendButtons: (...) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  // [colar lógica das linhas 5008-5168 aqui]
}
```

**2. No index.ts, substituir 5008-5168** por:

```typescript
    } else if (decision.actionType === "control") {
      const { handleControl } = await import("./intents/control.ts");
      await handleControl(userId, decision.slots, nomeUsuario, conteudoProcessado, isProUserFlag, sendMessage, sendButtons, payload.phoneNumber, payload.messageSource);
      return;
```

**3. Teste:** Enviar "oi" → saudação. Enviar "ajuda" → lista de comandos.

---

## RESUMO DE EXECUÇÃO

| # | Tarefa | Ação | Arquivo novo? | Linhas removidas do index.ts |
|---|--------|------|---------------|------------------------------|
| 3.1 | set_context | EXTRAIR | ✅ set-context.ts | ~23 |
| 3.2 | purchase | JÁ FEITO | ❌ | 0 |
| 3.3 | goal/list_goals | JÁ FEITO | ❌ | 0 |
| 3.4 | debt/list_debts | JÁ FEITO | ❌ | 0 |
| 3.5 | edit | EXTRAIR | ✅ edit.ts | ~88 |
| 3.6 | set_budget | JÁ FEITO | ❌ | 0 |
| 3.7 | cancel | EXTRAIR | ✅ cancel-routing.ts | ~182 |
| 3.8 | query | EXTRAIR | ✅ query-routing.ts | ~590 |
| 3.9 | control | EXTRAIR | ✅ control.ts | ~160 |

**Total de linhas removidas do index.ts:** ~1.043 linhas
**index.ts depois:** ~4.391 linhas → avanço significativo

---

## ORDEM DE EXECUÇÃO

1. **3.1 (set_context)** → deploy → teste → ✅
2. **3.5 (edit)** → deploy → teste → ✅
3. **3.9 (control)** → deploy → teste → ✅
4. **3.7 (cancel)** → deploy → teste → ✅
5. **3.8 (query)** → deploy → teste → ✅ (ÚLTIMO porque é o maior)

**Depois de cada extração:** testar no WhatsApp o fluxo correspondente.
**Se quebrar:** reverter APENAS aquela extração.
