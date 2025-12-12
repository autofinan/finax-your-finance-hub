import { AppLayout } from '@/components/layout/AppLayout';
import { useFaturas } from '@/hooks/useFaturas';
import { useCartoes } from '@/hooks/useCartoes';
import { Button } from '@/components/ui/button';
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
import { Receipt, Check, CreditCard, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

const Faturas = () => {
  const { faturas, faturasEmAberto, loading, pagarFatura } = useFaturas();
  const { cartoes } = useCartoes();

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getCartaoNome = (cartaoId: string | null) => {
    if (!cartaoId) return 'Sem cartão';
    const cartao = cartoes.find((c) => c.id === cartaoId);
    return cartao?.nome || 'Cartão';
  };

  const getMesNome = (mes: number | null) => {
    if (!mes) return '';
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return meses[mes - 1] || '';
  };

  const totalEmAberto = faturasEmAberto.reduce((acc, f) => acc + Number(f.valor_total || 0), 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Faturas</h1>
            <p className="text-muted-foreground">
              Total em aberto: <span className="font-semibold text-red-500">{formatCurrency(totalEmAberto)}</span>
            </p>
          </div>
        </div>

        {/* Faturas em Aberto */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Receipt className="w-5 h-5 text-red-500" />
            Faturas em Aberto
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
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
          ) : faturasEmAberto.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center">
              <Check className="w-10 h-10 mx-auto text-green-500 mb-3" />
              <p className="text-muted-foreground">Nenhuma fatura em aberto!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {faturasEmAberto.map((fatura, index) => (
                <div
                  key={fatura.id}
                  className="glass rounded-xl p-4 animate-slide-up border-l-4 border-l-red-500"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-red-500/10">
                      <CreditCard className="w-6 h-6 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{getCartaoNome(fatura.cartao_id)}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {getMesNome(fatura.mes)}/{fatura.ano}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-bold text-lg text-red-500">
                          {formatCurrency(fatura.valor_total)}
                        </p>
                        <p className="text-xs text-muted-foreground">{fatura.status}</p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            Pagar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirmar pagamento?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Marcar fatura de {formatCurrency(fatura.valor_total)} como paga.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => fatura.id && pagarFatura(fatura.id, fatura.valor_total || 0)}
                            >
                              Confirmar Pagamento
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Histórico de Faturas */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Histórico de Faturas
          </h2>

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
          ) : faturas.length === 0 ? (
            <div className="glass rounded-xl p-8 text-center">
              <Receipt className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Nenhuma fatura registrada.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {faturas.map((fatura, index) => (
                <div
                  key={fatura.id}
                  className={cn(
                    "glass rounded-xl p-4 animate-slide-up",
                    fatura.status === 'paga' && "opacity-60"
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "p-3 rounded-xl",
                      fatura.status === 'paga' ? "bg-green-500/10" : "bg-muted"
                    )}>
                      {fatura.status === 'paga' ? (
                        <Check className="w-6 h-6 text-green-500" />
                      ) : (
                        <CreditCard className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{getCartaoNome(fatura.cartao_id)}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {getMesNome(fatura.mes)}/{fatura.ano}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "font-bold text-lg",
                        fatura.status === 'paga' ? "text-green-500" : "text-foreground"
                      )}>
                        {formatCurrency(fatura.valor_total)}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{fatura.status}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Faturas;
