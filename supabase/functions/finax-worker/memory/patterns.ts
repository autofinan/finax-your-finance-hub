// ============================================================================
// 🧠 MEMORY LAYER - FASE 2 FINAX ELITE
// ============================================================================
// Sistema de memória de longo prazo que aprende padrões do usuário.
// REGRAS DE OURO:
// 1. Texto do usuário SEMPRE vence memória
// 2. Não aprender de transações corrigidas
// 3. Padrões expiram após 90 dias de inatividade
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots } from "../decision/types.ts";
import { recordMetric } from "../governance/config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DECISION_VERSION = "v5.1";
const CONFIDENCE_THRESHOLD = 0.7;
const PATTERN_TTL_DAYS = 90;

// ============================================================================
// 🔤 NORMALIZAR MERCHANT/DESCRIÇÃO
// ============================================================================

export function normalizeMerchant(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // remover acentos
    .replace(/[^\w\s]/g, "")           // remover pontuação
    .replace(/\s+/g, " ")              // normalizar espaços
    .trim()
    .slice(0, 50);                     // limitar tamanho
}

// ============================================================================
// 📝 APRENDER PADRÃO DE MERCHANT
// ============================================================================
// Após cada transação bem-sucedida (NÃO corrigida), aprendemos o padrão.
// Exemplo: "padaria do zé" → categoria: alimentação, pagamento: débito
// ============================================================================

export interface LearnPatternParams {
  userId: string;
  description: string;
  category: string;
  paymentMethod: string;
  cardId?: string;
  transactionId: string;
  wasUserCorrected?: boolean;
}

export async function learnMerchantPattern(params: LearnPatternParams): Promise<void> {
  const {
    userId,
    description,
    category,
    paymentMethod,
    cardId,
    transactionId,
    wasUserCorrected = false
  } = params;
  
  // REGRA: Não aprender de transações corrigidas
  if (wasUserCorrected) {
    console.log(`⚠️ [MEMORY] Ignorando padrão de transação corrigida: ${description}`);
    return;
  }
  
  const merchantNormalized = normalizeMerchant(description);
  
  if (merchantNormalized.length < 3) {
    console.log(`⚠️ [MEMORY] Descrição muito curta para aprender: ${description}`);
    return;
  }
  
  console.log(`🧠 [MEMORY] Aprendendo padrão: ${merchantNormalized} → ${category}/${paymentMethod}`);
  
  try {
    // Verificar se já existe padrão
    const { data: existing } = await supabase
      .from("user_patterns")
      .select("*")
      .eq("user_id", userId)
      .eq("merchant_normalized", merchantNormalized)
      .single();
    
    const expiresAt = new Date(Date.now() + PATTERN_TTL_DAYS * 24 * 60 * 60 * 1000);
    
    if (existing) {
      // REGRA: Só incrementar se mesma categoria + mesmo pagamento
      const isSamePattern = 
        existing.inferred_category === category && 
        existing.inferred_payment_method === paymentMethod;
      
      if (isSamePattern) {
        const newUsageCount = existing.usage_count + 1;
        const newConfidence = Math.min(0.99, existing.confidence + 0.15);
        // Só ativar (confidence >= 0.7) quando usage_count >= 3
        const effectiveConfidence = newUsageCount >= 3 ? newConfidence : Math.min(newConfidence, CONFIDENCE_THRESHOLD - 0.01);
        
        await supabase.from("user_patterns")
          .update({
            inferred_category: category,
            inferred_payment_method: paymentMethod,
            inferred_card_id: cardId || existing.inferred_card_id,
            confidence: effectiveConfidence,
            usage_count: newUsageCount,
            last_used_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString()
          })
          .eq("id", existing.id);
        
        const isActive = newUsageCount >= 3 && effectiveConfidence >= CONFIDENCE_THRESHOLD;
        console.log(`🧠 [MEMORY] Padrão atualizado: ${merchantNormalized} (uso: ${newUsageCount}x, conf: ${effectiveConfidence.toFixed(2)}, ativo: ${isActive})`);
      } else {
        // Padrão divergente - não sobrescrever, apenas logar
        console.log(`⚠️ [MEMORY] Padrão divergente ignorado: ${merchantNormalized} (existente: ${existing.inferred_category}/${existing.inferred_payment_method}, novo: ${category}/${paymentMethod})`);
      }
    } else {
      // Inserir novo padrão com confidence baixa (NÃO será aplicado até 3x)
      await supabase.from("user_patterns").insert({
        user_id: userId,
        merchant: description,
        merchant_normalized: merchantNormalized,
        inferred_category: category,
        inferred_payment_method: paymentMethod,
        inferred_card_id: cardId,
        confidence: 0.3,  // Começa BAIXO - não será aplicado até 3x
        usage_count: 1,
        source_transaction_id: transactionId,
        expires_at: expiresAt.toISOString(),
        decision_version: DECISION_VERSION
      });
      
      console.log(`🧠 [MEMORY] Novo padrão criado: ${merchantNormalized} (conf: 0.3, precisa de 3x para ativar)`);
    }
  } catch (error) {
    console.error("❌ [MEMORY] Erro ao aprender padrão:", error);
  }
}

