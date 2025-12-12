
-- ============================================
-- MIGRAÇÃO: Alinhamento com modelo Finax
-- ============================================

-- 1) Adicionar colunas faltantes em transacoes
ALTER TABLE public.transacoes 
ADD COLUMN IF NOT EXISTS id_cartao uuid REFERENCES public.cartoes_credito(id),
ADD COLUMN IF NOT EXISTS id_recorrente uuid REFERENCES public.gastos_recorrentes(id),
ADD COLUMN IF NOT EXISTS status text DEFAULT 'confirmada',
ADD COLUMN IF NOT EXISTS parcela_atual integer,
ADD COLUMN IF NOT EXISTS total_parcelas integer,
ADD COLUMN IF NOT EXISTS descricao text;

-- Comentário: parcela_atual e total_parcelas substituem o campo "parcela" (texto "1/4")
-- Mantemos o campo "parcela" para retrocompatibilidade

-- 2) Adicionar coluna "ativo" em cartoes_credito
ALTER TABLE public.cartoes_credito
ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;

-- 3) Melhorar resumo_mensal com campos adicionais
ALTER TABLE public.resumo_mensal
ADD COLUMN IF NOT EXISTS total_entradas numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_parcelado numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_recorrente numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS categoria_mais_cara text,
ADD COLUMN IF NOT EXISTS alertas text;

-- 4) Melhorar perfil_cliente
ALTER TABLE public.perfil_cliente
ADD COLUMN IF NOT EXISTS limites jsonb,
ADD COLUMN IF NOT EXISTS alertas_financeiros jsonb,
ADD COLUMN IF NOT EXISTS preferencias jsonb;

-- 5) Atualizar faturas_cartao para ter updated_at
ALTER TABLE public.faturas_cartao
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- ============================================
-- RECRIAR VIEWS OTIMIZADAS
-- ============================================

-- View: vw_transacoes_mes_atual (transações do mês corrente)
DROP VIEW IF EXISTS public.vw_transacoes_mes_atual;
CREATE VIEW public.vw_transacoes_mes_atual AS
SELECT 
  t.*,
  c.nome as cartao_nome
FROM public.transacoes t
LEFT JOIN public.cartoes_credito c ON t.id_cartao = c.id
WHERE date_trunc('month', t.data) = date_trunc('month', now())
ORDER BY t.data DESC;

-- View: vw_transacoes_mes (resumo por mês)
DROP VIEW IF EXISTS public.vw_transacoes_mes;
CREATE VIEW public.vw_transacoes_mes AS
SELECT 
  usuario_id,
  date_trunc('month', data) as mes_inicio,
  COUNT(*) as total_transacoes,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) as total_entradas,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) as total_gastos
FROM public.transacoes
WHERE status != 'cancelada'
GROUP BY usuario_id, date_trunc('month', data)
ORDER BY mes_inicio DESC;

-- View: vw_resumo_mes_atual (resumo consolidado do mês atual)
DROP VIEW IF EXISTS public.vw_resumo_mes_atual;
CREATE VIEW public.vw_resumo_mes_atual AS
SELECT 
  usuario_id,
  date_trunc('month', now()) as mes,
  COUNT(*) as total_transacoes,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) as total_entradas,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) as total_saidas,
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada'), 0) - 
  COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida'), 0) as saldo_final
FROM public.transacoes
WHERE date_trunc('month', data) = date_trunc('month', now())
  AND status != 'cancelada'
GROUP BY usuario_id;

-- View: vw_parcelas_abertas (parcelamentos ativos com parcelas restantes)
DROP VIEW IF EXISTS public.vw_parcelas_abertas;
CREATE VIEW public.vw_parcelas_abertas AS
SELECT 
  p.*,
  (p.num_parcelas - p.parcela_atual) as parcelas_restantes
FROM public.parcelamentos p
WHERE p.ativa = true 
  AND p.parcela_atual < p.num_parcelas;

