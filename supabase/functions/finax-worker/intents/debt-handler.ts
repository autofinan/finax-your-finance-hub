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
// 📊 SIMULAR QUITAÇÃO (Avalanche Method)
// ============================================================================

interface SimResult {
  nome: string;
  meses: number;
  totalJuros: number;
  totalPago: number;
  pagamentoMensal: number;
}

function simularCenario(
  dividas: any[],
  margemExtra: number,
  nome: string
): SimResult {
  const minimoTotal = dividas.reduce((s: number, d: any) => s + (d.valor_minimo || 0), 0);
  const pagamentoMensal = minimoTotal + margemExtra;

  let saldos = dividas.map((d: any) => ({
    saldo: d.saldo_devedor,
    taxa: (d.taxa_juros || 0) / 100,
    minimo: d.valor_minimo || 0,
    quitada: false,
  })).sort((a: any, b: any) => b.taxa - a.taxa);

  let meses = 0, totalJuros = 0, totalPago = 0;

  while (saldos.some((s: any) => !s.quitada && s.saldo > 0) && meses < 600) {
    meses++;
    let extra = margemExtra;

    for (const s of saldos) {
      if (s.quitada || s.saldo <= 0) continue;
      const juros = s.saldo * s.taxa;
      totalJuros += juros;
      s.saldo += juros;
    }
    for (const s of saldos) {
      if (s.quitada || s.saldo <= 0) continue;
      const p = Math.min(s.minimo, s.saldo);
      s.saldo -= p; totalPago += p;
      if (s.saldo <= 0.01) { s.quitada = true; s.saldo = 0; }
    }
    for (const s of saldos) {
      if (s.quitada || s.saldo <= 0 || extra <= 0) continue;
      const p = Math.min(extra, s.saldo);
      s.saldo -= p; totalPago += p; extra -= p;
      if (s.saldo <= 0.01) { s.quitada = true; s.saldo = 0; }
    }
  }

  return { nome, meses, totalJuros: Math.round(totalJuros * 100) / 100, totalPago: Math.round(totalPago * 100) / 100, pagamentoMensal: Math.round(pagamentoMensal * 100) / 100 };
}

export async function simulateDebts(
  userId: string,
  slots: Record<string, any>
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
      return { success: true, message: "📋 Sem dívidas ativas para simular.\n\nRegistre com: *registrar dívida*" };
    }

    const receita = Number(slots.receita || slots.income || 0);
    const gastos = Number(slots.gastos || slots.expenses || 0);
    const minimoTotal = dividas.reduce((s: number, d: any) => s + (d.valor_minimo || 0), 0);

    if (!receita) {
      return {
        success: true,
        message: `📊 *Para simular quitação preciso saber:*\n\n1️⃣ Sua receita mensal\n2️⃣ Seus gastos fixos essenciais\n\nExemplo: *simular quitação receita 5000 gastos 3000*\n\n📋 Suas dívidas ativas: ${dividas.length}\n💰 Saldo total: R$ ${dividas.reduce((s: number, d: any) => s + d.saldo_devedor, 0).toFixed(2)}\n💵 Mínimo mensal: R$ ${minimoTotal.toFixed(2)}`,
      };
    }

    const margem = Math.max(0, receita - gastos - minimoTotal);
    const atual = simularCenario(dividas, 0, "Atual");
    const conservador = simularCenario(dividas, margem * 0.5, "Conservador");
    const agressivo = simularCenario(dividas, margem, "Agressivo");

    const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
    const mesesFmt = (m: number) => m >= 600 ? "∞" : `${m} meses`;

    let msg = `📊 *Simulador de Quitação*\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `💵 Margem disponível: ${fmt(margem)}/mês\n\n`;

    msg += `⏳ *Cenário Atual (só mínimo)*\n`;
    msg += `   Pgto: ${fmt(atual.pagamentoMensal)}/mês\n`;
    msg += `   Prazo: ${mesesFmt(atual.meses)}\n`;
    msg += `   Total pago: ${fmt(atual.totalPago)}\n`;
    msg += `   Juros: ${fmt(atual.totalJuros)}\n\n`;

    msg += `📘 *Conservador (+50% margem)*\n`;
    msg += `   Pgto: ${fmt(conservador.pagamentoMensal)}/mês\n`;
    msg += `   Prazo: ${mesesFmt(conservador.meses)}\n`;
    msg += `   Total pago: ${fmt(conservador.totalPago)}\n`;
    msg += `   Juros: ${fmt(conservador.totalJuros)}\n`;
    if (atual.meses - conservador.meses > 0) {
      msg += `   🚀 ${atual.meses - conservador.meses} meses mais rápido!\n`;
    }
    msg += `\n`;

    msg += `🟢 *Agressivo (+100% margem)*\n`;
    msg += `   Pgto: ${fmt(agressivo.pagamentoMensal)}/mês\n`;
    msg += `   Prazo: ${mesesFmt(agressivo.meses)}\n`;
    msg += `   Total pago: ${fmt(agressivo.totalPago)}\n`;
    msg += `   Juros: ${fmt(agressivo.totalJuros)}\n`;
    if (atual.totalPago - agressivo.totalPago > 0) {
      msg += `   💰 Economia total: ${fmt(atual.totalPago - agressivo.totalPago)}!\n`;
    }

    msg += `\n💡 Método: *Avalanche* (prioriza maior juros)`;

    return { success: true, message: msg };
  } catch (err) {
    console.error("❌ [SIMULATE_DEBTS] Erro:", err);
    return { success: false, message: "Erro ao simular quitação." };
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
