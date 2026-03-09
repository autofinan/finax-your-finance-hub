import { useFreedomDays } from '@/hooks/useFreedomDays';
import { useDividas } from '@/hooks/useDividas';
import { TrendingDown, Trophy, Calendar } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  usuarioId?: string;
}

export function ProgressoAcumuladoCard({ usuarioId }: Props) {
  const { diasParaLiberdade, dataEstimada, margemReal, hasData } = useFreedomDays(usuarioId);
  const { dividasAtivas, saldoTotal, minimoTotal } = useDividas();

  if (!hasData || dividasAtivas.length === 0) return null;

  // Estimativa de juros que seriam pagos se só pagasse mínimo
  const taxaMediaMensal = dividasAtivas.reduce((sum, d) => sum + (d.taxa_juros || 0), 0) / dividasAtivas.length / 100;
  const jurosMensaisEstimados = saldoTotal * taxaMediaMensal;
  const jurosEvitadosPorMes = margemReal > minimoTotal ? (margemReal - minimoTotal) * taxaMediaMensal : 0;

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
      className="bg-gradient-to-br from-emerald-950/40 to-teal-950/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-6 hover:border-emerald-500/40 transition-all"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2.5 rounded-xl bg-emerald-500/10">
          <Trophy className="w-5 h-5 text-emerald-400" />
        </div>
        <h3 className="font-bold text-lg text-white">Progresso Acumulado</h3>
      </div>

      <div className="space-y-4">
        {/* Juros evitados */}
        <div className="p-3 bg-emerald-500/10 rounded-xl">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-emerald-300">Juros evitados/mês</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">
            {formatCurrency(jurosEvitadosPorMes)}
          </p>
          <p className="text-xs text-emerald-400/60 mt-1">
            Pagando {formatCurrency(margemReal)}/mês vs mínimo {formatCurrency(minimoTotal)}
          </p>
        </div>

        {/* Data estimada */}
        {dataEstimada && diasParaLiberdade < Infinity && (
          <div className="p-3 bg-white/5 rounded-xl">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <span className="text-sm text-slate-300">Livre de dívidas em</span>
            </div>
            <p className="text-lg font-bold text-white">
              {dataEstimada.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </p>
            <p className="text-xs text-slate-500">
              ~{diasParaLiberdade} dias restantes
            </p>
          </div>
        )}

        {/* Custo mensal juros */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Juros mensais atuais</span>
          <span className="text-red-400 font-semibold">{formatCurrency(jurosMensaisEstimados)}</span>
        </div>
      </div>
    </motion.div>
  );
}
