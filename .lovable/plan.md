

# Plano: Corrigir 3 bugs encontrados nos testes do Sprint 3

## Resumo dos problemas

1. **"Cancelar café" mostra recorrentes em vez de transacoes pontuais** — O `cancel-routing.ts` busca recorrentes por nome ("café"), nao acha, e depois lista TODOS os recorrentes ativos como fallback, em vez de ir direto para transacoes
2. **Parcelamentos nao descontam mensalmente** — O CRON `processar-recorrentes` ja tem a logica correta, mas provavelmente nao esta sendo executado (precisa de agendamento via pg_cron ou invocacao externa). Isso nao e um bug de codigo, e de configuracao
3. **"Gastos" apos "Ajuda" retorna lista de gastos do mes** — O regex `\bgasto\b` nao captura "gastos" (plural). A IA classifica "gastos" como `query` em vez de `control`, e o interceptor de help no index.ts (L4038) tambem falha no match

---

## Correcao 1: Cancel routing — buscar transacoes por nome tambem

**Arquivo:** `supabase/functions/finax-worker/intents/cancel-routing.ts`

**Problema:** Linhas 52-73 — quando tem `searchTerm` (ex: "café"), busca recorrentes por nome. Se nao acha, faz `listActiveRecurrings()` que retorna TODOS os recorrentes. Deveria buscar transacoes por nome tambem.

**Mudanca:** Reescrever a logica para:
1. Buscar recorrentes por nome
2. Buscar transacoes por nome (novo)
3. Se achou algum dos dois, mostrar combinado
4. Se nao achou nada com o termo, ai sim mostrar mensagem "nao encontrei"
5. Remover o fallback `listActiveRecurrings()` quando tem searchTerm

**Tambem:** Adicionar funcao `findTransactionsByName` no `cancel-handler.ts` para buscar transacoes por descricao.

### cancel-handler.ts — adicionar funcao:
```typescript
export async function findTransactionsByName(userId: string, searchTerm: string): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, categoria, data, status")
    .eq("usuario_id", userId)
    .in("status", ["confirmada", "prevista"])
    .ilike("descricao", `%${searchTerm}%`)
    .order("created_at", { ascending: false })
    .limit(5);
  return data || [];
}
```

### cancel-routing.ts — reescrever L52-73:
```typescript
if (isRecurringCancel || searchTerm) {
  let recorrentes: any[] = [];
  let transacoes: any[] = [];

  if (searchTerm) {
    // Buscar em AMBOS: recorrentes E transações por nome
    recorrentes = await findRecurringByName(userId, searchTerm);
    transacoes = await findTransactionsByName(userId, searchTerm);
  }

  // Se não achou nada pelo nome, tentar listar recorrentes (só se foi pedido explícito)
  if (recorrentes.length === 0 && transacoes.length === 0 && isRecurringCancel) {
    recorrentes = await listActiveRecurrings(userId);
  }

  // Se ainda não achou nada
  if (recorrentes.length === 0 && transacoes.length === 0) {
    await sendMessage(phoneNumber, `Não encontrei "${searchTerm}" nos seus gastos ou recorrentes 🤔`, messageSource);
    return;
  }

  // Se só achou transações pontuais, mostrar essas
  if (recorrentes.length === 0 && transacoes.length > 0) {
    await _showTransactionCancelOptions(transacoes, userId, messageId, sendButtons, sendListMessage, phoneNumber, messageSource);
    return;
  }

  // Se achou recorrentes (com ou sem transações), priorizar recorrentes
  // ... resto da lógica de recorrentes (1 match → botões, múltiplos → lista)
```

Importar `findTransactionsByName` no cancel-routing.ts.

---

## Correcao 2: Help follow-up — regex nao captura plural

**Arquivos:** 
- `supabase/functions/finax-worker/index.ts` (L4038)
- `supabase/functions/finax-worker/intents/control.ts` (L134)

**Problema:** O regex `\b(gasto|registr|...)\b` nao captura "gastos" porque `\b` trata o "s" como continuacao da palavra.

**Mudanca:** Trocar `\bgasto\b` por `\bgastos?\b` em ambos os arquivos. Fazer o mesmo para outros termos que podem vir no plural:

```
// DE:
/\b(gasto|registr|anotar|lanc|compra|despesa)\b/i

// PARA:
/\b(gastos?|registr|anotar|lanc|compras?|despesas?)\b/i
```

Aplicar em:
- `index.ts` L4038
- `control.ts` L134

Tambem para cartoes:
```
// DE:
/\b(cartao|cartões|credito|limite)\b/i

// PARA:  
/\b(cartao|cartões|cartoes|credito|crédito|limite)\b/i
```

---

## Correcao 3: Parcelamentos — verificar CRON

**Arquivo:** `supabase/functions/processar-recorrentes/index.ts`

**Status:** O codigo ja tem a logica correta (L230-303 `processarParcelasFuturas`). O problema e que o CRON precisa estar agendado no Supabase (pg_cron ou webhook externo) para rodar diariamente.

**Acao:** Verificar no Supabase Dashboard se existe um CRON job apontando para esta funcao. Se nao existir, criar via SQL:
```sql
select cron.schedule(
  'processar-recorrentes-diario',
  '0 10 * * *',  -- 10:00 UTC = 07:00 Brasília
  $$select extensions.http((
    'POST',
    'https://<PROJECT_REF>.supabase.co/functions/v1/processar-recorrentes',
    ARRAY[extensions.http_header('Authorization', 'Bearer <SERVICE_ROLE_KEY>')],
    'application/json',
    '{}'
  )::extensions.http_request)$$
);
```

Isso nao e mudanca de codigo — e configuracao do banco. Vou verificar se ja existe.

---

## Testes apos as correcoes

| # | Teste | Resultado esperado |
|---|-------|--------------------|
| 1 | "cancelar café" | Lista transacoes com "café" na descricao, NAO recorrentes |
| 2 | "cancelar netflix" | Encontra Netflix nos recorrentes e pede confirmacao |
| 3 | "cancelar" (sem termo) | Lista transacoes recentes genericas |
| 4 | "ajuda" → "gastos" | Responde com tutorial de como registrar gastos |
| 5 | "ajuda" → "cartões" | Responde com tutorial de cartoes |
| 6 | "ajuda" → "metas" | Responde com tutorial de metas |
| 7 | "meus parcelamentos" | Lista parcelamentos (ja funciona) |

