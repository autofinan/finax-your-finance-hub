
# Plano de Correção Completa do Finax

## Diagnóstico dos Problemas Identificados

### Problemas Reportados pelo Usuário

| Teste | Problema | Causa Raiz |
|-------|----------|------------|
| "Cancelar evento" | Mostra recorrentes em vez de cancelar gasto | IA interpreta "cancelar" como cancelar recorrente |
| "4" para selecionar | Mostra JSON bruto + pede confirmação | Contexto de seleção não está tratando números corretamente |
| "Sim" após confirmação | "Não entendi" | Status `awaiting_confirmation` não reconheceu o "sim" |
| "100 no crédito" | Funciona mas pede confirmação desnecessária | Confirmation Gate ativo |
| "Comprei roupa 5x de 77" | Interpreta como 2 gastos separados | Regex de `detectMultipleExpenses` conflita com parcelamento |
| "Roupa 300 em 5x" | Mostra JSON bruto | Contexto de multi_expense ativo, não roteou para installment |
| "Adicionar cartão Bradesco 2000 limite vence dia 16" | Interpreta como gastos | `detectMultipleExpenses` ativou antes da IA classificar |

### Problemas Estruturais

1. **Confirmação Excessiva**: O `confirmation-gate.ts` pede confirmação mesmo para intenções claras
2. **detectMultipleExpenses Agressivo**: Ativa antes da classificação IA, quebrando parcelamentos e cartões
3. **Perda de Contexto em Seleções**: Quando usuário responde "4", o sistema mostra JSON ao invés de executar
4. **Dados do Site Não Vinculados**: Frontend usa `user?.id` (auth.uid) em vez de `usuarioId` do WhatsApp

---

## Solução Proposta

### 1. REMOVER Confirmation Gate para Intenções Claras

**Filosofia**: Só pedir confirmação para imagens e áudios (onde há interpretação). Texto claro executa direto.

**Arquivos afetados**:
- `supabase/functions/finax-worker/index.ts` (linhas 3244-3273, 3313-3385)

**Mudanças**:
```
ANTES (expense com todos os slots):
→ requireConfirmation() → awaiting_confirmation → espera "sim"

DEPOIS (expense com todos os slots):
→ registerExpense() direto → mensagem de sucesso
```

### 2. PROTEGER detectMultipleExpenses

**Problema**: Ativa para "1200 em 12x" e "2000 de limite vence dia 16"

**Solução**: Adicionar guard que verifica padrões de parcelamento/cartão ANTES de detectar múltiplos gastos.

**Arquivo**: `supabase/functions/finax-worker/index.ts` (linhas 3063-3091)

```typescript
// NOVO GUARD
const isInstallmentPattern = /\d+\s*(x|vezes|parcela)/i.test(conteudoProcessado);
const isCardPattern = /(adicionar|registrar|cadastrar|novo)\s*cart[aã]o/i.test(conteudoProcessado);

if (payload.messageType === "text" && !activeAction && !isInstallmentPattern && !isCardPattern) {
  const multipleExpenses = detectMultipleExpenses(conteudoProcessado);
  // ...
}
```

### 3. CORRIGIR Handler de Seleção Numérica

**Problema**: Quando usuário responde "4" em lista de recorrentes, o sistema mostra JSON bruto.

**Causa**: O context-handler não está tratando seleções de lista corretamente.

**Arquivo**: `supabase/functions/finax-worker/fsm/context-handler.ts`

**Mudanças**:
- Adicionar lógica para `pending_slot === "selection"` que interpreta números como índices de lista
- Executar ação correspondente (cancelar recorrente selecionado)

### 4. VINCULAR Dados do Site ao WhatsApp

**Problema**: Frontend usa `user?.id` (auth.uid) que não existe na tabela `transacoes`.

**Solução**: Usar `useUsuarioId()` em todas as páginas.

**Arquivos afetados**:
- `src/pages/Transacoes.tsx` (linha 22)
- `src/pages/Cartoes.tsx` (linhas 31-33)

```typescript
// ANTES
const { user } = useAuth();
const { transacoes } = useTransacoes(user?.id);

// DEPOIS  
const { usuarioId } = useUsuarioId();
const { transacoes } = useTransacoes(usuarioId || undefined);
```

### 5. ATIVAR Funcionalidades Dormentes

#### 5.1 Sistema de Memória (patterns.ts)
**Status**: Código existe, mas `learnMerchantPattern` nunca é chamado.

**Solução**: Adicionar chamada após cada transação bem-sucedida em `registerExpense`.

**Arquivo**: `supabase/functions/finax-worker/intents/expense.ts`

```typescript
// Após registrar transação com sucesso:
await learnMerchantPattern({
  userId,
  description: slots.description,
  category: slots.category || "outros",
  paymentMethod: slots.payment_method,
  transactionId: transaction.id,
  wasUserCorrected: false
});
```

#### 5.2 Sistema de Metas (goals.ts)
**Status**: Código existe e já está roteado no index.ts (linhas 3713-3762).
**Ação**: Já funcional! Testar com "criar meta de 5000 para viagem".

