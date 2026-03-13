# SPRINT 2 — Centralizar registerExpense (17 → 1)

## STATUS ATUAL

A função `registerExpenseInline` já existe em `intents/expense-inline.ts` (linhas 152-408).
No `index.ts`, ela é importada e aliasada na linha 87:
```ts
const registerExpense = registerExpenseInline;
```

**A função já é centralizada.** Os 17 call sites já chamam a MESMA função.

O problema real NÃO é "17 implementações diferentes" — é que **os 17 call sites passam parâmetros de forma inconsistente:**

- 5 passam `undefined` como actionId (risco: action fica pendurada)
- 3 usam `as any` nos slots (risco: tipo errado)
- Alguns fecham a action manualmente DEPOIS, outros não fecham

---

## O QUE FAZER NESTE SPRINT

### Objetivo: padronizar os 17 call sites, NÃO reescrever registerExpense

---

## TAREFA 1: Adicionar `closeAction` como parâmetro padrão

**Arquivo:** `intents/expense-inline.ts`
**Linha 152-157** — Assinatura atual:
```ts
export async function registerExpenseInline(
  userId: string, 
  slots: ExtractedSlots, 
  actionId?: string,
  createActionFn?: ...,
  closeActionFn?: ...
)
```

**Problema:** `createActionFn` e `closeActionFn` são opcionais e quase nunca passados.
Na linha 327: `if (actionId && closeActionFn) await closeActionFn(actionId, tx.id);`
→ Se passar actionId mas NÃO closeActionFn, a action nunca é fechada!

**Fix:** Importar `closeAction` direto no expense-inline.ts e usar como default.

**Mudança em `intents/expense-inline.ts`:**
1. Adicionar no topo (após linha 18):
```ts
import { closeAction as defaultCloseAction, createAction as defaultCreateAction } from "../fsm/action-manager.ts";
```

2. Linha 327, trocar:
```ts
// DE:
if (actionId && closeActionFn) await closeActionFn(actionId, tx.id);

// PARA:
if (actionId) {
  const closeFn = closeActionFn || defaultCloseAction;
  await closeFn(actionId, tx.id);
}
```

3. Linha 205, trocar:
```ts
// DE:
if (createActionFn) {
  await createActionFn(userId, "duplicate_confirm", "duplicate_expense", {...}, null, null);
}

// PARA:
const createFn = createActionFn || defaultCreateAction;
await createFn(userId, "duplicate_confirm", "duplicate_expense", {...}, null, null);
```

**Teste:** Enviar "café 15 pix" → gasto registrado. A action deve ser fechada automaticamente.

---

## TAREFA 2: Corrigir os 5 call sites que passam `undefined` como actionId

Estes call sites NÃO passam actionId, então a action pode ficar pendente:

### Call site #1 — Linha 576 (OCR com payment completo)
```ts
const result = await registerExpense(userId, slots, undefined);
```
**Contexto:** OCR detectou imagem com slots completos. Não tem action criada.
**Fix:** OK como está — não existe action para fechar. Manter `undefined`.

### Call site #14 — Linha 2943 (Routing expense com slots completos)
```ts
const result = await registerExpense(userId, slots as any, undefined);
```
**Contexto:** IA classificou expense com todos slots. Action pode ou não existir.
**Fix na linha 2943-2948:** Trocar por:
```ts
const result = await registerExpense(userId, slots, undefined);
// Fechar qualquer action pendente
await supabase.from("actions")
  .update({ status: "done" })
  .eq("user_id", userId)
  .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
```
→ Remover `as any` (Tarefa 3 cuida da tipagem).

### Call site #15 — Linha 3199 (pay_bill reclassificado)
```ts
const result = await registerExpense(userId, slots as any, undefined);
```
**Fix:** Mesmo padrão — remover `as any`, manter undefined + cleanup manual.

### Call site #6 — Linha 1685 (duplicate_confirm_yes via botão)
```ts
const result = await registerExpense(userId, dupSlots);
```
**Contexto:** `dupAction` já foi fechada via `closeAction(dupAction.id)` na linha anterior.
**Fix:** OK como está — action já fechada manualmente.

### Call site #16 — Linha 4666 (duplicate_confirm via texto "sim")
```ts
const result = await registerExpense(userId, dupSlots);
```
**Fix:** OK — mesmo padrão que #6.

---

## TAREFA 3: Eliminar `as any` nos slots (3 call sites)

### Call site #7 — Linha 1783 (pattern_confirm_yes)
```ts
const result = await registerExpense(userId, activeAction.slots as any, activeAction.id);
```
**Fix:** Trocar por:
```ts
const result = await registerExpense(userId, activeAction.slots as ExtractedSlots, activeAction.id);
```

