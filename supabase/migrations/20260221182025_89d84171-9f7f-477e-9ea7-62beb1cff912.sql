
-- Fase 3A: Adicionar expense_type em transacoes
ALTER TABLE transacoes ADD COLUMN IF NOT EXISTS expense_type TEXT DEFAULT 'flexivel';

-- Fase 2A fix: RLS policies para tabela dividas (que já existe mas sem RLS)
ALTER TABLE dividas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dividas_select_own" ON dividas FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY "dividas_insert_own" ON dividas FOR INSERT WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "dividas_update_own" ON dividas FOR UPDATE USING (usuario_id = auth.uid());
CREATE POLICY "dividas_delete_own" ON dividas FOR DELETE USING (usuario_id = auth.uid());
CREATE POLICY "dividas_service_role_all" ON dividas FOR ALL USING (is_service_role()) WITH CHECK (is_service_role());

-- Index para performance
CREATE INDEX IF NOT EXISTS idx_dividas_usuario_ativa ON dividas(usuario_id, ativa);
CREATE INDEX IF NOT EXISTS idx_transacoes_expense_type ON transacoes(expense_type);
