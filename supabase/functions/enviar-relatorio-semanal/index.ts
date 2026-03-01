import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const JANELA_24H_MS = 24 * 60 * 60 * 1000;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📤 WHATSAPP SENDER
// ============================================================================

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    console.log(`📤 Enviando relatório para ${cleanNumber}...`);

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cleanNumber,
          type: "text",
          text: { body: text },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Erro WhatsApp:`, error);
      return false;
    }
    console.log(`✅ Mensagem enviada para ${cleanNumber}`);
    return true;
  } catch (error) {
    console.error(`❌ Erro ao enviar WhatsApp:`, error);
    return false;
  }
}

// ============================================================================
// ⏰ JANELA 24H
// ============================================================================

async function verificarJanela24h(userId: string): Promise<boolean> {
  try {
    const { data: ultimaMensagem } = await supabase
      .from("historico_conversas")
      .select("created_at")
      .eq("user_id", userId)
      .not("user_message", "is", null)
      .not("user_message", "ilike", "%RELATÓRIO%")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!ultimaMensagem) return false;

    const ultimaInteracao = new Date(ultimaMensagem.created_at).getTime();
    return (Date.now() - ultimaInteracao) <= JANELA_24H_MS;
  } catch {
    return false;
  }
}

async function marcarRelatorioPendente(userId: string): Promise<void> {
  await supabase
    .from("usuarios")
    .update({ relatorio_semanal_pendente: true })
    .eq("id", userId);
}

// ============================================================================
// 📊 DETECTOR DE PADRÕES
// ============================================================================

interface PatternResult {
  topRecurringDay: string | null;        // Dia da semana com mais gastos
  topRecurringCategory: string | null;   // Categoria dominante
  categoryTrend: "rising" | "falling" | "stable"; // Tendência
  avgDailySpend: number;
  peakDay: { day: string; total: number } | null;
  lowDay: { day: string; total: number } | null;
  weekdayVsWeekend: { weekday: number; weekend: number };
}

async function detectPatterns(userId: string): Promise<PatternResult> {
  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  
  const { data: transactions } = await supabase
    .from("transacoes")
    .select("valor, categoria, data, tipo")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .neq("status", "cancelada")
    .gte("data", fourWeeksAgo.toISOString())
    .order("data", { ascending: true });

  const result: PatternResult = {
    topRecurringDay: null,
    topRecurringCategory: null,
    categoryTrend: "stable",
    avgDailySpend: 0,
    peakDay: null,
    lowDay: null,
    weekdayVsWeekend: { weekday: 0, weekend: 0 },
  };

  if (!transactions || transactions.length < 5) return result;

  // Gastos por dia da semana
  const dayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const byDay: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalSpend = 0;
  let weekdayTotal = 0, weekendTotal = 0;

  for (const t of transactions) {
    const d = new Date(t.data);
    const dow = d.getDay();
    const dayName = dayNames[dow];
    byDay[dayName] = (byDay[dayName] || 0) + t.valor;
    byCategory[t.categoria || "Outros"] = (byCategory[t.categoria || "Outros"] || 0) + t.valor;
    totalSpend += t.valor;
    if (dow === 0 || dow === 6) weekendTotal += t.valor;
    else weekdayTotal += t.valor;
  }

  result.avgDailySpend = Math.round(totalSpend / 28);
  result.weekdayVsWeekend = { weekday: Math.round(weekdayTotal / 20), weekend: Math.round(weekendTotal / 8) };

  // Dia de pico e mínimo
  const dayEntries = Object.entries(byDay).sort((a, b) => b[1] - a[1]);
  if (dayEntries.length > 0) {
    result.peakDay = { day: dayEntries[0][0], total: Math.round(dayEntries[0][1]) };
    result.topRecurringDay = dayEntries[0][0];
    result.lowDay = { day: dayEntries[dayEntries.length - 1][0], total: Math.round(dayEntries[dayEntries.length - 1][1]) };
  }

  // Categoria dominante
  const catEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (catEntries.length > 0) {
    result.topRecurringCategory = catEntries[0][0];
  }

  // Tendência: comparar semanas 1-2 vs 3-4
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const firstHalf = transactions.filter(t => new Date(t.data) < twoWeeksAgo).reduce((s, t) => s + t.valor, 0);
  const secondHalf = transactions.filter(t => new Date(t.data) >= twoWeeksAgo).reduce((s, t) => s + t.valor, 0);
  
  if (firstHalf > 0) {
    const change = (secondHalf - firstHalf) / firstHalf;
    result.categoryTrend = change > 0.15 ? "rising" : change < -0.15 ? "falling" : "stable";
  }

  return result;
}

// ============================================================================
// 🚨 RADAR DE ANOMALIAS
// ============================================================================

interface Anomaly {
  type: "spike" | "unusual_category" | "frequency_jump" | "weekend_surge";
  severity: "info" | "warn" | "alert";
  message: string;
  data: Record<string, any>;
}

async function detectAnomalies(userId: string, weeklyData: any, patterns: PatternResult): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];
  const totais = weeklyData?.totais;
  const comparativo = weeklyData?.comparativo;

  if (!totais) return anomalies;

  // 1. Spike de gastos (>50% acima da semana anterior)
  if (comparativo && comparativo.saidas_semana_anterior > 0) {
    const variacao = ((totais.saidas - comparativo.saidas_semana_anterior) / comparativo.saidas_semana_anterior) * 100;
    if (variacao > 50) {
      anomalies.push({
        type: "spike",
        severity: "alert",
        message: `Gastos ${Math.round(variacao)}% acima da semana anterior`,
        data: { variacao: Math.round(variacao), atual: totais.saidas, anterior: comparativo.saidas_semana_anterior }
      });
    } else if (variacao > 25) {
      anomalies.push({
        type: "spike",
        severity: "warn",
        message: `Gastos ${Math.round(variacao)}% acima da semana anterior`,
        data: { variacao: Math.round(variacao) }
      });
    }
  }

  // 2. Gasto no fim de semana desproporcional
  if (patterns.weekdayVsWeekend.weekend > patterns.weekdayVsWeekend.weekday * 2 && patterns.weekdayVsWeekend.weekend > 50) {
    anomalies.push({
      type: "weekend_surge",
      severity: "info",
      message: `Fins de semana custam ${Math.round(patterns.weekdayVsWeekend.weekend / Math.max(patterns.weekdayVsWeekend.weekday, 1) * 100)}% a mais que dias úteis`,
      data: patterns.weekdayVsWeekend
    });
  }

  // 3. Tendência de alta em 4 semanas
  if (patterns.categoryTrend === "rising") {
    anomalies.push({
      type: "frequency_jump",
      severity: "warn",
      message: "Tendência de alta nos gastos nas últimas 4 semanas",
      data: { trend: "rising" }
    });
  }

  // 4. Semana sem receita (se havia receita antes)
  if (totais.entradas === 0 && comparativo?.entradas_semana_anterior > 0) {
    anomalies.push({
      type: "unusual_category",
      severity: "info",
      message: "Nenhuma entrada registrada esta semana",
      data: { entradas_anterior: comparativo.entradas_semana_anterior }
    });
  }

  return anomalies;
}

// ============================================================================
// 🤖 GERAR RELATÓRIO COM IA (CONSULTOR SEMANAL)
// ============================================================================

async function gerarRelatorioConsultivo(
  dados: any,
  patterns: PatternResult,
  anomalies: Anomaly[],
  nomeUsuario: string
): Promise<string> {
  try {
    const anomalyText = anomalies.length > 0
      ? `\nANOMALIAS DETECTADAS:\n${anomalies.map(a => `- [${a.severity.toUpperCase()}] ${a.message}`).join("\n")}`
      : "\nNenhuma anomalia detectada.";

    const patternText = `
