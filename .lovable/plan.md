

# Plano: Correcoes dos Testes do Bloco 1-13

## Problemas Identificados nos Testes

### BUG 1: Tabela `parcelas` nao existe (CRITICO)
**Teste 2.1** - Parcelamento registra transacao mae mas falha ao criar parcelas.
O codigo em `installment.ts` (linha 222) insere na tabela `parcelas`, mas ela NAO existe no banco. So existe `parcelamentos`.

**Log:** `Could not find the table 'public.parcelas' in the schema cache`

**Fix:** Criar tabela `parcelas` via migracao SQL com as colunas usadas pelo codigo.

### BUG 2: Query "meus parcelamentos" retorna vazio (CRITICO)
**Teste 2.3** - A query em `index.ts` (linha 5807) busca da tabela `parcelas` que nao existe. Mesmo apos criar a tabela, a query nao vai funcionar se as parcelas nao foram salvas (por causa do Bug 1).

**Fix:** Corrigido automaticamente ao resolver o Bug 1.

### BUG 3: Credito nao pergunta cartao no fluxo de botoes (CRITICO)
**Teste final (pag 40-41)** - Quando usuario envia "cremozinho 5" -> seleciona [Credito] via botao, o handler `pay_credito` (linha 3405-3458) registra direto SEM perguntar qual cartao. A resolucao de cartao (`resolveCreditCard`) so existe no fluxo principal da engine (linha 4636), nao no handler de botoes.

**Fix:** No handler `pay_credito` (linha 3412), antes de registrar, verificar se `payment_method === "credito"` e chamar `resolveCreditCard`. Se precisa de selecao de cartao, criar action com slot pendente `card`.

### BUG 4: Credito com padrao aprendido nao confirma cartao
**Teste (pag 41)** - "cafe 1 no credito" -> Registra direto no Sicredi sem confirmar. O padrao aprendido escolhe o cartao automaticamente, mas deveria perguntar "Posso registrar no Sicredi?" com opcao de trocar.

**Fix:** No fluxo principal de expense com credito (linha 4636), quando `resolveCreditCard` retorna sucesso com 1 cartao (auto-selecionado), adicionar etapa de confirmacao: "Registrar no [Cartao]?" com botoes [Sim] e [Outro cartao].

NOTA: Esse comportamento e mais complexo e pode ser opcional. A regra sugerida pelo usuario e boa (perguntar se usuario usa o cartao padrao), mas pode adicionar fricao desnecessaria para quem so tem 1 cartao. Implementaremos apenas quando ha 2+ cartoes.

### BUG 5: "RELATORIO SEMANAL" mostra resumo do MES (IMPORTANTE)
**Teste 3.4** - IA classifica corretamente como `query_scope: "summary", time_range: "week"`, mas o case `"summary"` (linha 5884) faz `break` e cai no fallback que chama `getMonthlySummary()` (linha 6026). Nao ha tratamento para `summary + week`.

**Fix:** No case `"summary"` (linha 5884), verificar se `time_range === "week"` e redirecionar para o handler `weekly_report` que ja existe e funciona.

### BUG 6: "recebi 500" nao pergunta forma de pagamento (MENOR)
**Teste 1.7** - O teste esperava botoes [Pix] [Dinheiro] [Transferencia], mas o income registra direto sem perguntar. Isso porque `hasAllRequiredSlots("income", slots)` retorna true (income so requer `amount`).

**Analise:** O comportamento atual e CORRETO pela definicao de slots (income so requer amount). Se o usuario quer perguntar source, precisamos adicionar `source` como slot obrigatorio. MAS isso adiciona fricao. 

**Fix:** Nao alterar agora - comportamento correto. Entradas sem source sao registradas como "outro". Se quiser mudar no futuro, basta adicionar source a SLOT_REQUIREMENTS.

### BUG 7: "ja tenho 500 para o trefego pago" - IA nao entende (IMPORTANTE)
**Teste 4.3** - IA classifica como `unknown` (conf: 0.3). O texto tem erro de ortografia ("trefego" vs "trafego") e a IA nao consegue mapear. O codigo de add-to-goal (linha 5323) depende de `isAddIntent && slots.amount && slots.description`, mas a IA retornou `slots: {}`.

**Fix:** Melhorar o PROMPT_FINAX_UNIVERSAL para incluir exemplos de `goal` com verbo "tenho" + valor + meta. Adicionar: `"ja tenho 500 para X" -> goal, slots: {amount: 500, description: "X"}`.

### BUG 8: "guardei 200" registra como entrada, nao como contribuicao de meta (IMPORTANTE)
**Teste 4.4** - IA classifica como `income` em vez de `goal`. O verbo "guardei" esta na lista ADD_INDICATORS (linha 5320), mas so e verificado DENTRO do bloco `if (decision.actionType === "goal")`.

**Fix:** Adicionar deteccao de "guardei" ANTES do roteamento da engine, ou melhorar o prompt para que a IA classifique "guardei 200" como `goal` quando o usuario tem metas ativas.

### BUG 9: Contexto ajuda -> "registrar gastos" perde contexto (MENOR)
**Teste 6.2** - Apos "ajuda" e menu de opcoes, usuario responde "registrar gastos" e o sistema acha que e uma mensagem ambigua (chat guard). O historico de 10 mensagens deveria ajudar, mas a IA classifica como `chat` (conf: 0.7) e o chat guard bloqueia.

**Fix:** Apos enviar menu de ajuda, salvar contexto `topic: "help"` para que respostas subsequentes sejam tratadas como continuacao da ajuda, nao como mensagem independente.

