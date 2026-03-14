// ============================================================================
// 🔒 FSM CONTEXT HANDLER - PRIORIDADE ABSOLUTA AO CONTEXTO ATIVO
// ============================================================================
// Implementa Máquina de Estados Finitos onde o contexto ativo tem prioridade
// sobre qualquer nova classificação IA.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots, SLOT_REQUIREMENTS } from "../decision/types.ts";

// Interface local mais flexível para compatibilidade
interface ActiveActionLocal {
  id: string;
  user_id: string;
  type: string;
  intent: string;
  slots: Record<string, any>;
  status: string;
  pending_slot?: string | null;
  pending_selection_id?: string | null;
  origin_message_id?: string | null;
  last_message_id?: string | null;
  meta?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📋 TIPOS DE RESPOSTA
// ============================================================================

export interface ContextHandlerResult {
  handled: boolean;                    // Se o contexto tratou a mensagem
  shouldContinue: boolean;             // Se deve continuar para IA
  shouldCancel?: boolean;              // Se deve cancelar action atual
  action?: string;                     // Ação executada
  filledSlot?: string;                 // Qual slot foi preenchido
  slotValue?: any;                     // Valor do slot
  updatedSlots?: ExtractedSlots;       // Slots atualizados
  readyToExecute?: boolean;            // Todos os slots obrigatórios preenchidos
  readyToConfirm?: boolean;            // Pronto para pedir confirmação
  cancelled?: boolean;                 // Usuário cancelou
  message?: string;                    // Mensagem para enviar ao usuário
}

// ============================================================================
// 🚫 DETECTAR INTENÇÃO DE CANCELAMENTO (AMPLIADO)
// ============================================================================

const CANCEL_WORDS = [
  "cancela", "cancelar", "esquece", "nao quero", "não quero",
  "deixa pra la", "deixa pra lá", "para", "parar", "desiste",
  "tchau", "nenhuma", "nenhum", "sair", "depois", "nao sei",
  "não sei", "deixa", "esquece isso", "volta", "desisto"
];

function isCancelIntent(normalized: string): boolean {
  return CANCEL_WORDS.some(word => normalized.includes(word));
}

// ============================================================================
// 🔄 DETECTAR MUDANÇA DE ASSUNTO
// ============================================================================

const SUBJECT_CHANGE_KEYWORDS = [
  "orcamento", "orçamento", "meta", "divida", "dívida", "resumo",
  "cartao", "cartão", "gasto", "entrada", "parcelamento", "parcelar",
  "recorrente", "ajuda", "cancelar assinatura", "registrar",
  "quanto gastei", "quanto tenho", "relatorio", "relatório",
  "fatura", "conta", "salario", "salário", "renda",
  "definir limite", "definir gasto", "viagem", "evento"
];

function isSubjectChange(normalized: string, currentIntent: string): boolean {
  // Só detectar mudança se a mensagem tem conteúdo semântico (2+ palavras ou keyword clara)
  const words = normalized.split(/\s+/).filter(w => w.length > 1);
  
  for (const keyword of SUBJECT_CHANGE_KEYWORDS) {
    if (normalized.includes(keyword)) {
      // Não considerar mudança se a keyword é do mesmo intent
      const sameIntentKeywords: Record<string, string[]> = {
        expense: ["gasto", "gastei"],
        income: ["entrada", "renda", "salario", "salário"],
        set_budget: ["orcamento", "orçamento", "limite", "definir limite", "definir gasto"],
        goal: ["meta"],
        debt: ["divida", "dívida"],
        recurring: ["recorrente"],
        installment: ["parcelamento", "parcelar"],
        add_card: ["cartao", "cartão"],
      };
      
      const currentKeywords = sameIntentKeywords[currentIntent] || [];
      if (currentKeywords.some(k => keyword.includes(k) || k.includes(keyword))) {
        continue; // Mesma intenção, não é mudança
      }
      
      console.log(`🔄 [FSM] Mudança de assunto detectada: "${keyword}" (intent atual: ${currentIntent})`);
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// 💳 EXTRAIR FORMA DE PAGAMENTO DO TEXTO (para correções mid-flow)
// ============================================================================

function extractPaymentFromText(normalized: string): string | null {
  if (normalized.includes("pix")) return "pix";
  if (normalized.includes("debito") || normalized.includes("débito") || normalized.includes("debit")) return "debito";
  if (normalized.includes("dinheiro") || normalized.includes("cash")) return "dinheiro";
  if (normalized.includes("credito") || normalized.includes("crédito") || 
      normalized.includes("cartao") || normalized.includes("cartão")) return "credito";
  return null;
}

// ============================================================================
// 🔢 RETRY TRACKER (in-memory por action)
// ============================================================================

const retryCounters = new Map<string, number>();

function getRetryCount(actionId: string): number {
  return retryCounters.get(actionId) || 0;
}

function incrementRetry(actionId: string): number {
  const count = getRetryCount(actionId) + 1;
  retryCounters.set(actionId, count);
  return count;
}

function resetRetry(actionId: string): void {
  retryCounters.delete(actionId);
}

const MAX_RETRIES = 2;

// ============================================================================
// 🎯 HANDLER PRINCIPAL DE CONTEXTO ATIVO
// ============================================================================

export async function handleActiveContext(
  userId: string,
  activeAction: ActiveActionLocal,
  message: string,
  _phoneNumber?: string
): Promise<ContextHandlerResult> {
  const normalizedMessage = message.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  
  console.log(`🔒 [FSM] Contexto ativo: ${activeAction.intent} | pending_slot: ${activeAction.pending_slot} | status: ${activeAction.status}`);
  
  // ========================================================================
  // 1. VERIFICAR SE USUÁRIO QUER CANCELAR O FLUXO
  // ========================================================================
  if (isCancelIntent(normalizedMessage)) {
    resetRetry(activeAction.id);
    return {
      handled: true,
      shouldContinue: false,
      shouldCancel: true,
      cancelled: true,
      action: "cancelled",
      message: "👍 Ok, sem problemas! Me chama quando precisar 😊"
    };
  }
  
  // ========================================================================
  // 2. VERIFICAR MUDANÇA DE ASSUNTO (ANTES de processar slot)
  // ========================================================================
  if (activeAction.pending_slot && isSubjectChange(normalizedMessage, activeAction.intent)) {
    resetRetry(activeAction.id);
    return {
      handled: false,
      shouldContinue: true,
      shouldCancel: true,
      action: "subject_change",
      message: undefined
    };
  }
  
  // ========================================================================
  // 2.5 DETECTAR CONVERSA/CHAT QUANDO SLOT PENDENTE (Bug #7)
  // Se o usuário manda mensagem longa sem números e sem relação com o slot,
  // liberar o contexto e processar como nova mensagem (chat/query)
  // ========================================================================
  if (activeAction.pending_slot) {
    const words = normalizedMessage.split(/\s+/).filter(w => w.length > 1);
    const hasNumbers = /\d/.test(normalizedMessage);
    const pendingSlotType = activeAction.pending_slot;
    
    // Se esperando número (amount/value) mas recebeu texto longo sem números
    const isWaitingForNumber = ["amount", "value", "limit", "estimated_value"].includes(pendingSlotType);
    const isLikelyChatMessage = words.length >= 5 && !hasNumbers;
    
    // Verificar se parece conversa/conselho (verbos de chat)
    const chatIndicators = ["cara", "to", "tou", "estou", "gastando", "muito", "demais",
      "como", "dica", "ajuda", "preciso", "quero", "conselho", "economizar",
      "o que", "por que", "porque", "sera", "posso", "devo", "vale"];
    const hasChatIndicator = chatIndicators.some(w => normalizedMessage.includes(w));
    
    if (isWaitingForNumber && isLikelyChatMessage && hasChatIndicator) {
      console.log(`🔀 [FSM] Conversa detectada durante slot "${pendingSlotType}" → liberando contexto`);
      resetRetry(activeAction.id);
      return {
        handled: false,
        shouldContinue: true,
        shouldCancel: true,
        action: "subject_change_chat",
        message: undefined
      };
    }
  }
  
  // ========================================================================
  // 3. STATUS: AWAITING_CONFIRMATION → processar sim/não
  // ========================================================================
  if (activeAction.status === "awaiting_confirmation") {
    const result = handleConfirmation(normalizedMessage);
    return { ...result, action: result.readyToExecute ? "confirmed" : "awaiting" };
  }
  
  // ========================================================================
  // 4. STATUS: COLLECTING → preencher slot pendente
  // ========================================================================
  if (activeAction.pending_slot) {
    const result = fillPendingSlot(activeAction, message, normalizedMessage);
    return { ...result, action: result.filledSlot ? `filled_${result.filledSlot}` : undefined };
  }
  
  // ========================================================================
  // 5. SEM SLOT PENDENTE → mudança de assunto
  // ========================================================================
  console.log(`🔄 [FSM] Sem slot pendente - possível mudança de assunto`);
  return {
    handled: false,
    shouldContinue: true,
    shouldCancel: true
  };
}

// ============================================================================
// ✅ PROCESSAR CONFIRMAÇÃO (sim/não)
// ============================================================================

function handleConfirmation(normalized: string): ContextHandlerResult {
  const positiveWords = ["sim", "s", "yes", "confirma", "confirmar", "isso", "certeza", "ok", "certo", "sjm", "simmm", "siin", "si", "sii", "simm", "sím"];
  const negativeWords = ["nao", "não", "n", "no", "cancela", "cancelar", "errado"];
  
  const isPositive = positiveWords.some(word => normalized === word || normalized.startsWith(word + " "));
  const isNegative = negativeWords.some(word => normalized === word || normalized.startsWith(word + " "));
  
  if (isPositive) {
    return {
      handled: true,
      shouldContinue: false,
      readyToExecute: true,
      message: undefined
    };
  }
  
  if (isNegative) {
    return {
      handled: true,
      shouldContinue: false,
      cancelled: true,
      message: "👍 Cancelado! Se quiser registrar de novo, é só mandar."
    };
  }
  
  return {
    handled: true,
    shouldContinue: false,
    message: "Responde *sim* ou *não* 👆"
  };
}

// ============================================================================
// 📥 PREENCHER SLOT PENDENTE
// ============================================================================

function fillPendingSlot(
  activeAction: ActiveActionLocal,
  rawMessage: string,
  normalized: string
): ContextHandlerResult {
  const pendingSlot = activeAction.pending_slot!;
  const intent = activeAction.intent;
  
  console.log(`📥 [FSM] Preenchendo slot "${pendingSlot}" para "${intent}"`);
  
  // ========================================================================
  // 🔢 CASO ESPECIAL: Seleção de lista (selection)
  // ========================================================================
  if (pendingSlot === "selection") {
    const options = activeAction.slots.options as string[] | undefined;
    
    // Verificar se é um número para seleção de lista
    const numMatch = rawMessage.trim().match(/^(\d+)$/);
    if (numMatch && options) {
      const selectedIndex = parseInt(numMatch[1]) - 1;
      
      if (selectedIndex >= 0 && selectedIndex < options.length) {
        const selectedId = options[selectedIndex];
        console.log(`✅ [FSM] Seleção numérica: índice ${selectedIndex + 1} → ID ${selectedId}`);
        resetRetry(activeAction.id);
        
        return {
          handled: true,
          shouldContinue: false,
          filledSlot: "selection",
          slotValue: selectedId,
          updatedSlots: {
            ...activeAction.slots,
            selected_id: selectedId,
            selection_index: selectedIndex
          },
          readyToExecute: true
        };
      } else {
        return {
          handled: true,
          shouldContinue: false,
          message: `Número inválido. Escolha entre 1 e ${options.length} 👆`
        };
      }
    }
    
    // Não é número → verificar retry limit
    const retryCount = incrementRetry(activeAction.id);
    
    if (retryCount >= MAX_RETRIES) {
      console.log(`❌ [FSM] Limite de tentativas atingido para selection`);
      resetRetry(activeAction.id);
      return {
        handled: true,
        shouldContinue: false,
        shouldCancel: true,
        cancelled: true,
        message: "Sem problema, vou liberar você! Me chama quando quiser continuar 😊"
      };
    }
    
    // Variar mensagem de retry
    const retryMessages = [
      "Hmm, não entendi 🤔 Manda o *número* da opção que você quer.",
      "Tenta mandar só o número (1, 2, 3...) da opção desejada 👆"
    ];
    
    return {
      handled: true,
      shouldContinue: false,
      message: retryMessages[Math.min(retryCount - 1, retryMessages.length - 1)]
    };
  }
  
  // ========================================================================
  // 🔢 CASO ESPECIAL: Seleção de cartão por número
  // ========================================================================
  if (pendingSlot === "card") {
    // ========================================================================
    // 🔧 FIX CRÍTICO: Se o usuário mencionou pagamento NÃO-crédito,
    // sobrescrever payment_method e pular seleção de cartão
    // Ex: "Comprei no Pix" enquanto esperava seleção de cartão
    // ========================================================================
    const paymentOverride = extractPaymentFromText(normalized);
    if (paymentOverride && paymentOverride !== "credito") {
      console.log(`🔧 [FSM] Usuário corrigiu pagamento para "${paymentOverride}" durante seleção de cartão`);
      resetRetry(activeAction.id);
      
      const updatedSlots: ExtractedSlots = {
        ...activeAction.slots,
        payment_method: paymentOverride as ExtractedSlots["payment_method"],
      };
      // Remover slots de cartão inválidos
      delete updatedSlots.card;
      delete updatedSlots.card_id;
      delete updatedSlots.card_options;
      delete updatedSlots._inferred_payment_from_pattern;
      
      // Verificar se todos os slots obrigatórios estão preenchidos
      const requirements = SLOT_REQUIREMENTS["expense"];
      const missingSlots: string[] = [];
      if (requirements) {
        for (const required of requirements.required) {
          const value = updatedSlots[required];
          if (!value || (required === "payment_method" && ["unknown", "outro"].includes(String(value).toLowerCase()))) {
            missingSlots.push(required);
          }
        }
      }
      
      return {
        handled: true,
        shouldContinue: false,
        filledSlot: "payment_method",
        slotValue: paymentOverride,
        updatedSlots,
        readyToExecute: missingSlots.length === 0,
      };
    }
    
    const numMatch = rawMessage.trim().match(/^(\d+)$/);
    
    if (numMatch) {
      const cardOptions = activeAction.slots.card_options as Array<{ id: string; nome: string }> | undefined;
      
      if (cardOptions && cardOptions.length > 0) {
        const selectedIndex = parseInt(numMatch[1]) - 1;
        
        if (selectedIndex >= 0 && selectedIndex < cardOptions.length) {
          const selectedCard = cardOptions[selectedIndex];
          console.log(`✅ [FSM] Cartão selecionado por número: ${selectedIndex + 1} → ${selectedCard.nome}`);
          resetRetry(activeAction.id);
          
          return {
            handled: true,
            shouldContinue: false,
            filledSlot: "card",
            slotValue: selectedCard.nome,
            readyToExecute: true,
            readyToConfirm: false,
            updatedSlots: {
              ...activeAction.slots,
              card: selectedCard.nome,
              card_id: selectedCard.id
            }
          };
        } else {
          return {
            handled: true,
            shouldContinue: false,
            message: `Número inválido. Escolha entre 1 e ${cardOptions.length} 💳`
          };
        }
      }
      
      return {
        handled: true,
        shouldContinue: false,
        message: `Qual o nome do cartão? (ex: Nubank, Inter...) 💳`
      };
    }
  }
  
  // Tentar extrair valor baseado no tipo de slot
  const extractedValue = extractSlotValue(rawMessage, normalized, pendingSlot);
  
  if (extractedValue === null) {
    console.log(`❌ [FSM] Não conseguiu extrair valor para slot "${pendingSlot}"`);
    
    // Retry com limite
    const retryCount = incrementRetry(activeAction.id);
    
    if (retryCount >= MAX_RETRIES) {
      console.log(`❌ [FSM] Limite de tentativas atingido para ${pendingSlot}`);
      resetRetry(activeAction.id);
      return {
        handled: true,
        shouldContinue: false,
        shouldCancel: true,
        cancelled: true,
        message: "Tá difícil entender 😅 Vou liberar você, depois a gente tenta de novo!"
      };
    }
    
    return {
      handled: true,
      shouldContinue: false,
      message: getSlotRetryMessage(pendingSlot, retryCount)
    };
  }
  
  // Slot coletado com sucesso → reset retry
  resetRetry(activeAction.id);
  
  // Merge com slots existentes
  const updatedSlots: ExtractedSlots = {
    ...activeAction.slots,
    [pendingSlot]: extractedValue
  };
  
  // Verificar se tem todos os slots obrigatórios
  const requirements = SLOT_REQUIREMENTS[intent as keyof typeof SLOT_REQUIREMENTS];
  const missingSlots: string[] = [];
  
  if (requirements) {
    for (const required of requirements.required) {
      if (!updatedSlots[required]) {
        missingSlots.push(required);
      }
    }
  }
  
  console.log(`📊 [FSM] Slots após preenchimento: ${JSON.stringify(updatedSlots)}`);
  console.log(`📊 [FSM] Slots faltando: ${missingSlots.join(", ") || "nenhum"}`);
  
  return {
    handled: true,
    shouldContinue: false,
    filledSlot: pendingSlot,
    slotValue: extractedValue,
    updatedSlots,
    readyToConfirm: false,
    readyToExecute: missingSlots.length === 0
  };
}

// ============================================================================
// 🔧 EXTRAÇÃO DE VALOR POR TIPO DE SLOT
// ============================================================================

function extractSlotValue(rawMessage: string, normalized: string, slotType: string): any {
  switch (slotType) {
    case "amount":
    case "value":
    case "limit":
    case "estimated_value":
      const numMatch = rawMessage.match(/(\d+[.,]?\d*)/);
      if (numMatch) {
        return parseFloat(numMatch[1].replace(",", "."));
      }
      return null;
    
    case "due_day":
    case "day_of_month":
    case "closing_day": {
      const dayMatch = rawMessage.match(/(\d{1,2})/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1]);
        if (day >= 1 && day <= 31) return day;
      }
      return null;
    }

    case "installments": {
      const installmentMatch = normalized.match(/(\d{1,2})\s*(x|vezes|parcela|parcelas)?/i) || rawMessage.match(/(\d{1,2})/);
      if (!installmentMatch) return null;

      const count = parseInt(installmentMatch[1], 10);
      if (Number.isNaN(count) || count < 2 || count > 72) return null;
      return count;
    }
    
    case "type_choice": {
      const expenseWords = ["gasto", "despesa", "saida", "saída", "expense", "1"];
      const incomeWords = ["entrada", "receita", "renda", "income", "2"];
      if (expenseWords.some(w => normalized.includes(w))) return "expense";
      if (incomeWords.some(w => normalized.includes(w))) return "income";
      return null;
    }
    
    case "payment_method":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("debito") || normalized.includes("débito") || normalized.includes("debit")) return "debito";
      if (normalized.includes("credito") || normalized.includes("crédito") || 
          normalized.includes("cartao") || normalized.includes("cartão")) return "credito";
      if (normalized.includes("dinheiro") || normalized.includes("cash")) return "dinheiro";
      return null;
    
    case "source":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("dinheiro")) return "dinheiro";
      if (normalized.includes("transfer")) return "transferencia";
      if (normalized.includes("salario") || normalized.includes("salário")) return "salario";
      return normalized.trim() || null;
    
    case "description":
    case "card_name":
    case "bill_name":
    case "card":
      if (rawMessage.trim().length > 0) {
        if (slotType === "card_name" || slotType === "bill_name") {
          const cleaned = rawMessage.replace(/\d+/g, "").trim();
          return cleaned.length > 0 ? cleaned : rawMessage.trim();
        }
        return rawMessage.trim();
      }
      return null;
    
    case "periodicity":
    case "recurrence_type":
      if (normalized.includes("diario") || normalized.includes("diária") || normalized.includes("dia")) return "diaria";
      if (normalized.includes("semana")) return "semanal";
      if (normalized.includes("mes") || normalized.includes("mês") || normalized.includes("mensal")) return "mensal";
      if (normalized.includes("ano") || normalized.includes("anual")) return "anual";
      return "mensal";
    
    default:
      return rawMessage.trim() || null;
  }
}

