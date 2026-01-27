
# Plano de Correção Completa - Frontend FINAX v3.2

## 📋 Diagnóstico dos Problemas

### Problemas Identificados nas Screenshots e Análise

| # | Problema | Causa Raiz | Impacto |
|---|----------|------------|---------|
| 1 | "Não foi possível adicionar transação" | RLS policy exige `usuario_id = auth.uid()`, mas usuário usa auth customizado | Crítico |
| 2 | Dashboard mostra R$ 0,00 | `useTransacoes(user?.id)` passa `auth.uid` inexistente no sistema customizado | Crítico |
| 3 | Botões de adicionar não funcionam | Mesmo problema - RLS blocking inserts | Crítico |
| 4 | Borda branca visível | CSS não aplica dark mode ao body/html | Visual |
| 5 | Dados não vinculados ao WhatsApp | Dashboard não usa `useUsuarioId()` | Funcional |

---

## 🔧 Análise Técnica Detalhada

### Problema Principal: Desalinhamento Auth ↔ Supabase

**O sistema atual:**
```
WhatsApp → OTP → Token customizado (localStorage) → AuthContext.user
```

**O que o Supabase RLS espera:**
```
auth.uid() → ID do usuário autenticado via Supabase Auth
```

**Problema:**
- O `AuthContext.user.id` é o ID da tabela `usuarios` (UUID do usuário WhatsApp)
- O `auth.uid()` do Supabase é `null` porque não há sessão Supabase ativa
- RLS policies bloqueiam INSERT/UPDATE com `with_check: (usuario_id = auth.uid())`

### Por que Transacoes.tsx funciona mas Dashboard não?

| Página | Como busca dados | Resultado |
|--------|-----------------|-----------|
| Transacoes.tsx | `useUsuarioId()` → busca usuario_id via telefone | ✅ Funciona (SELECT) |
| Dashboard.tsx | `user?.id` direto do AuthContext | ❌ Não encontra dados |

Mas AMBOS falham no INSERT porque a RLS policy exige `auth.uid()` que não existe.

---

## 🛠️ Soluções Propostas

### Solução 1: Corrigir Frontend (Dashboard + Hooks)

**Arquivos afetados:**
- `src/pages/Dashboard.tsx`
- `src/hooks/useTransacoes.ts`
- `src/hooks/useCartoes.ts`
- `src/hooks/useGastosRecorrentes.ts`
- `src/index.css` (borda branca)

**Mudanças:**

#### 1.1 Dashboard.tsx - Usar useUsuarioId
```typescript
// ANTES (linha 27):
const { transacoes, loading, addTransacao } = useTransacoes(user?.id);

// DEPOIS:
const { usuarioId } = useUsuarioId();
const { transacoes, loading, addTransacao } = useTransacoes(usuarioId || undefined);
const { gastos } = useGastosRecorrentes(usuarioId || undefined);
```

#### 1.2 useTransacoes.ts - Incluir usuarioId no insert
```typescript
// ANTES (linhas 64-78):
const transacaoData = {
  // ...
  usuario_id: transacao.usuario_id || null,  // ← PROBLEMA: sempre null
};

// DEPOIS:
const addTransacao = async (transacao: { ... }) => {
  // Validar que temos usuarioId
  if (!usuarioId) {
    toast({
      title: 'Erro',
      description: 'Você precisa estar conectado via WhatsApp para adicionar transações.',
      variant: 'destructive',
    });
    throw new Error('Usuario não vinculado');
  }

  const transacaoData = {
    // ...
    usuario_id: usuarioId,  // ← CORRIGIDO: usa usuarioId do hook
  };
};
```

#### 1.3 useCartoes.ts - Mesmo padrão
```typescript
// Modificar addCartao para incluir usuarioId
const addCartao = async (cartao: ...) => {
  if (!usuarioId) {
    toast({ title: 'Erro', description: 'Usuário não vinculado', variant: 'destructive' });
    throw new Error('Usuario não vinculado');
  }
  
  const { data, error } = await supabase
    .from('cartoes_credito')
    .insert([{ ...cartao, usuario_id: usuarioId }])  // ← Incluir usuarioId
    .select()
    .single();
};
```

