// ============================================================================
// 💰 BUDGET HANDLER - Extraído de index.ts para modularização
// ============================================================================
// setBudget e checkBudgetAfterExpense
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface ExtractedSlots {
  amount?: number;
  category?: string;
  [key: string]: any;
}

// ============================================================================
// 💰 SET BUDGET
// ============================================================================

export async function setBudget(userId: string, slots: ExtractedSlots): Promise<{ success: boolean; message: string }> {
  const limite = slots.amount;
  if (!limite || limite <= 0) {
    return { success: false, message: "Preciso de um valor válido para o orçamento 💸" };
  }
  
  const categoria = slots.category || null;
  const tipo = categoria ? "categoria" : "global";
  
  if (!categoria) {
    await supabase.from("perfil_cliente").upsert({
      usuario_id: userId,
      operation_mode: "normal",
      limites: { mensal: limite },
      score_economia: 50
    }, { onConflict: "usuario_id" });
  }
  
  let query = supabase
    .from("orcamentos")
    .select("id")
    .eq("usuario_id", userId)
    .eq("tipo", tipo)
    .eq("ativo", true);
  
  if (categoria) {
    query = query.eq("categoria", categoria);
  } else {
    query = query.is("categoria", null);
  }
  
  const { data: existingBudget } = await query.single();
  
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  let queryGastos = supabase
    .from("transacoes")
    .select("valor")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", startOfMonth.toISOString());
  
  if (categoria) {
    queryGastos = queryGastos.eq("categoria", categoria);
  }
  
  const { data: gastos } = await queryGastos;
  const gastoAtual = gastos?.reduce((sum: number, t: any) => sum + (Number(t.valor) || 0), 0) || 0;
  
  console.log(`💰 [BUDGET] Gastos do mês em ${categoria || 'total'}: R$ ${gastoAtual.toFixed(2)}`);
  
  if (existingBudget) {
    await supabase.from("orcamentos")
      .update({ 
        limite, 
        gasto_atual: gastoAtual,
        alerta_50_enviado: gastoAtual >= limite * 0.5,
        alerta_80_enviado: gastoAtual >= limite * 0.8,
        alerta_100_enviado: gastoAtual >= limite
      })
      .eq("id", existingBudget.id);
  } else {
    await supabase.from("orcamentos").insert({
      usuario_id: userId,
      tipo,
      categoria: categoria || null,
      limite,
      periodo: "mensal",
      ativo: true,
      gasto_atual: gastoAtual,
      alerta_50_enviado: gastoAtual >= limite * 0.5,
      alerta_80_enviado: gastoAtual >= limite * 0.8,
      alerta_100_enviado: gastoAtual >= limite
    });
  }
  
  const percentual = (gastoAtual / limite) * 100;
  let statusMsg = "";
  
  if (percentual >= 100) {
    statusMsg = `\n\n🚨 *ATENÇÃO:* Você já estourou o limite!\nGastou R$ ${gastoAtual.toFixed(2)} de R$ ${limite.toFixed(2)}`;
  } else if (percentual >= 80) {
    statusMsg = `\n\n⚠️ Você já gastou ${percentual.toFixed(0)}% do limite (R$ ${gastoAtual.toFixed(2)})`;
  } else if (percentual >= 50) {
    statusMsg = `\n\nℹ️ Você já gastou ${percentual.toFixed(0)}% do limite (R$ ${gastoAtual.toFixed(2)})`;
  }
  
  const catLabel = categoria ? `de *${categoria}*` : "*total*";
  return {
    success: true,
    message: `✅ Orçamento ${catLabel} definido!\n\n💰 Limite: *R$ ${limite.toFixed(2)}/mês*${statusMsg}\n\nVou te avisar quando atingir 50%, 80% e 100% do limite. 📊`
  };
}

// ============================================================================
// 📊 CHECK BUDGET AFTER EXPENSE
// ============================================================================

export async function checkBudgetAfterExpense(userId: string, categoria: string, valorGasto: number): Promise<string | null> {
  try {
    const { data: orcamentos } = await supabase
      .from("orcamentos")
      .select("*")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .or(`tipo.eq.global,and(tipo.eq.categoria,categoria.eq.${categoria})`);
    
    if (!orcamentos || orcamentos.length === 0) return null;
    
    const alerts: string[] = [];
    
    for (const orcamento of orcamentos) {
      const limiteVal = orcamento.limite ?? 0;
      const gastoAtualVal = orcamento.gasto_atual ?? 0;
      const percentual = ((gastoAtualVal + valorGasto) / (limiteVal || 1)) * 100;
      
      if (percentual >= 100 && !orcamento.alerta_100_enviado) {
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`🚨 *Atenção!* Você atingiu 100% do ${tipo}!\n\nLimite: R$ ${limiteVal.toFixed(2)}\nGasto: R$ ${(gastoAtualVal + valorGasto).toFixed(2)}`);
        
        await supabase.from("orcamentos")
          .update({ alerta_100_enviado: true })
          .eq("id", orcamento.id);
          
      } else if (percentual >= 80 && percentual < 100 && !orcamento.alerta_80_enviado) {
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`⚠️ Você usou 80% do ${tipo}.\n\nRestam R$ ${(limiteVal - gastoAtualVal - valorGasto).toFixed(2)}`);
        
        await supabase.from("orcamentos")
          .update({ alerta_80_enviado: true })
          .eq("id", orcamento.id);
          
      } else if (percentual >= 50 && percentual < 80 && !orcamento.alerta_50_enviado) {
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`💡 Você atingiu 50% do ${tipo}.`);
        
        await supabase.from("orcamentos")
          .update({ alerta_50_enviado: true })
          .eq("id", orcamento.id);
      }
    }
    
    return alerts.length > 0 ? alerts.join("\n\n") : null;
    
  } catch (error) {
    console.error("❌ [BUDGET] Erro ao verificar orçamentos:", error);
    return null;
  }
}
