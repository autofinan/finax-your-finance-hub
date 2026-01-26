
# Plano de Refatoração Definitivo do Finax - Arquitetura de Estado Forte

## Diagnóstico Completo

Após análise profunda do código, banco de dados e logs, identifiquei **5 problemas estruturais críticos**:

### PROBLEMA 1: Estado Conversacional FRACO (70% dos bugs)
```
EVIDÊNCIA no banco:
- 199 actions no total
- Muitas com status "collecting" ou "expired" sem conclusão
- Várias actions duplicadas para o mesmo usuário/intent
```

**O que acontece:**
- Usuário diz "Registrar cartão Bradesco limite 2000"
- IA classifica como `add_card` com slots parciais
- Sistema pergunta algo (ex: dia vencimento)
- Usuário responde "15"
- IA classifica "15" como novo intent (expense/income)
- O fluxo de add_card é abandonado

**Causa Raiz:** O Decision Engine não PRIORIZA o contexto ativo. Cada mensagem é classificada isoladamente.

### PROBLEMA 2: Gastos no Crédito SEM Cartão/Fatura (Estrutura Inutilizada)
```sql
-- 10+ transações com forma_pagamento='credito' e cartao_id=NULL
-- 0 registros em faturas_cartao
-- 3 cartões cadastrados mas NUNCA vinculados a transações
```

**O que acontece:**
- Usuário registra "50 no crédito"
- Sistema grava na tabela `transacoes` com `forma_pagamento='credito'`
- MAS não vincula ao cartão (`cartao_id=NULL`)
- MAS não cria entrada na fatura (`fatura_id=NULL`)
- MAS não desconta do limite disponível

**Resultado:** Cartões e faturas existem mas são inúteis.

### PROBLEMA 3: Tabelas Não Utilizadas (Desperdício de Arquitetura)
```
TABELA                   REGISTROS   STATUS
─────────────────────────────────────────────────
faturas_cartao           0           NÃO USADA (deveria ter faturas mensais)
orcamentos               0           NÃO USADA (poderia ter limites por categoria)
savings_goals            0           NÃO USADA (metas existem, handler ok, não testado)
alert_feedback           0           NÃO USADA (alertas não enviam)
media_analysis           5           USADA MAS NÃO INTEGRADA (OCR salva mas não alimenta decisões)
conversas_ativas         0           OBSOLETA (substituída por actions)
```

### PROBLEMA 4: Fluxos que Começam e Nunca Terminam
```
EVIDÊNCIA nas actions:
- status="collecting" sem pending_slot definido
- múltiplas actions ativas para o mesmo usuário
- nenhuma confirmação final antes de salvar
```

**O que deveria acontecer:**
1. Usuário inicia fluxo
2. Sistema coleta dados necessários
3. Sistema CONFIRMA antes de salvar
4. Sistema VOLTA ao estado neutro

**O que acontece hoje:**
1. Usuário inicia fluxo
2. Sistema coleta parcialmente
3. Qualquer mensagem nova inicia outro fluxo
4. Estado vira caos

### PROBLEMA 5: Site Desconectado dos Dados WhatsApp
```
EVIDÊNCIA:
- Transacoes.tsx usa useTransacoes hook
- Hook filtra por usuario_id
- Dados aparecem SE o usuário está autenticado
- MAS: usuario_id das transações WhatsApp ≠ auth.uid() do site
```

**Causa:** O WhatsApp usa `usuarios.id` baseado em phone_number. O site usa `auth.uid()`. Não há vinculação explícita.

---

## Solução: Arquitetura de Estado Forte

### Princípio Fundamental
O Finax implementará uma **Máquina de Estados Finitos** onde:
- Cada usuário tem UM estado ativo por vez
- Mensagens são interpretadas NO CONTEXTO daquele estado
- Transições são explícitas (início → coleta → confirmação → execução → neutro)
- Fluxos não podem ser "esquecidos"

### MÓDULO 1: Priorização de Contexto Ativo

**Arquivo:** `supabase/functions/finax-worker/index.ts`

**Mudança no Decision Engine:**
```text
ANTES:
1. Receber mensagem
2. Classificar com IA
3. Verificar se tem action ativa
4. Tentar preencher slot

DEPOIS:
1. Receber mensagem
2. VERIFICAR SE TEM ACTION ATIVA
3. SE TEM: interpretar mensagem COMO RESPOSTA ao slot pendente
4. SE NÃO TEM: classificar com IA
```

