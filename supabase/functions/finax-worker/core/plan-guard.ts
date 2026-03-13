import { PRO_ONLY_INTENTS, PRO_TEASER_INTENTS } from "../config/constants.ts";

export function isProUser(plano: string, trialFim: string | null): boolean {
  if (plano === "pro") return true;
  if (plano === "trial" && trialFim && new Date(trialFim) > new Date()) return true;
  return false;
}

export function isTrialExpired(plano: string, trialFim: string | null): boolean {
  if (plano !== "trial") return false;
  if (!trialFim) return false;
  return new Date(trialFim) < new Date();
}

export function isProOnlyIntent(actionType: string): boolean {
  return PRO_ONLY_INTENTS.includes(actionType);
}

export function getProTeaser(actionType: string): string {
  return PRO_TEASER_INTENTS[actionType] ?? "⭐ Este recurso é exclusivo do plano Pro!";
}
