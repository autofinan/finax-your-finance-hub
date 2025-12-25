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
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");

// WhatsApp Business API (Meta)
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type MessageSource = "meta" | "vonage";

// ============================================================================
// 🎯 INTERFACES
// ============================================================================

interface ConversaAtiva {
  id?: string;
  usuario_id: string;
  estado: "aguardando_dados" | "aguardando_confirmacao" | "concluido";
  tipo_operacao: "gasto" | "entrada" | "recorrente" | "parcelamento";
  dados_coletados: {
    valor?: number;
    descricao?: string;
    categoria?: string;
    forma_pagamento?: "pix" | "dinheiro" | "debito" | "credito";
    cartao_id?: string;
    tipo_recorrencia?: "mensal" | "semanal" | "anual";
    dia_mes?: number;
    dia_semana?: string;
    num_parcelas?: number;
  };
  campos_pendentes: string[];
  mensagens_usuario: string[];
  ultima_pergunta_ia: string;
  criado_em?: string;
  atualizado_em?: string;
  expira_em?: string;
}

interface DecisaoIA {
  acao: "coletar" | "registrar" | "confirmar" | "erro" | "onboarding";
  mensagem_usuario: string;
  usar_botoes: boolean;
  botoes?: Array<{ id: string; texto: string }>;
  dados_completos?: any;
  campos_coletados?: any;
  atualizar_conversa?: {
    campos_pendentes: string[];
    ultima_pergunta?: string;
  };
  onboarding_step?: string;
  salvar_onboarding?: any;
}

interface Transacao {
  id?: string;
  usuario_id: string;
  valor: number;
  tipo: "entrada" | "saida";
  descricao: string;
  categoria: string;
  forma_pagamento?: string;
  cartao_id?: string;
  data_transacao: string;
  origem: string;
  observacao?: string;
  recorrente_id?: string;
  parcelamento_id?: string;
}

// ============================================================================
// 🧠 PROMPT MASTER - IA ORQUESTRADORA
// ============================================================================