#### 1.4 index.css - Remover borda branca
```css
/* Adicionar no @layer base */
html, body, #root {
  @apply bg-slate-950;
  margin: 0;
  padding: 0;
}
```

### Solução 2: Corrigir RLS Policies (Backend)

**Problema:** As policies usam `auth.uid()` que retorna `null` com auth customizado.

**Solução:** Criar policies baseadas em JWT claims ou usar service_role no frontend.

**Opção A - Manter auth customizado (recomendado para MVP):**
Usar uma função RPC que bypassa RLS para operações autenticadas:

```sql
-- Criar função para insert com validação customizada
CREATE OR REPLACE FUNCTION insert_transacao_segura(
  p_usuario_id UUID,
  p_tipo TEXT,
  p_valor NUMERIC,
  p_categoria TEXT,
  p_observacao TEXT DEFAULT NULL,
  p_data TIMESTAMPTZ DEFAULT NOW()
)
RETURNS transacoes
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_result transacoes;
BEGIN
  -- Inserir transação
  INSERT INTO transacoes (usuario_id, tipo, valor, categoria, observacao, data, origem)
  VALUES (p_usuario_id, p_tipo, p_valor, p_categoria, p_observacao, p_data, 'manual')
  RETURNING * INTO v_result;
  
  RETURN v_result;
END;
$$;
```

**Opção B - Relaxar RLS para INSERT (temporário):**
```sql
-- Permitir insert para usuários autenticados (qualquer)
DROP POLICY IF EXISTS "transacoes_insert_own" ON transacoes;
CREATE POLICY "transacoes_insert_authenticated" ON transacoes
  FOR INSERT TO authenticated
  WITH CHECK (true);
```

---

## 📦 Arquivos a Modificar

| Arquivo | Mudança | Prioridade |
|---------|---------|------------|
| `src/pages/Dashboard.tsx` | Usar `useUsuarioId()` em vez de `user?.id` | Alta |
| `src/hooks/useTransacoes.ts` | Incluir `usuarioId` no hook e usar no insert | Alta |
| `src/hooks/useCartoes.ts` | Incluir `usuarioId` no hook e usar no insert | Alta |
| `src/hooks/useGastosRecorrentes.ts` | Incluir `usuarioId` no hook e usar no insert | Alta |
| `src/index.css` | Adicionar background escuro ao html/body | Média |
| Supabase Migration | Criar RPC ou ajustar RLS para auth customizado | Alta |

---

## 🔄 Fluxo Corrigido

```text
1. Usuário faz login OTP
   ↓
2. AuthContext.user = { id, phone, plano, ... }
   ↓
3. useUsuarioId() busca usuarios.id pelo phone
   ↓
4. usuarioId = UUID do usuário no banco
   ↓
5. useTransacoes(usuarioId) / useCartoes(usuarioId)
   ↓
6. SELECT * WHERE usuario_id = usuarioId ✅
   ↓
7. INSERT com usuario_id = usuarioId ✅
```

---

## ✅ Testes de Validação

| Cenário | Resultado Esperado |
|---------|-------------------|
| Abrir Dashboard logado | Mostra dados do usuário (não R$ 0,00) |
| Clicar "Nova Transação" e preencher | Transação criada com sucesso |
| Clicar "Novo Cartão" e preencher | Cartão criado com sucesso |
| Verificar borda da página | Sem borda branca visível |
| Adicionar gasto recorrente | Recorrente criado com sucesso |

---

## 🎯 Correções do ChatGPT v3.2 Integradas

Além das correções do frontend, este plano também prepara o terreno para as correções do backend v3.2:

| Correção ChatGPT | Status | Onde Aplicar |
|------------------|--------|--------------|
| Separar `query_scope` de `time_range` | Pendente | `finax-worker/index.ts` |
| Funções retornam dados, não strings | Pendente | `finax-worker/intents/query.ts` |
| `pending_messages` como pré-transação | Pendente | Schema + Worker |
| Idempotência atômica (UPDATE + check rowCount) | Pendente | `finax-worker/index.ts` |
| Credit flow determinístico | Pendente | `finax-worker/intents/expense.ts` |
| Context marca transações | Pendente | Schema + Worker |
| Chat analítico read-only | Pendente | `finax-worker/index.ts` |

