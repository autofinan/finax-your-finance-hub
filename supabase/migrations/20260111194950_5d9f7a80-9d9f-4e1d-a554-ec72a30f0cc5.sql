-- Remove overly permissive public policies from codigos_ativacao
-- The service_role policy already exists, just need to remove the public ones
DROP POLICY IF EXISTS "codigos_public_select" ON public.codigos_ativacao;
DROP POLICY IF EXISTS "codigos_public_update" ON public.codigos_ativacao;