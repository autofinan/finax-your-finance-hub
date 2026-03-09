
-- FIX #4: Adicionar colunas à tabela erros_interpretacao para log de decisões fracas
ALTER TABLE public.erros_interpretacao
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS ai_classification TEXT,
  ADD COLUMN IF NOT EXISTS confidence DECIMAL,
  ADD COLUMN IF NOT EXISTS reason TEXT;
