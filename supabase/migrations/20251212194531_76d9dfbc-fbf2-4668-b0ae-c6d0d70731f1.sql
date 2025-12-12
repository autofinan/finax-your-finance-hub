-- ===============================================
-- TRIGGER: Atualizar resumo_mensal automaticamente
-- ===============================================

-- Criar trigger para atualização automática do resumo mensal
CREATE OR REPLACE TRIGGER trg_transacoes_resumo
AFTER INSERT OR UPDATE OR DELETE ON public.transacoes
FOR EACH ROW
EXECUTE FUNCTION public.trg_transacoes_upsert_resumo();

-- ===============================================
-- TRIGGER: Atualizar limite usado do cartão
-- ===============================================

-- Função para atualizar limite do cartão quando transação é inserida/deletada
CREATE OR REPLACE FUNCTION public.trg_update_cartao_limite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.id_cartao IS NOT NULL AND NEW.tipo = 'saida' THEN
      UPDATE cartoes_credito 
      SET limite_disponivel = limite_disponivel - NEW.valor
      WHERE id = NEW.id_cartao;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.id_cartao IS NOT NULL AND OLD.tipo = 'saida' THEN
      UPDATE cartoes_credito 
      SET limite_disponivel = limite_disponivel + OLD.valor
      WHERE id = OLD.id_cartao;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Se mudou o cartão ou valor, ajustar
    IF OLD.id_cartao IS DISTINCT FROM NEW.id_cartao OR OLD.valor IS DISTINCT FROM NEW.valor THEN
      -- Devolver ao cartão antigo
      IF OLD.id_cartao IS NOT NULL AND OLD.tipo = 'saida' THEN
        UPDATE cartoes_credito 
        SET limite_disponivel = limite_disponivel + OLD.valor
        WHERE id = OLD.id_cartao;
      END IF;
      -- Debitar do cartão novo
      IF NEW.id_cartao IS NOT NULL AND NEW.tipo = 'saida' THEN
        UPDATE cartoes_credito 
        SET limite_disponivel = limite_disponivel - NEW.valor
        WHERE id = NEW.id_cartao;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Criar trigger para limite do cartão
DROP TRIGGER IF EXISTS trg_transacoes_cartao_limite ON public.transacoes;
CREATE TRIGGER trg_transacoes_cartao_limite
AFTER INSERT OR UPDATE OR DELETE ON public.transacoes
FOR EACH ROW
EXECUTE FUNCTION public.trg_update_cartao_limite();

-- ===============================================
-- TRIGGER: Atualizar valor da fatura do cartão
-- ===============================================

-- Função para atualizar fatura quando transação de cartão é criada
CREATE OR REPLACE FUNCTION public.trg_update_fatura_cartao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mes INT;
  v_ano INT;
  v_cartao_id UUID;
  v_usuario_id UUID;
  v_dia_fechamento INT;
BEGIN
  -- Determinar cartão e usuário
  IF TG_OP = 'DELETE' THEN
    v_cartao_id := OLD.id_cartao;
    v_usuario_id := OLD.usuario_id;
  ELSE
    v_cartao_id := NEW.id_cartao;
    v_usuario_id := NEW.usuario_id;
  END IF;

  -- Se não tem cartão, não faz nada
  IF v_cartao_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Buscar dia de fechamento do cartão
  SELECT dia_fechamento INTO v_dia_fechamento
  FROM cartoes_credito 
  WHERE id = v_cartao_id;

  -- Calcular mês/ano da fatura baseado na data e fechamento
  IF TG_OP = 'DELETE' THEN
    -- Se a data é depois do fechamento, vai para próximo mês
    IF EXTRACT(DAY FROM OLD.data) > COALESCE(v_dia_fechamento, 1) THEN
      v_mes := EXTRACT(MONTH FROM OLD.data + INTERVAL '1 month')::INT;
      v_ano := EXTRACT(YEAR FROM OLD.data + INTERVAL '1 month')::INT;
    ELSE
      v_mes := EXTRACT(MONTH FROM OLD.data)::INT;
      v_ano := EXTRACT(YEAR FROM OLD.data)::INT;
    END IF;
  ELSE
    IF EXTRACT(DAY FROM NEW.data) > COALESCE(v_dia_fechamento, 1) THEN
      v_mes := EXTRACT(MONTH FROM NEW.data + INTERVAL '1 month')::INT;
      v_ano := EXTRACT(YEAR FROM NEW.data + INTERVAL '1 month')::INT;
    ELSE
      v_mes := EXTRACT(MONTH FROM NEW.data)::INT;
      v_ano := EXTRACT(YEAR FROM NEW.data)::INT;
    END IF;
  END IF;

  -- Upsert na fatura
  INSERT INTO faturas_cartao (id, cartao_id, usuario_id, mes, ano, valor_total, status, created_at)
  VALUES (gen_random_uuid(), v_cartao_id, v_usuario_id, v_mes, v_ano, 0, 'aberta', now())
  ON CONFLICT (cartao_id, mes, ano) DO NOTHING;

  -- Recalcular valor da fatura
  UPDATE faturas_cartao
  SET valor_total = (
    SELECT COALESCE(SUM(t.valor), 0)
    FROM transacoes t
    WHERE t.id_cartao = v_cartao_id
      AND t.tipo = 'saida'
      AND t.status != 'cancelada'
      AND (
        (EXTRACT(DAY FROM t.data) > COALESCE(v_dia_fechamento, 1) 
         AND EXTRACT(MONTH FROM t.data + INTERVAL '1 month') = v_mes
         AND EXTRACT(YEAR FROM t.data + INTERVAL '1 month') = v_ano)
        OR
        (EXTRACT(DAY FROM t.data) <= COALESCE(v_dia_fechamento, 1) 
         AND EXTRACT(MONTH FROM t.data) = v_mes
         AND EXTRACT(YEAR FROM t.data) = v_ano)
      )
  ),
  updated_at = now()
  WHERE cartao_id = v_cartao_id AND mes = v_mes AND ano = v_ano;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Criar trigger para atualizar fatura
DROP TRIGGER IF EXISTS trg_transacoes_fatura ON public.transacoes;
CREATE TRIGGER trg_transacoes_fatura
AFTER INSERT OR UPDATE OR DELETE ON public.transacoes
FOR EACH ROW
EXECUTE FUNCTION public.trg_update_fatura_cartao();

-- ===============================================
-- ADICIONAR UNIQUE CONSTRAINT em faturas_cartao
-- ===============================================

-- Garantir que existe constraint única para cartao_id + mes + ano
-- (Já existe, mas vamos garantir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'faturas_cartao_cartao_mes_unique'
  ) THEN
    CREATE UNIQUE INDEX faturas_cartao_cartao_mes_unique 
    ON faturas_cartao (cartao_id, mes, ano);
  END IF;
END $$;