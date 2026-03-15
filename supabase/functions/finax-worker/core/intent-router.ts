// ============================================================================
// 🎯 INTENT ROUTER — Roteamento por tipo de ação
// Extraído de index.ts — Sprint 5
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type ExtractedSlots } from "../decision/types.ts";
import { type MessageSource, type JobPayload } from "./job-context.ts";
import { SLOT_PROMPTS, getMissingSlots, hasAllRequiredSlots } from "../ui/slot-prompts.ts";
import { createAction, updateAction, closeAction } from "../fsm/action-manager.ts";
import { registerExpenseInline, handleExpenseResult } from "../intents/expense-inline.ts";
import { registerIncome } from "../intents/income.ts";
import { registerRecurring, cancelRecurring } from "../intents/recurring-handler.ts";
import { listCardsForUser, queryCardLimits, queryCardExpenses, queryContextExpenses } from "../intents/card-queries.ts";
import { getActiveContext, createUserContext, closeUserContext } from "../intents/context-handler.ts";
import { getLastTransaction, listTransactionsForCancel, cancelTransaction, updateTransactionPaymentMethod } from "../intents/cancel-handler.ts";
import { setBudget } from "../intents/budget.ts";
import { normalizeText, isNumericOnly } from "../utils/helpers.ts";
import { markAsExecuted } from "../utils/ai-decisions.ts";
import { processNextInQueue, queueMessage, markMessageProcessed } from "../utils/message-queue.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const registerExpense = registerExpenseInline;

async function handleExpenseResultCompat(
  result: { success: boolean; message: string; isDuplicate?: boolean },
  phoneNumber: string,
  messageSource: MessageSource,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>
): Promise<void> {
  return handleExpenseResult(result, phoneNumber, messageSource, sendMessage as any, sendButtons as any);
}

