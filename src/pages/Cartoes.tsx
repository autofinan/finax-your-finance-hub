import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useCartoes } from '@/hooks/useCartoes';
import { useFaturas } from '@/hooks/useFaturas';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Plus, Trash2, CreditCard, Calendar, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const Cartoes = () => {
  // Usar usuarioId do WhatsApp (não auth.uid)
  const { usuarioId } = useUsuarioId();
  const { cartoes, loading, addCartao, deleteCartao } = useCartoes(usuarioId || undefined);
  const { faturasEmAberto } = useFaturas(usuarioId || undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [nome, setNome] = useState('');
  const [limiteTotal, setLimiteTotal] = useState('');
  const [diaFechamento, setDiaFechamento] = useState('');
  const [diaVencimento, setDiaVencimento] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome) return;

    setFormLoading(true);
    try {
      await addCartao({
        nome,
        limite_total: limiteTotal ? parseFloat(limiteTotal) : null,
        limite_disponivel: limiteTotal ? parseFloat(limiteTotal) : null,
        dia_fechamento: diaFechamento ? parseInt(diaFechamento) : null,
        dia_vencimento: diaVencimento ? parseInt(diaVencimento) : null,
        usuario_id: null,
      });
      resetForm();
      setFormOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setNome('');
    setLimiteTotal('');
    setDiaFechamento('');
    setDiaVencimento('');
  };

  const getFaturaAberta = (cartaoId: string) => {
    return faturasEmAberto.find((f) => f.cartao_id === cartaoId);
  };

  const totalLimite = cartoes.reduce((acc, c) => acc + Number(c.limite_total || 0), 0);
  const totalDisponivel = cartoes.reduce((acc, c) => acc + Number(c.limite_disponivel || 0), 0);
  const totalUsado = totalLimite - totalDisponivel;

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
              <p className="text-slate-500 font-medium mb-1">Controle de crédito</p>
              <h1 className="text-4xl font-bold text-white">
                Cartões de Crédito <span className="text-indigo-400">💳</span>
              </h1>
            </div>
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-500 px-6 py-3 rounded-xl font-bold text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:scale-[1.02]"
            >
              <Plus className="w-5 h-5" />
              Novo Cartão
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
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Limite Total</p>
                  <p className="text-xl font-bold text-indigo-400">{formatCurrency(totalLimite)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Disponível</p>
                  <p className="text-xl font-bold text-emerald-400">{formatCurrency(totalDisponivel)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-4 hover:border-amber-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Em Uso</p>
                  <p className="text-xl font-bold text-amber-400">{formatCurrency(totalUsado)}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Cards Grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 animate-pulse">
                  <div className="w-14 h-14 rounded-xl bg-slate-800 mb-4" />
                  <div className="h-5 bg-slate-800 rounded w-32 mb-2" />
                  <div className="h-4 bg-slate-800 rounded w-24" />
                </div>
              ))}
            </div>
          ) : cartoes.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-16 text-center"
            >
              <CreditCard className="w-16 h-16 mx-auto text-slate-600 mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Nenhum cartão cadastrado</h3>
              <p className="text-slate-500">Adicione seus cartões para acompanhar limites e faturas</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cartoes.map((cartao, index) => {
                const faturaAberta = getFaturaAberta(cartao.id);
                const percentUsado = cartao.limite_total 
                  ? ((Number(cartao.limite_total) - Number(cartao.limite_disponivel || 0)) / Number(cartao.limite_total)) * 100
                  : 0;

                return (
                  <motion.div
                    key={cartao.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-300 group"
                  >
                    <div className="flex items-start justify-between mb-6">
                      <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 group-hover:from-indigo-500/30 group-hover:to-purple-500/30 transition-all">
                        <CreditCard className="w-8 h-8 text-indigo-400" />
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-5 h-5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-slate-900 border-slate-700">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-white">Excluir cartão?</AlertDialogTitle>
                            <AlertDialogDescription className="text-slate-400">
                              Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white">Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteCartao(cartao.id)}
                              className="bg-red-500 hover:bg-red-600"
                            >
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>

                    <h3 className="font-bold text-xl text-white mb-4">{cartao.nome || 'Sem nome'}</h3>
                    
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-slate-500">Limite usado</span>
                          <span className={cn(
                            "font-bold",
                            percentUsado > 80 ? "text-red-400" : percentUsado > 50 ? "text-amber-400" : "text-emerald-400"
                          )}>
                            {percentUsado.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(percentUsado, 100)}%` }}
                            transition={{ duration: 0.5, delay: index * 0.1 }}
                            className={cn(
                              "h-full rounded-full",
                              percentUsado > 80 ? "bg-gradient-to-r from-red-500 to-red-400" : 
                              percentUsado > 50 ? "bg-gradient-to-r from-amber-500 to-amber-400" : 
                              "bg-gradient-to-r from-emerald-500 to-emerald-400"
                            )}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Disponível</p>
                          <p className="font-bold text-emerald-400">{formatCurrency(cartao.limite_disponivel)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Limite</p>
                          <p className="font-bold text-white">{formatCurrency(cartao.limite_total)}</p>
                        </div>
                      </div>

                      {cartao.dia_fechamento && (
                        <div className="flex items-center gap-2 text-sm text-slate-500 pt-2 border-t border-slate-800">
                          <Calendar className="w-4 h-4" />
                          Fecha dia {cartao.dia_fechamento} • Vence dia {cartao.dia_vencimento}
                        </div>
                      )}

                      {faturaAberta && (
                        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-red-300">Fatura Atual</span>
                            <span className="font-bold text-xl text-red-400">
                              {formatCurrency(faturaAberta.valor_total)}
                            </span>
                          </div>
                        </div>
                      )}
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
            <DialogTitle className="text-xl">Novo Cartão de Crédito</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Nome do Cartão</Label>
              <Input
                placeholder="Ex: Nubank, Itaú..."
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Limite Total (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={limiteTotal}
                onChange={(e) => setLimiteTotal(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Dia Fechamento</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Ex: 15"
                  value={diaFechamento}
                  onChange={(e) => setDiaFechamento(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Dia Vencimento</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Ex: 25"
                  value={diaVencimento}
                  onChange={(e) => setDiaVencimento(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90" 
              disabled={formLoading}
            >
              {formLoading ? 'Salvando...' : 'Adicionar Cartão'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Cartoes;
