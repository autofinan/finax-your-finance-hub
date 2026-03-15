import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PAYMENT_ALIASES, SOURCE_ALIASES, SLOT_PROMPTS, getMissingSlots } from "../ui/slot-prompts.ts";
import { updateAction, closeAction, createAction } from "../fsm/action-manager.ts";
import { registerExpense } from "../intents/expense.ts";
import { registerIncome } from "../intents/income.ts";
import { registerRecurring } from "../intents/recurring-handler.ts";
import { handleExpenseResult } from "../intents/expense-inline.ts";
import { listCardsForUser } from "../intents/card-queries.ts";
import type { ExtractedSlots } from "../decision/types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function handleExpenseResultCompat(
  result: { success: boolean; message: string; isDuplicate?: boolean },
  phone: string,
  source: string,
  sendMsg: (p: string, m: string, s: string) => Promise<void>,
  sendBtns: (p: string, t: string, b: Array<{ id: string; title: string }>, s: string) => Promise<void>
): Promise<void> {
  return handleExpenseResult(result, phone, source, sendMsg, sendBtns);
}

export async function handlePaymentCallbacks(
  buttonId: string,
  userId: string,
  activeAction: any,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string,
  messageId: string
): Promise<boolean> {
  const isPay = buttonId?.startsWith("pay_");
  const isSrc = buttonId?.startsWith("src_");
  const isRecPay = buttonId?.startsWith("rec_pay_");
  const isRecCard = buttonId?.startsWith("rec_card_");
  const isCard = buttonId?.startsWith("card_") || buttonId?.startsWith("select_card_");
  const isCardOthers = buttonId === "card_others";
  const isInstallment = buttonId === "installment_credito" || buttonId === "installment_boleto";
  const isLimit = buttonId === "limit_force_yes" || buttonId === "limit_other_card" || buttonId === "limit_cancel";
  const isPattern = buttonId === "pattern_confirm_yes" || buttonId === "pattern_confirm_no";

  if (!isPay && !isSrc && !isRecPay && !isRecCard && !isCard && !isCardOthers && !isInstallment && !isLimit && !isPattern) {
    return false;
  }

  // FORMA DE PAGAMENTO
  if (buttonId.startsWith("pay_")) {
    const paymentMethod = PAYMENT_ALIASES[buttonId];
    if (paymentMethod && activeAction && activeAction.intent === "expense") {
      const updatedSlots: Record<string, any> = { ...activeAction.slots, payment_method: paymentMethod };
      
      if (paymentMethod === "credito") {
        const { resolveCreditCard } = await import("../intents/credit-flow.ts");
        const creditResult = await resolveCreditCard(userId, updatedSlots);
        
        if (!creditResult.success) {
          if (creditResult.missingSlot === "card") {
            const slotsWithOptions = {
              ...updatedSlots,
              card_options: creditResult.cardOptions || []
            };
            await updateAction(activeAction.id, { slots: slotsWithOptions, pending_slot: "card" });
            
            if (creditResult.useListMessage && creditResult.listSections) {
              await sendListMessage(phoneNumber, creditResult.message, "Escolher cartão", creditResult.listSections, messageSource);
            } else if (creditResult.cardButtons) {
              await sendButtons(phoneNumber, creditResult.message, creditResult.cardButtons, messageSource);
            } else {
              await sendMessage(phoneNumber, creditResult.message, messageSource);
            }
            return true;
          }
          await sendMessage(phoneNumber, creditResult.message, messageSource);
          return true;
        }
        
        updatedSlots.card_id = creditResult.cardId;
        updatedSlots.fatura_id = creditResult.invoiceId;
        updatedSlots.card = creditResult.cardName;
        console.log(`💳 [BUTTON-CREDIT] Vinculado: ${creditResult.cardName}`);
      }
      
      const missing = getMissingSlots("expense", updatedSlots);
      
      if (missing.length === 0) {
        const result = await registerExpense(userId, updatedSlots, activeAction.id);
        
        const remainingExpenses = activeAction.slots?.remaining_expenses as Array<{amount: number; description: string; confidence?: number}> | undefined;
        
        if (remainingExpenses && remainingExpenses.length > 0) {
          const nextExpense = remainingExpenses[0];
          const nextRemaining = remainingExpenses.slice(1);
          
          console.log(`📦 [MULTI-QUEUE] Próximo gasto: R$ ${nextExpense.amount} - ${nextExpense.description} (restam ${nextRemaining.length})`);
          
          await supabase.from("actions")
            .update({ status: "done" })
            .eq("id", activeAction.id);
          
          await createAction(userId, "multi_expense_queue", "expense", {
            amount: nextExpense.amount,
            description: nextExpense.description,
            remaining_expenses: nextRemaining
          }, "payment_method", messageId);
          
          await handleExpenseResultCompat(result, phoneNumber, messageSource, sendMessage, sendButtons);
          await sendButtons(
            phoneNumber,
            `💸 R$ ${nextExpense.amount.toFixed(2)} - ${nextExpense.description}\n\nComo você pagou?`,
            SLOT_PROMPTS.payment_method.buttons!,
            messageSource
          );
          return true;
        }
        
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input"]);
        await handleExpenseResultCompat(result, phoneNumber, messageSource, sendMessage, sendButtons);
        console.log(`✅ [BUTTON] Expense registrado, todas actions fechadas`);
        return true;
      }
      
      await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
      const prompt = SLOT_PROMPTS[missing[0]];
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(phoneNumber, prompt.text, prompt.buttons, messageSource);
      } else {
        await sendMessage(phoneNumber, prompt?.text || "Continue...", messageSource);
      }
      return true;
    }
  }
  
  // SOURCE DE ENTRADA
  if (buttonId.startsWith("src_")) {
    const source = SOURCE_ALIASES[buttonId];
    if (source && activeAction && activeAction.intent === "income") {
      const updatedSlots: ExtractedSlots = { ...activeAction.slots, source };
      
      if (!updatedSlots.amount) {
        await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "amount" });
        await sendMessage(phoneNumber, SLOT_PROMPTS.amount_income.text, messageSource);
        return true;
      }
      
      const result = await registerIncome(userId, updatedSlots, activeAction.id);
      await supabase.from("actions")
        .update({ status: "done" })
        .eq("user_id", userId)
        .in("status", ["collecting", "awaiting_input"]);
      await sendMessage(phoneNumber, result.message, messageSource);
      console.log(`✅ [BUTTON] Income registrado, todas actions fechadas`);
      return true;
    }
  }

  // SELEÇÃO DE CARTÃO PARA RECURRING
  if (buttonId.startsWith("rec_card_") && activeAction) {
    const cardId = buttonId.replace("rec_card_", "");
    
    const { data: card } = await supabase
      .from("cartoes_credito")
      .select("*")
      .eq("id", cardId)
      .single();
    
    if (card && activeAction.intent === "recurring") {
      const updatedSlots = { 
        ...activeAction.slots, 
        card: card.nome,
        card_id: card.id
      };
      
      const result = await registerRecurring(userId, updatedSlots, activeAction.id);
      await sendMessage(phoneNumber, result.message, messageSource);
      return true;
    }
  }
  
  // PAGAMENTO DE RECORRENTE
  if (buttonId.startsWith("rec_pay_") && activeAction?.intent === "recurring") {
    const paymentAliases: Record<string, string> = {
      "rec_pay_pix": "pix",
      "rec_pay_debito": "debito",
      "rec_pay_credito": "credito",
      "rec_pay_dinheiro": "dinheiro"
    };
    const paymentMethod = paymentAliases[buttonId];
    
    if (paymentMethod) {
      const updatedSlots: ExtractedSlots = { ...activeAction.slots, payment_method: paymentMethod };
      
      if (paymentMethod === "credito") {
        const cards = await listCardsForUser(userId);
        if (cards.length > 1) {
          const cardButtons = cards.slice(0, 3).map((c) => ({
            id: `rec_card_${c.id}`,
            title: (c.nome || "Cartão").slice(0, 20)
          }));
          
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "card" });
          await sendButtons(
            phoneNumber,
            `🔄 ${updatedSlots.description || "Recorrente"} - R$ ${updatedSlots.amount?.toFixed(2)}/mês\n\nQual cartão?`,
            cardButtons,
            messageSource
          );
          return true;
        } else if (cards.length === 1) {
          updatedSlots.card = cards[0].nome;
          updatedSlots.card_id = cards[0].id;
        }
      }
      
      const result = await registerRecurring(userId, updatedSlots, activeAction.id);
      await sendMessage(phoneNumber, result.message, messageSource);
      return true;
    }
  }

  // BOTÃO "OUTROS" - Mostrar lista completa de cartões
  if (buttonId === "card_others") {
    console.log(`📋 [BUTTON] Mostrar todos os cartões via lista`);
    
    if (!activeAction) {
      await sendMessage(phoneNumber, "Ops, perdi o contexto 😕\nTenta novamente?", messageSource);
      return true;
    }
    
    const { listUserCards } = await import("../intents/credit-flow.ts");
    const allCards = await listUserCards(userId);
    
    if (allCards.length === 0) {
      await sendMessage(phoneNumber, "Nenhum cartão encontrado 🤔", messageSource);
      return true;
    }
    
    const sections = [{
      title: "Seus cartões",
      rows: allCards.map(c => {
        const disponivel = c.limite_disponivel ?? c.limite_total ?? 0;
        return {
          id: `card_${c.id}`,
          title: (c.nome || "Cartão").slice(0, 24),
          description: `Disponível: R$ ${disponivel.toFixed(2)}`
        };
      })
    }];
    
    await sendListMessage(phoneNumber, "💳 Escolha um cartão:", "Selecionar cartão", sections, messageSource);
    return true;
  }
  
  // SELEÇÃO DE CARTÃO VIA LISTA/BOTÃO (select_card_ / card_)
  if (buttonId?.startsWith("select_card_") || buttonId?.startsWith("card_")) {
    if (buttonId === "card_others") return true; // já tratado
    
    const cardId = buttonId.replace("select_card_", "").replace("card_", "");
    console.log(`💳 [BUTTON] Cartão selecionado via lista: ${cardId}`);
    
    if (!activeAction) {
      await sendMessage(phoneNumber, "Ops, perdi o contexto 😕\nTenta novamente?", messageSource);
      return true;
    }
    
    const { data: selectedCard } = await supabase
      .from("cartoes_credito")
      .select("*")
      .eq("id", cardId)
      .single();
    
    if (!selectedCard) {
      await sendMessage(phoneNumber, "Cartão não encontrado 🤔", messageSource);
      return true;
    }
    
    const updatedSlots = {
      ...activeAction.slots,
      card: selectedCard.nome,
      card_id: cardId
    };
    
    if (activeAction.intent === "expense") {
      const result = await registerExpense(userId, updatedSlots as ExtractedSlots, activeAction.id, activeAction.id);
      await supabase.from("actions").update({ status: "done" }).eq("id", activeAction.id);
      await handleExpenseResultCompat(result, phoneNumber, messageSource, sendMessage, sendButtons);
      return true;
    } else if (activeAction.intent === "recurring") {
      const result = await registerRecurring(userId, updatedSlots, activeAction.id);
      await sendMessage(phoneNumber, result.message, messageSource);
      return true;
    } else if (activeAction.intent === "installment") {
      const { registerInstallment } = await import("../intents/installment.ts");
      const result = await registerInstallment(userId, updatedSlots as any, activeAction.id);
      await sendMessage(phoneNumber, result.message, messageSource);
      return true;
    }
  }

  // LIMITE INSUFICIENTE - Handlers
  if (buttonId === "limit_force_yes" && activeAction?.intent === "expense") {
    const result = await registerExpense(userId, activeAction.slots as ExtractedSlots, activeAction.id, activeAction.id);
    await supabase.from("actions").update({ status: "done" }).eq("id", activeAction.id);
    await handleExpenseResultCompat(result, phoneNumber, messageSource, sendMessage, sendButtons);
    return true;
  }
  
  if (buttonId === "limit_other_card" && activeAction?.intent === "expense") {
    const cards = await listCardsForUser(userId);
    if (cards.length <= 1) {
      await sendMessage(phoneNumber, "Você só tem um cartão cadastrado 💳", messageSource);
      return true;
    }
    const cardButtons = cards.slice(0, 3).map(c => ({
      id: `card_${c.id}`,
      title: (c.nome || "Cartão").slice(0, 20)
    }));
    const slotsClean = { ...activeAction.slots, card: undefined, card_id: undefined };
    await updateAction(activeAction.id, { slots: slotsClean, pending_slot: "card" });
    await sendButtons(phoneNumber, "💳 Qual cartão quer usar?", cardButtons, messageSource);
    return true;
  }
  
  if (buttonId === "limit_cancel") {
    if (activeAction) await closeAction(activeAction.id);
    await sendMessage(phoneNumber, "Ok, cancelado! 👍", messageSource);
    return true;
  }
  
  // INSTALLMENT PAYMENT METHOD HANDLERS (boleto vs cartão)
  if (buttonId === "installment_credito") {
    if (activeAction?.intent === "installment") {
      const updatedSlots = { ...activeAction.slots, payment_method: "credito" };
      await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "card" });
      
      const { listUserCards } = await import("../intents/credit-flow.ts");
      const cards = await listUserCards(userId);
      
      if (cards.length === 0) {
        await sendMessage(phoneNumber, "Você não tem cartões cadastrados 💳\n\nAdicione um: *Adicionar cartão Nubank limite 5000*", messageSource);
      } else if (cards.length <= 3) {
        const cardButtons = cards.map(c => ({ id: `card_${c.id}`, title: (c.nome || "Cartão").slice(0, 20) }));
        await sendButtons(phoneNumber, "💳 Qual cartão?", cardButtons, messageSource);
      } else {
        const sections = [{ title: "Seus cartões", rows: cards.map(c => ({ id: `card_${c.id}`, title: (c.nome || "Cartão").slice(0, 24), description: `Disponível: R$ ${(c.limite_disponivel ?? 0).toFixed(2)}` })) }];
        await sendListMessage(phoneNumber, "💳 Qual cartão?", "Selecionar cartão", sections, messageSource);
      }
    }
    return true;
  }
  
  if (buttonId === "installment_boleto") {
    if (activeAction?.intent === "installment") {
      const slotsWithBoleto: Record<string, any> = { ...activeAction.slots, payment_method: "boleto" };
      
      const valorTotal = Number(slotsWithBoleto.amount || 0);
      const numParcelas = Number(slotsWithBoleto.installments || 1);
      const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
      const { getBrasiliaISO } = await import("../utils/date-helpers.ts");
      const { dateISO, timeString } = getBrasiliaISO();
      
      let category = slotsWithBoleto.category || "outros";
      if (slotsWithBoleto.description && !slotsWithBoleto.category) {
        const { categorizeDescription } = await import("../ai/categorizer.ts");
        const catResult = await categorizeDescription(slotsWithBoleto.description);
        category = catResult.category;
      }
      
      await supabase.from("transacoes").insert({
        usuario_id: userId, valor: valorParcela, tipo: "saida", categoria: category,
        descricao: `${slotsWithBoleto.description || "Parcelado boleto"} (1/${numParcelas})`,
        data: dateISO, data_transacao: dateISO, hora_transacao: timeString,
        origem: "whatsapp", forma_pagamento: "boleto", status: "confirmada",
        parcela: `1/${numParcelas}`, is_parcelado: true, total_parcelas: numParcelas
      });
      
      await supabase.from("parcelamentos").insert({
        usuario_id: userId, descricao: slotsWithBoleto.description || "Parcelamento boleto",
        valor_total: valorTotal, num_parcelas: numParcelas, parcela_atual: 1,
        valor_parcela: valorParcela, ativa: true,
      });
      
      await closeAction(activeAction.id);
      
      await sendMessage(phoneNumber, 
        `✅ *Parcelamento no boleto registrado!*\n\n` +
        `📦 *${slotsWithBoleto.description || "Compra"}*\n` +
        `💰 R$ ${valorTotal.toFixed(2)} em *${numParcelas}x* de R$ ${valorParcela.toFixed(2)}\n` +
        `📄 Pagamento: Boleto`,
        messageSource
      );
    }
    return true;
  }
  
  // PATTERN CONFIRMATION HANDLERS (cartão aprendido)
  if (buttonId === "pattern_confirm_yes") {
    console.log(`✅ [PATTERN] Usuário confirmou padrão de cartão`);
    if (activeAction) {
      const patternId = (activeAction.meta as any)?.patternId;
      if (patternId) {
        const { confirmPattern } = await import("../memory/patterns.ts");
        await confirmPattern(patternId);
      }
      const result = await registerExpense(userId, activeAction.slots as ExtractedSlots, activeAction.id);
      await handleExpenseResultCompat(result, phoneNumber, messageSource, sendMessage, sendButtons);
    } else {
      await sendMessage(phoneNumber, "Ops, perdi o contexto. Tenta de novo? 😕", messageSource);
    }
    return true;
  }
  
  if (buttonId === "pattern_confirm_no") {
    console.log(`❌ [PATTERN] Usuário rejeitou padrão de cartão`);
    if (activeAction) {
      const patternId = (activeAction.meta as any)?.patternId;
      if (patternId) {
        const { rejectPattern } = await import("../memory/patterns.ts");
        await rejectPattern(patternId);
      }
      const slotsWithoutCard = { ...activeAction.slots } as any;
      delete slotsWithoutCard.card_id;
      delete slotsWithoutCard.card;
      
      await supabase.from("actions")
        .update({ slots: slotsWithoutCard })
        .eq("id", activeAction.id);
      
      const { listUserCards } = await import("../intents/credit-flow.ts");
      const allCards = await listUserCards(userId);
      
      if (allCards.length <= 3) {
        const cardButtons = allCards.map(c => ({
          id: `card_${c.id}`,
          title: (c.nome || "Cartão").slice(0, 20)
        }));
        await sendButtons(phoneNumber, "💳 Em qual cartão foi?", cardButtons, messageSource);
      } else {
        const sections = [{
          title: "Seus cartões",
          rows: allCards.map(c => ({
            id: `card_${c.id}`,
            title: (c.nome || "Cartão").slice(0, 24),
            description: `Disponível: R$ ${(c.limite_disponivel ?? c.limite_total ?? 0).toFixed(2)}`
          }))
        }];
        await sendListMessage(phoneNumber, "💳 Em qual cartão foi?", "Selecionar cartão", sections, messageSource);
      }
    } else {
      await sendMessage(phoneNumber, "Ops, perdi o contexto. Tenta de novo? 😕", messageSource);
    }
    return true;
  }

  return false;
}
