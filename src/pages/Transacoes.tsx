import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { TransactionList } from '@/components/transacoes/TransactionList';
import { TransactionForm } from '@/components/transacoes/TransactionForm';
import { useTransacoes } from '@/hooks/useTransacoes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, Filter, TrendingUp, TrendingDown, Wallet, ArrowUpDown } from 'lucide-react';
import { CATEGORIAS } from '@/types/finance';
import { motion } from 'framer-motion';

const Transacoes = () => {
  const { transacoes, loading, addTransacao, deleteTransacao } = useTransacoes();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategoria, setFilterCategoria] = useState<string>('all');
  const [filterTipo, setFilterTipo] = useState<string>('all');

  const filteredTransacoes = useMemo(() => {
    return transacoes.filter((t) => {
      const matchSearch =
        !search ||
        t.observacao?.toLowerCase().includes(search.toLowerCase()) ||
        t.categoria.toLowerCase().includes(search.toLowerCase());

      const matchCategoria = filterCategoria === 'all' || t.categoria === filterCategoria;
      const matchTipo = filterTipo === 'all' || t.tipo === filterTipo;

      return matchSearch && matchCategoria && matchTipo;
    });
  }, [transacoes, search, filterCategoria, filterTipo]);

  const stats = useMemo(() => {
    const entradas = filteredTransacoes.filter(t => t.tipo === 'entrada').reduce((acc, t) => acc + Number(t.valor), 0);
    const saidas = filteredTransacoes.filter(t => t.tipo === 'saida').reduce((acc, t) => acc + Number(t.valor), 0);
    return { entradas, saidas, saldo: entradas - saidas };
  }, [filteredTransacoes]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
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
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        {/* Background Effects */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
        </div>

        {/* Grid Pattern */}
        <div className="fixed inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

        <div className="relative z-10 max-w-[1800px] mx-auto space-y-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
          >
            <div>
              <p className="text-slate-500 font-medium mb-1">Gestão financeira</p>
              <h1 className="text-4xl font-bold text-white">
                Transações <span className="text-indigo-400">📊</span>
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

          {/* Quick Stats */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Entradas</p>
                  <p className="text-xl font-bold text-emerald-400">{formatCurrency(stats.entradas)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-4 hover:border-red-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Saídas</p>
                  <p className="text-xl font-bold text-red-400">{formatCurrency(stats.saidas)}</p>
                </div>
              </div>
            </div>

            <div className={`bg-slate-900/40 backdrop-blur-xl border ${stats.saldo >= 0 ? 'border-indigo-500/20 hover:border-indigo-500/40' : 'border-amber-500/20 hover:border-amber-500/40'} rounded-2xl p-4 transition-all`}>
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${stats.saldo >= 0 ? 'bg-indigo-500/10' : 'bg-amber-500/10'}`}>
                  <Wallet className={`w-5 h-5 ${stats.saldo >= 0 ? 'text-indigo-400' : 'text-amber-400'}`} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Saldo</p>
                  <p className={`text-xl font-bold ${stats.saldo >= 0 ? 'text-indigo-400' : 'text-amber-400'}`}>{formatCurrency(stats.saldo)}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Filters */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-4"
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <Input
                  placeholder="Buscar transações..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-12 h-12 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 rounded-xl focus:border-indigo-500"
                />
              </div>
              <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                <SelectTrigger className="w-full sm:w-[200px] h-12 bg-slate-800/50 border-slate-700 text-white rounded-xl">
                  <Filter className="w-4 h-4 mr-2 text-slate-500" />
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">Todas categorias</SelectItem>
                  {CATEGORIAS.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value} className="text-white">
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterTipo} onValueChange={setFilterTipo}>
                <SelectTrigger className="w-full sm:w-[160px] h-12 bg-slate-800/50 border-slate-700 text-white rounded-xl">
                  <ArrowUpDown className="w-4 h-4 mr-2 text-slate-500" />
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">Todos</SelectItem>
                  <SelectItem value="entrada" className="text-emerald-400">Entradas</SelectItem>
                  <SelectItem value="saida" className="text-red-400">Saídas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </motion.div>

          {/* Results Count */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-between"
          >
            <p className="text-slate-500 text-sm">
              {filteredTransacoes.length} transação(ões) encontrada(s)
            </p>
          </motion.div>

          {/* Transaction List */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <TransactionList
              transacoes={filteredTransacoes}
              onDelete={deleteTransacao}
              loading={loading}
            />
          </motion.div>
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

export default Transacoes;
