
# Plano: Memoria Conversacional Completa (10 mensagens + Contexto Proativo)

## Resumo

Corrigir o bug principal (historico buscado mas ignorado pela IA) e implementar memoria conversacional robusta que funciona para TODAS as situacoes, nao apenas contas.

## O Bug Central

O sistema tem DOIS pontos onde a IA e chamada:

1. **`index.ts` linha 980** - `callAIForDecision()` recebe `history` como parametro mas **IGNORA** na linha 1005
2. **`decision/engine.ts` linha 464** - `callAIForDecision()` da engine **NAO recebe** historico nenhum

O fluxo principal passa por `decisionEngine()` no index.ts (linha 1102), que chama `callAIForDecision` do index.ts na linha 1289 e **passa o history** (linha 1297). O problema e que dentro da funcao (linha 1005), o history nao e injetado no prompt.

## Mudancas

### 1. index.ts - Injetar historico no prompt da IA (BUG PRINCIPAL)

**Linha 1005**: Adicionar history ao prompt enviado para a IA

```text
ANTES:
  messages: [
    { role: "system", content: PROMPT_FINAX_UNIVERSAL + "\n\n" + contextInfo },
    { role: "user", content: message }
  ]

DEPOIS:
  messages: [
    { role: "system", content: PROMPT_FINAX_UNIVERSAL + "\n\n" + contextInfo +
      (history ? "\n\n--- HISTORICO RECENTE ---\n" + history + "\n---\n\n" +
      "REGRA: Use o historico para entender contexto. " +
      "Se o Bot enviou lembrete de conta (agua, luz, gas, internet, aluguel) " +
      "e o usuario confirma pagamento, classifique como pay_bill, " +
      "categoria moradia, NAO alimentacao." : "")
    },
    { role: "user", content: message }
  ]
```

### 2. index.ts - Aumentar janela de historico para 10 mensagens

**Linha 4336**: Mudar `.limit(3)` para `.limit(10)`

**Linha 4338**: Melhorar formato para incluir mais contexto do bot

```text
ANTES:
  .limit(3);
  const historicoFormatado = historico?.map(h =>
    `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 80)}...`
  ).reverse().join("\n") || "";

DEPOIS:
  .limit(10);
  const historicoFormatado = historico?.map(h =>
    `User: ${h.user_message}\nBot: ${h.ai_response?.slice(0, 200) || "(sem resposta)"}`
  ).reverse().join("\n---\n") || "";
```

### 3. index.ts - Tambem injetar historico na engine.ts (via contexto)

A `decisionEngine` em `decision/engine.ts` tambem chama sua propria `callAIForDecision` (linha 274) que **NAO recebe historico**. Precisamos passar o historico para la tambem.

Na engine.ts, a funcao `decisionEngine` (linha 201) recebe `input: DecisionInput` que ja tem campo `context`. Vamos adicionar `history` ao context que e passado pela index.ts.

Mas o fluxo principal no index.ts usa sua propria `decisionEngine` (linha 1102), nao a da engine.ts. Entao a correcao da linha 1005 ja cobre o caso principal. A engine.ts so e usada como fallback/import.

### 4. conversation-context.ts - Aumentar TTL para 24h

**Linha 20**: Mudar `CONTEXT_TTL_MINUTES = 30` para `CONTEXT_TTL_MINUTES = 1440` (24 horas)

Isso garante que se o usuario demorar para responder (ex: recebe lembrete as 9h, responde as 18h), o contexto ainda existe.

### 5. lembrar-contas/index.ts - Atualizar conversation_context ao enviar lembrete

Apos enviar WhatsApp com sucesso (depois da linha 153), fazer upsert no `conversation_context` com:
- `current_topic: "pay_bill"`
- `last_intent: "pay_bill"`
- `expires_at: agora + 24h`

### 6. ciclo-fatura/index.ts - Atualizar conversation_context ao alertar fatura

Apos enviar alerta de vencimento (apos linhas 252 e 271), fazer upsert no `conversation_context` com:
- `current_topic: "pay_bill"`
- `last_intent: "pay_bill"`
- `last_card_name: cartao.nome`
- `expires_at: agora + 24h`

### 7. processar-recorrentes/index.ts - Atualizar conversation_context ao notificar

Apos enviar notificacao (apos linha 178), fazer upsert no `conversation_context` com:
- `current_topic: "recurring"`
- `last_intent: "recurring_processed"`
- `expires_at: agora + 1h`

### 8. PROMPT_FINAX_UNIVERSAL - Adicionar regra de contexto

Adicionar ao final do prompt (antes da linha 882 que fecha o template literal) uma secao sobre uso do historico:

```text
## REGRA CRITICA: HISTORICO DA CONVERSA

Quando o HISTORICO mostra que voce (Bot) enviou:
- Lembrete de conta (agua, luz, gas, internet, aluguel, condominio, energia)
- Alerta de fatura de cartao
- Confirmacao de recorrente

E o usuario responde com valor ou confirma pagamento:
- Classifique como pay_bill (NAO expense)
- Categoria: moradia (para contas de consumo)
- "agua", "luz", "gas", "internet" = conta de consumo, NUNCA alimentacao
- Use o historico para desambiguar

Quando o HISTORICO mostra conversa sobre um topico especifico:
- Mantenha o contexto da conversa
- NAO mude de assunto a menos que o usuario mude explicitamente
```

## Secao Tecnica - Arquivos Afetados

```text
EDITAR:
  supabase/functions/finax-worker/index.ts
    L1005: Injetar history no prompt (FIX PRINCIPAL)
    L4336: limit(3) → limit(10)
    L4338: Melhorar formato historico (200 chars, separador ---)
    L~880: Adicionar regra de contexto no PROMPT_FINAX_UNIVERSAL

  supabase/functions/finax-worker/utils/conversation-context.ts
    L20: CONTEXT_TTL_MINUTES = 30 → 1440

  supabase/functions/lembrar-contas/index.ts
    Apos L153: Upsert conversation_context (pay_bill)

  supabase/functions/ciclo-fatura/index.ts
    Apos L252 e L271: Upsert conversation_context (pay_bill + card_name)

  supabase/functions/processar-recorrentes/index.ts
    Apos L178: Upsert conversation_context (recurring)

DEPLOY:
  finax-worker, lembrar-contas, ciclo-fatura, processar-recorrentes
```

## Resultado Esperado

```text
Bot: "Sua conta agua vence hoje!"
  → Salva context: {topic: "pay_bill", expires: +24h}
  → Salva no historico_conversas

User: "Ja paguei a agua, foi 55"
  → Busca ultimas 10 msgs do historico
  → IA ve: "Bot disse conta agua vence + user diz paguei 55"
  → IA classifica: pay_bill, categoria moradia
  → Bot: "Paguei conta de agua R$ 55.00. Como pagou?"

User: "cafe 8"
  → Historico mostra conversa sobre conta, mas nova mensagem e claramente gasto
  → IA classifica: expense, cafe, R$ 8.00
  → Contexto funciona para TUDO, nao so contas
```
