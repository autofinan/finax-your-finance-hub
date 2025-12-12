-- Remover a versão antiga da função rpc_registrar_transacao (versão simples)
-- e manter apenas a versão completa com search_path

-- Primeiro, remover a versão simples com 6 parâmetros
DROP FUNCTION IF EXISTS public.rpc_registrar_transacao(uuid, numeric, text, text, text, timestamp without time zone);

-- Garantir que a versão completa tem search_path
CREATE OR REPLACE FUNCTION public.rpc_registrar_transacao(
  p_usuario_id uuid, 
  p_valor numeric, 
  p_tipo text, 
  p_categoria text, 
  p_descricao text DEFAULT NULL, 
  p_data timestamp without time zone DEFAULT now(), 
  p_origem text DEFAULT 'manual', 
  p_id_cartao uuid DEFAULT NULL, 
  p_parcela_atual integer DEFAULT NULL, 
  p_total_parcelas integer DEFAULT NULL, 
  p_id_recorrente uuid DEFAULT NULL, 
  p_parcelamento_id uuid DEFAULT NULL, 
  p_essencial boolean DEFAULT false, 
  p_status text DEFAULT 'confirmada'
)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  new_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO transacoes (
    id, usuario_id, valor, tipo, categoria, descricao, observacao,
    data, origem, id_cartao, parcela_atual, total_parcelas,
    id_recorrente, parcelamento_id, essencial, status, created_at
  )
  VALUES (
    new_id, p_usuario_id, p_valor, p_tipo, p_categoria, p_descricao, p_descricao,
    COALESCE(p_data, now()), p_origem, p_id_cartao, p_parcela_atual, p_total_parcelas,
    p_id_recorrente, p_parcelamento_id, p_essencial, p_status, now()
  );

  RETURN QUERY SELECT new_id;
END;
$function$;