# INVENTÁRIO TÉCNICO COMPLETO — FINAX

---

## 1. ÁRVORE RESUMIDA DAS PASTAS PRINCIPAIS

```
finax/
├── src/                                    # FRONTEND (React + Vite + TS)
│   ├── pages/                              # 15 páginas da aplicação
│   │   ├── Landing.tsx                     # Página de vendas (pública)
│   │   ├── Auth.tsx                        # Login via OTP WhatsApp
│   │   ├── Dashboard.tsx                   # Painel principal (protegida)
│   │   ├── Transacoes.tsx                  # CRUD transações
│   │   ├── Recorrentes.tsx                 # Gastos recorrentes
│   │   ├── Cartoes.tsx                     # Cartões de crédito
│   │   ├── Faturas.tsx                     # Faturas de cartão
│   │   ├── Parcelamentos.tsx               # Parcelamentos ativos
│   │   ├── ContasPagar.tsx                 # Contas a pagar
│   │   ├── Relatorios.tsx                  # Relatórios financeiros
│   │   ├── Chat.tsx                        # Consultor IA (web)
│   │   ├── Metas.tsx                       # Metas financeiras + frequência
│   │   ├── Dividas.tsx                     # Dívidas + simulador quitação
│   │   ├── Projecoes.tsx                   # Projeções 3/6/12 meses
│   │   ├── Eventos.tsx                     # Eventos financeiros
│   │   ├── Configuracoes.tsx               # Configurações do usuário
│   │   ├── Cancelar.tsx                    # Fluxo de cancelamento
│   │   └── NotFound.tsx                    # 404
│   │
│   ├── components/
│   │   ├── layout/                         # AppLayout, Sidebar, MobileNav
│   │   ├── dashboard/                      # StatCard, BudgetCard, ExpenseChart, FreedomCard, etc.
│   │   ├── chat/                           # ChatInterface
│   │   ├── checkout/                       # CheckoutModal (Stripe)
│   │   ├── cartoes/                        # FaturaDetail, FaturaDetailModal
│   │   ├── dividas/                        # SimuladorQuitacao
│   │   ├── transacoes/                     # TransactionForm, TransactionList, CSVImportModal
│   │   ├── ui/                             # shadcn/ui (50+ componentes)
│   │   ├── NavLink.tsx                     # Link de navegação
│   │   ├── ProtectedRoute.tsx              # Guard de autenticação
│   │   └── UpgradeTeaser.tsx               # Teaser para upgrade de plano
│   │
│   ├── hooks/                              # 21 hooks customizados
│   │   ├── useUsuarioId.ts                 # Resolve usuario_id do auth
│   │   ├── usePlanoStatus.ts               # Feature gating (FEATURE_MATRIX)
│   │   ├── useDashboard.ts                 # Dados do dashboard
│   │   ├── useTransacoes.ts                # CRUD transações
│   │   ├── useCartoes.ts                   # CRUD cartões
│   │   ├── useFaturas.ts                   # Faturas de cartão
│   │   ├── useParcelamentos.ts             # Parcelamentos
│   │   ├── useGastosRecorrentes.ts         # Recorrentes
│   │   ├── useContasPagar.ts               # Contas a pagar
│   │   ├── useDividas.ts                   # Dívidas
│   │   ├── useMetas.ts                     # Metas financeiras
│   │   ├── useMetasFrequencia.ts           # Metas de frequência
│   │   ├── useFreedomDays.ts               # Freedom Days
│   │   ├── useProjecoes.ts                 # Projeções financeiras
│   │   ├── useChat.ts                      # Chat IA (web)
│   │   ├── useStripeCheckout.ts            # Checkout Stripe
│   │   ├── useCategorias.ts                # Categorias
│   │   ├── useEventos.ts                   # Eventos
│   │   ├── usePlanilhaExport.ts            # Exportação Excel
│   │   ├── use-mobile.tsx                  # Detecção mobile
│   │   └── use-toast.ts                    # Toast notifications
│   │
│   ├── contexts/
│   │   └── AuthContext.tsx                 # SSO: OTP WhatsApp → Supabase session
│   │
│   ├── types/
│   │   └── finance.ts                      # Tipos TypeScript (289 linhas)
│   │
│   ├── integrations/supabase/
│   │   ├── client.ts                       # Supabase client singleton
│   │   └── types.ts                        # Auto-gerado (read-only)
│   │
│   ├── assets/                             # Logo Finax
│   ├── utils/excelStyles.ts                # Estilos para exportação
│   └── index.css                           # Tema (CSS variables, Tailwind)
│
├── supabase/functions/                     # BACKEND (Edge Functions - Deno)
│   │
│   ├── finax-worker/                       # ⭐ MONOLITO PRINCIPAL (~5.400 linhas)
│   │   ├── index.ts                        # processarJob() — routing central
│   │   ├── decision/                       # Motor de IA
│   │   │   ├── ai-engine.ts                # Gemini Tool Calling (classify_intent)
│   │   │   ├── classifier.ts               # Fast-track determinístico (regex)
│   │   │   ├── engine.ts                   # Orquestrador (determinístico → IA)
│   │   │   └── types.ts                    # Tipos do decision engine
│   │   ├── intents/                        # 21 handlers de intent
│   │   │   ├── expense.ts                  # Registro de gasto
│   │   │   ├── income.ts                   # Registro de receita
│   │   │   ├── query.ts                    # Consultas financeiras
│   │   │   ├── card.ts                     # Adicionar cartão
│   │   │   ├── card-queries.ts             # Consultas de cartão
│   │   │   ├── installment.ts              # Parcelamento
│   │   │   ├── recurring-handler.ts        # Gasto recorrente
│   │   │   ├── goals.ts                    # Metas
│   │   │   ├── debt-handler.ts             # Dívidas
│   │   │   ├── bills.ts                    # Contas a pagar
│   │   │   ├── budget.ts                   # Orçamento
│   │   │   ├── cancel.ts / cancel-handler  # Cancelar transação/recorrente
│   │   │   ├── chat-handler.ts             # Consultor IA conversacional
│   │   │   ├── context-handler.ts          # Contextos (viagem, etc.)
│   │   │   ├── credit-flow.ts             # Fluxo de crédito
│   │   │   ├── expense-inline.ts           # Gasto inline (sem confirmação)
│   │   │   ├── freedom-insights.ts         # Freedom Days
│   │   │   ├── purchase.ts                 # Consultor de compra
│   │   │   ├── alerts.ts                   # Alertas proativos
│   │   │   └── reports-handler.ts          # Relatórios sob demanda
│   │   ├── fsm/                            # Finite State Machine
│   │   │   ├── context-handler.ts          # Slot filling (coleta de dados)
│   │   │   ├── action-manager.ts           # Gerenciamento de ações pendentes
│   │   │   └── confirmation-gate.ts        # Gate de confirmação
│   │   ├── ui/                             # Formatação WhatsApp
│   │   │   ├── messages.ts                 # Templates de mensagem
│   │   │   ├── slot-prompts.ts             # Prompts para slots faltantes
│   │   │   └── whatsapp-sender.ts          # Envio via Meta API
│   │   ├── utils/                          # 15 utilitários
│   │   │   ├── helpers.ts                  # normalizeText, detectQueryScope, etc.
│   │   │   ├── transaction-factory.ts      # Registro centralizado de transações
│   │   │   ├── parseAmount.ts              # Parse de valores BR (1.500,00)
│   │   │   ├── date-helpers.ts             # Parse de datas em PT-BR
│   │   │   ├── media.ts                    # OCR (Gemini Vision) + áudio (AssemblyAI)
│   │   │   ├── onboarding.ts              # Fluxo de boas-vindas
│   │   │   ├── conversation-context.ts     # Contexto conversacional persistido
│   │   │   ├── dynamic-query.ts            # Consultas dinâmicas
│   │   │   ├── multiple-expenses.ts        # Múltiplos gastos em uma mensagem
│   │   │   ├── ai-decisions.ts             # Persistência de decisões IA
│   │   │   ├── message-queue.ts            # Fila de mensagens
│   │   │   ├── errors.ts                   # Registro de erros
│   │   │   ├── logger.ts                   # Logger estruturado
│   │   │   ├── profile.ts                  # Perfil do usuário
│   │   │   └── text-helpers.ts             # Helpers de texto
│   │   ├── ai/categorizer.ts              # Categorização automática
│   │   ├── context/manager.ts             # Gerenciador de contextos (viagem)
│   │   ├── governance/config.ts           # Configuração de governance IA
│   │   ├── greetings/smart-greeting.ts    # Saudações contextuais
│   │   ├── learning/corrections.ts        # Self-healing (auto-correção)
│   │   ├── memory/patterns.ts             # Padrões de comportamento
│   │   └── sales/seller.ts               # Modo vendedor (trial expirado)
│   │
│   ├── whatsapp-webhook/index.ts           # Receptor de msgs WhatsApp → webhook_jobs
│   ├── send-otp/index.ts                  # Envio de OTP via WhatsApp
│   ├── verify-otp/index.ts                # Verificação de OTP
│   ├── validate-session/index.ts           # Validação de sessão web
│   ├── create-checkout/index.ts            # Criação de sessão Stripe
│   ├── finax-payment-webhook/index.ts      # Webhook Stripe → ativação de plano
│   ├── cancel-subscription/index.ts        # Cancelamento de assinatura
│   ├── chat/index.ts                       # Chat IA (endpoint web)
│   ├── analyze-spending/index.ts           # Análise de gastos (IA)
│   ├── finax-insights/index.ts             # Insights preditivos
│   ├── enviar-relatorio-semanal/index.ts   # CRON: relatório semanal
│   ├── enviar-relatorio-mensal/index.ts    # CRON: relatório mensal
│   ├── daily-sales/index.ts                # CRON: sequência de vendas
│   ├── lembrar-contas/index.ts             # CRON: lembretes de contas
│   ├── processar-recorrentes/index.ts      # CRON: gerar transações recorrentes
│   ├── ciclo-fatura/index.ts               # CRON: ciclo de faturas
│   ├── redirect/index.ts                   # Encurtador de URLs
│   └── health/index.ts                     # Health check
│
├── supabase/config.toml                    # Config (verify_jwt=false para todas)
├── index.html                              # Entry point
├── vite.config.ts                          # Vite config
├── tailwind.config.ts                      # Tailwind config
└── .env                                    # VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
```

