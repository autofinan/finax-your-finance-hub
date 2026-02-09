// ============================================================================
// 💰 INTENT: INCOME (Registrar Entrada)
// ============================================================================
// Extraído de index.ts para modularização.
// Contém a lógica completa de registro de entrada (inline do index.ts).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBrasiliaISO } from "../utils/date-helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📝 INTERFACE
// ============================================================================

export interface ExtractedSlotsIncome {
  amount?: number;
  description?: string;
  source?: string;
  transaction_date?: string;
  [key: string]: any;
}

export interface IncomeResult {
  success: boolean;
  message: string;
  transactionId?: string;
}

// ============================================================================
// 💰 REGISTRAR ENTRADA (lógica idêntica ao inline do index.ts)
// ============================================================================

export async function registerIncome(
  userId: string,
  slots: ExtractedSlotsIncome,
  actionId?: string
): Promise<IncomeResult> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  const source = slots.source || "outro";
  
  // ✅ CORREÇÃO DEFINITIVA: Usar getBrasiliaISO() em vez de new Date()
  let dateISO: string;
  let timeString: string;

  if (slots.transaction_date) {
    dateISO = slots.transaction_date;
    timeString = dateISO.substring(11, 16);
    console.log(`📅 [INCOME] Usando transaction_date dos slots: ${dateISO}`);
  } else {
    const result = getBrasiliaISO();
    dateISO = result.dateISO;
    timeString = result.timeString;
    console.log(`📅 [INCOME] Usando hora atual Brasília: ${dateISO}`);
  }

  const { data: tx, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria: "entrada",
    tipo: "entrada",
    descricao,
    data: dateISO,
    data_transacao: dateISO,
    hora_transacao: timeString,
    origem: "whatsapp",
    forma_pagamento: source,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [INCOME] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  // Fechar action se existir
  if (actionId) {
    await supabase.from("actions").update({ 
      status: "done", 
      entity_id: tx.id, 
      updated_at: new Date().toISOString() 
    }).eq("id", actionId);
    console.log(`✅ [ACTION] Fechado: ${actionId.slice(-8)}`);
  }
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_entrada",
    entity_type: "transacao",
    entity_id: tx.id,
    new_data: slots
  });
  
  // ✅ Parsear direto da string ISO (sem Date/Intl)
  const [_dp] = dateISO.split('T');
  const [_yy, _mm, _dd] = _dp.split('-');
  const dataFormatada = `${_dd}/${_mm}/${_yy}`;
  const horaFormatada = dateISO.substring(11, 16);
  
  console.log(`✅ [INCOME] Registrado: ${tx.id}`);
  
  return {
    success: true,
    message: `💰 *Entrada registrada!*\n\n✅ *+R$ ${valor.toFixed(2)}*\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${source}\n📅 ${dataFormatada} às ${horaFormatada}`,
    transactionId: tx.id
  };
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

export function getMissingIncomeSlots(slots: ExtractedSlotsIncome): string[] {
  const required = ["amount"];
  return required.filter(slot => !slots[slot]);
}
