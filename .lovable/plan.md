
# Plano: Corrigir Engessamento do Finax WhatsApp

## Diagnostico Real (5 Bugs Criticos)

Analisei cada imagem e tracei o fluxo no codigo. Encontrei 5 problemas raiz:

### Bug 1: Loop "Responde com o numero da opcao" (CRITICO)
**Onde:** `fsm/context-handler.ts` linha 210-213
**Causa:** Quando `pending_slot === "selection"` e o usuario NAO envia um numero, o bot responde "Responde com o numero da opcao" e retorna `handled: true, shouldContinue: false`. NAO tem:
- Deteccao de escape ("tchau", "nenhuma", "para")  
- Deteccao de mudanca de assunto ("orcamento", "meta")
- Limite de tentativas (loop infinito)
- Aceitacao de linguagem natural

### Bug 2: "Vamos" apos onboarding nao funciona
**Onde:** `utils/onboarding.ts` linha 295 envia botoes `onb_start` e `onb_plan`, mas quando o usuario DIGITA "Vamos" em vez de clicar no botao, cai no fluxo normal que nao reconhece. Resultado: classificacao unknown, que pode cair em loop.

### Bug 3: "Definir gasto mensal" → 300 → "Gasto ou Entrada?"
**Onde:** `index.ts` linha 4378-4381 - O bloco `set_budget` NAO cria action quando falta `amount`. Ele so manda texto e retorna. Quando o usuario envia "300,00", chega como mensagem NOVA, sem contexto. O fast-track classifica como "numero isolado", cria action `numero_isolado` e pergunta "Gasto ou Entrada?" - COMPLETAMENTE fora de contexto.

### Bug 4: "selection" sem escape no context-handler
**Onde:** `fsm/context-handler.ts` funcao `fillPendingSlot` - O bloco `selection` (linhas 175-214) nao verifica `isCancelIntent` antes de checar se e numero. O `isCancelIntent` e chamado antes na funcao `handleActiveContext`, mas APENAS para palavras exatas como "cancela", "esquece". Palavras como "tchau", "nenhuma", "orcamento" NAO estao na lista.

### Bug 5: context-handler nao detecta mudanca de assunto
**Onde:** `fsm/context-handler.ts` funcao `handleActiveContext` - Quando tem `pending_slot`, o codigo SEMPRE vai para `fillPendingSlot` sem verificar se o usuario mudou de assunto. Precisa verificar ANTES se a mensagem e uma nova intencao.

---

## Solucao

### Arquivo 1: `supabase/functions/finax-worker/fsm/context-handler.ts`

**Mudancas:**

1. **Ampliar `isCancelIntent`** para incluir palavras de escape:
   - Adicionar: "tchau", "nenhuma", "nenhum", "para", "sair", "depois", "nao sei", "nao quero"

2. **Adicionar `isSubjectChange`** - nova funcao que detecta mudanca de assunto:
   - Palavras-chave: "orcamento", "meta", "divida", "resumo", "cartao", "gasto", "entrada", "parcelamento", "recorrente", "ajuda", "cancelar", "registrar"
   - Se mensagem contem 2+ palavras e inclui keyword de outro intent, retornar `shouldContinue: true, shouldCancel: true`

3. **Refatorar bloco `selection`** (linhas 175-214):
   - ANTES de checar numero, verificar `isSubjectChange` e escape
   - Se escape: retornar `cancelled: true`
   - Se mudanca de assunto: retornar `shouldContinue: true, shouldCancel: true`
   - Adicionar contador de tentativas: apos 2 falhas, cancelar automaticamente
   - Variar mensagem de erro em vez de repetir "Responde com o numero da opcao"

4. **Refatorar `fillPendingSlot`** (linhas 162-309):
   - Adicionar deteccao de mudanca de assunto ANTES de tentar extrair slot
   - Se mensagem parece ser nova intencao (ex: "orcamento"), retornar `shouldContinue: true`

### Arquivo 2: `supabase/functions/finax-worker/index.ts`

**Mudancas:**

1. **set_budget SEM amount** (linha 4378): Criar action com `pending_slot: "amount"` em vez de so enviar texto
   ```
   Antes:  sendMessage("Qual valor?") → return
   Depois: createAction("set_budget", ..., pending_slot: "amount") → sendMessage("Qual valor?") → return
   ```
   Isso garante que quando o usuario enviar "300", o contexto sabe que e para `set_budget`.

2. **Botoes de onboarding como texto:** Adicionar handler para "Vamos", "vamos", "bora" apos onboarding done:
   - Se onboarding.current_step === "done" E mensagem e tipo "vamos/bora/comecar"
   - Responder com o guia de uso (mesmo conteudo do botao onb_start)

3. **Handler de `onb_start` e `onb_plan`** nos callbacks de botao (bloco de BUTTON): adicionar tratamento para esses IDs, que hoje nao tem handler.

### Arquivo 3: `supabase/functions/finax-worker/utils/onboarding.ts`

**Mudancas:**

1. Apos onboarding `done`, marcar `current_step = "done"` para evitar re-entrada
2. Adicionar handler para texto "vamos" / "bora" como alternativa aos botoes

---

## Impacto nas Imagens

**Imagem 1 (Onboarding):** Usuario envia "Quero comecar meu trial" → onboarding inicia OK. Mas "Vamos" depois nao funciona → FIX: handler de texto pos-onboarding

**Imagem 2 ("Opa perdi contexto" + "Vamos" → help):** Apos timeout, usuario digita "Vamos" → AI nao entende → help menu. Depois "Gastei 10 com cafe" → funciona. ESSE FLUXO JA ESTA OK, so precisa que "Vamos" apos onboarding funcione.

**Imagem 3 ("Definir gasto mensal" → 300 → "Gasto ou Entrada?"):** FIX: set_budget cria action com pending_slot.

**Imagem 4 (Loop "Responde com numero da opcao"):** FIX: escape + mudanca de assunto + retry limit no context-handler.

---

## Secao Tecnica

| Arquivo | Mudanca |
|---------|---------|
| `fsm/context-handler.ts` | Ampliar escape, detectar mudanca assunto, retry limit, variar mensagens |
| `index.ts` | set_budget cria action, handler onb_start/onb_plan, handler texto "vamos" |
| `utils/onboarding.ts` | Handler texto "vamos"/"bora" como alternativa a botoes |

## Ordem de Execucao

1. context-handler.ts (corrige loop infinito - mais critico)
2. index.ts (set_budget + onboarding handlers)  
3. onboarding.ts (texto como alternativa a botoes)
4. Deploy + teste
