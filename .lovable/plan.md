
# Plano de Correção Definitivo do Finax - Handlers Faltantes

## 📋 Diagnóstico Confirmado

Baseado na análise profunda dos logs, código e banco de dados, identifiquei **3 problemas estruturais críticos** que explicam porque funcionalidades básicas não funcionam:

### PROBLEMA 1: Handler de `add_card` NÃO EXISTE
**Evidência nos logs:**
```
📊 [DECISION] {"type":"expense","conf":0.95,"slots":{"amount":2000},"canExec":false}
```
- Quando você diz "Registre meu cartão Bradesco crédito limite 2000"
- IA não sabe classificar como `add_card` (não está no prompt!)
- Sistema classifica como `expense` e trata 2000 como valor de gasto

**Causa Raiz:**
1. `add_card` está definido em `SLOT_REQUIREMENTS` (types.ts:111)
2. MAS não está no `PROMPT_FINAX_UNIVERSAL` (index.ts:557-610)
3. E não existe handler `if (decision.actionType === "add_card")` no index.ts

### PROBLEMA 2: Handler de `bill` (Faturas/Contas a Pagar) NÃO EXISTE
**Evidência nos logs:**
```
📊 [DECISION] {"type":"recurring","slots":{"amount":10,"description":"Conta de água"}}
```
- Quando você diz "Minha fatura de água vence dia 10"
- IA confunde com `recurring` por causa de "todo mês"
- Sistema trata como gasto recorrente, não como conta a pagar

**Causa Raiz:**
1. Funções `createBill` e `payBill` existem em `bills.ts`
2. MAS `bill` não está como ActionType válido
3. E não existe handler `if (decision.actionType === "bill")` no index.ts

### PROBLEMA 3: Prompt da IA Incompleto
O `PROMPT_FINAX_UNIVERSAL` não ensina a IA sobre:
- `add_card` - Registrar cartão de crédito
- `bill` - Criar fatura/conta a pagar
- `pay_bill` - Pagar fatura

---

## 🔧 SOLUÇÃO: Implementação de Handlers Faltantes

### Fase 1: Adicionar ActionTypes Faltantes

**Arquivo:** `supabase/functions/finax-worker/index.ts`

**1.1 - Atualizar type ActionType (linha 53):**
```typescript
type ActionType = 
  | "expense" | "income" | "card_event" 
  | "add_card"    // NOVO: Registrar cartão
  | "bill"        // NOVO: Criar fatura/conta a pagar
  | "pay_bill"    // NOVO: Pagar fatura
  | "cancel" | "query" | "query_alerts" | "control" 
  | "recurring" | "set_context" | "chat" | "edit" | "goal" | "unknown";
```

**1.2 - Atualizar SLOT_REQUIREMENTS (linha 123):**
```typescript
const SLOT_REQUIREMENTS = {
  // ... existentes ...
  add_card: { required: ["card_name", "limit"], optional: ["due_day", "closing_day"] },
  bill: { required: ["bill_name", "due_day"], optional: ["estimated_value"] },
  pay_bill: { required: ["bill_name", "amount"], optional: [] },
};
```

**1.3 - Atualizar SLOT_PROMPTS (linha 158):**
```typescript
const SLOT_PROMPTS = {
  // ... existentes ...
  card_name: { text: "Qual o nome do cartão? (ex: Nubank, Inter...)" },
  limit: { text: "Qual o limite total? 💰" },
  due_day: { text: "Qual o dia de vencimento? (1-31)" },
  closing_day: { text: "Qual o dia de fechamento?" },
  bill_name: { text: "Qual o nome da conta? (ex: Energia, Internet...)" },
  estimated_value: { text: "Qual o valor estimado? (opcional)" },
};
```

### Fase 2: Atualizar Prompt da IA

**Arquivo:** `supabase/functions/finax-worker/index.ts` (PROMPT_FINAX_UNIVERSAL ~linha 550-640)

Adicionar novas seções ao prompt:

```text
### add_card - Registrar NOVO cartão de crédito
Exemplos: "Registrar cartão Nubank limite 5000", "Adicionar cartão Bradesco crédito 3000 vencimento dia 15"
- Palavras-chave: registrar cartão, adicionar cartão, novo cartão, cadastrar cartão + nome do banco + limite
- OBRIGATÓRIO: nome do cartão E limite
- Opcional: dia de vencimento

### bill - Criar fatura/conta a pagar (NÃO é recorrente automático!)
Exemplos: "Minha conta de água vence dia 10", "Criar fatura energia dia 15", "Fatura internet todo dia 20"
- Palavras-chave: conta de, fatura, vence dia, vencimento
- É para lembretes de contas variáveis (água, luz, internet)
- NÃO confundir com recurring (Netflix, Spotify - valor fixo)

### pay_bill - Pagar fatura/conta existente
Exemplos: "Paguei a energia, deu 184", "Paguei fatura de água 120"
- Palavras-chave: paguei a fatura, paguei a conta de + nome + valor
```

