
# Plano: Correcao de 3 Bugs + Analise do Fluxo de Cartao

---

## Bug #1: Nao consegue apagar gastos recorrentes no site

**Causa raiz:** A politica RLS de DELETE na tabela `gastos_recorrentes` usa `usuario_id = auth.uid()`. O sistema de autenticacao cria um usuario Supabase Auth com o MESMO UUID da tabela `usuarios`, e o frontend chama `supabase.auth.setSession()` com os tokens recebidos.

**Problema provavel:** A sessao Supabase Auth pode ter expirado (token JWT expira apos ~1h). Quando expira, `auth.uid()` retorna NULL e o DELETE falha silenciosamente (RLS bloqueia, retorna 0 rows deleted, sem erro).

O hook `useGastosRecorrentes` nao verifica se o delete realmente funcionou - ele apenas remove o item do estado local otimisticamente.

**Fix (src/hooks/useGastosRecorrentes.ts):**
- Apos o delete, verificar se o registro ainda existe
- Se ainda existir, tentar refresh da sessao Supabase Auth e tentar novamente
- Mostrar erro claro se falhar

**Fix (src/contexts/AuthContext.tsx):**
- Adicionar listener para `onAuthStateChange` para auto-refresh de tokens
- Garantir que a sessao Supabase Auth esteja ativa antes de operacoes criticas

**Alternativa mais robusta:** Adicionar fallback no hook - se o delete via RLS falhar, chamar uma edge function que usa service_role_key para deletar.

---

## Bug #2: Logo do Finax no painel interno

**Causa raiz:** O Sidebar (desktop) e o AppLayout (mobile drawer) usam um div com gradiente e a letra "F" em vez da imagem real do logo Finax. O arquivo `src/assets/finax-logo-transparent.png` existe e ja e usado na pagina de Auth.

**Fix (src/components/layout/Sidebar.tsx):**
- Substituir o div com "F" pela imagem `finax-logo-transparent.png` (linhas 55-57)

**Fix (src/components/layout/AppLayout.tsx):**
- Substituir o div com "F" pela imagem `finax-logo-transparent.png` (linhas 120-122)

---

## Bug #3: Verificar cancelamento de recorrentes via WhatsApp

O fluxo de cancelamento via WhatsApp ja existe no `index.ts` (linha 5720+). Quando o usuario diz "cancelar aluguel", o sistema:
1. Busca recorrentes por nome
2. Mostra botoes/lista para selecao
3. Ao selecionar, desativa (`ativo: false`)

O fluxo ja funciona. Nao e necessario correcao aqui.

---

## Analise do Fluxo de Cartao de Credito

### O que ja esta correto:

1. **Gasto pontual:** `credit-flow.ts` resolve cartao, busca/cria fatura, deduz limite, atualiza fatura. OK.
2. **Parcelamento:** `installment.ts` deduz limite TOTAL imediatamente, cria parcelas em faturas futuras. OK.
3. **Pagamento de fatura:** `restoreCardLimitOnPayment` restaura limite ao pagar. OK.
4. **Fechamento automatico:** `ciclo-fatura/index.ts` CRON fecha faturas no dia correto, cria proxima fatura. OK.

### Problemas identificados:

**P1: Timezone em `getOrCreateInvoice` (credit-flow.ts linhas 254-264)**
- Usa `new Date()` que retorna UTC, nao Brasilia
- Se sao 22h BRT (01h UTC dia seguinte), o dia calculado esta errado
- Isso pode colocar uma compra na fatura errada

**Fix:** Usar data de Brasilia (UTC-3) para calcular mes/ano da fatura:
```text
// Antes: const hoje = new Date();
// Depois: calcular diaAtual com offset -3
```

**P2: Timezone em `getOrCreateFutureInvoice` (installment.ts linhas 349-365)**
- Mesmo problema de timezone

**P3: Pagamento parcial nao implementado**
O `restoreCardLimitOnPayment` sempre seta `status: "paga"`. Se o usuario pagar metade:
- O limite deve subir proporcionalmente
- O status deve permanecer "fechada" (nao "paga")
- Deve mostrar saldo restante

**Fix (credit-flow.ts `restoreCardLimitOnPayment`):**
- Verificar se `valorPago >= fatura.valor_total` para decidir status
- Se parcial: status = "fechada", `valor_pago += valorPago`
- Se total: status = "paga"

**P4: Compra apos fechamento no mesmo dia**
O `getOrCreateInvoice` usa `hoje.getDate() >= diaFechamento`. Compras no dia do fechamento VÃO para a proxima fatura (correto se considerarmos que o fechamento acontece no inicio do dia). Isso esta OK para o padrao simplificado.

---

## Secao Tecnica - Arquivos e Mudancas

```text
src/hooks/useGastosRecorrentes.ts
  - deleteGasto: adicionar verificacao pos-delete
  - Se RLS bloqueou, tentar refresh da sessao e retry
  - Alternativa: chamar edge function com service_role

src/contexts/AuthContext.tsx
  - Adicionar supabase.auth.onAuthStateChange listener
  - Auto-refresh de sessao quando token expira

src/components/layout/Sidebar.tsx
  - Linha 55-57: substituir div "F" pela imagem finax-logo-transparent.png
  - import finaxLogo from "@/assets/finax-logo-transparent.png"

src/components/layout/AppLayout.tsx
  - Linha 120-122: substituir div "F" pela imagem finax-logo-transparent.png

supabase/functions/finax-worker/intents/credit-flow.ts
  - getOrCreateInvoice (L254): usar timezone Brasilia
  - restoreCardLimitOnPayment (L347-382): suportar pagamento parcial
    - Se valorPago < valor_total: status = "fechada", valor_pago += valorPago
    - Se valorPago >= valor_total: status = "paga"

supabase/functions/finax-worker/intents/installment.ts
  - getOrCreateFutureInvoice (L349): usar timezone Brasilia

supabase/functions/ciclo-fatura/index.ts
  - Ja usa UTC, mas como o CRON roda as 8h BRT (11h UTC), o dia
    esta correto na maioria dos casos. Mesmo assim, corrigir para
    usar Brasilia explicitamente.

DEPLOY: finax-worker, ciclo-fatura
```

## Ordem de Execucao

```text
1. Sidebar.tsx + AppLayout.tsx - Logo do Finax
2. AuthContext.tsx - Auto-refresh de sessao Supabase Auth
3. useGastosRecorrentes.ts - Verificacao pos-delete + retry
4. credit-flow.ts - Timezone + pagamento parcial
5. installment.ts - Timezone
6. ciclo-fatura - Timezone
7. Deploy edge functions
```

## Resultado Esperado

```text
Deletar recorrente no site → funciona (com retry se sessao expirou)
Logo Finax → aparece corretamente no sidebar e mobile drawer
Compra 23h BRT → vai para fatura correta (Brasilia, nao UTC)
"paguei 500 da fatura" (total 1200) → parcial, limite +500, status "fechada"
```