// ============================================================================
// ❌ MENSAGENS DE RETRY POR SLOT (variadas, não repetitivas)
// ============================================================================

function getSlotRetryMessage(slotType: string, retryCount: number): string {
  const retryMessages: Record<string, string[]> = {
    amount: [
      "Não entendi o valor 🤔 Manda só o número (ex: 50 ou 150,90)",
      "Qual foi o valor? Manda assim: 50 ou 150,90"
    ],
    value: [
      "Qual o valor? Manda só o número 💰",
      "Tenta assim: 300 ou 1500,00"
    ],
    limit: [
      "Qual o limite? Manda só o número 💰",
      "Exemplo: 2000 ou 3500,00"
    ],
    installments: [
      "Em quantas vezes? (ex: 3x, 12x)",
      "Manda só o número de parcelas (ex: 2, 6, 10)"
    ],
    payment_method: [
      "Como você pagou? *Pix*, *débito*, *crédito* ou *dinheiro*?",
      "Foi pix, cartão ou dinheiro? Pode escrever!"
    ],
    due_day: [
      "Qual o dia do vencimento? (1 a 31)",
      "Me diz o dia (ex: 10, 15, 25...)"
    ],
    closing_day: [
      "Qual o dia de fechamento? (1 a 31)",
      "Me manda o dia do fechamento (ex: 5, 10...)"
    ],
    description: [
      "Manda uma descrição curta 📝",
      "O que foi? Tipo: mercado, uber, farmácia..."
    ],
    card_name: [
      "Qual o nome do cartão? (ex: Nubank, Inter...)",
      "Me diz o nome do cartão 💳"
    ],
    bill_name: [
      "Qual o nome da conta? (ex: Luz, Internet...)",
      "Qual conta é essa?"
    ],
    type_choice: [
      "É *gasto* ou *entrada*? 🤔",
      "Isso foi uma despesa ou um dinheiro que entrou?"
    ],
  };
  
  const messages = retryMessages[slotType] || ["Não entendi 🤔 Pode reformular?", "Tenta de novo de outra forma?"];
  return messages[Math.min(retryCount - 1, messages.length - 1)];
}

