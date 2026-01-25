// ============================================================================
// 🔔 CRON: LEMBRAR CONTAS A PAGAR
// ============================================================================
// Executado diariamente às 9h para lembrar usuários sobre contas próximas

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
// 📤 ENVIAR WHATSAPP
// ============================================================================

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`⚠️ WhatsApp não configurado. Mensagem para ${to}: ${text}`);
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
          text: { body: text }
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
// 🔔 GERAR MENSAGEM DE LEMBRETE
// ============================================================================

function gerarMensagemLembrete(conta: {
  nome: string;
  dia_vencimento: number;
  valor_estimado: number | null;
  dias_ate_vencimento: number;
  usuario_nome: string;
}): string {
  const saudacao = conta.usuario_nome ? `Oi, ${conta.usuario_nome.split(" ")[0]}!` : "Oi!";
  
  let msg = `${saudacao} 📅\n\n`;
  msg += `Sua conta *${conta.nome}* vence `;
  
  if (conta.dias_ate_vencimento === 0) {
    msg += `*hoje* (dia ${conta.dia_vencimento})! ⚠️\n\n`;
  } else if (conta.dias_ate_vencimento === 1) {
    msg += `*amanhã* (dia ${conta.dia_vencimento})!\n\n`;
  } else {
    msg += `em *${conta.dias_ate_vencimento} dias* (dia ${conta.dia_vencimento}).\n\n`;
  }
  
  if (conta.valor_estimado) {
    msg += `💰 Valor estimado: R$ ${conta.valor_estimado.toFixed(2)}\n\n`;
  }
  
  msg += `_Quando pagar, me avisa o valor!_\n`;
  msg += `_Ex: "Paguei ${conta.nome.toLowerCase()}, deu 150"_`;
  
  return msg;
}

// ============================================================================
// 🚀 HANDLER PRINCIPAL
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("🔔 [LEMBRAR-CONTAS] Iniciando verificação...");

  try {
    // Buscar contas que precisam de lembrete
    const { data: contas, error } = await supabase.rpc("fn_contas_para_lembrar");

    if (error) {
      console.error("❌ Erro ao buscar contas:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!contas || contas.length === 0) {
      console.log("✅ Nenhuma conta para lembrar hoje.");
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Nenhuma conta para lembrar",
        lembretes_enviados: 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`📋 ${contas.length} contas para lembrar`);

    let enviados = 0;
    let erros = 0;

    for (const conta of contas) {
      try {
        const mensagem = gerarMensagemLembrete(conta);
        const enviado = await sendWhatsApp(conta.phone_number, mensagem);

        if (enviado) {
          // Marcar lembrete como enviado
          await supabase
            .from("contas_pagar")
            .update({ ultimo_lembrete: new Date().toISOString() })
            .eq("id", conta.conta_id);

          // Log
          await supabase.from("finax_logs").insert({
            user_id: conta.usuario_id,
            action_type: "lembrete_conta",
            entity_type: "conta_pagar",
            entity_id: conta.conta_id,
            new_data: { 
              nome: conta.nome, 
              dias_ate_vencimento: conta.dias_ate_vencimento 
            }
          });

          enviados++;
          console.log(`✅ Lembrete enviado: ${conta.nome} -> ${conta.phone_number}`);
        } else {
          erros++;
          console.log(`⚠️ Falha ao enviar para: ${conta.phone_number}`);
        }
      } catch (err) {
        erros++;
        console.error(`❌ Erro ao processar conta ${conta.nome}:`, err);
      }

      // Delay entre mensagens para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`🏁 Finalizado: ${enviados} enviados, ${erros} erros`);

    return new Response(JSON.stringify({
      success: true,
      total_contas: contas.length,
      lembretes_enviados: enviados,
      erros
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("❌ Erro geral:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Erro desconhecido" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
