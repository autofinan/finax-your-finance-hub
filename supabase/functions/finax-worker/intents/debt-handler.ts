// ============================================================================
// 💳 DEBT HANDLER - Registro e consulta de dívidas via WhatsApp
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// 📝 REGISTRAR DÍVIDA
// ============================================================================

export async function registerDebt(
  userId: string,
  slots: Record<string, any>
): Promise<{ success: boolean; message: string }> {
  try {
    const { tipo, nome, saldo_devedor, taxa_juros, valor_minimo } = slots;

    if (!nome || !saldo_devedor) {
      return { success: false, message: "Preciso do nome e saldo devedor da dívida." };
    }

    const { error } = await supabase.from("dividas").insert({
      usuario_id: userId,
      tipo: tipo || "cartao",
      nome,
      saldo_devedor: Number(saldo_devedor),
      taxa_juros: taxa_juros ? Number(taxa_juros) : null,
      valor_minimo: valor_minimo ? Number(valor_minimo) : null,
      ativa: true,
    });

    if (error) {
      console.error("❌ [DEBT] Erro ao registrar:", error);
      return { success: false, message: "Erro ao registrar dívida." };
    }

    const jurosInfo = taxa_juros ? `\n📊 Juros: ${taxa_juros}% ao mês` : "";
    const minimoInfo = valor_minimo ? `\n💵 Mínimo: R$ ${Number(valor_minimo).toFixed(2)}` : "";

    return {
      success: true,
      message: `✅ *Dívida registrada!*\n\n${getTipoIcon(tipo)} ${nome}\n💰 Saldo: R$ ${Number(saldo_devedor).toFixed(2)}${jurosInfo}${minimoInfo}\n\nAgora posso simular cenários de quitação para você! 🚀`,
    };
  } catch (err) {
    console.error("❌ [DEBT] Erro:", err);
    return { success: false, message: "Erro interno ao registrar dívida." };
  }
}

// ============================================================================
// 📋 LISTAR DÍVIDAS
// ============================================================================

export async function listDebts(
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { data: dividas, error } = await supabase
      .from("dividas")
      .select("*")
      .eq("usuario_id", userId)
      .eq("ativa", true)
      .order("saldo_devedor", { ascending: false });

    if (error) throw error;

    if (!dividas || dividas.length === 0) {
      return {
        success: true,
        message: "📋 Você não tem dívidas registradas.\n\nPara registrar, diga: *registrar dívida*",
      };
    }

    const saldoTotal = dividas.reduce((sum: number, d: any) => sum + d.saldo_devedor, 0);
    const minimoTotal = dividas.reduce((sum: number, d: any) => sum + (d.valor_minimo || 0), 0);

    let msg = `📋 *Suas Dívidas Ativas (${dividas.length})*\n\n`;
    
    dividas.forEach((d: any, i: number) => {
      msg += `${getTipoIcon(d.tipo)} *${d.nome}*\n`;
      msg += `   Saldo: R$ ${d.saldo_devedor.toFixed(2)}`;
      if (d.taxa_juros) msg += ` | Juros: ${d.taxa_juros}%`;
      if (d.valor_minimo) msg += ` | Mín: R$ ${d.valor_minimo.toFixed(2)}`;
      msg += "\n\n";
    });

    msg += `💰 *Total devedor:* R$ ${saldoTotal.toFixed(2)}`;
    if (minimoTotal > 0) msg += `\n💵 *Mínimo mensal:* R$ ${minimoTotal.toFixed(2)}`;
    msg += `\n\n💡 Diga *simular quitação* para ver cenários de aceleração!`;

    return { success: true, message: msg };
  } catch (err) {
    console.error("❌ [DEBT] Erro ao listar:", err);
    return { success: false, message: "Erro ao buscar dívidas." };
  }
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

function getTipoIcon(tipo: string): string {
  const icons: Record<string, string> = {
    cartao: "💳",
    emprestimo: "🏦",
    financiamento: "🚗",
    cheque_especial: "⚠️",
  };
  return icons[tipo] || "📄";
}
