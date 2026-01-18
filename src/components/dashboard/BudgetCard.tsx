import { Target, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface Orcamento {
  id: string;
  tipo: string;
  categoria: string | null;
  limite: number;
  gasto_atual: number;
  ativo: boolean;
}

export function BudgetCard() {
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrcamentos = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('orcamentos')
          .select('*')
          .eq('usuario_id', user.id)
          .eq('ativo', true)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Erro ao buscar orçamentos:', error);
        } else {
          setOrcamentos(data || []);
        }
      } catch (err) {
        console.error('Erro:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrcamentos();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getPercentual = (gasto: number, limite: number) => {
    return Math.min((gasto / limite) * 100, 100);
  };

  const getStatusIcon = (percentual: number) => {
    if (percentual >= 100) return <AlertTriangle className="w-4 h-4 text-red-400" />;
    if (percentual >= 80) return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    return <CheckCircle className="w-4 h-4 text-emerald-400" />;
  };

  const getProgressColor = (percentual: number) => {
    if (percentual >= 100) return 'bg-red-500';
    if (percentual >= 80) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  if (loading) {
    return (
      <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-indigo-500/10">
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <h3 className="font-bold text-lg text-white">Orçamentos</h3>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-slate-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (orcamentos.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-500"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-indigo-500/10">
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <h3 className="font-bold text-lg text-white">Orçamentos</h3>
        </div>
        
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-800/50 flex items-center justify-center">
            <Target className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-sm text-slate-400 mb-2">Nenhum orçamento definido</p>
          <p className="text-xs text-slate-600">
            Crie pelo WhatsApp: "orçamento de 500 para alimentação"
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(79,70,229,0.2)]"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10">
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <h3 className="font-bold text-lg text-white">Orçamentos</h3>
        </div>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          {orcamentos.length} ativos
        </span>
      </div>

      <div className="space-y-5">
        {orcamentos.slice(0, 3).map((orc, index) => {
          const percentual = getPercentual(orc.gasto_atual, orc.limite);

          return (
            <motion.div
              key={orc.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(percentual)}
                  <span className="font-semibold text-sm text-white">
                    {orc.tipo === 'global' ? 'Total Mensal' : orc.categoria || 'Categoria'}
                  </span>
                </div>
                <span className={cn(
                  "text-sm font-bold",
                  percentual >= 100 ? "text-red-400" :
                  percentual >= 80 ? "text-amber-400" :
                  "text-emerald-400"
                )}>
                  {percentual.toFixed(0)}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentual}%` }}
                  transition={{ duration: 1, delay: index * 0.1 + 0.2 }}
                  className={cn(
                    "h-full rounded-full",
                    getProgressColor(percentual)
                  )}
                />
              </div>

              <div className="flex justify-between text-xs">
                <span className="text-slate-400">
                  {formatCurrency(orc.gasto_atual)}
                </span>
                <span className="text-slate-500">
                  de {formatCurrency(orc.limite)}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {orcamentos.length > 3 && (
        <button className="w-full mt-4 py-3 bg-white/5 border border-white/5 rounded-xl text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-white transition-all">
          Ver todos os orçamentos
        </button>
      )}
    </motion.div>
  );
}
