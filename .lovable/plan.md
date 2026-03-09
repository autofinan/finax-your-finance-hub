
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

---

## 🔜 Pendente (por prioridade)

### 🔴 Alta Prioridade

| Item | Complexidade | Impacto | Estimativa |
|------|-------------|---------|-----------|
| Configurar cron job daily-sales (pg_cron + pg_net) | Baixa | 🔥 Alto | 10 min |
| Comprar domínio curto (fin.ax / finax.link) | Externa | Alto | — |

> **Cron job** = ativação imediata da sequência automática de 4 toques de vendas. Prioridade máxima.

---

### 🟡 Média Prioridade

| Item | Complexidade | Impacto | Estimativa |
|------|-------------|---------|-----------|
| Projeções Financeiras (3/6/12 meses) | Média | Alto | 1-2 sessões |
| Sistema de cupons/descontos (Stripe) | Média | Médio | 1 sessão |

---

### 🟢 Baixa Prioridade

| Item | Complexidade | Impacto | Estimativa |
|------|-------------|---------|-----------|
| Metas de Frequência (ex: máx. 8 deliveries/mês) | Baixa | Médio | 1 sessão |
| Progresso Acumulado (juros evitados + dias antecipados) | Baixa | Médio | 1 sessão |
| Relatórios diferenciados (Básico vs Pro) | Baixa | Baixo | 1 sessão |

---

## 💡 Backlog Técnico

| Categoria | Item |
|-----------|------|
| Infraestrutura | Padronizar estrutura de logs entre edge functions |
| Infraestrutura | Melhorar error handling no pipeline WhatsApp |
| Performance | Cache inteligente para queries de relatórios |
| UX/Mobile | Otimizar experiência mobile na web app |
| AI/ML | Melhorar precisão da categorização com histórico |
| AI/ML | Recomendações personalizadas por perfil do usuário |

---

## 🎯 Próximo Sprint Recomendado

1. **Configurar cron job** — ativa vendas automáticas imediatamente
2. **Projeções Financeiras** — alto valor percebido para usuários Pro
3. **Metas de Frequência** — diferenciação competitiva única
