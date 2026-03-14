import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { updateTransactionPaymentMethod } from "./cancel-handler.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export async function handleEdit(
  userId: string,
  slots: Record<string, any>,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  const { data: lastTx } = await supabase
    .from("transacoes")
    .select("id, descricao, valor, forma_pagamento")
    .eq("usuario_id", userId)
    .eq("tipo", "saida")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastTx) {
    await sendMessage(phoneNumber, "Não encontrei nenhuma transação recente para corrigir 🤔", messageSource);
    return;
  }

  const newPayment = slots.new_payment_method || slots.payment_method;

  if (newPayment && ["pix", "dinheiro", "credito", "debito"].includes(newPayment)) {
    const result = await updateTransactionPaymentMethod(lastTx.id, newPayment);
    if (result.success) {
      await sendMessage(
        phoneNumber,
        `✅ *Corrigido!*\n\n📝 ${lastTx.descricao}\n💰 R$ ${(lastTx.valor ?? 0).toFixed(2)}\n💳 ${lastTx.forma_pagamento} → ${newPayment}`,
        messageSource
      );
    } else {
      await sendMessage(phoneNumber, "Erro ao corrigir 😕 Tenta de novo.", messageSource);
    }
    return;
  }

  await sendButtons(
    phoneNumber,
    `Qual a forma de pagamento correta para:\n📝 ${lastTx.descricao} — R$ ${(lastTx.valor ?? 0).toFixed(2)}?`,
    [
      { id: "edit_pix", title: "Pix" },
      { id: "edit_dinheiro", title: "Dinheiro" },
      { id: "edit_credito", title: "Crédito" }
    ],
    messageSource
  );
}
