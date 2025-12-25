-- Adiciona coluna para controle de etapa do onboarding
ALTER TABLE public.usuarios 
ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT NULL;

-- Valores possíveis: null, "bancos", "cartoes", "dividas", "gastos_fixos", "finalizado"
-- O campo onboarding_status já existe e controla: null, "iniciado", "concluido"

COMMENT ON COLUMN public.usuarios.onboarding_step IS 'Etapa atual do onboarding: null, bancos, cartoes, dividas, gastos_fixos, finalizado';