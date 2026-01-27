import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { useEventos, Evento } from '@/hooks/useEventos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, 
  Palmtree, 
  Calendar, 
  DollarSign,
  CheckCircle2,
  XCircle,
  Edit2,
  Trash2,
  TrendingUp,
  Clock,
  MapPin,
} from 'lucide-react';
import { motion } from 'framer-motion';

const Eventos = () => {
  const { usuarioId } = useUsuarioId();
  const {
    eventos,
    loading,
    criarEvento,
    finalizarEvento,
    cancelarEvento,
    deletarEvento,
    getEventosAtivos,
    getEventosFinalizados,
    calcularDiasRestantes,
    formatCurrency,
  } = useEventos(usuarioId || undefined);
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedEvento, setSelectedEvento] = useState<Evento | null>(null);
  
  // Form states
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleCreate = async () => {
    if (!label || !startDate || !endDate) return;
    
    await criarEvento({
      label,
      description,
      start_date: startDate,
      end_date: endDate,
      auto_tag: true,
    });
    
    setIsCreateOpen(false);
    setLabel('');
    setDescription('');
    setStartDate('');
    setEndDate('');
  };

  const getStatusBadge = (evento: Evento) => {
    if (evento.status === 'completed') {
      return <Badge className="gap-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle2 className="w-3 h-3" /> Finalizado</Badge>;
    }
    if (evento.status === 'cancelled') {
      return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> Cancelado</Badge>;
    }
    
    const dias = calcularDiasRestantes(evento.end_date);
    if (dias === null || dias < 0) {
      return <Badge variant="outline" className="gap-1 border-amber-500 text-amber-500"><Clock className="w-3 h-3" /> Expirado</Badge>;
    }
    
    return <Badge className="gap-1 bg-blue-500/20 text-blue-400 border-blue-500/30"><Calendar className="w-3 h-3" /> {dias} dias</Badge>;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const eventosAtivos = getEventosAtivos();
  const eventosFinalizados = getEventosFinalizados();

  const EventoCard = ({ evento, index }: { evento: Evento; index: number }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="bg-slate-900/50 border-white/10 hover:border-white/20 transition-all hover:shadow-lg hover:shadow-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                <Palmtree className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-white text-lg">{evento.label}</CardTitle>
                {evento.description && (
                  <p className="text-slate-400 text-sm mt-1">{evento.description}</p>
                )}
              </div>
            </div>
            {getStatusBadge(evento)}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Período */}
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-slate-300">
              {formatDate(evento.start_date)} → {formatDate(evento.end_date)}
            </span>
          </div>

          {/* Total Gasto */}
          <div className="p-3 bg-slate-800/50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-sm">Total Gasto</span>
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span className="text-white font-semibold text-lg">
                  {formatCurrency(evento.total_spent)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
              <TrendingUp className="w-3 h-3" />
              {evento.transaction_count} transações
            </div>
          </div>

          {/* Ações */}
          {evento.status === 'active' && (
            <div className="flex gap-2 pt-2">
              <Button 
                size="sm" 
                className="flex-1 gap-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                onClick={() => finalizarEvento(evento.id)}
              >
                <CheckCircle2 className="w-4 h-4" />
                Finalizar
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={() => cancelarEvento(evento.id)}
              >
                <XCircle className="w-4 h-4" />
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                className="text-slate-400 hover:text-slate-300"
                onClick={() => deletarEvento(evento.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                <Palmtree className="w-6 h-6 text-white" />
              </div>
              Eventos & Viagens
            </h1>
            <p className="text-slate-400 text-sm mt-1">Acompanhe gastos de viagens, obras e projetos especiais</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-primary to-purple-500 hover:opacity-90 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4" />
                Novo Evento
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-white/10">
              <DialogHeader>
                <DialogTitle className="text-white flex items-center gap-2">
                  <Palmtree className="w-5 h-5 text-primary" />
                  Criar Novo Evento
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label className="text-slate-300">Nome do Evento</Label>
                  <Input 
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Ex: Viagem para Bahia, Reforma da Casa..."
                    className="bg-slate-800 border-white/10 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Descrição (opcional)</Label>
                  <Textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Detalhes sobre o evento..."
                    className="bg-slate-800 border-white/10 text-white resize-none"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Data Início</Label>
                    <Input 
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-slate-800 border-white/10 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Data Fim</Label>
                    <Input 
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-slate-800 border-white/10 text-white"
                    />
                  </div>
                </div>
                <Button onClick={handleCreate} className="w-full bg-gradient-to-r from-primary to-purple-500">
                  Criar Evento
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="ativos" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-900/50 border border-white/10">
            <TabsTrigger value="ativos">Ativos ({eventosAtivos.length})</TabsTrigger>
            <TabsTrigger value="finalizados">Finalizados ({eventosFinalizados.length})</TabsTrigger>
          </TabsList>
          
          {/* Eventos Ativos */}
          <TabsContent value="ativos" className="mt-6">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="bg-slate-900/50 border-white/10 animate-pulse">
                    <CardContent className="h-48" />
                  </Card>
                ))}
              </div>
            ) : eventosAtivos.length === 0 ? (
              <Card className="bg-slate-900/50 border-white/10">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Palmtree className="w-16 h-16 text-slate-600 mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Nenhum evento ativo</h3>
                  <p className="text-slate-400 mb-6 max-w-md">
                    Crie eventos para acompanhar gastos de viagens, obras ou qualquer período especial
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)} className="gap-2 bg-gradient-to-r from-primary to-purple-500">
                    <Plus className="w-4 h-4" />
                    Criar Primeiro Evento
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {eventosAtivos.map((evento, index) => (
                  <EventoCard key={evento.id} evento={evento} index={index} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Eventos Finalizados */}
          <TabsContent value="finalizados" className="mt-6">
            {eventosFinalizados.length === 0 ? (
              <Card className="bg-slate-900/50 border-white/10">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle2 className="w-16 h-16 text-slate-600 mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Nenhum evento finalizado</h3>
                  <p className="text-slate-400">Finalize seus eventos ativos para vê-los aqui</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {eventosFinalizados.map((evento, index) => (
                  <EventoCard key={evento.id} evento={evento} index={index} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Eventos;
