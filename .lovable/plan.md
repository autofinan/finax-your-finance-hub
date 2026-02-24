
# Plano: Corrigir Bug "undefined" no WhatsApp + Status do Plano Acelerador

## Diagnostico do Bug "Qual o undefined?"

O problema ocorre quando o usuario envia uma imagem com 2 gastos (ex: 2 corridas Uber). O OCR do Gemini extrai apenas 1 valor. Apos registrar o primeiro gasto, quando o usuario diz "Registra tambem 5,95 Uber", o sistema cria uma action de expense com amount=5.95 e description="Uber", mas a logica de slot prompts tem um caminho onde `getNextMissingSlot` ou `getSlotPrompt` recebe `undefined` como parametro, gerando "Qual o undefined?".

**Causa raiz:** No `index.ts` linhas 1977-1991, quando `contextResult.updatedSlots` e processado e `getNextMissingSlot` retorna `null` (todos os slots preenchidos), o codigo continua para a linha 1983 que chama `getSlotPrompt(nextMissing)` - mas `nextMissing` pode ser `null`. Alem disso, o fluxo de expense inline nao esta gerando botoes de payment_method corretamente apos a segunda despesa, porque a action ja foi fechada e o novo registro "5,95 Uber" cai no decision engine que cria uma action mas o slot prompt para `payment_method` nao esta sendo enviado com botoes.

**Segunda causa:** Na mensagem "Registra tambem 5,95 Uber", o decision engine classifica como expense com amount=5.95 e description="Uber", mas `payment_method` esta faltando. O sistema deveria perguntar "Como voce pagou?" com botoes, mas em vez disso o fluxo passa por um caminho onde o slot name vira `undefined`.

---

## Correcao 1: Proteger getSlotPrompt contra undefined/null

**Arquivo:** `supabase/functions/finax-worker/fsm/context-handler.ts`

Na funcao `getSlotPrompt` (linha 546), adicionar guard:

```typescript
export function getSlotPrompt(slotType: string): { text: string; buttons?: ... } {
  if (!slotType) {
    return { text: "Como voce pagou?", buttons: [/* payment buttons */] };
  }
  // ... resto
}
```

Na funcao `getNextMissingSlot` (linha 529), garantir que valida slots de payment_method com a mesma logica do `INVALID_PAYMENT_VALUES`:

```typescript
export function getNextMissingSlot(intent: string, slots: ExtractedSlots): string | null {
  // ... existing code
  for (const required of requirements.required) {
    const value = slots[required];
    if (!value) return required;
    // Rejeitar payment_method invalidos
    if (required === "payment_method" && typeof value === "string" && 
        ["unknown","outro","desconhecido","none","null","undefined"].includes(value.toLowerCase())) {
      return required;
    }
  }
  return null;
}
```

---

## Correcao 2: Proteger index.ts contra nextMissing null

**Arquivo:** `supabase/functions/finax-worker/index.ts`

Nas linhas 1981-1991, adicionar guard para `nextMissing` nulo:

```typescript
if (nextMissing) {
  // ... send prompt (existing code)
} else {
  // Todos os slots preenchidos mas readyToExecute era false
  // Executar direto como fallback
  console.log("[FSM] nextMissing null, executando direto");
  // ... execute
}
```

---

## Correcao 3: OCR Multi-Expense - Melhorar prompt do Gemini

**Arquivo:** `supabase/functions/finax-worker/utils/media.ts`

Alterar o prompt do Gemini Vision para detectar MULTIPLOS itens na imagem. O `OCRResult` precisa suportar um array de resultados:

```typescript
export interface OCRResult {
  valor?: number;
  descricao?: string;
  forma_pagamento?: string;
  data?: string;
  confidence: number;
  raw?: string;
  items?: Array<{ valor: number; descricao: string }>; // NOVO: multiplos itens
}
```

Alterar o prompt para:
- "Se houver MULTIPLOS itens/transacoes na imagem, retorne um campo 'items' com array"
- Formato: `{ items: [{valor: 3.52, descricao: "Moto IFMT"}, {valor: 5.96, descricao: "Moto Paris"}] }`

---

## Correcao 4: Fluxo de imagem com multiplos itens

**Arquivo:** `supabase/functions/finax-worker/index.ts`

No bloco de processamento de imagem (linhas 333-433), apos o OCR:
- Se `ocrResult.items` tem 2+ itens, usar o mesmo fluxo de multi_expense (botoes "Separado" / "Tudo junto")
- Se tem apenas 1 item, manter fluxo atual

```text
Fluxo:
1. OCR detecta 2 itens na imagem
2. Enviar: "Vi 2 gastos na imagem: 1. Moto IFMT R$3,52  2. Moto Paris R$5,96 - Como quer registrar?"
3. Botoes: [Separado] [Tudo junto]
4. Reutilizar fluxo multi_expense existente
```

---

## Status do Plano Acelerador de Liberdade Financeira

### Ja Implementado:
1. Tabela `dividas` + CRUD + pagina web de dividas
2. Classificacao automatica `expense_type` (essencial_fixo, flexivel, etc.)
3. Widget "Essenciais vs Flexiveis" no Dashboard
4. TransactionList mostrando descricao + badge expense_type
5. Feature Gating completo (`usePlanoStatus.ts` com FEATURE_MATRIX)
6. Componente `UpgradeTeaser.tsx` reutilizavel
7. Gating aplicado em Dividas, Cartoes, Metas
8. Landing Page Pricing atualizado (R$19,90 / R$29,90)
9. PlanoCard atualizado no Dashboard
10. CheckoutModal com precos corretos
11. Debt Handler no WhatsApp (registrar/listar dividas)
12. Interceptor de correcao de pagamento

### Falta Implementar (Proximas Fases):
1. **Simulador de Quitacao (Pro)** - 3 cenarios de pagamento com calculo de juros e "dias de liberdade"
2. **Insights Preditivos (Pro)** - "Se voce reduzir delivery em 40%, quita 47 dias antes"
3. **Consultor IA Semanal (Pro)** - Analise automatica com plano de acao
4. **Detector de Padroes (Pro)** - Identificar gastos recorrentes nao registrados
5. **Radar de Anomalias (Pro)** - Alertar gastos fora do padrao
6. **Projecoes Financeiras (Pro)** - Onde voce estara em 3, 6, 12 meses
7. **Metas de Frequencia (Pro)** - "Maximo 8 deliveries/mes"
8. **Progresso Acumulado** - "Desde que entrou no Finax, voce economizou X"
9. **Trial End Summary** - Tela mostrando o que o usuario conquistou nos 14 dias
10. **Gating no WhatsApp** - Diferenciar respostas Basico vs Pro no bot
11. **Relatorios diferenciados** - Basico: resumo simples / Pro: insights com impacto em dias

---

## Secao Tecnica: Arquivos Modificados

| Arquivo | Mudanca |
|---|---|
| `supabase/functions/finax-worker/fsm/context-handler.ts` | Guard contra slot undefined + validacao payment_method |
| `supabase/functions/finax-worker/index.ts` | Guard nextMissing null + fluxo multi-expense para imagens |
| `supabase/functions/finax-worker/utils/media.ts` | OCRResult com items[] + prompt multi-item |

## Ordem de Execucao

1. Corrigir bug "Qual o undefined?" (correcoes 1 e 2 - urgente)
2. Melhorar OCR para multiplos itens (correcoes 3 e 4)
3. Deploy e teste do finax-worker
