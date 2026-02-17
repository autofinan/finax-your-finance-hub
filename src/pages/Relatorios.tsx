import { useMemo, useState, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useUsuarioId } from '@/hooks/useUsuarioId';
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
import * as XLSX from 'xlsx';

// ─── Mapeamento de categorias do FINAX para grupos financeiros ────────────────
const GRUPO_CATEGORIAS: Record<string, string> = {
  // Necessidades Básicas
  moradia: 'Necessidades Básicas',
  alimentacao: 'Necessidades Básicas',
  transporte: 'Necessidades Básicas',
  saude: 'Necessidades Básicas',
  educacao_basica: 'Necessidades Básicas',
  servicos: 'Necessidades Básicas',
  contas: 'Necessidades Básicas',
  // Lazer
  lazer: 'Lazer',
  restaurante: 'Lazer',
  viagem: 'Lazer',
  assinaturas: 'Lazer',
  entretenimento: 'Lazer',
  compras: 'Lazer',
  // Investimentos
  investimento: 'Investimentos',
  poupanca: 'Investimentos',
  reserva: 'Investimentos',
  // Outros (default)
  outros: 'Outros',
};

function getGrupo(categoriaValue: string): string {
  const lower = categoriaValue?.toLowerCase() || '';
  for (const [key, grupo] of Object.entries(GRUPO_CATEGORIAS)) {
    if (lower.includes(key)) return grupo;
  }
  return 'Outros';
}

const GRUPOS_ORDEM = ['Necessidades Básicas', 'Lazer', 'Investimentos', 'Outros'];

