

# Plano: Sistema Completo de Feature Gating + Teasers + Precificacao Atualizada

## Minha Opiniao sobre a Precificacao

A estrutura esta muito bem pensada. Concordo com os ajustes sugeridos pelo chat:

1. **Basico com 2 cartoes** (nao 1) -- reduz cancelamento por frustracao
2. **Basico mostra projecao simples de divida** (prazo com pagamento minimo) -- o usuario precisa sentir que tem "algo" antes de ver o teaser Pro
3. **Insights basicos no Basico** (categoria que mais cresceu, maior gasto, alerta de excesso) -- sem isso o Basico parece vazio
4. **Recorrentes no Basico** -- confirmado, entra

A diferenca de R$10/mes entre Basico e Pro e perfeita. O Pro precisa parecer "absurdamente barato pelo que entrega", e essa tabela consegue isso.

---

## Fase 1: Refatorar usePlanoStatus com Feature Matrix

**Arquivo:** `src/hooks/usePlanoStatus.ts`

Reescrever completamente com:
- Type `Feature` com todas as 25+ features mapeadas
- `FEATURE_MATRIX` definindo quais planos acessam cada feature
- `LIMITS` por plano (maxCards, maxGoals, etc.)
- Funcoes: `canAccessFeature()`, `showUpgradeTeaser()`, `getUpgradeMessage()`, `getLimit()`
- Trial ativo = acesso Pro completo (como definido)
- Trial expirado = nenhum acesso (modo bloqueado)

---

## Fase 2: Componente UpgradeTeaser

**Arquivo novo:** `src/components/UpgradeTeaser.tsx`

Componente reutilizavel com:
- Preview borrado (blur) do conteudo bloqueado
- Overlay com icone de cadeado
- Mensagem personalizada por feature (via `getUpgradeMessage`)
- Botao CTA "Fazer Upgrade Pro - R$ 29,90/mês"
- Link para pagina de planos ou checkout direto
- Texto "Apenas +R$ 10/mês para acelerar sua liberdade"

---

## Fase 3: Aplicar Feature Gating nas Paginas

### 3A: Dividas (`src/pages/Dividas.tsx`)
- Basico: mostra lista de dividas + saldo total + prazo simples (meses no minimo)
- Simulador de cenarios: teaser com preview borrado para Basico
- Pro: tudo desbloqueado

### 3B: Cartoes (`src/pages/Cartoes.tsx`)
- Basico: limite de 2 cartoes (mostrar aviso ao tentar adicionar 3o)
- Composicao do uso / breakdown: teaser para Basico
- Pro: ilimitado + gestao avancada

### 3C: Metas (`src/pages/Metas.tsx`)
- Basico: limite de 5 metas de valor
- Metas de frequencia: teaser para Basico
- Pro: ilimitado

### 3D: Dashboard Insights
- Basico: insights basicos (maior gasto, categoria crescente)
- Insights preditivos com impacto em dias: teaser para Basico
- Pro: completo

### 3E: Relatorios (`src/pages/Relatorios.tsx`)
- Basico: semanal/mensal
- Projecoes financeiras: teaser
- Pro: tudo

---

## Fase 4: Atualizar Landing Page Pricing

**Arquivo:** `src/components/landing/Pricing.tsx`

Atualizar as features listadas nos planos para refletir a nova tabela comparativa:

**Basico R$ 19,90:**
- Registro ilimitado de gastos
- Orcamentos ilimitados
- Ate 5 metas de economia
- 2 cartoes de credito
- Registro de dividas
- Relatorios semanais/mensais
- Insights basicos
- Recorrentes
- Parcelamentos
- Suporte 24h

**Pro R$ 29,90:**
- Tudo do Basico +
- Simulador de quitacao (3 cenarios)
- Insights preditivos com IA
- Consultor IA semanal
- Detector de padroes
- Radar de anomalias
- Cartoes ilimitados
- Gestao avancada de faturas
- Metas de frequencia
- Projecoes financeiras
- Contextos temporarios
- Suporte prioritario 2h

---

## Fase 5: Atualizar PlanoCard no Dashboard

**Arquivo:** `src/components/dashboard/PlanoCard.tsx`

- Basico: mostrar features ativas corretas (orcamentos, metas, relatorios, recorrentes)
- Pro: mostrar features premium (insights preditivos, simulador, consultor IA)
- Trial expirado: mostrar resumo do que usou durante trial (usando dados reais se disponiveis)
- Botoes de upgrade direcionam para checkout

---

## Fase 6: CheckoutModal e Pricing - Preco Correto

**Arquivos:** `src/components/checkout/CheckoutModal.tsx`, `src/components/landing/Pricing.tsx`

Confirmar que os precos estao corretos:
- Basico: R$ 19,90/mes
- Pro: R$ 29,90/mes

---

## Secao Tecnica: Arquivos Modificados

| Arquivo | Tipo | Mudanca |
|---|---|---|
| `src/hooks/usePlanoStatus.ts` | Reescrita | Feature matrix + gating completo |
| `src/components/UpgradeTeaser.tsx` | Novo | Componente de teaser reutilizavel |
| `src/pages/Dividas.tsx` | Editar | Gating no simulador |
| `src/pages/Cartoes.tsx` | Editar | Limite de cartoes |
| `src/pages/Metas.tsx` | Editar | Limite de metas + frequencia |
| `src/components/dashboard/PlanoCard.tsx` | Editar | Features corretas por plano |
| `src/components/landing/Pricing.tsx` | Editar | Features e precos atualizados |
| `src/components/checkout/CheckoutModal.tsx` | Editar | Precos confirmados |

Nenhuma mudanca de banco de dados necessaria nesta fase -- tudo e frontend/logica de UI.

---

## Ordem de Execucao

1. `usePlanoStatus.ts` (base de tudo)
2. `UpgradeTeaser.tsx` (componente reutilizavel)
3. Aplicar gating nas paginas (Dividas, Cartoes, Metas)
4. Atualizar PlanoCard
5. Atualizar Pricing na landing

