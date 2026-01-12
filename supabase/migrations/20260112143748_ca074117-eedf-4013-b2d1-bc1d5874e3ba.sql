-- ============================================================================
-- FINAX ELITE - MIGRAÇÃO COMPLETA DE GOVERNANÇA E FEEDBACK
-- ============================================================================

-- 1. Tabela perfil_cliente - adicionar operation_mode
ALTER TABLE perfil_cliente ADD COLUMN IF NOT EXISTS operation_mode TEXT DEFAULT 'silent';

-- 2. Tabela ai_corrections - campos de governança
ALTER TABLE ai_corrections ADD COLUMN IF NOT EXISTS correction_confidence FLOAT DEFAULT 0.5;
ALTER TABLE ai_corrections ADD COLUMN IF NOT EXISTS decision_version TEXT DEFAULT 'v5.1';
ALTER TABLE ai_corrections ADD COLUMN IF NOT EXISTS confirmed_by_user BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_corrections ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;

-- 3. Tabela user_patterns - campos de governança
ALTER TABLE user_patterns ADD COLUMN IF NOT EXISTS last_confirmed_by_user BOOLEAN DEFAULT FALSE;
ALTER TABLE user_patterns ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days');
ALTER TABLE user_patterns ADD COLUMN IF NOT EXISTS decision_version TEXT DEFAULT 'v5.1';
ALTER TABLE user_patterns ADD COLUMN IF NOT EXISTS source_transaction_id UUID;

-- 4. Tabela spending_alerts - campos de governança
ALTER TABLE spending_alerts ADD COLUMN IF NOT EXISTS delivery_mode TEXT DEFAULT 'silent';
ALTER TABLE spending_alerts ADD COLUMN IF NOT EXISTS decision_version TEXT DEFAULT 'v5.1';

-- 5. Nova Tabela: ai_decision_versions (Governança/Kill Switch)
CREATE TABLE IF NOT EXISTS ai_decision_versions (
  version TEXT PRIMARY KEY,
  active BOOLEAN DEFAULT true,
  auto_apply_corrections BOOLEAN DEFAULT false,
  auto_apply_patterns BOOLEAN DEFAULT true,
  proactive_alerts_enabled BOOLEAN DEFAULT false,
  global_corrections_enabled BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserir versão inicial
INSERT INTO ai_decision_versions (version, active, description, auto_apply_corrections, auto_apply_patterns, proactive_alerts_enabled, global_corrections_enabled)
VALUES ('v5.1', true, 'Versão inicial Elite - modo conservador', false, true, false, false)
ON CONFLICT (version) DO NOTHING;

-- 6. Nova Tabela: alert_feedback (Feedback do Usuário)
CREATE TABLE IF NOT EXISTS alert_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES spending_alerts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  feedback TEXT NOT NULL CHECK (feedback IN ('useful', 'annoying', 'irrelevant', 'wrong')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_alert ON alert_feedback(alert_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON alert_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON alert_feedback(created_at DESC);

-- 7. Nova Tabela: finax_metrics (Observabilidade)
CREATE TABLE IF NOT EXISTS finax_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  value NUMERIC NOT NULL,
  tags JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON finax_metrics(metric_name, created_at DESC);

-- 8. RLS para novas tabelas
ALTER TABLE ai_decision_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE finax_metrics ENABLE ROW LEVEL SECURITY;

-- Policies para ai_decision_versions (somente leitura para todos, escrita via service_role)
CREATE POLICY "Anyone can read decision versions" ON ai_decision_versions
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage decision versions" ON ai_decision_versions
  FOR ALL USING (is_service_role());

-- Policies para alert_feedback
CREATE POLICY "Users can view own feedback" ON alert_feedback
  FOR SELECT USING (auth.uid() = user_id OR is_service_role());

CREATE POLICY "Users can create own feedback" ON alert_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id OR is_service_role());

CREATE POLICY "Service role full access to feedback" ON alert_feedback
  FOR ALL USING (is_service_role());

-- Policies para finax_metrics (somente service_role)
CREATE POLICY "Service role can manage metrics" ON finax_metrics
  FOR ALL USING (is_service_role());

-- 9. Função de rollback (Kill Switch)
CREATE OR REPLACE FUNCTION fn_disable_decision_version(p_version TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Desativar a versão
  UPDATE ai_decision_versions SET active = false, updated_at = now() WHERE version = p_version;
  
  -- Invalidar correções dessa versão (zerar contadores)
  UPDATE ai_corrections SET applied_count = 0 WHERE decision_version = p_version;
  
  -- Reduzir confiança de padrões dessa versão
  UPDATE user_patterns SET confidence = 0.5 WHERE decision_version = p_version;
  
  -- Log da ação
  INSERT INTO finax_logs (action, status, metadata)
  VALUES ('rollback_decision_version', 'success', jsonb_build_object('version', p_version));
END;
$$;

-- 10. Função para ajustar utility baseado em feedback
CREATE OR REPLACE FUNCTION fn_adjust_alert_utility()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE spending_alerts sa
  SET utility_score = GREATEST(0, LEAST(1, utility_score + (
    SELECT CASE 
      WHEN AVG(CASE WHEN af.feedback = 'useful' THEN 1.0 WHEN af.feedback IN ('annoying', 'wrong') THEN -1.0 ELSE 0 END) > 0 THEN 0.1
      ELSE -0.15
    END
    FROM alert_feedback af
    WHERE af.alert_id = sa.id
  )))
  WHERE id IN (SELECT DISTINCT alert_id FROM alert_feedback WHERE created_at > NOW() - INTERVAL '1 day');
END;
$$;