-- =============================================================================
-- FINAX V5.2 - MIGRAÇÃO: ORÇAMENTOS E RELATÓRIOS
-- =============================================================================

-- 1. ADICIONAR COLUNA PARA RELATÓRIOS PENDENTES
-- =============================================================================
ALTER TABLE usuarios 
ADD COLUMN IF NOT EXISTS relatorio_semanal_pendente BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS relatorio_mensal_pendente BOOLEAN DEFAULT false;

COMMENT ON COLUMN usuarios.relatorio_semanal_pendente IS 'True se há relatório semanal pendente aguardando interação do usuário';
COMMENT ON COLUMN usuarios.relatorio_mensal_pendente IS 'True se há relatório mensal pendente aguardando interação do usuário';

-- 2. CRIAR TABELA DE ORÇAMENTOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS orcamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  
  -- Tipo de orçamento: 'categoria', 'global', 'contexto'
  tipo TEXT NOT NULL CHECK (tipo IN ('categoria', 'global', 'contexto')),
  
  -- Para tipo = 'categoria'
  categoria TEXT,
  
  -- Para tipo = 'contexto' (viagem, evento, etc)
  contexto_id UUID REFERENCES user_contexts(id) ON DELETE CASCADE,
  
  -- Limites
  limite NUMERIC NOT NULL CHECK (limite > 0),
  gasto_atual NUMERIC DEFAULT 0,
  
  -- Período: 'mensal', 'semanal', 'total' (para contextos)
  periodo TEXT DEFAULT 'mensal' CHECK (periodo IN ('mensal', 'semanal', 'total')),
  
  -- Alertas
  alerta_50_enviado BOOLEAN DEFAULT false,
  alerta_80_enviado BOOLEAN DEFAULT false,
  alerta_100_enviado BOOLEAN DEFAULT false,
  
  -- Status
  ativo BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_orcamentos_usuario ON orcamentos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_ativo ON orcamentos(usuario_id, ativo) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_orcamentos_categoria ON orcamentos(usuario_id, categoria) WHERE tipo = 'categoria';

-- RLS
ALTER TABLE orcamentos ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para orcamentos
CREATE POLICY "Usuários podem ver seus próprios orçamentos"
  ON orcamentos FOR SELECT
  USING (auth.uid()::text = usuario_id::text OR usuario_id IN (SELECT id FROM usuarios WHERE phone_number = current_setting('app.current_phone', true)));

CREATE POLICY "Usuários podem criar seus próprios orçamentos"
  ON orcamentos FOR INSERT
  WITH CHECK (auth.uid()::text = usuario_id::text OR usuario_id IN (SELECT id FROM usuarios WHERE phone_number = current_setting('app.current_phone', true)));

CREATE POLICY "Usuários podem atualizar seus próprios orçamentos"
  ON orcamentos FOR UPDATE
  USING (auth.uid()::text = usuario_id::text OR usuario_id IN (SELECT id FROM usuarios WHERE phone_number = current_setting('app.current_phone', true)));

CREATE POLICY "Usuários podem deletar seus próprios orçamentos"
  ON orcamentos FOR DELETE
  USING (auth.uid()::text = usuario_id::text OR usuario_id IN (SELECT id FROM usuarios WHERE phone_number = current_setting('app.current_phone', true)));

-- 3. FUNÇÃO PARA ATUALIZAR GASTO ATUAL DO ORÇAMENTO
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_atualizar_orcamento_apos_transacao()
RETURNS TRIGGER AS $$
DECLARE
  v_orcamento RECORD;
  v_mes_atual INTEGER;
  v_ano_atual INTEGER;
