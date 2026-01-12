// ============================================================================
// 📚 SELF-HEALING ENGINE - FASE 1 FINAX ELITE
// ============================================================================
// Sistema que aprende com erros e sugere correções automaticamente.
// REGRA DE OURO: Aprender automaticamente, aplicar SOMENTE com confirmação.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DecisionOutput, ExtractedSlots } from "../decision/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DECISION_VERSION = "v5.1";

// ============================================================================
// 🔑 GERAR PATTERN HASH (NORMALIZAÇÃO INTELIGENTE)
// ============================================================================
// Remove valores monetários, números e datas para agrupar padrões similares.
// Exemplo: "Gastei 150 no cartão" e "Gastei 300 no cartão" → mesmo hash
// ============================================================================

export function generatePatternHash(message: string): string {
  // Normalizar texto
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // remover acentos
    .replace(/r\$\s*/gi, "")            // remover R$
    .replace(/\d+([.,]\d+)?/g, "{NUM}") // substituir números por placeholder
    .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g, "{DATE}") // datas
    .replace(/[^\w\s{}]/g, "")          // remover pontuação
    .replace(/\s+/g, " ")               // normalizar espaços
    .trim()
    .slice(0, 60);                      // limitar tamanho
  
  // Gerar hash simples (não precisa ser criptográfico)
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return Math.abs(hash).toString(16).padStart(8, "0");
}

// ============================================================================
// 📝 SALVAR CORREÇÃO (APRENDER SEM APLICAR)
// ============================================================================
// Quando usuário corrige algo ("era débito", "foi entrada"), salvamos 
// a correção para sugerir automaticamente em mensagens futuras similares.
// ============================================================================

export interface CorrectionData {
  userId: string;
  originalMessage: string;
  originalClassification: Partial<DecisionOutput>;
  userCorrection: string;
  correctedField: string;
  correctedValue: any;
}

export async function learnFromCorrection(data: CorrectionData): Promise<void> {
  const patternHash = generatePatternHash(data.originalMessage);
  
  console.log(`📚 [LEARN] Salvando correção: ${data.correctedField} = ${data.correctedValue}`);
  console.log(`📚 [LEARN] Pattern hash: ${patternHash}`);
  
  try {
    // Verificar se já existe correção similar para este padrão
    const { data: existing } = await supabase
      .from("ai_corrections")
      .select("id, applied_count, correction_confidence")
      .eq("user_id", data.userId)
      .eq("pattern_hash", patternHash)
      .eq("correction_type", data.correctedField)
      .single();
    
    if (existing) {
      // Atualizar correção existente (incrementar confiança)
      await supabase.from("ai_corrections")
        .update({
          correction_confidence: Math.min(0.99, existing.correction_confidence + 0.1),
          applied_count: existing.applied_count + 1,
          user_correction: data.userCorrection,
          corrected_classification: { [data.correctedField]: data.correctedValue }
        })
        .eq("id", existing.id);
      
      console.log(`📚 [LEARN] Correção atualizada: ${existing.id}`);
    } else {
      // Inserir nova correção
      await supabase.from("ai_corrections").insert({
        user_id: data.userId,
        original_message: data.originalMessage,
        original_classification: data.originalClassification,
        user_correction: data.userCorrection,
        corrected_classification: { [data.correctedField]: data.correctedValue },
        correction_type: data.correctedField,
        pattern_hash: patternHash,
        correction_confidence: 0.5,  // Começa baixo
        confirmed_by_user: false,    // Só true após confirmação
        decision_version: DECISION_VERSION,
        applied_count: 0
      });
      
      console.log(`📚 [LEARN] Nova correção salva para padrão: ${patternHash}`);
    }
  } catch (error) {
    console.error("❌ [LEARN] Erro ao salvar correção:", error);
  }
}

// ============================================================================
// 🔍 VERIFICAR CORREÇÕES ANTERIORES (SUGERIR, NUNCA SOBRESCREVER)
// ============================================================================
// Antes de classificar uma mensagem, verificamos se existe correção 
// para padrão similar. Só aplicamos automaticamente se:
// 1. applied_count >= 5
// 2. correction_confidence >= 0.85
// 3. confirmed_by_user = true
// 4. Tipo não é crítico (valor, cartão)
// ============================================================================

export interface CorrectionSuggestion {
  hasSuggestion: boolean;
  shouldAutoApply: boolean;
  suggestion?: {
    id: string;
    correctedField: string;
    correctedValue: any;
    confidence: number;
    appliedCount: number;
  };
}

