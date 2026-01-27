📌 OBJETIVO ÚNICO

Unificar WhatsApp + Site usando UM ÚNICO IDENTIFICADOR:
usuarios.id (UUID).

Telefone NÃO É identidade.
LocalStorage NÃO É fonte de verdade.

🔒 REGRA DE IDENTIDADE (OBRIGATÓRIA)

usuarios.id é o único identificador canônico

Telefone só serve para:

login

OTP

Frontend NUNCA resolve usuário manualmente

Frontend SEMPRE usa AuthContext.user.id

Todas as queries Supabase DEVEM filtrar por:

.eq("usuario_id", userId)

🧠 FRONTEND — CORREÇÕES OBRIGATÓRIAS
✅ 1. useUsuarioId.ts (SUBSTITUIR COMPLETAMENTE)
import { useAuth } from "@/contexts/AuthContext";

export function useUsuarioId() {
  const { user, loading } = useAuth();

  return {
    usuarioId: user?.id ?? null,
    usuario: user ?? null,
    loading,
    isAuthenticated: !!user,
  };
}


❌ Proibido:

localStorage direto

chave "usuario"

telefone

✅ 2. TODAS as páginas do dashboard

Devem usar somente:

const { usuarioId, loading } = useUsuarioId();


Se !usuarioId && !loading → redirecionar para login.

✅ 3. TODOS os hooks de dados (useTransacoes, useCartoes, etc.)

ANTES de qualquer query:

if (!usuarioId) return;


INSERÇÕES obrigatórias:

usuario_id: usuarioId

🧠 BACKEND (FINAX-WORKER) — REGRA DE OURO
✅ 4. Isolamento absoluto de domínio
assert(job.user_id, "user_id obrigatório");

query.eq("usuario_id", job.user_id);


❌ Proibido:

buscar dados de outro usuário

mencionar outro usuário

inferir dados

✅ 5. Respostas vazias NÃO são erro

Se não houver registros:

responder “nenhum dado encontrado”

NUNCA lançar exceção

NUNCA enviar “Ops algo deu errado”

🧪 CHECKLIST DE VALIDAÇÃO (FINAL)

 Dashboard carrega dados após login

 Cartões mostram vazio se não houver

 Inserir transação pelo site funciona

 WhatsApp e site retornam os MESMOS dados

 Nenhuma query sem usuario_id

🚫 PROIBIÇÕES ABSOLUTAS

❌ Reanalisar arquitetura

❌ Criar novo sistema de login

❌ Inferir usuário por telefone no frontend

❌ Ler localStorage manualmente fora do AuthContext

### 2.2. Melhorar Tratamento de Erros no finax-worker

**Problema**: Qualquer erro vira "Ops, algo deu errado"

**Solução**: Erros específicos com mensagens úteis

```typescript
// Linha 4665 - Em vez de mensagem genérica
case "cards":
  const cards = await queryCardLimits(userId);
  // Se retorna mensagem de "não tem cartões", é ok, não é erro
  await sendMessage(phoneNumber, cards, payload.messageSource);
  return;
```

O código já está correto! A função `queryCardLimits` retorna "Você não tem cartões cadastrados 💳" quando não há cartões. O erro está em outro lugar - precisa investigar os logs.


