import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Vonage credentials
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Vonage Sandbox endpoint
const VONAGE_SANDBOX_URL = "https://messages-sandbox.nexmo.com/v1/messages";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Extrai entidades financeiras da mensagem usando AI
async function extractFinancialEntities(message: string): Promise<{
  valor?: number;
  categoria?: string;
  tipo?: "entrada" | "saida";
  descricao?: string;
}> {
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
            content: `Você é um extrator de entidades financeiras. Analise a mensagem e extraia:
- valor: número (ex: 150.50)
- categoria: string (alimentação, transporte, lazer, moradia, saúde, educação, salário, freelance, investimentos, outros)
- tipo: "entrada" ou "saida"
- descricao: breve descrição da transação

Responda APENAS com JSON válido. Se não encontrar transação, retorne {}.
Exemplos:
"gastei 50 reais no mercado" -> {"valor": 50, "categoria": "alimentação", "tipo": "saida", "descricao": "mercado"}
"recebi 3000 de salário" -> {"valor": 3000, "categoria": "salário", "tipo": "entrada", "descricao": "salário"}
"oi" -> {}`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    // Limpa o JSON de possíveis markdown
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Erro ao extrair entidades:", error);
    return {};
  }
}

// Gera resposta conversacional
async function generateResponse(userMessage: string, context: string): Promise<string> {
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
            content: `Você é o FinBot, um assistente financeiro pessoal amigável via WhatsApp.
${context}
Seja breve, use emojis ocasionalmente, e seja útil. Responda em português brasileiro.`
          },
          { role: "user", content: userMessage }
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";
  } catch (error) {
    console.error("Erro ao gerar resposta:", error);
    return "Ops! Tive um probleminha. Tente novamente em alguns segundos. 🔄";
  }
}

// Envia mensagem via Vonage WhatsApp (Sandbox)
async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  try {
    // Remove o prefixo "whatsapp:" se existir (formato Twilio antigo)
    const cleanNumber = to.replace("whatsapp:", "");
    
    const credentials = btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`);
    
    const response = await fetch(VONAGE_SANDBOX_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        from: VONAGE_WHATSAPP_NUMBER,
        to: cleanNumber,
        message_type: "text",
        text: text,
        channel: "whatsapp"
      }),
    });

    const result = await response.json();
    console.log("Vonage response:", JSON.stringify(result));
    
    if (!response.ok) {
      console.error("Vonage error:", result);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("Erro ao enviar WhatsApp via Vonage:", error);
    return false;
  }
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Vonage envia como JSON (diferente do Twilio que usava form-urlencoded)
    const contentType = req.headers.get("content-type") || "";
    let from = "";
    let body = "";
    
    if (contentType.includes("application/json")) {
      // Formato Vonage (JSON)
      const json = await req.json();
      console.log("Vonage webhook payload:", JSON.stringify(json));
      
      // Vonage Messages API format
      from = json.from?.number || json.from || "";
      body = json.text || json.message?.content?.text || "";
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      // Formato Twilio legado (form-urlencoded) - mantido para compatibilidade
      const formData = await req.formData();
      from = (formData.get("From") as string)?.replace("whatsapp:", "") || "";
      body = formData.get("Body") as string || "";
    }

    const phoneNumber = from;

    console.log(`Mensagem recebida de ${phoneNumber}: ${body}`);

    if (!phoneNumber || !body) {
      console.log("Webhook de status ou mensagem vazia - ignorando");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Busca ou cria usuário
    let { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("phone_number", phoneNumber)
      .single();

    if (!usuario) {
      const { data: newUser } = await supabase
        .from("usuarios")
        .insert({ phone_number: phoneNumber })
        .select()
        .single();
      usuario = newUser;
    }

    // 2. Extrai entidades financeiras
    const entities = await extractFinancialEntities(body);
    let context = "";

    // 3. Se encontrou transação, salva no banco
    if (entities.valor && entities.tipo) {
      const { error } = await supabase.from("transacoes").insert({
        usuario_id: usuario?.id,
        valor: entities.valor,
        categoria: entities.categoria || "outros",
        tipo: entities.tipo,
        observacao: entities.descricao,
        data: new Date().toISOString().split("T")[0],
      });

      if (!error) {
        context = `Transação registrada: ${entities.tipo === "entrada" ? "+" : "-"}R$ ${entities.valor.toFixed(2)} em ${entities.categoria}.`;
      }
    }

    // 4. Busca resumo financeiro para contexto
    const { data: transacoes } = await supabase
      .from("transacoes")
      .select("valor, tipo")
      .eq("usuario_id", usuario?.id)
      .gte("data", new Date(new Date().setDate(1)).toISOString().split("T")[0]);

    let totalEntradas = 0;
    let totalSaidas = 0;
    transacoes?.forEach((t) => {
      if (t.tipo === "entrada") totalEntradas += Number(t.valor);
      else totalSaidas += Number(t.valor);
    });

    context += ` Resumo do mês: Entradas R$ ${totalEntradas.toFixed(2)}, Saídas R$ ${totalSaidas.toFixed(2)}, Saldo R$ ${(totalEntradas - totalSaidas).toFixed(2)}.`;

    // 5. Gera resposta com AI
    const aiResponse = await generateResponse(body, context);

    // 6. Salva histórico
    await supabase.from("historico_conversas").insert({
      phone_number: phoneNumber,
      user_message: body,
      ai_response: aiResponse,
    });

    // 7. Envia resposta via WhatsApp (Vonage)
    await sendWhatsAppMessage(phoneNumber, aiResponse);

    // Vonage espera JSON 200 OK (diferente do Twilio que esperava TwiML/XML)
    return new Response(
      JSON.stringify({ status: "ok", message_sent: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 200, // Vonage espera 200 mesmo em erros para não reenviar
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
