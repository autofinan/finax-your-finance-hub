import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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
      if (payload.buttonReplyId === "confirm_yes" && activeAction && activeAction.status === "awaiting_confirmation") {
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
            const { registerInstallment } = await import("./intents/installment.ts");
            const installResult = await registerInstallment(userId, slots as any, activeAction.id);
            
            // ✅ BLOCO 2: Se precisa seleção de cartão, pedir com botões/lista
            if (installResult.needsCardSelection && installResult.cardButtons) {
              console.log(`💳 [INSTALLMENT] Precisa selecionar cartão após confirmação`);
              await updateAction(activeAction.id, { 
                slots: { ...slots }, 
                pending_slot: "card",
                status: "collecting"
              });
              
              if (installResult.cardButtons.length <= 3) {
                await sendButtons(payload.phoneNumber, installResult.message, installResult.cardButtons, payload.messageSource);
              } else {
                const sections = [{
                  title: "Seus cartões",
                  rows: installResult.cardButtons.map(c => ({
                    id: c.id,
                    title: c.title
                  }))
                }];
                await sendListMessage(payload.phoneNumber, installResult.message, "Selecionar cartão", sections, payload.messageSource);
              }
              return; // Return early - don't fall through to sendMessage
            }
            
            result = installResult;
            break;
          }
          case "add_card": {
            const { createCard } = await import("./intents/card.ts");
            result = await createCard(userId, slots as any);
            break;
          }
          case "bill": {
            const { createBill } = await import("./intents/bills.ts");
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
        
        // ✅ Se for duplicata detectada, enviar botões em vez de mensagem simples
        if ((result as any).isDuplicate) {
          await handleExpenseResultCompat(result as any, payload.phoneNumber, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        }
        return;
      }
      
      if (payload.buttonReplyId === "confirm_no" && activeAction) {
        await cancelAction(userId);
        await sendMessage(payload.phoneNumber, "👍 Cancelado!", payload.messageSource);
        return;
      }
  
      // ====================================================================
      // 📦 MÚLTIPLOS GASTOS - Separado ou Junto
      // ====================================================================
      if (payload.buttonReplyId === "multi_separado" && activeAction?.intent === "multi_expense") {
        const detectedExpenses = activeAction.slots.detected_expenses as Array<{amount: number; description: string}>;
        console.log(`📦 [MULTI] Registrando ${detectedExpenses?.length} gastos separadamente`);
        
        if (!detectedExpenses || detectedExpenses.length === 0) {
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, "Ops, perdi os dados. Pode repetir?", payload.messageSource);
          return;
        }
        
        // Registrar cada gasto separadamente (pedir pagamento para o primeiro)
        const firstExpense = detectedExpenses[0];
        await closeAction(activeAction.id);
        await createAction(userId, "multi_expense_queue", "expense", { 
          amount: firstExpense.amount,
          description: firstExpense.description,
          remaining_expenses: detectedExpenses.slice(1)
        }, "payment_method", payload.messageId);
        
        await sendButtons(
          payload.phoneNumber,
          `💸 R$ ${firstExpense.amount.toFixed(2)} - ${firstExpense.description}\n\nComo você pagou?`,
          SLOT_PROMPTS.payment_method.buttons!,
          payload.messageSource
        );
        return;
      }
      
      if (payload.buttonReplyId === "multi_junto" && activeAction?.intent === "multi_expense") {
        const total = activeAction.slots.total as number;
        const originalMessage = activeAction.slots.original_message as string;
        console.log(`📦 [MULTI] Registrando tudo junto: R$ ${total}`);
        
        await closeAction(activeAction.id);
        await createAction(userId, "expense", "expense", { 
          amount: total,
          description: originalMessage?.slice(0, 50) || "Múltiplos itens"
        }, "payment_method", payload.messageId);
        
        await sendButtons(
          payload.phoneNumber,
          `💸 R$ ${total.toFixed(2)}\n\nComo você pagou?`,
          SLOT_PROMPTS.payment_method.buttons!,
          payload.messageSource
        );
        return;
      }
  // ====================================================================
      // 🎯 HANDLER ONBOARDING BUTTONS (onb_start, onb_plan)
      // ====================================================================
      if (payload.buttonReplyId === "onb_start") {
        await sendMessage(payload.phoneNumber,
          `🚀 *Vamos lá!*\n\nÉ simples, me manda:\n\n• *"Gastei 50 no mercado"* — registro rápido\n• *"Quanto gastei?"* — resumo do mês\n• *"Orçamento 2000"* — definir limite\n• *"Me ajuda"* — ver tudo que posso fazer\n\nBora começar? Me conta seu primeiro gasto! 💪`,
          payload.messageSource
        );
        return;
      }
      
      if (payload.buttonReplyId === "onb_plan") {
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
        await sendMessage(payload.phoneNumber, planMsg, payload.messageSource);
        return;
      }
      
      // ====================================================================
      // 🛡️ GUARD: BOTÃO EXPIRADO (sem contexto ativo)
      // ====================================================================
      if (!activeAction) {
        console.log(`⏰ [EXPIRED_BUTTON] Botão clicado sem contexto ativo: ${payload.buttonReplyId}`);
        
        if (payload.buttonReplyId === "word_gasto" || payload.buttonReplyId === "word_consulta") {
          await sendMessage(payload.phoneNumber, 
            "⏰ Ops, demorei demais e perdi o contexto!\n\nPode repetir o que você quer registrar ou consultar?", 
            payload.messageSource
          );
          return;
        }
        
        if (payload.buttonReplyId === "num_gasto" || payload.buttonReplyId === "num_entrada") {
          await sendMessage(payload.phoneNumber, 
            "⏰ Hmm, perdi o fio da meada!\n\nPode mandar o valor de novo?", 
            payload.messageSource
          );
          return;
        }
        
        await sendMessage(payload.phoneNumber, 
          "⏰ Opa, o tempo passou e perdi o contexto.\n\nPode me mandar de novo o que você quer fazer?", 
          payload.messageSource
        );
        return;
      }
      
      // ✏️ EDIT - Correção de forma de pagamento OU cartão
      if (payload.buttonReplyId.startsWith("edit_") && activeAction?.intent === "edit") {
        // ✅ FIX WA-1/WA-6: Handler para edit_card_{id}
        if (payload.buttonReplyId.startsWith("edit_card_")) {
          const editCardId = payload.buttonReplyId.replace("edit_card_", "");
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
            await sendMessage(payload.phoneNumber, 
              `✅ *Corrigido!*\n\n💳 Agora está no *${editCard.nome}*`,
              payload.messageSource);
            return;
          }
        }
        
        // ✅ FIX WA-6: Se edit_credito → listar cartões em vez de corrigir direto
        if (payload.buttonReplyId === "edit_credito" && activeAction.slots.transaction_id) {
          const editCards = await listCardsForUser(userId);
          if (editCards.length > 1) {
            // Múltiplos cartões → pedir seleção
            if (editCards.length <= 3) {
              const cardBtns = editCards.map(c => ({
                id: `edit_card_${c.id}`,
                title: (c.nome || "Cartão").slice(0, 20)
              }));
              await updateAction(activeAction.id, { pending_slot: "card" });
              await sendButtons(payload.phoneNumber, "💳 Qual cartão?", cardBtns, payload.messageSource);
            } else {
              const sections = [{
                title: "Seus cartões",
                rows: editCards.map(c => ({
                  id: `edit_card_${c.id}`,
                  title: (c.nome || "Cartão").slice(0, 24)
                }))
              }];
              await updateAction(activeAction.id, { pending_slot: "card" });
              await sendListMessage(payload.phoneNumber, "💳 Qual cartão?", "Selecionar", sections, payload.messageSource);
            }
            return;
          } else if (editCards.length === 1) {
            // 1 cartão → corrigir direto para crédito nesse cartão
            await supabase.from("transacoes")
              .update({ forma_pagamento: "credito", cartao_id: editCards[0].id })
              .eq("id", activeAction.slots.transaction_id);
            await closeAction(activeAction.id);
            await sendMessage(payload.phoneNumber, 
              `✅ *Corrigido!*\n\n💳 Agora é crédito no *${editCards[0].nome}*`,
              payload.messageSource);
            return;
          }
        }
        
        const editAliases: Record<string, string> = {
          "edit_pix": "pix",
          "edit_debito": "debito",
          "edit_dinheiro": "dinheiro",
          "edit_credito": "credito"
        };
        const newMethod = editAliases[payload.buttonReplyId];
        
        if (newMethod && activeAction.slots.transaction_id) {
          const result = await updateTransactionPaymentMethod(activeAction.slots.transaction_id, newMethod);
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
  // ========================================================================
      // 🔤 PALAVRA SOLTA - GASTO
      // ========================================================================
      if (payload.buttonReplyId === "word_gasto" && activeAction?.intent === "clarify_word") {
        const possibleDesc = activeAction.slots.possible_description || "";
        console.log(`🔤 [BUTTON] Palavra "${possibleDesc}" é um GASTO`);
        
        await closeAction(activeAction.id);
        
        // Criar action de expense com a descrição preenchida
        await createAction(userId, "expense", "expense", { description: possibleDesc }, "amount", payload.messageId);
        await sendMessage(payload.phoneNumber, `💸 ${possibleDesc}\n\nQual foi o valor?`, payload.messageSource);
        return;
      }
      
      // ========================================================================
      // 🔤 PALAVRA SOLTA - CONSULTA
      // ========================================================================
      if (payload.buttonReplyId === "word_consulta" && activeAction?.intent === "clarify_word") {
        const possibleDesc = activeAction.slots.possible_description || "";
        console.log(`🔤 [BUTTON] Palavra "${possibleDesc}" é uma CONSULTA`);
        
        await closeAction(activeAction.id);
        
        // Buscar gastos relacionados a esse termo
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
          
          await sendMessage(payload.phoneNumber, 
            `📊 *Gastos com "${possibleDesc}"*\n\n${list}\n\n💰 Total: R$ ${total.toFixed(2)}`,
            payload.messageSource
          );
        } else {
          await sendMessage(payload.phoneNumber, 
            `Não encontrei gastos com "${possibleDesc}" 🤔\n\nSe quiser registrar, manda o valor!`,
            payload.messageSource
          );
        }
        return;
      }
  // CONFIRMAR CANCELAMENTO
      if (payload.buttonReplyId === "cancel_confirm_yes" && activeAction?.slots?.transaction_id) {
        const result = await cancelTransaction(userId, activeAction.slots.transaction_id);
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // CONFIRMAR CANCELAMENTO DE RECORRENTE
      if (payload.buttonReplyId === "cancel_confirm_rec_yes" && activeAction?.slots?.transaction_id) {
        const result = await cancelRecurring(userId, activeAction.slots.transaction_id);
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      if (payload.buttonReplyId === "cancel_confirm_no") {
        if (activeAction) await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, "Ok, mantido! 👍", payload.messageSource);
        return;
      }
      
      // SELEÇÃO DE RECORRENTE PARA CANCELAR (via botão/lista)
      if (payload.buttonReplyId?.startsWith("cancel_rec_") && activeAction) {
        const recId = payload.buttonReplyId.replace("cancel_rec_", "");
        const result = await cancelRecurring(userId, recId);
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // SELEÇÃO DE TRANSAÇÃO PARA CANCELAR (via botão/lista)
      if (payload.buttonReplyId?.startsWith("cancel_tx_") && activeAction) {
        const txId = payload.buttonReplyId.replace("cancel_tx_", "");
        const result = await cancelTransaction(userId, txId);
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // SELEÇÃO DE META PARA ADICIONAR PROGRESSO (via botão/lista)
      if (payload.buttonReplyId?.startsWith("goal_add_") && activeAction) {
        const goalId = payload.buttonReplyId.replace("goal_add_", "");
        const amount = activeAction.slots?.amount;
        if (amount) {
          const { addToGoal } = await import("./intents/goals.ts");
          const result = await addToGoal(userId, goalId, Number(amount));
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, result, payload.messageSource);
          return;
        }
      }
  // ========================================================================
      // 📬 HANDLER: Confirmação de gastos pendentes
      // ========================================================================
      if (payload.buttonReplyId === "confirm_pending_yes") {
        // Buscar mensagens pendentes
        const { data: pendingMsgs } = await supabase
          .from("pending_messages")
          .select("id, message_text")
          .eq("user_id", userId)
          .eq("processed", false)
          .order("created_at", { ascending: true })
          .limit(10);
        
        if (pendingMsgs && pendingMsgs.length > 0) {
          const lista = pendingMsgs.map((p, i) => `${i + 1}. ${p.message_text?.slice(0, 40)}`).join("\n");
          
          await sendMessage(payload.phoneNumber,
            `📬 *Gastos Pendentes*\n\n${lista}\n\n_Digite o número para confirmar ou "todos" para confirmar tudo_`,
            payload.messageSource
          );
          
          await createAction(userId, "confirm_pending", "confirm_pending", {
            pending_ids: pendingMsgs.map(p => p.id),
            pending_contents: pendingMsgs.map(p => p.message_text)
          }, "selection", payload.messageId);
        }
        return;
      }
      
      if (payload.buttonReplyId === "confirm_pending_no") {
        await sendMessage(payload.phoneNumber, 
          `Blz! Os gastos ficam anotados aqui. É só dizer "gastos pendentes" quando quiser ver 📋`,
          payload.messageSource
        );
        return;
      }
      
      // ========================================================================
      // 💳 HANDLER: Botões de fatura (pagar / lembrar)
      // ========================================================================
      if (payload.buttonReplyId?.startsWith("fatura_pagar_")) {
        const faturaId = payload.buttonReplyId.replace("fatura_pagar_", "");
        console.log(`💳 [FATURA] Marcando como paga: ${faturaId}`);
        
        // Buscar fatura e cartão
        const { data: fatura } = await supabase
          .from("faturas_cartao")
          .select("id, valor_total, cartao_id, cartoes_credito(nome, limite_disponivel)")
          .eq("id", faturaId)
          .maybeSingle();
        
        if (fatura) {
          // Marcar como paga
          await supabase.from("faturas_cartao")
            .update({ status: "paga", valor_pago: fatura.valor_total, updated_at: new Date().toISOString() })
            .eq("id", faturaId);
          
          // Recompor limite do cartão
          if (fatura.cartao_id && fatura.valor_total) {
            await supabase.rpc("atualizar_limite_cartao", {
              p_cartao_id: fatura.cartao_id,
              p_valor: fatura.valor_total,
              p_operacao: "restaurar",
            });
          }
          
          const cartaoNome = (fatura.cartoes_credito as any)?.nome || "Cartão";
          await sendMessage(payload.phoneNumber,
            `✅ *Fatura paga!*\n\n💳 ${cartaoNome}\n💰 R$ ${(fatura.valor_total || 0).toFixed(2)}\n\n🎉 Limite recomposto!`,
            payload.messageSource
          );
        } else {
          await sendMessage(payload.phoneNumber, `❌ Não encontrei essa fatura. Tente novamente.`, payload.messageSource);
        }
        return;
      }
      
      if (payload.buttonReplyId?.startsWith("fatura_lembrar_")) {
        const faturaId = payload.buttonReplyId.replace("fatura_lembrar_", "");
        console.log(`📅 [FATURA] Lembrar depois: ${faturaId}`);
        await sendMessage(payload.phoneNumber,
          `📅 Beleza! Vou te lembrar de novo amanhã. Quando pagar, me diz: "paguei a fatura" 😉`,
          payload.messageSource
        );
        return;
      }
 // ========================================================================
      // 📄 HANDLER: Resposta à sugestão de criar fatura
      // ========================================================================
      if (payload.buttonReplyId === "create_bill_yes" && 
          (activeAction?.intent === "bill" || activeAction?.intent === "bill_suggestion")) {
        const billName = activeAction.slots.bill_name;
        const estimatedValue = activeAction.slots.estimated_value;
        
        console.log(`📄 [BILL] Criando fatura recorrente: ${billName}`);
        
        await closeAction(activeAction.id);
        await createAction(userId, "bill", "bill", {
          bill_name: billName,
          estimated_value: estimatedValue
        }, "due_day", payload.messageId);
        
        await sendMessage(payload.phoneNumber,
          `📄 Qual dia do mês vence a conta de *${billName}*? (1-31)`,
          payload.messageSource
        );
        return;
      }
      
      if (payload.buttonReplyId === "create_bill_no" && 
          (activeAction?.intent === "bill" || activeAction?.intent === "bill_suggestion")) {
        await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, 
          `Tranquilo! Se mudar de ideia, é só me avisar 😊`,
          payload.messageSource
        );
        return;
      }
  // ========================================================================
      // 💳 LIMITE INSUFICIENTE - Handlers
      // ========================================================================
      if (payload.buttonReplyId === "limit_force_yes" && activeAction?.intent === "expense") {
        // Forçar registro mesmo com limite insuficiente
        const result = await registerExpense(userId, activeAction.slots as ExtractedSlots, activeAction.id);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      if (payload.buttonReplyId === "limit_other_card" && activeAction?.intent === "expense") {
        // Listar outros cartões para o usuário escolher
        const cards = await listCardsForUser(userId);
        if (cards.length <= 1) {
          await sendMessage(payload.phoneNumber, "Você só tem um cartão cadastrado 💳", payload.messageSource);
          return;
        }
        const cardButtons = cards.slice(0, 3).map(c => ({
          id: `card_${c.id}`,
          title: (c.nome || "Cartão").slice(0, 20)
        }));
        const slotsClean = { ...activeAction.slots, card: undefined, card_id: undefined };
        await updateAction(activeAction.id, { slots: slotsClean, pending_slot: "card" });
        await sendButtons(payload.phoneNumber, "💳 Qual cartão quer usar?", cardButtons, payload.messageSource);
        return;
      }
      
      if (payload.buttonReplyId === "limit_cancel") {
        if (activeAction) await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, "Ok, cancelado! 👍", payload.messageSource);
        return;
      }
   // NÚMERO ISOLADO - GASTO
      if (payload.buttonReplyId === "num_gasto" && activeAction?.slots?.amount) {
        await closeAction(activeAction.id);
        await createAction(userId, "expense", "expense", { amount: activeAction.slots.amount }, "payment_method", payload.messageId);
        await sendButtons(payload.phoneNumber, "Como você pagou?", SLOT_PROMPTS.payment_method.buttons!, payload.messageSource);
        return;
      }
      
      // NÚMERO ISOLADO - ENTRADA
      if (payload.buttonReplyId === "num_entrada" && activeAction?.slots?.amount) {
        await closeAction(activeAction.id);
        await createAction(userId, "income", "income", { amount: activeAction.slots.amount }, "source", payload.messageId);
        await sendButtons(payload.phoneNumber, "Como você recebeu?", SLOT_PROMPTS.source.buttons!, payload.messageSource);
        return;
      }

  return false; // se nenhum handler tratou
}
