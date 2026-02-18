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
  type ExtractedSlots,
  type SemanticResult,
  type ActiveAction
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
import { normalizeText, detectQueryScope, detectTimeRange, isNumericOnly, parseNumericValue, logDecision, extractSlotValue } from "./utils/helpers.ts";
import { sendMessage, sendButtons, sendListMessage } from "./ui/whatsapp-sender.ts";
import { analyzeImageWithGemini, downloadWhatsAppMedia, transcreverAudio, type OCRResult } from "./utils/media.ts";
import { getActiveAction, createAction, updateAction, closeAction, cancelAction, type ActiveAction } from "./fsm/action-manager.ts";

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
// 👤 PERFIL DO CLIENTE: Criar automaticamente se não existir
// ============================================================================

async function ensurePerfilCliente(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("perfil_cliente")
    .select("id")
    .eq("usuario_id", userId)
    .single();
  
  if (!existing) {
    console.log(`👤 [PERFIL] Criando perfil automático para: ${userId}`);
    await supabase.from("perfil_cliente").insert({
      usuario_id: userId,
      operation_mode: "normal",
      limites: { mensal: 0 },
      score_economia: 50,
      preferencias: {},
      metas_financeiras: {},
      insights: {}
    });
  }
}

// ============================================================================
// 💰 SET_BUDGET: Definir orçamento via WhatsApp
// ============================================================================

async function setBudget(userId: string, slots: ExtractedSlots): Promise<{ success: boolean; message: string }> {
  const limite = slots.amount;
  if (!limite || limite <= 0) {
    return { success: false, message: "Preciso de um valor válido para o orçamento 💸" };
  }
  
  const categoria = slots.category || null;
  const tipo = categoria ? "categoria" : "global";
  
  // Se é global, atualizar perfil_cliente.limites.mensal também
  if (!categoria) {
    await supabase.from("perfil_cliente").upsert({
      usuario_id: userId,
      operation_mode: "normal",
      limites: { mensal: limite },
      score_economia: 50
    }, { onConflict: "usuario_id" });
  }
  
  // Upsert no orçamento
  // Verificar se já existe
  let query = supabase
    .from("orcamentos")
    .select("id")
    .eq("usuario_id", userId)
    .eq("tipo", tipo)
    .eq("ativo", true);
  
  if (categoria) {
    query = query.eq("categoria", categoria);
  } else {
    query = query.is("categoria", null);
  }
  
  const { data: existingBudget } = await query.single();
  
  // ✅ CORREÇÃO: Calcular gastos do mês atual ao criar/atualizar orçamento
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  let queryGastos = supabase
    .from("transacoes")
    .select("valor")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .gte("data", startOfMonth.toISOString());
  
  if (categoria) {
    queryGastos = queryGastos.eq("categoria", categoria);
  }
  
  const { data: gastos } = await queryGastos;
  const gastoAtual = gastos?.reduce((sum: number, t: any) => sum + (Number(t.valor) || 0), 0) || 0;
  
  console.log(`💰 [BUDGET] Gastos do mês em ${categoria || 'total'}: R$ ${gastoAtual.toFixed(2)}`);
  
  if (existingBudget) {
    await supabase.from("orcamentos")
      .update({ 
        limite, 
        gasto_atual: gastoAtual,
        alerta_50_enviado: gastoAtual >= limite * 0.5,
        alerta_80_enviado: gastoAtual >= limite * 0.8,
        alerta_100_enviado: gastoAtual >= limite
      })
      .eq("id", existingBudget.id);
  } else {
    await supabase.from("orcamentos").insert({
      usuario_id: userId,
      tipo,
      categoria: categoria || null,
      limite,
      periodo: "mensal",
      ativo: true,
      gasto_atual: gastoAtual,
      alerta_50_enviado: gastoAtual >= limite * 0.5,
      alerta_80_enviado: gastoAtual >= limite * 0.8,
      alerta_100_enviado: gastoAtual >= limite
    });
  }
  
  // Mensagem com status atual
  const percentual = (gastoAtual / limite) * 100;
  let statusMsg = "";
  
  if (percentual >= 100) {
    statusMsg = `\n\n🚨 *ATENÇÃO:* Você já estourou o limite!\nGastou R$ ${gastoAtual.toFixed(2)} de R$ ${limite.toFixed(2)}`;
  } else if (percentual >= 80) {
    statusMsg = `\n\n⚠️ Você já gastou ${percentual.toFixed(0)}% do limite (R$ ${gastoAtual.toFixed(2)})`;
  } else if (percentual >= 50) {
    statusMsg = `\n\nℹ️ Você já gastou ${percentual.toFixed(0)}% do limite (R$ ${gastoAtual.toFixed(2)})`;
  }
  
  const catLabel = categoria ? `de *${categoria}*` : "*total*";
  return {
    success: true,
    message: `✅ Orçamento ${catLabel} definido!\n\n💰 Limite: *R$ ${limite.toFixed(2)}/mês*${statusMsg}\n\nVou te avisar quando atingir 50%, 80% e 100% do limite. 📊`
  };
}


// Verifica orçamentos após registrar um gasto
async function checkBudgetAfterExpense(userId: string, categoria: string, valorGasto: number): Promise<string | null> {
  try {
    // Buscar orçamentos ativos para esta categoria ou global
    const { data: orcamentos } = await supabase
      .from("orcamentos")
      .select("*")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .or(`tipo.eq.global,and(tipo.eq.categoria,categoria.eq.${categoria})`);
    
    if (!orcamentos || orcamentos.length === 0) return null;
    
    const alerts: string[] = [];
    
    for (const orcamento of orcamentos) {
      // ✅ FIX BUG #8: Guards ?? 0 para evitar "R$ undefined"
      const limiteVal = orcamento.limite ?? 0;
      const gastoAtualVal = orcamento.gasto_atual ?? 0;
      const percentual = ((gastoAtualVal + valorGasto) / (limiteVal || 1)) * 100;
      
      // Verificar cada nível de alerta
      if (percentual >= 100 && !orcamento.alerta_100_enviado) {
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`🚨 *Atenção!* Você atingiu 100% do ${tipo}!\n\nLimite: R$ ${limiteVal.toFixed(2)}\nGasto: R$ ${(gastoAtualVal + valorGasto).toFixed(2)}`);
        
        await supabase.from("orcamentos")
          .update({ alerta_100_enviado: true })
          .eq("id", orcamento.id);
          
      } else if (percentual >= 80 && percentual < 100 && !orcamento.alerta_80_enviado) {
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`⚠️ Você usou 80% do ${tipo}.\n\nRestam R$ ${(limiteVal - gastoAtualVal - valorGasto).toFixed(2)}`);
        
        await supabase.from("orcamentos")
          .update({ alerta_80_enviado: true })
          .eq("id", orcamento.id);
          
      } else if (percentual >= 50 && percentual < 80 && !orcamento.alerta_50_enviado) {
        const tipo = orcamento.tipo === "global" ? "orçamento total" : `orçamento de ${orcamento.categoria}`;
        alerts.push(`💡 Você atingiu 50% do ${tipo}.`);
        
        await supabase.from("orcamentos")
          .update({ alerta_50_enviado: true })
          .eq("id", orcamento.id);
      }
    }
    
    return alerts.length > 0 ? alerts.join("\n\n") : null;
    
  } catch (error) {
    console.error("❌ [BUDGET] Erro ao verificar orçamentos:", error);
    return null;
  }
}

// ============================================================================
// 📊 VERIFICAÇÃO E ENVIO DE RELATÓRIOS PENDENTES
// ============================================================================

// Verifica se há relatório pendente e envia após interação do usuário
async function checkAndSendPendingReport(userId: string, phoneNumber: string, source: MessageSource): Promise<void> {
  try {
    // Buscar usuário com flags de relatório pendente
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("relatorio_semanal_pendente, relatorio_mensal_pendente, nome")
      .eq("id", userId)
      .single();
    
    if (!usuario) return;
    
    // Verificar relatório semanal pendente
    if (usuario.relatorio_semanal_pendente) {
      console.log(`📊 [REPORT] Relatório semanal pendente para ${userId} - enviando...`);
      
      // Buscar dados do relatório
      const { data: relatorio } = await supabase.rpc("fn_relatorio_semanal", { 
        p_usuario_id: userId 
      });
      
      if (relatorio && relatorio.totais && (relatorio.totais.entradas > 0 || relatorio.totais.saidas > 0)) {
        // Gerar texto do relatório com IA
        const textoRelatorio = await gerarTextoRelatorioInline(relatorio, usuario.nome);
        
        // Enviar
        await sendMessage(phoneNumber, textoRelatorio, source);
        
        // Marcar como enviado
        await supabase.from("usuarios")
          .update({ 
            relatorio_semanal_pendente: false,
            ultimo_relatorio_semanal: new Date().toISOString()
          })
          .eq("id", userId);
        
        // Salvar no histórico
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: userId,
          user_message: "[RELATÓRIO PENDENTE - ENVIADO]",
          ai_response: textoRelatorio,
          tipo: "relatorio_semanal"
        });
        
        console.log(`✅ [REPORT] Relatório semanal enviado para ${userId}`);
      } else {
        // Limpar flag se não há dados
        await supabase.from("usuarios")
          .update({ relatorio_semanal_pendente: false })
          .eq("id", userId);
      }
    }
  } catch (error) {
    console.error("❌ [REPORT] Erro ao verificar relatórios pendentes:", error);
  }
}

// Gera texto do relatório inline (versão simplificada)
async function gerarTextoRelatorioInline(dados: any, nomeUsuario: string | null): Promise<string> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Você é o Finax, um assistente financeiro via WhatsApp.
Escreva um RELATÓRIO SEMANAL curto e amigável.

