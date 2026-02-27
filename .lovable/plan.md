

# Plano: Corrigir Build Errors + Melhorar Landing Page + Avaliar Plano Acelerador

## 1. Corrigir Build Errors (URGENTE)

### 1A: `conteudoProcessado` usado antes da declaracao (`index.ts`)

O bloco de onboarding pos-done (linha 657) usa `conteudoProcessado` que so e declarado na linha 1928. 

**Fix:** Substituir `conteudoProcessado` por `payload.messageText` nas linhas 657, 661 e 666, ja que nesse ponto do codigo o texto ainda nao foi processado.

### 1B: `result.items` possivelmente undefined (`media.ts`)

Linhas 222-227 acessam `result.items` sem verificar se existe.

**Fix:** Adicionar optional chaining: `result.items?.length` e `result.items?.[0]`.

---

## 2. Landing Page - Correcoes

### 2A: Botao "Entrar" no header

Adicionar botao "Entrar" na navbar que linka para `/auth`. Ao lado do "Comecar gratis", com estilo ghost.

### 2B: Botoes de compra direta nos planos

Os botoes de plano atualmente direcionam ao WhatsApp. Adicionar opcao de compra direta:
- Basico: link para `/auth?plan=basico` ou checkout direto
- Pro: manter "Testar 14 dias gratis" via WhatsApp + adicionar "Assinar direto" como botao secundario
- Ambos os cards terao 2 CTAs: trial gratis (WhatsApp) + assinar agora (checkout/auth)

### 2C: Mockup com rotacao de exemplos

O ChatMockup ja roda 5 conversas diferentes automaticamente. O problema e que em telas menores o mockup pode ficar muito grande. Verificar e ajustar padding/sizing para mobile.

### 2D: Responsividade mobile

Problemas identificados:
- Antes vs Depois: grid 3 colunas (com seta no meio) nao colapsa em mobile
- Stats bar: 4 colunas pode ficar apertado em 320px
- Navbar: botao "Comecar gratis" pode cortar em telas pequenas
- Plans grid: ja tem media query para 1 coluna mas verificar padding

**Fix:** Adicionar media queries para:
- `@media(max-width:900px)`: Antes/Depois vira 1 coluna (sem seta), navbar botao menor
- `@media(max-width:540px)`: Stats vira 2x2, padding reduzido geral

---

## 3. Status do Plano Acelerador - O Que Podemos Fazer AGORA

### Implementavel nesta sessao:

**A) Gating no WhatsApp (Alta prioridade)**
Ja temos o "Modo Vendedor" para trial expirado. O que falta e diferenciar respostas Basico vs Pro no bot. Por exemplo:
- Basico pede insights preditivos -> teaser "Isso e Pro, quer upgrade?"
- Basico pede simulador -> teaser

Isso e uma verificacao simples no `index.ts`: antes de executar intents Pro, checar `user.plano`.

**B) Trial End Summary (Baixa prioridade, mas rapido)**
Quando trial expira, o modo vendedor ja envia resumo. Podemos melhorar com dados reais (gastos registrados, cartoes, metas).

### NAO implementavel agora (requer mais sessoes):

- Simulador de Quitacao: logica complexa de juros compostos, 3 cenarios, UI dedicada
- Insights Preditivos: requer analise de dados historicos, ML basico
- Consultor IA Semanal: edge function agendada + prompt complexo
- Detector de Padroes / Radar de Anomalias: analise estatistica
- Projecoes Financeiras: graficos + calculos de projecao
- Metas de Frequencia: novo tipo de meta no banco

---

## Secao Tecnica: Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `supabase/functions/finax-worker/index.ts` | Fix `conteudoProcessado` -> `payload.messageText` (linhas 657, 661, 666) |
| `supabase/functions/finax-worker/utils/media.ts` | Fix optional chaining em `result.items` (linhas 222-227) |
| `src/pages/Landing.tsx` | Botao Entrar, botoes compra, responsividade mobile, media queries |

## Ordem de Execucao

1. Fix build errors (index.ts + media.ts) - deploy
2. Landing page (header + botoes + responsividade)
3. Gating no WhatsApp (se der tempo)

