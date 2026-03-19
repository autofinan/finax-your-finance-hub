# Plano de Correção: Testes de Regressão (Lote 2)

Foram identificados 10 problemas nos testes. Este plano corrige cada um cirurgicamente.

---

## Problema 1 — Descrição de Income salva como verbo ("Recebi", "Ganhei")

**Arquivos:** `decision/classifier.ts` (Fast-Track) + `core/intent-router.ts` (income handler)

**Causa raiz:** O Fast-Track extrai "Recebi" como description de "recebi 500 de salário" porque o VERB_ONLY fix só existe para expenses (CASO 3, linha 230), mas income passa pelo mesmo CASO 3 com o verbo como descrição. A IA confirma `description: "Recebi"` sem corrigir.

**Fix:** 

1. Adicionar verbos de income ao VERB_ONLY no classifier: `"recebi", "ganhei", "entrou", "pingou", "mandaram"`
2. No income handler do intent-router, aplicar limpeza similar: extrair substantivo real do `conteudoProcessado` (ex: "salário" de "recebi 500 de salário")

---

## Problema 2 — Áudio sem descrição → categoria "outros"

**Arquivo:** `intents/expense-inline.ts` (registerExpenseInline)

**Causa raiz:** Log mostra `📂 [CAT] Descrição vazia - retornando "outros"`. O áudio transcreveu "gastei 6,50 no uber pix" mas a descrição chegou como `undefined` nos slots. O processamento de áudio não está passando o texto transcrito para o classifier.

**Fix:** No expense handler, se `slots.description` está vazio mas `conteudoProcessado` tem texto, re-extrair descrição do texto bruto (similar ao safety guard já existente na linha 355-361 do intent-router, mas garantindo que funcione para áudio).

---

## Problema 3 — Recorrente no crédito não pergunta cartão

**Arquivo:** `core/intent-router.ts` (recurring handler, linha 766-817) + `ui/slot-prompts.ts`

**Causa raiz:** Quando "netflix 55 todo mês no crédito" é classificado, o slot `payment_method: "credito"` já vem preenchido. O `SLOT_REQUIREMENTS.recurring` exige `["amount", "description", "payment_method"]` — com crédito, TODOS os slots obrigatórios estão preenchidos. O `registerRecurring` salva direto sem perguntar qual cartão.

**Fix:** No recurring handler (antes da execução direta), se `payment_method === "credito"`, verificar cartões:

- Se 1 cartão → vincular automaticamente
- Se 2-3 → mostrar botões `rec_card_*`
- Se 4+ → mostrar lista
- Se 0 → pedir cadastro

---

## Problema 4 — "liste as minhas recorrencias" retorna gastos do mês

**Arquivo:** `utils/text-helpers.ts` (detectQueryScope) OU classificação da IA

**Causa raiz:** A função `detectQueryScope` na linha que verifica recurring usa `normalized.includes("recorrente") || normalized.includes("assinatura")`. Mas "recorrencias" (sem acento, normalizado) não contém "recorrente". Precisa adicionar "recorrencia" ao pattern.

**Fix:** Em `detectQueryScope`, expandir a detecção:

```
if (normalized.includes("recorrente") || normalized.includes("recorrencia") || 
    normalized.includes("assinatura") || normalized.includes("fixos") ||
    normalized.includes("gastos fixos")) return "recurring";
```

---

## Problema 5 — "cancela essa recorrência" falha

**Arquivo:** `intents/cancel-routing.ts` (linha 65)

**Causa raiz:** O `searchTerm` é extraído do texto ORIGINAL (com acentos), mas a regex de limpeza na linha 65 tenta remover `\brecorrencia\b` (sem acento). Como o texto tem "recorrência" (com acento), o replace não funciona e `searchTerm = "recorrência"` (não vazio). O check `!searchTerm` na linha 76 é FALSE, então não entra no fast-path de pronome contextual.

**Fix:** Normalizar o searchTerm removendo acentos ANTES do replace, ou adicionar variantes com acento na regex.

---

## Problema 6 — Parcelamento não pergunta número de parcelas

**Arquivo:** `core/intent-router.ts` (installment handler, linha 822-850)

