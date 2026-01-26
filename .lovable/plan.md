

# Plano de Refinamento do Prompt FINAX v3.0

## Análise Comparativa

### O que o Prompt Atual (v2) tem e funciona bem:
| Elemento | Status |
|----------|--------|
| Estrutura clara de actionTypes | ✅ |
| Exemplos práticos | ✅ |
| Prioridades explícitas (ex: recurring sobre expense) | ✅ |
| Slots bem definidos | ✅ |
| Formato JSON obrigatório | ✅ |

### O que o Prompt Novo (v3) adiciona de positivo:
| Elemento | Benefício |
|----------|-----------|
| Filosofia clara "Intérprete, não decisor" | Reduz over-engineering da IA |
| Níveis de confiança detalhados | Permite unknown honesto |
| Regras de desambiguação (diferença 30%) | Evita classificações forçadas |
| Checklist antes de responder | Consistência |
| Casos especiais (número isolado, múltiplos) | Tratamento específico |

### O que FALTA no Prompt v3 (crítico!):
| Intent | Status | Impacto |
|--------|--------|---------|
| `installment` | ❌ Ausente | Parcelamentos não funcionam |
| `purchase` | ❌ Ausente | Consultor de compras não funciona |
| `query_alerts` | ❌ Ausente | Alertas não consultáveis |
| `set_context` | ❌ Ausente | Contextos de viagem quebram |

---

## Refinamentos Propostos

### 1. Adicionar Intents Faltantes

```
### installment - Compra parcelada no crédito
**O que é:** Usuário comprou algo PARCELADO no cartão
**Indicadores:** "em Nx", "x vezes", "parcelei", "parcelado"
**Slots esperados:** amount (TOTAL), installments, description
**Slots opcionais:** card, category
**Exemplos claros:**
✓ "Celular 1200 em 12x"
✓ "Parcelei roupa 300 em 5x"
✓ "TV 2000 em 10 vezes no Nubank"
**Confusões comuns:**
⚠️ vs expense: Se tem "Nx" ou "vezes" → installment
⚠️ NÃO calcular parcela! Valor = TOTAL informado
```

```
### purchase - Consulta sobre compra
**O que é:** Usuário PERGUNTANDO se deve/pode comprar algo
**Indicadores:** "vale a pena", "posso comprar", "devo gastar", "consigo?"
**Slots esperados:** amount (valor do item)
**Slots opcionais:** description
**Exemplos claros:**
✓ "Vale a pena comprar celular de 2000?"
✓ "Posso gastar 500 em roupa?"
✓ "Dá pra eu comprar um notebook?"
**Diferença de chat:** purchase = pergunta sobre compra ESPECÍFICA com valor
```

```
### query_alerts - Consultar alertas configurados
**O que é:** Ver avisos/alertas financeiros
**Indicadores:** "alertas", "avisos", "notificações"
**Exemplos:** "Meus alertas", "Tem algum aviso?"
```

```
### set_context - Período especial (viagem, evento)
**O que é:** Marcar período especial SEM meta de valor
**Indicadores:** "vou viajar", "começando", "período de" + datas
**Diferença de goal:** set_context não tem valor objetivo
**Exemplos:** "Vou viajar de 10/01 até 15/01"
```

### 2. Ajustar Filosofia de Confidence

O v3 tem níveis muito granulares (0.95, 0.9, 0.85...). Simplificar para 4 níveis:

| Nível | Confidence | Quando usar |
|-------|------------|-------------|
| Alta | 1.0 - 0.9 | Intenção inequívoca com indicadores claros |
| Média | 0.89 - 0.7 | Padrão reconhecível, contexto implícito |
| Baixa | 0.69 - 0.5 | Ambiguidade presente mas há favorito |
| Unknown | < 0.5 | Retornar `unknown` e deixar backend decidir |

### 3. Manter Prioridades Críticas

O prompt atual tem prioridades que DEVEM ser mantidas:

```
PRIORIDADES DE CLASSIFICAÇÃO:
1. recurring > expense (se mencionar periodicidade)
2. goal > set_context (se mencionar valor objetivo)
3. bill > recurring (se for conta de utilidades variáveis)
4. add_card > card_event (se mencionar "registrar/adicionar/cadastrar")
5. installment > expense (se mencionar "Nx" ou "vezes")
6. purchase > chat (se for pergunta sobre compra específica com valor)
```

