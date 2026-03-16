# 🧪 PLANO DE TESTES DE REGRESSÃO — Sprint 6

> **Data:** 16/03/2026  
> **Objetivo:** Validar 100% dos fluxos do Finax após a refatoração modular (index.ts de 5.400 → 1.421 linhas)

---

## 📋 LEGENDA DE STATUS

| Emoji | Status |
|-------|--------|
| ⬜ | Não testado |
| ✅ | Passou |
| ❌ | Falhou |
| ⚠️ | Parcialmente |

---

## 1️⃣ REGISTRO DE GASTOS (expense)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 1.1 | Gasto completo texto | "gastei 50 no mercado pix" | Registra R$50 / mercado / pix ✅ | ⬜ |
| 1.2 | Gasto sem pagamento | "25 padaria" | Pergunta "Como pagou?" com botões Pix/Dinheiro/Crédito | ⬜ |
| 1.3 | Gasto só valor | "150" (sem contexto) | Pergunta "Gasto ou Entrada?" com botões | ⬜ |
| 1.4 | Gasto com data | "gastei 80 ontem no restaurante" | Registra com data de ontem | ⬜ |
| 1.5 | Gasto crédito 1 cartão | "50 farmácia crédito" (1 cartão) | Vincula ao único cartão automaticamente | ⬜ |
| 1.6 | Gasto crédito N cartões | "100 loja crédito" (2+ cartões) | Mostra botões/lista de cartões | ⬜ |
| 1.7 | Gasto via áudio | Enviar áudio "gastei 30 no uber" | Transcreve + registra | ⬜ |
| 1.8 | Gasto via imagem | Enviar foto de cupom fiscal | OCR extrai valor/descrição | ⬜ |
| 1.9 | Múltiplos gastos | "50 mercado e 30 padaria" | Detecta 2 gastos, pergunta separado/junto | ⬜ |
| 1.10 | Gasto duplicado | Enviar "50 mercado pix" 2x em 5min | Pergunta "Já registrei, quer duplicar?" | ⬜ |

---

## 2️⃣ REGISTRO DE ENTRADA (income)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 2.1 | Salário completo | "recebi 5000 de salário" | Registra entrada R$5000 cat. salário | ⬜ |
| 2.2 | Entrada sem categoria | "recebi 200" | Pergunta categoria ou registra como "outros" | ⬜ |
| 2.3 | Freelancer | "ganhei 1500 de freelance" | Registra entrada R$1500 | ⬜ |

---

## 3️⃣ RECORRENTES (recurring)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 3.1 | Criar recorrente | "todo mês pago 30 de passagem" | Cria recorrência "Passagem" R$30/mês (NÃO "todo mês pago") | ⬜ |
| 3.2 | Criar com cartão | "netflix 55 todo mês no crédito" | Registra + pergunta cartão | ⬜ |
| 3.3 | Cancelar por nome | "cancela a netflix" | Encontra e pede confirmação | ⬜ |
| 3.4 | Cancelar contextual | "cancela essa recorrência" | Busca mais recente, pede confirmação | ⬜ |
| 3.5 | Listar recorrentes | "meus gastos fixos" / "recorrentes" | Lista todos os ativos | ⬜ |
| 3.6 | Descrição refinada | "pago 100 de academia mensal" | Descrição = "Academia" (não genérico) | ⬜ |

---

## 4️⃣ PARCELAMENTOS (installment)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 4.1 | Parcelamento completo | "comprei roupa 200 em 2x" | Pergunta cartão ou boleto | ⬜ |
| 4.2 | Parcelamento + cartão | Selecionar cartão após 4.1 | Registra parcelas vinculadas ao cartão | ⬜ |
| 4.3 | Parcelamento boleto | Selecionar "Boleto" após 4.1 | Registra sem cartão, cria parcelamento | ⬜ |
| 4.4 | Sem nº parcelas | "parcelei 500 na loja" | Pergunta "Em quantas vezes?" | ⬜ |
| 4.5 | Listar parcelas | "minhas parcelas" | Mostra parcelamentos ativos | ⬜ |

---

