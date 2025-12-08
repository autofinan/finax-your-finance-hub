-- Corrigir search_path da função
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Habilitar RLS na tabela employees (que já existia)
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Policy para employees
CREATE POLICY "Acesso público employees" ON public.employees FOR ALL USING (true) WITH CHECK (true);