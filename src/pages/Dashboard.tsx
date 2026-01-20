import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/dashboard/StatCard';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { ExpenseChart } from '@/components/dashboard/ExpenseChart';
import { PlanoCard } from '@/components/dashboard/PlanoCard';
import { BudgetCard } from '@/components/dashboard/BudgetCard';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useGastosRecorrentes } from '@/hooks/useGastosRecorrentes';
import { usePlanoStatus } from '@/hooks/usePlanoStatus';
import { useAuth } from '@/contexts/AuthContext';
import { Wallet, TrendingUp, TrendingDown, RefreshCcw, Plus, Sparkles, Target, Calendar, PieChart, Bot, X, Send } from 'lucide-react';
import { useState, useMemo } from 'react';
import { TransactionForm } from '@/components/transacoes/TransactionForm';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  ResponsiveContainer,
  Tooltip 
} from 'recharts';

const Dashboard = () => {
  const { user, isTrialExpirado, isTrial, loading: authLoading } = useAuth();
  const { transacoes, loading, addTransacao } = useTransacoes(user?.id);
  const { gastos } = useGastosRecorrentes(user?.id);
  const { planoStatus } = usePlanoStatus();
  const [formOpen, setFormOpen] = useState(false);
  const [finBotOpen, setFinBotOpen] = useState(false);
  const [finInput, setFinInput] = useState('');

  const stats = useMemo(() => {
    const mesAtual = new Date().getMonth();
    const anoAtual = new Date().getFullYear();

    const transacoesMes = transacoes.filter((t) => {
      const data = new Date(t.data);
      return data.getMonth() === mesAtual && data.getFullYear() === anoAtual;
    });

    const totalEntradas = transacoesMes
      .filter((t) => t.tipo === 'entrada')
      .reduce((acc, t) => acc + Number(t.valor), 0);

    const totalSaidas = transacoesMes
      .filter((t) => t.tipo === 'saida')
      .reduce((acc, t) => acc + Number(t.valor), 0);

    const gastosAtivos = gastos
      .filter((g) => g.ativo)
      .reduce((acc, g) => acc + Number(g.valor_parcela), 0);

    return {
      totalEntradas,
      totalSaidas,
      saldo: totalEntradas - totalSaidas,
      gastosRecorrentes: gastosAtivos,
    };
  }, [transacoes, gastos]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

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

  // Mock data para gráfico de fluxo
  const flowData = [
    { name: 'Seg', value: 4000 },
    { name: 'Ter', value: 3000 },
    { name: 'Qua', value: 5000 },
    { name: 'Qui', value: 2780 },
    { name: 'Sex', value: 1890 },
    { name: 'Sáb', value: 2390 },
    { name: 'Dom', value: 3490 },
  ];

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        {/* Background Effects */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
        </div>

        {/* Grid Pattern */}
        <div className="fixed inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

        <div className="relative z-10 max-w-[1800px] mx-auto space-y-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
          >
            <div>
              <p className="text-slate-500 font-medium mb-1">Bem-vindo de volta,</p>
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
                    : `⏰ Seu trial acaba em ${planoStatus?.diasRestantesTrial} dias. Aproveite!`
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
                <p className="text-slate-300 leading-relaxed mb-4">
                  Você está gastando <span className="text-white font-bold">23% a menos</span> em transporte este mês comparado ao anterior. Continue assim e você pode economizar até <span className="text-emerald-400 font-bold">R$ 450</span> até o final do ano!
                </p>
                <div className="flex items-center gap-3">
                  <button className="px-4 py-2 bg-indigo-500 rounded-lg text-white text-sm font-bold hover:bg-indigo-600 transition-all">
                    Ver detalhes
                  </button>
                  <button className="px-4 py-2 bg-white/5 rounded-lg text-slate-400 text-sm font-bold hover:bg-white/10 transition-all">
                    Próximo insight
                  </button>
                </div>
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
              <ExpenseChart transacoes={transacoes} />
            </div>

            {/* Right Column - 1/3 */}
            <div className="space-y-6">
              <PlanoCard />
              <BudgetCard />
              <QuickActions onAddTransaction={() => setFormOpen(true)} />
            </div>
          </div>
        </div>
      </div>

      {/* FIN BOT FLUTUANTE */}
      <AnimatePresence>
        {finBotOpen ? (
          <motion.div
            initial={{ opacity: 0, x: 400 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 400 }}
            className="fixed right-6 bottom-6 w-96 h-[600px] bg-slate-950 border border-indigo-500/30 rounded-2xl shadow-2xl shadow-indigo-500/20 z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/10 bg-gradient-to-r from-indigo-950 to-blue-950">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-500 rounded-xl flex items-center justify-center">
                      <Bot className="w-6 h-6 text-white" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-slate-950 rounded-full" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Fin AI</h3>
                    <p className="text-xs text-emerald-400 font-bold">Online</p>
                  </div>
                </div>
                <button
                  onClick={() => setFinBotOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 p-4 overflow-y-auto">
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="flex-1 p-3 bg-white/5 rounded-xl">
                    <p className="text-sm text-slate-300">
                      Olá! Sou o Fin, seu assistente financeiro. Como posso ajudar você hoje?
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-white/10">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={finInput}
                  onChange={(e) => setFinInput(e.target.value)}
                  placeholder="Pergunte ao Fin..."
                  className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <button className="p-3 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-xl text-white hover:shadow-lg hover:shadow-indigo-500/30 transition-all">
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            onClick={() => setFinBotOpen(true)}
            className="fixed right-6 bottom-6 w-16 h-16 bg-gradient-to-br from-indigo-500 to-blue-500 rounded-2xl shadow-2xl shadow-indigo-500/40 flex items-center justify-center z-50 hover:scale-110 transition-transform group"
          >
            <Bot className="w-8 h-8 text-white" />
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">3</span>
            </div>
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-400 to-blue-400 opacity-0 group-hover:opacity-20 transition-opacity" />
          </motion.button>
        )}
      </AnimatePresence>

      <TransactionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleAddTransaction}
      />
    </AppLayout>
  );
};

export default Dashboard;
