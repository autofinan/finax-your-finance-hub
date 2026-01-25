// ============================================================================
// 📄 INTENT: BILLS (Contas a Pagar / Faturas Genéricas)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordMetric } from "../governance/config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📝 CRIAR CONTA A PAGAR
// ============================================================================

export interface CreateBillParams {
  userId: string;
  nome: string;
  tipo?: "cartao" | "fixa" | "variavel";
  diaVencimento?: number;
  valorEstimado?: number;
  lembrarDiasAntes?: number;
}

export async function createBill(params: CreateBillParams): Promise<string> {
  const {
    userId,
    nome,
    tipo = "fixa",
    diaVencimento,
    valorEstimado,
    lembrarDiasAntes = 3
  } = params;

  console.log(`📄 [BILLS] Criando conta: ${nome} - dia ${diaVencimento}`);

  try {
    const { data, error } = await supabase.from("contas_pagar").insert({
      usuario_id: userId,
      nome,
      tipo,
      dia_vencimento: diaVencimento,
      valor_estimado: valorEstimado,
      lembrar_dias_antes: lembrarDiasAntes,
      ativa: true
    }).select("id, nome, dia_vencimento").single();

    if (error) {
      console.error("❌ [BILLS] Erro ao criar conta:", error);
      return "❌ Não consegui criar a fatura. Tenta de novo?";
    }

    await recordMetric("bill_created", 1, { bill_id: data.id, user_id: userId });

    let response = `✅ *Fatura criada!*\n\n`;
    response += `📄 ${nome}\n`;
    
    if (diaVencimento) {
      response += `📅 Vence todo dia ${diaVencimento}\n`;
    }
    
    if (valorEstimado) {
      response += `💰 Valor estimado: R$ ${valorEstimado.toFixed(2)}\n`;
    }
    
    response += `🔔 Vou te lembrar ${lembrarDiasAntes} dias antes.\n\n`;
    response += `_Quando pagar, me avisa o valor!_`;

    return response;
  } catch (err) {
    console.error("❌ [BILLS] Erro ao criar conta:", err);
    return "❌ Erro ao criar fatura. Tenta novamente!";
  }
}

// ============================================================================
// 💸 REGISTRAR PAGAMENTO
// ============================================================================

export interface PayBillParams {
  userId: string;
  contaNome: string;
  valorPago: number;
  observacao?: string;
}

export async function payBill(params: PayBillParams): Promise<string> {
  const { userId, contaNome, valorPago, observacao } = params;

  console.log(`💸 [BILLS] Pagando conta: ${contaNome} - R$ ${valorPago}`);

  try {
    // Buscar conta pelo nome (fuzzy match)
    const { data: conta } = await supabase
      .from("contas_pagar")
      .select("id, nome, valor_estimado")
      .eq("usuario_id", userId)
      .eq("ativa", true)
      .ilike("nome", `%${contaNome}%`)
      .limit(1)
      .single();

    if (!conta) {
      return `❌ Não encontrei uma fatura com o nome "${contaNome}".\n\n` +
        `_Tente "minhas faturas" para ver a lista._`;
    }

    // Determinar mês de referência (mês atual)
    const mesReferencia = new Date();
    mesReferencia.setDate(1);

    // Registrar transação de saída
    const { data: transacao } = await supabase.from("transacoes").insert({
      usuario_id: userId,
      valor: valorPago,
      tipo: "saida",
      categoria: "Contas",
      descricao: conta.nome,
      data: new Date().toISOString(),
      origem: "whatsapp",
      forma_pagamento: "pix",
      status: "confirmada"
    }).select("id").single();

    // Registrar pagamento
    await supabase.from("pagamentos").insert({
      conta_id: conta.id,
      usuario_id: userId,
      mes_referencia: mesReferencia.toISOString().split("T")[0],
      valor_pago: valorPago,
      data_pagamento: new Date().toISOString(),
      status: "pago",
      transacao_id: transacao?.id,
      observacao
    });

    // Atualizar valor estimado com média
    if (conta.valor_estimado) {
      const novoEstimado = (conta.valor_estimado + valorPago) / 2;
      await supabase
        .from("contas_pagar")
        .update({ valor_estimado: novoEstimado })
        .eq("id", conta.id);
    } else {
      await supabase
        .from("contas_pagar")
        .update({ valor_estimado: valorPago })
        .eq("id", conta.id);
    }

    await recordMetric("bill_paid", valorPago, { bill_id: conta.id, user_id: userId });

    const mesNome = mesReferencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    return `✅ *Pagamento registrado!*\n\n` +
      `📄 ${conta.nome}\n` +
      `💸 R$ ${valorPago.toFixed(2)}\n` +
      `📅 Referência: ${mesNome}\n\n` +
      `_Gasto adicionado automaticamente! 📊_`;
  } catch (err) {
    console.error("❌ [BILLS] Erro ao pagar conta:", err);
    return "❌ Erro ao registrar pagamento. Tenta novamente!";
  }
}

