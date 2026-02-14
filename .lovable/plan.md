
# Plano: Notificacoes Automaticas, Recorrentes e Melhorias de Fila

## Diagnostico do Estado Atual

### O que JA EXISTE e funciona:
- `lembrar-contas/index.ts` - Edge function pronta para lembrar contas a pagar (usa `fn_contas_para_lembrar` RPC)
- `ciclo-fatura/index.ts` - Edge function pronta para fechar faturas e alertar vencimentos (7, 3, 1 dias)
- `fn_process_recorrentes` - RPC no banco que registra transacoes de gastos recorrentes automaticamente
- Sistema de fila (`message-queue.ts`) com enfileiramento e deteccao de slot response
- Handlers `limit_force_yes`, `limit_other_card`, `limit_cancel` para limite insuficiente
- `linkTransactionToContext` e `context_id` no `registerExpense` para vincular gastos a viagens

### O que NAO funciona / FALTA:
1. **NENHUM cron job** para `lembrar-contas` e `ciclo-fatura` (so existem crons para relatorios semanal/mensal, finax-worker fallback, e finax-insights)
2. **NENHUM cron job** para `fn_process_recorrentes` - recorrentes nunca sao processadas automaticamente
3. **Nenhuma edge function** para notificar usuario sobre recorrentes processadas via WhatsApp
4. **Fila de gastos rapidos**: Apos registrar um gasto, o sistema so INFORMA "voce tem N pendentes" mas NAO processa automaticamente o proximo
5. **Viagem**: `registerExpense` (modular) ja vincula `context_id`, mas o index.ts nao informa ao usuario que o gasto foi vinculado ao evento

---

## Solucao por Item

### 1. Notificacoes automaticas (Contas + Faturas) - CRON JOBS

**Problema:** As edge functions `lembrar-contas` e `ciclo-fatura` existem e funcionam, mas nao tem cron jobs agendados.

**Solucao:** Criar 2 cron jobs via SQL:
- `lembrar-contas`: Executar diariamente as 9h (horario de Brasilia = 12h UTC)
- `ciclo-fatura`: Executar diariamente as 8h (horario de Brasilia = 11h UTC)

**Importante sobre 24h window:** Ambas as functions ja usam a API do WhatsApp para enviar mensagens. Dentro da janela de 24h (usuario ja mandou mensagem), a mensagem sera entregue gratuitamente. Fora da janela, a Meta rejeita a mensagem. O `lembrar-contas` ja trata isso (retorna `response.ok`). O `ciclo-fatura` usa Vonage sandbox que tambem respeita a janela.

**Melhoria:** Adicionar fallback no `ciclo-fatura` para tentar enviar via Meta API primeiro (mesmo canal que o usuario usa), e so usar Vonage como backup. Isso maximiza entrega dentro da janela de 24h.

### 2. Fechamento automatico de fatura - JA IMPLEMENTADO

O `ciclo-fatura/index.ts` ja:
- Fecha faturas no dia de fechamento
- Alerta em 7, 3 e 1 dias antes do vencimento
- Marca como atrasada se passou do vencimento
- Envia mensagem formatada com valor

**Melhoria:** Adicionar botoes interativos na mensagem de vencimento (via Meta API, nao Vonage sandbox que nao suporta botoes). Botoes: "Pagar agora" / "Lembrar amanha".

### 3. Recorrentes processam automaticamente - CRON + NOTIFICACAO

**Problema:** `fn_process_recorrentes` existe no banco mas nao tem cron job. E nao notifica o usuario.

**Solucao:**
1. Criar edge function `processar-recorrentes/index.ts` que:
   - Chama `supabase.rpc("fn_process_recorrentes")`
   - Busca recorrentes processadas (onde `proxima_execucao` foi atualizada hoje)
   - Envia notificacao WhatsApp para cada usuario: "Registrei Netflix R$ 55.00"
2. Criar cron job diario as 7h (10h UTC) para essa edge function

### 4. Gastos rapidos em sequencia (fila funcional)

**Problema:** Apos registrar um gasto, o sistema so diz "voce tem N pendentes" mas nao processa o proximo automaticamente.

**Solucao:** No `index.ts`, apos cada `registerExpense` bem-sucedido (linhas 4600-4640):
1. Em vez de apenas informar o count, chamar `processNextInQueue(userId)` do `message-queue.ts`
2. Se retornar uma mensagem, reprocessa-la como se fosse uma nova mensagem (re-invoke o pipeline)
3. Adicionar loop com limite de 5 mensagens para evitar recursao infinita
4. Manter a mensagem informativa mas processar em sequencia

### 5. Viagem vincula gastos - PARCIALMENTE FUNCIONAL

**Problema:** O `registerExpense` ja salva `context_id`, mas o usuario nao recebe feedback visual.

