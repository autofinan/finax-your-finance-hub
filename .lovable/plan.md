

# Correcao Definitiva do Horario + Melhorias Estruturais

## 1. Bug do Horario: Causa Raiz DEFINITIVA

O problema esta 100% claro agora. Existe um "double-shift" de -3h causado por uma cadeia de funcoes:

```text
parseRelativeDate("ontem")
  └─ usa getBrasiliaDate() como base
     └─ pega UTC real (ex: 19:46Z)
     └─ converte para Brasilia (16:46)
     └─ cria Date com 16:46 como se fosse UTC
  └─ retorna Date com getHours()=16 mas .toISOString()="16:46Z"

getBrasiliaISO(aquele Date)
  └─ chama getBrasiliaDateParts()
     └─ usa Intl.DateTimeFormat com timeZone:'America/Sao_Paulo'
     └─ Intl ve 16:46 UTC → converte para 13:46 Brasilia  ← DOUBLE SHIFT
  └─ retorna "T13:46:18-03:00"

Resultado: mostra 13:46 em vez de 16:46
```

A hora real de Brasilia era 16:46. Mas o sistema mostra 13:46 porque aplica -3h DUAS VEZES.

### Correcao (3 pontos)

**A) `getBrasiliaISO()` — Remover `getBrasiliaDate()` como default**

Linha 172 de `date-helpers.ts`:

```text
// ANTES:
const d = date ? (...) : getBrasiliaDate();  // Fake-UTC!

// DEPOIS:
const d = date ? (...) : new Date();  // UTC real → Intl converte UMA vez
```

Isso resolve o caso "hora atual" (sem data relativa).

**B) `index.ts` linha 3771 — NAO passar Date de `parseRelativeDate` para `getBrasiliaISO`**

`parseRelativeDate` retorna um Date com valores de Brasilia como se fossem UTC. Se passarmos para `getBrasiliaISO`, o Intl aplica -3h de novo.

```text
// ANTES:
if (transactionDate) {
  const { dateISO } = getBrasiliaISO(transactionDate);
  slots.transaction_date = dateISO;
}

// DEPOIS:
if (transactionDate) {
  // transactionDate ja tem valores de Brasilia como componentes locais
  const y = transactionDate.getFullYear();
  const m = String(transactionDate.getMonth() + 1).padStart(2, '0');
  const d = String(transactionDate.getDate()).padStart(2, '0');
  const h = String(transactionDate.getHours()).padStart(2, '0');
  const min = String(transactionDate.getMinutes()).padStart(2, '0');
  const sec = String(transactionDate.getSeconds()).padStart(2, '0');
  slots.transaction_date = `${y}-${m}-${d}T${h}:${min}:${sec}-03:00`;
}
```

Isso constroi o ISO string direto dos componentes, sem passar pelo Intl.

**C) Mesma correcao em `intents/expense.ts` (linha 114-118) e `intents/installment.ts` (linha 151-153)**

Onde houver `getBrasiliaISO(getBrasiliaDate())`, substituir por `getBrasiliaISO()` (sem argumento, agora usa `new Date()` direto).

**D) `registerIncome` (index.ts linha 1796-1828) — Mesmo bug do registerExpense**

Usa `new Date()` e `toLocaleDateString` sem timezone. Aplicar a mesma logica: usar `getBrasiliaISO()` e parsear a string ISO direto.

---

## 2. Tabelas/Estruturas Subutilizadas no Banco

O banco tem 60+ tabelas. Varias estao dormentes ou subutilizadas:

| Tabela | Status | Potencial |
|---|---|---|
| `savings_goals` | Dormante | Metas de economia via WhatsApp |
| `spending_alerts` | Parcial | Alertas proativos ja existem mas sao pouco usados |
| `bank_connections` | Dormante | Open Banking futuro |
| `employees` | Dormante | Multi-usuario/empresa |
| `perfil_cliente` | Possivel redundancia | Verificar se duplica `usuarios` |
| `shared_reports` | Dormante | Compartilhar relatorios |
| `chart_cache` | Verificar | Cache de graficos |
| `erros_interpretacao` | Verificar | Log de erros de NLU |
| `hipoteses_registro` | Verificar | Hipoteses de registro |

Estas estruturas podem ser ativadas incrementalmente sem mudar a arquitetura.

---

## 3. index.ts com 5358 linhas — Precisa de Refatoracao

O `index.ts` concentra logica demais. Funcoes que deveriam estar em modulos separados:

| Funcao/Bloco | Linhas aprox. | Destino sugerido |
|---|---|---|
| `registerExpense` (inline) | 1623-1794 | `intents/expense.ts` (unificar com a existente) |
| `registerIncome` (inline) | 1796-1828 | `intents/income.ts` (unificar) |
| `getMonthlySummary` | 1830-1870 | `intents/query.ts` |
| Handlers de botao (pay_*, multi_*) | 2760-2950 | `fsm/button-handlers.ts` |
| Decision Engine + roteamento | 3560-3900 | `decision/router.ts` |
| Slot prompts / SLOT_PROMPTS | ~200 linhas | `ui/slot-prompts.ts` |

Isso eliminaria o problema de **shadowing** (duas `registerExpense`) de uma vez.

---

## Arquivos a Modificar

```text
1. supabase/functions/finax-worker/utils/date-helpers.ts
   - Linha 172: getBrasiliaISO default = new Date() em vez de getBrasiliaDate()

2. supabase/functions/finax-worker/index.ts
   - Linha 3770-3773: Construir ISO string direto dos componentes de parseRelativeDate
   - Linha 1796-1828: registerIncome — usar getBrasiliaISO() + parsear string ISO

3. supabase/functions/finax-worker/intents/expense.ts
   - Linhas 114-118: getBrasiliaISO() sem argumento (usar new Date() internamente)

4. supabase/functions/finax-worker/intents/installment.ts
   - Linhas 151-153: getBrasiliaISO() sem argumento
```

## Ordem de Implementacao

```text
1. Corrigir getBrasiliaISO() default → new Date()
2. Corrigir index.ts linha 3771 → construir ISO direto
3. Corrigir registerIncome (mesmo padrao)
4. Corrigir intents/expense.ts e installment.ts
5. Deploy finax-worker
6. Testar "ontem comprei cafe de 1,50 pix" → hora deve ser correta
```

## Testes Esperados

```text
Teste 1: "cafe 5 pix" → hora atual de Brasilia (ex: 17:30, nao 14:30)
Teste 2: "ontem comprei agua de 3" → data de ontem, hora ~atual
Teste 3: "dia 05/02 gastei 10 debito" → 05/02/2026, hora ~atual
```

## Proximos Passos (apos esta correcao)

1. Refatorar index.ts — extrair funcoes para modulos (elimina shadowing permanentemente)
2. Ativar `savings_goals` — metas de economia via WhatsApp
3. Ativar `spending_alerts` — alertas proativos personalizados
4. Revisar tabelas dormentes e limpar as que nao serao usadas
