

# Plano: Correcao de Bugs dos Testes de Regressao (Lote 3)

## Bugs Identificados (8 problemas)

---

## Bug 1 — Divida: "tenho uma divida de 5000 no cartao" nao extrai slots

**Arquivo:** `supabase/functions/finax-worker/core/intent-router.ts` (linha 1116)

**Causa:** A IA classifica como `debt` mas nao extrai `nome` e `saldo_devedor` nos slots (sao campos em portugues no `types.ts`). O `registerDebt` exige ambos e retorna "Preciso do nome e saldo devedor". A segunda mensagem "cartao nubank 5000" cai no fallback porque nao ha FSM/action criada para coletar slots pendentes de debt.

**Fix:** No intent-router, quando `debt` chega sem slots completos:
1. Tentar extrair `nome` e `saldo_devedor` do `conteudoProcessado` (regex: valor numerico = saldo, texto restante = nome)
2. Se ainda faltar, criar action com `pending_slot` para coletar via FSM
3. Adicionar case "debt" no FSM router para coletar slots pendentes

```typescript
// intent-router.ts - debt handler
if (decision.actionType === "debt") {
  let { nome, saldo_devedor, tipo } = decision.slots;
  
  // Extrair do texto se slots vazios
  if (!saldo_devedor) {
    const match = conteudoProcessado.match(/(\d+[.,]?\d*)/);
    if (match) saldo_devedor = parseBrazilianAmount(match[1]);
  }
  if (!nome) {
    // "tenho uma divida de 5000 no cartao" → nome = "cartao"
    const nomeMatch = conteudoProcessado.match(/(?:no|na|do|da|de)\s+(\w+)\s*$/i);
    if (nomeMatch) nome = nomeMatch[1];
  }
  
  if (!nome || !saldo_devedor) {
    await createAction(userId, "debt", "debt", { ...decision.slots, nome, saldo_devedor }, 
      !saldo_devedor ? "saldo_devedor" : "nome", payload.messageId);
    await sendMessage(payload.phoneNumber, 
      !saldo_devedor ? "Qual o saldo devedor? 💰" : "Qual o nome da divida? (ex: Nubank, Bradesco...)",
      payload.messageSource);
    return;
  }
  // ... executar registerDebt
}
```

---

## Bug 2 — "simular quitacao receita 3000 gastos 2000" vira multiplos gastos

**Arquivo:** `supabase/functions/finax-worker/index.ts` (detector de multiplos gastos)

**Causa:** O detector de multiplos gastos roda ANTES do intent router e encontra 2 numeros na mensagem (3000 e 2000), interpretando como "Vi 2 gastos". Mas "simular quitacao" deveria ser classificado como `simulate_debts` ANTES.

**Fix:** No index.ts, o bloco de deteccao de multiplos gastos precisa de uma guarda:
```typescript
// Antes de detectar multiplos gastos, verificar se e simulate_debts
const normalizedCheck = normalizeText(conteudoProcessado);
const isSimulation = normalizedCheck.includes("simular") || normalizedCheck.includes("quitacao");
if (!isSimulation) {
  // ... logica de multiplos gastos
}
```

---

## Bug 3 — "voltei da viagem" cria NOVO contexto em vez de fechar

**Arquivo:** `supabase/functions/finax-worker/intents/set-context.ts` (linha 20)

**Causa:** A verificacao de encerramento usa `normalized.includes("terminei") || normalized.includes("fim do") || normalized.includes("acabou") || normalized.includes("encerr")`. "voltei" nao esta na lista.

**Fix:** Adicionar "voltei", "cheguei", "retornei", "saí":
```typescript
if (normalized.includes("terminei") || normalized.includes("fim do") || 
    normalized.includes("acabou") || normalized.includes("encerr") ||
    normalized.includes("voltei") || normalized.includes("cheguei") || 
    normalized.includes("retornei") || normalized.includes("sai da") ||
    normalized.includes("fim da")) {
```

---

## Bug 4 — "gastos na viagem?" retorna gastos do mes (nao filtra por contexto)

**Arquivo:** `supabase/functions/finax-worker/intents/query-routing.ts`

**Causa:** O detectQueryScope nao tem scope para "contexto/viagem/evento". A IA classifica como `query` generico e retorna gastos do mes.

**Fix:** Adicionar scope "context" no detectQueryScope:
```typescript
if (normalized.includes("viagem") || normalized.includes("evento") || 
    normalized.includes("contexto")) return "context";
```

E adicionar case no query-routing:
```typescript
case "context": {
  const { queryContextExpenses } = await import("./card-queries.ts");
  const result = await queryContextExpenses(userId, normalized);
  await sendMessage(phoneNumber, result, messageSource);
  return;
}
```

---

