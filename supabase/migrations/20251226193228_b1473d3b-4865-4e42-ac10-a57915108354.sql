-- Novos campos em eventos_brutos para prevenir reprocessamento
ALTER TABLE eventos_brutos
ADD COLUMN IF NOT EXISTS media_downloaded BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS media_error TEXT,
ADD COLUMN IF NOT EXISTS interpretado BOOLEAN DEFAULT false;

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_eventos_brutos_media 
ON eventos_brutos(media_downloaded) 
WHERE media_downloaded = false;

CREATE INDEX IF NOT EXISTS idx_eventos_brutos_interpretado 
ON eventos_brutos(interpretado) 
WHERE interpretado = false;