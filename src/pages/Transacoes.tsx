import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { TransactionList } from '@/components/transacoes/TransactionList';
import { TransactionForm } from '@/components/transacoes/TransactionForm';
import { CSVImportModal } from '@/components/transacoes/CSVImportModal';
import { useTransacoes } from '@/hooks/useTransacoes';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, Filter, TrendingUp, TrendingDown, Wallet, ArrowUpDown, CalendarDays, Upload } from 'lucide-react';
import { CATEGORIAS } from '@/types/finance';
import { motion } from 'framer-motion';

const Transacoes = () => {
  // Usar usuarioId do WhatsApp (não auth.uid)
  const { usuarioId } = useUsuarioId();
  const { transacoes, loading, addTransacao, deleteTransacao } = useTransacoes(usuarioId || undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategoria, setFilterCategoria] = useState<string>('all');
  const [filterTipo, setFilterTipo] = useState<string>('all');
  const [dataInicio, setDataInicio] = useState<string>('');
  const [dataFim, setDataFim] = useState<string>('');

  const filteredTransacoes = useMemo(() => {
    return transacoes.filter((t) => {
      const matchSearch =
        !search ||
        t.observacao?.toLowerCase().includes(search.toLowerCase()) ||
        t.categoria.toLowerCase().includes(search.toLowerCase());

      const matchCategoria = filterCategoria === 'all' || t.categoria === filterCategoria;
      const matchTipo = filterTipo === 'all' || t.tipo === filterTipo;
      
      // Filtro por período de datas
      let matchData = true;
      if (dataInicio && dataFim) {
        const transDate = new Date(t.data);
        const inicio = new Date(dataInicio);
        const fim = new Date(dataFim);
        fim.setHours(23, 59, 59, 999); // Incluir o dia final completo
        matchData = transDate >= inicio && transDate <= fim;
      } else if (dataInicio) {
        const transDate = new Date(t.data);
        const inicio = new Date(dataInicio);
        matchData = transDate >= inicio;
      } else if (dataFim) {
        const transDate = new Date(t.data);
        const fim = new Date(dataFim);
        fim.setHours(23, 59, 59, 999);
        matchData = transDate <= fim;
      }

      return matchSearch && matchCategoria && matchTipo && matchData;
    });
  }, [transacoes, search, filterCategoria, filterTipo, dataInicio, dataFim]);

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
            <div className="flex gap-3">
              <button
                onClick={() => setCsvOpen(true)}
                className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-4 py-3 rounded-xl font-bold text-slate-300 hover:bg-slate-700 transition-all"
              >
                <Upload className="w-5 h-5" />
                Importar CSV
              </button>
              <button
                onClick={() => setFormOpen(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-500 px-6 py-3 rounded-xl font-bold text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:scale-[1.02]"
              >
                <Plus className="w-5 h-5" />
                Nova Transação
              </button>
            </div>
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
          {/* Filters */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-4"
          >
            <div className="flex flex-col gap-3">
              {/* Linha 1: Busca e Filtros de Tipo/Categoria */}
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
              
              {/* Linha 2: Filtro por Período de Datas com Atalhos */}
              <div className="flex flex-col gap-2">
                {/* Atalhos Rápidos - FIX DASH-2 */}
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  <button
                    onClick={() => {
                      const today = new Date().toISOString().split('T')[0];
                      setDataInicio(today);
                      setDataFim(today);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-indigo-500/20 hover:text-indigo-400 border border-slate-700 hover:border-indigo-500/30 transition-all whitespace-nowrap"
                  >
                    Hoje
                  </button>
                  <button
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(start.getDate() - 6);
                      setDataInicio(start.toISOString().split('T')[0]);
                      setDataFim(end.toISOString().split('T')[0]);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-indigo-500/20 hover:text-indigo-400 border border-slate-700 hover:border-indigo-500/30 transition-all whitespace-nowrap"
                  >
                    7 dias
                  </button>
                  <button
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(start.getDate() - 29);
                      setDataInicio(start.toISOString().split('T')[0]);
                      setDataFim(end.toISOString().split('T')[0]);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-indigo-500/20 hover:text-indigo-400 border border-slate-700 hover:border-indigo-500/30 transition-all whitespace-nowrap"
                  >
                    30 dias
                  </button>
                  <button
                    onClick={() => {
                      const now = new Date();
                      const start = new Date(now.getFullYear(), now.getMonth(), 1);
                      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                      setDataInicio(start.toISOString().split('T')[0]);
                      setDataFim(end.toISOString().split('T')[0]);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-indigo-500/20 hover:text-indigo-400 border border-slate-700 hover:border-indigo-500/30 transition-all whitespace-nowrap"
                  >
                    Este mês
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <div className="flex items-center gap-2 text-slate-500">
                    <CalendarDays className="w-4 h-4" />
                    <span className="text-sm">Período:</span>
                  </div>
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                    className="w-full sm:w-[160px] h-10 bg-slate-800/50 border-slate-700 text-white rounded-xl focus:border-indigo-500"
                  />
                  <span className="text-slate-500 text-sm">até</span>
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className="w-full sm:w-[160px] h-10 bg-slate-800/50 border-slate-700 text-white rounded-xl focus:border-indigo-500"
                  />
                  {(dataInicio || dataFim) && (
                    <button
                      onClick={() => { setDataInicio(''); setDataFim(''); }}
                      className="text-xs text-slate-400 hover:text-white underline"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>
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

      {usuarioId && (
        <CSVImportModal
          open={csvOpen}
          onOpenChange={setCsvOpen}
          usuarioId={usuarioId}
          onSuccess={() => window.location.reload()}
        />
      )}
    </AppLayout>
  );
};

export default Transacoes;
