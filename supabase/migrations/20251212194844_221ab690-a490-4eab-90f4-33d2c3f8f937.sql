-- ===============================================
-- CORRIGIR VIEWS: Usar SECURITY INVOKER (padrão seguro)
-- ===============================================

-- Recriar as views com SECURITY INVOKER explícito

-- vw_dashboard_usuario
CREATE OR REPLACE VIEW public.vw_dashboard_usuario
WITH (security_invoker = true)
AS
SELECT 
  u.id AS usuario_id,
  COALESCE(tm.total_gastos, 0::numeric) AS total_gastos_mes,
  COALESCE(tm.total_entradas, 0::numeric) AS total_entradas_mes,
  COALESCE(tm.saldo, 0::numeric) AS saldo_mes,
  COALESCE(tm.num_transacoes, 0::bigint) AS transacoes_no_mes,
  COALESCE(rec.total_recorrente, 0::numeric) AS total_fixos_mes,
  COALESCE(fat.total_cartao, 0::numeric) AS total_cartao_mes,
  COALESCE(parc.parcelas_ativas, 0::bigint) AS parcelas_ativas
FROM usuarios u
LEFT JOIN (
  SELECT 
    usuario_id,
    SUM(valor) FILTER (WHERE tipo = 'saida') AS total_gastos,
    SUM(valor) FILTER (WHERE tipo = 'entrada') AS total_entradas,
    (SUM(valor) FILTER (WHERE tipo = 'entrada') - SUM(valor) FILTER (WHERE tipo = 'saida')) AS saldo,
    COUNT(*) AS num_transacoes
  FROM transacoes
  WHERE date_trunc('month', data) = date_trunc('month', now()) 
    AND status != 'cancelada'
  GROUP BY usuario_id
) tm ON tm.usuario_id = u.id
LEFT JOIN (
  SELECT usuario_id, SUM(valor_parcela) AS total_recorrente
  FROM gastos_recorrentes
  WHERE ativo = true
  GROUP BY usuario_id
) rec ON rec.usuario_id = u.id
LEFT JOIN (
  SELECT usuario_id, SUM(valor_total) AS total_cartao
  FROM faturas_cartao
  WHERE status = 'aberta' 
    AND mes = EXTRACT(MONTH FROM now())::int 
    AND ano = EXTRACT(YEAR FROM now())::int
  GROUP BY usuario_id
) fat ON fat.usuario_id = u.id
LEFT JOIN (
  SELECT usuario_id, COUNT(*) AS parcelas_ativas
  FROM parcelamentos
  WHERE ativa = true
  GROUP BY usuario_id
) parc ON parc.usuario_id = u.id;

-- vw_faturas_em_aberto
CREATE OR REPLACE VIEW public.vw_faturas_em_aberto
WITH (security_invoker = true)
AS
SELECT 
  fc.id,
  fc.cartao_id,
  fc.usuario_id,
  fc.mes,
  fc.ano,
  fc.valor_total,
  fc.valor_pago,
  fc.status,
  fc.created_at,
  fc.updated_at,
  c.nome AS cartao_nome,
  c.dia_vencimento
FROM faturas_cartao fc
JOIN cartoes_credito c ON fc.cartao_id = c.id
WHERE fc.status IN ('aberta', 'pendente');

-- vw_parcelas_abertas
CREATE OR REPLACE VIEW public.vw_parcelas_abertas
WITH (security_invoker = true)
AS
SELECT 
  id,
  usuario_id,
  descricao,
  valor_total,
  num_parcelas,
  parcela_atual,
  valor_parcela,
  ativa,
  created_at,
  (num_parcelas - parcela_atual) AS parcelas_restantes
FROM parcelamentos
WHERE ativa = true AND parcela_atual < num_parcelas;

-- vw_parcelas_pendentes_usuario
CREATE OR REPLACE VIEW public.vw_parcelas_pendentes_usuario
WITH (security_invoker = true)
AS
SELECT 
  id AS parcelamento_id,
  usuario_id,
  descricao,
  num_parcelas,
  parcela_atual,
  (num_parcelas - parcela_atual) AS restantes