#### 5.3 Alertas Proativos (alerts.ts)
**Status**: Código existe, alertas são salvos mas não consultados.

**Solução**: Ativar chamada de `checkImmediateAlerts` após cada gasto.

**Arquivo**: `supabase/functions/finax-worker/intents/expense.ts`

```typescript
// Após registrar transação:
await checkImmediateAlerts(userId, {
  valor: slots.amount,
  categoria: slots.category || "outros",
  descricao: slots.description || ""
});
```

#### 5.4 Consultor de Compras (purchase.ts)
**Status**: Código existe mas não está roteado no index.ts.

**Solução**: Adicionar intent "purchase" ao prompt da IA e roteamento no index.ts.

**Arquivos**:
- `supabase/functions/finax-worker/index.ts` (prompt + handler)
- Adicionar bloco para `decision.actionType === "purchase"`

#### 5.5 Análise de Mídia Integrada
**Status**: `media_analysis` existe mas cria registros isolados.

**Solução**: Quando OCR/transcrição extrai dados, preencher slots da action ativa em vez de criar nova transação.

**Arquivo**: `supabase/functions/finax-worker/index.ts` (seção de imagem/áudio)

---

## Resumo de Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `finax-worker/index.ts` | Remover confirmação para texto, proteger detectMultipleExpenses, ativar purchase |
| `finax-worker/fsm/context-handler.ts` | Corrigir handler de seleção numérica |
| `finax-worker/intents/expense.ts` | Chamar `learnMerchantPattern` e `checkImmediateAlerts` |
| `src/pages/Transacoes.tsx` | Usar `useUsuarioId()` |
| `src/pages/Cartoes.tsx` | Usar `useUsuarioId()` |

---

## Testes de Validação

Após implementação, testar os cenários que falharam:

| Cenário | Resultado Esperado |
|---------|-------------------|
| "Gastei 50 no mercado" + "Débito" | Registra direto sem pedir confirmação |
| "Roupa 300 em 5x" | Abre fluxo de parcelamento (pede cartão) |
| "Adicionar cartão Bradesco 2000 limite vence dia 16" | Cria cartão Bradesco com limite 2000 |
| Selecionar "4" em lista de recorrentes | Cancela o Spotify |
| "criar meta de 5000 para viagem" | Cria meta |
| "vale a pena comprar um celular de 2000?" | Análise de compra com contexto financeiro |

---

## Detalhes Técnicos

### Remoção do Confirmation Gate

No bloco de EXPENSE (linhas ~3300-3385), substituir:

```typescript
// REMOVER ESTE BLOCO:
const { requireConfirmation } = await import("./fsm/confirmation-gate.ts");
const gateResult = await requireConfirmation(...);
if (gateResult.canExecute) { ... }
// Precisa confirmar → enviar mensagem de confirmação

// SUBSTITUIR POR EXECUÇÃO DIRETA:
const result = await registerExpense(userId, slots as any, undefined);
await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
return;
```

Mesma mudança para INCOME (linhas ~3239-3273).

### Guard para detectMultipleExpenses

```typescript
// Antes da linha 3063
const INSTALLMENT_PATTERN = /\d+\s*(x|vezes|parcelas?)\s*(de\s*\d+)?/i;
const CARD_PATTERN = /(adicionar|registrar|cadastrar|novo|meu)\s*cart[aã]o/i;
const BILL_PATTERN = /(conta\s+de|fatura|vence\s+dia)/i;

const shouldSkipMultiDetection = 
  INSTALLMENT_PATTERN.test(conteudoProcessado) ||
  CARD_PATTERN.test(conteudoProcessado) ||
  BILL_PATTERN.test(conteudoProcessado);

if (payload.messageType === "text" && !activeAction && !shouldSkipMultiDetection) {
  // ... detectMultipleExpenses logic
}
```

### Correção do Handler de Seleção

Em `context-handler.ts`, adicionar tratamento para `pending_slot === "selection"`:

```typescript
case "selection":
  // Número indica seleção de lista
  const numMatch = rawMessage.match(/^(\d+)$/);
  if (numMatch) {
    const selectedIndex = parseInt(numMatch[1]) - 1; // 1-indexed
    const options = activeAction.slots.options as string[];
    if (options && selectedIndex >= 0 && selectedIndex < options.length) {
      return options[selectedIndex]; // Retorna ID selecionado
    }
  }
  return null;
```

### Ativação do Purchase Intent

Adicionar ao prompt da IA:
```
### purchase - Consulta de compra
Exemplos: "vale a pena comprar X?", "posso gastar X em Y?", "devo comprar?"
- Palavras-chave: vale a pena, posso comprar, devo gastar, consigo comprar
```

Adicionar handler no index.ts:
```typescript
if (decision.actionType === "purchase") {
  const { analyzePurchase } = await import("./intents/purchase.ts");
  const result = await analyzePurchase({
    userId,
    itemDescription: slots.description || "item",
    itemValue: slots.amount || 0,
    category: slots.category
  });
  await sendMessage(payload.phoneNumber, result, payload.messageSource);
  return;
}
```
