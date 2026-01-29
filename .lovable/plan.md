
# Plano de Correcao Completo - Semana 1 + Bugs Criticos

## Resumo Executivo

Este plano resolve TODOS os problemas identificados em 4 frentes:

1. **Backend (finax-worker)**: Integrar logger, FinaxError, salvar ai_decisions, atualizar prompt
2. **Bug Critico**: Parser de valores brasileiros (8,54 sendo interpretado como 8 e 54)
3. **Frontend - Contas a Pagar**: Corrigir erro na criacao
4. **Frontend - Visual**: Padronizar Eventos, Metas e ContasPagar com mesmo template do Dashboard

---

## PARTE 1: PARSER BRASILEIRO (BUG CRITICO)

### Problema
Mensagem "101,31 internet Cuiaba" esta sendo parseada como 2 gastos:
- Gasto de R$ 101.00
- Internet Cuiaba: R$ 31.00

### Causa Raiz
O arquivo `multiple-expenses.ts` linha 65 usa:
```typescript
const parsed = parseFloat(match[1].replace(",", "."));
```

Porem o regex na linha 37 captura `\d+[.,]?\d*` que funciona, mas o PROBLEMA esta no separator da linha 31:
```typescript
const separators = /[,\n]|\s+e\s+/gi;  // ← VIRGULA e tratada como separator!
```

Quando o usuario escreve "101,31 internet" o sistema:
1. Separa por VIRGULA → ["101", "31 internet Cuiaba"]
2. Parseia 101 como primeiro gasto
3. Parseia 31 como segundo gasto

### Solucao

**Arquivo Novo**: `supabase/functions/finax-worker/utils/parseAmount.ts`

```typescript
// Parser de valores monetarios formato brasileiro
export function parseBrazilianAmount(input: string): number | null {
  if (!input || typeof input !== 'string') return null;

  // Limpar espacos e simbolos de moeda
  let raw = input.trim().replace(/[R$\s]/gi, "");
  
  // Se vazio, retornar null
  if (!raw || raw.length === 0) return null;
  
  // Detectar formato: se tem virgula DEPOIS de ponto, e BR (1.234,56)
  // Se tem ponto DEPOIS de virgula, e US (1,234.56)
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  
  if (lastComma > lastDot && lastComma !== -1) {
    // Formato brasileiro: 1.234,56 ou 8,54
    raw = raw.replace(/\./g, "");  // Remove separadores de milhar
    raw = raw.replace(",", ".");    // Troca virgula decimal por ponto
  } else if (lastDot > lastComma && lastDot !== -1) {
    // Formato americano ou so com ponto: 1,234.56 ou 8.54
    raw = raw.replace(/,/g, "");   // Remove separadores de milhar
  }
  // Se nao tem nem virgula nem ponto, e numero inteiro
  
  const value = Number(raw);
  
  if (isNaN(value) || value <= 0 || value >= 1000000) return null;
  
  // Arredondar para 2 casas decimais
  return Math.round(value * 100) / 100;
}
```

**Modificar**: `supabase/functions/finax-worker/utils/multiple-expenses.ts`

1. Importar o novo parser
2. Mudar regex de separador para NAO separar por virgula quando seguida de digitos:
```typescript
// ANTES (linha 31)
const separators = /[,\n]|\s+e\s+/gi;

// DEPOIS - Nao separar virgula que tem digito depois (decimal)
const separators = /(?<!\d),(?!\d)|\n|\s+e\s+/gi;
```

3. Usar `parseBrazilianAmount` em vez de `parseFloat`:
```typescript
// ANTES (linha 65)
const parsed = parseFloat(match[1].replace(",", "."));

// DEPOIS
const parsed = parseBrazilianAmount(match[1]);
if (parsed === null) continue;
```

**Modificar**: `supabase/functions/finax-worker/index.ts`

1. Linha 252-254 - `parseNumericValue`:
```typescript
// ANTES
function parseNumericValue(text: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, "").replace(",", ".");
  const value = parseFloat(cleaned);
  return isNaN(value) || value <= 0 ? null : value;
}

// DEPOIS - Importar e usar parseBrazilianAmount
import { parseBrazilianAmount } from "./utils/parseAmount.ts";

function parseNumericValue(text: string): number | null {
  return parseBrazilianAmount(text);
}
```

2. Linha 762 em `normalizeAISlots` - garantir que amount seja parseado corretamente:
```typescript
// ANTES
if (slots.amount !== undefined) normalized.amount = Number(slots.amount);

// DEPOIS
if (slots.amount !== undefined) {
  if (typeof slots.amount === 'string') {
    normalized.amount = parseBrazilianAmount(slots.amount) || 0;
  } else {
    normalized.amount = Number(slots.amount);
  }
}
```

---

## PARTE 2: INTEGRACAO LOGGER + FINAXERROR + AI_DECISIONS

### 2.1 Usar Logger no index.ts

**Modificar**: `supabase/functions/finax-worker/index.ts`

Adicionar import no topo (linha ~7):
```typescript
import { logger } from "./utils/logger.ts";
import { FinaxError, FinaxErrorCode } from "./utils/errors.ts";
```

