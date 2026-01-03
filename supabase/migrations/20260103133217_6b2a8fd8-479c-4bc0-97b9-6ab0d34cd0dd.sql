-- ============================================================================
-- MIGRAÇÃO: SLOT FILLING ARCHITECTURE
-- ============================================================================
-- Adiciona suporte a slots persistentes para coleta incremental de dados
-- ============================================================================

-- 1. Adicionar coluna slots na tabela actions
ALTER TABLE public.actions 
ADD COLUMN IF NOT EXISTS slots JSONB DEFAULT '{}'::jsonb;

-- 2. Criar índice para busca de pending actions por usuário/status
CREATE INDEX IF NOT EXISTS idx_actions_user_pending_slots 
ON public.actions (user_id, status) 
WHERE status IN ('pending', 'awaiting_input', 'collecting');

-- 3. Criar índice para busca por intent (novo fluxo slot filling)
CREATE INDEX IF NOT EXISTS idx_actions_user_intent 
ON public.actions (user_id, action_type, status);

-- 4. Adicionar comentário explicativo
COMMENT ON COLUMN public.actions.slots IS 'Slots coletados incrementalmente no fluxo de slot filling. Chaves: card, field, value, amount, description, category, etc.';