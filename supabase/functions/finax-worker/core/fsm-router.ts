// ============================================================================
// 🔒 FSM ROUTER — State Machine para actions ativas
// Extraído de index.ts — Sprint 5
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type ExtractedSlots } from "../decision/types.ts";
import { type MessageSource } from "./job-context.ts";
import { updateAction, closeAction, cancelAction } from "../fsm/action-manager.ts";
import { registerExpenseInline, handleExpenseResult } from "../intents/expense-inline.ts";
import { registerIncome } from "../intents/income.ts";
import { registerRecurring } from "../intents/recurring-handler.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const registerExpense = registerExpenseInline;

async function handleExpenseResultCompat(
  result: { success: boolean; message: string; isDuplicate?: boolean },
  phoneNumber: string,
  messageSource: MessageSource,
  sendMessage: Function,
  sendButtons: Function
): Promise<void> {
  return handleExpenseResult(result, phoneNumber, messageSource, sendMessage as any, sendButtons as any);
}

export async function handleFSM(
  userId: string,
  activeAction: any,
  conteudoProcessado: string,
  payload: { phoneNumber: string; messageSource: MessageSource; messageId?: string },
  sendMessage: (phone: string, msg: string, source: MessageSource) => Promise<boolean | void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: MessageSource) => Promise<boolean | void>
): Promise<{ handled: boolean; shouldContinue: boolean }> {

  if (!activeAction || (!activeAction.pending_slot && activeAction.status !== "awaiting_confirmation")) {
    return { handled: false, shouldContinue: true };
  }

  console.log(`🔒 [FSM] Ação ativa: ${activeAction.intent} | status: ${activeAction.status} | pending_slot: ${activeAction.pending_slot}`);

  const { handleActiveContext } = await import("../fsm/context-handler.ts");

  const contextResult = await handleActiveContext(
    userId,
    activeAction,
    conteudoProcessado
  );

  // ========================================================================
  // CASO 1: CONFIRMAÇÃO RECEBIDA → EXECUTAR
  // ========================================================================
  if (contextResult.readyToExecute && activeAction.status === "awaiting_confirmation") {
    console.log(`✅ [FSM] Confirmação recebida - executando ${activeAction.intent}`);

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
        result = await registerInstallment(userId, slots as any, activeAction.id);
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
      case "pay_bill": {
        const { payBill } = await import("../intents/bills.ts");
        const payResult = await payBill({
          userId,
          contaNome: slots.bill_name || slots.description || "Conta",
          valorPago: Number(slots.amount)
        });
        result = { message: payResult, success: true };
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
      await handleExpenseResultCompat(result as any, payload.phoneNumber, payload.messageSource, sendMessage, sendButtons);
    } else {
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
    }
    return { handled: true, shouldContinue: false };
  }

  // ========================================================================
  // CASO 2: CANCELAMENTO
  // ========================================================================
  if (contextResult.cancelled) {
    await cancelAction(userId);
    await sendMessage(payload.phoneNumber, contextResult.message || "👍 Cancelado!", payload.messageSource);
    return { handled: true, shouldContinue: false };
  }

  // ========================================================================
  // CASO 3: SLOT PREENCHIDO → VERIFICAR SE PRONTO PARA CONFIRMAR
  // ========================================================================
  if (contextResult.handled && contextResult.filledSlot) {
    console.log(`✅ [FSM] Slot preenchido: ${contextResult.filledSlot} = ${contextResult.slotValue}`);

    await updateAction(activeAction.id, {
      slots: contextResult.updatedSlots,
      pending_slot: null
    });

    // ================================================================
    // CASO 3A: PRONTO PARA EXECUTAR DIRETO (sem confirmação)
    // ================================================================
    if (contextResult.readyToExecute) {
      console.log(`🚀 [FSM] Todos os slots preenchidos → EXECUTAR DIRETO`);
      const execSlots = contextResult.updatedSlots as ExtractedSlots;
      let execResult: any;

      switch (activeAction.intent) {
        case "expense":
          execResult = await registerExpense(userId, execSlots, activeAction.id);
          break;
        case "income":
          execResult = await registerIncome(userId, execSlots, activeAction.id);
          break;
        case "numero_isolado": {
          const typeChoice2 = execSlots.type_choice || execSlots.original_intent;
          if (typeChoice2 === "income") {
            execResult = await registerIncome(userId, execSlots, activeAction.id);
          } else {
            execResult = await registerExpense(userId, execSlots, activeAction.id);
          }
          break;
        }
        case "goal": {
          const { createGoal } = await import("../intents/goals.ts");
          const goalResult = await createGoal({
            userId,
            name: execSlots.description || "Meta",
            targetAmount: execSlots.amount || 0,
            deadline: execSlots.deadline ? new Date(execSlots.deadline) : undefined,
            category: execSlots.category
          });
          execResult = { message: goalResult };
          break;
        }
        case "add_goal_progress": {
          const { addToGoal } = await import("../intents/goals.ts");
          const goalName = execSlots.description || execSlots.goal_name || "";
          const goalAmount = execSlots.amount || 0;
          const progressResult = await addToGoal(userId, goalName, goalAmount);
          execResult = { message: progressResult };
          break;
        }
        case "debt": {
          const { registerDebt } = await import("../intents/debt-handler.ts");
          const debtResult = await registerDebt(userId, execSlots);
          execResult = { message: debtResult.message };
          break;
        }
        case "installment": {
          const { registerInstallment } = await import("../intents/installment.ts");
          execResult = await registerInstallment(userId, execSlots as any, activeAction.id);
          break;
        }
        default: {
          console.log(`⚠️ [FSM] Intent "${activeAction.intent}" não suporta execução direta`);
          const { generateConfirmationMessage, setActionAwaitingConfirmation } = await import("../fsm/context-handler.ts");
          await setActionAwaitingConfirmation(activeAction.id, execSlots as any);
          const confirmMsg = generateConfirmationMessage(activeAction.intent, execSlots as any);
          await sendMessage(payload.phoneNumber, confirmMsg, payload.messageSource);
          return { handled: true, shouldContinue: false };
        }
      }

      await supabase.from("actions")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", activeAction.id);

      await sendMessage(payload.phoneNumber, execResult.message, payload.messageSource);
      return { handled: true, shouldContinue: false };
    }

    // ================================================================
    // CASO 3B: PEDIR CONFIRMAÇÃO
    // ================================================================
    if (contextResult.readyToConfirm) {
      const { generateConfirmationMessage, setActionAwaitingConfirmation } = await import("../fsm/context-handler.ts");

      await setActionAwaitingConfirmation(activeAction.id, contextResult.updatedSlots!);

      const confirmMsg = generateConfirmationMessage(activeAction.intent, contextResult.updatedSlots!);
      await sendButtons(payload.phoneNumber, confirmMsg, [
        { id: "confirm_yes", title: "✅ Confirmar" },
        { id: "confirm_no", title: "❌ Cancelar" }
      ], payload.messageSource);
      return { handled: true, shouldContinue: false };
    }

    // Ainda falta slot → perguntar próximo
    const { getNextMissingSlot, getSlotPrompt } = await import("../fsm/context-handler.ts");
    const nextMissing = getNextMissingSlot(activeAction.intent, contextResult.updatedSlots!);

    if (nextMissing) {
      await updateAction(activeAction.id, { pending_slot: nextMissing });
      const prompt = getSlotPrompt(nextMissing);

      if (prompt.buttons) {
        await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, prompt.text, payload.messageSource);
      }
      return { handled: true, shouldContinue: false };
    } else {
      // Fallback: todos os slots preenchidos mas readyToExecute era false
      console.log(`⚠️ [FSM] nextMissing null com readyToExecute false, executando direto como fallback para intent: ${activeAction.intent}`);

      const updatedSlots = contextResult.updatedSlots!;

      if (activeAction.intent === "expense") {
        const result = await registerExpense(userId, updatedSlots, undefined);
        await closeAction(activeAction.id);
        await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource, sendMessage, sendButtons);
      } else if (activeAction.intent === "income") {
        const result = await registerIncome(userId, updatedSlots);
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      } else {
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, "✅ Registrado!", payload.messageSource);
      }
      return { handled: true, shouldContinue: false };
    }
  }

  // ========================================================================
  // CASO 4: HANDLED MAS SEM SLOT PREENCHIDO (erro de entrada)
  // ========================================================================
  if (contextResult.handled && contextResult.message) {
    if (activeAction.pending_slot) {
      const { getSlotPrompt } = await import("../fsm/context-handler.ts");
      const prompt = getSlotPrompt(activeAction.pending_slot);
      if (prompt.buttons) {
        await sendButtons(
          payload.phoneNumber,
          contextResult.message + "\n\n" + prompt.text,
          prompt.buttons,
          payload.messageSource
        );
        return { handled: true, shouldContinue: false };
      }
    }
    await sendMessage(payload.phoneNumber, contextResult.message, payload.messageSource);
    return { handled: true, shouldContinue: false };
  }

  // ========================================================================
  // CASO 5: MUDANÇA DE ASSUNTO → CANCELAR E CONTINUAR
  // ========================================================================
  if (contextResult.shouldCancel) {
    console.log(`🔄 [FSM] Mudança de assunto detectada, cancelando action`);
    await cancelAction(userId);
    return { handled: false, shouldContinue: true };
  }

  return { handled: false, shouldContinue: true };
}
