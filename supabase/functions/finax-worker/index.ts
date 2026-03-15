// Sentry must be imported FIRST for proper error tracking
import * as Sentry from "https://esm.sh/@sentry/deno@7";

// Initialize Sentry before any other code
const SENTRY_DSN = Deno.env.get("SENTRY_DSN");
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") || "production",
    tracesSampleRate: 0.1,
  });
}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyDeterministic } from "./decision/classifier.ts";
import { 
  PROMPT_FINAX_UNIVERSAL, 
  normalizeAISlots, 
  callAIForDecision, 
  decisionEngine,
  assertDomainIsolation,
  type ExtractedSlots,
  type SemanticResult
} from "./decision/ai-engine.ts";
import { detectMultipleExpenses, formatExpensesList, calculateTotal } from "./utils/multiple-expenses.ts";
import { 
  parseRelativeDate, 
  getBrasiliaDate, 
  formatBrasiliaDateTime, 
  formatBrasiliaDate,
  getBrasiliaISO,
  formatTimeAgo 
} from "./utils/date-helpers.ts";
import { queueMessage, markMessageProcessed, countPendingMessages, processNextInQueue } from "./utils/message-queue.ts";
import { logger } from "./utils/logger.ts";
import { FinaxError, FinaxErrorCode } from "./utils/errors.ts";
import { parseBrazilianAmount } from "./utils/parseAmount.ts";
import { getConversationContext, updateConversationContext, clearConversationContext, scopeToTopic } from "./utils/conversation-context.ts";
import { saveAIDecision, markAsExecuted, markAsIncorrect } from "./utils/ai-decisions.ts";
import { 
  SLOT_REQUIREMENTS, SLOT_PROMPTS, PAYMENT_ALIASES, SOURCE_ALIASES,
  hasAllRequiredSlots, getMissingSlots,
  type ActionType 
} from "./ui/slot-prompts.ts";
import { learnMerchantPattern } from "./memory/patterns.ts";
import { startOnboarding, handleOnboardingStep } from "./utils/onboarding.ts";
import {
  normalizeText, detectQueryScope, detectTimeRange,
  isNumericOnly, parseNumericValue, logDecision, extractSlotValue, extractPaymentMethodFromText
} from "./utils/helpers.ts";
import { sendMessage, sendButtons, sendListMessage } from "./ui/whatsapp-sender.ts";
import { analyzeImageWithGemini, downloadWhatsAppMedia, transcreverAudio, type OCRResult } from "./utils/media.ts";
import { getActiveAction, createAction, updateAction, closeAction, cancelAction } from "./fsm/action-manager.ts";
import { ensurePerfilCliente } from "./utils/profile.ts";
import { setBudget, checkBudgetAfterExpense } from "./intents/budget.ts";
import { checkAndSendPendingReport, gerarTextoRelatorioInline } from "./intents/reports-handler.ts";
import { registerExpenseInline, handleExpenseResult, getMonthlySummaryInline } from "./intents/expense-inline.ts";
import { registerIncome } from "./intents/income.ts";
import { categorizeDescription } from "./ai/categorizer.ts";
import { registerRecurring, tryRegisterRecurring, findRecurringByName, listActiveRecurrings, cancelRecurring } from "./intents/recurring-handler.ts";
import { listCardsForUser, updateCardLimit, queryCardLimits, queryCardExpenses, queryContextExpenses } from "./intents/card-queries.ts";
import { getActiveContext, createUserContext, closeUserContext, linkTransactionToContext } from "./intents/context-handler.ts";
import { generateChatResponse } from "./intents/chat-handler.ts";
import { listTransactionsForCancel, cancelTransaction, getLastTransaction, updateTransactionPaymentMethod } from "./intents/cancel-handler.ts";
import { handleDuplicateConfirmNo, handleDuplicateConfirmYes } from "./intents/duplicate-handler.ts";
import { finaxSalesResponse, shortenURL } from "./sales/seller.ts";
import { SITE_URL, PRICE_BASICO, PRICE_PRO, PRO_ONLY_INTENTS, PRO_TEASER_INTENTS, STRIPE_IMPORT_URL, CHAT_CONFIDENCE_THRESHOLD, HISTORY_CONTEXT_LIMIT, SIMULTANEOUS_MSG_WINDOW_MS } from "./config/constants.ts";
import { isProUser as checkIsProUser } from "./core/plan-guard.ts";

// DecisionOutput type used by processarJob
interface DecisionOutput {
  actionType: string;
  confidence: number;
  reasoning: string;
  slots: ExtractedSlots;
  missingSlots: string[];
  shouldExecute: boolean;
  shouldAsk: boolean;
  question: string | null;
  buttons: Array<{ id: string; title: string }> | null;
  decisionId?: string | null;
}

// ============================================================================
// 🔗 ALIASES para compatibilidade com nomes antigos usados no processarJob
// ============================================================================
const registerExpense = registerExpenseInline;
const getMonthlySummary = getMonthlySummaryInline;