-- View: vw_parcelas_pendentes_usuario
DROP VIEW IF EXISTS public.vw_parcelas_pendentes_usuario;
CREATE VIEW public.vw_parcelas_pendentes_usuario AS
SELECT 
  p.id as parcelamento_id,
  p.usuario_id,
  p.descricao,
  p.num_parcelas,
  p.parcela_atual,
  (p.num_parcelas - p.parcela_atual) as restantes
FROM public.parcelamentos p
WHERE p.ativa = true;

-- View: vw_faturas_em_aberto (faturas não pagas)
DROP VIEW IF EXISTS public.vw_faturas_em_aberto;
CREATE VIEW public.vw_faturas_em_aberto AS
SELECT 
  fc.*,
  c.nome as cartao_nome,
  c.dia_vencimento
FROM public.faturas_cartao fc
JOIN public.cartoes_credito c ON fc.cartao_id = c.id
WHERE fc.status = 'aberta' OR fc.status = 'pendente';

-- View: vw_recorrencias_ativas
DROP VIEW IF EXISTS public.vw_recorrencias_ativas;
CREATE VIEW public.vw_recorrencias_ativas AS
SELECT * FROM public.gastos_recorrentes
WHERE ativo = true;

-- View: vw_dashboard_usuario (painel consolidado)
DROP VIEW IF EXISTS public.vw_dashboard_usuario;
CREATE VIEW public.vw_dashboard_usuario AS
SELECT 
  u.id as usuario_id,
  -- Totais do mês atual
  COALESCE(tm.total_gastos, 0) as total_gastos_mes,
  COALESCE(tm.total_entradas, 0) as total_entradas_mes,
  COALESCE(tm.saldo, 0) as saldo_mes,
  -- Contadores
  COALESCE(tm.num_transacoes, 0) as transacoes_no_mes,
  -- Fixos e recorrentes
  COALESCE(rec.total_recorrente, 0) as total_fixos_mes,
  -- Cartão
  COALESCE(fat.total_cartao, 0) as total_cartao_mes,
  -- Parcelamentos ativos
  COALESCE(parc.parcelas_ativas, 0) as parcelas_ativas
FROM public.usuarios u
LEFT JOIN (
  SELECT 
    usuario_id,
    SUM(valor) FILTER (WHERE tipo = 'saida') as total_gastos,
    SUM(valor) FILTER (WHERE tipo = 'entrada') as total_entradas,
    SUM(valor) FILTER (WHERE tipo = 'entrada') - SUM(valor) FILTER (WHERE tipo = 'saida') as saldo,
    COUNT(*) as num_transacoes
  FROM public.transacoes
  WHERE date_trunc('month', data) = date_trunc('month', now())
    AND status != 'cancelada'
  GROUP BY usuario_id
) tm ON tm.usuario_id = u.id
LEFT JOIN (
  SELECT 
    usuario_id,
    SUM(valor_parcela) as total_recorrente
  FROM public.gastos_recorrentes
  WHERE ativo = true
  GROUP BY usuario_id
) rec ON rec.usuario_id = u.id
LEFT JOIN (
  SELECT 
    usuario_id,
    SUM(valor_total) as total_cartao
  FROM public.faturas_cartao
  WHERE status = 'aberta'
    AND mes = EXTRACT(MONTH FROM now())
    AND ano = EXTRACT(YEAR FROM now())
  GROUP BY usuario_id
) fat ON fat.usuario_id = u.id
LEFT JOIN (
  SELECT 
    usuario_id,
    COUNT(*) as parcelas_ativas
  FROM public.parcelamentos
  WHERE ativa = true
  GROUP BY usuario_id
) parc ON parc.usuario_id = u.id;

-- View: vw_transacoes_agrupadas_categoria (gastos por categoria)
DROP VIEW IF EXISTS public.vw_transacoes_agrupadas_categoria;
CREATE VIEW public.vw_transacoes_agrupadas_categoria AS
SELECT 
  usuario_id,
  categoria,
  date_trunc('month', data) as mes,
  SUM(valor) as total,
  COUNT(*) as quantidade
FROM public.transacoes
WHERE tipo = 'saida' AND status != 'cancelada'
GROUP BY usuario_id, categoria, date_trunc('month', data)
ORDER BY total DESC;

