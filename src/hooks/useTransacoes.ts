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

  const addTransacao = async (transacao: Omit<Transacao, 'id' | 'created_at'>) => {
    try {
      const { data, error } = await supabase
        .from('transacoes')
        .insert([transacao])
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