**Causa raiz:** O fluxo de parcelamento verifica PRIMEIRO se falta `payment_method` (STEP 0, linha 832) e mostra botões boleto/crédito. Mas deveria verificar PRIMEIRO se falta `installments`, porque "parcelei 500 na loja" não tem número de parcelas.

**Fix:** Reordenar: antes do STEP 0, verificar se `installments` está ausente e perguntar "Em quantas vezes?". Só depois de ter `installments` é que pergunta boleto/crédito.

---

## Problema 7 — Parcelas não progridem (CRON não atualiza parcela_atual)

**Arquivo:** `supabase/functions/processar-recorrentes/index.ts` (processarParcelasFuturas)

**Causa raiz:** O CRON processa parcelas com `status: "futura"` e `mes_referencia` do mês atual. Mas:

1. Se o CRON não está rodando (pg_cron não configurado), nada acontece
2. Se as parcelas foram criadas com `mes_referencia` incorreto, não são encontradas
3. O `parcelamentos.parcela_atual` é atualizado mas o WhatsApp lê da tabela `parcelas`

**Fix:**

1. Verificar se pg_cron está chamando `processar-recorrentes` diariamente
2. No WhatsApp query de "minhas parcelas" (query-routing.ts, installments case), mostrar parcelas da tabela `parcelas` agrupadas corretamente, incluindo quais já foram pagas vs futuras
3. Garantir que `parcelamentos.parcela_atual` e `parcelas.status` sejam atualizados em sincronia

---

## Problema 8 — Gasto crédito registrado sem limite suficiente (sem confirmação)

**Arquivo:** `intents/expense-inline.ts` (linha 295-316)

**Causa raiz:** O `resolveCreditCard` em `credit-flow.ts` JÁ bloqueia com botões (limit_force_yes) quando limite é insuficiente. Mas o fluxo do expense-inline.ts faz uma SEGUNDA dedução do limite na linha 305-310. Se o cartão foi selecionado via botão `card_*`, o credit-flow.ts já deduziu o limite na `processCardSelection`. O expense-inline.ts deduz de novo → double-deduction.

**Fix:** No expense-inline.ts, verificar se o limite já foi deduzido pelo credit-flow (verificar se `slots.fatura_id` existe — se sim, o credit-flow já processou). Não deduzir novamente.

---

## Problema 9 — Formato da mensagem de income

**Arquivo:** `intents/income.ts` (linha 107-109)

**Causa raiz:** Income mostra `✅ *+R$ 500.00*` (com ponto decimal) e `📝 Recebi` (verbo). O formato deve usar vírgula e a descrição correta.

**Fix:** Alinhar formato do income com o do expense:

```
💰 *Entrada registrada!*

✅ +R$ 500,00
📂 salário
📝 Salário
💳 transferencia
📅 18/03/2026 às 20:40
```

---

## Problema 10 — Parcelamentos não aparecem no site

**Arquivo:** `src/hooks/useParcelamentos.ts` + `src/pages/Parcelamentos.tsx`

**Causa raiz:** O hook busca `parcelamentos` e `vw_parcelas_abertas`. Se a view não existe ou retorna erro, os dados aparecem parcialmente. Também falta filtro `ativa = true` e realtime.

**Fix:** Adicionar `.eq("ativa", true)`, adicionar realtime subscription similar ao useGastosRecorrentes.

---

## Ordem de Implementação (por impacto)

1. **P6** — Parcelamento sem perguntar nº parcelas (quebra fluxo)
2. **P5** — Cancel recorrência falha (UX quebrada)
3. **P1** — Income description verbo (dados incorretos)
4. **P3** — Recurring crédito sem cartão (dados incompletos)
5. **P4** — Query "recorrencias" retorna errado
6. **P2** — Áudio sem descrição
7. **P9** — Formato income
8. **P8** — Double-deduction crédito
9. **P7** — Parcelas não progridem (CRON)
10. **P10** — Parcelamentos no site

---

## Detalhes Técnicos

**Arquivos backend modificados:**

- `decision/classifier.ts` — VERB_ONLY expandido
- `core/intent-router.ts` — income description fix + recurring crédito + installment reorder
- `intents/cancel-routing.ts` — normalize searchTerm
- `intents/income.ts` — formato de mensagem  
- `intents/expense-inline.ts` — double-deduction guard
- `utils/text-helpers.ts` — detectQueryScope pattern
- `processar-recorrentes/index.ts` — verificar CRON

