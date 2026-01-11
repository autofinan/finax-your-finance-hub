-- Remove overly permissive public access policies
-- These policies expose sensitive user data to anyone

-- employees table: Remove public access
DROP POLICY IF EXISTS "Acesso público employees" ON public.employees;

-- historico_conversas table: Remove public access, add service_role policy
DROP POLICY IF EXISTS "Acesso público historico" ON public.historico_conversas;
CREATE POLICY "historico_conversas_service_role_all" ON public.historico_conversas
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- gastos_recorrentes table: Remove public access
DROP POLICY IF EXISTS "Acesso público gastos_recorrentes" ON public.gastos_recorrentes;

-- usuarios table: Remove public access, add service_role policy
DROP POLICY IF EXISTS "Acesso público usuarios" ON public.usuarios;
CREATE POLICY "usuarios_service_role_all" ON public.usuarios
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- transacoes table: Remove public access, add service_role policy
DROP POLICY IF EXISTS "Acesso público transacoes" ON public.transacoes;
CREATE POLICY "transacoes_service_role_all" ON public.transacoes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- codigos_ativacao: Remove public SELECT and UPDATE (keep employee and select_own policies)
DROP POLICY IF EXISTS "codigos_public_select" ON public.codigos_ativacao;
DROP POLICY IF EXISTS "codigos_public_update" ON public.codigos_ativacao;
CREATE POLICY "codigos_ativacao_service_role_all" ON public.codigos_ativacao
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- processed_messages: Remove public access
DROP POLICY IF EXISTS "processed_messages_public_access" ON public.processed_messages;
CREATE POLICY "processed_messages_service_role_all" ON public.processed_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- user_contexts: Fix policies to use proper user_id check
DROP POLICY IF EXISTS "Users can create their own contexts" ON public.user_contexts;
DROP POLICY IF EXISTS "Users can delete their own contexts" ON public.user_contexts;
DROP POLICY IF EXISTS "Users can update their own contexts" ON public.user_contexts;
DROP POLICY IF EXISTS "Users can view their own contexts" ON public.user_contexts;

CREATE POLICY "user_contexts_select_own" ON public.user_contexts
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "user_contexts_insert_own" ON public.user_contexts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_contexts_update_own" ON public.user_contexts
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "user_contexts_delete_own" ON public.user_contexts
  FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "user_contexts_service_role_all" ON public.user_contexts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- messages_outbox: Add service_role policy (no public access)
DROP POLICY IF EXISTS "messages_outbox_public_access" ON public.messages_outbox;
CREATE POLICY "messages_outbox_service_role_all" ON public.messages_outbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- resumo_mensal: Remove any public access, add service_role
DROP POLICY IF EXISTS "Acesso público resumo_mensal" ON public.resumo_mensal;
CREATE POLICY "resumo_mensal_service_role_all" ON public.resumo_mensal
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- perfil_cliente: Remove any public access, add service_role
DROP POLICY IF EXISTS "Acesso público perfil_cliente" ON public.perfil_cliente;
CREATE POLICY "perfil_cliente_service_role_all" ON public.perfil_cliente
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- parcelamentos: Remove any public access, add service_role
DROP POLICY IF EXISTS "Acesso público parcelamentos" ON public.parcelamentos;
CREATE POLICY "parcelamentos_service_role_all" ON public.parcelamentos
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);