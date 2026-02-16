// ============================================================================
// 💳 CREDIT FLOW - Vinculação de Gastos no Crédito a Cartão/Fatura
// ============================================================================
// Quando o usuário registra gasto no crédito, este módulo:
// 1. Resolve qual cartão usar (único, múltiplos, ou cadastrar novo)
// 2. Busca/cria a fatura do mês atual
// 3. Atualiza o limite disponível do cartão
// 4. Vincula a transação à fatura
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots } from "../decision/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📋 TIPOS
// ============================================================================

export interface CreditResolutionResult {
  success: boolean;
  cardId?: string;
  cardName?: string;
  invoiceId?: string;
  limiteAntes?: number;
  limiteDepois?: number;
  needsCardSelection?: boolean;
  needsCardCreation?: boolean;
  cardOptions?: Array<{ id: string; nome: string }>;
  message: string;
  missingSlot?: string;
  cardButtons?: Array<{ id: string; title: string }>;
  useListMessage?: boolean;
  listSections?: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
}

export interface CardInfo {
  id: string;
  nome: string;
  limite_total: number;
  limite_disponivel: number;
  dia_fechamento: number | null;
  dia_vencimento: number | null;
}

export interface InvoiceInfo {
  id: string;
  cartao_id: string;
  mes: number;
  ano: number;
  valor_total: number;
  status: string;
}

// ============================================================================
// 🔧 RESOLVER CARTÃO PARA GASTO NO CRÉDITO
// ============================================================================

export async function resolveCreditCard(
  userId: string,
  slots: Record<string, any>
): Promise<CreditResolutionResult> {
  console.log(`💳 [CREDIT] Resolvendo cartão para gasto de R$ ${slots.amount}`);
  
  // 1. Buscar cartões ativos do usuário
  const cards = await listUserCards(userId);
  
  // ========================================================================
  // CASO 1: Nenhum cartão cadastrado → oferecer cadastro
  // ========================================================================
  if (cards.length === 0) {
    console.log(`💳 [CREDIT] Nenhum cartão encontrado`);
    return {
      success: false,
      needsCardCreation: true,
      message: "Você não tem cartões cadastrados 💳\n\n" +
               "Quer adicionar? Diga:\n" +
               "👉 *Adicionar cartão Nubank limite 5000*",
      missingSlot: "card"
    };
  }
  
  // ========================================================================
  // CASO 2: Já tem cartão especificado nos slots → usar esse
  // ========================================================================
  if (slots.card_id) {
    const selectedCard = cards.find(c => c.id === slots.card_id);
    if (selectedCard) {
      return await processCardSelection(userId, selectedCard, slots.amount!);
    }
  }
  
  if (slots.card) {
    const selectedCard = await findCardByName(userId, slots.card);
    if (selectedCard) {
      return await processCardSelection(userId, selectedCard, slots.amount!);
    }
  }
  
  // ========================================================================
  // CASO 3: Apenas 1 cartão → usar automaticamente
  // ========================================================================
  if (cards.length === 1) {
    console.log(`💳 [CREDIT] Único cartão: ${cards[0].nome}`);
    return await processCardSelection(userId, cards[0], slots.amount!);
  }
  
  // ========================================================================
  // CASO 4: 2-3 cartões → botões inline
  // ========================================================================
  if (cards.length <= 3) {
    console.log(`💳 [CREDIT] ${cards.length} cartões - botões inline`);
    return {
      success: false,
      needsCardSelection: true,
      cardOptions: cards.map(c => ({ id: c.id, nome: c.nome })),
      message: `💳 Qual cartão?`,
      missingSlot: "card",
      cardButtons: cards.map(c => ({ id: `card_${c.id}`, title: (c.nome || "Cartão").slice(0, 20) }))
    };
  }
  
  // ========================================================================
  // CASO 5: 4+ cartões → lista interativa direto (mais rápido)
  // ========================================================================
  console.log(`💳 [CREDIT] ${cards.length} cartões - lista interativa direta`);
  
  return {
    success: false,
    needsCardSelection: true,
    cardOptions: cards.map(c => ({ id: c.id, nome: c.nome })),
    message: `💳 Qual cartão?`,
    missingSlot: "card",
    useListMessage: true,
    listSections: [{
      title: "Seus cartões",
      rows: cards.map(c => {
        const disponivel = c.limite_disponivel ?? c.limite_total ?? 0;
        return {
          id: `card_${c.id}`,
          title: (c.nome || "Cartão").slice(0, 24),
          description: `Disponível: R$ ${disponivel.toFixed(2)}`
        };
      })
    }]
  };
}

// ============================================================================
// 💳 PROCESSAR SELEÇÃO DE CARTÃO
// ============================================================================