**Regra de Ouro:**
```
SE activeAction.pending_slot existe:
  → Mensagem é resposta para aquele slot
  → NÃO classificar com IA
  → APENAS validar e preencher
```

### MÓDULO 2: Fluxo de Cartão de Crédito Completo

**O que precisa acontecer quando usuário diz "50 no crédito":**

1. Sistema detecta `forma_pagamento = credito`
2. SE usuário tem 1 cartão → usar automaticamente
3. SE usuário tem múltiplos cartões → perguntar qual
4. SE usuário tem 0 cartões → oferecer cadastrar
5. APÓS vincular ao cartão:
   - `cartao_id` = cartão selecionado
   - Buscar/criar fatura do mês atual
   - `fatura_id` = fatura do mês
   - Atualizar `limite_disponivel -= valor`
   - Atualizar `faturas_cartao.valor_total += valor`

**Arquivos a modificar:**
- `supabase/functions/finax-worker/intents/expense.ts` (vincular cartão/fatura)
- `supabase/functions/finax-worker/intents/card.ts` (criar função getOrCreateInvoice)

### MÓDULO 3: Sistema de Confirmação Final

**Antes de QUALQUER registro definitivo:**
```text
Finax: "Confirmando:
        💳 Bradesco
        💰 Limite: R$ 2000
        📅 Vencimento: dia 15
        
        Tudo certo? ✅"
```

**Usuário responde:**
- "Sim" / "Confirma" → Salvar e fechar action
- "Não" / "Cancela" → Cancelar action
- Qualquer outra coisa → Perguntar novamente

**Implementação:**
- Novo status de action: `awaiting_confirmation`
- Novo handler para processar confirmações

### MÓDULO 4: Vinculação Site ↔ WhatsApp

**Problema:** `auth.uid()` ≠ `usuarios.id`

**Solução:** Criar coluna `auth_id` na tabela `usuarios` e popular no login OTP.

**Fluxo:**
1. Usuário faz login com telefone no site
2. Sistema busca `usuarios` por `phone_number`
3. Atualiza `usuarios.auth_id = auth.uid()`
4. Hooks do site usam `auth_id` para filtrar

**Arquivos:**
- Criar migração para adicionar `auth_id` em `usuarios`
- Atualizar `verify-otp/index.ts` para preencher `auth_id`
- Atualizar todos os hooks (`useTransacoes`, `useCartoes`, etc.)

### MÓDULO 5: Ciclo de Vida de Faturas

**Automações necessárias:**

1. **Criar fatura do mês automaticamente:**
   - Quando: primeiro gasto no crédito do mês OU dia de abertura
   - Status inicial: `aberta`

2. **Fechar fatura no dia de fechamento:**
   - CRON diário verifica cartões onde `dia_fechamento = hoje`
   - Muda status para `fechada`
   - Valor total fica congelado

3. **Alertar sobre vencimento:**
   - 7, 3, 1 dia antes do `dia_vencimento`
   - Enviar mensagem via WhatsApp

4. **Marcar como paga:**
   - Usuário: "Paguei a fatura do Nubank"
   - Sistema: atualiza `status = 'paga'`, restaura limite

**Arquivos:**
- `supabase/functions/ciclo-fatura/index.ts` (nova função CRON)
- Atualizar `supabase/config.toml` com schedule

---

## Resumo de Mudanças

### Arquivos Novos
| Arquivo | Propósito |
|---------|-----------|
| `supabase/migrations/xxx_auth_id_usuarios.sql` | Adicionar auth_id |
| `supabase/functions/ciclo-fatura/index.ts` | CRON para ciclo de faturas |

### Arquivos Modificados
| Arquivo | Mudança |
|---------|---------|
| `finax-worker/index.ts` | Priorizar contexto ativo sobre IA |
| `finax-worker/intents/expense.ts` | Vincular cartão e fatura em gastos crédito |
| `finax-worker/intents/card.ts` | getOrCreateInvoice, updateCardLimit com fatura |
| `verify-otp/index.ts` | Popular auth_id no login |
| `src/hooks/useTransacoes.ts` | Filtrar por auth_id vinculado |
| `src/hooks/useCartoes.ts` | Filtrar por auth_id vinculado |
| `src/hooks/useFaturas.ts` | Buscar faturas_cartao reais |

