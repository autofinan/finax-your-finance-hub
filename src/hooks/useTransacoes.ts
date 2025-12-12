import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Transacao } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';

export function useTransacoes(usuarioId?: string) {
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTransacoes = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('transacoes')
        .select('*')
        .order('data', { ascending: false });

      if (usuarioId) {
        query = query.eq('usuario_id', usuarioId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTransacoes((data as Transacao[]) || []);
    } catch (error) {
      console.error('Erro ao buscar transações:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as transações.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addTransacao = async (transacao: {
    tipo: 'entrada' | 'saida';
    valor: number;
    categoria: string;
    observacao?: string | null;
    data?: string;
    usuario_id?: string | null;
    recorrente?: boolean | null;
    parcela?: string | null;
    parcelamento_id?: string | null;
    fatura_id?: string | null;
    essencial?: boolean | null;
    merchant?: string | null;
    origem?: string | null;
  }) => {
    try {
      const transacaoData = {
        tipo: transacao.tipo,
        valor: transacao.valor,
        categoria: transacao.categoria,
        observacao: transacao.observacao || null,
        data: transacao.data || new Date().toISOString(),
        usuario_id: transacao.usuario_id || null,
        recorrente: transacao.recorrente ?? false,
        parcela: transacao.parcela || null,
        parcelamento_id: transacao.parcelamento_id || null,
        fatura_id: transacao.fatura_id || null,
        essencial: transacao.essencial ?? false,
        merchant: transacao.merchant || null,
        origem: transacao.origem || 'manual',
      };

      const { data, error } = await supabase
        .from('transacoes')
        .insert([transacaoData])
        .select()
        .single();

      if (error) throw error;

      setTransacoes((prev) => [data as Transacao, ...prev]);
      toast({
        title: 'Sucesso',
        description: 'Transação adicionada com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao adicionar transação:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível adicionar a transação.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const deleteTransacao = async (id: string) => {
    try {
      const { error } = await supabase.from('transacoes').delete().eq('id', id);

      if (error) throw error;

      setTransacoes((prev) => prev.filter((t) => t.id !== id));
      toast({
        title: 'Sucesso',
        description: 'Transação removida com sucesso!',
      });
    } catch (error) {
      console.error('Erro ao deletar transação:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível remover a transação.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchTransacoes();
  }, [usuarioId]);

  return {
    transacoes,
    loading,
    addTransacao,
    deleteTransacao,
    refetch: fetchTransacoes,
  };
}