async function processCardSelection(
  userId: string,
  card: CardInfo,
  amount: number
): Promise<CreditResolutionResult> {
  console.log(`💳 [CREDIT] Processando: ${card.nome} | Valor: R$ ${amount}`);
  
  // ========================================================================
  // 1. VERIFICAR LIMITE DISPONÍVEL
  // ========================================================================
  if (card.limite_disponivel !== null && card.limite_disponivel < amount) {
    console.log(`⚠️ [CREDIT] Limite insuficiente: R$ ${card.limite_disponivel} < R$ ${amount}`);
    const faltam = amount - card.limite_disponivel;
    return {
      success: false,
      message: `❌ Limite insuficiente no *${card.nome}*!\n\n` +
               `Disponível: R$ ${card.limite_disponivel.toFixed(2)}\n` +
               `Necessário: R$ ${amount.toFixed(2)}\n` +
               `Faltam: R$ ${faltam.toFixed(2)}\n\n` +
               `O que quer fazer?`,
      missingSlot: "card",
      cardButtons: [
        { id: "limit_force_yes", title: "✅ Registrar assim" },
        { id: "limit_other_card", title: "💳 Outro cartão" },
        { id: "limit_cancel", title: "❌ Cancelar" }
      ]
    };
  }
  
  // ========================================================================
  // 2. BUSCAR OU CRIAR FATURA DO MÊS
  // ========================================================================
  const invoice = await getOrCreateInvoice(userId, card.id, card.dia_fechamento);
  
  // ========================================================================
  // 3. ATUALIZAR LIMITE DISPONÍVEL DO CARTÃO
  // ========================================================================
  const novoLimite = Math.max(0, (card.limite_disponivel || card.limite_total) - amount);
  
  await supabase
    .from("cartoes_credito")
    .update({ limite_disponivel: novoLimite })
    .eq("id", card.id);
  
  console.log(`💳 [CREDIT] Limite atualizado: R$ ${card.limite_disponivel} → R$ ${novoLimite}`);
  
  // ========================================================================
  // 4. ATUALIZAR VALOR TOTAL DA FATURA
  // ========================================================================
  await supabase
    .from("faturas_cartao")
    .update({ 
      valor_total: (invoice.valor_total || 0) + amount,
      updated_at: new Date().toISOString()
    })
    .eq("id", invoice.id);
  
  console.log(`📄 [CREDIT] Fatura ${invoice.mes}/${invoice.ano} atualizada: +R$ ${amount}`);
  
  // ========================================================================
  // 5. REGISTRAR LOG
  // ========================================================================
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "credit_expense_linked",
    entity_type: "cartao",
    entity_id: card.id,
    new_data: {
      card_name: card.nome,
      amount,
      invoice_id: invoice.id,
      limite_antes: card.limite_disponivel,
      limite_depois: novoLimite
    }
  });
  
  return {
    success: true,
    cardId: card.id,
    cardName: card.nome,
    invoiceId: invoice.id,
    limiteAntes: card.limite_disponivel,
    limiteDepois: novoLimite,
    message: ""
  };
}

// ============================================================================
// 📄 BUSCAR OU CRIAR FATURA DO MÊS
// ============================================================================

