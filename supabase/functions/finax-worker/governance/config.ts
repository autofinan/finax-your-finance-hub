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

// ============================================================================
// 🧪 A/B TEST - PROMPT SELECTION
// ============================================================================
// Seleciona prompt baseado em A/B test (quando ativado)
// Usa hash do userId para distribuição consistente (mesmo user = mesmo grupo)
// ============================================================================

export interface ABTestConfig {
  enabled: boolean;
  control_prompt_name: string;   // Prompt A (controle)
  variant_prompt_name: string;   // Prompt B (variante)
  variant_percentage: number;     // 0-100: % de usuários no grupo B
}

// Cache do A/B test config
let abTestConfig: ABTestConfig | null = null;
let abTestCacheExpiry: number = 0;

export async function getABTestConfig(): Promise<ABTestConfig | null> {
  const now = Date.now();
  
  if (abTestConfig !== null && now < abTestCacheExpiry) {
    return abTestConfig.enabled ? abTestConfig : null;
  }
  
  try {
    const { data, error } = await supabase
      .from("ai_prompts")
      .select("name, active, performance")
      .eq("active", true)
      .in("name", ["finax_prompt_v7", "finax_prompt_v8"])
      .order("version", { ascending: false });
    
    if (error || !data || data.length < 2) {
      // Não há 2 prompts ativos → sem A/B test
      abTestConfig = { enabled: false, control_prompt_name: "", variant_prompt_name: "", variant_percentage: 0 };
      abTestCacheExpiry = now + PROMPT_CACHE_TTL_MS;
      return null;
    }
    
    // Verificar se algum tem ab_test config no campo performance
    const v7 = data.find(p => p.name === "finax_prompt_v7");
    const v8 = data.find(p => p.name === "finax_prompt_v8");
    
    if (!v7 || !v8) {
      abTestConfig = { enabled: false, control_prompt_name: "", variant_prompt_name: "", variant_percentage: 0 };
      abTestCacheExpiry = now + PROMPT_CACHE_TTL_MS;
      return null;
    }
    
    const perf = v8.performance as Record<string, any> | null;
    const abEnabled = perf?.ab_test_enabled === true;
    const variantPct = perf?.ab_test_percentage ?? 0;
    
    abTestConfig = {
      enabled: abEnabled,
      control_prompt_name: "finax_prompt_v7",
      variant_prompt_name: "finax_prompt_v8",
      variant_percentage: variantPct
    };
    
    abTestCacheExpiry = now + PROMPT_CACHE_TTL_MS;
    
    if (abEnabled) {
      console.log(`🧪 [A/B TEST] Ativo: ${variantPct}% no prompt v8`);
    }
    
    return abTestConfig.enabled ? abTestConfig : null;
    
  } catch (err) {
    console.warn(`⚠️ [A/B TEST] Erro ao buscar config:`, err);
    return null;
  }
}

/**
 * Determina qual prompt usar para um dado userId.
 * Usa hash simples do userId para distribuição consistente.
 */
export function getUserABGroup(userId: string, variantPercentage: number): "control" | "variant" {
  // Hash simples: soma dos charCodes mod 100
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash + userId.charCodeAt(i)) % 100;
  }
  return hash < variantPercentage ? "variant" : "control";
}

/**
 * Retorna o prompt correto para o usuário (A/B test aware).
 * Se A/B test desabilitado, retorna o fallback (prompt hardcoded).
 */
export async function getPromptForUser(userId: string, fallbackPrompt: string): Promise<{ prompt: string; group: "control" | "variant" | "default"; promptName: string }> {
  const abConfig = await getABTestConfig();
  
  if (!abConfig) {
    return { prompt: fallbackPrompt, group: "default", promptName: "hardcoded_v7" };
  }
  
  const group = getUserABGroup(userId, abConfig.variant_percentage);
  const promptName = group === "variant" ? abConfig.variant_prompt_name : abConfig.control_prompt_name;
  
  const prompt = await getActivePrompt(promptName, fallbackPrompt);
  
  // Se o prompt do banco é o fallback, usar hardcoded
  if (prompt === DEFAULT_FINAX_PROMPT || prompt === "FALLBACK_PROMPT") {
    return { prompt: fallbackPrompt, group: "default", promptName: "hardcoded_v7" };
  }
  
  console.log(`🧪 [A/B] User ${userId.slice(0, 8)}... → grupo "${group}" → prompt "${promptName}"`);
  return { prompt, group, promptName };
}

/**
 * Registra resultado do A/B test para análise posterior.
 */
export async function recordABTestResult(
  userId: string,
  group: string,
  promptName: string,
  intent: string,
  confidence: number,
  wasExecuted: boolean
): Promise<void> {
  try {
    await recordMetric("ab_test_result", confidence, {
      group,
      prompt_name: promptName,
      intent,
      executed: String(wasExecuted)
    });
  } catch {
    // Silencioso - não interromper fluxo
  }
}
