

# Plano de Correção: 7 Bugs + 2 Problemas Web

## Resumo dos Problemas

Foram identificados 7 bugs no backend (finax-worker) e 2 no frontend web. O plano aborda cada um cirurgicamente.

---

## Bug 1 — Interceptor disparando em gastos novos

**Arquivo:** `supabase/functions/finax-worker/index.ts` (linhas ~1109-1160)

**Problema:** "50 mercado pix" dispara o interceptor de correção de pagamento em vez de registrar como gasto novo. O interceptor verifica se `paymentMentioned` existe e se a última transação tem `forma_pagamento = outro/null`, mas não verifica se a mensagem atual TEM valor e descrição (o que indica gasto novo, não correção).

**Fix:** Antes da linha 1117, adicionar guard:

```typescript
const hasAmountInMessage = /\d+/.test(conteudoProcessado);
const hasDescriptionInMessage = decision?.slots?.description && decision?.slots?.amount;
const isOnlyPaymentCorrection = !hasDescriptionInMessage && !hasAmountInMessage;

// Só interceptar se for APENAS correção de pagamento
if (paymentMentioned && isOnlyPaymentCorrection) {
```

Isso garante que "50 mercado pix" (tem amount + description) passe direto para o intent router como expense.

---

## Bug 2 — FSM aceita texto inválido para slot `installments`

**Arquivo:** `supabase/functions/finax-worker/fsm/context-handler.ts` (função `fillPendingSlot`, ~linha 291+)

**Problema:** O slot `installments` aceita qualquer texto, inclusive "todo mes gasto 50 de combustivel", que é uma mensagem de intent completamente diferente.

**Fix:** No `fillPendingSlot`, antes do handler genérico, adicionar case especial para `installments`:

```typescript
if (pendingSlot === "installments") {
  const num = parseInt(normalized.replace(/\D/g, ""), 10);
  if (isNaN(num) || num < 2 || num > 72) {
    const retryCount = incrementRetry(activeAction.id);
    if (retryCount >= MAX_RETRIES) {
      resetRetry(activeAction.id);
      return { handled: false, shouldContinue: true, shouldCancel: true, cancelled: true };
    }
    return {
      handled: true, shouldContinue: false,
      message: "Quantas parcelas? Manda só o número (ex: 2, 6, 12) 🔢"
    };
  }
  resetRetry(activeAction.id);
  return {
    handled: true, shouldContinue: false,
    filledSlot: "installments", slotValue: num,
    updatedSlots: { ...activeAction.slots, installments: num },
    readyToConfirm: true
  };
}
```

---

## Bug 3 — Descrição de recorrente salva como "Todo mes gasto"

**Arquivo:** `supabase/functions/finax-worker/intents/recurring-handler.ts` (função `registerRecurring`, linha ~111-113)

**Problema:** A `refineRecurringDescription` existe em `intent-router.ts` mas NÃO é chamada dentro de `registerRecurring`. A descrição chega crua.

**Fix:** Importar e aplicar `refineRecurringDescription` de `core/intent-router.ts` dentro de `registerRecurring`, ou duplicar a lógica inline:

```typescript
// Em registerRecurring, após "const descricao = slots.description || "";"
const descricaoRefinada = refineDescription(conteudoOriginal || descricao, descricao);
```

Onde `refineDescription` aplica a mesma limpeza: remove "todo mês/pago/gasto/de", remove valores numéricos, capitaliza o que sobrar. A função já existe em `intent-router.ts` - basta exportá-la e importá-la, ou mover para um `utils/text-helpers.ts`.

---

## Bug 4 — Cancelamento de recorrente não reflete na web

**Arquivos:** `src/hooks/useGastosRecorrentes.ts` + `src/pages/Recorrentes.tsx`

**Problema 1:** O hook `useGastosRecorrentes` faz `SELECT *` sem filtrar `.eq("ativo", true)`. Recorrências canceladas (ativo=false) continuam aparecendo.

**Problema 2:** O hook não tem realtime subscription. Mudanças feitas via WhatsApp não atualizam a tela.

**Problema 3 (console log):** Delete falha com `foreign key constraint "transacoes_id_recorrente_fkey"` — precisa desvincular transações antes de deletar.

**Fix:**
1. Adicionar `.eq("ativo", true)` na query de `fetchGastos`
2. Adicionar canal realtime para `gastos_recorrentes` (similar ao `useDashboard`)
3. No `deleteGasto`, antes do delete, fazer `UPDATE transacoes SET id_recorrente = null WHERE id_recorrente = id`

---

## Bug 5 — "oi" tratado como slot de action pendente

**Arquivo:** `supabase/functions/finax-worker/index.ts` (ACK detection, ~linha 730)

**Problema:** A ACK detection está na posição correta (Prioridade 0), MAS quando há uma action ativa com `pending_slot`, ela retorna silenciosamente sem responder. O log mostra "cancela o spotify" → action criada com `pending_slot: selection` → "oi" chega → FSM tenta processar como seleção numérica → "Hmm, não entendi".

**Fix:** Na ACK detection (linha 734-738), em vez de retornar silenciosamente, responder com emoji e manter o estado:

```typescript
if (activeAction && activeAction.pending_slot) {
  await sendMessage(payload.phoneNumber, "😊", payload.messageSource);
  return; // mantém estado da FSM
}
```

Adicionalmente, no `fsm/context-handler.ts`, adicionar ACK_WORDS no topo do `fillPendingSlot` para rejeitar cortesias:

```typescript
const ACK_WORDS = ["oi", "ola", "bom dia", "boa tarde", "boa noite", "opa"];
if (ACK_WORDS.some(w => normalized === w)) {
  return { handled: true, shouldContinue: false, message: "😊 Tô aqui! Responde a pergunta anterior 👆" };
}
```