const PROMPT_ORQUESTRADOR = `
# VOCÊ É A FINAX - IA FINANCEIRA AUTÔNOMA

Você é uma assistente financeira inteligente que ajuda usuários a organizarem suas finanças pelo WhatsApp.

## PRINCÍPIOS FUNDAMENTAIS
1. **AUTONOMIA TOTAL** - Você decide, coleta e registra
2. **CONTEXTO SEMPRE** - Nunca perde informações
3. **NATURAL E HUMANA** - Conversa fluida, sem robótica
4. **RICA EM DETALHES** - Mensagens completas e organizadas
5. **PROATIVA** - Infere categoria, sugere ações

## ONBOARDING (NOVOS USUÁRIOS)

### Etapa 1: Renda
Pergunta: "Olá! 👋 Prazer, sou a Finax!\n\nVou te ajudar a organizar suas finanças de forma simples.\n\nPra começar, me conta: **quanto você costuma ganhar por mês?**\n\n_Pode ser aproximado, tipo 'uns 3 mil' ou 'varia entre 4k e 5k'_"

Coleta: valor da renda mensal
Próxima: cartoes

### Etapa 2: Cartões
Pergunta: "Legal! R$ X.XXX anotado 💰\n\nVocê usa cartão de crédito?\n\nSe sim, me diz quais (ex: Nubank, Itaú...)\nSe não, só responde 'não uso'"

Coleta: lista de cartões OU confirmação de não uso
Próxima: finalizado

### Etapa 3: Finalizado
Mensagem: "Perfeito! [N] cartões salvos 💳\n\n✅ **Tudo pronto!**\n\nAgora é só me mandar seus gastos do dia a dia:\n• Por texto: 'gastei 50 no mercado'\n• Por áudio: só gravar\n• Por foto: comprovante/nota\n\nVamos lá! 🚀"

## CATEGORIAS DISPONÍVEIS
- alimentacao: 🍔 Alimentação (mercado, restaurante, ifood, delivery)
- transporte: 🚗 Transporte (uber, gasolina, estacionamento, ônibus)
- moradia: 🏠 Moradia (aluguel, condomínio, água, luz, gás)
- lazer: 🎉 Lazer (cinema, streaming, jogos, viagens)
- saude: 💊 Saúde (farmácia, consulta, plano de saúde)
- educacao: 📚 Educação (curso, livro, escola)
- outros: 📦 Outros (tudo que não se encaixa)

## INFERÊNCIA INTELIGENTE

### Descrição → Categoria
- uber, 99, gasolina, estacionamento → transporte
- mercado, ifood, restaurante, lanche → alimentacao
- aluguel, condomínio, luz, água, gás → moradia
- netflix, spotify, cinema, viagem → lazer
- farmácia, médico, remédio → saude
- curso, livro, faculdade → educacao

### Descrição → Forma de Pagamento (sugestão)
- uber, ifood → provavelmente débito/crédito
- mercado pequeno → provavelmente dinheiro/pix
- aluguel → pix (sempre perguntar)
- netflix, spotify → crédito

## REGRAS DE COLETA

### DADOS ESSENCIAIS (obrigatórios)
- GASTO/ENTRADA: valor, descrição
- RECORRENTE: valor, descrição, quando repete (dia_mes OU dia_semana)
- PARCELAMENTO: valor, descrição, num_parcelas

### DADOS IMPORTANTES (perguntar se faltar)
- forma_pagamento (para todos)
- categoria (inferir se possível)
- cartao_id (se forma = credito)

### QUANDO REGISTRAR DIRETO
✅ Tem dados essenciais E (categoria inferida OU fornecida) → REGISTRA
✅ Confiança > 90% → REGISTRA
❌ Falta forma_pagamento → PERGUNTA com botões
❌ Falta 2+ campos → COLETA naturalmente

## FORMATO DE RESPOSTA JSON

Você SEMPRE responde em JSON puro (sem markdown):

{
  "acao": "coletar" | "registrar" | "erro" | "onboarding",
  "mensagem_usuario": "texto para enviar ao usuário",
  "usar_botoes": true | false,
  "botoes": [{"id": "pix", "texto": "💳 Pix"}] ou null,
  
  "dados_completos": {
    "valor": 50.00,
    "descricao": "Uber",
    "categoria": "transporte",
    "forma_pagamento": "debito",
    "tipo": "saida" | "entrada"
  },
  
  "campos_coletados": {"forma_pagamento": "credito"},
  
  "atualizar_conversa": {
    "campos_pendentes": ["cartao_id"],
    "ultima_pergunta": "Qual cartão?"
  },
  
  "onboarding_step": "renda" | "cartoes" | "finalizado",
  "salvar_onboarding": {"renda": 4500, "cartoes": ["Nubank", "Inter"]}
}

## EXEMPLOS PRÁTICOS

### Exemplo 1: Gasto completo
Mensagem: "Gastei 50 no uber de pix"
Contexto: {}

Resposta:
{
  "acao": "registrar",
  "mensagem_usuario": "placeholder", 
  "usar_botoes": false,
  "dados_completos": {
    "valor": 50,
    "descricao": "Uber",
    "categoria": "transporte",
    "forma_pagamento": "pix",
    "tipo": "saida"
  }
}

### Exemplo 2: Falta forma pagamento
Mensagem: "Paguei 150 de aluguel"
Contexto: {}

Resposta:
{
  "acao": "coletar",
  "mensagem_usuario": "Aluguel de R$ 150,00 anotado! 🏠\n\nComo você pagou?",
  "usar_botoes": true,
  "botoes": [
    {"id": "pix", "texto": "💳 Pix"},
    {"id": "debito", "texto": "💳 Débito"},
    {"id": "credito", "texto": "💳 Crédito"}
  ],
  "campos_coletados": {
    "valor": 150,
    "descricao": "aluguel",
    "categoria": "moradia"
  },
  "atualizar_conversa": {
    "campos_pendentes": ["forma_pagamento"],
    "ultima_pergunta": "Como você pagou?"
  }
}

### Exemplo 3: Recorrente
Mensagem: "Netflix é 50 todo mês"
Contexto: {}

Resposta:
{
  "acao": "coletar",
  "mensagem_usuario": "Netflix de R$ 50,00 mensais - anotado! 📺\n\nQual dia do mês cai a cobrança?\n\n_Pode responder tipo: 'dia 15' ou 'todo dia 5'_",
  "usar_botoes": false,
  "campos_coletados": {
    "valor": 50,
    "descricao": "Netflix",
    "categoria": "lazer",
    "tipo_recorrencia": "mensal"
  },
  "atualizar_conversa": {
    "campos_pendentes": ["dia_mes"]
  }
}

### Exemplo 4: Continuação de contexto
Mensagem: "pix"
Contexto: {
  "dados_coletados": {"valor": 150, "descricao": "aluguel", "categoria": "moradia"},
  "campos_pendentes": ["forma_pagamento"],
  "ultima_pergunta": "Como você pagou?"
}

Resposta:
{
  "acao": "registrar",
  "mensagem_usuario": "placeholder",
  "usar_botoes": false,
  "dados_completos": {
    "valor": 150,
    "descricao": "aluguel",
    "categoria": "moradia",
    "forma_pagamento": "pix",
    "tipo": "saida"
  }
}

### Exemplo 5: Onboarding - Renda
Mensagem: "ganho uns 4500"
Contexto: {"onboarding_step": "renda"}

Resposta:
{
  "acao": "onboarding",
  "mensagem_usuario": "Legal! R$ 4.500,00 anotado 💰\n\nVocê usa cartão de crédito?\n\nSe sim, me diz quais (ex: Nubank, Itaú...)\nSe não, só responde 'não uso'",
  "usar_botoes": false,
  "onboarding_step": "cartoes",
  "salvar_onboarding": {"renda": 4500}
}

### Exemplo 6: Onboarding - Cartões
Mensagem: "nubank e inter"
Contexto: {"onboarding_step": "cartoes"}

Resposta:
{
  "acao": "onboarding",
  "mensagem_usuario": "Perfeito! 2 cartões salvos 💳\n\n✅ **Tudo pronto!**\n\nAgora é só me mandar seus gastos do dia a dia:\n• Por texto: 'gastei 50 no mercado'\n• Por áudio: só gravar\n• Por foto: comprovante/nota\n\nVamos lá! 🚀",
  "usar_botoes": false,
  "onboarding_step": "finalizado",
  "salvar_onboarding": {"cartoes": ["Nubank", "Inter"]}
}

## TRATAMENTO DE ERROS

Se não entender:
{
  "acao": "erro",
  "mensagem_usuario": "Hmm, não entendi bem 🤔\n\nVocê pode repetir de outra forma?\n\nOu me diz:\n• Registrar gasto\n• Ver resumo\n• Criar recorrência",
  "usar_botoes": false
}

## IMPORTANTE
- SEMPRE retorne JSON puro, SEM markdown (sem \`\`\`json)
- NUNCA invente dados que o usuário não forneceu
- SEMPRE infira categoria quando possível
- Use botões para forma_pagamento quando faltar
- Seja natural, humana e prestativa
`;

