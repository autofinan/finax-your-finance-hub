-- Add authorization checks to SECURITY DEFINER functions
-- These functions now validate that the caller either owns the data or is service_role

-- Helper function to check if caller is service_role
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role',
    false
  );
$$;

-- Fix fn_relatorio_semanal with authorization check
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
  -- AUTHORIZATION CHECK: Only allow own data or service_role
  IF p_usuario_id != auth.uid() AND NOT is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot access other users data';
  END IF;

  -- Dia da semana atual (0 = domingo, 1 = segunda, ..., 6 = sábado)
  v_dow := EXTRACT(DOW FROM current_date)::int;
  
  -- Define período baseado no tipo
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

-- Fix fn_relatorio_mensal with authorization check
CREATE OR REPLACE FUNCTION public.fn_relatorio_mensal(p_usuario_id uuid, p_mes integer DEFAULT NULL::integer, p_ano integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mes int;
  v_ano int;
  v_data_inicio date;
  v_data_fim date;
  v_total_entradas numeric := 0;
  v_total_saidas numeric := 0;
  v_saldo numeric := 0;
  v_media_diaria numeric := 0;
  v_dias_no_mes int;
  v_despesas_fixas numeric := 0;
  v_maiores_gastos jsonb := '[]'::jsonb;
  v_categorias jsonb := '[]'::jsonb;
  v_resultado jsonb;
BEGIN
  -- AUTHORIZATION CHECK: Only allow own data or service_role
  IF p_usuario_id != auth.uid() AND NOT is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot access other users data';
  END IF;

  IF p_mes IS NULL THEN
    v_mes := EXTRACT(MONTH FROM current_date - INTERVAL '1 month')::int;
    v_ano := EXTRACT(YEAR FROM current_date - INTERVAL '1 month')::int;
  ELSE
    v_mes := p_mes;
    v_ano := COALESCE(p_ano, EXTRACT(YEAR FROM current_date)::int);
  END IF;

  v_data_inicio := make_date(v_ano, v_mes, 1);
  v_data_fim := (v_data_inicio + INTERVAL '1 month')::date;
  v_dias_no_mes := EXTRACT(DAY FROM v_data_fim - INTERVAL '1 day')::int;

  SELECT 
    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0)
  INTO v_total_entradas, v_total_saidas
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_data_inicio
    AND data < v_data_fim
    AND status != 'cancelada';

  v_saldo := v_total_entradas - v_total_saidas;
  
  IF v_dias_no_mes > 0 THEN
    v_media_diaria := ROUND(v_total_saidas / v_dias_no_mes, 2);
  END IF;

  SELECT COALESCE(SUM(valor), 0)
  INTO v_despesas_fixas
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= v_data_inicio
    AND data < v_data_fim
    AND tipo = 'saida'
    AND (recorrente = true OR id_recorrente IS NOT NULL)
    AND status != 'cancelada';

  SELECT jsonb_agg(gasto ORDER BY valor DESC)
  INTO v_maiores_gastos
  FROM (
    SELECT jsonb_build_object(
      'descricao', COALESCE(descricao, observacao, categoria),
      'valor', valor,
      'categoria', categoria,
      'data', data::date
    ) as gasto, valor
    FROM transacoes
    WHERE usuario_id = p_usuario_id
      AND data >= v_data_inicio
      AND data < v_data_fim
      AND tipo = 'saida'
      AND status != 'cancelada'
    ORDER BY valor DESC
    LIMIT 5
  ) top_gastos;

  SELECT jsonb_agg(cat ORDER BY total DESC)
  INTO v_categorias
  FROM (
    SELECT jsonb_build_object(
      'categoria', categoria,
      'total', SUM(valor)::numeric,
      'quantidade', COUNT(*)::int,
      'percentual', ROUND((SUM(valor) / NULLIF(v_total_saidas, 0)) * 100, 1)
    ) as cat, SUM(valor) as total
    FROM transacoes
    WHERE usuario_id = p_usuario_id
      AND data >= v_data_inicio
      AND data < v_data_fim
      AND tipo = 'saida'
      AND status != 'cancelada'
    GROUP BY categoria
    ORDER BY SUM(valor) DESC
  ) cats;

  v_resultado := jsonb_build_object(
    'periodo', jsonb_build_object(
      'mes', v_mes,
      'ano', v_ano,
      'nome_mes', CASE v_mes
        WHEN 1 THEN 'Janeiro' WHEN 2 THEN 'Fevereiro' WHEN 3 THEN 'Março'
        WHEN 4 THEN 'Abril' WHEN 5 THEN 'Maio' WHEN 6 THEN 'Junho'
        WHEN 7 THEN 'Julho' WHEN 8 THEN 'Agosto' WHEN 9 THEN 'Setembro'
        WHEN 10 THEN 'Outubro' WHEN 11 THEN 'Novembro' WHEN 12 THEN 'Dezembro'
      END
    ),
    'totais', jsonb_build_object(
      'entradas', v_total_entradas,
      'saidas', v_total_saidas,
      'saldo', v_saldo,
      'media_diaria', v_media_diaria,
      'despesas_fixas', v_despesas_fixas
    ),
    'maiores_gastos', COALESCE(v_maiores_gastos, '[]'::jsonb),
    'categorias', COALESCE(v_categorias, '[]'::jsonb)
  );

  RETURN v_resultado;
