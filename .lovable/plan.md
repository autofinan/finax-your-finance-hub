
# Plano Completo de Correção do Finax - Análise Profunda

## Diagnóstico Baseado em Logs, Banco de Dados e Código

### Evidências Encontradas no Banco de Dados

**1. Transações sem `cartao_id` mesmo sendo crédito:**
```
Todas as 10 transações de crédito têm cartao_id = NULL
- açaí: R$ 13 (credito) → cartao_id: NULL
- Jantar: R$ 150 (credito) → cartao_id: NULL  
- Gasolina: R$ 50 (credito) → cartao_id: NULL
```

**2. Limites de cartão não são descontados:**
```
Cartão Nubank: limite_total = 6400, limite_disponivel = 6400
(Mesmo com gastos registrados no crédito, limite permanece intacto)
```

**3. Actions de seleção numérica ficam canceladas:**
```
action_type: "cancel_recurring"
pending_slot: "selection"
slots: {options: [array de IDs]}
status: "cancelled"
→ Quando usuário respondeu "4", foi interpretado como R$ 4.00
```

**4. Mensagens pendentes nunca processadas:**
```
4 mensagens em pending_messages com processed = false
- "Refri 10" (22/01 e 23/01)
- "Compra 77" (22/01 e 23/01)
```

**5. Tabelas completamente vazias (não utilizadas):**
```
- savings_goals: 0 registros (meta de poupança não salva)
- spending_alerts: 0 registros (alertas não são gerados)
- user_patterns: 0 registros (padrões não são aprendidos)
```

---

## PROBLEMA RAIZ #1: Seleção Numérica Quebrada (CRÍTICO)

**Localização:** `index.ts` linhas 828-866

**Fluxo Atual (QUEBRADO):**
```
Usuário: "4" (para cancelar Spotify)
     ↓
isNumericOnly("4") = true
     ↓
Não verifica se há activeAction com pending_slot = "selection"
     ↓
Cria action "numero_isolado" com amount: 4
     ↓
Pergunta: "R$ 4.00 - gasto ou entrada?"
```

**Correção Necessária:**
Adicionar verificação de seleção ANTES do tratamento de número isolado:

```typescript
// NOVO BLOCO (linha ~828, ANTES do isNumericOnly)
if (activeAction?.pending_slot === "selection" && isNumericOnly(message)) {
  const index = parseInt(message.trim()) - 1;
  const options = activeAction.slots.options as string[];
  
  if (options && index >= 0 && index < options.length) {
    const selectedId = options[index];
    
    // Roteamento por tipo de action
    switch (activeAction.intent) {
      case "cancel_recurring":
        const result = await cancelRecurringById(userId, selectedId);
        await closeAction(activeAction.id);
        return { result, shouldBlockLegacyFlow: true };
        
      case "cancel":
        const txResult = await cancelTransactionById(userId, selectedId);
        await closeAction(activeAction.id);
        return { result: txResult, shouldBlockLegacyFlow: true };
        
      case "edit":
        // Preencher transaction_id e continuar edição
        break;
    }
  }
}
```

TBM PRECISAMOS ENTENDER QUE ESSE NUMERO ISOLADO VAI DEPENDER DO CONTEXTO. SE ENVIAMOS ALGO PARA ELE SELECIONAR COM BASE EM NUMERO, E A RESPOSTA FOR EM NUMERO, SABEMOS QUE É SOBRE O QUE PEDIMOS. AGORA SE FOR DO NADA, APENAS NUMERO, PODE SER GASTO OU ENTRADA, TUDO VAI DEPENDER DO CONTEXTO, POR ISSO QUE NAO PODEMOS PERDER CONTEXTO ASSIM, TEMOS QUE SABER O QUE ESTAMOS FAZENDO EM CADA MOMENTO. 
---

## PROBLEMA RAIZ #2: Gastos no Crédito Não Vinculam ao Cartão

**Localização:** `intents/expense.ts` linha 133

**Código Atual:**
```typescript
id_cartao: slots.card || null,  // slots.card contém NOME, não ID!
```

**Problema:**
- Quando usuário diz "credito nubank", o slot `card` recebe "nubank" (texto)
- A inserção tenta salvar "nubank" no campo `id_cartao` que espera UUID
- Resultado: cartao_id fica NULL, limite não é descontado

