
# Correcao Definitiva - Data/Hora, Multi-Expense, e Confirmacao

## Diagnostico Completo (Causa Raiz de CADA Bug)

### Bug 1: Data "ontem" mostra 07/02 em vez de 06/02 + hora 18:53

**Causa raiz**: A funcao `formatBrasiliaDateTime(transactionDate)` na linha 220 do expense.ts usa `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'`. Porem, o `transactionDate` vem de `getBrasiliaDate()` que JA cria um Date com valores de Brasilia armazenados como UTC. Quando o Intl aplica a conversao de timezone NOVAMENTE, ocorre double-shift de -3h.

Alem disso, quando `slots.transaction_date` NAO esta definido (else branch), o `transactionDate = getBrasiliaDate()` produz um Date cujo valor UTC interno ja esta com valores de Brasilia. O `formatBrasiliaDateTime` aplica timezone de novo, gerando hora errada.

**Solucao DEFINITIVA**: Nao usar `formatBrasiliaDateTime(transactionDate)` para a mensagem. Em vez disso, parsear a string `dateISO` diretamente (que JA contem data e hora corretas de Brasilia):

```text
// dateISO = "2026-02-06T15:53:00-03:00"
// Extrair direto da string:
const [datePart] = dateISO.split('T');
const [year, month, day] = datePart.split('-');
const time = dateISO.substring(11, 16); // "15:53"
const formattedDateTime = `${day}/${month}/${year} as ${time}`;
// Resultado: "06/02/2026 as 15:53"
```

Isso elimina QUALQUER conversao de timezone e usa os valores que ja estao corretos.

---

### Bug 2: "ANTES DE ONTEM" nao detectado como data

**Causa raiz**: O parseRelativeDate em date-helpers.ts tem o padrao `anteontem` (regex: `/\banteontem\b/`) mas NAO tem "antes de ontem" (com espacos).

**Solucao**: Adicionar padrao `antes_de_ontem` com regex `/\bantes\s+de\s+ontem\b/i` ANTES do padrao "anteontem" na lista de padroes.

---

### Bug 3: "DIA 05/02 COMPREI UMA AGUA DE 5" detectado como 2 gastos

**Causa raiz**: A deteccao de multiplos gastos (linha 3421) roda ANTES da deteccao de datas (linha 3454). A funcao `detectMultipleExpenses` encontra "05" (da data) e "5" (do valor) e interpreta como 2 gastos separados.

**Solucao**: Adicionar um guard de DATA ao `shouldSkipMultiDetection`:

```text
const DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\b|dia\s+\d{1,2}|ontem|anteontem|antes\s+de\s+ontem/i;
```

Se a mensagem contem um padrao de data, pular a deteccao de multiplos gastos.

---

### Bug 4: Confirmacao desnecessaria apos todos os slots preenchidos

**Causa raiz**: No context-handler.ts, quando o ultimo slot e preenchido (ex: selecao de cartao), a funcao `fillPendingSlot` retorna `readyToConfirm: true` e `readyToExecute: true` (linha 306-307). O index.ts verifica `readyToConfirm` PRIMEIRO (linha 3358) e envia mensagem de confirmacao, ignorando o `readyToExecute`.

**Solucao**: No context-handler.ts, quando todos os slots estao preenchidos, retornar APENAS `readyToExecute: true` e `readyToConfirm: false`. A confirmacao so deve ocorrer em casos excepcionais (valor > R$ 500 ou confianca baixa).

No index.ts, adicionar tratamento para `readyToExecute` (sem status awaiting_confirmation) ANTES de verificar `readyToConfirm` no CASO 3.

---

## Arquivos a Modificar

### 1. `supabase/functions/finax-worker/intents/expense.ts` (linhas 217-229)

Substituir `formatBrasiliaDateTime(transactionDate)` por parsing direto de `dateISO`:

```text
// ANTES (linha 220):
const formattedDateTime = formatBrasiliaDateTime(transactionDate);

// DEPOIS:
// Parsear dateISO direto (ja tem data/hora corretas de Brasilia)
const [_datePart] = dateISO.split('T');
const [_y, _m, _d] = _datePart.split('-');
const _time = dateISO.substring(11, 16);
const formattedDateTime = `${_d}/${_m}/${_y} as ${_time}`;
```

Tambem adicionar logs no final:

