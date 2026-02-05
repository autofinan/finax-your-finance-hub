-- Fix remaining 5 views with SECURITY INVOKER

-- 1. ai_accuracy_summary (re-create if first batch was rolled back)
DROP VIEW IF EXISTS public.ai_accuracy_summary;
CREATE VIEW public.ai_accuracy_summary
WITH (security_invoker = true)
AS
SELECT ai_classification,
    count(*) AS total_decisions,
    avg(ai_confidence) AS avg_confidence,
    count(CASE WHEN user_confirmed = true THEN 1 ELSE NULL::integer END) AS correct_count,
    count(CASE WHEN user_confirmed = false THEN 1 ELSE NULL::integer END) AS error_count,
    round(100.0 * count(CASE WHEN user_confirmed = true THEN 1 ELSE NULL::integer END)::numeric / 
          NULLIF(count(CASE WHEN user_confirmed IS NOT NULL THEN 1 ELSE NULL::integer END), 0)::numeric, 2) AS accuracy_percent
FROM ai_decisions
WHERE user_confirmed IS NOT NULL
GROUP BY ai_classification
ORDER BY (count(*)) DESC;

-- 2. queue_status
DROP VIEW IF EXISTS public.queue_status;
CREATE VIEW public.queue_status
WITH (security_invoker = true)
AS
SELECT u.id AS user_id,
    u.nome AS user_name,
    u.phone_number,
    count(pm.id) FILTER (WHERE pm.processed = false AND pm.processing = false) AS pending,
    count(pm.id) FILTER (WHERE pm.processed = false AND pm.processing = true) AS processing,
    count(pm.id) FILTER (WHERE pm.processed = true) AS processed_total,
    cs.pending_slot,
    cs.current_transaction_id,
    cs.updated_at AS state_updated_at
FROM usuarios u
LEFT JOIN pending_messages pm ON u.id = pm.user_id
LEFT JOIN conversation_state cs ON u.id = cs.user_id
GROUP BY u.id, u.nome, u.phone_number, cs.pending_slot, cs.current_transaction_id, cs.updated_at
HAVING count(pm.id) > 0 OR cs.pending_slot IS NOT NULL
ORDER BY cs.updated_at DESC NULLS LAST;

-- 3. vw_contas_a_vencer
DROP VIEW IF EXISTS public.vw_contas_a_vencer;
CREATE VIEW public.vw_contas_a_vencer
WITH (security_invoker = true)
AS
SELECT cp.id, cp.usuario_id, cp.nome, cp.tipo, cp.dia_vencimento, cp.valor_estimado,
    cp.lembrar_dias_antes, cp.ativa, cp.ultimo_lembrete, cp.created_at, cp.updated_at,
    u.nome AS usuario_nome, u.phone_number,
    CASE
        WHEN cp.dia_vencimento::numeric >= EXTRACT(day FROM CURRENT_DATE) 
          THEN cp.dia_vencimento - EXTRACT(day FROM CURRENT_DATE)::integer
        ELSE cp.dia_vencimento + (date_part('days'::text, date_trunc('month'::text, CURRENT_DATE + '1 mon'::interval) - '1 day'::interval)::integer - EXTRACT(day FROM CURRENT_DATE)::integer)
    END AS dias_ate_vencimento
FROM contas_pagar cp
JOIN usuarios u ON cp.usuario_id = u.id
WHERE cp.ativa = true;

-- 4. vw_dashboard_usuario
DROP VIEW IF EXISTS public.vw_dashboard_usuario CASCADE;
CREATE VIEW public.vw_dashboard_usuario
WITH (security_invoker = true)
AS
SELECT u.id AS usuario_id,
    COALESCE(tm.total_gastos, 0::numeric) AS total_gastos_mes,
    COALESCE(tm.total_entradas, 0::numeric) AS total_entradas_mes,
    COALESCE(tm.saldo, 0::numeric) AS saldo_mes,
    COALESCE(tm.num_transacoes, 0::bigint) AS transacoes_no_mes,
    COALESCE(rec.total_recorrente, 0::numeric) AS total_fixos_mes,
    COALESCE(fat.total_cartao, 0::numeric) AS total_cartao_mes,
    COALESCE(parc.parcelas_ativas, 0::bigint) AS parcelas_ativas
FROM usuarios u
LEFT JOIN ( SELECT transacoes.usuario_id,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'saida'::text) AS total_gastos,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'entrada'::text) AS total_entradas,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'entrada'::text) - sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'saida'::text) AS saldo,
        count(*) AS num_transacoes
       FROM transacoes
      WHERE date_trunc('month'::text, transacoes.data) = date_trunc('month'::text, now()) AND transacoes.status <> 'cancelada'::text
      GROUP BY transacoes.usuario_id) tm ON tm.usuario_id = u.id
LEFT JOIN ( SELECT gastos_recorrentes.usuario_id,
        sum(gastos_recorrentes.valor_parcela) AS total_recorrente
       FROM gastos_recorrentes
      WHERE gastos_recorrentes.ativo = true
      GROUP BY gastos_recorrentes.usuario_id) rec ON rec.usuario_id = u.id
LEFT JOIN ( SELECT faturas_cartao.usuario_id,
        sum(faturas_cartao.valor_total) AS total_cartao
       FROM faturas_cartao
      WHERE faturas_cartao.status = 'aberta'::text AND faturas_cartao.mes = EXTRACT(month FROM now())::integer AND faturas_cartao.ano = EXTRACT(year FROM now())::integer
      GROUP BY faturas_cartao.usuario_id) fat ON fat.usuario_id = u.id
LEFT JOIN ( SELECT parcelamentos.usuario_id,
        count(*) AS parcelas_ativas
       FROM parcelamentos
      WHERE parcelamentos.ativa = true
      GROUP BY parcelamentos.usuario_id) parc ON parc.usuario_id = u.id;

-- 5. vw_status_plano
DROP VIEW IF EXISTS public.vw_status_plano;
CREATE VIEW public.vw_status_plano
WITH (security_invoker = true)
AS
SELECT u.id AS usuario_id, u.plano, u.trial_inicio, u.trial_fim,
    CASE
        WHEN u.plano = ANY (ARRAY['basico'::text, 'pro'::text]) THEN true
        WHEN u.plano = 'trial'::text THEN u.trial_fim > now()
        ELSE false
    END AS ativo,
    CASE
        WHEN u.plano = 'trial'::text THEN GREATEST(0::numeric, EXTRACT(day FROM u.trial_fim - now()))
        ELSE NULL::numeric
    END AS dias_restantes_trial
FROM usuarios u;