export async function routeIntent(
  decision: any,
  userId: string,
  conteudoProcessado: string,
  nomeUsuario: string,
  activeAction: any,
  usuario: any,
  transactionDate: Date | null,
  payload: { phoneNumber: string; messageSource: string; messageId: string; messageType: string },
  eliteContext: { patternApplied: boolean; patternId?: string | null; patternCardName?: string | null; patternRequiresConfirmation: boolean },
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: string) => Promise<void>
): Promise<void> {

    // ========================================================================
    // 🎯 ROTEAMENTO POR TIPO DE AÇÃO
    // ========================================================================
    
    // ========================================================================
    // ✏️ EDIT - Correção rápida (dentro de 2 minutos)
    // ========================================================================
    if (decision.actionType === "edit") {
      console.log(`✏️ [EDIT] Correção detectada: ${JSON.stringify(decision.slots)}`);
      
      const lastTx = await getLastTransaction(userId, 2);
      
      if (!lastTx) {
        await sendMessage(payload.phoneNumber, "Não encontrei registro recente para corrigir 🤔\n\n_A correção funciona até 2 min após o registro_", payload.messageSource);
        return;
      }
      
      // Se o usuário já mencionou a forma de pagamento correta → corrigir direto
      if (decision.slots.new_payment_method) {
        const result = await updateTransactionPaymentMethod(lastTx.id, decision.slots.new_payment_method);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ✅ FIX WA-1: Detectar correção de CARTÃO ("não foi no Sicredi", "era no Nubank")
      // Se a transação já é crédito E a mensagem menciona um nome de cartão → trocar cartão
      const editNormalized = normalizeText(conteudoProcessado);
      const userCards = await listCardsForUser(userId);
      
      if (lastTx.forma_pagamento === "credito" && userCards.length > 0) {
        // Verificar se a mensagem menciona algum cartão pelo nome
        const mentionedCard = userCards.find(c => {
          const cardNorm = normalizeText(c.nome || "");
          return cardNorm && editNormalized.includes(cardNorm);
        });
        
        if (mentionedCard) {
          // Usuário mencionou cartão específico → corrigir direto
          console.log(`✏️ [EDIT] Correção de cartão detectada: ${mentionedCard.nome}`);
          await supabase.from("transacoes")
            .update({ cartao_id: mentionedCard.id })
            .eq("id", lastTx.id);
          await sendMessage(payload.phoneNumber, 
            `✅ *Corrigido!*\n\n💳 Agora está no *${mentionedCard.nome}*`,
            payload.messageSource
          );
          return;
        }
        
        // Mensagem não menciona cartão específico mas parece correção de cartão
        // ("não foi no X" ou "era no Y" sem match)
        if (editNormalized.includes("cartao") || editNormalized.includes("nao foi no") || editNormalized.includes("era no")) {
          // Oferecer lista de cartões
          if (userCards.length <= 3) {
            const cardBtns = userCards.map(c => ({
              id: `edit_card_${c.id}`,
              title: (c.nome || "Cartão").slice(0, 20)
            }));
            await createAction(userId, "edit", "edit", { transaction_id: lastTx.id }, "card", payload.messageId);
            await sendButtons(payload.phoneNumber,
              `📝 R$ ${lastTx.valor?.toFixed(2)} - ${lastTx.descricao || lastTx.categoria}\n\nQual o cartão correto?`,
              cardBtns, payload.messageSource);
          } else {
            const sections = [{
              title: "Seus cartões",
              rows: userCards.map(c => ({
                id: `edit_card_${c.id}`,
                title: (c.nome || "Cartão").slice(0, 24),
                description: `Disponível: R$ ${(c.limite_disponivel ?? 0).toFixed(2)}`
              }))
            }];
            await createAction(userId, "edit", "edit", { transaction_id: lastTx.id }, "card", payload.messageId);
            await sendListMessage(payload.phoneNumber,
              `📝 R$ ${lastTx.valor?.toFixed(2)} - ${lastTx.descricao || lastTx.categoria}\n\nQual o cartão correto?`,
              "Selecionar cartão", sections, payload.messageSource);
          }
          return;
        }
      }
      
      // Se não mencionou → oferecer opções de pagamento (fluxo original)
      await sendButtons(
        payload.phoneNumber,
        `📝 *Corrigir:* R$ ${lastTx.valor?.toFixed(2)} - ${lastTx.descricao || lastTx.categoria}\n\nQual a forma correta?`,
        [
          { id: "edit_pix", title: "📱 Pix" },
          { id: "edit_dinheiro", title: "💵 Dinheiro" },
          { id: "edit_credito", title: "💳 Crédito" }
        ],
        payload.messageSource
      );
      
      await createAction(userId, "edit", "edit", { transaction_id: lastTx.id }, "payment_method", payload.messageId);
      return;
    }
    
    // ========================================================================
    // 💰 INCOME - Contrato: required = ["amount"]
    // ========================================================================
    // ✅ BUG 8 FIX: Reclassificar "guardei/juntei/poupei" como goal, não income
    if (decision.actionType === "income") {
      const guardeiNorm = normalizeText(conteudoProcessado);
      const GOAL_VERBS = ["guardei", "juntei", "poupei", "economizei", "depositei"];
      const isGoalVerb = GOAL_VERBS.some(v => guardeiNorm.includes(v));
      
      if (isGoalVerb && decision.slots.amount) {
        console.log(`🎯 [RECLASSIFY] "${conteudoProcessado}" reclassificado de income → goal (verbo de acumulação)`);
        decision.actionType = "goal";
        // Re-rotear para o bloco de goal (que já está acima)
        // Precisamos buscar metas ativas para saber para onde direcionar
        const { data: activeMetas } = await supabase
          .from("savings_goals")
          .select("id, name, current_amount, target_amount")
          .eq("user_id", userId)
          .eq("status", "active");
        
        if (activeMetas && activeMetas.length > 0) {
          const { addToGoal } = await import("../intents/goals.ts");
          
          // Se tem description, tentar match direto
          if (decision.slots.description) {
            const goalName = normalizeText(String(decision.slots.description));
            const matched = activeMetas.find(g => {
              const gName = normalizeText(g.name);
              return gName.includes(goalName) || goalName.includes(gName);
            });
            if (matched) {
              const result = await addToGoal(userId, matched.id, decision.slots.amount as number);
              await sendMessage(payload.phoneNumber, result, payload.messageSource);
              return;
            }
          }
          
          // Sem match → perguntar qual meta
          if (activeMetas.length <= 3) {
            const goalButtons = activeMetas.map(m => ({
              id: `goal_add_${m.id}`,
              title: m.name.slice(0, 20)
            }));
            await createAction(userId, "add_goal_progress", "goal", { amount: decision.slots.amount }, "goal_id", payload.messageId);
            await sendButtons(payload.phoneNumber,
              `💰 R$ ${(decision.slots.amount as number).toFixed(2)}\n\nEm qual meta quer adicionar?`,
              goalButtons, payload.messageSource);
          } else {
            const sections = [{
              title: "Suas metas",
              rows: activeMetas.map(m => ({
                id: `goal_add_${m.id}`,
                title: m.name.slice(0, 24),
                description: `R$ ${Number(m.current_amount).toFixed(2)} / R$ ${Number(m.target_amount).toFixed(2)}`
              }))
            }];
            await createAction(userId, "add_goal_progress", "goal", { amount: decision.slots.amount }, "goal_id", payload.messageId);
            await sendListMessage(payload.phoneNumber,
              `💰 R$ ${(decision.slots.amount as number).toFixed(2)}\n\nEm qual meta quer adicionar?`,
              "Selecionar meta", sections, payload.messageSource);
          }
          return;
        }
        // Sem metas ativas → registrar como income normalmente (fallthrough)
        console.log(`💰 [RECLASSIFY] Sem metas ativas, mantendo como income`);
        decision.actionType = "income";
      }
    }
    if (decision.actionType === "income") {
      const slots = decision.slots;
      const missing = getMissingSlots("income", slots);
      
      // ✅ TODOS OS SLOTS → EXECUTAR DIRETO (texto claro não precisa confirmação)
      if (hasAllRequiredSlots("income", slots)) {
        console.log(`💰 [INCOME] Slots completos - executando direto (sem confirmação para texto)`);
        
        const result = await registerIncome(userId, slots as any, undefined);
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
        
        // ✅ Marcar decisão como executada
        if (decision.decisionId) {
          await markAsExecuted(decision.decisionId, true);
        }
        
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO → perguntar APENAS o que falta
      const nextMissing = missing[0]; // Só pergunta UM por vez
      
      if (activeAction?.intent === "income") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "income", "income", slots, nextMissing, payload.messageId);
      }
      
      // Usar prompt específico para income
      const promptKey = nextMissing === "amount" ? "amount_income" : nextMissing;
      const prompt = SLOT_PROMPTS[promptKey] || SLOT_PROMPTS[nextMissing];
      
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, prompt?.text || `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💸 EXPENSE - Contrato: required = ["amount", "payment_method"]
    // ========================================================================
    if (decision.actionType === "expense") {
      const slots = decision.slots;
      
      // ✅ SAFETY GUARD: Log slots recebidos para diagnóstico
      console.log(`💸 [EXPENSE-HANDLER] Slots recebidos: ${JSON.stringify(slots)}`);
      
      // ✅ SAFETY: Se slots vieram vazios mas o texto original tem número, re-extrair
      if (!slots.amount && conteudoProcessado) {
        const numMatch = conteudoProcessado.match(/(\d+[.,]?\d*)/);
        if (numMatch) {
          const extractedAmount = parseFloat(numMatch[1].replace(",", "."));
          if (!isNaN(extractedAmount) && extractedAmount > 0) {
            slots.amount = extractedAmount;
            console.log(`🔧 [SAFETY] Re-extraído amount do texto: ${extractedAmount}`);
          }
        }
        // Re-extrair descrição se vazia
        if (!slots.description) {
          const textWithoutNumbers = conteudoProcessado.replace(/\d+[.,]?\d*/g, "").replace(/\s*(reais?|real)\s*/gi, "").trim();
          if (textWithoutNumbers.length >= 2) {
            slots.description = textWithoutNumbers.charAt(0).toUpperCase() + textWithoutNumbers.slice(1);
            console.log(`🔧 [SAFETY] Re-extraída description do texto: ${slots.description}`);
          }
        }
      }
      
      // ========================================================================
      // 📅 ADICIONAR DATA RELATIVA AOS SLOTS (se detectada)
      // CORREÇÃO: Usar getBrasiliaISO() para evitar conversão UTC (+3h)
      // ========================================================================
      if (transactionDate) {
        // ✅ CORREÇÃO DEFINITIVA: Construir ISO direto dos componentes
        // parseRelativeDate retorna Date com valores de Brasília como se fossem UTC.
        // NÃO passar para getBrasiliaISO — causaria double-shift de -3h.
        const y = transactionDate.getFullYear();
        const m = String(transactionDate.getMonth() + 1).padStart(2, '0');
        const dd = String(transactionDate.getDate()).padStart(2, '0');
        const h = String(transactionDate.getHours()).padStart(2, '0');
        const min = String(transactionDate.getMinutes()).padStart(2, '0');
        const sec = String(transactionDate.getSeconds()).padStart(2, '0');
        slots.transaction_date = `${y}-${m}-${dd}T${h}:${min}:${sec}-03:00`;
        console.log(`📅 [EXPENSE] Data relativa aplicada: ${y}-${m}-${dd} às ${h}:${min} (Brasília)`);
      }
      
      const missing = getMissingSlots("expense", slots);
      
      // ✅ TODOS OS SLOTS → EXECUTAR DIRETO (texto claro não precisa confirmação)
      if (hasAllRequiredSlots("expense", slots)) {
        console.log(`💸 [EXPENSE] Slots completos - executando direto (sem confirmação para texto)`);
        
        // ========================================================================
        // 🧠 CONFIRMAÇÃO DE PADRÃO DE CARTÃO (antes de executar)
        // ========================================================================
        if (patternRequiresConfirmation && slots.card_id && patternCardName) {
          console.log(`🧠 [PATTERN] Pedindo confirmação: ${slots.description} → ${patternCardName}`);
          
          // Salvar action com slots completos + patternId no meta
          await createAction(userId, "expense", "expense", slots, "card_confirm", payload.messageId);
          // Atualizar meta da action com patternId
          await supabase.from("actions")
            .update({ meta: { patternId } })
            .eq("user_id", userId)
            .eq("status", "collecting");
          
          const valor = slots.amount ? `R$ ${Number(slots.amount).toFixed(2)}` : "";
          const desc = slots.description || "Gasto";
          
          await sendButtons(
            payload.phoneNumber,
            `🧠 ${desc} ${valor} no *${patternCardName}*, certo?`,
            [
              { id: "pattern_confirm_yes", title: "✅ Sim, registrar" },
              { id: "pattern_confirm_no", title: "❌ Não, outro cartão" }
            ],
            payload.messageSource
          );
          return;
        }
        
        // ========================================================================
        // 💳 VINCULAR CRÉDITO AO CARTÃO/FATURA (FSM MÓDULO 2)
        // ========================================================================
        if (slots.payment_method === "credito" || slots.payment_method === "crédito") {
          const { resolveCreditCard } = await import("../intents/credit-flow.ts");
          
          const creditResult = await resolveCreditCard(userId, slots);
          
          if (!creditResult.success) {
            // Precisa perguntar qual cartão ou não tem cartões
            if (creditResult.missingSlot === "card") {
              // ✅ Salvar card_options nos slots para seleção numérica posterior
              const slotsWithOptions = {
                ...slots,
                card_options: creditResult.cardOptions || []
              };
              await createAction(userId, "expense", "expense", slotsWithOptions, "card", payload.messageId);
              
              if (creditResult.useListMessage && creditResult.listSections) {
                // 4+ cartões: usar lista interativa
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
          
          // Atualizar slots com cartão/fatura vinculados
          slots.card_id = creditResult.cardId;
          slots.fatura_id = creditResult.invoiceId;
          slots.card = creditResult.cardName;
          console.log(`💳 [CREDIT] Vinculado: ${creditResult.cardName}, fatura: ${creditResult.invoiceId}`);
        }
        
        // Executar diretamente
        const result = await registerExpense(userId, slots, undefined);
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
        
        // ✅ Marcar decisão como executada
        if (decision.decisionId) {
          await markAsExecuted(decision.decisionId, result.success ?? true);
        }
        
        await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource);
        
        // ✅ APÓS registrar expense que foi reclassificado de pay_bill → oferecer criar fatura
        if (slots.suggest_bill_after && slots.description) {
          await sendButtons(payload.phoneNumber,
            `💡 Quer que eu crie uma fatura "${slots.description}" pra te lembrar todo mês?`,
            [
              { id: "create_bill_yes", title: "✅ Sim, criar" },
              { id: "create_bill_no", title: "❌ Não" }
            ],
            payload.messageSource
          );
          
          // Salvar contexto para resposta
          await createAction(userId, "bill_suggestion", "bill", {
            bill_name: slots.description,
            estimated_value: slots.amount
          }, "choice", payload.messageId);
        }
        
        // Processar fila de mensagens pendentes AUTOMATICAMENTE
        const nextQueued = await processNextInQueue(userId);
        if (nextQueued) {
          console.log(`📬 [QUEUE] Processando próximo da fila: "${nextQueued.message_text}"`);
          // Re-invocar o pipeline para a mensagem da fila
          const queuePayload: JobPayload = {
            ...payload,
            messageText: nextQueued.message_text,
            messageId: nextQueued.message_id,
            messageType: "text",
            buttonReplyId: null,
            listReplyId: null,
          };
          await markMessageProcessed(nextQueued.id);
          // Enviar separador visual
          await sendMessage(payload.phoneNumber, `📬 _Processando próximo gasto da fila..._`, payload.messageSource);
          // Reprocessar como nova invocação (sem recursão - o worker será chamado novamente pelo trigger)
          await supabase.from("eventos_brutos").insert({
            conteudo: { text: nextQueued.message_text },
            origem: "queue",
            phone_number: payload.phoneNumber,
            message_id: nextQueued.message_id,
            user_id: userId,
            status: "pendente",
          });
        }
        return;
      }
      
      // ========================================================================
      // 📬 FILA DE MENSAGENS: Se já há ação pendente de expense, enfileirar nova
      // ========================================================================
      if (activeAction?.intent === "expense" && activeAction.pending_slot === "payment_method") {
        // Nova mensagem parece ser novo gasto
        const hasNewAmount = slots.amount && slots.amount !== activeAction.slots.amount;
        const hasNewDescription = slots.description && slots.description !== activeAction.slots.description;
        
        if (hasNewAmount || hasNewDescription) {
          console.log(`📬 [QUEUE] Enfileirando novo gasto enquanto aguarda pagamento do anterior`);
          await queueMessage(userId, conteudoProcessado, payload.messageId);
          
          await sendMessage(payload.phoneNumber, 
            `📝 Anotei! Vou registrar isso assim que terminar o gasto anterior.\n\n` +
            `💸 R$ ${activeAction.slots.amount?.toFixed(2)}\n\nComo você pagou?`,
            payload.messageSource
          );
          return;
        }
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO → perguntar APENAS o que falta
      const nextMissing = missing[0]; // Só pergunta UM por vez
      
      if (activeAction?.intent === "expense") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "expense", "expense", slots, nextMissing, payload.messageId);
      }
      
      const prompt = SLOT_PROMPTS[nextMissing];
      
      // Contexto amigável com valor se já temos
      const prefix = slots.amount ? `💸 R$ ${slots.amount.toFixed(2)}\n\n` : "";
      
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `${prefix}${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `${prefix}${prompt?.text || `Qual o ${nextMissing}?`}`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💳 ADD_CARD - Registrar NOVO cartão de crédito
    // ========================================================================
    if (decision.actionType === "add_card") {
      const slots = decision.slots;
      const { createCard } = await import("../intents/card.ts");
      
      // Normalizar slots (IA pode enviar de várias formas) - usar Record para flexibilidade
      const normalizedSlots: Record<string, any> = {
        ...slots,
        card_name: slots.card_name || slots.card || slots.description,
        limit: slots.limit || slots.amount || slots.value,
        due_day: slots.due_day || slots.day_of_month,
      };
      
      const result = await createCard(userId, normalizedSlots as any);
      
      // Se criou com sucesso ou erro definitivo
      if (result.success || !result.missingSlot) {
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // Se faltou slot, criar action para coletar
      if (result.missingSlot) {
        if (activeAction?.intent === "add_card") {
          await updateAction(activeAction.id, { slots: normalizedSlots, pending_slot: result.missingSlot });
        } else {
          await createAction(userId, "add_card", "add_card", normalizedSlots, result.missingSlot, payload.messageId);
        }
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 📄 BILL - Criar fatura/conta a pagar
    // ========================================================================
    if (decision.actionType === "bill") {
      const slots = decision.slots;
      const { createBill } = await import("../intents/bills.ts");
      
      const billName = slots.bill_name || slots.description;
      const dueDay = slots.due_day || slots.day_of_month;
      const estimatedValue = slots.estimated_value || slots.amount;
      
      if (!billName) {
        await sendMessage(payload.phoneNumber, "Qual o nome da conta? (ex: Energia, Internet, Água...)", payload.messageSource);
        await createAction(userId, "bill", "bill", slots, "bill_name", payload.messageId);
        return;
      }
      
      if (!dueDay) {
        await sendMessage(payload.phoneNumber, `Em qual dia do mês vence a conta de *${billName}*? (1-31)`, payload.messageSource);
        await createAction(userId, "bill", "bill", { ...slots, bill_name: billName }, "due_day", payload.messageId);
        return;
      }
      
      const result = await createBill({
        userId,
        nome: billName,
        diaVencimento: Number(dueDay),
        valorEstimado: estimatedValue ? Number(estimatedValue) : undefined,
        tipo: "fixa",
      });
      
      await sendMessage(payload.phoneNumber, result, payload.messageSource);
      return;
    }
    
// ========================================================================
// 💸 PAY_BILL - Pagar fatura existente (COM FALLBACK INTELIGENTE)
// ========================================================================
if (decision.actionType === "pay_bill") {
  const slots = decision.slots;
  const { payBill } = await import("../intents/bills.ts");
  
  const billName = slots.bill_name || slots.description;
  const amount = slots.amount;
  
  if (!billName) {
    await sendMessage(payload.phoneNumber, "Qual conta você pagou? (ex: Energia, Água, Internet...)", payload.messageSource);
    return;
  }
  
  // ✅ VERIFICAR SE FATURA EXISTE ANTES DE PROSSEGUIR
  const { data: faturaExistente } = await supabase
    .from("contas_pagar")
    .select("id, nome")
    .eq("usuario_id", userId)
    .eq("ativa", true)
    .ilike("nome", `%${billName}%`)
    .maybeSingle();
  
  if (!faturaExistente) {
    // ❌ FATURA NÃO EXISTE → Registrar como gasto E oferecer criar fatura
    console.log(`💸 [PAY_BILL] Fatura "${billName}" não existe - registrando como gasto`);
    
    // ✅ RECLASSIFICAR COMO EXPENSE (NÃO DAR RETURN - CONTINUAR ABAIXO)
    decision.actionType = "expense";
    decision.slots = {
      ...slots,
      category: "Contas",
      description: billName,
      suggest_bill_after: true  // Flag para oferecer criar fatura depois
    };
    
    // ⚠️ NÃO DAR RETURN AQUI - DEIXAR O CÓDIGO CONTINUAR PARA O HANDLER DE EXPENSE ABAIXO
    console.log(`🔄 [PAY_BILL→EXPENSE] Reclassificado. Continuando para handler de expense...`);
    
  } else {
    // ✅ FATURA EXISTE - continuar fluxo normal de pay_bill
    console.log(`📄 [PAY_BILL] Fatura encontrada: ${faturaExistente.nome}`);
    
    if (!amount) {
      await sendMessage(payload.phoneNumber, `Quanto foi a conta de *${faturaExistente.nome}*? 💸`, payload.messageSource);
      await createAction(userId, "pay_bill", "pay_bill", { 
        ...slots, 
        bill_name: faturaExistente.nome, 
        bill_id: faturaExistente.id 
      }, "amount", payload.messageId);
      return;
    }
    
    const result = await payBill({
      userId,
      contaNome: faturaExistente.nome,
      valorPago: Number(amount),
    });
    
    await sendMessage(payload.phoneNumber, result, payload.messageSource);
    return;
  }
}

// ========================================================================
// 💸 PÓS-RECLASSIFICAÇÃO: Se pay_bill reclassificou para expense, processar aqui
// ========================================================================
// Este bloco captura o caso em que pay_bill detectou que a fatura não existe
// e reclassificou para expense. Como o handler de expense já passou, precisamos
// processar manualmente aqui.
// ========================================================================
if (decision.actionType === "expense" && decision.slots.suggest_bill_after) {
  const slots = decision.slots;
  console.log(`💸 [RECLASSIFIED] pay_bill → expense, processando: R$ ${slots.amount} - ${slots.description}`);
  
  // Verificar se tem todos os slots obrigatórios
  const missing = getMissingSlots("expense", slots);
  
  if (hasAllRequiredSlots("expense", slots)) {
    // ✅ Slots completos - registrar direto
    console.log(`💸 [RECLASSIFIED] Registrando gasto reclassificado`);
    
    const result = await registerExpense(userId, slots, undefined);
    await supabase.from("actions")
      .update({ status: "done" })
      .eq("user_id", userId)
      .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
    await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
    
    // ✅ Oferecer criar fatura (apenas para categorias de contas)
    const billKeywords = ["internet", "luz", "agua", "energia", "gas", "telefone", "aluguel", "condominio"];
    const descLower = (slots.description || "").toLowerCase();
    const shouldOfferBill = billKeywords.some(k => descLower.includes(k));
    
    if (shouldOfferBill) {
      await sendButtons(payload.phoneNumber,
        `💡 Quer que eu crie uma fatura "${slots.description}" pra te lembrar todo mês?`,
        [
          { id: "create_bill_yes", title: "✅ Sim, criar" },
          { id: "create_bill_no", title: "❌ Não" }
        ],
        payload.messageSource
      );
      
      await createAction(userId, "bill_suggestion", "bill", {
        bill_name: slots.description,
        estimated_value: slots.amount
      }, "choice", payload.messageId);
    }
    return;
  }
  
  // ❌ Falta slot - perguntar
  const nextMissing = missing[0];
  console.log(`💸 [RECLASSIFIED] Falta slot: ${nextMissing}`);
  
  await createAction(userId, "expense", "expense", slots, nextMissing, payload.messageId);
  
  const prompt = SLOT_PROMPTS[nextMissing];
  if (prompt?.useButtons && prompt.buttons) {
    await sendButtons(payload.phoneNumber, 
      `💸 R$ ${slots.amount?.toFixed(2)} - ${slots.description || "Conta"}\n\n${prompt.text}`,
      prompt.buttons, 
      payload.messageSource
    );
  } else {
    await sendMessage(payload.phoneNumber, prompt?.text || `Qual é o ${nextMissing}?`, payload.messageSource);
  }
  return;
}
    
    // ========================================================================
    // 🔄 RECURRING - Gastos Recorrentes
    // ========================================================================
    if (decision.actionType === "recurring") {
      const slots = decision.slots;
      const missing = getMissingSlots("recurring", slots);
      
      // ✅ EXECUÇÃO DIRETA: tem amount e description
      if (hasAllRequiredSlots("recurring", slots)) {
        console.log(`🔄 [RECURRING] Execução direta: R$ ${slots.amount} - ${slots.description}`);
        const actionId = activeAction?.intent === "recurring" ? activeAction.id : undefined;
        const result = await registerRecurring(userId, slots, actionId);
        
        // ✅ Marcar decisão como executada
        if (decision.decisionId) {
          await markAsExecuted(decision.decisionId, result.success ?? true);
        }
        
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const nextMissing = missing[0];
      
      if (activeAction?.intent === "recurring") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "recurring", "recurring", slots, nextMissing, payload.messageId);
      }
      
      // Perguntas específicas para recorrente
      if (nextMissing === "amount") {
        await sendMessage(payload.phoneNumber, "Qual o valor mensal? 💸", payload.messageSource);
      } else if (nextMissing === "description") {
        await sendMessage(payload.phoneNumber, "Qual gasto é esse? (ex: Netflix, Aluguel, Academia...)", payload.messageSource);
      } else if (nextMissing === "payment_method") {
        await sendButtons(payload.phoneNumber, 
          `🔄 ${slots.description || "Recorrente"} - R$ ${slots.amount?.toFixed(2)}/mês\n\nComo você paga?`, 
          [
            { id: "rec_pay_pix", title: "📱 Pix" },
            { id: "rec_pay_dinheiro", title: "💵 Dinheiro" },
            { id: "rec_pay_credito", title: "💳 Crédito" }
          ], 
          payload.messageSource
        );
      } else {
        await sendMessage(payload.phoneNumber, `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 📦 INSTALLMENT - Parcelamento (Cartão de Crédito ou Boleto)
    // ========================================================================
    if (decision.actionType === "installment") {
      const slots = decision.slots;
      console.log(`📦 [INSTALLMENT] Processando: ${JSON.stringify(slots)}`);
      
      const { registerInstallment, getMissingInstallmentSlots, hasAllRequiredInstallmentSlots } = 
        await import("../intents/installment.ts");
      
      // ========================================================================
      // STEP 0: Se não tem payment_method, perguntar boleto ou cartão
      // ========================================================================
      if (!slots.payment_method && !slots.card && !slots.card_id) {
        // Não especificou como pagou → perguntar com botões
        if (activeAction?.intent === "installment") {
          await updateAction(activeAction.id, { slots, pending_slot: "installment_payment" });
        } else {
          await createAction(userId, "installment", "installment", slots, "installment_payment", payload.messageId);
        }
        
        const valorDisplay = slots.amount ? `💰 R$ ${Number(slots.amount).toFixed(2)} em *${slots.installments || "?"}x*\n\n` : "";
        await sendButtons(payload.phoneNumber, 
          `${valorDisplay}📦 *${slots.description || "Parcelamento"}*\n\nÉ no cartão de crédito ou boleto?`,
          [
            { id: "installment_credito", title: "💳 Cartão de Crédito" },
            { id: "installment_boleto", title: "📄 Boleto" }
          ],
          payload.messageSource
        );
        return;
      }
      
      // ========================================================================
      // BOLETO PATH: Salvar como gastos recorrentes simples (sem cartão)
      // ========================================================================
      if (slots.payment_method === "boleto") {
        console.log(`📦 [INSTALLMENT] Fluxo BOLETO`);
        
        const valorTotal = Number(slots.amount || 0);
        const numParcelas = Number(slots.installments || 1);
        const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
        const { dateISO, timeString } = (await import("../finax-worker/utils/date-helpers.ts")).getBrasiliaISO();
        
        // Categorizar
        let category = slots.category || "outros";
        if (slots.description && !slots.category) {
          const { categorizeDescription } = await import("./ai/categorizer.ts");
          const catResult = await categorizeDescription(slots.description);
          category = catResult.category;
        }
        
        // Criar transação da primeira parcela
        await supabase.from("transacoes").insert({
          usuario_id: userId,
          valor: valorParcela,
          tipo: "saida",
          categoria: category,
          descricao: `${slots.description || "Parcelado boleto"} (1/${numParcelas})`,
          data: dateISO,
          data_transacao: dateISO,
          hora_transacao: timeString,
          origem: "whatsapp",
          forma_pagamento: "boleto",
          status: "confirmada",
          parcela: `1/${numParcelas}`,
          is_parcelado: true,
          total_parcelas: numParcelas
        });
        
        // Criar registro no parcelamentos
        await supabase.from("parcelamentos").insert({
          usuario_id: userId,
          descricao: slots.description || "Parcelamento boleto",
          valor_total: valorTotal,
          num_parcelas: numParcelas,
          parcela_atual: 1,
          valor_parcela: valorParcela,
          ativa: true,
        });
        
        // Fechar action
        if (activeAction) await closeAction(activeAction.id);
        
        await sendMessage(payload.phoneNumber, 
          `✅ *Parcelamento no boleto registrado!*\n\n` +
          `📦 *${slots.description || "Compra"}*\n` +
          `💰 R$ ${valorTotal.toFixed(2)} em *${numParcelas}x* de R$ ${valorParcela.toFixed(2)}\n` +
          `📄 Pagamento: Boleto\n\n` +
          `_1ª parcela registrada como gasto deste mês!_`,
          payload.messageSource
        );
        return;
      }
      
      // ========================================================================
      // CARTÃO PATH: Fluxo original com seleção de cartão
      // ========================================================================
      
      // ✅ TODOS OS SLOTS → PEDIR CONFIRMAÇÃO
      if (hasAllRequiredInstallmentSlots(slots as any)) {
        console.log(`🔒 [INSTALLMENT] Slots completos - solicitando confirmação`);
        
        const { requireConfirmation } = await import("../fsm/confirmation-gate.ts");
        const { generateConfirmationMessage } = await import("../fsm/context-handler.ts");
        
        const gateResult = await requireConfirmation(
          userId,
          "installment",
          slots as any,
          activeAction as any,
          payload.messageId
        );
        
        if (gateResult.canExecute) {
          const result = await registerInstallment(userId, slots as any, gateResult.actionId);
          await supabase.from("actions")
            .update({ status: "done" })
            .eq("user_id", userId)
            .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
          
          if (decision.decisionId) {
            await markAsExecuted(decision.decisionId, true);
          }
          
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        const valorParcela = (slots.amount || 0) / (slots.installments || 1);
        const confirmMsg = `*Confirmar parcelamento:*\n\n` +
          `📦 ${slots.description || "Compra"}\n` +
          `💰 R$ ${(slots.amount || 0).toFixed(2)} em *${slots.installments}x* de R$ ${valorParcela.toFixed(2)}\n` +
          (slots.card ? `💳 ${slots.card}\n` : "") +
          `\n✅ *Tudo certo?*`;
        
        await sendButtons(payload.phoneNumber, confirmMsg, [
          { id: "confirm_yes", title: "✅ Confirmar" },
          { id: "confirm_no", title: "❌ Cancelar" }
        ], payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const missingSlots = getMissingInstallmentSlots(slots as any);
      const nextMissing = missingSlots[0];
      
      if (activeAction?.intent === "installment") {
        await updateAction(activeAction.id, { slots, pending_slot: nextMissing });
      } else {
        await createAction(userId, "installment", "installment", slots, nextMissing, payload.messageId);
      }
      
      // Perguntas específicas
      if (nextMissing === "amount") {
        await sendMessage(payload.phoneNumber, "Qual o valor total da compra? 💰", payload.messageSource);
      } else if (nextMissing === "installments") {
        const prefix = slots.amount ? `💰 R$ ${slots.amount.toFixed(2)}\n\n` : "";
        await sendMessage(payload.phoneNumber, `${prefix}Em quantas vezes? (ex: 3x, 12x)`, payload.messageSource);
      } else if (nextMissing === "description") {
        await sendMessage(payload.phoneNumber, "O que você comprou?", payload.messageSource);
      } else if (nextMissing === "card") {
        const { listUserCards } = await import("../intents/credit-flow.ts");
        const cards = await listUserCards(userId);
        
        if (cards.length === 0) {
          await sendMessage(payload.phoneNumber, 
            "Você não tem cartões cadastrados 💳\n\nAdicione um: *Adicionar cartão Nubank limite 5000*", 
            payload.messageSource
          );
        } else if (cards.length <= 3) {
          const cardButtons = cards.map(c => ({ 
            id: `card_${c.id}`, 
            title: (c.nome || "Cartão").slice(0, 20) 
          }));
          await sendButtons(payload.phoneNumber, 
            "💳 Qual cartão?", 
            cardButtons, 
            payload.messageSource
          );
        } else {
          const sections = [{
            title: "Seus cartões",
            rows: cards.map(c => {
              const disponivel = c.limite_disponivel ?? c.limite_total ?? 0;
              return {
                id: `card_${c.id}`,
                title: (c.nome || "Cartão").slice(0, 24),
                description: `Disponível: R$ ${disponivel.toFixed(2)}`
              };
            })
          }];
          await sendListMessage(payload.phoneNumber, "💳 Qual cartão?", "Selecionar cartão", sections, payload.messageSource);
        }
      } else {
        await sendMessage(payload.phoneNumber, `Qual o ${nextMissing}?`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 📋 LIST_GOALS - Listar metas do usuário
    // ========================================================================
    if (decision.actionType === "list_goals") {
      console.log(`📋 [LIST_GOALS] Listando metas do usuário`);
      const { listGoals } = await import("../intents/goals.ts");
      const result = await listGoals(userId);
      await sendMessage(payload.phoneNumber, result, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 💳 DEBT - Registrar dívida
    // ========================================================================
    if (decision.actionType === "debt") {
      console.log(`💳 [DEBT] Registrando dívida: ${JSON.stringify(decision.slots)}`);
      const { registerDebt } = await import("../intents/debt-handler.ts");
      const result = await registerDebt(userId, decision.slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 📋 LIST_DEBTS - Listar dívidas
    // ========================================================================
    if (decision.actionType === "list_debts") {
      console.log(`📋 [LIST_DEBTS] Listando dívidas do usuário`);
      const { listDebts } = await import("../intents/debt-handler.ts");
      const result = await listDebts(userId);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }

    // ========================================================================
    // 📊 SIMULATE_DEBTS - Simulador de quitação via WhatsApp
    // ========================================================================
    if (decision.actionType === "simulate_debts") {
      console.log(`📊 [SIMULATE_DEBTS] Simulando quitação para usuário`);
      const { simulateDebts } = await import("../intents/debt-handler.ts");
      const result = await simulateDebts(userId, decision.slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🏁 QUERY_FREEDOM - Consultar dias de liberdade financeira
    // ========================================================================
    if (decision.actionType === "query_freedom") {
      console.log(`🏁 [QUERY_FREEDOM] Consultando dias de liberdade`);
      const { queryFreedomDays } = await import("../intents/freedom-insights.ts");
      const result = await queryFreedomDays(userId);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 💰 ADD_GOAL_PROGRESS - Adicionar valor à meta existente
    // ========================================================================
    if (decision.actionType === "add_goal_progress") {
      const slots = decision.slots;
      console.log(`💰 [ADD_GOAL] Adicionando à meta: ${JSON.stringify(slots)}`);
      
      const { listGoals, addToGoal } = await import("../intents/goals.ts");
      
      // ✅ BUSCAR METAS ATIVAS
      const { data: metasAtivas } = await supabase
        .from("savings_goals")
        .select("id, name, current_amount, target_amount")
        .eq("user_id", userId)
        .eq("status", "active");
      
      if (!metasAtivas || metasAtivas.length === 0) {
        await sendButtons(payload.phoneNumber, 
          "📋 Você ainda não tem metas ativas!\n\nQuer criar uma agora?",
          [
            { id: "goal_create_yes", title: "✅ Criar meta" },
            { id: "goal_create_no", title: "❌ Agora não" }
          ],
          payload.messageSource
        );
        return;
      }
      
      // Se só tem 1 meta → adicionar direto
      if (metasAtivas.length === 1 && slots.amount) {
        const meta = metasAtivas[0];
        const valorAdicionado = slots.amount;
        
        const result = await addToGoal(userId, meta.id, valorAdicionado);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Se tem valor mas precisa escolher meta
      if (slots.amount && metasAtivas.length > 1) {
        if (metasAtivas.length <= 3) {
          // Usar botões
          const goalButtons = metasAtivas.map(m => ({
            id: `goal_add_${m.id}`,
            title: m.name.slice(0, 20)
          }));
          await sendButtons(payload.phoneNumber,
            `💰 R$ ${slots.amount.toFixed(2)}\n\nEm qual meta quer adicionar?`,
            goalButtons,
            payload.messageSource
          );
        } else {
          // Usar lista interativa
          const sections = [{
            title: "Suas metas",
            rows: metasAtivas.map(m => ({
              id: `goal_add_${m.id}`,
              title: m.name.slice(0, 24),
              description: `R$ ${Number(m.current_amount).toFixed(2)} / R$ ${Number(m.target_amount).toFixed(2)}`
            }))
          }];
          await sendListMessage(payload.phoneNumber,
            `💰 R$ ${slots.amount.toFixed(2)}\n\nEm qual meta quer adicionar?`,
            "Selecionar meta",
            sections,
            payload.messageSource
          );
        }
        
        await createAction(userId, "add_goal_progress", "goal", {
          ...slots,
          goal_options: metasAtivas.map(m => ({ id: m.id, name: m.name }))
        }, "goal_id", payload.messageId);
        
        return;
      }
      
      // Falta valor
      if (!slots.amount) {
        await sendMessage(payload.phoneNumber, "💰 Quanto você quer adicionar à meta?", payload.messageSource);
        await createAction(userId, "add_goal_progress", "goal", slots, "amount", payload.messageId);
        return;
      }
      
      return;
    }
    
    // ========================================================================
    // 🎯 GOAL - Metas de Poupança (savings_goals) - CRIAR NOVA
    // ========================================================================
    if (decision.actionType === "goal") {
      const slots = decision.slots;
      console.log(`🎯 [GOAL] Processando meta: ${JSON.stringify(slots)}`);
      
      // Importar funções de goals
      const { createGoal, listGoals, addToGoal } = await import("../intents/goals.ts");
      
      const normalized = normalizeText(conteudoProcessado);
      
      // Listar metas (fallback - prioridade é list_goals)
      if (normalized.includes("minhas metas") || normalized.includes("ver metas") || 
          normalized.includes("quais metas") || normalized.includes("metas tenho")) {
        const result = await listGoals(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // ✅ FIX WA-2: Detectar intenção de ADICIONAR a meta existente
      // Palavras que indicam "já tenho X guardado" ou "adicionar X à meta"
      const ADD_INDICATORS = ["tenho", "guardei", "juntei", "adicionei", "depositar", "depositei", "adicionar", "acrescentar", "coloquei", "poupei", "economizei"];
      const isAddIntent = ADD_INDICATORS.some(w => normalized.includes(w));
      
      if (isAddIntent && slots.amount && slots.description) {
        // Verificar se já existe meta com nome similar
        const { data: existingGoals } = await supabase
          .from("savings_goals")
          .select("id, name, current_amount, target_amount")
          .eq("user_id", userId)
          .eq("status", "active");
        
        const goalName = normalizeText(slots.description);
        const matchedGoal = existingGoals?.find(g => {
          const gName = normalizeText(g.name);
          return gName.includes(goalName) || goalName.includes(gName);
        });
        
        if (matchedGoal) {
          // Meta encontrada → adicionar ao acumulado
          console.log(`🎯 [GOAL] Adicionando R$ ${slots.amount} à meta "${matchedGoal.name}"`);
          const result = await addToGoal(userId, matchedGoal.id, slots.amount);
          await sendMessage(payload.phoneNumber, result, payload.messageSource);
          return;
        }
        
        // Se tem múltiplas metas e não deu match → pedir seleção
        if (existingGoals && existingGoals.length > 0) {
          if (existingGoals.length <= 3) {
            const goalButtons = existingGoals.map(m => ({
              id: `goal_add_${m.id}`,
              title: m.name.slice(0, 20)
            }));
            await createAction(userId, "add_goal_progress", "goal", { amount: slots.amount }, "goal_id", payload.messageId);
            await sendButtons(payload.phoneNumber,
              `💰 R$ ${slots.amount.toFixed(2)}\n\nEm qual meta quer adicionar?`,
              goalButtons, payload.messageSource);
          } else {
            const sections = [{
              title: "Suas metas",
              rows: existingGoals.map(m => ({
                id: `goal_add_${m.id}`,
                title: m.name.slice(0, 24),
                description: `R$ ${Number(m.current_amount).toFixed(2)} / R$ ${Number(m.target_amount).toFixed(2)}`
              }))
            }];
            await createAction(userId, "add_goal_progress", "goal", { amount: slots.amount }, "goal_id", payload.messageId);
            await sendListMessage(payload.phoneNumber,
              `💰 R$ ${slots.amount.toFixed(2)}\n\nEm qual meta quer adicionar?`,
              "Selecionar meta", sections, payload.messageSource);
          }
          return;
        }
      }
      
      // Criar nova meta
      if (slots.amount && slots.description) {
        const result = await createGoal({
          userId,
          name: slots.description,
          targetAmount: slots.amount,
          deadline: slots.deadline ? new Date(slots.deadline) : undefined,
          category: slots.category
        });
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Falta informação → criar action com pending_slot para FSM capturar
      if (!slots.amount) {
        await createAction(userId, "goal", "goal", slots, "amount", payload.messageId);
        await sendMessage(payload.phoneNumber, "🎯 Qual o valor da meta?", payload.messageSource);
        return;
      }
      if (!slots.description) {
        await createAction(userId, "goal", "goal", slots, "description", payload.messageId);
        await sendMessage(payload.phoneNumber, "🎯 Qual o nome da meta? (ex: Viagem, Carro, Emergência...)", payload.messageSource);
        return;
      }
      
      return;
    }
    
    // ========================================================================
    // 🛒 PURCHASE - Consultor de Compras
    // ========================================================================
    if (decision.actionType === "purchase") {
      const slots = decision.slots;
      console.log(`🛒 [PURCHASE] Analisando compra: ${JSON.stringify(slots)}`);
      
      const { analyzePurchase } = await import("../intents/purchase.ts");
      const result = await analyzePurchase({
        userId,
        itemDescription: slots.description || "item",
        itemValue: slots.amount || 0,
        category: slots.category
      });
      await sendMessage(payload.phoneNumber, result, payload.messageSource);
      return;
    }
    
    // ========================================================================
    if (decision.actionType === "set_context") {
      const { handleSetContext } = await import("../intents/set-context.ts");
      await handleSetContext(userId, decision.slots, conteudoProcessado, decision.decisionId || null, sendMessage, payload.phoneNumber, payload.messageSource);
      return;
    }
    
    // 🗑️ CANCEL - BUSCA INTELIGENTE DE RECORRENTES + HANDLER DE SELEÇÃO
    if (decision.actionType === "cancel") {
      const normalized = normalizeText(conteudoProcessado);
      
      // ========================================================================
      // 🔢 HANDLER DE SELEÇÃO NUMÉRICA (veio do decision engine)
      // ========================================================================
      if (decision.slots.selected_id && decision.slots.selection_intent) {
        const selectedId = decision.slots.selected_id as string;
        const selectionIntent = decision.slots.selection_intent as string;
        
        console.log(`🔢 [CANCEL] Processando seleção: intent=${selectionIntent}, id=${selectedId}`);
        
        // Fechar action de seleção
        if (activeAction) {
          await closeAction(activeAction.id);
        }
        
        // Executar baseado no intent
        if (selectionIntent === "cancel_recurring") {
          const result = await cancelRecurring(userId, selectedId);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        if (selectionIntent === "cancel" || selectionIntent === "cancel_transaction") {
          const result = await cancelTransaction(userId, selectedId);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        // Fallback para outros tipos
        await sendMessage(payload.phoneNumber, "Ação processada! ✅", payload.messageSource);
        return;
      }
      
      // Non-selection cancel path → handler
      const { handleCancelRouting } = await import("../intents/cancel-routing.ts");
      await handleCancelRouting(userId, decision.slots, conteudoProcessado, payload.messageId, sendMessage, sendButtons, sendListMessage, payload.phoneNumber, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 📊 QUERY - Consultas financeiras
    // ========================================================================
    if (decision.actionType === "query") {
      const { handleQueryRouting } = await import("../intents/query-routing.ts");
      await handleQueryRouting(userId, decision.slots, conteudoProcessado, nomeUsuario, sendMessage, sendButtons, sendListMessage, payload.phoneNumber, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🚨 QUERY_ALERTS - Alertas Proativos (ELITE)
    // ========================================================================
    if (decision.actionType === "query_alerts") {
      console.log(`🚨 [ALERTS] Buscando alertas para usuário: ${userId}`);
      
      const { data: alerts } = await supabase
        .from("spending_alerts")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["detected", "eligible"])
        .is("sent_at", null)
        .order("utility_score", { ascending: false })
        .limit(5);
      
      if (!alerts || alerts.length === 0) {
        await sendMessage(payload.phoneNumber, "✨ *Tudo tranquilo!*\n\nNão há nada fora do normal nos seus gastos. Continue assim! 💪", payload.messageSource);
        return;
      }
      
      // Marcar como enviados
      const alertIds = alerts.map((a: any) => a.id);
      await supabase
        .from("spending_alerts")
        .update({ 
          sent_at: new Date().toISOString(), 
          status: "sent" 
        })
        .in("id", alertIds);
      
      // Formatar resposta
      const severityEmoji: Record<string, string> = {
        critical: "🚨",
        warning: "⚠️",
        info: "💡"
      };
      
      let response = `📊 *Seus Alertas* (${alerts.length})\n\n`;
      
      for (const alert of alerts) {
        const emoji = severityEmoji[alert.severity] || "💡";
        response += `${emoji} ${alert.message}\n\n`;
      }
      
      response += `_Responda "descartar alertas" para limpar._`;
      
      await sendMessage(payload.phoneNumber, response, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 💰 SET_BUDGET - Definir orçamento/limite mensal
    // ========================================================================
    if (decision.actionType === "set_budget") {
      console.log(`💰 [SET_BUDGET] Definindo orçamento para: ${userId}`);
      
      if (!decision.slots.amount) {
        // ✅ FIX Bug 3: Criar action com pending_slot para manter contexto
        await createAction(userId, "set_budget", "set_budget", {
          ...decision.slots
        }, "amount", payload.messageId);
        await sendMessage(payload.phoneNumber, "Qual valor de limite mensal você quer definir? 💸", payload.messageSource);
        return;
      }
      
      const result = await setBudget(userId, decision.slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: result.message,
        tipo: "set_budget"
      });
      return;
    }
    
}