---

## Priorização de Implementação

| Fase | Descrição | Impacto | Tempo |
|------|-----------|---------|-------|
| **1** | Priorizar contexto ativo (MÓDULO 1) | Corrige 70% dos bugs | 45 min |
| **2** | Vincular crédito a cartão/fatura (MÓDULO 2) | Dá sentido aos cartões | 60 min |
| **3** | Confirmação antes de salvar (MÓDULO 3) | Elimina registros incorretos | 30 min |
| **4** | Vincular site ↔ WhatsApp (MÓDULO 4) | Site mostra dados reais | 45 min |
| **5** | Ciclo de faturas automático (MÓDULO 5) | Automatiza cartões | 60 min |

**Total estimado:** ~4 horas de implementação focada

---

## Resultado Esperado

### Antes (Hoje)
| Comando | Resultado |
|---------|-----------|
| "Registrar cartão Bradesco limite 2000" | "R$ 2000 - gasto ou entrada?" |
| "Conta de água vence dia 10" | "R$ 10/mês como você paga?" |
| "50 no crédito" | Registra sem vincular cartão |
| Site: ver transações | Não mostra dados do WhatsApp |

### Depois (Com Correções)
| Comando | Resultado |
|---------|-----------|
| "Registrar cartão Bradesco limite 2000" | "Qual o dia de vencimento?" → "15" → "✅ Cartão cadastrado!" |
| "Conta de água vence dia 10" | "✅ Fatura criada! Vou te lembrar." |
| "50 no crédito" | "Qual cartão?" → "Nubank" → "✅ R$ 50 no Nubank. Limite: R$ 1950" |
| Site: ver transações | Mostra todas as transações do WhatsApp |

---

## Seção Técnica: Detalhe da Implementação

### Módulo 1: Priorização de Contexto

Inserir no início do processamento (~linha 2955 do index.ts):

```typescript
// ========================================================================
// 🔒 PRIORIDADE ABSOLUTA: CONTEXTO ATIVO
// ========================================================================
if (activeAction && activeAction.pending_slot) {
  console.log(`🎯 [CONTEXT-FIRST] Ação ativa: ${activeAction.intent} aguardando ${activeAction.pending_slot}`);
  
  // Interpretar mensagem como resposta ao slot pendente
  const response = await handlePendingSlot(
    userId,
    activeAction,
    conteudoProcessado,
    payload
  );
  
  if (response.handled) {
    return; // Fluxo tratado pelo contexto, não classificar com IA
  }
  
  // Se não foi tratável como slot, usuário quer mudar de assunto
  // Cancelar action atual e prosseguir
  console.log(`🔄 [CONTEXT-FIRST] Mudança de assunto detectada`);
  await closeAction(activeAction.id);
}
```

### Módulo 2: Vincular Crédito

Em `registerExpense`, após determinar `payment_method === "credito"`:

```typescript
if (slots.payment_method === "credito") {
  // Buscar cartões do usuário
  const cards = await listCardsForUser(userId);
  
  if (cards.length === 0) {
    return { 
      success: false, 
      message: "Você não tem cartões cadastrados 💳\n\nQuer adicionar? Diga: \"Adicionar cartão [nome] limite [valor]\"" 
    };
  }
  
  let selectedCard;
  if (cards.length === 1) {
    selectedCard = cards[0];
  } else if (slots.card_id) {
    selectedCard = cards.find(c => c.id === slots.card_id);
  } else if (slots.card) {
    selectedCard = await findCard(userId, slots.card);
  }
  
  if (!selectedCard) {
    // Perguntar qual cartão (retornar para slot collection)
    return {
      success: false,
      missingSlot: "card",
      message: `💳 Qual cartão?\n\n${cards.map((c, i) => `${i + 1}. ${c.nome}`).join("\n")}`
    };
  }
  
  // Buscar/criar fatura do mês
  const invoice = await getOrCreateInvoice(userId, selectedCard.id);
  
  // Atualizar transação
  slots.cartao_id = selectedCard.id;
  slots.fatura_id = invoice.id;
  
  // Atualizar limite disponível
  await updateCardLimit(selectedCard.id, selectedCard.limite_disponivel - slots.amount);
  
  // Atualizar valor da fatura
  await updateInvoiceTotal(invoice.id, invoice.valor_total + slots.amount);
}
```

### Módulo 4: Auth ID

