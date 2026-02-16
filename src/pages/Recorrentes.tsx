import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useGastosRecorrentes } from '@/hooks/useGastosRecorrentes';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, RefreshCcw, Calendar, DollarSign, Zap, Clock, Pencil } from 'lucide-react';
import { CATEGORIAS, CategoriaTransacao, GastoRecorrente } from '@/types/finance';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const Recorrentes = () => {
  // Usar usuarioId do WhatsApp (não auth.uid)
  const { usuarioId } = useUsuarioId();
  const { gastos, loading, addGasto, updateGasto, deleteGasto } = useGastosRecorrentes(usuarioId || undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingGasto, setEditingGasto] = useState<GastoRecorrente | null>(null);
  const [descricao, setDescricao] = useState('');
  const [valorParcela, setValorParcela] = useState('');
  const [categoria, setCategoria] = useState<CategoriaTransacao>('outros');
  const [tipoRecorrencia, setTipoRecorrencia] = useState<'mensal' | 'semanal' | 'parcelado'>('mensal');
  const [diaMes, setDiaMes] = useState('1');
  const [numParcelas, setNumParcelas] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  
  // Preencher form quando abrir edição
  useEffect(() => {
    if (editingGasto) {
      setDescricao(editingGasto.descricao || '');
      setValorParcela(editingGasto.valor_parcela?.toString() || '');
      setCategoria((editingGasto.categoria as CategoriaTransacao) || 'outros');
      setTipoRecorrencia((editingGasto.tipo_recorrencia as 'mensal' | 'semanal' | 'parcelado') || 'mensal');
      setDiaMes(editingGasto.dia_mes?.toString() || '1');
      setNumParcelas(editingGasto.num_parcelas?.toString() || '');
    }
  }, [editingGasto]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valorParcela || parseFloat(valorParcela) <= 0) return;

    setFormLoading(true);
    try {
      await addGasto({
        descricao,
        valor_parcela: parseFloat(valorParcela),
        valor_total: tipoRecorrencia === 'parcelado' 
          ? parseFloat(valorParcela) * parseInt(numParcelas || '1')
          : null,
        categoria,
        tipo_recorrencia: tipoRecorrencia,
        dia_mes: tipoRecorrencia === 'mensal' ? parseInt(diaMes) : null,
        num_parcelas: tipoRecorrencia === 'parcelado' ? parseInt(numParcelas || '1') : null,
        parcela_atual: 1,
        ativo: true,
      });
      resetForm();
      setFormOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setDescricao('');
    setValorParcela('');
    setCategoria('outros');
    setTipoRecorrencia('mensal');
    setDiaMes('1');
    setNumParcelas('');
    setEditingGasto(null);
  };

  const handleOpenEdit = (gasto: GastoRecorrente) => {
    setEditingGasto(gasto);
    setEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGasto || !valorParcela || parseFloat(valorParcela) <= 0) return;

    setFormLoading(true);
    try {
      await updateGasto(editingGasto.id, {
        descricao,
        valor_parcela: parseFloat(valorParcela),
        categoria,
        tipo_recorrencia: tipoRecorrencia,
        dia_mes: tipoRecorrencia === 'mensal' ? parseInt(diaMes) : null,
        num_parcelas: tipoRecorrencia === 'parcelado' ? parseInt(numParcelas || '1') : null,
      });
      resetForm();
      setEditOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const toggleAtivo = async (gasto: GastoRecorrente) => {
    await updateGasto(gasto.id, { ativo: !gasto.ativo });
  };

  const getCategoriaInfo = (categoria: string) => {
    return CATEGORIAS.find((c) => c.value === categoria) || { label: categoria, cor: 'hsl(220, 10%, 50%)' };
  };

  const totalMensal = gastos
    .filter((g) => g.ativo)
    .reduce((acc, g) => acc + Number(g.valor_parcela), 0);

  const gastosAtivos = gastos.filter(g => g.ativo).length;
  const gastosInativos = gastos.filter(g => !g.ativo).length;

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
              <p className="text-slate-500 font-medium mb-1">Gestão automática</p>
              <h1 className="text-4xl font-bold text-white">
                Gastos Recorrentes <span className="text-indigo-400">🔄</span>
              </h1>
            </div>
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-500 px-6 py-3 rounded-xl font-bold text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:scale-[1.02]"
            >
              <Plus className="w-5 h-5" />
              Novo Gasto
            </button>
          </motion.div>

          {/* Stats Cards */}
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
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Mensal</p>
                  <p className="text-xl font-bold text-indigo-400">{formatCurrency(totalMensal)}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-emerald-500/20 rounded-2xl p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10">
                  <Zap className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Ativos</p>
                  <p className="text-xl font-bold text-emerald-400">{gastosAtivos}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-500/20 rounded-2xl p-4 hover:border-slate-500/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-slate-500/10">
                  <Clock className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Inativos</p>
                  <p className="text-xl font-bold text-slate-400">{gastosInativos}</p>
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
          ) : gastos.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-16 text-center"
            >
              <RefreshCcw className="w-16 h-16 mx-auto text-slate-600 mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Nenhum gasto recorrente</h3>
              <p className="text-slate-500">Adicione suas contas fixas para acompanhar automaticamente</p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {gastos.map((gasto, index) => {
                const categoriaInfo = getCategoriaInfo(gasto.categoria);
                return (
                  <motion.div
                    key={gasto.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      'bg-slate-900/40 backdrop-blur-xl border rounded-2xl p-5 transition-all duration-300 hover:border-indigo-500/30',
                      gasto.ativo ? 'border-white/5' : 'border-white/5 opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="p-4 rounded-xl"
                        style={{ backgroundColor: `${categoriaInfo.cor}15` }}
                      >
                        <RefreshCcw className="w-6 h-6" style={{ color: categoriaInfo.cor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-white truncate">
                            {gasto.descricao || categoriaInfo.label}
                          </p>
                          <span
                            className="text-xs px-2.5 py-1 rounded-full font-medium"
                            style={{
                              backgroundColor: `${categoriaInfo.cor}20`,
                              color: categoriaInfo.cor,
                            }}
                          >
                            {categoriaInfo.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {gasto.tipo_recorrencia === 'mensal' && `Dia ${gasto.dia_mes}`}
                            {gasto.tipo_recorrencia === 'semanal' && 'Semanal'}
                            {gasto.tipo_recorrencia === 'parcelado' && 
                              `${gasto.parcela_atual}/${gasto.num_parcelas} parcelas`}
                          </span>
                          {gasto.proxima_execucao && (
                            <span className="text-indigo-400 font-medium">
                              Próxima: {new Date(gasto.proxima_execucao + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          )}
                          {gasto.ultima_execucao && (
                            <span className="text-slate-600">
                              Última: {new Date(gasto.ultima_execucao + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="font-bold text-2xl text-white">
                            {formatCurrency(Number(gasto.valor_parcela))}
                          </p>
                          <p className="text-xs text-slate-500">por mês</p>
                        </div>
                        <Switch
                          checked={gasto.ativo}
                          onCheckedChange={() => toggleAtivo(gasto)}
                          className="data-[state=checked]:bg-indigo-500"
                        />
                        {/* Botão Editar */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(gasto)}
                          className="text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10"
                        >
                          <Pencil className="w-5 h-5" />
                        </Button>
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
                              <AlertDialogTitle className="text-white">Excluir gasto recorrente?</AlertDialogTitle>
                              <AlertDialogDescription className="text-slate-400">
                                Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteGasto(gasto.id)}
                                className="bg-red-500 hover:bg-red-600"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
            <DialogTitle className="text-xl">Novo Gasto Recorrente</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Descrição</Label>
              <Input
                placeholder="Ex: Netflix, Aluguel..."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={valorParcela}
                onChange={(e) => setValorParcela(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Categoria</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaTransacao)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {CATEGORIAS.filter((c) => c.value !== 'salario').map((cat) => (
                    <SelectItem key={cat.value} value={cat.value} className="text-white">
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Tipo de Recorrência</Label>
              <Select value={tipoRecorrencia} onValueChange={(v) => setTipoRecorrencia(v as typeof tipoRecorrencia)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="mensal" className="text-white">Mensal</SelectItem>
                  <SelectItem value="semanal" className="text-white">Semanal</SelectItem>
                  <SelectItem value="parcelado" className="text-white">Parcelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {tipoRecorrencia === 'mensal' && (
              <div className="space-y-2">
                <Label className="text-slate-300">Dia do Mês</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={diaMes}
                  onChange={(e) => setDiaMes(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            )}

            {tipoRecorrencia === 'parcelado' && (
              <div className="space-y-2">
                <Label className="text-slate-300">Número de Parcelas</Label>
                <Input
                  type="number"
                  min="1"
                  value={numParcelas}
                  onChange={(e) => setNumParcelas(e.target.value)}
                  required
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90" 
              disabled={formLoading}
            >
              {formLoading ? 'Salvando...' : 'Adicionar'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de Edição */}
      <Dialog open={editOpen} onOpenChange={(open) => {
        setEditOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Pencil className="w-5 h-5 text-indigo-400" />
              Editar Gasto Recorrente
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Descrição</Label>
              <Input
                placeholder="Ex: Netflix, Aluguel..."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={valorParcela}
                onChange={(e) => setValorParcela(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Categoria</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaTransacao)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {CATEGORIAS.filter((c) => c.value !== 'salario').map((cat) => (
                    <SelectItem key={cat.value} value={cat.value} className="text-white">
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {tipoRecorrencia === 'mensal' && (
              <div className="space-y-2">
                <Label className="text-slate-300">Dia do Mês</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={diaMes}
                  onChange={(e) => setDiaMes(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90" 
              disabled={formLoading}
            >
              {formLoading ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Recorrentes;
