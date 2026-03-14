import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SLOT_PROMPTS } from "../ui/slot-prompts.ts";
import { updateAction, closeAction, createAction, cancelAction } from "../fsm/action-manager.ts";
import { registerExpense } from "../intents/expense.ts";
import { registerIncome } from "../intents/income.ts";
import { registerRecurring, cancelRecurring } from "../intents/recurring-handler.ts";
import { cancelTransaction, updateTransactionPaymentMethod } from "../intents/cancel-handler.ts";
import { handleExpenseResult } from "../intents/expense-inline.ts";
import { listCardsForUser } from "../intents/card-queries.ts";
import type { ExtractedSlots } from "../decision/ai-engine.ts";

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

export async function handleButtonCallbacks(
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

  // ====================================================================
  // ✅ CONFIRMAÇÃO VIA BOTÃO (confirm_yes / confirm_no)
  // ====================================================================
  if (buttonId === "confirm_yes" && activeAction && activeAction.status === "awaiting_confirmation") {
    console.log(`✅ [BUTTON] Confirmação recebida para ${activeAction.intent}`);
    
    const slots = activeAction.slots as ExtractedSlots;
    let result: { message: string; success?: boolean };
    
    switch (activeAction.intent) {
      case "expense":
        result = await registerExpense(userId, slots, activeAction.id);
        break;
      case "income":
        result = await registerIncome(userId, slots, activeAction.id);
        break;
      case "recurring":
        result = await registerRecurring(userId, slots, activeAction.id);
        break;
      case "installment": {
        const { registerInstallment } = await import("../intents/installment.ts");
        const installResult = await registerInstallment(userId, slots as any, activeAction.id);
        
        if (installResult.needsCardSelection && installResult.cardButtons) {
          console.log(`💳 [INSTALLMENT] Precisa selecionar cartão após confirmação`);
          await updateAction(activeAction.id, { 
            slots: { ...slots }, 
            pending_slot: "card",
            status: "collecting"
          });
          
          if (installResult.cardButtons.length <= 3) {
            await sendButtons(phoneNumber, installResult.message, installResult.cardButtons, messageSource);
          } else {
            const sections = [{
              title: "Seus cartões",
              rows: installResult.cardButtons.map(c => ({
                id: c.id,
                title: c.title
              }))
            }];
            await sendListMessage(phoneNumber, installResult.message, "Selecionar cartão", sections, messageSource);
          }
          return true;
        }
        
        result = installResult;
        break;
      }
      case "add_card": {
        const { createCard } = await import("../intents/card.ts");
        result = await createCard(userId, slots as any);
        break;
      }
      case "bill": {
        const { createBill } = await import("../intents/bills.ts");
        const billResult = await createBill({
          userId,
          nome: slots.bill_name || slots.description || "Conta",
          diaVencimento: Number(slots.due_day || 1),
          valorEstimado: slots.estimated_value ? Number(slots.estimated_value) : undefined,
          tipo: "fixa"
        });
        result = { message: billResult, success: true };
        break;
      }
      case "numero_isolado": {
        const typeChoice = slots.type_choice || slots.original_intent;
        if (typeChoice === "income") {
          result = await registerIncome(userId, slots, activeAction.id);
        } else {
          result = await registerExpense(userId, slots, activeAction.id);
        }
        break;
      }
      default:
        result = { message: "✅ Feito!", success: true };
    }
    
    await supabase.from("actions")
      .update({ status: "done" })
      .eq("user_id", userId)
      .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
    
    if ((result as any).isDuplicate) {
      await handleExpenseResultCompat(result as any, phoneNumber, messageSource, sendMessage, sendButtons);
    } else {
      await sendMessage(phoneNumber, result.message, messageSource);
    }
    return true;
  }
  
  if (buttonId === "confirm_no" && activeAction) {
    await cancelAction(userId);
    await sendMessage(phoneNumber, "👍 Cancelado!", messageSource);
    return true;
  }

  // ====================================================================
  // 📦 MÚLTIPLOS GASTOS - Separado ou Junto
  // ====================================================================
  if (buttonId === "multi_separado" && activeAction?.intent === "multi_expense") {
    const detectedExpenses = activeAction.slots.detected_expenses as Array<{amount: number; description: string}>;
    console.log(`📦 [MULTI] Registrando ${detectedExpenses?.length} gastos separadamente`);
    
    if (!detectedExpenses || detectedExpenses.length === 0) {
      await closeAction(activeAction.id);
      await sendMessage(phoneNumber, "Ops, perdi os dados. Pode repetir?", messageSource);
      return true;
    }
    
    const firstExpense = detectedExpenses[0];
    await closeAction(activeAction.id);
    await createAction(userId, "multi_expense_queue", "expense", { 
      amount: firstExpense.amount,
      description: firstExpense.description,
      remaining_expenses: detectedExpenses.slice(1)
    }, "payment_method", messageId);
    
    await sendButtons(
      phoneNumber,
      `💸 R$ ${firstExpense.amount.toFixed(2)} - ${firstExpense.description}\n\nComo você pagou?`,
      SLOT_PROMPTS.payment_method.buttons!,
      messageSource
    );
    return true;
  }
  
  if (buttonId === "multi_junto" && activeAction?.intent === "multi_expense") {
    const total = activeAction.slots.total as number;
    const originalMessage = activeAction.slots.original_message as string;
    console.log(`📦 [MULTI] Registrando tudo junto: R$ ${total}`);
    
    await closeAction(activeAction.id);
    await createAction(userId, "expense", "expense", { 
      amount: total,
      description: originalMessage?.slice(0, 50) || "Múltiplos itens"
    }, "payment_method", messageId);
    
    await sendButtons(
      phoneNumber,
      `💸 R$ ${total.toFixed(2)}\n\nComo você pagou?`,
      SLOT_PROMPTS.payment_method.buttons!,
      messageSource
    );
    return true;
  }

  // ====================================================================
  // 🎯 HANDLER ONBOARDING BUTTONS (onb_start, onb_plan)
  // ====================================================================
  if (buttonId === "onb_start") {
    await sendMessage(phoneNumber,
      `🚀 *Vamos lá!*\n\nÉ simples, me manda:\n\n• *"Gastei 50 no mercado"* — registro rápido\n• *"Quanto gastei?"* — resumo do mês\n• *"Orçamento 2000"* — definir limite\n• *"Me ajuda"* — ver tudo que posso fazer\n\nBora começar? Me conta seu primeiro gasto! 💪`,
      messageSource
    );
    return true;
  }
  
  if (buttonId === "onb_plan") {
    const { data: onbData } = await supabase
      .from("user_onboarding")
      .select("main_problem, problem_details, financial_state")
      .eq("user_id", userId)
      .single();
    
    let planMsg = `📋 *Seu Plano no Finax*\n\n`;
    if (onbData?.main_problem === "prob_debt") {
      planMsg += `🎯 Objetivo: Sair da dívida\n`;
      if (onbData.problem_details?.amount) planMsg += `💳 Valor: R$ ${onbData.problem_details.amount}\n`;
    } else if (onbData?.main_problem === "goal_save") {
      planMsg += `🎯 Objetivo: Juntar grana\n`;
      if (onbData.problem_details?.text) planMsg += `📌 Para: ${onbData.problem_details.text}\n`;
    } else if (onbData?.main_problem === "prob_overspend") {
      planMsg += `🎯 Objetivo: Gastar menos do que ganha\n`;
    } else {
      planMsg += `🎯 Objetivo: Organizar suas finanças\n`;
    }
    planMsg += `\n📱 Comece registrando seus gastos diários!\nMe manda: *"Gastei X no Y"*`;
    await sendMessage(phoneNumber, planMsg, messageSource);
    return true;
  }
  
  // ====================================================================
  // 🛡️ GUARD: BOTÃO EXPIRADO (sem contexto ativo)
  // ====================================================================
  if (!activeAction) {
    console.log(`⏰ [EXPIRED_BUTTON] Botão clicado sem contexto ativo: ${buttonId}`);
    
    if (buttonId === "word_gasto" || buttonId === "word_consulta") {
      await sendMessage(phoneNumber, 
        "⏰ Ops, demorei demais e perdi o contexto!\n\nPode repetir o que você quer registrar ou consultar?", 
        messageSource
      );
      return true;
    }
    
    if (buttonId === "num_gasto" || buttonId === "num_entrada") {
      await sendMessage(phoneNumber, 
        "⏰ Hmm, perdi o fio da meada!\n\nPode mandar o valor de novo?", 
        messageSource
      );
      return true;
    }
    
    // Don't return true for unknown buttons without context - let them fall through
    return false;
  }
  
  // ✏️ EDIT - Correção de forma de pagamento OU cartão
  if (buttonId.startsWith("edit_") && activeAction?.intent === "edit") {
    if (buttonId.startsWith("edit_card_")) {
      const editCardId = buttonId.replace("edit_card_", "");
      const { data: editCard } = await supabase
        .from("cartoes_credito")
        .select("id, nome")
        .eq("id", editCardId)
        .single();
      
      if (editCard && activeAction.slots.transaction_id) {
        await supabase.from("transacoes")
          .update({ cartao_id: editCard.id, forma_pagamento: "credito" })
          .eq("id", activeAction.slots.transaction_id);
        await closeAction(activeAction.id);
        await sendMessage(phoneNumber, 
          `✅ *Corrigido!*\n\n💳 Agora está no *${editCard.nome}*`,
          messageSource);
        return true;
      }
    }
    
    if (buttonId === "edit_credito" && activeAction.slots.transaction_id) {
      const editCards = await listCardsForUser(userId);
      if (editCards.length > 1) {
        if (editCards.length <= 3) {
          const cardBtns = editCards.map(c => ({
            id: `edit_card_${c.id}`,
            title: (c.nome || "Cartão").slice(0, 20)
          }));
          await updateAction(activeAction.id, { pending_slot: "card" });
          await sendButtons(phoneNumber, "💳 Qual cartão?", cardBtns, messageSource);
        } else {
          const sections = [{
            title: "Seus cartões",
            rows: editCards.map(c => ({
              id: `edit_card_${c.id}`,
              title: (c.nome || "Cartão").slice(0, 24)
            }))
          }];
          await updateAction(activeAction.id, { pending_slot: "card" });
          await sendListMessage(phoneNumber, "💳 Qual cartão?", "Selecionar", sections, messageSource);
        }
        return true;
      } else if (editCards.length === 1) {
        await supabase.from("transacoes")
          .update({ forma_pagamento: "credito", cartao_id: editCards[0].id })
          .eq("id", activeAction.slots.transaction_id);
        await closeAction(activeAction.id);
        await sendMessage(phoneNumber, 
          `✅ *Corrigido!*\n\n💳 Agora é crédito no *${editCards[0].nome}*`,
          messageSource);
        return true;
      }
    }
    
    const editAliases: Record<string, string> = {
      "edit_pix": "pix",
      "edit_debito": "debito",
      "edit_dinheiro": "dinheiro",
      "edit_credito": "credito"
    };
    const newMethod = editAliases[buttonId];
    
    if (newMethod && activeAction.slots.transaction_id) {
      const result = await updateTransactionPaymentMethod(activeAction.slots.transaction_id, newMethod);
      await closeAction(activeAction.id);
      await sendMessage(phoneNumber, result.message, messageSource);
      return true;
    }
  }

  // ========================================================================
  // 🔤 PALAVRA SOLTA - GASTO
  // ========================================================================
  if (buttonId === "word_gasto" && activeAction?.intent === "clarify_word") {
    const possibleDesc = activeAction.slots.possible_description || "";
    console.log(`🔤 [BUTTON] Palavra "${possibleDesc}" é um GASTO`);
    
    await closeAction(activeAction.id);
    await createAction(userId, "expense", "expense", { description: possibleDesc }, "amount", messageId);
    await sendMessage(phoneNumber, `💸 ${possibleDesc}\n\nQual foi o valor?`, messageSource);
    return true;
  }
  
  // ========================================================================
  // 🔤 PALAVRA SOLTA - CONSULTA
  // ========================================================================
  if (buttonId === "word_consulta" && activeAction?.intent === "clarify_word") {
    const possibleDesc = activeAction.slots.possible_description || "";
    console.log(`🔤 [BUTTON] Palavra "${possibleDesc}" é uma CONSULTA`);
    
    await closeAction(activeAction.id);
    
    const { data: relatedTx } = await supabase
      .from("transacoes")
      .select("valor, categoria, descricao, data")
      .eq("usuario_id", userId)
      .eq("status", "confirmada")
      .ilike("descricao", `%${possibleDesc}%`)
      .order("data", { ascending: false })
      .limit(5);
    
    if (relatedTx && relatedTx.length > 0) {
      const total = relatedTx.reduce((sum, t) => sum + Number(t.valor), 0);
      const list = relatedTx.map(t => 
        `💸 R$ ${Number(t.valor).toFixed(2)} - ${new Date(t.data).toLocaleDateString("pt-BR")}`
      ).join("\n");
      
      await sendMessage(phoneNumber, 
        `📊 *Gastos com "${possibleDesc}"*\n\n${list}\n\n💰 Total: R$ ${total.toFixed(2)}`,
        messageSource
      );
    } else {
      await sendMessage(phoneNumber, 
        `Não encontrei gastos com "${possibleDesc}" 🤔\n\nSe quiser registrar, manda o valor!`,
        messageSource
      );
    }
    return true;
  }

  // CONFIRMAR CANCELAMENTO
  if (buttonId === "cancel_confirm_yes" && activeAction?.slots?.transaction_id) {
    const result = await cancelTransaction(userId, activeAction.slots.transaction_id);
    await closeAction(activeAction.id);
    await sendMessage(phoneNumber, result.message, messageSource);
    return true;
  }
  
  if (buttonId === "cancel_confirm_rec_yes" && activeAction?.slots?.transaction_id) {
    const result = await cancelRecurring(userId, activeAction.slots.transaction_id);
    await closeAction(activeAction.id);
    await sendMessage(phoneNumber, result.message, messageSource);
    return true;
  }
  
  if (buttonId === "cancel_confirm_no") {
    if (activeAction) await closeAction(activeAction.id);
    await sendMessage(phoneNumber, "Ok, mantido! 👍", messageSource);
    return true;
  }
  
  // SELEÇÃO DE RECORRENTE PARA CANCELAR (via botão/lista)
  if (buttonId?.startsWith("cancel_rec_") && activeAction) {
    const recId = buttonId.replace("cancel_rec_", "");
    const result = await cancelRecurring(userId, recId);
    await closeAction(activeAction.id);
    await sendMessage(phoneNumber, result.message, messageSource);
    return true;
  }
  
  // SELEÇÃO DE TRANSAÇÃO PARA CANCELAR (via botão/lista)
  if (buttonId?.startsWith("cancel_tx_") && activeAction) {
    const txId = buttonId.replace("cancel_tx_", "");
    const result = await cancelTransaction(userId, txId);
    await closeAction(activeAction.id);
    await sendMessage(phoneNumber, result.message, messageSource);
    return true;
  }
  
  // SELEÇÃO DE META PARA ADICIONAR PROGRESSO (via botão/lista)
  if (buttonId?.startsWith("goal_add_") && activeAction) {
    const goalId = buttonId.replace("goal_add_", "");
    const amount = activeAction.slots?.amount;
    if (amount) {
      const { addToGoal } = await import("../intents/goals.ts");
      const result = await addToGoal(userId, goalId, Number(amount));
      await closeAction(activeAction.id);
      await sendMessage(phoneNumber, result, messageSource);
      return true;
    }
  }

  // ========================================================================
  // 📬 HANDLER: Confirmação de gastos pendentes
  // ========================================================================
  if (buttonId === "confirm_pending_yes") {
    const { data: pendingMsgs } = await supabase
      .from("pending_messages")
      .select("id, message_text")
      .eq("user_id", userId)
      .eq("processed", false)
      .order("created_at", { ascending: true })
      .limit(10);
    
    if (pendingMsgs && pendingMsgs.length > 0) {
      const lista = pendingMsgs.map((p, i) => `${i + 1}. ${p.message_text?.slice(0, 40)}`).join("\n");
      
      await sendMessage(phoneNumber,
        `📬 *Gastos Pendentes*\n\n${lista}\n\n_Digite o número para confirmar ou "todos" para confirmar tudo_`,
        messageSource
      );
      
      await createAction(userId, "confirm_pending", "confirm_pending", {
        pending_ids: pendingMsgs.map(p => p.id),
        pending_contents: pendingMsgs.map(p => p.message_text)
      }, "selection", messageId);
    }
    return true;
  }
  
  if (buttonId === "confirm_pending_no") {
    await sendMessage(phoneNumber, 
      `Blz! Os gastos ficam anotados aqui. É só dizer "gastos pendentes" quando quiser ver 📋`,
      messageSource
    );
    return true;
  }
  
  // ========================================================================
  // 💳 HANDLER: Botões de fatura (pagar / lembrar)
  // ========================================================================
  if (buttonId?.startsWith("fatura_pagar_")) {
    const faturaId = buttonId.replace("fatura_pagar_", "");
    console.log(`💳 [FATURA] Marcando como paga: ${faturaId}`);
    
    const { data: fatura } = await supabase
      .from("faturas_cartao")
      .select("id, valor_total, cartao_id, cartoes_credito(nome, limite_disponivel)")
      .eq("id", faturaId)
      .maybeSingle();
    
    if (fatura) {
      await supabase.from("faturas_cartao")
        .update({ status: "paga", valor_pago: fatura.valor_total, updated_at: new Date().toISOString() })
        .eq("id", faturaId);
      
      if (fatura.cartao_id && fatura.valor_total) {
        await supabase.rpc("atualizar_limite_cartao", {
          p_cartao_id: fatura.cartao_id,
          p_valor: fatura.valor_total,
          p_operacao: "restaurar",
        });
      }
      
      const cartaoNome = (fatura.cartoes_credito as any)?.nome || "Cartão";
      await sendMessage(phoneNumber,
        `✅ *Fatura paga!*\n\n💳 ${cartaoNome}\n💰 R$ ${(fatura.valor_total || 0).toFixed(2)}\n\n🎉 Limite recomposto!`,
        messageSource
      );
    } else {
      await sendMessage(phoneNumber, `❌ Não encontrei essa fatura. Tente novamente.`, messageSource);
    }
    return true;
  }
  
  if (buttonId?.startsWith("fatura_lembrar_")) {
    const faturaId = buttonId.replace("fatura_lembrar_", "");
    console.log(`📅 [FATURA] Lembrar depois: ${faturaId}`);
    await sendMessage(phoneNumber,
      `📅 Beleza! Vou te lembrar de novo amanhã. Quando pagar, me diz: "paguei a fatura" 😉`,
      messageSource
    );
    return true;
  }

  // ========================================================================
  // 📄 HANDLER: Resposta à sugestão de criar fatura
  // ========================================================================
  if (buttonId === "create_bill_yes" && 
      (activeAction?.intent === "bill" || activeAction?.intent === "bill_suggestion")) {
    const billName = activeAction.slots.bill_name;
    const estimatedValue = activeAction.slots.estimated_value;
    
    console.log(`📄 [BILL] Criando fatura recorrente: ${billName}`);
    
    await closeAction(activeAction.id);
    await createAction(userId, "bill", "bill", {
      bill_name: billName,
      estimated_value: estimatedValue
    }, "due_day", messageId);
    
    await sendMessage(phoneNumber,
      `📄 Qual dia do mês vence a conta de *${billName}*? (1-31)`,
      messageSource
    );
    return true;
  }
  
  if (buttonId === "create_bill_no" && 
      (activeAction?.intent === "bill" || activeAction?.intent === "bill_suggestion")) {
    await closeAction(activeAction.id);
    await sendMessage(phoneNumber, 
      `Tranquilo! Se mudar de ideia, é só me avisar 😊`,
      messageSource
    );
    return true;
  }

  // NÚMERO ISOLADO - GASTO
  if (buttonId === "num_gasto" && activeAction?.slots?.amount) {
    await closeAction(activeAction.id);
    await createAction(userId, "expense", "expense", { amount: activeAction.slots.amount }, "payment_method", messageId);
    await sendButtons(phoneNumber, "Como você pagou?", SLOT_PROMPTS.payment_method.buttons!, messageSource);
    return true;
  }
  
  // NÚMERO ISOLADO - ENTRADA
  if (buttonId === "num_entrada" && activeAction?.slots?.amount) {
    await closeAction(activeAction.id);
    await createAction(userId, "income", "income", { amount: activeAction.slots.amount }, "source", messageId);
    await sendButtons(phoneNumber, "Como você recebeu?", SLOT_PROMPTS.source.buttons!, messageSource);
    return true;
  }

  return false;
}
