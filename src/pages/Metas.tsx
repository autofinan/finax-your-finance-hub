import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { useMetas, Meta } from '@/hooks/useMetas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Plus, 
  Target, 
  TrendingUp,
  CheckCircle2,
  XCircle,
  DollarSign,
  Calendar,
  Trash2,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { motion } from 'framer-motion';

const Metas = () => {
  const { usuarioId } = useUsuarioId();
  const {
    metas,
    loading,
    criarMeta,
    adicionarProgresso,
    concluirMeta,
    cancelarMeta,
    deletarMeta,
    getMetasAtivas,
    getMetasConcluidas,
    calcularDiasRestantes,
    calcularValorFaltante,
    formatCurrency,
  } = useMetas(usuarioId || undefined);
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAddProgressOpen, setIsAddProgressOpen] = useState(false);
  const [selectedMeta, setSelectedMeta] = useState<Meta | null>(null);
  
  // Form states
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [category, setCategory] = useState('');
  const [progressValue, setProgressValue] = useState('');

  const handleCreate = async () => {
    if (!name || !targetAmount) return;
    
    await criarMeta({
      name,
      target_amount: parseFloat(targetAmount),
      deadline: deadline || undefined,
      category: category || undefined,
      weekly_checkin_enabled: true,
    });
    
    setIsCreateOpen(false);
    setName('');
    setTargetAmount('');
    setDeadline('');
    setCategory('');
  };

  const handleAddProgress = async () => {
    if (!selectedMeta || !progressValue) return;
    
    await adicionarProgresso(selectedMeta.id, parseFloat(progressValue));
    
    setIsAddProgressOpen(false);
    setSelectedMeta(null);
    setProgressValue('');
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-emerald-500';
    if (percentage >= 75) return 'bg-blue-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Sem prazo';
    return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const metasAtivas = getMetasAtivas();
  const metasConcluidas = getMetasConcluidas();

  const MetaCard = ({ meta, index }: { meta: Meta; index: number }) => {
    const diasRestantes = calcularDiasRestantes(meta.deadline);
    const valorFaltante = calcularValorFaltante(meta);
    const progress = meta.progress_percentage || 0;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
      >
        <Card className="bg-slate-900/50 border-white/10 hover:border-white/20 transition-all hover:shadow-lg hover:shadow-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${
                  progress >= 100 
                    ? 'from-emerald-500/20 to-green-500/20' 
                    : 'from-primary/20 to-blue-500/20'
                } flex items-center justify-center`}>
                  {progress >= 100 ? (
                    <Trophy className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <Target className="w-6 h-6 text-primary" />
                  )}
                </div>
                <div className="flex-1">
                  <CardTitle className="text-white text-lg">{meta.name}</CardTitle>
                  {meta.category && (
                    <Badge variant="outline" className="text-xs mt-1">{meta.category}</Badge>
                  )}
                </div>
              </div>
              {meta.status === 'completed' && (
                <Badge className="gap-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Concluída
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Barra de Progresso */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Progresso</span>
                <span className={`font-semibold ${
                  progress >= 100 ? 'text-emerald-400' : 'text-white'
                }`}>
                  {progress.toFixed(0)}%
                </span>
              </div>
              <div className="relative h-3 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(progress, 100)}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full ${getProgressColor(progress)} rounded-full`}
                />
              </div>
            </div>

            {/* Valores */}
            <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Atual</span>
                <span className="text-white font-semibold">
                  {formatCurrency(meta.current_amount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Objetivo</span>
                <span className="text-primary font-semibold">
                  {formatCurrency(meta.target_amount)}
                </span>
              </div>
              {valorFaltante > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-slate-700">
                  <span className="text-slate-400 text-sm">Faltam</span>
                  <span className="text-amber-400 font-semibold">
                    {formatCurrency(valorFaltante)}
                  </span>
                </div>
              )}
            </div>

            {/* Prazo */}
            {meta.deadline && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300">
                  {formatDate(meta.deadline)}
                  {diasRestantes !== null && diasRestantes >= 0 && (
                    <span className="text-slate-500 ml-2">
                      ({diasRestantes} dias)
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* Ações */}
            {meta.status === 'active' && (
              <div className="flex gap-2 pt-2">
                <Button 
                  size="sm" 
                  className="flex-1 gap-1 bg-primary/20 hover:bg-primary/30 text-primary"
                  onClick={() => {
                    setSelectedMeta(meta);
                    setIsAddProgressOpen(true);
                  }}
                >
                  <TrendingUp className="w-4 h-4" />
                  Adicionar
                </Button>
                {progress >= 100 && (
                  <Button 
                    size="sm" 
                    className="gap-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                    onClick={() => concluirMeta(meta.id)}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Concluir
                  </Button>
                )}
                <Button 
                  size="sm" 
                  variant="ghost" 
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  onClick={() => cancelarMeta(meta.id)}
                >
                  <XCircle className="w-4 h-4" />
                </Button>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  className="text-slate-400 hover:text-slate-300"
                  onClick={() => deletarMeta(meta.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center">
                <Target className="w-6 h-6 text-white" />
              </div>
              Metas Financeiras
            </h1>
            <p className="text-slate-400 text-sm mt-1">Crie e acompanhe seus objetivos financeiros</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-primary to-blue-500 hover:opacity-90 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4" />
                Nova Meta
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-white/10">
              <DialogHeader>
                <DialogTitle className="text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" />
                  Criar Nova Meta
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label className="text-slate-300">Nome da Meta</Label>
                  <Input 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Viagem para Europa, Carro Novo..."
                    className="bg-slate-800 border-white/10 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Valor Objetivo</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      type="number"
                      step="0.01"
                      value={targetAmount}
                      onChange={(e) => setTargetAmount(e.target.value)}
                      placeholder="0.00"
                      className="bg-slate-800 border-white/10 text-white pl-9"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Prazo (opcional)</Label>
                    <Input 
                      type="date"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="bg-slate-800 border-white/10 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Categoria (opcional)</Label>
                    <Input 
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="Ex: Viagem, Investimento..."
                      className="bg-slate-800 border-white/10 text-white"
                    />
                  </div>
                </div>
                <Button onClick={handleCreate} className="w-full bg-gradient-to-r from-primary to-blue-500">
                  Criar Meta
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="ativas" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-900/50 border border-white/10">
            <TabsTrigger value="ativas">Ativas ({metasAtivas.length})</TabsTrigger>
            <TabsTrigger value="concluidas">Concluídas ({metasConcluidas.length})</TabsTrigger>
          </TabsList>
          
          {/* Metas Ativas */}
          <TabsContent value="ativas" className="mt-6">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="bg-slate-900/50 border-white/10 animate-pulse">
                    <CardContent className="h-64" />
                  </Card>
                ))}
              </div>
            ) : metasAtivas.length === 0 ? (
              <Card className="bg-slate-900/50 border-white/10">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Target className="w-16 h-16 text-slate-600 mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Nenhuma meta ativa</h3>
                  <p className="text-slate-400 mb-6 max-w-md">
                    Crie metas para seus objetivos financeiros e acompanhe seu progresso
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)} className="gap-2 bg-gradient-to-r from-primary to-blue-500">
                    <Plus className="w-4 h-4" />
                    Criar Primeira Meta
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {metasAtivas.map((meta, index) => (
                  <MetaCard key={meta.id} meta={meta} index={index} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Metas Concluídas */}
          <TabsContent value="concluidas" className="mt-6">
            {metasConcluidas.length === 0 ? (
              <Card className="bg-slate-900/50 border-white/10">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Trophy className="w-16 h-16 text-slate-600 mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Nenhuma meta concluída</h3>
                  <p className="text-slate-400">Conclua suas metas ativas para vê-las aqui</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {metasConcluidas.map((meta, index) => (
                  <MetaCard key={meta.id} meta={meta} index={index} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Dialog Adicionar Progresso */}
        <Dialog open={isAddProgressOpen} onOpenChange={setIsAddProgressOpen}>
          <DialogContent className="bg-slate-900 border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white">Adicionar Progresso</DialogTitle>
            </DialogHeader>
            {selectedMeta && (
              <div className="space-y-4 pt-4">
                <div className="p-4 bg-slate-800/50 rounded-lg">
                  <p className="text-slate-400 text-sm">Meta</p>
                  <p className="text-white font-medium">{selectedMeta.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-slate-400 text-sm">Atual</span>
                    <span className="text-white">{formatCurrency(selectedMeta.current_amount)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Objetivo</span>
                    <span className="text-primary">{formatCurrency(selectedMeta.target_amount)}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-slate-300">Valor a Adicionar</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      type="number"
                      step="0.01"
                      value={progressValue}
                      onChange={(e) => setProgressValue(e.target.value)}
                      placeholder="0.00"
                      className="bg-slate-800 border-white/10 text-white pl-9"
                    />
                  </div>
                </div>
                <Button onClick={handleAddProgress} className="w-full bg-gradient-to-r from-primary to-blue-500 gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Adicionar Progresso
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Metas;
