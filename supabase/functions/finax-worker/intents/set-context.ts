// ============================================================================
// 📍 INTENT: SET_CONTEXT (Criar/encerrar contexto de gastos)
// ============================================================================

import { getActiveContext, createUserContext, closeUserContext } from "./context-handler.ts";
import { normalizeText } from "../utils/helpers.ts";
import { markAsExecuted } from "../utils/ai-decisions.ts";

export async function handleSetContext(
  userId: string,
  slots: Record<string, any>,
  conteudoProcessado: string,
  decisionId: string | null,
  sendMessage: (phone: string, msg: string, source: string) => Promise<void>,
  phoneNumber: string,
  messageSource: string
): Promise<void> {
  // Verificar se é encerramento de contexto
  const normalized = normalizeText(conteudoProcessado);
  if (normalized.includes("terminei") || normalized.includes("fim do") || normalized.includes("acabou") || normalized.includes("encerr")) {
    const result = await closeUserContext(userId);
    await sendMessage(phoneNumber, result.message, messageSource);
    return;
  }

  // Criar novo contexto
  try {
    const result = await createUserContext(userId, slots);
    if (decisionId) {
      await markAsExecuted(decisionId, result.success);
    }
    await sendMessage(phoneNumber, result.message, messageSource);
  } catch (ctxError) {
    console.error(`❌ [CONTEXT] Exception ao criar contexto:`, ctxError);
    await sendMessage(phoneNumber, "Ops, erro ao criar contexto 😕\n\nTenta assim: \"vou viajar de 18/02 até 28/02\"", messageSource);
  }
}