// ============================================================================
// 🗄️ FUNÇÕES DE BANCO DE DADOS
// ============================================================================

async function getConversaAtiva(usuarioId: string): Promise<ConversaAtiva | null> {
  try {
    const { data, error } = await supabase
      .from("conversas_ativas")
      .select("*")
      .eq("usuario_id", usuarioId)
      .gt("expira_em", new Date().toISOString())
      .order("criado_em", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as ConversaAtiva;
  } catch {
    return null;
  }
}

async function salvarConversaAtiva(conversa: ConversaAtiva): Promise<void> {
  const expiraEm = new Date();
  expiraEm.setMinutes(expiraEm.getMinutes() + 30);

  await supabase.from("conversas_ativas").insert({
    usuario_id: conversa.usuario_id,
    estado: conversa.estado,
    tipo_operacao: conversa.tipo_operacao,
    dados_coletados: conversa.dados_coletados,
    campos_pendentes: conversa.campos_pendentes,
    mensagens_usuario: conversa.mensagens_usuario,
    ultima_pergunta_ia: conversa.ultima_pergunta_ia,
    expira_em: expiraEm.toISOString(),
  });
}

async function atualizarConversaAtiva(
  usuarioId: string,
  updates: Partial<ConversaAtiva>
): Promise<void> {
  const expiraEm = new Date();
  expiraEm.setMinutes(expiraEm.getMinutes() + 30);

  await supabase
    .from("conversas_ativas")
    .update({
      ...updates,
      atualizado_em: new Date().toISOString(),
      expira_em: expiraEm.toISOString(),
    })
    .eq("usuario_id", usuarioId)
    .gt("expira_em", new Date().toISOString());
}

async function limparConversaAtiva(usuarioId: string): Promise<void> {
  await supabase
    .from("conversas_ativas")
    .delete()
    .eq("usuario_id", usuarioId);
}

async function getUltimas10Transacoes(usuarioId: string): Promise<any[]> {
  const { data } = await supabase
    .from("transacoes")
    .select("*")
    .eq("usuario_id", usuarioId)
    .order("data_transacao", { ascending: false })
    .limit(10);

  return data || [];
}

async function salvarTransacao(transacao: Transacao): Promise<any> {
  const { data, error } = await supabase
    .from("transacoes")
    .insert({
      usuario_id: transacao.usuario_id,
      valor: transacao.valor,
      tipo: transacao.tipo,
      descricao: transacao.descricao,
      categoria: transacao.categoria,
      forma_pagamento: transacao.forma_pagamento,
      cartao_id: transacao.cartao_id,
      data_transacao: transacao.data_transacao,
      origem: transacao.origem,
      observacao: transacao.observacao,
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao salvar transação:", error);
    return null;
  }

  return data;
}

async function salvarRecorrente(usuarioId: string, dados: any): Promise<void> {
  await supabase.from("gastos_recorrentes").insert({
    usuario_id: usuarioId,
    descricao: dados.descricao,
    categoria: dados.categoria,
    valor_parcela: dados.valor,
    tipo_recorrencia: dados.tipo_recorrencia,
    dia_mes: dados.dia_mes,
    dia_semana: dados.dia_semana,
    ativo: true,
  });
}

async function getResumoMensal(usuarioId: string) {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const { data: transacoes } = await supabase
    .from("transacoes")
    .select("valor, tipo, categoria")
    .eq("usuario_id", usuarioId)
    .gte("data_transacao", inicioMes.toISOString());

  let entradas = 0;
  let saidas = 0;
  const porCategoria: Record<string, number> = {};

  transacoes?.forEach((t) => {
    const valor = Number(t.valor);
    if (t.tipo === "entrada") {
      entradas += valor;
    } else {
      saidas += valor;
      porCategoria[t.categoria] = (porCategoria[t.categoria] || 0) + valor;
    }
  });

  return {
    entradas,
    saidas,
    saldo: entradas - saidas,
    porCategoria,
  };
}

async function getCartaoNome(cartaoId: string): Promise<string> {
  const { data } = await supabase
    .from("cartoes_credito")
    .select("nome")
    .eq("id", cartaoId)
    .single();

  return data?.nome || "Crédito";
}

async function verificarNovoUsuario(phoneNumber: string): Promise<boolean> {
  const { count } = await supabase
    .from("historico_conversas")
    .select("id", { count: "exact", head: true })
    .eq("phone_number", phoneNumber);

  return count === 0;
}

async function getOnboardingStep(usuarioId: string): Promise<string | null> {
  const { data } = await supabase
    .from("usuarios")
    .select("onboarding_step, onboarding_status")
    .eq("id", usuarioId)
    .single();

  if (data?.onboarding_status === "concluido") return null;
  return data?.onboarding_step || "renda";
}

async function salvarOnboardingData(usuarioId: string, step: string, dados: any): Promise<void> {
  if (step === "renda") {
    await supabase
      .from("usuarios")
      .update({
        saldo_mensal: dados.renda,
        onboarding_step: "cartoes",
        onboarding_status: "iniciado",
      })
      .eq("id", usuarioId);
  } else if (step === "cartoes") {
    if (dados.cartoes && dados.cartoes.length > 0) {
      for (const cartao of dados.cartoes) {
        await supabase.from("cartoes_credito").insert({
          usuario_id: usuarioId,
          nome: cartao,
          ativo: true,
        });
      }
    }

    await supabase
      .from("usuarios")
      .update({
        onboarding_step: "finalizado",
        onboarding_status: "concluido",
      })
      .eq("id", usuarioId);
  }
}

// ============================================================================
// 🎨 FORMATAÇÃO DE MENSAGENS
// ============================================================================

function formatarCategoria(cat: string): string {
  const map: Record<string, string> = {
    alimentacao: "🍔 Alimentação",
    transporte: "🚗 Transporte",
    moradia: "🏠 Moradia",
    lazer: "🎉 Lazer",
    saude: "💊 Saúde",
    educacao: "📚 Educação",
    outros: "📦 Outros",
  };
  return map[cat] || cat;
}

function formatarFormaPagamento(forma: string, cartaoNome?: string): string {
  if (forma === "credito" && cartaoNome) {
    return `💳 Crédito - ${cartaoNome}`;
  }
  const map: Record<string, string> = {
    pix: "💳 Pix",
    dinheiro: "💵 Dinheiro",
    debito: "💳 Débito",
    credito: "💳 Crédito",
  };
  return map[forma] || forma;
}

async function montarMensagemRegistro(
  transacao: any,
  resumoMes: any
): Promise<string> {
  const emoji = transacao.tipo === "entrada" ? "📈" : "💸";
  const sinal = transacao.tipo === "entrada" ? "+" : "-";
  const data = new Date(transacao.data_transacao);
  const dataFormatada = data.toLocaleDateString("pt-BR");
  const horaFormatada = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  let cartaoNome = "";
  if (transacao.cartao_id) {
    cartaoNome = await getCartaoNome(transacao.cartao_id);
  }

  const categoriaAtual = transacao.categoria || "outros";
  const totalCategoria = resumoMes.porCategoria[categoriaAtual] || transacao.valor;

  return `
✅ ${transacao.tipo === "entrada" ? "Entrada" : "Gasto"} registrado!

🧾 **Detalhes da transação #${transacao.id.toString().slice(-4)}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${emoji} Valor: ${sinal}R$ ${Number(transacao.valor).toFixed(2)}
📂 Categoria: ${formatarCategoria(categoriaAtual)}
📝 Descrição: ${transacao.descricao}
💳 Pagamento: ${formatarFormaPagamento(transacao.forma_pagamento, cartaoNome)}
📅 Data: ${dataFormatada} às ${horaFormatada}
🆔 ID: TRX-${transacao.id.toString().slice(-4)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 **Resumo do mês**
💰 Saldo: R$ ${resumoMes.saldo.toFixed(2)}
📈 Entradas: R$ ${resumoMes.entradas.toFixed(2)}
📉 Saídas: R$ ${resumoMes.saidas.toFixed(2)}
📂 ${formatarCategoria(categoriaAtual)}: R$ ${totalCategoria.toFixed(2)}
`.trim();
}

// ============================================================================
// 🤖 IA ORQUESTRADORA
// ============================================================================

async function consultarIAOrquestradora(contexto: {
  mensagem_usuario: string;
  conversa_ativa: ConversaAtiva | null;
  historico_transacoes: any[];
  onboarding_step?: string | null;
}): Promise<DecisaoIA> {
  try {
    const historicoFormatado = contexto.historico_transacoes
      .slice(0, 5)
      .map(
        (t) =>
          `${t.tipo}: R$ ${t.valor} - ${t.descricao} (${t.categoria}, ${t.forma_pagamento})`
      )
      .join("\n");

    const promptContexto = `
MENSAGEM DO USUÁRIO: "${contexto.mensagem_usuario}"

${
  contexto.onboarding_step
    ? `
ONBOARDING EM ANDAMENTO
Etapa atual: ${contexto.onboarding_step}
`
    : ""
}

${
  contexto.conversa_ativa
    ? `
CONVERSA ATIVA:
Tipo: ${contexto.conversa_ativa.tipo_operacao}
Dados coletados: ${JSON.stringify(contexto.conversa_ativa.dados_coletados)}
Campos pendentes: ${contexto.conversa_ativa.campos_pendentes.join(", ")}
Última pergunta: ${contexto.conversa_ativa.ultima_pergunta_ia}
Mensagens anteriores: ${contexto.conversa_ativa.mensagens_usuario.join(" | ")}
`
    : ""
}

${
  historicoFormatado
    ? `
HISTÓRICO RECENTE (últimas 5 transações):
${historicoFormatado}
`
    : ""
}

Analise e responda em JSON puro (sem markdown).
`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: PROMPT_ORQUESTRADOR },
            { role: "user", content: promptContexto },
          ],
        }),
      }
    );

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    // Remove markdown se houver
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
    const decisao = JSON.parse(cleanJson) as DecisaoIA;

    console.log("🤖 [IA] Decisão:", JSON.stringify(decisao));
    return decisao;
  } catch (error) {
    console.error("❌ [IA] Erro:", error);
    return {
      acao: "erro",
      mensagem_usuario:
        "Ops, tive um problema técnico 😅\n\nPode tentar de novo?",
      usar_botoes: false,
    };
  }
}

