// ============================================================================
// 📅 CICLO FATURA - CRON para Automação de Faturas de Cartão
// ============================================================================
// Executado diariamente para:
// 1. Fechar faturas no dia de fechamento
// 2. Alertar sobre vencimentos próximos (7, 3, 1 dias)
// 3. Marcar faturas atrasadas
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log(`📅 [CICLO-FATURA] Iniciando processamento...`);
    const hoje = new Date();
    const diaHoje = hoje.getDate();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    const results = {
      faturasProcessadas: 0,
      faturasAlertadas: 0,
      erros: [] as string[]
    };

    // ========================================================================
    // 1. FECHAR FATURAS NO DIA DE FECHAMENTO
    // ========================================================================
    console.log(`📅 [CICLO-FATURA] Verificando fechamentos (dia ${diaHoje})...`);

    const { data: cartoesParaFechar } = await supabase
      .from("cartoes_credito")
      .select(`
        id, nome, dia_fechamento, usuario_id,
        usuarios(phone_number, nome)
      `)
      .eq("ativo", true)
      .eq("dia_fechamento", diaHoje);

    for (const cartao of cartoesParaFechar || []) {
      try {
        // Buscar fatura aberta do mês atual
        const { data: faturaAberta } = await supabase
          .from("faturas_cartao")
          .select("*")
          .eq("cartao_id", cartao.id)
          .eq("status", "aberta")
          .eq("mes", mesAtual)
          .eq("ano", anoAtual)
          .maybeSingle();

        if (faturaAberta) {
          // Fechar fatura
          await supabase
            .from("faturas_cartao")
            .update({ 
              status: "fechada",
              updated_at: new Date().toISOString()
            })
            .eq("id", faturaAberta.id);

          console.log(`🔒 [CICLO-FATURA] Fatura fechada: ${cartao.nome} - R$ ${faturaAberta.valor_total}`);

          // Notificar usuário
          const usuario = cartao.usuarios as any;
          if (usuario?.phone_number) {
            await sendNotification(
              usuario.phone_number,
              `🔒 *Fatura fechada!*\n\n` +
              `💳 ${cartao.nome}\n` +
              `💸 Total: R$ ${(faturaAberta.valor_total || 0).toFixed(2)}\n\n` +
              `_Me avisa quando pagar!_`
            );
          }

          results.faturasProcessadas++;
        }

        // Criar fatura do próximo mês (se não existir)
        let proximoMes = mesAtual + 1;
        let proximoAno = anoAtual;
        if (proximoMes > 12) {
          proximoMes = 1;
          proximoAno++;
        }

        const { data: proximaFatura } = await supabase
          .from("faturas_cartao")
          .select("id")
          .eq("cartao_id", cartao.id)
          .eq("mes", proximoMes)
          .eq("ano", proximoAno)
          .maybeSingle();

        if (!proximaFatura) {
          await supabase.from("faturas_cartao").insert({
            usuario_id: cartao.usuario_id,
            cartao_id: cartao.id,
            mes: proximoMes,
            ano: proximoAno,
            valor_total: 0,
            valor_pago: 0,
            status: "aberta"
          });
          console.log(`📄 [CICLO-FATURA] Nova fatura criada: ${cartao.nome} ${proximoMes}/${proximoAno}`);
        }

      } catch (err) {
        console.error(`❌ [CICLO-FATURA] Erro ao processar ${cartao.nome}:`, err);
        results.erros.push(`Cartão ${cartao.nome}: ${err}`);
      }
    }

    // ========================================================================
    // 2. ALERTAR SOBRE VENCIMENTOS PRÓXIMOS
    // ========================================================================
    console.log(`📅 [CICLO-FATURA] Verificando vencimentos...`);

    // Buscar faturas fechadas com vencimento próximo
    const { data: faturasParaAlertar } = await supabase
      .from("faturas_cartao")
      .select(`
        id, mes, ano, valor_total,
        cartoes_credito(id, nome, dia_vencimento, usuario_id,
          usuarios(phone_number, nome)
        )
      `)
      .eq("status", "fechada")
      .gt("valor_total", 0);

    for (const fatura of faturasParaAlertar || []) {
      try {
        const cartao = fatura.cartoes_credito as any;
        if (!cartao?.dia_vencimento) continue;

        // Calcular dias até o vencimento
        const dataVencimento = new Date(fatura.ano, fatura.mes - 1, cartao.dia_vencimento);
        const diasAteVencimento = Math.ceil((dataVencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

        // Alertar em 7, 3 e 1 dias
        if ([7, 3, 1].includes(diasAteVencimento)) {
          const usuario = cartao.usuarios as any;
          if (usuario?.phone_number) {
            const urgencia = diasAteVencimento === 1 ? "🚨" : diasAteVencimento === 3 ? "⚠️" : "📅";
            
            await sendNotification(
              usuario.phone_number,
              `${urgencia} *Fatura vence ${diasAteVencimento === 1 ? "AMANHÃ" : `em ${diasAteVencimento} dias`}!*\n\n` +
              `💳 ${cartao.nome}\n` +
              `💸 R$ ${fatura.valor_total?.toFixed(2)}\n` +
              `📅 Vencimento: dia ${cartao.dia_vencimento}\n\n` +
              `_Quando pagar, me avisa: "paguei a fatura do ${cartao.nome}"_`
            );

            results.faturasAlertadas++;
            console.log(`📬 [CICLO-FATURA] Alerta enviado: ${cartao.nome} (${diasAteVencimento} dias)`);
          }
        }

        // Marcar como atrasada se passou do vencimento
        if (diasAteVencimento < 0) {
          await supabase
            .from("faturas_cartao")
            .update({ status: "atrasada" })
            .eq("id", fatura.id);
          console.log(`⚠️ [CICLO-FATURA] Fatura marcada como atrasada: ${cartao.nome}`);
        }

      } catch (err) {
        console.error(`❌ [CICLO-FATURA] Erro ao alertar fatura:`, err);
      }
    }

    // ========================================================================
    // 3. LOG FINAL
    // ========================================================================
    console.log(`📅 [CICLO-FATURA] Concluído:`);
    console.log(`   Faturas processadas: ${results.faturasProcessadas}`);
    console.log(`   Alertas enviados: ${results.faturasAlertadas}`);
    console.log(`   Erros: ${results.erros.length}`);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`❌ [CICLO-FATURA] Erro fatal:`, error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

// ============================================================================
// 📬 ENVIAR NOTIFICAÇÃO VIA WHATSAPP
// ============================================================================

async function sendNotification(phone: string, message: string): Promise<void> {
  if (!VONAGE_API_KEY || !VONAGE_API_SECRET || !VONAGE_WHATSAPP_NUMBER) {
    console.log(`📬 [NOTIFY] Vonage não configurado - mensagem não enviada`);
    return;
  }

  try {
    const response = await fetch("https://messages-sandbox.nexmo.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`)
      },
      body: JSON.stringify({
        message_type: "text",
        text: message,
        to: phone,
        from: VONAGE_WHATSAPP_NUMBER,
        channel: "whatsapp"
      })
    });

    if (!response.ok) {
      console.error(`📬 [NOTIFY] Erro ao enviar:`, await response.text());
    }
  } catch (err) {
    console.error(`📬 [NOTIFY] Erro:`, err);
  }
}
