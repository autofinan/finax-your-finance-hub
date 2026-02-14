import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { useContasPagar, ContaPagar } from '@/hooks/useContasPagar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  Receipt, 
  Calendar, 
  Bell, 
  Trash2, 
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';

const ContasPagar = () => {
  const { usuarioId } = useUsuarioId();
  const { contas, loading, criarConta, desativarConta, registrarPagamento, calcularDiasAteVencimento } = useContasPagar(usuarioId || undefined);
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [selectedConta, setSelectedConta] = useState<ContaPagar | null>(null);
  
  // Form states
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'cartao' | 'fixa' | 'variavel'>('fixa');
  const [diaVencimento, setDiaVencimento] = useState('');
  const [valorEstimado, setValorEstimado] = useState('');
  const [valorPago, setValorPago] = useState('');

  const handleCreate = async () => {
    if (!nome || !diaVencimento) return;
    
    await criarConta({
      nome,
      tipo,
      dia_vencimento: parseInt(diaVencimento),
      valor_estimado: valorEstimado ? parseFloat(valorEstimado) : null,
      lembrar_dias_antes: 3,
      ativa: true,
    });
    
    setIsCreateOpen(false);
    setNome('');
    setTipo('fixa');
    setDiaVencimento('');
    setValorEstimado('');
  };

  const handlePay = async () => {
    if (!selectedConta || !valorPago) return;
    
    await registrarPagamento(selectedConta.id, parseFloat(valorPago));
    
    setIsPayOpen(false);
    setSelectedConta(null);
    setValorPago('');
  };

  const getStatusBadge = (conta: ContaPagar) => {
    // ✅ FIX DASH-3: Verificar se já foi pago este mês
    const pagoEsteMes = pagamentos.find(p => p.conta_id === conta.id);
    
    if (pagoEsteMes) {
      const dataPag = new Date(pagoEsteMes.data_pagamento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return <Badge className="gap-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30"><CheckCircle2 className="w-3 h-3" /> Pago em {dataPag}</Badge>;
    }

    const dias = calcularDiasAteVencimento(conta.dia_vencimento);
    
    if (dias === null) return null;
    
    if (dias === 0) {
      return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> Vence hoje</Badge>;
    } else if (dias <= 3) {
      return <Badge variant="outline" className="gap-1 border-amber-500 text-amber-500"><Clock className="w-3 h-3" /> {dias} dias</Badge>;
    } else {
      return <Badge className="gap-1 bg-blue-500/20 text-blue-400 border-blue-500/30"><Calendar className="w-3 h-3" /> Dia {conta.dia_vencimento}</Badge>;
    }
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
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
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                <Receipt className="w-6 h-6 text-white" />
              </div>
              Contas a Pagar
            </h1>
            <p className="text-slate-400 text-sm mt-1">Gerencie suas faturas e contas fixas mensais</p>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:opacity-90 shadow-lg shadow-indigo-500/20">
                <Plus className="w-4 h-4" />
                Nova Conta
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-white/10">
              <DialogHeader>
                <DialogTitle className="text-white flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-indigo-400" />
                  Criar Nova Conta
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label className="text-slate-300">Nome</Label>
                  <Input 
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: Energia, Internet, Aluguel..."
                    className="bg-slate-800 border-white/10 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Tipo</Label>
                    <Select value={tipo} onValueChange={(v) => setTipo(v as 'cartao' | 'fixa' | 'variavel')}>
                      <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-white/10">
                        <SelectItem value="fixa">💎 Fixa</SelectItem>
                        <SelectItem value="variavel">📊 Variável</SelectItem>
                        <SelectItem value="cartao">💳 Cartão</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-slate-300">Dia do Vencimento</Label>
                    <Input 
                      type="number"
                      min="1"
                      max="31"
                      value={diaVencimento}
                      onChange={(e) => setDiaVencimento(e.target.value)}
                      placeholder="15"
                      className="bg-slate-800 border-white/10 text-white"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-slate-300">Valor Estimado (opcional)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      type="number"
                      step="0.01"
                      value={valorEstimado}
                      onChange={(e) => setValorEstimado(e.target.value)}
                      placeholder="0.00"
                      className="bg-slate-800 border-white/10 text-white pl-9"
                    />
                  </div>
                </div>
                <Button onClick={handleCreate} className="w-full bg-gradient-to-r from-indigo-500 to-purple-500">
                  Criar Conta
                </Button>
              </div>
            </DialogContent>
          </Dialog>

        {/* Cards Grid */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="bg-slate-900/50 border-white/10 animate-pulse">
                <CardContent className="h-48" />
              </Card>
            ))}
          </div>
        ) : contas.length === 0 ? (
          <Card className="bg-slate-900/50 border-white/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Receipt className="w-16 h-16 text-slate-600 mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Nenhuma conta cadastrada</h3>
              <p className="text-slate-400 mb-6 max-w-md">
                Comece adicionando suas contas fixas como energia, internet, aluguel...
              </p>
              <Button onClick={() => setIsCreateOpen(true)} className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-500">
                <Plus className="w-4 h-4" />
                Adicionar Primeira Conta
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {contas.map((conta, index) => (
              <motion.div
                key={conta.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="bg-slate-900/50 border-white/10 hover:border-white/20 transition-all hover:shadow-lg hover:shadow-indigo-500/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                          <Receipt className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div>
                          <CardTitle className="text-white text-lg">{conta.nome}</CardTitle>
                          <Badge variant="outline" className="text-xs mt-1">
                            {conta.tipo === 'fixa' ? '💎 Fixa' : '📊 Variável'}
                          </Badge>
                        </div>
                      </div>
                      {getStatusBadge(conta)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Informações */}
                    <div className="p-3 bg-slate-800/50 rounded-lg space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400 flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          Vence dia {conta.dia_vencimento}
                        </span>
                        {conta.valor_estimado && (
                          <span className="text-white font-semibold">
                            {formatCurrency(conta.valor_estimado)}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 text-xs text-slate-500 pt-2 border-t border-slate-700">
                        <Bell className="w-3 h-3" />
                        Lembrete {conta.lembrar_dias_antes} dias antes
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        className="flex-1 gap-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400"
                        onClick={() => {
                          setSelectedConta(conta);
                          setIsPayOpen(true);
                        }}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Pagar
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => desativarConta(conta.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* Dialog de Pagamento */}
        <Dialog open={isPayOpen} onOpenChange={setIsPayOpen}>
          <DialogContent className="bg-slate-900 border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Registrar Pagamento
              </DialogTitle>
            </DialogHeader>
            {selectedConta && (
              <div className="space-y-4 pt-4">
                <div className="p-4 bg-slate-800/50 rounded-lg">
                  <p className="text-slate-400 text-sm">Conta</p>
                  <p className="text-white font-medium text-lg">{selectedConta.nome}</p>
                  {selectedConta.valor_estimado && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700">
                      <span className="text-slate-400 text-sm">Valor estimado</span>
                      <span className="text-white">{formatCurrency(selectedConta.valor_estimado)}</span>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-slate-300">Valor Pago</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      type="number"
                      step="0.01"
                      value={valorPago}
                      onChange={(e) => setValorPago(e.target.value)}
                      placeholder="0.00"
                      className="bg-slate-800 border-white/10 text-white pl-9"
                      autoFocus
                    />
                  </div>
                </div>
                <Button onClick={handlePay} className="w-full bg-gradient-to-r from-emerald-500 to-green-500 gap-2 shadow-lg shadow-emerald-500/20">
                  <CheckCircle2 className="w-4 h-4" />
                  Confirmar Pagamento
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

export default ContasPagar;
