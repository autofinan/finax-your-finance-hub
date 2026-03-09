import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useDividas, type Divida } from '@/hooks/useDividas';
import { usePlanoStatus } from '@/hooks/usePlanoStatus';
import { UpgradeTeaser } from '@/components/UpgradeTeaser';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit2, TrendingDown, DollarSign, AlertTriangle, CheckCircle } from 'lucide-react';
import { SimuladorQuitacao } from '@/components/dividas/SimuladorQuitacao';

function DividaForm({ onSubmit, initial, tipos }: {
  onSubmit: (data: any) => void;
  initial?: Partial<Divida>;
  tipos: readonly { value: string; label: string }[];
}) {
  const [form, setForm] = useState({
    tipo: initial?.tipo || 'cartao',
    nome: initial?.nome || '',
    saldo_devedor: initial?.saldo_devedor?.toString() || '',
    taxa_juros: initial?.taxa_juros?.toString() || '',
    valor_minimo: initial?.valor_minimo?.toString() || '',
    data_vencimento: initial?.data_vencimento || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      tipo: form.tipo,
      nome: form.nome,
      saldo_devedor: parseFloat(form.saldo_devedor) || 0,
      taxa_juros: form.taxa_juros ? parseFloat(form.taxa_juros) : null,
      valor_minimo: form.valor_minimo ? parseFloat(form.valor_minimo) : null,
      data_vencimento: form.data_vencimento || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-muted-foreground">Tipo</label>
        <Select value={form.tipo} onValueChange={(v) => setForm(p => ({ ...p, tipo: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {tipos.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm font-medium text-muted-foreground">Nome</label>
        <Input value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))} placeholder="Ex: Nubank, Empréstimo Banco X" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-muted-foreground">Saldo Devedor (R$)</label>
          <Input type="number" step="0.01" value={form.saldo_devedor} onChange={e => setForm(p => ({ ...p, saldo_devedor: e.target.value }))} required />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Juros Mensal (%)</label>
          <Input type="number" step="0.01" value={form.taxa_juros} onChange={e => setForm(p => ({ ...p, taxa_juros: e.target.value }))} placeholder="Ex: 2.5" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-muted-foreground">Pagamento Mínimo (R$)</label>
          <Input type="number" step="0.01" value={form.valor_minimo} onChange={e => setForm(p => ({ ...p, valor_minimo: e.target.value }))} />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Vencimento</label>
          <Input type="date" value={form.data_vencimento} onChange={e => setForm(p => ({ ...p, data_vencimento: e.target.value }))} />
        </div>
      </div>
      <Button type="submit" className="w-full">{initial ? 'Atualizar' : 'Registrar Dívida'}</Button>
    </form>
  );
}

const TIPO_ICONS: Record<string, string> = {
  cartao: '💳',
  emprestimo: '🏦',
  financiamento: '🚗',
  cheque_especial: '⚠️',
};

const TIPO_LABELS: Record<string, string> = {
  cartao: 'Cartão',
  emprestimo: 'Empréstimo',
  financiamento: 'Financiamento',
  cheque_especial: 'Cheque Especial',
};

// Cálculo simples de prazo com pagamento mínimo (Básico)
function calcularPrazoMinimo(saldo: number, valorMinimo: number | null, taxaJuros: number | null): string | null {
  if (!valorMinimo || valorMinimo <= 0 || saldo <= 0) return null;
  if (!taxaJuros || taxaJuros <= 0) {
    const meses = Math.ceil(saldo / valorMinimo);
    return `~${meses} meses pagando o mínimo`;
  }
  const taxa = taxaJuros / 100;
  if (valorMinimo <= saldo * taxa) return 'Pagamento mínimo não cobre os juros!';
  let s = saldo;
  let meses = 0;
  while (s > 0 && meses < 600) {
    s = s * (1 + taxa) - valorMinimo;
    meses++;
  }
  return `~${meses} meses pagando o mínimo`;
}

export default function Dividas() {
  const { dividas, dividasAtivas, saldoTotal, minimoTotal, isLoading, addDivida, updateDivida, deleteDivida, TIPOS_DIVIDA } = useDividas();
  const { showUpgradeTeaser, canAccessFeature } = usePlanoStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDivida, setEditingDivida] = useState<Divida | null>(null);

  const handleAdd = (data: any) => {
    addDivida.mutate(data, { onSuccess: () => setDialogOpen(false) });
  };

  const handleEdit = (data: any) => {
    if (!editingDivida) return;
    updateDivida.mutate({ id: editingDivida.id, ...data }, { onSuccess: () => setEditingDivida(null) });
  };

  const handleToggleAtiva = (divida: Divida) => {
    updateDivida.mutate({ id: divida.id, ativa: !divida.ativa });
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        <div className="relative z-10 max-w-[1800px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-slate-500 font-medium mb-1">Gestão de dívidas</p>
            <h1 className="text-4xl font-bold text-white">Dívidas <span className="text-indigo-400">📉</span></h1>
            <p className="text-sm text-slate-400 mt-1">Gerencie suas dívidas e acelere sua liberdade financeira</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <button className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-500 px-6 py-3 rounded-xl font-bold text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:scale-[1.02]">
                <Plus className="w-5 h-5" />Nova Dívida
              </button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-slate-700">
              <DialogHeader><DialogTitle className="text-white">Registrar Dívida</DialogTitle></DialogHeader>
              <DividaForm onSubmit={handleAdd} tipos={TIPOS_DIVIDA} />
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-4 hover:border-red-500/40 transition-all">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10">
                <TrendingDown className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Saldo Total Devedor</p>
                <p className="text-xl font-bold text-red-400">{formatCurrency(saldoTotal)}</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-4 hover:border-amber-500/40 transition-all">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10">
                <DollarSign className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Mínimo Mensal</p>
                <p className="text-xl font-bold text-amber-400">{formatCurrency(minimoTotal)}</p>
              </div>
            </div>
          </div>
          <Card className="bg-card border-border">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/10">
                  <AlertTriangle className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Dívidas Ativas</p>
                  <p className="text-xl font-black text-primary">{dividasAtivas.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Simulador de Quitação */}
        {dividasAtivas.length > 0 && (
          canAccessFeature('debt_simulator') ? (
            <SimuladorQuitacao dividasAtivas={dividasAtivas} />
          ) : showUpgradeTeaser('debt_simulator') ? (
            <UpgradeTeaser
              feature="debt_simulator"
              title="Simulador de Quitação"
              preview={
                <div className="space-y-4 p-6">
                  <div className="bg-muted p-4 rounded-xl">
                    <h4 className="font-bold text-foreground">Cenário Atual</h4>
                    <p className="text-sm text-muted-foreground">12 meses • R$ 1.400 em juros</p>
                  </div>
                  <div className="bg-muted p-4 rounded-xl">
                    <h4 className="font-bold text-foreground">Cenário Otimizado</h4>
                    <p className="text-sm text-muted-foreground">8 meses • R$ 890 em juros</p>
                  </div>
                </div>
              }
            />
          ) : null
        )}

        {/* Dividas List */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Carregando...</div>
        ) : dividas.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
              <TrendingDown className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">Nenhuma dívida registrada</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Registre suas dívidas para acompanhar e acelerar sua quitação</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {dividas.map(d => {
              const prazo = calcularPrazoMinimo(d.saldo_devedor, d.valor_minimo, d.taxa_juros);
              return (
                <Card key={d.id} className={`bg-card border-border ${!d.ativa ? 'opacity-50' : ''}`}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-2xl">{TIPO_ICONS[d.tipo] || '📄'}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-foreground">{d.nome}</h3>
                            <Badge variant={d.ativa ? 'default' : 'secondary'} className="text-[10px]">
                              {d.ativa ? TIPO_LABELS[d.tipo] || d.tipo : 'Quitada'}
                            </Badge>
                          </div>
                          <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                            <span>Saldo: <strong className="text-destructive">{formatCurrency(d.saldo_devedor)}</strong></span>
                            {d.taxa_juros && <span>Juros: {d.taxa_juros}%/mês</span>}
                            {d.valor_minimo && <span>Mínimo: {formatCurrency(d.valor_minimo)}</span>}
                          </div>
                          {/* Projeção simples para Básico, completa para Pro */}
                          {d.ativa && prazo && (
                            <p className="text-xs text-amber-400 mt-1">⏱️ {prazo}</p>
                          )}
                          {/* Teaser de projeção de liberdade */}
                          {d.ativa && showUpgradeTeaser('debt_freedom_projection') && d.taxa_juros && (
                            <p className="text-xs text-primary/60 mt-1 italic">
                              🔒 Veja em quantos dias pode ficar livre — Pro
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleToggleAtiva(d)} title={d.ativa ? 'Marcar como quitada' : 'Reativar'}>
                          <CheckCircle className={`w-4 h-4 ${d.ativa ? 'text-muted-foreground' : 'text-emerald-400'}`} />
                        </Button>
                        <Dialog open={editingDivida?.id === d.id} onOpenChange={(open) => !open && setEditingDivida(null)}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setEditingDivida(d)}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Editar Dívida</DialogTitle></DialogHeader>
                            <DividaForm onSubmit={handleEdit} initial={d} tipos={TIPOS_DIVIDA} />
                          </DialogContent>
                        </Dialog>
                        <Button variant="ghost" size="icon" onClick={() => deleteDivida.mutate(d.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
