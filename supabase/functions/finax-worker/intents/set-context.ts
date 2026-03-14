import { createUserContext, getActiveContext, closeUserContext } from "./context-handler.ts";

export async function handleSetContext(
  userId: string,
  slots: Record<string, any>,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  const label = slots.context_label || slots.description || "Contexto";

  const activeCtx = await getActiveContext(userId);
  if (activeCtx) {
    await closeUserContext(userId);
  }

  await createUserContext(userId, label);

  const message = `📍 *Contexto ativado: ${label}*\n\nA partir de agora, seus gastos serão vinculados a "${label}".\n\nQuando terminar, diga "encerrar contexto".`;
  await sendMessage(phoneNumber, message, messageSource);
}
