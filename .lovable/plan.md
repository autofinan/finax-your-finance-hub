# Plano Incremental: Finax Acelerador de Liberdade Financeira

## Diagnostico Real do Estado Atual

Dados do banco confirmam:


| Recurso                                 | Estado                              | Acao       |
| --------------------------------------- | ----------------------------------- | ---------- |
| Tabela `dividas`                        | NAO EXISTE                          | Criar      |
| Coluna `expense_type` em transacoes     | NAO EXISTE                          | Criar      |
| Campos de frequencia em `savings_goals` | NAO EXISTEM                         | Adicionar  |
| Faturas abertas                         | 0 (2 futuras, 6 pagas)              | Fix status |
| Transacoes com `fatura_id`              | 0 de 24 (todas usam so `cartao_id`) | Vincular   |
| Recorrentes com `cartao_id`             | 0 de 8 ativos                       | Vincular   |


---

## FASE 1 -- Correcoes de Dados e Bugs Pendentes (Prioridade Maxima)

### 1A: Corrigir faturas sem status correto

- Nenhuma fatura tem status `aberta` -- todas sao `futura` ou `paga`
- Problema: a migration anterior marcou TUDO como `futura`, mas fev/2026 (mes atual) deveria ser `aberta`
- Fix: UPDATE faturas_cartao SET status='aberta' WHERE mes = 2 AND ano = 2026

### 1B: Vincular transacoes existentes a faturas

- 24 transacoes tem `cartao_id` mas 0 tem `fatura_id`
- O FaturaDetailModal ja faz fallback por `cartao_id + date range` -- isso funciona
- Mas o valor_total da fatura pode estar dessincronizado
- Fix: Criar SQL que recalcula `valor_total` de cada fatura com base nas transacoes reais do ciclo

### 1C: Vincular recorrentes a cartoes

- 8 recorrentes ativos mas 0 tem `cartao_id` preenchido
- O campo `cartao_id` ja existe na tabela (migration anterior)
- Fix: identificar recorrentes que sao de credito e vincular ao cartao correto via UPDATE

**Arquivos modificados:** Nenhum codigo -- apenas SQLs via ferramenta de insert

---

## FASE 2 -- Tabela de Dividas + Registro Basico

### 2A: Criar tabela `dividas`

Migration SQL:

```text
CREATE TABLE dividas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  tipo TEXT NOT NULL,        -- 'cartao', 'emprestimo', 'financiamento', 'cheque_especial'
  nome TEXT NOT NULL,
  saldo_devedor NUMERIC(10,2) NOT NULL,
  taxa_juros NUMERIC(5,2),   -- Taxa mensal
  valor_minimo NUMERIC(10,2),
  data_vencimento DATE,
  data_contratacao DATE,
  ativa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS policies para usuario acessar apenas suas dividas
-- Indices em usuario_id e ativa
```

### 2B: Pagina de dividas no dashboard

- Novo arquivo: `src/pages/Dividas.tsx`
- Novo hook: `src/hooks/useDividas.ts`
- CRUD basico: listar, adicionar, editar, marcar como paga
- Card mostrando saldo total devedor e projecao simples
- Adicionar rota no `App.tsx` e link no `Sidebar.tsx`

### 2C: Fluxo WhatsApp para registrar divida

- Adicionar `debt` e `list_debts` como ActionType valido
- No `ai-classifier.ts`: mapear "registrar divida", "tenho divida", "quanto devo"
- No `index.ts` (processarJob): handler para `debt` com coleta de slots (tipo, nome, saldo_devedor, taxa_juros, valor_minimo)
- Novo arquivo: `supabase/functions/finax-worker/intents/debt-handler.ts`

**Arquivos novos:**

- `src/pages/Dividas.tsx`
- `src/hooks/useDividas.ts`
- `supabase/functions/finax-worker/intents/debt-handler.ts`

**Arquivos modificados:**