**Correção Necessária:**
```typescript
// 1. Buscar ID do cartão pelo nome antes de inserir
let cardId = null;
if (slots.payment_method === "credito" && slots.card) {
  const { data: cartao } = await supabase
    .from("cartoes_credito")
    .select("id")
    .eq("usuario_id", userId)
    .ilike("nome", `%${slots.card}%`)
    .eq("ativo", true)
    .limit(1)
    .single();
  
  cardId = cartao?.id || null;
}

// 2. Na inserção:
cartao_id: cardId,

// 3. Atualizar limite após inserção:
if (cardId && slots.payment_method === "credito") {
  await supabase.rpc("atualizar_limite_cartao", {
    p_cartao_id: cardId,
    p_valor: slots.amount,
    p_operacao: "deduzir"
  });
}
```

**Também precisa criar trigger/RPC:**
```sql
CREATE OR REPLACE FUNCTION atualizar_limite_cartao(
  p_cartao_id UUID,
  p_valor NUMERIC,
  p_operacao TEXT -- 'deduzir' ou 'restaurar'
) RETURNS VOID AS $$
BEGIN
  IF p_operacao = 'deduzir' THEN
    UPDATE cartoes_credito 
    SET limite_disponivel = limite_disponivel - p_valor
    WHERE id = p_cartao_id;
  ELSE
    UPDATE cartoes_credito 
    SET limite_disponivel = limite_disponivel + p_valor
    WHERE id = p_cartao_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## PROBLEMA RAIZ #3: Cancelamento por Nome Não Funciona

**Localização:** `index.ts` linhas 3156-3270

**Código Atual:**
Quando usuário diz "cancela spotify", o sistema:
1. Busca recorrentes por nome
2. Se encontra, mostra lista com números
3. Espera resposta numérica
4. **MAS:** resposta numérica é interceptada pelo handler de número isolado

**Correção Completa:**

```typescript
// 1. Adicionar busca fuzzy por nome no handler cancel_recurring
if (normalized.includes("spotify") || normalized.includes("netflix") || ...) {
  const searchTerm = extractSearchTerm(normalized);
  
  const { data: recorrentes } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .ilike("descricao", `%${searchTerm}%`);
  
  if (recorrentes?.length === 1) {
    // Apenas 1 resultado → cancelar direto
    await cancelRecurringById(userId, recorrentes[0].id);
    return successMessage;
  }
  
  if (recorrentes?.length > 1) {
    // Múltiplos → criar seleção
    // ... código existente, MAS com pending_slot: "selection"
  }
}

// 2. Criar função cancelRecurringById
async function cancelRecurringById(userId: string, id: string): Promise<string> {
  const { data: recorrente } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("id", id)
    .eq("usuario_id", userId)
    .single();
  
  if (!recorrente) return "Não encontrei esse recorrente 🤔";
  
  await supabase
    .from("gastos_recorrentes")
    .update({ ativo: false })
    .eq("id", id);
  
  return `✅ *${recorrente.descricao}* cancelado!\n\nR$ ${recorrente.valor_parcela}/mês não será mais cobrado.`;
}
```

---

## PROBLEMA RAIZ #4: Query "Quanto recebi" Retorna Gastos

**Localização:** `index.ts` handler de query (linha ~3243)

**Código Atual:**
O handler de query não diferencia entre "recebi" (entradas) e "gastei" (saídas)

**Correção:**
```typescript
// Dentro do handler de query, ANTES de getExpensesByCategory

if (decision.actionType === "query") {
  const normalized = normalizeText(conteudoProcessado);
  
  // 1. QUERY DE ENTRADAS (recebi, entrada, renda)
  if (normalized.includes("recebi") || normalized.includes("entrada") || 
      normalized.includes("entrou") || normalized.includes("renda") ||
      normalized.includes("quanto ganhei")) {
    const result = await getIncomeDetails(userId);
    await sendMessage(payload.phoneNumber, result, payload.messageSource);
    return;
  }
  
  // 2. QUERY POR CARTÃO ESPECÍFICO
  const cardMatch = normalized.match(/(?:gastei|quanto)\s+(?:no|na|do|da)\s+(\w+)/);
  if (cardMatch) {
    const cardName = cardMatch[1];
    const result = await getExpensesByCard(userId, cardName);
    await sendMessage(payload.phoneNumber, result, payload.messageSource);
    return;
  }
  
  // ... resto do handler
}

