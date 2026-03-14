import { listTransactionsForCancel, cancelTransaction, getLastTransaction } from "./cancel-handler.ts";
import { listActiveRecurrings, cancelRecurring } from "./recurring-handler.ts";

export async function handleCancelRouting(
  userId: string,
  slots: Record<string, any>,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  // ========================================================================
      // 🔢 HANDLER DE SELEÇÃO INVÁLIDA
      // ========================================================================
      if (decision.slots.error === "invalid_selection") {
        await sendMessage(payload.phoneNumber, decision.slots.message as string || "Escolha inválida 🤔", payload.messageSource);
        return;
      }
      
      // Detectar se é cancelamento de recorrente
      const isRecurringCancel = normalized.includes("cancela") && 
        (normalized.includes("assinatura") || normalized.includes("recorrente") ||
         normalized.includes("netflix") || normalized.includes("spotify") ||
         normalized.includes("aluguel") || normalized.includes("academia") ||
         normalized.includes("mensal") || normalized.includes("todo mes") ||
         normalized.includes("para de cobrar") || normalized.includes("parar"));
      
      // Extrair termo de busca
      const cancelPatterns = [
        /cancela(?:r)?\s+(?:a|o|meu|minha)?\s*(.+)/i,
        /para(?:r)?\s+(?:de\s+)?(?:cobrar|pagar)\s+(?:a|o)?\s*(.+)/i,
      ];
      
      let searchTerm = "";
      for (const pattern of cancelPatterns) {
        const matchResult = conteudoProcessado.match(pattern);
        if (matchResult && matchResult[1]) {
          searchTerm = matchResult[1].trim().split(" ")[0]; // Primeira palavra
          break;
        }
      }
      
      // Se parece cancelamento de recorrente OU tem termo de busca
      if (isRecurringCancel || searchTerm) {
        let recorrentes: any[] = [];
        
        if (searchTerm) {
          recorrentes = await findRecurringByName(userId, searchTerm);
        }
        
        if (recorrentes.length === 0) {
          recorrentes = await listActiveRecurrings(userId);
        }
        
        if (recorrentes.length === 0) {
          // Fallback: tentar transações
          const txs = await listTransactionsForCancel(userId);
          if (txs.length === 0) {
            await sendMessage(payload.phoneNumber, "Você não tem gastos recorrentes nem transações recentes para cancelar 🤔", payload.messageSource);
            return;
          }
          // Usar botões/lista para transações
          if (txs.length <= 3) {
            const txButtons = txs.map(t => ({
              id: `cancel_tx_${t.id}`,
              title: `${t.descricao || t.categoria}`.slice(0, 20)
            }));
            await createAction(userId, "cancel_transaction", "cancel", 
              { options: txs.map(t => t.id) }, "selection", payload.messageId);
            await sendButtons(payload.phoneNumber, "Qual transação cancelar?", txButtons, payload.messageSource);
          } else {
            const sections = [{
              title: "Transações recentes",
              rows: txs.map(t => ({
                id: `cancel_tx_${t.id}`,
                title: `${t.descricao || t.categoria}`.slice(0, 24),
                description: `R$ ${t.valor?.toFixed(2)}`
              }))
            }];
            await createAction(userId, "cancel_transaction", "cancel", 
              { options: txs.map(t => t.id) }, "selection", payload.messageId);
            await sendListMessage(payload.phoneNumber, "Qual transação cancelar?", "Selecionar", sections, payload.messageSource);
          }
          return;
        }
        
        if (recorrentes.length === 1) {
          // Match único → pedir confirmação com botões
          const rec = recorrentes[0];
          await sendButtons(payload.phoneNumber,
            `🔄 Cancelar *${rec.descricao}* (R$ ${Number(rec.valor_parcela).toFixed(2)}/mês)?`,
            [
              { id: "cancel_confirm_rec_yes", title: "✅ Sim, cancelar" },
              { id: "cancel_confirm_no", title: "❌ Não" }
            ],
            payload.messageSource
          );
          await createAction(userId, "cancel_recurring", "cancel", 
            { transaction_id: rec.id, options: [rec.id] }, "confirmation", payload.messageId);
          return;
        }
        
        // Múltiplos matches → usar botões/lista
        if (recorrentes.length <= 3) {
          const recButtons = recorrentes.map(r => ({
            id: `cancel_rec_${r.id}`,
            title: `${r.descricao}`.slice(0, 20)
          }));
          await sendButtons(payload.phoneNumber, "Qual você quer cancelar?", recButtons, payload.messageSource);
        } else {
          const sections = [{
            title: "Recorrentes",
            rows: recorrentes.map(r => ({
              id: `cancel_rec_${r.id}`,
              title: `${r.descricao}`.slice(0, 24),
              description: `R$ ${Number(r.valor_parcela).toFixed(2)}/mês`
            }))
          }];
          await sendListMessage(payload.phoneNumber, "Qual você quer cancelar?", "Selecionar", sections, payload.messageSource);
        }
        
        // Salvar seleção pendente
        await createAction(userId, "cancel_recurring", "cancel_recurring", 
          { options: recorrentes.map(r => r.id) }, "selection", payload.messageId);
        return;
      }
      
      // Fallback: listar transações para cancelar
      const txs = await listTransactionsForCancel(userId);
      
      if (txs.length === 0) {
        await sendMessage(payload.phoneNumber, "Você não tem transações para cancelar 🤔", payload.messageSource);
        return;
      }
      
      // ✅ BLOCO 6: Usar botões/lista em vez de texto numerado
      if (txs.length <= 3) {
        const txButtons = txs.map(t => ({
          id: `cancel_tx_${t.id}`,
          title: `${t.descricao || t.categoria}`.slice(0, 20)
        }));
        await createAction(userId, "cancel_transaction", "cancel", 
          { options: txs.map(t => t.id) }, "selection", payload.messageId);
        await sendButtons(payload.phoneNumber, "Qual transação cancelar?", txButtons, payload.messageSource);
      } else {
        const sections = [{
          title: "Transações recentes",
          rows: txs.map(t => ({
            id: `cancel_tx_${t.id}`,
            title: `${t.descricao || t.categoria}`.slice(0, 24),
            description: `R$ ${t.valor?.toFixed(2)}`
          }))
        }];
        await createAction(userId, "cancel_transaction", "cancel", 
          { options: txs.map(t => t.id) }, "selection", payload.messageId);
        await sendListMessage(payload.phoneNumber, "Qual transação cancelar?", "Selecionar", sections, payload.messageSource);
      }
      return;
    }
    
    // 📊 QUERY - COM QUERIES ANALÍTICAS (v3.2: ROTEAMENTO POR SCOPE)
    if (decision.actionType === "query") {
      const normalized = normalizeText(conteudoProcessado);
      
      // ========================================================================
      // v3.2: ROTEAMENTO PRIORITÁRIO POR query_scope DA IA
      // ========================================================================
      let queryScope = decision.slots.query_scope || detectQueryScope(normalized);
      const timeRange = decision.slots.time_range || detectTimeRange(normalized);
      
      // 🔧 FIX: "detalhe entradas" deve rotear para income, não para expense
      if ((normalized.includes("detalhe") || normalized.includes("detalha")) && 
          (normalized.includes("entrada") || normalized.includes("entrou") || normalized.includes("recebi"))) {
        queryScope = "income";
        console.log(`📊 [QUERY] FIX: "detalhe entradas" → roteando para INCOME`);
      }
      
      // 🔧 FIX: "detalhe [categoria]" deve filtrar por categoria
      const KNOWN_CATEGORIES = ["alimentacao", "alimentação", "transporte", "moradia", "lazer", "saude", "saúde", "educacao", "educação", "mercado", "servicos", "serviços", "outros", "compras"];
      if ((normalized.includes("detalhe") || normalized.includes("detalha") || normalized.includes("detalhar")) && !decision.slots.category) {
        for (const cat of KNOWN_CATEGORIES) {
          const catNorm = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (normalized.includes(catNorm)) {
            // Normalizar para formato do banco (sem acentos)
            decision.slots.category = catNorm;
            queryScope = "expenses";
            console.log(`📊 [QUERY] FIX: "detalhe ${cat}" → roteando para EXPENSES com category=${catNorm}`);
            break;
          }
        }
      }
      
      console.log(`📊 [QUERY] Scope: ${queryScope}, TimeRange: ${timeRange}`);
      
      // Importar funções de query
      const { getWeeklyExpenses, getTodayExpenses, listPendingExpenses, getExpensesByCategory, getMonthlySummary } = await import("./intents/query.ts");
      
      // 💬 Atualizar contexto conversacional para referências futuras
      await updateConversationContext(userId, {
        currentTopic: scopeToTopic(queryScope as string),
        lastIntent: "query",
        lastTimeRange: timeRange as string,
        lastQueryScope: queryScope as string
      });
      
      switch (queryScope) {
}
