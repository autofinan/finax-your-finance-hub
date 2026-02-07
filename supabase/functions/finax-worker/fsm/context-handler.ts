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
// 🎯 HANDLER PRINCIPAL DE CONTEXTO ATIVO
// ============================================================================

export async function handleActiveContext(
  userId: string,
  activeAction: ActiveActionLocal,
  message: string,
  _phoneNumber?: string // Opcional para compatibilidade
): Promise<ContextHandlerResult> {
  // Normalizar mensagem
  const normalizedMessage = message.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  
  console.log(`🔒 [FSM] Contexto ativo: ${activeAction.intent} | pending_slot: ${activeAction.pending_slot} | status: ${activeAction.status}`);
  
  // ========================================================================
  // 1. VERIFICAR SE USUÁRIO QUER CANCELAR O FLUXO
  // ========================================================================
  if (isCancelIntent(normalizedMessage)) {
    return {
      handled: true,
      shouldContinue: false,
      shouldCancel: true,
      cancelled: true,
      action: "cancelled",
      message: "👍 Ok, cancelado!"
    };
  }
  
  // ========================================================================
  // 2. STATUS: AWAITING_CONFIRMATION → processar sim/não
  // ========================================================================
  if (activeAction.status === "awaiting_confirmation") {
    const result = handleConfirmation(normalizedMessage);
    return { ...result, action: result.readyToExecute ? "confirmed" : "awaiting" };
  }
  
  // ========================================================================
  // 3. STATUS: COLLECTING → preencher slot pendente
  // ========================================================================
  if (activeAction.pending_slot) {
    const result = fillPendingSlot(activeAction, message, normalizedMessage);
    return { ...result, action: result.filledSlot ? `filled_${result.filledSlot}` : undefined };
  }
  
  // ========================================================================
  // 4. SEM SLOT PENDENTE → mudança de assunto
  // ========================================================================
  console.log(`🔄 [FSM] Sem slot pendente - possível mudança de assunto`);
  return {
    handled: false,
    shouldContinue: true,
    shouldCancel: true // Cancelar action atual para permitir novo fluxo
  };
}

// ============================================================================
// 🚫 DETECTAR INTENÇÃO DE CANCELAMENTO
// ============================================================================

function isCancelIntent(normalized: string): boolean {
  const cancelWords = [
    "cancela", "cancelar", "esquece", "nao quero", "não quero",
    "deixa pra la", "deixa pra lá", "para", "parar", "desiste"
  ];
  return cancelWords.some(word => normalized.includes(word));
}

// ============================================================================
// ✅ PROCESSAR CONFIRMAÇÃO (sim/não)
// ============================================================================

