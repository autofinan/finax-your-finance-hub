
# Plano de Correcoes e Melhorias Criticas - Finax

## Resumo Executivo

Este plano resolve **2 bugs criticos no WhatsApp** e adiciona **6 melhorias no site** solicitadas pelo usuario.

---

## PARTE 1: BUGS CRITICOS WHATSAPP

### BUG 1: Handlers de Botoes (create_bill_yes/no)

**Problema:** Os handlers verificam `activeAction?.intent === "bill"`, mas a action criada usa `intent === "bill_suggestion"`.

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Linhas:** 2927 e 2946

**Correcao:**
- Linha 2927: Mudar condicao para aceitar tanto `"bill"` quanto `"bill_suggestion"`
- Linha 2946: Mesma correcao

**Codigo atual:**
```typescript
if (payload.buttonReplyId === "create_bill_yes" && activeAction?.intent === "bill") {
```

**Codigo corrigido:**
```typescript
if (payload.buttonReplyId === "create_bill_yes" && 
    (activeAction?.intent === "bill" || activeAction?.intent === "bill_suggestion")) {
```

---

### BUG 2: Sistema de Contexto Dinamico (Queries)

**Problema:** O switch/case atual (linhas 4474-4493) so cobre periodos fixos (today, yesterday, week, month). Precisamos usar o sistema dinamico que ja existe em `utils/dynamic-query.ts`.

**Solucao em 3 partes:**

#### Parte 2.1: Substituir switch/case por executeDynamicQuery

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Linhas:** 4465-4496

**Deletar:** Todo o bloco do switch case de timeRange

**Substituir por:**
```typescript
case "expenses":
  console.log(`📊 [QUERY] Roteando para: EXPENSES`);
  
  // ✅ Usar sistema dinamico que a IA ja calculou as datas
  const { executeDynamicQuery } = await import("./utils/dynamic-query.ts");
  
  const queryParams = {
    userId,
    query_scope: "expenses" as const,
    start_date: decision.slots.start_date as string | undefined,
    end_date: decision.slots.end_date as string | undefined,
    time_range: timeRange,
    category: decision.slots.category as string | undefined,
    card_id: decision.slots.card_id as string | undefined
  };
  
  console.log(`📊 [QUERY] Params dinamicos:`, queryParams);
  
  const expensesResult = await executeDynamicQuery(queryParams);
  await sendMessage(payload.phoneNumber, expensesResult, payload.messageSource);
  return;
```

#### Parte 2.2: Remover override contextual (redundante)

**Arquivo:** `supabase/functions/finax-worker/index.ts`
**Linhas:** 3229-3259

**Deletar:** O bloco `temporalRefs` que faz override deterministico.

**Motivo:** Agora a IA resolve tudo via prompt com contexto. O override era necessario antes, mas agora e redundante e pode causar conflitos.

#### Parte 2.3: Garantir que o contexto conversacional esta sendo passado para a IA

**Verificar:** `decision/engine.ts` ja tem as regras de query (linhas 540-600).

O prompt ja instrui a IA a:
- Retornar `start_date` e `end_date` em ISO format
- Usar `time_range` apenas para formatacao
- Interpretar referencias como "e ontem?" usando o contexto passado

---

## PARTE 2: MELHORIAS NO SITE

### Melhoria 1: Filtro por Datas nas Transacoes

**Arquivo:** `src/pages/Transacoes.tsx`

**Adicionar:**
- Estado para `dataInicio` e `dataFim`
- DatePicker (ou inputs date) no filtro
- Logica de filtragem por periodo

**Componente de filtro de data:**
```typescript
// Novos estados
const [dataInicio, setDataInicio] = useState<string>('');
const [dataFim, setDataFim] = useState<string>('');

// Na filtragem
const matchData = !dataInicio || !dataFim || 
  (new Date(t.data) >= new Date(dataInicio) && new Date(t.data) <= new Date(dataFim));
```

**UI:** Adicionar dois inputs de data ao lado dos filtros existentes.

---

### Melhoria 2: Insights de Metas (Valor por semana/mes)

**Arquivo:** `src/hooks/useMetas.ts`