// ============================================================================
// 🔍 APLICAR PADRÕES DO USUÁRIO
// ============================================================================
// Antes de executar uma transação, verificamos se existe padrão.
// REGRA CRÍTICA: Texto do usuário SEMPRE vence memória.
// ============================================================================

export interface ApplyPatternsResult {
  slots: ExtractedSlots;
  patternApplied: boolean;
  patternId?: string;
  requiresConfirmation: boolean;
}

export async function applyUserPatterns(
  userId: string,
  slots: ExtractedSlots,
  originalMessage: string
): Promise<ApplyPatternsResult> {
  if (!slots.description) {
    return { slots, patternApplied: false, requiresConfirmation: false };
  }
  
  const merchantNormalized = normalizeMerchant(slots.description);
  
  console.log(`🔍 [MEMORY] Buscando padrão para: ${merchantNormalized}`);
  
  try {
    // Buscar padrão não expirado com confidence >= threshold
    const { data: pattern, error } = await supabase
      .from("user_patterns")
      .select("*")
      .eq("user_id", userId)
      .eq("merchant_normalized", merchantNormalized)
      .gte("confidence", CONFIDENCE_THRESHOLD)
      .gt("expires_at", new Date().toISOString())
      .single();
    
    if (error || !pattern) {
      console.log(`🔍 [MEMORY] Nenhum padrão encontrado`);
      return { slots, patternApplied: false, requiresConfirmation: false };
    }
    
    console.log(`✅ [MEMORY] Padrão encontrado: ${pattern.merchant} → ${pattern.inferred_payment_method}`);
    
    // REGRA CRÍTICA: Detectar se usuário mencionou explicitamente algo
    const messageNorm = originalMessage.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    const explicitPayments = ["pix", "debito", "débito", "credito", "crédito", "dinheiro", "cartao", "cartão"];
    const explicitCategories = ["lazer", "alimentacao", "alimentação", "transporte", "mercado", "saude", "saúde"];
    
    const hasExplicitPayment = explicitPayments.some(p => messageNorm.includes(p));
    const hasExplicitCategory = explicitCategories.some(c => messageNorm.includes(c));
    
    const newSlots = { ...slots };
    let patternApplied = false;
    
    // ✅ BUG #1 FIX: Só aplicar se NÃO foi mencionado explicitamente pelo usuário
    if (!slots.payment_method && !hasExplicitPayment && pattern.inferred_payment_method) {
      newSlots.payment_method = pattern.inferred_payment_method;
      newSlots._inferred_payment_from_pattern = true;
      patternApplied = true;
      
      // 📊 MÉTRICA: Padrão aplicado
      recordMetric("pattern_applied", 1, { 
        pattern_id: pattern.id, 
        field: "payment_method",
        confidence: pattern.confidence.toString()
      }).catch(() => {});
      console.log(`🧠 [MEMORY] Aplicando payment_method inferido: ${pattern.inferred_payment_method}`);
    } else if (slots.payment_method || hasExplicitPayment) {
      console.log(`🧠 [MEMORY] payment_method do usuário preservado: ${slots.payment_method} (padrão ignorado: ${pattern.inferred_payment_method})`);
    }
    
    if (!slots.category && !hasExplicitCategory && pattern.inferred_category) {
      newSlots.category = pattern.inferred_category;
      newSlots._inferred_category_from_pattern = true;
      patternApplied = true;
      console.log(`🧠 [MEMORY] Aplicando categoria inferida: ${pattern.inferred_category}`);
    }
    
    // ✅ BUG #1 FIX: Só injetar card_id se payment_method é credito (não pix/debito/dinheiro)
    const effectivePayment = newSlots.payment_method || slots.payment_method;
    if (!slots.card_id && pattern.inferred_card_id && 
        (effectivePayment === "credito" || (!effectivePayment && !hasExplicitPayment))) {
      newSlots.card_id = pattern.inferred_card_id;
      patternApplied = true;
    } else if (slots.card_id || (effectivePayment && effectivePayment !== "credito")) {
      console.log(`🧠 [MEMORY] card_id do padrão ignorado (payment: ${effectivePayment})`);
    }
    
    // Determinar se precisa confirmação (primeira vez usando padrão)
    const requiresConfirmation = patternApplied && !pattern.last_confirmed_by_user;
    
    return {
      slots: newSlots,
      patternApplied,
      patternId: pattern.id,
      requiresConfirmation
    };
  } catch (error) {
    console.error("❌ [MEMORY] Erro ao aplicar padrões:", error);
    return { slots, patternApplied: false, requiresConfirmation: false };
  }
}