Substituir console.log criticos por logger estruturado (exemplos):

```typescript
// Linha 1125 - classificacao deterministica
// ANTES
console.log(`⚡ [DETERMINISTICO] ${deterministicResult.actionType}...`);

// DEPOIS
logger.info({
  component: "classifier",
  userId,
  messageId: payload.messageId,
  actionType: deterministicResult.actionType,
  confidence: deterministicResult.confidence
}, "Classificacao deterministica concluida");
```

```typescript
// Linha 1180 - resultado IA
// ANTES
console.log(`🤖 [IA] Resultado: ${aiResult.actionType}...`);

// DEPOIS
logger.info({
  component: "ai_classifier",
  userId,
  messageId: payload.messageId,
  actionType: aiResult.actionType,
  confidence: aiResult.confidence,
  slots: aiResult.slots
}, "Classificacao IA concluida");
```

### 2.2 Salvar Decisoes da IA

**Modificar**: Linha ~1180 de `index.ts`, APOS `callAIForDecision`:

```typescript
const aiResult = await callAIForDecision(message, context, history);

// SALVAR DECISAO PARA ANALYTICS
try {
  await supabase.from("ai_decisions").insert({
    user_id: userId,
    message: conteudoProcessado.slice(0, 500),
    message_type: payload.messageType,
    message_id: payload.messageId ? payload.messageId : undefined,
    ai_classification: aiResult.actionType,
    ai_confidence: aiResult.confidence,
    ai_slots: aiResult.slots,
    ai_reasoning: aiResult.reasoning?.slice(0, 500),
    model_version: "gemini-2.5-flash"
  });
} catch (trackError) {
  logger.warn({ component: "ai_tracker", userId }, "Falha ao salvar decisao IA");
}
```

### 2.3 Usar FinaxError no catch principal

**Modificar**: Linhas 4631-4667

```typescript
} catch (error: unknown) {
  const finaxError = FinaxError.fromError(error);
  
  logger.error({
    component: "job_processor",
    userId,
    messageId: job.id,
    error: finaxError.message,
    code: finaxError.code
  }, "Erro no processamento do job");
  
  // Retry com backoff exponencial
  const retryCount = (job.retry_count || 0) + 1;
  const maxRetries = job.max_retries || 3;
  
  if (retryCount < maxRetries) {
    const backoffMs = Math.min(30000, 1000 * Math.pow(2, retryCount));
    const nextRetry = new Date(Date.now() + backoffMs);
    
    await supabase.from("webhook_jobs").update({
      status: "pending",
      retry_count: retryCount,
      last_error: finaxError.message,
      next_retry_at: nextRetry.toISOString()
    }).eq("id", job.id);
    
    logger.info({ component: "job_processor", jobId: job.id }, 
      `Retry ${retryCount}/${maxRetries} agendado`);
  } else {
    await supabase.from("webhook_jobs").update({
      status: "failed",
      dead_letter: true,
      last_error: finaxError.message
    }).eq("id", job.id);
  }
  
  // Enviar mensagem amigavel ao usuario
  try {
    await sendMessage(payload.phoneNumber, finaxError.userMessage, payload.messageSource);
  } catch {}
}
```

---

## PARTE 3: ATUALIZAR PROMPT PARA SLOTS EM INGLES

**Modificar**: `PROMPT_FINAX_UNIVERSAL` (linha 576)

Adicionar secao de nomenclatura rigida ANTES do checklist:

```typescript
## 🚨 NOMENCLATURA OBRIGATORIA DE SLOTS

SEMPRE use estes nomes EXATOS em ingles. NUNCA traduza para portugues.

| Intent | Slots Obrigatorios | Opcional |
|--------|-------------------|----------|
| expense | amount, payment_method | description, category, card |
| income | amount | description, source |
| recurring | amount, description, payment_method | day_of_month, periodicity |
| installment | amount, installments | description, card |
| goal | amount, description | deadline |
| query | query_scope | time_range |
| cancel | | cancel_target, target_name |

### Exemplo CORRETO:
{
  "actionType": "expense",
  "confidence": 0.92,
  "slots": {
    "amount": 50,
    "description": "cafe",
    "payment_method": "pix"
  }
}

### ERRADO (NUNCA FACA):
{
  "slots": {
    "valor": 50,           // ❌ use "amount"
    "descricao": "cafe",   // ❌ use "description"  
    "forma_pagamento": "pix" // ❌ use "payment_method"
  }
}
```

---

## PARTE 4: CORRIGIR CONTAS A PAGAR (FRONTEND)

### Problema
A interface permite criar conta com tipo "fixa" ou "variavel", mas a tabela `contas_pagar` espera enum com valores: `cartao`, `fixa`, `variavel`.

O hook `useContasPagar` na linha 98 omite campos obrigatorios.

### Solucao

**Modificar**: `src/pages/ContasPagar.tsx`

Linha 36 - Inicializar tipo corretamente:
```typescript
// ANTES
const [tipo, setTipo] = useState<'fixa' | 'variavel'>('fixa');

// DEPOIS - Incluir 'cartao' como opcao valida
const [tipo, setTipo] = useState<'cartao' | 'fixa' | 'variavel'>('fixa');
```

