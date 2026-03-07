
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
| Simulador de Quitação (3 cenários - Web + WhatsApp) | ✅ |
| Insights Preditivos (Freedom Days - Web + WhatsApp) | ✅ |
| Consultor IA Semanal (relatório + padrões + anomalias) | ✅ |
| Detector de Padrões (análise 4 semanas) | ✅ |
| Radar de Anomalias (spike, tendência, fim de semana) | ✅ |
| Melhorar prompt IA (Tool Calling + CoT + unificação) | ✅ v7.0 |
| Ativação automática de plano (webhook Stripe + match telefone) | ✅ |
| Encurtador de Links (short_links + redirect edge function) | ✅ |
| Vendedor IA Especialista (finaxSalesResponse com Gemini) | ✅ |
| Sequência de Vendas 4 Toques (daily-sales cron) | ✅ |
| Migração URLs para finaxai.vercel.app | ✅ |

## 🔜 Pendente (por prioridade)

### Alta Prioridade
| Item | Complexidade | Estimativa |
|------|-------------|-----------|
| Configurar cron job para daily-sales (pg_cron) | Baixa | 10 min |
| Comprar domínio curto (fin.ax / finax.link) para encurtador | Externa | - |

### Média Prioridade
| Item | Complexidade | Estimativa |
|------|-------------|-----------|
| Projeções Financeiras (3/6/12 meses) | Média | 1-2 sessões |
| Sistema de cupons/descontos (quando decidido) | Média | 1 sessão |

### Baixa Prioridade
| Item | Complexidade | Estimativa |
|------|-------------|-----------|
| Metas de Frequência (novo tipo de meta) | Baixa | 1 sessão |
| Progresso Acumulado | Baixa | 1 sessão |
| Relatórios diferenciados (Básico vs Pro) | Baixa | 1 sessão |

## Próximo Passo Recomendado

**Configurar cron job** — Ativar pg_cron + pg_net para rodar `daily-sales` todo dia às 10h (horário de Brasília). Isso ativa a sequência de 4 toques automática.
