// ============================================================================
// 🗑️ INTENT: CANCEL ROUTING (Cancelar transação ou recorrente)
// ============================================================================

import { listTransactionsForCancel, cancelTransaction, getLastTransaction, findTransactionsByName } from "./cancel-handler.ts";
import { listActiveRecurrings, cancelRecurring, findRecurringByName } from "./recurring-handler.ts";
import { createAction } from "../fsm/action-manager.ts";
import { normalizeText } from "../utils/helpers.ts";

export async function handleCancelRouting(
  userId: string,
  slots: Record<string, any>,
  conteudoProcessado: string,
  messageId: string,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  const normalized = normalizeText(conteudoProcessado);

  // Handler de seleção inválida
  if (slots.error === "invalid_selection") {
    await sendMessage(phoneNumber, (slots.message as string) || "Escolha inválida 🤔", messageSource);
    return;
  }

  // Detectar se é cancelamento de recorrente (linguagem natural)
  const hasCancelVerb =
    normalized.includes("cancela") ||
    normalized.includes("cancelar") ||
    normalized.includes("parar") ||
    normalized.includes("para de cobrar") ||
    normalized.includes("deixar de pagar");

  const recurringHints = [
    "assinatura", "recorrente", "recorrencia", "mensal", "todo mes",
    "netflix", "spotify", "aluguel", "academia"
  ];

  const hasContextPronoun =
    normalized.includes("essa") ||
    normalized.includes("esse") ||
    normalized.includes("isso") ||
    normalized.includes("ultimo") ||
    normalized.includes("ultima");

  const isRecurringCancel = hasCancelVerb &&
    (recurringHints.some(h => normalized.includes(h)) || hasContextPronoun);

  // Extrair termo de busca de forma robusta (sem cortar na primeira palavra)
  const cancelPatterns = [
    /cancela(?:r)?\s+(?:a|o|os|as|meu|minha)?\s*(.+)/i,
    /para(?:r)?\s+(?:de\s+)?(?:cobrar|pagar)\s+(?:a|o|os|as)?\s*(.+)/i,
  ];

  let searchTerm = "";
  for (const pattern of cancelPatterns) {
    const matchResult = conteudoProcessado.match(pattern);
    if (matchResult && matchResult[1]) {
      searchTerm = matchResult[1]
        .trim()
        .replace(/[?.!,]+$/g, "")
        .replace(/\b(a|o|os|as|meu|minha|esse|essa|isso|isto|este|esta|aquele|aquela|recorrencia|recorrente|assinatura|gasto|despesa|ultimo|ultima)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      break;
    }
  }

  // ========================================================================
  // FAST PATH: Pronome contextual + hint de recorrência → cancelar mais recente
  // "cancela essa recorrência", "cancela essa assinatura", "cancela esse recorrente"
  // ========================================================================
  if (isRecurringCancel && hasContextPronoun && !searchTerm) {
    console.log(`🗑️ [CANCEL] Pronome contextual detectado → buscando recorrência mais recente`);
    const recorrentes = await listActiveRecurrings(userId);
    
    if (recorrentes.length === 0) {
      await sendMessage(phoneNumber, "Você não tem gastos recorrentes ativos para cancelar 🤔", messageSource);
      return;
    }
    
    // Cancelar a mais recente diretamente com confirmação
    const rec = recorrentes[0];
    await sendButtons(phoneNumber,
      `🔄 Cancelar *${rec.descricao}* (R$ ${Number(rec.valor_parcela).toFixed(2)}/mês)?`,
      [
        { id: "cancel_confirm_rec_yes", title: "✅ Sim, cancelar" },
        { id: "cancel_confirm_no", title: "❌ Não" }
      ],
      messageSource
    );
    await createAction(userId, "cancel_recurring", "cancel", { transaction_id: rec.id, options: [rec.id] }, "confirmation", messageId);
    return;
  }

  // Se parece cancelamento de recorrente OU tem termo de busca
  if (isRecurringCancel || searchTerm) {
    let recorrentes: any[] = [];
    let transacoes: any[] = [];

    if (searchTerm) {
      // Buscar em AMBOS: recorrentes E transações por nome
      recorrentes = await findRecurringByName(userId, searchTerm);
      transacoes = await findTransactionsByName(userId, searchTerm);
    }

    // Linguagem genérica sem pronome contextual e sem termo → listar recorrentes
    if (isRecurringCancel && !searchTerm && recorrentes.length === 0) {
      recorrentes = await listActiveRecurrings(userId);
    }

    // Se ainda não achou nada
    if (recorrentes.length === 0 && transacoes.length === 0) {
      const fallbackMsg = searchTerm
        ? `Não encontrei "${searchTerm}" nos seus gastos ou recorrentes 🤔`
        : "Você não tem gastos recorrentes nem transações recentes para cancelar 🤔";
      await sendMessage(phoneNumber, fallbackMsg, messageSource);
      return;
    }

    // Se só achou transações pontuais, mostrar essas
    if (recorrentes.length === 0 && transacoes.length > 0) {
      await _showTransactionCancelOptions(transacoes, userId, messageId, sendButtons, sendListMessage, phoneNumber, messageSource);
      return;
    }

    if (recorrentes.length === 1) {
      const rec = recorrentes[0];
      await sendButtons(phoneNumber,
        `🔄 Cancelar *${rec.descricao}* (R$ ${Number(rec.valor_parcela).toFixed(2)}/mês)?`,
        [
          { id: "cancel_confirm_rec_yes", title: "✅ Sim, cancelar" },
          { id: "cancel_confirm_no", title: "❌ Não" }
        ],
        messageSource
      );
      await createAction(userId, "cancel_recurring", "cancel", { transaction_id: rec.id, options: [rec.id] }, "confirmation", messageId);
      return;
    }

    // Múltiplos matches → usar botões/lista
    if (recorrentes.length <= 3) {
      const recButtons = recorrentes.map(r => ({
        id: `cancel_rec_${r.id}`,
        title: `${r.descricao}`.slice(0, 20)
      }));
      await sendButtons(phoneNumber, "Qual você quer cancelar?", recButtons, messageSource);
    } else {
      const sections = [{
        title: "Recorrentes",
        rows: recorrentes.map(r => ({
          id: `cancel_rec_${r.id}`,
          title: `${r.descricao}`.slice(0, 24),
          description: `R$ ${Number(r.valor_parcela).toFixed(2)}/mês`
        }))
      }];
      await sendListMessage(phoneNumber, "Qual você quer cancelar?", "Selecionar", sections, messageSource);
    }

    await createAction(userId, "cancel_recurring", "cancel_recurring", { options: recorrentes.map(r => r.id) }, "selection", messageId);
    return;
  }

  // Fallback: listar transações para cancelar
  const txs = await listTransactionsForCancel(userId);
  if (txs.length === 0) {
    await sendMessage(phoneNumber, "Você não tem transações para cancelar 🤔", messageSource);
    return;
  }

  await _showTransactionCancelOptions(txs, userId, messageId, sendButtons, sendListMessage, phoneNumber, messageSource);
}

// Helper interno para exibir opções de cancelamento de transação
async function _showTransactionCancelOptions(
  txs: any[],
  userId: string,
  messageId: string,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  if (txs.length <= 3) {
    const txButtons = txs.map(t => ({
      id: `cancel_tx_${t.id}`,
      title: `${t.descricao || t.categoria}`.slice(0, 20)
    }));
    await createAction(userId, "cancel_transaction", "cancel", { options: txs.map(t => t.id) }, "selection", messageId);
    await sendButtons(phoneNumber, "Qual transação cancelar?", txButtons, messageSource);
  } else {
    const sections = [{
      title: "Transações recentes",
      rows: txs.map(t => ({
        id: `cancel_tx_${t.id}`,
        title: `${t.descricao || t.categoria}`.slice(0, 24),
        description: `R$ ${t.valor?.toFixed(2)}`
      }))
    }];
    await createAction(userId, "cancel_transaction", "cancel", { options: txs.map(t => t.id) }, "selection", messageId);
    await sendListMessage(phoneNumber, "Qual transação cancelar?", "Selecionar", sections, messageSource);
  }
}
