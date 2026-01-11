-- ============================================================================
-- Security Fix Migration: Enable RLS on all tables and fix security definer views
-- ============================================================================

-- 1. Enable RLS on tables that don't have it
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erros_interpretacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos_brutos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finax_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hipoteses_registro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_jobs ENABLE ROW LEVEL SECURITY;

-- 2. Create service role policies for backend operations (these tables are managed by edge functions)
-- actions table - service role access only (managed by finax-worker)
CREATE POLICY "actions_service_role_all" ON public.actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- erros_interpretacao - service role access only (internal error logging)
CREATE POLICY "erros_interpretacao_service_role_all" ON public.erros_interpretacao
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- eventos_brutos - service role access only (webhook processing)
CREATE POLICY "eventos_brutos_service_role_all" ON public.eventos_brutos
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- finax_logs - service role access only (internal logging)
CREATE POLICY "finax_logs_service_role_all" ON public.finax_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- hipoteses_registro - service role access only (ML/AI processing)
CREATE POLICY "hipoteses_registro_service_role_all" ON public.hipoteses_registro
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- media_analysis - service role access only (media processing)
CREATE POLICY "media_analysis_service_role_all" ON public.media_analysis
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- pending_selections - service role access only (conversation state)
CREATE POLICY "pending_selections_service_role_all" ON public.pending_selections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- webhook_jobs - service role access only (job queue)
CREATE POLICY "webhook_jobs_service_role_all" ON public.webhook_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Fix SECURITY DEFINER views by recreating them with SECURITY INVOKER
-- First, drop and recreate the views without SECURITY DEFINER

-- Drop and recreate vw_parcelas_abertas
DROP VIEW IF EXISTS public.vw_parcelas_abertas;
CREATE VIEW public.vw_parcelas_abertas 
WITH (security_invoker = true) AS
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

-- Drop and recreate vw_parcelas_pendentes_usuario  
DROP VIEW IF EXISTS public.vw_parcelas_pendentes_usuario;
CREATE VIEW public.vw_parcelas_pendentes_usuario
WITH (security_invoker = true) AS
SELECT 
  id AS parcelamento_id,
  usuario_id,
  descricao,
  num_parcelas,
  parcela_atual,
  (num_parcelas - parcela_atual) AS restantes
FROM parcelamentos
WHERE ativa = true;

-- Drop and recreate vw_resumo_mes_atual
DROP VIEW IF EXISTS public.vw_resumo_mes_atual;
CREATE VIEW public.vw_resumo_mes_atual
WITH (security_invoker = true) AS
SELECT 
  usuario_id,
  date_trunc('month', now()) AS mes,
  count(*) AS total_transacoes,
  COALESCE(sum(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
  COALESCE(sum(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_saidas,
  (COALESCE(sum(valor) FILTER (WHERE tipo = 'entrada'), 0) - COALESCE(sum(valor) FILTER (WHERE tipo = 'saida'), 0)) AS saldo_final
FROM transacoes
WHERE date_trunc('month', data) = date_trunc('month', now()) AND status <> 'cancelada'
GROUP BY usuario_id;

-- Drop and recreate vw_transacoes_mes
DROP VIEW IF EXISTS public.vw_transacoes_mes;
CREATE VIEW public.vw_transacoes_mes
WITH (security_invoker = true) AS
SELECT 
  usuario_id,
  date_trunc('month', data) AS mes_inicio,
  count(*) AS total_transacoes,
  COALESCE(sum(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
  COALESCE(sum(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_gastos
FROM transacoes
WHERE status <> 'cancelada'
GROUP BY usuario_id, date_trunc('month', data);

-- Drop and recreate vw_faturas_em_aberto
DROP VIEW IF EXISTS public.vw_faturas_em_aberto;
CREATE VIEW public.vw_faturas_em_aberto
WITH (security_invoker = true) AS
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
WHERE fc.status = ANY (ARRAY['aberta', 'pendente']);

-- Drop and recreate vw_recorrencias_ativas
DROP VIEW IF EXISTS public.vw_recorrencias_ativas;
CREATE VIEW public.vw_recorrencias_ativas
WITH (security_invoker = true) AS
SELECT 
  id, usuario_id, descricao, categoria, valor_total, valor_parcela,
  parcela_atual, num_parcelas, tipo_recorrencia, dia_semana, dia_mes,
  ativo, created_at, updated_at, ultima_execucao, proxima_execucao,
  origem, categoria_detalhada
FROM gastos_recorrentes
WHERE ativo = true;

-- Drop and recreate vw_gastos_categoria
DROP VIEW IF EXISTS public.vw_gastos_categoria;
CREATE VIEW public.vw_gastos_categoria
WITH (security_invoker = true) AS
SELECT 
  usuario_id,
  to_char(data, 'YYYY-MM') AS mes,
  categoria,
  count(*) AS quantidade,
  sum(valor) AS total
FROM transacoes
WHERE tipo = 'saida' AND status <> 'cancelada'
GROUP BY usuario_id, to_char(data, 'YYYY-MM'), categoria;

-- Drop and recreate vw_resumo_mensal
DROP VIEW IF EXISTS public.vw_resumo_mensal;
CREATE VIEW public.vw_resumo_mensal
WITH (security_invoker = true) AS
SELECT 
  usuario_id,
  to_char(data, 'YYYY-MM') AS mes,
  count(*) AS total_transacoes,
  COALESCE(sum(valor) FILTER (WHERE tipo = 'entrada'), 0) AS total_entradas,
  COALESCE(sum(valor) FILTER (WHERE tipo = 'saida'), 0) AS total_saidas,
  (COALESCE(sum(valor) FILTER (WHERE tipo = 'entrada'), 0) - COALESCE(sum(valor) FILTER (WHERE tipo = 'saida'), 0)) AS saldo
FROM transacoes
WHERE status <> 'cancelada'
GROUP BY usuario_id, to_char(data, 'YYYY-MM');

-- Drop and recreate vw_transacoes_agrupadas_categoria
DROP VIEW IF EXISTS public.vw_transacoes_agrupadas_categoria;
CREATE VIEW public.vw_transacoes_agrupadas_categoria
WITH (security_invoker = true) AS
SELECT 
  usuario_id,
  to_char(data, 'YYYY-MM') AS mes,
  categoria,
  count(*) AS quantidade,
  sum(valor) AS total
FROM transacoes
WHERE status <> 'cancelada'
GROUP BY usuario_id, to_char(data, 'YYYY-MM'), categoria;