FROM parcelamentos
WHERE ativa = true;

-- vw_recorrencias_ativas
CREATE OR REPLACE VIEW public.vw_recorrencias_ativas
WITH (security_invoker = true)
AS
SELECT 
  id,
  usuario_id,
  descricao,
  categoria,
  valor_total,
  valor_parcela,
  parcela_atual,
  num_parcelas,
  tipo_recorrencia,
  dia_semana,
  dia_mes,
  ativo,
  created_at,
  updated_at,
  proxima_execucao,
  ultima_execucao,
  origem,
  categoria_detalhada
FROM gastos_recorrentes
WHERE ativo = true;

-- vw_resumo_mes_atual
CREATE OR REPLACE VIEW public.vw_resumo_mes_atual
WITH (security_invoker = true)
AS
SELECT 
  usuario_id,
  date_trunc('month', now()) AS mes,
  COUNT(*) AS total_transacoes,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_saidas,
  (COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) - COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0)) AS saldo_final
FROM transacoes
WHERE date_trunc('month', data) = date_trunc('month', now()) 
  AND status != 'cancelada'
GROUP BY usuario_id;

-- vw_transacoes_agrupadas_categoria
CREATE OR REPLACE VIEW public.vw_transacoes_agrupadas_categoria
WITH (security_invoker = true)
AS
SELECT 
  usuario_id,
  categoria,
  date_trunc('month', data) AS mes,
  SUM(valor) AS total,
  COUNT(*) AS quantidade
FROM transacoes
WHERE tipo = 'saida' AND status != 'cancelada'
GROUP BY usuario_id, categoria, date_trunc('month', data);

-- vw_transacoes_mes
CREATE OR REPLACE VIEW public.vw_transacoes_mes
WITH (security_invoker = true)
AS
SELECT 
  usuario_id,
  date_trunc('month', data) AS mes_inicio,
  COUNT(*) AS total_transacoes,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_gastos
FROM transacoes
WHERE status != 'cancelada'
GROUP BY usuario_id, date_trunc('month', data);

-- vw_transacoes_mes_atual
CREATE OR REPLACE VIEW public.vw_transacoes_mes_atual
WITH (security_invoker = true)
AS
SELECT 
  t.id,
  t.usuario_id,
  t.data,
  t.categoria,
  t.valor,
  t.observacao,
  t.tipo,
  t.recorrente,
  t.parcela,
  t.created_at,
  t.fatura_id,
  t.parcelamento_id,
  t.origem,
  t.essencial,
  t.merchant,
  t.hash_unico,
  t.atualizado_em,
  t.id_cartao,
  t.id_recorrente,
  t.status,
  t.parcela_atual,
  t.total_parcelas,
  t.descricao,
  c.nome AS cartao_nome
FROM transacoes t
LEFT JOIN cartoes_credito c ON t.id_cartao = c.id
WHERE date_trunc('month', t.data) = date_trunc('month', now());

-- ===============================================
-- CORRIGIR FUNÇÕES: Adicionar search_path
-- ===============================================

