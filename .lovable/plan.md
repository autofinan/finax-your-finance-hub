

# Plano de Correcao - Bugs Restantes

## Status Atual (apos verificacao no codigo)

| Bug | Status Real | Explicacao |
|-----|------------|------------|
| #1 Limite insuficiente | JA CORRIGIDO | Handlers `limit_force_yes/other/cancel` existem nas linhas 3596-3627 |
| #2 Gasto duplicado | NAO CORRIGIDO | A funcao `registerExpense` USADA (shadowed, linha 1742 do index.ts) NAO tem deduplicacao. A versao em `intents/expense.ts` tem, mas NAO e chamada pelo fluxo principal |
| #7 Gastos rapidos | PARCIALMENTE | Existe `message-queue` e `multi_expense_queue` mas sem sistema de fila dedicado |
| #8 Orcamento undefined | NAO CORRIGIDO | Valores como `orcamento.limite` e `orcamento.gasto_atual` sao usados sem `?? 0` em varias mensagens |
| #9 Contexto/viagem | JA CORRIGIDO | `registerExpense` (linha 1863) ja chama `linkTransactionToContext` e mostra tag |
| #11 Imagem | NAO CORRIGIDO | `String.fromCharCode(...new Uint8Array(arrayBuffer))` causa stack overflow em imagens grandes |

## Bugs que Precisam de Correcao (3 restantes)

---

### BUG #2: Deduplicacao de gastos

**Problema:** A funcao `registerExpense` usada pelo sistema (inline no index.ts, linha 1742) nao verifica duplicatas. A versao em `intents/expense.ts` tem deduplicacao mas e "shadowed" (nunca chamada).

**Correcao:**
1. Adicionar verificacao de duplicata na `registerExpense` do index.ts (linha 1817, ANTES do insert):
   - Buscar transacoes dos ultimos 5 minutos com mesmo `valor + descricao normalizada + usuario`
   - Se encontrar, retornar mensagem pedindo confirmacao com botoes
2. Adicionar handlers `duplicate_confirm_yes` e `duplicate_confirm_no` na secao de botoes do index.ts

**Arquivos:** `index.ts` (linhas 1742-1830 + secao de handlers de botao)

---

### BUG #8: Valores "undefined" em mensagens de orcamento

**Problema:** Variaveis como `orcamento.limite`, `orcamento.gasto_atual` podem ser null/undefined, causando "R$ undefined" nas mensagens.

**Correcao:** Adicionar guards `?? 0` em TODOS os `.toFixed()` nas funcoes de orcamento:
- `checkBudgetAfterExpense` (linhas 486-510): `orcamento.limite`, `orcamento.gasto_atual`
- `setBudget` (linhas 454-465): `gastoAtual`, `limite` (estes ja parecem seguros, mas revisar)
- Tambem em `cancelarTransacao` (linha 2006): `tx.valor?.toFixed(2)` - ja usa optional chaining, OK
- `cancelRecurring` (linha 2099): `recorrente.valor_parcela?.toFixed(2)` - ja usa optional chaining, OK

**Arquivos:** `index.ts` (funcao checkBudgetAfterExpense, linhas 470-520)

---

### BUG #11: Imagem causa "Maximum call stack size exceeded"

**Problema:** Na linha 1675 do index.ts:
```text
const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
```
O spread operator `...` em arrays grandes (imagens de 1MB+) excede o limite de argumentos da stack do JavaScript.

**Correcao:** Substituir por conversao em chunks:
```text
const bytes = new Uint8Array(arrayBuffer);
let binary = '';
const chunkSize = 8192;
for (let i = 0; i < bytes.length; i += chunkSize) {
  const chunk = bytes.subarray(i, i + chunkSize);
  binary += String.fromCharCode(...chunk);
}
const base64 = btoa(binary);
```

**Arquivo:** `index.ts` (funcao `downloadWhatsAppMedia`, linha 1674-1675)

---

## Secao Tecnica

### Ordem de Implementacao

```text
1. BUG #11 - Imagem stack overflow (5 min) - Fix mais simples e isolado
2. BUG #8 - Undefined em orcamentos (10 min) - Guards rapidos
3. BUG #2 - Deduplicacao de gastos (30 min) - Mais complexo, precisa de handlers
```

### Detalhes do BUG #2

A deduplicacao sera adicionada na funcao `registerExpense` inline (linha 1742) porque essa e a versao REALMENTE usada pelo sistema (a de `intents/expense.ts` e shadowed).

Logica:
1. Antes do INSERT (linha 1817), buscar:
   ```text
   SELECT * FROM transacoes
   WHERE usuario_id = userId
     AND tipo = 'saida'
     AND valor = valor
     AND created_at > (now() - interval '5 minutes')
   ORDER BY created_at DESC LIMIT 1
   ```
2. Se encontrar, comparar descricao normalizada (lowercase, sem acentos, trim)
3. Se match, criar action `duplicate_confirm` e retornar mensagem com botoes
4. Handlers de botao:
   - `duplicate_confirm_yes`: Chamar registerExpense com flag `skip_duplicate: true` nos slots
   - `duplicate_confirm_no`: Fechar action e responder "Ok, nao vou registrar!"

### Deploy
Todas as mudancas sao no `index.ts` do finax-worker. Um unico deploy resolve tudo.