**Adicionar funcao:**
```typescript
function calcularValorMensal(meta: Meta): number | null {
  if (!meta.deadline) return null;
  const diasRestantes = calcularDiasRestantes(meta.deadline);
  if (!diasRestantes || diasRestantes <= 0) return null;
  const valorFaltante = calcularValorFaltante(meta);
  const mesesRestantes = Math.ceil(diasRestantes / 30);
  return valorFaltante / Math.max(mesesRestantes, 1);
}

function calcularValorSemanal(meta: Meta): number | null {
  if (!meta.deadline) return null;
  const diasRestantes = calcularDiasRestantes(meta.deadline);
  if (!diasRestantes || diasRestantes <= 0) return null;
  const valorFaltante = calcularValorFaltante(meta);
  const semanasRestantes = Math.ceil(diasRestantes / 7);
  return valorFaltante / Math.max(semanasRestantes, 1);
}
```

**Arquivo:** `src/pages/Metas.tsx`

**Adicionar no MetaCard:**
- Exibir "Guardar R$ X/mes" ou "R$ X/semana" abaixo da barra de progresso
- Mostrar insight ao criar meta no toast de sucesso

---

### Melhoria 3: Edicao de Cartoes (Site)

**Arquivo:** `src/pages/Cartoes.tsx`

**Adicionar:**
- Dialog de edicao (reutilizar estrutura do form de criacao)
- Botao de editar em cada card (icone de lapis)
- Estados para `editingCard` e `editFormOpen`

**Campos editaveis:**
- Nome
- Limite Total
- Dia Fechamento
- Dia Vencimento

**Hook:** `useCartoes.ts` ja tem `updateCartao` implementado.

---

### Melhoria 4: Edicao de Gastos Recorrentes (Site)

**Arquivo:** `src/pages/Recorrentes.tsx`

**Adicionar:**
- Dialog de edicao similar ao de criacao
- Botao de editar em cada item
- Estados para `editingGasto` e `editOpen`

**Campos editaveis:**
- Descricao
- Valor
- Dia do Mes
- Categoria

**Hook:** `useGastosRecorrentes.ts` ja tem `updateGasto` implementado.

---

### Melhoria 5: Edicao de Cartoes (WhatsApp)

**Arquivo:** `supabase/functions/finax-worker/index.ts`

**Adicionar handler para intent "card_edit":**
```typescript
if (decision.actionType === "card_edit") {
  const cardName = decision.slots.card_name;
  const field = decision.slots.field; // "limite", "vencimento", "fechamento"
  const newValue = decision.slots.value;
  
  // Buscar cartao
  const { data: card } = await supabase
    .from("cartoes_credito")
    .select("id, nome")
    .eq("usuario_id", userId)
    .ilike("nome", `%${cardName}%`)
    .single();
  
  if (!card) {
    await sendMessage(phone, `Nao encontrei o cartao "${cardName}"`, source);
    return;
  }
  
  // Atualizar campo
  const updates = {};
  if (field === "limite") updates.limite_total = newValue;
  if (field === "vencimento") updates.dia_vencimento = newValue;
  if (field === "fechamento") updates.dia_fechamento = newValue;
  
  await supabase.from("cartoes_credito").update(updates).eq("id", card.id);
  await sendMessage(phone, `Cartao ${card.nome} atualizado!`, source);
}
```

**Arquivo:** `decision/engine.ts`

**Adicionar intent "card_edit" ao prompt:**
- Detectar: "mudar limite do nubank para 5000"
- Detectar: "alterar vencimento do itau para dia 20"

---

### Melhoria 6: Corrigir Registro de Gastos Recorrentes e Contas a Pagar (Site)

**Investigacao necessaria:**
O usuario reportou que nao consegue registrar no site. Preciso verificar:

1. Se o `usuarioId` esta sendo resolvido corretamente
2. Se ha erros de RLS (Row Level Security)
3. Se os hooks estao funcionando

**Possivel causa:** O usuario pode nao ter vinculos corretos entre `auth.uid` e `usuarios.id`.

**Arquivo:** `src/hooks/useUsuarioId.ts`

**Verificar:** Se o hook esta retornando o `usuarioId` corretamente para usuarios autenticados.

**Correcao provavel:** Garantir que apos autenticacao, o sistema busca o usuario correto na tabela `usuarios` baseado no telefone ou email.

---

## ORDEM DE EXECUCAO