PADRÕES (últimas 4 semanas):
- Dia de pico: ${patterns.peakDay?.day || "N/A"} (R$ ${patterns.peakDay?.total || 0})
- Dia mais econômico: ${patterns.lowDay?.day || "N/A"} (R$ ${patterns.lowDay?.total || 0})
- Categoria dominante: ${patterns.topRecurringCategory || "N/A"}
- Média diária: R$ ${patterns.avgDailySpend}
- Tendência: ${patterns.categoryTrend === "rising" ? "📈 Alta" : patterns.categoryTrend === "falling" ? "📉 Queda" : "➡️ Estável"}
- Dia útil vs Fim de semana: R$ ${patterns.weekdayVsWeekend.weekday}/dia vs R$ ${patterns.weekdayVsWeekend.weekend}/dia`;

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
            content: `Você é o Finax, consultor financeiro pessoal do ${nomeUsuario}.

REGRAS:
- Tom profissional, direto e acessível
- Cite DADOS CONCRETOS (valores, percentuais)
- NÃO invente dados, use APENAS o que foi fornecido
- Máximo 4 parágrafos curtos
- Use no máximo 3 emojis
- Dê 1-2 sugestões PRÁTICAS e específicas baseadas nos padrões
- Se há anomalias, destaque a mais importante primeiro
- Linguagem simples para público geral

FORMATO:
📊 *Relatório Semanal - Finax*
[período]

[Resumo dos totais com variação]

[Padrão mais relevante identificado]

[Anomalia se houver + recomendação]

