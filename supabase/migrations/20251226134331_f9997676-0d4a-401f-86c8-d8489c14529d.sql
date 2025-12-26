-- 1. Criar tabela processed_messages para DEDUPE
CREATE TABLE IF NOT EXISTS public.processed_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT UNIQUE NOT NULL,
  phone_number TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  source TEXT DEFAULT 'meta'
);

-- Índice para busca rápida por message_id
CREATE INDEX IF NOT EXISTS idx_processed_messages_id ON processed_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_processed_messages_phone ON processed_messages(phone_number);

-- 2. Atualizar eventos_brutos com colunas adicionais
ALTER TABLE eventos_brutos 
ADD COLUMN IF NOT EXISTS message_id TEXT,
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS tipo_midia TEXT DEFAULT 'text';

-- Índices para eventos_brutos
CREATE INDEX IF NOT EXISTS idx_eventos_brutos_message_id ON eventos_brutos(message_id);
CREATE INDEX IF NOT EXISTS idx_eventos_brutos_user_phone ON eventos_brutos(user_id, phone_number);

-- 3. Índice para conversas_ativas (performance)
CREATE INDEX IF NOT EXISTS idx_conversas_ativas_usuario ON conversas_ativas(usuario_id);

-- 4. RLS para processed_messages (acesso público para edge functions)
ALTER TABLE public.processed_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "processed_messages_public_access" 
ON public.processed_messages 
FOR ALL 
USING (true) 
WITH CHECK (true);