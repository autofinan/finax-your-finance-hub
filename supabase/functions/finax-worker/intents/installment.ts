// ============================================================================
// 📦 INTENT: INSTALLMENT (Parcelamento no Crédito)
// ============================================================================
// Quando o usuário diz "celular 1200 em 12x", este módulo:
// 1. Cria transação mãe (compra parcelada)
// 2. Gera parcelas individuais vinculadas a faturas futuras
// 3. Deduz o LIMITE TOTAL do cartão (compromisso total)
// 4. Cada parcela vai para a fatura do mês correspondente
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ExtractedSlots, SLOT_REQUIREMENTS } from "../decision/types.ts";
import { closeAction } from "../context/manager.ts";
import { findCardByName, listUserCards, CardInfo } from "./credit-flow.ts";
import { categorizeDescription } from "../ai/categorizer.ts";
import { getBrasiliaISO } from "../utils/date-helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📋 TIPOS
// ============================================================================

export interface InstallmentResult {
  success: boolean;
  message: string;
  transactionId?: string;
  installmentIds?: string[];
  needsCardSelection?: boolean;
  cardButtons?: Array<{ id: string; title: string }>;
  missingSlot?: string;
}

export interface InstallmentSlots extends ExtractedSlots {
  amount: number;            // Valor TOTAL
  installments: number;      // Número de parcelas
  description?: string;      // Descrição
  card?: string;             // Nome do cartão
  card_id?: string;          // ID do cartão
  category?: string;         // Categoria
}

// ============================================================================
// 📦 REGISTRAR PARCELAMENTO
// ============================================================================

