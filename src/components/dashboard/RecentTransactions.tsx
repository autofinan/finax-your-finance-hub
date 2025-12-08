import { Transacao, CATEGORIAS } from '@/types/finance';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RecentTransactionsProps {
  transacoes: Transacao[];
  loading?: boolean;
}

export function RecentTransactions({ transacoes, loading }: RecentTransactionsProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getCategoriaLabel = (categoria: string) => {
    return CATEGORIAS.find((c) => c.value === categoria)?.label || categoria;
  };

  if (loading) {
    return (
      <div className="glass rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Transações Recentes</h3>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-muted" />
              <div className="flex-1">
                <div className="h-4 bg-muted rounded w-32 mb-2" />
                <div className="h-3 bg-muted rounded w-20" />
              </div>
              <div className="h-4 bg-muted rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 animate-fade-in">
      <h3 className="font-semibold mb-4">Transações Recentes</h3>
      {transacoes.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">
          Nenhuma transação registrada ainda.
        </p>
      ) : (
        <div className="space-y-3">
          {transacoes.slice(0, 5).map((transacao) => (
            <div
              key={transacao.id}
              className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary/50 transition-colors"
            >
              <div
                className={cn(
                  'p-2.5 rounded-xl',
                  transacao.tipo === 'entrada'
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                )}
              >
                {transacao.tipo === 'entrada' ? (
                  <ArrowDownLeft className="w-5 h-5" />
                ) : (
                  <ArrowUpRight className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {transacao.observacao || getCategoriaLabel(transacao.categoria)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(transacao.data), "dd MMM, HH:mm", { locale: ptBR })}
                </p>
              </div>
              <p
                className={cn(
                  'font-semibold',
                  transacao.tipo === 'entrada'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                )}
              >
                {transacao.tipo === 'entrada' ? '+' : '-'}
                {formatCurrency(Number(transacao.valor))}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
