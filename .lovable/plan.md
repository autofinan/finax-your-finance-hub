

# Plano de Correcao Completa - Finax Conversacional + Botoes

## Filosofia Central

O Finax e um assistente CONVERSACIONAL que usa botoes apenas quando ha opcoes objetivas e limitadas. Saudacoes, ajuda e dialogos sao CONVERSA. Selecao de cartao, forma de pagamento e confirmacoes sao BOTOES.

---

## BLOCO 1: Botoes "Ver todos" / "Por categoria" (BUG CRITICO)

**Problema:** Clicar em [Ver todos] ou [Por categoria] retorna "perdi o contexto" porque esses botoes caem no guard `EXPIRED_BUTTON` (linha 3047) que exige `activeAction`.

**Causa raiz:** Os handlers `view_all_*` e `view_by_category_*` ja existem (linhas 3480-3606) MAS estao DENTRO do bloco `if (activeAction)` (o guard na linha 3047 retorna antes de chegar neles).

**Correcao:** Mover os handlers de `view_all_*` e `view_by_category_*` para ANTES do guard de `EXPIRED_BUTTON`. Esses botoes sao auto-suficientes (extraem parametros do proprio ID) e nao precisam de action ativa.

**Arquivo:** `index.ts` - Reorganizar ordem dos handlers de botao (mover linhas 3480-3606 para antes da linha 3047)

---

## BLOCO 2: Parcelamento nao pede cartao com botoes (BUG CRITICO)

**Problema:** "ventilador 140 credito 2x" -> Confirma -> "Qual cartao?" em TEXTO -> usuario responde "sicredi" em texto -> IA retorna unknown conf 0.3 -> "Nao entendi"

**Causa raiz:** No handler `confirm_yes` para `installment` (linha 2940-2943), o resultado de `registerInstallment` nao verifica `needsCardSelection`. O installment.ts retorna `needsCardSelection: true` mas o index.ts ignora e envia `result.message` como texto simples.

**Correcao:**
- **`index.ts`** (case `installment` no confirm_yes, linha 2940): Apos chamar `registerInstallment`, verificar se `result.needsCardSelection === true`. Se sim:
  - Criar action com `pending_slot: "card"` e intent `installment`
  - Se `result.cardButtons` -> `sendButtons`
  - Se `result.useListMessage` -> `sendListMessage`
- O handler de `card_*` na linha 3694 ja trata `activeAction.intent === "installment"`, entao a selecao vai funcionar automaticamente.

**Arquivo:** `index.ts` - Bloco confirm_yes case installment

---

## BLOCO 3: Entrada mostra "outro" em vez da forma de pagamento (BUG IMPORTANTE)

**Problema:** "caiu 500 pix" registra com `💳 outro` na mensagem. Logs confirmam: IA envia `payment_method: "pix"` nos slots, mas income.ts usa `slots.source` (que e undefined) e faz fallback para "outro".

**Causa raiz:** Em `income.ts` linha 44: `const source = slots.source || "outro"`. A IA envia `payment_method` mas income.ts busca `source`. O mapeamento nao existe.

**Correcao:**
- **`income.ts`** (linha 44): Mudar para `const source = slots.source || slots.payment_method || "outro"`. Isso captura tanto quando vem de botao (`src_pix` -> source) quanto da IA (`payment_method`).

**Arquivo:** `intents/income.ts`

---

## BLOCO 4: "meus parcelamentos" mostra resumo geral (BUG IMPORTANTE)

**Problema:** IA classifica como `query` com `query_scope: "installments"`, mas o handler de query nao tem case para installments. Cai no fallback que mostra resumo mensal generico.

**Causa raiz:** No roteamento de query (provavelmente apos linha 4600), nao ha case para `query_scope === "installments"` ou `"installment"` ou `"parcelas"`.

**Correcao:**
- **`index.ts`** (secao de query routing): Adicionar case para `query_scope` contendo "installment"/"parcela"/"parcelamento":
  - Buscar da tabela `parcelamentos` onde `usuario_id = userId` e `ativa = true`
  - Formatar lista com descricao, parcela_atual/num_parcelas, valor_parcela
  - Se nao encontrar: "Nenhum parcelamento ativo"

**Arquivo:** `index.ts` - Secao de query

---

## BLOCO 5: "meus metas" / "minhas metas" mostra resumo geral (BUG SIMILAR)

**Problema:** IA classifica como `query` com `query_scope: "goal"` mas cai no resumo mensal generico.

**Causa raiz:** Mesma causa do BUG #4. Sem case para goals no query router.

**Correcao:**
- **`index.ts`** (secao de query routing): Adicionar case para `query_scope === "goal"` ou `"goals"` ou `"metas"`:
  - Buscar da tabela `metas` onde `usuario_id = userId` e `status = 'ativa'`
  - Formatar com nome, valor_atual/valor_objetivo, percentual de progresso

**Arquivo:** `index.ts` - Secao de query

---

## BLOCO 6: Cancelamento usa lista numerada em texto (BUG MEDIO)

**Problema:** "cancela" mostra lista "1. R$ 4.56 - uber" com "Responde com o numero" em texto.

