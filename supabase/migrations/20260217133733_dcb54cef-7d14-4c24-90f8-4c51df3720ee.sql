
-- Fix limite_disponivel based on open (unpaid) faturas only
-- Formula: limite_disponivel = limite_total - SUM(open fatura totals - paid amounts)
UPDATE cartoes_credito cc
SET limite_disponivel = cc.limite_total - COALESCE(
  (SELECT SUM(fc.valor_total - COALESCE(fc.valor_pago, 0))
   FROM faturas_cartao fc 
   WHERE fc.cartao_id = cc.id 
   AND fc.status IN ('aberta', 'fechada')),
  0
);
