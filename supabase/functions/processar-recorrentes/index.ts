// ============================================================================
// 🔄 CRON: PROCESSAR GASTOS RECORRENTES + PARCELAS FUTURAS
// ============================================================================
// Executado diariamente às 7h para registrar gastos recorrentes e notificar
// CORRIGIDO: Deduplicação por mês, timezone Brasília, processamento de parcelas

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

// ============================================================================
// 🕐 HELPER: Data de Brasília (UTC-3)
// ============================================================================
function getBrasiliaDate(): Date {
  const now = new Date();
  const brasiliaOffset = -3 * 60; // UTC-3 in minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + brasiliaOffset * 60000);
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ============================================================================
// 📲 WHATSAPP
// ============================================================================
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

// ============================================================================
// 🔄 PROCESSAR RECORRENTES
// ============================================================================
async function processarRecorrentes(hoje: Date, hojeISO: string, diaHoje: number) {
  const mesAtual = hoje.getMonth(); // 0-indexed
  const anoAtual = hoje.getFullYear();

  const { data: recorrentes, error } = await supabase
    .from("gastos_recorrentes")
    .select(`
      id, descricao, valor_parcela, categoria, tipo_recorrencia,
      dia_mes, proxima_execucao, ultima_execucao, usuario_id, parcela_atual, num_parcelas,
      usuarios(phone_number, nome)
    `)
    .eq("ativo", true);

  if (error) {
    console.error("❌ Erro ao buscar recorrentes:", error);
    return { processados: 0, notificados: 0, erros: 0 };
  }

  if (!recorrentes || recorrentes.length === 0) {
    console.log("✅ Nenhuma recorrente ativa encontrada.");
    return { processados: 0, notificados: 0, erros: 0 };
  }

  let processados = 0;
  let notificados = 0;
  let erros = 0;

  for (const rec of recorrentes) {
    try {
      // =====================================================================
      // 🛡️ GUARD: Deduplicação por mês - se já processou NESTE mês, pular
      // =====================================================================
      if (rec.ultima_execucao) {
        const lastExec = new Date(rec.ultima_execucao);
        if (lastExec.getMonth() === mesAtual && lastExec.getFullYear() === anoAtual) {
          console.log(`⏭️ ${rec.descricao} - já processado este mês (${rec.ultima_execucao}), pulando`);
          continue;
        }
      }

      // =====================================================================
      // 📅 Verificar se deve processar hoje
      // =====================================================================
      let deveProcessar = false;

      if (rec.proxima_execucao) {
        // Se tem proxima_execucao, usar como referência principal
        deveProcessar = rec.proxima_execucao <= hojeISO;
      } else if (rec.dia_mes && rec.dia_mes === diaHoje) {
        // Fallback: dia_mes bate com hoje
        deveProcessar = true;
      }

      if (!deveProcessar) {
        continue;
      }

      // Registrar transação
      const { error: txError } = await supabase.from("transacoes").insert({
        usuario_id: rec.usuario_id,
        valor: rec.valor_parcela,
        tipo: "saida",
        categoria: rec.categoria,
        descricao: rec.descricao,
        data: new Date().toISOString(),
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

      // Calcular próxima execução usando Brasília
      const proximaExecucao = new Date(hoje);
      if (rec.tipo_recorrencia === "mensal") {
        proximaExecucao.setMonth(proximaExecucao.getMonth() + 1);
        if (rec.dia_mes) {
          proximaExecucao.setDate(rec.dia_mes);
        }
      } else if (rec.tipo_recorrencia === "semanal") {
        proximaExecucao.setDate(proximaExecucao.getDate() + 7);
      }

      const updateData: Record<string, any> = {
        ultima_execucao: hojeISO,
        proxima_execucao: formatDateISO(proximaExecucao),
        updated_at: new Date().toISOString(),
      };

      // Atualizar parcela se for parcelamento
      if (rec.num_parcelas && rec.parcela_atual) {
        const novaParcela = rec.parcela_atual + 1;
        updateData.parcela_atual = novaParcela;
        if (novaParcela > rec.num_parcelas) {
          updateData.ativo = false;
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
        await new Promise((r) => setTimeout(r, 500));
      }

      // Log
      await supabase.from("finax_logs").insert({
        user_id: rec.usuario_id,
        action_type: "recorrente_processada",
        entity_type: "gasto_recorrente",
        entity_id: rec.id,
        new_data: { descricao: rec.descricao, valor: rec.valor_parcela },
      });
    } catch (err) {
      erros++;
      console.error(`❌ Erro ao processar ${rec.descricao}:`, err);
    }
  }

  return { processados, notificados, erros };
}

// ============================================================================
// 📦 PROCESSAR PARCELAS FUTURAS DO MÊS ATUAL
// ============================================================================
async function processarParcelasFuturas(hoje: Date) {
  const mesAtual = hoje.getMonth() + 1; // 1-indexed
  const anoAtual = hoje.getFullYear();
  const mesRef = `${anoAtual}-${String(mesAtual).padStart(2, "0")}-01`;

  console.log(`📦 [PARCELAS] Buscando parcelas futuras para ${mesAtual}/${anoAtual}...`);

  const { data: parcelas, error } = await supabase
    .from("parcelas")
    .select(`
      id, parcelamento_id, usuario_id, numero_parcela, total_parcelas,
      valor, fatura_id, cartao_id, status, mes_referencia, descricao
    `)
    .eq("status", "futura")
    .eq("mes_referencia", mesRef);

  if (error) {
    console.error("❌ Erro ao buscar parcelas futuras:", error);
    return { parcelas_processadas: 0 };
  }

  if (!parcelas || parcelas.length === 0) {
    console.log("✅ Nenhuma parcela futura para processar este mês.");
    return { parcelas_processadas: 0 };
  }

  console.log(`📦 ${parcelas.length} parcelas futuras encontradas`);
  let processadas = 0;

  for (const parcela of parcelas) {
    try {
      // Criar transação para esta parcela
      const { error: txError } = await supabase.from("transacoes").insert({
        usuario_id: parcela.usuario_id,
        valor: parcela.valor,
        tipo: "saida",
        categoria: "outros",
        descricao: `${parcela.descricao || "Parcelado"} (${parcela.numero_parcela}/${parcela.total_parcelas})`,
        data: new Date().toISOString(),
        origem: "parcelamento",
        forma_pagamento: "credito",
        status: "confirmada",
        id_cartao: parcela.cartao_id,
        parcela: `${parcela.numero_parcela}/${parcela.total_parcelas}`,
        is_parcelado: true,
        total_parcelas: parcela.total_parcelas,
      });

      if (txError) {
        console.error(`❌ Erro ao criar transação para parcela ${parcela.id}:`, txError);
        continue;
      }

      // Atualizar status da parcela
      await supabase
        .from("parcelas")
        .update({ status: "pendente" })
        .eq("id", parcela.id);

      // Atualizar parcela_atual no parcelamentos (se existir)
      await supabase
        .from("parcelamentos")
        .update({ parcela_atual: parcela.numero_parcela })
        .eq("id", parcela.parcelamento_id);

      processadas++;
      console.log(`✅ Parcela ${parcela.numero_parcela}/${parcela.total_parcelas} de "${parcela.descricao}" processada`);
    } catch (err) {
      console.error(`❌ Erro ao processar parcela ${parcela.id}:`, err);
    }
  }

  return { parcelas_processadas: processadas };
}

// ============================================================================
// 🚀 SERVE
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("🔄 [RECORRENTES] Iniciando processamento...");

  try {
    const hoje = getBrasiliaDate();
    const hojeISO = formatDateISO(hoje);
    const diaHoje = hoje.getDate();

    console.log(`📅 Data Brasília: ${hojeISO} (dia ${diaHoje})`);

    // 1. Processar recorrentes
    const recResult = await processarRecorrentes(hoje, hojeISO, diaHoje);

    // 2. Processar parcelas futuras do mês
    const parcResult = await processarParcelasFuturas(hoje);

    console.log(
      `🏁 [RECORRENTES] Finalizado: ${recResult.processados} recorrentes, ${recResult.notificados} notificados, ${recResult.erros} erros, ${parcResult.parcelas_processadas} parcelas`
    );

    return new Response(
      JSON.stringify({
        success: true,
        ...recResult,
        parcelas_processadas: parcResult.parcelas_processadas,
      }),
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