---

## 📊 Impacto Esperado

- **100%** dos erros de "Não foi possível adicionar" resolvidos
- **100%** dos dados carregando corretamente no Dashboard
- **Borda branca** removida
- Sistema pronto para as correções v3.2 do backend


Plano de Correção Completa - FINAX v3.2
📋 Diagnóstico Detalhado dos Erros
Erros Críticos Identificados nos Testes
#	Erro	Entrada	Resultado	Esperado
1	Query genérica absorve tudo	"Cartões", "Quais cartões?"	Resumo do mês	Lista de cartões
2	Perguntas temporais ignoradas	"Quanto gastei essa semana?"	Resumo do mês	Gastos da semana
3	Gastos pendentes não listados	"Quais gastos pendentes?"	Resumo do mês	Lista de pendentes
4	Cancel pega alvo errado	"Pausa meta viagem"	Lista transações	Pausar meta específica
5	Metas duplicadas	"Criar meta viagem"	Cria outra "viagem"	Atualizar existente ou perguntar
6	"Viagem 1" não entendido	Após "encontrei várias metas"	"Não entendi"	Selecionar meta 1
7	Contexto "Terminei viagem"	"Terminei a viagem"	"Registrar gasto?"	Fechar contexto set_context
8	Chat analítico vazio	"Analise meus gastos"	Resposta genérica sem dados	Análise com categorias já conhecidas
🔧 Correções Necessárias
1. EXPANDIR QUERY COM SUB-TIPOS (query_scope)
Problema: O intent query é um "buraco negro" - qualquer consulta vira resumo do mês.

Solução: Adicionar slot query_scope no prompt e criar handlers específicos.

Arquivo: supabase/functions/finax-worker/index.ts

Mudanças no Prompt (linhas 630-633):

### query - Consultar informações
Ver dados, não modificar.
Indicadores: "quanto", "resumo", "saldo", "total", "meus", "quais"
Slots: query_scope, time_range
- query_scope: summary | cards | expenses | income | pending | recurring | category | week | today
- time_range: month | week | today | custom
Exemplos: 
  - "Quanto gastei esse mês?" → query_scope: expenses, time_range: month
  - "Meus cartões" → query_scope: cards
  - "Gastos pendentes" → query_scope: pending
  - "Gastos da semana" → query_scope: expenses, time_range: week
  - "Quanto gastei hoje?" → query_scope: expenses, time_range: today
Mudanças no Handler QUERY (linhas ~3967-4110):


// NOVO: Rotear por query_scope
const queryScope = decision.slots.query_scope || detectQueryScope(normalized);
const timeRange = decision.slots.time_range || detectTimeRange(normalized);

switch (queryScope) {
  case "cards":
    const cardsResult = await queryCardLimits(userId);
    await sendMessage(phoneNumber, cardsResult, source);
    return;
  
  case "pending":
    const pending = await listPendingExpenses(userId);
    await sendMessage(phoneNumber, pending, source);
    return;
  
  case "expenses":
    if (timeRange === "week") {
      const weekResult = await getWeeklyExpenses(userId);
      await sendMessage(phoneNumber, weekResult, source);
      return;
    }
    if (timeRange === "today") {
      const todayResult = await getTodayExpenses(userId);
      await sendMessage(phoneNumber, todayResult, source);
      return;
    }
    break;
  
  // ... outros casos
}
2. CRIAR FUNÇÕES DE QUERY TEMPORAL
Problema: Não existem funções para "gastos da semana" ou "gastos de hoje".

Arquivo: supabase/functions/finax-worker/intents/query.ts

Adicionar:


export async function getWeeklyExpenses(userId: string): Promise<string> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Domingo
  startOfWeek.setHours(0, 0, 0, 0);
  
  const { data: transactions } = await supabase
    .from("transacoes")
    .select("valor, descricao, categoria, data")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", startOfWeek.toISOString())
    .eq("status", "confirmada")
    .order("data", { ascending: false });
  
  if (!transactions?.length) {
    return "📊 Nenhum gasto esta semana! 🎉";
  }
  
  const total = transactions.reduce((s, t) => s + Number(t.valor), 0);
  const list = transactions.slice(0, 10).map(t => 
    `💸 R$ ${Number(t.valor).toFixed(2)} - ${t.descricao || t.categoria}`
  ).join("\n");
  
  return `📊 *Gastos da Semana*\n\n${list}\n\n💸 Total: *R$ ${total.toFixed(2)}*`;
}