-- ============================================
-- ATUALIZAR FUNÇÃO DE RESUMO MENSAL
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_update_resumo_mensal(p_user_id uuid, p_mes integer, p_ano integer)
RETURNS void
LANGUAGE plpgsql
AS $$
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
  -- Calcular totais
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

  -- Categoria mais cara
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

  -- Upsert no resumo_mensal
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
$$;

-- ============================================
-- RPC: Registrar transação completa
-- ============================================

CREATE OR REPLACE FUNCTION public.rpc_registrar_transacao(
  p_usuario_id uuid,
  p_valor numeric,
  p_tipo text,
  p_categoria text,
  p_descricao text DEFAULT NULL,
  p_data timestamp DEFAULT now(),
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
AS $$
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

  -- Atualizar resumo mensal
  PERFORM fn_update_resumo_mensal(
    p_usuario_id, 
    EXTRACT(MONTH FROM COALESCE(p_data, now()))::int, 
    EXTRACT(YEAR FROM COALESCE(p_data, now()))::int
  );

  -- Se for cartão, atualizar limite usado
  IF p_id_cartao IS NOT NULL AND p_tipo = 'saida' THEN
    UPDATE cartoes_credito 
    SET limite_disponivel = limite_disponivel - p_valor
    WHERE id = p_id_cartao;
  END IF;

  RETURN QUERY SELECT new_id;
END;
$$;

-- ============================================
-- RPC: Criar parcelamento completo
-- ============================================

CREATE OR REPLACE FUNCTION public.rpc_criar_parcelamento(
  p_usuario_id uuid,
  p_valor_total numeric,
  p_num_parcelas integer,
  p_descricao text,
  p_categoria text DEFAULT 'Parcelamento',
  p_id_cartao uuid DEFAULT NULL,
  p_data_primeira_parcela date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_parcelamento_id uuid := gen_random_uuid();
  v_valor_parcela numeric := p_valor_total / p_num_parcelas;
  i integer;
  v_data_parcela date;
BEGIN
  -- Criar registro do parcelamento
  INSERT INTO parcelamentos (
    id, usuario_id, valor_total, num_parcelas, parcela_atual,
    valor_parcela, ativa, descricao, created_at
  )
  VALUES (
    v_parcelamento_id, p_usuario_id, p_valor_total, p_num_parcelas, 1,
    v_valor_parcela, true, p_descricao, now()
  );

  -- Gerar todas as parcelas como transações
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
    
    -- Se tiver cartão, vincular à fatura do mês correspondente
    IF p_id_cartao IS NOT NULL THEN
      INSERT INTO faturas_cartao (
        id, cartao_id, usuario_id, mes, ano, valor_total, status, created_at
      )
      VALUES (
        gen_random_uuid(), p_id_cartao, p_usuario_id,
        EXTRACT(MONTH FROM v_data_parcela)::int,
        EXTRACT(YEAR FROM v_data_parcela)::int,
        v_valor_parcela, 'aberta', now()
      )
      ON CONFLICT (cartao_id, mes) DO UPDATE
      SET valor_total = faturas_cartao.valor_total + EXCLUDED.valor_total;
    END IF;
  END LOOP;

  RETURN v_parcelamento_id;
END;
$$;

-- ============================================
-- CONSTRAINT ÚNICA PARA FATURAS
-- ============================================

-- Adicionar constraint única se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'faturas_cartao_cartao_mes_unique'
  ) THEN
    ALTER TABLE public.faturas_cartao 
    ADD CONSTRAINT faturas_cartao_cartao_mes_unique 
    UNIQUE (cartao_id, mes, ano);
  END IF;
END $$;

-- ============================================
-- TRIGGER PARA ATUALIZAR RESUMO AUTOMATICAMENTE
-- ============================================

CREATE OR REPLACE FUNCTION public.trg_transacoes_upsert_resumo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
$$;

-- Recriar trigger
DROP TRIGGER IF EXISTS trg_transacoes_resumo ON public.transacoes;
CREATE TRIGGER trg_transacoes_resumo
  AFTER INSERT OR UPDATE OR DELETE ON public.transacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_transacoes_upsert_resumo();
