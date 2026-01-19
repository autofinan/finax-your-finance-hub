import { AppLayout } from '@/components/layout/AppLayout';
import { useParcelamentos } from '@/hooks/useParcelamentos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, CreditCard, Calendar, TrendingDown, DollarSign, Target, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const Parcelamentos = () => {
  const { parcelamentos, parcelasAbertas, loading, addParcelamento, deleteParcelamento } = useParcelamentos();
  const [formOpen, setFormOpen] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [valorTotal, setValorTotal] = useState('');
  const [numParcelas, setNumParcelas] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valorTotal || !numParcelas) return;

    const total = parseFloat(valorTotal);
    const parcelas = parseInt(numParcelas);
    const valorParcela = total / parcelas;

    setFormLoading(true);
    try {
      await addParcelamento({
        descricao,
        valor_total: total,
        num_parcelas: parcelas,
        parcela_atual: 1,
        valor_parcela: valorParcela,
        ativa: true,
        usuario_id: null,
      });
      resetForm();
      setFormOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setDescricao('');
    setValorTotal('');
    setNumParcelas('');
  };

  const totalRestante = parcelasAbertas.reduce((acc, p) => {
    const restante = (p.parcelas_restantes || 0) * (p.valor_parcela || 0);
    return acc + restante;
  }, 0);

  const totalMensal = parcelasAbertas.reduce((acc, p) => acc + Number(p.valor_parcela || 0), 0);
  const totalOriginal = parcelasAbertas.reduce((acc, p) => acc + Number(p.valor_total || 0), 0);

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
              <p className="text-slate-500 font-medium mb-1">Acompanhamento de dívidas</p>
              <h1 className="text-4xl font-bold text-white">
                Parcelamentos <span className="text-indigo-400">📦</span>
              </h1>
            </div>
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-500 px-6 py-3 rounded-xl font-bold text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:scale-[1.02]"
            >
              <Plus className="w-5 h-5" />
              Novo Parcelamento
            </button>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            <div className="bg-slate-900/40 backdrop-blur-xl border border-indigo-500/20 rounded-2xl p-4 hover:border-indigo-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10">
                  <DollarSign className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Mensal</p>
                  <p className="text-xl font-bold text-indigo-400">{formatCurrency(totalMensal)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-4 hover:border-amber-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10">
                  <Clock className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Restante</p>
                  <p className="text-xl font-bold text-amber-400">{formatCurrency(totalRestante)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10">
                  <Target className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Ativos</p>
                  <p className="text-xl font-bold text-emerald-400">{parcelasAbertas.length}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* List */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 animate-pulse">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-slate-800" />
                    <div className="flex-1">
                      <div className="h-4 bg-slate-800 rounded w-40 mb-2" />
                      <div className="h-3 bg-slate-800 rounded w-24" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : parcelasAbertas.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-16 text-center"
            >
              <CreditCard className="w-16 h-16 mx-auto text-slate-600 mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Nenhum parcelamento ativo</h3>
              <p className="text-slate-500">Adicione suas compras parceladas para acompanhar</p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {parcelasAbertas.map((parcela, index) => {
                const progresso = parcela.num_parcelas 
                  ? ((parcela.parcela_atual || 1) / parcela.num_parcelas) * 100 
                  : 0;

                return (
                  <motion.div
                    key={parcela.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      "bg-slate-900/40 backdrop-blur-xl border rounded-2xl p-5 transition-all duration-300 hover:border-indigo-500/30",
                      parcela.ativa ? "border-white/5" : "border-white/5 opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
                        <TrendingDown className="w-6 h-6 text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg text-white truncate">
                          {parcela.descricao || 'Parcelamento'}
                        </p>
                        <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {parcela.parcela_atual}/{parcela.num_parcelas} parcelas
                          </span>
                          <span className="text-indigo-400 font-medium">
                            {parcela.parcelas_restantes} restantes
                          </span>
                        </div>
                        <div className="mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${progresso}%` }}
                            transition={{ duration: 0.5, delay: index * 0.1 }}
                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="font-bold text-2xl text-white">
                            {formatCurrency(parcela.valor_parcela)}
                          </p>
                          <p className="text-xs text-slate-500">
                            Total: {formatCurrency(parcela.valor_total)}
                          </p>
                        </div>
                        {parcela.id && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 className="w-5 h-5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="bg-slate-900 border-slate-700">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-white">Excluir parcelamento?</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-400">
                                  Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white">Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteParcelamento(parcela.id!)}
                                  className="bg-red-500 hover:bg-red-600"
                                >
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl">Novo Parcelamento</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Descrição</Label>
              <Input
                placeholder="Ex: TV, Geladeira..."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Valor Total (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Número de Parcelas</Label>
              <Input
                type="number"
                min="1"
                placeholder="Ex: 12"
                value={numParcelas}
                onChange={(e) => setNumParcelas(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            {valorTotal && numParcelas && (
              <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <span className="text-slate-300">Valor da parcela: </span>
                <span className="font-bold text-xl text-indigo-400">
                  {formatCurrency(parseFloat(valorTotal) / parseInt(numParcelas))}
                </span>
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90" 
              disabled={formLoading}
            >
              {formLoading ? 'Salvando...' : 'Adicionar Parcelamento'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Parcelamentos;
