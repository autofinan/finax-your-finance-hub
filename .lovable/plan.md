
# Correcao Definitiva: 4 Bugs Criticos

## Diagnostico Completo

### Bug 1: Horario ERRADO (mostra 00:23 em vez de 21:23)

**Causa raiz**: Existem DUAS funcoes `registerExpense` no projeto:
- Uma em `index.ts` (linha 1623) — esta e a que REALMENTE e chamada pelos handlers de botao
- Uma em `intents/expense.ts` (linha 32) — esta NUNCA e chamada porque a local em index.ts a "esconde" (shadowing)

A funcao em `index.ts` usa `new Date()` (UTC do servidor) para registrar a data:

```text
// index.ts linha 1680-1687
const agora = new Date();  // UTC do servidor!
data: agora.toISOString(),  // Salva em UTC
```

Depois formata com `toLocaleDateString("pt-BR")` sem timezone, mostrando horario UTC.

Todas as correcoes feitas em `intents/expense.ts` (parseamento de dateISO, bypass de formatBrasiliaDateTime) sao INUTEIS porque essa funcao nunca e chamada.

**Correcao**: Corrigir a funcao `registerExpense` DENTRO do `index.ts` (linha 1680-1753) para:
1. Usar `getBrasiliaISO()` em vez de `new Date().toISOString()`
2. Usar `slots.transaction_date` quando disponivel
3. Formatar data/hora parseando a string ISO direto

### Bug 2: Multi-expense "Separado" so registra o PRIMEIRO gasto

**Causa raiz**: Quando o usuario clica "Separado" (linha 2760-2786), o sistema:
1. Pega o primeiro gasto
2. Cria uma action `multi_expense_queue` com `remaining_expenses`
3. Pede forma de pagamento para o primeiro

Quando o usuario seleciona a forma de pagamento (pay_pix, etc), o handler da linha 2862 registra o gasto e fecha TODAS as actions:

```text
// linha 2872-2875
await supabase.from("actions")
  .update({ status: "done" })
  .eq("user_id", userId)
  .in("status", ["collecting", "awaiting_input"]);
```

Os `remaining_expenses` sao simplesmente DESCARTADOS. Nao existe logica para processar o proximo gasto da fila.

**Correcao**: Apos registrar cada gasto no handler `pay_*`, verificar se existem `remaining_expenses` nos slots da action. Se sim, criar nova action para o proximo gasto e perguntar a forma de pagamento. Repetir ate acabar a fila.

### Bug 3: Total duplicado na mensagem multi-expense

**Causa raiz**: A funcao `formatExpensesList` (multiple-expenses.ts linha 195-203) ja inclui o total na string retornada:

```text
return `${lista}\n\n💰 *Total: R$ ${total.toFixed(2)}*`;
```

E o chamador em index.ts (linha 3472) tambem adiciona o total:

```text
`Vi ${multipleExpenses.length} gastos:\n\n${lista}\n\n💰 Total: R$ ${total.toFixed(2)}\n\nComo quer registrar?`
```

Resultado: total aparece duas vezes.

**Correcao**: Remover o total de `formatExpensesList` — a funcao deve retornar apenas a lista numerada. O total e responsabilidade do chamador.

### Bug 4: Data "ontem" funciona nos logs mas nao no banco

**Causa raiz**: Mesma do Bug 1. A funcao `registerExpense` do `index.ts` (que e a chamada) ignora `slots.transaction_date` e usa `new Date()`:

```text
const agora = new Date();
data: agora.toISOString()
```

**Correcao**: Incluida na correcao do Bug 1.

---

## Detalhes Tecnicos

### 1. index.ts — registerExpense inline (linhas 1623-1771)

Correcoes necessarias:

**Linha 1680**: Substituir `const agora = new Date()` por logica que usa `slots.transaction_date` quando disponivel:

```text
// ANTES:
const agora = new Date();

// DEPOIS:
let dateISO: string;
let timeString: string;

if (slots.transaction_date) {
  dateISO = slots.transaction_date;
  timeString = dateISO.substring(11, 16);
} else {
  const result = getBrasiliaISO();
  dateISO = result.dateISO;
  timeString = result.timeString;
}
```

