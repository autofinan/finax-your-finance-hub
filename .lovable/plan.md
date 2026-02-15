# Plano: Correcao dos 5 Bugs Criticos

## Bug #1: 4+ Cartoes mostra botoes em vez de lista

**Causa raiz:** Em `credit-flow.ts` linha 170, o CASO 5 (4+ cartoes) retorna `useListMessage: false`. O handler no `index.ts` verifica `useListMessage` primeiro - como e `false`, cai para `cardButtons` e envia 3 botoes (2 top + Outros) em vez da lista.

**Requisito do usuario:** 4+ cartoes = lista interativa direto (mais rapido, sem "Outros").

**Fix:** Em `credit-flow.ts`, alterar CASO 5:

- Remover logica de "2 mais usados + Outros"
- Retornar `useListMessage: true` com a lista completa de cartoes
- Manter CASO 3 (1 cartao = auto) e CASO 4 (2-3 = botoes)

---

## Bug #2: Duplicata sem botoes

**Causa raiz:** Em `index.ts` linha 4793, o fluxo principal de expense usa `sendMessage` para enviar o resultado. A funcao `handleExpenseResult` (linha 2019) e que verifica `isDuplicate` e envia botoes, mas NAO e chamada nesse ponto.

**Fix:** Substituir `sendMessage(payload.phoneNumber, result.message, ...)` por `handleExpenseResult(result, payload.phoneNumber, payload.messageSource)` na linha 4793.

---

## Bug #3: Relatorio semanal sem dados

**Causa raiz:** A RPC `fn_relatorio_semanal` aceita parametros `(p_usuario_id, p_data_inicio, p_data_fim)`. O codigo chama com `{ p_usuario_id, p_tipo_periodo: "semana_atual" }`. O parametro `p_tipo_periodo` NAO existe na funcao -- PostgREST rejeita parametros desconhecidos, causando erro silencioso.

A propria RPC, quando recebe `p_data_inicio = NULL`, calcula a semana automaticamente (segunda a domingo). Para a semana ATUAL funcionar, basta chamar sem datas.

**Fix:** Remover `p_tipo_periodo` das 3 chamadas a `fn_relatorio_semanal` no `index.ts` (linhas 549, 5781, 5996). Chamar apenas com `{ p_usuario_id: userId }`.

---

# 🔴 BUG 4 CRÍTICO: PERDA DE CONTEXTO CONVERSACIONAL

---

## ❌ PROBLEMA IDENTIFICADO:

```
User: "QUANTO GASTEI COM ALIMENTAÇÃO ESSE MES?"
Bot: [Lista de gastos com alimentação] ✅

User: "E TRANSPORTE" ← Continuação da pergunta
Bot: "Qual valor de limite mensal você quer definir?" ❌❌❌

PROBLEMA: Bot perdeu COMPLETAMENTE o contexto!
- Não entendeu que "E TRANSPORTE" = "quanto gastei com transporte"
- Classificou como orçamento (totalmente errado)
```

---

## 🔍 CAUSA RAIZ:

### **1. Histórico NÃO está sendo usado pela IA**

Mesmo com a correção de memória que fizemos, a IA ainda não está vendo o contexto.

**Possíveis causas:**

- Histórico não está sendo injetado no prompt (implementação incompleta)
- IA ignora histórico mesmo quando presente
- Sistema Prompt não instrui sobre continuidade de conversa

---

## Bug #5: Follow-up de ajuda vai para o Chat (IA generica)

**Causa raiz:** Apos "ajuda" → menu, o contexto `lastIntent: "help"` e salvo. Mas quando o usuario responde "preciso de ajuda com o registro de gastos", a IA classifica como `chat` (nao `control`). O handler de help follow-up (linha 6432) so e executado DENTRO do bloco `if (decision.actionType === "control")`, que nunca e alcancado.

Resultado: a mensagem vai para `generateChatResponse` que da conselhos genericos de consultor financeiro em vez de mostrar exemplos praticos do Finax.

**Fix:** Mover a verificacao de `helpCtx?.lastIntent === "help"` para ANTES do roteamento por `actionType`. Assim, independente de como a IA classifica, se o contexto e de ajuda, o follow-up e tratado pelo handler correto.

Posicao: logo antes do bloco `if (decision.actionType === "chat")` (linha 6366), inserir:

```text
// Verificar help context ANTES do roteamento
const helpCtx = await getConversationContext(userId);
if (helpCtx?.lastIntent === "help") {
  // [mesma logica das linhas 6436-6509, copiada aqui]
  // Se match → responder e return
  // Se nao match → pedir clarificacao e return
}
```

---

## Secao Tecnica - Mudancas por Arquivo

```text
supabase/functions/finax-worker/intents/credit-flow.ts
  Linhas 128-182 (CASO 5): Simplificar para lista direta
    - Remover logica de top2 + Outros
    - Retornar useListMessage: true com listSections completa
    - cardButtons = undefined (nao necessario)

supabase/functions/finax-worker/index.ts
  L4793: sendMessage → handleExpenseResult (Bug #2 - duplicata)
  L549:  Remover p_tipo_periodo da chamada RPC (Bug #3)
  L5781: Remover p_tipo_periodo da chamada RPC (Bug #3)
  L5996: Remover p_tipo_periodo da chamada RPC (Bug #3)
  L~6360: Inserir help context check ANTES do chat handler (Bug #5)
 
DEPLOY: finax-worker
```

## Ordem de Execucao

```text
1. credit-flow.ts - Lista para 4+ cartoes          (Bug #1)
2. index.ts L4793 - handleExpenseResult             (Bug #2)
3. index.ts RPCs  - Remover p_tipo_periodo          (Bug #3)
5. index.ts help  - Mover check antes do chat       (Bug #5)
6. Deploy finax-worker
```

## Resultado Esperado

```text
"acai 15 credito" (5 cartoes) → Lista interativa WhatsApp    OK
"balinha 1 pix" (2x) → Botoes [Sim registrar] [Nao era erro] OK
"relatorio semanal" → Dados reais da semana                   OK
"ajuda" → menu → "registro de gastos" → exemplos praticos     OK
```