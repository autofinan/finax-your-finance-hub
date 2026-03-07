

# Plan: Fix 8 Critical Finax Issues

## Root Cause Analysis

The core problem is that the system has too many layers that work independently instead of cooperatively. Here's what's broken and the unified fixes:

---

## Issue 1: Description saves entire message instead of extracting the relevant part

**Problem**: When user says "Cara, hoje cedo eu fui tomar café da manhã e gastei", the full sentence is saved as `description`.

**Root Cause**: The AI prompt (`PROMPT_FINAX_UNIVERSAL`) doesn't instruct the AI to extract a **clean, short description** from the message. The `description` slot just gets whatever the AI returns, and the fast-track `cleanDescription` only removes payment terms, not conversational filler.

**Fix**: 
- Update `PROMPT_FINAX_UNIVERSAL` in `ai-engine.ts` to add a rule under the `slots` section: "description MUST be a short label (1-4 words) of WHAT was purchased/spent on, NOT the user's full sentence. Examples: 'Café da manhã' (not 'Cara, hoje cedo eu fui tomar café da manhã e gastei')."
- Add a `cleanDescriptionFromAI()` function in `expense-inline.ts` that truncates/cleans the description before DB insert — strip conversational words, cap at ~50 chars, extract the noun phrase.

## Issue 2: Payment correction after 2min triggers duplicate detection instead of edit

**Problem**: User says "Desculpa, errei, foi no Pix" within 2 min, but the POST-CLASSIFICATION INTERCEPTOR (line ~2448) checks `forma_pagamento === "outro" || "unknown"` — if the original was saved as `"credito"`, the interceptor doesn't fire, and the AI classifies the message as a new expense, triggering duplicate detection.

**Fix**:
- Expand the interceptor condition (line ~2461): also trigger if the user's message contains correction words ("errei", "desculpa", "era no", "foi no") AND mentions a payment method, regardless of what the last transaction's method was.
- Add correction keywords detection before the `lastTx.forma_pagamento` check.

## Issue 3: Audio with multiple expenses only registers the first

**Problem**: Audio is transcribed to text (`conteudoProcessado`), then goes through `detectMultipleExpenses()`. But if the transcription doesn't have clear delimiters (commas, "e"), the multi-expense detector fails and falls through to single-expense flow.

**Fix**:
- Enhance `detectMultipleExpenses()` in `multiple-expenses.ts` to handle natural speech patterns from audio:
  - Add pattern: `[item] por/paguei R$ X [item] paguei R$ Y` 
  - Add pattern: `[item] R$ X [item] R$ Y` (sequential items with values)
  - Pre-process: normalize `r$` markers and extract value-description pairs more aggressively

## Issue 4: Multiple expenses parsed with wrong descriptions (truncated/swapped)

**Problem**: "casquinha por R$5, entrada do cinema R$25, pipoca R$30, coca R$10, Uber R$20" → Descriptions come out as "A entrada", "A pipoca", "Peguei uma", "Do meu" — articles and verbs instead of actual items.

**Fix**:
- Rewrite the description extraction in `detectMultipleExpenses()` to be smarter about natural language:
  - Instead of naively splitting by separators, use a regex approach that finds `[description words] [R$|por|paguei] [number]` pairs
  - The `invalidWords` filter (line 154) needs expansion: add articles ("a", "o", "do", "da", "meu", "minha"), verbs ("paguei", "comprei", "peguei")
  - After extraction, if description starts with article/preposition, try to find the noun that follows

## Issue 5: Payment method mentioned in message but still asks "Como pagou?"

**Problem**: "meu Uber paguei 5 no débito" → AI and fast-track both extract `payment_method: "debito"`, but the expense handler still asks. 

**Root Cause**: The fast-track's CASE 5 (embedded number, line ~267) extracts `amount` and `payment_method` from the full text, but the description pattern (CASE 3) matches first and puts "débito" in the description instead of as payment. Then `cleanDescription` removes "débito" from description but the slot was already set wrong.

**Fix**:
- In `PROMPT_FINAX_UNIVERSAL`, add explicit instruction: "If the user mentions a payment method (pix, débito, crédito, dinheiro) in their message, ALWAYS extract it into `payment_method` slot."
- In the expense handler in `index.ts`, before creating action with `pending_slot: "payment_method"`, re-check if `payment_method` is already in slots from the AI classification.

## Issue 6: Income not extracting amount from natural language ("Me mandaram 200")

