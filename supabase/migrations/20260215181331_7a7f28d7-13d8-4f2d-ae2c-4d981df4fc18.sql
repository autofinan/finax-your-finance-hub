
-- ============================================================================
-- BUG 1: Criar tabela parcelas (usada por installment.ts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.parcelas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parcelamento_id UUID REFERENCES public.transacoes(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL,
  numero_parcela INTEGER NOT NULL,
  total_parcelas INTEGER NOT NULL,
  valor NUMERIC NOT NULL,
  fatura_id UUID REFERENCES public.faturas_cartao(id) ON DELETE SET NULL,
  cartao_id UUID REFERENCES public.cartoes_credito(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'futura', 'paga', 'cancelada')),
  mes_referencia DATE,
  descricao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.parcelas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own parcelas"
  ON public.parcelas FOR SELECT
  USING (usuario_id IN (SELECT id FROM public.usuarios WHERE id = usuario_id));

CREATE POLICY "Service role can manage parcelas"
  ON public.parcelas FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for performance
CREATE INDEX idx_parcelas_usuario_id ON public.parcelas(usuario_id);
CREATE INDEX idx_parcelas_parcelamento_id ON public.parcelas(parcelamento_id);
CREATE INDEX idx_parcelas_status ON public.parcelas(status);

-- ============================================================================
-- BUG 13: Fix logs_sistema constraint to accept 'warn'
-- ============================================================================
ALTER TABLE public.logs_sistema DROP CONSTRAINT IF EXISTS logs_sistema_level_check;
ALTER TABLE public.logs_sistema ADD CONSTRAINT logs_sistema_level_check 
  CHECK (level IN ('info', 'warn', 'warning', 'error', 'debug'));