-- fn_update_resumo_mensal
CREATE OR REPLACE FUNCTION public.fn_update_resumo_mensal(p_user_id uuid, p_mes integer, p_ano integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- trg_transacoes_upsert_resumo
CREATE OR REPLACE FUNCTION public.trg_transacoes_upsert_resumo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mes int;
  v_ano int;
  uid uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    uid := OLD.usuario_id;
    v_mes := EXTRACT(MONTH FROM OLD.data)::int;
    v_ano := EXTRACT(YEAR FROM OLD.data)::int;
  ELSE
    uid := NEW.usuario_id;
    v_mes := EXTRACT(MONTH FROM NEW.data)::int;
    v_ano := EXTRACT(YEAR FROM NEW.data)::int;
  END IF;

  IF uid IS NOT NULL THEN
    PERFORM fn_update_resumo_mensal(uid, v_mes, v_ano);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- fn_process_recorrentes
CREATE OR REPLACE FUNCTION public.fn_process_recorrentes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r record;
  next_date date;
BEGIN
  FOR r IN
    SELECT * FROM gastos_recorrentes 
    WHERE ativo IS TRUE 
      AND (proxima_execucao IS NULL OR proxima_execucao <= current_date)
  LOOP
    IF r.proxima_execucao IS NOT NULL THEN
      next_date := r.proxima_execucao;
    ELSE
      next_date := current_date;
    END IF;

    INSERT INTO transacoes (
      id, usuario_id, valor, tipo, categoria, descricao, data, 
      recorrente, id_recorrente, created_at, origem
    ) VALUES (
      gen_random_uuid(), r.usuario_id, r.valor_parcela, 'saida', 
      r.categoria, r.descricao, next_date, true, r.id, now(), 'recorrente'
    );

    IF r.tipo_recorrencia = 'mensal' THEN
      UPDATE gastos_recorrentes
      SET ultima_execucao = next_date,
          proxima_execucao = (next_date + INTERVAL '1 month')::date
      WHERE id = r.id;
    ELSIF r.tipo_recorrencia = 'semanal' THEN
      UPDATE gastos_recorrentes
      SET ultima_execucao = next_date,
          proxima_execucao = (next_date + INTERVAL '7 day')::date
      WHERE id = r.id;
    ELSIF r.tipo_recorrencia = 'anual' THEN
      UPDATE gastos_recorrentes
      SET ultima_execucao = next_date,
          proxima_execucao = (next_date + INTERVAL '1 year')::date
      WHERE id = r.id;
    ELSE
      UPDATE gastos_recorrentes
      SET ultima_execucao = next_date,
          proxima_execucao = (next_date + INTERVAL '1 month')::date
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$function$;

-- fn_close_card_faturas
CREATE OR REPLACE FUNCTION public.fn_close_card_faturas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c record;
  start_month date;
  end_month date;
  total numeric;
  mes int;
  ano int;
BEGIN
  FOR c IN SELECT * FROM cartoes_credito WHERE ativo IS TRUE LOOP
    mes := EXTRACT(MONTH FROM now())::int;
    ano := EXTRACT(YEAR FROM now())::int;
    start_month := make_date(ano, mes, 1);
    end_month := (start_month + INTERVAL '1 month')::date;

    SELECT COALESCE(SUM(t.valor), 0) INTO total
    FROM transacoes t
    WHERE t.id_cartao = c.id 
      AND t.data >= start_month 
      AND t.data < end_month
      AND t.tipo = 'saida'
      AND t.status != 'cancelada';

    INSERT INTO faturas_cartao (id, cartao_id, usuario_id, mes, ano, valor_total, status, created_at)
    VALUES (gen_random_uuid(), c.id, c.usuario_id, mes, ano, total, 'aberta', now())
    ON CONFLICT (cartao_id, mes, ano) DO UPDATE
      SET valor_total = EXCLUDED.valor_total, updated_at = now();
  END LOOP;
END;
$function$;

-- fn_daily_jobs
CREATE OR REPLACE FUNCTION public.fn_daily_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM fn_process_recorrentes();
  PERFORM fn_close_card_faturas();
END;
$function$;

-- fn_generate_parcelas
CREATE OR REPLACE FUNCTION public.fn_generate_parcelas(p_parcelamento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  p record;
  i int;
  start_date date := current_date;
  due_date date;
BEGIN
  SELECT * INTO p FROM parcelamentos WHERE id = p_parcelamento_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR i IN p.parcela_atual..p.num_parcelas LOOP
    due_date := start_date + ((i - p.parcela_atual) * INTERVAL '1 month')::interval;
    INSERT INTO transacoes (
      id, usuario_id, valor, tipo, categoria, data, parcelamento_id, 
      parcela, created_at, origem, parcela_atual, total_parcelas
    ) VALUES (
      gen_random_uuid(), p.usuario_id, p.valor_parcela, 'saida', 
      COALESCE(p.descricao, 'Parcelamento'), due_date, p.id, 
      (i || '/' || p.num_parcelas), now(), 'parcelamento', i, p.num_parcelas
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE parcelamentos SET parcela_atual = p.num_parcelas WHERE id = p.id;
END;
$function$;

-- rpc_criar_parcelamento
CREATE OR REPLACE FUNCTION public.rpc_criar_parcelamento(
  p_usuario_id uuid, 
  p_valor_total numeric, 
  p_num_parcelas integer, 
  p_descricao text, 
  p_categoria text DEFAULT 'Parcelamento'::text, 
  p_id_cartao uuid DEFAULT NULL::uuid, 
  p_data_primeira_parcela date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_parcelamento_id uuid := gen_random_uuid();
  v_valor_parcela numeric := p_valor_total / p_num_parcelas;
  i integer;
  v_data_parcela date;
BEGIN
  INSERT INTO parcelamentos (
    id, usuario_id, valor_total, num_parcelas, parcela_atual,
    valor_parcela, ativa, descricao, created_at
  )
  VALUES (
    v_parcelamento_id, p_usuario_id, p_valor_total, p_num_parcelas, 1,
    v_valor_parcela, true, p_descricao, now()
  );

  FOR i IN 1..p_num_parcelas LOOP
    v_data_parcela := p_data_primeira_parcela + ((i - 1) * INTERVAL '1 month')::interval;
    
    INSERT INTO transacoes (
      id, usuario_id, valor, tipo, categoria, descricao, observacao,
      data, origem, id_cartao, parcela_atual, total_parcelas,
      parcelamento_id, status, parcela, created_at
    )
    VALUES (
      gen_random_uuid(), p_usuario_id, v_valor_parcela, 'saida', 
      p_categoria, p_descricao, p_descricao,
      v_data_parcela, 'parcelamento', p_id_cartao, i, p_num_parcelas,
      v_parcelamento_id, 
      CASE WHEN i = 1 THEN 'confirmada' ELSE 'prevista' END,
      (i || '/' || p_num_parcelas),
      now()
    );
  END LOOP;

  RETURN v_parcelamento_id;
END;
$function$;

-- rpc_registrar_transacao (versão completa)
CREATE OR REPLACE FUNCTION public.rpc_registrar_transacao(
  p_usuario_id uuid, 
  p_valor numeric, 
  p_tipo text, 
  p_categoria text, 
  p_descricao text DEFAULT NULL, 
  p_data timestamp without time zone DEFAULT now(), 
  p_origem text DEFAULT 'manual', 
  p_id_cartao uuid DEFAULT NULL, 
  p_parcela_atual integer DEFAULT NULL, 
  p_total_parcelas integer DEFAULT NULL, 
  p_id_recorrente uuid DEFAULT NULL, 
  p_parcelamento_id uuid DEFAULT NULL, 
  p_essencial boolean DEFAULT false, 
  p_status text DEFAULT 'confirmada'
)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  new_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO transacoes (
    id, usuario_id, valor, tipo, categoria, descricao, observacao,
    data, origem, id_cartao, parcela_atual, total_parcelas,
    id_recorrente, parcelamento_id, essencial, status, created_at
  )
  VALUES (
    new_id, p_usuario_id, p_valor, p_tipo, p_categoria, p_descricao, p_descricao,
    COALESCE(p_data, now()), p_origem, p_id_cartao, p_parcela_atual, p_total_parcelas,
    p_id_recorrente, p_parcelamento_id, p_essencial, p_status, now()
  );

  RETURN QUERY SELECT new_id;
END;
$function$;

-- atualizar_resumo_mensal
CREATE OR REPLACE FUNCTION public.atualizar_resumo_mensal(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mes int := EXTRACT(MONTH FROM now())::int;
  v_ano int := EXTRACT(YEAR FROM now())::int;
BEGIN
  PERFORM fn_update_resumo_mensal(p_usuario, v_mes, v_ano);
END;
$function$;

-- trigger_atualizar_resumo
CREATE OR REPLACE FUNCTION public.trigger_atualizar_resumo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM atualizar_resumo_mensal(NEW.usuario_id);
  RETURN NEW;
END;
$function$;