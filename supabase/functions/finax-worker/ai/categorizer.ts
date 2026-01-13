// ============================================================================
// 🧠 AI-FIRST CATEGORIZER - AUTOAPRENDIZADO CONTROLADO
// ============================================================================
// Fluxo:
// 1. Busca no cache semântico (Camada 1 - instantâneo)
// 2. Se não encontrar → IA classifica (Camada 2 - Gemini)
// 3. Se IA classifica com confiança ≥ 0.9 → Salva no cache para próximas vezes
// 4. Fallback mínimo apenas se IA falhar completamente (Camada 3)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordMetric } from "../governance/config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Thresholds configuráveis
const CACHE_CONFIDENCE_THRESHOLD = 0.8;  // Mínimo para aceitar do cache
const AI_CONFIDENCE_TO_CACHE = 0.80;     // Mínimo para salvar no cache (baixado de 0.9 para aprender mais)
const DECISION_VERSION = "v5.2-ai-first";

// Categorias válidas do sistema
const VALID_CATEGORIES = [
  "alimentacao",
  "mercado", 
  "transporte",
  "saude",
  "lazer",
  "moradia",
  "compras",
  "servicos",
  "educacao",
  "outros"
] as const;

export type ValidCategory = typeof VALID_CATEGORIES[number];

export interface CategorizationResult {
  category: ValidCategory;
  confidence: number;
  source: "cache" | "ai" | "fallback";
  learned: boolean;  // true se foi aprendido nesta execução
  keyTerm?: string;  // termo-chave identificado
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

/**
 * Normaliza texto para busca no cache
 * Remove acentos, pontuação, converte para minúsculas
 */
export function normalizeTerm(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^\w\s]/g, "")          // Remove pontuação
    .trim();
}

/**
 * Extrai palavras-chave relevantes da descrição
 * Retorna a descrição completa + palavras individuais >= 3 chars
 */
function extractKeywords(description: string): string[] {
  const normalized = normalizeTerm(description);
  const words = normalized.split(/\s+/).filter(w => w.length >= 3);
  
  // Priorizar: descrição completa, depois palavras individuais
  const keywords: string[] = [];
  
  // Descrição completa normalizada
  if (normalized.length >= 3) {
    keywords.push(normalized);
  }
  
  // Palavras individuais (exceto números)
  for (const word of words) {
    if (!/^\d+$/.test(word) && !keywords.includes(word)) {
      keywords.push(word);
    }
  }
  
  return keywords;
}

// ============================================================================
// 📦 CAMADA 1: CACHE SEMÂNTICO
// ============================================================================

/**
 * Busca termo no cache semântico
 * Atualiza contador de uso se encontrar
 */
async function searchSemanticCache(
  description: string
): Promise<CategorizationResult | null> {
  const keywords = extractKeywords(description);
  
  console.log(`🔍 [CACHE] Buscando: ${keywords.join(", ")}`);
  
  for (const keyword of keywords) {
    const { data, error } = await supabase
      .from("semantic_categories")
      .select("*")
      .eq("termo_normalized", keyword)
      .gte("confidence", CACHE_CONFIDENCE_THRESHOLD)
      .single();
    
    if (data && !error) {
      // Atualizar contagem de uso (fire-and-forget)
      supabase.from("semantic_categories")
        .update({ 
          usage_count: data.usage_count + 1,
          last_used_at: new Date().toISOString()
        })
        .eq("id", data.id)
        .then(() => {});
      
      console.log(`✅ [CACHE] HIT! "${keyword}" → ${data.categoria} (conf: ${data.confidence})`);
      
      // 📊 MÉTRICA: Cache hit
      recordMetric("categorization_cache_hit", 1, { keyword, categoria: data.categoria }).catch(() => {});
      
      return {
        category: data.categoria as ValidCategory,
        confidence: data.confidence,
        source: "cache",
        learned: false,
        keyTerm: data.termo
      };
    }
  }
  
  console.log(`⚪ [CACHE] MISS - nenhum termo encontrado`);
  return null;
}

// ============================================================================
// 🤖 CAMADA 2: IA (GEMINI) COM AUTOAPRENDIZADO
// ============================================================================

/**
 * Usa Gemini para categorizar e aprende automaticamente
 */
