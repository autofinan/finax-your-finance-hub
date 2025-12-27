-- ============================================================================
-- MIGRATIONS P0: Correções Críticas do Schema Finax
-- ============================================================================

-- 1. ACTIONS: Tornar action_hash NOT NULL e UNIQUE (idempotência garantida)
-- Primeiro limpar registros sem action_hash (se houver)
UPDATE actions SET action_hash = 'legacy_' || id::text WHERE action_hash IS NULL;

-- Alterar para NOT NULL
ALTER TABLE actions ALTER COLUMN action_hash SET NOT NULL;

-- Criar constraint UNIQUE
ALTER TABLE actions ADD CONSTRAINT actions_action_hash_unique UNIQUE (action_hash);

-- 2. ACTIONS: Adicionar campos meta e updated_at
ALTER TABLE actions ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}';
ALTER TABLE actions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. PENDING_SELECTIONS: Índice para cleanup de expirados
CREATE INDEX IF NOT EXISTS idx_pending_expires 
ON pending_selections(expires_at) 
WHERE consumed = false;

-- 4. HIPOTESES_REGISTRO: Adicionar referência a media_analysis
ALTER TABLE hipoteses_registro ADD COLUMN IF NOT EXISTS media_analysis_id UUID REFERENCES media_analysis(id);

-- 5. WEBHOOK_JOBS: Adicionar campos para retry/backoff
ALTER TABLE webhook_jobs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE webhook_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;

-- 6. TRANSACOES: Adicionar status cancel_pending para undo window
-- (status já existe, mas garantir valores válidos)
COMMENT ON COLUMN transacoes.status IS 'Valores: confirmada, prevista, cancelada, cancel_pending';

-- 7. FINAX_LOGS: Tabela de audit logs (se não existir)
CREATE TABLE IF NOT EXISTS finax_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action_type TEXT NOT NULL,
  entity_type TEXT, -- transacao, hypothesis, action, etc
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  trace_id TEXT,
  message_id TEXT,
  job_id UUID,
  step TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finax_logs_user ON finax_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_finax_logs_trace ON finax_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_finax_logs_entity ON finax_logs(entity_type, entity_id);

-- 8. Função para cleanup de pending_selections expiradas
CREATE OR REPLACE FUNCTION fn_cleanup_expired_selections()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pending_selections 
  SET consumed = true 
  WHERE expires_at < now() AND consumed = false;
END;
$$;