## 5️⃣ CARTÕES DE CRÉDITO (add_card)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 5.1 | Criar cartão | "adicionar cartão Nubank limite 5000" | Cria cartão nome=Nubank, limite=5000 | ⬜ |
| 5.2 | Criar sem limite | "novo cartão Sicredi" | Pergunta limite | ⬜ |
| 5.3 | Consultar limites | "limite dos meus cartões" | Lista cartões com limite disponível | ⬜ |
| 5.4 | Gastos por cartão | "gastos do Nubank" | Lista transações daquele cartão | ⬜ |

---

## 6️⃣ CANCELAMENTO (cancel)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 6.1 | Cancelar transação | "cancelar" | Lista últimas 5 transações | ⬜ |
| 6.2 | Cancelar por nome | "cancela o uber" | Busca e mostra matches | ⬜ |
| 6.3 | Cancel + recorrente | Cancelar transação com id_recorrente | Desativa gastos_recorrentes.ativo=false | ⬜ |
| 6.4 | Cancel contextual | "cancela essa" | Busca última recorrência ativa | ⬜ |

---

## 7️⃣ EDIÇÃO RÁPIDA (edit)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 7.1 | Corrigir pagamento | "foi no pix" (dentro de 5min) | Atualiza forma_pagamento da última tx | ⬜ |
| 7.2 | Corrigir cartão | "era no Nubank" | Troca id_cartao | ⬜ |
| 7.3 | Palavra de correção | "errei, era débito" | Corrige payment_method | ⬜ |
| 7.4 | Sem tx recente | "corrige" (sem tx em 2min) | "Não encontrei registro recente" | ⬜ |

---

## 8️⃣ CONSULTAS (query)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 8.1 | Resumo do mês | "quanto gastei?" | Resumo com entradas/saídas/saldo | ⬜ |
| 8.2 | Resumo semanal | "gastos dessa semana" | Resumo da semana atual | ⬜ |
| 8.3 | Por categoria | "gastos com alimentação" | Total da categoria | ⬜ |
| 8.4 | Relatório completo | "relatório" | Relatório mensal formatado | ⬜ |
| 8.5 | Consulta temporal | "gastos dos últimos 5 dias" | Query com start_date/end_date corretos | ⬜ |
| 8.6 | Faturas abertas | "minhas faturas" | Lista faturas_cartao abertas | ⬜ |
| 8.7 | Contas pendentes | "contas a pagar" | Lista contas_pagar ativas | ⬜ |
| 8.8 | Orçamento | "meu orçamento" | Status do orçamento atual | ⬜ |

---

## 9️⃣ METAS (goal)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 9.1 | Criar meta | "quero juntar 5000 pra viagem" | Cria savings_goal | ⬜ |
| 9.2 | Adicionar a meta | "guardei 200 pra viagem" | Incrementa current_amount | ⬜ |
| 9.3 | Listar metas | "minhas metas" | Lista metas ativas com progresso | ⬜ |
| 9.4 | Múltiplas metas | "juntei 100" (2+ metas ativas) | Pergunta "em qual meta?" | ⬜ |

---

## 🔟 DÍVIDAS (debt)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 10.1 | Registrar dívida | "tenho uma dívida de 5000 no cartão" | Cria registro em dividas | ⬜ |
| 10.2 | Listar dívidas | "minhas dívidas" | Lista com saldo e juros | ⬜ |
| 10.3 | Simular quitação | "simular quitação" (PRO) | Simulação Avalanche | ⬜ |

---

## 1️⃣1️⃣ CONTROLE & AJUDA (control)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 11.1 | Saudação manhã | "bom dia" (6-12h) | Saudação contextual + resumo | ⬜ |
| 11.2 | Ajuda geral | "ajuda" / "me ajuda" | Menu de tópicos conversacional | ⬜ |
| 11.3 | Ajuda follow-up | "ajuda" → "gastos" | Tutorial sobre registro de gastos | ⬜ |
| 11.4 | Ajuda follow-up 2 | "ajuda" → "cartões" | Tutorial sobre cartões | ⬜ |
| 11.5 | Negação | "não" / "nenhum" | Cancela ação pendente | ⬜ |
| 11.6 | Esquece contexto | "esquece" | Limpa contexto + action | ⬜ |

