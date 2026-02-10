-- ---------------------------------------------------------------------------
-- 🔒 Security hardening: remove permissive RLS policies (WITH CHECK/USING true)
-- ---------------------------------------------------------------------------

-- historico_conversas: remove public insert
DROP POLICY IF EXISTS "historico_insert_only" ON public.historico_conversas;

-- Replace with authenticated self-insert (employees policy remains)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'historico_conversas' AND policyname = 'historico_insert_own'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "historico_insert_own"
      ON public.historico_conversas
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id)
    $p$;
  END IF;
END $$;

-- semantic_categories: remove overly permissive ALL policies to public
DROP POLICY IF EXISTS "Service role full access" ON public.semantic_categories;
DROP POLICY IF EXISTS "Service role full access on semantic_categories" ON public.semantic_categories;

-- Allow public read only (no write policies; service_role bypasses RLS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'semantic_categories' AND policyname = 'semantic_categories_read'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "semantic_categories_read"
      ON public.semantic_categories
      FOR SELECT
      TO public
      USING (true)
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 🔐 Fix "Function Search Path Mutable" warnings
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atualizar_limite_cartao(p_cartao_id uuid, p_valor numeric, p_operacao text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_operacao = 'deduzir' THEN
    UPDATE cartoes_credito
    SET limite_disponivel = limite_disponivel - p_valor
    WHERE id = p_cartao_id;
  ELSE
    UPDATE cartoes_credito
    SET limite_disponivel = limite_disponivel + p_valor
    WHERE id = p_cartao_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.atualizar_timestamp_conversas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_old_pending_messages()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.pending_messages
  WHERE processed = TRUE
    AND processed_at < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.limpar_conversas_expiradas()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM conversas_ativas WHERE expira_em < NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_user_conversation_state(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.conversation_state WHERE user_id = p_user_id;
  DELETE FROM public.pending_messages WHERE user_id = p_user_id AND processed = FALSE;
END;
$function$;