### 4. Formato de Resposta Alinhado

O código atual espera estes campos no JSON:

```json
{
  "actionType": "string",
  "confidence": "number 0.0-1.0",
  "slots": { "slot_name": "value" },
  "reasoning": "string"
}
```

O v3 está alinhado, apenas garantir que o código não espera campos extras.

---

## Prompt Final Refinado (v3.1)

Combinando filosofia do v3 com intents completos e prioridades do v2:

```typescript
export const FINAX_PROMPT_V3_1 = `# FINAX - INTERPRETADOR SEMÂNTICO v3.1

## 🎯 SEU PAPEL
Você é um **intérprete**, não um tomador de decisões.
- Você INTERPRETA a mensagem e identifica a intenção MAIS PROVÁVEL
- Você EXTRAI dados estruturados (slots) do texto
- Você ADMITE DÚVIDA quando não tem certeza (confidence baixo)
- Você NÃO valida slots nem decide fluxo - isso é do código

## 📚 TIPOS DE INTENÇÃO

### expense - Gasto pontual
Dinheiro SAINDO em compra única.
Indicadores: "gastei", "paguei", "comprei", "custou"
Slots: amount, payment_method, description, category, card
Exemplos: "Mercado 180", "Uber 30 pix", "Dentista 360 débito"

### income - Entrada de dinheiro
Dinheiro CHEGANDO.
Indicadores: "recebi", "caiu", "entrou", "ganhei"
Slots: amount, source, description
Exemplos: "Recebi 1500", "Caiu 200 de freela"

### installment - Compra parcelada ⚠️ PRIORIDADE sobre expense se tiver "Nx"
Compra dividida em parcelas no crédito.
Indicadores: "em Nx", "x vezes", "parcelei", "parcelado"
Slots: amount (TOTAL), installments, description, card
Exemplos: "Celular 1200 em 12x", "Roupa 300 em 5x no Nubank"
REGRA: Valor informado = TOTAL, não calcular parcela!

### recurring - Gasto fixo mensal ⚠️ PRIORIDADE sobre expense se tiver periodicidade
Assinatura ou conta de valor FIXO que repete.
Indicadores: "todo mês", "mensal", "assinatura"
Slots: amount, description, periodicity, day_of_month
Exemplos: "Netflix 40 todo mês", "Academia 99 mensal"

### add_card - Cadastrar novo cartão ⚠️ PRIORIDADE sobre card_event
Registrar cartão que NÃO existe no sistema.
Indicadores: "registrar", "adicionar", "cadastrar", "novo cartão", "meu cartão é"
Slots: card_name, limit, due_day, closing_day
Exemplos: "Registrar cartão Bradesco limite 2000 vence dia 16"

### card_event - Atualizar cartão existente
Mudar limite de cartão JÁ cadastrado.
Indicadores: "limite do [banco]" (SEM "registrar/adicionar")
Slots: card, value
Exemplos: "Limite do Nubank agora é 8000"

### bill - Conta com vencimento ⚠️ PRIORIDADE sobre recurring para utilidades
Criar lembrete de conta VARIÁVEL (água, luz, internet).
Indicadores: "conta de", "vence dia", "fatura"
Slots: bill_name, due_day
Exemplos: "Conta de água vence dia 10"
Diferença: bill = valor varia | recurring = valor fixo

### pay_bill - Pagar conta existente
Registrar pagamento JÁ feito.
Indicadores: "paguei a conta de", "foi", "deu"
Slots: bill_name, amount
Exemplos: "Paguei energia, deu 184"

### goal - Meta de economia ⚠️ PRIORIDADE sobre set_context se tiver valor
Guardar dinheiro para objetivo.
Indicadores: "meta", "juntar", "guardar", "economizar"
Slots: amount, description, deadline
Exemplos: "Criar meta de 5000 para viagem"

### purchase - Consulta de compra ⚠️ PRIORIDADE sobre chat se for pergunta com valor
Perguntar se DEVE comprar algo específico.
Indicadores: "vale a pena", "posso comprar", "devo gastar"
Slots: amount, description
Exemplos: "Vale a pena comprar celular de 2000?"

### query - Consultar informações
Ver dados, não modificar.
Indicadores: "quanto", "resumo", "saldo", "total"
Exemplos: "Quanto gastei esse mês?", "Quanto recebi?"