async function categorizeWithAI(
  description: string
): Promise<CategorizationResult> {
  console.log(`🤖 [AI] Categorizando: "${description}"`);
  
  if (!LOVABLE_API_KEY) {
    console.error("❌ [AI] LOVABLE_API_KEY não configurada");
    return fallbackCategorize(description);
  }
  
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "system",
          content: `Você é um categorizador financeiro especializado brasileiro.

CATEGORIAS VÁLIDAS (use EXATAMENTE estes nomes em minúsculas):
- alimentacao: restaurantes, lanches, delivery, café, padaria, fast food, refeições
- mercado: supermercado, feira, hortifruti, atacado, compras de casa
- transporte: uber, 99, taxi, combustível, estacionamento, passagem, ônibus, metrô, pedágio
- saude: farmácia, médico, hospital, academia, dentista, consulta, exame, plano de saúde
- lazer: cinema, show, teatro, bar, festa, streaming, jogos, viagem, passeio, evento, praia, parque, museu, ingresso, hotel, entretenimento, diversão, balada, boate
- moradia: aluguel, condomínio, energia, água, gás, internet, IPTU, manutenção casa
- compras: roupas, eletrônicos, celular, shopping, presentes, acessórios
- servicos: salão, barbearia, lavanderia, diarista, manutenção, assinatura
- educacao: curso, livro, escola, faculdade, mensalidade, material escolar
- outros: APENAS se realmente não encaixar em NENHUMA das anteriores

REGRAS CRÍTICAS:
1. Responda APENAS com JSON válido: {"categoria": "xxx", "confianca": 0.0-1.0, "termo_chave": "xxx"}
2. "termo_chave" é a palavra principal que define a categoria (para aprendizado)
3. Seja GENEROSO com lazer - shows, eventos, entretenimento, bares são LAZER
4. "outros" é ÚLTIMO recurso absoluto - esforce-se para categorizar
5. Confiança deve refletir certeza real (0.9+ = muito certo, 0.7-0.9 = provável, <0.7 = incerto)

EXEMPLOS:
"show rock in rio" → {"categoria": "lazer", "confianca": 0.98, "termo_chave": "show"}
"uber centro" → {"categoria": "transporte", "confianca": 0.99, "termo_chave": "uber"}
"pagamento fulano" → {"categoria": "outros", "confianca": 0.5, "termo_chave": "pagamento"}
"bar com amigos" → {"categoria": "lazer", "confianca": 0.95, "termo_chave": "bar"}
"pao de queijo" → {"categoria": "alimentacao", "confianca": 0.95, "termo_chave": "pao"}`
        }, {
          role: "user",
          content: `Categorize esta despesa brasileira: "${description}"`
        }],
        temperature: 0.1  // Baixa para consistência
      }),
    });

    if (!response.ok) {
      console.error(`❌ [AI] HTTP ${response.status}: ${await response.text()}`);
      return fallbackCategorize(description);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    
    // Limpar possíveis markdown code blocks
    const cleanContent = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    
    try {
      const parsed = JSON.parse(cleanContent);
      const rawCategoria = (parsed.categoria || "outros").toLowerCase();
      const confianca = Math.min(1, Math.max(0, parsed.confianca || 0.5));
      const termoChave = parsed.termo_chave || normalizeTerm(description).split(" ")[0];
      
      // Validar categoria
      const categoria: ValidCategory = VALID_CATEGORIES.includes(rawCategoria as ValidCategory) 
        ? rawCategoria as ValidCategory 
        : "outros";
      
      console.log(`🤖 [AI] Resultado: "${description}" → ${categoria} (conf: ${confianca}, termo: ${termoChave})`);
      
      // 📊 MÉTRICA: AI usado
      recordMetric("categorization_ai_used", 1, { categoria, confianca: confianca.toString() }).catch(() => {});
      
      // ================================================================
      // 🧠 AUTOAPRENDIZADO: Se confiança alta, salvar no cache
      // ================================================================
      let learned = false;
      if (confianca >= AI_CONFIDENCE_TO_CACHE && categoria !== "outros") {
        const termoNormalized = normalizeTerm(termoChave);
        
        // Verificar se já existe
        const { data: existing } = await supabase
          .from("semantic_categories")
          .select("id")
          .eq("termo_normalized", termoNormalized)
          .single();
        
        if (!existing) {
          // Inserir novo termo aprendido
          const { error: insertError } = await supabase
            .from("semantic_categories")
            .insert({
              termo: termoChave,
              termo_normalized: termoNormalized,
              categoria,
              confidence: confianca,
              source: "ai",
              usage_count: 1,
              decision_version: DECISION_VERSION
            });
          
          if (!insertError) {
            console.log(`🧠 [LEARN] Novo termo aprendido: "${termoChave}" → ${categoria} (conf: ${confianca})`);
            learned = true;
            
            // 📊 MÉTRICA: Termo aprendido
            recordMetric("categorization_learned", 1, { termo: termoChave, categoria }).catch(() => {});
          } else {
            console.error(`⚠️ [LEARN] Erro ao salvar termo:`, insertError);
          }
        } else {
          console.log(`ℹ️ [LEARN] Termo "${termoChave}" já existe no cache`);
        }
      }
      
      return {
        category: categoria,
        confidence: confianca,
        source: "ai",
        learned,
        keyTerm: termoChave
      };
      
    } catch (parseError) {
      console.error("❌ [AI] Erro parsing JSON:", parseError, "Content:", cleanContent);
      return fallbackCategorize(description);
    }
    
  } catch (error) {
    console.error("❌ [AI] Erro na chamada:", error);
    return fallbackCategorize(description);
  }
}

// ============================================================================
// 🛡️ CAMADA 3: FALLBACK MÍNIMO (apenas se IA falhar)
// ============================================================================

/**
 * Fallback mínimo - apenas termos absolutamente óbvios
 * Usado apenas se a IA estiver offline/falhar
 */
