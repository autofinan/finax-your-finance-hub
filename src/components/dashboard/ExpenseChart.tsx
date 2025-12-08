import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { Transacao, CATEGORIAS } from '@/types/finance';

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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  if (chartData.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 h-[350px] flex items-center justify-center">
        <p className="text-muted-foreground text-sm text-center">
          Nenhuma despesa registrada para exibir o gráfico.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 animate-fade-in">
      <h3 className="font-semibold mb-4">Despesas por Categoria</h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={4}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => formatCurrency(value)}
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value) => (
              <span className="text-xs text-foreground">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
