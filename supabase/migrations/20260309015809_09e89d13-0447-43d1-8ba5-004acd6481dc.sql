-- Sprint 1 Item 1: Índices críticos para performance
-- 93.5% sequential scans na tabela usuarios por falta de índice em phone_number

CREATE INDEX IF NOT EXISTS idx_usuarios_phone_number ON public.usuarios(phone_number);
CREATE INDEX IF NOT EXISTS idx_usuarios_phone_e164 ON public.usuarios(phone_e164);

-- Índice em transacoes.status (usado em WHERE status != 'cancelada')
CREATE INDEX IF NOT EXISTS idx_transacoes_status ON public.transacoes(status);

-- Índice composto para eventos_brutos pendentes
CREATE INDEX IF NOT EXISTS idx_eventos_brutos_pending ON public.eventos_brutos(status, user_id, created_at DESC) WHERE interpretado = false;