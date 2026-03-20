// ============================================================================
// 📊 INTENT: QUERY ROUTING (Consultas financeiras por scope)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeText, detectQueryScope, detectTimeRange } from "../utils/helpers.ts";
import { formatBrasiliaDate } from "../utils/date-helpers.ts";
import { updateConversationContext, scopeToTopic, getConversationContext } from "../utils/conversation-context.ts";
import { getActiveContext } from "./context-handler.ts";
import { queryCardLimits, queryCardExpenses, queryContextExpenses } from "./card-queries.ts";
import { listActiveRecurrings } from "./recurring-handler.ts";
import { gerarTextoRelatorioInline } from "./reports-handler.ts";
import { getMonthlySummaryInline } from "./expense-inline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const KNOWN_CATEGORIES = [
  "alimentacao", "alimentação", "transporte", "moradia", "lazer",
  "saude", "saúde", "educacao", "educação", "mercado",
  "servicos", "serviços", "outros", "compras"
];

export async function handleQueryRouting(
  userId: string,
  slots: Record<string, any>,
  conteudoProcessado: string,
  nomeUsuario: string,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  const normalized = normalizeText(conteudoProcessado);

  // ========================================================================
  // v3.2: ROTEAMENTO PRIORITÁRIO POR query_scope DA IA
  // ========================================================================
  let queryScope = slots.query_scope || detectQueryScope(normalized);
  const timeRange = slots.time_range || detectTimeRange(normalized);

  // 🔧 FIX: "detalhe entradas" deve rotear para income, não para expense
  if ((normalized.includes("detalhe") || normalized.includes("detalha")) &&
      (normalized.includes("entrada") || normalized.includes("entrou") || normalized.includes("recebi"))) {
    queryScope = "income";
    console.log(`📊 [QUERY] FIX: "detalhe entradas" → roteando para INCOME`);
  }

  // 🔧 FIX: "detalhe [categoria]" deve filtrar por categoria
  if ((normalized.includes("detalhe") || normalized.includes("detalha") || normalized.includes("detalhar")) && !slots.category) {
    for (const cat of KNOWN_CATEGORIES) {
      const catNorm = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalized.includes(catNorm)) {
        slots.category = catNorm;
        queryScope = "expenses";
        console.log(`📊 [QUERY] FIX: "detalhe ${cat}" → roteando para EXPENSES com category=${catNorm}`);
        break;
      }
    }
  }

  console.log(`📊 [QUERY] Scope: ${queryScope}, TimeRange: ${timeRange}`);

  // Importar funções de query
  const { getWeeklyExpenses, getTodayExpenses, listPendingExpenses, getExpensesByCategory, getExpensesByCategoryData, getInvoiceDetail, getFutureInvoicePreview } = await import("./query.ts");

  // 💬 Atualizar contexto conversacional para referências futuras
  await updateConversationContext(userId, {
    currentTopic: scopeToTopic(queryScope as string),
    lastIntent: "query",
    lastTimeRange: timeRange as string,
    lastQueryScope: queryScope as string
  });

  switch (queryScope) {
    // ✅ FIX WA-4: Handler para "relatório semanal" on-demand
    case "weekly_report": {
      console.log(`📊 [QUERY] Roteando para: WEEKLY REPORT`);

      const { data: relatorio } = await supabase.rpc("fn_relatorio_semanal", {
        p_usuario_id: userId
      });

      if (relatorio && relatorio.totais && (relatorio.totais.entradas > 0 || relatorio.totais.saidas > 0)) {
        const textoRelatorio = await gerarTextoRelatorioInline(relatorio, nomeUsuario);
        await sendMessage(phoneNumber, textoRelatorio, messageSource);
      } else {
        await sendMessage(phoneNumber, "📊 Sem dados suficientes para o relatório semanal.\n\nRegistre seus gastos e entradas primeiro! 💸", messageSource);
      }
      return;
    }

    case "cards":
      console.log(`📊 [QUERY] Roteando para: CARDS`);
      const cardsResult = await queryCardLimits(userId);
      await sendMessage(phoneNumber, cardsResult, messageSource);
      return;

    case "pending":
      console.log(`📊 [QUERY] Roteando para: PENDING`);
      const pendingResult = await listPendingExpenses(userId);
      await sendMessage(phoneNumber, pendingResult, messageSource);
      return;

    case "expenses": {
      console.log(`📊 [QUERY] Roteando para: EXPENSES - usando dynamic query`);

      const { executeDynamicQuery } = await import("../utils/dynamic-query.ts");

      // ✅ FIX: Detectar categoria do texto se não veio nos slots
      if (!slots.category) {
        for (const cat of KNOWN_CATEGORIES) {
          const catNorm = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (normalized.includes(catNorm)) {
            slots.category = catNorm;
            console.log(`📊 [QUERY] Detectou categoria no texto: ${catNorm}`);
            break;
          }
        }
      }

      // ✅ FIX: Detectar cartão do usuário no texto
      if (!slots.card_id) {
        const { data: userCardsExpense } = await supabase
          .from("cartoes_credito")
          .select("id, nome, limite_disponivel, limite_total")
          .eq("usuario_id", userId);
        
        for (const card of (userCardsExpense || [])) {
          if (card.nome && normalized.includes(normalizeText(card.nome))) {
            slots.card_id = card.id;
            console.log(`📊 [QUERY] Detectou cartão no texto: ${card.nome}`);
            
            // Rotear direto para gastos do cartão
            const inicioMesCard = new Date();
            inicioMesCard.setDate(1);
            inicioMesCard.setHours(0, 0, 0, 0);
            
            const { data: gastosCard } = await supabase
              .from("transacoes")
              .select("valor, descricao, data")
              .eq("usuario_id", userId)
              .eq("cartao_id", card.id)
              .eq("tipo", "saida")
              .gte("data", inicioMesCard.toISOString())
              .eq("status", "confirmada")
              .order("data", { ascending: false })
              .limit(1000);
            
            if (!gastosCard || gastosCard.length === 0) {
              await sendMessage(phoneNumber,
                `💳 *${card.nome}*\n\nNenhum gasto este mês.\n\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
                messageSource);
              return;
            }
            
            const totalCard = gastosCard.reduce((sum: number, g: any) => sum + Number(g.valor), 0);
            const listaCard = gastosCard.slice(0, 10).map((g: any) => {
              const dataStr = formatBrasiliaDate(g.data);
              return `💸 R$ ${Number(g.valor).toFixed(2)} - ${g.descricao || "Gasto"} (${dataStr})`;
            }).join("\n");
            
            await sendMessage(phoneNumber,
              `💳 *Gastos no ${card.nome}*\n\n${listaCard}\n\n💸 Total: R$ ${totalCard.toFixed(2)}\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
              messageSource);
            return;
          }
        }
      }

      const expenseQueryParams = {
        userId,
        query_scope: "expenses" as const,
        start_date: slots.start_date as string | undefined,
        end_date: slots.end_date as string | undefined,
        time_range: timeRange,
        category: slots.category as string | undefined,
        card_id: slots.card_id as string | undefined
      };

      console.log(`📊 [QUERY] Dynamic params:`, expenseQueryParams);

      const expensesResult = await executeDynamicQuery(expenseQueryParams);

      // ✅ Se tem mais itens, enviar com botões interativos
      if (expensesResult.hasMore) {
        const queryButtons: Array<{ id: string; title: string }> = [
          { id: `view_all_expenses_${expensesResult.timeRange}_${expensesResult.category || 'all'}`, title: "📋 Ver todos" }
        ];
        if (!expensesResult.category) {
          queryButtons.push({
            id: `view_by_category_${expensesResult.timeRange}`,
            title: "📊 Por categoria"
          });
        }
        await sendButtons(phoneNumber, expensesResult.message, queryButtons, messageSource);
      } else {
        await sendMessage(phoneNumber, expensesResult.message, messageSource);
      }

      // Atualizar contexto para próxima pergunta
      await updateConversationContext(userId, {
        currentTopic: "expenses",
        lastIntent: "query",
        lastTimeRange: timeRange,
        lastQueryScope: "expenses",
        lastCategory: slots.category as string || undefined
      });
      return;
    }

    case "income": {
      console.log(`📊 [QUERY] Roteando para: INCOME`);
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);

      const { data: entradas } = await supabase
        .from("transacoes")
        .select("valor, descricao, data, forma_pagamento")
        .eq("usuario_id", userId)
        .eq("tipo", "entrada")
        .gte("data", inicioMes.toISOString())
        .eq("status", "confirmada")
        .order("data", { ascending: false })
        .limit(1000);

      if (!entradas || entradas.length === 0) {
        await sendMessage(phoneNumber, "💰 Nenhuma entrada registrada este mês.\n\n_Manda \"recebi 1500\" pra registrar!_", messageSource);
        return;
      }

      const totalEntradas = entradas.reduce((sum: number, e: any) => sum + Number(e.valor), 0);
      const listaEntradas = entradas.slice(0, 10).map((e: any) => {
        const dataStr = formatBrasiliaDate(e.data);
        return `💰 R$ ${Number(e.valor).toFixed(2)} - ${e.descricao || "Entrada"} (${dataStr})`;
      }).join("\n");

      await sendMessage(phoneNumber,
        `💰 *Entradas do Mês*\n\n${listaEntradas}\n\n✅ *Total: R$ ${totalEntradas.toFixed(2)}*`,
        messageSource
      );
      return;
    }

    case "category": {
      console.log(`📊 [QUERY] Roteando para: CATEGORY`);
      const catDataResult = await getExpensesByCategoryData(userId);

      if (catDataResult.categories.length === 0) {
        await sendMessage(phoneNumber, "Sem gastos este mês 🎉", messageSource);
        return;
      }

      const catListMsg = catDataResult.categories.map(c => `${c.emoji} ${c.name}: R$ ${c.total.toFixed(2)}`).join("\n");
      const catFullMsg = `📊 *Gastos por Categoria*\n\n${catListMsg}\n\n💸 Total: *R$ ${catDataResult.grandTotal.toFixed(2)}*`;

      // Show drilldown buttons for top categories
      const topCategories = catDataResult.categories.slice(0, 3);
      if (topCategories.length > 0) {
        const drillButtons = topCategories.map(c => ({
          id: `view_all_expenses_month_${c.name}`,
          title: `${c.emoji} ${c.name}`.slice(0, 20)
        }));
        await sendButtons(phoneNumber, catFullMsg, drillButtons, messageSource);
      } else {
        await sendMessage(phoneNumber, catFullMsg, messageSource);
      }
      return;
    }

    case "recurring": {
      console.log(`📊 [QUERY] Roteando para: RECURRING`);
      const recorrentes = await listActiveRecurrings(userId);
      if (recorrentes.length === 0) {
        await sendMessage(phoneNumber, "Você não tem gastos recorrentes ativos 📋", messageSource);
        return;
      }
      const listaRec = recorrentes.map((r: any) =>
        `🔄 ${r.descricao} - R$ ${Number(r.valor_parcela).toFixed(2)}/mês`
      ).join("\n");
      await sendMessage(phoneNumber, `🔄 *Seus Recorrentes*\n\n${listaRec}`, messageSource);
      return;
    }

    // ✅ BUG #5 FIX: Handler para "quais meus orçamentos"
    case "budgets":
    case "budget":
    case "orcamentos":
    case "orcamento": {
      console.log(`📊 [QUERY] Roteando para: BUDGETS`);
      const { data: budgets } = await supabase
        .from("orcamentos")
        .select("*")
        .eq("usuario_id", userId)
        .eq("ativo", true)
        .order("tipo", { ascending: true });

      if (!budgets || budgets.length === 0) {
        await sendMessage(phoneNumber, "💰 Você não tem orçamentos definidos.\n\n_Defina um: \"limite mensal 3000\" ou \"máximo 500 alimentação\"_", messageSource);
        return;
      }

      const listaBudgets = budgets.map((b: any) => {
        const tipo = b.tipo === "global" ? "💰 Total" : `📂 ${b.categoria || b.tipo}`;
        const limite = Number(b.limite || 0);
        const gasto = Number(b.gasto_atual || 0);
        const percent = limite > 0 ? Math.round((gasto / limite) * 100) : 0;
        const emoji = percent >= 100 ? "🔴" : percent >= 80 ? "🟡" : "🟢";
        return `${emoji} *${tipo}*\n   Limite: R$ ${limite.toFixed(2)}\n   Gasto: R$ ${gasto.toFixed(2)} (${percent}%)`;
      }).join("\n\n");

      await sendMessage(phoneNumber, `💰 *Seus Orçamentos*\n\n${listaBudgets}`, messageSource);
      return;
    }

    // ✅ BLOCO 4: Handler para "meus parcelamentos"
    case "installments":
    case "installment":
    case "parcelas":
    case "parcelamento":
    case "parcelamentos": {
      console.log(`📊 [QUERY] Roteando para: INSTALLMENTS`);

      const { data: parcelas } = await supabase
        .from("parcelas")
        .select("descricao, numero_parcela, total_parcelas, valor, status, mes_referencia")
        .eq("usuario_id", userId)
        .in("status", ["pendente", "futura"])
        .order("mes_referencia", { ascending: true })
        .limit(20);

      if (!parcelas || parcelas.length === 0) {
        await sendMessage(phoneNumber, "📦 Nenhum parcelamento ativo!\n\n_Pra parcelar, manda: \"notebook 1200 crédito 12x\"_", messageSource);
        return;
      }

      // Agrupar por descrição
      const byDesc: Record<string, typeof parcelas> = {};
      for (const p of parcelas) {
        const desc = p.descricao || "Parcelado";
        if (!byDesc[desc]) byDesc[desc] = [];
        byDesc[desc].push(p);
      }

      let parcMsg = `📦 *Seus Parcelamentos*\n\n`;
      for (const [desc, items] of Object.entries(byDesc)) {
        const first = items[0];
        const totalParcelas = first.total_parcelas || items.length;
        const pendentes = items.filter(p => p.status === "pendente").length;
        const futuras = items.filter(p => p.status === "futura").length;
        const valorParcela = Number(first.valor || 0);
        const valorTotal = valorParcela * totalParcelas;

        parcMsg += `📦 *${desc}*\n`;
        parcMsg += `  💰 ${totalParcelas}x de R$ ${valorParcela.toFixed(2)} (Total: R$ ${valorTotal.toFixed(2)})\n`;
        parcMsg += `  📊 ${pendentes + futuras} parcelas restantes\n\n`;
      }

      await sendMessage(phoneNumber, parcMsg, messageSource);
      return;
    }

    // ✅ BLOCO 5: Handler para "minhas metas"
    case "goal":
    case "goals":
    case "metas": {
      console.log(`📊 [QUERY] Roteando para: GOALS`);

      const { data: metas } = await supabase
        .from("savings_goals")
        .select("name, current_amount, target_amount, status, deadline")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (!metas || metas.length === 0) {
        await sendMessage(phoneNumber, "🎯 Nenhuma meta ativa!\n\n_Pra criar uma, manda: \"meta viagem 5000\"_", messageSource);
        return;
      }

      let metaMsg = `🎯 *Suas Metas*\n\n`;
      for (const m of metas) {
        const atual = Number(m.current_amount || 0);
        const objetivo = Number(m.target_amount || 0);
        const pct = objetivo > 0 ? Math.round((atual / objetivo) * 100) : 0;
        const barFull = Math.round(pct / 10);
        const bar = "▓".repeat(barFull) + "░".repeat(10 - barFull);

        metaMsg += `🎯 *${m.name}*\n`;
        metaMsg += `  R$ ${atual.toFixed(2)} / R$ ${objetivo.toFixed(2)} (${pct}%)\n`;
        metaMsg += `  ${bar}\n`;
        if (m.deadline) {
          metaMsg += `  📅 Prazo: ${formatBrasiliaDate(m.deadline)}\n`;
        }
        metaMsg += `\n`;
      }

      await sendMessage(phoneNumber, metaMsg, messageSource);
      return;
    }

    // ✅ DETALHAMENTO DE FATURA
    case "invoice_detail": {
      console.log(`📊 [QUERY] Roteando para: INVOICE DETAIL`);

      // Extrair mês do texto
      const mesesMap: Record<string, number> = {
        janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
        julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
      };
      let invoiceMes: number | undefined;
      let invoiceAno: number | undefined;
      for (const [mesNome, mesNum] of Object.entries(mesesMap)) {
        if (normalized.includes(mesNome)) {
          invoiceMes = mesNum;
          break;
        }
      }
      // Detectar "passado/passada" → mês anterior
      if (normalized.includes("passad")) {
        const brasilNow = new Date();
        const bOffset = -3 * 60;
        const bTime = new Date(brasilNow.getTime() + (bOffset - brasilNow.getTimezoneOffset()) * 60000);
        invoiceMes = bTime.getMonth();
        if (invoiceMes === 0) { invoiceMes = 12; invoiceAno = bTime.getFullYear() - 1; }
      }

      // Detectar nome do cartão
      let invoiceCard: string | undefined;
      const cardWords = ["nubank", "inter", "bradesco", "itau", "sicredi", "santander", "c6", "next", "pan", "original", "neon"];
      for (const cw of cardWords) {
        if (normalized.includes(cw)) { invoiceCard = cw; break; }
      }
      const { data: userCardsForInvoice } = await supabase
        .from("cartoes_credito")
        .select("nome")
        .eq("usuario_id", userId);
      for (const uc of (userCardsForInvoice || [])) {
        if (uc.nome && normalized.includes(normalizeText(uc.nome))) {
          invoiceCard = uc.nome;
          break;
        }
      }

      const detailResult = await getInvoiceDetail(userId, invoiceCard, invoiceMes, invoiceAno);
      await sendMessage(phoneNumber, detailResult, messageSource);
      return;
    }

    // ✅ PREVISÃO DE FATURA FUTURA
    case "invoice_future": {
      console.log(`📊 [QUERY] Roteando para: INVOICE FUTURE`);

      let futureCard: string | undefined;
      const { data: userCardsForFuture } = await supabase
        .from("cartoes_credito")
        .select("nome")
        .eq("usuario_id", userId);
      for (const uc of (userCardsForFuture || [])) {
        if (uc.nome && normalized.includes(normalizeText(uc.nome))) {
          futureCard = uc.nome;
          break;
        }
      }

      const futureResult = await getFutureInvoicePreview(userId, futureCard);
      await sendMessage(phoneNumber, futureResult, messageSource);
      return;
    }

    case "summary": {
      // ✅ BUG 5 FIX: Se time_range é "week", rotear para weekly_report
      if (timeRange === "week" || timeRange === "weekly" || timeRange === "semana" || timeRange === "semanal") {
        console.log(`📊 [QUERY] Summary + week → roteando para WEEKLY REPORT`);
        const { data: relatorio } = await supabase.rpc("fn_relatorio_semanal", {
          p_usuario_id: userId
        });
        if (relatorio && relatorio.totais && (relatorio.totais.entradas > 0 || relatorio.totais.saidas > 0)) {
          const textoRelatorio = await gerarTextoRelatorioInline(relatorio, nomeUsuario);
          await sendMessage(phoneNumber, textoRelatorio, messageSource);
        } else {
          await sendMessage(phoneNumber, "📊 Sem dados suficientes para o relatório semanal.\n\nRegistre seus gastos e entradas primeiro! 💸", messageSource);
        }
        return;
      }
      
      // ✅ FIX: Resumo mensal — mostrar entradas/saídas/saldo
      console.log(`📊 [QUERY] Summary mensal → getMonthlySummary`);
      const { getMonthlySummary } = await import("./query.ts");
      const summaryText = await getMonthlySummary(userId);
      await sendMessage(phoneNumber, summaryText, messageSource);
      return;
    }

    // ✅ NOVO: Handler para "contas a pagar"
    case "bills": {
      console.log(`📊 [QUERY] Roteando para: BILLS`);
      const { listBills } = await import("./bills.ts");
      const billsResult = await listBills(userId);
      await sendMessage(phoneNumber, billsResult, messageSource);
      return;
    }

    // ✅ NOVO: Handler para "relatório" (mensal com IA)
    case "report": {
      console.log(`📊 [QUERY] Roteando para: REPORT (IA)`);
      const { gerarRelatorioMensalIA } = await import("./reports-handler.ts");
      
      // Buscar dados do mês
      const { getMonthlySummaryData } = await import("./query.ts");
      const { getExpensesByCategoryData: getCatData } = await import("./query.ts");
      
      const summaryData = await getMonthlySummaryData(userId);
      const catData = await getCatData(userId);
      
      const reportData = {
        entradas: summaryData.totalIncome,
        saidas: summaryData.totalExpense,
        saldo: summaryData.balance,
        transacoes: summaryData.transactionCount,
        categorias: catData.categories.map(c => ({ nome: c.name, total: c.total }))
      };
      
      const textoReport = await gerarRelatorioMensalIA(reportData, nomeUsuario);
      await sendMessage(phoneNumber, textoReport, messageSource);
      return;
    }

    // ✅ NOVO: Handler para gastos por contexto (viagem/evento)
    case "context": {
      console.log(`📊 [QUERY] Roteando para: CONTEXT`);
      const result = await queryContextExpenses(userId, normalized);
      await sendMessage(phoneNumber, result, messageSource);
      return;
    }

    default:
      break;
  }

  // ========================================================================
  // FALLBACK: Detecção por keywords (para compatibilidade)
  // ========================================================================

  // Query de ENTRADAS
  if (normalized.includes("recebi") || normalized.includes("entrada") ||
      normalized.includes("entrou") || normalized.includes("renda") ||
      normalized.includes("quanto ganhei") || normalized.includes("minhas entradas")) {
    console.log(`📊 [QUERY] Query de ENTRADAS detectada (fallback)`);

    const inicioMes2 = new Date();
    inicioMes2.setDate(1);
    inicioMes2.setHours(0, 0, 0, 0);

    const { data: entradas2 } = await supabase
      .from("transacoes")
      .select("valor, descricao, data, forma_pagamento")
      .eq("usuario_id", userId)
      .eq("tipo", "entrada")
      .gte("data", inicioMes2.toISOString())
      .eq("status", "confirmada")
      .order("data", { ascending: false })
      .limit(1000);

    if (!entradas2 || entradas2.length === 0) {
      await sendMessage(phoneNumber, "💰 Nenhuma entrada registrada este mês.\n\n_Manda \"recebi 1500\" pra registrar!_", messageSource);
      return;
    }

    const total2 = entradas2.reduce((sum: number, e: any) => sum + Number(e.valor), 0);
    const lista2 = entradas2.slice(0, 10).map((e: any) => {
      const dataStr = new Date(e.data).toLocaleDateString("pt-BR");
      return `💰 R$ ${Number(e.valor).toFixed(2)} - ${e.descricao || "Entrada"} (${dataStr})`;
    }).join("\n");

    await sendMessage(phoneNumber,
      `💰 *Entradas do Mês*\n\n${lista2}\n\n✅ *Total: R$ ${total2.toFixed(2)}*`,
      messageSource
    );
    return;
  }

  // Query por CARTÃO específico
  const cardMatch = normalized.match(/(?:gastei|quanto|gasto|gastos|usei)\s+(?:o que\s+)?(?:no|na|do|da|com o|com a|com)\s+(\w+)/);
  if (cardMatch && cardMatch[1]) {
    const cardName = cardMatch[1];
    console.log(`📊 [QUERY] Query de gastos no cartão: "${cardName}"`);

    const { data: card } = await supabase
      .from("cartoes_credito")
      .select("id, nome, limite_disponivel, limite_total")
      .eq("usuario_id", userId)
      .ilike("nome", `%${cardName}%`)
      .limit(1)
      .maybeSingle();

    if (card) {
      const inicioMes3 = new Date();
      inicioMes3.setDate(1);
      inicioMes3.setHours(0, 0, 0, 0);

      const { data: gastos } = await supabase
        .from("transacoes")
        .select("valor, descricao, data")
        .eq("usuario_id", userId)
        .eq("cartao_id", card.id)
        .eq("tipo", "saida")
        .gte("data", inicioMes3.toISOString())
        .eq("status", "confirmada")
        .order("data", { ascending: false })
        .limit(1000);

      if (!gastos || gastos.length === 0) {
        await sendMessage(phoneNumber,
          `💳 *${card.nome}*\n\nNenhum gasto este mês.\n\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
          messageSource
        );
        return;
      }

      const totalCard = gastos.reduce((sum: number, g: any) => sum + Number(g.valor), 0);
      const listaCard = gastos.slice(0, 8).map((g: any) => {
        const dataStr = new Date(g.data).toLocaleDateString("pt-BR");
        return `💸 R$ ${Number(g.valor).toFixed(2)} - ${g.descricao || "Gasto"} (${dataStr})`;
      }).join("\n");

      await sendMessage(phoneNumber,
        `💳 *Gastos no ${card.nome}*\n\n${listaCard}\n\n💸 Total: R$ ${totalCard.toFixed(2)}\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
        messageSource
      );
      return;
    }
  }

  // Gastos por CATEGORIA
  if (normalized.includes("categoria") || normalized.includes("categorias") ||
      (normalized.includes("gasto") && normalized.includes("por")) ||
      normalized.includes("breakdown") || normalized.includes("detalhado") ||
      (normalized.includes("detalha") && !KNOWN_CATEGORIES.some(c => normalized.includes(c.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))))) {
    console.log(`📊 [QUERY] Gastos por categoria detectado (fallback)`);
    const catData = await getExpensesByCategoryData(userId);

    if (catData.categories.length === 0) {
      await sendMessage(phoneNumber, "Sem gastos este mês 🎉", messageSource);
      return;
    }

    const catList = catData.categories.map(c => `${c.emoji} ${c.name}: R$ ${c.total.toFixed(2)}`).join("\n");
    const catMsg = `📊 *Gastos por Categoria*\n\n${catList}\n\n💸 Total: *R$ ${catData.grandTotal.toFixed(2)}*`;

    const topCats = catData.categories.slice(0, 3);
    if (topCats.length > 0) {
      const catButtons = topCats.map(c => ({
        id: `view_all_expenses_month_${c.name}`,
        title: `${c.emoji} ${c.name}`.slice(0, 20)
      }));
      await sendButtons(phoneNumber, catMsg, catButtons, messageSource);
    } else {
      await sendMessage(phoneNumber, catMsg, messageSource);
    }
    return;
  }

  // Perguntas sobre cartão/limite
  if ((normalized.includes("limite") && (normalized.includes("disponivel") || normalized.includes("cartao") || normalized.includes("cartoes"))) ||
      (normalized.includes("quanto") && normalized.includes("limite"))) {
    const result = await queryCardLimits(userId);
    await sendMessage(phoneNumber, result, messageSource);
    return;
  }

  // Perguntas sobre gastos por cartão
  if ((normalized.includes("gastei") || normalized.includes("gasto")) &&
      (normalized.includes("cartao") || normalized.includes("credito") || normalized.includes("cada cartao"))) {
    const result = await queryCardExpenses(userId);
    await sendMessage(phoneNumber, result, messageSource);
    return;
  }

  // Query de viagem/contexto
  if (normalized.includes("viagem") && (normalized.includes("quanto") || normalized.includes("gastei"))) {
    const activeContext = await getActiveContext(userId);
    if (activeContext) {
      const { total, count } = await queryContextExpenses(userId, activeContext.id);
      await sendMessage(phoneNumber,
        `📍 *Gastos na ${activeContext.label}*\n\n💸 Total: R$ ${total.toFixed(2)}\n🧾 ${count} transações`,
        messageSource
      );
      return;
    } else {
      await sendMessage(phoneNumber, "Você não tem nenhuma viagem ativa no momento 🤔\n\nPra começar uma viagem, manda: \"Viagem pra SP de 09/01 a 15/01\"", messageSource);
      return;
    }
  }

  // Fallback: resumo mensal COM botões interativos
  const { executeDynamicQuery } = await import("../utils/dynamic-query.ts");
  const fallbackResult = await executeDynamicQuery({
    userId,
    query_scope: "expenses",
    time_range: "month"
  });

  if (fallbackResult.totalItems > 0) {
    const fallbackButtons: Array<{ id: string; title: string }> = [];
    if (fallbackResult.hasMore) {
      fallbackButtons.push({ id: `view_all_expenses_month_all`, title: "📋 Ver todos" });
    }
    fallbackButtons.push({ id: `view_by_category_month`, title: "📊 Por categoria" });

    await sendButtons(phoneNumber, fallbackResult.message, fallbackButtons, messageSource);
  } else {
    const summaryFallback = await getMonthlySummaryInline(userId);
    await sendMessage(phoneNumber, summaryFallback, messageSource);
  }

  await updateConversationContext(userId, {
    currentTopic: "expenses",
    lastIntent: "query",
    lastTimeRange: "month",
    lastQueryScope: "expenses"
  });
}
