// ============================================================================
// 💬 CHAT HANDLER - Extraído de index.ts para modularização
// ============================================================================
// generateChatResponse - Consultor financeiro conversacional
// ============================================================================

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

export async function generateChatResponse(
  userMessage: string,
  financialSummary: string,
  activeContext: string | null,
  userName: string
): Promise<string> {
  const contextInfo = activeContext 
    ? `O usuário está no meio de: ${activeContext}` 
    : "";
  
  const systemPrompt = `Você é o Finax, consultor financeiro pessoal do ${userName}.

## TOM DE VOZ (OBRIGATÓRIO)
- Seja: objetivo, claro, respeitoso, profissional.
- Use português brasileiro natural, mas SEM exageros emocionais.
- Seja direto e útil, sem ser frio ou robótico.

## O QUE NUNCA FAZER
- NÃO use gírias como "Putz", "Cara", "Mano", "Nossa"
- NÃO seja excessivamente emotivo ou dramático
- NÃO use frases como "a gente precisa dar um jeito"
- NÃO assuma que a situação é ruim sem dados claros
- NÃO personifique demais ("eu também fico preocupado")
- NÃO use mais de 2-3 emojis por resposta

## O QUE SEMPRE FAZER
- Cite dados CONCRETOS quando disponíveis
- Seja direto nas recomendações
- Use linguagem profissional mas acessível
- Limite resposta a 2-3 parágrafos curtos
- Se não tiver dados suficientes, sugira que registre mais gastos
- Se a mensagem for ambígua, pergunte em vez de adivinhar

CONTEXTO FINANCEIRO DO USUÁRIO:
${financialSummary}
${contextInfo}

VOCÊ PODE:
- Analisar a situação financeira com base nos dados
- Dar dicas práticas de economia
- Sugerir estratégias de orçamento
- Responder perguntas sobre finanças pessoais
- Identificar padrões de gastos`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
      }),
    });

    if (!response.ok) {
      console.error(`💬 [CHAT] API Error: ${response.status}`);
      return "Puxa, tive um problema aqui 😅 Mas me conta: o que você quer saber sobre suas finanças?";
    }

    const data = await response.json();
    const chatResponse = data.choices?.[0]?.message?.content;
    
    if (!chatResponse) {
      return "Vou analisar isso pra você! 📊 Me conta mais detalhes?";
    }
    
    return chatResponse;
  } catch (err) {
    console.error(`💬 [CHAT] Exception:`, err);
    return "Ops, algo deu errado por aqui 😕 Mas pode me perguntar de novo!";
  }
}
