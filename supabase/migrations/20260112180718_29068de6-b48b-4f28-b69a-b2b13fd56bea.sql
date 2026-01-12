-- ============================================================================
-- 🧠 SEMANTIC CATEGORIES - Cache de categorização IA-First com autoaprendizado
-- ============================================================================

-- Tabela de cache semântico alimentado pela IA
CREATE TABLE IF NOT EXISTS semantic_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  termo TEXT NOT NULL,                    -- termo original: "show", "uber", "ifood"
  termo_normalized TEXT NOT NULL,         -- normalizado para busca: "show", "uber", "ifood"
  categoria TEXT NOT NULL,                -- categoria: "lazer", "transporte", etc.
  confidence FLOAT DEFAULT 0.8,           -- confiança da classificação (0.0 - 1.0)
  source TEXT DEFAULT 'ai',               -- 'ai' | 'manual' | 'user_feedback'
  usage_count INT DEFAULT 1,              -- quantas vezes foi usado
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decision_version TEXT,                  -- versão do decision engine que criou
  UNIQUE(termo_normalized)
);

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_semantic_term ON semantic_categories(termo_normalized);

-- Índice para análise de uso
CREATE INDEX IF NOT EXISTS idx_semantic_usage ON semantic_categories(usage_count DESC, last_used_at DESC);

-- Seed inicial com termos de alta confiança (mínimo necessário para bootstrap)
INSERT INTO semantic_categories (termo, termo_normalized, categoria, confidence, source) VALUES
-- Transporte
('uber', 'uber', 'transporte', 0.99, 'manual'),
('99', '99', 'transporte', 0.99, 'manual'),
('taxi', 'taxi', 'transporte', 0.99, 'manual'),
('gasolina', 'gasolina', 'transporte', 0.99, 'manual'),
('combustivel', 'combustivel', 'transporte', 0.99, 'manual'),
('estacionamento', 'estacionamento', 'transporte', 0.99, 'manual'),
('pedagio', 'pedagio', 'transporte', 0.99, 'manual'),
-- Alimentação
('ifood', 'ifood', 'alimentacao', 0.99, 'manual'),
('rappi', 'rappi', 'alimentacao', 0.99, 'manual'),
('restaurante', 'restaurante', 'alimentacao', 0.99, 'manual'),
('almoco', 'almoco', 'alimentacao', 0.99, 'manual'),
('jantar', 'jantar', 'alimentacao', 0.99, 'manual'),
('cafe', 'cafe', 'alimentacao', 0.95, 'manual'),
('padaria', 'padaria', 'alimentacao', 0.99, 'manual'),
('pizza', 'pizza', 'alimentacao', 0.99, 'manual'),
('hamburguer', 'hamburguer', 'alimentacao', 0.99, 'manual'),
('lanche', 'lanche', 'alimentacao', 0.99, 'manual'),
-- Lazer (expandido)
('netflix', 'netflix', 'lazer', 0.99, 'manual'),
('spotify', 'spotify', 'lazer', 0.99, 'manual'),
('cinema', 'cinema', 'lazer', 0.99, 'manual'),
('show', 'show', 'lazer', 0.99, 'manual'),
('teatro', 'teatro', 'lazer', 0.99, 'manual'),
('festa', 'festa', 'lazer', 0.99, 'manual'),
('balada', 'balada', 'lazer', 0.99, 'manual'),
('bar', 'bar', 'lazer', 0.95, 'manual'),
('evento', 'evento', 'lazer', 0.99, 'manual'),
('ingresso', 'ingresso', 'lazer', 0.99, 'manual'),
('praia', 'praia', 'lazer', 0.95, 'manual'),
('parque', 'parque', 'lazer', 0.95, 'manual'),
('museu', 'museu', 'lazer', 0.99, 'manual'),
('viagem', 'viagem', 'lazer', 0.95, 'manual'),
('hotel', 'hotel', 'lazer', 0.95, 'manual'),
('passeio', 'passeio', 'lazer', 0.95, 'manual'),
-- Saúde
('farmacia', 'farmacia', 'saude', 0.99, 'manual'),
('remedio', 'remedio', 'saude', 0.99, 'manual'),
('medico', 'medico', 'saude', 0.99, 'manual'),
('hospital', 'hospital', 'saude', 0.99, 'manual'),
('dentista', 'dentista', 'saude', 0.99, 'manual'),
('academia', 'academia', 'saude', 0.95, 'manual'),
('consulta', 'consulta', 'saude', 0.95, 'manual'),
('exame', 'exame', 'saude', 0.95, 'manual'),
-- Mercado
('mercado', 'mercado', 'mercado', 0.99, 'manual'),
('supermercado', 'supermercado', 'mercado', 0.99, 'manual'),
('feira', 'feira', 'mercado', 0.95, 'manual'),
('hortifruti', 'hortifruti', 'mercado', 0.99, 'manual'),
('atacadao', 'atacadao', 'mercado', 0.99, 'manual'),
-- Moradia
('aluguel', 'aluguel', 'moradia', 0.99, 'manual'),
('condominio', 'condominio', 'moradia', 0.99, 'manual'),
('luz', 'luz', 'moradia', 0.95, 'manual'),
('energia', 'energia', 'moradia', 0.95, 'manual'),
('internet', 'internet', 'moradia', 0.99, 'manual'),
('gas', 'gas', 'moradia', 0.95, 'manual'),
('iptu', 'iptu', 'moradia', 0.99, 'manual'),
-- Compras
('roupa', 'roupa', 'compras', 0.95, 'manual'),
('sapato', 'sapato', 'compras', 0.95, 'manual'),
('shopping', 'shopping', 'compras', 0.90, 'manual'),
('celular', 'celular', 'compras', 0.95, 'manual'),
('eletronico', 'eletronico', 'compras', 0.95, 'manual'),
-- Serviços
('salao', 'salao', 'servicos', 0.95, 'manual'),
('barbearia', 'barbearia', 'servicos', 0.99, 'manual'),
('manicure', 'manicure', 'servicos', 0.99, 'manual'),
('lavanderia', 'lavanderia', 'servicos', 0.99, 'manual'),
('diarista', 'diarista', 'servicos', 0.99, 'manual'),
('faxina', 'faxina', 'servicos', 0.99, 'manual'),
-- Educação
('curso', 'curso', 'educacao', 0.95, 'manual'),
('livro', 'livro', 'educacao', 0.90, 'manual'),
('escola', 'escola', 'educacao', 0.99, 'manual'),
('faculdade', 'faculdade', 'educacao', 0.99, 'manual'),
('mensalidade', 'mensalidade', 'educacao', 0.90, 'manual')
ON CONFLICT (termo_normalized) DO NOTHING;

-- RLS para proteção
ALTER TABLE semantic_categories ENABLE ROW LEVEL SECURITY;

-- Policy: Service role tem acesso total (edge functions usam service role)
CREATE POLICY "Service role full access on semantic_categories" 
ON semantic_categories FOR ALL 
USING (true) 
WITH CHECK (true);

-- View para monitoramento do aprendizado
CREATE OR REPLACE VIEW vw_semantic_learning AS
SELECT 
  termo,
  categoria,
  confidence,
  source,
  usage_count,
  created_at,
  last_used_at,
  CASE 
    WHEN source = 'ai' THEN '🤖 IA'
    WHEN source = 'manual' THEN '📝 Manual'
    WHEN source = 'user_feedback' THEN '👤 Usuário'
    ELSE '❓ Outro'
  END as source_label
FROM semantic_categories
ORDER BY created_at DESC;