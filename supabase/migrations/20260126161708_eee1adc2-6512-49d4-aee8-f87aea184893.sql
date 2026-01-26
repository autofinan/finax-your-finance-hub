-- ============================================================================
-- ADICIONAR AUTH_ID PARA VINCULAR USUARIOS WHATSAPP COM AUTH.USERS DO SITE
-- ============================================================================

-- Adicionar coluna auth_id para vincular com auth.users
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS auth_id uuid REFERENCES auth.users(id);

-- Criar índice único para garantir 1:1
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_auth_id ON usuarios(auth_id) WHERE auth_id IS NOT NULL;

-- Comentário explicativo
COMMENT ON COLUMN usuarios.auth_id IS 'Vincula o usuario WhatsApp com o auth.users do site para sincronizar dados';