**Arquivos frontend modificados:**

- `src/hooks/useParcelamentos.ts` — filtro ativa + realtime

&nbsp;

# Prompt para o Lovable — Correções Lote 2 (10 bugs)

Encontramos 10 bugs nos testes de regressão. Corrija todos na ordem abaixo. Para cada bug: leia o arquivo, localize o problema exato, corrija, e confirme o que mudou. Não mexa em nada fora do escopo de cada bug.

---

## BUG 1 — Parcelamento não pergunta número de parcelas (P6)

**Arquivo:** `supabase/functions/finax-worker/core/intent-router.ts` **Problema:** "parcelei 500 na loja" vai direto para botões "crédito ou boleto" sem perguntar "em quantas vezes?". O fluxo verifica `payment_method` antes de verificar `installments`.

**Fix — reordenar a lógica do installment handler:**

```typescript
// ANTES de verificar payment_method, verificar installments
if (!slots.installments || isNaN(Number(slots.installments)) || Number(slots.installments) < 2) {
  await createAction(userId, "installment", "installment", slots, "installments", payload.messageId);
  await sendMessage(
    payload.phoneNumber,
    `💰 R$ ${Number(slots.amount).toFixed(2)}\n\nEm quantas vezes? (ex: 3x, 12x)`,
    payload.messageSource
  );
  return;
}
// SÓ DEPOIS verificar payment_method

```

**Também corrigir:** no FSM (`fsm-router.ts`), o slot `installments` deve validar que a resposta é numérica:

```typescript
if (activeAction.pending_slot === "installments") {
  const num = parseInt(conteudoProcessado.replace(/\D/g, ""));
  if (isNaN(num) || num < 2 || num > 72) {
    return {
      handled: true,
      filledSlot: null,
      message: "Quantas parcelas? Me manda só o número (ex: 3, 12) 📦"
    };
  }
}

```

---

## BUG 2 — "cancela essa recorrência" falha (P5)

**Arquivo:** `supabase/functions/finax-worker/intents/cancel-routing.ts`

**Problema:** O searchTerm é extraído com acento ("recorrência") mas a regex de limpeza tenta remover "recorrencia" (sem acento). O replace não funciona, `searchTerm` fica como "recorrência" (não vazio), então o fast-path de pronome contextual nunca dispara.

**Fix 1 — normalizar ANTES de limpar:**

```typescript
// Aplicar normalizeText no searchTerm bruto antes dos replaces
let searchTerm = matchResult[1].trim();
searchTerm = searchTerm
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
  .replace(/[?.!,]+$/g, "")
  .replace(/\b(a|o|os|as|meu|minha|esse|essa|isso|isto|este|esta|aquele|aquela|recorrencia|recorrente|assinatura|gasto|despesa|ultimo|ultima)\b/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

```

**Fix 2 — fast-path para pronome contextual:**

```typescript
// Se searchTerm ficou vazio E tem pronome contextual → buscar mais recente
if (isRecurringCancel && hasContextPronoun && !searchTerm) {
  const recorrentes = await listActiveRecurrings(userId);
  if (recorrentes.length === 0) {
    await sendMessage(phoneNumber, "Você não tem gastos recorrentes ativos para cancelar 🤔", messageSource);
    return;
  }
  const rec = recorrentes[0];
  await createAction(userId, "cancel_recurring", "cancel",
    { transaction_id: rec.id, options: [rec.id] }, "confirmation", messageId);
  await sendButtons(phoneNumber,
    `🔄 Cancelar *${rec.descricao}* (R$ ${Number(rec.valor_parcela).toFixed(2)}/mês)?`,
    [
      { id: "cancel_confirm_rec_yes", title: "✅ Sim, cancelar" },
      { id: "cancel_confirm_no", title: "❌ Não" }
    ],
    messageSource
  );
  return;
}

```

---

## BUG 3 — Descrição de income salva como verbo ("Recebi", "Ganhei") (P1)

