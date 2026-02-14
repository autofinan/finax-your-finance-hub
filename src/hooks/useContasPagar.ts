import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUsuarioId } from '@/hooks/useUsuarioId';

export interface ContaPagar {
  id: string;
  usuario_id: string;
  nome: string;
  tipo: 'cartao' | 'fixa' | 'variavel';
  dia_vencimento: number | null;
  valor_estimado: number | null;
  lembrar_dias_antes: number;
  ativa: boolean;
  ultimo_lembrete: string | null;
  created_at: string;
  updated_at: string;
}

export interface Pagamento {
  id: string;
  conta_id: string;
  usuario_id: string;
  mes_referencia: string;
  valor_pago: number;
  data_pagamento: string;
  status: 'pendente' | 'pago' | 'atrasado';
  transacao_id: string | null;
  observacao: string | null;
  created_at: string;
}

export function useContasPagar(usuarioIdProp?: string) {
  const [contas, setContas] = useState<ContaPagar[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  
  // Usar hook para buscar usuario_id via auth_id
  const { usuarioId: resolvedUsuarioId, loading: loadingUsuarioId } = useUsuarioId();
  const usuarioId = usuarioIdProp || resolvedUsuarioId;

  const fetchContas = async () => {
    if (loadingUsuarioId) return;
    if (!usuarioId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('usuario_id', usuarioId)
        .eq('ativa', true)
        .order('dia_vencimento', { ascending: true });

      if (error) throw error;
      setContas((data as ContaPagar[]) || []);

      // ✅ FIX DASH-3: Buscar pagamentos do mês atual para mostrar status
      const mesAtual = new Date();
      mesAtual.setDate(1);
      mesAtual.setHours(0, 0, 0, 0);
      
      const { data: pagsMes } = await supabase
        .from('pagamentos')
        .select('*')
        .eq('usuario_id', usuarioId)
        .gte('data_pagamento', mesAtual.toISOString());
      
      setPagamentos((pagsMes as Pagamento[]) || []);

    } catch (error) {
      console.error('Erro ao buscar contas:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as contas.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPagamentos = async (contaId?: string) => {
    if (!usuarioId) return;
    
    try {
      let query = supabase
        .from('pagamentos')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('data_pagamento', { ascending: false });

      if (contaId) {
        query = query.eq('conta_id', contaId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setPagamentos((data as Pagamento[]) || []);

    } catch (error) {
      console.error('Erro ao buscar pagamentos:', error);
    }
  };

  const criarConta = async (conta: Omit<ContaPagar, 'id' | 'usuario_id' | 'created_at' | 'updated_at' | 'ultimo_lembrete'>) => {
    if (!usuarioId) return null;
    
    try {
      const { data, error } = await supabase
        .from('contas_pagar')
        .insert({
          ...conta,
          usuario_id: usuarioId,
        })
        .select()
        .single();

      if (error) throw error;

      setContas(prev => [...prev, data as ContaPagar]);
      
      toast({
        title: 'Sucesso',
        description: 'Conta criada com sucesso!',
      });

      return data;
    } catch (error) {
      console.error('Erro ao criar conta:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível criar a conta.',
        variant: 'destructive',
      });
      return null;
    }
  };

  const atualizarConta = async (id: string, updates: Partial<ContaPagar>) => {
    try {
      const { data, error } = await supabase
        .from('contas_pagar')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setContas(prev => prev.map(c => c.id === id ? (data as ContaPagar) : c));
      
      toast({
        title: 'Sucesso',
        description: 'Conta atualizada!',
      });

      return data;
    } catch (error) {
      console.error('Erro ao atualizar conta:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar a conta.',
        variant: 'destructive',
      });
      return null;
    }
  };

  const desativarConta = async (id: string) => {
    try {
      const { error } = await supabase
        .from('contas_pagar')
        .update({ ativa: false })
        .eq('id', id);

      if (error) throw error;

      setContas(prev => prev.filter(c => c.id !== id));
      
      toast({
        title: 'Sucesso',
        description: 'Conta desativada!',
      });

      return true;
    } catch (error) {
      console.error('Erro ao desativar conta:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível desativar a conta.',
        variant: 'destructive',
      });
      return false;
    }
  };

  const registrarPagamento = async (contaId: string, valorPago: number, observacao?: string) => {
    if (!usuarioId) return null;
    
    try {
      const mesReferencia = new Date();
      mesReferencia.setDate(1);

      const { data, error } = await supabase
        .from('pagamentos')
        .insert({
          conta_id: contaId,
          usuario_id: usuarioId,
          mes_referencia: mesReferencia.toISOString().split('T')[0],
          valor_pago: valorPago,
          status: 'pago',
          observacao,
        })
        .select()
        .single();

      if (error) throw error;

      setPagamentos(prev => [data as Pagamento, ...prev]);
      
      toast({
        title: 'Sucesso',
        description: 'Pagamento registrado!',
      });

      return data;
    } catch (error) {
      console.error('Erro ao registrar pagamento:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível registrar o pagamento.',
        variant: 'destructive',
      });
      return null;
    }
  };

  // Calcular dias até vencimento
  const calcularDiasAteVencimento = (diaVencimento: number | null): number | null => {
    if (!diaVencimento) return null;
    
    const hoje = new Date();
    const diaAtual = hoje.getDate();
    
    if (diaVencimento >= diaAtual) {
      return diaVencimento - diaAtual;
    } else {
      // Próximo mês
      const proximoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      const diasNoMes = proximoMes.getDate();
      return diasNoMes - diaAtual + diaVencimento;
    }
  };

  useEffect(() => {
    if (!loadingUsuarioId) {
      fetchContas();
      fetchPagamentos();
    }
  }, [usuarioId, loadingUsuarioId]);

  return {
    contas,
    pagamentos,
    loading,
    criarConta,
    atualizarConta,
    desativarConta,
    registrarPagamento,
    calcularDiasAteVencimento,
    refetch: () => {
      fetchContas();
      fetchPagamentos();
    },
  };
}
