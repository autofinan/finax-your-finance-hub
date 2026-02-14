

# Plano de Correcao Completa - Rodada Final

## Resumo dos Bugs Identificados

### WhatsApp (Edge Function)

| # | Bug | Gravidade | Causa Raiz |
|---|-----|-----------|------------|
| WA-1 | "nao foi no Sicredi" pede forma de pagamento em vez de cartao | CRITICO | `edit` handler so oferece pix/debito/credito. Nao detecta correcao de CARTAO. `updateTransactionPaymentMethod` so atualiza `forma_pagamento`, nao `id_cartao` |
| WA-2 | "ja tenho 250 para viagem" pergunta se quer atualizar objetivo | CRITICO | IA classifica como `goal` (nao `add_goal_progress`). `createGoal` encontra meta similar e oferece "atualizar objetivo" ao inves de adicionar ao acumulado |
| WA-3 | Categorias usa botoes (max 3) em vez de lista interativa | MEDIO | Handler `view_by_category` usa `sendButtons` com slice(0,3) em vez de `sendListMessage` |
| WA-4 | "relatorio semanal" mostra resumo mensal | MEDIO | `detectQueryScope` nao tem case para "relatorio/semanal". Cai no fallback "summary" |
| WA-5 | Parcelamento falha: coluna `is_parcelado` nao existe | CRITICO | `installment.ts` linha 172 insere `is_parcelado: true` mas a coluna NAO existe na tabela `transacoes` |
| WA-6 | Credito nao pede cartao (gasto avulso) | MEDIO | Quando usuario responde "Credito" a slot payment_method, o fluxo resolve automaticamente para cartao unico sem perguntar. Na correcao (edit), so muda `forma_pagamento` sem vincular cartao |
| WA-7 | Duplicata: botao "Nao" nao funciona | MEDIO | Resposta "nao" como TEXTO (nao botao) cai na IA como `unknown` conf 0.4. O guard de `activeAction` para `duplicate_confirm` nao captura texto livre |

### Dashboard (Frontend)

| # | Bug | Gravidade | Causa Raiz |
|---|-----|-----------|------------|
| DASH-1 | Transacoes em ordem incorreta | BAIXO | Query ordena por `data DESC` mas transacoes do mesmo dia ficam sem ordem secundaria por `created_at` |
| DASH-2 | Sem filtros rapidos (Hoje, 7 dias, 30 dias) | MEDIO | Falta botoes de atalho para periodos comuns |
| DASH-3 | Contas a pagar duplicadas | MEDIO | Cada conta aparece 1 card sem indicar se ja foi paga este mes. Sem filtro por `mes_referencia` |
| DASH-4 | Parcelamento nao atualiza ao pagar cartao | BAIXO | Sem logica para marcar parcelas como pagas quando fatura e paga |

---

## Secao Tecnica

### WA-1: Correcao de cartao ("nao foi no Sicredi")

**Problema detalhado:** Quando o usuario diz "nao foi no Sicredi", a IA classifica como `edit`. O handler de edit (linha 4322) oferece botoes de FORMA DE PAGAMENTO (pix/debito/credito). Mas o usuario quer trocar o CARTAO, nao a forma.

**Correcao:**
1. No handler de `edit` (linha 4322-4352): Detectar se a mensagem menciona nome de cartao (ex: "nao foi no Sicredi"). Se sim, e a transacao ja e credito, mostrar lista de cartoes em vez de formas de pagamento.
2. Criar funcao `updateTransactionCard(txId, cardId, cardName)` que atualiza `id_cartao` na transacao.
3. Adicionar handlers `edit_card_{id}` na secao de botoes para completar a troca de cartao.

**Arquivos:** `index.ts` (handler edit + novo handler de botao)

### WA-2: Meta "ja tenho 250 para viagem" deve adicionar

**Problema detalhado:** A IA classifica como `goal` com `{amount: 250, description: "viagem"}`. O handler de `goal` (linha 5083) chama `createGoal` que encontra meta existente "viagem" e retorna "Quer atualizar o objetivo para R$ 250?".

**Correcao:**
1. No handler de `goal` (linha 5083-5127): ANTES de chamar `createGoal`, verificar se ja existe meta com nome similar. Se sim, detectar se a intencao e ADICIONAR (palavras como "tenho", "guardei", "adicionei", "juntei", "adicionar", "depositar") vs CRIAR. Se for adicionar, chamar `addToGoal` em vez de `createGoal`.
2. Se nao detectar intencao clara, perguntar com botoes: "Adicionar R$ 250 a meta viagem?" vs "Atualizar objetivo para R$ 250?"

**Arquivos:** `index.ts` (handler goal, linhas 5083-5127)

### WA-3: Categorias deve usar lista interativa

**Problema detalhado:** O handler `view_by_category` no index.ts monta botoes das top 3 categorias. Com 8+ categorias, o usuario perde opcoes.

**Correcao:** Substituir `sendButtons` por `sendListMessage` quando ha 4+ categorias. Manter botoes apenas se <= 3 categorias.

**Arquivos:** `index.ts` (handler view_by_category)

### WA-4: "relatorio semanal" nao reconhecido

**Problema detalhado:** `detectQueryScope` nao tem case para "relatorio". O texto "relatorio semanal" cai no case `summary` default e mostra resumo mensal generico.

**Correcao:**
1. Adicionar case na secao de query (switch): detectar `normalized.includes("relatorio") && normalized.includes("semanal")`.
2. Chamar `supabase.rpc("fn_relatorio_semanal", { p_usuario_id: userId })` e gerar texto com IA (mesma logica da edge function `enviar-relatorio-semanal`).

**Arquivos:** `index.ts` (secao query switch + detectQueryScope)

### WA-5: Coluna `is_parcelado` nao existe