- `src/App.tsx` (rota)
- `src/components/layout/Sidebar.tsx` (link)
- `supabase/functions/finax-worker/decision/types.ts` (ActionType)
- `supabase/functions/finax-worker/decision/ai-classifier.ts` (mapeamento)
- `supabase/functions/finax-worker/index.ts` (handler)

---

## FASE 3 -- Classificacao de Gastos (expense_type)

### 3A: Adicionar coluna `expense_type` em transacoes

Migration:

```text
ALTER TABLE transacoes ADD COLUMN expense_type TEXT DEFAULT 'discricionario';
-- Valores: essencial_fixo, essencial_variavel, estrategico, discricionario, divida
```

### 3B: Auto-classificar na hora do registro

- Modificar `expense-inline.ts`: apos registrar transacao, classificar expense_type baseado em regras de descricao/categoria
- Mapa de regras estatico (aluguel -> essencial_fixo, mercado -> essencial_variavel, etc.)
- Nao precisa de edge function separada -- integrar na logica existente

### 3C: Dashboard usar expense_type para insights

- Modificar `useDashboard.ts` e `Dashboard.tsx` para mostrar breakdown por expense_type
- Widget: "Gastos Essenciais vs Discricionarios"

**Arquivos modificados:**

- `supabase/functions/finax-worker/intents/expense-inline.ts`
- `src/hooks/useDashboard.ts`
- `src/components/dashboard/ExpenseChart.tsx`

---

## FASE 4 -- Simulador de Cenarios de Quitacao

### 4A: Calculo de margem real

- Nova funcao em `debt-handler.ts`: `calculateRealMargin(userId)`
- Receita - essenciais_fixos - minimos_divida = margem real

### 4B: Simulador de 3 cenarios

- Nova funcao: `simulateDebtScenarios(userId)`
- Cenario atual (30% margem), conservador (-15% discricionario), agressivo (-30% discricionario)
- Retorna: meses para quitar, juros total, dias para liberdade

### 4C: WhatsApp + Dashboard

- WhatsApp: "simular quitacao" / "quanto tempo pra quitar"
- Dashboard: Widget de simulacao em `src/pages/Dividas.tsx` com os 3 cenarios lado a lado

**Arquivos modificados:**

- `supabase/functions/finax-worker/intents/debt-handler.ts` (ampliar)
- `src/pages/Dividas.tsx` (widget simulador)

---

## FASE 5 -- Detector de Padroes e Insights Premium

### 5A: Detector de padroes assertivos

- Funcao em `supabase/functions/finax-worker/intents/reports-handler.ts`: `detectHighImpactPatterns(userId)`
- Detecta: delivery excessivo (>=12x/mes), assinaturas multiplas (>=3), cafes fora (>=15x/mes)
- Retorna apenas padroes de alta severidade

### 5B: Gerador de insight com impacto em dias

- Funcao: `generatePremiumInsight(userId)` -- combina padroes + simulador de dividas
- Formato fixo: situacaoAtual, ajustePossivel, impactoDias, impactoJuros, novaData
- Usa dados REAIS do usuario (nunca generico)

### 5C: Envio via finax-insights (CRON existente)

- Modificar `supabase/functions/finax-insights/index.ts` para gerar insights premium alem dos alertas basicos
- Formato WhatsApp com impacto em dias de liberdade

**Arquivos novos:**

- Nenhum (funcoes em arquivos existentes)

**Arquivos modificados:**

- `supabase/functions/finax-worker/intents/reports-handler.ts`
- `supabase/functions/finax-insights/index.ts`

---

## FASE 6 -- Metas com Frequencia + Retenção

### 6A: Campos de frequencia em savings_goals

Migration:

