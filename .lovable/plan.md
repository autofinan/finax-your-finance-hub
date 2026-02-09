

# Ativacao de Tabelas Dormentes e Melhorias Estruturais

## Resumo da Situacao Atual

Apos analise completa do banco (60+ tabelas) e do codigo, identifiquei 5 sistemas que ja tem codigo pronto mas estao desconectados ou subutilizados:

```text
SISTEMA              | TABELA           | CODIGO EXISTE? | CONECTADO? | DADOS
---------------------|------------------|----------------|------------|-------
Memory (Padroes)     | user_patterns    | Sim (patterns.ts) | PARCIAL | 0 registros
Metas de Economia    | savings_goals    | Sim (goals.ts)    | SIM      | 2 registros
Alertas Proativos    | spending_alerts  | Sim (alerts.ts)   | SIM      | 0 registros
Perfil do Cliente    | perfil_cliente   | Sim (alertas usa) | PARCIAL  | 0 registros
Orcamentos           | orcamentos       | Sim (inline)      | SIM      | 0 registros
Onboarding           | user_onboarding  | Sim (onboarding.ts)| NAO     | 0 registros
Purchase Advisor     | (sem tabela)     | Sim (purchase.ts) | SIM      | N/A
```

---

## Ativacoes Necessarias (5 acoes)

### 1. MEMORY LAYER: `user_patterns` - Ativar aprendizado apos gasto

**Problema**: O codigo de `learnMerchantPattern` existe em `memory/patterns.ts` e e chamado em `intents/expense.ts`, MAS a funcao `registerExpense` inline do `index.ts` (que e a realmente executada) NAO chama `learnMerchantPattern`. Logo, nenhum padrao e aprendido.

**Acao**: Adicionar chamada a `learnMerchantPattern` no `registerExpense` inline apos cada gasto registrado com sucesso.

```text
// Apos registro bem-sucedido (apos closeAction):
await learnMerchantPattern({
  userId,
  description: descricao,
  category: categoria,
  paymentMethod: formaPagamento,
  cardId: cardId || undefined,
  transactionId: tx.id,
  wasUserCorrected: false
});
```

**Beneficio**: O Finax vai aprender que "Padaria do Ze" = alimentacao/debito, e da proxima vez ja preenche automaticamente. Isso ja funciona no pipeline (applyUserPatterns e chamado na decisao), so falta o lado do aprendizado.

**Arquivo**: `supabase/functions/finax-worker/index.ts` (dentro do registerExpense inline, apos closeAction)

---

### 2. PERFIL DO CLIENTE: `perfil_cliente` - Criar perfil automaticamente

**Problema**: A tabela `perfil_cliente` e usada por `alerts.ts` (para verificar limites mensais) e por `index.ts` (para verificar operation_mode), mas nenhum perfil e criado. Logo:
- `detectGoalRisk` nunca retorna alertas (limiteMensal = 0)
- `operation_mode` sempre cai no fallback "normal"

**Acao**: Criar perfil automaticamente quando o usuario se registra ou na primeira transacao. Tambem criar funcao para que o usuario defina seu limite mensal via WhatsApp.

```text
// Apos primeiro registro ou onboarding:
await supabase.from("perfil_cliente").upsert({
  usuario_id: userId,
  operation_mode: "normal",
  limites: { mensal: 0 },  // usuario define depois
  score_economia: 50
});
```

**Tambem**: Adicionar reconhecimento no AI classifier para mensagens como "meu limite mensal e 3000" ou "quero gastar no maximo 2000 por mes" que atualizem `perfil_cliente.limites.mensal`.

**Arquivo**: `supabase/functions/finax-worker/index.ts` (no fluxo de novo usuario + novo handler para "definir limite")

---

### 3. ONBOARDING COMPLETO: `user_onboarding` - Ativar fluxo de boas-vindas

**Problema**: O codigo de onboarding existe em `utils/onboarding.ts` com fluxo completo (estado emocional, problema, meta, nome), mas NAO e usado. O index.ts tem um onboarding simplificado inline (so manda uma mensagem de boas-vindas).

**Acao**: Substituir o onboarding inline pelo fluxo completo de `onboarding.ts`, que:
1. Pergunta estado emocional (stressed/ok/good) com botoes
2. Pergunta problema principal (divida/gasto demais/juntar grana)
3. Coleta detalhes (valor da divida, objetivo de poupanca)
4. Pede o nome
5. Cria perfil automaticamente com base nas respostas

**Ao finalizar o onboarding**:
- Criar `perfil_cliente` com os dados coletados
- Se o usuario quer juntar dinheiro, criar `savings_goal` automaticamente
- Se quer controlar gastos, criar `orcamento` automatico baseado na renda informada

**Arquivo**: `supabase/functions/finax-worker/index.ts` (substituir linhas 2577-2588) + `utils/onboarding.ts` (adicionar criacao de perfil/meta/orcamento ao finalizar)

