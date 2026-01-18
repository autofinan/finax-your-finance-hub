import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Transacao, CATEGORIAS } from '@/types/finance';
import { motion } from 'framer-motion';
import { PieChart as PieChartIcon } from 'lucide-react';

interface ExpenseChartProps {
  transacoes: Transacao[];
}

export function ExpenseChart({ transacoes }: ExpenseChartProps) {
  const despesas = transacoes.filter((t) => t.tipo === 'saida');

  const dataByCategoria = despesas.reduce((acc, t) => {
    const categoria = t.categoria;
    acc[categoria] = (acc[categoria] || 0) + Number(t.valor);
    return acc;
  }, {} as Record<string, number>);

  const chartData = Object.entries(dataByCategoria)
    .map(([categoria, valor]) => ({
      name: CATEGORIAS.find((c) => c.value === categoria)?.label || categoria,
      value: valor,
      color: CATEGORIAS.find((c) => c.value === categoria)?.cor || 'hsl(220, 10%, 50%)',
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const total = chartData.reduce((acc, item) => acc + item.value, 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  if (chartData.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[400px]"
      >
        <div className="w-20 h-20 rounded-2xl bg-slate-800/50 flex items-center justify-center mb-4">
          <PieChartIcon className="w-10 h-10 text-slate-600" />
        </div>
        <p className="text-sm text-slate-400 text-center">
          Nenhuma despesa registrada para exibir o gráfico
        </p>
      </motion.div>
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
            <PieChartIcon className="w-5 h-5 text-indigo-400" />
          </div>
          <h3 className="font-bold text-lg text-white">Despesas por Categoria</h3>
        </div>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          Top 6
        </span>
      </div>

      {/* Chart */}
      <div className="relative">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={80}
              outerRadius={110}
              paddingAngle={4}
              dataKey="value"
              animationBegin={0}
              animationDuration={800}
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.color} 
                  strokeWidth={0}
                  className="hover:opacity-80 transition-opacity cursor-pointer"
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0];
                  return (
                    <div className="bg-slate-950 border border-white/10 rounded-xl p-3 shadow-2xl backdrop-blur-xl">
                      <p className="text-xs font-semibold text-white mb-1">
                        {data.name}
                      </p>
                      <p className="text-sm font-bold text-indigo-400">
                        {formatCurrency(data.value as number)}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {((data.value as number / total) * 100).toFixed(1)}% do total
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center Label */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-widest mb-1">
            Total
          </p>
          <p className="text-2xl font-black text-white">
            {formatCurrency(total)}
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        {chartData.map((item, index) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center gap-2"
          >
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {item.name}
              </p>
              <p className="text-xs text-slate-500">
                {formatCurrency(item.value)}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
