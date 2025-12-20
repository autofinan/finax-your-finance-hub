import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Credentials
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WhatsApp Business API (Meta)
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Tipos de intent que a IA pode detectar
interface ExtractedIntent {
  intent: 
    | "registrar_gasto" 
    | "registrar_entrada" 
    | "criar_parcelamento" 
    | "criar_recorrente"
    | "consultar_resumo"
    | "consultar_categoria"
    | "consultar_detalhes"
    | "saudacao"
    | "ajuda"
    | "outro";
  
  // Para transações simples
  valor?: number;
  categoria?: string;
  descricao?: string;
  
  // Para parcelamentos
  parcelas?: number;
  
  // Para recorrentes
  tipo_recorrencia?: "mensal" | "semanal" | "anual";
  dia_mes?: number;
  dia_semana?: string;
  
  // Para consultas
  periodo?: string; // "mes_atual", "dezembro", "semana", etc.
  categoria_consulta?: string;
}

// Extrai intent e entidades da mensagem usando AI
async function extractIntent(message: string, historicoRecente: string): Promise<ExtractedIntent> {
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
            content: `Você é um analisador de intenções financeiras. Analise a mensagem do usuário e extraia a intenção e entidades.

INTENTS POSSÍVEIS:
- "registrar_gasto": usuário quer registrar um gasto/despesa simples
- "registrar_entrada": usuário quer registrar uma receita/entrada de dinheiro
- "criar_parcelamento": usuário comprou algo parcelado (ex: "comprei TV em 12x", "parcelei em 6 vezes")
- "criar_recorrente": usuário quer cadastrar gasto que se repete (ex: "todo mês pago netflix", "semanalmente gasto X")
- "consultar_resumo": usuário quer ver resumo geral dos gastos
- "consultar_categoria": usuário quer ver gastos de uma categoria específica
- "consultar_detalhes": usuário quer ver detalhes/lista de transações
- "saudacao": apenas cumprimento (oi, olá, bom dia)
- "ajuda": pedindo ajuda sobre como usar
- "outro": não se encaixa em nenhum

REGRAS DE EXTRAÇÃO:
1. Se mencionar parcelas, vezes, "em Xx" → intent = "criar_parcelamento"
2. Se mencionar "todo mês", "mensal", "semanal", "recorrente" → intent = "criar_recorrente"
3. Se pedir resumo, quanto gastou, balanço → intent = "consultar_resumo"
4. Se perguntar sobre categoria específica (alimentação, transporte, etc) → intent = "consultar_categoria"
5. Se pedir detalhes, lista, o que comprou → intent = "consultar_detalhes"
6. Recebi, ganhei, entrou, pix recebido → intent = "registrar_entrada"
7. Gastei, paguei, comprei (sem parcela) → intent = "registrar_gasto"

CATEGORIAS VÁLIDAS:
alimentação, transporte, lazer, moradia, saúde, educação, compras, tecnologia, assinaturas, salário, freelance, investimentos, pix, outros

EXTRAÇÃO DE VALORES:
- "45 reais", "R$ 45", "45,00" → valor: 45
- "3000 em 12x" → valor: 3000 (total), parcelas: 12
- "20,90 todo mês no dia 10" → valor: 20.90, tipo_recorrencia: "mensal", dia_mes: 10

Responda APENAS com JSON válido:
{
  "intent": "string",
  "valor": number ou null,
  "categoria": "string" ou null,
  "descricao": "string" ou null,
  "parcelas": number ou null,
  "tipo_recorrencia": "string" ou null,
  "dia_mes": number ou null,
  "dia_semana": "string" ou null,
  "periodo": "string" ou null,
  "categoria_consulta": "string" ou null
}

${historicoRecente ? `CONTEXTO DA CONVERSA RECENTE:\n${historicoRecente}` : ""}
`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"intent": "outro"}';
    
    // Limpa o JSON de possíveis markdown
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    console.log("Intent extraído:", cleanJson);
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Erro ao extrair intent:", error);
    return { intent: "outro" };
  }
}