function handleConfirmation(normalized: string): ContextHandlerResult {
  const positiveWords = ["sim", "s", "yes", "confirma", "confirmar", "isso", "certeza", "ok", "certo"];
  const negativeWords = ["nao", "não", "n", "no", "cancela", "cancelar", "errado"];
  
  const isPositive = positiveWords.some(word => normalized === word || normalized.startsWith(word + " "));
  const isNegative = negativeWords.some(word => normalized === word || normalized.startsWith(word + " "));
  
  if (isPositive) {
    return {
      handled: true,
      shouldContinue: false,
      readyToExecute: true,
      message: undefined // Executor vai gerar mensagem de sucesso
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
  
  // Resposta ambígua → pedir novamente
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
      const selectedIndex = parseInt(numMatch[1]) - 1; // 1-indexed
      
      if (selectedIndex >= 0 && selectedIndex < options.length) {
        const selectedId = options[selectedIndex];
        console.log(`✅ [FSM] Seleção numérica: índice ${selectedIndex + 1} → ID ${selectedId}`);
        
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
          readyToExecute: true // Seleção completa → executar
        };
      } else {
        return {
          handled: true,
          shouldContinue: false,
          message: `Número inválido. Escolha entre 1 e ${options.length} 👆`
        };
      }
    }
    
    // Não é número válido para seleção
    return {
      handled: true,
      shouldContinue: false,
      message: `Responde com o número da opção 👆`
    };
  }
  
  // ========================================================================
  // 🔢 CASO ESPECIAL: Seleção de cartão por número
  // ========================================================================
  if (pendingSlot === "card") {
    // Verificar se o usuário enviou um número (seleção de lista)
    const numMatch = rawMessage.trim().match(/^(\d+)$/);
    
    if (numMatch) {
      const cardOptions = activeAction.slots.card_options as Array<{ id: string; nome: string }> | undefined;
      
      if (cardOptions && cardOptions.length > 0) {
        const selectedIndex = parseInt(numMatch[1]) - 1; // 1-indexed
        
        if (selectedIndex >= 0 && selectedIndex < cardOptions.length) {
          const selectedCard = cardOptions[selectedIndex];
          console.log(`✅ [FSM] Cartão selecionado por número: ${selectedIndex + 1} → ${selectedCard.nome}`);
          
          return {
            handled: true,
            shouldContinue: false,
            filledSlot: "card",
            slotValue: selectedCard.nome,
            updatedSlots: {
              ...activeAction.slots,
              card: selectedCard.nome,
              card_id: selectedCard.id
            },
            readyToConfirm: true, // Cartão é geralmente o último slot
            readyToExecute: false // Precisa confirmar ainda
          };
        } else {
          return {
            handled: true,
            shouldContinue: false,
            message: `Número inválido. Escolha entre 1 e ${cardOptions.length} 💳`
          };
        }
      }
      
      // Não tem lista de opções mas usuário enviou número
      // Esse caso não deveria acontecer, mas trata gracefully
      return {
        handled: true,
        shouldContinue: false,
        message: `Qual o nome do cartão? (ex: Nubank, Inter...) 💳`
      };
    }
    
    // Não é número → continuar com extração normal (nome do cartão)
  }
  
  // Tentar extrair valor baseado no tipo de slot
  const extractedValue = extractSlotValue(rawMessage, normalized, pendingSlot);
  
  if (extractedValue === null) {
    console.log(`❌ [FSM] Não conseguiu extrair valor para slot "${pendingSlot}"`);
    return {
      handled: true,
      shouldContinue: false,
      message: getSlotErrorMessage(pendingSlot)
    };
  }
  
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
    readyToConfirm: missingSlots.length === 0,
    readyToExecute: missingSlots.length === 0 // Executa direto quando completo
  };
}

// ============================================================================
// 🔧 EXTRAÇÃO DE VALOR POR TIPO DE SLOT
// ============================================================================

function extractSlotValue(rawMessage: string, normalized: string, slotType: string): any {
  switch (slotType) {
    // Valores numéricos
    case "amount":
    case "value":
    case "limit":
    case "estimated_value":
      const numMatch = rawMessage.match(/(\d+[.,]?\d*)/);
      if (numMatch) {
        return parseFloat(numMatch[1].replace(",", "."));
      }
      return null;
    
    // Dia do mês (1-31)
    case "due_day":
    case "day_of_month":
    case "closing_day":
      const dayMatch = rawMessage.match(/(\d{1,2})/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1]);
        if (day >= 1 && day <= 31) return day;
      }
      return null;
    
    // Forma de pagamento
    case "payment_method":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("debito") || normalized.includes("débito")) return "debito";
      if (normalized.includes("credito") || normalized.includes("crédito") || 
          normalized.includes("cartao") || normalized.includes("cartão")) return "credito";
      if (normalized.includes("dinheiro") || normalized.includes("cash")) return "dinheiro";
      return null;
    
    // Fonte de entrada
    case "source":
      if (normalized.includes("pix")) return "pix";
      if (normalized.includes("dinheiro")) return "dinheiro";
      if (normalized.includes("transfer")) return "transferencia";
      if (normalized.includes("salario") || normalized.includes("salário")) return "salario";
      return normalized.trim() || null;
    
    // Textos livres
    case "description":
    case "card_name":
    case "bill_name":
    case "card":
      if (rawMessage.trim().length > 0) {
        // Remover números para nomes de cartão/conta
        if (slotType === "card_name" || slotType === "bill_name") {
          const cleaned = rawMessage.replace(/\d+/g, "").trim();
          return cleaned.length > 0 ? cleaned : rawMessage.trim();
        }
        return rawMessage.trim();
      }
      return null;
    
    // Periodicidade
    case "periodicity":
    case "recurrence_type":
      if (normalized.includes("diario") || normalized.includes("diária") || normalized.includes("dia")) return "diaria";
      if (normalized.includes("semana")) return "semanal";
      if (normalized.includes("mes") || normalized.includes("mês") || normalized.includes("mensal")) return "mensal";
      if (normalized.includes("ano") || normalized.includes("anual")) return "anual";
      return "mensal"; // Default
    
    default:
      // Para outros slots, aceitar qualquer texto
      return rawMessage.trim() || null;
  }
}

