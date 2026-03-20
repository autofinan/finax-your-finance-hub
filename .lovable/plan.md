

# Plano: Corrigir Consultas, Metas e Roteamento do WhatsApp

## Diagnostico Raiz

Ha um problema **sistematico**: quase todas as queries caem no fallback que mostra "Gastos do Mes" porque o roteamento esta quebrado em multiplos pontos.

---

## Problema 1 — DUAS funcoes `detectQueryScope` (CRITICO)

**Causa raiz de QUASE TODOS os bugs de query.**

Existem duas versoes da funcao `detectQueryScope`:
- `utils/text-helpers.ts` (linha 44) — foi atualizada com "recorrencia", "gastos fixos", etc.
- `utils/helpers.ts` (linha 27) — versao ANTIGA, sem essas atualizacoes

O arquivo `intents/query-routing.ts` **importa de `helpers.ts`** (linha 6), nao de `text-helpers.ts`. Entao todas as correcoes feitas em sprints anteriores nunca tiveram efeito.

**Fix:** Em `utils/helpers.ts`, substituir a funcao `detectQueryScope` pela versao atualizada de `text-helpers.ts`, e ADICIONAR os escopos que faltam:

```typescript
export function detectQueryScope(normalized: string): string {
  // Relatórios
  if ((normalized.includes("relatorio") || normalized.includes("report")) && 
      (normalized.includes("semanal") || normalized.includes("semana"))) return "weekly_report";
  if (normalized.includes("relatorio") || normalized.includes("report")) return "report";
  
  // Faturas
  if (normalized.includes("fatura") && (normalized.includes("detalh") || normalized.includes("tem na") || normalized.includes("abrir") || normalized.includes("ver"))) return "invoice_detail";
  if (normalized.includes("detalh") && normalized.includes("fatura")) return "invoice_detail";
  if (normalized.includes("fatura") && (normalized.includes("futur") || normalized.includes("proximo"))) return "invoice_future";
  if (normalized.includes("fatura")) return "invoice_detail";
  
  // Cartões
  if (normalized.includes("cartao") || normalized.includes("cartoes") || normalized.includes("limite")) return "cards";
  
  // Contas a pagar
  if (normalized.includes("conta") && normalized.includes("pagar")) return "bills";
  if (normalized.includes("contas") && !normalized.includes("gastei")) return "bills";
  
  // Orçamentos  
  if (normalized.includes("orcamento") || normalized.includes("orcamentos") || 
      normalized.includes("limite mensal") || normalized.includes("budget")) return "budgets";
  
  // Recorrentes
  if (normalized.includes("recorrente") || normalized.includes("recorrencia") || 
      normalized.includes("recorrencias") || normalized.includes("assinatura") || 
      normalized.includes("assinaturas") || normalized.includes("fixos") || 
      normalized.includes("gastos fixos") || normalized.includes("gastos mensais")) return "recurring";
  
  // Parcelamentos
  if (normalized.includes("parcelamento") || normalized.includes("parcela") || 
      normalized.includes("parcelado")) return "installments";
  
  // Metas
  if (normalized.includes("meta") || normalized.includes("metas") || 
      normalized.includes("poupanca")) return "goals";
  
  // Pendentes
  if (normalized.includes("pendente") || normalized.includes("pendentes")) return "pending";
  
  // Categorias
  if (normalized.includes("categoria") || normalized.includes("categorias")) return "category";
  
  // Entradas
  if (normalized.includes("recebi") || normalized.includes("entrada") || 
      normalized.includes("entrou")) return "income";
  
  // Gastos
  if (normalized.includes("gastei") || normalized.includes("gasto") || 
      normalized.includes("gastos")) return "expenses";
  
  return "summary";
}
```

**Tambem atualizar `text-helpers.ts`** com os mesmos termos para manter sincronizado.

---

## Problema 2 — Caso `summary` nao renderiza resumo

**Arquivo:** `intents/query-routing.ts` (linha 413-430)

**Problema:** O case `summary` so trata `timeRange === "week"` e depois faz `break`, caindo no fallback que mostra lista de gastos.