**Problema detalhado:** O log mostra `Could not find the 'is_parcelado' column of 'transacoes' in the schema cache`. A tabela `transacoes` tem `total_parcelas` mas NAO tem `is_parcelado`.

**Correcao:** Adicionar coluna `is_parcelado` via migracao SQL:
```text
ALTER TABLE public.transacoes ADD COLUMN IF NOT EXISTS is_parcelado BOOLEAN DEFAULT false;
```

**Arquivos:** Migracao SQL

### WA-6: Credito nao pede cartao

**Problema detalhado:** Quando o usuario responde "Credito" ao slot `payment_method`, o fluxo `resolveCreditCard` (linha 4436) resolve automaticamente para o unico cartao ou o ultimo usado. Na correcao (edit_credito), so muda `forma_pagamento` sem vincular cartao.

**Correcao:**
1. No handler `edit_credito` (linhas 3293-3308): Se novo metodo e "credito", em vez de chamar `updateTransactionPaymentMethod`, listar cartoes do usuario e pedir selecao com botoes/lista. Criar action de edit com `pending_slot: "card"`.
2. Adicionar handler `edit_card_{id}` para completar: atualizar tanto `forma_pagamento` quanto `id_cartao` da transacao.

**Arquivos:** `index.ts` (handler edit_* + novo handler edit_card_*)

### WA-7: Duplicata "nao" como texto nao funciona

**Problema detalhado:** O usuario responde "nao" como texto (nao clica no botao). A IA classifica como `unknown` conf 0.4. O guard de `activeAction` para `duplicate_confirm` so funciona com `buttonReplyId`.

**Correcao:** No guard de chat/unknown com action ativa (linhas 5819-5877): Adicionar case para `activeAction.intent === "duplicate_expense"`. Se texto normalizado inclui "nao", cancelar duplicata. Se inclui "sim", registrar.

**Arquivos:** `index.ts` (guard de chat/unknown)

### DASH-1: Ordem das transacoes

**Correcao:** No `useTransacoes.ts` (linha 26), adicionar ordenacao secundaria:
```text
.order('data', { ascending: false })
.order('created_at', { ascending: false })
```

**Arquivos:** `src/hooks/useTransacoes.ts`

### DASH-2: Filtros rapidos

**Correcao:** Adicionar botoes de atalho na pagina Transacoes: "Hoje", "Ontem", "7 dias", "30 dias", "Este mes". Cada botao preenche automaticamente `dataInicio` e `dataFim`.

**Arquivos:** `src/pages/Transacoes.tsx`

### DASH-3: Contas a pagar duplicadas

**Problema:** A mesma conta (ex: "agua") aparece 1 card mas sem indicar se ja foi paga ESTE MES. O usuario nao sabe se ja pagou ou nao.

**Correcao:**
1. No `useContasPagar.ts`: Ao carregar contas, fazer join com `pagamentos` do mes atual para trazer status de pagamento.
2. Na UI `ContasPagar.tsx`: Mostrar badge "Pago em DD/MM" se ja tem pagamento no mes, ou "Pendente" se nao.

**Arquivos:** `src/hooks/useContasPagar.ts` + `src/pages/ContasPagar.tsx`

### DASH-4: Parcela atualiza ao pagar fatura

**Correcao:** No `useFaturas.ts`, apos `pagarFatura`: chamar funcao para marcar parcelas vinculadas aquela fatura como "paga" e liberar limite proporcional do cartao.

**Arquivos:** `src/hooks/useFaturas.ts`

---

## Ordem de Implementacao

```text
DIA 1 (Criticos - WhatsApp):
  1. WA-5: Migracao is_parcelado (5 min)
  2. WA-2: Meta "ja tenho X" → addToGoal (30 min)
  3. WA-7: Duplicata "nao" como texto (15 min)
  4. WA-1: Correcao de cartao (45 min)
  5. WA-6: Credito pede cartao no edit (30 min)

DIA 2 (Importantes - WhatsApp + Dashboard):
  6. WA-4: "relatorio semanal" on-demand (45 min)
  7. WA-3: Categorias com lista (15 min)
  8. DASH-1: Ordem transacoes (5 min)
  9. DASH-2: Filtros rapidos (30 min)
  10. DASH-3: Contas duplicadas (45 min)
  11. DASH-4: Parcela ao pagar fatura (30 min)

DIA 3: Testes finais
```

## Arquivos Afetados

```text
supabase/functions/finax-worker/index.ts
  - Handler edit: detectar correcao de cartao
  - Handler goal: detectar "ja tenho/guardei" e chamar addToGoal
  - Handler view_by_category: usar lista interativa
  - Query switch: case para "relatorio semanal"
  - Guard chat/unknown: case para duplicate_confirm texto
  - Handler edit_*: se credito, pedir cartao

supabase/functions/finax-worker/intents/installment.ts
  - Remover is_parcelado do insert (ou manter apos migracao)

Migracao SQL:
  - ADD COLUMN is_parcelado BOOLEAN DEFAULT false

src/hooks/useTransacoes.ts
  - Adicionar .order('created_at', { ascending: false })

src/pages/Transacoes.tsx
  - Botoes de filtro rapido

src/hooks/useContasPagar.ts
  - Join com pagamentos do mes atual

src/pages/ContasPagar.tsx
  - Badge de status (pago/pendente) por mes

src/hooks/useFaturas.ts
  - Apos pagar fatura, atualizar parcelas vinculadas
```

## Principios

- Zero regressao: todas as mudancas sao aditivas
- Cada bloco pode ser testado independentemente
- Priorizar bugs que BLOQUEIAM funcionalidade (is_parcelado, metas, duplicata)
- Dashboard e polish fazem parte do DIA 2

