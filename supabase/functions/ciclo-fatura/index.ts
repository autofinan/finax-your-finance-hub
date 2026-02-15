// ============================================================================
// 📅 CICLO FATURA - CRON para Automação de Faturas de Cartão
// ============================================================================
// Executado diariamente para:
// 1. Fechar faturas no dia de fechamento
// 2. Alertar sobre vencimentos próximos (3 e 1 dias)
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
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📤 ENVIAR WHATSAPP (Meta API - texto simples)
// ============================================================================

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`⚠️ WhatsApp não configurado`);
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
    if (!response.ok) {
      console.error(`📬 [NOTIFY] Erro:`, await response.text());
    }
    return response.ok;
  } catch (err) {
    console.error(`📬 [NOTIFY] Erro:`, err);
    return false;
  }
}

// ============================================================================
// 📤 ENVIAR WHATSAPP COM BOTÕES INTERATIVOS (Meta API)
// ============================================================================

async function sendWhatsAppButtons(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
): Promise<boolean> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`⚠️ WhatsApp não configurado`);
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
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: bodyText },
            action: {
              buttons: buttons.slice(0, 3).map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.title.slice(0, 20) },
              })),
            },
          },
        }),
      }
    );
    if (!response.ok) {
      console.error(`📬 [BUTTONS] Erro:`, await response.text());
      // Fallback to text
      return sendWhatsApp(to, bodyText + "\n\n" + buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n"));
    }
    return true;
  } catch (err) {
    console.error(`📬 [BUTTONS] Erro:`, err);
    return sendWhatsApp(to, bodyText);
  }
}

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
      erros: [] as string[],
    };

    // ========================================================================
    // 1. FECHAR FATURAS NO DIA DE FECHAMENTO
    // ========================================================================
    console.log(`📅 [CICLO-FATURA] Verificando fechamentos (dia ${diaHoje})...`);

    const { data: cartoesParaFechar } = await supabase
      .from("cartoes_credito")
      .select(`id, nome, dia_fechamento, usuario_id, usuarios(phone_number, nome)`)
      .eq("ativo", true)
      .eq("dia_fechamento", diaHoje);

    for (const cartao of cartoesParaFechar || []) {
      try {
        const { data: faturaAberta } = await supabase
          .from("faturas_cartao")
          .select("*")
          .eq("cartao_id", cartao.id)
          .eq("status", "aberta")
          .eq("mes", mesAtual)
          .eq("ano", anoAtual)
          .maybeSingle();

        if (faturaAberta) {
          await supabase
            .from("faturas_cartao")
            .update({ status: "fechada", updated_at: new Date().toISOString() })
            .eq("id", faturaAberta.id);

          console.log(`🔒 [CICLO-FATURA] Fatura fechada: ${cartao.nome} - R$ ${faturaAberta.valor_total}`);

          const usuario = cartao.usuarios as any;
          if (usuario?.phone_number) {
            await sendWhatsApp(
              usuario.phone_number,
              `🔒 *Fatura fechada!*\n\n` +
                `💳 ${cartao.nome}\n` +
                `💸 Total: R$ ${(faturaAberta.valor_total || 0).toFixed(2)}\n\n` +
                `_Me avisa quando pagar!_`
            );
          }
          results.faturasProcessadas++;
        }

        // Criar fatura do próximo mês
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
            status: "aberta",
          });
          console.log(`📄 [CICLO-FATURA] Nova fatura criada: ${cartao.nome} ${proximoMes}/${proximoAno}`);
        }
      } catch (err) {
        console.error(`❌ [CICLO-FATURA] Erro ao processar ${cartao.nome}:`, err);
        results.erros.push(`Cartão ${cartao.nome}: ${err}`);
      }
    }

    // ========================================================================
    // 2. ALERTAR SOBRE VENCIMENTOS PRÓXIMOS (3 e 1 dias) COM BOTÕES
    // ========================================================================
    console.log(`📅 [CICLO-FATURA] Verificando vencimentos...`);

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

        const dataVencimento = new Date(fatura.ano!, fatura.mes! - 1, cartao.dia_vencimento);
        const diasAteVencimento = Math.ceil(
          (dataVencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Alertar em 3 e 1 dias com botões interativos
        if ([3, 1].includes(diasAteVencimento)) {
          const usuario = cartao.usuarios as any;
          if (usuario?.phone_number) {
            const urgencia = diasAteVencimento === 1 ? "🚨" : "⚠️";
            const prazo = diasAteVencimento === 1 ? "AMANHÃ" : `em ${diasAteVencimento} dias`;

            await sendWhatsAppButtons(
              usuario.phone_number,
              `${urgencia} *Fatura vence ${prazo}!*\n\n` +
                `💳 ${cartao.nome}\n` +
                `💸 R$ ${fatura.valor_total?.toFixed(2)}\n` +
                `📅 Vencimento: dia ${cartao.dia_vencimento}`,
              [
                { id: `fatura_pagar_${fatura.id}`, title: "💰 Paguei!" },
                { id: `fatura_lembrar_${fatura.id}`, title: "📅 Lembrar depois" },
              ]
            );

            results.faturasAlertadas++;
            console.log(`📬 [CICLO-FATURA] Alerta enviado: ${cartao.nome} (${diasAteVencimento} dias)`);

            // Atualizar conversation_context
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            await supabase.from("conversation_context").upsert({
              user_id: cartao.usuario_id,
              current_topic: "pay_bill",
              last_intent: "pay_bill",
              last_card_name: cartao.nome,
              last_interaction_at: new Date().toISOString(),
              expires_at: expiresAt
            }, { onConflict: "user_id" });
          }
        }

        // Alertar no dia do vencimento (dia 0)
        if (diasAteVencimento === 0) {
          const usuario = cartao.usuarios as any;
          if (usuario?.phone_number) {
            await sendWhatsAppButtons(
              usuario.phone_number,
              `🚨 *Fatura vence HOJE!*\n\n` +
                `💳 ${cartao.nome}\n` +
                `💸 R$ ${fatura.valor_total?.toFixed(2)}`,
              [
                { id: `fatura_pagar_${fatura.id}`, title: "💰 Paguei!" },
              ]
            );
            results.faturasAlertadas++;

            // Atualizar conversation_context (vencimento hoje)
            const expiresAt2 = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            await supabase.from("conversation_context").upsert({
              user_id: cartao.usuario_id,
              current_topic: "pay_bill",
              last_intent: "pay_bill",
              last_card_name: cartao.nome,
              last_interaction_at: new Date().toISOString(),
              expires_at: expiresAt2
            }, { onConflict: "user_id" });
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`❌ [CICLO-FATURA] Erro fatal:`, error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
