// ============================================================================
// 📱 UI: MENSAGENS E BOTÕES
// ============================================================================

import { MessageSource } from "../decision/types.ts";

const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const VONAGE_API_KEY = Deno.env.get("VONAGE_API_KEY");
const VONAGE_API_SECRET = Deno.env.get("VONAGE_API_SECRET");
const VONAGE_WHATSAPP_NUMBER = Deno.env.get("VONAGE_WHATSAPP_NUMBER");

// ============================================================================
// 📤 ENVIO DE MENSAGENS
// ============================================================================

async function sendWhatsAppMeta(to: string, text: string): Promise<boolean> {
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
    console.error("[Meta] Erro:", error);
    return false;
  }
}

async function sendWhatsAppVonage(to: string, text: string): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");
    const response = await fetch("https://messages-sandbox.nexmo.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${btoa(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`)}`,
      },
      body: JSON.stringify({
        from: VONAGE_WHATSAPP_NUMBER,
        to: cleanNumber,
        message_type: "text",
        text: text,
        channel: "whatsapp",
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Vonage] Erro:", error);
    return false;
  }
}

export async function sendMessage(
  to: string, 
  text: string, 
  source: MessageSource
): Promise<boolean> {
  if (source === "vonage") return sendWhatsAppVonage(to, text);
  return sendWhatsAppMeta(to, text);
}

// ============================================================================
// 🔘 ENVIO DE BOTÕES
// ============================================================================

export async function sendButtons(
  to: string, 
  bodyText: string, 
  buttons: Array<{ id: string; title: string }>,
  source: MessageSource
): Promise<boolean> {
  // Vonage não suporta botões nativos
  if (source !== "meta") {
    const fallbackText = bodyText + "\n\n" + buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    return sendMessage(to, fallbackText, source);
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
              buttons: buttons.slice(0, 3).map(b => ({
                type: "reply",
                reply: { id: b.id, title: b.title.slice(0, 20) }
              }))
            }
          }
        }),
      }
    );
    return response.ok;
  } catch (error) {
    console.error("[Meta Buttons] Erro:", error);
    // Fallback para texto
    return sendMessage(to, bodyText, source);
  }
}

// ============================================================================
// 📝 MENSAGENS PRÉ-DEFINIDAS
// ============================================================================

export const MESSAGES = {
  onboarding: (name: string) => 
    `Oi, ${name}! 👋\n\n` +
    `Sou o *Finax* — seu assistente financeiro.\n\n` +
    `Pode me mandar gastos por texto, áudio ou foto.\n\n` +
    `Pra começar, me conta: quanto você costuma ganhar por mês? 💰`,
  
  help: () =>
    `*Como usar o Finax* 📊\n\n` +
    `💸 *Registrar gasto:*\n"Gastei 50 no mercado"\n"Café 8 reais pix"\n\n` +
    `💰 *Registrar entrada:*\n"Recebi 200 no pix"\n\n` +
    `📊 *Ver resumo:*\n"Quanto gastei?"\n"Resumo"\n\n` +
    `🗑️ *Cancelar:*\n"Cancela" ou responda uma mensagem antiga\n\n` +
    `💳 *Cartões:*\n"Ver cartões"\n"Atualiza limite Nubank 5000"`,
  
  greeting: (name: string) => 
    `Oi, ${name}! 👋\n\nMe conta um gasto ou pergunta seu resumo.`,
  
  notUnderstood: () =>
    `Não entendi 🤔\n\n` +
    `Pode me dizer:\n` +
    `• Um gasto (ex: "café 8 reais pix")\n` +
    `• Uma entrada (ex: "recebi 200")\n` +
    `• "Resumo" pra ver seus gastos\n` +
    `• "Cancelar" pra desfazer algo`,
  
  error: () => 
    `Ops, algo deu errado 😕\n\nTenta de novo?`
};