// Campos críticos que NUNCA devem ser auto-aplicados
const CRITICAL_FIELDS = ["amount", "value", "card", "card_id", "installments"];

export async function checkPreviousCorrections(
  userId: string,
  message: string
): Promise<CorrectionSuggestion> {
  const patternHash = generatePatternHash(message);
  
  console.log(`🔍 [CORRECTIONS] Buscando correções para hash: ${patternHash}`);
  
  try {
    // Buscar correções:
    // 1. Do próprio usuário para esse padrão
    // 2. Ou globais (de qualquer usuário) com alto uso (>= 10) e confirmadas
    const { data: corrections, error } = await supabase
      .from("ai_corrections")
      .select("*")
      .eq("pattern_hash", patternHash)
      .or(`user_id.eq.${userId},and(applied_count.gte.10,confirmed_by_user.eq.true)`)
      .order("correction_confidence", { ascending: false })
      .limit(1);
    
    if (error) {
      console.error("❌ [CORRECTIONS] Erro na busca:", error);
      return { hasSuggestion: false, shouldAutoApply: false };
    }
    
    if (!corrections?.length) {
      return { hasSuggestion: false, shouldAutoApply: false };
    }
    
    const correction = corrections[0];
    const correctedField = correction.correction_type;
    const correctedValue = correction.corrected_classification?.[correctedField];
    
    console.log(`✅ [CORRECTIONS] Correção encontrada: ${correctedField} = ${correctedValue}`);
    console.log(`   confidence: ${correction.correction_confidence}, applied: ${correction.applied_count}, confirmed: ${correction.confirmed_by_user}`);
    
    // Determinar se deve auto-aplicar
    const isCriticalField = CRITICAL_FIELDS.includes(correctedField);
    const shouldAutoApply = 
      correction.applied_count >= 5 &&
      correction.correction_confidence >= 0.85 &&
      correction.confirmed_by_user === true &&
      !isCriticalField;
    
    return {
      hasSuggestion: true,
      shouldAutoApply,
      suggestion: {
        id: correction.id,
        correctedField,
        correctedValue,
        confidence: correction.correction_confidence,
        appliedCount: correction.applied_count
      }
    };
  } catch (error) {
    console.error("❌ [CORRECTIONS] Erro:", error);
    return { hasSuggestion: false, shouldAutoApply: false };
  }
}

// ============================================================================
// ✅ CONFIRMAR SUGESTÃO (Aumentar confiança)
// ============================================================================

export async function confirmCorrectionSuggestion(
  correctionId: string
): Promise<void> {
  console.log(`✅ [CORRECTIONS] Confirmando correção: ${correctionId}`);
  
  try {
    const { data: correction } = await supabase
      .from("ai_corrections")
      .select("correction_confidence, applied_count")
      .eq("id", correctionId)
      .single();
    
    if (correction) {
      await supabase.from("ai_corrections")
        .update({
          correction_confidence: Math.min(0.99, correction.correction_confidence + 0.1),
          applied_count: correction.applied_count + 1,
          confirmed_by_user: true,
          last_confirmed_at: new Date().toISOString()
        })
        .eq("id", correctionId);
    }
  } catch (error) {
    console.error("❌ [CORRECTIONS] Erro ao confirmar:", error);
  }
}

// ============================================================================
// ❌ REJEITAR SUGESTÃO (Diminuir confiança)
// ============================================================================

export async function rejectCorrectionSuggestion(
  correctionId: string
): Promise<void> {
  console.log(`❌ [CORRECTIONS] Rejeitando correção: ${correctionId}`);
  
  try {
    const { data: correction } = await supabase
      .from("ai_corrections")
      .select("correction_confidence")
      .eq("id", correctionId)
      .single();
    
    if (correction) {
      // Diminuir confiança, mas não abaixo de 0.1
      await supabase.from("ai_corrections")
        .update({
          correction_confidence: Math.max(0.1, correction.correction_confidence - 0.2)
        })
        .eq("id", correctionId);
    }
  } catch (error) {
    console.error("❌ [CORRECTIONS] Erro ao rejeitar:", error);
  }
}

// ============================================================================
// 🧹 APLICAR CORREÇÃO AOS SLOTS
// ============================================================================

export function applyCorrectionToSlots(
  slots: ExtractedSlots,
  correctedField: string,
  correctedValue: any
): ExtractedSlots {
  return {
    ...slots,
    [correctedField]: correctedValue,
    _corrected_by_learning: true,
    _corrected_field: correctedField
  };
}
