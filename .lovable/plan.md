
# Plano Acelerador de Liberdade Financeira — Status Atualizado

## ✅ Concluído

| Item | Status |
|------|--------|
| Gating de features (web - FEATURE_MATRIX) | ✅ |
| Precificação (R$19,90 / R$29,90) | ✅ |
| Registro de dívidas | ✅ |
| Classificação expense_type | ✅ |
| Modo Vendedor (trial expirado) | ✅ |
| Checkout Stripe (web + WhatsApp) | ✅ |
| Códigos de ativação | ✅ |
| UpgradeTeaser (web) | ✅ |
| Landing Page (botão Entrar, compra direta, responsividade) | ✅ |
| FSM humanizado (escape, subject change, retry limit) | ✅ |
| Gating no WhatsApp (Básico vs Pro) | ✅ |
| Trial End Summary (dados reais) | ✅ |

## 🔜 Pendente (por prioridade)

### Alta Prioridade
| Item | Complexidade | Estimativa |
|------|-------------|-----------|
| Simulador de Quitação (3 cenários) | Alta | 2-3 sessões |
| Insights Preditivos (impacto em dias de liberdade) | Alta | 2 sessões |

### Média Prioridade
| Item | Complexidade | Estimativa |
|------|-------------|-----------|
| Consultor IA Semanal (edge function agendada) | Média | 1-2 sessões |
| Detector de Padrões (análise estatística) | Média | 1-2 sessões |
| Radar de Anomalias (alertas automáticos) | Média | 1 sessão |
| Projeções Financeiras (3/6/12 meses) | Média | 1-2 sessões |

### Baixa Prioridade
| Item | Complexidade | Estimativa |
|------|-------------|-----------|
| Metas de Frequência (novo tipo de meta) | Baixa | 1 sessão |
| Progresso Acumulado | Baixa | 1 sessão |
| Relatórios diferenciados (Básico vs Pro) | Baixa | 1 sessão |

## Próximo Passo Recomendado

**Simulador de Quitação** — Lógica de juros compostos com 3 cenários (Atual, Conservador, Agressivo) baseado na "Margem Real" do usuário. Requer:
1. Edge function para cálculo dos cenários
2. UI no dashboard (página Dividas)
3. Handler no WhatsApp para "simular quitação"
