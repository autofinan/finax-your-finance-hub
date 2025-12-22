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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Envia mensagem via WhatsApp Business API
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

// Gera texto do relatório usando IA
async function gerarTextoRelatorio(dados: any): Promise<string> {
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
Sua tarefa é escrever um RELATÓRIO SEMANAL amigável e consultivo.

REGRAS ABSOLUTAS:
🚫 NUNCA calcule valores - todos os números já estão calculados
🚫 NUNCA invente dados - use APENAS o que foi fornecido
🚫 NUNCA faça afirmações absolutas sobre o futuro
✅ Interprete os dados e escreva de forma amigável
✅ Use emojis com moderação (2-3 no máximo)
✅ Mensagens curtas e escaneáveis
✅ Dê 1 sugestão prática simples no final
✅ Linguagem simples para público geral

FORMATO DO RELATÓRIO:
1. Título com período
2. Resumo dos totais (entradas, saídas, saldo)
3. Destaque sobre variação em relação à semana anterior
4. Categorias mais usadas (se houver)
5. Uma dica prática curta

Responda APENAS em português brasileiro.`
          },
          {
            role: "user",
            content: `Gere o relatório semanal com estes dados PRÉ-CALCULADOS (não recalcule):

${JSON.stringify(dados, null, 2)}

Escreva o relatório de forma amigável e consultiva.`
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("📊 Iniciando envio de relatórios semanais...");

    // Busca todos os usuários ativos com plano válido
    const { data: usuarios, error: errUsuarios } = await supabase
      .from("usuarios")
      .select("id, phone_number, nome, plano")
      .eq("ativo", true)
      .in("plano", ["trial", "pro"]);

    if (errUsuarios) {
      console.error("Erro ao buscar usuários:", errUsuarios);
      return new Response(
        JSON.stringify({ error: "Erro ao buscar usuários" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!usuarios || usuarios.length === 0) {
      console.log("Nenhum usuário ativo encontrado");
      return new Response(
        JSON.stringify({ message: "Nenhum usuário para enviar relatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 ${usuarios.length} usuários encontrados`);

    let enviados = 0;
    let erros = 0;

    for (const usuario of usuarios) {
      try {
        // Chama a função SQL para calcular dados do relatório
        const { data: relatorio, error: errRelatorio } = await supabase
          .rpc("fn_relatorio_semanal", { p_usuario_id: usuario.id });

        if (errRelatorio) {
          console.error(`Erro ao gerar relatório para ${usuario.id}:`, errRelatorio);
          erros++;
          continue;
        }

        // Verifica se tem dados
        const totais = relatorio?.totais;
        if (!totais || (totais.entradas === 0 && totais.saidas === 0)) {
          console.log(`Usuário ${usuario.id} sem transações na semana, pulando...`);
          continue;
        }

        // Gera texto do relatório com IA
        const textoRelatorio = await gerarTextoRelatorio({
          nome_usuario: usuario.nome || "Usuário",
          ...relatorio
        });

        // Envia via WhatsApp
        const enviou = await sendWhatsApp(usuario.phone_number, textoRelatorio);

        if (enviou) {
          enviados++;

          // Atualiza timestamp do último relatório
          await supabase
            .from("usuarios")
            .update({ ultimo_relatorio_semanal: new Date().toISOString() })
            .eq("id", usuario.id);

          // Salva no histórico
          await supabase.from("historico_conversas").insert({
            phone_number: usuario.phone_number,
            user_id: usuario.id,
            user_message: "[RELATÓRIO SEMANAL AUTOMÁTICO]",
            ai_response: textoRelatorio,
            tipo: "relatorio_semanal"
          });
        } else {
          erros++;
        }

        // Delay entre envios para evitar rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Erro ao processar usuário ${usuario.id}:`, error);
        erros++;
      }
    }

    console.log(`✅ Relatórios enviados: ${enviados}, Erros: ${erros}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        enviados, 
        erros,
        total_usuarios: usuarios.length 
      }),
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