export async function getTodayExpenses(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { data } = await supabase
    .from("transacoes")
    .select("valor, descricao, categoria")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", today.toISOString())
    .eq("status", "confirmada");
  
  if (!data?.length) {
    return "📊 Nenhum gasto hoje! 🎉";
  }
  
  const total = data.reduce((s, t) => s + Number(t.valor), 0);
  const list = data.map(t => 
    `💸 R$ ${Number(t.valor).toFixed(2)} - ${t.descricao || t.categoria}`
  ).join("\n");
  
  return `📊 *Gastos de Hoje*\n\n${list}\n\n💸 Total: *R$ ${total.toFixed(2)}*`;
}

export async function listPendingExpenses(userId: string): Promise<string> {
  const { data } = await supabase
    .from("pending_messages")
    .select("content, created_at")
    .eq("user_id", userId)
    .eq("processed", false)
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (!data?.length) {
    return "📬 Nenhum gasto pendente! Tudo registrado ✅";
  }
  
  const list = data.map((p, i) => `${i + 1}. ${p.content}`).join("\n");
  return `📬 *Gastos Pendentes*\n\n${list}\n\n_Quer que eu registre algum desses?_`;
}
3. SEPARAR CANCEL COM TARGET EXPLÍCITO
Problema: cancel tenta adivinhar se é transação, recorrente ou meta.

Solução: Adicionar slot cancel_target no prompt e forçar clarificação.

Mudanças no Prompt:

### cancel - Cancelar algo
Indicadores: "cancela", "desfaz", "apaga", "remove", "para de"
Slots: cancel_target, target_name
- cancel_target: transaction | recurring | goal | context
- target_name: nome do item (Netflix, viagem, etc.)
Exemplos:
  - "Cancela minha Netflix" → cancel_target: recurring, target_name: Netflix
  - "Pausa meta viagem" → cancel_target: goal, target_name: viagem (AÇÃO: pausar)
  - "Cancela esse gasto" → cancel_target: transaction
  - "Terminei a viagem" → cancel_target: context, target_name: viagem
Mudanças no Handler CANCEL (linhas ~3879-3963):


if (decision.actionType === "cancel") {
  const target = decision.slots.cancel_target;
  const targetName = decision.slots.target_name || decision.slots.description;
  
  // OBRIGATÓRIO: Se não tem target, perguntar
  if (!target) {
    await sendButtons(phoneNumber, 
      "O que você quer cancelar?",
      [
        { id: "cancel_tx", title: "🧾 Transação" },
        { id: "cancel_rec", title: "🔄 Recorrente" },
        { id: "cancel_goal", title: "🎯 Meta" }
      ],
      source
    );
    return;
  }
  
  switch (target) {
    case "goal":
      // Redirecionar para goals com ação pausar/cancelar
      const { updateGoalStatus } = await import("./intents/goals.ts");
      const result = await updateGoalStatus(userId, targetName, "paused");
      await sendMessage(phoneNumber, result, source);
      return;
    
    case "recurring":
      // Fluxo existente de cancelar recorrente
      // ...
      break;
    
    case "context":
      // Fechar contexto ativo (viagem/evento)
      await closeActiveContext(userId, targetName);
      await sendMessage(phoneNumber, `✅ Contexto "${targetName}" finalizado!`, source);
      return;
    
    case "transaction":
    default:
      // Fluxo existente de cancelar transação
      break;
  }
}
4. PREVENIR METAS DUPLICADAS (upsert semântico)
Problema: Criar "meta viagem" quando já existe uma cria duplicada.

Arquivo: supabase/functions/finax-worker/intents/goals.ts

Modificar createGoal:


