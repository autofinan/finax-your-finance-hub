

# Plano de Correcao Completa - Finax Worker

## Problemas Identificados

### Problema 1: Selecao de cartao mostra texto em vez de botoes/lista interativa
**O que acontece:** Quando usuario diz "cafe 5,40 credito" e tem 4 cartoes, o sistema mostra lista numerada em texto com "Responde com o numero do cartao" em vez de usar botoes interativos (ate 3) ou lista interativa do WhatsApp (4+).

**Causa raiz:** O `credit-flow.ts` ja foi corrigido para retornar `useListMessage` e `listSections`, e o `index.ts` ja tem `sendListMessage`. Porem, o codigo no bloco de expense (linha ~4126) envia a lista corretamente, MAS o fallback de texto na mensagem do `credit-flow.ts` (linha 142) ainda inclui "Responde com o numero do cartao" que e redundante quando a lista interativa funciona. O problema real e que **a funcao `sendListMessage` pode estar falhando silenciosamente** e caindo no fallback de texto. Alem disso, ha o bug do "R$ undefined disponivel" no Sicredi.

### Problema 2: "R$ undefined disponivel" no cartao Sicredi
**O que acontece:** Cartao Sicredi mostra "R$ undefined disponivel" porque `limite_disponivel` e `null` no banco.

**Causa raiz:** A migracao SQL para corrigir valores `null` ja foi aprovada/executada, mas o codigo em `credit-flow.ts` linha 134 ja usa `c.limite_disponivel ?? c.limite_total ?? 0`. O problema e que a mensagem de texto (fallback) no `credit-flow.ts` linha 135 usa `c.limite_disponivel` que pode ser null antes do fallback. Precisa verificar se a migracao realmente rodou.

### Problema 3: "Acai 25" tratado como numero isolado
**O que acontece:** Quando usuario manda "Acai 25", o sistema cria uma action `numero_isolado` com pending_slot `type_choice` e amount `1` (!!). Depois "Sim" dispara confirmacao que cai no case `default` do `generateConfirmationMessage`, exibindo JSON bruto.

**Causa raiz:** O `isNumericOnly("Acai 25")` retorna `false` (correto), mas no decision engine, o resultado da IA provavelmente retorna `unknown` com baixa confianca, e o fallback final no `isNumericOnly` check pega. Olhando os logs: `amount: 1` e `type_choice: "Acai 25"` - isso indica que o texto "Acai 25" foi inserido como `type_choice` quando deveria ter sido classificado como expense. O intent `numero_isolado` nao e reconhecido no switch case do `generateConfirmationMessage`, causando JSON bruto.

### Problema 4: Botoes "Ver todos" / "Por categoria" nas queries
**O que acontece:** Ja implementado no codigo (linhas 4997-5011), mas precisa verificar se funciona corretamente na pratica com os handlers de botao (linhas 3361-3487).

### Problema 5: "Detalhe alimentacao" nao filtra por categoria
**O que acontece:** Ja implementado (linhas 4936-4948), precisa verificar se funciona.

---

## Correcoes Necessarias

### Correcao 1: `credit-flow.ts` - Garantir lista interativa para 4+ cartoes

**Arquivo:** `supabase/functions/finax-worker/intents/credit-flow.ts`

O codigo atual (linhas 131-158) ja tem a logica de lista interativa. O problema e sutil: a mensagem de fallback (linha 142) diz "Responde com o numero do cartao" que so deveria aparecer se a lista interativa falhar. A estrutura esta correta, mas precisa garantir que `sendListMessage` no `index.ts` funcione.

**Acao:** Verificar que o fluxo no `index.ts` (linhas 4126-4128) esta chamando `sendListMessage` corretamente quando `useListMessage === true`.

### Correcao 2: `index.ts` - Corrigir tratamento de "Acai 25" como numero isolado

**Arquivo:** `supabase/functions/finax-worker/index.ts`

