# Plano: Correcao de 4 Bugs (Recorrencia Duplicada, UI Recorrentes, Parcelamento, Confirmacao de Cartao)

---

## Bug #1: Recorrencia Processada 2x (Aluguel duplicado)

**Causa raiz:** A query em `processar-recorrentes/index.ts` linha 72 usa:

```text
.or(`dia_mes.eq.${diaHoje},proxima_execucao.lte.${hojeISO}`)
```

No dia 15/02, o aluguel (dia_mes=15) e processado e `proxima_execucao` e atualizada para `2026-03-15`. Porem, a data esta sendo definida com `new Date()` que usa UTC. Como o CRON roda as 7h BRT (10h UTC), `new Date().getDate()` retorna o dia correto. MAS se a `proxima_execucao` anterior nao existia (era NULL) OU foi setada incorretamente, a condicao `proxima_execucao.lte.${hojeISO}` tambem bate, causando dupla execucao.

**Evidencia no banco:** O aluguel tem `proxima_execucao: 2026-02-16` e `ultima_execucao: 2026-02-16`, confirmando que processou no dia 16 tambem. Isso aconteceu porque no dia 15 a proxima_execucao era NULL, entao o OR bateu em `dia_mes=15`. Depois, `proxima_execucao` foi setada para `2026-02-16` (usando UTC + 1 mes errado). No dia 16, `proxima_execucao.lte.2026-02-16` bateu de novo.

**Problema secundario:** A categoria do aluguel no banco e "outros" (foi cadastrado via WhatsApp sem categoria correta). A notificacao mostra a categoria do registro, que e "outros".

**Fix (processar-recorrentes/index.ts):**

1. Adicionar verificacao de `ultima_execucao` - se ja processou no mes atual, pular
2. Usar data de Brasilia para calcular `diaHoje` e `proxima_execucao`
3. Priorizar `proxima_execucao` sobre `dia_mes` quando ambos existem

```text
Logica corrigida:
- Buscar recorrentes WHERE ativo=true
- Para cada: verificar se ultima_execucao ja e do mes atual → pular
- Verificar se dia_mes == diaHoje OU proxima_execucao <= hojeISO
- Ao atualizar proxima_execucao, usar data de Brasilia e setar dia_mes correto
```

**Fix categoria aluguel:** Corrigir no banco a categoria do registro de "outros" para "moradia".

---

## Bug #2: Pagina Recorrentes sem data da proxima cobranca

**Causa raiz:** O componente `Recorrentes.tsx` nao exibe os campos `proxima_execucao` nem `ultima_execucao`, apesar de existirem no banco.

**Fix (src/pages/Recorrentes.tsx):**
Adicionar na area de informacoes de cada item:

- "Proxima cobranca: DD/MM/AAAA" (campo `proxima_execucao`)
- "Ultima cobranca: DD/MM/AAAA" (campo `ultima_execucao`)

---

## Bug #3: Parcelamentos lancam todas as parcelas de uma vez

**Problema:** Quando o usuario diz "perfume 120 em 3x", o sistema cria 3 registros na tabela `parcelas` imediatamente (parcela 1 pendente, parcela 2 e 3 futuras). Isso polui a visualizacao de transacoes e confunde o usuario.

**Solucao proposta:** Manter a criacao das parcelas na tabela `parcelas` (para controle de faturas), mas NAO criar transacoes futuras em `transacoes`. Apenas a parcela do mes atual gera transacao. As proximas parcelas serao processadas pelo CRON mensal (similar a recorrentes).

**Fix (intents/installment.ts):**

- Manter a logica atual de criar registros em `parcelas` (necessario para vincular a faturas)
- Verificar que apenas 1 transacao e criada em `transacoes` (a transacao mae com valor da parcela, nao o total)
- Adicionar um novo handler no CRON `processar-recorrentes` que tambem processa parcelas com status "futura" cujo `mes_referencia` corresponde ao mes atual

**Fix (processar-recorrentes/index.ts):**

- Apos processar gastos recorrentes, buscar parcelas com `status = 'futura'` e `mes_referencia` do mes atual
- Criar transacao para cada parcela e atualizar status para "pendente"
- Notificar usuario via WhatsApp

