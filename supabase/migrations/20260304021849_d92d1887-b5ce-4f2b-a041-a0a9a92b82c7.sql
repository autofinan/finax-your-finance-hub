-- ============================================================================
-- 1. Fix ai_decisions_ai_source_check constraint to allow 'ai_v7_tool_calling'
-- ============================================================================
ALTER TABLE public.ai_decisions DROP CONSTRAINT IF EXISTS ai_decisions_ai_source_check;
ALTER TABLE public.ai_decisions ADD CONSTRAINT ai_decisions_ai_source_check 
  CHECK (ai_source = ANY (ARRAY['ai'::text, 'deterministic'::text, 'contextual'::text, 'ai_v7_tool_calling'::text]));

-- ============================================================================
-- 2. Fix fn_relatorio_semanal (4-param) - aggregate nesting error
-- The ORDER BY inside jsonb_agg must use a subquery pattern
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_relatorio_semanal(p_usuario_id uuid, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date, p_tipo_periodo text DEFAULT 'semana_passada'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_data_inicio date;
  v_data_fim date;
  v_semana_anterior_inicio date;
  v_semana_anterior_fim date;
  v_total_entradas numeric := 0;
  v_total_saidas numeric := 0;
  v_saldo numeric := 0;
  v_total_entradas_ant numeric := 0;
  v_total_saidas_ant numeric := 0;
  v_variacao_gastos numeric := 0;
  v_categorias jsonb := '[]'::jsonb;
  v_gastos_por_dia jsonb := '[]'::jsonb;
  v_resultado jsonb;
  v_dow int;
BEGIN
  -- AUTHORIZATION CHECK
  IF p_usuario_id != auth.uid() AND NOT is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot access other users data';
  END IF;

  v_dow := EXTRACT(DOW FROM current_date)::int;
  
  IF p_data_inicio IS NOT NULL THEN
    v_data_inicio := p_data_inicio;
    v_data_fim := COALESCE(p_data_fim, p_data_inicio + 6);
  ELSIF p_tipo_periodo = 'semana_atual' THEN
    IF v_dow = 0 THEN
      v_data_inicio := current_date - 6;
    ELSE
      v_data_inicio := current_date - (v_dow - 1);
    END IF;
    v_data_fim := current_date;
  ELSE
    IF v_dow = 0 THEN
      v_data_inicio := current_date - 13;
      v_data_fim := current_date - 7;
    ELSE
      v_data_inicio := current_date - v_dow - 6;
      v_data_fim := current_date - v_dow;
    END IF;
  END IF;
  
  v_semana_anterior_inicio := v_data_inicio - 7;
  v_semana_anterior_fim := v_data_fim - 7;

  SELECT 
    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)
  INTO v_total_entradas, v_total_saidas
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_data_inicio
    AND data < v_data_fim + 1
    AND status != 'cancelada';

  v_saldo := v_total_entradas - v_total_saidas;

  SELECT 
    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)
  INTO v_total_entradas_ant, v_total_saidas_ant
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_semana_anterior_inicio
    AND data < v_semana_anterior_fim + 1
    AND status != 'cancelada';

  IF v_total_saidas_ant > 0 THEN
    v_variacao_gastos := ROUND(((v_total_saidas - v_total_saidas_ant) / v_total_saidas_ant) * 100, 1);
  ELSIF v_total_saidas > 0 THEN
    v_variacao_gastos := 100;
  ELSE
    v_variacao_gastos := 0;
  END IF;

  SELECT jsonb_agg(cat ORDER BY total DESC)
  INTO v_categorias
  FROM (
    SELECT jsonb_build_object(
      'categoria', categoria,
      'total', SUM(valor)::numeric,
      'quantidade', COUNT(*)::int
    ) as cat, SUM(valor) as total
    FROM transacoes
    WHERE usuario_id = p_usuario_id
      AND data >= v_data_inicio
      AND data < v_data_fim + 1
      AND tipo = 'saida'
      AND status != 'cancelada'
    GROUP BY categoria
    ORDER BY SUM(valor) DESC
    LIMIT 5
  ) cats;

  -- Fixed: use subquery to avoid nested aggregate error
  SELECT jsonb_agg(day_data ORDER BY dow_num)
  INTO v_gastos_por_dia
  FROM (
    SELECT 
      EXTRACT(DOW FROM data) as dow_num,
      jsonb_build_object(
        'dia', CASE EXTRACT(DOW FROM data)::int
          WHEN 0 THEN 'Domingo'
          WHEN 1 THEN 'Segunda'
          WHEN 2 THEN 'Terça'
          WHEN 3 THEN 'Quarta'
          WHEN 4 THEN 'Quinta'
          WHEN 5 THEN 'Sexta'
          WHEN 6 THEN 'Sábado'
        END,
        'total', COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)::numeric,
        'entradas', COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0)::numeric
      ) as day_data
    FROM transacoes
    WHERE usuario_id = p_usuario_id
      AND data >= v_data_inicio
      AND data < v_data_fim + 1
      AND status != 'cancelada'
    GROUP BY EXTRACT(DOW FROM data)
    ORDER BY EXTRACT(DOW FROM data)
  ) daily;

  v_resultado := jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', to_char(v_data_inicio, 'DD/MM/YYYY'),
      'fim', to_char(v_data_fim, 'DD/MM/YYYY'),
      'tipo', p_tipo_periodo
    ),
    'totais', jsonb_build_object(
      'entradas', v_total_entradas,
      'saidas', v_total_saidas,
      'saldo', v_saldo
    ),
    'comparativo', jsonb_build_object(
      'entradas_semana_anterior', v_total_entradas_ant,
      'saidas_semana_anterior', v_total_saidas_ant,
      'variacao_gastos_percentual', v_variacao_gastos
    ),
    'categorias', COALESCE(v_categorias, '[]'::jsonb),
    'gastos_por_dia', COALESCE(v_gastos_por_dia, '[]'::jsonb)
  );

  RETURN v_resultado;
