// ============================================================================
// 💰 INTENT: INCOME (Registrar Entrada)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots, SLOT_REQUIREMENTS } from "../decision/types.ts";
import { closeAction } from "../context/manager.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📝 REGISTRAR ENTRADA
// ============================================================================

export interface IncomeResult {
  success: boolean;
  message: string;
  transactionId?: string;
}

export async function registerIncome(
  userId: string,
  slots: ExtractedSlots,
  eventoId: string | null,
  actionId?: string
): Promise<IncomeResult> {
  console.log(`💰 [INCOME] Registrando: ${JSON.stringify(slots)}`);
  
  // Verificar slot obrigatório (apenas amount)
  if (!slots.amount) {
    return {
      success: false,
      message: "Falta informar o valor 💰"
    };
  }
  
  // Registrar transação
  const now = new Date();
  
  const { data: transaction, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor: slots.amount,
    categoria: "entrada",
    tipo: "entrada",
    descricao: slots.description || slots.source || "Entrada",
    data: now.toISOString(),
    data_transacao: now.toISOString(),
    hora_transacao: now.toTimeString().slice(0, 5),
    origem: "whatsapp",
    forma_pagamento: slots.source || "outros",
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [INCOME] Erro:", error);
    return {
      success: false,
      message: "Ops, algo deu errado ao registrar 😕"
    };
  }
  
  // Fechar action se existir
  if (actionId) {
    await closeAction(actionId, transaction.id);
  }
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_entrada",
    entity_type: "transacao",
    entity_id: transaction.id,
    new_data: slots
  });
  
  // Formatar resposta amigável
  const formattedDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const formattedTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const sourceEmojiMap: Record<string, string> = {
    pix: "📱",
    dinheiro: "💵",
    transferencia: "🏦"
  };
  const sourceEmoji = sourceEmojiMap[slots.source || ""] || "💰";
  
  const message = `✅ *Entrada registrada!*\n\n` +
    `💰 *+R$ ${slots.amount?.toFixed(2)}*\n` +
    (slots.description ? `📝 ${slots.description}\n` : "") +
    (slots.source ? `${sourceEmoji} ${slots.source}\n` : "") +
    `📅 ${formattedDate} às ${formattedTime}\n\n` +
    `_Mandou errado? Responda "cancelar"!_`;
  
  console.log(`✅ [INCOME] Registrado: ${transaction.id}`);
  
  return {
    success: true,
    message,
    transactionId: transaction.id
  };
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

export function getMissingIncomeSlots(slots: ExtractedSlots): string[] {
  const requirements = SLOT_REQUIREMENTS.income;
  return requirements.required.filter(slot => !slots[slot]);
}
