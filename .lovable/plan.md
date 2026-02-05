
# Plano de Correcao Completo - Finax

## Resumo dos Problemas Identificados

Apos analise detalhada dos logs e codigo, identifiquei os seguintes problemas:

### 1. DATAS RELATIVAS NAO FUNCIONANDO (Prioridade Alta)

**Evidencia do problema:**
- Logs mostram: `uber 5,62 segunda passada` registrou em `2026-02-05 14:20:54` (hoje) em vez de `2026-02-03` (segunda passada)
- O `parseRelativeDate` detectou corretamente: `📅 [DATE] Ontem: 04/02/2026`
- MAS o `transaction_date` no banco esta com hora UTC: `2026-02-02T11:20:39.000Z`

**Causa raiz:**
A funcao `parseRelativeDate` retorna um Date correto, mas quando fazemos `toISOString()` ele converte para UTC, adicionando 3h. O `getBrasiliaISO` depois tenta ajustar mas o dano ja foi feito.

**Solucao:**
Refatorar para usar `getBrasiliaISO(transactionDate)` diretamente em vez de `toISOString()`.

---

### 2. HORARIO 3H A FRENTE (Timezone)

**Evidencia:**
- Mensagem enviada as `10:20` (horario de Brasilia)
- Registrado como `14:20` (UTC)
- Diferenca de exatamente 3 horas = offset UTC-3

**Causa raiz:**
A funcao `getBrasiliaDate()` cria um Date com valores de Brasilia, mas JavaScript trata como local timezone do servidor (UTC). Quando fazemos `toISOString()`, ele nao aplica offset.

**Solucao:**
1. Modificar `getBrasiliaISO()` para retornar string com offset `-03:00`
2. Garantir que `dateISO` seja sempre `YYYY-MM-DDTHH:MM:SS-03:00`
3. Usar `getBrasiliaISO()` em todos os lugares onde salvamos data no banco

---

### 3. INSIGHTS NAO FUNCIONANDO

**Status atual:**
- Edge function `analyze-spending` existe e detecta alertas
- Alertas sao salvos em `spending_alerts` com `status: detected`
- NAO existe funcao para ENVIAR os alertas via WhatsApp
- Nenhum cron job configurado para insights

**O que falta:**
1. Criar edge function `finax-insights` para enviar alertas pendentes
2. Configurar cron job para executar diariamente as 19h

---

### 4. PROMPTS NO BANCO

**Status atual:**
- Tabela `ai_prompts` existe com estrutura correta
- Funcao `getActivePrompt()` implementada em `governance/config.ts`
- Prompt hardcoded em `engine.ts` (linhas 500-680)
- NAO ha nenhum prompt salvo na tabela

**O que falta:**
1. Inserir o prompt atual na tabela `ai_prompts`
2. Modificar `engine.ts` para usar `getActivePrompt()` com fallback

---

### 5. MENU MOBILE (Parcialmente Corrigido)

**Status atual:**
- Bottom Nav implementado com 4 itens + Menu
- Drawer (Sheet) implementado com hierarquia correta
- Fecha ao clicar em link

**Ajustes faltantes:**
1. Safe area inset bottom para iPhones com notch
2. Fechar drawer automaticamente ao navegar (useEffect com location)

---

## Arquivos a Modificar

### Backend (Edge Functions)

```text
1. supabase/functions/finax-worker/utils/date-helpers.ts
   - Corrigir getBrasiliaISO() para retornar ISO com offset -03:00
   - Garantir que parseRelativeDate retorne data correta

2. supabase/functions/finax-worker/index.ts
   - Usar getBrasiliaISO(transactionDate) corretamente
   - Passar transaction_date como string ISO com offset

3. supabase/functions/finax-worker/intents/expense.ts
   - Validar que dateISO esta sendo usado corretamente

4. supabase/functions/finax-worker/decision/engine.ts
   - Integrar getActivePrompt() com fallback para prompt hardcoded

5. NOVO: supabase/functions/finax-insights/index.ts
   - Buscar alertas com status="detected"
   - Enviar via WhatsApp API
   - Atualizar status para "sent"
```

### Frontend

```text
6. src/components/layout/MobileNav.tsx
   - Adicionar safe-area-inset-bottom padding
   - Melhorar transicoes

7. src/components/layout/AppLayout.tsx
   - Adicionar useEffect para fechar drawer ao mudar rota
```

