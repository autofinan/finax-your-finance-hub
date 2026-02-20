
# Plano Completo: Sistema de Cartões, Faturas e Correções de Build

---

## Contexto: O que encontrei na varredura

### Dados reais do banco (estado atual)
- **nubank**: limite_total=6400, limite_disponivel=6210.10 → `calculado_usado=189.90`
  - Mas faturas em aberto somam R$ 420 (março R$140 + abril R$70 de parcela)
  - Parcelas futuras: R$ 210
  - **O limite_disponivel está ERRADO** — não reflete as faturas abertas
- **inter**: limite_total=300, limite_disponivel=259.50 → usado=40.50, mas parcelas futuras R$135
- **Sicredi**: limite_total=2100, limite_disponivel=2100 → faturas todas pagas, correto
- Transações do nubank: nenhuma tem `fatura_id` preenchido — **é por isso que "detalhar fatura" aparece vazio**

### Problemas de Build pendentes (2 erros)
1. `getMonthlySummary` duplicado: existe em `helpers.ts` (linha 156) E é redeclarado como alias na linha 86 do `index.ts` — conflito de nome
2. `markAsExecuted` chamado com 3 argumentos (linha 3318) mas a função aceita apenas 2

---

## PARTE 1 — Correções de Build (urgente, precisa de deploy)

### Fix 1A: Remover `getMonthlySummary` do import de `helpers.ts`
**Arquivo:** `supabase/functions/finax-worker/index.ts` linha 51
- Remover `getMonthlySummary` do import de `./utils/helpers.ts`
- O alias na linha 86 (`const getMonthlySummary = getMonthlySummaryInline`) já cobre todos os usos

### Fix 1B: Corrigir chamada `markAsExecuted` com 3 args
**Arquivo:** `supabase/functions/finax-worker/index.ts` linha 3318
- `await markAsExecuted(decision.decisionId, result.success, result.contextId)`
- Verificar assinatura real da função e ajustar para 2 argumentos ou adicionar o terceiro parâmetro

---

## PARTE 2 — Problema Raiz: `fatura_id` nunca é preenchido nas transações

### Diagnóstico
As transações do nubank no banco **não têm `fatura_id`** preenchido:
```
chinelo → fatura_id: null
passagem de onibus → fatura_id: null
açaí → fatura_id: null
```
Isso significa que a query do `FaturaDetailModal` por `fatura_id` retorna vazio. A query por `cartao_id + date range` deveria funcionar, mas o modal ainda mostra vazio.

### Causa do "Detalhar Fatura vazio"
O `FaturaDetailModal` usa dois critérios para buscar transações:
1. Por `fatura_id` → retorna vazio (porque as transações não têm fatura_id)
2. Por `cartao_id + date range` (ciclo de fechamento) → deveria funcionar, mas o botão "Detalhar fatura" no Cartões.tsx só abre se `faturaAberta` existir (linha 119: `if (!fatura) return`)

**Problema adicional**: A função `openFaturaDetail` em `Cartoes.tsx` (linha 117-132) usa `faturasEmAberto` da view `vw_faturas_em_aberto`. Se a view retorna fatura mas sem transações linkadas, o modal abre mas mostra vazio.

### Fix necessário no `FaturaDetailModal`
Melhorar a estratégia de busca para usar apenas `cartao_id + date range` quando `fatura_id` não retornar resultados.

---

## PARTE 3 — Limite Disponível: Cálculo Incorreto

### Como está hoje (errado)
O `limite_disponivel` é decrementado quando um gasto é registrado via WhatsApp (na função de registro de expense). Mas:
- Quando o usuário **paga a fatura**, o limite volta (função `pagarFatura` já faz isso)
- Quando o usuário **aumenta o limite** pelo frontend, `updateCartao` agora recalcula `limite_disponivel` (fix anterior aplicado)

### Problema real encontrado
`calculado_usado = limite_total - limite_disponivel = 189.90`
Mas as faturas abertas somam R$ 420. Isso significa que o `limite_disponivel` foi decrementado incorretamente em algum momento.

### Fix: Sincronizar `limite_disponivel` com base nas faturas abertas
**Arquivo novo:** `src/components/cartoes/useLimiteSync.ts`
- Criar hook que calcula o `limite_disponivel` real = `limite_total - soma(faturas abertas não pagas + parcelas futuras)`
- Exibir no card o valor calculado localmente (sem precisar atualizar o banco a cada consulta)

**Regra de negócio correta:**
```
limite_disponivel_real = limite_total - (soma das faturas abertas - valor_pago)
```

---

## PARTE 4 — Cartões.tsx: Mostrar Recorrentes e Detalhamento Correto

### 4A: Buscar recorrentes vinculados ao cartão
Os recorrentes no banco **não têm `cartao_id`** (o campo não existe na tabela `gastos_recorrentes`). Portanto, não é possível vincular diretamente pelo banco. A solução é mostrar os recorrentes globais em uma seção separada no card, sem vincular por cartão.

**Novo campo necessário na tabela:** `gastos_recorrentes.cartao_id` (migration)

Enquanto isso, na interface mostrar os recorrentes ativos como "possíveis compromissos mensais" na seção do cartão.

### 4B: Separação visual de "Em Uso"
Dentro de cada card de cartão, mostrar:
- Pontuais: gastos da fatura atual
- Parcelas: valor das parcelas ativas neste cartão
- Total usado: soma dos dois

### 4C: Botão "Detalhar" sempre visível
Atualmente o botão "Detalhar fatura" só aparece se `faturaAberta` existe. Mudar para: sempre mostrar botão se houver fatura (aberta OU histórica). Se não houver nenhuma fatura, mostrar "Nenhuma fatura ainda".