Migração SQL:
```sql
ALTER TABLE usuarios ADD COLUMN auth_id uuid REFERENCES auth.users(id);
CREATE UNIQUE INDEX idx_usuarios_auth_id ON usuarios(auth_id);
```

Em `verify-otp/index.ts`:
```typescript
// Após validar OTP e criar sessão...
const { data: usuario } = await supabase
  .from("usuarios")
  .select("id")
  .eq("phone_number", phoneE164)
  .single();

if (usuario) {
  await supabase
    .from("usuarios")
    .update({ auth_id: session.user.id })
    .eq("id", usuario.id);
}
```

Em hooks do site:
```typescript
// useTransacoes.ts
const fetchTransacoes = async () => {
  // Buscar usuario_id pelo auth_id
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("id")
    .eq("auth_id", user?.id)
    .single();
    
  if (!usuario) return;
  
  const { data } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", usuario.id);
};
```

PRINCÍPIO FUNDAMENTAL

O Finax operará sob uma Máquina de Estados Finitos (FSM) por usuário.

Regras de Ouro

Cada usuário possui NO MÁXIMO 1 action ativa

Toda mensagem é interpretada no contexto do estado atual

Nenhum dado financeiro é salvo sem confirmação explícita

Nenhuma action pode “sumir” sem fechamento

MODELO CANÔNICO DE ACTION (FSM)
Estados possíveis (action.status)
idle                (nenhuma action ativa)
collecting          (coletando slots)
awaiting_confirmation (resumo apresentado, aguardando sim/não)
executing           (registro no banco)
completed           (finalizada com sucesso)
cancelled           (cancelada pelo usuário)
expired             (timeout)

Campos obrigatórios
id
user_id
intent
status
pending_slot
slots (jsonb)
started_at
updated_at

MÓDULO 1 — PRIORIDADE ABSOLUTA AO CONTEXTO ATIVO
Fluxo de processamento (OBRIGATÓRIO)
1. Receber mensagem
2. Buscar action ativa do usuário
3. SE action.status IN (collecting, awaiting_confirmation):
     → tratar mensagem COMO resposta
     → NÃO chamar IA
4. SE NÃO houver action ativa:
     → classificar intenção com IA

Regra Crítica

IA NUNCA roda enquanto houver pending_slot.

MÓDULO 2 — SISTEMA DE CONFIRMAÇÃO FINAL (OBRIGATÓRIO)

Antes de salvar QUALQUER coisa:

Resumo claro
↓
Estado: awaiting_confirmation
↓
Usuário responde:
  - "sim" → executar
  - "não" / "cancelar" → cancelar
  - outro → repetir pergunta


Nenhuma exceção.

MÓDULO 3 — CRÉDITO REAL (CARTÃO + FATURA + LIMITE)
Ao detectar pagamento = crédito

Resolver cartão:

0 cartões → oferecer cadastro

1 cartão → selecionar automaticamente

1 cartões → perguntar qual

Resolver fatura:

Buscar fatura aberta do mês

Se não existir → criar

Registrar impacto:

Associar transação ao cartão

Associar à fatura

Reduzir limite disponível

Atualizar total da fatura

MÓDULO 3.1 — CRÉDITO PARCELADO (OBRIGATÓRIO)
Exemplo: “1200 em 12x no crédito”

Criar transação mãe

Gerar parcelas (installments)

Cada parcela:

vinculada à fatura do mês correto

status independente

Limite é reduzido pelo TOTAL no ato

Faturas futuras já “sabem” das parcelas

Sem isso, o sistema quebra no médio prazo.

MÓDULO 4 — CICLO DE VIDA DAS FATURAS (AUTOMÁTICO)
Estados de fatura
aberta → fechada → paga | atrasada

Automação CRON

Criar fatura no primeiro uso do mês

Fechar no dia_fechamento

Alertar 7/3/1 dias antes do vencimento

Restaurar limite ao pagar

MÓDULO 5 — VINCULAÇÃO SITE ↔ WHATSAPP
Solução oficial

usuarios.auth_id

Preenchido no login OTP

Frontend filtra sempre via auth_id → usuarios.id

Sem isso, o site nunca será confiável.

MÓDULO 6 — MEDIA ANALYSIS INTEGRADA

OCR e áudio:

NÃO registram dados

Alimentam slots da action

Sempre passam por confirmação
