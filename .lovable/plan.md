
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
| Simulador de Quitação (3 cenários - Web UI) | ✅ |

## 🔜 Pendente (por prioridade)

### Alta Prioridade
| Item | Complexidade | Estimativa |
|------|-------------|-----------|
| ~~Simulador de Quitação (handler WhatsApp)~~ | ~~Baixa~~ | ✅ |
| ~~Insights Preditivos (impacto em dias de liberdade)~~ | ~~Alta~~ | ✅ |

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

**Insights Preditivos** — Calcular impacto de cada gasto em "dias de liberdade financeira". Requer:
1. Lógica de cálculo baseada na margem real e dívidas ativas
2. UI com indicadores no dashboard
3. Handler no WhatsApp para consultar insights
