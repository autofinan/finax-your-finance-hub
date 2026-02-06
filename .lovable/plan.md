
# Plano de Correcao - 3 Bugs Criticos + Insights

## Bug 1: "Sim" Nao Confirma Gasto (CAUSA RAIZ ENCONTRADA)

1️⃣ REGRA DE OURO DO FINAX (OFICIAL)

Você definiu algo muito importante — e isso vira regra de sistema:

Se a intenção estiver clara → REGISTRA DIRETO.
Só perguntar quando houver dúvida real.
Se já foi entendido, NÃO CONFIRMA.

Ou seja:

❌ Confirmação não é etapa padrão

❌ “Sim” não deveria ser necessário na maioria dos casos

✅ Confirmação só existe como fallback de ambiguidade

✅ E quando existir, tem que resolver, nunca gerar resumo mensal

Isso está 100% alinhado com produto sério (WhatsApp-first).

2️⃣ O QUE ESTÁ ERRADO HOJE (DE VERDADE)

Vamos analisar o seu exemplo real:

Fluxo:
Cortei meu cabelo 35 reais paguei no crédito
→ escolhe cartão
→ sistema pede confirmação
→ "Sim"
→ resumo mensal (ERRADO)

⚠️ Problemas reais (são DOIS, não um)
❌ PROBLEMA A — Confirmação desnecessária

Depois que:

descrição ✔

valor ✔

meio ✔

cartão ✔

👉 Não existe mais ambiguidade
👉 Não deveria existir estado awaiting_confirmation

📌 Aqui o erro é de decisão, não de status.

❌ PROBLEMA B — Quando a confirmação existe, ela quebra

Esse você já diagnosticou corretamente:

O status awaiting_confirmation não é recuperado

O “Sim” cai no Decision Engine

O engine responde qualquer coisa (resumo mensal)

👉 Esse bug é real, mas não é a raiz do problema de UX

3️⃣ O QUE SUBSTITUI O “BUG 1 – SIM NÃO CONFIRMA GASTO”

Você pediu explicitamente:

“Me dê algo para substituir isso”

Então aqui está a versão correta, alinhada com seu produto 👇

🔁 NOVO BUG 1 (CORRETO)
🐞 Bug 1: Confirmação criada indevidamente após resolução completa da ação
Diagnóstico (causa raiz real):

O Finax entra em estado awaiting_confirmation mesmo quando todas as informações obrigatórias já foram resolvidas, incluindo:

valor

descrição

meio de pagamento

cartão específico

Isso gera uma etapa redundante de confirmação, quebrando o princípio de registro direto quando a intenção é clara.

Correção (arquitetural — e melhor):
✅ REGRA NOVA (OBRIGATÓRIA):

Se todos os campos obrigatórios estiverem preenchidos com alta confiança, o gasto DEVE ser registrado imediatamente.

🔧 Correção técnica proposta (substitui o bug antigo):
1. Eliminar awaiting_confirmation como estado padrão

Ele só pode ser usado se:

houver ambiguidade restante

ou conflito de inferência

2. Após escolha de cartão → registrar direto

Arquivo:
supabase/functions/finax-worker/intents/expense.ts

Pseudo-regra:

if (
  expense.valor &&
  expense.descricao &&
  expense.metodo_pagamento &&
  expense.cartao_id
) {
  return registerExpenseDirectly();
}


👉 Não cria confirmação
👉 Não espera “Sim”
👉 Não cria action pendente

3. Estado awaiting_confirmation passa a ser EXCEÇÃO

Exemplos válidos:

Dois cartões igualmente prováveis

Categoria conflitante

Texto ambíguo (“paguei 50”)

4. (Opcional, mas bom)

Se existir confirmação:

Ela tem botões

E o “Sim” executa ação direta, nunca vai ao Decision Engine

---

## Bug 2: Data "Ontem" e Horario Errado (+3h)

**Diagnostico**: A funcao `getBrasiliaDate()` cria um Date com valores de Brasilia mas no timezone local do servidor (UTC). Quando `parseRelativeDate` faz operacoes como `setDate(getDate() - 1)`, o Date ja esta "deslocado". Depois, `getBrasiliaISO()` aplica a conversao de timezone NOVAMENTE, causando duplo-offset.