// ============================================================================
// ❌ MENSAGENS DE ERRO POR SLOT
// ============================================================================

function getSlotErrorMessage(slotType: string): string {
  const errorMessages: Record<string, string> = {
    amount: "Não entendi o valor 🤔\n\nManda só o número (ex: 50 ou 150,90)",
    value: "Qual o valor? Manda só o número 💰",
    limit: "Qual o limite? Manda só o número 💰",
    payment_method: "Não entendi a forma de pagamento.\n\nÉ *pix*, *débito*, *crédito* ou *dinheiro*?",
    due_day: "Qual o dia do vencimento? (1 a 31)",
    closing_day: "Qual o dia de fechamento? (1 a 31)",
    description: "Manda uma descrição curta 📝",
    card_name: "Qual o nome do cartão? (ex: Nubank, Inter...)",
    bill_name: "Qual o nome da conta? (ex: Luz, Internet...)",
  };
  
  return errorMessages[slotType] || `Qual o ${slotType}?`;
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
          "debito": "💳 Débito",
          "credito": "💳 Crédito",
          "dinheiro": "💵 Dinheiro"
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
      if (slots.due_day) message += `📅 Vence dia ${slots.due_day}\n`;
      if (slots.estimated_value) message += `💰 ~R$ ${slots.estimated_value.toFixed(2)}\n`;
      break;
    
    case "recurring":
      message = `*Confirmar recorrente:*\n\n`;
      message += `🔄 ${slots.description}\n`;
      message += `💸 R$ ${slots.amount?.toFixed(2)}/mês\n`;
      if (slots.payment_method) message += `💳 ${slots.payment_method}\n`;
      if (slots.day_of_month) message += `📅 Todo dia ${slots.day_of_month}\n`;
      break;
    
    default:
      message = `*Confirmar:*\n\n${JSON.stringify(slots, null, 2)}`;
  }
  
  message += `\n✅ *Tudo certo?*`;
  
  return message;
}

// ============================================================================
// 🔄 ATUALIZAR ACTION PARA CONFIRMAÇÃO
// ============================================================================

export async function setActionAwaitingConfirmation(
  actionId: string,
  updatedSlots: ExtractedSlots
): Promise<void> {
  const { data: existing } = await supabase
    .from("actions")
    .select("meta")
    .eq("id", actionId)
    .single();
  
  const meta = { ...(existing?.meta as Record<string, any>) };
  meta.pending_slot = null; // Limpar slot pendente
  
  await supabase
    .from("actions")
    .update({
      status: "awaiting_confirmation",
      slots: updatedSlots,
      meta,
      updated_at: new Date().toISOString()
    })
    .eq("id", actionId);
  
  console.log(`✅ [FSM] Action ${actionId.slice(-8)} → awaiting_confirmation`);
}

// ============================================================================
// 📝 OBTER PRÓXIMO SLOT FALTANTE
// ============================================================================

export function getNextMissingSlot(intent: string, slots: ExtractedSlots): string | null {
  const requirements = SLOT_REQUIREMENTS[intent as keyof typeof SLOT_REQUIREMENTS];
  if (!requirements) return null;
  
  for (const required of requirements.required) {
    if (!slots[required]) {
      return required;
    }
  }
  
  return null;
}

// ============================================================================
// 📝 OBTER PROMPT PARA SLOT
// ============================================================================

export function getSlotPrompt(slotType: string): { text: string; buttons?: Array<{ id: string; title: string }> } {
  const prompts: Record<string, { text: string; buttons?: Array<{ id: string; title: string }> }> = {
    amount: { text: "Qual foi o valor? 💸" },
    payment_method: { 
      text: "Como você pagou?",
      buttons: [
        { id: "pay_pix", title: "📱 Pix" },
        { id: "pay_debito", title: "💳 Débito" },
        { id: "pay_credito", title: "💳 Crédito" }
      ]
    },
    description: { text: "O que foi essa compra?" },
    source: { text: "De onde veio esse dinheiro?" },
    card_name: { text: "Qual o nome do cartão? (ex: Nubank, Inter...)" },
    limit: { text: "Qual o limite total? 💰" },
    due_day: { text: "Qual o dia de vencimento? (1-31)" },
    closing_day: { text: "Qual o dia de fechamento?" },
    bill_name: { text: "Qual o nome da conta? (ex: Luz, Internet...)" },
    estimated_value: { text: "Qual o valor estimado? (pode aproximar)" }
  };
  
  return prompts[slotType] || { text: `Qual o ${slotType}?` };
}