END;
$function$;

-- Fix fn_analise_consultiva with authorization check
CREATE OR REPLACE FUNCTION public.fn_analise_consultiva(p_usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_media_semanal numeric := 0;
  v_gastos_semana_atual numeric := 0;
  v_total_parcelado_mes numeric := 0;
  v_total_saidas_mes numeric := 0;
  v_saldo_semana numeric := 0;
  v_categoria_dominante text;
  v_percentual_categoria numeric := 0;
  v_alertas jsonb := '[]'::jsonb;
  v_alerta text;
  v_ultimo_alerta timestamp;
  v_resultado jsonb;
BEGIN
  -- AUTHORIZATION CHECK: Only allow own data or service_role
  IF p_usuario_id != auth.uid() AND NOT is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot access other users data';
  END IF;

  SELECT MAX(created_at)
  INTO v_ultimo_alerta
  FROM historico_conversas
  WHERE user_id = p_usuario_id
    AND tipo = 'alerta_consultivo';

  IF v_ultimo_alerta IS NOT NULL AND v_ultimo_alerta > current_timestamp - INTERVAL '7 days' THEN
    RETURN jsonb_build_object('gerar_alerta', false, 'motivo', 'alerta_recente');
  END IF;

  SELECT COALESCE(AVG(total), 0)
  INTO v_media_semanal
  FROM (
    SELECT SUM(valor) as total
    FROM transacoes
    WHERE usuario_id = p_usuario_id
      AND data >= current_date - 28
      AND data < current_date - 7
      AND tipo = 'saida'
      AND status != 'cancelada'
    GROUP BY DATE_TRUNC('week', data)
  ) semanas;

  SELECT COALESCE(SUM(valor), 0)
  INTO v_gastos_semana_atual
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= current_date - EXTRACT(DOW FROM current_date)::int
    AND tipo = 'saida'
    AND status != 'cancelada';

  SELECT COALESCE(SUM(valor), 0)
  INTO v_total_parcelado_mes
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= DATE_TRUNC('month', current_date)
    AND tipo = 'saida'
    AND parcelamento_id IS NOT NULL
    AND status != 'cancelada';

  SELECT COALESCE(SUM(valor), 0)
  INTO v_total_saidas_mes
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= DATE_TRUNC('month', current_date)
    AND tipo = 'saida'
    AND status != 'cancelada';

  SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)
  INTO v_saldo_semana
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= current_date - 7
    AND status != 'cancelada';

  SELECT categoria, ROUND((SUM(valor) / NULLIF(v_total_saidas_mes, 0)) * 100, 1)
  INTO v_categoria_dominante, v_percentual_categoria
  FROM transacoes
  WHERE usuario_id = p_usuario_id
    AND data >= DATE_TRUNC('month', current_date)
    AND tipo = 'saida'
    AND status != 'cancelada'
  GROUP BY categoria
  ORDER BY SUM(valor) DESC
  LIMIT 1;

  IF v_media_semanal > 0 AND v_gastos_semana_atual > v_media_semanal * 1.3 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'aumento_gastos',
      'mensagem', 'Seus gastos esta semana estão acima da sua média',
      'dados', jsonb_build_object(
        'media_semanal', v_media_semanal,
        'gastos_semana', v_gastos_semana_atual,
        'percentual_acima', ROUND(((v_gastos_semana_atual - v_media_semanal) / v_media_semanal) * 100, 1)
      )
    );
  END IF;

  IF v_total_saidas_mes > 0 AND v_total_parcelado_mes / v_total_saidas_mes > 0.4 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'parcelamentos_alto',
      'mensagem', 'Grande parte dos seus gastos são parcelamentos',
      'dados', jsonb_build_object(
        'total_parcelado', v_total_parcelado_mes,
        'total_saidas', v_total_saidas_mes,
        'percentual', ROUND((v_total_parcelado_mes / v_total_saidas_mes) * 100, 1)
      )
    );
  END IF;

  IF v_saldo_semana < 0 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'saldo_negativo',
      'mensagem', 'Você gastou mais do que recebeu esta semana',
      'dados', jsonb_build_object(
        'saldo_semana', v_saldo_semana
      )
    );
  END IF;

  IF v_percentual_categoria > 50 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'categoria_dominante',
      'mensagem', 'Uma categoria está dominando seu orçamento',
      'dados', jsonb_build_object(
        'categoria', v_categoria_dominante,
        'percentual', v_percentual_categoria
      )
    );
  END IF;

  v_resultado := jsonb_build_object(
    'gerar_alerta', jsonb_array_length(v_alertas) > 0,
    'alertas', v_alertas,
    'dados_resumo', jsonb_build_object(
      'media_semanal', v_media_semanal,
      'gastos_semana_atual', v_gastos_semana_atual,
      'saldo_semana', v_saldo_semana,
      'total_parcelado_mes', v_total_parcelado_mes,
      'categoria_dominante', v_categoria_dominante,
      'percentual_categoria', v_percentual_categoria
    )
  );

  RETURN v_resultado;