### BUG 10: Botao de duplicata expirado (MENOR)
**Teste 1.5** - Botao `duplicate_confirm_no` expirou antes de ser clicado. O contexto foi perdido entre o envio do botao e o clique.

**Analise:** Isso e um problema de timing - o edge function reiniciou (shutdown/boot) entre o envio e o clique. O TTL do contexto ja foi aumentado para 24h, mas a action pode ter expirado.

**Fix:** Aumentar timeout de cleanup de actions para evitar que actions recentes sejam limpas prematuramente.

### BUG 11: Grafico do Dashboard nao funciona (FRONTEND)
**Teste 12.1** - O grafico de fluxo semanal nao renderiza dados. O problema e que `t.data` no banco contem timestamps com timezone (`2026-02-15 17:37:02+00`), mas o filtro no Dashboard (linha 100) compara com `diaStr` que e `YYYY-MM-DD`. A comparacao `t.data === diaStr` sempre falha porque `t.data` inclui hora.

**Fix:** Mudar a comparacao para `t.data.startsWith(diaStr)` ou usar `.split('T')[0]`.

### BUG 12: Transacoes nao ordenam mais recente primeiro (FRONTEND)
**Teste 9.2** - Quando mostra "todas as transacoes", a mais antiga aparece primeiro. O hook `useTransacoes` (linha 26) ja ordena `ascending: false`, mas a pagina `Transacoes.tsx` pode estar revertendo a ordem na renderizacao ou o filtro altera a ordem.

**Fix:** Verificar se `filteredTransacoes` preserva a ordem. A query ja tem `order('data', { ascending: false })`.

### BUG 13: `logs_sistema` constraint rejeita level "warn" (MENOR)
**Logs** - O logger usa `'warn'` mas a constraint CHECK da tabela so aceita `['info', 'warning', 'error', 'debug']`.

**Fix:** Alterar a constraint para aceitar `'warn'` ou mudar o logger para usar `'warning'`.

### BUG 14: Cardoes com 4+ opcoes nao mostra lista completa
**Teste 1.3/1.4 (pag 2)** - Usuario tem mais de 3 cartoes mas so ve 2 opcoes como botoes + "Outros". O usuario quer que com 1 cartao = auto-seleciona, 2 = 2 botoes, 3 = 3 botoes, 4+ = lista interativa do WhatsApp.

**Fix:** Ja esta implementado no `credit-flow.ts` (usa lista para 4+). O problema e que no handler de botoes `pay_credito` (Bug 3) isso nao e chamado.

---

## Secao Tecnica - Arquivos e Mudancas

```text
MIGRACOES SQL:
  1. Criar tabela 'parcelas' com colunas:
     - id (uuid PK)
     - parcelamento_id (uuid FK -> transacoes.id)
     - usuario_id (uuid)
     - numero_parcela (int)
     - total_parcelas (int)
     - valor (numeric)
     - fatura_id (uuid FK -> faturas_cartao.id)
     - cartao_id (uuid FK -> cartoes_credito.id)
     - status (text: pendente/futura/paga)
     - mes_referencia (date)
     - descricao (text)
     - created_at (timestamptz)
     + RLS policies para usuario_id
  
  2. Alterar constraint logs_sistema_level_check:
     DROP CONSTRAINT logs_sistema_level_check
     ADD CONSTRAINT logs_sistema_level_check CHECK (level IN ('info','warn','warning','error','debug'))

EDITAR:
  supabase/functions/finax-worker/index.ts
    L3412: Handler pay_credito - adicionar resolveCreditCard antes de registrar
    L5884: Case "summary" - verificar time_range === "week" e rotear para weekly_report
    L5323: Goal add - melhorar deteccao quando IA classifica "guardei" como income

  supabase/functions/finax-worker/index.ts (PROMPT)
    Adicionar exemplos de goal: "ja tenho X para Y" -> goal
    Adicionar regra: "guardei X" sem destino claro = goal (nao income)

  src/pages/Dashboard.tsx
    L100: Mudar filtro de data para usar startsWith ou split('T')[0]

  src/pages/Transacoes.tsx
    Verificar ordenacao de transacoes

DEPLOY:
  finax-worker
```

## Prioridade de Implementacao

```text
1. [CRITICO] Criar tabela parcelas (SQL)                     - 5 min
2. [CRITICO] Handler pay_credito -> resolveCreditCard         - 15 min
3. [IMPORTANTE] Summary + week -> weekly_report               - 5 min
4. [IMPORTANTE] Goal: "guardei/tenho" -> melhorar prompt      - 10 min
5. [FRONTEND] Dashboard grafico filtro de data                - 5 min
6. [FRONTEND] Transacoes ordenacao                            - 5 min
7. [MENOR] logs_sistema constraint warn                       - 2 min
8. [MENOR] Contexto "ajuda" -> resposta subsequente           - 10 min
```

## Resultado Esperado Apos Correcoes

```text
"perfume 120 credito 3x" -> Parcelas criadas na tabela parcelas ✅
"meus parcelamentos" -> Lista parcelas ativas ✅
"cremozinho 5" -> [Credito] -> "Qual cartao?" ✅
"cafe 1 no credito" (2+ cartoes) -> "Qual cartao?" ✅
"RELATORIO SEMANAL" -> Resumo dos ultimos 7 dias ✅
"guardei 200" (com metas ativas) -> "Em qual meta?" ✅
"ja tenho 500 para trafego" -> Adiciona a meta ✅
Dashboard grafico -> Mostra dados reais ✅
Transacoes -> Mais recente primeiro ✅
```
