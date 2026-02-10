
-- Remove overly permissive "Permitir acesso completo" policies
-- All tables already have proper owner-scoped + service_role policies

DROP POLICY IF EXISTS "Permitir acesso completo transacoes" ON transacoes;
DROP POLICY IF EXISTS "Permitir acesso completo cartoes" ON cartoes_credito;
DROP POLICY IF EXISTS "Permitir acesso completo parcelamentos" ON parcelamentos;
DROP POLICY IF EXISTS "Permitir acesso completo faturas" ON faturas;
DROP POLICY IF EXISTS "Permitir acesso completo recorrentes" ON gastos_recorrentes;
DROP POLICY IF EXISTS "Permitir acesso completo metas" ON savings_goals;
