// ============================================================================
// 📱 WHATSAPP SENDER - Extraído de index.ts para modularização
// ============================================================================
// Envio de mensagens, botões e listas via WhatsApp (Meta + Vonage).
// ============================================================================

type MessageSource = "meta" | "vonage";

const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

// ============================================================================
// 📤 ENVIO DE MENSAGENS DE TEXTO
// ============================================================================

async function sendWhatsAppMeta(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: cleanNumber, type: "text", text: { body: text } }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Meta] Erro:", error);
    return false;
  }
}

async function sendWhatsAppVonage(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch("https://messages-sandbox.nexmo.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`)}` },
      body: JSON.stringify({ from: VONAGE_WHATSAPP_NUMBER, to: cleanNumber, message_type: "text", text: text, channel: "whatsapp" }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Vonage] Erro:", error);
    return false;
  }
}

export async function sendMessage(to: string, text: string, source: MessageSource): Promise<boolean> {
  if (source === "vonage") return sendWhatsAppVonage(to, text);
  return sendWhatsAppMeta(to, text);
}

// ============================================================================
// 🔘 ENVIO DE BOTÕES INTERATIVOS
// ============================================================================

export async function sendButtons(to: string, bodyText: string, buttons: Array<{ id: string; title: string }>, source: MessageSource): Promise<boolean> {
  if (source !== "meta") {
    const fallbackText = bodyText + "\n\n" + buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    return sendMessage(to, fallbackText, source);
  }

  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: { buttons: buttons.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) }
        }
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Meta Buttons] Erro:", error);
    return sendMessage(to, bodyText, source);
  }
}

// ============================================================================
// 📋 ENVIO DE LISTA INTERATIVA (4+ opções)
// ============================================================================

export async function sendListMessage(
  to: string, 
  bodyText: string, 
  buttonText: string,
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
  source: MessageSource
): Promise<boolean> {
  if (source !== "meta") {
    const fallbackRows = sections.flatMap(s => s.rows);
    const fallbackText = bodyText + "\n\n" + fallbackRows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` - ${r.description}` : ""}`).join("\n");
    return sendMessage(to, fallbackText, source);
  }

  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: {
            button: buttonText.slice(0, 20),
            sections: sections.map(s => ({
              title: s.title.slice(0, 24),
              rows: s.rows.map(r => ({
                id: r.id.slice(0, 200),
                title: r.title.slice(0, 24),
                description: r.description?.slice(0, 72) || undefined
              }))
            }))
          }
        }
      }),
    });
    
    if (!response.ok) {
      console.error(`📋 [LIST] Erro:`, await response.text());
      const fallbackRows = sections.flatMap(s => s.rows);
      const fallbackText = bodyText + "\n\n" + fallbackRows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` - ${r.description}` : ""}`).join("\n");
      return sendMessage(to, fallbackText, source);
    }
    
    console.log(`📋 [LIST] Lista enviada para ${cleanNumber}`);
    return true;
  } catch (error) {
    console.error("[Meta List] Erro:", error);
    const fallbackRows = sections.flatMap(s => s.rows);
    const fallbackText = bodyText + "\n\n" + fallbackRows.map((r, i) => `${i + 1}. ${r.title}`).join("\n");
    return sendMessage(to, fallbackText, source);
  }
}
