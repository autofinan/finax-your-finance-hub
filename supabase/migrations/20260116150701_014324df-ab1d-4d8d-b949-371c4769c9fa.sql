-- Fix search_path for functions created in previous migration
CREATE OR REPLACE FUNCTION fn_atualizar_orcamento_apos_transacao()
RETURNS TRIGGER AS $$
DECLARE
  v_orcamento RECORD;
  v_mes_atual INTEGER;
  v_ano_atual INTEGER;
BEGIN
  IF NEW.tipo != 'saida' THEN
    RETURN NEW;
  END IF;
  
  v_mes_atual := EXTRACT(MONTH FROM CURRENT_DATE);
  v_ano_atual := EXTRACT(YEAR FROM CURRENT_DATE);
  
  UPDATE public.orcamentos
  SET 
    gasto_atual = (
      SELECT COALESCE(SUM(valor), 0)
      FROM public.transacoes t
      WHERE t.usuario_id = NEW.usuario_id
        AND t.categoria = public.orcamentos.categoria
        AND t.tipo = 'saida'
        AND t.status = 'confirmada'
        AND EXTRACT(MONTH FROM t.data) = v_mes_atual
        AND EXTRACT(YEAR FROM t.data) = v_ano_atual
    ),
    updated_at = now()
  WHERE usuario_id = NEW.usuario_id
    AND tipo = 'categoria'
    AND categoria = NEW.categoria
    AND ativo = true;
  
  UPDATE public.orcamentos
  SET 
    gasto_atual = (
      SELECT COALESCE(SUM(valor), 0)
      FROM public.transacoes t
      WHERE t.usuario_id = NEW.usuario_id
        AND t.tipo = 'saida'
        AND t.status = 'confirmada'
        AND EXTRACT(MONTH FROM t.data) = v_mes_atual
        AND EXTRACT(YEAR FROM t.data) = v_ano_atual
    ),
    updated_at = now()
  WHERE usuario_id = NEW.usuario_id
    AND tipo = 'global'
    AND ativo = true;
  
  IF NEW.context_id IS NOT NULL THEN
    UPDATE public.orcamentos
    SET 
      gasto_atual = (
        SELECT COALESCE(SUM(valor), 0)
        FROM public.transacoes t
        WHERE t.context_id = NEW.context_id
          AND t.tipo = 'saida'
          AND t.status = 'confirmada'
      ),
      updated_at = now()
    WHERE contexto_id = NEW.context_id
      AND tipo = 'contexto'
      AND ativo = true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION fn_verificar_alertas_orcamento(p_usuario_id UUID)
RETURNS TABLE (
  orcamento_id UUID,
  tipo TEXT,
  categoria TEXT,
  limite NUMERIC,
  gasto_atual NUMERIC,
  percentual NUMERIC,
  alerta_nivel TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id as orcamento_id,
    o.tipo,
    o.categoria,
    o.limite,
    o.gasto_atual,
    ROUND((o.gasto_atual / o.limite * 100)::numeric, 1) as percentual,
    CASE 
      WHEN o.gasto_atual >= o.limite THEN 'critico'
      WHEN o.gasto_atual >= o.limite * 0.8 THEN 'alerta'
      WHEN o.gasto_atual >= o.limite * 0.5 THEN 'atencao'
      ELSE 'ok'
    END as alerta_nivel
  FROM public.orcamentos o
  WHERE o.usuario_id = p_usuario_id
    AND o.ativo = true
    AND o.gasto_atual >= o.limite * 0.5
  ORDER BY (o.gasto_atual / o.limite) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;