```text
console.log(`[EXPENSE] Registrado: ${transaction.id}`);
console.log(`[EXPENSE] Salvo no banco: ${dateISO}`);
console.log(`[EXPENSE] Mostrado ao usuario: ${formattedDateTime}`);
```

### 2. `supabase/functions/finax-worker/utils/date-helpers.ts` (linha 282)

Adicionar padrao "antes_de_ontem" ANTES de "anteontem":

```text
// INSERIR ANTES do padrao "anteontem" (linha 282):
{
  name: "antes_de_ontem",
  regex: /\bantes\s+de\s+ontem\b/i,
  transform: (d) => {
    const result = new Date(d);
    result.setDate(result.getDate() - 2);
    console.log(`[DATE] Antes de ontem: ${formatBrasiliaDate(result)}`);
    return result;
  }
},
```

### 3. `supabase/functions/finax-worker/index.ts` (linhas 3412-3419)

Adicionar guard de data para evitar falso positivo no multi-expense:

```text
// ADICIONAR ao shouldSkipMultiDetection:
const DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\b|\bdia\s+\d{1,2}\b|\bontem\b|\banteontem\b|\bantes\s+de\s+ontem\b/i;

const shouldSkipMultiDetection =
  INSTALLMENT_PATTERN.test(conteudoProcessado) ||
  CARD_PATTERN.test(conteudoProcessado) ||
  BILL_PATTERN.test(conteudoProcessado) ||
  DATE_PATTERN.test(conteudoProcessado);
```

### 4. `supabase/functions/finax-worker/fsm/context-handler.ts` (linhas 300-308)

Mudar para executar direto quando slots completos (sem confirmacao):

```text
// ANTES (linhas 306-307):
readyToConfirm: missingSlots.length === 0,
readyToExecute: missingSlots.length === 0

// DEPOIS:
readyToConfirm: false,
readyToExecute: missingSlots.length === 0
```

### 5. `supabase/functions/finax-worker/index.ts` (linhas 3346-3383)

Adicionar CASO 3A para executar direto quando readyToExecute sem awaiting_confirmation:

```text
// CASO 3: SLOT PREENCHIDO
if (contextResult.handled && contextResult.filledSlot) {
  await updateAction(activeAction.id, {
    slots: contextResult.updatedSlots,
    pending_slot: null
  });

  // CASO 3A: PRONTO PARA EXECUTAR DIRETO (sem confirmacao)
  if (contextResult.readyToExecute) {
    const slots = contextResult.updatedSlots as ExtractedSlots;
    let result;

    switch (activeAction.intent) {
      case "expense":
        result = await registerExpense(userId, slots, activeAction.id);
        break;
      case "income":
        result = await registerIncome(userId, slots, activeAction.id);
        break;
      // ... outros intents
    }

    await supabase.from("actions")
      .update({ status: "done" })
      .eq("user_id", userId)
      .in("status", ["collecting","awaiting_input","awaiting_confirmation"]);

    await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
    return;
  }

  // Se readyToConfirm (casos excepcionais) → pedir confirmacao
  if (contextResult.readyToConfirm) { ... }

  // Ainda falta slot → perguntar proximo
  ...
}
```

---

## Ordem de Implementacao

```text
1. date-helpers.ts → Adicionar "antes de ontem"
2. expense.ts → Parsear dateISO direto (bypass formatBrasiliaDateTime)
3. index.ts → Adicionar DATE_PATTERN guard no multi-expense
4. context-handler.ts → readyToExecute=true, readyToConfirm=false
5. index.ts → CASO 3A: executar direto quando readyToExecute
6. Deploy finax-worker
```

## Testes Esperados

```text
Teste 1: "ontem comprei um cafe de 1,50"
  → Pix → Registrado com 06/02/2026 as HH:MM (hora correta)

Teste 2: "ANTES DE ONTEM COMPREI UMA AGUA DE 5 NO CREDITO"
  → Detecta cartao → Registra DIRETO (sem confirmacao)
  → Data: 05/02/2026

Teste 3: "DIA 05/02 COMPREI UMA AGUA DE 5 NO CREDITO"
  → NAO detecta como 2 gastos
  → Detecta 1 gasto de R$ 5 no dia 05/02

Teste 4: "Pizza 30 pix"
  → Registra direto (sem confirmacao, confianca alta)
```