### Banco de Dados (Migracao)

```text
8. Migrar prompt atual para tabela ai_prompts
   - name: "finax_classifier"
   - version: 1
   - active: true
   - status: "active"
   - content: [prompt completo do engine.ts]

9. Criar cron job para finax-insights
   - schedule: "0 19 * * *" (19h diariamente)
```

---

## Detalhes Tecnicos

### Correcao do Timezone (date-helpers.ts)

O problema esta na conversao para ISO. A funcao atual:

```typescript
// PROBLEMA: toISOString() converte para UTC
transactionDate.toISOString()
// "2026-02-05T14:20:00.000Z" (UTC, 3h a frente)
```

Solucao:

```typescript
// getBrasiliaISO() deve retornar com offset
export function getBrasiliaISO(date?: Date | string): { dateISO: string; timeString: string } {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : getBrasiliaDate();
  
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const hour = parts.find(p => p.type === 'hour')?.value;
  const minute = parts.find(p => p.type === 'minute')?.value;
  const second = parts.find(p => p.type === 'second')?.value;
  
  // Sempre retorna com offset de Brasilia
  const dateISO = `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`;
  const timeString = `${hour}:${minute}`;
  
  return { dateISO, timeString };
}
```

### Correcao no index.ts (linha 3672)

```typescript
// ANTES (errado):
slots.transaction_date = transactionDate.toISOString();

// DEPOIS (correto):
const { dateISO } = getBrasiliaISO(transactionDate);
slots.transaction_date = dateISO;
```

### Edge Function finax-insights

Estrutura:

```typescript
// 1. Buscar alertas pendentes
const { data: alerts } = await supabase
  .from("spending_alerts")
  .select("*, usuarios!inner(telefone)")
  .eq("status", "detected")
  .order("utility_score", { ascending: false })
  .limit(50);

// 2. Para cada alerta, enviar WhatsApp
for (const alert of alerts) {
  await sendWhatsAppMessage(alert.usuarios.telefone, alert.message);
  
  // 3. Atualizar status
  await supabase.from("spending_alerts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", alert.id);
}
```

### Integracao getActivePrompt no engine.ts

```typescript
import { getActivePrompt } from "../governance/config.ts";

// No callAIForDecision():
const FALLBACK_PROMPT = `Voce e Finax...`; // prompt atual hardcoded

const systemPrompt = await getActivePrompt("finax_classifier", FALLBACK_PROMPT);
```

---

## Ordem de Implementacao

```text
Fase 1: Correcoes Criticas (Hoje)
├── 1.1 Corrigir getBrasiliaISO() para retornar offset -03:00
├── 1.2 Corrigir index.ts para usar getBrasiliaISO(transactionDate)
├── 1.3 Deploy finax-worker
└── 1.4 Testar via WhatsApp: "uber 10 ontem"

Fase 2: Insights Proativos
├── 2.1 Criar finax-insights/index.ts
├── 2.2 Adicionar ao config.toml
├── 2.3 Deploy e teste manual
└── 2.4 Criar cron job (19h diario)

Fase 3: Prompts no Banco
├── 3.1 Inserir prompt atual na tabela ai_prompts
├── 3.2 Modificar engine.ts para usar getActivePrompt()
└── 3.3 Deploy e validar

Fase 4: Ajustes Mobile
├── 4.1 Adicionar safe-area-inset-bottom no MobileNav
└── 4.2 useEffect para fechar drawer ao navegar
```

---

## Testes de Validacao

### Teste de Data Relativa

```text
Mensagem: "uber 10 ontem"
Esperado:
- Data salva: 2026-02-04 (ontem)
- Horario: horario do envio em Brasilia
- Resposta: "📅 04/02/2026 às XX:XX"
```

### Teste de Insights

```text
1. Trigger: Executar analyze-spending manualmente
2. Verificar: spending_alerts com status="detected"
3. Executar: finax-insights
4. Verificar: WhatsApp recebido + status="sent"
```

---

## Estimativa de Esforco

| Tarefa | Complexidade | Arquivos |
|--------|--------------|----------|
| Corrigir timezone | Media | 2 |
| Criar finax-insights | Media | 1 novo |
| Integrar prompts | Baixa | 1 + migracao |
| Ajustes mobile | Baixa | 2 |