### Fase 3: Criar Handler de add_card

**Arquivo:** `supabase/functions/finax-worker/intents/card.ts`

Adicionar nova função `createCard`:

```typescript
export interface CreateCardResult {
  success: boolean;
  message: string;
  cardId?: string;
}

export async function createCard(
  userId: string,
  slots: ExtractedSlots
): Promise<CreateCardResult> {
  console.log(`💳 [CARD] Criando cartão: ${JSON.stringify(slots)}`);
  
  const cardName = slots.card_name || slots.card || slots.description;
  const limit = slots.limit || slots.amount || slots.value;
  const dueDay = slots.due_day || slots.day_of_month;
  const closingDay = slots.closing_day;
  
  if (!cardName) {
    return { success: false, message: "Qual o nome do cartão? (ex: Nubank, Inter...)" };
  }
  
  if (!limit) {
    return { success: false, message: `Qual o limite do ${cardName}? 💰` };
  }
  
  // Verificar se já existe
  const existing = await findCard(userId, cardName);
  if (existing) {
    return { 
      success: false, 
      message: `Você já tem um cartão ${existing.nome} cadastrado 💳\n\nQuer atualizar o limite?` 
    };
  }
  
  // Inserir
  const { data, error } = await supabase
    .from("cartoes_credito")
    .insert({
      usuario_id: userId,
      nome: cardName,
      limite_total: limit,
      limite_disponivel: limit,
      dia_vencimento: dueDay,
      dia_fechamento: closingDay,
      ativo: true
    })
    .select("id, nome, limite_total, dia_vencimento")
    .single();
  
  if (error) {
    console.error("❌ [CARD] Erro ao criar:", error);
    return { success: false, message: "Ops, algo deu errado 😕" };
  }
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "criar_cartao",
    entity_type: "cartao",
    entity_id: data.id,
    new_data: { nome: cardName, limite: limit, vencimento: dueDay }
  });
  
  let response = `✅ *Cartão cadastrado!*\n\n`;
  response += `💳 ${data.nome}\n`;
  response += `💰 Limite: R$ ${data.limite_total.toFixed(2)}\n`;
  if (data.dia_vencimento) response += `📅 Vencimento: dia ${data.dia_vencimento}\n`;
  response += `\n_Agora seus gastos no crédito vão descontar desse limite!_`;
  
  return { success: true, message: response, cardId: data.id };
}
```

### Fase 4: Criar Handler no index.ts para add_card

**Arquivo:** `supabase/functions/finax-worker/index.ts` (após handler de card_event ~linha 3210)

```typescript
// ========================================================================
// 💳 ADD_CARD - Registrar NOVO cartão de crédito
// ========================================================================
if (decision.actionType === "add_card") {
  const slots = decision.slots;
  const { createCard } = await import("./intents/card.ts");
  
  // Normalizar slots (IA pode enviar card, card_name ou description)
  const normalizedSlots = {
    ...slots,
    card_name: slots.card_name || slots.card || slots.description,
    limit: slots.limit || slots.amount || slots.value,
    due_day: slots.due_day || slots.day_of_month,
  };
  
  const result = await createCard(userId, normalizedSlots);
  await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
  
  // Se faltou slot, criar action para coletar
  if (!result.success && !result.cardId) {
    const missing = getMissingSlots("add_card", normalizedSlots);
    if (missing.length > 0) {
      await createAction(userId, "add_card", "add_card", normalizedSlots, missing[0], payload.messageId);
    }
  }
  return;
}
```

### Fase 5: Criar Handler no index.ts para bill e pay_bill

**Arquivo:** `supabase/functions/finax-worker/index.ts` (após handler de add_card)

