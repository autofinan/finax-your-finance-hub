-- Fix remaining SECURITY DEFINER views by dropping and recreating with security_invoker

-- Drop and recreate vw_dashboard_usuario
DROP VIEW IF EXISTS public.vw_dashboard_usuario CASCADE;
CREATE VIEW public.vw_dashboard_usuario
WITH (security_invoker = true) AS
SELECT u.id AS usuario_id,
    COALESCE(tm.total_gastos, (0)::numeric) AS total_gastos_mes,
    COALESCE(tm.total_entradas, (0)::numeric) AS total_entradas_mes,
    COALESCE(tm.saldo, (0)::numeric) AS saldo_mes,
    COALESCE(tm.num_transacoes, (0)::bigint) AS transacoes_no_mes,
    COALESCE(rec.total_recorrente, (0)::numeric) AS total_fixos_mes,
    COALESCE(fat.total_cartao, (0)::numeric) AS total_cartao_mes,
    COALESCE(parc.parcelas_ativas, (0)::bigint) AS parcelas_ativas
FROM usuarios u
LEFT JOIN (
    SELECT transacoes.usuario_id,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'saida') AS total_gastos,
        sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'entrada') AS total_entradas,
        (sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'entrada') - sum(transacoes.valor) FILTER (WHERE transacoes.tipo = 'saida')) AS saldo,
        count(*) AS num_transacoes
    FROM transacoes
    WHERE date_trunc('month', transacoes.data) = date_trunc('month', now()) AND transacoes.status <> 'cancelada'
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
    WHERE faturas_cartao.status = 'aberta' 
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

-- Drop and recreate vw_transacoes_mes_atual
DROP VIEW IF EXISTS public.vw_transacoes_mes_atual CASCADE;
CREATE VIEW public.vw_transacoes_mes_atual
WITH (security_invoker = true) AS
SELECT t.id,
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

-- Drop and recreate vw_active_contexts
DROP VIEW IF EXISTS public.vw_active_contexts CASCADE;
CREATE VIEW public.vw_active_contexts
WITH (security_invoker = true) AS
SELECT id,
    user_id,
    label,
    description,
    start_date,
    end_date,
    status,
    auto_tag,
    total_spent,
    transaction_count,
    created_at,
    updated_at,
    (end_date - now()) AS time_remaining
FROM user_contexts
WHERE status = 'active';