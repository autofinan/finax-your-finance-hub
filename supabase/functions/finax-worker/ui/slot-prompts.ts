// ============================================================================
// 📜 SLOT PROMPTS, REQUIREMENTS & ALIASES
// ============================================================================
// Extraído de index.ts para modularização.
// Fonte única de verdade para contratos de slot e prompts de coleta.
// ============================================================================

// ============================================================================
// 📜 CONTRATOS DE SLOT (FONTE ÚNICA DE VERDADE)
// ============================================================================
// Cada intenção tem slots OBRIGATÓRIOS e opcionais.
// Execução direta SÓ acontece quando TODOS os obrigatórios estão preenchidos.
// Perguntas SÓ são feitas para slots obrigatórios faltantes.
// ============================================================================

export type ActionType = "expense" | "income" | "card_event" | "add_card" | "bill" | "pay_bill" | "cancel" | "query" | "query_alerts" | "control" | "recurring" | "set_context" | "set_budget" | "chat" | "edit" | "goal" | "list_goals" | "add_goal_progress" | "installment" | "purchase" | "unknown";

export const SLOT_REQUIREMENTS: Record<string, { required: string[]; optional: string[] }> = {
  expense: { required: ["amount", "payment_method"], optional: ["description", "category", "card", "card_id"] },
  income: { required: ["amount", "source"], optional: ["description"] },
  card_event: { required: ["card", "value"], optional: ["field"] },
  add_card: { required: ["card_name", "limit"], optional: ["due_day", "closing_day"] },
  bill: { required: ["bill_name", "due_day"], optional: ["estimated_value"] },
  pay_bill: { required: ["bill_name", "amount"], optional: [] },
  cancel: { required: [], optional: ["transaction_id"] },
  query: { required: [], optional: [] },
  control: { required: [], optional: [] },
  recurring: { required: ["amount", "description", "payment_method"], optional: ["day_of_month", "category", "periodicity", "card", "card_id"] },
  installment: { required: ["amount", "installments"], optional: ["description", "card", "card_id", "category"] },
  set_context: { required: ["label", "start_date", "end_date"], optional: ["description"] },
  chat: { required: [], optional: [] },
  edit: { required: [], optional: ["transaction_id", "field", "new_value"] },
  goal: { required: ["amount", "description"], optional: ["deadline", "category"] },
  purchase: { required: ["amount"], optional: ["description", "category"] },
  set_budget: { required: ["amount"], optional: ["category"] },
  unknown: { required: [], optional: [] },
};

// ============================================================================
// ✅ hasAllRequiredSlots - FUNÇÃO CANÔNICA
// ============================================================================

export function hasAllRequiredSlots(actionType: ActionType, slots: Record<string, any>): boolean {
  const requirements = SLOT_REQUIREMENTS[actionType];
  if (!requirements) return true;
  
  for (const required of requirements.required) {
    const value = slots[required];
    if (value === null || value === undefined || value === "") {
      return false;
    }
  }
  return true;
}

export function getMissingSlots(actionType: ActionType, slots: Record<string, any>): string[] {
  const requirements = SLOT_REQUIREMENTS[actionType];
  if (!requirements) return [];
  return requirements.required.filter(slot => {
    const value = slots[slot];
    return value === null || value === undefined || value === "";
  });
}

// ============================================================================
// 💬 SLOT PROMPTS
// ============================================================================

export const SLOT_PROMPTS: Record<string, { text: string; useButtons?: boolean; buttons?: Array<{ id: string; title: string }> }> = {
  amount: { text: "Qual foi o valor? 💸" },
  amount_income: { text: "Qual foi o valor que entrou? 💰" },
  description: { text: "O que foi essa compra?" },
  description_income: { text: "De onde veio esse dinheiro?" },
  source: { 
    text: "Como você recebeu?", 
    useButtons: true, 
    buttons: [
      { id: "src_pix", title: "📱 Pix" },
      { id: "src_dinheiro", title: "💵 Dinheiro" },
      { id: "src_transf", title: "🏦 Transferência" },
      { id: "src_deposito", title: "💳 Depósito" }
    ]
  },
  payment_method: { 
    text: "Como você pagou?", 
    useButtons: true,
    buttons: [
      { id: "pay_pix", title: "📱 Pix" },
      { id: "pay_debito", title: "💳 Débito" },
      { id: "pay_credito", title: "💳 Crédito" }
    ]
  },
  card: { text: "Qual cartão?" },
  card_name: { text: "Qual o nome do cartão? (ex: Nubank, Inter, Bradesco...)" },
  limit: { text: "Qual o limite total? 💰" },
  due_day: { text: "Qual o dia de vencimento? (1-31)" },
  closing_day: { text: "Qual o dia de fechamento?" },
  bill_name: { text: "Qual o nome da conta? (ex: Energia, Internet, Água...)" },
  estimated_value: { text: "Qual o valor estimado? (opcional)" },
};

// ============================================================================
// 🔄 ALIASES DE PAGAMENTO E FONTE
// ============================================================================

export const PAYMENT_ALIASES: Record<string, string> = {
  "pix": "pix", "débito": "debito", "debito": "debito", 
  "crédito": "credito", "credito": "credito", "cartão": "credito",
  "dinheiro": "dinheiro", "cash": "dinheiro",
  "pay_pix": "pix", "pay_debito": "debito", "pay_credito": "credito", "pay_dinheiro": "dinheiro"
};

export const SOURCE_ALIASES: Record<string, string> = {
  "pix": "pix", "dinheiro": "dinheiro", "transferencia": "transferencia",
  "salario": "salario", "deposito": "deposito",
  "src_pix": "pix", "src_dinheiro": "dinheiro", "src_transf": "transferencia",
  "src_deposito": "deposito", "src_salario": "salario"
};