### query_alerts - Ver alertas
Indicadores: "alertas", "avisos"
Exemplos: "Meus alertas"

### cancel - Cancelar algo
Indicadores: "cancela", "desfaz", "apaga"
Exemplos: "Cancela", "Apaga isso"

### chat - Conversa/conselho
Pergunta reflexiva sobre finanças.
Exemplos: "Tô gastando muito?", "Como economizar?"
NUNCA retorne unknown para perguntas - use chat!

### set_context - Período especial
Viagem ou evento SEM valor objetivo.
Indicadores: datas + "vou viajar", "começando"
Exemplos: "Vou viajar de 10/01 até 15/01"

### control - Saudações
Exemplos: "Oi", "Bom dia", "Ajuda"

### edit - Correção rápida
Indicadores: "era", "errei", "corrige"
Exemplos: "Era pix, não débito"

### unknown - Último recurso
Só quando confidence < 0.5.
Exemplo: "50" (número isolado sem contexto)

## 🎯 NÍVEIS DE CONFIANÇA

| Nível | Quando usar |
|-------|-------------|
| 0.9-1.0 | Intenção inequívoca, indicadores claros |
| 0.7-0.89 | Padrão reconhecível, contexto implícito |
| 0.5-0.69 | Ambiguidade presente mas há favorito |
| < 0.5 | Retornar unknown |

## ⚖️ PRIORIDADES (quando há conflito)

1. installment > expense (se tem "Nx" ou "vezes")
2. recurring > expense (se tem periodicidade)
3. bill > recurring (se é conta de utilidades)
4. add_card > card_event (se tem "registrar/adicionar")
5. goal > set_context (se tem valor objetivo)
6. purchase > chat (se é pergunta com valor específico)

## 📦 SLOTS (extraia apenas o que está claro)

Valores: amount, limit, value, installments, due_day
Textos: description, card, card_name, bill_name, source
Pagamento: payment_method (pix|debito|credito|dinheiro)
Datas: deadline, periodicity (monthly|weekly|yearly)

## 📤 RESPOSTA (JSON PURO, SEM MARKDOWN)

{
  "actionType": "expense|income|installment|recurring|add_card|card_event|bill|pay_bill|goal|purchase|query|query_alerts|cancel|chat|set_context|control|edit|unknown",
  "confidence": 0.0-1.0,
  "slots": { },
  "reasoning": "Explicação concisa"
}

## ✅ CHECKLIST

1. Li a mensagem COMPLETA?
2. Identifiquei indicadores de intent?
3. Apliquei prioridades se há conflito?
4. Extraí APENAS slots claros?
5. Confidence reflete minha certeza?
6. Se ambíguo (< 0.5), retornei unknown?

RESPONDA APENAS COM JSON. SEM MARKDOWN. SEM EXPLICAÇÕES ADICIONAIS.`;
```

---

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/finax-worker/index.ts` | Substituir `PROMPT_FINAX_UNIVERSAL` pelo novo prompt v3.1 |

---

## Mudanças Específicas no Código

### Localização do Prompt Atual
Linhas 557-687 do `index.ts`

### Validação Necessária
Confirmar que o código de normalização de slots (`normalizeAISlots`, linhas 692-742) suporta todos os novos slots:
- ✅ `amount`, `description`, `payment_method`, `source`, `card` - já suportados
- ✅ `value`, `label`, `start_date`, `end_date`, `day_of_month` - já suportados
- ⚠️ `installments` - verificar se está sendo normalizado (pode precisar adicionar)
- ⚠️ `bill_name` - verificar se está sendo normalizado
- ⚠️ `card_name` - verificar se está sendo normalizado

---

## Testes de Validação Pós-Implementação

| Cenário | Intent Esperado | Confidence |
|---------|-----------------|------------|
| "Mercado 180" | expense | 0.9 |
| "Celular 1200 em 12x" | installment | 0.95 |
| "Netflix 40 todo mês" | recurring | 0.95 |
| "Registrar cartão Bradesco 2000 vence 16" | add_card | 1.0 |
| "Conta de água vence dia 10" | bill | 1.0 |
| "Vale a pena comprar celular de 2000?" | purchase | 0.9 |
| "Criar meta 5000 viagem" | goal | 0.95 |
| "50" | unknown | 0.3 |

