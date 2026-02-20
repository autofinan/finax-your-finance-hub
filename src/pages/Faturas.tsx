import { AppLayout } from '@/components/layout/AppLayout';
import { useFaturas } from '@/hooks/useFaturas';
import { useCartoes } from '@/hooks/useCartoes';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Receipt, Check, CreditCard, Calendar, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { FaturaDetailModal } from '@/components/cartoes/FaturaDetailModal';

const Faturas = () => {
  const { usuarioId } = useUsuarioId();
  const { faturas, faturasEmAberto, faturasFuturas, loading, pagarFatura } = useFaturas(usuarioId || undefined);
  const { cartoes } = useCartoes(usuarioId || undefined);

  const [detailModal, setDetailModal] = useState<{
    open: boolean; faturaId: string; cartaoId: string; cartaoNome: string;
    mes: number | null; ano: number | null; diaFechamento: number | null;
    valorTotal: number | null; valorPago: number | null; status: string | null;
  }>({ open: false, faturaId: '', cartaoId: '', cartaoNome: '', mes: null, ano: null, diaFechamento: null, valorTotal: null, valorPago: null, status: null });

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const getCartao = (cartaoId: string | null) => {
    if (!cartaoId) return null;
    return cartoes.find((c) => c.id === cartaoId) || null;
  };

  const getCartaoNome = (cartaoId: string | null) => {
    return getCartao(cartaoId)?.nome || 'Cartão';
  };

  const getMesNome = (mes: number | null) => {
    if (!mes) return '';
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return meses[mes - 1] || '';
  };

  const openDetail = (f: any) => {
    const cartao = getCartao(f.cartao_id);
    setDetailModal({
      open: true, faturaId: f.id,
      cartaoId: f.cartao_id || '',
      cartaoNome: cartao?.nome || 'Cartão',
      mes: f.mes, ano: f.ano,
      diaFechamento: cartao?.dia_fechamento ?? null,
      valorTotal: f.valor_total, valorPago: f.valor_pago ?? 0,
      status: f.status,
    });
  };

  const totalEmAberto = faturasEmAberto.reduce((acc, f) => acc + Number(f.valor_total || 0), 0);
  const totalFuturo = faturasFuturas.reduce((acc, f) => acc + Number(f.valor_total || 0), 0);
  const faturasPagas = faturas.filter(f => f.status === 'paga');
  const totalPago = faturasPagas.reduce((acc, f) => acc + Number(f.valor_total || 0), 0);

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        <div className="relative z-10 max-w-[1800px] mx-auto space-y-6">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-slate-500 font-medium mb-1">Controle de faturas</p>
              <h1 className="text-4xl font-bold text-white">Faturas <span className="text-indigo-400">📄</span></h1>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-4 hover:border-red-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10"><AlertTriangle className="w-5 h-5 text-red-400" /></div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Em Aberto</p>
                  <p className="text-xl font-bold text-red-400">{formatCurrency(totalEmAberto)}</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-4 hover:border-amber-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10"><Clock className="w-5 h-5 text-amber-400" /></div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Próximas Faturas</p>
                  <p className="text-xl font-bold text-amber-400">{formatCurrency(totalFuturo)}</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10"><CheckCircle className="w-5 h-5 text-emerald-400" /></div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Pago</p>
                  <p className="text-xl font-bold text-emerald-400">{formatCurrency(totalPago)}</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl border border-indigo-500/20 rounded-2xl p-4 hover:border-indigo-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10"><Receipt className="w-5 h-5 text-indigo-400" /></div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Qtd. Faturas</p>
                  <p className="text-xl font-bold text-indigo-400">{faturas.length}</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Faturas em Aberto (ciclo atual) */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10"><AlertTriangle className="w-5 h-5 text-red-400" /></div>
              <h2 className="text-xl font-bold text-white">Faturas em Aberto</h2>
              <span className="text-xs text-slate-500">Ciclo atual</span>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 animate-pulse">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl bg-slate-800" />
                      <div className="flex-1"><div className="h-4 bg-slate-800 rounded w-32 mb-2" /><div className="h-3 bg-slate-800 rounded w-20" /></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : faturasEmAberto.length === 0 ? (
              <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-10 text-center">
                <CheckCircle className="w-14 h-14 mx-auto text-emerald-400 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Tudo em dia! 🎉</h3>
                <p className="text-slate-500">Nenhuma fatura em aberto no ciclo atual.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {faturasEmAberto.map((fatura, index) => (
                  <motion.div key={fatura.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-slate-900/40 backdrop-blur-xl border-l-4 border-l-red-500 border border-white/5 rounded-2xl p-5 hover:border-red-500/30 transition-all cursor-pointer"
                    onClick={() => openDetail(fatura)}>
                    <div className="flex items-center gap-4">
                      <div className="p-4 rounded-xl bg-red-500/10"><CreditCard className="w-6 h-6 text-red-400" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg text-white">{getCartaoNome(fatura.cartao_id)}</p>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Calendar className="w-4 h-4" /> {getMesNome(fatura.mes)} {fatura.ano}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-bold text-2xl text-red-400">{formatCurrency(fatura.valor_total)}</p>
                          <p className="text-xs text-red-400/70 font-medium">Aberta</p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button className="bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90"
                              onClick={(e) => e.stopPropagation()}>
                              <Check className="w-4 h-4 mr-2" /> Pagar
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
                                className="bg-emerald-500 hover:bg-emerald-600">Confirmar Pagamento</AlertDialogAction>
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

          {/* Faturas Futuras */}
          {faturasFuturas.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10"><Clock className="w-5 h-5 text-amber-400" /></div>
                <h2 className="text-xl font-bold text-white">Próximas Faturas</h2>
                <span className="text-xs text-slate-500 bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">Parcelas futuras</span>
              </div>
              <div className="space-y-3">
                {faturasFuturas.map((fatura, index) => (
                  <motion.div key={fatura.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + index * 0.05 }}
                    className="bg-slate-900/40 backdrop-blur-xl border-l-4 border-l-amber-500/50 border border-white/5 rounded-2xl p-5 hover:border-amber-500/30 transition-all cursor-pointer opacity-80"
                    onClick={() => openDetail(fatura)}>
                    <div className="flex items-center gap-4">
                      <div className="p-4 rounded-xl bg-amber-500/10"><Clock className="w-6 h-6 text-amber-400" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg text-white">{getCartaoNome(fatura.cartao_id)}</p>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Calendar className="w-4 h-4" /> {getMesNome(fatura.mes)} {fatura.ano}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-xl text-amber-400">{formatCurrency(fatura.valor_total)}</p>
                        <span className="text-xs text-amber-400/70 font-medium">Futura</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Histórico */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10"><Receipt className="w-5 h-5 text-indigo-400" /></div>
              <h2 className="text-xl font-bold text-white">Histórico de Faturas</h2>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 animate-pulse">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl bg-slate-800" />
                      <div className="flex-1"><div className="h-4 bg-slate-800 rounded w-32 mb-2" /><div className="h-3 bg-slate-800 rounded w-20" /></div>
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
                {faturas.map((fatura, index) => {
                  const isFutura = fatura.status === 'futura';
                  const isPaga = fatura.status === 'paga';
                  return (
                    <motion.div key={fatura.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + index * 0.03 }}
                      onClick={() => openDetail(fatura)}
                      className={cn(
                        "bg-slate-900/40 backdrop-blur-xl border rounded-2xl p-5 transition-all cursor-pointer hover:border-indigo-500/30",
                        isPaga ? "border-emerald-500/20 opacity-70" : 
                        isFutura ? "border-amber-500/20 opacity-80" : "border-white/5"
                      )}>
                      <div className="flex items-center gap-4">
                        <div className={cn("p-4 rounded-xl", 
                          isPaga ? "bg-emerald-500/10" : 
                          isFutura ? "bg-amber-500/10" : "bg-slate-800")}>
                          {isPaga ? <Check className="w-6 h-6 text-emerald-400" /> : 
                           isFutura ? <Clock className="w-6 h-6 text-amber-400" /> :
                           <CreditCard className="w-6 h-6 text-slate-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-lg text-white">{getCartaoNome(fatura.cartao_id)}</p>
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Calendar className="w-4 h-4" /> {getMesNome(fatura.mes)} {fatura.ano}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={cn("font-bold text-xl", 
                            isPaga ? "text-emerald-400" : 
                            isFutura ? "text-amber-400" : "text-white")}>
                            {formatCurrency(fatura.valor_total)}
                          </p>
                          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full",
                            isPaga ? "bg-emerald-500/10 text-emerald-400" :
                            isFutura ? "bg-amber-500/10 text-amber-400" :
                            "bg-red-500/10 text-red-400"
                          )}>
                            {isFutura ? 'Futura' : isPaga ? 'Paga' : fatura.status}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Detail Modal */}
      <FaturaDetailModal
        open={detailModal.open}
        onClose={() => setDetailModal(prev => ({ ...prev, open: false }))}
        faturaId={detailModal.faturaId}
        cartaoId={detailModal.cartaoId}
        cartaoNome={detailModal.cartaoNome}
        mes={detailModal.mes}
        ano={detailModal.ano}
        diaFechamento={detailModal.diaFechamento}
        valorTotal={detailModal.valorTotal}
        valorPago={detailModal.valorPago}
        status={detailModal.status}
        onPagar={pagarFatura}
      />
    </AppLayout>
  );
};

export default Faturas;
