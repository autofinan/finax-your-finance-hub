import { motion } from 'framer-motion';
import { Flag, TrendingDown, Calendar, Zap } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useFreedomDays } from '@/hooks/useFreedomDays';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface FreedomCardProps {
  usuarioId?: string;
}

export function FreedomCard({ usuarioId }: FreedomCardProps) {
  const metrics = useFreedomDays(usuarioId);

  if (!metrics.hasData) return null;

  const isInfinite = metrics.diasParaLiberdade === Infinity;
  const anos = Math.floor(metrics.diasParaLiberdade / 365);
  const meses = Math.floor((metrics.diasParaLiberdade % 365) / 30);
  const dias = metrics.diasParaLiberdade % 30;

  const tempoFormatado = isInfinite
    ? '∞'
    : anos > 0
      ? `${anos}a ${meses}m`
      : meses > 0
        ? `${meses}m ${dias}d`
        : `${dias}d`;

  // Micro-insights contextuais
  const microInsight = (() => {
    if (isInfinite) return 'Sua margem está zerada. Reduza gastos flexíveis!';
    const impactoCafe = Math.round(metrics.impactoPorReal * 8 * 30); // café R$8/dia
    if (impactoCafe > 5) {
      return `☕ Um café diário de R$8 custa ${impactoCafe} dias de liberdade/mês`;
    }
    if (metrics.diasParaLiberdade <= 180) {
      return '🚀 Você está a menos de 6 meses da liberdade!';
    }
    if (metrics.margemReal > 500) {
      return `💡 Redirecionando ${formatCurrency(metrics.margemReal * 0.5)} extras, você encurta o prazo pela metade`;
    }
    return `💡 Cada R$100 a menos em gastos = ${Math.round(metrics.impactoPorReal * 100)} dias a menos`;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="bg-gradient-to-br from-emerald-950/60 to-teal-950/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-5 hover:border-emerald-500/40 transition-all duration-500 shadow-lg shadow-emerald-500/5"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2.5 rounded-xl bg-emerald-500/15">
          <Flag className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-bold text-white text-sm">Liberdade Financeira</h3>
          <p className="text-[10px] text-emerald-400/70">Previsão de quitação total</p>
        </div>
      </div>

      {/* Main metric */}
      <div className="text-center mb-4">
        <p className="text-4xl font-black text-emerald-400 tracking-tight">
          {tempoFormatado}
        </p>
        {!isInfinite && metrics.dataEstimada && (
          <p className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1">
            <Calendar className="w-3 h-3" />
            Previsão: {format(metrics.dataEstimada, "MMM/yyyy", { locale: ptBR })}
          </p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <TrendingDown className="w-4 h-4 text-rose-400 mx-auto mb-1" />
          <p className="text-xs text-slate-400">Saldo devedor</p>
          <p className="text-sm font-bold text-white">{formatCurrency(metrics.saldoTotal)}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 text-center">
          <Zap className="w-4 h-4 text-amber-400 mx-auto mb-1" />
          <p className="text-xs text-slate-400">Margem/mês</p>
          <p className="text-sm font-bold text-white">{formatCurrency(metrics.margemReal)}</p>
        </div>
      </div>

      {/* Micro insight */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
        <p className="text-xs text-emerald-300 leading-relaxed">{microInsight}</p>
      </div>
    </motion.div>
  );
}