---

## 1️⃣2️⃣ CHAT (consultor IA)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 12.1 | Pergunta financeira | "tô gastando demais?" | Resposta do consultor com dados reais | ⬜ |
| 12.2 | Conselho genérico | "como economizar?" | Dicas contextualizadas | ⬜ |
| 12.3 | Palavra solta ambígua | "café" | Pergunta "gasto ou consulta?" | ⬜ |
| 12.4 | Off-topic | "qual a capital da França?" | Recusa educada (fora de domínio) | ⬜ |

---

## 1️⃣3️⃣ BOTÕES & CALLBACKS

| # | Teste | Callback ID | Resultado Esperado | Status |
|---|-------|-------------|-------------------|--------|
| 13.1 | Confirmar sim | confirm_yes | Executa ação pendente | ⬜ |
| 13.2 | Confirmar não | confirm_no | Cancela ação | ⬜ |
| 13.3 | Duplicar sim | duplicate_confirm_yes | Registra mesmo duplicado | ⬜ |
| 13.4 | Duplicar não | duplicate_confirm_no | Descarta | ⬜ |
| 13.5 | Pagamento Pix | pay_pix | Atribui payment_method=pix | ⬜ |
| 13.6 | Selecionar cartão | card_{uuid} | Vincula cartão ao gasto | ⬜ |
| 13.7 | Multi separado | multi_separado | Registra gastos individualmente | ⬜ |
| 13.8 | Multi junto | multi_junto | Registra soma total | ⬜ |
| 13.9 | Número isolado gasto | num_gasto | Cria expense com amount | ⬜ |
| 13.10 | Número isolado entrada | num_entrada | Cria income com amount | ⬜ |
| 13.11 | Cancel recorrente sim | cancel_confirm_rec_yes | Desativa recorrência | ⬜ |
| 13.12 | Upgrade pro | upgrade_pro | Envia link Stripe | ⬜ |
| 13.13 | Instalment crédito | installment_credito | Pede seleção de cartão | ⬜ |
| 13.14 | Instalment boleto | installment_boleto | Registra sem cartão | ⬜ |

---

## 1️⃣4️⃣ FSM (Máquina de Estados)

| # | Teste | Cenário | Resultado Esperado | Status |
|---|-------|---------|-------------------|--------|
| 14.1 | Slot filling amount | "50 mercado" → bot pergunta pgto → "pix" | Registra completo | ⬜ |
| 14.2 | Slot pivot | Durante coleta, muda assunto | Pivota para novo intent | ⬜ |
| 14.3 | TTL expiry | Deixar 15min sem responder | Action expira automaticamente | ⬜ |
| 14.4 | Escape words | "tchau" / "sair" durante coleta | Limpa contexto | ⬜ |
| 14.5 | Max attempts | Responder inválido 3x | Cancela ação | ⬜ |
| 14.6 | Mensagem simultânea | Enviar 2 gastos em <2s | Enfileira o segundo | ⬜ |

---

## 1️⃣5️⃣ CONTAS A PAGAR (bill)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 15.1 | Criar conta | "conta de luz vence dia 10 valor 150" | Cria em contas_pagar | ⬜ |
| 15.2 | Pagar conta existente | "paguei a luz 148" | Registra pagamento | ⬜ |
| 15.3 | Pagar inexistente | "paguei internet 100" (sem fatura) | Registra como gasto + oferece criar fatura | ⬜ |

---

## 1️⃣6️⃣ CONTEXTOS (set_context)

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 16.1 | Criar contexto | "tô em viagem" | Cria user_context ativo | ⬜ |
| 16.2 | Gasto no contexto | "50 restaurante" (com contexto ativo) | Vincula ao contexto | ⬜ |
| 16.3 | Fechar contexto | "voltei da viagem" | Fecha contexto + resumo | ⬜ |
| 16.4 | Gastos do contexto | "quanto gastei na viagem?" | Consulta por contexto | ⬜ |

