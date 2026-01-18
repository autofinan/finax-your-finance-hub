import { Transacao, CATEGORIAS } from '@/types/finance';
import { ArrowDownLeft, ArrowUpRight, Clock, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'framer-motion';

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
      <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10">
              <Clock className="w-5 h-5 text-indigo-400" />
            </div>
            <h3 className="font-bold text-lg text-white">Transações Recentes</h3>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-xl animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-slate-800/50" />
              <div className="flex-1">
                <div className="h-4 bg-slate-800/50 rounded w-32 mb-2" />
                <div className="h-3 bg-slate-800/50 rounded w-20" />
              </div>
              <div className="h-4 bg-slate-800/50 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(79,70,229,0.2)]"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10">
            <Clock className="w-5 h-5 text-indigo-400" />
          </div>
          <h3 className="font-bold text-lg text-white">Transações Recentes</h3>
        </div>
        <button className="p-2 hover:bg-white/5 rounded-lg transition-colors">
          <Filter className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {transacoes.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-800/50 flex items-center justify-center">
            <Clock className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-sm text-slate-400 mb-1">Nenhuma transação registrada</p>
          <p className="text-xs text-slate-600">
            Comece registrando seu primeiro gasto ou entrada
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {transacoes.slice(0, 5).map((transacao, index) => (
            <motion.div
              key={transacao.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="group flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all duration-300 cursor-pointer"
            >
              {/* Icon */}
              <div
                className={cn(
                  'p-2.5 rounded-xl transition-transform duration-300 group-hover:scale-110',
                  transacao.tipo === 'entrada'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-red-500/10 text-red-400'
                )}
              >
                {transacao.tipo === 'entrada' ? (
                  <ArrowDownLeft className="w-5 h-5" />
                ) : (
                  <ArrowUpRight className="w-5 h-5" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-white truncate">
                  {transacao.observacao || getCategoriaLabel(transacao.categoria)}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-slate-500">
                    {format(new Date(transacao.data), "dd MMM, HH:mm", { locale: ptBR })}
                  </p>
                  <span className="w-1 h-1 rounded-full bg-slate-700" />
                  <p className="text-xs text-slate-500">
                    {getCategoriaLabel(transacao.categoria)}
                  </p>
                </div>
              </div>

              {/* Value */}
              <p
                className={cn(
                  'font-bold text-sm',
                  transacao.tipo === 'entrada'
                    ? 'text-emerald-400'
                    : 'text-red-400'
                )}
              >
                {transacao.tipo === 'entrada' ? '+' : '-'}
                {formatCurrency(Number(transacao.valor))}
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {transacoes.length > 5 && (
        <button className="w-full mt-4 py-3 bg-white/5 border border-white/5 rounded-xl text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-white transition-all">
          Ver todas as transações ({transacoes.length})
        </button>
      )}
    </motion.div>
  );
}