---

## 2. PRINCIPAIS PÁGINAS

| Página | Arquivo | Rota | Protegida | Função |
|--------|---------|------|-----------|--------|
| Landing | `pages/Landing.tsx` | `/` | ❌ | Página de vendas, pricing, FAQ |
| Auth | `pages/Auth.tsx` | `/auth` | ❌ | Login OTP WhatsApp |
| Dashboard | `pages/Dashboard.tsx` | `/dashboard` | ✅ | Painel principal com cards |
| Transações | `pages/Transacoes.tsx` | `/transacoes` | ✅ | Lista/CRUD de transações |
| Recorrentes | `pages/Recorrentes.tsx` | `/recorrentes` | ✅ | Gastos fixos/recorrentes |
| Cartões | `pages/Cartoes.tsx` | `/cartoes` | ✅ | CRUD cartões de crédito |
| Faturas | `pages/Faturas.tsx` | `/faturas` | ✅ | Faturas de cartão abertas |
| Parcelamentos | `pages/Parcelamentos.tsx` | `/parcelamentos` | ✅ | Parcelamentos ativos |
| Contas | `pages/ContasPagar.tsx` | `/contas` | ✅ | Contas a pagar + lembretes |
| Relatórios | `pages/Relatorios.tsx` | `/relatorios` | ✅ | Relatórios financeiros |
| Chat IA | `pages/Chat.tsx` | `/chat` | ✅ | Consultor financeiro IA |
| Metas | `pages/Metas.tsx` | `/metas` | ✅ | Metas financeiras + frequência |
| Dívidas | `pages/Dividas.tsx` | `/dividas` | ✅ | Dívidas + simulador quitação |
| Projeções | `pages/Projecoes.tsx` | `/projecoes` | ✅ | Cenários 3/6/12 meses |
| Configurações | `pages/Configuracoes.tsx` | `/configuracoes` | ✅ | Nome, categorias, alertas, export |
| Cancelar | `pages/Cancelar.tsx` | `/cancelar` | ❌ | Fluxo de cancelamento |

