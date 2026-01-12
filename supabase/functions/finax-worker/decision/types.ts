// ============================================================================
// 🏭 FINAX - TYPES & CONTRACTS
// ============================================================================

export type MessageSource = "meta" | "vonage";
export type TipoMidia = "text" | "audio" | "image";

// ============================================================================
// 🎯 ACTION TYPES - CONTRATO GLOBAL
// ============================================================================

export type ActionType = 
  | "expense"       // gasto
  | "income"        // entrada
  | "card_event"    // cartão (limite, nome, etc)
  | "cancel"        // cancelamento
  | "query"         // consulta
  | "query_alerts"  // consulta de alertas proativos
  | "control"       // meta-comando (cancelar, deixa pra lá)
  | "recurring"     // gasto recorrente
  | "set_context"   // definir contexto (viagem, evento)
  | "edit"          // edição/correção rápida
  | "chat"          // conversa livre
  | "goal"          // metas de economia (criar, atualizar, consultar)
  | "purchase_advice" // assistente de compras contextual
  | "unknown";      // não identificado

// Mapeamento interno para compatibilidade
export type InternalActionType = "slot_filling" | "cancel_selection" | "card_update" | "batch_confirm" | "duplicate_confirm";

// ============================================================================
// 📦 INTERFACES
// ============================================================================

export interface JobPayload {
  phoneNumber: string;
  messageText: string;
  messageType: TipoMidia;
  messageId: string;
  mediaId: string | null;
  mediaMimeType: string;
  messageSource: MessageSource;
  nomeContato: string | null;
  evento_id: string | null;
  buttonReplyId: string | null;
  replyToMessageId?: string | null;
}

export interface ExtractedSlots {
  amount?: number;
  description?: string;
  category?: string;
  payment_method?: "pix" | "dinheiro" | "debito" | "credito";
  source?: "pix" | "dinheiro" | "transferencia";
  card?: string;
  installments?: number;
  recurrence_type?: "mensal" | "semanal" | "anual";
  [key: string]: any;
}

export interface DecisionInput {
  message: string;
  userId: string;
  messageId: string;
  context: {
    hasActiveAction: boolean;
    activeActionType?: string;
    activeActionIntent?: string;
    activeActionSlots?: Record<string, any>;
    pendingSlot?: string | null;
  };
  history?: string;
}

export interface DecisionOutput {
  actionType: ActionType;
  confidence: number;
  reasoning: string;
  slots: ExtractedSlots;
  missingSlots: string[];
  shouldExecute: boolean;
  shouldAsk: boolean;
  question: string | null;
  buttons: Array<{ id: string; title: string }> | null;
}

export interface ActiveAction {
  id: string;
  user_id: string;
  type: InternalActionType;
  intent: string;
  slots: Record<string, any>;
  status: string;
  pending_slot?: string | null;
  pending_selection_id?: string | null;
  origin_message_id?: string | null;
  last_message_id?: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ============================================================================
// 🎰 SLOT REQUIREMENTS & PROMPTS
// ============================================================================

export const SLOT_REQUIREMENTS: Record<string, { required: string[]; optional: string[] }> = {
  expense: { required: ["amount", "payment_method"], optional: ["description", "category", "card"] },
  income: { required: ["amount"], optional: ["description", "source"] },
  card_event: { required: ["card", "value"], optional: ["field"] },
  add_card: { required: ["card_name", "limit", "due_day"], optional: ["closing_day"] },
  remove_card: { required: ["card"], optional: [] },
  installment: { required: ["amount", "installments", "description"], optional: ["category", "card"] },
  recurring: { required: ["amount", "description", "recurrence_type"], optional: ["category", "day_of_month"] },
  goal: { required: ["goal_name", "target_amount"], optional: ["deadline", "category"] },
  purchase_advice: { required: ["item_description", "item_value"], optional: ["category"] },
};

export const SLOT_PROMPTS: Record<string, { 
  text: string; 
  useButtons?: boolean; 
  buttons?: Array<{ id: string; title: string }> 
}> = {
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
      { id: "src_transf", title: "🏦 Transferência" }
    ]
  },
  category: { text: "Qual categoria?" },
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
  card_name: { text: "Qual o nome do cartão? (Ex: Nubank, C6...)" },
  limit: { text: "Qual o limite total? 💰" },
  due_day: { text: "Qual o dia de vencimento? (1-31)" },
  closing_day: { text: "Qual o dia de fechamento?" },
  field: { text: "O que quer atualizar? (limite, vencimento ou nome)" },
  value: { text: "Qual o novo valor do limite?" },
  installments: { text: "Em quantas vezes?" },
  recurrence_type: { text: "É mensal, semanal ou anual?" },
  goal_name: { text: "Qual o nome da meta?" },
  target_amount: { text: "Qual o valor objetivo?" },
  item_description: { text: "O que você quer comprar?" },
  item_value: { text: "Quanto custa?" },
};

// ============================================================================
// 🔤 ALIASES
// ============================================================================

export const PAYMENT_ALIASES: Record<string, string> = {
  "pix": "pix", 
  "débito": "debito", 
  "debito": "debito", 
  "crédito": "credito", 
  "credito": "credito", 
  "cartão": "credito",
  "dinheiro": "dinheiro", 
  "cash": "dinheiro",
  "pay_pix": "pix", 
  "pay_debito": "debito", 
  "pay_credito": "credito", 
  "pay_dinheiro": "dinheiro"
};

export const SOURCE_ALIASES: Record<string, string> = {
  "pix": "pix", 
  "dinheiro": "dinheiro", 
  "transferencia": "transferencia",
  "src_pix": "pix", 
  "src_dinheiro": "dinheiro", 
  "src_transf": "transferencia"
};