### Call site #14 — Linha 2943 (routing expense)
```ts
const result = await registerExpense(userId, slots as any, undefined);
```
**Fix:** `slots` já é `ExtractedSlots` (vem de `decision.slots`). Trocar por:
```ts
const result = await registerExpense(userId, slots, undefined);
```

### Call site #15 — Linha 3199 (pay_bill reclassificado)
```ts
const result = await registerExpense(userId, slots as any, undefined);
```
**Fix:** `slots` vem de `decision.slots`. Trocar por:
```ts
const result = await registerExpense(userId, slots, undefined);
```

---

## TAREFA 4: Verificar que `as ExtractedSlots` está OK nos call sites restantes

### Call site #5 — Linha 1649 (limit_force_yes)
```ts
const result = await registerExpense(userId, activeAction.slots as ExtractedSlots, activeAction.id);
```
**Status:** ✅ OK — `as ExtractedSlots` é seguro porque `activeAction.slots` vem do banco (já validado).

---

## RESUMO DE MUDANÇAS EXATAS

### Arquivo: `intents/expense-inline.ts`

| Linha | Ação | Detalhe |
|-------|------|---------|
| 18 (após) | ADICIONAR | `import { closeAction as defaultCloseAction, createAction as defaultCreateAction } from "../fsm/action-manager.ts";` |
| 205-209 | SUBSTITUIR | Remover `if (createActionFn)` guard, usar `createFn = createActionFn \|\| defaultCreateAction` |
| 327 | SUBSTITUIR | `if (actionId) { const closeFn = closeActionFn \|\| defaultCloseAction; await closeFn(actionId, tx.id); }` |

### Arquivo: `index.ts`

| Linha | Ação | Detalhe |
|-------|------|---------|
| 1783 | SUBSTITUIR | `as any` → `as ExtractedSlots` |
| 2943 | SUBSTITUIR | `as any` → remover cast (slots já é ExtractedSlots) |
| 3199 | SUBSTITUIR | `as any` → remover cast |

---

## TESTES POR CALL SITE

| # | Fluxo a testar | Mensagem de teste |
|---|---------------|-------------------|
| 1 | OCR imagem | Enviar foto de comprovante |
| 2 | Confirmação via botão (confirm_yes → expense) | "café 15" → clicar Sim |
| 3 | Confirmação via botão (numero_isolado) | Enviar "42" quando há action pendente → clicar Sim |
| 4 | Seleção de pagamento (pay_ button) | "almoço 30" → clicar Pix |
| 5 | Forçar limite (limit_force_yes) | Gasto > limite do cartão → clicar "Registrar mesmo" |
| 6 | Duplicata (duplicate_confirm_yes) | Enviar mesmo gasto 2x em 5 min → clicar "Sim, registrar" |
| 7 | Padrão confirmado (pattern_confirm_yes) | Gasto recorrente com padrão aprendido → confirmar |
| 8 | Seleção de cartão (select_card_) | "uber 25 crédito" com 2+ cartões → selecionar um |
| 9 | FSM slot filling → expense | "gastei 50" → "pix" → deve registrar |
| 10 | FSM numero_isolado → expense | "42" sem contexto → "gasto" → confirmar |
| 11 | FSM slot preenchido direto | "mercearia" quando action pede descrição → confirmar |
| 12 | Routing direto (slots completos) | "café 15 pix" → deve registrar direto |
| 13 | pay_bill reclassificado | Pagar conta que vira expense |
| 14 | Duplicata via texto ("sim") | Duplicata detectada → responder "sim" |
| 15 | Guard final com action pendente | Gasto com todos slots em action perdida |

---

## TESTE DE REGRESSÃO CRÍTICO (SALDO DUPLICADO)

1. Enviar "café 15 pix"
2. Verificar no banco: `SELECT count(*) FROM transacoes WHERE usuario_id = '...' AND valor = 15 AND created_at > now() - interval '1 minute'`
3. Deve retornar **exatamente 1**
4. Enviar "café 15 pix" novamente em 30 segundos
5. Deve detectar duplicata e perguntar (NÃO registrar automaticamente)
6. Clicar "Não, era erro" → nenhuma transação extra criada

---

## ORDEM DE EXECUÇÃO

1. Fazer mudanças no `expense-inline.ts` (Tarefa 1) — deploy + teste #1, #2, #9
2. Fazer mudanças nos `as any` no `index.ts` (Tarefa 3) — deploy + teste #7, #12, #13
3. Rodar teste de regressão de saldo duplicado
4. Rodar todos os 15 testes

---

## DEPOIS DO SPRINT 2

Com os call sites padronizados, o Sprint 3 pode extrair intents com segurança porque:
- Cada intent handler pode chamar `registerExpense(userId, slots, actionId)` sabendo que a action será fechada automaticamente
- Sem `as any` = TypeScript pega erros de tipo em compile time
