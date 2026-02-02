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
import { 
  Plus, 
  Target, 
  TrendingUp,
  CheckCircle2,
  XCircle,
  DollarSign,
  Calendar,
  Trash2,
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
    getInsightMeta,
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
    const insightMeta = getInsightMeta(meta);

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
      >
        <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-all hover:shadow-lg hover:shadow-primary/10">
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
                  <CardTitle className="text-foreground text-lg">{meta.name}</CardTitle>
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
                <span className="text-muted-foreground">Progresso</span>
                <span className={`font-semibold ${
                  progress >= 100 ? 'text-emerald-400' : 'text-foreground'
                }`}>
                  {progress.toFixed(0)}%
                </span>
              </div>
              <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(progress, 100)}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full ${getProgressColor(progress)} rounded-full`}
                />
              </div>
              
              {/* 💡 Insight: Valor necessário por período */}
              {insightMeta && progress < 100 && (
                <div className="flex items-center gap-2 text-sm bg-gradient-to-r from-primary/10 to-blue-500/10 rounded-lg px-3 py-2 border border-primary/20">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span className="text-primary font-medium">{insightMeta}</span>
                </div>
              )}
            </div>

            {/* Valores */}
            <div className="p-3 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Atual</span>
                <span className="text-foreground font-semibold">
                  {formatCurrency(meta.current_amount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Objetivo</span>
                <span className="text-primary font-semibold">
                  {formatCurrency(meta.target_amount)}
                </span>
              </div>
              {valorFaltante > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-muted-foreground text-sm">Faltam</span>
                  <span className="text-amber-400 font-semibold">
                    {formatCurrency(valorFaltante)}
                  </span>
                </div>
              )}
            </div>

            {/* Prazo */}
            {meta.deadline && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-foreground">
                  {formatDate(meta.deadline)}
                  {diasRestantes !== null && diasRestantes >= 0 && (
                    <span className="text-muted-foreground ml-2">
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
                  className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                  onClick={() => cancelarMeta(meta.id)}
                >
                  <XCircle className="w-4 h-4" />
                </Button>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  className="text-muted-foreground hover:text-foreground"
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
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          >
            <div>
              <p className="text-muted-foreground font-medium mb-1">Seus objetivos</p>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center">
                  <Target className="w-6 h-6 text-primary-foreground" />
                </div>
                Metas Financeiras
              </h1>
            </div>
            
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-gradient-to-r from-primary to-blue-500 hover:opacity-90 shadow-lg shadow-primary/20">
                  <Plus className="w-4 h-4" />
                  Nova Meta
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="text-foreground flex items-center gap-2">
                    <Target className="w-5 h-5 text-primary" />
                    Criar Nova Meta
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <Label className="text-foreground">Nome da Meta</Label>
                    <Input 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Viagem para Europa, Carro Novo..."
                      className="bg-muted border-border text-foreground"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground">Valor Objetivo</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        type="number"
                        step="0.01"
                        value={targetAmount}
                        onChange={(e) => setTargetAmount(e.target.value)}
                        placeholder="0.00"
                        className="bg-muted border-border text-foreground pl-9"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-foreground">Prazo (opcional)</Label>
                      <Input 
                        type="date"
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                        className="bg-muted border-border text-foreground"
                      />
                    </div>
                    <div>
                      <Label className="text-foreground">Categoria (opcional)</Label>
                      <Input 
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="Ex: Viagem, Investimento..."
                        className="bg-muted border-border text-foreground"
                      />
                    </div>
                  </div>
                  <Button onClick={handleCreate} className="w-full bg-gradient-to-r from-primary to-blue-500">
                    Criar Meta
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </motion.div>

          {/* Tabs */}
          <Tabs defaultValue="ativas" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted/50 border border-border">
              <TabsTrigger value="ativas">Ativas ({metasAtivas.length})</TabsTrigger>
              <TabsTrigger value="concluidas">Concluídas ({metasConcluidas.length})</TabsTrigger>
            </TabsList>
            
            {/* Metas Ativas */}
            <TabsContent value="ativas" className="mt-6">
              {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="bg-card/50 border-border animate-pulse">
                      <CardContent className="h-64" />
                    </Card>
                  ))}
                </div>
              ) : metasAtivas.length === 0 ? (
                <Card className="bg-card/50 border-border">
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                    <Target className="w-16 h-16 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">Nenhuma meta ativa</h3>
                    <p className="text-muted-foreground mb-6 max-w-md">
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
                <Card className="bg-card/50 border-border">
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                    <Trophy className="w-16 h-16 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">Nenhuma meta concluída</h3>
                    <p className="text-muted-foreground">Conclua suas metas ativas para vê-las aqui</p>
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
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">Adicionar Progresso</DialogTitle>
              </DialogHeader>
              {selectedMeta && (
                <div className="space-y-4 pt-4">
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-muted-foreground text-sm">Meta</p>
                    <p className="text-foreground font-medium">{selectedMeta.name}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-muted-foreground text-sm">Atual</span>
                      <span className="text-foreground">{formatCurrency(selectedMeta.current_amount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-sm">Objetivo</span>
                      <span className="text-primary">{formatCurrency(selectedMeta.target_amount)}</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-foreground">Valor a Adicionar</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        type="number"
                        step="0.01"
                        value={progressValue}
                        onChange={(e) => setProgressValue(e.target.value)}
                        placeholder="0.00"
                        className="bg-muted border-border text-foreground pl-9"
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
      </div>
    </AppLayout>
  );
};

export default Metas;
