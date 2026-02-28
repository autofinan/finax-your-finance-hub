import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/dashboard/StatCard';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { ExpenseChart } from '@/components/dashboard/ExpenseChart';
import { ExpenseTypeBreakdown } from '@/components/dashboard/ExpenseTypeBreakdown';
import { PlanoCard } from '@/components/dashboard/PlanoCard';
import { BudgetCard } from '@/components/dashboard/BudgetCard';
import { InsightDoDia } from '@/components/dashboard/InsightDoDia';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { FreedomCard } from '@/components/dashboard/FreedomCard';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useDashboard } from '@/hooks/useDashboard';
import { usePlanoStatus } from '@/hooks/usePlanoStatus';
import { useAuth } from '@/contexts/AuthContext';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { Wallet, TrendingUp, TrendingDown, RefreshCcw, Plus, Sparkles, Calendar } from 'lucide-react';
import { useState, useMemo } from 'react';
import { TransactionForm } from '@/components/transacoes/TransactionForm';
import { motion } from 'framer-motion';
import { formatCurrency } from '@/lib/utils';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  ResponsiveContainer,
  Tooltip 
} from 'recharts';

const Dashboard = () => {
  const { user, isTrialExpirado, isTrial } = useAuth();
  const { usuarioId } = useUsuarioId();
  const { transacoes, loading, addTransacao } = useTransacoes(usuarioId || undefined);
  const { dashboard } = useDashboard(usuarioId || undefined);
  const { diasRestantesTrial } = usePlanoStatus();
  const [formOpen, setFormOpen] = useState(false);

  // Use view data for stats (server-side calculation)
  const stats = useMemo(() => ({
    totalEntradas: Number(dashboard?.total_entradas_mes || 0),
    totalSaidas: Number(dashboard?.total_gastos_mes || 0),
    saldo: Number(dashboard?.saldo_mes || 0),
    gastosRecorrentes: Number(dashboard?.total_fixos_mes || 0),
  }), [dashboard]);

  const handleAddTransaction = async (data: {
    tipo: 'entrada' | 'saida';
    valor: number;
    categoria: string;
    observacao: string;
    data: string;
  }) => {
    await addTransacao({
      tipo: data.tipo,
      valor: data.valor,
      categoria: data.categoria,
      observacao: data.observacao,
      data: data.data,
    });
  };

  // Dados reais do fluxo semanal (últimos 7 dias)
  const flowData = useMemo(() => {
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const hoje = new Date();
    const resultado = [];
    for (let i = 6; i >= 0; i--) {
      const dia = new Date(hoje);
      dia.setDate(hoje.getDate() - i);
      const diaStr = dia.toISOString().split('T')[0];
      const totalDia = transacoes
        .filter((t) => t.data && t.data.split('T')[0] === diaStr && t.tipo === 'saida')
        .reduce((acc, t) => acc + Number(t.valor), 0);
      resultado.push({ name: dias[dia.getDay()], value: totalDia });
    }
    return resultado;
  }, [transacoes]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        <div className="relative z-10 max-w-[1800px] mx-auto space-y-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
          >
            <div>
              <p className="text-slate-500 font-medium mb-1">Bem-vindo de volta{user?.nome ? `, ${user.nome}` : ''}!</p>
              <h1 className="text-4xl font-bold text-white">
                Comando Central <span className="text-indigo-400">Finax</span>
              </h1>
            </div>
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-500 px-6 py-3 rounded-xl font-bold text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:scale-[1.02]"
            >
              <Plus className="w-5 h-5" />
              Nova Transação
            </button>
          </motion.div>

          {/* Trial Alerts */}
          {(isTrial || isTrialExpirado) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl backdrop-blur-xl"
            >
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <p className="text-sm text-amber-300">
                  {isTrialExpirado
                    ? '⏰ Seu período de teste acabou. Escolha um plano para continuar!'
                    : `⏰ Seu trial acaba em ${diasRestantesTrial} dias. Aproveite!`
                  }
                </p>
              </div>
            </motion.div>
          )}

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Saldo do Mês"
              value={formatCurrency(stats.saldo)}
              icon={<Wallet className="w-5 h-5" />}
              variant={stats.saldo >= 0 ? 'success' : 'danger'}
              delay={0}
            />
            <StatCard
              title="Entradas"
              value={formatCurrency(stats.totalEntradas)}
              icon={<TrendingUp className="w-5 h-5" />}
              variant="success"
              delay={0.1}
            />
            <StatCard
              title="Saídas"
              value={formatCurrency(stats.totalSaidas)}
              icon={<TrendingDown className="w-5 h-5" />}
              variant="danger"
              delay={0.2}
            />
            <StatCard
              title="Gastos Recorrentes"
              value={formatCurrency(stats.gastosRecorrentes)}
              icon={<RefreshCcw className="w-5 h-5" />}
              delay={0.3}
            />
          </div>

          {/* Insights IA Card - FIXO NO DASHBOARD */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-gradient-to-r from-indigo-950/50 to-blue-950/50 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-6 shadow-xl shadow-indigo-500/10"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-indigo-500/20 flex-shrink-0">
                <Sparkles className="w-6 h-6 text-indigo-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-white mb-2">💡 Insight do Dia</h3>
                <InsightDoDia transacoes={transacoes} stats={stats} />
              </div>
            </div>
          </motion.div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - 2/3 */}
            <div className="lg:col-span-2 space-y-6">
              {/* Fluxo de Caixa Semanal */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-500"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-indigo-500/10">
                      <Calendar className="w-5 h-5 text-indigo-400" />
                    </div>
                    <h3 className="font-bold text-lg text-white">Fluxo Semanal</h3>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={flowData}>
                    <defs>
                      <linearGradient id="colorFlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="name" 
                      stroke="#475569" 
                      style={{ fontSize: '12px' }}
                    />
                    <YAxis 
                      stroke="#475569" 
                      style={{ fontSize: '12px' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '12px',
                        color: '#fff'
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="value" 
                      stroke="#6366f1" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorFlow)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>

              <RecentTransactions transacoes={transacoes} loading={loading} />
              <ExpenseTypeBreakdown transacoes={transacoes} />
              <ExpenseChart transacoes={transacoes} />
            </div>

            {/* Right Column - 1/3 */}
            <div className="space-y-6">
              <FreedomCard usuarioId={usuarioId || undefined} />
              <PlanoCard />
              <BudgetCard />
              <QuickActions onAddTransaction={() => setFormOpen(true)} />
            </div>
          </div>
        </div>
      </div>

      <TransactionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleAddTransaction}
      />
    </AppLayout>
  );
};

export default Dashboard;
