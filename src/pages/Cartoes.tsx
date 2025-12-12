import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useCartoes } from '@/hooks/useCartoes';
import { useFaturas } from '@/hooks/useFaturas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Plus, Trash2, CreditCard, Calendar, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';

const Cartoes = () => {
  const { cartoes, loading, addCartao, deleteCartao } = useCartoes();
  const { faturasEmAberto } = useFaturas();
  const [formOpen, setFormOpen] = useState(false);
  const [nome, setNome] = useState('');
  const [limiteTotal, setLimiteTotal] = useState('');
  const [diaFechamento, setDiaFechamento] = useState('');
  const [diaVencimento, setDiaVencimento] = useState('');
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
    if (!nome) return;

    setFormLoading(true);
    try {
      await addCartao({
        nome,
        limite_total: limiteTotal ? parseFloat(limiteTotal) : null,
        limite_disponivel: limiteTotal ? parseFloat(limiteTotal) : null,
        dia_fechamento: diaFechamento ? parseInt(diaFechamento) : null,
        dia_vencimento: diaVencimento ? parseInt(diaVencimento) : null,
        usuario_id: null,
      });
      resetForm();
      setFormOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setNome('');
    setLimiteTotal('');
    setDiaFechamento('');
    setDiaVencimento('');
  };

  const getFaturaAberta = (cartaoId: string) => {
    return faturasEmAberto.find((f) => f.cartao_id === cartaoId);
  };

  const totalLimite = cartoes.reduce((acc, c) => acc + Number(c.limite_total || 0), 0);
  const totalDisponivel = cartoes.reduce((acc, c) => acc + Number(c.limite_disponivel || 0), 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Cartões de Crédito</h1>
            <p className="text-muted-foreground">
              Limite disponível: <span className="font-semibold text-foreground">{formatCurrency(totalDisponivel)}</span>
              {' / '}
              <span className="text-foreground">{formatCurrency(totalLimite)}</span>
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Cartão
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl p-6 animate-pulse">
                <div className="w-12 h-12 rounded-xl bg-muted mb-4" />
                <div className="h-5 bg-muted rounded w-32 mb-2" />
                <div className="h-4 bg-muted rounded w-24" />
              </div>
            ))}
          </div>
        ) : cartoes.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <CreditCard className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum cartão cadastrado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cartoes.map((cartao, index) => {
              const faturaAberta = getFaturaAberta(cartao.id);
              const percentUsado = cartao.limite_total 
                ? ((Number(cartao.limite_total) - Number(cartao.limite_disponivel || 0)) / Number(cartao.limite_total)) * 100
                : 0;

              return (
                <div
                  key={cartao.id}
                  className="glass rounded-xl p-6 animate-slide-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 rounded-xl bg-primary/10">
                      <CreditCard className="w-6 h-6 text-primary" />
                    </div>
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
                          <AlertDialogTitle>Excluir cartão?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteCartao(cartao.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  <h3 className="font-semibold text-lg mb-2">{cartao.nome || 'Sem nome'}</h3>
                  
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Limite usado</span>
                        <span>{percentUsado.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all",
                            percentUsado > 80 ? "bg-red-500" : percentUsado > 50 ? "bg-yellow-500" : "bg-green-500"
                          )}
                          style={{ width: `${Math.min(percentUsado, 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Disponível</span>
                      <span className="font-medium">{formatCurrency(cartao.limite_disponivel)}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Limite Total</span>
                      <span>{formatCurrency(cartao.limite_total)}</span>
                    </div>

                    {cartao.dia_fechamento && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-4 h-4" />
                        Fecha dia {cartao.dia_fechamento} • Vence dia {cartao.dia_vencimento}
                      </div>
                    )}

                    {faturaAberta && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Fatura Atual</span>
                          <span className="font-bold text-red-500">
                            {formatCurrency(faturaAberta.valor_total)}
                          </span>
                        </div>
                      </div>
                    )}
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
            <DialogTitle>Novo Cartão de Crédito</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Cartão</Label>
              <Input
                placeholder="Ex: Nubank, Itaú..."
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Limite Total (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={limiteTotal}
                onChange={(e) => setLimiteTotal(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dia Fechamento</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Ex: 15"
                  value={diaFechamento}
                  onChange={(e) => setDiaFechamento(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Dia Vencimento</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Ex: 25"
                  value={diaVencimento}
                  onChange={(e) => setDiaVencimento(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={formLoading}>
              {formLoading ? 'Salvando...' : 'Adicionar Cartão'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Cartoes;
