
# Ativação de Tabelas Dormentes - IMPLEMENTADO ✅

## Status: TODAS AS 3 FASES IMPLEMENTADAS E DEPLOYADAS

### Fase 1 ✅ - Memory Layer + Perfil Cliente
- `learnMerchantPattern` chamado após cada gasto registrado com sucesso no `registerExpense` inline
- `ensurePerfilCliente` criado e chamado automaticamente após cada transação
- Ambos são não-bloqueantes (try/catch isolados)

### Fase 2 ✅ - Onboarding Completo
- Onboarding inline substituído pelo fluxo completo de `onboarding.ts`
- Verifica `user_onboarding` ativo ANTES de processar mensagens normais
- Ao finalizar onboarding:
  - Cria `perfil_cliente` com score baseado no estado emocional
  - Se quer juntar grana → cria `savings_goal` automaticamente
  - Se quer controlar gastos → cria `orcamento` global automaticamente

### Fase 3 ✅ - Set Budget + Alertas
- `set_budget` ActionType adicionado em: types.ts, slot-prompts.ts, engine.ts, index.ts
- Handler completo: cria/atualiza orçamento + atualiza perfil_cliente.limites.mensal
- Prompt IA atualizado com exemplos de "meu limite mensal é 3000"
- Semantic patterns do engine.ts atualizado com verbos/contextos de orçamento

### Verificações de Banco ✅
- `transacoes.status` → EXISTE (text)
- `transacoes.id_recorrente` → EXISTE (uuid)
- `usuarios.phone_number` → EXISTE (era phone_number, não telefone)