**Causa raiz:** O handler de cancel cria action com `options` e `pending_slot: "selection"`, e mostra lista numerada. O FSM espera resposta numerica que pode ser confundida com valor.

**Correcao:**
- **`index.ts`** (handler de cancel, onde cria lista numerada): Substituir por botoes (ate 3 transacoes) ou lista interativa (4+):
  - Botoes com `cancel_tx_{id}` (ja existe handler na linha 3423)
  - Lista com `cancel_tx_{id}` como row ID
  - Remover a logica de "selecao numerica" do FSM para cancel

**Arquivo:** `index.ts` - Secao de cancel

---

## BLOCO 7: "Erro ao atualizar contexto" em todos os logs (BUG NAO-BLOQUEANTE)

**Problema:** Erro aparece em TODOS os testes. Provavelmente a tabela `conversation_context` nao tem todas as colunas necessarias ou o upsert falha.

**Causa raiz:** O `conversation-context.ts` faz upsert com campos como `last_card_name`, `last_goal_name`, `last_start_date`, `last_end_date`, `interaction_count` que podem nao existir na tabela.

**Correcao:**
- Verificar schema da tabela `conversation_context` e adicionar colunas faltantes via migracao SQL
- OU simplificar o upsert para usar apenas colunas que existem

**Arquivo:** Migracao SQL + `utils/conversation-context.ts`

---

## BLOCO 8: Saudacao e Ajuda conversacionais (POLIMENTO)

**Problema:** "oi" e "ajuda" retornam respostas basicas sem contexto.

**Correcao (CONVERSA, nao botoes):**
- **Saudacao:** Detectar horario (bom dia/boa tarde/boa noite), buscar ultima atividade do usuario, responder contextualmente. Ex: "Boa tarde! Vi que voce acabou de registrar um cafe. Quer adicionar mais algo?"
- **Ajuda:** Responder com texto conversacional listando exemplos por categoria. Se o usuario responder com topico ("gastos"), detalhar. Usar `conversation_context.last_intent = "help"` para manter contexto da conversa de ajuda.
- NAO usar botoes para saudacao nem ajuda. Manter conversa natural.

**Arquivo:** `index.ts` - Handlers de saudacao e ajuda

---

## BLOCO 9: Meta nao reconhece "ja tenho 250 para essa meta" (BUG MEDIO)

**Problema:** "ja tenho 250 para essa meta" -> IA classifica como `goal` com `amount: 250` mas sem `description`. Pergunta nome da meta. Usuario responde "trafego pago" -> IA classifica como `unknown` conf 0.3.

**Causa raiz:** A resposta ao slot `description` da meta e um texto solto que a IA nao consegue classificar. O FSM (context-handler) deveria capturar isso como preenchimento de slot, mas provavelmente nao tem case para goal/description.

**Correcao:**
- **`fsm/context-handler.ts`**: Garantir que quando `activeAction.intent === "goal"` e `pending_slot === "description"`, qualquer texto livre seja aceito como nome da meta (sem passar pela IA).
- **`index.ts`** (handler de goal): Se IA detecta `goal` com `description` que ja existe, ao inves de perguntar "quer atualizar", verificar se o usuario disse "guardei/adicionei/ja tenho" e adicionar ao acumulado.

**Arquivo:** `fsm/context-handler.ts` + `intents/goals.ts`

---

## Ordem de Implementacao

```text
DIA 1 (Criticos - impacto imediato):
  1. BLOCO 1 - Botoes Ver todos/Por categoria (30 min)
  2. BLOCO 2 - Parcelamento pedir cartao com botoes (1h)
  3. BLOCO 3 - Income forma_pagamento "outro" -> correto (15 min)
  4. BLOCO 7 - Fix "Erro ao atualizar contexto" (30 min)

DIA 2 (Importantes):
  5. BLOCO 4 - Handler "meus parcelamentos" (1h)
  6. BLOCO 5 - Handler "minhas metas" (1h)
  7. BLOCO 6 - Cancel com botoes/lista (1h)
  8. BLOCO 9 - Meta context e "ja tenho X" (1.5h)

DIA 3 (Polimento):
  9. BLOCO 8 - Saudacao e ajuda conversacionais (1.5h)
  10. Testes finais e ajustes
```

## Arquivos Afetados

```text
supabase/functions/finax-worker/index.ts
  - Reorganizar handlers de botao (view_all antes do guard)
  - Case installment no confirm_yes tratar needsCardSelection
  - Cases query para installments e goals
  - Cancel com botoes/lista
  - Saudacao e ajuda conversacionais

supabase/functions/finax-worker/intents/income.ts
  - Mapear payment_method para source

supabase/functions/finax-worker/fsm/context-handler.ts
  - Goal description aceitar texto livre

supabase/functions/finax-worker/utils/conversation-context.ts
  - Fix colunas do upsert

Migracao SQL (se necessario):
  - Adicionar colunas faltantes em conversation_context
```

## Principios

- Zero regressao: todas as mudancas sao aditivas
- Botoes APENAS para opcoes objetivas (pagamento, cartao, confirmacao)
- Conversa para saudacao, ajuda, dialogos
- Cada bloco pode ser deployado e testado independentemente
- Manter contexto ativo ate finalizar a intent (nao expirar prematuramente)

