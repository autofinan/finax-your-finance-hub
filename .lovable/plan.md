
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
| Padronização visual UI (dark theme, glassmorphism) | ✅ |
| **Auditoria Técnica: Índices DB** | ✅ 09/03 |
| **Auditoria Técnica: .limit() em queries** | ✅ 09/03 |
| **Auditoria Técnica: Validação expense** | ✅ 09/03 |
| **Auditoria Técnica: A/B Test structure** | ✅ 09/03 |
| **Auditoria Técnica: Transaction Factory** | ✅ 09/03 |
| **Alertas Proativos (spending_alerts)** | ✅ 09/03 |
| **Aprendizado com Correções (ai_corrections)** | ✅ 09/03 |
| **Remoção tabela hipoteses_registro** | ✅ 09/03 |
| **Projeções Financeiras (3/6/12 meses - Web)** | ✅ 09/03 |
| **Metas de Frequência (Web)** | ✅ 09/03 |
| **Progresso Acumulado (card dashboard)** | ✅ 09/03 |
| **Dashboard Realtime (supabase.channel)** | ✅ 09/03 |
| **Mobile Nav melhorada** | ✅ 09/03 |
| **Configurações expandidas (categorias + alertas)** | ✅ 09/03 |

---

## 🔜 Pendente (por prioridade)

### 🔴 Alta Prioridade — Sprint 1 (Estabilidade WhatsApp)

| Item | Complexidade | Impacto | Estimativa |
|------|-------------|---------|-----------|
| TTL Cleanup (actions expiradas) | Baixa | 🔥 Alto | 15 min |
| Unificar execução de intents (executeIntent) | Média | 🔥 Alto | 30 min |
| Fallback inteligente (unknown → chat IA) | Baixa | Alto | 15 min |
| Log de erros_interpretacao | Baixa | Médio | 10 min |
| Configurar cron job daily-sales (pg_cron + pg_net) | Baixa | 🔥 Alto | 10 min |

> **Sprint 1** = parar de travar com coisas simples. Prioridade máxima.

---

### 🟡 Média Prioridade

| Item | Complexidade | Impacto | Estimativa |
|------|-------------|---------|-----------|
| Sistema de cupons/descontos (Stripe) | Média | Médio | 1 sessão |
| Relatórios diferenciados (Básico vs Pro) | Baixa | Baixo | 1 sessão |
| Comprar domínio curto (fin.ax / finax.link) | Externa | Alto | — |

---

## 💡 Backlog Técnico

| Categoria | Item |
|-----------|------|
| Infraestrutura | Padronizar estrutura de logs entre edge functions |
| Infraestrutura | Melhorar error handling no pipeline WhatsApp |
| Performance | Cache inteligente para queries de relatórios |
| AI/ML | Melhorar precisão da categorização com histórico |
| AI/ML | Recomendações personalizadas por perfil do usuário |

---

## 🎯 Próximo Sprint Recomendado

1. **Sprint 1 (Estabilidade)** — TTL cleanup, unificar execução, fallback inteligente
2. **Configurar cron job** — ativa vendas automáticas
3. **Relatórios diferenciados** — valor percebido Básico vs Pro
