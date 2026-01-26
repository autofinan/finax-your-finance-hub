-- Security Fix: Drop legacy public access policies that expose sensitive data
-- These policies allowed anyone with the anon key to read all data
-- Edge functions use service_role key which bypasses RLS, so they'll continue working

-- Drop public access policy on usuarios table
DROP POLICY IF EXISTS "Acesso público usuarios" ON public.usuarios;

-- Drop public access policy on transacoes table  
DROP POLICY IF EXISTS "Acesso público transacoes" ON public.transacoes;

-- Drop public access policy on gastos_recorrentes table
DROP POLICY IF EXISTS "Acesso público gastos_recorrentes" ON public.gastos_recorrentes;

-- Drop public access policy on historico_conversas table
DROP POLICY IF EXISTS "Acesso público historico" ON public.historico_conversas;

-- Drop public access policy on employees table (exposes passwords!)
DROP POLICY IF EXISTS "Acesso público employees" ON public.employees;