Linha 131-139 - Adicionar opcao de cartao no Select:
```typescript
<Select value={tipo} onValueChange={(v) => setTipo(v as 'cartao' | 'fixa' | 'variavel')}>
  <SelectTrigger className="bg-slate-800 border-white/10 text-white">
    <SelectValue />
  </SelectTrigger>
  <SelectContent className="bg-slate-800 border-white/10">
    <SelectItem value="fixa">💎 Fixa</SelectItem>
    <SelectItem value="variavel">📊 Variavel</SelectItem>
    <SelectItem value="cartao">💳 Cartao</SelectItem>
  </SelectContent>
</Select>
```

**Modificar**: `src/hooks/useContasPagar.ts`

Linha 10 - Garantir interface com tipo correto (ja esta certo):
```typescript
tipo: 'cartao' | 'fixa' | 'variavel';
```

---

## PARTE 5: PADRONIZAR VISUAL DAS PAGINAS

### Template Base (do Dashboard)

Todas as paginas internas devem seguir:

```tsx
<AppLayout>
  <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
    {/* Background Effects */}
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
    </div>

    {/* Grid Pattern */}
    <div className="fixed inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

    <div className="relative z-10 max-w-[1800px] mx-auto space-y-6">
      {/* Conteudo */}
    </div>
  </div>
</AppLayout>
```

### Paginas a Modificar

| Pagina | Status Atual | Acao |
|--------|-------------|------|
| ContasPagar.tsx | Sem background/gradiente | Aplicar template completo |
| Eventos.tsx | Usa `bg-primary/5` (tema claro) | Mudar para `bg-indigo-600/10` |
| Metas.tsx | Usa `bg-primary/5` (tema claro) | Mudar para `bg-indigo-600/10` |

### ContasPagar.tsx - Modificacoes

Adicionar wrapper com template completo (linhas 89-91):
```tsx
// ANTES
return (
  <AppLayout>
    <div className="space-y-6">

// DEPOIS
return (
  <AppLayout>
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
      </div>
      
      {/* Grid Pattern */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />
      
      <div className="relative z-10 max-w-[1800px] mx-auto space-y-6">
```

### Eventos.tsx e Metas.tsx - Modificacoes

Mudar cores do background effects de `bg-primary/5` para cores fixas:
```tsx
// ANTES (Eventos linha 178-179, Metas linha 248-250)
<div className="absolute ... bg-primary/5 ..." />
<div className="absolute ... bg-accent/5 ..." />

// DEPOIS
<div className="absolute ... bg-indigo-600/10 ..." />
<div className="absolute ... bg-purple-600/10 ..." />
```

Mudar grid pattern de `hsl(var(--primary)/0.03)` para cor fixa:
```tsx
// ANTES
bg-[linear-gradient(hsl(var(--primary)/0.03)_1px,transparent_1px)...]

// DEPOIS
bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)]
```

---

## RESUMO DE ARQUIVOS A MODIFICAR

### Backend (Edge Functions)
1. **NOVO**: `supabase/functions/finax-worker/utils/parseAmount.ts`
2. **MODIFICAR**: `supabase/functions/finax-worker/utils/multiple-expenses.ts`
3. **MODIFICAR**: `supabase/functions/finax-worker/index.ts`
   - Import logger + FinaxError
   - Usar logger em ~10 pontos criticos
   - Salvar ai_decisions apos IA
   - Usar FinaxError no catch
   - Atualizar PROMPT com regras de slots
   - Usar parseBrazilianAmount

### Frontend
4. **MODIFICAR**: `src/pages/ContasPagar.tsx` - Layout + tipo cartao
5. **MODIFICAR**: `src/pages/Eventos.tsx` - Cores fixas
6. **MODIFICAR**: `src/pages/Metas.tsx` - Cores fixas

---

## ORDEM DE EXECUCAO

1. Criar `parseAmount.ts` (novo arquivo)
2. Modificar `multiple-expenses.ts` (corrigir regex + usar parser)
3. Modificar `index.ts` (imports + logger + ai_decisions + FinaxError + prompt)
4. Deploy edge function
5. Modificar `ContasPagar.tsx` (layout + tipos)
6. Modificar `Eventos.tsx` (cores)
7. Modificar `Metas.tsx` (cores)

---

## TESTES DE VALIDACAO

| Cenario | Resultado Esperado |
|---------|-------------------|
| WhatsApp: "8,54 uber" | 1 gasto de R$ 8.54 |
| WhatsApp: "101,31 internet" | 1 gasto de R$ 101.31 |
| WhatsApp: "cafe 20, almoco 35" | 2 gastos separados |
| Site: Criar conta fixa | Sucesso, sem erro |
| Site: Abrir Eventos | Fundo dark consistente |
| Site: Abrir Metas | Fundo dark consistente |
| Site: Abrir ContasPagar | Fundo dark consistente |
| Logs do worker | Formato JSON estruturado |
| Tabela ai_decisions | Registros de decisoes com message_id |