---

## PARTE 5 — Ciclo Correto de Faturas: Uma por Mês por Cartão

### Problema detectado
Faturas do nubank:
- mes=3, ano=2026 → R$140 (aberta)
- mes=4, ano=2026 → R$70 (aberta) — **parcela futura sendo colocada no mês seguinte automaticamente**

O sistema já cria faturas para meses futuros quando registra parcelas. Isso está correto pelo design (parcela da cadeira 2/2 vai para abril). Mas a interface exibe a fatura de abril como "em aberto" quando deveria ser "futura".

### Fix: Status de faturas futuras
**Arquivo:** `supabase/functions/finax-worker/intents/expense.ts` ou onde as parcelas são criadas
Ao criar fatura para mês futuro: `status = 'futura'` em vez de `'aberta'`
- `aberta` = ciclo atual
- `futura` = meses que ainda não chegaram

**No frontend** (`useFaturas.ts`):
- `faturasEmAberto`: filtrar apenas status `aberta` (não `futura`)
- Historico: mostrar todas incluindo `futura` com badge visual diferente

---

## PARTE 6 — WhatsApp: Fluxo de Consultas de Faturas e Contas

### 6A: Faturas em aberto via WhatsApp
Já existe `getInvoiceDetail` em `query.ts` (linha 342+). O problema é que busca por `fatura_id` nas transações, mas as transações não têm `fatura_id` preenchido.

**Fix em `query.ts`:** Na função `getInvoiceDetail`, adicionar fallback: se não encontrar transações por `fatura_id`, buscar por `cartao_id + mes_referencia`.

### 6B: "Quais contas pendentes esse mês" via WhatsApp
Já existe handler em `query.ts`. Verificar se está mapeado corretamente no classifier.

### 6C: Duplicata falsa (print enviado)
O usuário pediu "Me mande o relatório semanal" após registrar um gasto — o sistema interpretou como nova tentativa de registrar "chinelo 49.90" e disparou alerta de duplicata.

**Causa:** A detecção de duplicata está comparando com transações dentro de 5 minutos, e o sistema classificou o pedido de relatório como gasto. O fix correto é no `ai-classifier.ts`: garantir que "me mande o relatório" seja sempre classificado como `weekly_report`, nunca como `expense`.

---

## PARTE 7 — Arquivos a Criar/Modificar

### Arquivos Frontend (sem risco de quebrar o backend)
| Arquivo | Ação | O que muda |
|---|---|---|
| `src/pages/Cartoes.tsx` | Modificar | Buscar recorrentes, mostrar breakdown pontuais/parcelas, sempre exibir botão detalhar |
| `src/pages/Faturas.tsx` | Modificar | Filtrar faturas futuras do "Em Aberto", badge visual para futura |
| `src/hooks/useFaturas.ts` | Modificar | Separar faturasEmAberto (status=aberta) de faturasFuturas (status=futura) |
| `src/components/cartoes/FaturaDetailModal.tsx` | Modificar | Melhorar fallback de busca sem fatura_id |

### Arquivos Backend Edge Function (requer deploy)
| Arquivo | Ação | O que muda |
|---|---|---|
| `supabase/functions/finax-worker/index.ts` | Modificar | Fix 2 erros de build + fix duplicata falsa de relatório |
| `supabase/functions/finax-worker/intents/query.ts` | Modificar | Fix fallback de busca de transações por cartao_id quando fatura_id está vazio |
| `supabase/functions/finax-worker/decision/ai-classifier.ts` | Modificar | Garantir que "relatório semanal" nunca seja expense |

### Migration de banco (requer execução manual)
| Tabela | Ação | SQL |
|---|---|---|
| `gastos_recorrentes` | Adicionar coluna | `ALTER TABLE gastos_recorrentes ADD COLUMN cartao_id uuid REFERENCES cartoes_credito(id)` |
| `faturas_cartao` | Adicionar constraint | UPDATE faturas_cartao SET status='futura' WHERE (ano > EXTRACT(YEAR FROM NOW())) OR (ano = EXTRACT(YEAR FROM NOW()) AND mes > EXTRACT(MONTH FROM NOW())) |

---

## Sequência de Execução

1. **Fix build errors** → deploy imediato (sem isso o worker não funciona)
2. **Frontend: useFaturas + Faturas.tsx** → separar futura de aberta
3. **Frontend: Cartoes.tsx** → mostrar recorrentes + breakdown
4. **Frontend: FaturaDetailModal** → fix busca por cartao_id+date range
5. **Migration** → adicionar cartao_id em gastos_recorrentes + corrigir status futuras
6. **Backend: query.ts** → fallback de busca por cartao_id
7. **Backend: ai-classifier** → fix duplicata falsa de relatório

---

## Secao Tecnica: Fix dos 2 Erros de Build

**Erro 1** — `getMonthlySummary` duplicado:
```typescript
// index.ts linha 51 — REMOVER getMonthlySummary do import:
import { normalizeText, detectQueryScope, detectTimeRange, 
  isNumericOnly, parseNumericValue, logDecision, extractSlotValue
} from "./utils/helpers.ts";
// A linha 86 já tem: const getMonthlySummary = getMonthlySummaryInline;
```

**Erro 2** — `markAsExecuted` com 3 args:
```typescript
// index.ts linha 3318 — CORRIGIR:
// De: await markAsExecuted(decision.decisionId, result.success, result.contextId);
// Para: await markAsExecuted(decision.decisionId, result.success);
```
