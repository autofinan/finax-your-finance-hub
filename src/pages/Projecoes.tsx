import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useProjecoes } from '@/hooks/useProjecoes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, BarChart3, Target, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatCurrency } from '@/lib/utils';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, BarChart, Bar, Legend,
} from 'recharts';

const Projecoes = () => {
  const { usuarioId } = useUsuarioId();
  const { transacoes } = useTransacoes(usuarioId || undefined);
  const { cenarios, mediaEntradas, mediaSaidas, tendencia } = useProjecoes(transacoes, usuarioId || undefined);
  const [periodo, setPeriodo] = useState<'3' | '6' | '12'>('6');

  const cenariosFiltrados = cenarios.filter(c => c.meses === Number(periodo));
  const realista = cenariosFiltrados.find(c => c.label.includes('Realista'));
  const otimista = cenariosFiltrados.find(c => c.label.includes('Otimista'));
  const economico = cenariosFiltrados.find(c => c.label.includes('Econômico'));

  const TendenciaIcon = tendencia === 'subindo' ? TrendingUp : tendencia === 'descendo' ? TrendingDown : Minus;
  const tendenciaColor = tendencia === 'subindo' ? 'text-red-400' : tendencia === 'descendo' ? 'text-emerald-400' : 'text-slate-400';
  const tendenciaLabel = tendencia === 'subindo' ? 'Gastos subindo' : tendencia === 'descendo' ? 'Gastos descendo' : 'Gastos estáveis';

  // Merge data for comparison chart
  const comparisonData = realista?.dados.map((d, i) => ({
    mes: d.mes,
    realista: d.saldoAcumulado,
    otimista: otimista?.dados[i]?.saldoAcumulado || 0,
    economico: economico?.dados[i]?.saldoAcumulado || 0,
  })) || [];

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        <div className="relative z-10 max-w-[1800px] mx-auto space-y-6">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-slate-500 font-medium mb-1">Planejamento</p>
              <h1 className="text-3xl lg:text-4xl font-bold text-white flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                Projeções Financeiras
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Badge className={`gap-1 ${tendenciaColor} bg-transparent border border-current`}>
                <TendenciaIcon className="w-3 h-3" />
                {tendenciaLabel}
              </Badge>
            </div>
          </motion.div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="bg-slate-900/40 border-white/5 hover:border-emerald-500/30 transition-all">
                <CardContent className="p-5">
                  <p className="text-sm text-slate-400 mb-1">Média Entradas/mês</p>
                  <p className="text-2xl font-bold text-emerald-400">{formatCurrency(mediaEntradas)}</p>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="bg-slate-900/40 border-white/5 hover:border-red-500/30 transition-all">
                <CardContent className="p-5">
                  <p className="text-sm text-slate-400 mb-1">Média Saídas/mês</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(mediaSaidas)}</p>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className="bg-slate-900/40 border-white/5 hover:border-indigo-500/30 transition-all">
                <CardContent className="p-5">
                  <p className="text-sm text-slate-400 mb-1">Margem Mensal</p>
                  <p className={`text-2xl font-bold ${mediaEntradas - mediaSaidas >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(mediaEntradas - mediaSaidas)}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Period Tabs */}
          <Tabs value={periodo} onValueChange={(v) => setPeriodo(v as '3' | '6' | '12')}>
            <TabsList className="grid w-full max-w-md grid-cols-3 bg-slate-900/60 border border-white/10">
              <TabsTrigger value="3">3 Meses</TabsTrigger>
              <TabsTrigger value="6">6 Meses</TabsTrigger>
              <TabsTrigger value="12">12 Meses</TabsTrigger>
            </TabsList>

            <TabsContent value={periodo} className="mt-6 space-y-6">
              {/* Comparison Chart */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                <h3 className="font-bold text-lg text-white mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  Saldo Acumulado — 3 Cenários
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={comparisonData}>
                    <defs>
                      <linearGradient id="gRealista" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gOtimista" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gEconomico" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="mes" stroke="#475569" style={{ fontSize: '12px' }} />
                    <YAxis stroke="#475569" style={{ fontSize: '12px' }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '12px', color: '#fff' }}
                      formatter={(value: number, name: string) => [formatCurrency(value), name === 'realista' ? 'Realista' : name === 'otimista' ? 'Otimista' : 'Econômico']}
                    />
                    <Legend formatter={(value) => value === 'realista' ? 'Realista' : value === 'otimista' ? 'Otimista (-10%)' : 'Econômico (-20%)'} />
                    <Area type="monotone" dataKey="realista" stroke="#6366f1" strokeWidth={2} fill="url(#gRealista)" />
                    <Area type="monotone" dataKey="otimista" stroke="#10b981" strokeWidth={2} fill="url(#gOtimista)" />
                    <Area type="monotone" dataKey="economico" stroke="#f59e0b" strokeWidth={2} fill="url(#gEconomico)" />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>

              {/* Scenario Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {cenariosFiltrados.map((cenario, i) => {
                  const colors = [
                    { border: 'border-indigo-500/30', bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
                    { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
                    { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
                  ][i];
                  return (
                    <motion.div key={cenario.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * i }}>
                      <Card className={`bg-slate-900/40 ${colors.border} border hover:shadow-lg transition-all`}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-white text-base flex items-center gap-2">
                            <Target className={`w-4 h-4 ${colors.text}`} />
                            {cenario.label.split('—')[1]?.trim() || cenario.label}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className={`p-3 ${colors.bg} rounded-xl`}>
                            <p className="text-xs text-slate-400">Saldo acumulado</p>
                            <p className={`text-xl font-bold ${cenario.saldoFinal >= 0 ? colors.text : 'text-red-400'}`}>
                              {formatCurrency(cenario.saldoFinal)}
                            </p>
                          </div>
                          {cenario.economiaPotencial > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-400">Economia vs atual</span>
                              <span className={`font-semibold ${colors.text}`}>+{formatCurrency(cenario.economiaPotencial)}</span>
                            </div>
                          )}
                          {cenario.dividaRestante > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-400">Dívida restante</span>
                              <span className="text-red-400 font-semibold">{formatCurrency(cenario.dividaRestante)}</span>
                            </div>
                          )}
                          {cenario.dividaRestante === 0 && (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                              🎉 Livre de dívidas!
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>

              {/* Monthly Breakdown */}
              {realista && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                  <h3 className="font-bold text-lg text-white mb-4">Fluxo Mensal Projetado (Realista)</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={realista.dados}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="mes" stroke="#475569" style={{ fontSize: '12px' }} />
                      <YAxis stroke="#475569" style={{ fontSize: '12px' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '12px', color: '#fff' }}
                        formatter={(value: number) => formatCurrency(value)}
                      />
                      <Legend />
                      <Bar dataKey="entradas" name="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="saidas" name="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
            </TabsContent>
          </Tabs>

          {/* Empty State */}
          {transacoes.length === 0 && (
            <Card className="bg-slate-900/40 border-white/5">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <BarChart3 className="w-16 h-16 text-slate-600 mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Sem dados para projetar</h3>
                <p className="text-slate-400 max-w-md">
                  Registre transações por pelo menos 1 mês para ver projeções financeiras.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Projecoes;