---

## 3. PRINCIPAIS COMPONENTES

### Layout
| Componente | Função |
|------------|--------|
| `layout/AppLayout.tsx` | Shell principal (sidebar + content) |
| `layout/Sidebar.tsx` | Menu lateral desktop |
| `layout/MobileNav.tsx` | Navegação bottom bar mobile |
| `ProtectedRoute.tsx` | Guard: redireciona para `/auth` se não logado |
| `UpgradeTeaser.tsx` | Banner de upgrade (Básico → Pro) |

### Dashboard
| Componente | Função |
|------------|--------|
| `dashboard/StatCard.tsx` | Card de estatística (entradas, saídas, saldo) |
| `dashboard/BudgetCard.tsx` | Card de orçamento com barra de progresso |
| `dashboard/ExpenseChart.tsx` | Gráfico semanal de despesas (Recharts) |
| `dashboard/ExpenseTypeBreakdown.tsx` | Breakdown por tipo de gasto |
| `dashboard/FreedomCard.tsx` | Freedom Days (dias de liberdade financeira) |
| `dashboard/PlanoCard.tsx` | Status do plano atual |
| `dashboard/ProgressoAcumuladoCard.tsx` | Progresso acumulado do mês |
| `dashboard/InsightDoDia.tsx` | Insight diário baseado em dados |
| `dashboard/RecentTransactions.tsx` | Últimas transações |
| `dashboard/QuickActions.tsx` | Ações rápidas (adicionar gasto, etc.) |
| `dashboard/TrialBlockOverlay.tsx` | Overlay quando trial expira |

