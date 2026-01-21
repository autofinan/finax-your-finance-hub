import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect } from 'react';
import { User, Bell, Shield, Download, Trash2, LogOut, Smartphone, CreditCard, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

const Configuracoes = () => {
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [notificacoes, setNotificacoes] = useState(true);

  useEffect(() => {
    if (user) {
      setNome(user.nome || '');
      setTelefone(user.phone || '');
    }
  }, [user]);

  const handleSave = () => {
    toast({
      title: 'Configurações salvas',
      description: 'Suas preferências foram atualizadas com sucesso.',
    });
  };

  const handleExport = () => {
    toast({
      title: 'Exportação iniciada',
      description: 'Seus dados serão baixados em breve.',
    });
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
        {/* Background Effects */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
        </div>

        <div className="fixed inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="text-slate-500 font-medium mb-1">Personalize</p>
            <h1 className="text-4xl font-bold text-white">
              Configurações <span className="text-indigo-400">⚙️</span>
            </h1>
          </motion.div>

          {/* Profile Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all"
          >
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
                <Input
                  placeholder="Seu nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Telefone (WhatsApp)</Label>
                <div className="relative">
                  <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    placeholder="+55 11 99999-9999"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    disabled
                    className="pl-12 bg-slate-800/50 border-slate-700 text-slate-400 cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Vinculado à sua conta Finax via WhatsApp
                </p>
              </div>
            </div>
          </motion.div>

          {/* Notifications */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all"
          >
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
                <p className="text-sm text-slate-500">
                  Receba lembretes e alertas de gastos
                </p>
              </div>
              <Switch 
                checked={notificacoes} 
                onCheckedChange={setNotificacoes}
                className="data-[state=checked]:bg-indigo-500"
              />
            </div>
          </motion.div>

          {/* Data & Privacy */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all"
          >
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
              <Button 
                variant="outline" 
                className="w-full justify-start gap-3 bg-slate-800/30 border-slate-700 text-white hover:bg-slate-800/50" 
                onClick={handleExport}
              >
                <Download className="w-5 h-5 text-indigo-400" />
                Exportar meus dados
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start gap-3 bg-slate-800/30 border-slate-700 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="w-5 h-5" />
                Excluir todos os dados
              </Button>
            </div>
          </motion.div>

          {/* Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Button 
              onClick={handleSave}
              className="flex-1 bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90"
            >
              Salvar Configurações
            </Button>
            <Button 
              variant="outline"
              onClick={handleLogout}
              className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Configuracoes;