export async function registerInstallment(
  userId: string,
  slots: InstallmentSlots,
  actionId?: string
): Promise<InstallmentResult> {
  console.log(`📦 [INSTALLMENT] Registrando: ${JSON.stringify(slots)}`);
  
  // ========================================================================
  // VALIDAÇÕES
  // ========================================================================
  
  if (!slots.amount || slots.amount <= 0) {
    return {
      success: false,
      message: "Qual o valor total da compra? 💸",
      missingSlot: "amount"
    };
  }
  
  if (!slots.installments || slots.installments < 2) {
    return {
      success: false,
      message: "Em quantas vezes? (ex: 3x, 12x)",
      missingSlot: "installments"
    };
  }
  
  // ========================================================================
  // RESOLVER CARTÃO
  // ========================================================================
  
  const cards = await listUserCards(userId);
  
  if (cards.length === 0) {
    return {
      success: false,
      message: "Você não tem cartões cadastrados 💳\n\n" +
               "Quer adicionar? Diga:\n" +
               "👉 *Adicionar cartão Nubank limite 5000*",
      missingSlot: "card"
    };
  }
  
  let selectedCard: CardInfo | null = null;
  
  // Cartão já especificado por ID
  if (slots.card_id) {
    selectedCard = cards.find(c => c.id === slots.card_id) || null;
  }
  // Cartão especificado por nome
  else if (slots.card) {
    selectedCard = await findCardByName(userId, slots.card);
  }
  // Apenas 1 cartão → usar automaticamente
  else if (cards.length === 1) {
    selectedCard = cards[0];
  }
  
  // Precisa escolher cartão
  if (!selectedCard) {
    // Retornar com cardButtons para o caller usar sendButtons/sendListMessage
    const cardButtons = cards.slice(0, 3).map(c => ({ 
      id: `card_${c.id}`, 
      title: (c.nome || "Cartão").slice(0, 20) 
    }));
    
    return {
      success: false,
      needsCardSelection: true,
      message: `💳 Qual cartão?`,
      missingSlot: "card",
      cardButtons
    };
  }
  
  // ========================================================================
  // VERIFICAR LIMITE (TOTAL, não por parcela)
  // ========================================================================
  
  const valorTotal = slots.amount;
  const numParcelas = slots.installments;
  const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
  
  if (selectedCard.limite_disponivel !== null && selectedCard.limite_disponivel < valorTotal) {
    console.log(`⚠️ [INSTALLMENT] Limite insuficiente: R$ ${selectedCard.limite_disponivel} < R$ ${valorTotal}`);
    // Apenas avisa, não bloqueia
  }
  
  // ========================================================================
  // CATEGORIZAÇÃO IA
  // ========================================================================
  
  let category = slots.category || "outros";
  
  if (slots.description && !slots.category) {
    const categoryResult = await categorizeDescription(slots.description);
    category = categoryResult.category;
    console.log(`📂 [INSTALLMENT] Categorizado: ${category}`);
  }
  
  // ========================================================================
  // 1. CRIAR TRANSAÇÃO MÃE (COMPRA PARCELADA)
  // ========================================================================
  
  // ✅ CORREÇÃO: getBrasiliaISO() sem argumento — usa new Date() internamente
  const { dateISO, timeString } = getBrasiliaISO();
  
  // ✅ Transação mãe usa valor_parcela (não valor_total) - é a primeira parcela
  const { data: parentTx, error: txError } = await supabase
    .from("transacoes")
    .insert({
      usuario_id: userId,
      valor: valorParcela,
      tipo: "saida",
      categoria: category,
      descricao: `${slots.description || "Parcelado"} (1/${numParcelas})`,
      data: dateISO,
      data_transacao: dateISO,
      hora_transacao: timeString,
      origem: "whatsapp",
      forma_pagamento: "credito",
      status: "confirmada",
      id_cartao: selectedCard.id,
      parcela: `1/${numParcelas}`,
      is_parcelado: true,
      total_parcelas: numParcelas
    })
    .select("id")
    .single();
  
  if (txError) {
    console.error("❌ [INSTALLMENT] Erro ao criar transação mãe:", txError);
    return {
      success: false,
      message: "Ops, algo deu errado ao registrar 😕"
    };
  }
  
  console.log(`✅ [INSTALLMENT] Transação mãe criada: ${parentTx.id}`);
  
  // ========================================================================
  // 2. GERAR PARCELAS INDIVIDUAIS COM FATURAS FUTURAS
  // ========================================================================
  
  const parcelas: any[] = [];
  const installmentIds: string[] = [];
  
  for (let i = 1; i <= numParcelas; i++) {
    // Calcular mês/ano da fatura para esta parcela
    const invoiceOffset = i - 1; // Primeira parcela = mês atual
    const invoice = await getOrCreateFutureInvoice(
      userId, 
      selectedCard.id, 
      selectedCard.dia_fechamento,
      invoiceOffset
    );
    
    // Criar registro de parcela
    parcelas.push({
      parcelamento_id: parentTx.id,
      usuario_id: userId,
      numero_parcela: i,
      total_parcelas: numParcelas,
      valor: valorParcela,
      fatura_id: invoice.id,
      cartao_id: selectedCard.id,
      status: i === 1 ? "pendente" : "futura",
      mes_referencia: `${invoice.ano}-${String(invoice.mes).padStart(2, "0")}-01`,
      descricao: slots.description || "Parcelado"
    });
  }
  
  // Inserir todas as parcelas
  const { data: insertedParcelas, error: parcelasError } = await supabase
    .from("parcelas")
    .insert(parcelas)
    .select("id");
  
  if (parcelasError) {
    console.error("❌ [INSTALLMENT] Erro ao criar parcelas:", parcelasError);
    // Transação mãe já foi criada, então continua
  } else {
    installmentIds.push(...(insertedParcelas?.map(p => p.id) || []));
    console.log(`✅ [INSTALLMENT] ${numParcelas} parcelas criadas`);
  }
  
  // ========================================================================
  // 3. ATUALIZAR FATURAS COM VALOR DAS PARCELAS
  // ========================================================================
  
  // Agrupar parcelas por fatura para atualizar valor_total
  const faturaValues = new Map<string, number>();
  for (const parcela of parcelas) {
    const current = faturaValues.get(parcela.fatura_id) || 0;
    faturaValues.set(parcela.fatura_id, current + parcela.valor);
  }
  
  for (const [faturaId, valorAdicional] of faturaValues) {
    // Buscar valor atual da fatura
    const { data: fatura } = await supabase
      .from("faturas_cartao")
      .select("valor_total")
      .eq("id", faturaId)
      .single();
    
    // Atualizar com valor adicionado
    await supabase
      .from("faturas_cartao")
      .update({ 
        valor_total: ((fatura?.valor_total as number) || 0) + valorAdicional,
        updated_at: new Date().toISOString()
      })
      .eq("id", faturaId);
  }
  
  // ========================================================================
  // 4. DEDUZIR LIMITE TOTAL DO CARTÃO (COMPROMISSO)
  // ========================================================================
  
  const novoLimite = Math.max(0, (selectedCard.limite_disponivel ?? selectedCard.limite_total) - valorTotal);
  
  await supabase
    .from("cartoes_credito")
    .update({ limite_disponivel: novoLimite })
    .eq("id", selectedCard.id);
  
  console.log(`💳 [INSTALLMENT] Limite atualizado: R$ ${selectedCard.limite_disponivel} → R$ ${novoLimite}`);
  
  // ========================================================================
  // 5. CRIAR REGISTRO EM PARCELAMENTOS (para aparecer no site)
  // ========================================================================
  
  await supabase.from("parcelamentos").insert({
    usuario_id: userId,
    descricao: slots.description || "Compra parcelada",
    valor_total: valorTotal,
    num_parcelas: numParcelas,
    parcela_atual: 1,
    valor_parcela: valorParcela,
    ativa: true,
  }).then(({ error: parcelamentoError }) => {
    if (parcelamentoError) {
      console.error("⚠️ [INSTALLMENT] Erro ao criar registro em parcelamentos:", parcelamentoError);
    } else {
      console.log("✅ [INSTALLMENT] Registro em parcelamentos criado");
    }
  });
  
  // ========================================================================
  // 6. FECHAR ACTION E LOG
  // ========================================================================
  
  if (actionId) {
    await closeAction(actionId, parentTx.id);
  }
  
  await supabase.from("finax_logs").insert({
    user_id: userId,
    action_type: "registrar_parcelamento",
    entity_type: "transacao",
    entity_id: parentTx.id,
    new_data: {
      valor_total: valorTotal,
      num_parcelas: numParcelas,
      valor_parcela: valorParcela,
      cartao: selectedCard.nome,
      categoria: category
    }
  });
  
  // ========================================================================
  // 6. RESPOSTA AMIGÁVEL
  // ========================================================================
  
  const message = `✅ *Parcelamento registrado!*\n\n` +
    `📦 *${slots.description || "Compra parcelada"}*\n` +
    `💳 ${selectedCard.nome}\n` +
    `💰 R$ ${valorTotal.toFixed(2)} em *${numParcelas}x* de R$ ${valorParcela.toFixed(2)}\n\n` +
    `📊 Cada parcela vai entrar na fatura do mês!\n` +
    `💳 Limite disponível: R$ ${novoLimite.toFixed(2)}\n\n` +
    `_Mandou errado? Responda "cancelar"!_`;
  
  return {
    success: true,
    message,
    transactionId: parentTx.id,
    installmentIds
  };
}

