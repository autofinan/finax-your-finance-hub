-- ============================================================================
-- 🚀 SISTEMA DE PLANOS FINAX v1.0
-- ============================================================================
-- 1. Atualiza plano padrão para trial com 14 dias
-- 2. Expande codigos_ativacao para suportar gateway de pagamento
-- 3. Melhora função de validação de código
-- ============================================================================

-- 1. ATUALIZAR TABELA USUARIOS
-- Adicionar CHECK constraint para planos válidos (trial, basico, pro)
-- Primeiro, precisamos dropar a constraint existente se houver
DO $$ BEGIN
  -- Tentar dropar constraint antiga se existir
  ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_plano_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Adicionar nova constraint com planos válidos
ALTER TABLE public.usuarios 
ADD CONSTRAINT usuarios_plano_check 
CHECK (plano IN ('trial', 'basico', 'pro'));

-- Alterar default de trial_fim para 14 dias a partir de agora
ALTER TABLE public.usuarios 
ALTER COLUMN trial_fim SET DEFAULT (now() + interval '14 days');

-- Garantir que trial_inicio tem default
ALTER TABLE public.usuarios 
ALTER COLUMN trial_inicio SET DEFAULT now();

-- 2. EXPANDIR TABELA CODIGOS_ATIVACAO
-- Adicionar colunas para suportar gateway de pagamento
ALTER TABLE public.codigos_ativacao 
ADD COLUMN IF NOT EXISTS plano_destino text DEFAULT 'pro' CHECK (plano_destino IN ('basico', 'pro'));

ALTER TABLE public.codigos_ativacao 
ADD COLUMN IF NOT EXISTS phone_number_destino text;

ALTER TABLE public.codigos_ativacao 
ADD COLUMN IF NOT EXISTS origem text DEFAULT 'manual' CHECK (origem IN ('manual', 'hotmart', 'stripe', 'pagarme', 'asaas'));

ALTER TABLE public.codigos_ativacao 
ADD COLUMN IF NOT EXISTS email_comprador text;

ALTER TABLE public.codigos_ativacao 
ADD COLUMN IF NOT EXISTS valor_pago numeric;

ALTER TABLE public.codigos_ativacao 
ADD COLUMN IF NOT EXISTS transaction_id text;

-- Index para busca por código (case insensitive)
CREATE INDEX IF NOT EXISTS idx_codigos_ativacao_codigo 
ON public.codigos_ativacao (upper(codigo));

-- Index para busca por telefone destino
CREATE INDEX IF NOT EXISTS idx_codigos_ativacao_phone 
ON public.codigos_ativacao (phone_number_destino);

-- 3. CRIAR/ATUALIZAR FUNÇÃO DE VALIDAÇÃO DE CÓDIGO
CREATE OR REPLACE FUNCTION public.validar_codigo_ativacao(
  p_codigo text,
  p_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo record;
  v_plano text;
BEGIN
  -- Buscar código (case insensitive)
  SELECT * INTO v_codigo
  FROM codigos_ativacao
  WHERE upper(codigo) = upper(p_codigo);
  
  -- Verificar se existe
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valido', false,
      'erro', 'codigo_inexistente'
    );
  END IF;
  
  -- Verificar se já foi usado
  IF v_codigo.usado = true THEN
    RETURN jsonb_build_object(
      'valido', false,
      'erro', 'codigo_usado'
    );
  END IF;
  
  -- Verificar se expirou
  IF v_codigo.valido_ate < now() THEN
    RETURN jsonb_build_object(
      'valido', false,
      'erro', 'codigo_expirado'
    );
  END IF;
  
  -- Código válido! Ativar plano
  v_plano := COALESCE(v_codigo.plano_destino, 'pro');
  
  -- Marcar código como usado
  UPDATE codigos_ativacao 
  SET 
    usado = true,
    usado_em = now(),
    usuario_id = p_usuario_id
  WHERE id = v_codigo.id;
  
  -- Atualizar plano do usuário
  UPDATE usuarios 
  SET 
    plano = v_plano,
    trial_fim = CASE 
      WHEN v_plano IN ('basico', 'pro') THEN null -- Plano ativo não tem trial_fim
      ELSE trial_fim 
    END,
    updated_at = now()
  WHERE id = p_usuario_id;
  
  RETURN jsonb_build_object(
    'valido', true,
    'plano', v_plano,
    'origem', v_codigo.origem
  );
END;
$$;