**Arquivos:** `supabase/functions/finax-worker/decision/classifier.ts` + `supabase/functions/finax-worker/core/intent-router.ts`

**Problema:** "recebi 500 de salário" extrai "Recebi" como descrição porque o VERB_ONLY fix não cobre verbos de income.

**Fix 1 — classifier.ts, expandir VERB_ONLY:** Localizar onde estão os verbos de expense que são descartados e adicionar os verbos de income:

```typescript
const INCOME_VERBS = ["recebi", "ganhei", "entrou", "pingou", "mandaram", "caiu", "depositaram", "transferiram"];
// Se description é apenas um verbo de income, descartar
if (INCOME_VERBS.includes(description?.toLowerCase())) {
  slots.description = undefined;
}

```

**Fix 2 — intent-router.ts, no income handler:** Após classificação, se `slots.description` está vazio ou é verbo, extrair descrição do texto real:

```typescript
// Extrair descrição real: "recebi 500 de salário" → "Salário"
function extractIncomeDescription(text: string): string | undefined {
  const normalized = text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const match = normalized.match(/(?:recebi|ganhei|entrou|caiu)\s+[\d.,]+\s+(?:de\s+)?(.+)/);
  if (match && match[1]) {
    const desc = match[1].trim()
      .replace(/\b(de|do|da|no|na|pelo|pela)\b/g, "")
      .replace(/\s+/g, " ").trim();
    return desc.charAt(0).toUpperCase() + desc.slice(1);
  }
  return undefined;
}

// Aplicar antes de registrar:
if (!slots.description || INCOME_VERBS.includes(slots.description.toLowerCase())) {
  slots.description = extractIncomeDescription(conteudoProcessado) || "Entrada";
}

```

---

## BUG 4 — Recorrente crédito não pergunta cartão (P3)

**Arquivo:** `supabase/functions/finax-worker/core/intent-router.ts` (recurring handler)

**Problema:** "netflix 55 todo mês no crédito" tem todos os slots obrigatórios preenchidos (`amount`, `description`, `payment_method`). O handler executa direto sem verificar se precisa de cartão.

**Fix — antes de executar registerRecurring, verificar cartão:**

```typescript
// Se payment_method é crédito, verificar cartão
if (slots.payment_method === "credito" && !slots.card_id) {
  const cards = await listCardsForUser(userId);
  if (cards.length === 0) {
    await sendMessage(payload.phoneNumber,
      "Você não tem cartões cadastrados. Quer registrar sem cartão vinculado?",
      payload.messageSource);
    return;
  }
  if (cards.length === 1) {
    // Vincular automaticamente
    slots.card_id = cards[0].id;
    slots.card = cards[0].nome;
  } else if (cards.length <= 3) {
    await createAction(userId, "recurring", "recurring", slots, "card_id", payload.messageId);
    await sendButtons(payload.phoneNumber,
      `🔄 ${slots.description} - R$ ${Number(slots.amount).toFixed(2)}/mês\n\nQual cartão?`,
      cards.map(c => ({ id: `rec_card_${c.id}`, title: (c.nome || "Cartão").slice(0, 20) })),
      payload.messageSource);
    return;
  } else {
    await createAction(userId, "recurring", "recurring", slots, "card_id", payload.messageId);
    await sendListMessage(payload.phoneNumber,
      `🔄 ${slots.description} - R$ ${Number(slots.amount).toFixed(2)}/mês\n\nQual cartão?`,
      "Ver cartões",
      [{ title: "Seus cartões", rows: cards.map(c => ({
        id: `rec_card_${c.id}`,
        title: (c.nome || "Cartão").slice(0, 24),
        description: `Disponível: R$ ${(c.limite_disponivel ?? 0).toFixed(2)}`
      }))}],
      payload.messageSource);
    return;
  }
}

```

---

## BUG 5 — "liste as minhas recorrencias" retorna gastos do mês (P4)

**Arquivo:** `supabase/functions/finax-worker/utils/text-helpers.ts` (função `detectQueryScope`)

**Problema:** "recorrencias" (sem acento, normalizado) não bate com "recorrente". Retorna scope errado.

**Fix — expandir detecção de recurring:**