**Problem**: AI classifies as `income` with confidence 0.9, but slots are empty `{}`. The fast-track doesn't trigger because "Me mandaram" matches `NON_EXPENSE_PREFIXES` (it starts with "me mande/me envia").

**Root Cause**: `NON_EXPENSE_PREFIXES` contains "me mande" but the text "Me mandaram" starts with "me mandaram" which is a substring match on "me mand". Actually looking closer, the normalizer strips accents and the prefix check does `.includes()` not `.startsWith()` — "me mand" would match "me mandaram".

Wait, actually the NON_EXPENSE_PREFIXES don't contain "me mandaram" but they contain "me mande" and "me envia" — and the check is `normalized.startsWith(prefix) || normalized.includes(prefix)`. "me mandaram" doesn't start with "me mande" and doesn't include "me mande". So the fast-track should proceed... Let me re-check. The issue is that the fast-track's CASE 5 (embedded number) extracts `amount: 200` but the AI returns empty slots.

**Fix**:
- The merge logic should already handle this (FT slots as base). The log shows `🔗 [MERGE] FT: {} | AI: {} | FINAL: {}` which means NEITHER extracted slots. The fast-track returned `hasStructure: false` because "me mandaram 200" doesn't match any of the fast-track patterns cleanly (it has 3 words before the number). Actually CASE 3 should match: `(.+?)\s+(\d+)` → desc="Me mandaram", amount=200.

But looking at the NON_EXPENSE_PREFIXES check — "manda" is in the list! And "me mandaram" includes "manda". So it short-circuits to `needsAI: true, slots: {}` with confidence 0.

**Fix**: Remove "manda" and "me mande" from `NON_EXPENSE_PREFIXES` — these block income detection too aggressively. Instead, add more specific prefixes like "manda o relatorio", "manda um resumo". Or better: only block if followed by non-numeric continuation.

## Issue 7: Chat mode broken — leaks from income action context

**Problem**: User says "Cara, tô gastando muito" → system responds "Não entendi o valor 🤔". This happens because there's a stale income action still pending.

**Root Cause**: After issue 6, the income action was created with `pending_slot: "amount"`. When the user then writes a chat message, the FSM context handler (line ~2055) intercepts it because `activeAction.pending_slot` exists, and tries to extract a number from "tô gastando muito" — fails, and sends the retry message.

**Fix**: This is already partially fixed by the TTL (15 min). But the user might send the chat within 15 min. The real fix is in the FSM `handleActiveContext`:
- Before attempting to fill a slot, check if the message is clearly a **different intent** (chat/query). If the message has NO numbers AND is >5 words AND doesn't contain slot-relevant keywords, treat it as a subject change.

## Issue 8: Chat responses not using existing categorized data

**Problem**: Finax says "seria útil ter uma categorização dos seus gastos" when the user already has categorized data.

**Fix**:
- In `generateChatResponse()` (`chat-handler.ts`), the `financialSummary` parameter needs to include category breakdowns. Currently the caller in `index.ts` passes a summary but may not include per-category data.
- Update the chat handler caller in `index.ts` to query and include `categorias` from `fn_relatorio_mensal` in the financial summary string passed to the AI.

---

## Implementation Order

1. **ai-engine.ts** — Update `PROMPT_FINAX_UNIVERSAL` with description extraction rules and payment method extraction
2. **classifier.ts** — Fix `NON_EXPENSE_PREFIXES` to not block income patterns like "me mandaram"
3. **multiple-expenses.ts** — Rewrite description extraction for natural language patterns
4. **index.ts** — Fix payment correction interceptor (issue 2), enhance chat summary data (issue 8), re-check payment_method before asking (issue 5)
5. **expense-inline.ts** — Add `cleanDescriptionFromAI()` that cleans verbose descriptions
6. **fsm/context-handler.ts** — Add subject-change detection for chat messages when slot is pending (issue 7)
7. **chat-handler.ts** — No change needed (the fix is in the caller)
8. Deploy `finax-worker`

## Files Modified

- `supabase/functions/finax-worker/decision/ai-engine.ts`
- `supabase/functions/finax-worker/decision/classifier.ts`
- `supabase/functions/finax-worker/utils/multiple-expenses.ts`
- `supabase/functions/finax-worker/intents/expense-inline.ts`
- `supabase/functions/finax-worker/fsm/context-handler.ts`
- `supabase/functions/finax-worker/index.ts`