// ============================================================================
// 📄 BUSCAR OU CRIAR FATURA FUTURA
// ============================================================================

async function getOrCreateFutureInvoice(
  userId: string,
  cardId: string,
  diaFechamento?: number | null,
  monthOffset: number = 0
): Promise<{ id: string; mes: number; ano: number }> {
  const hoje = new Date();
  let mes = hoje.getMonth() + 1;
  let ano = hoje.getFullYear();
  
  // Se já passou do dia de fechamento, a compra vai para a próxima fatura
  if (diaFechamento && hoje.getDate() >= diaFechamento) {
    mes += 1;
  }
  
  // Aplicar offset de meses
  mes += monthOffset;
  
  // Ajustar virada de ano
  while (mes > 12) {
    mes -= 12;
    ano += 1;
  }
  
  console.log(`📄 [INVOICE] Buscando/criando fatura ${mes}/${ano} (offset: ${monthOffset})`);
  
  // Buscar fatura existente
  const { data: existingInvoice } = await supabase
    .from("faturas_cartao")
    .select("id, mes, ano")
    .eq("usuario_id", userId)
    .eq("cartao_id", cardId)
    .eq("mes", mes)
    .eq("ano", ano)
    .maybeSingle();
  
  if (existingInvoice) {
    return existingInvoice;
  }
  
  // Criar nova fatura
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
    .select("id, mes, ano")
    .single();
  
  if (error) {
    console.error(`❌ [INVOICE] Erro ao criar fatura futura:`, error);
    throw error;
  }
  
  console.log(`📄 [INVOICE] Nova fatura futura criada: ${mes}/${ano}`);
  
  return newInvoice;
}

// ============================================================================
// 🔧 HELPERS
// ============================================================================

export function getMissingInstallmentSlots(slots: ExtractedSlots): string[] {
  const requirements = SLOT_REQUIREMENTS.installment || { required: ["amount", "installments"], optional: [] };
  return requirements.required.filter(slot => !slots[slot]);
}

export function hasAllRequiredInstallmentSlots(slots: ExtractedSlots): boolean {
  return getMissingInstallmentSlots(slots).length === 0;
}