// ============================================================================
// ✅ CONFIRMAR PADRÃO INFERIDO
// ============================================================================

export async function confirmPattern(patternId: string): Promise<void> {
  console.log(`✅ [MEMORY] Confirmando padrão: ${patternId}`);
  
  try {
    const { data: pattern } = await supabase
      .from("user_patterns")
      .select("confidence")
      .eq("id", patternId)
      .single();
    
    if (pattern) {
      await supabase.from("user_patterns")
        .update({
          confidence: Math.min(0.99, pattern.confidence + 0.15),
          last_confirmed_by_user: true,
          last_used_at: new Date().toISOString()
        })
        .eq("id", patternId);
    }
  } catch (error) {
    console.error("❌ [MEMORY] Erro ao confirmar padrão:", error);
  }
}

// ============================================================================
// ❌ REJEITAR PADRÃO INFERIDO
// ============================================================================

export async function rejectPattern(patternId: string): Promise<void> {
  console.log(`❌ [MEMORY] Rejeitando padrão: ${patternId}`);
  
  try {
    const { data: pattern } = await supabase
      .from("user_patterns")
      .select("confidence")
      .eq("id", patternId)
      .single();
    
    if (pattern) {
      await supabase.from("user_patterns")
        .update({
          confidence: Math.max(0.1, pattern.confidence - 0.3),
          last_confirmed_by_user: false
        })
        .eq("id", patternId);
    }
  } catch (error) {
    console.error("❌ [MEMORY] Erro ao rejeitar padrão:", error);
  }
}

// ============================================================================
// 📊 OBTER ESTATÍSTICAS DE PADRÕES DO USUÁRIO
// ============================================================================

export async function getUserPatternStats(userId: string): Promise<{
  totalPatterns: number;
  activePatterns: number;
  avgConfidence: number;
}> {
  try {
    const { data: patterns } = await supabase
      .from("user_patterns")
      .select("confidence, expires_at")
      .eq("user_id", userId);
    
    if (!patterns?.length) {
      return { totalPatterns: 0, activePatterns: 0, avgConfidence: 0 };
    }
    
    const now = new Date();
    const activePatterns = patterns.filter(p => new Date(p.expires_at) > now);
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    
    return {
      totalPatterns: patterns.length,
      activePatterns: activePatterns.length,
      avgConfidence
    };
  } catch (error) {
    console.error("❌ [MEMORY] Erro ao obter estatísticas:", error);
    return { totalPatterns: 0, activePatterns: 0, avgConfidence: 0 };
  }
}