// ============================================================================
// 📋 LISTAR CONTAS
// ============================================================================

export async function listBills(userId: string): Promise<string> {
  console.log(`📋 [BILLS] Listando contas para: ${userId}`);

  try {
    const { data: contas } = await supabase
      .from("contas_pagar")
      .select("id, nome, dia_vencimento, valor_estimado, tipo")
      .eq("usuario_id", userId)
      .eq("ativa", true)
      .order("dia_vencimento", { ascending: true });

    if (!contas || contas.length === 0) {
      return `📄 Você não tem faturas cadastradas.\n\n` +
        `_Diga "criar fatura energia dia 15" para começar!_`;
    }

    let response = `📄 *Suas Faturas* (${contas.length})\n\n`;

    for (const conta of contas) {
      const tipoEmoji = conta.tipo === "fixa" ? "📌" : conta.tipo === "cartao" ? "💳" : "📊";
      response += `${tipoEmoji} *${conta.nome}*\n`;
      
      if (conta.dia_vencimento) {
        response += `   📅 Vence dia ${conta.dia_vencimento}\n`;
      }
      
      if (conta.valor_estimado) {
        response += `   💰 ~R$ ${conta.valor_estimado.toFixed(2)}\n`;
      }
      
      response += `\n`;
    }

    response += `_Diga "paguei a [fatura], deu [valor]" para registrar._`;

    return response;
  } catch (err) {
    console.error("❌ [BILLS] Erro ao listar contas:", err);
    return "❌ Erro ao buscar faturas.";
  }
}

// ============================================================================
// 🗑️ DESATIVAR CONTA
// ============================================================================

export async function deactivateBill(userId: string, contaNome: string): Promise<string> {
  console.log(`🗑️ [BILLS] Desativando conta: ${contaNome}`);

  try {
    const { data: conta } = await supabase
      .from("contas_pagar")
      .select("id, nome")
      .eq("usuario_id", userId)
      .eq("ativa", true)
      .ilike("nome", `%${contaNome}%`)
      .limit(1)
      .single();

    if (!conta) {
      return `❌ Não encontrei uma fatura com o nome "${contaNome}".`;
    }

    await supabase
      .from("contas_pagar")
      .update({ ativa: false })
      .eq("id", conta.id);

    return `✅ Fatura *${conta.nome}* desativada!\n\n_Não vou mais te lembrar dela._`;
  } catch (err) {
    console.error("❌ [BILLS] Erro ao desativar conta:", err);
    return "❌ Erro ao desativar fatura.";
  }
}

// ============================================================================
// 🔔 BUSCAR CONTAS PARA LEMBRETE (usado pelo CRON)
// ============================================================================

export async function getBillsToRemind(): Promise<Array<{
  conta_id: string;
  usuario_id: string;
  nome: string;
  dia_vencimento: number;
  valor_estimado: number | null;
  phone_number: string;
  usuario_nome: string;
  dias_ate_vencimento: number;
}>> {
  const { data, error } = await supabase.rpc("fn_contas_para_lembrar");

  if (error) {
    console.error("❌ [BILLS] Erro ao buscar contas para lembrete:", error);
    return [];
  }

  return data || [];
}

// ============================================================================
// ✅ MARCAR LEMBRETE ENVIADO
// ============================================================================

export async function markReminderSent(contaId: string): Promise<void> {
  await supabase
    .from("contas_pagar")
    .update({ ultimo_lembrete: new Date().toISOString() })
    .eq("id", contaId);
}
