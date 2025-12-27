-- Adicionar campos de controle mais robustos para mídia
ALTER TABLE eventos_brutos 
ADD COLUMN IF NOT EXISTS media_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS media_attempts INTEGER DEFAULT 0;

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_eventos_brutos_media_status 
ON eventos_brutos(media_status);

-- Atualizar registros existentes que já têm media_downloaded = true
UPDATE eventos_brutos 
SET media_status = 'done' 
WHERE media_downloaded = true AND media_status = 'pending';

-- Atualizar registros com erro
UPDATE eventos_brutos 
SET media_status = 'error' 
WHERE media_error IS NOT NULL AND media_status = 'pending';