```typescript
// ========================================================================
// 📄 BILL - Criar fatura/conta a pagar
// ========================================================================
if (decision.actionType === "bill") {
  const slots = decision.slots;
  const { createBill } = await import("./intents/bills.ts");
  
  const billName = slots.bill_name || slots.description;
  const dueDay = slots.due_day || slots.day_of_month;
  const estimatedValue = slots.estimated_value || slots.amount;
  
  if (!billName) {
    await sendMessage(payload.phoneNumber, "Qual o nome da conta? (ex: Energia, Internet, Água...)", payload.messageSource);
    await createAction(userId, "bill", "bill", slots, "bill_name", payload.messageId);
    return;
  }
  
  if (!dueDay) {
    await sendMessage(payload.phoneNumber, `Em qual dia do mês vence a conta de *${billName}*?`, payload.messageSource);
    await createAction(userId, "bill", "bill", { ...slots, bill_name: billName }, "due_day", payload.messageId);
    return;
  }
  
  const result = await createBill({
    userId,
    nome: billName,
    diaVencimento: dueDay,
    valorEstimado: estimatedValue,
    tipo: "fixa",
  });
  
  await sendMessage(payload.phoneNumber, result, payload.messageSource);
  return;
}

// ========================================================================
// 💸 PAY_BILL - Pagar fatura existente
// ========================================================================
if (decision.actionType === "pay_bill") {
  const slots = decision.slots;
  const { payBill } = await import("./intents/bills.ts");
  
  const billName = slots.bill_name || slots.description;
  const amount = slots.amount;
  
  if (!billName || !amount) {
    await sendMessage(payload.phoneNumber, "Qual conta você pagou e quanto foi?", payload.messageSource);
    return;
  }
  
  const result = await payBill({
    userId,
    contaNome: billName,
    valorPago: amount,
  });
  
  await sendMessage(payload.phoneNumber, result, payload.messageSource);
  return;
}
```

### Fase 6: Atualizar Classificador Semântico

**Arquivo:** `supabase/functions/finax-worker/decision/engine.ts` (SEMANTIC_PATTERNS ~linha 46)

Adicionar novos padrões:

```typescript
const SEMANTIC_PATTERNS = {
  // ... existentes ...
  
  // ADICIONAR CARTÃO - alta prioridade
  add_card: {
    verbs: ["registrar", "adicionar", "cadastrar", "novo cartão", "criar cartão"],
    contexts: ["cartão", "cartao", "limite", "nubank", "itau", "bradesco", "inter", "c6"],
    weight: 0.95
  },
  
  // FATURA/CONTA A PAGAR - alta prioridade
  bill: {
    verbs: ["conta de", "fatura", "vence dia", "vencimento"],
    contexts: ["água", "luz", "energia", "internet", "gas", "gás", "telefone", "aluguel"],
    weight: 0.92
  },
  
  // PAGAR FATURA
  pay_bill: {
    verbs: ["paguei a conta", "paguei a fatura", "paguei energia", "paguei água"],
    contexts: ["deu", "foi", "ficou"],
    weight: 0.9
  },
};
```

---

## 📊 Resumo das Mudanças

| Arquivo | Mudanças |
|---------|----------|
| `index.ts` | + ActionType `add_card`, `bill`, `pay_bill` |
| `index.ts` | + SLOT_REQUIREMENTS para novos types |
| `index.ts` | + SLOT_PROMPTS para novos slots |
| `index.ts` | + PROMPT_FINAX_UNIVERSAL com novas intenções |
| `index.ts` | + Handler `add_card` (~20 linhas) |
| `index.ts` | + Handler `bill` (~30 linhas) |
| `index.ts` | + Handler `pay_bill` (~20 linhas) |
| `card.ts` | + função `createCard` (~60 linhas) |
| `engine.ts` | + SEMANTIC_PATTERNS para novos types |

---

## ✅ Resultado Esperado Após Correções

| Comando | Antes (Quebrado) | Depois (Correto) |
|---------|------------------|------------------|
| "Registrar cartão Bradesco limite 2000" | "R$ 2000 - gasto ou entrada?" | "✅ Cartão cadastrado! Bradesco, Limite: R$ 2000" |
| "Minha conta de água vence dia 10" | "R$ 10/mês como você paga?" | "✅ Fatura criada! Água, vence dia 10" |
| "Paguei a energia, deu 184" | "Como você pagou?" | "✅ Pagamento registrado! Energia R$ 184" |
| "Adicionar cartão Inter crédito 5000 vencimento 15" | Confusão total | "✅ Cartão cadastrado! Inter, Limite R$ 5000, Venc: 15" |

---

## ⏱️ Estimativa

| Fase | Tempo |
|------|-------|
| Fase 1: ActionTypes e Slots | 10 min |
| Fase 2: Prompt da IA | 10 min |
| Fase 3: createCard | 15 min |
| Fase 4: Handler add_card | 10 min |
| Fase 5: Handlers bill/pay_bill | 15 min |
| Fase 6: SEMANTIC_PATTERNS | 10 min |
| **Total** | **~70 min** |
