-- Atualiza fn_relatorio_semanal para suportar períodos flexíveis
-- "semana_atual" = segunda atual até hoje
-- "semana_passada" = segunda passada até domingo passado
-- Datas customizadas também suportadas

CREATE OR REPLACE FUNCTION public.fn_relatorio_semanal(
  p_usuario_id uuid, 
  p_data_inicio date DEFAULT NULL, 
  p_data_fim date DEFAULT NULL,
  p_tipo_periodo text DEFAULT 'semana_passada'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
  -- Dia da semana atual (0 = domingo, 1 = segunda, ..., 6 = sábado)
  v_dow := EXTRACT(DOW FROM current_date)::int;
  
  -- Define período baseado no tipo
  IF p_data_inicio IS NOT NULL THEN
    -- Datas customizadas fornecidas
    v_data_inicio := p_data_inicio;
    v_data_fim := COALESCE(p_data_fim, p_data_inicio + 6);
  ELSIF p_tipo_periodo = 'semana_atual' THEN
    -- Segunda-feira DESTA semana até HOJE
    -- Se hoje é domingo (0), volta 6 dias para segunda
    -- Se hoje é segunda (1), volta 0 dias
    -- etc.
    IF v_dow = 0 THEN
      v_data_inicio := current_date - 6;  -- Domingo: volta para segunda
    ELSE
      v_data_inicio := current_date - (v_dow - 1);  -- Volta para segunda
    END IF;
    v_data_fim := current_date;  -- Até hoje
  ELSE
    -- semana_passada (padrão): Segunda passada até Domingo passado
    IF v_dow = 0 THEN
      -- Hoje é domingo
      v_data_inicio := current_date - 13;  -- Segunda da semana retrasada
      v_data_fim := current_date - 7;      -- Domingo da semana passada
    ELSE
      v_data_inicio := current_date - v_dow - 6;  -- Segunda da semana passada
      v_data_fim := current_date - v_dow;         -- Domingo da semana passada
    END IF;
  END IF;
  
  -- Semana anterior para comparação
  v_semana_anterior_inicio := v_data_inicio - 7;
  v_semana_anterior_fim := v_data_fim - 7;

  -- Total de entradas e saídas da semana
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

  -- Totais da semana anterior (para variação)
  SELECT 
    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)
  INTO v_total_entradas_ant, v_total_saidas_ant
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_semana_anterior_inicio
    AND data < v_semana_anterior_fim + 1
    AND status != 'cancelada';

  -- Variação percentual dos gastos
  IF v_total_saidas_ant > 0 THEN
    v_variacao_gastos := ROUND(((v_total_saidas - v_total_saidas_ant) / v_total_saidas_ant) * 100, 1);
  ELSIF v_total_saidas > 0 THEN
    v_variacao_gastos := 100;
  ELSE
    v_variacao_gastos := 0;
  END IF;

  -- Categorias mais usadas (ordenadas por valor)
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

  -- Gastos por dia da semana
  SELECT jsonb_agg(
    jsonb_build_object(
      'dia', CASE EXTRACT(DOW FROM data)
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
    )
    ORDER BY EXTRACT(DOW FROM data)
  )
  INTO v_gastos_por_dia
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_data_inicio
    AND data < v_data_fim + 1
    AND status != 'cancelada'
  GROUP BY EXTRACT(DOW FROM data);

  -- Monta resultado final com datas formatadas
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