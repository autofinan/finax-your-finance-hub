import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect } from 'react';
import { User, Bell, Shield, Download, Trash2, LogOut, Smartphone, Loader2, Tag, Plus, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

interface Categoria {
  id: string;
  nome: string;
  tipo: string;
  usuario_id: string | null;
}

const Configuracoes = () => {
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [notificacoes, setNotificacoes] = useState(true);
  const [alertaOrcamento50, setAlertaOrcamento50] = useState(true);
  const [alertaOrcamento80, setAlertaOrcamento80] = useState(true);
  const [alertaOrcamento100, setAlertaOrcamento100] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  // Categories state
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loadingCategorias, setLoadingCategorias] = useState(true);
  const [novaCategoria, setNovaCategoria] = useState('');
  const [novaTipo, setNovaTipo] = useState<'saida' | 'entrada'>('saida');
  const [isAddCatOpen, setIsAddCatOpen] = useState(false);

  useEffect(() => {
    if (user) {
      setNome(user.nome || '');
      setTelefone(user.phone || '');
    }
  }, [user]);

  // Load categories
  useEffect(() => {
    async function loadCategorias() {
      if (!user?.id) return;
      try {
        const { data, error } = await supabase
          .from('categorias')
          .select('*')
          .or(`usuario_id.eq.${user.id},usuario_id.is.null`)
          .order('nome');
        if (error) throw error;
        setCategorias(data || []);
      } catch (error) {
        console.error('Erro ao carregar categorias:', error);
      } finally {
        setLoadingCategorias(false);
      }
    }
    loadCategorias();
  }, [user?.id]);

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from('usuarios')
        .update({ nome: nome })
        .eq('id', user.id);
      if (error) throw error;
      toast({
        title: 'Configurações salvas',
        description: 'Suas preferências foram atualizadas com sucesso.',
      });
    } catch (error) {
      console.error('Erro ao salvar:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível salvar as configurações.',
        variant: 'destructive',
      });
    }
  };

  const handleAddCategoria = async () => {
    if (!user?.id || !novaCategoria.trim()) return;
    try {
      const { data, error } = await supabase
        .from('categorias')
        .insert({ nome: novaCategoria.toLowerCase(), tipo: novaTipo, usuario_id: user.id })
        .select()
        .single();
      if (error) throw error;
      setCategorias(prev => [...prev, data]);
      setNovaCategoria('');
      setIsAddCatOpen(false);
      toast({ title: 'Categoria criada!' });
    } catch (error) {
      console.error('Erro ao criar categoria:', error);
      toast({ title: 'Erro ao criar categoria', variant: 'destructive' });
    }
  };

  const handleDeleteCategoria = async (id: string) => {
    try {
      const { error } = await supabase.from('categorias').delete().eq('id', id);
      if (error) throw error;
      setCategorias(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Categoria removida' });
    } catch (error) {
      console.error('Erro ao remover:', error);
      toast({ title: 'Erro ao remover', variant: 'destructive' });
    }
  };

  const handleExport = async () => {
    if (!user?.id) return;
    setExporting(true);
    try {
      const [transacoes, parcelamentos, cartoes, contasPagar, gastosRecorrentes] = await Promise.all([
        supabase.from('transacoes').select('*').eq('usuario_id', user.id).order('data', { ascending: false }),
        supabase.from('parcelamentos').select('*').eq('usuario_id', user.id),
        supabase.from('cartoes_credito').select('*').eq('usuario_id', user.id),
        supabase.from('contas_pagar').select('*').eq('usuario_id', user.id),
        supabase.from('gastos_recorrentes').select('*').eq('usuario_id', user.id),
      ]);

      const exportData = {
        exportado_em: new Date().toISOString(),
        usuario: { nome: user.nome, telefone: user.phone, plano: user.plano },
        transacoes: transacoes.data || [],
        parcelamentos: parcelamentos.data || [],
        cartoes: cartoes.data || [],
        contas_pagar: contasPagar.data || [],
        gastos_recorrentes: gastosRecorrentes.data || [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finax-dados-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: 'Dados exportados!', description: 'O arquivo JSON foi baixado com sucesso.' });
    } catch (error) {
      console.error('Erro ao exportar:', error);
      toast({ title: 'Erro', description: 'Não foi possível exportar os dados.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAllData = async () => {
    if (!user?.id) return;
    setDeleting(true);
    try {
      const tables = ['parcelas', 'parcelamentos', 'contas_pagar', 'gastos_recorrentes', 'transacoes', 'faturas', 'faturas_cartao', 'cartoes_credito', 'orcamentos'] as const;
      for (const table of tables) {
        await supabase.from(table).delete().eq('usuario_id', user.id);
      }
      toast({ title: 'Dados excluídos', description: 'Todos os seus dados financeiros foram removidos.' });
    } catch (error) {
      console.error('Erro ao excluir dados:', error);
      toast({ title: 'Erro', description: 'Não foi possível excluir todos os dados.', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const getPlanoBadge = () => {
    if (user?.plano === 'pro') return { label: 'Pro', color: 'bg-gradient-to-r from-indigo-500 to-purple-500' };
    if (user?.plano === 'basico') return { label: 'Básico', color: 'bg-gradient-to-r from-blue-500 to-cyan-500' };
    return { label: 'Trial', color: 'bg-gradient-to-r from-amber-500 to-orange-500' };
  };

  const planoBadge = getPlanoBadge();
  const categoriasUsuario = categorias.filter(c => c.usuario_id === user?.id);
  const categoriasGlobais = categorias.filter(c => c.usuario_id === null);

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        <div className="relative z-10 max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-slate-500 font-medium mb-1">Personalize</p>
            <h1 className="text-4xl font-bold text-white">
              Configurações <span className="text-indigo-400">⚙️</span>
            </h1>
          </motion.div>

          <Tabs defaultValue="perfil" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-slate-900/60 border border-white/10">
              <TabsTrigger value="perfil">Perfil</TabsTrigger>
              <TabsTrigger value="categorias">Categorias</TabsTrigger>
              <TabsTrigger value="alertas">Alertas</TabsTrigger>
            </TabsList>

            {/* PERFIL TAB */}
            <TabsContent value="perfil" className="mt-6 space-y-6">
              {/* Profile Card */}
              <Card className="bg-slate-900/40 border-white/5">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                      <User className="w-8 h-8 text-white" />
                    </div>
                    <div className="flex-1">
                      <h2 className="font-bold text-xl text-white">{user?.nome || 'Usuário Finax'}</h2>
                      <p className="text-slate-500">{user?.phone || 'Sem telefone'}</p>
                    </div>
                    <span className={`px-4 py-2 rounded-full text-sm font-bold text-white ${planoBadge.color}`}>
                      {planoBadge.label}
                    </span>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-slate-300">Nome</Label>
                      <Input placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)}
                        className="bg-slate-800/50 border-slate-700 text-white" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">Telefone (WhatsApp)</Label>
                      <div className="relative">
                        <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                        <Input placeholder="+55 11 99999-9999" value={telefone} disabled
                          className="pl-12 bg-slate-800/50 border-slate-700 text-slate-400 cursor-not-allowed" />
                      </div>
                      <p className="text-xs text-slate-500">Vinculado à sua conta Finax via WhatsApp</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Data & Privacy */}
              <Card className="bg-slate-900/40 border-white/5">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Shield className="w-5 h-5 text-indigo-400" />
                    Dados e Privacidade
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full justify-start gap-3 bg-slate-800/30 border-slate-700 text-white hover:bg-slate-800/50" 
                    onClick={handleExport} disabled={exporting}>
                    {exporting ? <Loader2 className="w-5 h-5 animate-spin text-indigo-400" /> : <Download className="w-5 h-5 text-indigo-400" />}
                    {exporting ? 'Exportando...' : 'Exportar meus dados'}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="w-full justify-start gap-3 bg-slate-800/30 border-slate-700 text-red-400 hover:bg-red-500/10" disabled={deleting}>
                        {deleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                        {deleting ? 'Excluindo...' : 'Excluir todos os dados'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-slate-900 border-slate-700">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">⚠️ Excluir todos os dados?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-400">
                          Essa ação é <strong className="text-red-400">irreversível</strong>. Todas as suas transações serão removidas.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white">Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteAllData} className="bg-red-500 hover:bg-red-600 text-white">
                          Sim, excluir tudo
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button onClick={handleSave} className="flex-1 bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90">
                  Salvar Configurações
                </Button>
                <Button variant="outline" onClick={handleLogout} className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10">
                  <LogOut className="w-4 h-4 mr-2" /> Sair
                </Button>
              </div>
            </TabsContent>

            {/* CATEGORIAS TAB */}
            <TabsContent value="categorias" className="mt-6 space-y-6">
              <Card className="bg-slate-900/40 border-white/5">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Tag className="w-5 h-5 text-indigo-400" />
                    Suas Categorias
                  </CardTitle>
                  <Dialog open={isAddCatOpen} onOpenChange={setIsAddCatOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="gap-1 bg-indigo-500 hover:bg-indigo-600">
                        <Plus className="w-4 h-4" /> Nova
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-slate-900 border-slate-700">
                      <DialogHeader>
                        <DialogTitle className="text-white">Criar Categoria</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-4">
                        <div>
                          <Label className="text-slate-300">Nome</Label>
                          <Input value={novaCategoria} onChange={(e) => setNovaCategoria(e.target.value)} placeholder="Ex: assinaturas"
                            className="bg-slate-800/50 border-slate-700 text-white" />
                        </div>
                        <div>
                          <Label className="text-slate-300">Tipo</Label>
                          <div className="flex gap-2 mt-2">
                            <Button variant={novaTipo === 'saida' ? 'default' : 'outline'} onClick={() => setNovaTipo('saida')}
                              className={novaTipo === 'saida' ? 'bg-red-500' : ''}>Saída</Button>
                            <Button variant={novaTipo === 'entrada' ? 'default' : 'outline'} onClick={() => setNovaTipo('entrada')}
                              className={novaTipo === 'entrada' ? 'bg-emerald-500' : ''}>Entrada</Button>
                          </div>
                        </div>
                        <Button onClick={handleAddCategoria} className="w-full bg-indigo-500">Criar</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingCategorias ? (
                    <div className="text-slate-400 text-center py-8">Carregando...</div>
                  ) : (
                    <>
                      {categoriasUsuario.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500 uppercase">Personalizadas</p>
                          <div className="flex flex-wrap gap-2">
                            {categoriasUsuario.map((cat) => (
                              <Badge key={cat.id} variant="outline" className="gap-2 text-white border-slate-600 pr-1">
                                {cat.nome}
                                <button onClick={() => handleDeleteCategoria(cat.id)} className="hover:text-red-400 transition-colors">
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-xs text-slate-500 uppercase">Padrão do Sistema</p>
                        <div className="flex flex-wrap gap-2">
                          {categoriasGlobais.map((cat) => (
                            <Badge key={cat.id} variant="secondary" className="text-slate-300">
                              {cat.nome}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ALERTAS TAB */}
            <TabsContent value="alertas" className="mt-6 space-y-6">
              <Card className="bg-slate-900/40 border-white/5">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Bell className="w-5 h-5 text-indigo-400" />
                    Notificações WhatsApp
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl">
                    <div>
                      <p className="font-medium text-white">Receber notificações</p>
                      <p className="text-sm text-slate-500">Ative para receber lembretes e alertas</p>
                    </div>
                    <Switch checked={notificacoes} onCheckedChange={setNotificacoes} className="data-[state=checked]:bg-indigo-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-900/40 border-white/5">
                <CardHeader>
                  <CardTitle className="text-white">Alertas de Orçamento</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl">
                    <div>
                      <p className="font-medium text-white">Alerta 50%</p>
                      <p className="text-sm text-slate-500">Aviso quando atingir metade do orçamento</p>
                    </div>
                    <Switch checked={alertaOrcamento50} onCheckedChange={setAlertaOrcamento50} className="data-[state=checked]:bg-amber-500" />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl">
                    <div>
                      <p className="font-medium text-white">Alerta 80%</p>
                      <p className="text-sm text-slate-500">Aviso quando atingir 80% do orçamento</p>
                    </div>
                    <Switch checked={alertaOrcamento80} onCheckedChange={setAlertaOrcamento80} className="data-[state=checked]:bg-orange-500" />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl">
                    <div>
                      <p className="font-medium text-white">Alerta 100%</p>
                      <p className="text-sm text-slate-500">Aviso quando exceder o orçamento</p>
                    </div>
                    <Switch checked={alertaOrcamento100} onCheckedChange={setAlertaOrcamento100} className="data-[state=checked]:bg-red-500" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
};

export default Configuracoes;
