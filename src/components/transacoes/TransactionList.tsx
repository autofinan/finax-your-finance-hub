import { Transacao, CATEGORIAS } from '@/types/finance';
import { ArrowDownLeft, ArrowUpRight, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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

interface TransactionListProps {
  transacoes: Transacao[];
  onDelete: (id: string) => Promise<void>;
  loading?: boolean;
}

export function TransactionList({ transacoes, onDelete, loading }: TransactionListProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getCategoriaInfo = (categoria: string) => {
    return CATEGORIAS.find((c) => c.value === categoria) || { label: categoria, cor: 'hsl(220, 10%, 50%)' };
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="glass rounded-xl p-4 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-muted" />
              <div className="flex-1">
                <div className="h-4 bg-muted rounded w-32 mb-2" />
                <div className="h-3 bg-muted rounded w-20" />
              </div>
              <div className="h-5 bg-muted rounded w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (transacoes.length === 0) {
    return (
      <div className="glass rounded-xl p-12 text-center">
        <p className="text-muted-foreground">Nenhuma transação encontrada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {transacoes.map((transacao, index) => {
        const categoriaInfo = getCategoriaInfo(transacao.categoria);
        return (
          <div
            key={transacao.id}
            className="glass rounded-xl p-4 animate-slide-up hover:shadow-lg transition-shadow"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'p-3 rounded-xl',
                  transacao.tipo === 'entrada'
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                )}
              >
                {transacao.tipo === 'entrada' ? (
                  <ArrowDownLeft className="w-6 h-6" />
                ) : (
                  <ArrowUpRight className="w-6 h-6" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium truncate">
                    {transacao.observacao || categoriaInfo.label}
                  </p>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${categoriaInfo.cor}20`,
                      color: categoriaInfo.cor,
                    }}
                  >
                    {categoriaInfo.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(transacao.data), "EEEE, dd 'de' MMMM 'às' HH:mm", {
                    locale: ptBR,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p
                  className={cn(
                    'font-bold text-lg',
                    transacao.tipo === 'entrada'
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {transacao.tipo === 'entrada' ? '+' : '-'}
                  {formatCurrency(Number(transacao.valor))}
                </p>
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
                      <AlertDialogTitle>Excluir transação?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação não pode ser desfeita. A transação será permanentemente removida.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onDelete(transacao.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