const Relatorios = () => {
  const { usuarioId, usuario } = useUsuarioId();
  const { transacoes, loading } = useTransacoes(usuarioId || undefined);
  const [periodo, setPeriodo] = useState('3');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPeriodo, setExportPeriodo] = useState<'mensal' | 'semanal' | 'personalizado'>('mensal');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [exportSuccess, setExportSuccess] = useState(false);

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

  // Evolução patrimonial: saldo acumulado mês a mês
  const evolucaoPatrimonial = useMemo(() => {
    let acumulado = 0;
    return dadosMensais.map((m) => {
      acumulado += m.saldo;
      return { name: m.name, fullName: m.fullName, acumulado };
    });
  }, [dadosMensais]);

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

  // ─── Pré-visualização do que será exportado ────────────────────────────────
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

  // ─── Exportação XLSX melhorada ─────────────────────────────────────────────
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

    // Por categoria com nome legível
    const porCat: Record<string, { valor: number; grupo: string }> = {};
    saidas.forEach(t => {
      const cat = CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria;
      const grupo = getGrupo(t.categoria);
      if (!porCat[cat]) porCat[cat] = { valor: 0, grupo };
      porCat[cat].valor += Number(t.valor);
    });

    // Por grupo financeiro
    const porGrupo: Record<string, number> = {};
    GRUPOS_ORDEM.forEach(g => { porGrupo[g] = 0; });
    Object.values(porCat).forEach(({ valor, grupo }) => {
      porGrupo[grupo] = (porGrupo[grupo] || 0) + valor;
    });

    const wb = XLSX.utils.book_new();

    // ── ABA 1: RESUMO ──────────────────────────────────────────────────────
    const periodoLabel = `${format(startDate, 'dd/MM/yyyy')} a ${format(endDate, 'dd/MM/yyyy')}`;
    const saldoLabel = totalEnt - totalSai >= 0 ? 'POSITIVO ✓' : 'NEGATIVO ✗';

    const resumoData: (string | number)[][] = [
      ['RELATÓRIO FINANCEIRO'],
      ['Gerado pelo FINAX — Seu Assistente Financeiro'],
      [''],
      ['Usuário', usuario?.nome || 'Usuário'],
      ['Período', periodoLabel],
      ['Gerado em', format(now, "dd/MM/yyyy 'às' HH:mm")],
      [''],
      ['═══ RESUMO DO PERÍODO ═══', '', ''],
      ['', 'Valor (R$)', 'Participação'],
      ['Total de Receitas', totalEnt, '100%'],
      ['Total de Despesas', totalSai, totalEnt > 0 ? `${((totalSai / totalEnt) * 100).toFixed(1)}%` : '0%'],
      ['Saldo do Período', totalEnt - totalSai, saldoLabel],
      ['Total de Transações', filtered.length, `${entradas.length} receitas / ${saidas.length} despesas`],
      [''],
      ['═══ DESPESAS POR GRUPO FINANCEIRO ═══', '', ''],
      ['Grupo', 'Total Gasto (R$)', '% das Despesas'],
      ...GRUPOS_ORDEM
        .filter(g => porGrupo[g] > 0)
        .map(g => [g, porGrupo[g], totalSai > 0 ? `${((porGrupo[g] / totalSai) * 100).toFixed(1)}%` : '0%']),
      [''],
      ['═══ DESPESAS POR CATEGORIA ═══', '', ''],
      ['Categoria', 'Grupo', 'Total Gasto (R$)', '% das Despesas'],
      ...Object.entries(porCat)
        .sort((a, b) => b[1].valor - a[1].valor)
        .map(([cat, { valor, grupo }]) => [
          cat,
          grupo,
          valor,
          totalSai > 0 ? `${((valor / totalSai) * 100).toFixed(1)}%` : '0%',
        ]),
    ];

    const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
    wsResumo['!cols'] = [{ wch: 32 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, '📊 Resumo');

    // ── ABA 2: TODAS AS TRANSAÇÕES ─────────────────────────────────────────
    const txHeaders = ['Data', 'Descrição', 'Categoria', 'Grupo Financeiro', 'Tipo', 'Valor (R$)'];
    const txRows = filtered
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .map(t => [
        format(new Date(t.data), 'dd/MM/yyyy'),
        t.observacao || CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        t.tipo === 'saida' ? getGrupo(t.categoria) : 'Receita',
        t.tipo === 'entrada' ? 'Receita' : 'Despesa',
        Number(t.valor),
      ]);

    const totaisRow = ['', '', '', '', 'TOTAIS →', totalEnt - totalSai];

    const wsTx = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows, [''], totaisRow]);
    wsTx['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsTx, '📋 Transações');

    // ── ABA 3: RECEITAS ────────────────────────────────────────────────────
    const entHeaders = ['Data', 'Descrição', 'Categoria', 'Valor (R$)'];
    const entRows = entradas
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .map(t => [
        format(new Date(t.data), 'dd/MM/yyyy'),
        t.observacao || CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        Number(t.valor),
      ]);

    const wsEnt = XLSX.utils.aoa_to_sheet([
      entHeaders,
      ...entRows,
      [''],
      ['', '', 'TOTAL DE RECEITAS', totalEnt],
    ]);
    wsEnt['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 20 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsEnt, '💰 Receitas');

    // ── ABA 4: DESPESAS ────────────────────────────────────────────────────
    const saiHeaders = ['Data', 'Descrição', 'Categoria', 'Grupo Financeiro', 'Valor (R$)'];
    const saiRows = saidas
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .map(t => [
        format(new Date(t.data), 'dd/MM/yyyy'),
        t.observacao || CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        CATEGORIAS.find(c => c.value === t.categoria)?.label || t.categoria,
        getGrupo(t.categoria),
        Number(t.valor),
      ]);

    const wsSai = XLSX.utils.aoa_to_sheet([
      saiHeaders,
      ...saiRows,
      [''],
      ['', '', '', 'TOTAL DE DESPESAS', totalSai],
    ]);
    wsSai['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 20 }, { wch: 22 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSai, '💸 Despesas');

    // ── ABA 5: ACOMPANHAMENTO DE ORÇAMENTO ─────────────────────────────────
    // Referência: planilha modelo — compara planejado (regra 50/30/20) vs realizado
    const PERCENTUAIS: Record<string, number> = {
      'Necessidades Básicas': 0.50,
      'Lazer': 0.30,
      'Investimentos': 0.20,
      'Outros': 0,
    };

    const acompHeaders = ['Grupo Financeiro', 'Planejado (%)', 'Planejado (R$)', 'Gasto Real (R$)', 'Disponível (R$)', 'Status'];
    const acompRows = GRUPOS_ORDEM.map(grupo => {
      const perc = PERCENTUAIS[grupo] || 0;
      const planejado = totalEnt * perc;
      const gasto = porGrupo[grupo] || 0;
      const disponivel = planejado - gasto;
      const status = grupo === 'Outros' ? '—'
        : disponivel >= 0 ? '✓ Dentro do orçamento'
        : `✗ Excedido em ${formatCurrency(Math.abs(disponivel))}`;
      return [grupo, perc > 0 ? `${(perc * 100).toFixed(0)}%` : '—', perc > 0 ? planejado : '—', gasto, perc > 0 ? disponivel : '—', status];
    });

    const acompData = [
      ['ACOMPANHAMENTO DE ORÇAMENTO'],
      [`Baseado na Regra 50/30/20 | Receita do período: ${formatCurrency(totalEnt)}`],
      [''],
      acompHeaders,
      ...acompRows,
      [''],
      ['* Necessidades Básicas: moradia, alimentação, transporte, saúde'],
      ['* Lazer: restaurantes, assinaturas, entretenimento, compras'],
      ['* Investimentos: poupança, reserva de emergência, aplicações'],
    ];

    const wsAcomp = XLSX.utils.aoa_to_sheet(acompData);
    wsAcomp['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsAcomp, '🎯 Orçamento');

    const fileName = `Finax_Relatorio_${format(startDate, 'yyyy-MM-dd')}_a_${format(endDate, 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setExportSuccess(true);
    setTimeout(() => {
      setExportOpen(false);
      setExportSuccess(false);
    }, 1500);
  }, [transacoes, exportPeriodo, customStart, customEnd, usuario]);

  const periodoLabel: Record<string, string> = {
    '3': 'Últimos 3 meses',
    '6': 'Últimos 6 meses',
    '12': 'Último ano',
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
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

          {/* Summary Stats — 3 cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            {/* Entradas */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-sm text-slate-500">Total Receitas · {periodoLabel[periodo]}</p>
              </div>
              <p className="text-3xl font-bold text-emerald-400">{formatCurrency(totalEntradas)}</p>
            </div>

            {/* Saídas */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                </div>
                <p className="text-sm text-slate-500">Total Despesas · {periodoLabel[periodo]}</p>
              </div>
              <p className="text-3xl font-bold text-red-400">{formatCurrency(totalSaidas)}</p>
            </div>

            {/* Saldo Líquido */}
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

            {/* Evolução Patrimonial */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">Evolução Patrimonial</h3>
                  <p className="text-xs text-slate-500">Saldo acumulado ao longo dos meses</p>
                </div>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-pulse text-slate-500">Carregando...</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={evolucaoPatrimonial}>
                    <defs>
                      <linearGradient id="patrimonioGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => formatCurrency(v)} width={80} />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), 'Patrimônio acumulado']}
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '12px', color: '#fff' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="acumulado"
                      stroke="#22c55e"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#patrimonioGradient)"
                      name="Patrimônio"
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
              Exportar Planilha Financeira
            </DialogTitle>
          </DialogHeader>

          {exportSuccess ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-8 flex flex-col items-center gap-3"
            >
              <CheckCircle2 className="w-16 h-16 text-emerald-400" />
              <p className="text-lg font-bold text-white">Planilha exportada!</p>
              <p className="text-sm text-slate-400">O arquivo foi baixado para o seu dispositivo.</p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {/* Seletor de período */}
              <div className="space-y-2">
                <Label className="text-slate-300 font-medium">Período do relatório</Label>
                <Select value={exportPeriodo} onValueChange={(v) => setExportPeriodo(v as any)}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="mensal" className="text-white">📅 Mês Atual</SelectItem>
                    <SelectItem value="semanal" className="text-white">📆 Última Semana</SelectItem>
                    <SelectItem value="personalizado" className="text-white">🗓️ Período Personalizado</SelectItem>
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

              {/* Pré-visualização */}
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
                  <p className="text-xs text-slate-500 text-center">{previewExport.total} transação(ões) no período</p>
                </div>
              ) : exportPeriodo === 'personalizado' ? (
                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <p className="text-sm text-slate-500">Selecione as datas para ver a pré-visualização.</p>
                </div>
              ) : null}

              {/* O que a planilha inclui */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-white/5 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">A planilha incluirá 5 abas:</p>
                <div className="space-y-1.5">
                  {[
                    { icon: '📊', name: 'Resumo', desc: 'Totais, saldo e gastos por categoria e grupo' },
                    { icon: '📋', name: 'Transações', desc: 'Lista completa com tipo e grupo financeiro' },
                    { icon: '💰', name: 'Receitas', desc: 'Todas as entradas do período' },
                    { icon: '💸', name: 'Despesas', desc: 'Todas as saídas agrupadas por categoria' },
                    { icon: '🎯', name: 'Orçamento', desc: 'Planejado vs. realizado pela regra 50/30/20' },
                  ].map(({ icon, name, desc }) => (
                    <div key={name} className="flex items-start gap-2">
                      <span className="text-sm flex-shrink-0">{icon}</span>
                      <p className="text-xs text-slate-300">
                        <strong>{name}</strong>
                        <span className="text-slate-500"> — {desc}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={handleExport}
                className="w-full bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90 flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                disabled={exportPeriodo === 'personalizado' && (!customStart || !customEnd)}
              >
                <Download className="w-4 h-4" />
                Baixar Planilha .xlsx
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Relatorios;
