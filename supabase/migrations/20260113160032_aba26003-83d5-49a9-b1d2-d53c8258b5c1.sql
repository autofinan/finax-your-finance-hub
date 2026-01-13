-- ============================================
-- SECURITY FIX: Enable RLS on 4 missing tables
-- ============================================

-- 1. Enable RLS on savings_goals
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "savings_goals_select_own" ON public.savings_goals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "savings_goals_insert_own" ON public.savings_goals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "savings_goals_update_own" ON public.savings_goals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "savings_goals_delete_own" ON public.savings_goals
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 2. Enable RLS on chart_cache
ALTER TABLE public.chart_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chart_cache_select_own" ON public.chart_cache
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "chart_cache_insert_own" ON public.chart_cache
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "chart_cache_update_own" ON public.chart_cache
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "chart_cache_delete_own" ON public.chart_cache
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 3. Enable RLS on shared_reports
ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;

-- Owners can always see their own reports
CREATE POLICY "shared_reports_select_own" ON public.shared_reports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Anyone can view valid tokens (for public sharing feature)
CREATE POLICY "shared_reports_select_valid_token" ON public.shared_reports
  FOR SELECT TO anon, authenticated
  USING (
    is_revoked = false AND 
    expires_at > NOW() AND 
    (max_views IS NULL OR view_count < max_views)
  );

CREATE POLICY "shared_reports_insert_own" ON public.shared_reports
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "shared_reports_update_own" ON public.shared_reports
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "shared_reports_delete_own" ON public.shared_reports
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 4. Enable RLS on bank_connections
ALTER TABLE public.bank_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_connections_select_own" ON public.bank_connections
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "bank_connections_insert_own" ON public.bank_connections
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "bank_connections_update_own" ON public.bank_connections
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "bank_connections_delete_own" ON public.bank_connections
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================
-- SECURITY FIX: Change views to SECURITY INVOKER
-- ============================================

-- Fix vw_dashboard_usuario
ALTER VIEW public.vw_dashboard_usuario SET (security_invoker = on);

-- Fix vw_transacoes_mes_atual
ALTER VIEW public.vw_transacoes_mes_atual SET (security_invoker = on);

-- Fix vw_transacoes_agrupadas_categoria
ALTER VIEW public.vw_transacoes_agrupadas_categoria SET (security_invoker = on);

-- Fix vw_active_contexts
ALTER VIEW public.vw_active_contexts SET (security_invoker = on);

-- Fix vw_parcelas_abertas
ALTER VIEW public.vw_parcelas_abertas SET (security_invoker = on);

-- Fix vw_parcelas_pendentes_usuario
ALTER VIEW public.vw_parcelas_pendentes_usuario SET (security_invoker = on);

-- Fix vw_resumo_mes_atual
ALTER VIEW public.vw_resumo_mes_atual SET (security_invoker = on);

-- Fix vw_transacoes_mes
ALTER VIEW public.vw_transacoes_mes SET (security_invoker = on);

-- Fix vw_faturas_em_aberto
ALTER VIEW public.vw_faturas_em_aberto SET (security_invoker = on);

-- Fix vw_recorrencias_ativas
ALTER VIEW public.vw_recorrencias_ativas SET (security_invoker = on);

-- Fix vw_gastos_categoria
ALTER VIEW public.vw_gastos_categoria SET (security_invoker = on);

-- Fix vw_resumo_mensal
ALTER VIEW public.vw_resumo_mensal SET (security_invoker = on);

-- Fix vw_cognitive_evolution
ALTER VIEW public.vw_cognitive_evolution SET (security_invoker = on);

-- Fix vw_semantic_learning
ALTER VIEW public.vw_semantic_learning SET (security_invoker = on);

-- Fix vw_brain_summary
ALTER VIEW public.vw_brain_summary SET (security_invoker = on);