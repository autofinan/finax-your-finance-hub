-- Fix cards with NULL limite_disponivel
UPDATE cartoes_credito 
SET limite_disponivel = COALESCE(limite_total, 0) 
WHERE limite_disponivel IS NULL;

-- Fix cards with NULL limite_total
UPDATE cartoes_credito 
SET limite_total = 0, limite_disponivel = 0 
WHERE limite_total IS NULL;