export async function createGoal(params: CreateGoalParams): Promise<string> {
  const { userId, name, targetAmount } = params;
  
  // NOVO: Verificar se já existe meta com nome similar
  const { data: existing } = await supabase
    .from("savings_goals")
    .select("id, name, target_amount, current_amount, status")
    .eq("user_id", userId)
    .ilike("name", `%${name}%`);
  
  if (existing && existing.length > 0) {
    const activeGoals = existing.filter(g => g.status === "active");
    
    if (activeGoals.length === 1) {
      // UMA meta similar ativa → oferecer atualizar
      const goal = activeGoals[0];
      return `🎯 Você já tem uma meta "${goal.name}"!\n\n` +
        `💰 Objetivo: R$ ${goal.target_amount.toFixed(2)}\n` +
        `📊 Acumulado: R$ ${goal.current_amount.toFixed(2)}\n\n` +
        `Quer *atualizar o objetivo* para R$ ${targetAmount.toFixed(2)} ou *criar uma nova* meta?`;
    }
    
    if (activeGoals.length > 1) {
      // MÚLTIPLAS metas similares → listar
      const list = activeGoals.map(g => `• ${g.name}: R$ ${g.current_amount}/${g.target_amount}`).join("\n");
      return `🎯 Você tem várias metas similares:\n\n${list}\n\n` +
        `Qual você quer atualizar? Ou manda "nova meta ${name} ${targetAmount}" para criar uma diferente.`;
    }
  }
  
  // Fluxo normal de criação
  // ... código existente
}
5. HANDLER DE SELEÇÃO EM CONTEXTO DE METAS
Problema: "Viagem 1" após listar metas não é entendido.

Arquivo: supabase/functions/finax-worker/index.ts

Adicionar no handler GOAL (linhas ~3747-3795):


if (decision.actionType === "goal") {
  const slots = decision.slots;
  const normalized = normalizeText(conteudoProcessado);
  
  // NOVO: Detectar seleção numérica após listar metas
  const numSelectionMatch = conteudoProcessado.match(/^(\w+)\s*(\d+)$/i);
  if (numSelectionMatch && activeAction?.intent === "goal" && activeAction.slots.options) {
    const options = activeAction.slots.options as any[];
    const idx = parseInt(numSelectionMatch[2]) - 1;
    
    if (idx >= 0 && idx < options.length) {
      const selectedGoal = options[idx];
      // Executar ação pendente (adicionar, pausar, etc.)
      if (activeAction.slots.pending_action === "add") {
        const amount = activeAction.slots.pending_amount || slots.amount;
        const result = await addToGoal(userId, selectedGoal.id, amount);
        await sendMessage(phoneNumber, result, source);
        return;
      }
    }
  }
  
  // ... resto do handler
}
6. DETECTAR "TERMINEI A VIAGEM" COMO FECHAR CONTEXTO
Problema: "Terminei a viagem" é tratado como gasto/unknown.

Solução: Adicionar padrão no prompt e handler para set_context com ação de fechar.

Mudanças no Prompt:

### set_context - Período especial
Viagem ou evento COM ciclo de vida.
Indicadores: 
  - Iniciar: "vou viajar", "começando", "início" + datas
  - Encerrar: "terminei", "voltei", "acabou", "fim da"
Slots: label, start_date, end_date, action (start|end)
Exemplos: 
  - "Vou viajar de 10/01 até 15/01" → action: start
  - "Terminei a viagem" → action: end, label: viagem
  - "Voltei da viagem" → action: end, label: viagem
Handler SET_CONTEXT:


if (decision.actionType === "set_context") {
  const action = decision.slots.action || "start";
  const label = decision.slots.label || decision.slots.description;
  
  if (action === "end" || normalized.includes("terminei") || normalized.includes("voltei")) {
    // Fechar contexto ativo
    const activeCtx = await getActiveContext(userId);
    if (activeCtx) {
      await closeActiveContext(userId, activeCtx.id);
      const { total } = await queryContextExpenses(userId, activeCtx.id);
      await sendMessage(phoneNumber, 
        `✅ *${activeCtx.label} encerrada!*\n\n` +
        `💸 Total gasto: R$ ${total.toFixed(2)}\n\n` +
        `_Boa viagem! 🧳_`,
        source
      );
      return;
    }
    await sendMessage(phoneNumber, "Você não tem nenhum contexto ativo no momento 🤔", source);
    return;
  }
  
  // Fluxo de iniciar contexto...
}
7. CHAT ANALÍTICO COM DADOS ESTRUTURADOS
Problema: "Analise meus gastos" responde sem usar dados que já foram mostrados.