**Fix:** Adicionar handler para summary mensal ANTES do break:

```typescript
case "summary": {
  if (timeRange === "week" || ...) { /* weekly report (já existe) */ }
  
  // ✅ RESUMO MENSAL (novo)
  const { getMonthlySummary } = await import("./query.ts");
  const summaryText = await getMonthlySummary(userId);
  await sendMessage(phoneNumber, summaryText, messageSource);
  return;
}
```

---

## Problema 3 — Novos cases no switch de query-routing

**Arquivo:** `intents/query-routing.ts`

Adicionar handlers para os novos scopes:

### `case "bills":`
```typescript
const { listBills } = await import("./bills.ts");
const billsResult = await listBills(userId);
await sendMessage(phoneNumber, billsResult, messageSource);
return;
```

### `case "report":`
Usar `fn_relatorio_mensal` + IA para gerar texto analitico:
```typescript
const { data: relatorio } = await supabase.rpc("fn_relatorio_mensal", { p_usuario_id: userId });
if (relatorio) {
  const textoReport = await gerarRelatorioMensalIA(relatorio, nomeUsuario);
  await sendMessage(phoneNumber, textoReport, messageSource);
} else {
  await sendMessage(phoneNumber, "📊 Sem dados para gerar relatório.", messageSource);
}
return;
```

A funcao `gerarRelatorioMensalIA` sera criada em `reports-handler.ts`, usando Gemini para interpretar os dados e gerar texto com recomendacoes.

---

## Problema 4 — Query por cartao nao funciona

**Arquivo:** `intents/query-routing.ts` (linha 479)

**Problema:** Regex `(?:gastei|quanto)\s+(?:no|na|do|da)\s+(\w+)` nao captura "Gastei o que com o inter?"

**Fix:** Expandir regex e tambem detectar card_id na IA:

```typescript
const cardMatch = normalized.match(
  /(?:gastei|quanto|gasto|gastos|usei)\s+(?:o que\s+)?(?:no|na|do|da|com o|com a|com)\s+(\w+)/
);
```

E adicionar deteccao de nome de cartao do usuario:

```typescript
// Antes do regex, verificar se algum cartão do usuário está no texto
const { data: userCards } = await supabase
  .from("cartoes_credito")
  .select("id, nome, limite_disponivel, limite_total")
  .eq("usuario_id", userId);
  
for (const card of (userCards || [])) {
  if (card.nome && normalized.includes(normalizeText(card.nome))) {
    // Rotear para gastos deste cartão
    // ... (mesma lógica do bloco existente)
    return;
  }
}
```

---

## Problema 5 — Goal FSM mostra "Qual o goal_name?"

**Arquivos:** `decision/types.ts` (linha 152) vs `ui/slot-prompts.ts` (linha 33)

**Problema:** Ha dois contratos CONFLITANTES:
- `types.ts`: `goal: { required: ["goal_name", "target_amount"] }`
- `slot-prompts.ts`: `goal: { required: ["amount", "description"] }`

O intent-router usa `amount` e `description` (correto), mas se o FSM pegar os slots de `types.ts`, mostra "Qual o goal_name?" (raw).

**Fix:** Alinhar `types.ts` com `slot-prompts.ts`:
```typescript
// types.ts - MUDAR:
goal: { required: ["amount", "description"], optional: ["deadline", "category"] },
```

E atualizar SLOT_PROMPTS em types.ts:
```typescript
// Remover goal_name e target_amount, substituir por:
amount: { text: "Qual o valor da meta? 💰" },
description: { text: "Qual o nome da meta? (ex: Viagem, Carro...)" },
```

---

## Problema 6 — "adicione 300 na meta de trafego" cria nova meta

**Arquivo:** `core/intent-router.ts` (linha 1266)

**Problema:** `ADD_INDICATORS` nao inclui "adicione" e "adiciona" (conjugacoes imperativas). Alem disso, o Fast-Track extrai "Adicione" como description em vez de "trafego".