// ============================================================================
// 📝 GERAR MENSAGEM DE CONFIRMAÇÃO
// ============================================================================

export function generateConfirmationMessage(
  intent: string,
  slots: ExtractedSlots
): string {
  let message = "";
  
  switch (intent) {
    case "expense":
      message = `*Confirmar gasto:*\n\n`;
      message += `💸 R$ ${slots.amount?.toFixed(2)}\n`;
      if (slots.description) message += `📝 ${slots.description}\n`;
      if (slots.payment_method) {
        const paymentEmoji: Record<string, string> = {
          "pix": "📱 Pix",
          "dinheiro": "💵 Dinheiro",
          "credito": "💳 Crédito",
          "debito": "💳 Débito"
        };
        message += `${paymentEmoji[slots.payment_method] || slots.payment_method}\n`;
      }
      if (slots.card) message += `💳 ${slots.card}\n`;
      break;
    
    case "income":
      message = `*Confirmar entrada:*\n\n`;
      message += `💰 R$ ${slots.amount?.toFixed(2)}\n`;
      if (slots.description) message += `📝 ${slots.description}\n`;
      if (slots.source) message += `📥 ${slots.source}\n`;
      break;
    
    case "add_card":
      message = `*Confirmar cartão:*\n\n`;
      message += `💳 ${slots.card_name || slots.card}\n`;
      message += `💰 Limite: R$ ${(slots.limit || slots.amount)?.toFixed(2)}\n`;
      if (slots.due_day) message += `📅 Vencimento: dia ${slots.due_day}\n`;
      if (slots.closing_day) message += `📅 Fechamento: dia ${slots.closing_day}\n`;
      break;
    
    case "bill":
      message = `*Confirmar fatura:*\n\n`;
      message += `📄 ${slots.bill_name || slots.description}\n`;
      if (slots.due_day) message += `📅 Vencimento: dia ${slots.due_day}\n`;
      if (slots.estimated_value) message += `💰 Valor estimado: R$ ${slots.estimated_value.toFixed(2)}\n`;
      break;
    
    case "recurring":
      message = `*Confirmar gasto recorrente:*\n\n`;
      message += `📝 ${slots.description}\n`;
      message += `💸 R$ ${slots.amount?.toFixed(2)}\n`;
      break;
    
    case "installment":
      message = `*Confirmar parcelamento:*\n\n`;
      message += `📝 ${slots.description}\n`;
      if (slots.amount) message += `💸 Total: R$ ${slots.amount?.toFixed(2)}\n`;
      if (slots.installments) message += `🔢 ${slots.installments}x\n`;
      break;
    
    default:
      message = `*Confirmar ${intent}?*\n\n`;
      for (const [key, value] of Object.entries(slots)) {
        if (value !== undefined && value !== null) {
          message += `${key}: ${value}\n`;
        }
      }
  }
  
  message += `\n*Confirma?*`;
  return message;
}

