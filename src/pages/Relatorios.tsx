import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useAuth } from '@/contexts/AuthContext';
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
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORIAS } from '@/types/finance';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { BarChart3, LineChartIcon, PieChartIcon, TrendingUp } from 'lucide-react';

const Relatorios = () => {
  const { user } = useAuth();
  const { transacoes, loading } = useTransacoes(user?.id);
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
        fill: CATEGORIAS.find((c) => c.value === categoria)?.cor || '#6366f1',
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

  const totalEntradas = dadosMensais.reduce((acc, m) => acc + m.entradas, 0);
  const totalSaidas = dadosMensais.reduce((acc, m) => acc + m.saidas, 0);

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        {/* Background Effects */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
        </div>

        <div className="fixed inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

        <div className="relative z-10 max-w-[1800px] mx-auto space-y-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
          >
            <div>
              <p className="text-slate-500 font-medium mb-1">Análise completa</p>
              <h1 className="text-4xl font-bold text-white">
                Relatórios <span className="text-indigo-400">📈</span>
              </h1>
            </div>
            <Select value={periodo} onValueChange={setPeriodo}>
              <SelectTrigger className="w-[200px] bg-slate-900/50 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="3" className="text-white">Últimos 3 meses</SelectItem>
                <SelectItem value="6" className="text-white">Últimos 6 meses</SelectItem>
                <SelectItem value="12" className="text-white">Último ano</SelectItem>
              </SelectContent>
            </Select>
          </motion.div>

          {/* Summary Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-sm text-slate-500">Total Entradas ({periodo} meses)</p>
              </div>
              <p className="text-3xl font-bold text-emerald-400">{formatCurrency(totalEntradas)}</p>
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <BarChart3 className="w-5 h-5 text-red-400" />
                </div>
                <p className="text-sm text-slate-500">Total Saídas ({periodo} meses)</p>
              </div>
              <p className="text-3xl font-bold text-red-400">{formatCurrency(totalSaidas)}</p>
            </div>
          </motion.div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Evolução Mensal */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/10">
                  <BarChart3 className="w-5 h-5 text-indigo-400" />
                </div>
                <h3 className="font-bold text-lg text-white">Evolução Mensal</h3>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-pulse text-slate-500">Carregando...</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dadosMensais}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={formatCurrency} />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '12px',
                        color: '#fff'
                      }}
                    />
                    <Bar dataKey="entradas" fill="#22c55e" radius={[4, 4, 0, 0]} name="Entradas" />
                    <Bar dataKey="saidas" fill="#ef4444" radius={[4, 4, 0, 0]} name="Saídas" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </motion.div>

            {/* Saldo ao Longo do Tempo */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/10">
                  <LineChartIcon className="w-5 h-5 text-indigo-400" />
                </div>
                <h3 className="font-bold text-lg text-white">Saldo ao Longo do Tempo</h3>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-pulse text-slate-500">Carregando...</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={dadosMensais}>
                    <defs>
                      <linearGradient id="saldoGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={formatCurrency} />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '12px',
                        color: '#fff'
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="saldo"
                      stroke="#6366f1"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#saldoGradient)"
                      name="Saldo"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </motion.div>

            {/* Gastos por Categoria */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 lg:col-span-2 hover:border-indigo-500/30 transition-all"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/10">
                  <PieChartIcon className="w-5 h-5 text-indigo-400" />
                </div>
                <h3 className="font-bold text-lg text-white">Gastos por Categoria (Mês Atual)</h3>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-pulse text-slate-500">Carregando...</div>
                </div>
              ) : dadosCategorias.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center">
                  <p className="text-slate-500">Nenhum gasto registrado este mês.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={dadosCategorias}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="valor"
                      >
                        {dadosCategorias.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(99, 102, 241, 0.3)',
                          borderRadius: '12px',
                          color: '#fff'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3">
                    {dadosCategorias.slice(0, 6).map((cat, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: cat.fill }}
                          />
                          <span className="text-slate-300">{cat.name}</span>
                        </div>
                        <span className="font-bold text-white">{formatCurrency(cat.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Relatorios;
