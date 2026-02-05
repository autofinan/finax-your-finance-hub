// ============================================================================
// 📤 FINAX-INSIGHTS - ENVIAR ALERTAS PROATIVOS VIA WHATSAPP
// ============================================================================
// Edge function que busca alertas com status="detected" e envia via WhatsApp.
// Executada via CRON diariamente às 19h (horário de Brasília).
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
// 📱 ENVIAR MENSAGEM WHATSAPP (Meta API)
// ============================================================================

async function sendWhatsAppMessage(phoneNumber: string, message: string): Promise<boolean> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error("❌ [INSIGHTS] Credenciais WhatsApp não configuradas");
    return false;
  }

  try {
    // Normalizar número (remover caracteres não numéricos)
    const normalizedPhone = phoneNumber.replace(/\D/g, "");
    
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
          to: normalizedPhone,
          type: "text",
          text: { body: message },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ [INSIGHTS] Erro ao enviar WhatsApp: ${error}`);
      return false;
    }

    console.log(`✅ [INSIGHTS] Mensagem enviada para ${normalizedPhone}`);
    return true;
  } catch (error) {
    console.error(`❌ [INSIGHTS] Erro ao enviar WhatsApp:`, error);
    return false;
  }
}

// ============================================================================
// 📊 BUSCAR E ENVIAR ALERTAS
// ============================================================================

interface AlertFromDB {
  id: string;
  user_id: string;
  alert_type: string;
  message: string;
  severity: string;
  utility_score: number;
  usuarios: {
    telefone: string;
    nome: string;
  };
}

async function processAlerts(): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // Buscar alertas pendentes com dados do usuário
  const { data: alerts, error } = await supabase
    .from("spending_alerts")
    .select(`
      id,
      user_id,
      alert_type,
      message,
      severity,
      utility_score,
      usuarios!inner(telefone, nome)
    `)
    .eq("status", "detected")
    .order("utility_score", { ascending: false })
    .limit(100);

  if (error) {
    console.error("❌ [INSIGHTS] Erro ao buscar alertas:", error);
    return { sent: 0, failed: 0, skipped: 0 };
  }

  console.log(`📊 [INSIGHTS] ${alerts?.length || 0} alertas pendentes encontrados`);

  for (const alertRaw of alerts || []) {
    // Cast seguro - Supabase retorna o objeto com a estrutura correta
    const alert = alertRaw as unknown as AlertFromDB;
    
    // Verificar se usuário tem telefone
    const telefone = alert.usuarios?.telefone;
    if (!telefone) {
      console.log(`⏭️ [INSIGHTS] Usuário sem telefone: ${alert.user_id.slice(0, 8)}`);
      skipped++;
      continue;
    }

    // Formatar mensagem com emoji baseado na severidade
    const severityEmoji = 
      alert.severity === "critical" ? "🚨" :
      alert.severity === "warning" ? "⚠️" : "💡";
    
    const formattedMessage = `${severityEmoji} *Insight Finax*\n\n${alert.message}\n\n_Responda "desativar alertas" se não quiser mais receber._`;

    // Tentar enviar
    const success = await sendWhatsAppMessage(telefone, formattedMessage);

    if (success) {
      // Atualizar status para "sent"
      await supabase
        .from("spending_alerts")
        .update({ 
          status: "sent", 
          sent_at: new Date().toISOString() 
        })
        .eq("id", alert.id);
      
      sent++;
      console.log(`✅ [INSIGHTS] Alerta ${alert.alert_type} enviado para ${alert.usuarios?.nome || "usuário"}`);
    } else {
      // Marcar como falha (mas não bloquear re-tentativa futura)
      await supabase
        .from("spending_alerts")
        .update({ 
          status: "failed",
          trigger_data: { 
            ...alert, 
            last_error: "WhatsApp send failed",
            failed_at: new Date().toISOString()
          }
        })
        .eq("id", alert.id);
      
      failed++;
    }

    // Rate limiting básico (evitar spam)
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return { sent, failed, skipped };
}

// ============================================================================
// 🚀 HANDLER PRINCIPAL
// ============================================================================

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("📤 FINAX-INSIGHTS - ENVIANDO ALERTAS PROATIVOS");
  console.log(`📅 ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  console.log("═══════════════════════════════════════════════════════════════");

  try {
    const result = await processAlerts();

    // Registrar métricas
    await supabase.from("finax_logs").insert({
      action_type: "insights_sent",
      entity_type: "system",
      new_data: {
        alerts_sent: result.sent,
        alerts_failed: result.failed,
        alerts_skipped: result.skipped,
        run_at: new Date().toISOString()
      }
    });

    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`✅ CONCLUÍDO: ${result.sent} enviados, ${result.failed} falharam, ${result.skipped} pulados`);
    console.log("═══════════════════════════════════════════════════════════════");

    return new Response(
      JSON.stringify({
        success: true,
        alertsSent: result.sent,
        alertsFailed: result.failed,
        alertsSkipped: result.skipped,
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    );
  } catch (error: unknown) {
    console.error("❌ [INSIGHTS] Erro:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500
      }
    );
  }
});
