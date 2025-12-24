-- Adiciona coluna de status do onboarding na tabela usuarios
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT NULL;

-- Valores possíveis: NULL (nunca iniciou), 'iniciado', 'concluido'
COMMENT ON COLUMN public.usuarios.onboarding_status IS 'Status do onboarding: NULL, iniciado, concluido';