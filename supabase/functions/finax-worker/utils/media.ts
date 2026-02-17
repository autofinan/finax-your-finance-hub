// ============================================================================
// 🎤📷 MEDIA HANDLERS - Extraído de index.ts para modularização
// ============================================================================
// Download de mídia WhatsApp, transcrição de áudio e OCR de imagens.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📷 OCR RESULT INTERFACE
// ============================================================================

export interface OCRResult {
  valor?: number;
  descricao?: string;
  forma_pagamento?: string;
  data?: string;
  confidence: number;
  raw?: string;
}

// ============================================================================
// 📥 DOWNLOAD DE MÍDIA DO WHATSAPP
// ============================================================================

export async function downloadWhatsAppMedia(mediaId: string, eventoId?: string): Promise<string | null> {
  if (eventoId) {
    const { data: evento } = await supabase.from("eventos_brutos").select("media_status, media_attempts, media_downloaded").eq("id", eventoId).single();
    if (evento?.media_status === 'done' || evento?.media_downloaded) return null;
    if ((evento?.media_attempts || 0) >= 2) return null;
    await supabase.from("eventos_brutos").update({ media_status: 'processing', media_attempts: (evento?.media_attempts || 0) + 1 }).eq("id", eventoId);
  }
  
  try {
    const urlResponse = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } });
    if (!urlResponse.ok) return null;
    
    const urlData = await urlResponse.json();
    const mediaResponse = await fetch(urlData.url, { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } });
    if (!mediaResponse.ok) return null;
    
    const arrayBuffer = await mediaResponse.arrayBuffer();
    // ✅ FIX BUG #11: Conversão em chunks para evitar stack overflow em imagens grandes
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    
    if (eventoId) await supabase.from("eventos_brutos").update({ media_status: 'done', media_downloaded: true }).eq("id", eventoId);
    return base64;
  } catch (error) {
    console.error("❌ [MÍDIA] Erro:", error);
    return null;
  }
}

// ============================================================================
// 🎤 TRANSCRIÇÃO DE ÁUDIO (AssemblyAI)
// ============================================================================

export async function transcreverAudio(audioBase64: string): Promise<{ texto: string | null; confianca: number }> {
  try {
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { "Authorization": ASSEMBLYAI_API_KEY!, "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!uploadResponse.ok) return { texto: null, confianca: 0 };
    
    const uploadData = await uploadResponse.json();
    const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "Authorization": ASSEMBLYAI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: uploadData.upload_url, language_code: "pt" }),
    });
    if (!transcriptResponse.ok) return { texto: null, confianca: 0 };
    
    const transcriptData = await transcriptResponse.json();
    const transcriptId = transcriptData.id;
    
    // Poll for completion
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { "Authorization": ASSEMBLYAI_API_KEY! },
      });
      const pollData = await pollResponse.json();
      
      if (pollData.status === "completed") {
        return { texto: pollData.text || null, confianca: pollData.confidence || 0 };
      }
      if (pollData.status === "error") {
        console.error("❌ [AUDIO] Transcrição falhou:", pollData.error);
        return { texto: null, confianca: 0 };
      }
    }
    
    console.error("❌ [AUDIO] Timeout na transcrição");
    return { texto: null, confianca: 0 };
  } catch (error) {
    console.error("❌ [AUDIO] Erro:", error);
    return { texto: null, confianca: 0 };
  }
}

// ============================================================================
// 📷 ANÁLISE DE IMAGEM COM GEMINI VISION
// ============================================================================

export async function analyzeImageWithGemini(base64Image: string): Promise<OCRResult> {
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
            role: "user",
            content: [
              {
                type: "text",
                text: `Analise esta imagem de um cupom fiscal, recibo ou comprovante de pagamento.

EXTRAIA APENAS as seguintes informações (se visíveis):
1. VALOR TOTAL (número em reais)
2. DESCRIÇÃO (o que foi comprado - resumo curto)
3. FORMA DE PAGAMENTO (pix, débito, crédito, dinheiro - se identificável)
4. DATA (se visível)

REGRAS:
- Retorne APENAS JSON válido, sem texto adicional
- Se não encontrar um campo, não inclua no JSON
- Para valor, retorne apenas o número (ex: 45.90)
- Para descrição, seja breve (máximo 30 caracteres)
- Se não conseguir identificar NADA útil, retorne {"confidence": 0}

Formato de resposta:
{
  "valor": 45.90,
  "descricao": "Supermercado",
  "forma_pagamento": "pix",
  "data": "15/01/2024",
  "confidence": 0.85
}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
      }),
    });
    
    if (!response.ok) {
      console.error(`📷 [GEMINI] Erro na API:`, response.status);
      return { confidence: 0 };
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"confidence": 0}';
    
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    
    try {
      const parsed = JSON.parse(cleanJson);
      
      const result: OCRResult = {
        confidence: parsed.confidence || 0,
        raw: cleanJson
      };
      
      if (parsed.valor && typeof parsed.valor === "number" && parsed.valor > 0) {
        result.valor = parsed.valor;
      }
      
      if (parsed.descricao && typeof parsed.descricao === "string" && parsed.descricao.length > 0) {
        result.descricao = parsed.descricao.slice(0, 50);
      }
      
      if (parsed.forma_pagamento) {
        const paymentMap: Record<string, string> = {
          "pix": "pix",
          "débito": "debito", 
          "debito": "debito",
          "crédito": "credito",
          "credito": "credito",
          "cartão": "credito",
          "cartao": "credito",
          "dinheiro": "dinheiro",
          "espécie": "dinheiro"
        };
        const normalized = String(parsed.forma_pagamento).toLowerCase();
        result.forma_pagamento = paymentMap[normalized] || undefined;
      }
      
      if (parsed.data) {
        result.data = String(parsed.data);
      }
      
      console.log(`📷 [GEMINI] Análise concluída: valor=${result.valor}, desc=${result.descricao}, conf=${result.confidence}`);
      return result;
      
    } catch (parseError) {
      console.error(`📷 [GEMINI] Erro ao parsear JSON:`, cleanJson.slice(0, 200));
      return { confidence: 0, raw: cleanJson };
    }
    
  } catch (error) {
    console.error(`📷 [GEMINI] Erro:`, error);
    return { confidence: 0 };
  }
}