## Bug 5 — "ajuda" → "parcelamentos" nao funciona

**Arquivo:** `supabase/functions/finax-worker/intents/control.ts` (linha 133 - `_getHelpFollowUp`)

**Causa:** A regex e `/\b(parcel|parcela)\b/i` mas "parcelamentos" contem "parcel" como substring, porem `\b` nao bate porque "parcel" e seguido de "a" sem word boundary. Na verdade `\b(parcel)` DEVE funcionar... O problema real: quando o usuario diz "parcelamentos" apos "ajuda", a mensagem e interceptada pela IA como `query` (scope installments) antes de chegar ao control handler.

**Fix:** No index.ts, verificar o `helpCtx.lastIntent === "help"` ANTES do decision engine para redirecionar ao control handler:
```typescript
// Antes do decision engine
const helpCtx = await getConversationContext(userId);
if (helpCtx?.lastIntent === "help") {
  // Forcar roteamento para control
  decision = { actionType: "control", confidence: 1, slots: {} };
}
```

---

## Bug 6 — "lanche" (palavra solta) dispara coleta de gasto em vez de perguntar

**Arquivo:** `supabase/functions/finax-worker/decision/classifier.ts`

**Causa:** O Fast-Track detecta "lanche" como texto sem numero e a IA classifica como expense sem amount. O FSM cria action e pergunta valor. Mas o esperado seria perguntar "gasto ou consulta?".

**Fix:** Este e um trade-off de UX. Na pratica, palavras soltas sem valor sao QUASE SEMPRE gastos que o usuario quer registrar (ele vai informar o valor depois). O comportamento atual (perguntar valor) e ACEITAVEL. O problema real e o Bug 6b abaixo.

---

## Bug 6b — Slot pivot: "acai 20 dinheiro" durante coleta de "lanche" ignora o lanche

**Arquivo:** `supabase/functions/finax-worker/fsm/context-handler.ts`

**Causa:** Quando o FSM tem action pendente de expense com `pending_slot: amount`, e o usuario manda "acai 20 dinheiro" (mensagem completa com novo gasto), o FSM deveria detectar subject_change e pivotar. Mas em vez disso, extrai "20" como amount do "lanche" original e ignora "acai".

**Fix:** No context-handler, quando `pending_slot === "amount"` e a mensagem contem TANTO numero QUANTO texto novo (description), tratar como pivot:
```typescript
if (pendingSlot === "amount" && hasNewDescription) {
  // Cancelar action atual e reprocessar como novo gasto
  await cancelAction(activeAction.id);
  return { handled: false, shouldContinue: true };
}
```

---

## Bug 7 — Mensagens simultaneas (<2s) causam conflito de actions

**Causa:** Duas mensagens chegam quase simultaneas. A primeira cria action. A segunda chega antes da primeira terminar e cria outra action ou interfere. O message-queue deveria serializar mas nao esta funcionando corretamente.

**Fix:** Verificar que o `queueMessage` esta respeitando a fila e processando sequencialmente. Este e um problema de concorrencia que requer lock otimista na tabela actions.

---

## Bug 8 — "quero economizar para investir" cria meta em vez de chat

**Causa:** A IA detecta "economizar" como goal intent. Mas o contexto e conversacional (usuario disse "to gastando muito?" → bot respondeu analise → usuario faz follow-up). Deveria ir para chat.

**Fix:** No AI engine, follow-ups conversacionais (sem valor numerico, sem indicador de acao) devem ser roteados para `chat`, nao `goal`. Verificar se o conversation_context indica topico "chat" e manter.

---

## Resumo de Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `core/intent-router.ts` | Debt handler com FSM + extrair slots do texto |
| `index.ts` | Guard no detector de multiplos gastos + help context redirect |
| `intents/set-context.ts` | Expandir palavras de encerramento |
| `utils/helpers.ts` e `text-helpers.ts` | Adicionar scope "context" |
| `intents/query-routing.ts` | Adicionar case "context" |
| `intents/control.ts` | Nenhuma mudanca (fix esta no index.ts) |

## Testes

| # | Entrada | Esperado |
|---|---------|----------|
| 1 | "tenho uma divida de 5000 no cartao" | Pergunta nome ou registra |
| 2 | "simular quitacao receita 3000 gastos 2000" | Simula, NAO cria multiplos gastos |
| 3 | "voltei da viagem" | FECHA contexto ativo |
| 4 | "quanto gastei na viagem?" | Gastos filtrados pelo contexto |
| 5 | "ajuda" → "parcelamentos" | Tutorial de parcelamentos |
| 6 | "acai 20 dinheiro" (durante coleta de outro gasto) | Registra acai, nao o gasto anterior |
| 7 | "quero economizar para investir" (apos conversa) | Chat contextual, nao cria meta |

