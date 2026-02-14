// ============================================================================
// 🔄 CRON: PROCESSAR GASTOS RECORRENTES
// ============================================================================
// Executado diariamente às 7h para registrar gastos recorrentes e notificar

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`⚠️ WhatsApp não configurado. Msg para ${to}: ${text}`);
    return false;
  }
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
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
    return response.ok;
  } catch (error) {
    console.error("[WhatsApp] Erro:", error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("🔄 [RECORRENTES] Iniciando processamento...");

  try {
    // 1. Buscar recorrentes que vencem hoje
    const hoje = new Date();
    const hojeISO = hoje.toISOString().split("T")[0]; // YYYY-MM-DD
    const diaHoje = hoje.getDate();

    const { data: recorrentes, error } = await supabase
      .from("gastos_recorrentes")
      .select(`
        id, descricao, valor_parcela, categoria, tipo_recorrencia,
        dia_mes, proxima_execucao, usuario_id, parcela_atual, num_parcelas,
        usuarios(phone_number, nome)
      `)
      .eq("ativo", true)
      .or(`dia_mes.eq.${diaHoje},proxima_execucao.lte.${hojeISO}`);

    if (error) {
      console.error("❌ Erro ao buscar recorrentes:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!recorrentes || recorrentes.length === 0) {
      console.log("✅ Nenhuma recorrente para processar hoje.");
      return new Response(
        JSON.stringify({ success: true, processados: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 ${recorrentes.length} recorrentes para processar`);

    let processados = 0;
    let notificados = 0;
    let erros = 0;

    for (const rec of recorrentes) {
      try {
        // Verificar se já foi processada hoje (evitar duplicata)
        if (rec.proxima_execucao) {
          const proxDate = new Date(rec.proxima_execucao);
          if (proxDate > hoje) {
            console.log(`⏭️ ${rec.descricao} - próxima execução é futura, pulando`);
            continue;
          }
        }

        // Registrar transação
        const { error: txError } = await supabase.from("transacoes").insert({
          usuario_id: rec.usuario_id,
          valor: rec.valor_parcela,
          tipo: "saida",
          categoria: rec.categoria,
          descricao: rec.descricao,
          data: hoje.toISOString(),
          origem: "recorrente",
          id_recorrente: rec.id,
          recorrente: true,
          status: "confirmada",
          parcela_atual: rec.parcela_atual,
          total_parcelas: rec.num_parcelas,
        });

        if (txError) {
          console.error(`❌ Erro ao registrar ${rec.descricao}:`, txError);
          erros++;
          continue;
        }

        // Atualizar próxima execução
        const proximaExecucao = new Date(hoje);
        if (rec.tipo_recorrencia === "mensal") {
          proximaExecucao.setMonth(proximaExecucao.getMonth() + 1);
        } else if (rec.tipo_recorrencia === "semanal") {
          proximaExecucao.setDate(proximaExecucao.getDate() + 7);
        }

        const updateData: Record<string, any> = {
          ultima_execucao: hoje.toISOString(),
          proxima_execucao: proximaExecucao.toISOString().split("T")[0],
          updated_at: hoje.toISOString(),
        };

        // Atualizar parcela se for parcelamento
        if (rec.num_parcelas && rec.parcela_atual) {
          const novaParcela = rec.parcela_atual + 1;
          updateData.parcela_atual = novaParcela;
          if (novaParcela > rec.num_parcelas) {
            updateData.ativo = false; // Parcelamento concluído
          }
        }

        await supabase
          .from("gastos_recorrentes")
          .update(updateData)
          .eq("id", rec.id);

        processados++;
        console.log(`✅ Processado: ${rec.descricao} - R$ ${rec.valor_parcela}`);

        // Notificar via WhatsApp
        const usuario = rec.usuarios as any;
        if (usuario?.phone_number) {
          const nome = usuario.nome ? usuario.nome.split(" ")[0] : "";
          const saudacao = nome ? `${nome}, ` : "";
          const parcelaInfo =
            rec.num_parcelas && rec.parcela_atual
              ? ` (${rec.parcela_atual}/${rec.num_parcelas})`
              : "";

          const msg =
            `🔄 ${saudacao}registrei automaticamente:\n\n` +
            `💸 *${rec.descricao}${parcelaInfo}*\n` +
            `💰 R$ ${rec.valor_parcela.toFixed(2)}\n` +
            `📂 ${rec.categoria}\n\n` +
            `_Se o valor mudou, me diz: "corrigir ${rec.descricao} para X"_`;

          const sent = await sendWhatsApp(usuario.phone_number, msg);
          if (sent) notificados++;

          // Rate limiting
          await new Promise((r) => setTimeout(r, 500));
        }

        // Log
        await supabase.from("finax_logs").insert({
          user_id: rec.usuario_id,
          action_type: "recorrente_processada",
          entity_type: "gasto_recorrente",
          entity_id: rec.id,
          new_data: {
            descricao: rec.descricao,
            valor: rec.valor_parcela,
          },
        });
      } catch (err) {
        erros++;
        console.error(`❌ Erro ao processar ${rec.descricao}:`, err);
      }
    }

    console.log(
      `🏁 [RECORRENTES] Finalizado: ${processados} processados, ${notificados} notificados, ${erros} erros`
    );

    return new Response(
      JSON.stringify({ success: true, processados, notificados, erros }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Erro geral:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Erro desconhecido",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