export async function getOrCreateInvoice(
  userId: string,
  cardId: string,
  diaFechamento?: number | null
): Promise<InvoiceInfo> {
  // Usar horário de Brasília (UTC-3)
  const now = new Date();
  const brasiliaOffset = -3 * 60; // minutes
  const brasiliaTime = new Date(now.getTime() + (brasiliaOffset - now.getTimezoneOffset()) * 60000);
  const diaAtual = brasiliaTime.getDate();
  let mes = brasiliaTime.getMonth() + 1;
  let ano = brasiliaTime.getFullYear();
  
  if (diaFechamento && diaAtual >= diaFechamento) {
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  
  console.log(`📄 [INVOICE] Buscando fatura ${mes}/${ano} do cartão ${cardId.slice(-8)}`);
  
  const { data: existingInvoice } = await supabase
    .from("faturas_cartao")
    .select("*")
    .eq("usuario_id", userId)
    .eq("cartao_id", cardId)
    .eq("mes", mes)
    .eq("ano", ano)
    .maybeSingle();
  
  if (existingInvoice) {
    console.log(`📄 [INVOICE] Fatura existente encontrada: ${existingInvoice.id.slice(-8)}`);
    return existingInvoice as InvoiceInfo;
  }
  
  const { data: newInvoice, error } = await supabase
    .from("faturas_cartao")
    .insert({
      usuario_id: userId,
      cartao_id: cardId,
      mes,
      ano,
      valor_total: 0,
      valor_pago: 0,
      status: "aberta"
    })
    .select()
    .single();
  
  if (error) {
    console.error(`❌ [INVOICE] Erro ao criar fatura:`, error);
    throw error;
  }
  
  console.log(`📄 [INVOICE] Nova fatura criada: ${newInvoice.id.slice(-8)} (${mes}/${ano})`);
  
  return newInvoice as InvoiceInfo;
}

// ============================================================================
// 📋 LISTAR CARTÕES DO USUÁRIO
// ============================================================================

export async function listUserCards(userId: string): Promise<CardInfo[]> {
  const { data } = await supabase
    .from("cartoes_credito")
    .select("id, nome, limite_total, limite_disponivel, dia_fechamento, dia_vencimento")
    .eq("usuario_id", userId)
    .eq("ativo", true)
    .order("created_at", { ascending: false });
  
  return (data || []) as CardInfo[];
}

// ============================================================================
// 🔍 BUSCAR CARTÃO POR NOME (FUZZY)
// ============================================================================

export async function findCardByName(userId: string, cardName: string): Promise<CardInfo | null> {
  const cards = await listUserCards(userId);
  
  const nameLower = cardName.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  const found = cards.find(c => {
    const cardNameNorm = (c.nome || "").toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    
    return cardNameNorm.includes(nameLower) || nameLower.includes(cardNameNorm);
  });
  
  return found || null;
}

// ============================================================================
// 💰 RESTAURAR LIMITE AO PAGAR FATURA
// ============================================================================

export async function restoreCardLimitOnPayment(
  cardId: string,
  invoiceId: string,
  valorPago: number
): Promise<void> {
  console.log(`💳 [CREDIT] Restaurando limite: +R$ ${valorPago}`);
  
  const { data: card } = await supabase
    .from("cartoes_credito")
    .select("limite_disponivel, limite_total")
    .eq("id", cardId)
    .single();
  
  if (!card) return;
  
  // Buscar fatura para verificar pagamento parcial vs total
  const { data: fatura } = await supabase
    .from("faturas_cartao")
    .select("valor_total, valor_pago")
    .eq("id", invoiceId)
    .single();
  
  if (!fatura) return;
  
  const novoLimite = Math.min(
    card.limite_total!,
    (card.limite_disponivel || 0) + valorPago
  );
  
  await supabase
    .from("cartoes_credito")
    .update({ limite_disponivel: novoLimite })
    .eq("id", cardId);
  
  // Calcular total pago (acumulado + novo pagamento)
  const totalPago = (fatura.valor_pago || 0) + valorPago;
  const valorTotal = fatura.valor_total || 0;
  
  // Pagamento total ou parcial?
  const isPagamentoTotal = totalPago >= valorTotal;
  
  await supabase
    .from("faturas_cartao")
    .update({ 
      valor_pago: totalPago,
      status: isPagamentoTotal ? "paga" : "fechada",
      updated_at: new Date().toISOString()
    })
    .eq("id", invoiceId);
  
  console.log(`💳 [CREDIT] Limite restaurado: R$ ${card.limite_disponivel} → R$ ${novoLimite} | Pagamento ${isPagamentoTotal ? 'TOTAL' : 'PARCIAL'} (${totalPago}/${valorTotal})`);
}

// ============================================================================
// 📊 RELATÓRIO DE FATURA
// ============================================================================

export async function getInvoiceSummary(userId: string, cardId?: string): Promise<string> {
  const hoje = new Date();
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();
  
  let query = supabase
    .from("faturas_cartao")
    .select(`
      *,
      cartoes_credito(nome)
    `)
    .eq("usuario_id", userId)
    .eq("mes", mes)
    .eq("ano", ano);
  
  if (cardId) {
    query = query.eq("cartao_id", cardId);
  }
  
  const { data: faturas } = await query;
  
  if (!faturas || faturas.length === 0) {
    return "📄 Nenhuma fatura aberta este mês.";
  }
  
  let response = `📄 *Faturas de ${mes}/${ano}*\n\n`;
  
  for (const fatura of faturas) {
    const cardName = (fatura.cartoes_credito as any)?.nome || "Cartão";
    const statusEmoji = fatura.status === "paga" ? "✅" : fatura.status === "fechada" ? "🔒" : "📂";
    
    response += `${statusEmoji} *${cardName}*\n`;
    response += `   💸 Total: R$ ${(fatura.valor_total || 0).toFixed(2)}\n`;
    if (fatura.valor_pago > 0) {
      response += `   ✅ Pago: R$ ${fatura.valor_pago.toFixed(2)}\n`;
    }
    response += `\n`;
  }
  
  return response;
}
