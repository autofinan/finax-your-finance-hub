import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTransacoes } from '@/hooks/useTransacoes';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORIAS } from '@/types/finance';
import { format, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const Relatorios = () => {
  const { transacoes, loading } = useTransacoes();
  const [periodo, setPeriodo] = useState('3');

  const meses = useMemo(() => {
    const numMeses = parseInt(periodo);
    return Array.from({ length: numMeses }, (_, i) => {
      const date = subMonths(new Date(), numMeses - 1 - i);
      return {
        date,
        label: format(date, 'MMM', { locale: ptBR }),
        fullLabel: format(date, 'MMMM yyyy', { locale: ptBR }),
      };
    });
  }, [periodo]);

  const dadosMensais = useMemo(() => {
    return meses.map((mes) => {
      const inicio = startOfMonth(mes.date);
      const fim = endOfMonth(mes.date);

      const transacoesMes = transacoes.filter((t) => {
        const data = new Date(t.data);
        return data >= inicio && data <= fim;
      });

      const entradas = transacoesMes
        .filter((t) => t.tipo === 'entrada')
        .reduce((acc, t) => acc + Number(t.valor), 0);

      const saidas = transacoesMes
        .filter((t) => t.tipo === 'saida')
        .reduce((acc, t) => acc + Number(t.valor), 0);

      return {
        name: mes.label,
        fullName: mes.fullLabel,
        entradas,
        saidas,
        saldo: entradas - saidas,
      };
    });
  }, [transacoes, meses]);

  const dadosCategorias = useMemo(() => {
    const mesAtual = new Date();
    const inicio = startOfMonth(mesAtual);
    const fim = endOfMonth(mesAtual);

    const transacoesMes = transacoes.filter((t) => {
      const data = new Date(t.data);
      return data >= inicio && data <= fim && t.tipo === 'saida';
    });

    const porCategoria = transacoesMes.reduce((acc, t) => {
      acc[t.categoria] = (acc[t.categoria] || 0) + Number(t.valor);
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(porCategoria)
      .map(([categoria, valor]) => ({
        name: CATEGORIAS.find((c) => c.value === categoria)?.label || categoria,
        valor,
        fill: CATEGORIAS.find((c) => c.value === categoria)?.cor || 'hsl(220, 10%, 50%)',
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [transacoes]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
    }).format(value);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Relatórios</h1>
            <p className="text-muted-foreground">Análise detalhada das suas finanças</p>
          </div>
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Último ano</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass rounded-2xl p-6">
            <h3 className="font-semibold mb-4">Evolução Mensal</h3>
            {loading ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="animate-pulse text-muted-foreground">Carregando...</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dadosMensais}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={formatCurrency} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '12px',
                    }}
                  />
                  <Bar dataKey="entradas" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} name="Entradas" />
                  <Bar dataKey="saidas" fill="hsl(0, 84%, 60%)" radius={[4, 4, 0, 0]} name="Saídas" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="glass rounded-2xl p-6">
            <h3 className="font-semibold mb-4">Saldo ao Longo do Tempo</h3>
            {loading ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="animate-pulse text-muted-foreground">Carregando...</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dadosMensais}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={formatCurrency} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '12px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="saldo"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2 }}
                    name="Saldo"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="glass rounded-2xl p-6 lg:col-span-2">
            <h3 className="font-semibold mb-4">Gastos por Categoria (Mês Atual)</h3>
            {loading ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="animate-pulse text-muted-foreground">Carregando...</div>
              </div>
            ) : dadosCategorias.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-muted-foreground">Nenhum gasto registrado este mês.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dadosCategorias} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={formatCurrency} />
                  <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} width={100} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '12px',
                    }}
                  />
                  <Bar dataKey="valor" radius={[0, 4, 4, 0]} name="Valor">
                    {dadosCategorias.map((entry, index) => (
                      <Bar key={index} dataKey="valor" fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Relatorios;