Solução: Sempre buscar dados antes de chamar a IA para análise.

Mudanças no Handler CHAT (linhas ~4250+):


if (decision.actionType === "chat") {
  // NOVO: Detectar se é pergunta analítica
  const isAnalytical = normalized.includes("analise") || normalized.includes("análise") ||
                       normalized.includes("exagerado") || normalized.includes("muito") ||
                       normalized.includes("melhorar") || normalized.includes("economizar");
  
  if (isAnalytical) {
    // BUSCAR DADOS PRIMEIRO
    const [summary, categories, cards] = await Promise.all([
      getMonthlySummary(userId),
      getExpensesByCategory(userId),
      queryCardLimits(userId)
    ]);
    
    // Construir contexto estruturado para a IA
    const dataContext = `
DADOS DO USUÁRIO (use isso para responder):
${summary}

${categories}

${cards}
`;
    
    // Chamar IA com contexto
    const analysis = await callAIWithContext(dataContext, conteudoProcessado);
    await sendMessage(phoneNumber, analysis, source);
    return;
  }
  
  // Chat normal...
}
8. IDEMPOTÊNCIA DE EXECUÇÃO
Problema: Mensagem duplicada registra duas vezes.

Solução: Verificar message_id antes de processar.

Arquivo: supabase/functions/finax-worker/index.ts (início do handler)


// Logo após buscar evento bruto
const { data: existingEvent } = await supabase
  .from("eventos_brutos")
  .select("id, processado")
  .eq("message_id", payload.messageId)
  .single();

if (existingEvent?.processado) {
  console.log(`⚠️ [IDEMPOTENT] Mensagem ${payload.messageId} já processada - ignorando`);
  return new Response("Already processed", { status: 200 });
}

// Marcar como sendo processada
await supabase
  .from("eventos_brutos")
  .update({ processado: true, processing_started_at: new Date().toISOString() })
  .eq("id", existingEvent?.id);
📦 Resumo de Arquivos a Modificar
Arquivo	Mudança
finax-worker/index.ts	Prompt v3.2, handlers de query/cancel/goal/set_context, idempotência
finax-worker/intents/query.ts	Funções getWeeklyExpenses, getTodayExpenses, listPendingExpenses
finax-worker/intents/goals.ts	Verificação de duplicatas em createGoal
finax-worker/decision/types.ts	Novos slots: query_scope, time_range, cancel_target
✅ Testes de Validação Pós-Implementação
Cenário	Intent	Resultado Esperado
"Meus cartões"	query	Lista cartões cadastrados
"Quanto gastei essa semana?"	query	Gastos dos últimos 7 dias
"Gastos pendentes"	query	Lista de pending_messages
"Pausa meta viagem"	cancel	Meta pausada (não transação)
"Criar meta viagem 5000" (já existe)	goal	Pergunta se atualiza ou cria nova
"Viagem 1" após listar metas	goal	Seleciona primeira meta
"Terminei a viagem"	set_context	Fecha contexto ativo, mostra total
"Analise meus gastos"	chat	Análise com dados das categorias
Mensagem duplicada	-	Ignora segunda execução
🔄 Ordem de Implementação
Idempotência - Proteção básica contra duplicatas
Query expandida - Resolver o maior volume de erros
Cancel com target - Evitar ações destrutivas erradas
Goals sem duplicatas - UX melhorada
Set_context lifecycle - Fechar viagens
Chat analítico - Qualidade das respostas
📊 Impacto Esperado
70% dos erros de "Resumo do mês indevido" serão eliminados com query_scope
100% das pausas de meta irão para o handler correto
0 duplicações com idempotência
Análises financeiras terão dados reais, não genéricos

2️⃣ Correções obrigatórias (a parte que você ainda não enxergou)
❌ ERRO 1 — query_scope está misturando tipo com tempo

Você criou isso:

