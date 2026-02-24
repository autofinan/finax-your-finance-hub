
# Plano: Finax Acelerador de Liberdade Financeira

## ✅ Já Implementado

### Core (v1-v5)
1. Tabela `dividas` + CRUD + página web de dívidas
2. Classificação automática `expense_type` (essencial_fixo, flexível, etc.)
3. Widget "Essenciais vs Flexíveis" no Dashboard
4. TransactionList mostrando descrição + badge expense_type
5. Debt Handler no WhatsApp (registrar/listar dívidas)
6. Interceptor de correção de pagamento

### Feature Gating + Pricing
7. Feature Gating completo (`usePlanoStatus.ts` com FEATURE_MATRIX - 30+ features)
8. Componente `UpgradeTeaser.tsx` reutilizável (blur + lock + CTA)
9. Gating aplicado em Dívidas, Cartões (2 limite), Metas (5 limite)
10. Landing Page Pricing atualizado (R$19,90 / R$29,90)
11. PlanoCard atualizado no Dashboard
12. CheckoutModal com preços corretos

### Bug Fixes WhatsApp
13. ✅ Fix "Qual o undefined?" - Guard em `getSlotPrompt` contra null/undefined
14. ✅ Fix `getNextMissingSlot` - Validação de payment_method inválidos
15. ✅ Fix `nextMissing null` - Fallback para executar quando todos slots preenchidos
16. ✅ OCR Multi-Item - Prompt Gemini atualizado para detectar múltiplos itens
17. ✅ Fluxo multi-expense para imagens - Reutiliza fluxo existente (Separado/Junto)

---

## 🔮 Falta Implementar (Próximas Fases - Features Pro)

### Prioridade Alta
1. **Simulador de Quitação (Pro)** - 3 cenários de pagamento com cálculo de juros e "dias de liberdade"
2. **Insights Preditivos (Pro)** - "Se você reduzir delivery em 40%, quita 47 dias antes"
3. **Gating no WhatsApp** - Diferenciar respostas Básico vs Pro no bot

### Prioridade Média
4. **Consultor IA Semanal (Pro)** - Análise automática com plano de ação
5. **Detector de Padrões (Pro)** - Identificar gastos recorrentes não registrados
6. **Radar de Anomalias (Pro)** - Alertar gastos fora do padrão
7. **Projeções Financeiras (Pro)** - Onde você estará em 3, 6, 12 meses

### Prioridade Baixa
8. **Metas de Frequência (Pro)** - "Máximo 8 deliveries/mês"
9. **Progresso Acumulado** - "Desde que entrou no Finax, você economizou X"
10. **Trial End Summary** - Tela mostrando o que o usuário conquistou nos 14 dias
11. **Relatórios diferenciados** - Básico: resumo simples / Pro: insights com impacto em dias