**Linha 1681-1692**: Usar `dateISO` em vez de `agora.toISOString()`:

```text
data: dateISO,
data_transacao: dateISO,
hora_transacao: timeString,
```

**Linhas 1752-1753**: Substituir `toLocaleDateString/toLocaleTimeString` por parsing direto da string ISO:

```text
// ANTES:
const dataFormatada = agora.toLocaleDateString("pt-BR");
const horaFormatada = agora.toLocaleTimeString("pt-BR", {...});

// DEPOIS:
const [_dp] = dateISO.split('T');
const [_yy, _mm, _dd] = _dp.split('-');
const dataFormatada = `${_dd}/${_mm}/${_yy}`;
const horaFormatada = dateISO.substring(11, 16);
```

### 2. index.ts — Handler pay_* (linhas 2862-2878)

Apos registrar o gasto com sucesso, verificar e processar `remaining_expenses`:

```text
// Apos sendMessage do resultado...

// Verificar se ha gastos pendentes da fila multi-expense
const remainingExpenses = activeAction.slots.remaining_expenses as Array<{amount: number; description: string}> | undefined;

if (remainingExpenses && remainingExpenses.length > 0) {
  const nextExpense = remainingExpenses[0];
  const nextRemaining = remainingExpenses.slice(1);

  // Criar action para o proximo gasto
  await createAction(userId, "multi_expense_queue", "expense", {
    amount: nextExpense.amount,
    description: nextExpense.description,
    remaining_expenses: nextRemaining
  }, "payment_method", payload.messageId);

  // Perguntar forma de pagamento
  await sendButtons(
    payload.phoneNumber,
    `💸 R$ ${nextExpense.amount.toFixed(2)} - ${nextExpense.description}\n\nComo voce pagou?`,
    SLOT_PROMPTS.payment_method.buttons!,
    payload.messageSource
  );
}
```

### 3. multiple-expenses.ts — formatExpensesList (linhas 195-203)

Remover o total duplicado:

```text
// ANTES:
export function formatExpensesList(expenses: DetectedExpense[]): string {
  const lista = expenses.map((e, i) =>
    `${i + 1}. ${e.description}: R$ ${e.amount.toFixed(2)}`
  ).join("\n");

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return `${lista}\n\n💰 *Total: R$ ${total.toFixed(2)}*`;
}

// DEPOIS:
export function formatExpensesList(expenses: DetectedExpense[]): string {
  return expenses.map((e, i) =>
    `${i + 1}. ${e.description}: R$ ${e.amount.toFixed(2)}`
  ).join("\n");
}
```

---

## Arquivos a Modificar

```text
1. supabase/functions/finax-worker/index.ts
   - Linhas 1680-1692: Usar dateISO/getBrasiliaISO em vez de new Date()
   - Linhas 1752-1753: Parsear string ISO direto para formatacao
   - Linhas 2862-2878: Adicionar processamento de remaining_expenses apos registro

2. supabase/functions/finax-worker/utils/multiple-expenses.ts
   - Linhas 195-203: Remover total da funcao formatExpensesList
```

## Ordem de Implementacao

```text
1. Corrigir registerExpense inline (index.ts) — data/hora
2. Adicionar processamento de fila multi-expense (index.ts)
3. Remover total duplicado (multiple-expenses.ts)
4. Deploy finax-worker
```

## Testes Esperados

```text
Teste 1 (Horario):
  "Lanche 10" → Pix → Data/hora mostra horario de Brasilia correto

Teste 2 (Ontem):
  "uber 10 ontem" → Pix → Data mostra dia anterior

Teste 3 (Multi-expense separado):
  "30 cinema, 50 almoco, 15 uber" → Separado
  → Pede pagamento para 1o → Registra → Pede pagamento para 2o → Registra → Pede para 3o → Registra
  → Todos os 3 gastos ficam no banco

Teste 4 (Total unico):
  "30 cinema, 50 almoco" → Mensagem mostra total UMA vez
```