---

### 4. ALERTAS PROATIVOS: Ativar CRON do `analyze-spending`

**Problema**: O codigo de `analyze-spending` e `finax-insights` existe e esta completo, mas:
- Nenhum `perfil_cliente` existe (logo `detectGoalRisk` nunca detecta nada)
- O campo `transacoes.status` e verificado como `confirmada`, mas as transacoes sao inseridas sem esse campo (verificar se a coluna existe)

**Acao**: Garantir que as transacoes sejam inseridas com `status: "confirmada"` (ja e feito no registerExpense inline). Apos ativar perfil_cliente (item 2), os alertas vao comecar a funcionar naturalmente.

**Tambem**: Verificar se os CRONs estao configurados no Supabase para `analyze-spending` (18h) e `finax-insights` (19h).

**Verificacao necessaria**: A coluna `status` na tabela `transacoes` pode nao existir ou ter nome diferente. Se nao existir, os detectores de alerta nunca encontram transacoes.

---

### 5. ORÇAMENTOS: Melhorar fluxo de criacao

**Problema**: A tabela `orcamentos` existe e o `checkBudgetAfterExpense` ja funciona no registerExpense. Mas ninguem cria orcamentos. Nao existe intent para isso.

**Acao**: O orcamento pode ser criado automaticamente no onboarding (se o usuario informa renda) ou via comando "definir orcamento de 2000 para alimentacao".

**Arquivo**: Criar handler para actionType `set_budget` no index.ts que:
1. Recebe limite e categoria (ou "global")
2. Faz upsert na tabela `orcamentos`
3. Retorna confirmacao

---

## Detalhes Tecnicos

### Arquivos a Modificar

```text
1. supabase/functions/finax-worker/index.ts
   - registerExpense inline: adicionar learnMerchantPattern apos sucesso
   - Onboarding (linhas 2577-2588): usar fluxo completo de onboarding.ts
   - Adicionar handler para "definir limite" e "definir orcamento"
   - Criar perfil_cliente na primeira transacao se nao existir

2. supabase/functions/finax-worker/utils/onboarding.ts
   - Ao finalizar: criar perfil_cliente, savings_goal e orcamento automaticamente

3. supabase/functions/finax-worker/decision/engine.ts (ou prompt do classificador)
   - Adicionar actionTypes: set_budget, set_limit (ou reusar set_context)
```

### Verificacoes de Banco Necessarias

```text
1. Coluna "status" na tabela transacoes - existe? O analyze-spending filtra por status="confirmada"
2. Coluna "telefone" na tabela usuarios - o finax-insights faz JOIN com usuarios(telefone)
3. Coluna "id_recorrente" na tabela transacoes - o detect missed recurring filtra por ela
```

### Ordem de Implementacao

```text
Fase 1 (Baixo risco - NAO muda fluxos existentes):
  1. Ativar learnMerchantPattern no registerExpense inline
  2. Criar perfil_cliente automaticamente na primeira transacao

Fase 2 (Risco medio - muda onboarding de novos usuarios):
  3. Ativar onboarding completo (user_onboarding + perfil + meta + orcamento)

Fase 3 (Risco medio - novos handlers):
  4. Adicionar handler "definir limite/orcamento"
  5. Verificar e ativar CRONs de alertas
```

### O que NAO mexer agora

```text
- bank_connections: Depende de Open Banking (futuro)
- employees: Modelo multi-usuario (futuro)
- chart_cache: Cache de graficos para WhatsApp (funciona quando charts sao enviados)
- shared_reports: Compartilhamento de relatorios (futuro)
- erros_interpretacao / hipoteses_registro: Logs de debug (ja funcionam via service_role)
```

## Testes Esperados Apos Implementacao

```text
Teste 1 (Memory Layer):
  Enviar "cafe 5 pix" → registra com sucesso
  Enviar "cafe 8 pix" de novo → segunda vez deve preencher categoria automaticamente
  Verificar tabela user_patterns: deve ter 1 registro "cafe" → alimentacao/pix

Teste 2 (Perfil):
  Enviar "meu limite mensal e 3000" → deve criar/atualizar perfil_cliente
  Verificar tabela perfil_cliente: limites.mensal = 3000

Teste 3 (Orcamento):
  Enviar "quero gastar no maximo 500 com alimentacao" → deve criar orcamento
  Depois registrar gastos em alimentacao → alertas de 50%/80%/100% devem aparecer

Teste 4 (Onboarding - testar com numero novo):
  Primeira mensagem → recebe botoes de estado emocional
  Clicar "To apertado" → recebe botoes de problema
  Clicar "Divida no cartao" → pergunta valor
  Enviar "5000" → pergunta nome
  Enviar "Christian" → resumo + botoes de comecar
  Verificar: perfil_cliente criado, savings_goal criada (se aplicavel)
```

