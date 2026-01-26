// ============================================================================
// 🔒 CONFIRMATION GATE - PORTÃO DE CONFIRMAÇÃO OBRIGATÓRIO
// ============================================================================
// REGRA ABSOLUTA: NENHUMA transação financeira pode ser salva sem passar
// por este portão de confirmação explícita do usuário.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots } from "../decision/types.ts";
import { 
  getNextMissingSlot, 
  generateConfirmationMessage, 
  setActionAwaitingConfirmation 
} from "./context-handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📋 TIPOS
// ============================================================================

export interface ConfirmationGateResult {
  canExecute: boolean;       // true = já confirmado, pode executar
  needsConfirmation: boolean; // true = precisa pedir confirmação
  message?: string;          // Mensagem de confirmação para enviar
  actionId?: string;         // ID da action criada/atualizada
}

export interface ActiveAction {
  id: string;
  user_id: string;
  type: string;
  intent: string;
  slots: Record<string, any>;
  status: string;
  pending_slot?: string | null;
}

// ============================================================================
// 🚪 PORTÃO DE CONFIRMAÇÃO
// ============================================================================
// Verifica se a transação pode ser executada ou precisa de confirmação.
// NUNCA executa diretamente - sempre retorna estado para o caller decidir.
// ============================================================================

export async function requireConfirmation(
  userId: string,
  intent: string,
  slots: ExtractedSlots,
  activeAction?: ActiveAction | null,
  messageId?: string
): Promise<ConfirmationGateResult> {
  console.log(`🔒 [GATE] Verificando confirmação: ${intent}`);
  
  // ========================================================================
  // CASO 1: Action ativa JÁ está em awaiting_confirmation
  // ========================================================================
  if (activeAction?.status === "awaiting_confirmation" && activeAction.intent === intent) {
    console.log(`✅ [GATE] Action ${activeAction.id.slice(-8)} já confirmada - pode executar`);
    return {
      canExecute: true,
      needsConfirmation: false,
      actionId: activeAction.id
    };
  }
  
  // ========================================================================
  // CASO 2: Verificar se ainda falta algum slot obrigatório
  // ========================================================================
  const missingSlot = getNextMissingSlot(intent, slots);
  
  if (missingSlot) {
    console.log(`❌ [GATE] Slot obrigatório faltando: ${missingSlot}`);
    // Não é responsabilidade do gate coletar slots - retorna para o caller
    return {
      canExecute: false,
      needsConfirmation: false
    };
  }
  
  // ========================================================================
  // CASO 3: Todos os slots OK → Criar/Atualizar action para confirmação
  // ========================================================================
  console.log(`🔒 [GATE] Slots completos - solicitando confirmação`);
  
  let actionId: string;
  
  if (activeAction && activeAction.intent === intent) {
    // Atualizar action existente
    await setActionAwaitingConfirmation(activeAction.id, slots);
    actionId = activeAction.id;
  } else {
    // Criar nova action
    const newAction = await createConfirmationAction(userId, intent, slots, messageId);
    actionId = newAction.id;
  }
  
  // Gerar mensagem de confirmação
  const confirmMessage = generateConfirmationMessage(intent, slots);
  
  return {
    canExecute: false,
    needsConfirmation: true,
    message: confirmMessage,
    actionId
  };
}

// ============================================================================
// ✨ CRIAR ACTION PARA CONFIRMAÇÃO
// ============================================================================

async function createConfirmationAction(
  userId: string,
  intent: string,
  slots: ExtractedSlots,
  messageId?: string | null
): Promise<{ id: string }> {
  const actionHash = `action_${userId.slice(0, 8)}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  
  // LOCK: Fechar todas as actions anteriores antes de criar nova
  await supabase
    .from("actions")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("status", ["collecting", "awaiting_input", "pending_selection", "awaiting_confirmation"]);
  
  const { data: newAction, error } = await supabase
    .from("actions")
    .insert({
      user_id: userId,
      action_type: intent,
      action_hash: actionHash,
      status: "awaiting_confirmation",
      slots,
      meta: {
        action_type: intent,
        origin_message_id: messageId,
        expires_at: expiresAt
      }
    })
    .select("id")
    .single();
  
  if (error) {
    console.error("❌ [GATE] Erro ao criar action:", error);
    throw error;
  }
  
  console.log(`✨ [GATE] Action criada: ${newAction.id.slice(-8)} → awaiting_confirmation`);
  
  return newAction;
}

// ============================================================================
// 📋 INTENTS QUE REQUEREM CONFIRMAÇÃO
// ============================================================================

export const INTENTS_REQUIRING_CONFIRMATION = [
  "expense",
  "income",
  "recurring",
  "add_card",
  "bill",
  "pay_bill",
  "installment"
];

export function requiresConfirmation(intent: string): boolean {
  return INTENTS_REQUIRING_CONFIRMATION.includes(intent);
}
