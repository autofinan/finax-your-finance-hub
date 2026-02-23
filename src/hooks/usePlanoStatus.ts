import { useAuth } from '@/contexts/AuthContext';

// ============================================================================
// 🎯 FEATURE GATING SYSTEM - Finax
// ============================================================================

export type Plano = 'trial' | 'basico' | 'pro';

export type Feature =
  // Core (todos)
  | 'expense_tracking'
  | 'basic_dashboard'
  | 'categories'
  // Básico + Pro
  | 'unlimited_budgets'
  | 'budget_alerts'
  | 'basic_goals'
  | 'debt_tracking_basic'
  | 'basic_insights'
  | 'weekly_reports'
  | 'monthly_reports'
  | 'expense_history_full'
  | 'installments_basic'
  | 'recurring_expenses'
  | 'csv_export'
  | 'basic_card'
  // Pro only
  | 'debt_simulator'
  | 'debt_interest_calc'
  | 'debt_freedom_projection'
  | 'predictive_insights'
  | 'ai_consultant'
  | 'pattern_detector'
  | 'risk_radar'
  | 'financial_projections'
  | 'advanced_goals'
  | 'frequency_goals'
  | 'card_management_advanced'
  | 'card_usage_breakdown'
  | 'card_recurring_linked'
  | 'card_auto_cycle'
  | 'installment_tracking'
  | 'temporary_contexts'
  | 'personalized_recommendations'
  | 'multiple_cards'
  | 'json_export'
  | 'priority_support'
  | 'trend_comparison';

const FEATURE_MATRIX: Record<Feature, Plano[]> = {
  // Core - todos
  expense_tracking: ['trial', 'basico', 'pro'],
  basic_dashboard: ['trial', 'basico', 'pro'],
  categories: ['trial', 'basico', 'pro'],
  // Básico + Pro
  unlimited_budgets: ['basico', 'pro'],
  budget_alerts: ['basico', 'pro'],
  basic_goals: ['basico', 'pro'],
  debt_tracking_basic: ['basico', 'pro'],
  basic_insights: ['basico', 'pro'],
  weekly_reports: ['basico', 'pro'],
  monthly_reports: ['basico', 'pro'],
  expense_history_full: ['basico', 'pro'],
  installments_basic: ['basico', 'pro'],
  recurring_expenses: ['basico', 'pro'],
  csv_export: ['basico', 'pro'],
  basic_card: ['basico', 'pro'],
  // Pro only
  debt_simulator: ['pro'],
  debt_interest_calc: ['pro'],
  debt_freedom_projection: ['pro'],
  predictive_insights: ['pro'],
  ai_consultant: ['pro'],
  pattern_detector: ['pro'],
  risk_radar: ['pro'],
  financial_projections: ['pro'],
  advanced_goals: ['pro'],
  frequency_goals: ['pro'],
  card_management_advanced: ['pro'],
  card_usage_breakdown: ['pro'],
  card_recurring_linked: ['pro'],
  card_auto_cycle: ['pro'],
  installment_tracking: ['pro'],
  temporary_contexts: ['pro'],
  personalized_recommendations: ['pro'],
  multiple_cards: ['pro'],
  json_export: ['pro'],
  priority_support: ['pro'],
  trend_comparison: ['pro'],
};

const LIMITS: Record<Plano, { maxCards: number; maxGoals: number; historyDays: number | null }> = {
  trial: { maxCards: 999, maxGoals: 999, historyDays: null }, // Pro completo
  basico: { maxCards: 2, maxGoals: 5, historyDays: null },
  pro: { maxCards: 999, maxGoals: 999, historyDays: null },
};

const UPGRADE_MESSAGES: Partial<Record<Feature, string>> = {
  debt_simulator: 'Simule cenários e descubra quanto pode antecipar sua quitação.',
  debt_interest_calc: 'Veja o cálculo real de juros e quanto está perdendo.',
  debt_freedom_projection: 'Descubra em quantos dias pode ficar livre das dívidas.',
  predictive_insights: 'Insights que calculam o impacto real em dias da sua liberdade.',
  ai_consultant: 'Consultoria personalizada toda semana com plano de ação.',
  pattern_detector: 'Detecte padrões destrutivos antes de virar problema.',
  risk_radar: 'Radar que identifica anomalias nos seus gastos automaticamente.',
  financial_projections: 'Veja onde você estará em 3, 6 e 12 meses.',
  advanced_goals: 'Metas ilimitadas para acelerar seus objetivos.',
  frequency_goals: 'Metas de frequência que te ajudam a manter disciplina.',
  multiple_cards: 'Cartões ilimitados com gestão completa e ciclo automático.',
  card_management_advanced: 'Gestão avançada com breakdown, recorrentes e ciclo automático.',
  card_usage_breakdown: 'Veja a composição detalhada do uso de cada cartão.',
  installment_tracking: 'Rastreamento inteligente de parcelamentos vinculados ao cartão.',
  temporary_contexts: 'Contextos temporários para viagens e eventos especiais.',
  personalized_recommendations: 'Recomendações personalizadas baseadas no seu perfil.',
  trend_comparison: 'Compare tendências e veja sua evolução ao longo do tempo.',
};

export function usePlanoStatus() {
  const { user } = useAuth();

  const plano: Plano = (user?.plano as Plano) || 'trial';
  const planoStatus = user?.planoStatus || 'indefinido';
  const diasRestantesTrial = user?.diasRestantesTrial ?? null;

  const isTrialExpirado = planoStatus === 'trial_expirado';
  const isPro = plano === 'pro';
  const isBasico = plano === 'basico';
  const isTrial = plano === 'trial' && planoStatus === 'trial_ativo';

  // Trial ativo = acesso Pro completo
  // Trial expirado = nenhum acesso
  const canAccessFeature = (feature: Feature): boolean => {
    if (isTrialExpirado) return false;
    if (isTrial) return true; // Trial ativo = Pro completo
    return FEATURE_MATRIX[feature].includes(plano);
  };

  const showUpgradeTeaser = (feature: Feature): boolean => {
    if (isTrialExpirado) return true;
    if (isTrial) return false;
    return !FEATURE_MATRIX[feature].includes(plano);
  };

  const getUpgradeMessage = (feature: Feature): string => {
    return UPGRADE_MESSAGES[feature] || 'Recurso disponível no plano Pro.';
  };

  const getLimit = (type: keyof typeof LIMITS.trial): number | null => {
    if (isTrialExpirado) return 0;
    return LIMITS[plano][type];
  };

  // Alert for trial ending
  let alertaTrial: 'urgente' | 'aviso' | 'ok' | null = null;
  if (isTrial && diasRestantesTrial !== null) {
    if (diasRestantesTrial <= 2) alertaTrial = 'urgente';
    else if (diasRestantesTrial <= 4) alertaTrial = 'aviso';
    else alertaTrial = 'ok';
  }

  return {
    plano,
    planoStatus,
    diasRestantesTrial,
    alertaTrial,
    isTrialExpirado,
    isPro,
    isBasico,
    isTrial,
    canAccessFeature,
    showUpgradeTeaser,
    getUpgradeMessage,
    getLimit,
    loading: false,
    // Legacy compat
    planoStatusObj: {
      plano,
      statusPlano: planoStatus,
      diasRestantesTrial,
      alertaTrial,
      trialInicio: null,
      trialFim: null,
    },
  };
}
