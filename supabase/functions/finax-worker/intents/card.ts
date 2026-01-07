// ============================================================================
// 💳 INTENT: CARD (Eventos de Cartão)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots } from "../decision/types.ts";
import { normalizeText } from "../decision/engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📋 LISTAR CARTÕES
// ============================================================================

export async function listCards(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from("cartoes_credito")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true);
  
  return data || [];
}

// ============================================================================
// 🔍 ENCONTRAR CARTÃO POR NOME (FUZZY)
// ============================================================================

export async function findCard(userId: string, cardName: string): Promise<any | null> {
  const cards = await listCards(userId);
  const nameLower = normalizeText(cardName);
  
  return cards.find(c => 
    normalizeText(c.nome || "").includes(nameLower) ||
    nameLower.includes(normalizeText(c.nome || ""))
  ) || null;
}

// ============================================================================
// 🔄 ATUALIZAR LIMITE
// ============================================================================

export interface CardUpdateResult {
  success: boolean;
  message: string;
  cardId?: string;
}

export async function updateCardLimit(
  userId: string,
  slots: ExtractedSlots
): Promise<CardUpdateResult> {
  console.log(`💳 [CARD] Atualizando limite: ${JSON.stringify(slots)}`);
  
  // Verificar se temos o nome do cartão
  if (!slots.card) {
    const cards = await listCards(userId);
    
    if (cards.length === 0) {
      return {
        success: false,
        message: "Você não tem cartões cadastrados 💳\n\nPra adicionar: \"Adicionar cartão Nubank limite 5000\""
      };
    }
    
    if (cards.length === 1) {
      // Apenas um cartão, usar ele
      slots.card = cards[0].id;
    } else {
      // Múltiplos cartões, precisa perguntar
      return {
        success: false,
        message: `Qual cartão?\n\n${cards.map((c, i) => `${i + 1}. ${c.nome}`).join("\n")}\n\n_Responde com o número_`
      };
    }
  }
  
  // Verificar se temos o valor do limite
  if (!slots.value && !slots.amount) {
    return {
      success: false,
      message: "Qual o novo valor do limite? 💰"
    };
  }
  
  const newLimit = slots.value || slots.amount;
  
  // Encontrar o cartão
  let card;
  
  // Se slots.card é um UUID, buscar diretamente
  if (slots.card && slots.card.length === 36) {
    const { data } = await supabase
      .from("cartoes_credito")
      .select("*")
      .eq("id", slots.card)
      .single();
    card = data;
  } else {
    // Buscar por nome
    card = await findCard(userId, slots.card || "");
  }
  
  if (!card) {
    return {
      success: false,
      message: "Não encontrei esse cartão 🤔\n\nDiga \"ver cartões\" pra ver os cadastrados."
    };
  }
  
  // Atualizar limite
  const { error } = await supabase
    .from("cartoes_credito")
    .update({ 
      limite_total: newLimit, 
      limite_disponivel: newLimit 
    })
    .eq("id", card.id);
  
  if (error) {
    console.error("❌ [CARD] Erro ao atualizar:", error);
    return {
      success: false,
      message: "Ops, algo deu errado 😕"
    };
  }
  
  // Log
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "atualizar_cartao",
    entity_type: "cartao",
    entity_id: card.id,
    old_data: { limite_total: card.limite_total },
    new_data: { limite_total: newLimit }
  });
  
  console.log(`✅ [CARD] Limite atualizado: ${card.nome} → R$ ${newLimit}`);
  
  return {
    success: true,
    message: `✅ Limite do *${card.nome}* atualizado para *R$ ${newLimit?.toFixed(2)}*`,
    cardId: card.id
  };
}

// ============================================================================
// 👀 VER CARTÕES
// ============================================================================

export async function viewCards(userId: string): Promise<string> {
  const cards = await listCards(userId);
  
  if (cards.length === 0) {
    return "Você não tem cartões cadastrados 💳\n\nPra adicionar: \"Adicionar cartão Nubank limite 5000\"";
  }
  
  const list = cards.map(c => 
    `💳 *${c.nome}*\n   Limite: R$ ${c.limite_total?.toFixed(2) || "não informado"}\n   Venc: dia ${c.dia_vencimento || "?"}`
  ).join("\n\n");
  
  return `Seus cartões:\n\n${list}`;
}