function fallbackCategorize(description: string): CategorizationResult {
  console.log(`⚠️ [FALLBACK] Usando heurística mínima para: "${description}"`);
  
  // 📊 MÉTRICA: Fallback usado
  recordMetric("categorization_fallback", 1, { description: description.slice(0, 50) }).catch(() => {});
  
  const desc = normalizeTerm(description);
  
  // Lista MÍNIMA - apenas termos absolutamente óbvios e comuns
  const criticalMap: Record<string, ValidCategory> = {
    uber: "transporte",
    "99": "transporte",
    ifood: "alimentacao",
    rappi: "alimentacao",
    netflix: "lazer",
    spotify: "lazer",
    show: "lazer",
    cinema: "lazer",
    mercado: "mercado",
    supermercado: "mercado",
    farmacia: "saude",
    aluguel: "moradia"
  };
  
  for (const [term, cat] of Object.entries(criticalMap)) {
    if (desc.includes(term)) {
      console.log(`✅ [FALLBACK] Match: "${term}" → ${cat}`);
      return { 
        category: cat, 
        confidence: 0.75, 
        source: "fallback", 
        learned: false,
        keyTerm: term
      };
    }
  }
  
  console.log(`❓ [FALLBACK] Sem match - retornando "outros"`);
  return { 
    category: "outros", 
    confidence: 0.3, 
    source: "fallback", 
    learned: false 
  };
}

// ============================================================================
// 🎯 FUNÇÃO PRINCIPAL: CATEGORIZAR COM IA-FIRST
// ============================================================================

/**
 * Categoriza uma descrição usando arquitetura IA-First:
 * 1. Cache semântico (instantâneo)
 * 2. IA Gemini (com autoaprendizado)
 * 3. Fallback mínimo (se IA falhar)
 * 
 * @param description - Descrição da transação
 * @param existingCategory - Categoria já definida (opcional, será respeitada se não for "outros")
 * @returns Resultado da categorização com metadados
 */
export async function categorizeDescription(
  description: string,
  existingCategory?: string
): Promise<CategorizationResult> {
  // Se já tem categoria válida (não é "outros"), mantém
  if (existingCategory && existingCategory !== "outros" && VALID_CATEGORIES.includes(existingCategory as ValidCategory)) {
    console.log(`📂 [CAT] Categoria existente mantida: ${existingCategory}`);
    return { 
      category: existingCategory as ValidCategory, 
      confidence: 1.0, 
      source: "cache", 
      learned: false 
    };
  }
  
  if (!description || description.trim().length === 0) {
    console.log(`📂 [CAT] Descrição vazia - retornando "outros"`);
    return { 
      category: "outros", 
      confidence: 0.1, 
      source: "fallback", 
      learned: false 
    };
  }
  
  console.log(`📂 [CAT] Iniciando categorização: "${description}"`);
  
  // CAMADA 1: Cache semântico (instantâneo)
  const cached = await searchSemanticCache(description);
  if (cached) {
    return cached;
  }
  
  // CAMADA 2: IA (com autoaprendizado)
  try {
    const aiResult = await categorizeWithAI(description);
    return aiResult;
  } catch (error) {
    console.error("❌ [CAT] Erro na IA:", error);
    
    // CAMADA 3: Fallback mínimo
    return fallbackCategorize(description);
  }
}

// ============================================================================
// 📊 FUNÇÕES AUXILIARES PARA MONITORAMENTO
// ============================================================================

/**
 * Retorna estatísticas do cache de aprendizado
 */
export async function getCacheStats(): Promise<{
  totalTerms: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  recentlyLearned: number;
}> {
  const { data, error } = await supabase
    .from("semantic_categories")
    .select("*");
  
  if (error || !data) {
    return { totalTerms: 0, bySource: {}, byCategory: {}, recentlyLearned: 0 };
  }
  
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let recentlyLearned = 0;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  for (const row of data) {
    bySource[row.source] = (bySource[row.source] || 0) + 1;
    byCategory[row.categoria] = (byCategory[row.categoria] || 0) + 1;
    if (new Date(row.created_at) > oneDayAgo) {
      recentlyLearned++;
    }
  }
  
  return {
    totalTerms: data.length,
    bySource,
    byCategory,
    recentlyLearned
  };
}

/**
 * Força aprendizado de um termo (para correções do usuário)
 */
export async function learnTermFromFeedback(
  termo: string,
  categoria: ValidCategory,
  confidence: number = 0.95
): Promise<boolean> {
  const termoNormalized = normalizeTerm(termo);
  
  const { error } = await supabase
    .from("semantic_categories")
    .upsert({
      termo,
      termo_normalized: termoNormalized,
      categoria,
      confidence,
      source: "user_feedback",
      usage_count: 1,
      decision_version: DECISION_VERSION
    }, { 
      onConflict: "termo_normalized" 
    });
  
  if (error) {
    console.error("❌ [LEARN] Erro ao salvar feedback:", error);
    return false;
  }
  
  console.log(`✅ [LEARN] Termo aprendido via feedback: "${termo}" → ${categoria}`);
  return true;
}