```typescript
// Localizar o bloco de detecção de recurring e expandir:
if (
  normalized.includes("recorrente") ||
  normalized.includes("recorrencia") ||  // ADD
  normalized.includes("recorrencias") || // ADD
  normalized.includes("assinatura") ||
  normalized.includes("assinaturas") ||  // ADD
  normalized.includes("fixos") ||
  normalized.includes("gastos fixos") || // ADD
  normalized.includes("gastos mensais")  // ADD
) {
  return "recurring";
}

```

---

## BUG 6 — Áudio sem descrição → categoria "outros" (P2)

**Arquivo:** `supabase/functions/finax-worker/intents/expense-inline.ts`

**Problema:** Log mostra `📂 [CAT] Descrição vazia - retornando "outros"`. O slot `description` chega como `undefined` para gastos de áudio mesmo quando o texto transcrito tem a descrição.

**Fix — safety guard no registerExpenseInline:**

```typescript
// No início de registerExpenseInline, se description está vazio mas temos o texto original
if (!slots.description && slots._raw_text) {
  // Tentar extrair descrição do texto bruto
  const raw = slots._raw_text as string;
  const descMatch = raw.match(/(?:no|na|no\s+|na\s+|em\s+)([a-záéíóúâêîôûãõç\s]+?)(?:\s+pix|\s+debito|\s+credito|\s+dinheiro|$)/i);
  if (descMatch) {
    slots.description = descMatch[1].trim();
  }
}

// Também garantir que description nunca é undefined ao categorizar:
const descricao = slots.description || conteudoProcessado || "Gasto";

```

**Também em index.ts:** ao processar áudio, passar o texto transcrito nos slots:

```typescript
slots._raw_text = transcricao; // guardar texto original para safety guard

```

---

## BUG 7 — Formato da mensagem de income (P9)

**Arquivo:** `supabase/functions/finax-worker/intents/income.ts`

**Problema:** Income usa ponto decimal e não mostra categoria. Formato deve ser consistente com expense.

**Fix — localizar onde monta a mensagem de sucesso e substituir:**

```typescript
const valorFormatado = Number(valor).toFixed(2).replace(".", ",");
const dataFormatada = formatBrasiliaDateTime(new Date());
const categoriaDisplay = categoria || "outros";
const descricaoDisplay = descricao || "Entrada";
const fonteDisplay = fonte || "outro";

const msg =
  `💰 *Entrada registrada!*\n\n` +
  `✅ +R$ ${valorFormatado}\n` +
  `📂 ${categoriaDisplay}\n` +
  `📝 ${descricaoDisplay}\n` +
  `💳 ${fonteDisplay}\n` +
  `📅 ${dataFormatada}`;

```

---

## BUG 8 — Double-deduction do limite do cartão (P8)

**Arquivo:** `supabase/functions/finax-worker/intents/expense-inline.ts`

**Problema:** Quando gasto crédito é registrado via botão `card_*`, o `credit-flow.ts` já deduziu o limite durante a seleção. O `expense-inline.ts` deduz de novo → saldo dobrado.

**Fix — verificar se já foi processado pelo credit-flow:**

```typescript
// Se slots.fatura_id já existe, o credit-flow processou. Não deduzir limite de novo.
const jaProcessadoPeloCreditFlow = !!(slots.fatura_id);

if (slots.card_id && !jaProcessadoPeloCreditFlow) {
  // deduzir limite aqui
  await supabase.rpc("atualizar_limite_cartao", {
    p_cartao_id: slots.card_id,
    p_valor: -Number(slots.amount)
  });
}

```

---

## BUG 9 — Parcelas não progridem mensalmente / não aparecem no site (P7 + P10)

**Este bug tem duas partes:**

### Parte A — CRON não está descontando parcelas

**Arquivo:** `supabase/functions/processar-recorrentes/index.ts`

Verificar se a função `processarParcelasFuturas` (ou equivalente) existe e está:

1. Buscando parcelas com `status = "futura"` E `mes_referencia <= data_atual`
2. Atualizando o `parcelamentos.parcela_atual` após processar
3. Sendo chamada pelo pg_cron diariamente

Se não existir lógica de parcelas, adicionar:

