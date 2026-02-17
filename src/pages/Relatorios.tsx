import { useMemo, useState, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
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
import { BarChart3, LineChartIcon, PieChartIcon, TrendingUp, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

const Relatorios = () => {
  const { usuarioId, usuario } = useUsuarioId();
  const { transacoes, loading } = useTransacoes(usuarioId || undefined);
  const [periodo, setPeriodo] = useState('3');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPeriodo, setExportPeriodo] = useState<'mensal' | 'semanal' | 'personalizado'>('mensal');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

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

  const handleExport = useCallback(() => {
    let startDate: Date;
    let endDate: Date;
    const now = new Date();

    if (exportPeriodo === 'mensal') {
      startDate = startOfMonth(now);
      endDate = endOfMonth(now);
    } else if (exportPeriodo === 'semanal') {
      startDate = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      endDate = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    } else {
      if (!customStart || !customEnd) return;
      startDate = new Date(customStart + 'T00:00:00');
      endDate = new Date(customEnd + 'T23:59:59');
    }

    const filtered = transacoes.filter((t) => {
      const d = new Date(t.data);
      return d >= startDate && d <= endDate;
    });

    const entradas = filtered.filter(t => t.tipo === 'entrada');
    const saidas = filtered.filter(t => t.tipo === 'saida');
    const totalEnt = entradas.reduce((s, t) => s + Number(t.valor), 0);
    const totalSai = saidas.reduce((s, t) => s + Number(t.valor), 0);

    // Por categoria
    const porCat: Record<string, number> = {};
    saidas.forEach(t => {
      const cat = CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria;
      porCat[cat] = (porCat[cat] || 0) + Number(t.valor);
    });

    const wb = XLSX.utils.book_new();

    // Sheet 1: Resumo
    const resumoData = [
      ['RELATÓRIO FINANCEIRO - FINAX'],
      [''],
      ['Usuário', usuario?.nome || 'Usuário'],
      ['Período', `${format(startDate, 'dd/MM/yyyy')} a ${format(endDate, 'dd/MM/yyyy')}`],
      ['Gerado em', format(now, 'dd/MM/yyyy HH:mm')],
      [''],
      ['RESUMO'],
      ['Total de Entradas', totalEnt],
      ['Total de Saídas', totalSai],
      ['Saldo do Período', totalEnt - totalSai],
      [''],
      ['GASTOS POR CATEGORIA'],
      ['Categoria', 'Valor', '% do Total'],
      ...Object.entries(porCat)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, val]) => [cat, val, totalSai > 0 ? ((val / totalSai) * 100).toFixed(1) + '%' : '0%']),
    ];
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
    wsResumo['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    // Sheet 2: Todas as transações
    const txHeaders = ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Forma Pgto', 'Cartão'];
    const txRows = filtered
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .map(t => [
        format(new Date(t.data), 'dd/MM/yyyy'),
        t.observacao || t.categoria || '',
        CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        t.tipo === 'entrada' ? 'Receita' : 'Despesa',
        Number(t.valor),
        '',
        '',
      ]);
    const wsTx = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows]);
    wsTx['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsTx, 'Transações');

    // Sheet 3: Entradas
    const entRows = entradas
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .map(t => [
        format(new Date(t.data), 'dd/MM/yyyy'),
        t.observacao || t.categoria || '',
        CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        Number(t.valor),
      ]);
    const wsEnt = XLSX.utils.aoa_to_sheet([['Data', 'Descrição', 'Categoria', 'Valor'], ...entRows, ['', '', 'TOTAL', totalEnt]]);
    wsEnt['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsEnt, 'Entradas');

    // Sheet 4: Saídas
    const saiRows = saidas
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .map(t => [
        format(new Date(t.data), 'dd/MM/yyyy'),
        t.observacao || t.categoria || '',
        CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        Number(t.valor),
      ]);
    const wsSai = XLSX.utils.aoa_to_sheet([['Data', 'Descrição', 'Categoria', 'Valor'], ...saiRows, ['', '', 'TOTAL', totalSai]]);
    wsSai['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSai, 'Saídas');

    const fileName = `Finax_Relatorio_${format(startDate, 'yyyy-MM-dd')}_a_${format(endDate, 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setExportOpen(false);
  }, [transacoes, exportPeriodo, customStart, customEnd, usuario]);

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
                className="bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Baixar Planilha
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
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-emerald-500/10"><TrendingUp className="w-5 h-5 text-emerald-400" /></div>
                <p className="text-sm text-slate-500">Total Entradas ({periodo} meses)</p>
              </div>
              <p className="text-3xl font-bold text-emerald-400">{formatCurrency(totalEntradas)}</p>
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-red-500/10"><BarChart3 className="w-5 h-5 text-red-400" /></div>
                <p className="text-sm text-slate-500">Total Saídas ({periodo} meses)</p>
              </div>
              <p className="text-3xl font-bold text-red-400">{formatCurrency(totalSaidas)}</p>
            </div>
          </motion.div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Evolução Mensal */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/10"><BarChart3 className="w-5 h-5 text-indigo-400" /></div>
                <h3 className="font-bold text-lg text-white">Evolução Mensal</h3>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center"><div className="animate-pulse text-slate-500">Carregando...</div></div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dadosMensais}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)}
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '12px', color: '#fff' }} />
                    <Bar dataKey="entradas" fill="#22c55e" radius={[4, 4, 0, 0]} name="Entradas" />
                    <Bar dataKey="saidas" fill="#ef4444" radius={[4, 4, 0, 0]} name="Saídas" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </motion.div>

            {/* Saldo ao Longo do Tempo */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/10"><LineChartIcon className="w-5 h-5 text-indigo-400" /></div>
                <h3 className="font-bold text-lg text-white">Saldo ao Longo do Tempo</h3>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center"><div className="animate-pulse text-slate-500">Carregando...</div></div>
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
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)}
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '12px', color: '#fff' }} />
                    <Area type="monotone" dataKey="saldo" stroke="#6366f1" strokeWidth={3}
                      fillOpacity={1} fill="url(#saldoGradient)" name="Saldo" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </motion.div>

            {/* Gastos por Categoria */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 lg:col-span-2 hover:border-indigo-500/30 transition-all">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/10"><PieChartIcon className="w-5 h-5 text-indigo-400" /></div>
                <h3 className="font-bold text-lg text-white">Gastos por Categoria (Mês Atual)</h3>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center"><div className="animate-pulse text-slate-500">Carregando...</div></div>
              ) : dadosCategorias.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center"><p className="text-slate-500">Nenhum gasto registrado este mês.</p></div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={dadosCategorias} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="valor">
                        {dadosCategorias.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)}
                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '12px', color: '#fff' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3">
                    {dadosCategorias.slice(0, 6).map((cat, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.fill }} />
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

      {/* Export Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              Exportar Relatório
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Período</Label>
              <Select value={exportPeriodo} onValueChange={(v) => setExportPeriodo(v as any)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="mensal" className="text-white">Mês Atual</SelectItem>
                  <SelectItem value="semanal" className="text-white">Última Semana</SelectItem>
                  <SelectItem value="personalizado" className="text-white">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {exportPeriodo === 'personalizado' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Data Início</Label>
                  <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Data Fim</Label>
                  <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white" />
                </div>
              </div>
            )}

            <div className="p-4 rounded-xl bg-slate-800/50 border border-white/5 space-y-2">
              <p className="text-sm text-slate-400">A planilha incluirá:</p>
              <ul className="text-sm text-slate-300 space-y-1">
                <li>📊 <strong>Resumo</strong> — Entradas, saídas, saldo, gastos por categoria</li>
                <li>📋 <strong>Transações</strong> — Lista completa com data, descrição, categoria, valor</li>
                <li>💰 <strong>Entradas</strong> — Todas as receitas do período</li>
                <li>💸 <strong>Saídas</strong> — Todas as despesas do período</li>
              </ul>
            </div>

            <Button onClick={handleExport}
              className="w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 flex items-center gap-2"
              disabled={exportPeriodo === 'personalizado' && (!customStart || !customEnd)}>
              <Download className="w-4 h-4" />
              Baixar .xlsx
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Relatorios;
