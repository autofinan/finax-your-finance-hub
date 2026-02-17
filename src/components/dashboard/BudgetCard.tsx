import { Target, AlertTriangle, CheckCircle, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import { CATEGORIAS } from '@/types/finance';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

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
  const [modalOpen, setModalOpen] = useState(false);
  const [novoTipo, setNovoTipo] = useState<'global' | 'categoria'>('categoria');
  const [novaCategoria, setNovaCategoria] = useState('');
  const [novoLimite, setNovoLimite] = useState('');
  const [saving, setSaving] = useState(false);
  const { usuarioId } = useUsuarioId();
  const { toast } = useToast();

  const fetchOrcamentos = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('orcamentos')
        .select('*')
        .eq('usuario_id', user.id)
        .eq('ativo', true)
        .order('created_at', { ascending: false });

      if (error) console.error('Erro ao buscar orçamentos:', error);
      else setOrcamentos(data || []);
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrcamentos(); }, []);

  const getPercentual = (gasto: number, limite: number) => Math.min((gasto / limite) * 100, 100);

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

  const handleCreate = async () => {
    if (!usuarioId || !novoLimite) return;
    const limite = parseFloat(novoLimite);
    if (isNaN(limite) || limite <= 0) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('orcamentos').insert({
        usuario_id: usuarioId,
        tipo: novoTipo,
        categoria: novoTipo === 'categoria' ? novaCategoria : null,
        limite,
        gasto_atual: 0,
        ativo: true,
      });

      if (error) throw error;

      toast({ title: '✅ Orçamento criado!', description: `Limite de ${formatCurrency(limite)} definido.` });
      setModalOpen(false);
      setNovoLimite('');
      setNovaCategoria('');
      fetchOrcamentos();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('orcamentos').update({ ativo: false }).eq('id', id);
    if (!error) {
      setOrcamentos(prev => prev.filter(o => o.id !== id));
      toast({ title: 'Orçamento removido' });
    }
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

  return (
    <>
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
          <button
            onClick={() => setModalOpen(true)}
            className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-colors"
            title="Novo orçamento"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {orcamentos.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-800/50 flex items-center justify-center">
              <Target className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-sm text-slate-400 mb-2">Nenhum orçamento definido</p>
            <button
              onClick={() => setModalOpen(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
            >
              + Criar primeiro orçamento
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {orcamentos.slice(0, 4).map((orc, index) => {
              const percentual = getPercentual(orc.gasto_atual, orc.limite);
              return (
                <motion.div
                  key={orc.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="space-y-3 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(percentual)}
                      <span className="font-semibold text-sm text-white">
                        {orc.tipo === 'global'
                          ? 'Total Mensal'
                          : CATEGORIAS.find(c => c.value === orc.categoria)?.label || orc.categoria || 'Categoria'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-sm font-bold",
                        percentual >= 100 ? "text-red-400" :
                        percentual >= 80 ? "text-amber-400" :
                        "text-emerald-400"
                      )}>
                        {percentual.toFixed(0)}%
                      </span>
                      <button
                        onClick={() => handleDelete(orc.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-slate-600 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentual}%` }}
                      transition={{ duration: 1, delay: index * 0.1 + 0.2 }}
                      className={cn("h-full rounded-full", getProgressColor(percentual))}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">{formatCurrency(orc.gasto_atual)}</span>
                    <span className="text-slate-500">de {formatCurrency(orc.limite)}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {orcamentos.length > 4 && (
          <p className="text-xs text-slate-500 text-center mt-4">
            +{orcamentos.length - 4} orçamentos
          </p>
        )}
      </motion.div>

      {/* Modal Criar Orçamento */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-400" />
              Novo Orçamento
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Tipo</Label>
              <Select value={novoTipo} onValueChange={(v) => setNovoTipo(v as 'global' | 'categoria')}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="global" className="text-white">🌐 Total Mensal (global)</SelectItem>
                  <SelectItem value="categoria" className="text-white">📂 Por Categoria</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {novoTipo === 'categoria' && (
              <div className="space-y-2">
                <Label className="text-slate-300">Categoria</Label>
                <Select value={novaCategoria} onValueChange={setNovaCategoria}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {CATEGORIAS.filter(c => c.tipo === 'saida' || c.tipo === 'ambos').map((cat) => (
                      <SelectItem key={cat.value} value={cat.value} className="text-white">
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-slate-300">Limite mensal (R$)</Label>
              <Input
                type="number"
                placeholder="500.00"
                value={novoLimite}
                onChange={(e) => setNovoLimite(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <Button
              onClick={handleCreate}
              disabled={saving || !novoLimite || (novoTipo === 'categoria' && !novaCategoria)}
              className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90"
            >
              {saving ? 'Criando...' : 'Criar Orçamento'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