// Gera resposta conversacional com contexto completo
async function generateResponse(
  userMessage: string, 
  context: string, 
  acaoRealizada: string
): Promise<string> {
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
            content: `Você é o Finax, um assistente financeiro pessoal amigável e inteligente via WhatsApp.

PERSONALIDADE:
- Seja amigável, use emojis com moderação (1-2 por mensagem)
- Formate bem suas respostas com quebras de linha para facilitar leitura
- Seja conciso mas informativo
- Use linguagem natural, como se fosse um amigo ajudando

FORMATO DAS RESPOSTAS:
- Use linhas em branco para separar seções
- Liste itens com • ou -
- Destaque valores importantes com **negrito**
- Nunca envie tudo em um único parágrafo corrido

${acaoRealizada ? `AÇÃO REALIZADA:\n${acaoRealizada}\n` : ""}

${context ? `CONTEXTO FINANCEIRO:\n${context}` : ""}

Responda de forma natural e útil. Se uma transação foi registrada, confirme com detalhes.
Se é uma consulta, apresente os dados de forma clara e organizada.`
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

// Envia mensagem via WhatsApp Business API (Meta)
async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  try {
    // Remove formatação extra do número
    const cleanNumber = to.replace(/\D/g, "");
    
    console.log(`Enviando mensagem para ${cleanNumber}...`);
    
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

    const result = await response.json();
    console.log("Meta WhatsApp response:", JSON.stringify(result));
    
    if (!response.ok) {
      console.error("Erro na API Meta:", result);
    }
    
    return response.ok;
  } catch (error) {
    console.error("Erro ao enviar WhatsApp via Meta:", error);
    return false;
  }
}

// Busca resumo financeiro do mês
async function getResumoMes(usuarioId: string) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo, categoria, observacao, descricao, data, parcela")
    .eq("usuario_id", usuarioId)
    .gte("data", inicioMes.toISOString());

  let totalEntradas = 0;
  let totalSaidas = 0;
  const porCategoria: Record<string, number> = {};
  
  transacoes?.forEach((t) => {
    const valor = Number(t.valor);
    if (t.tipo === "entrada") {
      totalEntradas += valor;
    } else {
      totalSaidas += valor;
      porCategoria[t.categoria] = (porCategoria[t.categoria] || 0) + valor;
    }
  });

  return {
    totalEntradas,
    totalSaidas,
    saldo: totalEntradas - totalSaidas,
    porCategoria,
    transacoes: transacoes || []
  };
}

// Busca transações por categoria
async function getTransacoesPorCategoria(usuarioId: string, categoria: string, periodo?: string) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  
  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", usuarioId)
    .ilike("categoria", `%${categoria}%`)
    .gte("data", inicioMes.toISOString())
    .order("data", { ascending: false });

  return transacoes || [];
}

