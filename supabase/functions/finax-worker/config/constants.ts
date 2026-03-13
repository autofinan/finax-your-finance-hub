export const SITE_URL = "https://finaxai.vercel.app";

export const PRICE_BASICO = "R$ 19,90/mês";
export const PRICE_PRO = "R$ 29,90/mês";

export const PLAN_BASICO = "basico" as const;
export const PLAN_PRO = "pro" as const;
export const PLAN_TRIAL = "trial" as const;

export const PRO_ONLY_INTENTS = [
  "query_alerts",
  "purchase", 
  "query_freedom",
  "simulate_debts"
];

export const PRO_TEASER_INTENTS: Record<string, string> = {
  query_alerts: "🚨 Alertas Proativos são exclusivos do plano Pro!",
  purchase: "🛒 Consultor de Compras é exclusivo do plano Pro!",
  query_freedom: "🏁 Previsão de Liberdade Financeira é exclusiva do plano Pro!",
  simulate_debts: "📊 Simulador de Quitação é exclusivo do plano Pro!",
};

export const CHAT_CONFIDENCE_THRESHOLD = 0.85;
export const HISTORY_CONTEXT_LIMIT = 10;
export const SIMULTANEOUS_MSG_WINDOW_MS = 2000;
export const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
export const STRIPE_IMPORT_URL = "https://esm.sh/stripe@14.21.0?target=deno";