// ============================================================================
// 🎤 PERCEPÇÃO (mantém original)
// ============================================================================

async function downloadWhatsAppMedia(mediaId: string): Promise<string | null> {
  try {
    const urlResponse = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
      }
    );

    if (!urlResponse.ok) return null;

    const urlData = await urlResponse.json();
    const mediaUrl = urlData.url;

    const mediaResponse = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
    });

    if (!mediaResponse.ok) return null;

    const arrayBuffer = await mediaResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    return base64;
  } catch (error) {
    console.error("Erro ao baixar mídia:", error);
    return null;
  }
}

async function transcreverAudio(audioBase64: string): Promise<string | null> {
  try {
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        Authorization: ASSEMBLYAI_API_KEY!,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    });

    if (!uploadResponse.ok) return null;

    const uploadData = await uploadResponse.json();
    const uploadUrl = uploadData.upload_url;

    const transcriptResponse = await fetch(
      "https://api.assemblyai.com/v2/transcript",
      {
        method: "POST",
        headers: {
          Authorization: ASSEMBLYAI_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio_url: uploadUrl,
          language_code: "pt",
          speech_model: "best",
        }),
      }
    );

    if (!transcriptResponse.ok) return null;

    const transcriptData = await transcriptResponse.json();
    const transcriptId = transcriptData.id;

    let status = "queued";
    let transcricaoFinal: string | null = null;
    let tentativas = 0;

    while (
      (status === "queued" || status === "processing") &&
      tentativas < 30
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const pollingResponse = await fetch(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: { Authorization: ASSEMBLYAI_API_KEY! },
        }
      );

      if (!pollingResponse.ok) {
        tentativas++;
        continue;
      }

      const pollingData = await pollingResponse.json();
      status = pollingData.status;

      if (status === "completed") {
        transcricaoFinal = pollingData.text;
        break;
      } else if (status === "error") {
        return null;
      }

      tentativas++;
    }

    return transcricaoFinal;
  } catch (error) {
    console.error("Erro ao transcrever:", error);
    return null;
  }
}