// ============================================================================
// 🔄 SETAR STATUS AWAITING_CONFIRMATION
// ============================================================================

export async function setActionAwaitingConfirmation(
  actionId: string,
  slots: ExtractedSlots
): Promise<void> {
  const { data: existing } = await supabase.from("actions").select("meta").eq("id", actionId).single();
  const meta = { ...(existing?.meta as Record<string, any> || {}) };
  meta.pending_slot = null;
  
  await supabase.from("actions").update({
    status: "awaiting_confirmation",
    slots,
    meta,
    updated_at: new Date().toISOString()
  }).eq("id", actionId);
  
  console.log(`⏳ [ACTION] Aguardando confirmação: ${actionId.slice(-8)}`);
}

// ============================================================================
// 🔍 VERIFICAR PRÓXIMO SLOT FALTANDO
// ============================================================================

export function getNextMissingSlot(intent: string, slots: ExtractedSlots): string | null {
  const requirements = SLOT_REQUIREMENTS[intent as keyof typeof SLOT_REQUIREMENTS];
  if (!requirements) return null;
  
  const INVALID_PAYMENT_VALUES = ["unknown", "outro", "desconhecido", "none", "null", "undefined"];
  
  for (const required of requirements.required) {
    const value = slots[required];
    if (!value) return required;
    
    if (required === "payment_method" && typeof value === "string" && 
        INVALID_PAYMENT_VALUES.includes(value.toLowerCase())) {
      return required;
    }
  }
  
  return null;
}

