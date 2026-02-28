// ============================================================================
// 🏁 FREEDOM INSIGHTS - Cálculo de "Dias de Liberdade" pós-gasto e consulta
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface FreedomResult {
  diasParaLiberdade: number;
  margemReal: number;
  saldoTotal: number;
  impactoPorReal: number;
}

// ============================================================================
// 📊 CALCULAR DIAS DE LIBERDADE
// ============================================================================

async function calcFreedomDays(userId: string): Promise<FreedomResult | null> {
  // 1. Buscar dívidas ativas
  const { data: dividas } = await supabase
    .from("dividas")
    .select("saldo_devedor, valor_minimo")
    .eq("usuario_id", userId)
    .eq("ativa", true);

  if (!dividas || dividas.length === 0) return null;

  const saldoTotal = dividas.reduce((s, d) => s + (d.saldo_devedor || 0), 0);

  // 2. Buscar receita e gastos do mês atual
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo")
    .eq("usuario_id", userId)
    .gte("data", inicioMes.toISOString())
    .neq("status", "cancelada");

  let totalEntradas = 0;
  let totalSaidas = 0;
  transacoes?.forEach((t) => {
    if (t.tipo === "entrada") totalEntradas += Number(t.valor);
    else totalSaidas += Number(t.valor);
  });

  if (totalEntradas <= 0) return null;

  const margemReal = Math.max(0, totalEntradas - totalSaidas);
  if (margemReal <= 0) {
    return { diasParaLiberdade: Infinity, margemReal: 0, saldoTotal, impactoPorReal: 0 };
  }

  const margemDiaria = margemReal / 30;
  const diasParaLiberdade = Math.ceil(saldoTotal / margemDiaria);
  const impactoPorReal = 1 / margemDiaria;

  return { diasParaLiberdade, margemReal, saldoTotal, impactoPorReal };
}

// ============================================================================
// 💬 MICRO-INSIGHT PÓS GASTO (append ao message do expense)
// ============================================================================

export async function getFreedomMicroInsight(
  userId: string,
  valorGasto: number
): Promise<string> {
  try {
    const result = await calcFreedomDays(userId);
    if (!result || result.diasParaLiberdade === Infinity) return "";

    const diasImpacto = Math.round(result.impactoPorReal * valorGasto);
    if (diasImpacto < 1) return "";

    return `\n\n🏁 _Esse gasto = +${diasImpacto} dia${diasImpacto > 1 ? "s" : ""} no caminho pra liberdade_`;
  } catch (err) {
    console.error("⚠️ [FREEDOM] Erro micro-insight:", err);
    return "";
  }
}

// ============================================================================
// 📋 CONSULTA COMPLETA "QUANTO FALTA PRA LIBERDADE?"
// ============================================================================

export async function queryFreedomDays(
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await calcFreedomDays(userId);

    if (!result) {
      return {
        success: true,
        message: "🏁 Sem dívidas ativas! Você já está livre! 🎉\n\nOu registre suas dívidas com: *registrar dívida*",
      };
    }

    if (result.diasParaLiberdade === Infinity) {
      return {
        success: true,
        message: "🏁 *Liberdade Financeira*\n\n⚠️ Sua margem mensal está zerada ou negativa.\n\n💡 Reduza gastos flexíveis para criar margem de quitação.\n\nDica: diga *listar dívidas* para ver seu panorama.",
      };
    }

    const anos = Math.floor(result.diasParaLiberdade / 365);
    const meses = Math.floor((result.diasParaLiberdade % 365) / 30);
    const dias = result.diasParaLiberdade % 30;

    const tempoStr = anos > 0
      ? `${anos} ano${anos > 1 ? "s" : ""} e ${meses} mês(es)`
      : meses > 0
        ? `${meses} mês(es) e ${dias} dia(s)`
        : `${dias} dia(s)`;

    const dataEstimada = new Date();
    dataEstimada.setDate(dataEstimada.getDate() + result.diasParaLiberdade);
    const mesAno = dataEstimada.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    const impacto100 = Math.round(result.impactoPorReal * 100);
    const impactoCafe = Math.round(result.impactoPorReal * 8 * 30);

    let msg = `🏁 *Liberdade Financeira*\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `📅 *Previsão:* ${tempoStr}\n`;
    msg += `🗓️ *Data estimada:* ${mesAno}\n\n`;
    msg += `💰 Saldo devedor: R$ ${result.saldoTotal.toFixed(2)}\n`;
    msg += `📊 Margem mensal: R$ ${result.margemReal.toFixed(2)}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 *Impactos:*\n`;
    msg += `• -R$ 100 em gastos = -${impacto100} dias\n`;
    if (impactoCafe > 3) {
      msg += `• ☕ Café diário de R$8 = +${impactoCafe} dias/mês\n`;
    }
    msg += `\n🚀 Diga *simular quitação* para ver cenários acelerados!`;

    return { success: true, message: msg };
  } catch (err) {
    console.error("❌ [FREEDOM] Erro:", err);
    return { success: false, message: "Erro ao calcular previsão de liberdade." };
  }
}
