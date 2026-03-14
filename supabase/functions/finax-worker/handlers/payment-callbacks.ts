import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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
      if (payload.buttonReplyId.startsWith("pay_")) {
      const paymentMethod = PAYMENT_ALIASES[payload.buttonReplyId];
        if (paymentMethod && activeAction && activeAction.intent === "expense") {
          const updatedSlots: Record<string, any> = { ...activeAction.slots, payment_method: paymentMethod };
          
          // ✅ BUG 3 FIX: Se crédito, resolver cartão ANTES de registrar
          if (paymentMethod === "credito") {
            const { resolveCreditCard } = await import("./intents/credit-flow.ts");
            const creditResult = await resolveCreditCard(userId, updatedSlots);
            
            if (!creditResult.success) {
              // Precisa perguntar qual cartão
              if (creditResult.missingSlot === "card") {
                const slotsWithOptions = {
                  ...updatedSlots,
                  card_options: creditResult.cardOptions || []
                };
                await updateAction(activeAction.id, { slots: slotsWithOptions, pending_slot: "card" });
                
                if (creditResult.useListMessage && creditResult.listSections) {
                  await sendListMessage(payload.phoneNumber, creditResult.message, "Escolher cartão", creditResult.listSections, payload.messageSource);
                } else if (creditResult.cardButtons) {
                  await sendButtons(payload.phoneNumber, creditResult.message, creditResult.cardButtons, payload.messageSource);
                } else {
                  await sendMessage(payload.phoneNumber, creditResult.message, payload.messageSource);
                }
                return;
              }
              await sendMessage(payload.phoneNumber, creditResult.message, payload.messageSource);
              return;
            }
            
            // Cartão resolvido → atualizar slots
            updatedSlots.card_id = creditResult.cardId;
            updatedSlots.fatura_id = creditResult.invoiceId;
            updatedSlots.card = creditResult.cardName;
            console.log(`💳 [BUTTON-CREDIT] Vinculado: ${creditResult.cardName}`);
          }
          
          const missing = getMissingSlots("expense", updatedSlots);
          
          if (missing.length === 0) {
            // 🔒 CRÍTICO: Registrar E fechar action imediatamente
            const result = await registerExpense(userId, updatedSlots, activeAction.id);
            
            // ================================================================
            // 📦 MULTI-EXPENSE QUEUE: Processar próximo gasto da fila
            // ================================================================
            const remainingExpenses = activeAction.slots?.remaining_expenses as Array<{amount: number; description: string; confidence?: number}> | undefined;
            
            if (remainingExpenses && remainingExpenses.length > 0) {
              // Há gastos pendentes na fila — NÃO fechar tudo
              const nextExpense = remainingExpenses[0];
              const nextRemaining = remainingExpenses.slice(1);
              
              console.log(`📦 [MULTI-QUEUE] Próximo gasto: R$ ${nextExpense.amount} - ${nextExpense.description} (restam ${nextRemaining.length})`);
              
              // Fechar apenas a action atual
              await supabase.from("actions")
                .update({ status: "done" })
                .eq("id", activeAction.id);
              
              // Criar nova action para o próximo gasto
              await createAction(userId, "multi_expense_queue", "expense", {
                amount: nextExpense.amount,
                description: nextExpense.description,
                remaining_expenses: nextRemaining
              }, "payment_method", payload.messageId);
              
              // Enviar resultado do gasto atual + perguntar próximo
              await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource);
              await sendButtons(
                payload.phoneNumber,
                `💸 R$ ${nextExpense.amount.toFixed(2)} - ${nextExpense.description}\n\nComo você pagou?`,
                SLOT_PROMPTS.payment_method.buttons!,
                payload.messageSource
              );
              return;
            }
            
            // Sem fila — fechar todas as actions pendentes
            await supabase.from("actions")
              .update({ status: "done" })
              .eq("user_id", userId)
              .in("status", ["collecting", "awaiting_input"]);
            await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource);
            console.log(`✅ [BUTTON] Expense registrado, todas actions fechadas`);
            return; // FIM - sem mais processamento
          }
          
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
          const prompt = SLOT_PROMPTS[missing[0]];
          if (prompt?.useButtons && prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
          }
          return;
        }
      }
      
      // SOURCE DE ENTRADA
      if (payload.buttonReplyId.startsWith("src_")) {
        const source = SOURCE_ALIASES[payload.buttonReplyId];
        if (source && activeAction && activeAction.intent === "income") {
          const updatedSlots: ExtractedSlots = { ...activeAction.slots, source };
          
          if (!updatedSlots.amount) {
            await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "amount" });
            await sendMessage(payload.phoneNumber, SLOT_PROMPTS.amount_income.text, payload.messageSource);
            return;
          }
          
          // 🔒 CRÍTICO: Registrar E fechar todas as actions
          const result = await registerIncome(userId, updatedSlots, activeAction.id);
          await supabase.from("actions")
            .update({ status: "done" })
            .eq("user_id", userId)
            .in("status", ["collecting", "awaiting_input"]);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          console.log(`✅ [BUTTON] Income registrado, todas actions fechadas`);
          return;
        }
      }
  // SELEÇÃO DE CARTÃO PARA RECURRING
      if (payload.buttonReplyId.startsWith("rec_card_") && activeAction) {
        const cardId = payload.buttonReplyId.replace("rec_card_", "");
        
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
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
      
      // PAGAMENTO DE RECORRENTE
      if (payload.buttonReplyId.startsWith("rec_pay_") && activeAction?.intent === "recurring") {
        const paymentAliases: Record<string, string> = {
          "rec_pay_pix": "pix",
          "rec_pay_debito": "debito",
          "rec_pay_credito": "credito",
          "rec_pay_dinheiro": "dinheiro"
        };
        const paymentMethod = paymentAliases[payload.buttonReplyId];
        
        if (paymentMethod) {
          const updatedSlots: ExtractedSlots = { ...activeAction.slots, payment_method: paymentMethod };
          
          // Se é crédito e tem múltiplos cartões, perguntar qual
          if (paymentMethod === "credito") {
            const cards = await listCardsForUser(userId);
            if (cards.length > 1) {
              const cardButtons = cards.slice(0, 3).map((c) => ({
                id: `rec_card_${c.id}`,
                title: (c.nome || "Cartão").slice(0, 20)
              }));
              
              await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "card" });
              await sendButtons(
                payload.phoneNumber,
                `🔄 ${updatedSlots.description || "Recorrente"} - R$ ${updatedSlots.amount?.toFixed(2)}/mês\n\nQual cartão?`,
                cardButtons,
                payload.messageSource
              );
              return;
            } else if (cards.length === 1) {
              updatedSlots.card = cards[0].nome;
              updatedSlots.card_id = cards[0].id;
            }
          }
          
          const result = await registerRecurring(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
  // ========================================================================
      // 💳 BOTÃO "OUTROS" - Mostrar lista completa de cartões
      // ========================================================================
      if (payload.buttonReplyId === "card_others") {
        console.log(`📋 [BUTTON] Mostrar todos os cartões via lista`);
        
        if (!activeAction) {
          await sendMessage(payload.phoneNumber, "Ops, perdi o contexto 😕\nTenta novamente?", payload.messageSource);
          return;
        }
        
        const { listUserCards } = await import("./intents/credit-flow.ts");
        const allCards = await listUserCards(userId);
        
        if (allCards.length === 0) {
          await sendMessage(payload.phoneNumber, "Nenhum cartão encontrado 🤔", payload.messageSource);
          return;
        }
        
        // Enviar lista interativa
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
        
        await sendListMessage(
          payload.phoneNumber,
          "💳 Escolha um cartão:",
          "Selecionar cartão",
          sections,
          payload.messageSource
        );
        return;
      }
      
      // ========================================================================
      // 💳 SELEÇÃO DE CARTÃO VIA LISTA/BOTÃO (select_card_ / card_)
      // ========================================================================
      if (payload.buttonReplyId?.startsWith("select_card_") || payload.buttonReplyId?.startsWith("card_")) {
        // Filtrar "card_others" que já foi tratado acima
        if (payload.buttonReplyId === "card_others") {
          // Já tratado
          return;
        }
        
        const cardId = payload.buttonReplyId.replace("select_card_", "").replace("card_", "");
        
        console.log(`💳 [BUTTON] Cartão selecionado via lista: ${cardId}`);
        
        if (!activeAction) {
          await sendMessage(payload.phoneNumber, "Ops, perdi o contexto 😕\nTenta novamente?", payload.messageSource);
          return;
        }
        
        const { data: selectedCard } = await supabase
          .from("cartoes_credito")
          .select("*")
          .eq("id", cardId)
          .single();
        
        if (!selectedCard) {
          await sendMessage(payload.phoneNumber, "Cartão não encontrado 🤔", payload.messageSource);
          return;
        }
        
        const updatedSlots = {
          ...activeAction.slots,
          card: selectedCard.nome,
          card_id: cardId
        };
        
        if (activeAction.intent === "expense") {
          const result = await registerExpense(userId, updatedSlots, activeAction.id);
          await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource);
          return;
        } else if (activeAction.intent === "recurring") {
          const result = await registerRecurring(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        } else if (activeAction.intent === "installment") {
          const { registerInstallment } = await import("./intents/installment.ts");
          const result = await registerInstallment(userId, updatedSlots as any, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
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
      
      // ====================================================================
      // 📦 INSTALLMENT PAYMENT METHOD HANDLERS (boleto vs cartão)
      // ====================================================================
      if (payload.buttonReplyId === "installment_credito") {
        if (activeAction?.intent === "installment") {
          const updatedSlots = { ...activeAction.slots, payment_method: "credito" };
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: "card" });
          
          // Mostrar seleção de cartão
          const { listUserCards } = await import("./intents/credit-flow.ts");
          const cards = await listUserCards(userId);
          
          if (cards.length === 0) {
            await sendMessage(payload.phoneNumber, "Você não tem cartões cadastrados 💳\n\nAdicione um: *Adicionar cartão Nubank limite 5000*", payload.messageSource);
          } else if (cards.length <= 3) {
            const cardButtons = cards.map(c => ({ id: `card_${c.id}`, title: (c.nome || "Cartão").slice(0, 20) }));
            await sendButtons(payload.phoneNumber, "💳 Qual cartão?", cardButtons, payload.messageSource);
          } else {
            const sections = [{ title: "Seus cartões", rows: cards.map(c => ({ id: `card_${c.id}`, title: (c.nome || "Cartão").slice(0, 24), description: `Disponível: R$ ${(c.limite_disponivel ?? 0).toFixed(2)}` })) }];
            await sendListMessage(payload.phoneNumber, "💳 Qual cartão?", "Selecionar cartão", sections, payload.messageSource);
          }
        }
        return;
      }
      
      if (payload.buttonReplyId === "installment_boleto") {
        if (activeAction?.intent === "installment") {
          const slotsWithBoleto: Record<string, any> = { ...activeAction.slots, payment_method: "boleto" };
          
          // Executar fluxo boleto diretamente
          const valorTotal = Number(slotsWithBoleto.amount || 0);
          const numParcelas = Number(slotsWithBoleto.installments || 1);
          const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
          const { getBrasiliaISO } = await import("./utils/date-helpers.ts");
          const { dateISO, timeString } = getBrasiliaISO();
          
          let category = slotsWithBoleto.category || "outros";
          if (slotsWithBoleto.description && !slotsWithBoleto.category) {
            const { categorizeDescription } = await import("./ai/categorizer.ts");
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
          
          await sendMessage(payload.phoneNumber, 
            `✅ *Parcelamento no boleto registrado!*\n\n` +
            `📦 *${slotsWithBoleto.description || "Compra"}*\n` +
            `💰 R$ ${valorTotal.toFixed(2)} em *${numParcelas}x* de R$ ${valorParcela.toFixed(2)}\n` +
            `📄 Pagamento: Boleto`,
            payload.messageSource
          );
        }
        return;
      }
      
      // ====================================================================
      // 🧠 PATTERN CONFIRMATION HANDLERS (cartão aprendido)
      // ====================================================================
      if (payload.buttonReplyId === "pattern_confirm_yes") {
        console.log(`✅ [PATTERN] Usuário confirmou padrão de cartão`);
        if (activeAction) {
          // Confirmar padrão na memória
          const patternId = (activeAction.meta as any)?.patternId;
          if (patternId) {
            const { confirmPattern } = await import("./memory/patterns.ts");
            await confirmPattern(patternId);
          }
          // Executar a transação com os slots já preenchidos
          const result = await registerExpense(userId, activeAction.slots as ExtractedSlots, activeAction.id);
          await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, "Ops, perdi o contexto. Tenta de novo? 😕", payload.messageSource);
        }
        return;
      }
      
      if (payload.buttonReplyId === "pattern_confirm_no") {
        console.log(`❌ [PATTERN] Usuário rejeitou padrão de cartão`);
        if (activeAction) {
          // Rejeitar padrão
          const patternId = (activeAction.meta as any)?.patternId;
          if (patternId) {
            const { rejectPattern } = await import("./memory/patterns.ts");
            await rejectPattern(patternId);
          }
          // Remover card_id dos slots e mostrar lista de cartões
          const slotsWithoutCard = { ...activeAction.slots } as any;
          delete slotsWithoutCard.card_id;
          delete slotsWithoutCard.card;
          
          // Atualizar action com slots sem cartão
          await supabase.from("actions")
            .update({ slots: slotsWithoutCard })
            .eq("id", activeAction.id);
          
          // Mostrar lista de cartões
          const { listUserCards } = await import("./intents/credit-flow.ts");
          const allCards = await listUserCards(userId);
          
          if (allCards.length <= 3) {
            const cardButtons = allCards.map(c => ({
              id: `card_${c.id}`,
              title: (c.nome || "Cartão").slice(0, 20)
            }));
            await sendButtons(payload.phoneNumber, "💳 Em qual cartão foi?", cardButtons, payload.messageSource);
          } else {
            const sections = [{
              title: "Seus cartões",
              rows: allCards.map(c => ({
                id: `card_${c.id}`,
                title: (c.nome || "Cartão").slice(0, 24),
                description: `Disponível: R$ ${(c.limite_disponivel ?? c.limite_total ?? 0).toFixed(2)}`
              }))
            }];
            await sendListMessage(payload.phoneNumber, "💳 Em qual cartão foi?", "Selecionar cartão", sections, payload.messageSource);
          }
        } else {
          await sendMessage(payload.phoneNumber, "Ops, perdi o contexto. Tenta de novo? 😕", payload.messageSource);
        }
        return;
      }

  return true;
}