💡 [Dica prática baseada nos dados]`
          },
          {
            role: "user",
            content: `Gere o relatório consultivo semanal com estes dados PRÉ-CALCULADOS:

DADOS DA SEMANA:
${JSON.stringify(dados, null, 2)}

${patternText}
${anomalyText}

Nome do usuário: ${nomeUsuario}`
          }
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Não foi possível gerar o relatório.";
  } catch (error) {
    console.error("Erro ao gerar texto:", error);
    return "Erro ao gerar relatório semanal.";
  }
}

// ============================================================================
// 🚀 HANDLER PRINCIPAL
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("📊 Iniciando Consultor IA Semanal...");

    const { data: usuarios, error: errUsuarios } = await supabase
      .from("usuarios")
      .select("id, phone_number, nome, plano")
      .eq("ativo", true)
      .in("plano", ["trial", "basico", "pro"]);

    if (errUsuarios || !usuarios?.length) {
      console.log("Nenhum usuário ativo encontrado");
      return new Response(
        JSON.stringify({ message: "Nenhum usuário para enviar relatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 ${usuarios.length} usuários encontrados`);

    let enviados = 0, pendentes = 0, erros = 0;

    for (const usuario of usuarios) {
      try {
        // Verificar janela 24h
        const dentroDaJanela = await verificarJanela24h(usuario.id);
        if (!dentroDaJanela) {
          await marcarRelatorioPendente(usuario.id);
          pendentes++;
          continue;
        }

        // Buscar dados do relatório semanal (pré-calculado pelo PostgreSQL)
        const { data: relatorio, error: errRelatorio } = await supabase
          .rpc("fn_relatorio_semanal", { p_usuario_id: usuario.id });

        if (errRelatorio) {
          console.error(`Erro relatório ${usuario.id}:`, errRelatorio);
          erros++;
          continue;
        }

        const totais = relatorio?.totais;
        if (!totais || (totais.entradas === 0 && totais.saidas === 0)) {
          console.log(`Usuário ${usuario.id} sem transações, pulando...`);
          continue;
        }

        // 📊 Detectar padrões (4 semanas)
        const patterns = await detectPatterns(usuario.id);

        // 🚨 Detectar anomalias
        const anomalies = await detectAnomalies(usuario.id, relatorio, patterns);

        // 🤖 Gerar relatório consultivo com IA
        const isPro = usuario.plano === "pro";
        let textoRelatorio: string;

        if (isPro) {
          // Pro: relatório completo com padrões + anomalias + consultoria
          textoRelatorio = await gerarRelatorioConsultivo(
            relatorio,
            patterns,
            anomalies,
            usuario.nome || "Usuário"
          );
        } else {
          // Básico/Trial: relatório simples com teaser Pro
          textoRelatorio = await gerarRelatorioConsultivo(
            relatorio,
            { ...patterns, peakDay: null, lowDay: null, weekdayVsWeekend: { weekday: 0, weekend: 0 } },
            [],
            usuario.nome || "Usuário"
          );
          textoRelatorio += "\n\n---\n⭐ _No Plano Pro, seu relatório inclui detector de padrões, radar de anomalias e consultoria personalizada com IA._";
        }

        // Enviar
        const enviou = await sendWhatsApp(usuario.phone_number, textoRelatorio);
        if (enviou) {
          enviados++;

          await supabase
            .from("usuarios")
            .update({
              ultimo_relatorio_semanal: new Date().toISOString(),
              relatorio_semanal_pendente: false
            })
            .eq("id", usuario.id);

          await supabase.from("historico_conversas").insert({
            phone_number: usuario.phone_number,
            user_id: usuario.id,
            user_message: "[CONSULTOR IA SEMANAL]",
            ai_response: textoRelatorio,
            tipo: "relatorio_semanal"
          });

          // Salvar anomalias detectadas para análise futura
          if (anomalies.length > 0 && isPro) {
            for (const anomaly of anomalies) {
              await supabase.from("spending_alerts").insert({
                user_id: usuario.id,
                alert_type: anomaly.type,
                message: anomaly.message,
                severity: anomaly.severity,
                metadata: anomaly.data,
                source: "weekly_consultant",
                status: "sent",
                sent_at: new Date().toISOString(),
              }).catch(() => {}); // Non-critical
            }
          }
        } else {
          erros++;
        }

        // Rate limit protection
        await new Promise(resolve => setTimeout(resolve, 1500));

      } catch (error) {
        console.error(`Erro usuário ${usuario.id}:`, error);
        erros++;
      }
    }

    console.log(`✅ Enviados: ${enviados} | Pendentes: ${pendentes} | Erros: ${erros}`);

    return new Response(
      JSON.stringify({ success: true, enviados, pendentes, erros, total_usuarios: usuarios.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Erro geral:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