-- 4. FUNÇÃO PARA GERAR CÓDIGO DE ATIVAÇÃO (para webhook de pagamento)
CREATE OR REPLACE FUNCTION public.gerar_codigo_ativacao(
  p_plano text DEFAULT 'pro',
  p_origem text DEFAULT 'manual',
  p_phone_destino text DEFAULT null,
  p_email text DEFAULT null,
  p_valor numeric DEFAULT null,
  p_transaction_id text DEFAULT null,
  p_dias_validade int DEFAULT 7
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo text;
BEGIN
  -- Gerar código alfanumérico único (FINAX-XXXXXX)
  v_codigo := 'FINAX-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  
  -- Garantir unicidade
  WHILE EXISTS (SELECT 1 FROM codigos_ativacao WHERE upper(codigo) = upper(v_codigo)) LOOP
    v_codigo := 'FINAX-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  END LOOP;
  
  -- Inserir código
  INSERT INTO codigos_ativacao (
    codigo,
    valido_ate,
    plano_destino,
    origem,
    phone_number_destino,
    email_comprador,
    valor_pago,
    transaction_id
  ) VALUES (
    v_codigo,
    now() + (p_dias_validade || ' days')::interval,
    p_plano,
    p_origem,
    p_phone_destino,
    p_email,
    p_valor,
    p_transaction_id
  );
  
  RETURN v_codigo;
END;
$$;

-- 5. VIEW PARA VERIFICAR STATUS DO PLANO DO USUÁRIO
CREATE OR REPLACE VIEW public.vw_status_plano AS
SELECT 
  u.id as usuario_id,
  u.phone_number,
  u.nome,
  u.plano,
  u.trial_inicio,
  u.trial_fim,
  CASE 
    WHEN u.plano IN ('basico', 'pro') THEN 'ativo'
    WHEN u.plano = 'trial' AND u.trial_fim > now() THEN 'trial_ativo'
    WHEN u.plano = 'trial' AND u.trial_fim <= now() THEN 'trial_expirado'
    ELSE 'indefinido'
  END as status_plano,
  CASE 
    WHEN u.plano = 'trial' AND u.trial_fim > now() 
    THEN EXTRACT(DAY FROM (u.trial_fim - now()))::int
    ELSE null
  END as dias_restantes_trial,
  CASE 
    WHEN u.plano = 'trial' AND u.trial_fim > now() THEN
      CASE 
        WHEN (u.trial_fim - now()) <= interval '2 days' THEN 'urgente'
        WHEN (u.trial_fim - now()) <= interval '4 days' THEN 'aviso'
        ELSE 'ok'
      END
    ELSE null
  END as alerta_trial
FROM usuarios u;

-- Grant para acesso
GRANT SELECT ON public.vw_status_plano TO authenticated;
GRANT SELECT ON public.vw_status_plano TO anon;

-- 6. TABELA DE FEATURES POR PLANO (referência)
CREATE TABLE IF NOT EXISTS public.plano_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano text NOT NULL CHECK (plano IN ('trial', 'basico', 'pro')),
  feature text NOT NULL,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (plano, feature)
);

-- Inserir features padrão
INSERT INTO public.plano_features (plano, feature, ativo) VALUES
-- Trial = tudo liberado (para mostrar valor)
('trial', 'expense', true),
('trial', 'income', true),
('trial', 'recurring', true),
('trial', 'query', true),
('trial', 'budget', true),
('trial', 'reports', true),
('trial', 'card_management', true),
('trial', 'goals', true),
('trial', 'insights', true),
('trial', 'family', true),
('trial', 'contexts', true),
-- Básico = essencial
('basico', 'expense', true),
('basico', 'income', true),
('basico', 'recurring', true),
('basico', 'query', true),
('basico', 'budget', true),
('basico', 'reports', true),
('basico', 'card_management', false), -- PRO only
('basico', 'goals', false), -- PRO only
('basico', 'insights', false), -- PRO only
('basico', 'family', false), -- PRO only
('basico', 'contexts', false), -- PRO only
-- Pro = tudo
('pro', 'expense', true),
('pro', 'income', true),
('pro', 'recurring', true),
('pro', 'query', true),
('pro', 'budget', true),
('pro', 'reports', true),
('pro', 'card_management', true),
('pro', 'goals', true),
('pro', 'insights', true),
('pro', 'family', true),
('pro', 'contexts', true)
ON CONFLICT (plano, feature) DO NOTHING;

-- RLS para plano_features
ALTER TABLE public.plano_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plano_features_select" ON public.plano_features
FOR SELECT TO authenticated, anon
USING (true);

-- 7. FUNÇÃO PARA VERIFICAR SE FEATURE É PERMITIDA
CREATE OR REPLACE FUNCTION public.feature_permitida(
  p_usuario_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano text;
  v_trial_fim timestamptz;
  v_permitido boolean;
BEGIN
  -- Buscar plano do usuário
  SELECT plano, trial_fim INTO v_plano, v_trial_fim
  FROM usuarios
  WHERE id = p_usuario_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Se trial expirado, bloquear tudo
  IF v_plano = 'trial' AND v_trial_fim < now() THEN
    RETURN false;
  END IF;
  
  -- Verificar se feature está ativa para o plano
  SELECT ativo INTO v_permitido
  FROM plano_features
  WHERE plano = v_plano AND feature = p_feature;
  
  RETURN COALESCE(v_permitido, false);
END;
$$;