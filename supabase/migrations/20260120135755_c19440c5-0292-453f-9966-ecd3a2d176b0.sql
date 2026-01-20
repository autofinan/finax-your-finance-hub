-- =====================================================
-- Security Fix: Recreate views with SECURITY INVOKER
-- This ensures views respect RLS policies of the querying user
-- =====================================================

-- Drop and recreate vw_dashboard_usuario with security_invoker
DROP VIEW IF EXISTS public.vw_dashboard_usuario;
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
LEFT JOIN (
    SELECT transacoes.usuario_id,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'saida'::text) AS total_gastos,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'entrada'::text) AS total_entradas,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'entrada'::text) - 
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'saida'::text) AS saldo,
        count(*) AS num_transacoes
    FROM transacoes
    WHERE date_trunc('month'::text, transacoes.data) = date_trunc('month'::text, now()) 
        AND transacoes.status <> 'cancelada'::text
    GROUP BY transacoes.usuario_id
) tm ON tm.usuario_id = u.id
LEFT JOIN (
    SELECT gastos_recorrentes.usuario_id,
        sum(gastos_recorrentes.valor_parcela) AS total_recorrente
    FROM gastos_recorrentes
    WHERE gastos_recorrentes.ativo = true
    GROUP BY gastos_recorrentes.usuario_id
) rec ON rec.usuario_id = u.id
LEFT JOIN (
    SELECT faturas_cartao.usuario_id,
        sum(faturas_cartao.valor_total) AS total_cartao
    FROM faturas_cartao
    WHERE faturas_cartao.status = 'aberta'::text 
        AND faturas_cartao.mes = EXTRACT(month FROM now())::integer 
        AND faturas_cartao.ano = EXTRACT(year FROM now())::integer
    GROUP BY faturas_cartao.usuario_id
) fat ON fat.usuario_id = u.id
LEFT JOIN (
    SELECT parcelamentos.usuario_id,
        count(*) AS parcelas_ativas
    FROM parcelamentos
    WHERE parcelamentos.ativa = true
    GROUP BY parcelamentos.usuario_id
) parc ON parc.usuario_id = u.id;

-- Grant appropriate permissions
GRANT SELECT ON public.vw_dashboard_usuario TO authenticated;
GRANT SELECT ON public.vw_dashboard_usuario TO service_role;

-- Drop and recreate vw_status_plano with security_invoker
DROP VIEW IF EXISTS public.vw_status_plano;
CREATE VIEW public.vw_status_plano
WITH (security_invoker = true)
AS
SELECT id AS usuario_id,
    phone_number,
    nome,
    plano,
    trial_inicio,
    trial_fim,
    CASE
        WHEN plano = ANY (ARRAY['basico'::text, 'pro'::text]) THEN 'ativo'::text
        WHEN plano = 'trial'::text AND trial_fim > now() THEN 'trial_ativo'::text
        WHEN plano = 'trial'::text AND trial_fim <= now() THEN 'trial_expirado'::text
        ELSE 'indefinido'::text
    END AS status_plano,
    CASE
        WHEN plano = 'trial'::text AND trial_fim > now() THEN EXTRACT(day FROM trial_fim - now())::integer
        ELSE NULL::integer
    END AS dias_restantes_trial,
    CASE
        WHEN plano = 'trial'::text AND trial_fim > now() THEN
            CASE
                WHEN (trial_fim - now()) <= '2 days'::interval THEN 'urgente'::text
                WHEN (trial_fim - now()) <= '4 days'::interval THEN 'aviso'::text
                ELSE 'ok'::text
            END
        ELSE NULL::text
    END AS alerta_trial
FROM usuarios u;

-- Grant appropriate permissions
GRANT SELECT ON public.vw_status_plano TO authenticated;
GRANT SELECT ON public.vw_status_plano TO service_role;