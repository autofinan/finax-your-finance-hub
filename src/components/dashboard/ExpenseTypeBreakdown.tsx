import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Layers } from 'lucide-react';
import { Transacao } from '@/types/finance';
import { formatCurrency } from '@/lib/utils';

interface ExpenseTypeBreakdownProps {
  transacoes: Transacao[];
}

const TYPE_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  essencial_fixo: { label: 'Essenciais Fixos', emoji: '🏠', color: '#3b82f6' },
  essencial_variavel: { label: 'Essenciais Variáveis', emoji: '🛒', color: '#06b6d4' },
  estrategico: { label: 'Estratégicos', emoji: '🎯', color: '#8b5cf6' },
  flexivel: { label: 'Gastos Flexíveis', emoji: '☕', color: '#f59e0b' },
  divida: { label: 'Dívidas', emoji: '💳', color: '#ef4444' },
};

export function ExpenseTypeBreakdown({ transacoes }: ExpenseTypeBreakdownProps) {
  const breakdown = useMemo(() => {
    const despesas = transacoes.filter(t => t.tipo === 'saida');
    const total = despesas.reduce((s, t) => s + Number(t.valor), 0);
    if (total === 0) return { items: [], total: 0 };

    const byType: Record<string, number> = {};
    despesas.forEach(t => {
      const type = (t as any).expense_type || 'flexivel';
      byType[type] = (byType[type] || 0) + Number(t.valor);
    });

    const items = Object.entries(byType)
      .map(([type, valor]) => ({
        type,
        valor,
        percent: (valor / total) * 100,
        ...(TYPE_CONFIG[type] || TYPE_CONFIG.flexivel),
      }))
      .sort((a, b) => b.valor - a.valor);

    return { items, total };
  }, [transacoes]);

  if (breakdown.items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-500"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-indigo-500/10">
          <Layers className="w-5 h-5 text-indigo-400" />
        </div>
        <h3 className="font-bold text-lg text-white">Essenciais vs Flexíveis</h3>
      </div>

      {/* Stacked bar */}
      <div className="h-4 rounded-full overflow-hidden flex mb-6">
        {breakdown.items.map(item => (
          <div
            key={item.type}
            style={{ width: `${item.percent}%`, backgroundColor: item.color }}
            className="transition-all duration-500"
          />
        ))}
      </div>

      {/* Legend */}
      <div className="space-y-3">
        {breakdown.items.map((item, i) => (
          <motion.div
            key={item.type}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-sm text-slate-300">{item.emoji} {item.label}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-white">{formatCurrency(item.valor)}</span>
              <span className="text-xs text-slate-500 ml-2">{item.percent.toFixed(0)}%</span>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
