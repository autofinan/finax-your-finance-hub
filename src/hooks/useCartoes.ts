import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CartaoCredito } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';

export function useCartoes(usuarioId?: string) {
  const [cartoes, setCartoes] = useState<CartaoCredito[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchCartoes = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('cartoes_credito')
        .select('*')
        .order('created_at', { ascending: false });

      if (usuarioId) {
        query = query.eq('usuario_id', usuarioId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCartoes((data as CartaoCredito[]) || []);
    } catch (error) {
      console.error('Erro ao buscar cartões:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os cartões.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addCartao = async (cartao: Omit<CartaoCredito, 'id' | 'created_at'>) => {
    try {
      const { data, error } = await supabase
        .from('cartoes_credito')
        .insert([cartao])
        .select()
        .single();

      if (error) throw error;

      setCartoes((prev) => [data as CartaoCredito, ...prev]);
      toast({
        title: 'Sucesso',
        description: 'Cartão adicionado com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao adicionar cartão:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível adicionar o cartão.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const updateCartao = async (id: string, updates: Partial<CartaoCredito>) => {
    try {
      const { data, error } = await supabase
        .from('cartoes_credito')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setCartoes((prev) =>
        prev.map((c) => (c.id === id ? (data as CartaoCredito) : c))
      );
      toast({
        title: 'Sucesso',
        description: 'Cartão atualizado com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao atualizar cartão:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar o cartão.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const deleteCartao = async (id: string) => {
    try {
      const { error } = await supabase.from('cartoes_credito').delete().eq('id', id);

      if (error) throw error;

      setCartoes((prev) => prev.filter((c) => c.id !== id));
      toast({
        title: 'Sucesso',
        description: 'Cartão removido com sucesso!',
      });
    } catch (error) {
      console.error('Erro ao deletar cartão:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível remover o cartão.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchCartoes();
  }, [usuarioId]);

  return {
    cartoes,
    loading,
    addCartao,
    updateCartao,
    deleteCartao,
    refetch: fetchCartoes,
  };
}
