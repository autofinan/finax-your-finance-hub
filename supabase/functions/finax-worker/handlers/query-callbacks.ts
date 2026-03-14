import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatBrasiliaDate } from "../utils/date-helpers.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export async function handleQueryCallbacks(
  buttonId: string,
  userId: string,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<boolean> {
  if (!buttonId?.startsWith("view_all_") && !buttonId?.startsWith("view_by_category_")) {
    return false;
  }

  if (buttonId.startsWith("view_all_")) {
    const parts = buttonId.replace("view_all_", "").split("_");
    const scope = parts[0];
    const viewTimeRange = parts[1] || "month";
    const viewCategory = parts[2] !== "all" ? parts[2] : undefined;
    
    console.log(`📋 [BUTTON] Ver todos: ${scope} ${viewTimeRange} ${viewCategory || 'todas categorias'}`);
    
    const viewStartOfMonth = new Date();
    if (viewTimeRange === "month") {
      viewStartOfMonth.setDate(1);
      viewStartOfMonth.setHours(0, 0, 0, 0);
    } else if (viewTimeRange === "week") {
      viewStartOfMonth.setDate(viewStartOfMonth.getDate() - 7);
      viewStartOfMonth.setHours(0, 0, 0, 0);
    } else if (viewTimeRange === "today") {
      viewStartOfMonth.setHours(0, 0, 0, 0);
    } else {
      viewStartOfMonth.setDate(1);
      viewStartOfMonth.setHours(0, 0, 0, 0);
    }
    
    let viewQuery = supabase
      .from("transacoes")
      .select("valor, descricao, categoria, data")
      .eq("usuario_id", userId)
      .eq("tipo", scope === "income" ? "entrada" : "saida")
      .gte("data", viewStartOfMonth.toISOString())
      .eq("status", "confirmada")
      .order("data", { ascending: false })
      .limit(1000);
    
    if (viewCategory) {
      viewQuery = viewQuery.eq("categoria", viewCategory);
    }
    
    const { data: allTx } = await viewQuery;
    
    if (!allTx || allTx.length === 0) {
      await sendMessage(phoneNumber, "Nenhum gasto encontrado 🤷", messageSource);
      return true;
    }
    
    const byCategory: Record<string, typeof allTx> = {};
    for (const tx of allTx) {
      const cat = tx.categoria || "outros";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(tx);
    }
    
    const catEmojis: Record<string, string> = {
      alimentacao: "🍔", transporte: "🚗", moradia: "🏠", lazer: "🎮",
      saude: "🏥", educacao: "📚", mercado: "🛒", servicos: "✂️", compras: "🛍️", outros: "📦"
    };
    
    let fullMsg = `📊 *Todos os gastos*\n\n`;
    for (const [cat, txs] of Object.entries(byCategory)) {
      const emoji = catEmojis[cat] || "💸";
      const totalCat = txs.reduce((sum, t) => sum + Number(t.valor), 0);
      fullMsg += `${emoji} *${cat}* (R$ ${totalCat.toFixed(2)})\n`;
      for (const tx of txs) {
        const dataF = tx.data ? formatBrasiliaDate(tx.data) : "";
        fullMsg += `  💸 R$ ${Number(tx.valor).toFixed(2)} - ${tx.descricao || 'Sem descrição'}${dataF ? ` (${dataF})` : ""}\n`;
      }
      fullMsg += `\n`;
    }
    const totalAll = allTx.reduce((sum, t) => sum + Number(t.valor), 0);
    fullMsg += `💰 *Total: R$ ${totalAll.toFixed(2)}*`;
    
    await sendMessage(phoneNumber, fullMsg, messageSource);
    return true;
  }
  
  if (buttonId.startsWith("view_by_category_")) {
    const catTimeRange = buttonId.replace("view_by_category_", "");
    console.log(`📊 [BUTTON] Ver por categoria: ${catTimeRange}`);
    
    const catStartDate = new Date();
    if (catTimeRange === "month") { catStartDate.setDate(1); catStartDate.setHours(0,0,0,0); }
    else if (catTimeRange === "week") { catStartDate.setDate(catStartDate.getDate() - 7); catStartDate.setHours(0,0,0,0); }
    else { catStartDate.setDate(1); catStartDate.setHours(0,0,0,0); }
    
    const { data: catTxs } = await supabase
      .from("transacoes")
      .select("categoria, valor")
      .eq("usuario_id", userId)
      .eq("tipo", "saida")
      .gte("data", catStartDate.toISOString())
      .eq("status", "confirmada")
      .limit(10000);
    
    if (!catTxs || catTxs.length === 0) {
      await sendMessage(phoneNumber, "Nenhum gasto encontrado 🤷", messageSource);
      return true;
    }
    
    const byCat: Record<string, number> = {};
    for (const tx of catTxs) {
      const cat = tx.categoria || "outros";
      byCat[cat] = (byCat[cat] || 0) + Number(tx.valor);
    }
    
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const catEmojis2: Record<string, string> = {
      alimentacao: "🍔", transporte: "🚗", moradia: "🏠", lazer: "🎮",
      saude: "🏥", educacao: "📚", mercado: "🛒", servicos: "✂️", compras: "🛍️", outros: "📦"
    };
    
    let catMsg = `📊 *Gastos por Categoria*\n\n`;
    for (const [cat, total] of sorted) {
      const emoji = catEmojis2[cat] || "💸";
      catMsg += `${emoji} ${cat}: R$ ${total.toFixed(2)}\n`;
    }
    const totalGeral = sorted.reduce((sum, [_, val]) => sum + val, 0);
    catMsg += `\n💸 *Total: R$ ${totalGeral.toFixed(2)}*`;
    
    if (sorted.length > 3) {
      const sections = [{
        title: "Categorias",
        rows: sorted.map(([cat]) => ({
          id: `view_all_expenses_${catTimeRange}_${cat}`,
          title: `${catEmojis2[cat] || "💸"} ${cat}`.slice(0, 24),
          description: `R$ ${byCat[cat].toFixed(2)}`
        }))
      }];
      await sendListMessage(phoneNumber, catMsg, "Ver categoria", sections, messageSource);
    } else {
      const detailButtons = sorted.map(([cat]) => ({
        id: `view_all_expenses_${catTimeRange}_${cat}`,
        title: `📋 ${cat.slice(0, 16)}`
      }));
      await sendButtons(phoneNumber, catMsg, detailButtons, messageSource);
    }
    return true;
  }

  return false;
}