// Nova função getIncomeDetails
async function getIncomeDetails(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: entradas } = await supabase
    .from("transacoes")
    .select("valor, descricao, data, forma_pagamento")
    .eq("usuario_id", userId)
    .eq("tipo", "entrada")
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada")
    .order("data", { ascending: false });
  
  if (!entradas?.length) {
    return "Nenhuma entrada registrada este mês 💰";
  }
  
  const total = entradas.reduce((sum, e) => sum + Number(e.valor), 0);
  const lista = entradas.slice(0, 10).map(e => 
    `💰 R$ ${Number(e.valor).toFixed(2)} - ${e.descricao || "Entrada"}`
  ).join("\n");
  
  return `💰 *Entradas do Mês*\n\n${lista}\n\n✅ *Total: R$ ${total.toFixed(2)}*`;
}
```

---

## PROBLEMA RAIZ #5: Metas de Poupança Não Salvam

**Evidência:** Tabela `savings_goals` tem 0 registros

**Problema:** Quando usuário diz "criar meta de 15000 para viagem":
- IA classifica como `set_context` (viagem)
- Cria um contexto temporário em vez de meta de poupança

**Correção:**

```typescript
// 1. Adicionar novo ActionType
type ActionType = "expense" | "income" | "goal" | ... // adicionar "goal"

// 2. Atualizar PROMPT_FINAX_UNIVERSAL
### goal - Criar meta de poupança/guardar dinheiro
Exemplos: "Criar meta de 3000 para viagem", "Quero juntar 5000", "Guardar para emergência"
- Palavras-chave: meta, juntar, guardar, economizar, poupar + valor

// 3. Criar handler de goal
if (decision.actionType === "goal") {
  const slots = decision.slots;
  
  const result = await createSavingsGoal(userId, {
    name: slots.description || "Meta",
    target_amount: slots.amount || 0,
    deadline: slots.deadline || null
  });
  
  await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
  return;
}

// 4. Função createSavingsGoal
async function createSavingsGoal(userId: string, params: {
  name: string;
  target_amount: number;
  deadline?: string;
}): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase
    .from("savings_goals")
    .insert({
      user_id: userId,
      name: params.name,
      target_amount: params.target_amount,
      current_amount: 0,
      deadline: params.deadline,
      status: "active"
    })
    .select("id")
    .single();
  
  if (error) return { success: false, message: "Erro ao criar meta" };
  
  // Calcular sugestão mensal
  const mesesRestantes = params.deadline 
    ? Math.ceil((new Date(params.deadline).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000))
    : 12;
  const sugestaoMensal = params.target_amount / mesesRestantes;
  
  return {
    success: true,
    message: `🎯 *Meta criada!*\n\n` +
      `📌 ${params.name}\n` +
      `💰 Objetivo: R$ ${params.target_amount.toFixed(2)}\n` +
      `📅 ${mesesRestantes} meses\n\n` +
      `💡 Sugestão: guardar R$ ${sugestaoMensal.toFixed(2)}/mês\n\n` +
      `_Diga "guardar 500 na meta" para contribuir!_`
  };
}
```

---

## PROBLEMA RAIZ #6: Mensagens Pendentes Não Processadas

**Evidência:** 4 registros em `pending_messages` com `processed = false`

**Problema:** A fila de mensagens é criada mas nunca consumida

**Correção:**

```typescript
// Após registrar gasto com sucesso (linha ~3004):
const pendingCount = await countPendingMessages(userId);
if (pendingCount > 0) {
  // Processar próxima mensagem da fila
  const nextMessage = await getNextPendingMessage(userId);
  
  if (nextMessage) {
    await markMessageProcessed(nextMessage.id);
    
    // Reprocessar como novo job
    await supabase.from("webhook_jobs").insert({
      user_id: userId,
      message_id: nextMessage.message_id,
      payload: {
        phoneNumber: payload.phoneNumber,
        messageText: nextMessage.message_text,
        messageType: "text",
        messageSource: payload.messageSource
      },
      status: "pending"
    });
    
    await sendMessage(payload.phoneNumber, 
      `📝 Processando próximo gasto da fila...`, 
      payload.messageSource
    );
  }
}