### Específicos
| Componente | Função |
|------------|--------|
| `chat/ChatInterface.tsx` | Interface de chat com IA |
| `checkout/CheckoutModal.tsx` | Modal de checkout Stripe |
| `cartoes/FaturaDetail.tsx` | Detalhe de fatura |
| `cartoes/FaturaDetailModal.tsx` | Modal com detalhe de fatura |
| `dividas/SimuladorQuitacao.tsx` | Simulador 3 cenários (mínimo, moderado, agressivo) |
| `transacoes/TransactionForm.tsx` | Formulário de transação |
| `transacoes/TransactionList.tsx` | Lista de transações com filtros |
| `transacoes/CSVImportModal.tsx` | Importação de CSV |

---

## 4. PRINCIPAIS ROTAS/API (Edge Functions)

### Autenticação
| Função | Rota | Método | Função |
|--------|------|--------|--------|
| `send-otp` | `/functions/v1/send-otp` | POST | Envia código OTP via WhatsApp |
| `verify-otp` | `/functions/v1/verify-otp` | POST | Valida OTP, cria sessão |
| `validate-session` | `/functions/v1/validate-session` | POST | Verifica token de sessão |

### WhatsApp Pipeline
| Função | Rota | Método | Função |
|--------|------|--------|--------|
| `whatsapp-webhook` | `/functions/v1/whatsapp-webhook` | POST/GET | Recebe mensagens Meta → insere em `webhook_jobs` |
| `finax-worker` | `/functions/v1/finax-worker` | POST | ⭐ Processa job: classifica, executa, responde |

### Pagamentos
| Função | Rota | Método | Função |
|--------|------|--------|--------|
| `create-checkout` | `/functions/v1/create-checkout` | POST | Cria sessão Stripe Checkout |
| `finax-payment-webhook` | `/functions/v1/finax-payment-webhook` | POST | Webhook Stripe → ativa plano |
| `cancel-subscription` | `/functions/v1/cancel-subscription` | POST | Cancela assinatura Stripe |

### IA / Análise
| Função | Rota | Método | Função |
|--------|------|--------|--------|
| `chat` | `/functions/v1/chat` | POST | Chat IA para web |
| `analyze-spending` | `/functions/v1/analyze-spending` | POST | Análise de gastos com IA |
| `finax-insights` | `/functions/v1/finax-insights` | POST | Insights preditivos |

### CRON Jobs (Automáticos)
| Função | Frequência | Função |
|--------|------------|--------|
| `enviar-relatorio-semanal` | Semanal | Envia relatório semanal via WhatsApp |
| `enviar-relatorio-mensal` | Mensal | Envia relatório mensal via WhatsApp |
| `daily-sales` | Diário | Sequência de vendas para trials expirados |
| `lembrar-contas` | Diário | Lembretes de contas próximas do vencimento |
| `processar-recorrentes` | Diário | Gera transações de gastos recorrentes |
| `ciclo-fatura` | Diário | Fecha/abre ciclos de fatura |

### Utilitários
| Função | Função |
|--------|--------|
| `redirect` | Encurtador de URLs |
| `health` | Health check |

---

## 5. PRINCIPAIS TABELAS/ENTIDADES DO BANCO