END;
$function$;

-- Also fix the 3-param version (same aggregate nesting issue)
CREATE OR REPLACE FUNCTION public.fn_relatorio_semanal(p_usuario_id uuid, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_data_inicio date;
  v_data_fim date;
  v_semana_anterior_inicio date;
  v_semana_anterior_fim date;
  v_total_entradas numeric := 0;
  v_total_saidas numeric := 0;
  v_saldo numeric := 0;
  v_total_entradas_ant numeric := 0;
  v_total_saidas_ant numeric := 0;
  v_variacao_gastos numeric := 0;
  v_categorias jsonb := '[]'::jsonb;
  v_gastos_por_dia jsonb := '[]'::jsonb;
  v_resultado jsonb;
BEGIN
  IF p_data_inicio IS NULL THEN
    v_data_inicio := current_date - EXTRACT(DOW FROM current_date)::int - 6;
    v_data_fim := v_data_inicio + 6;
  ELSE
    v_data_inicio := p_data_inicio;
    v_data_fim := COALESCE(p_data_fim, p_data_inicio + 6);
  END IF;
  
  v_semana_anterior_inicio := v_data_inicio - 7;
  v_semana_anterior_fim := v_data_fim - 7;

  SELECT 
    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)
  INTO v_total_entradas, v_total_saidas
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_data_inicio
    AND data < v_data_fim + 1
    AND status != 'cancelada';

  v_saldo := v_total_entradas - v_total_saidas;

  SELECT 
    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)
  INTO v_total_entradas_ant, v_total_saidas_ant
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_semana_anterior_inicio
    AND data < v_semana_anterior_fim + 1
    AND status != 'cancelada';

  IF v_total_saidas_ant > 0 THEN
    v_variacao_gastos := ROUND(((v_total_saidas - v_total_saidas_ant) / v_total_saidas_ant) * 100, 1);
  ELSIF v_total_saidas > 0 THEN
    v_variacao_gastos := 100;
  ELSE
    v_variacao_gastos := 0;
  END IF;

  SELECT jsonb_agg(cat ORDER BY total DESC)
  INTO v_categorias
  FROM (
    SELECT jsonb_build_object(
      'categoria', categoria,
      'total', SUM(valor)::numeric,
      'quantidade', COUNT(*)::int
    ) as cat, SUM(valor) as total
    FROM transacoes
    WHERE usuario_id = p_usuario_id
      AND data >= v_data_inicio
      AND data < v_data_fim + 1
      AND tipo = 'saida'
      AND status != 'cancelada'
    GROUP BY categoria
    ORDER BY SUM(valor) DESC
    LIMIT 5
  ) cats;

  SELECT jsonb_agg(day_data ORDER BY dow_num)
  INTO v_gastos_por_dia
  FROM (
    SELECT 
      EXTRACT(DOW FROM data) as dow_num,
      jsonb_build_object(
        'dia', CASE EXTRACT(DOW FROM data)::int
          WHEN 0 THEN 'Domingo'
          WHEN 1 THEN 'Segunda'
          WHEN 2 THEN 'Terça'
          WHEN 3 THEN 'Quarta'
          WHEN 4 THEN 'Quinta'
          WHEN 5 THEN 'Sexta'
          WHEN 6 THEN 'Sábado'
        END,
        'total', COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)::numeric,
        'entradas', COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0)::numeric
      ) as day_data
    FROM transacoes
    WHERE usuario_id = p_usuario_id
      AND data >= v_data_inicio
      AND data < v_data_fim + 1
      AND status != 'cancelada'
    GROUP BY EXTRACT(DOW FROM data)
    ORDER BY EXTRACT(DOW FROM data)
  ) daily;

  v_resultado := jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', v_data_inicio,
      'fim', v_data_fim
    ),
    'totais', jsonb_build_object(
      'entradas', v_total_entradas,
      'saidas', v_total_saidas,
      'saldo', v_saldo
    ),
    'comparativo', jsonb_build_object(
      'entradas_semana_anterior', v_total_entradas_ant,
      'saidas_semana_anterior', v_total_saidas_ant,
      'variacao_gastos_percentual', v_variacao_gastos
    ),
    'categorias', COALESCE(v_categorias, '[]'::jsonb),
    'gastos_por_dia', COALESCE(v_gastos_por_dia, '[]'::jsonb)
  );

  RETURN v_resultado;
END;
$function$;