**Solucao:** No `index.ts`, apos `registerExpense` retornar sucesso:
1. Verificar se ha `activeContext` para o usuario
2. Se sim, adicionar tag na mensagem de confirmacao: "📍 Viagem SP"

### 6. Limite insuficiente - JA FUNCIONA

Os handlers `limit_force_yes`, `limit_other_card`, `limit_cancel` ja existem nas linhas 3734-3762 do index.ts. O `credit-flow.ts` ja retorna botoes com essas opcoes quando o limite e insuficiente.

**Verificacao:** Este item JA ESTA IMPLEMENTADO e funcional.

---

## Secao Tecnica

### Novos Cron Jobs (SQL - NAO usar migracao, contem dados sensíveis)

Executar via "Run SQL" no Supabase:

```text
-- CRON 1: Lembrar contas a pagar (diario 9h Brasilia = 12h UTC)
SELECT cron.schedule(
  'lembrar-contas-diario',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url:='https://[PROJECT_REF].supabase.co/functions/v1/lembrar-contas',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer [ANON_KEY]"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

-- CRON 2: Ciclo de fatura (diario 8h Brasilia = 11h UTC)
SELECT cron.schedule(
  'ciclo-fatura-diario',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url:='https://[PROJECT_REF].supabase.co/functions/v1/ciclo-fatura',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer [ANON_KEY]"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

-- CRON 3: Processar recorrentes (diario 7h Brasilia = 10h UTC)
SELECT cron.schedule(
  'processar-recorrentes-diario',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url:='https://[PROJECT_REF].supabase.co/functions/v1/processar-recorrentes',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer [ANON_KEY]"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);
```

### Nova Edge Function: `processar-recorrentes/index.ts`

Responsabilidades:
1. Chamar `fn_process_recorrentes` para registrar transacoes no banco
2. Buscar recorrentes que foram processadas hoje (ultima_execucao = today)
3. Para cada uma, buscar telefone do usuario via join com `usuarios`
4. Enviar WhatsApp: "Registrei [descricao] R$ [valor]"
5. Usar Meta API (mesmo canal do finax-worker) para maximizar entrega dentro da janela 24h

### Modificacao: `ciclo-fatura/index.ts`

1. Adicionar fallback Meta API (alem do Vonage) usando `WHATSAPP_ACCESS_TOKEN`
2. Adicionar botoes interativos nas mensagens de vencimento (via Meta API)
3. Adicionar handler no `index.ts` para botoes `fatura_pagar_[id]` e `fatura_lembrar_[id]`

### Modificacao: `finax-worker/index.ts`

**Fila de gastos (linhas 4631-4639):**
Substituir notificacao passiva por processamento ativo:
```text
// ANTES: So informa
await sendMessage(..., "Voce tem N pendentes");

// DEPOIS: Processa automaticamente
const nextMsg = await processNextInQueue(userId);
if (nextMsg) {
  // Re-processar como nova mensagem
  const newPayload = { ...payload, messageText: nextMsg.message_text, messageId: nextMsg.message_id };
  // Processar inline (sem recursao - max 5)
  await markMessageProcessed(nextMsg.id);
  // ... re-invoke pipeline
}
```

**Contexto de viagem (apos registerExpense):**
```text
if (result.success && result.transactionId) {
  const ctx = await getActiveContext(userId);
  if (ctx) {
    result.message += "\n📍 " + ctx.label;
  }
}
```

---

## Arquivos Afetados

```text
CRIAR:
  supabase/functions/processar-recorrentes/index.ts (nova edge function)

EDITAR:
  supabase/functions/ciclo-fatura/index.ts
    - Adicionar Meta API como canal primario
    - Adicionar botoes interativos nas mensagens

  supabase/functions/finax-worker/index.ts
    - Fila: substituir notificacao por processamento ativo (linhas 4631-4639)
    - Viagem: adicionar tag de contexto na mensagem de confirmacao
    - Handlers: adicionar fatura_pagar_* e fatura_lembrar_*

SQL (Run SQL, nao migracao):
    - 3 cron jobs (lembrar-contas, ciclo-fatura, processar-recorrentes)
```

## Resumo de Status

| Item | Status Atual | Acao |
|------|-------------|------|
| 1. Notificacoes contas/faturas | Edge functions prontas, SEM cron | Criar 2 cron jobs + melhorar canal |
| 2. Fechamento de fatura | Funciona, sem botoes | Adicionar botoes interativos |
| 3. Recorrentes automaticas | RPC pronta, SEM cron, SEM notificacao | Nova edge function + cron |
| 4. Fila de gastos rapidos | Enfileira mas nao processa | Processar automaticamente |
| 5. Viagem vincula gastos | context_id salvo, sem feedback | Adicionar tag visual |
| 6. Limite insuficiente | JA FUNCIONA | Nenhuma acao necessaria |
