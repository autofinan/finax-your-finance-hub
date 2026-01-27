import { AppLayout } from '@/components/layout/AppLayout';
import { useFaturas } from '@/hooks/useFaturas';
import { useCartoes } from '@/hooks/useCartoes';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { Button } from '@/components/ui/button';
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
import { Receipt, Check, CreditCard, Calendar, AlertTriangle, CheckCircle, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const Faturas = () => {
  // Usar usuarioId do WhatsApp (não auth.uid)
  const { usuarioId } = useUsuarioId();
  const { faturas, faturasEmAberto, loading, pagarFatura } = useFaturas(usuarioId || undefined);
  const { cartoes } = useCartoes(usuarioId || undefined);

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const getCartaoNome = (cartaoId: string | null) => {
    if (!cartaoId) return 'Sem cartão';
    const cartao = cartoes.find((c) => c.id === cartaoId);
    return cartao?.nome || 'Cartão';
  };

  const getMesNome = (mes: number | null) => {
    if (!mes) return '';
    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return meses[mes - 1] || '';
  };

  const totalEmAberto = faturasEmAberto.reduce((acc, f) => acc + Number(f.valor_total || 0), 0);
  const faturasPagas = faturas.filter(f => f.status === 'paga');
  const totalPago = faturasPagas.reduce((acc, f) => acc + Number(f.valor_total || 0), 0);

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
              <p className="text-slate-500 font-medium mb-1">Controle de faturas</p>
              <h1 className="text-4xl font-bold text-white">
                Faturas <span className="text-indigo-400">📄</span>
              </h1>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-4 hover:border-red-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Em Aberto</p>
                  <p className="text-xl font-bold text-red-400">{formatCurrency(totalEmAberto)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Pago</p>
                  <p className="text-xl font-bold text-emerald-400">{formatCurrency(totalPago)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-indigo-500/20 rounded-2xl p-4 hover:border-indigo-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10">
                  <Receipt className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Qtd. Faturas</p>
                  <p className="text-xl font-bold text-indigo-400">{faturas.length}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Faturas em Aberto */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Faturas em Aberto</h2>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 animate-pulse">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl bg-slate-800" />
                      <div className="flex-1">
                        <div className="h-4 bg-slate-800 rounded w-32 mb-2" />
                        <div className="h-3 bg-slate-800 rounded w-20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : faturasEmAberto.length === 0 ? (
              <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-10 text-center">
                <CheckCircle className="w-14 h-14 mx-auto text-emerald-400 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Tudo em dia! 🎉</h3>
                <p className="text-slate-500">Nenhuma fatura em aberto no momento.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {faturasEmAberto.map((fatura, index) => (
                  <motion.div
                    key={fatura.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-slate-900/40 backdrop-blur-xl border-l-4 border-l-red-500 border border-white/5 rounded-2xl p-5 hover:border-red-500/30 transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-4 rounded-xl bg-red-500/10">
                        <CreditCard className="w-6 h-6 text-red-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg text-white">{getCartaoNome(fatura.cartao_id)}</p>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Calendar className="w-4 h-4" />
                          {getMesNome(fatura.mes)} {fatura.ano}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-bold text-2xl text-red-400">
                            {formatCurrency(fatura.valor_total)}
                          </p>
                          <p className="text-xs text-slate-500 capitalize">{fatura.status}</p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button className="bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90">
                              <Check className="w-4 h-4 mr-2" />
                              Pagar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-slate-900 border-slate-700">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Confirmar pagamento?</AlertDialogTitle>
                              <AlertDialogDescription className="text-slate-400">
                                Marcar fatura de {formatCurrency(fatura.valor_total)} como paga.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white">Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => fatura.id && pagarFatura(fatura.id, fatura.valor_total || 0)}
                                className="bg-emerald-500 hover:bg-emerald-600"
                              >
                                Confirmar Pagamento
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Histórico */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10">
                <Receipt className="w-5 h-5 text-indigo-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Histórico de Faturas</h2>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 animate-pulse">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl bg-slate-800" />
                      <div className="flex-1">
                        <div className="h-4 bg-slate-800 rounded w-32 mb-2" />
                        <div className="h-3 bg-slate-800 rounded w-20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : faturas.length === 0 ? (
              <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-10 text-center">
                <Receipt className="w-14 h-14 mx-auto text-slate-600 mb-4" />
                <p className="text-slate-500">Nenhuma fatura registrada.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {faturas.map((fatura, index) => (
                  <motion.div
                    key={fatura.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.03 }}
                    className={cn(
                      "bg-slate-900/40 backdrop-blur-xl border rounded-2xl p-5 transition-all",
                      fatura.status === 'paga' ? "border-emerald-500/20 opacity-70" : "border-white/5"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "p-4 rounded-xl",
                        fatura.status === 'paga' ? "bg-emerald-500/10" : "bg-slate-800"
                      )}>
                        {fatura.status === 'paga' ? (
                          <Check className="w-6 h-6 text-emerald-400" />
                        ) : (
                          <CreditCard className="w-6 h-6 text-slate-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg text-white">{getCartaoNome(fatura.cartao_id)}</p>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Calendar className="w-4 h-4" />
                          {getMesNome(fatura.mes)} {fatura.ano}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={cn(
                          "font-bold text-xl",
                          fatura.status === 'paga' ? "text-emerald-400" : "text-white"
                        )}>
                          {formatCurrency(fatura.valor_total)}
                        </p>
                        <p className="text-xs text-slate-500 capitalize">{fatura.status}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Faturas;
