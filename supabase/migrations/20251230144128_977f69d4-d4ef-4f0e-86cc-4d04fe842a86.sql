-- Garantir unique constraint na coluna action_hash da tabela actions
-- Isso é CRÍTICO para idempotência real

-- Primeiro remover possíveis duplicatas antigas (manter apenas a mais recente)
DELETE FROM actions a
WHERE a.id NOT IN (
  SELECT DISTINCT ON (action_hash) id
  FROM actions
  ORDER BY action_hash, created_at DESC
);

-- Criar unique constraint se não existir
ALTER TABLE actions
DROP CONSTRAINT IF EXISTS actions_action_hash_unique;

ALTER TABLE actions
ADD CONSTRAINT actions_action_hash_unique UNIQUE (action_hash);

-- Criar índice para buscas rápidas por user_id e status
CREATE INDEX IF NOT EXISTS idx_actions_user_status 
ON actions(user_id, status);

-- Criar índice para busca por hash
CREATE INDEX IF NOT EXISTS idx_actions_hash 
ON actions(action_hash);