### Core (Dados do Usuário)
| Tabela | Função | Campos-chave |
|--------|--------|--------------|
| `usuarios` | Usuário principal | id, phone_number, phone_e164, nome, plano, trial_fim, auth_id, ativo |
| `transacoes` | ⭐ Tabela central — todas as transações | usuario_id, valor, tipo (entrada/saida), categoria, data, id_cartao, parcelamento_id, status |
| `cartoes_credito` | Cartões de crédito | usuario_id, nome, limite_total, limite_disponivel, dia_fechamento, dia_vencimento |
| `faturas_cartao` | Faturas mensais de cartão | cartao_id, mes, ano, valor_total, valor_pago, status |
| `parcelamentos` | Parcelamentos ativos | usuario_id, valor_total, num_parcelas, parcela_atual, valor_parcela, ativa |
| `gastos_recorrentes` | Gastos fixos/assinaturas | usuario_id, descricao, categoria, tipo_recorrencia, valor_parcela, dia_mes, ativo |
| `contas_pagar` | Contas a pagar com lembretes | usuario_id, nome, tipo, dia_vencimento, valor_estimado, lembrar_dias_antes |
| `pagamentos` | Pagamentos de contas | conta_id, mes_referencia, valor_pago, status |
| `categorias` | Categorias personalizadas | usuario_id, nome, tipo |
| `dividas` | Dívidas do usuário | usuario_id, nome, saldo_devedor, taxa_juros, tipo, valor_minimo |
| `savings_goals` | Metas de economia | usuario_id, nome, target_amount, current_amount, deadline |
| `orcamentos` | Orçamentos por categoria/global | usuario_id, tipo, categoria, limite, gasto_atual |
| `resumo_mensal` | Resumo mensal calculado | usuario_id, mes, ano, total_gastos, total_entradas, saldo_final |

### Conversação e IA
| Tabela | Função |
|--------|--------|
| `historico_conversas` | Histórico de mensagens WhatsApp |
| `conversas_ativas` | FSM: estado da conversa ativa (tipo_operacao, dados_coletados, campos_pendentes) |
| `conversation_state` | Estado simplificado (pending_slot, current_transaction_id) |
| `conversation_context` | Contexto conversacional (último intent, cartão, categoria, período) |
| `actions` | Ações pendentes de confirmação (FSM) |
| `ai_decisions` | Log de decisões da IA (classificação, confiança, slots) |
| `ai_corrections` | Correções do usuário (self-healing) |
| `erros_interpretacao` | Erros de interpretação para análise |
| `ai_prompts` | Prompts versionados |
| `ai_decision_versions` | Versões do motor de decisão |

### Pipeline WhatsApp
| Tabela | Função |
|--------|--------|
| `webhook_jobs` | Fila de jobs (mensagens recebidas) → trigger chama `finax-worker` |
| `eventos_brutos` | Eventos brutos do WhatsApp |
| `pending_messages` | Mensagens pendentes de envio |

### Autenticação e Plano
| Tabela | Função |
|--------|--------|
| `user_sessions` | Sessões web (token, expires_at) |
| `otp_codes` | Códigos OTP temporários |
| `codigos_ativacao` | Códigos de ativação de plano (FINAX-XXXXXX) |
| `cancelamentos` | Registro de cancelamentos |
| `plano_features` | Matrix de features por plano |
| `short_links` | Links encurtados |

### Contextos e Padrões
| Tabela | Função |
|--------|--------|
| `user_contexts` | Contextos temporais (viagem, evento) |
| `user_patterns` | Padrões de comportamento aprendidos |
| `user_onboarding` | Estado do onboarding |
| `semantic_categories` | Cache de categorização semântica |
| `spending_alerts` | Alertas proativos de gastos |
| `alert_feedback` | Feedback do usuário sobre alertas |

### Views Principais
| View | Função |
|------|--------|
| `vw_dashboard_usuario` | Dados agregados para dashboard |
| `vw_status_plano` | Status atual do plano |
| `queue_status` | Status da fila de processamento |

---

## 6. PRINCIPAIS INTEGRAÇÕES EXTERNAS

| Serviço | Uso | Onde |
|---------|-----|------|
| **Meta WhatsApp Business API** | Envio/recebimento de mensagens, OTP | `whatsapp-webhook`, `ui/whatsapp-sender.ts`, `send-otp` |
| **Google Gemini (via Lovable Gateway)** | Classificação de intents, OCR, chat consultivo | `decision/ai-engine.ts`, `intents/chat-handler.ts`, `utils/media.ts` |
| **Stripe** | Checkout, webhooks de pagamento, assinaturas | `create-checkout`, `finax-payment-webhook`, `cancel-subscription` |
| **AssemblyAI** | Transcrição de áudio (mensagens de voz) | `utils/media.ts` |
| **Vonage** | Fallback para envio de mensagens WhatsApp | `ui/whatsapp-sender.ts` |
| **Supabase** | Banco, auth, storage, realtime, edge functions | Todo o backend |
| **Vercel** | Hosting do frontend | Deploy automático |