---

## Bug 6 — Lista de cartões para recorrente mostra máximo 3

**Arquivo:** `supabase/functions/finax-worker/handlers/payment-callbacks.ts` (linhas ~200-215)

**Problema:** `cards.slice(0, 3)` corta a lista. WhatsApp limita botões a 3, mas pode usar `sendListMessage` para mais.

**Fix:**

```typescript
if (paymentMethod === "credito") {
  const cards = await listCardsForUser(userId);
  if (cards.length > 3) {
    // Usar lista interativa para 4+ cartões
    await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "card" });
    await sendListMessage(phoneNumber,
      `🔄 ${updatedSlots.description || "Recorrente"} - R$ ${updatedSlots.amount?.toFixed(2)}/mês\n\nQual cartão?`,
      "Ver cartões",
      [{ title: "Seus cartões", rows: cards.map(c => ({
        id: `rec_card_${c.id}`,
        title: (c.nome || "Cartão").slice(0, 24),
        description: `Disponível: R$ ${(c.limite_disponivel ?? 0).toFixed(2)}`
      }))}],
      messageSource
    );
    return true;
  } else if (cards.length > 1) {
    // Botões para 2-3 cartões (como já funciona)
    ...
  }
}
```

---

## Bug 7 — Formato da mensagem de gasto

**Arquivo:** `supabase/functions/finax-worker/intents/expense-inline.ts` (linha ~379)

**Problema:** O formato atual usa `*-R$ ${valor.toFixed(2)}*` com ponto decimal. O formato desejado usa vírgula e layout específico.

**Fix:** Alterar a linha 379:

```typescript
const valorFormatado = valor.toFixed(2).replace(".", ",");
let message = `${emoji} *Gasto registrado!*\n\n` +
  `💸 -R$ ${valorFormatado}\n` +
  `📂 ${categoria}\n` +
  `${descricao ? `📝 ${descricao}\n` : ""}` +
  `💳 ${formaPagamento}${cardInfo}\n` +
  `📅 ${dataFormatada} às ${horaFormatada}${contextInfo}`;
```

---

## Problema Web 8 — 404 no refresh de página

**Arquivo:** `vite.config.ts`

**Problema:** SPA com client-side routing. Quando o usuário recarrega `/recorrentes`, o servidor não sabe rotear e retorna 404.

**Fix:** A Lovable preview já deveria tratar isso. Se o deploy em produção (Vercel) dá 404, precisa de `vercel.json` com rewrite. Para a preview, isso é tratado automaticamente. Se persistir, adicionar ao `vite.config.ts`:

```typescript
server: {
  host: "::",
  port: 8080,
  historyApiFallback: true, // Não é opção do Vite
}
```

Na verdade no Vite o SPA fallback é automático em dev. O problema pode ser na **publicação**. Verificar se existe `public/_redirects` (Netlify) ou configuração equivalente. Para Vercel, criar `vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

---

## Problema Web 9 — Sessão nunca expira

**Arquivo:** `src/contexts/AuthContext.tsx`

**Problema:** O token `finax_session_token` fica no localStorage indefinidamente. A `refreshUser` valida via edge function, mas se a validação falha por erro de rede, a sessão local persiste. Além disso, o Supabase Auth session gera erro `refresh_token_not_found` (visível nos console logs), mas o app não limpa a sessão nesses casos.

**Fix:**
1. No `useEffect` inicial, ao detectar `SIGNED_OUT` do Supabase Auth, também limpar os tokens Finax
2. Adicionar TTL check no token: se `finax_session_token` foi criado há mais de X dias, forçar revalidação

---

## Testes de Regressão Críticos

| # | Cenário | Entrada | Esperado |
|---|---------|---------|----------|
| 1 | Gasto completo inline | "50 mercado pix" | Registra gasto, NÃO dispara interceptor |
| 2 | Correção de pagamento | (registrar gasto) → "foi no pix" | Corrige forma de pagamento |
| 3 | Parcelamento completo | "roupa 200 em 2x crédito" → cartão → NÃO pedir parcelas de novo | Registra parcelamento |
| 4 | FSM rejeita texto em installments | (durante parcelamento) → "todo mes gasto 50" | Re-pergunta número de parcelas |
| 5 | Recorrente com descrição boa | "todo mes gasto 50 de combustivel" | Salva descrição "Combustível" |
| 6 | Cancelar recorrente contextual | "cancela o spotify" | Cancela e reflete na web |
| 7 | Web mostra só ativos | Abrir /recorrentes | Não mostra recorrências canceladas |
| 8 | Delete recorrente na web | Clicar lixeira em recorrente | Não dá erro de FK |
| 9 | ACK durante FSM | (durante seleção) → "oi" | Responde emoji, mantém estado |
| 10 | 4+ cartões em recorrente | Recorrente crédito com 4+ cartões | Mostra lista, não botões |
| 11 | Formato de mensagem | Qualquer gasto | Formato com vírgula e layout correto |
| 12 | Refresh de página | F5 em /recorrentes | Não dá 404 |
| 13 | Sessão após dias | Reabrir app após 3+ dias | Revalida ou redireciona para login |

---

## Ordem de Implementação

1. **Bug 2** (FSM installments) — mais crítico, corrompe dados
2. **Bug 1** (Interceptor) — bloqueia gastos novos
3. **Bug 3** (Descrição recorrente) — qualidade de dados
4. **Bug 5** (ACK na FSM) — UX quebrada
5. **Bug 6** (Lista de cartões) — limitação de UI
6. **Bug 7** (Formato mensagem) — cosmético
7. **Bug 4 + Problema 8** (Web: filtro ativo, FK, realtime)
8. **Problema 9** (Sessão) — auth hardening

