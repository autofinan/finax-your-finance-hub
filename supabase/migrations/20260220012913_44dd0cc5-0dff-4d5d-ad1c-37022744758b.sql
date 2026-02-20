
-- PARTE 1: Adicionar cartao_id em gastos_recorrentes
ALTER TABLE gastos_recorrentes ADD COLUMN IF NOT EXISTS cartao_id uuid REFERENCES cartoes_credito(id) ON DELETE SET NULL;

-- PARTE 2: Corrigir status de faturas futuras (meses futuros devem ser 'futura', não 'aberta')
UPDATE faturas_cartao 
SET status = 'futura'
WHERE status = 'aberta'
  AND (
    ano > EXTRACT(YEAR FROM NOW())
    OR (ano = EXTRACT(YEAR FROM NOW()) AND mes > EXTRACT(MONTH FROM NOW()))
  );

-- PARTE 3: Índice para busca por cartao_id em gastos_recorrentes
CREATE INDEX IF NOT EXISTS idx_gastos_recorrentes_cartao_id ON gastos_recorrentes(cartao_id);
