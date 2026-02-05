// ============================================================================
// 🏛️ FINAX ELITE - GOVERNANCE (KILL SWITCH & DECISION CONFIG)
// ============================================================================
// Controla comportamento dinâmico da IA:
// - auto_apply_corrections: Aplicar correções automaticamente
// - auto_apply_patterns: Aplicar padrões aprendidos
// - proactive_alerts_enabled: Alertas proativos habilitados
// - global_corrections_enabled: Correções globais entre usuários
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const DECISION_VERSION = "v5.1";

// ============================================================================
// 🔧 DECISION CONFIG TYPE
// ============================================================================

export interface DecisionConfig {
  version: string;
  active: boolean;
  auto_apply_corrections: boolean;
  auto_apply_patterns: boolean;
  proactive_alerts_enabled: boolean;
  global_corrections_enabled: boolean;
  description?: string;
}

// Cache de configuração (evita múltiplas queries por job)
let cachedConfig: DecisionConfig | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60000; // 1 minuto

// ============================================================================
// 📖 GET DECISION CONFIG
// ============================================================================
// Busca configuração ativa do banco (com cache de 1 minuto)
// ============================================================================

export async function getDecisionConfig(): Promise<DecisionConfig> {
  const now = Date.now();
  
  // Retornar do cache se válido
  if (cachedConfig && now < cacheExpiry) {
    return cachedConfig;
  }
  
  try {
    const { data, error } = await supabase
      .from("ai_decision_versions")
      .select("*")
      .eq("version", DECISION_VERSION)
      .eq("active", true)
      .single();
    
    if (error || !data) {
      console.log(`⚠️ [GOVERNANCE] Config não encontrada, usando defaults conservadores`);
      // Defaults conservadores (modo seguro)
      cachedConfig = {
        version: DECISION_VERSION,
        active: true,
        auto_apply_corrections: false,
        auto_apply_patterns: true,
        proactive_alerts_enabled: false,
        global_corrections_enabled: false
      };
    } else {
      cachedConfig = {
        version: data.version,
        active: data.active,
        auto_apply_corrections: data.auto_apply_corrections ?? false,
        auto_apply_patterns: data.auto_apply_patterns ?? true,
        proactive_alerts_enabled: data.proactive_alerts_enabled ?? false,
        global_corrections_enabled: data.global_corrections_enabled ?? false,
        description: data.description
      };
      console.log(`🏛️ [GOVERNANCE] Config carregada: ${JSON.stringify(cachedConfig)}`);
    }
    
    cacheExpiry = now + CACHE_TTL_MS;
    return cachedConfig;
    
  } catch (err) {
    console.error(`❌ [GOVERNANCE] Erro ao buscar config:`, err);
    // Fallback seguro
    return {
      version: DECISION_VERSION,
      active: true,
      auto_apply_corrections: false,
      auto_apply_patterns: true,
      proactive_alerts_enabled: false,
      global_corrections_enabled: false
    };
  }
}

// ============================================================================
// 🔒 IS FEATURE ENABLED
// ============================================================================
// Atalhos para verificar features específicas
// ============================================================================

export async function isAutoCorrectionsEnabled(): Promise<boolean> {
  const config = await getDecisionConfig();
  return config.auto_apply_corrections;
}

export async function isAutoPatternsEnabled(): Promise<boolean> {
  const config = await getDecisionConfig();
  return config.auto_apply_patterns;
}

export async function isProactiveAlertsEnabled(): Promise<boolean> {
  const config = await getDecisionConfig();
  return config.proactive_alerts_enabled;
}

export async function isGlobalCorrectionsEnabled(): Promise<boolean> {
  const config = await getDecisionConfig();
  return config.global_corrections_enabled;
}

// ============================================================================
// 📊 RECORD METRIC
// ============================================================================
// Registra métricas de comportamento para análise
// ============================================================================

export async function recordMetric(
  metricName: string, 
  value: number, 
  tags?: Record<string, string>
): Promise<void> {
  try {
    await supabase.from("finax_metrics").insert({
      metric_name: metricName,
      value,
      tags: tags || {}
    });
  } catch (err) {
    // Falha silenciosa - métricas não devem interromper fluxo
    console.error(`📊 [METRIC] Falha ao registrar ${metricName}:`, err);
  }
}

// ============================================================================
// 🔄 INVALIDATE CACHE
// ============================================================================
// Força recarregamento da config (útil após alterações)
// ============================================================================

export function invalidateConfigCache(): void {
  cachedConfig = null;
  cacheExpiry = 0;
  console.log(`🔄 [GOVERNANCE] Cache invalidado`);
}

// ============================================================================
// 📝 GET ACTIVE PROMPT
// ============================================================================
// Busca prompt ativo do banco com fallback seguro
// A tabela ai_prompts já existe - apenas usar quando quiser testar
// ============================================================================

// Fallback padrão (prompt atual hardcoded no engine.ts)
const DEFAULT_FINAX_PROMPT = "FALLBACK_PROMPT";

// Cache de prompts
const promptCache: Map<string, { content: string; expiry: number }> = new Map();
const PROMPT_CACHE_TTL_MS = 300000; // 5 minutos

export async function getActivePrompt(name: string, fallback?: string): Promise<string> {
  const now = Date.now();
  
  // Verificar cache
  const cached = promptCache.get(name);
  if (cached && now < cached.expiry) {
    return cached.content;
  }
  
  try {
    const { data, error } = await supabase
      .from("ai_prompts")
      .select("content")
      .eq("name", name)
      .eq("active", true)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    
    if (error || !data?.content) {
      console.log(`⚠️ [PROMPTS] Prompt "${name}" não encontrado, usando fallback`);
      return fallback || DEFAULT_FINAX_PROMPT;
    }
    
    // Cachear resultado
    promptCache.set(name, { content: data.content, expiry: now + PROMPT_CACHE_TTL_MS });
    console.log(`📝 [PROMPTS] Prompt "${name}" carregado do banco`);
    
    return data.content;
    
  } catch (err) {
    console.warn(`⚠️ [PROMPTS] Erro ao buscar prompt "${name}", usando fallback:`, err);
    return fallback || DEFAULT_FINAX_PROMPT;
  }
}

// Invalidar cache de prompt específico
export function invalidatePromptCache(name?: string): void {
  if (name) {
    promptCache.delete(name);
    console.log(`🔄 [PROMPTS] Cache de "${name}" invalidado`);
  } else {
    promptCache.clear();
    console.log(`🔄 [PROMPTS] Cache de prompts limpo`);
  }
}
