import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/dashboard/StatCard';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { ExpenseChart } from '@/components/dashboard/ExpenseChart';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useGastosRecorrentes } from '@/hooks/useGastosRecorrentes';
import { Wallet, TrendingUp, TrendingDown, RefreshCcw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { TransactionForm } from '@/components/transacoes/TransactionForm';
import { useMemo } from 'react';

const Index = () => {
  const { transacoes, loading, addTransacao } = useTransacoes();
  const { gastos } = useGastosRecorrentes();
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
      <div className="space-y-8">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RecentTransactions transacoes={transacoes} loading={loading} />
          <ExpenseChart transacoes={transacoes} />
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

export default Index;
