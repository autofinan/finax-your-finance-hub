import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { usePlanilhaExport } from '@/hooks/usePlanilhaExport';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CATEGORIAS } from '@/types/finance';
import { format, subMonths, subWeeks, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'framer-motion';
import {
  BarChart3, LineChartIcon, PieChartIcon, TrendingUp, TrendingDown,
  Download, FileSpreadsheet, Wallet, CheckCircle2, AlertCircle,
} from 'lucide-react';

const Relatorios = () => {
  const { usuarioId, usuario } = useUsuarioId();
  const { transacoes, loading } = useTransacoes(usuarioId || undefined);
  const { exportarPlanilha } = usePlanilhaExport();
  
  const [periodo, setPeriodo] = useState('3');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPeriodo, setExportPeriodo] = useState<'mensal' | 'semanal' | 'trimestral' | 'semestral' | 'anual' | 'personalizado'>('mensal');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exporting, setExporting] = useState(false);

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
      const entradas = transacoesMes.filter((t) => t.tipo === 'entrada').reduce((acc, t) => acc + Number(t.valor), 0);
      const saidas = transacoesMes.filter((t) => t.tipo === 'saida').reduce((acc, t) => acc + Number(t.valor), 0);
      return { name: mes.label, fullName: mes.fullLabel, entradas, saidas, saldo: entradas - saidas };
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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(value);

  const totalEntradas = dadosMensais.reduce((acc, m) => acc + m.entradas, 0);
  const totalSaidas = dadosMensais.reduce((acc, m) => acc + m.saidas, 0);
  const saldoLiquido = totalEntradas - totalSaidas;

  // Pré-visualização do que será exportado
  const previewExport = useMemo(() => {
    let startDate: Date;
    let endDate: Date;
    const now = new Date();
    if (exportPeriodo === 'mensal') {
      startDate = startOfMonth(now);
      endDate = endOfMonth(now);
    } else if (exportPeriodo === 'semanal') {
      startDate = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      endDate = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    } else if (exportPeriodo === 'trimestral') {
      startDate = subMonths(startOfMonth(now), 2);
      endDate = endOfMonth(now);
    } else if (exportPeriodo === 'semestral') {
      startDate = subMonths(startOfMonth(now), 5);
      endDate = endOfMonth(now);
    } else if (exportPeriodo === 'anual') {
      startDate = subMonths(startOfMonth(now), 11);
      endDate = endOfMonth(now);
    } else {
      if (!customStart || !customEnd) return null;
      startDate = new Date(customStart + 'T00:00:00');
      endDate = new Date(customEnd + 'T23:59:59');
    }
    const filtered = transacoes.filter((t) => {
      const d = new Date(t.data);
      return d >= startDate && d <= endDate;
    });
    const ent = filtered.filter(t => t.tipo === 'entrada').reduce((s, t) => s + Number(t.valor), 0);
    const sai = filtered.filter(t => t.tipo === 'saida').reduce((s, t) => s + Number(t.valor), 0);
    return {
      periodo: `${format(startDate, 'dd/MM/yyyy')} a ${format(endDate, 'dd/MM/yyyy')}`,
      total: filtered.length,
      entradas: ent,
      saidas: sai,
      saldo: ent - sai,
    };
  }, [transacoes, exportPeriodo, customStart, customEnd]);

  // Exportação usando o hook
  const handleExport = async () => {
    let startDate: Date;
    let endDate: Date;
    const now = new Date();

    if (exportPeriodo === 'mensal') {
      startDate = startOfMonth(now);
      endDate = endOfMonth(now);
    } else if (exportPeriodo === 'semanal') {
      startDate = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      endDate = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    } else if (exportPeriodo === 'trimestral') {
      startDate = subMonths(startOfMonth(now), 2);
      endDate = endOfMonth(now);
    } else if (exportPeriodo === 'semestral') {
      startDate = subMonths(startOfMonth(now), 5);
      endDate = endOfMonth(now);
    } else if (exportPeriodo === 'anual') {
      startDate = subMonths(startOfMonth(now), 11);
      endDate = endOfMonth(now);
    } else {
      if (!customStart || !customEnd) return;
      startDate = new Date(customStart + 'T00:00:00');
      endDate = new Date(customEnd + 'T23:59:59');
    }

    const filtered = transacoes.filter((t) => {
      const d = new Date(t.data);
      return d >= startDate && d <= endDate;
    });

    setExporting(true);
    
    try {
      await exportarPlanilha({
        startDate,
        endDate,
        transacoes: filtered,
        usuario,
      });
      
      setExportSuccess(true);
      setTimeout(() => {
        setExportOpen(false);
        setExportSuccess(false);
      }, 1500);
    } catch (error) {
      console.error('Erro ao exportar:', error);
      alert('Erro ao exportar planilha. Tente novamente.');
    } finally {
      setExporting(false);
    }
  };

  const periodoLabel: Record<string, string> = {
    '3': 'Últimos 3 meses',
    '6': 'Últimos 6 meses',
    '12': 'Último ano',
  };

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
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setExportOpen(true)}
                className="bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 flex items-center gap-2 shadow-lg shadow-emerald-500/20"
              >
                <Download className="w-4 h-4" />
                Exportar Planilha
              </Button>
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
            </div>
          </motion.div>

          {/* Summary Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-sm text-slate-500">Total Receitas · {periodoLabel[periodo]}</p>
              </div>
              <p className="text-3xl font-bold text-emerald-400">{formatCurrency(totalEntradas)}</p>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                </div>
                <p className="text-sm text-slate-500">Total Despesas · {periodoLabel[periodo]}</p>
              </div>
              <p className="text-3xl font-bold text-red-400">{formatCurrency(totalSaidas)}</p>
            </div>

            <div className={`bg-slate-900/40 backdrop-blur-xl border rounded-2xl p-5 ${saldoLiquido >= 0 ? 'border-indigo-500/20' : 'border-amber-500/20'}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg ${saldoLiquido >= 0 ? 'bg-indigo-500/10' : 'bg-amber-500/10'}`}>
                  <Wallet className={`w-5 h-5 ${saldoLiquido >= 0 ? 'text-indigo-400' : 'text-amber-400'}`} />
                </div>
                <p className="text-sm text-slate-500">Saldo Líquido · {periodoLabel[periodo]}</p>
              </div>
              <p className={`text-3xl font-bold ${saldoLiquido >= 0 ? 'text-indigo-400' : 'text-amber-400'}`}>
                {formatCurrency(saldoLiquido)}
              </p>
              <p className={`text-xs mt-1 ${saldoLiquido >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                {saldoLiquido >= 0
                  ? `Você poupou ${totalEntradas > 0 ? ((saldoLiquido / totalEntradas) * 100).toFixed(1) : 0}% da renda`
                  : `Déficit de ${totalEntradas > 0 ? ((Math.abs(saldoLiquido) / totalEntradas) * 100).toFixed(1) : 0}% da renda`
                }
              </p>
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
                <div>
                  <h3 className="font-bold text-lg text-white">Evolução Mensal</h3>
                  <p className="text-xs text-slate-500">Receitas vs. despesas por mês</p>
                </div>
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
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => formatCurrency(v)} width={80} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCurrency(value), name === 'entradas' ? 'Receitas' : 'Despesas']}
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '12px', color: '#fff' }}
                    />
                    <Legend formatter={(value) => value === 'entradas' ? 'Receitas' : 'Despesas'} />
                    <Bar dataKey="entradas" fill="#22c55e" radius={[4, 4, 0, 0]} name="entradas" />
                    <Bar dataKey="saidas" fill="#ef4444" radius={[4, 4, 0, 0]} name="saidas" />
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
                <div>
                  <h3 className="font-bold text-lg text-white">Saldo ao Longo do Tempo</h3>
                  <p className="text-xs text-slate-500">Evolução do saldo mensal</p>
                </div>
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
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => formatCurrency(v)} width={80} />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), 'Saldo']}
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '12px', color: '#fff' }}
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
                <div>
                  <h3 className="font-bold text-lg text-white">Gastos por Categoria</h3>
                  <p className="text-xs text-slate-500">Distribuição das despesas no mês atual</p>
                </div>
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
                        formatter={(value: number) => [formatCurrency(value), 'Gasto']}
                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '12px', color: '#fff' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3 self-center">
                    {dadosCategorias.slice(0, 7).map((cat, index) => {
                      const totalGastos = dadosCategorias.reduce((s, c) => s + c.valor, 0);
                      const perc = totalGastos > 0 ? ((cat.valor / totalGastos) * 100).toFixed(1) : '0';
                      return (
                        <div key={index} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.fill }} />
                            <span className="text-slate-300 text-sm truncate">{cat.name}</span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-xs text-slate-500 w-10 text-right">{perc}%</span>
                            <span className="font-bold text-white text-sm">{formatCurrency(cat.valor)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Export Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              Exportar Planilha Profissional
            </DialogTitle>
          </DialogHeader>

          {exportSuccess ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-8 flex flex-col items-center gap-3"
            >
              <CheckCircle2 className="w-16 h-16 text-emerald-400" />
              <p className="text-lg font-bold text-white">Planilha exportada com sucesso!</p>
              <p className="text-sm text-slate-400">O arquivo foi baixado para o seu dispositivo.</p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300 font-medium">Período do relatório</Label>
                <Select value={exportPeriodo} onValueChange={(v) => setExportPeriodo(v as any)}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="mensal" className="text-white">📅 Mês Atual</SelectItem>
                    <SelectItem value="semanal" className="text-white">📆 Última Semana</SelectItem>
                    <SelectItem value="trimestral" className="text-white">📊 Últimos 3 Meses</SelectItem>
                    <SelectItem value="semestral" className="text-white">📈 Últimos 6 Meses</SelectItem>
                    <SelectItem value="anual" className="text-white">📅 Últimos 12 Meses</SelectItem>
                    <SelectItem value="personalizado" className="text-white">🗓️ Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {exportPeriodo === 'personalizado' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300">Data Início</Label>
                    <Input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">Data Fim</Label>
                    <Input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                </div>
              )}

              {previewExport ? (
                <div className="p-4 rounded-xl bg-slate-800/60 border border-indigo-500/20 space-y-3">
                  <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Pré-visualização</p>
                  <p className="text-xs text-slate-400">{previewExport.periodo}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center">
                      <p className="text-xs text-slate-500 mb-1">Receitas</p>
                      <p className="text-sm font-bold text-emerald-400">{formatCurrency(previewExport.entradas)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-slate-500 mb-1">Despesas</p>
                      <p className="text-sm font-bold text-red-400">{formatCurrency(previewExport.saidas)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-slate-500 mb-1">Saldo</p>
                      <p className={`text-sm font-bold ${previewExport.saldo >= 0 ? 'text-indigo-400' : 'text-amber-400'}`}>
                        {formatCurrency(previewExport.saldo)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 text-center">{previewExport.total} transação(ões)</p>
                </div>
              ) : exportPeriodo === 'personalizado' ? (
                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <p className="text-sm text-slate-500">Selecione as datas para ver a pré-visualização.</p>
                </div>
              ) : null}

              <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 space-y-2">
                <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
                  <span>✨</span> Planilha profissional com design
                </p>
                <div className="space-y-1.5">
                  {[
                    { icon: '🎨', desc: 'Cores, bordas e formatação empresarial' },
                    { icon: '📊', desc: 'Gráficos e tabelas com estilo FINAX' },
                    { icon: '💎', desc: 'Layout organizado e fácil de ler' },
                    { icon: '✓', desc: 'Totais e percentuais automáticos' },
                  ].map(({ icon, desc }) => (
                    <div key={desc} className="flex items-start gap-2">
                      <span className="text-sm flex-shrink-0">{icon}</span>
                      <p className="text-xs text-slate-300">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={handleExport}
                disabled={exportPeriodo === 'personalizado' && (!customStart || !customEnd) || exporting}
                className="w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 flex items-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                {exporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Gerando planilha...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Baixar Planilha .xlsx
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Relatorios;