REGRAS:
- Use APENAS os números fornecidos
- Máximo 10 linhas
- 2-3 emojis
- Uma dica prática curta no final
- Português brasileiro informal`
          },
          {
            role: "user",
            content: `Relatório para ${nomeUsuario || "Usuário"}:\n${JSON.stringify(dados, null, 2)}`
          }
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "📊 Não foi possível gerar o relatório.";
  } catch (error) {
    console.error("Erro ao gerar relatório inline:", error);
    return "📊 Erro ao gerar relatório.";
  }
}

// ============================================================================
// 🎯 CONTEXT MANAGER
// ============================================================================


// ============================================================================
// 💾 INTENT HANDLERS
// ============================================================================

// 🧠 Categorização agora é feita via ai/categorizer.ts com IA-First + autoaprendizado
import { categorizeDescription } from "./ai/categorizer.ts";

// 📊 Query handlers
import { getExpensesByCategory } from "./intents/query.ts";

// 💰 Income handler (extraído para módulo)
import { registerIncome as registerIncomeModule } from "./intents/income.ts";

async function registerExpense(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string; isDuplicate?: boolean }> {
  const valor = slots.amount!;
  const descricao = slots.description || "";
  
  // 🧠 CATEGORIZAÇÃO IA-FIRST COM AUTOAPRENDIZADO
  const categoryResult = await categorizeDescription(descricao, slots.category);
  const categoria = categoryResult.category;
  
  console.log(`📂 [EXPENSE] Categorização: "${descricao}" → ${categoria} (fonte: ${categoryResult.source}, conf: ${categoryResult.confidence})`);
  if (categoryResult.learned) {
    console.log(`   └─ 🧠 Termo "${categoryResult.keyTerm}" aprendido para futuras transações!`);
  }
  
  const formaPagamento = slots.payment_method || "outro";
  
  // ========================================================================
  // ✅ FIX BUG #2: DEDUPLICAÇÃO - Verificar gasto duplicado nos últimos 5 min
  // ========================================================================
  if (!slots._skip_duplicate) {
    const normalizedDesc = descricao.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const { data: recentTx } = await supabase
      .from("transacoes")
      .select("id, descricao, valor, created_at")
      .eq("usuario_id", userId)
      .eq("tipo", "saida")
      .eq("valor", valor)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (recentTx && recentTx.length > 0) {
      const existingDesc = (recentTx[0].descricao || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (existingDesc === normalizedDesc || normalizedDesc.includes(existingDesc) || existingDesc.includes(normalizedDesc)) {
        console.log(`⚠️ [DEDUPE] Possível duplicata detectada: ${recentTx[0].id}`);
        // Criar action para confirmação de duplicata
        await createAction(userId, "duplicate_confirm", "duplicate_expense", {
          ...slots,
          original_tx_id: recentTx[0].id
        }, null, null);
        
        const minutesAgo = Math.round((Date.now() - new Date(recentTx[0].created_at).getTime()) / 60000);
        return {
          success: false,
          isDuplicate: true,
          message: `⚠️ *Possível duplicata!*\n\nVi um gasto igual há ${minutesAgo} min:\n📝 ${recentTx[0].descricao} - R$ ${(recentTx[0].valor ?? 0).toFixed(2)}\n\nQuer registrar mesmo assim?`
        };
      }
    }
  }
  
  // ========================================================================
  // 💳 CORREÇÃO CRÍTICA: BUSCAR CARTÃO POR NOME E OBTER ID
  // ========================================================================
  let cardId = slots.card_id || null;
  let cardName = slots.card || null;
  
  // Se é crédito e temos nome do cartão mas não ID, buscar ID
  if (formaPagamento === "credito" && cardName && !cardId) {
    console.log(`💳 [EXPENSE] Buscando cartão por nome: "${cardName}"`);
    
    const { data: foundCard } = await supabase
      .from("cartoes_credito")
      .select("id, nome, limite_disponivel")
      .eq("usuario_id", userId)
      .eq("ativo", true)
      .ilike("nome", `%${cardName}%`)
      .limit(1)
      .single();
    
    if (foundCard) {
      cardId = foundCard.id;
      cardName = foundCard.nome;
      console.log(`💳 [EXPENSE] Cartão encontrado: ${cardName} (${cardId})`);
    } else {
      console.log(`💳 [EXPENSE] Cartão "${cardName}" não encontrado, buscando primeiro cartão ativo...`);
      // Fallback: usar primeiro cartão ativo
      const { data: firstCard } = await supabase
        .from("cartoes_credito")
        .select("id, nome, limite_disponivel")
        .eq("usuario_id", userId)
        .eq("ativo", true)
        .limit(1)
        .single();
      
      if (firstCard) {
        cardId = firstCard.id;
        cardName = firstCard.nome;
        console.log(`💳 [EXPENSE] Usando cartão padrão: ${cardName} (${cardId})`);
      }
    }
  }
  
  // ========================================================================
  // ✅ CORREÇÃO DEFINITIVA: Usar slots.transaction_date ou getBrasiliaISO()
  // NUNCA usar new Date() — causa hora UTC no servidor
  // ========================================================================
  let dateISO: string;
  let timeString: string;

  if (slots.transaction_date) {
    dateISO = slots.transaction_date;
    timeString = dateISO.substring(11, 16);
    console.log(`📅 [EXPENSE-INLINE] Usando transaction_date dos slots: ${dateISO}`);
  } else {
    const result = getBrasiliaISO();
    dateISO = result.dateISO;
    timeString = result.timeString;
    console.log(`📅 [EXPENSE-INLINE] Usando hora atual Brasília: ${dateISO}`);
  }

  const { data: tx, error } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: dateISO,
    data_transacao: dateISO,
    hora_transacao: timeString,
    origem: "whatsapp",
    forma_pagamento: formaPagamento,
    cartao_id: cardId,
    status: "confirmada"
  }).select("id").single();
  
  if (error) {
    console.error("❌ [EXPENSE] Erro:", error);
    return { success: false, message: "Algo deu errado 😕\nTenta de novo?" };
  }
  
  // ========================================================================
  // 💳 ATUALIZAR LIMITE DO CARTÃO SE FOR CRÉDITO
  // ========================================================================
  let cardInfo = "";
  if (formaPagamento === "credito" && cardId) {
    const { data: card } = await supabase
      .from("cartoes_credito")
      .select("limite_disponivel, nome")
      .eq("id", cardId)
      .single();
    
    if (card && card.limite_disponivel !== null) {
      const novoLimite = Math.max(0, card.limite_disponivel - valor);
      
      await supabase
        .from("cartoes_credito")
        .update({ limite_disponivel: novoLimite })
        .eq("id", cardId);
      
      console.log(`💳 [CARD] Limite atualizado: ${card.limite_disponivel} → ${novoLimite}`);
      cardInfo = `\n💳 ${card.nome || cardName} (disponível: R$ ${novoLimite.toFixed(2)})`;
    }
  } else if (cardName) {
    cardInfo = `\n💳 ${cardName}`;
  }
  
  // 📍 INTERCEPTADOR: Vincular a contexto ativo (viagem/evento)
  await linkTransactionToContext(userId, tx.id);
  
  // Verificar se há contexto ativo para informar o usuário
  const activeContext = await getActiveContext(userId);
  let contextInfo = "";
  if (activeContext) {
    contextInfo = `\n📍 _Vinculado a: ${activeContext.label}_`;
  }
  
  if (actionId) await closeAction(actionId, tx.id);
  
  // ========================================================================
  // 🧠 MEMORY LAYER: Aprender padrão de merchant após sucesso
  // ========================================================================
  try {
    await learnMerchantPattern({
      userId,
      description: descricao,
      category: categoria,
      paymentMethod: formaPagamento,
      cardId: cardId || undefined,
      transactionId: tx.id,
      wasUserCorrected: false
    });
  } catch (memErr) {
    console.error("⚠️ [MEMORY] Erro não-bloqueante ao aprender padrão:", memErr);
  }
  
  // ========================================================================
  // 👤 PERFIL DO CLIENTE: Criar automaticamente se não existir
  // ========================================================================
  try {
    await ensurePerfilCliente(userId);
  } catch (perfilErr) {
    console.error("⚠️ [PERFIL] Erro não-bloqueante ao criar perfil:", perfilErr);
  }
  
  // ========================================================================
  // 💰 VERIFICAR ALERTAS DE ORÇAMENTO APÓS REGISTRO
  // ========================================================================
  const budgetAlert = await checkBudgetAfterExpense(userId, categoria, valor);
  
  // ========================================================================
  // 📬 PROCESSAR PRÓXIMA MENSAGEM DA FILA (SE HOUVER)
  // ========================================================================
  const pendingCount = await countPendingMessages(userId);
  let queueInfo = "";
  if (pendingCount > 0) {
    queueInfo = `\n\n📬 _Você tem ${pendingCount} gasto(s) pendente(s) que anotei!_`;
    console.log(`📬 [QUEUE] ${pendingCount} mensagem(ns) pendente(s) para ${userId}`);
  }
  
  // ✅ CORREÇÃO DEFINITIVA: Parsear direto da string ISO (sem Date/Intl)
  const [_dp] = dateISO.split('T');
  const [_yy, _mm, _dd] = _dp.split('-');
  const dataFormatada = `${_dd}/${_mm}/${_yy}`;
  const horaFormatada = dateISO.substring(11, 16);
  
  const emoji = categoria === "alimentacao" ? "🍽️" : categoria === "mercado" ? "🛒" : categoria === "transporte" ? "🚗" : "💸";
  
  // Montar mensagem com alerta de orçamento se houver
  let message = `${emoji} *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n${descricao ? `📝 ${descricao}\n` : ""}💳 ${formaPagamento}${cardInfo}\n📅 ${dataFormatada} às ${horaFormatada}${contextInfo}`;
  
  if (budgetAlert) {
    message += `\n\n${budgetAlert}`;
  }
  
  if (queueInfo) {
    message += queueInfo;
  }
  
  return {
    success: true,
    message
  };
}

// ✅ Helper: Envia resultado de registerExpense com botões se for duplicata
async function handleExpenseResult(
  result: { success: boolean; message: string; isDuplicate?: boolean },
  phoneNumber: string,
  messageSource: MessageSource
): Promise<void> {
  if (result.isDuplicate) {
    await sendButtons(phoneNumber, result.message, [
      { id: "duplicate_confirm_yes", title: "✅ Sim, registrar" },
      { id: "duplicate_confirm_no", title: "❌ Não, era erro" }
    ], messageSource);
  } else {
    await sendMessage(phoneNumber, result.message, messageSource);
  }
}

// 💰 registerIncome — delegado ao módulo intents/income.ts
async function registerIncome(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  return registerIncomeModule(userId, slots, actionId);
}

async function getMonthlySummary(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo")
    .eq("usuario_id", userId)
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada");

  let totalEntradas = 0, totalSaidas = 0;
  transacoes?.forEach((t) => {
    if (t.tipo === "entrada") totalEntradas += Number(t.valor);
    else totalSaidas += Number(t.valor);
  });
  
  const saldo = totalEntradas - totalSaidas;
  
  return !transacoes || transacoes.length === 0
    ? "Você ainda não tem transações este mês 📊\n\nManda um gasto!"
    : `📊 *Resumo do Mês*\n\n💵 Entradas: *R$ ${totalEntradas.toFixed(2)}*\n💸 Saídas: *R$ ${totalSaidas.toFixed(2)}*\n📈 Saldo: *R$ ${saldo.toFixed(2)}*`;
}

async function listCardsForUser(userId: string): Promise<any[]> {
  const { data } = await supabase.from("cartoes_credito").select("*").eq("usuario_id", userId).eq("ativo", true);
  return data || [];
}

async function updateCardLimit(userId: string, cardName: string, newLimit: number): Promise<{ success: boolean; message: string }> {
  const cards = await listCardsForUser(userId);
  const card = cards.find(c => normalizeText(c.nome || "").includes(normalizeText(cardName)));
  
  if (!card) {
    return { success: false, message: `Não encontrei o cartão "${cardName}" 💳\n\nQuer ver seus cartões? Manda "ver cartões"` };
  }
  
  await supabase.from("cartoes_credito").update({ limite_total: newLimit, limite_disponivel: newLimit }).eq("id", card.id);
  
  return { success: true, message: `✅ Limite do *${card.nome}* atualizado para R$ ${newLimit.toFixed(2)}` };
}

async function listTransactionsForCancel(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("id, valor, descricao, categoria, data, status")
    .eq("usuario_id", userId)
    .in("status", ["confirmada", "prevista"])
    .order("created_at", { ascending: false })
    .limit(5);
  return data || [];
}

async function cancelTransaction(userId: string, txId: string): Promise<{ success: boolean; message: string }> {
  const { data: tx } = await supabase.from("transacoes").select("*").eq("id", txId).eq("usuario_id", userId).single();
  if (!tx) return { success: false, message: "Transação não encontrada 🤔" };
  if (tx.status === "cancelada") return { success: false, message: "Já foi cancelada 👍" };
  
  await supabase.from("transacoes").update({ status: "cancelada" }).eq("id", txId);
  return { success: true, message: `✅ *Transação cancelada!*\n\n🗑️ R$ ${tx.valor?.toFixed(2)} - ${tx.descricao || tx.categoria}` };
}

// ============================================================================
// ✏️ EDIT/CORREÇÃO RÁPIDA - Buscar última transação e permitir correção
// ============================================================================

async function getLastTransaction(userId: string, withinMinutes: number = 2): Promise<any | null> {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  
  const { data } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("status", "confirmada")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  return data || null;
}

async function updateTransactionPaymentMethod(txId: string, newMethod: string): Promise<{ success: boolean; message: string }> {
  const { data: tx, error } = await supabase
    .from("transacoes")
    .update({ forma_pagamento: newMethod })
    .eq("id", txId)
    .select("valor, descricao, categoria")
    .single();
  
  if (error || !tx) {
    console.error("❌ [EDIT] Erro ao atualizar:", error);
    return { success: false, message: "Não consegui corrigir 😕" };
  }
  
  const paymentEmoji = newMethod === "pix" ? "📱" : newMethod === "debito" ? "💳" : newMethod === "credito" ? "💳" : "💵";
  
  return {
    success: true,
    message: `✅ *Corrigido!*\n\n💸 R$ ${tx.valor?.toFixed(2)} agora é *${paymentEmoji} ${newMethod}*`
  };
}

// ============================================================================
// 🔄 RECURRING HANDLER - Gastos Recorrentes (ARQUITETURA DEFENSIVA)
// ============================================================================
// 🔍 BUSCA INTELIGENTE DE RECORRENTES
// ============================================================================

async function findRecurringByName(userId: string, searchTerm: string): Promise<any[]> {
  // Busca case-insensitive usando ilike
  const { data: recorrentes } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .ilike("descricao", `%${searchTerm}%`);
  
  return recorrentes || [];
}

async function listActiveRecurrings(userId: string): Promise<any[]> {
  const { data: recorrentes } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .order("created_at", { ascending: false })
    .limit(10);
  
  return recorrentes || [];
}

async function cancelRecurring(userId: string, recurringId: string): Promise<{ success: boolean; message: string }> {
  const { data: recorrente } = await supabase
    .from("gastos_recorrentes")
    .select("*")
    .eq("id", recurringId)
    .eq("usuario_id", userId)
    .single();
  
  if (!recorrente) {
    return { success: false, message: "Recorrente não encontrado 🤔" };
  }
  
  await supabase
    .from("gastos_recorrentes")
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq("id", recurringId);
  
  return {
    success: true,
    message: `✅ *Recorrente cancelado!*\n\n🗑️ ${recorrente.descricao} - R$ ${recorrente.valor_parcela?.toFixed(2)}/mês\n\n_Não será mais cobrado automaticamente._`
  };
}

// ============================================================================
// 💳 QUERIES ANALÍTICAS DE CARTÕES
// ============================================================================

async function queryCardLimits(userId: string): Promise<string> {
  const { data: cards } = await supabase
    .from("cartoes_credito")
    .select("*")
    .eq("usuario_id", userId)
    .eq("ativo", true);
  
  if (!cards || cards.length === 0) {
    return "Você não tem cartões cadastrados 💳";
  }
  
  const lista = cards.map(c => {
    const total = c.limite_total || 0;
    const disponivel = c.limite_disponivel || 0;
    const usado = total - disponivel;
    return `💳 *${c.nome}*\n   Total: R$ ${total.toFixed(2)}\n   Disponível: R$ ${disponivel.toFixed(2)}\n   Usado: R$ ${usado.toFixed(2)}`;
  }).join("\n\n");
  
  return `💳 *Seus Cartões*\n\n${lista}`;
}

async function queryExpensesByCard(userId: string): Promise<string> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: gastos } = await supabase
    .from("transacoes")
    .select("valor, cartao_id")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .eq("forma_pagamento", "credito")
    .gte("data", inicioMes.toISOString())
    .eq("status", "confirmada");
  
  if (!gastos || gastos.length === 0) {
    return "Nenhum gasto no crédito este mês 💳";
  }
  
  // Buscar nomes dos cartões
  const cardIds = [...new Set(gastos.map(g => g.cartao_id).filter(Boolean))];
  const { data: cards } = await supabase
    .from("cartoes_credito")
    .select("id, nome")
    .in("id", cardIds.length > 0 ? cardIds : ["none"]);
  
  const cardMap = new Map(cards?.map(c => [c.id, c.nome]) || []);
  
  // Agrupar por cartão
  const byCard: Record<string, { nome: string; total: number; count: number }> = {};
  gastos.forEach(g => {
    const cardName = g.cartao_id ? (cardMap.get(g.cartao_id) || "Outro") : "Sem cartão";
    if (!byCard[cardName]) byCard[cardName] = { nome: cardName, total: 0, count: 0 };
    byCard[cardName].total += Number(g.valor);
    byCard[cardName].count += 1;
  });
  
  const lista = Object.values(byCard)
    .map(c => `💳 ${c.nome}: R$ ${c.total.toFixed(2)} (${c.count} gastos)`)
    .join("\n");
  
  return `💳 *Gastos por Cartão (este mês)*\n\n${lista}`;
}

async function queryContextExpenses(userId: string, contextId: string): Promise<{ total: number; count: number }> {
  const { data: gastos } = await supabase
    .from("transacoes")
    .select("valor")
    .eq("context_id", contextId)
    .eq("status", "confirmada");
  
  const total = gastos?.reduce((sum, g) => sum + Number(g.valor), 0) || 0;
  return { total, count: gastos?.length || 0 };
}

// ============================================================================

// Interface do contrato de recorrência
interface RecurringContract {
  user_id: string;
  transaction_id: string;
  amount: number;
  description: string;
  periodicity: "monthly" | "weekly" | "yearly";
  day_of_month?: number;
  categoria?: string;
}

// Validador do contrato - retorna null se válido, ou string com motivo se inválido
function validateRecurringContract(contract: Partial<RecurringContract>): string | null {
  if (!contract.user_id) return "user_id ausente";
  if (!contract.transaction_id) return "transaction_id ausente";
  if (typeof contract.amount !== "number" || isNaN(contract.amount) || contract.amount <= 0) return `amount inválido: ${contract.amount}`;
  if (!contract.description || contract.description.trim() === "") return "description ausente ou vazia";
  if (!["monthly", "weekly", "yearly"].includes(contract.periodicity || "")) return `periodicity inválido: ${contract.periodicity}`;
  return null; // Contrato válido
}

// Normalizador de periodicity para o formato do banco (capitalizado conforme constraint)
function normalizePeriodicityForDB(periodicity: string): string {
  const map: Record<string, string> = {
    "monthly": "Mensal",
    "weekly": "Semanal",
    "yearly": "Mensal", // Banco não tem "Anual", usar Mensal como fallback
    "mensal": "Mensal",
    "semanal": "Semanal",
    "anual": "Mensal"
  };
  return map[periodicity.toLowerCase()] || "Mensal";
}

// 🛡️ FUNÇÃO DEFENSIVA - NUNCA lança exceção, NUNCA interrompe fluxo principal
async function tryRegisterRecurring(contract: Partial<RecurringContract>): Promise<{ success: boolean; reason?: string; recurrenceId?: string }> {
  // GUARD 1: Validar contrato
  const validationError = validateRecurringContract(contract);
  if (validationError) {
    console.log(`🔄 [RECURRING][SKIP] Contrato inválido: ${validationError}`, JSON.stringify(contract));
    return { success: false, reason: validationError };
  }
  
  // GUARD 2: Contrato válido, prosseguir com insert
  const tipoRecorrencia = normalizePeriodicityForDB(contract.periodicity!);
  const dayOfMonth = contract.day_of_month || new Date().getDate();
  
  console.log(`🔄 [RECURRING][ATTEMPT] Criando recorrência: ${contract.description} - R$ ${contract.amount} (${tipoRecorrencia}, dia ${dayOfMonth})`);
  
  try {
    const { data: recorrencia, error: recError } = await supabase.from("gastos_recorrentes").insert({
      usuario_id: contract.user_id,
      valor_parcela: contract.amount,
      categoria: contract.categoria || "outros",
      descricao: contract.description,
      tipo_recorrencia: tipoRecorrencia,
      dia_mes: dayOfMonth,
      ativo: true,
      origem: "whatsapp"
    }).select("id").single();
    
    if (recError) {
      console.error(`🔄 [RECURRING][DB_ERROR] Falha no insert:`, recError.message, recError.details, recError.hint);
      return { success: false, reason: `DB: ${recError.message}` };
    }
    
    // Vincular transação à recorrência
    await supabase.from("transacoes").update({ id_recorrente: recorrencia.id }).eq("id", contract.transaction_id);
    
    console.log(`🔄 [RECURRING][SUCCESS] Recorrência criada: ${recorrencia.id}`);
    return { success: true, recurrenceId: recorrencia.id };
    
  } catch (err) {
    // FALLBACK: Captura qualquer exceção inesperada
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`🔄 [RECURRING][EXCEPTION] Erro inesperado:`, errorMsg);
    return { success: false, reason: `Exception: ${errorMsg}` };
  }
}

// Função principal de registro de recorrência (usa a defensiva internamente)
async function registerRecurring(userId: string, slots: ExtractedSlots, actionId?: string): Promise<{ success: boolean; message: string }> {
  const valor = slots.amount;
  const descricao = slots.description || "";
  const periodicity = (slots.periodicity || "monthly") as "monthly" | "weekly" | "yearly";
  const dayOfMonth = slots.day_of_month || new Date().getDate();
  
  // GUARD: Validar valor antes de qualquer operação
  if (!valor || typeof valor !== "number" || valor <= 0) {
    console.error(`🔄 [RECURRING][GUARD] Valor inválido: ${valor}`);
    return { success: false, message: "Falta informar o valor 💰" };
  }
  
  // 🧠 CATEGORIZAÇÃO IA-FIRST COM AUTOAPRENDIZADO
  const categoryResult = await categorizeDescription(descricao, slots.category);
  const categoria = categoryResult.category;
  
  console.log(`🔄 [RECURRING] Iniciando: R$ ${valor} - ${descricao} (${periodicity})`);
  console.log(`📂 [RECURRING] Categorização: "${descricao}" → ${categoria} (fonte: ${categoryResult.source})`);
  
  const agora = new Date();
  
  // PASSO 1: Registrar a transação de HOJE (SEMPRE executa)
  const { data: tx, error: txError } = await supabase.from("transacoes").insert({
    usuario_id: userId,
    valor,
    categoria,
    tipo: "saida",
    descricao,
    data: agora.toISOString(),
    origem: "whatsapp",
    recorrente: true,
    status: "confirmada"
  }).select("id").single();
  
  if (txError) {
    console.error("❌ [RECURRING] Erro ao criar transação:", txError);
    return { success: false, message: "Algo deu errado ao registrar 😕" };
  }
  
  console.log(`🔄 [RECURRING] Transação criada: ${tx.id}`);
  
  // PASSO 2: Tentar criar recorrência (ISOLADO - nunca afeta o passo 1)
  const recurringResult = await tryRegisterRecurring({
    user_id: userId,
    transaction_id: tx.id,
    amount: valor,
    description: descricao,
    periodicity: periodicity,
    day_of_month: dayOfMonth,
    categoria: categoria
  });
  
  // PASSO 3: Fechar action se existir
  if (actionId) await closeAction(actionId, tx.id);
  
  // PASSO 4: Retornar mensagem apropriada
  const diaLabel = dayOfMonth === 1 ? "início" : dayOfMonth >= 25 ? "fim" : `dia ${dayOfMonth}`;
  
  if (recurringResult.success) {
    return {
      success: true,
      message: `🔄 *Gasto recorrente salvo!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n📅 Todo ${diaLabel} do mês\n\n✅ _Registrei o gasto de hoje e agendei os próximos!_`
    };
  } else {
    // Transação foi salva, mas recorrência falhou
    console.log(`🔄 [RECURRING][PARTIAL] Transação OK, recorrência falhou: ${recurringResult.reason}`);
    return { 
      success: true, 
      message: `✅ *Gasto registrado!*\n\n💸 *-R$ ${valor.toFixed(2)}*\n📂 ${categoria}\n📝 ${descricao}\n\n⚠️ _Não consegui agendar os próximos meses (${recurringResult.reason})_`
    };
  }
}

// ============================================================================
// 📍 CONTEXT HANDLER - Viagens/Eventos
// ============================================================================

async function getActiveContext(userId: string): Promise<any | null> {
  const now = new Date().toISOString();
  
  const { data } = await supabase
    .from("user_contexts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("start_date", now)
    .gte("end_date", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  return data || null;
}

async function createUserContext(userId: string, slots: ExtractedSlots): Promise<{ success: boolean; message: string; contextId?: string }> {
  const label = slots.label || "Evento";
  const description = slots.description || null;
  const CURRENT_YEAR = 2026; // ANO ATUAL EXPLÍCITO
  
  // Parsear datas
  let startDate = new Date();
  let endDate = new Date();
  endDate.setDate(endDate.getDate() + 7); // Default: 7 dias
  
  if (slots.date_range) {
    // Tentar parsear datas do formato brasileiro
    const parseDate = (str: string): Date => {
      const parts = str.split(/[\/\-]/);
      if (parts.length >= 2) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        // USAR ANO ATUAL (2026) SE NÃO ESPECIFICADO
        let year = parts[2] ? parseInt(parts[2]) : CURRENT_YEAR;
        if (year < 100) year = 2000 + year;
        
        const date = new Date(year, month, day);
        
        // VALIDAÇÃO: Se data é no passado distante (mais de 30 dias), ajustar
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (date < thirtyDaysAgo) {
          // Data muito antiga, provavelmente ano errado - usar ano atual
          date.setFullYear(CURRENT_YEAR);
          console.log(`📍 [CONTEXT] Data ajustada para ano ${CURRENT_YEAR}: ${date.toISOString()}`);
        }
        
        return date;
      }
      return new Date();
    };
    
    startDate = parseDate(slots.date_range.start);
    endDate = parseDate(slots.date_range.end);
    
    // Garantir que endDate é depois de startDate
    if (endDate <= startDate) {
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    }
  } else if (slots.start_date && slots.end_date) {
    startDate = new Date(slots.start_date);
    endDate = new Date(slots.end_date);
  }
  
  console.log(`📍 [CONTEXT] Criando: ${label} de ${startDate.toISOString()} até ${endDate.toISOString()}`);
  
  const { data: context, error } = await supabase.from("user_contexts").insert({
    user_id: userId,
    label,
    description,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    status: "active",
    auto_tag: true
  }).select("id").single();
  
  if (error) {
    console.error("❌ [CONTEXT] Erro:", error);
    return { success: false, message: "Não consegui criar o contexto 😕" };
  }
  
  const startFormatted = startDate.toLocaleDateString("pt-BR");
  const endFormatted = endDate.toLocaleDateString("pt-BR");
  const diasRestantes = Math.ceil((endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    success: true,
    contextId: context.id,
    message: `📍 *Modo Contexto Ativado!*\n\n🏷️ *${label}*\n📅 ${startFormatted} até ${endFormatted}\n⏰ ${diasRestantes} dias\n\n✅ _Todos os seus gastos serão marcados como parte de "${label}" automaticamente!_\n\n_Quando terminar, mande "terminei a viagem" ou "fim do evento"_`
  };
}

async function closeUserContext(userId: string): Promise<{ success: boolean; message: string }> {
  const activeContext = await getActiveContext(userId);
  
  if (!activeContext) {
    return { success: false, message: "Você não tem nenhum evento ativo no momento 🤔" };
  }
  
  await supabase.from("user_contexts").update({ 
    status: "completed",
    end_date: new Date().toISOString()
  }).eq("id", activeContext.id);
  
  return {
    success: true,
    message: `✅ *Evento "${activeContext.label}" encerrado!*\n\n📊 Total gasto: R$ ${(activeContext.total_spent || 0).toFixed(2)}\n🧾 ${activeContext.transaction_count || 0} transações\n\n_Voltando ao modo normal!_`
  };
}

// Função para vincular transação a contexto ativo (interceptador)
async function linkTransactionToContext(userId: string, transactionId: string): Promise<void> {
  const activeContext = await getActiveContext(userId);
  
  if (activeContext && activeContext.auto_tag) {
    await supabase.from("transacoes").update({ context_id: activeContext.id }).eq("id", transactionId);
    console.log(`📍 [CONTEXT] Transação ${transactionId.slice(-8)} vinculada ao contexto ${activeContext.label}`);
  }
}

// ============================================================================
// 💬 CHAT HANDLER - Consultor Financeiro Conversacional
// ============================================================================

async function generateChatResponse(
  userMessage: string,
  financialSummary: string,
  activeContext: string | null,
  userName: string
): Promise<string> {
  const contextInfo = activeContext 
    ? `O usuário está no meio de: ${activeContext}` 
    : "";
  
  const systemPrompt = `Você é o Finax, consultor financeiro pessoal do ${userName}.