BEGIN
  -- Só processar gastos (despesas)
  IF NEW.tipo != 'saida' THEN
    RETURN NEW;
  END IF;
  
  v_mes_atual := EXTRACT(MONTH FROM CURRENT_DATE);
  v_ano_atual := EXTRACT(YEAR FROM CURRENT_DATE);
  
  -- Atualizar orçamentos por categoria
  UPDATE orcamentos
  SET 
    gasto_atual = (
      SELECT COALESCE(SUM(valor), 0)
      FROM transacoes t
      WHERE t.usuario_id = NEW.usuario_id
        AND t.categoria = orcamentos.categoria
        AND t.tipo = 'saida'
        AND t.status = 'confirmada'
        AND EXTRACT(MONTH FROM t.data) = v_mes_atual
        AND EXTRACT(YEAR FROM t.data) = v_ano_atual
    ),
    updated_at = now()
  WHERE usuario_id = NEW.usuario_id
    AND tipo = 'categoria'
    AND categoria = NEW.categoria
    AND ativo = true;
  
  -- Atualizar orçamento global
  UPDATE orcamentos
  SET 
    gasto_atual = (
      SELECT COALESCE(SUM(valor), 0)
      FROM transacoes t
      WHERE t.usuario_id = NEW.usuario_id
        AND t.tipo = 'saida'
        AND t.status = 'confirmada'
        AND EXTRACT(MONTH FROM t.data) = v_mes_atual
        AND EXTRACT(YEAR FROM t.data) = v_ano_atual
    ),
    updated_at = now()
  WHERE usuario_id = NEW.usuario_id
    AND tipo = 'global'
    AND ativo = true;
  
  -- Atualizar orçamento de contexto (se transação está vinculada)
  IF NEW.context_id IS NOT NULL THEN
    UPDATE orcamentos
    SET 
      gasto_atual = (
        SELECT COALESCE(SUM(valor), 0)
        FROM transacoes t
        WHERE t.context_id = NEW.context_id
          AND t.tipo = 'saida'
          AND t.status = 'confirmada'
      ),
      updated_at = now()
    WHERE contexto_id = NEW.context_id
      AND tipo = 'contexto'
      AND ativo = true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para atualizar orçamentos após cada transação
DROP TRIGGER IF EXISTS trg_atualizar_orcamento ON transacoes;
CREATE TRIGGER trg_atualizar_orcamento
  AFTER INSERT OR UPDATE ON transacoes
  FOR EACH ROW
  EXECUTE FUNCTION fn_atualizar_orcamento_apos_transacao();

-- 4. FUNÇÃO PARA VERIFICAR ALERTAS DE ORÇAMENTO
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_verificar_alertas_orcamento(p_usuario_id UUID)
RETURNS TABLE (
  orcamento_id UUID,
  tipo TEXT,
  categoria TEXT,
  limite NUMERIC,
  gasto_atual NUMERIC,
  percentual NUMERIC,
  alerta_nivel TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id as orcamento_id,
    o.tipo,
    o.categoria,
    o.limite,
    o.gasto_atual,
    ROUND((o.gasto_atual / o.limite * 100)::numeric, 1) as percentual,
    CASE 
      WHEN o.gasto_atual >= o.limite THEN 'critico'
      WHEN o.gasto_atual >= o.limite * 0.8 THEN 'alerta'
      WHEN o.gasto_atual >= o.limite * 0.5 THEN 'atencao'
      ELSE 'ok'
    END as alerta_nivel
  FROM orcamentos o
  WHERE o.usuario_id = p_usuario_id
    AND o.ativo = true
    AND o.gasto_atual >= o.limite * 0.5
  ORDER BY (o.gasto_atual / o.limite) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. COMENTÁRIOS
-- =============================================================================
COMMENT ON TABLE orcamentos IS 'Orçamentos definidos pelo usuário (por categoria, global ou contexto)';
COMMENT ON COLUMN orcamentos.tipo IS 'categoria = limite por categoria | global = limite total | contexto = limite por viagem/evento';
COMMENT ON COLUMN orcamentos.gasto_atual IS 'Atualizado automaticamente via trigger após cada transação';