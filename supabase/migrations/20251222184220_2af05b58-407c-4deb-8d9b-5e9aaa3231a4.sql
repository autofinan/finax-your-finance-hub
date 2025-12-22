-- Adicionar campos para controle de uso diário do plano free
ALTER TABLE public.usuarios 
ADD COLUMN IF NOT EXISTS mensagens_hoje INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ultima_mensagem_data DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS limite_mensagens_dia INTEGER DEFAULT 20;