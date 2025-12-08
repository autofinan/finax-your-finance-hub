import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useState } from 'react';
import { User, Bell, Moon, Shield, Download, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const Configuracoes = () => {
  const { toast } = useToast();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [notificacoes, setNotificacoes] = useState(true);
  const [temaEscuro, setTemaEscuro] = useState(false);

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

  return (
    <AppLayout>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-3xl font-bold">Configurações</h1>
          <p className="text-muted-foreground">
            Gerencie suas preferências e dados
          </p>
        </div>

        <div className="glass rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold">Perfil</h2>
              <p className="text-sm text-muted-foreground">Informações pessoais</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                placeholder="Seu nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone (WhatsApp)</Label>
              <Input
                id="telefone"
                placeholder="+55 11 99999-9999"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Usado para receber notificações e interagir com o FinBot via WhatsApp
              </p>
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold">Notificações</h2>
              <p className="text-sm text-muted-foreground">Preferências de alertas</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Notificações por WhatsApp</p>
              <p className="text-sm text-muted-foreground">
                Receba lembretes e alertas de gastos
              </p>
            </div>
            <Switch checked={notificacoes} onCheckedChange={setNotificacoes} />
          </div>
        </div>

        <div className="glass rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold">Aparência</h2>
              <p className="text-sm text-muted-foreground">Personalização visual</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Tema Escuro</p>
              <p className="text-sm text-muted-foreground">
                Usar tema escuro na interface
              </p>
            </div>
            <Switch checked={temaEscuro} onCheckedChange={setTemaEscuro} />
          </div>
        </div>

        <div className="glass rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold">Dados e Privacidade</h2>
              <p className="text-sm text-muted-foreground">Gerenciamento de dados</p>
            </div>
          </div>

          <div className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Exportar meus dados
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2 text-destructive hover:text-destructive">
              <Trash2 className="w-4 h-4" />
              Excluir todos os dados
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave}>Salvar Configurações</Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default Configuracoes;
