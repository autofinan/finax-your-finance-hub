// ============================================================================
// 📊 REPORTS HANDLER - Extraído de index.ts para modularização
// ============================================================================
// checkAndSendPendingReport e gerarTextoRelatorioInline
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type MessageSource = "meta" | "vonage";

// ============================================================================
// 📊 GERAR TEXTO DO RELATÓRIO COM IA
// ============================================================================

export async function gerarTextoRelatorioInline(dados: any, nomeUsuario: string | null): Promise<string> {
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
// 📊 GERAR RELATÓRIO MENSAL COM IA
// ============================================================================

export async function gerarRelatorioMensalIA(dados: any, nomeUsuario: string | null): Promise<string> {
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
            content: `Você é o Finax, assistente financeiro via WhatsApp.
Escreva um RELATÓRIO MENSAL analítico e amigável.

REGRAS:
- Use APENAS os números fornecidos, não invente dados
- Máximo 15 linhas
- Comece com "📊 *Relatório Mensal*"
- Mostre: Entradas, Saídas, Saldo
- Analise as top 3 categorias de gasto
- Dê 1-2 dicas práticas baseadas nos dados reais
- Use 3-4 emojis relevantes
- Português brasileiro informal
- Valores em formato R$ X.XXX,XX`
          },
          {
            role: "user",
            content: `Relatório mensal para ${nomeUsuario || "Usuário"}:\n${JSON.stringify(dados, null, 2)}`
          }
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "📊 Não foi possível gerar o relatório mensal.";
  } catch (error) {
    console.error("Erro ao gerar relatório mensal IA:", error);
    return "📊 Erro ao gerar relatório mensal.";
  }
}

// ============================================================================
// 📊 VERIFICAR E ENVIAR RELATÓRIOS PENDENTES
// ============================================================================

export async function checkAndSendPendingReport(
  userId: string, 
  phoneNumber: string, 
  source: MessageSource,
  sendMessageFn: (to: string, text: string, src: MessageSource) => Promise<boolean>
): Promise<void> {
  try {
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("relatorio_semanal_pendente, relatorio_mensal_pendente, nome")
      .eq("id", userId)
      .single();
    
    if (!usuario) return;
    
    if (usuario.relatorio_semanal_pendente) {
      console.log(`📊 [REPORT] Relatório semanal pendente para ${userId} - enviando...`);
      
      const { data: relatorio } = await supabase.rpc("fn_relatorio_semanal", { 
        p_usuario_id: userId 
      });
      
      if (relatorio && relatorio.totais && (relatorio.totais.entradas > 0 || relatorio.totais.saidas > 0)) {
        const textoRelatorio = await gerarTextoRelatorioInline(relatorio, usuario.nome);
        
        await sendMessageFn(phoneNumber, textoRelatorio, source);
        
        await supabase.from("usuarios")
          .update({ 
            relatorio_semanal_pendente: false,
            ultimo_relatorio_semanal: new Date().toISOString()
          })
          .eq("id", userId);
        
        await supabase.from("historico_conversas").insert({
          phone_number: phoneNumber,
          user_id: userId,
          user_message: "[RELATÓRIO PENDENTE - ENVIADO]",
          ai_response: textoRelatorio,
          tipo: "relatorio_semanal"
        });
        
        console.log(`✅ [REPORT] Relatório semanal enviado para ${userId}`);
      } else {
        await supabase.from("usuarios")
          .update({ relatorio_semanal_pendente: false })
          .eq("id", userId);
      }
    }
  } catch (error) {
    console.error("❌ [REPORT] Erro ao verificar relatórios pendentes:", error);
  }
}
