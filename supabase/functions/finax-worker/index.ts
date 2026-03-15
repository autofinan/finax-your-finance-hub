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
    // REGRA DE OURO v7.0: Action ativa tem prioridade TOTAL.
    // Isso inclui:
    // - pending_slot: aguardando slot específico
    // - awaiting_confirmation: aguardando sim/não/cancelar
    // ========================================================================
    if (activeAction && (activeAction.pending_slot || activeAction.status === "awaiting_confirmation")) {
      console.log(`🔒 [FSM] Ação ativa: ${activeAction.intent} | status: ${activeAction.status} | pending_slot: ${activeAction.pending_slot}`);
      
      const { handleActiveContext } = await import("./fsm/context-handler.ts");
      
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
          case "installment":
            const { registerInstallment } = await import("./intents/installment.ts");
            result = await registerInstallment(userId, slots as any, activeAction.id);
            break;
          case "add_card":
            const { createCard } = await import("./intents/card.ts");
            result = await createCard(userId, slots as any);
            break;
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
          case "pay_bill": {
            const { payBill } = await import("./intents/bills.ts");
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
              // Default to expense
              result = await registerExpense(userId, slots, activeAction.id);
            }
            break;
          }
          default:
            result = { message: "✅ Feito!", success: true };
        }
        
        // Limpar actions
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
        
        if ((result as any).isDuplicate) {
          await handleExpenseResultCompat(result as any, payload.phoneNumber, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        }
        return;
      }
      
      // ========================================================================
      // CASO 2: CANCELAMENTO
      // ========================================================================
      if (contextResult.cancelled) {
        await cancelAction(userId);
        await sendMessage(payload.phoneNumber, contextResult.message || "👍 Cancelado!", payload.messageSource);
        return;
      }
      
      // ========================================================================
      // CASO 3: SLOT PREENCHIDO → VERIFICAR SE PRONTO PARA CONFIRMAR
      // ========================================================================
      if (contextResult.handled && contextResult.filledSlot) {
        console.log(`✅ [FSM] Slot preenchido: ${contextResult.filledSlot} = ${contextResult.slotValue}`);
        
        // Atualizar action com novos slots
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
              // ✅ BLOCO 9: Executar criação de meta diretamente
              const { createGoal } = await import("./intents/goals.ts");
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
              // ✅ BLOCO 9: Executar contribuição à meta
              const { addToGoal } = await import("./intents/goals.ts");
              const goalName = execSlots.description || execSlots.goal_name || "";
              const goalAmount = execSlots.amount || 0;
              const progressResult = await addToGoal(userId, goalName, goalAmount);
              execResult = { message: progressResult };
              break;
            }
            case "debt": {
              const { registerDebt } = await import("./intents/debt-handler.ts");
              const debtResult = await registerDebt(userId, execSlots);
              execResult = { message: debtResult.message };
              break;
            }
            default:
              console.log(`⚠️ [FSM] Intent "${activeAction.intent}" não suporta execução direta`);
              // Fallback: pedir confirmação
              const { generateConfirmationMessage, setActionAwaitingConfirmation } = await import("./fsm/context-handler.ts");
              await setActionAwaitingConfirmation(activeAction.id, execSlots as any);
              const confirmMsg = generateConfirmationMessage(activeAction.intent, execSlots as any);
              await sendMessage(payload.phoneNumber, confirmMsg, payload.messageSource);
              return;
          }
          
          // Limpar action
          await supabase.from("actions")
            .update({ status: "done", updated_at: new Date().toISOString() })
            .eq("id", activeAction.id);
          
          await sendMessage(payload.phoneNumber, execResult.message, payload.messageSource);
          return;
        }
        
        // ================================================================
        // CASO 3B: PEDIR CONFIRMAÇÃO (casos excepcionais de ambiguidade)
        // ================================================================
        if (contextResult.readyToConfirm) {
          const { generateConfirmationMessage, setActionAwaitingConfirmation } = await import("./fsm/context-handler.ts");
          
          await setActionAwaitingConfirmation(activeAction.id, contextResult.updatedSlots!);
          
          const confirmMsg = generateConfirmationMessage(activeAction.intent, contextResult.updatedSlots!);
          await sendButtons(payload.phoneNumber, confirmMsg, [
            { id: "confirm_yes", title: "✅ Confirmar" },
            { id: "confirm_no", title: "❌ Cancelar" }
          ], payload.messageSource);
          return;
        }
        
        // Ainda falta slot → perguntar próximo
        const { getNextMissingSlot, getSlotPrompt } = await import("./fsm/context-handler.ts");
        const nextMissing = getNextMissingSlot(activeAction.intent, contextResult.updatedSlots!);
        
        if (nextMissing) {
          await updateAction(activeAction.id, { pending_slot: nextMissing });
          const prompt = getSlotPrompt(nextMissing);
          
          if (prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt.text, payload.messageSource);
          }
          return;
        } else {
          // ✅ FIX: nextMissing é null mas readyToExecute era false
          // Todos os slots preenchidos → executar direto como fallback
          console.log(`⚠️ [FSM] nextMissing null com readyToExecute false, executando direto como fallback para intent: ${activeAction.intent}`);
          
          const updatedSlots = contextResult.updatedSlots!;
          
          if (activeAction.intent === "expense") {
            const result = await registerExpense(userId, updatedSlots, undefined);
            await closeAction(activeAction.id);
            await handleExpenseResultCompat(result, payload.phoneNumber, payload.messageSource);
          } else if (activeAction.intent === "income") {
            const result = await registerIncome(userId, updatedSlots);
            await closeAction(activeAction.id);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          } else {
            // Fallback genérico: fechar action e avisar
            await closeAction(activeAction.id);
            await sendMessage(payload.phoneNumber, "✅ Registrado!", payload.messageSource);
          }
          return;
        }
      }
      
      // ========================================================================
      // CASO 4: HANDLED MAS SEM SLOT PREENCHIDO (erro de entrada)
      // ========================================================================
      if (contextResult.handled && contextResult.message) {
        // Se o slot pendente tem botões (ex: payment_method), reenviar com botões
        if (activeAction.pending_slot) {
          const { getSlotPrompt } = await import("./fsm/context-handler.ts");
          const prompt = getSlotPrompt(activeAction.pending_slot);
          if (prompt.buttons) {
            await sendButtons(
              payload.phoneNumber, 
              contextResult.message + "\n\n" + prompt.text, 
              prompt.buttons, 
              payload.messageSource
            );
            return;
          }
        }
        await sendMessage(payload.phoneNumber, contextResult.message, payload.messageSource);
        return;
      }
      
      // ========================================================================
      // CASO 5: MUDANÇA DE ASSUNTO → CANCELAR E CONTINUAR
      // ========================================================================
      if (contextResult.shouldCancel) {
        console.log(`🔄 [FSM] Mudança de assunto detectada, cancelando action`);
        await cancelAction(userId);
        // Continuar para classificar nova intenção
      }
    }
    
    // ========================================================================
    // 📦 DETECÇÃO DE MÚLTIPLOS GASTOS (antes do decision engine)
    // ========================================================================
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
          const { addToGoal } = await import("./intents/goals.ts");
          
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
          const { resolveCreditCard } = await import("./intents/credit-flow.ts");
          
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
      const { createCard } = await import("./intents/card.ts");
      
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
      const { createBill } = await import("./intents/bills.ts");
      
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
  const { payBill } = await import("./intents/bills.ts");
  
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
        await import("./intents/installment.ts");
      
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
        const { dateISO, timeString } = getBrasiliaISO();
        
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
        
        const { requireConfirmation } = await import("./fsm/confirmation-gate.ts");
        const { generateConfirmationMessage } = await import("./fsm/context-handler.ts");
        
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
        const { listUserCards } = await import("./intents/credit-flow.ts");
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
      const { listGoals } = await import("./intents/goals.ts");
      const result = await listGoals(userId);
      await sendMessage(payload.phoneNumber, result, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 💳 DEBT - Registrar dívida
    // ========================================================================
    if (decision.actionType === "debt") {
      console.log(`💳 [DEBT] Registrando dívida: ${JSON.stringify(decision.slots)}`);
      const { registerDebt } = await import("./intents/debt-handler.ts");
      const result = await registerDebt(userId, decision.slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 📋 LIST_DEBTS - Listar dívidas
    // ========================================================================
    if (decision.actionType === "list_debts") {
      console.log(`📋 [LIST_DEBTS] Listando dívidas do usuário`);
      const { listDebts } = await import("./intents/debt-handler.ts");
      const result = await listDebts(userId);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }

    // ========================================================================
    // 📊 SIMULATE_DEBTS - Simulador de quitação via WhatsApp
    // ========================================================================
    if (decision.actionType === "simulate_debts") {
      console.log(`📊 [SIMULATE_DEBTS] Simulando quitação para usuário`);
      const { simulateDebts } = await import("./intents/debt-handler.ts");
      const result = await simulateDebts(userId, decision.slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🏁 QUERY_FREEDOM - Consultar dias de liberdade financeira
    // ========================================================================
    if (decision.actionType === "query_freedom") {
      console.log(`🏁 [QUERY_FREEDOM] Consultando dias de liberdade`);
      const { queryFreedomDays } = await import("./intents/freedom-insights.ts");
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
      
      const { listGoals, addToGoal } = await import("./intents/goals.ts");
      
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
      const { createGoal, listGoals, addToGoal } = await import("./intents/goals.ts");
      
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
      
      const { analyzePurchase } = await import("./intents/purchase.ts");
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
      const { handleSetContext } = await import("./intents/set-context.ts");
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
      const { handleCancelRouting } = await import("./intents/cancel-routing.ts");
      await handleCancelRouting(userId, decision.slots, conteudoProcessado, payload.messageId, sendMessage, sendButtons, sendListMessage, payload.phoneNumber, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 📊 QUERY - Consultas financeiras
    // ========================================================================
    if (decision.actionType === "query") {
      const { handleQueryRouting } = await import("./intents/query-routing.ts");
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
    
    // ========================================================================
    // Este guard protege contra a IA classificar erroneamente como "chat"
    // quando o usuário está no meio de um fluxo de registro.
    // ========================================================================
    if ((decision.actionType === "chat" || decision.actionType === "unknown") &&
        activeAction !== null && 
        (activeAction.intent === "expense" || activeAction.intent === "income" || activeAction.intent === "duplicate_expense") &&
        (activeAction.pending_slot || activeAction.intent === "duplicate_expense")) {
      
      // ✅ FIX WA-7: Handle "sim"/"não" como texto para duplicate_confirm
      if (activeAction.intent === "duplicate_expense") {
        const dupNormalized = normalizeText(conteudoProcessado);
        if (dupNormalized.includes("nao") || dupNormalized.includes("não") || dupNormalized === "n") {
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, "Ok, não vou registrar! 👍", payload.messageSource);
          return;
        }
        if (dupNormalized.includes("sim") || dupNormalized === "s" || dupNormalized.includes("registra")) {
          const dupSlots = { ...(activeAction.slots as ExtractedSlots), _skip_duplicate: true };
          await closeAction(activeAction.id);
          const result = await registerExpense(userId, dupSlots);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
      }
      
      if (!activeAction.pending_slot) {
        // duplicate_expense without pending_slot and no clear yes/no → re-ask
        await sendButtons(payload.phoneNumber,
          "Quer registrar mesmo assim?",
          [
            { id: "duplicate_confirm_yes", title: "✅ Sim" },
            { id: "duplicate_confirm_no", title: "❌ Não" }
          ],
          payload.messageSource);
        return;
      }
      
      console.log(`🛡️ [GUARD] Bloqueando chat - action ativa: ${activeAction.intent} aguardando ${activeAction.pending_slot}`);
      
      // Tentar extrair o slot pendente da mensagem atual
      const pendingSlot: string = activeAction.pending_slot;
      let slotValue: any = null;
      
      if (pendingSlot === "payment_method") {
        const normalizedGuard = normalizeText(conteudoProcessado);
        slotValue = extractPaymentMethodFromText(normalizedGuard);
      } else if (pendingSlot === "amount") {
        const numMatch = conteudoProcessado.match(/(\d+[.,]?\d*)/);
        if (numMatch && numMatch[1]) slotValue = parseFloat(numMatch[1].replace(",", "."));
      } else if (pendingSlot === "description") {
        slotValue = conteudoProcessado.trim();
      }
      
      if (slotValue !== null) {
        // Preencher o slot e continuar o fluxo
        const updatedSlots: Record<string, any> = { ...activeAction.slots, [pendingSlot]: slotValue };
        const actionType = activeAction.intent as ActionType;
        const missing = getMissingSlots(actionType, updatedSlots);
        
        if (hasAllRequiredSlots(actionType, updatedSlots)) {
          // Executar!
          const result = actionType === "income" 
            ? await registerIncome(userId, updatedSlots, activeAction.id)
            : await registerExpense(userId, updatedSlots, activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
        
        // Ainda falta slot → perguntar próximo
        await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: missing[0] });
        const nextSlotKey = missing[0];
        const prompt = SLOT_PROMPTS[nextSlotKey];
        if (prompt?.useButtons && prompt.buttons) {
          await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, prompt?.text || `Qual o ${nextSlotKey}?`, payload.messageSource);
        }
        return;
      }
      
      // Não conseguiu extrair → re-perguntar
      const promptKey = pendingSlot;
      const prompt = SLOT_PROMPTS[promptKey];
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `Hmm, não entendi 🤔\n\n${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `Hmm, não entendi 🤔\n\n${prompt?.text || "Continue..."}`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 🛡️ CHAT GUARD - ÚLTIMA LINHA DE DEFESA CONTRA ALUCINAÇÃO
    // ========================================================================
    // Chat só entra se houver INTENÇÃO EXPLÍCITA de conversa.
    // Mensagens curtas/ambíguas NUNCA devem entrar em chat.
    // THRESHOLD elevado para chat: precisa 0.85+ de confiança da IA
    // ========================================================================
    function isExplicitChatIntent(text: string): boolean {
      const t = text.toLowerCase().trim();
      const normalizedT = normalizeText(text);
      const words = t.split(/\s+/);
      
      // Regra 0: Se é token de ACK, NUNCA é chat (já tratado antes, mas double-check)
      const ackTokensLocal = ["obrigado", "obrigada", "valeu", "ok", "blz", "beleza", "entendi", "certo"];
      if (words.length <= 2 && ackTokensLocal.some(tok => normalizedT.includes(tok))) {
        return false;
      }
      
      // Regra 1: Mensagem tem "?" → é pergunta explícita
      if (t.includes("?")) return true;
      
      // Regra 2: Mais de 6 palavras → frase completa (provavelmente contexto)
      if (words.length > 6) return true;
      
      // Regra 3: Contém verbo de consulta/opinião/conselho
      const chatVerbs = [
        "como", "onde", "por que", "porque", "o que", "qual",
        "me ajuda", "me diga", "acho", "devo", "vale a pena",
        "dica", "opinião", "melhorar", "economizar", "gastando",
        "posso", "consigo", "tenho", "tô", "estou", "será"
      ];
      
      return chatVerbs.some(v => t.includes(v));
    }
    
    // Threshold elevado para chat: precisa de alta confiança
    const CHAT_CONFIDENCE_THRESHOLD = 0.85;

    // ========================================================================
    // 🔍 VERIFICAR HELP CONTEXT ANTES DO ROTEAMENTO (Bug #5 fix)
    // ========================================================================
    const helpCtxPreChat = await getConversationContext(userId);
    if (helpCtxPreChat?.lastIntent === "help" && decision.actionType !== "control" && decision.actionType !== "expense" && decision.actionType !== "income") {
      // Usuário está respondendo a "precisa de ajuda com o quê?" mas IA classificou como chat/outro
      let helpResponse = "";
      
      if (/\b(gastos?|registr|anotar|lanc|compras?|despesas?)\b/i.test(conteudoProcessado)) {
        helpResponse = `💸 *Registrar gastos é simples!*\n\n` +
          `É só me dizer assim:\n\n` +
          `• "café 5 pix"\n` +
          `• "almoço 30 dinheiro"\n` +
          `• "uber 15 crédito"\n\n` +
          `Eu pergunto o que faltar!\n\n` +
          `Também dá pra mandar:\n` +
          `• "ontem jantar 80 cartão"\n` +
          `• "dia 05/02 mercado 150 dinheiro"\n\n` +
          `Quer testar agora? 😊`;
      } else if (/\b(cartao|cartões|cartoes|credito|crédito|limite)\b/i.test(conteudoProcessado)) {
        helpResponse = `💳 *Sobre cartões de crédito:*\n\n` +
          `Ver seus cartões:\n` +
          `• "meus cartões"\n\n` +
          `Adicionar novo:\n` +
          `• "adicionar cartão Nubank limite 5000"\n\n` +
          `Gasto no crédito:\n` +
          `• "uber 15 crédito"\n\n` +
          `O que quer fazer?`;
      } else if (/\b(resumo|saldo|quanto|gastei|relatorio)\b/i.test(conteudoProcessado)) {
        helpResponse = `📊 *Ver seu resumo:*\n\n` +
          `• "quanto gastei esse mês?"\n` +
          `• "saldo"\n` +
          `• "gastos da semana"\n` +
          `• "detalhe alimentação"\n\n` +
          `Quer ver algum desses agora?`;
      } else if (/\b(meta|metas|economia|economizar|poupar)\b/i.test(conteudoProcessado)) {
        helpResponse = `🎯 *Metas de economia:*\n\n` +
          `Criar meta:\n` +
          `• "meta viagem 5000"\n\n` +
          `Adicionar valor:\n` +
          `• "guardei 200 pra viagem"\n\n` +
          `Ver metas:\n` +
          `• "minhas metas"\n\n` +
          `Quer criar uma meta?`;
      } else if (/\b(recorrente|fixo|mensal|conta)\b/i.test(conteudoProcessado)) {
        helpResponse = `🔄 *Gastos recorrentes:*\n\n` +
          `Criar recorrente:\n` +
          `• "spotify 22 todo mês"\n` +
          `• "academia 99 mensal"\n\n` +
          `Ver recorrentes:\n` +
          `• "meus gastos fixos"\n\n` +
          `O que quer fazer?`;
      } else if (/\b(parcel|parcela)\b/i.test(conteudoProcessado)) {
        helpResponse = `📦 *Parcelamentos:*\n\n` +
          `Registrar:\n` +
          `• "tv 3000 crédito 12x"\n\n` +
          `Ver parcelamentos:\n` +
          `• "meus parcelamentos"\n\n` +
          `Quer registrar um?`;
      } else if (/\b(exemplo|como|registrar)\b/i.test(conteudoProcessado)) {
        helpResponse = `💡 *Exemplos de uso do Finax:*\n\n` +
          `💸 *Gastos:*\n` +
          `• "café 5 pix"\n` +
          `• "uber 15 crédito"\n` +
          `• "mercado 200 dinheiro"\n\n` +
          `💰 *Receitas:*\n` +
          `• "recebi 3000 pix"\n` +
          `• "salário 5000"\n\n` +
          `📊 *Consultas:*\n` +
          `• "quanto gastei esse mês?"\n` +
          `• "saldo"\n\n` +
          `Quer testar agora? 😊`;
      }
      
      if (helpResponse) {
        await updateConversationContext(userId, { lastIntent: null });
        await sendMessage(payload.phoneNumber, helpResponse, payload.messageSource);
        return;
      }
      
      // Não entendeu o tópico
      await sendMessage(payload.phoneNumber,
        `Não entendi bem... 🤔\n\n` +
        `Você quer ajuda com:\n` +
        `• Registrar gastos?\n` +
        `• Cartões?\n` +
        `• Ver resumo?\n` +
        `• Metas?\n` +
        `• Parcelamentos?\n\n` +
        `Me diz qual!`, payload.messageSource);
      return;
    }

    // ========================================================================
    // 💬 CHAT - Consultor Financeiro Conversacional
    // ========================================================================
    if (decision.actionType === "chat") {
      // 🛡️ CHAT GUARD: Verificar se realmente é intenção de chat
      // Dupla verificação: confiança alta E intenção explícita
      const hasExplicitIntent = isExplicitChatIntent(conteudoProcessado);
      const hasHighConfidence = decision.confidence >= CHAT_CONFIDENCE_THRESHOLD;
      
      if (!hasExplicitIntent && !hasHighConfidence) {
        console.log(`🛑 [CHAT_GUARD] Chat bloqueado → mensagem ambígua: "${conteudoProcessado}" (conf: ${decision.confidence.toFixed(2)})`);
        
        // Tratar como palavra solta → pedir clarificação
        await sendButtons(payload.phoneNumber, 
          `"${conteudoProcessado}"\n\nVocê quer registrar um gasto ou consultar algo?`, 
          [
            { id: "word_gasto", title: "💸 Registrar gasto" },
            { id: "word_consulta", title: "📊 Consultar" }
          ], 
          payload.messageSource
        );
        
        await createAction(userId, "clarify", "clarify_word", 
          { possible_description: conteudoProcessado }, 
          "clarify_type", 
          payload.messageId
        );
        return;
      }
      
      console.log(`💬 [CHAT] Permitido → explícito: ${hasExplicitIntent}, confiança: ${decision.confidence.toFixed(2)}`);
      console.log(`💬 [CHAT] Ativando modo consultor para: "${conteudoProcessado.slice(0, 50)}..."`);
      
      // Buscar contexto financeiro do usuário COM CATEGORIAS (Bug #8)
      let summary = await getMonthlySummary(userId);
      const activeCtx = await getActiveContext(userId);
      
      // Enriquecer summary com breakdown por categoria
      try {
        const inicioMesChat = new Date();
        inicioMesChat.setDate(1);
        inicioMesChat.setHours(0, 0, 0, 0);
        
        const { data: catBreakdown } = await supabase
          .from("transacoes")
          .select("categoria, valor")
          .eq("usuario_id", userId)
          .eq("tipo", "saida")
          .eq("status", "confirmada")
          .gte("data", inicioMesChat.toISOString())
          .limit(10000);
        
        if (catBreakdown && catBreakdown.length > 0) {
          const byCategory: Record<string, number> = {};
          for (const t of catBreakdown) {
            const cat = t.categoria || "outros";
            byCategory[cat] = (byCategory[cat] || 0) + Number(t.valor);
          }
          const catList = Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, total]) => `${cat}: R$ ${total.toFixed(2)}`)
            .join(", ");
          summary += `\n\nDetalhamento por categoria: ${catList}`;
        }
      } catch (catErr) {
        console.error("⚠️ [CHAT] Erro ao buscar categorias (não-bloqueante):", catErr);
      }
      
      // Chamar IA com contexto para resposta conversacional
      const chatResponse = await generateChatResponse(
        conteudoProcessado, 
        summary,
        activeCtx?.label || null,
        nomeUsuario
      );
      
      await sendMessage(payload.phoneNumber, chatResponse, payload.messageSource);
      
      // Salvar no histórico
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: chatResponse,
        tipo: "chat"
      });
      return;
    }
    
    // 🎮 CONTROL (saudação, ajuda, negação)
    if (decision.actionType === "control") {
      const { handleControl } = await import("./intents/control.ts");
      await handleControl(userId, decision.slots, nomeUsuario, conteudoProcessado, isProUserFlag, sendMessage, sendButtons, payload.phoneNumber, payload.messageSource);
      return;
    }
    
    // ========================================================================
    // 🔢 FALLBACK: NÚMERO ISOLADO (só chega aqui se Decision Engine disse "unknown")
    // ========================================================================
    // Este é o "fundo do poço" da lógica. SÓ pergunta "gasto ou entrada?"
    // quando a IA NÃO conseguiu classificar a intenção.
    // ========================================================================
    if (decision.actionType === "unknown" && payload.messageType === 'text' && isNumericOnly(conteudoProcessado)) {
      const numValue = parseNumericValue(conteudoProcessado);
      
      logDecision({ messageId: payload.messageId, decision: "numeric_fallback", details: { value: numValue } });
      
      // CASO 1: Há contexto ativo esperando amount → preencher slot
      if (activeAction !== null && activeAction.pending_slot === "amount" && numValue !== null) {
        const updatedSlots: Record<string, any> = { ...activeAction.slots, amount: numValue };
        const actionType = activeAction.intent === "income" ? "income" : activeAction.intent === "expense" ? "expense" : null;
        
        if (actionType) {
          const missing = getMissingSlots(actionType as ActionType, updatedSlots);
          
          // Todos slots preenchidos → executar
          if (hasAllRequiredSlots(actionType as ActionType, updatedSlots)) {
            const result = actionType === "income" 
              ? await registerIncome(userId, updatedSlots, activeAction.id)
              : await registerExpense(userId, updatedSlots, activeAction.id);
            await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
            return;
          }
          
          // Falta slot → perguntar APENAS o próximo obrigatório
          const nextSlotKey = missing[0];
          await updateAction(activeAction.id, { slots: updatedSlots, pending_slot: nextSlotKey });
          const prompt = SLOT_PROMPTS[nextSlotKey];
          if (prompt?.useButtons && prompt.buttons) {
            await sendButtons(payload.phoneNumber, prompt.text, prompt.buttons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, prompt?.text || "Continue...", payload.messageSource);
          }
          return;
        }
      }
      
      // CASO 2: Número SEM contexto → PERGUNTAR
      await sendButtons(payload.phoneNumber, `💰 R$ ${numValue?.toFixed(2)}\n\nEsse valor foi um gasto ou uma entrada?`, [
        { id: "num_gasto", title: "💸 Gasto" },
        { id: "num_entrada", title: "💰 Entrada" }
      ], payload.messageSource);
      
      if (activeAction) {
        await cancelAction(userId);
      }
      
      await createAction(userId, "unknown", "numero_isolado", { amount: numValue }, "type_choice", payload.messageId);
      return;
    }
    
    // ========================================================================
    // 🔤 FALLBACK: PALAVRA SOLTA (possível descrição)
    // ========================================================================
    // Se o classificador detectou uma palavra solta, perguntar clarificação
    // ========================================================================
    if (decision.actionType === "unknown" && decision.slots.possible_description) {
      const possibleDesc = decision.slots.possible_description;
      console.log(`🔤 [WORD] Palavra solta detectada: "${possibleDesc}" → perguntando clarificação`);
      
      await sendButtons(payload.phoneNumber, 
        `"${possibleDesc}"\n\nVocê quer registrar um gasto ou consultar algo?`, 
        [
          { id: "word_gasto", title: "💸 Registrar gasto" },
          { id: "word_consulta", title: "📊 Consultar" }
        ], 
        payload.messageSource
      );
      
      // Salvar contexto para continuar o fluxo
      await createAction(userId, "clarify", "clarify_word", 
        { possible_description: possibleDesc }, 
        "clarify_type", 
        payload.messageId
      );
      return;
    }
    
    // ❓ UNKNOWN / FALLBACK → TENTAR CHAT (nunca travar!)
    if (activeAction !== null && activeAction.pending_slot) {
      // Re-perguntar o slot pendente
      const slotKey = activeAction.pending_slot;
      const prompt = SLOT_PROMPTS[slotKey];
      if (prompt?.useButtons && prompt.buttons) {
        await sendButtons(payload.phoneNumber, `Hmm, não entendi bem 🤔\n\n${prompt.text}`, prompt.buttons, payload.messageSource);
      } else {
        await sendMessage(payload.phoneNumber, `Hmm, não entendi bem 🤔\n\n${prompt?.text || "Continue..."}`, payload.messageSource);
      }
      return;
    }
    
    // ========================================================================
    // 💡 FIX #3: FALLBACK INTELIGENTE EXPANDIDO
    // ========================================================================
    // Se parece pergunta OU mensagem longa sem números → responder como chat
    // Reduz drasticamente os "não entendi" desnecessários
    // ========================================================================
    const normalizedFallback = normalizeText(conteudoProcessado);
    const parecePerguntar = conteudoProcessado.includes("?") || 
                            normalizedFallback.match(/^(como|quando|quanto|qual|por que|o que|sera|devo|posso|tenho|to |tou |estou |consigo)/);
    
    // FIX #3: Mensagem longa (>5 palavras) sem números → provavelmente é chat
    const words = conteudoProcessado.trim().split(/\s+/).length;
    const hasNumber = /\d/.test(conteudoProcessado);
    const isLongTextWithoutNumber = words > 5 && !hasNumber;
    
    if (parecePerguntar || isLongTextWithoutNumber) {
      console.log(`💬 [FALLBACK→CHAT] Redirecionando para chat: "${conteudoProcessado.slice(0, 50)}..." (${parecePerguntar ? 'pergunta' : 'texto longo'})`);
      
      const summary = await getMonthlySummary(userId);
      const chatResponse = await generateChatResponse(
        conteudoProcessado,
        summary,
        null,
        nomeUsuario
      );
      await sendMessage(payload.phoneNumber, chatResponse, payload.messageSource);
      
      // Salvar no histórico
      await supabase.from("historico_conversas").insert({
        phone_number: payload.phoneNumber,
        user_id: userId,
        user_message: conteudoProcessado,
        ai_response: chatResponse,
        tipo: isLongTextWithoutNumber ? "chat_fallback_long" : "chat_fallback"
      });
      return;
    }
    
    // Fallback gentil para mensagens que realmente não fazem sentido
    const primeiroNome = nomeUsuario.split(" ")[0];
    await sendMessage(payload.phoneNumber, `Oi ${primeiroNome}! 👋\n\nNão entendi bem essa. Você pode:\n\n💸 *Registrar gasto:* "café 8 pix"\n💰 *Registrar entrada:* "recebi 200"\n📊 *Ver resumo:* "resumo"\n💬 *Conversar:* "tô gastando demais?"`, payload.messageSource);
    
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
      // Calcular backoff exponencial (1s, 2s, 4s, max 30s)
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
      // Mover para dead letter queue
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
