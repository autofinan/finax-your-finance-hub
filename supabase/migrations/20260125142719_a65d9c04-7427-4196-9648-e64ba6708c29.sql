-- ============================================================================
-- FASE 1: FUNDAÇÃO SÓLIDA - Contas a Pagar + Estado Conversacional
-- ============================================================================

-- 1. Adicionar campos de estado conversacional na tabela usuarios
ALTER TABLE public.usuarios 
ADD COLUMN IF NOT EXISTS ultima_interacao timestamptz,
ADD COLUMN IF NOT EXISTS interacoes_hoje int DEFAULT 0,
ADD COLUMN IF NOT EXISTS estado_financeiro text DEFAULT 'neutro' CHECK (estado_financeiro IN ('neutro', 'apertado', 'tranquilo')),
ADD COLUMN IF NOT EXISTS preferencia_saudacao text DEFAULT 'padrao';

-- 2. Criar tabela contas_pagar (faturas genéricas)
CREATE TABLE IF NOT EXISTS public.contas_pagar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE CASCADE NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'fixa' CHECK (tipo IN ('cartao', 'fixa', 'variavel')),
  dia_vencimento int CHECK (dia_vencimento >= 1 AND dia_vencimento <= 31),
  valor_estimado numeric,
  lembrar_dias_antes int DEFAULT 3,
  ativa boolean DEFAULT true,
  ultimo_lembrete timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. Criar tabela pagamentos (histórico de pagamentos das contas)
CREATE TABLE IF NOT EXISTS public.pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid REFERENCES public.contas_pagar(id) ON DELETE CASCADE NOT NULL,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE CASCADE NOT NULL,
  mes_referencia date NOT NULL,
  valor_pago numeric NOT NULL,
  data_pagamento timestamptz DEFAULT now(),
  status text DEFAULT 'pago' CHECK (status IN ('pendente', 'pago', 'atrasado')),
  transacao_id uuid REFERENCES public.transacoes(id) ON DELETE SET NULL,
  observacao text,
  created_at timestamptz DEFAULT now()
);

-- 4. Habilitar RLS
ALTER TABLE public.contas_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;

-- 5. Políticas RLS para contas_pagar
CREATE POLICY "Users can view own contas_pagar" ON public.contas_pagar
  FOR SELECT USING (auth.uid() = usuario_id);

CREATE POLICY "Users can insert own contas_pagar" ON public.contas_pagar
  FOR INSERT WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Users can update own contas_pagar" ON public.contas_pagar
  FOR UPDATE USING (auth.uid() = usuario_id);

CREATE POLICY "Users can delete own contas_pagar" ON public.contas_pagar
  FOR DELETE USING (auth.uid() = usuario_id);

CREATE POLICY "Service role full access contas_pagar" ON public.contas_pagar
  FOR ALL USING (public.is_service_role());

-- 6. Políticas RLS para pagamentos
CREATE POLICY "Users can view own pagamentos" ON public.pagamentos
  FOR SELECT USING (auth.uid() = usuario_id);

CREATE POLICY "Users can insert own pagamentos" ON public.pagamentos
  FOR INSERT WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Users can update own pagamentos" ON public.pagamentos
  FOR UPDATE USING (auth.uid() = usuario_id);

CREATE POLICY "Service role full access pagamentos" ON public.pagamentos
  FOR ALL USING (public.is_service_role());

-- 7. Índices para performance
CREATE INDEX IF NOT EXISTS idx_contas_pagar_usuario ON public.contas_pagar(usuario_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_vencimento ON public.contas_pagar(dia_vencimento) WHERE ativa = true;
CREATE INDEX IF NOT EXISTS idx_pagamentos_conta ON public.pagamentos(conta_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_mes ON public.pagamentos(mes_referencia);

-- 8. Trigger para atualizar updated_at
CREATE TRIGGER update_contas_pagar_updated_at
  BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 9. View para contas a vencer (próximos 7 dias)
CREATE OR REPLACE VIEW public.vw_contas_a_vencer AS
SELECT 
  cp.*,
  u.nome as usuario_nome,
  u.phone_number,
  -- Calcular dias até vencimento
  CASE 
    WHEN cp.dia_vencimento >= EXTRACT(DAY FROM CURRENT_DATE) THEN
      cp.dia_vencimento - EXTRACT(DAY FROM CURRENT_DATE)::int
    ELSE
      -- Próximo mês
      cp.dia_vencimento + (DATE_PART('days', DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') - INTERVAL '1 day')::int - EXTRACT(DAY FROM CURRENT_DATE)::int)
  END as dias_ate_vencimento
FROM public.contas_pagar cp
JOIN public.usuarios u ON cp.usuario_id = u.id
WHERE cp.ativa = true;

-- 10. Função para buscar contas que precisam de lembrete
CREATE OR REPLACE FUNCTION public.fn_contas_para_lembrar()
RETURNS TABLE (
  conta_id uuid,
  usuario_id uuid,
  nome text,
  dia_vencimento int,
  valor_estimado numeric,
  phone_number text,
  usuario_nome text,
  dias_ate_vencimento int
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cp.id as conta_id,
    cp.usuario_id,
    cp.nome,
    cp.dia_vencimento,
    cp.valor_estimado,
    u.phone_number,
    u.nome as usuario_nome,
    CASE 
      WHEN cp.dia_vencimento >= EXTRACT(DAY FROM CURRENT_DATE) THEN
        (cp.dia_vencimento - EXTRACT(DAY FROM CURRENT_DATE))::int
      ELSE
        (cp.dia_vencimento + (DATE_PART('days', DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') - INTERVAL '1 day') - EXTRACT(DAY FROM CURRENT_DATE)))::int
    END as dias_ate_vencimento
  FROM contas_pagar cp
  JOIN usuarios u ON cp.usuario_id = u.id
  WHERE cp.ativa = true
    AND u.ativo = true
    AND (cp.ultimo_lembrete IS NULL OR cp.ultimo_lembrete < CURRENT_DATE)
    AND CASE 
      WHEN cp.dia_vencimento >= EXTRACT(DAY FROM CURRENT_DATE) THEN
        (cp.dia_vencimento - EXTRACT(DAY FROM CURRENT_DATE))::int
      ELSE
        (cp.dia_vencimento + (DATE_PART('days', DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') - INTERVAL '1 day') - EXTRACT(DAY FROM CURRENT_DATE)))::int
    END <= cp.lembrar_dias_antes;
END;
$$;

-- 11. Função para atualizar última interação do usuário
CREATE OR REPLACE FUNCTION public.fn_atualizar_interacao(p_usuario_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoje date := CURRENT_DATE;
  v_ultima_data date;
BEGIN
  SELECT ultima_interacao::date INTO v_ultima_data
  FROM usuarios WHERE id = p_usuario_id;
  
  IF v_ultima_data IS NULL OR v_ultima_data < v_hoje THEN
    -- Novo dia, resetar contador
    UPDATE usuarios SET 
      ultima_interacao = now(),
      interacoes_hoje = 1
    WHERE id = p_usuario_id;
  ELSE
    -- Mesmo dia, incrementar
    UPDATE usuarios SET 
      ultima_interacao = now(),
      interacoes_hoje = interacoes_hoje + 1
    WHERE id = p_usuario_id;
  END IF;
END;
$$;