### Secrets necessárias (Edge Functions)
- `WHATSAPP_TOKEN` — Token da Meta API
- `WHATSAPP_PHONE_ID` — ID do número WhatsApp
- `WHATSAPP_VERIFY_TOKEN` — Token de verificação do webhook
- `LOVABLE_API_KEY` — Chave para Gemini via Lovable Gateway
- `STRIPE_SECRET_KEY` — Chave secreta Stripe
- `STRIPE_WEBHOOK_SECRET` — Secret do webhook Stripe
- `ASSEMBLYAI_API_KEY` — Chave AssemblyAI
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (já automática)

---

## 7. PONTOS ONDE A LÓGICA DE NEGÓCIO ESTÁ CONCENTRADA

### Backend (Supabase)
| Local | Tipo | O que faz |
|-------|------|-----------|
| `finax-worker/index.ts` | Edge Function | ⭐ **MONOLITO PRINCIPAL** — processarJob() com ~5.400 linhas: routing de intents, handlers de botões, execução de ações |
| `intents/expense.ts` | Módulo | Lógica de registro de despesa |
| `intents/income.ts` | Módulo | Lógica de registro de receita |
| `intents/installment.ts` | Módulo | Criação de parcelamentos |
| `intents/query.ts` | Módulo | Consultas financeiras (10+ scopes) |
| `utils/transaction-factory.ts` | Módulo | Fábrica centralizada de transações (RPC) |
| `fsm/context-handler.ts` | Módulo | Slot filling — coleta progressiva de dados |
| `fsm/action-manager.ts` | Módulo | Gerenciamento de ações pendentes (TTL, lock) |
| `sales/seller.ts` | Módulo | Modo vendedor para trials expirados |

### Banco (PostgreSQL)
| Local | Tipo | O que faz |
|-------|------|-----------|
| `rpc_registrar_transacao` | RPC | Registro de transação com validações |
| `rpc_criar_parcelamento` | RPC | Cria parcelamento + N transações futuras |
| `fn_relatorio_mensal` | RPC | Relatório mensal completo (JSON) |
| `fn_relatorio_semanal` | RPC | Relatório semanal com comparativo |
| `fn_update_resumo_mensal` | RPC | Recalcula resumo mensal |
| `fn_analise_consultiva` | RPC | Análise consultiva (alertas automáticos) |
| `fn_verificar_alertas_orcamento` | RPC | Verifica limites de orçamento |
| `trg_update_cartao_limite` | Trigger | Atualiza limite do cartão em INSERT/UPDATE/DELETE |
| `trg_update_fatura_cartao` | Trigger | Recalcula valor da fatura em mudanças |
| `trg_transacoes_upsert_resumo` | Trigger | Atualiza resumo mensal em cada transação |
| `fn_atualizar_orcamento_apos_transacao` | Trigger | Atualiza orçamentos após transação |
| `feature_permitida` | RPC | Verifica se feature está liberada para o plano |

### Frontend (React)
| Local | Tipo | O que faz |
|-------|------|-----------|
| `hooks/usePlanoStatus.ts` | Hook | FEATURE_MATRIX — gating client-side |
| `hooks/useDashboard.ts` | Hook | Agregação de dados do dashboard |
| `hooks/useTransacoes.ts` | Hook | CRUD completo de transações |
| `hooks/useFreedomDays.ts` | Hook | Cálculo de Freedom Days |
| `hooks/useProjecoes.ts` | Hook | Projeções financeiras (client-side) |
| `contexts/AuthContext.tsx` | Context | Autenticação OTP → Supabase session bridge |

---

## 8. PONTOS ONDE A IA/INTERPRETAÇÃO DE LINGUAGEM NATURAL ACONTECE