---

## 1️⃣7️⃣ PLANOS & TRIAL

| # | Teste | Cenário | Resultado Esperado | Status |
|---|-------|---------|-------------------|--------|
| 17.1 | Trial ativo | Msg de trial dentro do prazo | Processa normalmente | ⬜ |
| 17.2 | Trial expirado | Msg após expirar | Vendedor IA + link Stripe | ⬜ |
| 17.3 | Código ativação | "FINAX-ABC123" com trial expirado | Ativa plano + confirma | ⬜ |
| 17.4 | Feature Pro bloqueada | "simular quitação" (plano básico) | Teaser + botão upgrade | ⬜ |

---

## 1️⃣8️⃣ ONBOARDING

| # | Teste | Cenário | Resultado Esperado | Status |
|---|-------|---------|-------------------|--------|
| 18.1 | Novo usuário | 1ª mensagem | Inicia onboarding wizard | ⬜ |
| 18.2 | Pós-onboarding | "vamos!" após done | Tutorial de primeiros passos | ⬜ |

---

## 1️⃣9️⃣ CORTESIA & ACK

| # | Teste | Mensagem WhatsApp | Resultado Esperado | Status |
|---|-------|-------------------|--------------------|--------|
| 19.1 | Obrigado | "obrigado" | Resposta amigável | ⬜ |
| 19.2 | Ok com slot pendente | "ok" (com action ativa) | Silêncio (mantém estado) | ⬜ |
| 19.3 | Valeu | "valeu!" | Resposta amigável | ⬜ |

---

## 2️⃣0️⃣ ELITE (Memória & Correções)

| # | Teste | Cenário | Resultado Esperado | Status |
|---|-------|---------|-------------------|--------|
| 20.1 | Padrão de cartão | Registrar 3x "mercado" no Nubank | Na 4ª vez, sugere "Nubank, certo?" | ⬜ |
| 20.2 | Correção aprendida | Corrigir pagamento de "outro" → "pix" | Próxima vez, aplica pix automaticamente | ⬜ |

---

## 🌐 TESTES WEB (Dashboard)

| # | Teste | Página | Resultado Esperado | Status |
|---|-------|--------|--------------------|--------|
| W.1 | Login | /auth | Login com email/senha funciona | ⬜ |
| W.2 | Dashboard | /dashboard | Cards com dados atualizados | ⬜ |
| W.3 | Transações | /transacoes | Lista + filtros + CSV import | ⬜ |
| W.4 | Cartões | /cartoes | Lista cartões + faturas | ⬜ |
| W.5 | Recorrentes | /recorrentes | Lista gastos fixos | ⬜ |
| W.6 | Metas | /metas | Progresso visual | ⬜ |
| W.7 | Dívidas | /dividas | Simulador de quitação | ⬜ |
| W.8 | Relatórios | /relatorios | Export planilha | ⬜ |
| W.9 | Chat web | /chat | Chat streaming funcional | ⬜ |
| W.10 | Configurações | /configuracoes | Perfil + cancelamento | ⬜ |

---

## 🔄 MELHORIAS IDENTIFICADAS

### UX WhatsApp
1. **Feedback de progresso**: Quando registra gasto, mostrar saldo restante do orçamento
2. **Quick replies pós-registro**: Após registrar, oferecer "Registrar outro" / "Ver resumo"
3. **Resumo matinal proativo**: Enviar resumo do dia anterior ao bom dia
4. **Alerta de orçamento**: Quando atingir 80% do orçamento, avisar proativamente

### UX Web
5. **Onboarding wizard**: Tela vazia do dashboard → wizard de configuração inicial
6. **Notificações push**: Lembrar de contas próximas ao vencimento
7. **Gráfico de tendência**: Comparativo mês a mês na dashboard
8. **Mobile-first**: Melhorar responsividade em telas < 375px

### Performance
9. **Materialized Views**: Para dashboard queries pesadas
10. **Cache de relatórios**: Evitar recalcular todo mês

### Segurança
11. **Rate limiting**: Edge functions
12. **LGPD**: Export/purge de dados do usuário
