-- Tabela de Usuários/Contatos
CREATE TABLE IF NOT EXISTS public.usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT UNIQUE NOT NULL,
  nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de Transações (substitui Google Sheets)
CREATE TABLE IF NOT EXISTS public.transacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE,
  data TIMESTAMPTZ NOT NULL DEFAULT now(),
  categoria TEXT NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  observacao TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('Despesa', 'Receita')),
  recorrente BOOLEAN DEFAULT false,
  parcela TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de Gastos Recorrentes
CREATE TABLE IF NOT EXISTS public.gastos_recorrentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE,
  descricao TEXT,
  categoria TEXT NOT NULL,
  valor_total DECIMAL(10,2),
  valor_parcela DECIMAL(10,2) NOT NULL,
  parcela_atual INT DEFAULT 1,
  num_parcelas INT,
  tipo_recorrencia TEXT NOT NULL CHECK (tipo_recorrencia IN ('Diária', 'Semanal', 'Mensal', 'Parcelamento Fixo')),
  dia_semana TEXT,
  dia_mes INT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_transacoes_usuario ON public.transacoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_data ON public.transacoes(data);
CREATE INDEX IF NOT EXISTS idx_transacoes_tipo ON public.transacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_gastos_recorrentes_usuario ON public.gastos_recorrentes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_gastos_recorrentes_ativo ON public.gastos_recorrentes(ativo);

-- Enable RLS
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos_recorrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_conversas ENABLE ROW LEVEL SECURITY;

-- Policies para acesso público (webhook não tem auth)
CREATE POLICY "Acesso público usuarios" ON public.usuarios FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso público transacoes" ON public.transacoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso público gastos_recorrentes" ON public.gastos_recorrentes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso público historico" ON public.historico_conversas FOR ALL USING (true) WITH CHECK (true);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_usuarios_updated_at
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_gastos_recorrentes_updated_at
  BEFORE UPDATE ON public.gastos_recorrentes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();