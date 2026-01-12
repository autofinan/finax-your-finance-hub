-- =====================================================
-- FINAX ELITE: Fase 1, 2, 3 - Correção de Índices
-- =====================================================

-- Índice para busca de padrões (sem filtro de data)
CREATE INDEX IF NOT EXISTS idx_patterns_merchant ON public.user_patterns(user_id, merchant_normalized);

-- Função RPC para estatísticas de alertas (corrigida)
CREATE OR REPLACE FUNCTION public.get_alert_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
  total_count INT;
  eligible_count INT;
  sent_count INT;
  detected_24h INT;
  avg_util FLOAT;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'eligible'),
    COUNT(*) FILTER (WHERE sent_at IS NOT NULL),
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'),
    AVG(utility_score)
  INTO total_count, eligible_count, sent_count, detected_24h, avg_util
  FROM spending_alerts
  WHERE created_at > NOW() - INTERVAL '30 days';
  
  result := jsonb_build_object(
    'total', COALESCE(total_count, 0),
    'eligible_count', COALESCE(eligible_count, 0),
    'sent_count', COALESCE(sent_count, 0),
    'detected_last_24h', COALESCE(detected_24h, 0),
    'avg_utility', COALESCE(avg_util, 0)
  );
  
  RETURN result;
END;
$$;

-- Função para limpar padrões expirados (executar via CRON)
CREATE OR REPLACE FUNCTION public.fn_cleanup_expired_patterns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Marcar padrões com baixa confiança como expirados
  DELETE FROM user_patterns
  WHERE expires_at < NOW()
  OR (confidence < 0.6 AND last_used_at < NOW() - INTERVAL '30 days');
END;
$$;