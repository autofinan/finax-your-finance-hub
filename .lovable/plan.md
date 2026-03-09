
# Plano: Ajustes de Padrões, Pagamento e Freedom Insight

## Resumo das Mudanças

### 1. Padrão de Aprendizado - Só após 3x
**Problema:** Hoje o sistema aprende padrão na primeira ocorrência (confidence 0.5).  
**Solução:** Só criar padrão quando `usage_count >= 3` com mesmo produto + pagamento.

**Arquivos:**
- `supabase/functions/finax-worker/memory/patterns.ts`

**Lógica:**
```
learnMerchantPattern():
  Se NÃO existe padrão:
    → Criar com confidence=0.3, usage_count=1 (NÃO APLICA ainda)
  Se existe:
    Se mesma categoria + mesmo pagamento:
      → usage_count++, confidence += 0.15
      → Só marca "ativo" quando usage_count >= 3 E confidence >= 0.7
    Se divergente:
      → Ignorar (não sobrescrever)
```

**Critério para aplicar:** `confidence >= 0.7` (já existe) + `usage_count >= 3` (novo)

---

### 2. Débito → Dinheiro (Botões e Display)
**Problema:** "Pix" e "Débito" são praticamente iguais hoje. Usuário quer trocar "Débito" por "Dinheiro" nos botões.  
**Regra:** Se usuário digitar "débito", aceitar mas salvar/exibir como "dinheiro".

**Arquivos:**
- `types.ts:181-185` - Trocar botão
- `ui/slot-prompts.ts:94-98` - Trocar botão
- `PAYMENT_ALIASES` - Mapear `débito → dinheiro`

**Mudança:**
```typescript
// ANTES
buttons: [
  { id: "pay_pix", title: "📱 Pix" },
  { id: "pay_debito", title: "💳 Débito" },
  { id: "pay_credito", title: "💳 Crédito" }
]

// DEPOIS
buttons: [
  { id: "pay_pix", title: "📱 Pix" },
  { id: "pay_dinheiro", title: "💵 Dinheiro" },
  { id: "pay_credito", title: "💳 Crédito" }
]
```

**PAYMENT_ALIASES:**
```typescript
"débito": "dinheiro",  // ← Mapear débito → dinheiro
"debito": "dinheiro",
```

---

### 3. Freedom Insight - Só para Pro
**Problema:** Mensagem "Esse gasto = +1 dia no caminho pra liberdade" aparece em TODOS os gastos, confusa.  
**Solução:** Restringir ao plano Pro.

**Arquivos:**
- `intents/expense-inline.ts:382-386` - Verificar plano antes de chamar

**Lógica:**
```typescript
// 🏁 FREEDOM MICRO-INSIGHT (PRO ONLY)
const { data: usuario } = await supabase
  .from("usuarios")
  .select("plano, trial_fim")
  .eq("id", userId)
  .single();

const isPro = usuario?.plano === "pro" || 
  (usuario?.plano === "trial" && new Date(usuario.trial_fim) > new Date());

if (isPro) {
  const freedomInsight = await getFreedomMicroInsight(userId, valor);
  if (freedomInsight) {
    message += freedomInsight;
  }
}
```

---

## Arquivos a Editar

| Arquivo | Mudança |
|---------|---------|
| `memory/patterns.ts` | Só aplicar padrão após 3 usos |
| `decision/types.ts` | Botão débito → dinheiro |
| `ui/slot-prompts.ts` | Botão débito → dinheiro |
| `intents/expense-inline.ts` | Freedom insight só Pro |

---

## Testes Sugeridos

1. **Padrão 3x:** Registre "Açaí 10 pix" 3 vezes → só na 3ª deve aplicar padrão
2. **Botões:** Ao registrar gasto, deve aparecer [Pix] [Dinheiro] [Crédito]
3. **Débito → Dinheiro:** Envie "gastei 50 débito" → deve salvar como "dinheiro"
4. **Freedom Pro:** Usuário Básico não vê "dias de liberdade", Pro vê