## TOM DE VOZ (OBRIGATÓRIO)
- Seja: objetivo, claro, respeitoso, profissional.
- Use português brasileiro natural, mas SEM exageros emocionais.
- Seja direto e útil, sem ser frio ou robótico.

## O QUE NUNCA FAZER
- NÃO use gírias como "Putz", "Cara", "Mano", "Nossa"
- NÃO seja excessivamente emotivo ou dramático
- NÃO use frases como "a gente precisa dar um jeito"
- NÃO assuma que a situação é ruim sem dados claros
- NÃO personifique demais ("eu também fico preocupado")
- NÃO use mais de 2-3 emojis por resposta

## O QUE SEMPRE FAZER
- Cite dados CONCRETOS quando disponíveis
- Seja direto nas recomendações
- Use linguagem profissional mas acessível
- Limite resposta a 2-3 parágrafos curtos
- Se não tiver dados suficientes, sugira que registre mais gastos
- Se a mensagem for ambígua, pergunte em vez de adivinhar

CONTEXTO FINANCEIRO DO USUÁRIO:
${financialSummary}
${contextInfo}

VOCÊ PODE:
- Analisar a situação financeira com base nos dados
- Dar dicas práticas de economia
- Sugerir estratégias de orçamento
- Responder perguntas sobre finanças pessoais
- Identificar padrões de gastos`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
      }),
    });

    if (!response.ok) {
      console.error(`💬 [CHAT] API Error: ${response.status}`);
      return "Puxa, tive um problema aqui 😅 Mas me conta: o que você quer saber sobre suas finanças?";
    }

    const data = await response.json();
    const chatResponse = data.choices?.[0]?.message?.content;
    
    if (!chatResponse) {
      return "Vou analisar isso pra você! 📊 Me conta mais detalhes?";
    }
    
    return chatResponse;
  } catch (err) {
    console.error(`💬 [CHAT] Exception:`, err);
    return "Ops, algo deu errado por aqui 😕 Mas pode me perguntar de novo!";
  }
}

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
    // Buscar usuário
    const { data: usuario } = await supabase.from("usuarios").select("*").eq("id", userId).single();
    const nomeUsuario = usuario?.nome || "amigo(a)";
    
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
        
        // Verificar se a mensagem é um código de ativação (FINAX-XXXXXX)
        const msgText = payload.messageText?.trim().toUpperCase() || "";
        const codigoMatch = msgText.match(/^(FINAX[-\s]?)?([A-Z0-9]{6,12})$/);
        
        if (codigoMatch) {
          // Tentar validar código
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
            
            // Salvar no histórico
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
        
        // Se não é código, enviar mensagem de trial expirado
        const primeiroNome = nomeUsuario.split(" ")[0];
        await sendMessage(payload.phoneNumber, 
          `⏰ Oi ${primeiroNome}! Seu período de teste de 14 dias acabou.\n\nO Finax te ajudou a organizar suas finanças. Quer continuar?\n\n📱 *Básico* - Registros, orçamentos e relatórios\n⭐ *Pro* - Tudo + cartões, metas e insights\n\n👉 Acesse: [link do checkout]\n\nOu envie seu código de ativação aqui!`, 
          payload.messageSource
        );
        
        // Salvar no histórico
        await supabase.from("historico_conversas").insert({
          phone_number: payload.phoneNumber,
          user_id: userId,
          user_message: payload.messageText || "[MÍDIA]",
          ai_response: "[TRIAL EXPIRADO - BLOQUEIO]",
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
      await checkAndSendPendingReport(userId, payload.phoneNumber, payload.messageSource);
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
        if (ocrResult.valor && ocrResult.descricao) {
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
            await handleExpenseResult(result, payload.phoneNumber, payload.messageSource);
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
      .neq("current_step", "done")
      .single();
    
    if (activeOnboarding) {
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
          await handleExpenseResult(result as any, payload.phoneNumber, payload.messageSource);
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
      // 📋 QUERY BUTTONS INDEPENDENTES (NÃO precisam de activeAction)
      // ====================================================================
      // Estes botões extraem parâmetros do próprio ID e executam queries
      // diretamente. Devem vir ANTES do guard de EXPIRED_BUTTON.
      // ====================================================================
      if (payload.buttonReplyId?.startsWith("view_all_")) {
        const parts = payload.buttonReplyId.replace("view_all_", "").split("_");
        const scope = parts[0];
        const viewTimeRange = parts[1] || "month";
        const viewCategory = parts[2] !== "all" ? parts[2] : undefined;
        
        console.log(`📋 [BUTTON] Ver todos: ${scope} ${viewTimeRange} ${viewCategory || 'todas categorias'}`);
        
        const viewStartOfMonth = new Date();
        if (viewTimeRange === "month") {
          viewStartOfMonth.setDate(1);
          viewStartOfMonth.setHours(0, 0, 0, 0);
        } else if (viewTimeRange === "week") {
          viewStartOfMonth.setDate(viewStartOfMonth.getDate() - 7);
          viewStartOfMonth.setHours(0, 0, 0, 0);
        } else if (viewTimeRange === "today") {
          viewStartOfMonth.setHours(0, 0, 0, 0);
        } else {
          viewStartOfMonth.setDate(1);
          viewStartOfMonth.setHours(0, 0, 0, 0);
        }
        
        let viewQuery = supabase
          .from("transacoes")
          .select("valor, descricao, categoria, data")
          .eq("usuario_id", userId)
          .eq("tipo", scope === "income" ? "entrada" : "saida")
          .gte("data", viewStartOfMonth.toISOString())
          .eq("status", "confirmada")
          .order("data", { ascending: false });
        
        if (viewCategory) {
          viewQuery = viewQuery.eq("categoria", viewCategory);
        }
        
        const { data: allTx } = await viewQuery;
        
        if (!allTx || allTx.length === 0) {
          await sendMessage(payload.phoneNumber, "Nenhum gasto encontrado 🤷", payload.messageSource);
          return;
        }
        
        const byCategory: Record<string, typeof allTx> = {};
        for (const tx of allTx) {
          const cat = tx.categoria || "outros";
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(tx);
        }
        
        const catEmojis: Record<string, string> = {
          alimentacao: "🍔", transporte: "🚗", moradia: "🏠", lazer: "🎮",
          saude: "🏥", educacao: "📚", mercado: "🛒", servicos: "✂️", compras: "🛍️", outros: "📦"
        };
        
        let fullMsg = `📊 *Todos os gastos*\n\n`;
        for (const [cat, txs] of Object.entries(byCategory)) {
          const emoji = catEmojis[cat] || "💸";
          const totalCat = txs.reduce((sum, t) => sum + Number(t.valor), 0);
          fullMsg += `${emoji} *${cat}* (R$ ${totalCat.toFixed(2)})\n`;
          for (const tx of txs) {
            const dataF = tx.data ? formatBrasiliaDate(tx.data) : "";
            fullMsg += `  💸 R$ ${Number(tx.valor).toFixed(2)} - ${tx.descricao || 'Sem descrição'}${dataF ? ` (${dataF})` : ""}\n`;
          }
          fullMsg += `\n`;
        }
        const totalAll = allTx.reduce((sum, t) => sum + Number(t.valor), 0);
        fullMsg += `💰 *Total: R$ ${totalAll.toFixed(2)}*`;
        
        await sendMessage(payload.phoneNumber, fullMsg, payload.messageSource);
        return;
      }
      
      if (payload.buttonReplyId?.startsWith("view_by_category_")) {
        const catTimeRange = payload.buttonReplyId.replace("view_by_category_", "");
        console.log(`📊 [BUTTON] Ver por categoria: ${catTimeRange}`);
        
        const catStartDate = new Date();
        if (catTimeRange === "month") { catStartDate.setDate(1); catStartDate.setHours(0,0,0,0); }
        else if (catTimeRange === "week") { catStartDate.setDate(catStartDate.getDate() - 7); catStartDate.setHours(0,0,0,0); }
        else { catStartDate.setDate(1); catStartDate.setHours(0,0,0,0); }
        
        const { data: catTxs } = await supabase
          .from("transacoes")
          .select("categoria, valor")
          .eq("usuario_id", userId)
          .eq("tipo", "saida")
          .gte("data", catStartDate.toISOString())
          .eq("status", "confirmada");
        
        if (!catTxs || catTxs.length === 0) {
          await sendMessage(payload.phoneNumber, "Nenhum gasto encontrado 🤷", payload.messageSource);
          return;
        }
        
        const byCat: Record<string, number> = {};
        for (const tx of catTxs) {
          const cat = tx.categoria || "outros";
          byCat[cat] = (byCat[cat] || 0) + Number(tx.valor);
        }
        
        const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        const catEmojis2: Record<string, string> = {
          alimentacao: "🍔", transporte: "🚗", moradia: "🏠", lazer: "🎮",
          saude: "🏥", educacao: "📚", mercado: "🛒", servicos: "✂️", compras: "🛍️", outros: "📦"
        };
        
        let catMsg = `📊 *Gastos por Categoria*\n\n`;
        for (const [cat, total] of sorted) {
          const emoji = catEmojis2[cat] || "💸";
          catMsg += `${emoji} ${cat}: R$ ${total.toFixed(2)}\n`;
        }
        const totalGeral = sorted.reduce((sum, [_, val]) => sum + val, 0);
        catMsg += `\n💸 *Total: R$ ${totalGeral.toFixed(2)}*`;
        
        // ✅ FIX WA-3: Usar lista interativa quando há 4+ categorias
        if (sorted.length > 3) {
          const sections = [{
            title: "Categorias",
            rows: sorted.map(([cat]) => ({
              id: `view_all_expenses_${catTimeRange}_${cat}`,
              title: `${catEmojis2[cat] || "💸"} ${cat}`.slice(0, 24),
              description: `R$ ${byCat[cat].toFixed(2)}`
            }))
          }];
          await sendListMessage(payload.phoneNumber, catMsg, "Ver categoria", sections, payload.messageSource);
        } else {
          const detailButtons = sorted.map(([cat]) => ({
            id: `view_all_expenses_${catTimeRange}_${cat}`,
            title: `📋 ${cat.slice(0, 16)}`
          }));
          await sendButtons(payload.phoneNumber, catMsg, detailButtons, payload.messageSource);
        }
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
          "edit_credito": "credito",
          "edit_dinheiro": "dinheiro"
        };
        const newMethod = editAliases[payload.buttonReplyId];
        
        if (newMethod && activeAction.slots.transaction_id) {
          const result = await updateTransactionPaymentMethod(activeAction.slots.transaction_id, newMethod);
          await closeAction(activeAction.id);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
          return;
        }
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
              await handleExpenseResult(result, payload.phoneNumber, payload.messageSource);
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
            await handleExpenseResult(result, payload.phoneNumber, payload.messageSource);
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
      
      // NOTA: Seleção de cartão (card_) agora é tratada no bloco unificado select_card_/card_ acima
      
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
      // ✅ FIX BUG #2: DUPLICATE CONFIRM HANDLERS
      // ====================================================================
      if (payload.buttonReplyId === "duplicate_confirm_yes") {
        const dupAction = activeAction?.intent === "duplicate_expense" ? activeAction : null;
        if (dupAction) {
          const dupSlots = { ...(dupAction.slots as ExtractedSlots), _skip_duplicate: true };
          await closeAction(dupAction.id);
          const result = await registerExpense(userId, dupSlots);
          await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        } else {
          await sendMessage(payload.phoneNumber, "Ops, perdi o contexto. Tenta de novo? 😕", payload.messageSource);
        }
        return;
      }
      
      if (payload.buttonReplyId === "duplicate_confirm_no") {
        if (activeAction) await closeAction(activeAction.id);
        await sendMessage(payload.phoneNumber, "Ok, não vou registrar! 👍", payload.messageSource);
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
          const result = await registerExpense(userId, activeAction.slots as any, activeAction.id);
          await handleExpenseResult(result, payload.phoneNumber, payload.messageSource);
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
      
      // (view_all_* and view_by_category_* handlers moved before EXPIRED_BUTTON guard)
      
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
          await handleExpenseResult(result, payload.phoneNumber, payload.messageSource);
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
        /^(pix|debito|credito|dinheiro|cartao|sim|nao|\d{1,4})$/i.test(conteudoProcessado.trim())
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
          await handleExpenseResult(result as any, payload.phoneNumber, payload.messageSource);
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
        }
      }
      
      // ========================================================================
      // CASO 4: HANDLED MAS SEM SLOT PREENCHIDO (erro de entrada)
      // ========================================================================
      if (contextResult.handled && contextResult.message) {
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
    const domainCheck = assertDomainIsolation(decision.actionType, activeAction);
    if (domainCheck.shouldDiscard) {
      await cancelAction(userId);
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
          { id: "edit_debito", title: "💳 Débito" },
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
        const result = await registerExpense(userId, slots as any, undefined);
        await supabase.from("actions")
          .update({ status: "done" })
          .eq("user_id", userId)
          .in("status", ["collecting", "awaiting_input", "awaiting_confirmation"]);
        
        // ✅ Marcar decisão como executada
        if (decision.decisionId) {
          await markAsExecuted(decision.decisionId, result.success ?? true);
        }
        
        await handleExpenseResult(result, payload.phoneNumber, payload.messageSource);
        
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
    // 💳 CARD EVENT - Contrato: required = ["card", "value"]
    // ========================================================================
    // REGRA ABSOLUTA: card_event NUNCA entra em fluxo de expense/income
    // ========================================================================
    if (decision.actionType === "card_event") {
      const slots = decision.slots;
      
      // ✅ EXECUÇÃO DIRETA: hasAllRequiredSlots = true
      if (hasAllRequiredSlots("card_event", slots)) {
        const result = await updateCardLimit(userId, slots.card!, slots.value!);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // ❌ FALTA SLOT OBRIGATÓRIO
      const missing = getMissingSlots("card_event", slots);
      
      // Se falta cartão, listar opções com botões
      if (missing.includes("card")) {
        const cards = await listCardsForUser(userId);
        if (cards.length === 0) {
          await sendMessage(payload.phoneNumber, "Você não tem cartões cadastrados 💳", payload.messageSource);
          return;
        }
        if (cards.length <= 3) {
          const cardButtons = cards.map(c => ({
            id: `card_${c.id}`,
            title: (c.nome || "Cartão").slice(0, 20)
          }));
          await sendButtons(payload.phoneNumber, "Qual cartão atualizar?", cardButtons, payload.messageSource);
        } else {
          const sections = [{
            title: "Seus cartões",
            rows: cards.map(c => ({
              id: `card_${c.id}`,
              title: (c.nome || "Cartão").slice(0, 24)
            }))
          }];
          await sendListMessage(payload.phoneNumber, "Qual cartão atualizar?", "Selecionar", sections, payload.messageSource);
        }
        return;
      }
      
      // Se falta valor
      if (missing.includes("value")) {
        await sendMessage(payload.phoneNumber, `Qual o novo limite do *${slots.card}*?`, payload.messageSource);
        return;
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
    
    const result = await registerExpense(userId, slots as any, undefined);
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
            { id: "rec_pay_debito", title: "💳 Débito" },
            { id: "rec_pay_credito", title: "💳 Crédito" },
            { id: "rec_pay_dinheiro", title: "💵 Dinheiro" }
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
      const slots = decision.slots;
      
      // Verificar se é encerramento de contexto
      const normalized = normalizeText(conteudoProcessado);
      if (normalized.includes("terminei") || normalized.includes("fim do") || normalized.includes("acabou") || normalized.includes("encerr")) {
        const result = await closeUserContext(userId);
        await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
        return;
      }
      
      // Criar novo contexto
      const result = await createUserContext(userId, slots);
      await sendMessage(payload.phoneNumber, result.message, payload.messageSource);
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
        // ✅ FIX WA-4: Handler para "relatório semanal" on-demand
        case "weekly_report": {
          console.log(`📊 [QUERY] Roteando para: WEEKLY REPORT`);
          
          const { data: relatorio } = await supabase.rpc("fn_relatorio_semanal", {
            p_usuario_id: userId
          });
          
          if (relatorio && relatorio.totais && (relatorio.totais.entradas > 0 || relatorio.totais.saidas > 0)) {
            const textoRelatorio = await gerarTextoRelatorioInline(relatorio, nomeUsuario);
            await sendMessage(payload.phoneNumber, textoRelatorio, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, "📊 Sem dados suficientes para o relatório semanal.\n\nRegistre seus gastos e entradas primeiro! 💸", payload.messageSource);
          }
          return;
        }
        
        case "cards":
          console.log(`📊 [QUERY] Roteando para: CARDS`);
          const cardsResult = await queryCardLimits(userId);
          await sendMessage(payload.phoneNumber, cardsResult, payload.messageSource);
          return;
        
        case "pending":
          console.log(`📊 [QUERY] Roteando para: PENDING`);
          const pendingResult = await listPendingExpenses(userId);
          await sendMessage(payload.phoneNumber, pendingResult, payload.messageSource);
          return;
        
        case "expenses":
          console.log(`📊 [QUERY] Roteando para: EXPENSES - usando dynamic query`);
          
          // ✅ [v6.1] Sistema dinâmico - funciona para QUALQUER período
          const { executeDynamicQuery } = await import("./utils/dynamic-query.ts");
          
          const expenseQueryParams = {
            userId,
            query_scope: "expenses" as const,
            start_date: decision.slots.start_date as string | undefined,
            end_date: decision.slots.end_date as string | undefined,
            time_range: timeRange,
            category: decision.slots.category as string | undefined,
            card_id: decision.slots.card_id as string | undefined
          };
          
          console.log(`📊 [QUERY] Dynamic params:`, expenseQueryParams);
          
          const expensesResult = await executeDynamicQuery(expenseQueryParams);
          
          // ✅ Se tem mais itens, enviar com botões interativos
          if (expensesResult.hasMore) {
            const queryButtons: Array<{ id: string; title: string }> = [
              { id: `view_all_expenses_${expensesResult.timeRange}_${expensesResult.category || 'all'}`, title: "📋 Ver todos" }
            ];
            // Se não filtrou por categoria, adicionar botão "Por categoria"
            if (!expensesResult.category) {
              queryButtons.push({
                id: `view_by_category_${expensesResult.timeRange}`,
                title: "📊 Por categoria"
              });
            }
            await sendButtons(payload.phoneNumber, expensesResult.message, queryButtons, payload.messageSource);
          } else {
            await sendMessage(payload.phoneNumber, expensesResult.message, payload.messageSource);
          }
          
          // Atualizar contexto para próxima pergunta
          await updateConversationContext(userId, {
            currentTopic: "expenses",
            lastIntent: "query",
            lastTimeRange: timeRange,
            lastQueryScope: "expenses",
            lastCategory: decision.slots.category as string || undefined
          });
          
          return;
        
        case "income":
          console.log(`📊 [QUERY] Roteando para: INCOME`);
          const inicioMes = new Date();
          inicioMes.setDate(1);
          inicioMes.setHours(0, 0, 0, 0);
          
          const { data: entradas } = await supabase
            .from("transacoes")
            .select("valor, descricao, data, forma_pagamento")
            .eq("usuario_id", userId)
            .eq("tipo", "entrada")
            .gte("data", inicioMes.toISOString())
            .eq("status", "confirmada")
            .order("data", { ascending: false });
          
          if (!entradas || entradas.length === 0) {
            await sendMessage(payload.phoneNumber, "💰 Nenhuma entrada registrada este mês.\n\n_Manda \"recebi 1500\" pra registrar!_", payload.messageSource);
            return;
          }
          
          const totalEntradas = entradas.reduce((sum: number, e: any) => sum + Number(e.valor), 0);
          const listaEntradas = entradas.slice(0, 10).map((e: any) => {
            const dataStr = formatBrasiliaDate(e.data);
            return `💰 R$ ${Number(e.valor).toFixed(2)} - ${e.descricao || "Entrada"} (${dataStr})`;
          }).join("\n");
          
          await sendMessage(payload.phoneNumber, 
            `💰 *Entradas do Mês*\n\n${listaEntradas}\n\n✅ *Total: R$ ${totalEntradas.toFixed(2)}*`,
            payload.messageSource
          );
          return;
        
        case "category":
          console.log(`📊 [QUERY] Roteando para: CATEGORY`);
          const catResult = await getExpensesByCategory(userId);
          await sendMessage(payload.phoneNumber, catResult, payload.messageSource);
          return;
        
        case "recurring":
          console.log(`📊 [QUERY] Roteando para: RECURRING`);
          const recorrentes = await listActiveRecurrings(userId);
          if (recorrentes.length === 0) {
            await sendMessage(payload.phoneNumber, "Você não tem gastos recorrentes ativos 📋", payload.messageSource);
            return;
          }
          const listaRec = recorrentes.map((r: any) => 
            `🔄 ${r.descricao} - R$ ${Number(r.valor_parcela).toFixed(2)}/mês`
          ).join("\n");
          await sendMessage(payload.phoneNumber, `🔄 *Seus Recorrentes*\n\n${listaRec}`, payload.messageSource);
          return;
        
        // ✅ BLOCO 4: Handler para "meus parcelamentos"
        case "installments":
        case "installment":
        case "parcelas":
        case "parcelamento":
        case "parcelamentos": {
          console.log(`📊 [QUERY] Roteando para: INSTALLMENTS`);
          
          const { data: parcelas } = await supabase
            .from("parcelas")
            .select("descricao, numero_parcela, total_parcelas, valor, status, mes_referencia")
            .eq("usuario_id", userId)
            .in("status", ["pendente", "futura"])
            .order("mes_referencia", { ascending: true })
            .limit(20);
          
          if (!parcelas || parcelas.length === 0) {
            await sendMessage(payload.phoneNumber, "📦 Nenhum parcelamento ativo!\n\n_Pra parcelar, manda: \"notebook 1200 crédito 12x\"_", payload.messageSource);
            return;
          }
          
          // Agrupar por descrição
          const byDesc: Record<string, typeof parcelas> = {};
          for (const p of parcelas) {
            const desc = p.descricao || "Parcelado";
            if (!byDesc[desc]) byDesc[desc] = [];
            byDesc[desc].push(p);
          }
          
          let parcMsg = `📦 *Seus Parcelamentos*\n\n`;
          for (const [desc, items] of Object.entries(byDesc)) {
            const first = items[0];
            const totalParcelas = first.total_parcelas || items.length;
            const pendentes = items.filter(p => p.status === "pendente").length;
            const futuras = items.filter(p => p.status === "futura").length;
            const valorParcela = Number(first.valor || 0);
            const valorTotal = valorParcela * totalParcelas;
            
            parcMsg += `📦 *${desc}*\n`;
            parcMsg += `  💰 ${totalParcelas}x de R$ ${valorParcela.toFixed(2)} (Total: R$ ${valorTotal.toFixed(2)})\n`;
            parcMsg += `  📊 ${pendentes + futuras} parcelas restantes\n\n`;
          }
          
          await sendMessage(payload.phoneNumber, parcMsg, payload.messageSource);
          return;
        }
        
        // ✅ BLOCO 5: Handler para "minhas metas"
        case "goal":
        case "goals":
        case "metas": {
          console.log(`📊 [QUERY] Roteando para: GOALS`);
          
          const { data: metas } = await supabase
            .from("savings_goals")
            .select("name, current_amount, target_amount, status, deadline")
            .eq("user_id", userId)
            .eq("status", "active")
            .order("created_at", { ascending: false });
          
          if (!metas || metas.length === 0) {
            await sendMessage(payload.phoneNumber, "🎯 Nenhuma meta ativa!\n\n_Pra criar uma, manda: \"meta viagem 5000\"_", payload.messageSource);
            return;
          }
          
          let metaMsg = `🎯 *Suas Metas*\n\n`;
          for (const m of metas) {
            const atual = Number(m.current_amount || 0);
            const objetivo = Number(m.target_amount || 0);
            const pct = objetivo > 0 ? Math.round((atual / objetivo) * 100) : 0;
            const barFull = Math.round(pct / 10);
            const bar = "▓".repeat(barFull) + "░".repeat(10 - barFull);
            
            metaMsg += `🎯 *${m.name}*\n`;
            metaMsg += `  R$ ${atual.toFixed(2)} / R$ ${objetivo.toFixed(2)} (${pct}%)\n`;
            metaMsg += `  ${bar}\n`;
            if (m.deadline) {
              metaMsg += `  📅 Prazo: ${formatBrasiliaDate(m.deadline)}\n`;
            }
            metaMsg += `\n`;
          }
          
          await sendMessage(payload.phoneNumber, metaMsg, payload.messageSource);
          return;
        }
        
        // ✅ DETALHAMENTO DE FATURA
        case "invoice_detail": {
          console.log(`📊 [QUERY] Roteando para: INVOICE DETAIL`);
          const { getInvoiceDetail } = await import("./intents/query.ts");
          
          // Extrair mês do texto (ex: "fatura de março", "fatura janeiro")
          const mesesMap: Record<string, number> = {
            janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
            julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
          };
          let invoiceMes: number | undefined;
          let invoiceAno: number | undefined;
          for (const [mesNome, mesNum] of Object.entries(mesesMap)) {
            if (normalized.includes(mesNome)) {
              invoiceMes = mesNum;
              break;
            }
          }
          // Detectar "passado/passada" → mês anterior
          if (normalized.includes("passad")) {
            const brasilNow = new Date();
            const bOffset = -3 * 60;
            const bTime = new Date(brasilNow.getTime() + (bOffset - brasilNow.getTimezoneOffset()) * 60000);
            invoiceMes = bTime.getMonth(); // 0-indexed = previous month
            if (invoiceMes === 0) { invoiceMes = 12; invoiceAno = bTime.getFullYear() - 1; }
          }
          
          // Detectar nome do cartão (ex: "fatura do nubank")
          let invoiceCard: string | undefined;
          const cardWords = ["nubank", "inter", "bradesco", "itau", "sicredi", "santander", "c6", "next", "pan", "original", "neon"];
          for (const cw of cardWords) {
            if (normalized.includes(cw)) { invoiceCard = cw; break; }
          }
          // Also try from user's actual card names
          const { data: userCardsForInvoice } = await supabase
            .from("cartoes_credito")
            .select("nome")
            .eq("usuario_id", userId);
          for (const uc of (userCardsForInvoice || [])) {
            if (uc.nome && normalized.includes(normalizeText(uc.nome))) {
              invoiceCard = uc.nome;
              break;
            }
          }
          
          const detailResult = await getInvoiceDetail(userId, invoiceCard, invoiceMes, invoiceAno);
          await sendMessage(payload.phoneNumber, detailResult, payload.messageSource);
          return;
        }
        
        // ✅ PREVISÃO DE FATURA FUTURA
        case "invoice_future": {
          console.log(`📊 [QUERY] Roteando para: INVOICE FUTURE`);
          const { getFutureInvoicePreview } = await import("./intents/query.ts");
          
          let futureCard: string | undefined;
          const { data: userCardsForFuture } = await supabase
            .from("cartoes_credito")
            .select("nome")
            .eq("usuario_id", userId);
          for (const uc of (userCardsForFuture || [])) {
            if (uc.nome && normalized.includes(normalizeText(uc.nome))) {
              futureCard = uc.nome;
              break;
            }
          }
          
          const futureResult = await getFutureInvoicePreview(userId, futureCard);
          await sendMessage(payload.phoneNumber, futureResult, payload.messageSource);
          return;
        }
        
        case "summary": {
          // ✅ BUG 5 FIX: Se time_range é "week", rotear para weekly_report
          if (timeRange === "week" || timeRange === "weekly" || timeRange === "semana" || timeRange === "semanal") {
            console.log(`📊 [QUERY] Summary + week → roteando para WEEKLY REPORT`);
            const { data: relatorio } = await supabase.rpc("fn_relatorio_semanal", {
              p_usuario_id: userId
            });
            if (relatorio && relatorio.totais && (relatorio.totais.entradas > 0 || relatorio.totais.saidas > 0)) {
              const textoRelatorio = await gerarTextoRelatorioInline(relatorio, nomeUsuario);
              await sendMessage(payload.phoneNumber, textoRelatorio, payload.messageSource);
            } else {
              await sendMessage(payload.phoneNumber, "📊 Sem dados suficientes para o relatório semanal.\n\nRegistre seus gastos e entradas primeiro! 💸", payload.messageSource);
            }
            return;
          }
          // Continua para fallback checks
          break;
        }
        default:
          break;
      }
      
      // ========================================================================
      // FALLBACK: Detecção por keywords (para compatibilidade)
      // ========================================================================
      
      // Query de ENTRADAS
      if (normalized.includes("recebi") || normalized.includes("entrada") || 
          normalized.includes("entrou") || normalized.includes("renda") ||
          normalized.includes("quanto ganhei") || normalized.includes("minhas entradas")) {
        console.log(`📊 [QUERY] Query de ENTRADAS detectada (fallback)`);
        
        const inicioMes2 = new Date();
        inicioMes2.setDate(1);
        inicioMes2.setHours(0, 0, 0, 0);
        
        const { data: entradas2 } = await supabase
          .from("transacoes")
          .select("valor, descricao, data, forma_pagamento")
          .eq("usuario_id", userId)
          .eq("tipo", "entrada")
          .gte("data", inicioMes2.toISOString())
          .eq("status", "confirmada")
          .order("data", { ascending: false });
        
        if (!entradas2 || entradas2.length === 0) {
          await sendMessage(payload.phoneNumber, "💰 Nenhuma entrada registrada este mês.\n\n_Manda \"recebi 1500\" pra registrar!_", payload.messageSource);
          return;
        }
        
        const total2 = entradas2.reduce((sum: number, e: any) => sum + Number(e.valor), 0);
        const lista2 = entradas2.slice(0, 10).map((e: any) => {
          const dataStr = new Date(e.data).toLocaleDateString("pt-BR");
          return `💰 R$ ${Number(e.valor).toFixed(2)} - ${e.descricao || "Entrada"} (${dataStr})`;
        }).join("\n");
        
        await sendMessage(payload.phoneNumber, 
          `💰 *Entradas do Mês*\n\n${lista2}\n\n✅ *Total: R$ ${total2.toFixed(2)}*`,
          payload.messageSource
        );
        return;
      }
      
      // Query por CARTÃO específico
      const cardMatch = normalized.match(/(?:gastei|quanto)\s+(?:no|na|do|da)\s+(\w+)/);
      if (cardMatch && cardMatch[1]) {
        const cardName = cardMatch[1];
        console.log(`📊 [QUERY] Query de gastos no cartão: "${cardName}"`);
        
        const { data: card } = await supabase
          .from("cartoes_credito")
          .select("id, nome, limite_disponivel, limite_total")
          .eq("usuario_id", userId)
          .ilike("nome", `%${cardName}%`)
          .limit(1)
          .maybeSingle();
        
        if (card) {
          const inicioMes3 = new Date();
          inicioMes3.setDate(1);
          inicioMes3.setHours(0, 0, 0, 0);
          
          const { data: gastos } = await supabase
            .from("transacoes")
            .select("valor, descricao, data")
            .eq("usuario_id", userId)
            .eq("cartao_id", card.id)
            .eq("tipo", "saida")
            .gte("data", inicioMes3.toISOString())
            .eq("status", "confirmada")
            .order("data", { ascending: false });
          
          if (!gastos || gastos.length === 0) {
            await sendMessage(payload.phoneNumber, 
              `💳 *${card.nome}*\n\nNenhum gasto este mês.\n\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
              payload.messageSource
            );
            return;
          }
          
          const totalCard = gastos.reduce((sum: number, g: any) => sum + Number(g.valor), 0);
          const listaCard = gastos.slice(0, 8).map((g: any) => {
            const dataStr = new Date(g.data).toLocaleDateString("pt-BR");
            return `💸 R$ ${Number(g.valor).toFixed(2)} - ${g.descricao || "Gasto"} (${dataStr})`;
          }).join("\n");
          
          await sendMessage(payload.phoneNumber, 
            `💳 *Gastos no ${card.nome}*\n\n${listaCard}\n\n💸 Total: R$ ${totalCard.toFixed(2)}\n🟢 Disponível: R$ ${(card.limite_disponivel ?? 0).toFixed(2)}`,
            payload.messageSource
          );
          return;
        }
      }
      
      // Gastos por CATEGORIA
      if (normalized.includes("categoria") || normalized.includes("categorias") ||
          (normalized.includes("gasto") && normalized.includes("por")) ||
          normalized.includes("breakdown") || normalized.includes("detalha")) {
        console.log(`📊 [QUERY] Gastos por categoria detectado (fallback)`);
        const { getExpensesByCategory: getCat } = await import("./intents/query.ts");
        const result = await getCat(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Perguntas sobre cartão/limite
      if ((normalized.includes("limite") && (normalized.includes("disponivel") || normalized.includes("cartao") || normalized.includes("cartoes"))) ||
          (normalized.includes("quanto") && normalized.includes("limite"))) {
        const result = await queryCardLimits(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Perguntas sobre gastos por cartão
      if ((normalized.includes("gastei") || normalized.includes("gasto")) && 
          (normalized.includes("cartao") || normalized.includes("credito") || normalized.includes("cada cartao"))) {
        const result = await queryExpensesByCard(userId);
        await sendMessage(payload.phoneNumber, result, payload.messageSource);
        return;
      }
      
      // Query de viagem/contexto
      if (normalized.includes("viagem") && (normalized.includes("quanto") || normalized.includes("gastei"))) {
        const activeContext = await getActiveContext(userId);
        if (activeContext) {
          const { total, count } = await queryContextExpenses(userId, activeContext.id);
          await sendMessage(payload.phoneNumber, 
            `📍 *Gastos na ${activeContext.label}*\n\n💸 Total: R$ ${total.toFixed(2)}\n🧾 ${count} transações`,
            payload.messageSource
          );
          return;
        } else {
          await sendMessage(payload.phoneNumber, "Você não tem nenhuma viagem ativa no momento 🤔\n\nPra começar uma viagem, manda: \"Viagem pra SP de 09/01 a 15/01\"", payload.messageSource);
          return;
        }
      }
      
      // Fallback: resumo mensal
      const summary = await getMonthlySummary(userId);
      await sendMessage(payload.phoneNumber, summary, payload.messageSource);
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
        if (normalizedGuard.includes("pix")) slotValue = "pix";
        else if (normalizedGuard.includes("debito") || normalizedGuard.includes("débito")) slotValue = "debito";
        else if (normalizedGuard.includes("credito") || normalizedGuard.includes("crédito")) slotValue = "credito";
        else if (normalizedGuard.includes("dinheiro")) slotValue = "dinheiro";
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
    if (helpCtxPreChat?.lastIntent === "help" && decision.actionType !== "control") {
      // Usuário está respondendo a "precisa de ajuda com o quê?" mas IA classificou como chat/outro
      let helpResponse = "";
      
      if (/\b(gasto|registr|anotar|lanc|compra|despesa)\b/i.test(conteudoProcessado)) {
        helpResponse = `💸 *Registrar gastos é simples!*\n\n` +
          `É só me dizer assim:\n\n` +
          `• "café 5 pix"\n` +
          `• "almoço 30 débito"\n` +
          `• "uber 15 crédito"\n\n` +
          `Eu pergunto o que faltar!\n\n` +
          `Também dá pra mandar:\n` +
          `• "ontem jantar 80 cartão"\n` +
          `• "dia 05/02 mercado 150 débito"\n\n` +
          `Quer testar agora? 😊`;
      } else if (/\b(cartao|cartões|credito|limite)\b/i.test(conteudoProcessado)) {
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
          `• "mercado 200 débito"\n\n` +
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
      
      // Buscar contexto financeiro do usuário
      const summary = await getMonthlySummary(userId);
      const activeCtx = await getActiveContext(userId);
      
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
      const normalized = normalizeText(conteudoProcessado);
      
      if (normalized.includes("cancela") || normalized.includes("deixa") || normalized.includes("nao")) {
        const cancelled = await cancelAction(userId);
        await sendMessage(payload.phoneNumber, cancelled ? "Ok, descartei! 👍" : "Não tinha nada pendente 🤔", payload.messageSource);
        return;
      }
      
      // ================================================================
      // 🔍 VERIFICAR SE É FOLLOW-UP DE AJUDA (contexto ativo com last_intent = "help")
      // ================================================================
      const helpCtx = await getConversationContext(userId);
      if (helpCtx?.lastIntent === "help") {
        // Usuário está respondendo a "precisa de ajuda com o quê?"
        let helpResponse = "";
        
        if (/\b(gasto|registr|anotar|lanc|compra|despesa)\b/i.test(conteudoProcessado)) {
          helpResponse = `💸 *Registrar gastos é simples!*\n\n` +
            `É só me dizer assim:\n\n` +
            `• "café 5 pix"\n` +
            `• "almoço 30 débito"\n` +
            `• "uber 15 crédito"\n\n` +
            `Eu pergunto o que faltar!\n\n` +
            `Também dá pra mandar:\n` +
            `• "ontem jantar 80 cartão"\n` +
            `• "dia 05/02 mercado 150 débito"\n\n` +
            `Quer testar agora? 😊`;
        } else if (/\b(cartao|cartões|credito|limite)\b/i.test(conteudoProcessado)) {
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
      
      // ================================================================
      // 📖 AJUDA CONVERSACIONAL (sem botões!)
      // ================================================================
      if (normalized.includes("ajuda") || normalized.includes("help") || 
          normalized.includes("como usar") || normalized.includes("como funciona") ||
          normalized.includes("tutorial") || normalized.includes("comandos")) {
        
        // Salvar contexto de ajuda para follow-up
        await updateConversationContext(userId, { lastIntent: "help" });
        
        await sendMessage(payload.phoneNumber,
          `🤖 *Claro! Estou aqui pra te ajudar!*\n\n` +
          `Precisa de ajuda com o quê?\n\n` +
          `💸 Registrar gastos?\n` +
          `💳 Cartões de crédito?\n` +
          `📊 Ver resumo/saldo?\n` +
          `🎯 Metas de economia?\n` +
          `🔄 Gastos recorrentes?\n` +
          `📦 Parcelamentos?\n\n` +
          `Me diz que eu te explico! 😊`, payload.messageSource);
        return;
      }
      
      // ================================================================
      // 👋 SAUDAÇÃO CONTEXTUAL (sem botões!)
      // ================================================================
      try {
        const primeiroNome = nomeUsuario.split(" ")[0] || "você";
        
        // Buscar atividade recente para contexto
        const { data: recentActivity } = await supabase
          .from("transacoes")
          .select("tipo, valor, descricao, created_at")
          .eq("usuario_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        // Determinar período do dia (Brasília UTC-3)
        const now = new Date();
        const brasiliaHour = (now.getUTCHours() - 3 + 24) % 24;
        let greeting = "Oi";
        if (brasiliaHour >= 5 && brasiliaHour < 12) greeting = "Bom dia";
        else if (brasiliaHour >= 12 && brasiliaHour < 18) greeting = "Boa tarde";
        else greeting = "Boa noite";
        
        let contextMessage = "";
        
        if (recentActivity) {
          const hoursAgo = (Date.now() - new Date(recentActivity.created_at).getTime()) / (1000 * 60 * 60);
          
          if (hoursAgo < 1) {
            if (recentActivity.tipo === "saida") {
              contextMessage = `\n\nVi que você acabou de registrar *${recentActivity.descricao}*. Quer adicionar mais algo?`;
            } else {
              contextMessage = `\n\nVi que entrou dinheiro! 💰 Tudo certo?`;
            }
          } else if (hoursAgo < 12) {
            contextMessage = `\n\nComo vai o dia? Tudo tranquilo com as finanças? 📊`;
          }
        } else {
          // Nunca usou ou sem transações
          contextMessage = `\n\nSou seu assistente financeiro! 💰\n\nPode me dizer seus gastos assim:\n"café 5 pix" ou "almoço 30 débito"\n\nEu cuido do resto!`;
        }
        
        await sendMessage(payload.phoneNumber, `${greeting}, ${primeiroNome}! 👋${contextMessage}`, payload.messageSource);
      } catch (err) {
        const primeiroNome = nomeUsuario.split(" ")[0];
        await sendMessage(payload.phoneNumber, `Oi, ${primeiroNome}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`, payload.messageSource);
      }
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
    // 💡 FALLBACK INTELIGENTE: Se parece pergunta → responder como chat
    // ========================================================================
    const normalizedFallback = normalizeText(conteudoProcessado);
    const parecePerguntar = conteudoProcessado.includes("?") || 
                            normalizedFallback.match(/^(como|quando|quanto|qual|por que|o que|sera|devo|posso|tenho|to |tou |estou |consigo)/);
    
    if (parecePerguntar) {
      console.log(`💬 [FALLBACK→CHAT] Redirecionando para chat: "${conteudoProcessado.slice(0, 50)}..."`);
      
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
        tipo: "chat_fallback"
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