// ============================================================================
// 💬 GERAR PROMPT PARA SLOT
// ============================================================================

export function getSlotPrompt(slotType: string): { text: string; buttons?: Array<{ id: string; title: string }> } {
  if (!slotType) {
    return {
      text: "Como você pagou?",
      buttons: [
        { id: "pay_pix", title: "📱 Pix" },
        { id: "pay_dinheiro", title: "💵 Dinheiro" },
        { id: "pay_credito", title: "💳 Crédito" }
      ]
    };
  }
  
  const prompts: Record<string, { text: string; buttons?: Array<{ id: string; title: string }> }> = {
    amount: { text: "Qual foi o valor? 💰" },
    value: { text: "Qual o valor? 💰" },
    limit: { text: "Qual o limite do cartão? 💰" },
    installments: { text: "Em quantas vezes? (ex: 2x, 6x, 12x)" },
    description: { text: "O que você comprou? 📝" },
    payment_method: {
      text: "Como você pagou?",
      buttons: [
        { id: "pay_pix", title: "📱 Pix" },
        { id: "pay_dinheiro", title: "💵 Dinheiro" },
        { id: "pay_credito", title: "💳 Crédito" }
      ]
    },
    source: {
      text: "De onde veio o dinheiro?",
      buttons: [
        { id: "src_pix", title: "📱 Pix" },
        { id: "src_dinheiro", title: "💵 Dinheiro" },
        { id: "src_transf", title: "🏦 Transferência" }
      ]
    },
    due_day: { text: "Qual o dia do vencimento? (1 a 31)" },
    closing_day: { text: "Qual o dia de fechamento? (1 a 31)" },
    card_name: { text: "Qual o nome do cartão? (ex: Nubank, Inter...)" },
    bill_name: { text: "Qual o nome da conta? (ex: Luz, Internet...)" },
    type_choice: {
      text: "Esse valor foi um gasto ou uma entrada?",
      buttons: [
        { id: "num_gasto", title: "💸 Gasto" },
        { id: "num_entrada", title: "💰 Entrada" }
      ]
    }
  };
  
  return prompts[slotType] || { text: `Qual o ${slotType}?` };
}