async function extrairDadosImagem(
  imageBase64: string,
  mimeType: string
): Promise<any> {
  try {
    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analise esta imagem financeira e extraia dados.

RESPONDA APENAS JSON (sem markdown):
{
  "tipo": "comprovante" | "nota_fiscal" | "outro",
  "valor": 150.50,
  "descricao": "Mercado XYZ",
  "forma_pagamento": "pix" | "debito" | "credito" | "dinheiro",
  "itens": [{"desc": "Arroz", "valor": 25.50}] ou null,
  "confianca": 0.9
}`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();

    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Erro ao analisar imagem:", error);
    return null;
  }
}

// ============================================================================
// 📱 ENVIO DE MENSAGENS
// ============================================================================

async function sendWhatsAppMessage(
  to: string,
  text: string,
  source: MessageSource = "meta"
): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");

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
          to: cleanNumber,
          type: "text",
          text: { body: text },
        }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error);
    return false;
  }
}

async function sendWhatsAppButtons(
  to: string,
  text: string,
  buttons: Array<{ id: string; texto: string }>
): Promise<boolean> {
  try {
    const cleanNumber = to.replace(/\D/g, "");

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
          to: cleanNumber,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text },
            action: {
              buttons: buttons.slice(0, 3).map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.texto },
              })),
            },
          },
        }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error("Erro ao enviar botões:", error);
    // Fallback para texto simples
    const fallbackText =
      text +
      "\n\n" +
      buttons.map((b, i) => `${i + 1}️⃣ ${b.texto}`).join("\n");
    return sendWhatsAppMessage(to, fallbackText);
  }
}

// ============================================================================
// 🚀 PROCESSADOR PRINCIPAL
// ============================================================================

async function processarMensagem(
  mensagem: string,
  userId: string,
  phoneNumber: string
): Promise<void> {
  console.log(`📥 [PROCESSAR] User: ${userId} | Msg: ${mensagem}`);

  // 1. Verifica onboarding
  const onboardingStep = await getOnboardingStep(userId);

  // 2. Busca conversa ativa
  const conversaAtiva = await getConversaAtiva(userId);

  // 3. Busca histórico
  const historico = await getUltimas10Transacoes(userId);

  // 4. Consulta IA
  const decisao = await consultarIAOrquestradora({
    mensagem_usuario: mensagem,
    conversa_ativa: conversaAtiva,
    historico_transacoes: historico,
    onboarding_step: onboardingStep,
  });

  console.log(`🎯 [DECISÃO] Ação: ${decisao.acao}`);

  // 5. Executa ação
  switch (decisao.acao) {
    case "onboarding": {
      // Salva dados do onboarding
      if (decisao.salvar_onboarding && decisao.onboarding_step) {
        await salvarOnboardingData(
          userId,
          onboardingStep || "renda",
          decisao.salvar_onboarding
        );
      }

      // Envia mensagem
      await sendWhatsAppMessage(phoneNumber, decisao.mensagem_usuario);
      break;
    }

    case "registrar": {
      // Registra transação
      const transacao: Transacao = {
        usuario_id: userId,
        valor: decisao.dados_completos.valor,
        tipo: decisao.dados_completos.tipo,
        descricao: decisao.dados_completos.descricao,
        categoria: decisao.dados_completos.categoria,
        forma_pagamento: decisao.dados_completos.forma_pagamento,
        cartao_id: decisao.dados_completos.cartao_id,
        data_transacao: new Date().toISOString(),
        origem: "whatsapp",
      };

      const transacaoSalva = await salvarTransacao(transacao);

      if (transacaoSalva) {
        // Limpa conversa ativa
        await limparConversaAtiva(userId);

        // Busca resumo
        const resumo = await getResumoMensal(userId);

        // Monta mensagem rica
        const mensagemRica = await montarMensagemRegistro(
          transacaoSalva,
          resumo
        );

        await sendWhatsAppMessage(phoneNumber, mensagemRica);
      } else {
        await sendWhatsAppMessage(
          phoneNumber,
          "Ops, erro ao salvar 😅\nTente novamente?"
        );
      }
      break;
    }

    case "coletar": {
      // Atualiza ou cria conversa ativa
      if (conversaAtiva) {
        await atualizarConversaAtiva(userId, {
          dados_coletados: {
            ...conversaAtiva.dados_coletados,
            ...decisao.campos_coletados,
          },
          campos_pendentes:
            decisao.atualizar_conversa?.campos_pendentes ||
            conversaAtiva.campos_pendentes,
          ultima_pergunta_ia:
            decisao.atualizar_conversa?.ultima_pergunta ||
            decisao.mensagem_usuario,
          mensagens_usuario: [
            ...conversaAtiva.mensagens_usuario,
            mensagem,
          ].slice(-5),
        });
      } else {
        await salvarConversaAtiva({
          usuario_id: userId,
          estado: "aguardando_dados",
          tipo_operacao:
            decisao.campos_coletados?.tipo_recorrencia ? "recorrente" : "gasto",
          dados_coletados: decisao.campos_coletados || {},
          campos_pendentes: decisao.atualizar_conversa?.campos_pendentes || [],
          mensagens_usuario: [mensagem],
          ultima_pergunta_ia: decisao.mensagem_usuario,
        });
      }

      // Envia mensagem (com ou sem botões)
      if (decisao.usar_botoes && decisao.botoes) {
        await sendWhatsAppButtons(
          phoneNumber,
          decisao.mensagem_usuario,
          decisao.botoes
        );
      } else {
        await sendWhatsAppMessage(phoneNumber, decisao.mensagem_usuario);
      }
      break;
    }

    case "erro": {
      await sendWhatsAppMessage(phoneNumber, decisao.mensagem_usuario);
      break;
    }
  }

  // Salva no histórico
  await supabase.from("historico_conversas").insert({
    phone_number: phoneNumber,
    user_id: userId,
    user_message: mensagem,
    ai_response: decisao.mensagem_usuario,
    tipo: decisao.acao,
  });
}

// ============================================================================
// 🌐 WEBHOOK
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verificação GET (Meta)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response("Forbidden", { status: 403 });
  }

  // POST
  try {
    const json = await req.json();
    console.log("📨 Webhook recebido");

    let phoneNumber = "";
    let messageText = "";
    let messageType: "text" | "audio" | "image" = "text";
    let mediaId: string | null = null;
    let mediaMimeType = "";

    // Parse Meta webhook
    if (json.entry?.[0]?.changes?.[0]?.value) {
      const value = json.entry[0].changes[0].value;

      if (!value.messages || value.messages.length === 0) {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const message = value.messages[0];
      phoneNumber = message.from;

      if (message.type === "text") {
        messageType = "text";
        messageText = message.text?.body || "";
      } else if (message.type === "audio") {
        messageType = "audio";
        mediaId = message.audio?.id || null;
        mediaMimeType = message.audio?.mime_type || "audio/ogg";
      } else if (message.type === "image") {
        messageType = "image";
        mediaId = message.image?.id || null;
        mediaMimeType = message.image?.mime_type || "image/jpeg";
      } else if (message.type === "interactive") {
        // Resposta de botão
        messageType = "text";
        messageText =
          message.interactive?.button_reply?.id ||
          message.interactive?.button_reply?.title ||
          "";
      } else {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!phoneNumber) {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca ou cria usuário
    let { data: usuario } = await supabase
      .from("usuarios")
      .select("*")
      .eq("phone_number", phoneNumber)
      .single();

    if (!usuario) {
      const { data: newUser } = await supabase
        .from("usuarios")
        .insert({
          phone_number: phoneNumber,
          plano: "trial",
          onboarding_status: "iniciado",
          onboarding_step: "renda",
        })
        .select()
        .single();

      usuario = newUser;

      // Envia onboarding inicial
      await sendWhatsAppMessage(
        phoneNumber,
        "Olá! 👋 Prazer, sou a Finax!\n\nVou te ajudar a organizar suas finanças de forma simples.\n\nPra começar, me conta: **quanto você costuma ganhar por mês?**\n\n_Pode ser aproximado, tipo 'uns 3 mil' ou 'varia entre 4k e 5k'_"
      );

      return new Response(JSON.stringify({ status: "ok", new_user: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const usuarioId = usuario.id;

    // Processa áudio
    if (messageType === "audio" && mediaId) {
      const audioBase64 = await downloadWhatsAppMedia(mediaId);
      if (!audioBase64) {
        await sendWhatsAppMessage(
          phoneNumber,
          "Não consegui baixar o áudio 😕\nTente novamente?"
        );
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const transcricao = await transcreverAudio(audioBase64);
      if (!transcricao) {
        await sendWhatsAppMessage(
          phoneNumber,
          "Não entendi o áudio 😕\nFala mais devagar ou escreve?"
        );
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      messageText = transcricao;
      messageType = "text";
    }

    // Processa imagem
    if (messageType === "image" && mediaId) {
      const imageBase64 = await downloadWhatsAppMedia(mediaId);
      if (!imageBase64) {
        await sendWhatsAppMessage(
          phoneNumber,
          "Não consegui baixar a imagem 😕\nTente novamente?"
        );
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dadosImagem = await extrairDadosImagem(imageBase64, mediaMimeType);

      if (!dadosImagem || dadosImagem.tipo === "outro") {
        await sendWhatsAppMessage(
          phoneNumber,
          "Não identifiquei dados financeiros nessa imagem 🤔\n\nMe conta o que era?"
        );
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Monta mensagem com dados da imagem
      messageText = `Vi na imagem: ${dadosImagem.descricao || "gasto"} de R$ ${
        dadosImagem.valor || "?"
      }`;

      if (dadosImagem.forma_pagamento) {
        messageText += ` via ${dadosImagem.forma_pagamento}`;
      }
    }

    // Processa mensagem
    if (messageText) {
      await processarMensagem(messageText, usuarioId, phoneNumber);
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("❌ Erro no webhook:", error);
    return new Response(
      JSON.stringify({ status: "error", message: String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