E TBM SOBRE AS PARCELAS TENHO O PROBLEMA QUE REGISTREI UM GASTO PARCELADO DEPOIS DA CRIAÇÃO DA TABELA PARCELAS, AS PARCELAS ESTÃO INDO PARA A TABELA E DEBITANDO NO CARTÃO, POREM NÃO ESTA INDO PARA A ABA PARCELAMENTOS E APARECENDO NO SITE O QUE FOI PARCELADO, PRECISA SER ARRUMADO. E TBBM GARANTIR QUE ESTA OBEDECENDO O PADRÃO DOS CARTÕES. COMPREI ALGO PARCELADO, O LIMITE É USADO O VALOR COMPLETO NO LIMITE, AO PAGAMENTO DE CADA PARCELA NA FATURA DO CARTÃO, O VALOR DA PARCELA ABRE NO LIMITE. 

---

## Bug #4: Cartao de credito auto-selecionado sem confirmar com usuario

**Problema:** O sistema de memoria (`patterns.ts`) aprende que "cafe" sempre vai no "Sicredi Credito" e aplica automaticamente. O campo `requiresConfirmation` existe no retorno de `applyUserPatterns` mas NAO e verificado no `index.ts` (linha 4498). O cartao e aplicado silenciosamente.

**Fix (index.ts, linhas ~4498-4503):**
Quando `patternResult.requiresConfirmation === true` E o padrao incluiu `card_id`:

1. Aplicar os slots normalmente
2. Mas ANTES de executar, enviar botoes de confirmacao:
  - "[Sim, Sicredi Credito]" → continua normalmente
  - "[Nao, outro cartao]" → abre lista/botoes de selecao de cartao
3. Salvar action com status `awaiting_confirmation` e slot pendente `card_confirm`

```text
Fluxo corrigido:
"cafe 1,50 credito"
→ Padrao encontrado: Sicredi Credito (conf: 0.8)
→ "Cafe R$ 1,50 no Sicredi Credito, certo?"
   [Sim, registrar] [Nao, outro cartao]
→ Se "Sim" → registra + confirma padrao (confidence +0.15)
→ Se "Nao" → mostra lista de cartoes
```

Apos a primeira confirmacao (`last_confirmed_by_user = true`), as proximas vezes o padrao sera aplicado direto sem perguntar.

---

## Secao Tecnica - Arquivos e Mudancas

```text
supabase/functions/processar-recorrentes/index.ts
  - Adicionar guard de dedup: verificar ultima_execucao do mes atual
  - Usar timezone de Brasilia para diaHoje
  - Adicionar processamento de parcelas futuras do mes atual
  - Corrigir calculo de proxima_execucao

src/pages/Recorrentes.tsx
  - Exibir proxima_execucao e ultima_execucao em cada card
  - Formatar datas no padrao DD/MM/AAAA

supabase/functions/finax-worker/index.ts
  - Linhas ~4498-4503: Verificar requiresConfirmation
  - Se true + card_id inferido → enviar botoes confirmacao
  - Handler para button "pattern_confirm_yes" e "pattern_confirm_no"

supabase/functions/finax-worker/intents/installment.ts
  - Verificar que transacao mae usa valor_parcela (nao valor_total)
  - Garantir que parcelas futuras NAO criem transacoes em transacoes

SQL: UPDATE gastos_recorrentes SET categoria = 'moradia' 
     WHERE id = 'd4221c80-424d-4373-aae1-99229e98f76b';

DEPLOY: processar-recorrentes, finax-worker
```

## Ordem de Execucao

```text
1. SQL - Corrigir categoria do aluguel para 'moradia'
2. processar-recorrentes - Guard dedup + timezone + parcelas
3. Recorrentes.tsx - Exibir datas de proxima/ultima cobranca
4. index.ts - Confirmacao de padrao de cartao com botoes
5. Deploy processar-recorrentes + finax-worker
6. Testar fluxos
```

## Resultado Esperado

```text
Aluguel dia 15 → processa 1x, notifica com categoria "moradia"     OK
Recorrentes UI → mostra "Proxima: 15/03/2026"                      OK
"perfume 120 3x" → 1 transacao agora, proximas via CRON mensal     OK
"cafe 1,50 credito" → "No Sicredi Credito?" [Sim] [Nao, outro]    OK
```