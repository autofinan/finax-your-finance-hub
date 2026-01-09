-- ============================================================================
-- MIGRAÇÃO: Contextos de Usuário (Viagens/Eventos) + Campos Recorrentes
-- ============================================================================

-- 1. Criar tabela de contextos de usuário (viagens, eventos, obras, etc.)
CREATE TABLE IF NOT EXISTS public.user_contexts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  auto_tag BOOLEAN NOT NULL DEFAULT true,
  total_spent NUMERIC DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Adicionar coluna context_id na tabela transacoes para vincular gastos a contextos
ALTER TABLE public.transacoes 
ADD COLUMN IF NOT EXISTS context_id UUID REFERENCES public.user_contexts(id) ON DELETE SET NULL;

-- 3. Adicionar índices para performance
CREATE INDEX IF NOT EXISTS idx_user_contexts_user_id ON public.user_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contexts_status ON public.user_contexts(status);
CREATE INDEX IF NOT EXISTS idx_user_contexts_dates ON public.user_contexts(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_transacoes_context_id ON public.transacoes(context_id);

-- 4. Trigger para atualizar updated_at em user_contexts
CREATE OR REPLACE FUNCTION public.update_user_contexts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_user_contexts_updated_at ON public.user_contexts;
CREATE TRIGGER update_user_contexts_updated_at
  BEFORE UPDATE ON public.user_contexts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_contexts_updated_at();

-- 5. Trigger para atualizar estatísticas do contexto quando transações são vinculadas
CREATE OR REPLACE FUNCTION public.update_context_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Se uma transação foi vinculada a um contexto
  IF NEW.context_id IS NOT NULL THEN
    UPDATE public.user_contexts
    SET 
      total_spent = (
        SELECT COALESCE(SUM(valor), 0) 
        FROM public.transacoes 
        WHERE context_id = NEW.context_id AND tipo = 'saida'
      ),
      transaction_count = (
        SELECT COUNT(*) 
        FROM public.transacoes 
        WHERE context_id = NEW.context_id
      ),
      updated_at = now()
    WHERE id = NEW.context_id;
  END IF;
  
  -- Se uma transação foi desvinculada de um contexto (OLD tinha context_id)
  IF TG_OP = 'UPDATE' AND OLD.context_id IS NOT NULL AND OLD.context_id IS DISTINCT FROM NEW.context_id THEN
    UPDATE public.user_contexts
    SET 
      total_spent = (
        SELECT COALESCE(SUM(valor), 0) 
        FROM public.transacoes 
        WHERE context_id = OLD.context_id AND tipo = 'saida'
      ),
      transaction_count = (
        SELECT COUNT(*) 
        FROM public.transacoes 
        WHERE context_id = OLD.context_id
      ),
      updated_at = now()
    WHERE id = OLD.context_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_context_stats_on_transacao ON public.transacoes;
CREATE TRIGGER update_context_stats_on_transacao
  AFTER INSERT OR UPDATE ON public.transacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_context_stats();

-- 6. Job diário para fechar contextos expirados
CREATE OR REPLACE FUNCTION public.fn_close_expired_contexts()
RETURNS void AS $$
BEGIN
  UPDATE public.user_contexts
  SET status = 'completed', updated_at = now()
  WHERE status = 'active' 
    AND end_date < now();
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 7. View para contextos ativos com estatísticas
CREATE OR REPLACE VIEW public.vw_active_contexts AS
SELECT 
  uc.id,
  uc.user_id,
  uc.label,
  uc.description,
  uc.start_date,
  uc.end_date,
  uc.status,
  uc.auto_tag,
  uc.total_spent,
  uc.transaction_count,
  uc.created_at,
  uc.updated_at,
  (uc.end_date - now()) as time_remaining
FROM public.user_contexts uc
WHERE uc.status = 'active';

-- 8. Enable RLS
ALTER TABLE public.user_contexts ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies para user_contexts
CREATE POLICY "Users can view their own contexts"
  ON public.user_contexts
  FOR SELECT
  USING (true); -- Permissivo para o backend (service role)

CREATE POLICY "Users can create their own contexts"
  ON public.user_contexts
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update their own contexts"
  ON public.user_contexts
  FOR UPDATE
  USING (true);

CREATE POLICY "Users can delete their own contexts"
  ON public.user_contexts
  FOR DELETE
  USING (true);