**Fix 1:** Expandir ADD_INDICATORS:
```typescript
const ADD_INDICATORS = ["tenho", "guardei", "juntei", "adicionei", "depositar", 
  "depositei", "adicionar", "acrescentar", "coloquei", "poupei", "economizei",
  "adicione", "adiciona", "coloca", "coloque", "bota", "bote", "põe", "poe"];
```

**Fix 2:** Quando o description e um verbo de ADD_INDICATOR, extrair o nome real da meta do texto:
```typescript
if (isAddIntent) {
  // Extrair nome real da meta: "adicione 300 na meta de trafego" → "trafego"
  const metaMatch = conteudoProcessado.match(/(?:meta|meta de|na meta|pra|para)\s+(.+)/i);
  if (metaMatch) {
    slots.description = metaMatch[1].trim();
  }
}
```

---

## Problema 7 — "gastos de alimentação dessa semana" falha

**Problema:** A query com categoria + semana cai no handler `expenses` que usa `executeDynamicQuery`. Mas `time_range` e "week" e `category` nao esta sendo passada. A IA nao extrai `category` e `time_range` como slots.

**Fix:** No case `expenses` do query-routing, antes de chamar `executeDynamicQuery`, detectar categoria do texto:

```typescript
if (!slots.category) {
  for (const cat of KNOWN_CATEGORIES) {
    const catNorm = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes(catNorm)) {
      slots.category = catNorm;
      break;
    }
  }
}
```

Este codigo ja existe nas linhas 52-62, mas so para `detalhe`. Precisa expandir para qualquer query de expenses.

---

## Problema 8 — Fatura: resposta ao detalhe nao funciona

**Problema:** Apos listar faturas, o usuario responde "sicredi credito" mas o bot nao entende como selecao de fatura.

**Fix:** No FSM context-handler, quando ha action pendente de tipo "invoice_selection" ou quando o contexto anterior era `invoice_detail`, tratar a resposta como nome de cartao e rotear para `getInvoiceDetail`.

---

## Resumo de Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `utils/helpers.ts` | Reescrever `detectQueryScope` com TODOS os scopes |
| `utils/text-helpers.ts` | Sincronizar com helpers.ts |
| `intents/query-routing.ts` | Adicionar cases: bills, report, summary mensal. Expandir regex de cartao. Detectar categoria em expenses |
| `intents/reports-handler.ts` | Criar `gerarRelatorioMensalIA` usando Gemini |
| `decision/types.ts` | Alinhar goal slots com slot-prompts.ts |
| `core/intent-router.ts` | Expandir ADD_INDICATORS + extrair nome real da meta |

## Ordem de Implementacao

1. `helpers.ts` — detectQueryScope (resolve 70% dos bugs de uma vez)
2. `query-routing.ts` — summary + bills + report + card regex
3. `types.ts` — goal slots
4. `intent-router.ts` — ADD_INDICATORS + meta name extraction
5. `reports-handler.ts` — relatorio mensal IA
6. Deploy finax-worker

## Testes

| # | Entrada | Esperado |
|---|---------|----------|
| 1 | "minhas recorrências" | Lista gastos recorrentes ativos |
| 2 | "gastei o que com o inter?" | Gastos filtrados pelo cartao Inter |
| 3 | "resumo" | Entradas/Saidas/Saldo do mes |
| 4 | "quanto gastei esse mes?" | Entradas/Saidas/Saldo do mes |
| 5 | "gastos de alimentação dessa semana" | Gastos da categoria alimentacao na semana |
| 6 | "relatório" | Relatorio mensal com analise IA |
| 7 | "contas a pagar" | Lista de contas/faturas cadastradas |
| 8 | "quais orcamentos tenho?" | Lista de orcamentos ativos |
| 9 | "criar meta de 200 pra roupa" | Cria meta corretamente, sem "Qual o goal_name?" |
| 10 | "adicione 300 na meta de trafego" | Adiciona 300 a meta existente "trafego pago" |
| 11 | "minhas faturas" → "sicredi" | Mostra detalhe da fatura Sicredi |
| 12 | "minhas parcelas" | Lista parcelamentos ativos |
| 13 | "gastos dessa semana" | Gastos da semana com periodo visivel |