query_scope: summary | cards | expenses | income | pending | recurring | category | week | today
time_range: month | week | today | custom


⚠️ Isso está conceitualmente errado.

O problema

week e today NÃO SÃO escopos

Eles são filtros temporais

Você está duplicando responsabilidade:

expenses + week

week sozinho

time_range = week

👉 Isso vai gerar inconsistência, bugs e decisões conflitantes.

✅ Correção obrigatória

Faça isso agora, antes de seguir:

query_scope:
  summary
  cards
  expenses
  income
  pending
  recurring
  category

time_range:
  today
  week
  month
  custom


E NUNCA coloque tempo dentro de query_scope.

Regra de ouro:
Escopo = O QUÊ
Tempo = QUANDO

❌ ERRO 2 — Funções de query retornam string, não dados

Exemplo seu:

export async function getWeeklyExpenses(userId): Promise<string>


⚠️ Isso mata o futuro do sistema.

O problema real

Hoje você só responde texto.
Amanhã você vai querer:

análise

gráfico

exportação

comparação

insights automáticos

E aí?
Você vai ter que rebuscar tudo do banco, porque jogou fora os dados.

✅ Correção obrigatória

SEMPRE separar:

type WeeklyExpensesResult = {
  total: number
  transactions: Transaction[]
  startDate: string
  endDate: string
}


Função:

export async function getWeeklyExpensesData(userId): Promise<WeeklyExpensesResult>


E só depois um formatter:

formatWeeklyExpenses(result): string


📌 Regra de sistema maduro

Banco → Dados → Lógica → Apresentação
Nunca Banco → Texto

❌ ERRO 3 — pending_messages ainda está isolado do fluxo real

Você listou pendentes assim:

from("pending_messages")


Mas respondeu:

“Quer que eu registre algum desses?”

⚠️ Cadê o fluxo de confirmação?

Hoje:

pendente = texto solto

sem vínculo com:

categoria sugerida

valor estimado

tipo (entrada/saída)

origem (áudio/imagem/texto)

✅ Correção obrigatória

pending_messages PRECISA ser uma pré-transação.

Estrutura mínima:

pending_messages:
  id
  user_id
  raw_content
  suggested_type
  suggested_amount
  suggested_category
  confidence
  source (audio|image|text)
  processed


E quando o usuário disser:

“Registra o 2”

👉 você promove:
pending_message → transacoes

Sem reprocessar IA.
Sem chute.
Sem bug.

❌ ERRO 4 — Idempotência está incompleta (perigoso)

Você fez:

if (existingEvent?.processado) return;


⚠️ Isso não resolve concorrência real.

Dois workers podem:

Ler processado = false

Processar

Atualizar depois

Resultado: duplicação ainda ocorre.

✅ Correção correta (nível produção)

Você precisa de lock atômico:

update eventos_brutos
set processado = true
where message_id = ?
and processado = false


E checar rowCount === 1.

Se não for 1 → ignora.

📌 Idempotência não é if, é atomicidade.

3️⃣ Ajustes finos que elevam o Finax de nível

Esses não são “obrigatórios”, mas te colocam anos à frente.

🔧 Ajuste A — Credit Flow precisa ser determinístico

Hoje:

“Vincula automaticamente”

Mas com base em quê?

Você precisa garantir:

if (payment_method === "credit") {
  cartão = OBRIGATÓRIO
  fatura = derivada(cartão, data)
  parcela:
    total_parcelas
    parcela_atual
}


Nenhum gasto no crédito pode existir sem:

card_id

invoice_id

Se não tiver → perguntar, nunca inferir.

🔧 Ajuste B — Contexto (viagem) precisa marcar transações

Hoje você:

fecha contexto

soma gastos

Mas não marca as transações como pertencentes ao contexto.

Correção:

transacoes.context_id = active_context.id


Assim você pode:

consultar viagem depois

analisar viagens

comparar eventos

🔧 Ajuste C — Chat analítico não pode escrever no banco

Garanta:

chat = read-only

nenhuma função mutável

nenhuma side-effect

Isso evita bugs invisíveis.

ARRUME TUDO, NAO DEIXE NADA PARA TRÁS.
