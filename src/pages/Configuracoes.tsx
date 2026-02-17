import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect } from 'react';
import { User, Bell, Shield, Download, Trash2, LogOut, Smartphone, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const Configuracoes = () => {
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [notificacoes, setNotificacoes] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user) {
      setNome(user.nome || '');
      setTelefone(user.phone || '');
    }
  }, [user]);

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

  const handleExport = async () => {
    if (!user?.id) return;
    setExporting(true);
    try {
      // Fetch all user data in parallel
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

      // Download as JSON
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finax-dados-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Dados exportados!',
        description: 'O arquivo JSON foi baixado com sucesso.',
      });
    } catch (error) {
      console.error('Erro ao exportar:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível exportar os dados.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAllData = async () => {
    if (!user?.id) return;
    setDeleting(true);
    try {
      // Delete user data from all tables (order matters for FK constraints)
      const tables = [
        'parcelas',
        'parcelamentos', 
        'contas_pagar',
        'gastos_recorrentes',
        'transacoes',
        'faturas',
        'faturas_cartao',
        'cartoes_credito',
        'orcamentos',
      ] as const;

      for (const table of tables) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq('usuario_id', user.id);
        if (error) console.error(`Erro ao deletar ${table}:`, error);
      }

      toast({
        title: 'Dados excluídos',
        description: 'Todos os seus dados financeiros foram removidos.',
      });
    } catch (error) {
      console.error('Erro ao excluir dados:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível excluir todos os dados.',
        variant: 'destructive',
      });
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

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 lg:p-8">
        <div className="relative z-10 max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-slate-500 font-medium mb-1">Personalize</p>
            <h1 className="text-4xl font-bold text-white">
              Configurações <span className="text-indigo-400">⚙️</span>
            </h1>
          </motion.div>

          {/* Profile Card */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all">
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
                  <Input placeholder="+55 11 99999-9999" value={telefone} onChange={(e) => setTelefone(e.target.value)}
                    disabled className="pl-12 bg-slate-800/50 border-slate-700 text-slate-400 cursor-not-allowed" />
                </div>
                <p className="text-xs text-slate-500">Vinculado à sua conta Finax via WhatsApp</p>
              </div>
            </div>
          </motion.div>

          {/* Notifications */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-indigo-500/10">
                <Bell className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="font-bold text-white">Notificações</h2>
                <p className="text-sm text-slate-500">Preferências de alertas</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl">
              <div>
                <p className="font-medium text-white">Notificações por WhatsApp</p>
                <p className="text-sm text-slate-500">Receba lembretes e alertas de gastos</p>
              </div>
              <Switch checked={notificacoes} onCheckedChange={setNotificacoes}
                className="data-[state=checked]:bg-indigo-500" />
            </div>
          </motion.div>

          {/* Data & Privacy */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-indigo-500/10">
                <Shield className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="font-bold text-white">Dados e Privacidade</h2>
                <p className="text-sm text-slate-500">Gerenciamento de dados</p>
              </div>
            </div>

            <div className="space-y-3">
              <Button variant="outline" 
                className="w-full justify-start gap-3 bg-slate-800/30 border-slate-700 text-white hover:bg-slate-800/50" 
                onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="w-5 h-5 animate-spin text-indigo-400" /> : <Download className="w-5 h-5 text-indigo-400" />}
                {exporting ? 'Exportando...' : 'Exportar meus dados'}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline"
                    className="w-full justify-start gap-3 bg-slate-800/30 border-slate-700 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                    disabled={deleting}>
                    {deleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                    {deleting ? 'Excluindo...' : 'Excluir todos os dados'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-slate-900 border-slate-700">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">⚠️ Excluir todos os dados?</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-400">
                      Essa ação é <strong className="text-red-400">irreversível</strong>. Todas as suas transações, 
                      cartões, parcelamentos, metas e contas a pagar serão permanentemente removidos. 
                      Recomendamos exportar seus dados antes.
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
            </div>
          </motion.div>

          {/* Actions */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-4">
            <Button onClick={handleSave} className="flex-1 bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90">
              Salvar Configurações
            </Button>
            <Button variant="outline" onClick={handleLogout}
              className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10">
              <LogOut className="w-4 h-4 mr-2" /> Sair
            </Button>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Configuracoes;