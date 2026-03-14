// ============================================================================
// 🔁 DUPLICATE EXPENSE HANDLER - confirmação robusta de duplicatas
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ExtractedSlots } from "../decision/ai-engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type MessageSource = "meta" | "vonage";

type DuplicateAction = {
  id: string;
  intent: string;
  slots: Record<string, any>;
  status: string;
};

type RegisterExpenseFn = (
  userId: string,
  slots: ExtractedSlots,
  actionId?: string,
) => Promise<{ success: boolean; message: string }>;

type CloseActionFn = (actionId: string, entityId?: string) => Promise<void>;
type SendMessageFn = (to: string, text: string, src: MessageSource) => Promise<boolean | void>;

const DUPLICATE_ACTION_STATUSES = ["collecting", "awaiting_input", "pending_selection", "awaiting_confirmation"];

async function findPendingDuplicateAction(userId: string): Promise<DuplicateAction | null> {
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("actions")
    .select("id, action_type, slots, status, created_at")
    .eq("user_id", userId)
    .eq("action_type", "duplicate_expense")
    .in("status", DUPLICATE_ACTION_STATUSES)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    intent: data.action_type,
    slots: (data.slots || {}) as Record<string, any>,
    status: data.status || "collecting",
  };
}

async function resolveDuplicateAction(userId: string, activeAction: DuplicateAction | null): Promise<DuplicateAction | null> {
  if (activeAction?.intent === "duplicate_expense") return activeAction;
  return await findPendingDuplicateAction(userId);
}

export async function handleDuplicateConfirmNo(params: {
  userId: string;
  activeAction: DuplicateAction | null;
  phoneNumber: string;
  messageSource: MessageSource;
  closeAction: CloseActionFn;
  sendMessage: SendMessageFn;
}): Promise<void> {
  const action = await resolveDuplicateAction(params.userId, params.activeAction);
  if (action) {
    await params.closeAction(action.id);
  }

  await params.sendMessage(params.phoneNumber, "Ok, não vou registrar! 👍", params.messageSource);
}

export async function handleDuplicateConfirmYes(params: {
  userId: string;
  activeAction: DuplicateAction | null;
  phoneNumber: string;
  messageSource: MessageSource;
  registerExpense: RegisterExpenseFn;
  closeAction: CloseActionFn;
  sendMessage: SendMessageFn;
}): Promise<void> {
  const action = await resolveDuplicateAction(params.userId, params.activeAction);

  if (!action) {
    await params.sendMessage(
      params.phoneNumber,
      "⚠️ Esse botão expirou. Me manda o gasto novamente para eu registrar certinho.",
      params.messageSource,
    );
    return;
  }

  const slots = { ...(action.slots as ExtractedSlots), _skip_duplicate: true };
  await params.closeAction(action.id);

  const result = await params.registerExpense(params.userId, slots);
  await params.sendMessage(params.phoneNumber, result.message, params.messageSource);
}
