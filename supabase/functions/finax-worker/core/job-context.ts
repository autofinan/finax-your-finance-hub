import { type ExtractedSlots } from "../decision/ai-engine.ts";

export type MessageSource = "meta" | "vonage";

export interface JobPayload {
  phoneNumber: string;
  messageText: string;
  messageType: "text" | "audio" | "image";
  messageId: string;
  mediaId: string | null;
  mediaMimeType: string;
  messageSource: MessageSource;
  nomeContato: string | null;
  evento_id: string | null;
  buttonReplyId: string | null;
  listReplyId?: string | null;
  replyToMessageId?: string | null;
}

export interface ActiveAction {
  id: string;
  user_id: string;
  type: string;
  intent: string;
  slots: Record<string, any>;
  status: string;
  pending_slot?: string | null;
  pending_selection_id?: string | null;
  origin_message_id?: string | null;
  last_message_id?: string | null;
  meta?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface DecisionOutput {
  actionType: string;
  confidence: number;
  reasoning: string;
  slots: ExtractedSlots;
  missingSlots: string[];
  shouldExecute: boolean;
  shouldAsk: boolean;
  question: string | null;
  buttons: Array<{ id: string; title: string }> | null;
  decisionId?: string | null;
}

export interface JobContext {
  supabase: any;
  userId: string;
  phoneNumber: string;
  messageSource: MessageSource;
  payload: JobPayload;
  userPlano: string;
  isProUser: boolean;
  nomeUsuario: string;
  activeAction: ActiveAction | null;
  decision: DecisionOutput;
  conteudoProcessado: string;
  transactionDate: string | null;
  elitePatternApplied: boolean;
  patternRequiresConfirmation: boolean;
  patternId: string | null;
  patternCardName: string | null;
  sendMessage: (phone: string, msg: string, source: MessageSource) => Promise<void>;
  sendButtons: (phone: string, text: string, buttons: Array<{ id: string; title: string }>, source: MessageSource) => Promise<void>;
  sendListMessage: (phone: string, body: string, buttonText: string, sections: any[], source: MessageSource) => Promise<void>;
}

export type IntentHandler = (ctx: JobContext) => Promise<void>;
