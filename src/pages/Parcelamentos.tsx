import { AppLayout } from '@/components/layout/AppLayout';
import { useParcelamentos } from '@/hooks/useParcelamentos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, CreditCard, Calendar, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Parcelamentos = () => {
  const { parcelamentos, parcelasAbertas, loading, addParcelamento, deleteParcelamento } = useParcelamentos();
  const [formOpen, setFormOpen] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [valorTotal, setValorTotal] = useState('');
  const [numParcelas, setNumParcelas] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valorTotal || !numParcelas) return;

    const total = parseFloat(valorTotal);
    const parcelas = parseInt(numParcelas);
    const valorParcela = total / parcelas;

    setFormLoading(true);
    try {
      await addParcelamento({
        descricao,
        valor_total: total,
        num_parcelas: parcelas,
        parcela_atual: 1,
        valor_parcela: valorParcela,
        ativa: true,
        usuario_id: null,
      });
      resetForm();
      setFormOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setDescricao('');
    setValorTotal('');
    setNumParcelas('');
  };

  const totalRestante = parcelasAbertas.reduce((acc, p) => {
    const restante = (p.parcelas_restantes || 0) * (p.valor_parcela || 0);
    return acc + restante;
  }, 0);

  const totalMensal = parcelasAbertas.reduce((acc, p) => acc + Number(p.valor_parcela || 0), 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Parcelamentos</h1>
            <p className="text-muted-foreground">
              Mensal: <span className="font-semibold text-foreground">{formatCurrency(totalMensal)}</span>
              {' • '}
              Restante: <span className="font-semibold text-foreground">{formatCurrency(totalRestante)}</span>
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Parcelamento
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-muted" />
                  <div className="flex-1">
                    <div className="h-4 bg-muted rounded w-32 mb-2" />
                    <div className="h-3 bg-muted rounded w-20" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : parcelasAbertas.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <CreditCard className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum parcelamento ativo.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {parcelasAbertas.map((parcela, index) => {
              const progresso = parcela.num_parcelas 
                ? ((parcela.parcela_atual || 1) / parcela.num_parcelas) * 100 
                : 0;

              return (
                <div
                  key={parcela.id}
                  className={cn(
                    "glass rounded-xl p-4 animate-slide-up",
                    !parcela.ativa && "opacity-50"
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-primary/10">
                      <TrendingDown className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {parcela.descricao || 'Parcelamento'}
                      </p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {parcela.parcela_atual}/{parcela.num_parcelas} parcelas
                        </span>
                        <span>•</span>
                        <span>{parcela.parcelas_restantes} restantes</span>
                      </div>
                      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${progresso}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-bold text-lg">
                          {formatCurrency(parcela.valor_parcela)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Total: {formatCurrency(parcela.valor_total)}
                        </p>
                      </div>
                      {parcela.id && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir parcelamento?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteParcelamento(parcela.id!)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Parcelamento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                placeholder="Ex: TV, Geladeira..."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Valor Total (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Número de Parcelas</Label>
              <Input
                type="number"
                min="1"
                placeholder="Ex: 12"
                value={numParcelas}
                onChange={(e) => setNumParcelas(e.target.value)}
                required
              />
            </div>

            {valorTotal && numParcelas && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <span className="text-muted-foreground">Valor da parcela: </span>
                <span className="font-medium">
                  {formatCurrency(parseFloat(valorTotal) / parseInt(numParcelas))}
                </span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={formLoading}>
              {formLoading ? 'Salvando...' : 'Adicionar Parcelamento'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Parcelamentos;