// Novas funções em message-queue.ts
export async function getNextPendingMessage(userId: string) {
  const { data } = await supabase
    .from("pending_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  
  return data;
}
```

---

## PROBLEMA RAIZ #7: Query "Meus alertas" Retorna Resumo

**Evidência:** Tabela `spending_alerts` tem 0 registros

**Problema:** 
1. Não há handler específico para "meus alertas"
2. O cron job `analyze-spending` não está populando a tabela

**Correção:**

```typescript
// 1. Detectar query de alertas antes das outras queries
if (normalized.includes("meus alertas") || normalized.includes("alerta")) {
  // Handler já existe na linha 3298, mas precisa gerar alertas primeiro
  
  // Gerar alertas sob demanda se tabela vazia
  const { count } = await supabase
    .from("spending_alerts")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .is("sent_at", null);
  
  if (count === 0) {
    // Chamar função de análise
    await generateAlertsForUser(userId);
  }
  
  // ... código existente
}

// 2. Função generateAlertsForUser (importar de alerts.ts)
async function generateAlertsForUser(userId: string) {
  const { detectCategorySpike, detectMissedRecurring, detectGoalRisk } = await import("./intents/alerts.ts");
  
  const spikeAlert = await detectCategorySpike(userId);
  const missedAlerts = await detectMissedRecurring(userId);
  const goalAlert = await detectGoalRisk(userId);
  
  // Alertas já são salvos nas funções detect*
}
```

---

## CORREÇÕES ADICIONAIS IDENTIFICADAS

### A. Recorrentes não vinculam ao cartão
Mesmo problema do gasto: `slots.card` contém nome, não ID.

### B. Cancelamento de transação por arraste (reply)
O fluxo de reply não está implementado corretamente.

### C. Edição de transação antiga
Limite de 2 minutos é muito restritivo. Permitir edição por ID.

---

## Arquivos a Modificar

| Arquivo | Mudanças |
|---------|----------|
| `supabase/functions/finax-worker/index.ts` | Handler de seleção numérica, query de entradas, goal handler, processamento de fila |
| `supabase/functions/finax-worker/intents/expense.ts` | Vincular cartao_id corretamente, atualizar limite |
| `supabase/functions/finax-worker/intents/cancel.ts` | Cancelar recorrente por nome/ID |
| `supabase/functions/finax-worker/intents/query.ts` | Adicionar getIncomeDetails, getExpensesByCard |
| `supabase/functions/finax-worker/intents/goals.ts` | Ativar e conectar ao handler |
| `supabase/functions/finax-worker/utils/message-queue.ts` | getNextPendingMessage |
| `supabase/functions/finax-worker/decision/types.ts` | Adicionar ActionType "goal" |

---

## Ordem de Implementação (por prioridade)

### Fase 1: Correções Críticas (Bloqueadoras)
1. **Seleção numérica** - Impede cancelamentos e edições
2. **Vincular cartão a gastos** - Dados incorretos no banco
3. **Atualizar limite do cartão** - Feature core não funciona

### Fase 2: Fluxos Quebrados
4. **Query de entradas** - "Quanto recebi?" retorna gastos
5. **Query por cartão** - "Quanto gastei no nubank?" falha
6. **Cancelar recorrente por nome** - "Cancela Spotify" não funciona

### Fase 3: Features Não Utilizadas
7. **Metas de poupança** - Ativar savings_goals
8. **Alertas inteligentes** - Popular spending_alerts
9. **Processamento de fila** - Consumir pending_messages

### Fase 4: Robustez
10. **Cancelar transação por ID** - Permitir edição de antigos
11. **Padrões de merchant** - Popular user_patterns
12. **Orçamentos via chat** - Ativar tabela orcamentos

---

## Estimativa Total

| Fase | Itens | Tempo |
|------|-------|-------|
| 1 | 3 correções | 45 min |
| 2 | 3 fluxos | 30 min |
| 3 | 3 features | 45 min |
| 4 | 3 robustez | 30 min |

**Total: ~2h30 de implementação**

---

## Resultado Esperado Após Correções

| Comando | Antes | Depois |
|---------|-------|--------|
| "4" (seleção) | R$ 4.00 gasto/entrada? | Seleciona item 4 da lista |
| "Quanto recebi?" | Gastos por categoria | Entradas detalhadas |
| "Quanto gastei no nubank?" | Qual valor mensal? | Gastos do cartão Nubank |
| "Jantar 150 crédito nubank" | cartao_id: NULL | cartao_id: UUID do nubank |
| "Criar meta de 3000" | Cria contexto/viagem | Salva em savings_goals |
| "Meus alertas" | Resumo do mês | Alertas personalizados |
| "Cancela Spotify" | Lista + falha | Cancela direto ou lista |
| "Compra 77" na fila | Fica pendente | Processado automaticamente |

📊 TABELAS NÃO UTILIZADAS - Oportunidades
Tabela	Registros	Propósito Original	Ação Sugerida
savings_goals	0	Metas de poupança	Implementar handler completo
spending_alerts	0	Alertas inteligentes	Ativar cron job + handler
user_patterns	0	Padrões de merchant	Conectar ao auto-aprendizado
alert_feedback	0	Feedback de alertas	Usar para calibrar alertas
orcamentos	0	Orçamentos por categoria	Implementar criação via chat
semantic_categories	134	Cache de categorização	JÁ EM USO ✅

ARRUMAR ISSO. 
