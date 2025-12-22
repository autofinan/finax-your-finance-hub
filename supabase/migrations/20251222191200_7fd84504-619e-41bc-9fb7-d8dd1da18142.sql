-- Atualizar tabela usuarios para novo modelo de planos
ALTER TABLE public.usuarios 
  DROP COLUMN IF EXISTS mensagens_hoje,
  DROP COLUMN IF EXISTS ultima_mensagem_data,
  DROP COLUMN IF EXISTS limite_mensagens_dia;

-- Adicionar campos do novo modelo
ALTER TABLE public.usuarios 
  ADD COLUMN IF NOT EXISTS trial_inicio TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trial_fim TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days');

-- Atualizar valores default da coluna plano
ALTER TABLE public.usuarios 
  ALTER COLUMN plano SET DEFAULT 'trial';

-- Atualizar usuários existentes que estão como 'free' para 'trial'
UPDATE public.usuarios SET plano = 'trial' WHERE plano = 'free' OR plano IS NULL;

-- Criar tabela de códigos de ativação Pro
CREATE TABLE IF NOT EXISTS public.codigos_ativacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(20) NOT NULL UNIQUE,
  usuario_id UUID REFERENCES public.usuarios(id),
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT now(),
  valido_ate TIMESTAMP WITH TIME ZONE NOT NULL,
  usado_em TIMESTAMP WITH TIME ZONE,
  usado BOOLEAN DEFAULT false
);

-- RLS para códigos de ativação
ALTER TABLE public.codigos_ativacao ENABLE ROW LEVEL SECURITY;

-- Políticas para códigos (apenas sistema pode manipular via service role)
CREATE POLICY "codigos_select_own" ON public.codigos_ativacao
  FOR SELECT USING (usuario_id = auth.uid());

CREATE POLICY "codigos_employees_full" ON public.codigos_ativacao
  FOR ALL USING (EXISTS (SELECT 1 FROM employees e WHERE e.id = auth.uid()));

-- Política pública para validação via webhook (usando service role)
CREATE POLICY "codigos_public_select" ON public.codigos_ativacao
  FOR SELECT USING (true);

CREATE POLICY "codigos_public_update" ON public.codigos_ativacao
  FOR UPDATE USING (true);

-- Função para validar e usar código de ativação
CREATE OR REPLACE FUNCTION public.validar_codigo_ativacao(p_codigo VARCHAR, p_usuario_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo RECORD;
  v_resultado JSON;
BEGIN
  -- Buscar código
  SELECT * INTO v_codigo 
  FROM codigos_ativacao 
  WHERE UPPER(codigo) = UPPER(p_codigo);
  
  -- Código não existe
  IF NOT FOUND THEN
    RETURN json_build_object('valido', false, 'erro', 'codigo_inexistente');
  END IF;
  
  -- Código já foi usado
  IF v_codigo.usado = true THEN
    RETURN json_build_object('valido', false, 'erro', 'codigo_usado');
  END IF;
  
  -- Código expirado
  IF v_codigo.valido_ate < now() THEN
    RETURN json_build_object('valido', false, 'erro', 'codigo_expirado');
  END IF;
  
  -- Código válido - marcar como usado e ativar Pro
  UPDATE codigos_ativacao 
  SET usado = true, usado_em = now(), usuario_id = p_usuario_id
  WHERE id = v_codigo.id;
  
  UPDATE usuarios 
  SET plano = 'pro', updated_at = now()
  WHERE id = p_usuario_id;
  
  RETURN json_build_object('valido', true, 'mensagem', 'Plano Pro ativado com sucesso');
END;
$$;