| Arquivo | O que faz | Modelo |
|---------|-----------|--------|
| `decision/ai-engine.ts` | ⭐ **Motor principal**: Gemini Tool Calling com `classify_intent` — 30+ intents, CoT, confidence scoring | Gemini 2.5 Flash |
| `decision/classifier.ts` | **Fast-track determinístico**: regex para padrões comuns ("cafe 12", "recebi 3000") — bypass da IA | Regex |
| `decision/engine.ts` | **Orquestrador**: tenta determinístico primeiro, se falha → IA | — |
| `intents/chat-handler.ts` | **Consultor IA**: recebe resumo financeiro + pergunta → resposta consultiva | Gemini 2.5 Flash |
| `utils/media.ts` | **OCR**: Gemini Vision analisa foto de cupom → extrai itens/valores | Gemini 2.5 Flash |
| `utils/media.ts` | **Áudio**: AssemblyAI transcreve → texto processado normalmente | AssemblyAI |
| `ai/categorizer.ts` | **Categorização**: IA sugere categoria para descrições ambíguas | Gemini |
| `learning/corrections.ts` | **Self-healing**: aprende com correções do usuário | Tabela `ai_corrections` |
| `memory/patterns.ts` | **Padrões**: memoriza "uber → transporte, pix" | Tabela `user_patterns` |
| `greetings/smart-greeting.ts` | **Saudações**: adapta tom por horário/frequência de uso | Determinístico |
| `utils/onboarding.ts` | **Onboarding**: fluxo guiado com detecção de respostas | Determinístico |
| `analyze-spending/index.ts` | **Análise**: IA analisa padrões de gasto | Gemini |
| `finax-insights/index.ts` | **Insights**: previsões e anomalias | Gemini |
| `chat/index.ts` | **Chat web**: endpoint para ChatInterface.tsx | Gemini |

### Pipeline de interpretação (ordem)
```
1. Mensagem chega (texto/áudio/imagem)
2. Se áudio → AssemblyAI transcreve → texto
3. Se imagem → Gemini Vision OCR → extrai dados
4. Se texto → classifier.ts tenta fast-track (regex)
5. Se fast-track falha → ai-engine.ts (Gemini Tool Calling)
6. Gemini retorna: { intent, confidence, slots, reasoning }
7. Post-processing: merge com patterns, corrections, context
8. Se confidence alta → executa direto
9. Se confidence média → confirma com usuário
10. Se confidence baixa → pede clarificação
11. Se unknown + >5 palavras → redireciona para chat consultivo
```

---

## 9. PONTOS ONDE O ONBOARDING ACONTECE

### WhatsApp (Funcional ✅)
| Arquivo | O que faz |
|---------|-----------|
| `utils/onboarding.ts` | `startOnboarding()` — fluxo guiado com 5 etapas: boas-vindas → problema → detalhes → saldo → plano |
| `finax-worker/index.ts` | Detecta novo usuário (0 mensagens) → chama `startOnboarding()` |
| Tabela `user_onboarding` | Persiste estado do onboarding (step atual, dados coletados) |

### Web (❌ INEXISTENTE)
| O que falta | Impacto |
|-------------|---------|
| Empty states no dashboard | Usuário vê tela vazia, não entende valor |
| Wizard "conecte seu WhatsApp" | Não há ponte web ↔ WhatsApp |
| Tooltips de primeira visita | Sem guia visual |
| Tutorial interativo | Sem explicação de features |

---

## 10. PONTOS ONDE O SISTEMA É MAIS FRÁGIL

### 🔴 Crítico
| Ponto | Arquivo | Por que é frágil |
|-------|---------|-----------------|
| **Monolito processarJob()** | `finax-worker/index.ts` | ~5.400 linhas de if/else; cada mudança pode quebrar N coisas; impossível testar unitariamente |
| **Duplicação de registerExpense** | `index.ts` (4+ lugares) | Registra gasto em confirm_yes, expense handler, pay_bill, multi_expense — cada um com variações sutis |
| **Subscription webhook por phone** | `finax-payment-webhook/index.ts` | `customer.subscription.updated/deleted` busca por `customer.phone` — pode não existir no Stripe |
| **Zero testes automatizados** | Todo o projeto | Nenhum teste unitário, integração ou E2E |

### 🟡 Alto
| Ponto | Arquivo | Por que é frágil |
|-------|---------|-----------------|
| **Alertas sem persistência** | `pages/Configuracoes.tsx` | Toggles de alerta são `useState` puro — perdem-se ao recarregar |
| **Landing com inline styles** | `pages/Landing.tsx` | 695 linhas com CSS inline, fora do design system Tailwind |
| **Projeções client-side** | `hooks/useProjecoes.ts` | Cálculos no browser sem RPC dedicado |
| **Sessão em localStorage** | `contexts/AuthContext.tsx` | Token sem rotação client-side |
| **Race condition no worker** | `finax-worker/index.ts` | Lock otimista pode falhar sob alta concorrência |