| Prioridade | Tarefa | Arquivo |
|------------|--------|---------|
| 1 | Corrigir handlers create_bill | index.ts |
| 2 | Implementar executeDynamicQuery | index.ts |
| 3 | Remover override contextual | index.ts |
| 4 | Adicionar filtro de datas | Transacoes.tsx |
| 5 | Insights de metas | useMetas.ts + Metas.tsx |
| 6 | Edicao de cartoes (site) | Cartoes.tsx |
| 7 | Edicao de recorrentes (site) | Recorrentes.tsx |
| 8 | Edicao de cartoes (WhatsApp) | index.ts + engine.ts |
| 9 | Debug registro site | useUsuarioId.ts |

---

## TESTES DE VALIDACAO

### WhatsApp

| Cenario | Resultado Esperado |
|---------|-------------------|
| "Quanto gastei hoje?" -> "E ontem?" | Mostra gastos de ONTEM |
| "Quanto gastei nos ultimos 5 dias?" | Mostra periodo customizado |
| "Paguei 100 internet" -> [Pix] -> [Sim, criar] | Pergunta dia do vencimento |

### Site

| Cenario | Resultado Esperado |
|---------|-------------------|
| Filtrar transacoes por data | Mostra apenas periodo selecionado |
| Criar meta com prazo | Mostra insight "Guardar R$ X/mes" |
| Clicar editar cartao | Abre dialog com campos preenchidos |
| Editar gasto recorrente | Atualiza valor/dia corretamente |

---

## DETALHAMENTO TECNICO

### Secao 1: Arquivo index.ts - Linhas a Modificar

```
Linha 2927: Adicionar || activeAction?.intent === "bill_suggestion"
Linha 2946: Adicionar || activeAction?.intent === "bill_suggestion"
Linhas 3229-3259: DELETAR bloco temporalRefs
Linhas 4465-4496: SUBSTITUIR switch por executeDynamicQuery
```

### Secao 2: Novo Componente DateRangeFilter

```typescript
// Para src/pages/Transacoes.tsx
interface DateRangeFilterProps {
  dataInicio: string;
  dataFim: string;
  onDataInicioChange: (date: string) => void;
  onDataFimChange: (date: string) => void;
}

const DateRangeFilter = ({ dataInicio, dataFim, onDataInicioChange, onDataFimChange }) => (
  <div className="flex gap-2">
    <Input
      type="date"
      value={dataInicio}
      onChange={(e) => onDataInicioChange(e.target.value)}
      className="w-40 bg-slate-800/50 border-slate-700 text-white"
    />
    <span className="text-slate-500 self-center">ate</span>
    <Input
      type="date"
      value={dataFim}
      onChange={(e) => onDataFimChange(e.target.value)}
      className="w-40 bg-slate-800/50 border-slate-700 text-white"
    />
  </div>
);
```

### Secao 3: Insights de Metas

```typescript
// Adicionar ao useMetas.ts
function calcularInsightMeta(meta: Meta): string | null {
  const diasRestantes = calcularDiasRestantes(meta.deadline);
  if (!diasRestantes || diasRestantes <= 0) return null;
  
  const valorFaltante = calcularValorFaltante(meta);
  if (valorFaltante <= 0) return null;
  
  const valorSemanal = valorFaltante / Math.ceil(diasRestantes / 7);
  const valorMensal = valorFaltante / Math.ceil(diasRestantes / 30);
  
  if (diasRestantes <= 30) {
    return `Guardar ${formatCurrency(valorSemanal)}/semana`;
  }
  return `Guardar ${formatCurrency(valorMensal)}/mes`;
}
```

### Secao 4: Dialog de Edicao de Cartao

```typescript
// Adicionar ao Cartoes.tsx
const [editOpen, setEditOpen] = useState(false);
const [editingCard, setEditingCard] = useState<CartaoCredito | null>(null);

// Form fields pre-populados
useEffect(() => {
  if (editingCard) {
    setNome(editingCard.nome);
    setLimiteTotal(editingCard.limite_total?.toString() || '');
    setDiaFechamento(editingCard.dia_fechamento?.toString() || '');
    setDiaVencimento(editingCard.dia_vencimento?.toString() || '');
  }
}, [editingCard]);

const handleEdit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!editingCard) return;
  
  await updateCartao(editingCard.id, {
    nome,
    limite_total: limiteTotal ? parseFloat(limiteTotal) : null,
    dia_fechamento: diaFechamento ? parseInt(diaFechamento) : null,
    dia_vencimento: diaVencimento ? parseInt(diaVencimento) : null,
  });
  
  setEditOpen(false);
  setEditingCard(null);
};
```