// ============================================================================
// 💳 CHECKOUT URL GENERATOR
// ============================================================================
async function generateCheckoutUrl(planType: "basico" | "pro", phone: string): Promise<string> {
  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId = planType === "pro"
      ? Deno.env.get("STRIPE_PRICE_PRO")
      : Deno.env.get("STRIPE_PRICE_BASICO");

    if (!stripeSecretKey || !priceId) {
      return `${SITE_URL}/?plan=${planType}`;
    }

    const { default: Stripe } = await import(STRIPE_IMPORT_URL);
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/dashboard?success=true&plan=${planType}`,
      cancel_url: `${SITE_URL}/?canceled=true`,
      metadata: { plan: planType, phone },
      subscription_data: { metadata: { plan: planType } },
      allow_promotion_codes: true,
      phone_number_collection: { enabled: true },
    });

    return session.url || `${SITE_URL}/?plan=${planType}`;
  } catch (err) {
    console.error("[WORKER] Stripe checkout error:", err);
    return `${SITE_URL}/?plan=${planType}`;
  }
}

// Wrapper para handleExpenseResult que injeta sendMessage/sendButtons
async function handleExpenseResultCompat(
  result: { success: boolean; message: string; isDuplicate?: boolean },
  phoneNumber: string,
  messageSource: "meta" | "vonage"
): Promise<void> {
  return handleExpenseResult(result, phoneNumber, messageSource, sendMessage, sendButtons);
}

// ============================================================================
// 🏭 FINAX WORKER v6.0 - IA-FIRST ARCHITECTURE
// ============================================================================
//
// NOVA ARQUITETURA (v6.0):
// 1. FAST-TRACK: Extrai estrutura (números, pagamento) SEM classificar intent
// 2. IA: Classifica 100% das intenções semânticas (gasto, entrada, recorrente)
// 3. EXECUTORS: Módulos que APENAS executam ações baseado na IA
//
// MUDANÇAS DA v5.x → v6.0:
// - REMOVIDO: Keywords/heurísticas para classificação (quebrava muito)
// - REMOVIDO: classifySemanticHeuristic e SEMANTIC_PATTERNS
// - ADICIONADO: Fast-track estrutural que só extrai slots
// - MELHORADO: IA agora é fonte única de verdade para intent
//
// REGRAS DE OURO:
// - IA interpreta linguagem natural (não keywords)
// - Fast-track apenas acelera extração, não classifica
// - Código apenas EXECUTA o que a IA decidiu
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Credentials
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 TIPOS (inline para edge function)
// ============================================================================

type MessageSource = "meta" | "vonage";
type TipoMidia = "text" | "audio" | "image";
// ActionType importado de ui/slot-prompts.ts

interface JobPayload {
  phoneNumber: string;
  messageText: string;
  messageType: TipoMidia;
  messageId: string;
  mediaId: string | null;
  mediaMimeType: string;
  messageSource: MessageSource;
  nomeContato: string | null;
  evento_id: string | null;
  buttonReplyId: string | null;
  listReplyId?: string | null;
  replyToMessageId?: string | null;
}

interface ActiveAction {
  id: string;
  user_id: string;
  type: string;
  intent: string;
  slots: Record<string, any>;
  status: string;
  pending_slot?: string | null;
  pending_selection_id?: string | null;
  origin_message_id?: string | null;
  last_message_id?: string | null;
  meta?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

// ============================================================================
// 🎰 CONSTANTS — importados de ui/slot-prompts.ts
// ============================================================================
// SLOT_REQUIREMENTS, SLOT_PROMPTS, PAYMENT_ALIASES, SOURCE_ALIASES,
// hasAllRequiredSlots, getMissingSlots → importados no topo do arquivo
// ============================================================================

// ============================================================================
// 🔄 PROCESSAMENTO PRINCIPAL
// ============================================================================

async function processarJob(job: any): Promise<void> {
  const payload: JobPayload = job.payload;
  const userId = job.user_id;
  const eventoId = payload.evento_id;
  
  console.log(`\n🔄 [WORKER] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📩 [WORKER] Job ${job.id?.slice(-8)} | ${payload.messageType} | User: ${userId?.slice(0, 8)}`);
  console.log(`💬 [WORKER] Msg: "${payload.messageText?.slice(0, 50)}${payload.messageText?.length > 50 ? '...' : ''}"`);
  
  try {
    // ========================================================================
    // 🧹 FIX #1: TTL CLEANUP — Cancelar actions expiradas ANTES de processar
    // ========================================================================
    try {
      const { count } = await supabase
        .from("actions")
        .update({ status: "expired" })
        .lt("expires_at", new Date().toISOString())
        .in("status", ["collecting", "awaiting_input", "pending_selection"]);
      
      if (count && count > 0) {
        console.log(`🧹 [TTL_CLEANUP] ${count} action(s) expirada(s) canceladas`);
      }
    } catch (ttlErr) {
      console.warn(`🧹 [TTL_CLEANUP] Erro (não-bloqueante):`, ttlErr);
    }
    
    // Buscar usuário
    const { data: usuario } = await supabase.from("usuarios").select("*").eq("id", userId).single();
    const nomeUsuario = usuario?.nome || "amigo(a)";
    
    // ✅ Atualizar ultima_interacao e interacoes_hoje
    if (usuario) {
      await supabase.rpc("fn_atualizar_interacao", { p_usuario_id: userId });
    }
    
    // ========================================================================
    // 🔒 BLOQUEIO COGNITIVO: VERIFICAR PLANO DO USUÁRIO
    // ========================================================================
    // Antes de qualquer processamento, verificar se o trial expirou.
    // Se expirou, bloquear e direcionar para ativação.
    // ========================================================================
    if (usuario) {
      const plano = usuario.plano || "trial";
      const trialFim = usuario.trial_fim ? new Date(usuario.trial_fim) : null;
      const agora = new Date();
      
      // Verificar se trial expirou
      if (plano === "trial" && trialFim && trialFim < agora) {
        console.log(`🔒 [BLOQUEIO] Trial expirado para usuário ${userId}`);
            
        // ================================================================
        // 🔑 VERIFICAR CÓDIGO DE ATIVAÇÃO
        // ================================================================
        const msgText = payload.messageText?.trim().toUpperCase() || "";
        const msgLower = payload.messageText?.trim().toLowerCase() || "";
        const codigoMatch = msgText.match(/^(FINAX[-\s]?)?([A-Z0-9]{6,12})$/);
        
        if (codigoMatch) {
          const codigo = codigoMatch[2] || codigoMatch[0];
          console.log(`🔑 [ATIVAÇÃO] Tentando validar código: ${codigo}`);
          
          const { data: resultado } = await supabase.rpc("validar_codigo_ativacao", {
            p_codigo: codigo,
            p_usuario_id: userId
          });
          
          if (resultado?.valido) {
            await sendMessage(payload.phoneNumber, 
              `✅ *Plano ${resultado.plano === 'pro' ? 'Pro' : 'Básico'} ativado com sucesso!*\n\nAgora você tem acesso completo ao Finax. 🎉\n\nMe conta: o que posso te ajudar hoje?`, 
              payload.messageSource
            );
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: `[CÓDIGO: ${codigo}]`,
              ai_response: `Plano ${resultado.plano} ativado`,
              tipo: "ativacao"
            });
            return;
          } else {
            const erroMsgs: Record<string, string> = {
              codigo_inexistente: "Hmm, não encontrei esse código. Confere se digitou certinho? 🤔",
              codigo_usado: "Esse código já foi usado anteriormente.",
              codigo_expirado: "Esse código expirou. Entre em contato para ajuda."
            };
            await sendMessage(payload.phoneNumber, 
              erroMsgs[resultado?.erro] || "Código inválido. Tenta de novo?", 
              payload.messageSource
            );
            return;
          }
        }
        
        // ================================================================
        // 🧠 DETECÇÃO INTELIGENTE DE INTENÇÃO DE COMPRA
        // ================================================================
        const PURCHASE_INTENT_WORDS = ["link", "pagar", "assinar", "plano", "valor", "preço", "checkout", "comprar", "quero", "como assinar", "manda o link", "manda o site", "site"];
        const wantsBasico = /\b(b[aá]sico|plano\s*1|basico)\b/i.test(msgLower);
        const wantsPro = /\b(pro|plano\s*2|premium)\b/i.test(msgLower);
        const wantsSite = /\b(site|ver\s*site|plano\s*3)\b/i.test(msgLower);
        const hasPurchaseIntent = PURCHASE_INTENT_WORDS.some(w => msgLower.includes(w));
        
        // Resposta numérica direta (1, 2, 3)
        const numericChoice = msgText.match(/^[123]$/);
        
        const primeiroNome = nomeUsuario.split(" ")[0];
        
        if (numericChoice) {
          const choice = numericChoice[0];
          if (choice === "1" || wantsBasico) {
            const rawUrl = await generateCheckoutUrl("basico", payload.phoneNumber);
            const url = await shortenURL(rawUrl, userId, "choice_basico");
            await sendMessage(payload.phoneNumber,
              `📱 *Plano Básico* — R$ 19,90/mês\n\nRegistro ilimitado, orçamentos, relatórios e controle completo.\n\n👉 Assine aqui: ${url}`,
              payload.messageSource
            );
          } else if (choice === "2" || wantsPro) {
            const rawUrl = await generateCheckoutUrl("pro", payload.phoneNumber);
            const url = await shortenURL(rawUrl, userId, "choice_pro");
            await sendMessage(payload.phoneNumber,
              `⭐ *Plano Pro* — R$ 29,90/mês\n\nTudo do Básico + simulador de quitação, insights preditivos, cartões ilimitados e suporte prioritário.\n\n👉 Assine aqui: ${url}`,
              payload.messageSource
            );
          } else if (choice === "3" || wantsSite) {
            await sendMessage(payload.phoneNumber,
              `🌐 Acesse nosso site para ver todos os detalhes:\n\n👉 ${SITE_URL}`,
              payload.messageSource
            );
          }
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber, user_id: userId,
            user_message: payload.messageText, ai_response: `[SALES - choice ${choice}]`, tipo: "venda_trial"
          });
          return;
        }
        
        // Pediu plano específico diretamente
        if (wantsBasico) {
          const rawUrl = await generateCheckoutUrl("basico", payload.phoneNumber);
          const url = await shortenURL(rawUrl, userId, "direct_basico");
          await sendMessage(payload.phoneNumber,
            `Perfeito! 👌\n\n📱 *Básico* — R$ 19,90/mês\nRegistro ilimitado, relatórios e controle completo.\n\n👉 Assine aqui: ${url}`,
            payload.messageSource
          );
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber, user_id: userId,
            user_message: payload.messageText, ai_response: "[SALES - basico link]", tipo: "venda_trial"
          });
          return;
        }
        
        if (wantsPro) {
          const rawUrl = await generateCheckoutUrl("pro", payload.phoneNumber);
          const url = await shortenURL(rawUrl, userId, "direct_pro");
          await sendMessage(payload.phoneNumber,
            `Excelente escolha! 🚀\n\n⭐ *Pro* — R$ 29,90/mês\nTudo do Básico + simulador, insights com IA e cartões ilimitados.\n\n👉 Assine aqui: ${url}`,
            payload.messageSource
          );
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber, user_id: userId,
            user_message: payload.messageText, ai_response: "[SALES - pro link]", tipo: "venda_trial"
          });
          return;
        }
        
        if (wantsSite) {
          await sendMessage(payload.phoneNumber, `🌐 Acesse: ${SITE_URL}`, payload.messageSource);
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber, user_id: userId,
            user_message: payload.messageText, ai_response: "[SALES - site]", tipo: "venda_trial"
          });
          return;
        }
        
        // Pediu link genérico ou tem intenção de compra
        if (hasPurchaseIntent) {
          const rawBasico = await generateCheckoutUrl("basico", payload.phoneNumber);
          const rawPro = await generateCheckoutUrl("pro", payload.phoneNumber);
          const urlBasico = await shortenURL(rawBasico, userId, "purchase_intent_basico");
          const urlPro = await shortenURL(rawPro, userId, "purchase_intent_pro");
          await sendMessage(payload.phoneNumber,
            `Perfeito! 👌\n\nEscolha seu plano:\n\n📱 *Básico* — R$ 19,90/mês\n👉 ${urlBasico}\n\n⭐ *Pro* — R$ 29,90/mês\n👉 ${urlPro}\n\n🌐 Mais detalhes: ${SITE_URL}`,
            payload.messageSource
          );
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber, user_id: userId,
            user_message: payload.messageText, ai_response: "[SALES - links enviados]", tipo: "venda_trial"
          });
          return;
        }
        
        // ================================================================
        // 🤖 VENDEDOR IA — Responde qualquer mensagem de forma persuasiva
        // ================================================================
        const rawBasico = await generateCheckoutUrl("basico", payload.phoneNumber);
        const rawPro = await generateCheckoutUrl("pro", payload.phoneNumber);
        const urlBasico = await shortenURL(rawBasico, userId, "seller_basico");
        const urlPro = await shortenURL(rawPro, userId, "seller_pro");
        
        const sellerResponse = await finaxSalesResponse(
          userId,
          payload.messageText || "quero saber sobre os planos",
          urlBasico,
          urlPro
        );
        
        await sendMessage(payload.phoneNumber, sellerResponse, payload.messageSource);
        
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: payload.messageText || "[MÍDIA]",
          ai_response: sellerResponse.substring(0, 200),
          tipo: "bloqueio_trial"
        });
        return;
      }
      
      // Verificar alerta de trial expirando (dias 10, 12, 14)
      if (plano === "trial" && trialFim) {
        const diasRestantes = Math.ceil((trialFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
        
        // Verificar se já enviamos alerta hoje
        const { data: alertaHoje } = await supabase
          .from("historico_conversas")
          .select("id")
          .eq("user_id", userId)
          .eq("tipo", "alerta_trial")
          .gte("created_at", new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString())
          .limit(1);
        
        if (!alertaHoje || alertaHoje.length === 0) {
          if (diasRestantes === 4) {
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: "[ALERTA TRIAL]",
              ai_response: "4 dias restantes",
              tipo: "alerta_trial"
            });
            // Alerta sutil no próximo processamento (não bloqueia)
            console.log(`⚠️ [TRIAL] Usuário ${userId} tem 4 dias restantes`);
          } else if (diasRestantes === 2) {
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: "[ALERTA TRIAL]",
              ai_response: "2 dias restantes",
              tipo: "alerta_trial"
            });
            console.log(`⚠️ [TRIAL] Usuário ${userId} tem 2 dias restantes`);
          } else if (diasRestantes === 1) {
            await supabase.from("historico_conversas").insert({
              phone_number: payload.phoneNumber,
              user_id: userId,
              user_message: "[ALERTA TRIAL]",
              ai_response: "1 dia restante",
              tipo: "alerta_trial"
            });
            console.log(`🚨 [TRIAL] Usuário ${userId} tem 1 dia restante`);
          }
        }
      }
      
      // Verificar e enviar relatórios pendentes
      await checkAndSendPendingReport(userId, payload.phoneNumber, payload.messageSource, sendMessage);
    }
    
    // ========================================================================
    // 📷 PROCESSAMENTO INTELIGENTE DE IMAGENS (OCR com Gemini Vision)
    // ========================================================================
    // Em vez de ignorar imagens, analisamos com IA para extrair dados.
    // Se não encontrar informação completa, fazemos perguntas inteligentes.
    // ========================================================================
    if (payload.messageType === "image") {
      console.log(`📷 [WORKER] Imagem recebida - iniciando análise com Gemini Vision`);
      
      try {
        // 1. Baixar imagem do WhatsApp
        const imageBase64 = await downloadWhatsAppMedia(payload.mediaId || "", eventoId || "");
        
        if (!imageBase64) {
          console.log(`📷 [WORKER] Não foi possível baixar a imagem`);
          await sendMessage(payload.phoneNumber, "Não consegui baixar a imagem 😕 Pode tentar enviar novamente?", payload.messageSource);
          return;
        }
        
        // 2. Analisar imagem com Gemini Vision
        const ocrResult = await analyzeImageWithGemini(imageBase64);
        console.log(`📷 [OCR] Resultado: ${JSON.stringify(ocrResult)}`);
        
        // 3. Salvar análise na tabela media_analysis
        await supabase.from("media_analysis").insert({
          message_id: payload.messageId,
          evento_bruto_id: eventoId || null,
          raw_ocr: ocrResult.raw || null,
          parsed: ocrResult,
          confidence: ocrResult.confidence || 0,
          source: "gemini_vision"
        });
        
        // 4. Fluxo baseado no resultado
        
        // ✅ NOVO: Múltiplos itens detectados na imagem
        if (ocrResult.items && ocrResult.items.length >= 2) {
          console.log(`📷 [OCR] ${ocrResult.items.length} itens detectados na imagem`);
          
          // Formatar lista de itens
          const itemsList = ocrResult.items.map((item, i) => `${i + 1}. ${item.descricao} R$ ${item.valor.toFixed(2)}`).join("\n");
          const totalValue = ocrResult.items.reduce((sum, item) => sum + item.valor, 0);
          
          // Reutilizar fluxo multi_expense existente com slot names compatíveis
          const detectedExpenses = ocrResult.items.map(item => ({
            amount: item.valor,
            description: item.descricao
          }));
          
          await createAction(userId, "multi_expense", "multi_expense", {
            from_image: true,
            detected_expenses: detectedExpenses,
            total: totalValue,
            original_message: `[IMAGEM: ${ocrResult.items.map(i => i.descricao).join(" + ")}]`,
            forma_pagamento: ocrResult.forma_pagamento || undefined
          }, null, payload.messageId);
          
          await sendButtons(
            payload.phoneNumber,
            `📷 Vi *${ocrResult.items.length} gastos* na imagem:\n\n${itemsList}\n\n💰 *Total:* R$ ${totalValue.toFixed(2)}\n\nComo quer registrar?`,
            [
              { id: "multi_separado", title: "📝 Separado" },
              { id: "multi_junto", title: "💰 Tudo junto" }
            ],
            payload.messageSource
          );
          
        } else if (ocrResult.valor && ocrResult.descricao) {
          // Caso perfeito: tem valor E descrição → processar como expense
          console.log(`📷 [OCR] Dados completos: R$ ${ocrResult.valor} - ${ocrResult.descricao}`);
          
          const slots: ExtractedSlots = {
            amount: ocrResult.valor,
            description: ocrResult.descricao,
            payment_method: ocrResult.forma_pagamento || undefined
          };
          
          // Se tem forma de pagamento, pode executar direto
          if (slots.payment_method) {
            const result = await registerExpense(userId, slots, undefined);
            await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource);
          } else {
            // Falta forma de pagamento → perguntar
            await createAction(userId, "expense", "expense", slots, "payment_method", payload.messageId);
            await sendButtons(
              payload.phoneNumber, 
              `📷 Vi na imagem:\n\n💰 *Valor:* R$ ${ocrResult.valor.toFixed(2)}\n📝 *Descrição:* ${ocrResult.descricao}\n\nComo você pagou?`,
              SLOT_PROMPTS.payment_method.buttons!,
              payload.messageSource
            );
          }
          
        } else if (ocrResult.valor) {
          // Só valor: perguntar descrição
          console.log(`📷 [OCR] Só valor encontrado: R$ ${ocrResult.valor}`);
          
          await createAction(userId, "expense", "expense", { amount: ocrResult.valor }, "description", payload.messageId);
          await sendMessage(
            payload.phoneNumber, 
            `📷 Vi que o valor é *R$ ${ocrResult.valor.toFixed(2)}*.\n\nO que você comprou?`,
            payload.messageSource
          );
          
        } else {
          // Nada identificado: perguntar valor primeiro (de forma amigável)
          console.log(`📷 [OCR] Nenhum dado identificado na imagem`);
          
          await createAction(userId, "expense", "expense", { from_image: true }, "amount", payload.messageId);
          await sendMessage(
            payload.phoneNumber, 
            "📷 Recebi a imagem!\n\nVamos registrar juntos. Qual foi o valor?",
            payload.messageSource
          );
        }
        
        // Salvar no histórico
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: "[IMAGEM]",
          ai_response: `OCR processado: valor=${ocrResult.valor || 'N/A'}, desc=${ocrResult.descricao || 'N/A'}`,
          tipo: "image_ocr"
        });
        
        return;
        
      } catch (ocrError) {
        console.error(`📷 [OCR] Erro no processamento:`, ocrError);
        
        // Fallback amigável
        await createAction(userId, "expense", "expense", { from_image: true }, "amount", payload.messageId);
        await sendMessage(
          payload.phoneNumber, 
          "📷 Recebi a imagem!\n\nVamos registrar juntos. Qual foi o valor?",
          payload.messageSource
        );
        
        return;
      }
    }
    
    // ========================================================================
    // 🔕 GUARD: VERIFICAR OPERATION_MODE
    // ========================================================================
    const { data: perfil } = await supabase
      .from("perfil_cliente")
      .select("operation_mode")
      .eq("usuario_id", userId)
      .single();
    
    const operationMode = perfil?.operation_mode || "normal";
    console.log(`🔕 [WORKER] operation_mode: ${operationMode}`);
    
    // ========================================================================
    // 🎯 ONBOARDING COMPLETO: Verificar se há onboarding ativo
    // ========================================================================
    const { data: activeOnboarding } = await supabase
      .from("user_onboarding")
      .select("current_step")
      .eq("user_id", userId)
      .single();
    
    // ✅ FIX Bug 2: Handler para "Vamos"/"Bora" APÓS onboarding done
    if (activeOnboarding?.current_step === "done") {
      const postOnbNormalized = normalizeText(payload.messageText);
      const POST_ONB_WORDS = ["vamos", "bora", "comecar", "comecando", "iniciar", "start", "vamo", "partiu"];
      
      if (POST_ONB_WORDS.some(w => postOnbNormalized.includes(w))) {
        console.log(`🎯 [ONBOARDING] Texto pós-onboarding detectado: "${payload.messageText}"`);
        await sendMessage(payload.phoneNumber,
          `🚀 *Vamos lá!*\n\nÉ simples, me manda:\n\n• *"Gastei 50 no mercado"* — registro rápido\n• *"Quanto gastei?"* — resumo do mês\n• *"Orçamento 2000"* — definir limite\n• *"Me ajuda"* — ver tudo que posso fazer\n\nBora começar? Me conta seu primeiro gasto! 💪`,
          payload.messageSource
        );
        await supabase.from("historico_conversas").insert({ phone_number: payload.phoneNumber, user_id: userId, user_message: payload.messageText, ai_response: "[ONBOARDING - VAMOS]", tipo: "onboarding" });
        return;
      }
    }
    
    if (activeOnboarding && activeOnboarding.current_step !== "done") {
      console.log(`🎯 [ONBOARDING] Step ativo: ${activeOnboarding.current_step}`);
      const handled = await handleOnboardingStep(userId, payload.phoneNumber, payload.messageText || "", payload.buttonReplyId || undefined);
      if (handled) {
        await supabase.from("historico_conversas").insert({ phone_number: payload.phoneNumber, user_id: userId, user_message: payload.messageText || "[MÍDIA]", ai_response: "[ONBOARDING]", tipo: "onboarding" });
        return;
      }
    }
    
    // Verificar novo usuário (onboarding)
    const { count: historicoCount } = await supabase
      .from("historico_conversas")
      .select("id", { count: "exact", head: true })
      .eq("phone_number", payload.phoneNumber);
    
    if ((historicoCount || 0) === 0) {
      console.log(`🎉 [WORKER] Novo usuário - iniciando onboarding completo: ${payload.phoneNumber}`);
      await startOnboarding(userId, payload.phoneNumber);
      await supabase.from("historico_conversas").insert({ phone_number: payload.phoneNumber, user_id: userId, user_message: payload.messageText || "[MÍDIA]", ai_response: "[ONBOARDING]", tipo: "onboarding" });
      return;
    }
    // ========================================================================
    // 🎯 BUSCAR CONTEXTO ATIVO
    // ========================================================================
    const activeAction = await getActiveAction(userId);
    
    logDecision({ messageId: payload.messageId, decision: "start", details: { hasContext: !!activeAction, contextType: activeAction?.intent } });
    
    // ========================================================================
    // 🤝 PRIORIDADE 0: ACK DETECTION (Cortesia)
    // ========================================================================
    // Mensagens de cortesia como "Obrigado", "Valeu", "Ok" não devem disparar
    // nenhum fluxo de registro. Apenas responder amigavelmente.
    // ========================================================================
    const ACK_TOKENS = [
      "obrigado", "obrigada", "obg", "brigado", "brigada",
      "valeu", "vlw", "thanks", "thank you", "thx",
      "ok", "okay", "blz", "beleza", "entendi", "entendido",
      "certo", "fechou", "combinado", "perfeito", "massa",
      "top", "show", "dahora", "legal", "ótimo", "otimo",
      "maravilha", "excelente", "tranquilo", "suave"
    ];
    
    function isAcknowledgement(text: string): boolean {
      const normalized = normalizeText(text);
      const words = normalized.split(/\s+/);
      
      // Se tem mais de 3 palavras, provavelmente não é só cortesia
      if (words.length > 3) return false;
      
      // Verificar se algum token de ACK está presente
      return ACK_TOKENS.some(token => normalized.includes(token));
    }
    
    if (isAcknowledgement(payload.messageText || "")) {
      console.log(`🤝 [ACK] Mensagem de cortesia detectada: "${payload.messageText}"`);
      
      // Se há action pendente, manter estado (não interromper coleta)
      if (activeAction && activeAction.pending_slot) {
        console.log(`🤝 [ACK] Action pendente - mantendo estado, não respondendo`);
        // Silêncio - apenas manter o fluxo
        return;
      }
      
      // Responder amigavelmente
      const ackResponses = [
        "De nada! 😊 Me chama se precisar de algo.",
        "Por nada! Tô aqui quando precisar 💪",
        "Sempre às ordens! 🙌"
      ];
      const randomResponse = ackResponses[Math.floor(Math.random() * ackResponses.length)];
      
      await sendMessage(payload.phoneNumber, randomResponse, payload.messageSource);
      
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: payload.messageText,
        ai_response: randomResponse,
        tipo: "ack"
      });
      
      return;
    }
    
    // ========================================================================
    // 🔘 PRIORIDADE 1: CALLBACK DE BOTÃO
    // ========================================================================
    // 🔘 DETECTAR SE É CALLBACK DE BOTÃO OU LISTA
    const isButtonReply = !!(payload.buttonReplyId || payload.listReplyId);
    
    // ✅ NORMALIZAR: usar buttonReplyId para ambos (lista usa listReplyId)
    if (payload.listReplyId && !payload.buttonReplyId) {
      payload.buttonReplyId = payload.listReplyId;
      console.log(`📋 [LIST] Convertido listReplyId → buttonReplyId: ${payload.listReplyId}`);
    }
    
    if (isButtonReply && payload.buttonReplyId) {
      console.log(`🔘 [BUTTON] Callback: ${payload.buttonReplyId}`);

      // duplicate_confirm handlers (mantidos aqui — dependências diretas)
      if (payload.buttonReplyId === "duplicate_confirm_yes") {
        await handleDuplicateConfirmYes({
          userId,
          activeAction,
          phoneNumber: payload.phoneNumber,
          messageSource: payload.messageSource,
          registerExpense,
          closeAction,
          sendMessage,
        });
        return;
      }

      if (payload.buttonReplyId === "duplicate_confirm_no") {
        await handleDuplicateConfirmNo({
          userId,
          activeAction,
          phoneNumber: payload.phoneNumber,
          messageSource: payload.messageSource,
          closeAction,
          sendMessage,
        });
        return;
      }

      // ── Query callbacks (view_all_, view_by_category_) ─────────────────────
      if (
        payload.buttonReplyId.startsWith("view_all_") ||
        payload.buttonReplyId.startsWith("view_by_category_")
      ) {
        const { handleQueryCallbacks } = await import("./handlers/query-callbacks.ts");
        const handled = await handleQueryCallbacks(
          payload.buttonReplyId,
          userId,
          sendMessage,
          sendButtons,
          sendListMessage,
          payload.phoneNumber,
          payload.messageSource
        );
        if (handled) return;
      }

      // ── Payment & card callbacks ────────────────────────────────────────────
      const { handlePaymentCallbacks } = await import("./handlers/payment-callbacks.ts");
      const payHandled = await handlePaymentCallbacks(
        payload.buttonReplyId,
        userId,
        activeAction,
        sendMessage,
        sendButtons,
        sendListMessage,
        payload.phoneNumber,
        payload.messageSource,
        payload.messageId ?? ""
      );
      if (payHandled) return;

      // ── General button callbacks ────────────────────────────────────────────
      const { handleButtonCallbacks } = await import("./handlers/button-callbacks.ts");
      const btnHandled = await handleButtonCallbacks(
        payload.buttonReplyId,
        userId,
        activeAction,
        sendMessage,
        sendButtons,
        sendListMessage,
        payload.phoneNumber,
        payload.messageSource,
        payload.messageId ?? ""
      );
      if (btnHandled) return;
    }

    
    let conteudoProcessado = payload.messageText;
    
    if (payload.messageType === "audio" && payload.mediaId) {
      const audioBase64 = await downloadWhatsAppMedia(payload.mediaId, eventoId || undefined);
      if (!audioBase64) {
        await sendMessage(payload.phoneNumber, "Não peguei o áudio 🎤\n\n👉 Pode escrever?", payload.messageSource);
        return;
      }
      const transcricao = await transcreverAudio(audioBase64);
      if (!transcricao.texto) {
        await sendMessage(payload.phoneNumber, "Não entendi o áudio 🎤\n\n👉 Pode escrever?", payload.messageSource);
        return;
      }
      conteudoProcessado = transcricao.texto;
    }
    
    // ========================================================================
    // 🧹 COMANDO "ESQUECE CONTEXTO" - Limpar memória de curto prazo
    // ========================================================================
    const RESET_COMMANDS = ["esquece", "limpa contexto", "comeca de novo", "reseta", "limpar", "esquece tudo"];
    const normalizedForReset = normalizeText(conteudoProcessado);
    
    if (RESET_COMMANDS.some(cmd => normalizedForReset.includes(cmd))) {
      await clearConversationContext(userId);
      await cancelAction(userId);
      await sendMessage(
        payload.phoneNumber,
        "✅ Contexto limpo! Podemos começar uma nova conversa 😊",
        payload.messageSource
      );
      return;
    }
    
    // ========================================================================
    // 🔒 LOCK: Detectar mensagens simultâneas (< 2 segundos)
    // ========================================================================
    // Se o usuário mandou múltiplas mensagens em < 2s, enfileirar as extras
    // para evitar processamento paralelo e respostas duplicadas.
    // ========================================================================
    const { data: recentMessages } = await supabase
      .from("historico_conversas")
      .select("id, created_at")
      .eq("phone_number", payload.phoneNumber)
      .gte("created_at", new Date(Date.now() - 2000).toISOString())
      .order("created_at", { ascending: false });

    // Se já tem 1+ mensagem nos últimos 2s E não é resposta a slot ativo
    if ((recentMessages?.length || 0) >= 1) {
      const activeActionForLock = await getActiveAction(userId);
      
      // Verificar se é resposta a um slot (não enfileirar nesse caso)
      const isSlotResponse = activeActionForLock?.pending_slot && (
        // Respostas típicas de slot: pagamento, números curtos, confirmações
        /^(pix|debito|débito|credito|dinheiro|cartao|sim|nao|\d{1,4})$/i.test(conteudoProcessado.trim())
      );
      
      // Verificar se parece um novo gasto (tem valor numérico + mais texto)
      const hasAmount = /\d+/.test(conteudoProcessado);
      const isLikelyNewExpense = hasAmount && conteudoProcessado.length > 4;
      
      if (!isSlotResponse && isLikelyNewExpense) {
        console.log(`📬 [LOCK] Mensagem simultânea detectada - enfileirando: "${conteudoProcessado.slice(0, 30)}..."`);
        await queueMessage(userId, conteudoProcessado, payload.messageId);
        
        // Não enviar mensagem imediatamente para não confundir
        // O sistema vai processar depois que terminar o gasto atual
        
        return;
      }
    }
    
    //
    // 💬 RESOLUÇÃO DETERMINÍSTICA DE REFERÊNCIAS (ANTES DA IA)
    // ========================================================================
    // Economiza chamadas de IA e é mais confiável para referências implícitas
    // ========================================================================
    const conversationContext = await getConversationContext(userId);
    
    // ✅ [v6.1] Referências temporais agora são resolvidas pela IA via dynamic-query.ts
    // O contexto conversacional é passado para a IA que calcula start_date/end_date dinamicamente
    // Isso permite períodos como "últimos 5 dias", "anteontem", "semana retrasada", etc.
    
    // Referência a entidade: "primeiro", "segundo", "esse cartão", "mesma categoria"
    // ✅ [v6.1] Esta lógica ainda é útil para contexto de entidades, não temporal
    if (normalizedForReset.match(/^(primeiro|segundo|terceiro|esse|essa|mesmo|mesma)/) && conversationContext) {
      if (conversationContext.lastCardId && (normalizedForReset.includes("cart") || normalizedForReset.includes("primeiro") || normalizedForReset.includes("segundo"))) {
        console.log(`💬 [CONTEXT] Referência a cartão anterior: ${conversationContext.lastCardId}`);
        // Será usado nos slots adiante
      }
      if (conversationContext.lastCategory && normalizedForReset.includes("categor")) {
        console.log(`💬 [CONTEXT] Referência a categoria anterior: ${conversationContext.lastCategory}`);
      }
    }
    
    // ========================================================================
    // 🔒 PRIORIDADE ABSOLUTA: CONTEXTO ATIVO (FSM STATE MACHINE)
    // ========================================================================
    if (activeAction && (activeAction.pending_slot || activeAction.status === "awaiting_confirmation")) {
      const { handleFSM } = await import("./core/fsm-router.ts");
      const fsmResult = await handleFSM(
        userId,
        activeAction,
        conteudoProcessado,
        { phoneNumber: payload.phoneNumber, messageSource: payload.messageSource, messageId: payload.messageId },
        sendMessage,
        sendButtons
      );
      if (fsmResult.handled && !fsmResult.shouldContinue) return;
    }

    // Se a mensagem contém múltiplos valores, perguntar ao usuário se quer
    // registrar separado ou junto, ANTES de classificar.
    // ========================================================================
    // ========================================================================
    // 🛡️ GUARDS: Proteger parcelamentos, cartões e contas de detectMultipleExpenses
    // ========================================================================
    const INSTALLMENT_PATTERN = /\d+\s*(x|vezes|parcelas?)\s*(de\s*\d+)?/i;
    const CARD_PATTERN = /(adicionar|registrar|cadastrar|novo|meu)\s*cart[aã]o/i;
    const BILL_PATTERN = /(conta\s+de|fatura|vence\s+dia|vencimento)/i;
    
    // 📅 Guard de data: se tem data explícita/relativa → é UM gasto, não multi
    const DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\b|\bdia\s+\d{1,2}\b|\bontem\b|\banteontem\b|\bantes\s+de\s+ontem\b/i;
    
    const shouldSkipMultiDetection = 
      INSTALLMENT_PATTERN.test(conteudoProcessado) ||
      CARD_PATTERN.test(conteudoProcessado) ||
      BILL_PATTERN.test(conteudoProcessado) ||
      DATE_PATTERN.test(conteudoProcessado);
    
    if (payload.messageType === "text" && !activeAction && !shouldSkipMultiDetection) {
      const multipleExpenses = detectMultipleExpenses(conteudoProcessado);
      
      if (multipleExpenses.length > 1) {
        console.log(`📦 [MULTI] Detectados ${multipleExpenses.length} gastos na mensagem`);
        
        const lista = formatExpensesList(multipleExpenses);
        const total = calculateTotal(multipleExpenses);
        
        await sendButtons(
          payload.phoneNumber,
          `Vi ${multipleExpenses.length} gastos:\n\n${lista}\n\n💰 Total: R$ ${total.toFixed(2)}\n\nComo quer registrar?`,
          [
            { id: "multi_separado", title: "📝 Separado" },
            { id: "multi_junto", title: "📦 Tudo junto" }
          ],
          payload.messageSource
        );
        
        // Salvar estado pendente com os gastos detectados
        await createAction(userId, "multi_expense", "multi_expense", { 
          detected_expenses: multipleExpenses,
          total,
          original_message: conteudoProcessado
        }, "selection", payload.messageId);
        
        return;
      }
    }
    
    // ========================================================================
    // 📅 DETECÇÃO DE DATAS RELATIVAS ("ontem", "anteontem", etc.)
    // ========================================================================
    let transactionDate: Date | null = null;
    if (payload.messageType === "text") {
      transactionDate = parseRelativeDate(conteudoProcessado);
      if (transactionDate) {
        console.log(`📅 [DATE] Data relativa detectada: ${transactionDate.toISOString().split('T')[0]}`);
      }
    }
    
    // ========================================================================
    // 🧠 DECISION ENGINE PRIMEIRO - CLASSIFICAÇÃO UNIFICADA
    // ========================================================================
    // REGRA ABSOLUTA: A IA analisa a mensagem PRIMEIRO, antes de qualquer
    // verificação de número. Se a IA identificar intenção, números NÃO invalidam.
    // ========================================================================
    
    // Buscar histórico para contexto da IA
    const { data: historico } = await supabase
      .from("historico_conversas")
      .select("user_message, ai_response")
      .eq("phone_number", payload.phoneNumber)
      .order("created_at", { ascending: false })
      .limit(10);
    
    const historicoFormatado = historico?.map(h => `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 200) || "(sem resposta)"}`).reverse().join("\n---\n") || "";
    
    // 🔒 DECISION ENGINE - Única fonte de verdade
    // ✅ [v6.1] Agora a IA sempre é chamada e resolve referências temporais dinamicamente
    let decision: DecisionOutput;
    let shouldBlockLegacyFlow = false;
    
    const engineResult = await decisionEngine(
      conteudoProcessado,
      activeAction,
      userId,
      historicoFormatado,
      payload.messageType  // Passa o tipo: 'text', 'interactive', 'audio', etc.
    );
    
    // Converter SemanticResult para DecisionOutput
    const semanticResult = engineResult.result;
    decision = {
      actionType: semanticResult.actionType,
      confidence: semanticResult.confidence,
      reasoning: semanticResult.reason || "",
      slots: semanticResult.slots,
      missingSlots: [],
      shouldExecute: semanticResult.canExecuteDirectly || false,
      shouldAsk: !semanticResult.canExecuteDirectly,
      question: null,
      buttons: null,
      decisionId: semanticResult.decisionId
    };
    shouldBlockLegacyFlow = engineResult.shouldBlockLegacyFlow;
    
    logDecision({ 
      messageId: payload.messageId, 
      decision: "classified", 
      details: { 
        type: decision.actionType, 
        conf: decision.confidence, 
        slots: decision.slots,
        canExec: decision.shouldExecute,
        blocked: shouldBlockLegacyFlow
      }
    });
    
    // ========================================================================
    // 📝 FIX #4: LOG DE ERROS — Salvar decisões fracas para análise
    // ========================================================================
    if (decision.confidence < 0.5 || decision.actionType === "unknown") {
      try {
        await supabase.from("erros_interpretacao").insert({
          user_id: userId,
          evento_id: eventoId,
          message: conteudoProcessado?.substring(0, 200) || "",
          ai_classification: decision.actionType,
          confidence: decision.confidence,
          reason: decision.reasoning || "Low confidence",
          erro: `${decision.actionType} @ ${decision.confidence}`
        });
        console.log(`📝 [ERRO_LOG] Interpretação fraca salva: "${decision.actionType}" (${decision.confidence})`);
      } catch (logErr) {
        console.warn(`📝 [ERRO_LOG] Falha ao salvar (não-bloqueante):`, logErr);
      }
    }
    
    // ========================================================================
    // 🔄 POST-CLASSIFICATION INTERCEPTOR: Payment method correction
    // ========================================================================
    // If user says something like "paguei em pix" and last transaction was
    // registered with unknown/outro payment → reclassify as edit
    // ========================================================================
    // ========================================================================
    // 🔄 INTERCEPTOR EXPANDIDO: Correção de pagamento OU palavras de correção
    // ========================================================================
    {
      const norm = normalizeText(conteudoProcessado);
      const paymentMentioned = extractPaymentMethodFromText(norm);
      
      // Detectar palavras de correção
      const correctionWords = ["errei", "desculpa", "era no", "era na", "foi no", "foi na", "nao foi", "não foi", "errado", "corrige", "corrigir"];
      const hasCorrectionWord = correctionWords.some(w => norm.includes(w));
      
      if (paymentMentioned) {
        const lastTx = await getLastTransaction(userId, 5);
        if (lastTx && (
          // Caso original: payment era unknown/outro
          lastTx.forma_pagamento === "outro" || lastTx.forma_pagamento === "unknown" || !lastTx.forma_pagamento ||
          // Caso novo: usuário falou palavra de correção + método de pagamento
          (hasCorrectionWord && lastTx.forma_pagamento !== paymentMentioned)
        )) {
          console.log(`🔄 [INTERCEPTOR] Corrigindo pagamento da última transação: ${lastTx.id} → ${paymentMentioned} (correção: ${hasCorrectionWord})`);
          const result = await updateTransactionPaymentMethod(lastTx.id, paymentMentioned);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          
          // 🧠 APRENDER COM A CORREÇÃO (popular ai_corrections)
          if (hasCorrectionWord && lastTx.forma_pagamento && lastTx.forma_pagamento !== paymentMentioned) {
            try {
              const { learnFromCorrection } = await import("./learning/corrections.ts");
              await learnFromCorrection({
                userId,
                originalMessage: lastTx.descricao || conteudoProcessado,
                originalClassification: { 
                  actionType: "expense", 
                  slots: { payment_method: lastTx.forma_pagamento } 
                },
                userCorrection: conteudoProcessado,
                correctedField: "payment_method",
                correctedValue: paymentMentioned
              });
              console.log(`🧠 [LEARN] Correção de payment_method salva: ${lastTx.forma_pagamento} → ${paymentMentioned}`);
            } catch (learnErr) {
              console.error("⚠️ [LEARN] Erro não-bloqueante:", learnErr);
            }
          }
          
          await supabase.from("historico_conversas").insert({
            phone_number: payload.phoneNumber,
            user_id: userId,
            user_message: conteudoProcessado,
            ai_response: result.message,
            tipo: "edit"
          });
          return;
        }
      }
    }
    
    // ========================================================================
    // 🧠 ELITE: SELF-HEALING CHECK (Verificar correções anteriores)
    // ========================================================================
    // Antes de prosseguir, verificar se já temos correções aprendidas para 
    // este tipo de mensagem. Se sim, aplicar aos slots ou sugerir.
    // ========================================================================
    let elitePatternApplied = false;
    let patternRequiresConfirmation = false;
    let patternId: string | undefined;
    let patternCardName: string | undefined;
    
    if (payload.messageType === "text" && conteudoProcessado && 
        ["expense", "income", "recurring"].includes(decision.actionType)) {
      try {
        // 1. Verificar correções self-healing
        const { checkPreviousCorrections, applyCorrectionToSlots } = await import("./learning/corrections.ts");
        const correctionCheck = await checkPreviousCorrections(userId, conteudoProcessado);
        
        if (correctionCheck.hasSuggestion && correctionCheck.suggestion) {
          console.log(`🔄 [ELITE] Correção encontrada: ${correctionCheck.suggestion.correctedField}=${correctionCheck.suggestion.correctedValue}`);
          
          if (correctionCheck.shouldAutoApply) {
            // Aplicar correção automaticamente (cast para any para compatibilidade de tipos)
            const correctedSlots = applyCorrectionToSlots(
              decision.slots as any, 
              correctionCheck.suggestion.correctedField, 
              correctionCheck.suggestion.correctedValue
            );
            decision.slots = correctedSlots as ExtractedSlots;
            console.log(`✅ [ELITE] Correção auto-aplicada`);
          }
        }
        
        // 2. Aplicar padrões de memória (Memory Layer)
        // (variables declared above try block)
        
        if (decision.actionType === "expense" && decision.slots.description) {
          const { applyUserPatterns } = await import("./memory/patterns.ts");
          const patternResult = await applyUserPatterns(userId, decision.slots as any, conteudoProcessado);
          
          if (patternResult.patternApplied) {
            decision.slots = patternResult.slots as ExtractedSlots;
            elitePatternApplied = true;
            patternId = patternResult.patternId;
            console.log(`🧠 [ELITE] Padrão de memória aplicado para: ${decision.slots.description}`);
            
            // Verificar se precisa confirmação de cartão
            if (patternResult.requiresConfirmation && decision.slots.card_id) {
              patternRequiresConfirmation = true;
              // Buscar nome do cartão
              const { data: cardData } = await supabase
                .from("cartoes_credito")
                .select("nome")
                .eq("id", decision.slots.card_id)
                .single();
              patternCardName = cardData?.nome || "cartão";
              console.log(`🧠 [ELITE] Padrão requer confirmação de cartão: ${patternCardName}`);
            }
          }
        }
      } catch (eliteErr) {
        // Elite modules não devem bloquear fluxo principal
        console.error(`⚠️ [ELITE] Erro (não-bloqueante):`, eliteErr);
      }
    }
    
    // ========================================================================
    // 🚫 GUARD CLAUSE DE DOMÍNIO + AUTO-DESCARTE
    // ========================================================================
    const domainCheck = assertDomainIsolation(decision.actionType as ActionType, activeAction);
    if (domainCheck.shouldDiscard) {
      await cancelAction(userId);
    }
    
    // ========================================================================
    // 🔒 PRO-ONLY FEATURE GATING (Básico vs Pro no WhatsApp)
    // ========================================================================  
    const userPlano = usuario?.plano || "trial";
    const isProUserFlag = checkIsProUser(userPlano, usuario?.trial_fim || null);
    
    if (PRO_ONLY_INTENTS.includes(decision.actionType) && !isProUserFlag) {
      const teaser = PRO_TEASER_INTENTS[decision.actionType] || "⭐ Este recurso é exclusivo do plano Pro!";
      console.log(`🔒 [GATING] Bloqueando intent Pro "${decision.actionType}" para plano "${userPlano}"`);
      await sendButtons(payload.phoneNumber,
        teaser,
        [
          { id: "upgrade_pro", title: "⭐ Quero o Pro" },
          { id: "gating_ok", title: "👍 Entendi" }
        ],
        payload.messageSource
      );
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: `[GATING - ${decision.actionType} bloqueado]`,
        tipo: "gating_pro"
      });
      return;
    }
    

    // ========================================================================
    // 🎯 ROTEAMENTO POR TIPO DE AÇÃO
    // ========================================================================
    {
      const { routeIntent } = await import("./core/intent-router.ts");
      await routeIntent(
        decision,
        userId,
        conteudoProcessado,
        nomeUsuario,
        activeAction,
        usuario,
        transactionDate,
        {
          phoneNumber: payload.phoneNumber,
          messageSource: payload.messageSource,
          messageId: payload.messageId ?? "",
          messageType: payload.messageType
        },
        {
          patternApplied: elitePatternApplied,
          patternId,
          patternCardName,
          patternRequiresConfirmation
        },
        sendMessage,
        sendButtons,
        sendListMessage
      );
      return;
    }

  } catch (error: unknown) {
    const finaxError = FinaxError.fromError(error);
    
    // Log estruturado
    logger.error({
      component: "job_processor",
      userId,
      messageId: job.id,
      error: finaxError.message,
      code: finaxError.code
    }, "Erro no processamento do job");
    
    // Enviar para Sentry se configurado
    if (SENTRY_DSN) {
      Sentry.captureException(finaxError, {
        tags: { component: "job_processor" },
        extra: { userId, messageId: job.id, phoneNumber: payload.phoneNumber }
      });
    }
    
    // Retry com backoff exponencial
    const retryCount = (job.retry_count || 0) + 1;
    const maxRetries = job.max_retries || 3;
    
    if (retryCount < maxRetries) {
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, retryCount));
      const nextRetry = new Date(Date.now() + backoffMs);
      
      await supabase.from("webhook_jobs").update({
        status: "pending",
        retry_count: retryCount,
        last_error: finaxError.message,
        next_retry_at: nextRetry.toISOString()
      }).eq("id", job.id);
      
      logger.info({ component: "job_processor", jobId: job.id, retry: retryCount, maxRetries }, "Retry agendado");
    } else {
      await supabase.from("webhook_jobs").update({
        status: "failed",
        dead_letter: true,
        last_error: finaxError.message
      }).eq("id", job.id);
      
      logger.warn({ component: "job_processor", jobId: job.id }, "Job movido para dead letter queue");
    }
    
    // Enviar mensagem amigável ao usuário
    try {
      await sendMessage(payload.phoneNumber, finaxError.userMessage, payload.messageSource);
    } catch {}
  }
}

// ============================================================================
// 🚀 SERVE
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ========================================================================
    // 🔒 BUSCAR JOBS COM IDEMPOTÊNCIA E PRIORIDADE
    // ========================================================================
    // Buscar jobs pendentes OU que têm retry agendado para agora
    const now = new Date().toISOString();
    
    const { data: jobs, error } = await supabase
      .from("webhook_jobs")
      .select("*")
      .or(`status.eq.pending,and(status.eq.pending,next_retry_at.lte.${now})`)
      .eq("dead_letter", false)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) {
      console.error("Erro ao buscar jobs:", error);
      return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`📋 [WORKER] ${jobs.length} job(s) para processar`);

    let processedCount = 0;
    
    for (const job of jobs) {
      // ========================================================================
      // 🔒 LOCK OTIMISTA: Tentar marcar como processing
      // ========================================================================
      const { error: lockError, count } = await supabase
        .from("webhook_jobs")
        .update({ status: "processing", processed_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "pending");
      
      if (lockError || count === 0) {
        console.log(`⏭️ [WORKER] Job ${job.id?.slice(-8)} já em processamento por outra instância`);
        continue;
      }
      
      try {
        await processarJob(job);
        await supabase.from("webhook_jobs").update({ 
          status: "done", 
          processed_at: new Date().toISOString() 
        }).eq("id", job.id);
        processedCount++;
      } catch (jobError) {
        // O erro já é tratado dentro de processarJob com retry
        console.error(`❌ [JOB ${job.id?.slice(-8)}] Erro não tratado:`, jobError);
      }
    }

    return new Response(JSON.stringify({ processed: processedCount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Erro geral:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