// Busca histórico recente de conversa
async function getHistoricoRecente(phoneNumber: string): Promise<string> {
  const { data: historico } = await supabase
    .from("historico_conversas")
    .select("user_message, ai_response")
    .eq("phone_number", phoneNumber)
    .order("created_at", { ascending: false })
    .limit(3);

  if (!historico || historico.length === 0) return "";

  return historico.reverse().map(h => 
    `Usuário: ${h.user_message}\nAssistente: ${h.ai_response}`
  ).join("\n\n");
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ========== VERIFICAÇÃO GET (Meta Webhook Verification) ==========
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    
    console.log("Verificação webhook recebida:", { mode, token, challenge: challenge?.substring(0, 20) });
    
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      console.log("✅ Webhook verificado com sucesso!");
      return new Response(challenge, { 
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    console.log("❌ Verificação falhou - token inválido");
    return new Response("Forbidden", { status: 403 });
  }

  // ========== PROCESSAMENTO POST (Mensagens recebidas) ==========
  try {
    const json = await req.json();
    console.log("Webhook payload:", JSON.stringify(json));

    // Formato Meta WhatsApp Business API
    const entry = json.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    
    // Ignora notificações que não são mensagens (ex: status updates)
    if (!value?.messages || value.messages.length === 0) {
      console.log("Ignorando: não é uma mensagem de usuário (pode ser status update)");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = value.messages[0];
    const from = message.from; // Número do usuário
    const body = message.text?.body || ""; // Texto da mensagem
    const messageType = message.type;

    // Só processa mensagens de texto por enquanto
    if (messageType !== "text" || !body) {
      console.log(`Ignorando mensagem do tipo: ${messageType}`);
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phoneNumber = from;
    console.log(`Mensagem recebida de ${phoneNumber}: ${body}`);

    if (!phoneNumber || !body) {
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

    const usuarioId = usuario?.id;

    // 2. Busca histórico recente para contexto
    const historicoRecente = await getHistoricoRecente(phoneNumber);

    // 3. Extrai intent e entidades
    const intent = await extractIntent(body, historicoRecente);
    console.log("Intent detectado:", JSON.stringify(intent));

    let acaoRealizada = "";
    let contextoDados = "";

    // 4. Processa baseado no intent
    switch (intent.intent) {
      case "registrar_gasto": {
        if (intent.valor) {
          const { error } = await supabase.from("transacoes").insert({
            usuario_id: usuarioId,
            valor: intent.valor,
            categoria: intent.categoria || "outros",
            tipo: "saida",
            observacao: intent.descricao,
            descricao: intent.descricao,
            data: new Date().toISOString(),
            origem: "whatsapp"
          });

          if (!error) {
            acaoRealizada = `✅ Gasto registrado: -R$ ${intent.valor.toFixed(2)} em ${intent.categoria || "outros"}${intent.descricao ? ` (${intent.descricao})` : ""}`;
          }
        }
        break;
      }

      case "registrar_entrada": {
        if (intent.valor) {
          const { error } = await supabase.from("transacoes").insert({
            usuario_id: usuarioId,
            valor: intent.valor,
            categoria: intent.categoria || "outros",
            tipo: "entrada",
            observacao: intent.descricao,
            descricao: intent.descricao,
            data: new Date().toISOString(),
            origem: "whatsapp"
          });

          if (!error) {
            acaoRealizada = `✅ Entrada registrada: +R$ ${intent.valor.toFixed(2)} em ${intent.categoria || "outros"}${intent.descricao ? ` (${intent.descricao})` : ""}`;
          }
        }
        break;
      }

      case "criar_parcelamento": {
        if (intent.valor && intent.parcelas && intent.parcelas > 1) {
          const valorParcela = intent.valor / intent.parcelas;
          
          // Cria o parcelamento
          const { data: parcelamento, error: errParc } = await supabase
            .from("parcelamentos")
            .insert({
              usuario_id: usuarioId,
              valor_total: intent.valor,
              num_parcelas: intent.parcelas,
              parcela_atual: 1,
              valor_parcela: valorParcela,
              ativa: true,
              descricao: intent.descricao || "Compra parcelada"
            })
            .select()
            .single();

          if (!errParc && parcelamento) {
            // Cria as transações para cada parcela
            const hoje = new Date();
            const transacoesParcelas = [];
            
            for (let i = 0; i < intent.parcelas; i++) {
              const dataParcela = new Date(hoje);
              dataParcela.setMonth(dataParcela.getMonth() + i);
              
              transacoesParcelas.push({
                usuario_id: usuarioId,
                valor: valorParcela,
                categoria: intent.categoria || "compras",
                tipo: "saida",
                observacao: intent.descricao,
                descricao: intent.descricao,
                parcela: `${i + 1}/${intent.parcelas}`,
                parcela_atual: i + 1,
                total_parcelas: intent.parcelas,
                parcelamento_id: parcelamento.id,
                data: dataParcela.toISOString(),
                status: i === 0 ? "confirmada" : "prevista",
                origem: "whatsapp"
              });
            }

            await supabase.from("transacoes").insert(transacoesParcelas);

            acaoRealizada = `✅ Parcelamento criado!\n\n` +
              `📦 ${intent.descricao || "Compra"}\n` +
              `💰 Valor total: R$ ${intent.valor.toFixed(2)}\n` +
              `📅 ${intent.parcelas}x de R$ ${valorParcela.toFixed(2)}\n\n` +
              `A primeira parcela já foi registrada neste mês. As próximas serão lançadas automaticamente.`;
          }
        }
        break;
      }

      case "criar_recorrente": {
        if (intent.valor) {
          const { error } = await supabase.from("gastos_recorrentes").insert({
            usuario_id: usuarioId,
            valor_parcela: intent.valor,
            categoria: intent.categoria || "assinaturas",
            tipo_recorrencia: intent.tipo_recorrencia || "mensal",
            dia_mes: intent.dia_mes || new Date().getDate(),
            descricao: intent.descricao,
            ativo: true,
            proxima_execucao: null, // Será calculado pelo trigger
            origem: "whatsapp"
          });

          if (!error) {
            const diaTexto = intent.dia_mes ? `todo dia ${intent.dia_mes}` : "mensalmente";
            acaoRealizada = `✅ Gasto recorrente cadastrado!\n\n` +
              `🔄 ${intent.descricao || intent.categoria}\n` +
              `💰 R$ ${intent.valor.toFixed(2)} ${diaTexto}\n\n` +
              `Vou registrar automaticamente quando a data chegar.`;
          }
        }
        break;
      }

      case "consultar_resumo": {
        const resumo = await getResumoMes(usuarioId);
        
        let categoriasTexto = "";
        const categoriasOrdenadas = Object.entries(resumo.porCategoria)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5);
        
        if (categoriasOrdenadas.length > 0) {
          categoriasTexto = "\n\n📊 Maiores gastos por categoria:\n" +
            categoriasOrdenadas.map(([cat, val]) => 
              `• ${cat}: R$ ${val.toFixed(2)}`
            ).join("\n");
        }

        contextoDados = `📅 Resumo do mês atual:\n\n` +
          `💵 Entradas: R$ ${resumo.totalEntradas.toFixed(2)}\n` +
          `💸 Saídas: R$ ${resumo.totalSaidas.toFixed(2)}\n` +
          `📈 Saldo: R$ ${resumo.saldo.toFixed(2)}` +
          categoriasTexto;
        break;
      }

      case "consultar_categoria": {
        if (intent.categoria_consulta) {
          const transacoes = await getTransacoesPorCategoria(usuarioId, intent.categoria_consulta);
          const total = transacoes.reduce((sum, t) => sum + Number(t.valor), 0);
          
          if (transacoes.length > 0) {
            const listaTransacoes = transacoes.slice(0, 10).map(t => {
              const data = new Date(t.data).toLocaleDateString("pt-BR");
              const desc = t.descricao || t.observacao || t.categoria;
              return `• ${data}: R$ ${Number(t.valor).toFixed(2)} - ${desc}`;
            }).join("\n");

            contextoDados = `📊 Gastos em ${intent.categoria_consulta} este mês:\n\n` +
              `💰 Total: R$ ${total.toFixed(2)}\n` +
              `📝 ${transacoes.length} transação(ões)\n\n` +
              `Detalhes:\n${listaTransacoes}`;
          } else {
            contextoDados = `Você não teve gastos em ${intent.categoria_consulta} este mês.`;
          }
        }
        break;
      }

      case "consultar_detalhes": {
        const resumo = await getResumoMes(usuarioId);
        
        if (resumo.transacoes.length > 0) {
          const transacoesFormatadas = resumo.transacoes
            .slice(0, 15)
            .map(t => {
              const data = new Date(t.data).toLocaleDateString("pt-BR");
              const sinal = t.tipo === "entrada" ? "+" : "-";
              const desc = t.descricao || t.observacao || t.categoria;
              const parcela = t.parcela ? ` (${t.parcela})` : "";
              return `• ${data}: ${sinal}R$ ${Number(t.valor).toFixed(2)} - ${desc}${parcela}`;
            }).join("\n");

          contextoDados = `📋 Suas transações do mês:\n\n${transacoesFormatadas}\n\n` +
            `Total: ${resumo.transacoes.length} transações`;
        } else {
          contextoDados = "Você ainda não tem transações registradas este mês.";
        }
        break;
      }

      case "saudacao":
      case "ajuda":
      case "outro":
      default: {
        // Apenas busca contexto para a resposta
        const resumo = await getResumoMes(usuarioId);
        contextoDados = `Resumo atual: Entradas R$ ${resumo.totalEntradas.toFixed(2)}, ` +
          `Saídas R$ ${resumo.totalSaidas.toFixed(2)}, Saldo R$ ${resumo.saldo.toFixed(2)}`;
        break;
      }
    }

    // 5. Gera resposta com AI
    const contextoCompleto = contextoDados || acaoRealizada 
      ? `${acaoRealizada}\n\n${contextoDados}`.trim() 
      : "";
    
    const aiResponse = await generateResponse(body, contextoCompleto, acaoRealizada);

    // 6. Salva histórico
    await supabase.from("historico_conversas").insert({
      phone_number: phoneNumber,
      user_id: usuarioId,
      user_message: body,
      ai_response: aiResponse,
      tipo: intent.intent
    });

    // 7. Envia resposta via WhatsApp
    await sendWhatsAppMessage(phoneNumber, aiResponse);

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
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