```typescript
// Buscar parcelas do mês atual que ainda não foram processadas
const hoje = new Date();
const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

const { data: parcelasPendentes } = await supabase
  .from("parcelas")
  .select("*, parcelamentos(*)")
  .eq("status", "futura")
  .lte("mes_referencia", mesAtual + "-28");

for (const parcela of parcelasPendentes || []) {
  // Criar transação da parcela
  await supabase.from("transacoes").insert({
    usuario_id: parcela.parcelamentos.usuario_id,
    descricao: parcela.parcelamentos.descricao,
    valor: parcela.valor_parcela,
    tipo: "saida",
    categoria: parcela.parcelamentos.categoria,
    data: new Date().toISOString(),
    status: "confirmada",
    id_parcelamento: parcela.parcelamento_id,
    numero_parcela: parcela.numero_parcela
  });

  // Atualizar status da parcela
  await supabase
    .from("parcelas")
    .update({ status: "paga", paga_em: new Date().toISOString() })
    .eq("id", parcela.id);

  // Atualizar parcela_atual no parcelamento
  await supabase
    .from("parcelamentos")
    .update({ parcela_atual: parcela.numero_parcela })
    .eq("id", parcela.parcelamento_id);
}

```

### Parte B — Parcelamentos não aparecem no site

**Arquivo:** `src/hooks/useParcelamentos.ts`

```typescript
// Adicionar filtro ativa=true e realtime
const { data } = await supabase
  .from("parcelamentos")
  .select("*, parcelas(*)")
  .eq("usuario_id", userId)
  .eq("ativa", true)  // ADD
  .order("created_at", { ascending: false });

// Adicionar realtime:
supabase
  .channel("parcelamentos_changes")
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "parcelamentos",
    filter: `usuario_id=eq.${userId}`
  }, () => refetch())
  .subscribe();

```

---

## BUG 10 — Cancelamento de recorrente não reflete no site (P já identificado)

**Arquivo:** `src/hooks/useGastosRecorrentes.ts` (ou equivalente)

**Verificar:**

1. Query filtra `ativo = true`?
2. Tem realtime subscription?

**Fix se não tiver:**

```typescript
// Garantir filtro
.eq("ativo", true)

// Garantir realtime
supabase
  .channel("recorrentes_changes")
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "gastos_recorrentes",
    filter: `usuario_id=eq.${userId}`
  }, () => refetch())
  .subscribe();

```

---

## Ordem de implementação

Execute nessa sequência exata — da mais crítica para menos crítica:


| #   | Bug                                 | Arquivo principal                         | Impacto                |
| --- | ----------------------------------- | ----------------------------------------- | ---------------------- |
| 1   | Parcelamento sem nº parcelas        | `core/intent-router.ts` + `fsm-router.ts` | Fluxo quebrado         |
| 2   | Cancel recorrência contextual       | `intents/cancel-routing.ts`               | UX quebrada            |
| 3   | Descrição income como verbo         | `classifier.ts` + `intent-router.ts`      | Dados errados          |
| 4   | Recorrente crédito sem cartão       | `core/intent-router.ts`                   | Dados incompletos      |
| 5   | Query recorrências scope errado     | `utils/text-helpers.ts`                   | Query errada           |
| 6   | Áudio sem descrição → outros        | `intents/expense-inline.ts`               | Categorização errada   |
| 7   | Formato mensagem income             | `intents/income.ts`                       | Visual ruim            |
| 8   | Double-deduction cartão             | `intents/expense-inline.ts`               | Saldo incorreto        |
| 9   | Parcelas não progridem              | `processar-recorrentes/index.ts`          | Dados defasados        |
| 10  | Parcelamentos e recorrentes no site | `src/hooks/`                              | Frontend desatualizado |


---

## Regras gerais

1. Não reescreva lógica que não está no escopo de cada bug
2. Após cada correção, aponte o arquivo e as linhas exatas que foram modificadas
3. Para os bugs de frontend (9B e 10), verificar primeiro se a tabela `parcelas` realmente existe no schema antes de escrever queries
4. Todos os valores monetários no WhatsApp devem usar vírgula como separador decimal (R$ 200,00 e não R$ 200.00)
5. Todas as datas devem usar `formatBrasiliaDateTime` para garantir fuso horário correto