**Causa:** O intent `numero_isolado` nao esta nos cases do `generateConfirmationMessage` em `context-handler.ts`. Quando "Acai 25" chega com action `numero_isolado` e pending_slot `type_choice`, a FSM preenche `type_choice = "Acai 25"` (toda a mensagem como valor do slot). Depois, como nao tem mais slots faltando, marca `readyToExecute: true`. No executor (linha 3736), cai no case `default` que pede confirmacao via `generateConfirmationMessage`, e como nao ha case para `numero_isolado`, mostra JSON bruto.

**Solucao:**
1. Em `context-handler.ts`, o slot `type_choice` deveria validar se o valor e "expense" ou "income" (nao aceitar texto livre)
2. Se a mensagem "Acai 25" chega quando ha action `numero_isolado` com pending_slot `type_choice`, deveria reconhecer que nao e resposta valida e cancelar a action, permitindo reprocessar como novo expense
3. Adicionar case `numero_isolado` no `generateConfirmationMessage` como fallback de seguranca

### Correcao 3: FSM `context-handler.ts` - Validar slot `type_choice`

**Arquivo:** `supabase/functions/finax-worker/fsm/context-handler.ts`

Na funcao `extractSlotValue`, adicionar case para `type_choice` que so aceite "gasto", "entrada", "expense", "income" e similares. Se a mensagem nao corresponder, retornar `null` para que o sistema repergunte ou cancele e reprocesse.

### Correcao 4: `generateConfirmationMessage` - Adicionar case `numero_isolado`

**Arquivo:** `supabase/functions/finax-worker/fsm/context-handler.ts`

No default case da funcao `generateConfirmationMessage` (linha 464), em vez de mostrar `JSON.stringify(slots)`, formatar de forma amigavel:

```text
default:
  message = `*Confirmar:*\n\n`;
  if (slots.amount) message += `R$ ${slots.amount.toFixed(2)}\n`;
  if (slots.description) message += `${slots.description}\n`;
```

### Correcao 5: `index.ts` - Handler de `numero_isolado` no executor da FSM

**Arquivo:** `supabase/functions/finax-worker/index.ts`

Na secao de confirmacao recebida (linha 3652-3709), o switch case nao tem `numero_isolado`. Quando o usuario confirma "Sim" num contexto de numero isolado, o sistema precisa saber se e gasto ou entrada para executar. Como o `type_choice` esta nos slots, precisamos rotear:

```text
case "numero_isolado":
  if (slots.type_choice === "expense" || activeAction.slots.original_intent === "expense") {
    result = await registerExpense(userId, slots, activeAction.id);
  } else {
    result = await registerIncome(userId, slots, activeAction.id);
  }
  break;
```

### Correcao 6: Verificar e garantir migracao SQL dos limites null

Verificar se a migracao `20260210003203` realmente rodou para corrigir `limite_disponivel IS NULL` nos cartoes de credito. Se nao, reexecutar.

### Correcao 7: Tolerancia a typos na confirmacao ("sjm" = "sim")

**Arquivo:** `supabase/functions/finax-worker/fsm/context-handler.ts`

Na funcao `handleConfirmation` (linha 126), adicionar palavras com typos comuns:

```text
const positiveWords = ["sim", "s", "yes", "confirma", "confirmar", "isso", "certeza", "ok", "certo", "sjm", "simmm", "siin", "si"];
```

---

## Ordem de Implementacao

1. **context-handler.ts** - Corrigir `extractSlotValue` para `type_choice`, adicionar case `numero_isolado` no `generateConfirmationMessage`, adicionar tolerancia a typos
2. **index.ts** - Adicionar case `numero_isolado` no executor de confirmacao (linha ~3658)
3. **credit-flow.ts** - Verificar que o fallback de texto nao sobrescreve a lista interativa
4. **Verificar migracao SQL** - Confirmar que limites null foram corrigidos
5. **Deploy e testar**

## Impacto

- **Zero regressao:** Nenhuma funcionalidade existente e removida ou alterada em comportamento
- **Correcoes cirurgicas:** Cada mudanca e pontual e isolada
- **Compatibilidade:** As mudancas sao aditivas (novos cases, novas validacoes)
- **Arquivos afetados:** `context-handler.ts`, `index.ts` (2 pontos), `credit-flow.ts` (verificacao)

