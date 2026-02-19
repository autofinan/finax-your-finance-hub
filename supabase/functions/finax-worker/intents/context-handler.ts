// ============================================================================
// 📍 CONTEXT HANDLER - Extraído de index.ts para modularização
// ============================================================================
// getActiveContext, createUserContext, closeUserContext, linkTransactionToContext
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface ExtractedSlots {
  label?: string;
  description?: string;
  date_range?: { start: string; end: string };
  start_date?: string;
  end_date?: string;
  [key: string]: any;
}

// ============================================================================
// 🔍 BUSCAR CONTEXTO ATIVO
// ============================================================================

export async function getActiveContext(userId: string): Promise<any | null> {
  const now = new Date().toISOString();
  
  const { data } = await supabase
    .from("user_contexts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("start_date", now)
    .gte("end_date", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  return data || null;
}

// ============================================================================
// ✨ CRIAR CONTEXTO (Viagem/Evento)
// ============================================================================

export async function createUserContext(userId: string, slots: ExtractedSlots): Promise<{ success: boolean; message: string; contextId?: string }> {
  const label = slots.label || "Evento";
  const description = slots.description || null;
  const CURRENT_YEAR = new Date().getFullYear();
  
  let startDate = new Date();
  let endDate = new Date();
  endDate.setDate(endDate.getDate() + 7);
  
  // ✅ BUG #6 FIX: Parse robusto de datas BR e ISO
  const parseSmartDate = (str: string): Date => {
    if (!str) return new Date();
    const trimmed = str.trim();
    
    // Formato ISO: "2026-02-18" ou "2026-02-18T00:00:00Z"
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]), 0, 0, 0, 0);
    }
    
    // Formato BR: "18/02", "18/02/2026", "18/02/26"
    const brMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (brMatch) {
      const day = parseInt(brMatch[1]);
      const month = parseInt(brMatch[2]) - 1;
      let year = brMatch[3] ? parseInt(brMatch[3]) : CURRENT_YEAR;
      if (year < 100) year = 2000 + year;
      return new Date(year, month, day, 0, 0, 0, 0);
    }
    
    // Fallback: tentar parse nativo
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };
  
  if (slots.date_range) {
    startDate = parseSmartDate(slots.date_range.start);
    endDate = parseSmartDate(slots.date_range.end);
    
    if (endDate <= startDate) {
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    }
  } else if (slots.start_date && slots.end_date) {
    startDate = parseSmartDate(slots.start_date);
    endDate = parseSmartDate(slots.end_date);
  }
  
  console.log(`📍 [CONTEXT] Datas parsed: ${startDate.toISOString()} → ${endDate.toISOString()}`);
  
  console.log(`📍 [CONTEXT] Criando: ${label} de ${startDate.toISOString()} até ${endDate.toISOString()}`);
  
  const { data: context, error } = await supabase.from("user_contexts").insert({
    user_id: userId,
    label,
    description,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    status: "active",
    auto_tag: true
  }).select("id").single();
  
  if (error) {
    console.error("❌ [CONTEXT] Erro:", error);
    return { success: false, message: "Não consegui criar o contexto 😕" };
  }
  
  const startFormatted = startDate.toLocaleDateString("pt-BR");
  const endFormatted = endDate.toLocaleDateString("pt-BR");
  const diasRestantes = Math.ceil((endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    success: true,
    contextId: context.id,
    message: `📍 *Modo Contexto Ativado!*\n\n🏷️ *${label}*\n📅 ${startFormatted} até ${endFormatted}\n⏰ ${diasRestantes} dias\n\n✅ _Todos os seus gastos serão marcados como parte de "${label}" automaticamente!_\n\n_Quando terminar, mande "terminei a viagem" ou "fim do evento"_`
  };
}

// ============================================================================
// ✅ FECHAR CONTEXTO
// ============================================================================

export async function closeUserContext(userId: string): Promise<{ success: boolean; message: string }> {
  const activeContext = await getActiveContext(userId);
  
  if (!activeContext) {
    return { success: false, message: "Você não tem nenhum evento ativo no momento 🤔" };
  }
  
  await supabase.from("user_contexts").update({ 
    status: "completed",
    end_date: new Date().toISOString()
  }).eq("id", activeContext.id);
  
  return {
    success: true,
    message: `✅ *Evento "${activeContext.label}" encerrado!*\n\n📊 Total gasto: R$ ${(activeContext.total_spent || 0).toFixed(2)}\n🧾 ${activeContext.transaction_count || 0} transações\n\n_Voltando ao modo normal!_`
  };
}

// ============================================================================
// 🔗 VINCULAR TRANSAÇÃO AO CONTEXTO ATIVO
// ============================================================================

export async function linkTransactionToContext(userId: string, transactionId: string): Promise<void> {
  const activeContext = await getActiveContext(userId);
  
  if (activeContext && activeContext.auto_tag) {
    await supabase.from("transacoes").update({ context_id: activeContext.id }).eq("id", transactionId);
    console.log(`📍 [CONTEXT] Transação ${transactionId.slice(-8)} vinculada ao contexto ${activeContext.label}`);
  }
}