END;
$function$;

-- Fix fn_update_resumo_mensal with authorization check
CREATE OR REPLACE FUNCTION public.fn_update_resumo_mensal(p_user_id uuid, p_mes integer, p_ano integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  start_date date := make_date(p_ano, p_mes, 1);
  end_date date := (start_date + INTERVAL '1 month')::date;
  v_total_gastos numeric := 0;
  v_total_entradas numeric := 0;
  v_total_cartao numeric := 0;
  v_total_fixos numeric := 0;
  v_total_essenciais numeric := 0;
  v_total_parcelado numeric := 0;
  v_total_recorrente numeric := 0;
  v_categoria_mais_cara text;
BEGIN
  -- AUTHORIZATION CHECK: Only allow own data or service_role
  IF p_user_id != auth.uid() AND NOT is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized: Cannot access other users data';
  END IF;

  SELECT
    COALESCE(SUM(t.valor) FILTER (WHERE t.tipo = 'saida'), 0),
    COALESCE(SUM(t.valor) FILTER (WHERE t.tipo = 'entrada'), 0),
    COALESCE(SUM(t.valor) FILTER (WHERE t.id_cartao IS NOT NULL), 0),
    COALESCE(SUM(t.valor) FILTER (WHERE t.recorrente = true), 0),
    COALESCE(SUM(t.valor) FILTER (WHERE t.essencial = true), 0),
    COALESCE(SUM(t.valor) FILTER (WHERE t.parcelamento_id IS NOT NULL), 0),
    COALESCE(SUM(t.valor) FILTER (WHERE t.id_recorrente IS NOT NULL), 0)
  INTO v_total_gastos, v_total_entradas, v_total_cartao, v_total_fixos, 
       v_total_essenciais, v_total_parcelado, v_total_recorrente
  FROM transacoes t
  WHERE t.usuario_id = p_user_id 
    AND t.data >= start_date 
    AND t.data < end_date
    AND t.status != 'cancelada';

  SELECT categoria INTO v_categoria_mais_cara
  FROM transacoes
  WHERE usuario_id = p_user_id 
    AND data >= start_date 
    AND data < end_date
    AND tipo = 'saida'
    AND status != 'cancelada'
  GROUP BY categoria
  ORDER BY SUM(valor) DESC
  LIMIT 1;

  INSERT INTO resumo_mensal (
    id, usuario_id, mes, ano, 
    total_gastos, total_entradas, total_essenciais, total_fixos, 
    total_cartao, total_parcelado, total_recorrente,
    saldo_final, categoria_mais_cara, atualizado_em
  )
  VALUES (
    gen_random_uuid(), p_user_id, p_mes, p_ano,
    v_total_gastos, v_total_entradas, v_total_essenciais, v_total_fixos,
    v_total_cartao, v_total_parcelado, v_total_recorrente,
    (v_total_entradas - v_total_gastos), v_categoria_mais_cara, now()
  )
  ON CONFLICT (usuario_id, mes, ano) DO UPDATE
  SET total_gastos = EXCLUDED.total_gastos,
      total_entradas = EXCLUDED.total_entradas,
      total_essenciais = EXCLUDED.total_essenciais,
      total_fixos = EXCLUDED.total_fixos,
      total_cartao = EXCLUDED.total_cartao,
      total_parcelado = EXCLUDED.total_parcelado,
      total_recorrente = EXCLUDED.total_recorrente,
      saldo_final = EXCLUDED.saldo_final,
      categoria_mais_cara = EXCLUDED.categoria_mais_cara,
      atualizado_em = now();
END;
$function$;

-- Note: trg_transacoes_upsert_resumo is a trigger function and is safe because:
-- 1. It's only called by the trigger system (not directly via RPC)
-- 2. It operates on the NEW/OLD record from the triggering transaction
-- 3. RLS already validates the triggering operation