```text
ALTER TABLE savings_goals 
  ADD COLUMN tipo TEXT DEFAULT 'valor',       -- 'valor' | 'frequencia'
  ADD COLUMN categoria_alvo TEXT,
  ADD COLUMN frequencia_maxima INTEGER,
  ADD COLUMN frequencia_atual INTEGER DEFAULT 0,
  ADD COLUMN periodo TEXT DEFAULT 'mensal';
```

### 6B: Monitoramento em tempo real

- Apos cada gasto registrado, verificar se bate com alguma meta de frequencia
- Alertar quando atingir ou ultrapassar limite

### 6C: Sistema de streak de disciplina

- Funcao que calcula dias consecutivos dentro do orcamento
- Enviar elogio a cada 7, 14, 21, 30 dias

### 6D: Check-in semanal automatico

- Edge function CRON (toda segunda 9h)
- Resumo da semana + progresso de dividas

**Arquivos modificados:**

- `src/hooks/useMetas.ts` (suportar tipo frequencia)
- `src/pages/Metas.tsx` (UI para meta de frequencia)
- `supabase/functions/finax-worker/index.ts` (check apos registro)

---

## FASE 7 -- Refinar Planos de Assinatura

### 7A: Atualizar logica de trial/planos

- Trial 14 dias: tudo basico + 1 insight
- Basico R$19/mes: insights 1x/semana, simulador basico
- Pro R$39/mes: tudo ilimitado

### 7B: Gate de features por plano

- Criar helper `canAccessFeature(plano, feature)` 
- Bloquear simulador de dividas, insights ilimitados, gestao avancada de cartoes para plano trial/basico
- UI mostra lock icon + CTA de upgrade

**Arquivos modificados:**

- `src/hooks/usePlanoStatus.ts` (feature gating)
- Componentes que usam features Pro

---

## Sequencia de Execucao Recomendada


| Etapa | Fase                                | Risco | Tempo estimado |
| ----- | ----------------------------------- | ----- | -------------- |
| 1     | Fase 1: Fix dados (SQL)             | Baixo | 1 sessao       |
| 2     | Fase 2A: Tabela dividas (migration) | Baixo | 1 sessao       |
| 3     | Fase 2B: Pagina dividas (frontend)  | Baixo | 1 sessao       |
| 4     | Fase 2C: WhatsApp dividas (backend) | Medio | 1-2 sessoes    |
| 5     | Fase 3: expense_type                | Medio | 1 sessao       |
| 6     | Fase 4: Simulador                   | Medio | 1-2 sessoes    |
| 7     | Fase 5: Padroes + Insights          | Alto  | 2 sessoes      |
| 8     | Fase 6: Metas frequencia + retencao | Medio | 2 sessoes      |
| 9     | Fase 7: Planos                      | Baixo | 1 sessao       |


---

## O que NAO fazer agora

- NAO criar edge functions separadas para cada feature (manter modularizado dentro do finax-worker)
- NAO implementar gamificacao de competicao (streaks de disciplina sim, ranking nao)
- NAO adicionar integracao com bancos (Open Banking) -- escopo futuro
- NAO modularizar mais o processarJob do index.ts (decisao anterior confirmada)

---

## Secao Tecnica: Primeira Acao Imediata (Fase 1)

SQLs para corrigir dados agora:

```text
-- 1A: Corrigir fatura de fev/2026 para 'aberta'
UPDATE faturas_cartao 
SET status = 'aberta' 
WHERE mes = 2 AND ano = 2026 AND status = 'futura';

-- 1B: Recalcular valor_total das faturas com base nas transacoes reais
-- (executar apos verificar os dados)
```

Apos executar a Fase 1, comecar a Fase 2 (tabela dividas + frontend + backend).  
  
UM DETALHE, PARA O USUARIO NOA DIGA DESCRICIONARIO, ELE NAO VAI ENTENDER, FICA MUITO VAGO, NO INTERNO OK, MAS PARA O USUARIO CHAME DE GASTOS FLEXIVEIS, PARA ELE NAO ESTRANHAR. 