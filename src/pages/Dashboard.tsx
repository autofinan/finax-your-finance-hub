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
import { Wallet, TrendingUp, TrendingDown, RefreshCcw, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useMemo } from 'react';
import { TransactionForm } from '@/components/transacoes/TransactionForm';
import { Alert, AlertDescription } from '@/components/ui/alert';

const Dashboard = () => {
  const { transacoes, loading, addTransacao } = useTransacoes();
  const { gastos } = useGastosRecorrentes();
  const { planoStatus, isTrialExpirado, isTrial } = usePlanoStatus();
  const [formOpen, setFormOpen] = useState(false);

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

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">Visão geral das suas finanças</p>
          </div>
          <Button onClick={() => setFormOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Nova Transação
          </Button>
        </div>

        {/* Alertas de Trial */}
        {isTrial && planoStatus?.diasRestantesTrial && planoStatus.diasRestantesTrial <= 4 && (
          <Alert variant={planoStatus.alertaTrial === 'urgente' ? 'destructive' : 'default'}>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {planoStatus.diasRestantesTrial === 1 
                ? '⏰ Último dia do seu trial! Escolha um plano para continuar usando o Finax.'
                : `⏰ Seu trial acaba em ${planoStatus.diasRestantesTrial} dias. Aproveite para escolher um plano!`
              }
            </AlertDescription>
          </Alert>
        )}

        {isTrialExpirado && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Seu período de teste acabou. Escolha um plano para continuar organizando suas finanças!
            </AlertDescription>
          </Alert>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Saldo do Mês"
            value={formatCurrency(stats.saldo)}
            icon={<Wallet className="w-5 h-5" />}
            variant={stats.saldo >= 0 ? 'success' : 'danger'}
          />
          <StatCard
            title="Entradas"
            value={formatCurrency(stats.totalEntradas)}
            icon={<TrendingUp className="w-5 h-5" />}
            variant="success"
          />
          <StatCard
            title="Saídas"
            value={formatCurrency(stats.totalSaidas)}
            icon={<TrendingDown className="w-5 h-5" />}
            variant="danger"
          />
          <StatCard
            title="Gastos Recorrentes"
            value={formatCurrency(stats.gastosRecorrentes)}
            icon={<RefreshCcw className="w-5 h-5" />}
          />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <RecentTransactions transacoes={transacoes} loading={loading} />
            <ExpenseChart transacoes={transacoes} />
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-6">
            <PlanoCard />
            <BudgetCard />
            <QuickActions onAddTransaction={() => setFormOpen(true)} />
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