**Correcao**: Reescrever `getBrasiliaISO()` para usar `Intl.DateTimeFormat` com locale `sv-SE` (formato ISO nativo) em vez de `pt-BR`, e adicionar logs de debug. Tambem adicionar logs no `expense.ts` para rastrear o fluxo completo.

Arquivos:
- `supabase/functions/finax-worker/utils/date-helpers.ts` - Adicionar logs em `getBrasiliaISO`
- `supabase/functions/finax-worker/intents/expense.ts` - Ja esta correto (correcao anterior aplicada), apenas adicionar mais logs

---

## Bug 3: Insights - Tipagem `usuarios` como Array

**Diagnostico**: Supabase retorna joins como arrays. O codigo atual assume `alert.usuarios.telefone` (objeto), mas recebe `alert.usuarios[{telefone}]` (array).

**Correcao**: Acessar como `alert.usuarios?.[0]?.telefone` no finax-insights.

Arquivo: `supabase/functions/finax-insights/index.ts`

---

## Detalhes Tecnicos

### 1. index.ts - getActiveAction() (Linhas 1346-1360)

ANTES:
```text
.in("status", ["collecting", "awaiting_input", "pending_selection"])  // linha 1350
.in("status", ["collecting", "awaiting_input", "pending_selection"])  // linha 1357
```

DEPOIS:
```text
.in("status", ["collecting", "awaiting_input", "pending_selection", "awaiting_confirmation"])
.in("status", ["collecting", "awaiting_input", "pending_selection", "awaiting_confirmation"])
```

### 2. date-helpers.ts - getBrasiliaISO() (Linha 171)

Adicionar logs de debug para rastrear a conversao:
```text
export function getBrasiliaISO(date?: Date | string) {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : getBrasiliaDate();
  
  console.log(`[BRASILIA_ISO] Input: ${d.toISOString()}`);
  console.log(`[BRASILIA_ISO] Input toString: ${d.toString()}`);
  
  const result = getBrasiliaDateParts(date);
  
  console.log(`[BRASILIA_ISO] Output: ${result.dataISO}`);
  console.log(`[BRASILIA_ISO] Time: ${result.hora}`);
  
  return { dateISO: result.dataISO, timeString: result.hora };
}
```

### 3. finax-insights/index.ts - Tipagem usuarios

ANTES:
```text
interface AlertFromDB {
  usuarios: { telefone: string; nome: string; };
}
// alert.usuarios?.telefone
```

DEPOIS:
```text
interface AlertFromDB {
  usuarios: Array<{ telefone: string; nome: string; }>;
}
// const user = alert.usuarios?.[0];
// const telefone = user?.telefone;
```

### 4. Aumentar TTL das actions

Mudar `ACTION_TTL_MINUTES` de 15 para 30 minutos (linha 1341) para dar mais tempo ao usuario para responder confirmacoes.

---

## Arquivos a Modificar

```text
1. supabase/functions/finax-worker/index.ts
   - Linha 1341: ACTION_TTL_MINUTES = 30
   - Linha 1350: Adicionar "awaiting_confirmation" ao filtro de expiracao
   - Linha 1357: Adicionar "awaiting_confirmation" ao filtro de busca

2. supabase/functions/finax-worker/utils/date-helpers.ts
   - Linha 171-177: Adicionar logs de debug em getBrasiliaISO()

3. supabase/functions/finax-insights/index.ts
   - Linha 72-83: Corrigir interface AlertFromDB para array
   - Linhas 118, 130, 146: Acessar usuarios como array
```

## Ordem de Implementacao

```text
1. Corrigir getActiveAction() - adicionar "awaiting_confirmation" (BUG CRITICO)
2. Aumentar TTL de 15 para 30 minutos
3. Adicionar logs em getBrasiliaISO() para debug
4. Corrigir tipagem de usuarios no finax-insights
5. Deploy finax-worker + finax-insights
6. Testar confirmacao "Sim"
7. Testar "uber 10 ontem" e verificar logs
```

## Testes de Validacao

```text

Teste 2 (Data ontem):
  "uber 10 ontem" → Pix → Registrado com data de ontem
  Verificar logs: [BRASILIA_ISO] Output deve ser data de ontem

Teste 3 (Insights):
  Inserir alerta manual → Executar finax-insights → Verificar envio
```