### 🟢 Médio
| Ponto | Arquivo | Por que é frágil |
|-------|---------|-----------------|
| **URLs hardcoded** | 10+ arquivos | "finaxai.vercel.app" e phone_id espalhados |
| **Metas de frequência sem tracking** | `hooks/useMetasFrequencia.ts` | Criadas na web mas sem hook pós-gasto no WhatsApp |
| **Tipagem fraca em slots** | `decision/types.ts` | `[key: string]: any` anula type safety |
| **Sem fallback se Gemini cair** | `decision/ai-engine.ts` | Worker retorna erro genérico |

---

## 11. ARQUIVOS/ÁREAS MAIS CRÍTICOS PARA O FUNCIONAMENTO

### Tier 1 — Se quebrar, o produto para
| Arquivo | Motivo |
|---------|--------|
| `supabase/functions/finax-worker/index.ts` | ⭐ Cérebro do produto — processa TODA mensagem WhatsApp |
| `supabase/functions/whatsapp-webhook/index.ts` | Porta de entrada — sem ele, msgs não chegam |
| `supabase/functions/finax-worker/decision/ai-engine.ts` | Motor IA — sem ele, nenhuma mensagem é classificada |
| `supabase/functions/finax-worker/ui/whatsapp-sender.ts` | Envio de respostas — sem ele, bot fica mudo |
| `src/contexts/AuthContext.tsx` | Auth web — sem ele, ninguém loga |
| Tabela `transacoes` | Dados financeiros centrais |
| Tabela `usuarios` | Identidade + plano |
| Tabela `webhook_jobs` | Fila de processamento |
| Trigger `fn_trigger_finax_worker` | Dispara o worker automaticamente |

### Tier 2 — Se quebrar, feature importante falha
| Arquivo | Motivo |
|---------|--------|
| `supabase/functions/create-checkout/index.ts` | Checkout Stripe — sem ele, não vende |
| `supabase/functions/finax-payment-webhook/index.ts` | Webhook Stripe — sem ele, pagamento não ativa plano |
| `finax-worker/fsm/context-handler.ts` | Slot filling — sem ele, bot não coleta dados |
| `finax-worker/intents/expense.ts` | Registro de gasto — core do produto |
| `finax-worker/intents/query.ts` | Consultas — sem ele, bot não responde perguntas |
| `finax-worker/utils/transaction-factory.ts` | Fábrica de transações — ponto único de registro |
| `src/hooks/usePlanoStatus.ts` | Feature gating — sem ele, tudo fica liberado |
| `src/hooks/useDashboard.ts` | Dados do dashboard |
| Triggers `trg_update_cartao_limite` + `trg_update_fatura_cartao` | Consistência financeira de cartões |

### Tier 3 — Se quebrar, experiência degrada
| Arquivo | Motivo |
|---------|--------|
| `finax-worker/sales/seller.ts` | Modo vendedor — impacta conversão |
| `finax-worker/greetings/smart-greeting.ts` | Saudações — impacta percepção de inteligência |
| `finax-worker/learning/corrections.ts` | Self-healing — impacta precisão ao longo do tempo |
| `finax-worker/memory/patterns.ts` | Padrões — impacta conveniência |
| Edge functions CRON (relatórios, lembretes) | Automações — impacta retenção |
| `src/components/dashboard/*` | Cards do dashboard — impacta valor percebido |

---

## 12. RESUMO DE DEPENDÊNCIAS ENTRE SISTEMAS

```
WhatsApp → webhook → webhook_jobs → trigger → finax-worker → decision engine → intent handler → DB
                                                    ↓
                                              whatsapp-sender → Meta API → usuário

Web → AuthContext → validate-session → user_sessions
Web → Supabase Client → PostgreSQL (RLS via auth_id)
Web → hooks → views/RPCs → dados

Stripe → create-checkout ← Landing/Dashboard
Stripe → finax-payment-webhook → usuarios (plano) + codigos_ativacao

CRON → processar-recorrentes → transacoes
CRON → lembrar-contas → whatsapp-sender
CRON → enviar-relatorio-semanal → fn_relatorio_semanal → whatsapp-sender
CRON → daily-sales → seller.ts → whatsapp-sender
```
