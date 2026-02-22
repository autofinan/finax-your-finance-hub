import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CartaoCredito } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';
import { useUsuarioId } from '@/hooks/useUsuarioId';

export function useCartoes(usuarioIdProp?: string) {
  const [cartoes, setCartoes] = useState<CartaoCredito[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  
  // Usar hook para buscar usuario_id via telefone do auth
  const { usuarioId: resolvedUsuarioId, loading: loadingUsuarioId } = useUsuarioId();
  
  // Priorizar prop, depois o resolvido via auth
  const usuarioId = usuarioIdProp || resolvedUsuarioId;

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
    // Validar que temos usuarioId
    if (!usuarioId) {
      toast({
        title: 'Erro',
        description: 'Você precisa estar conectado via WhatsApp para adicionar cartões.',
        variant: 'destructive',
      });
      throw new Error('Usuario não vinculado');
    }

    try {
      const { data, error } = await supabase
        .from('cartoes_credito')
        .insert([{ ...cartao, usuario_id: usuarioId }])
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
      // ✅ Se está atualizando limite_total, recalcular limite_disponivel
      if (updates.limite_total !== undefined) {
        const cartaoAtual = cartoes.find(c => c.id === id);
        if (cartaoAtual) {
          const emUso = (Number(cartaoAtual.limite_total) || 0) - (Number(cartaoAtual.limite_disponivel) || 0);
          updates.limite_disponivel = Number(updates.limite_total) - emUso;
          console.log(`💳 Recalculando limite:`);
          console.log(`   Limite antigo: ${cartaoAtual.limite_total}`);
          console.log(`   Limite novo: ${updates.limite_total}`);
          console.log(`   Em uso: ${emUso}`);
          console.log(`   Disponível: ${updates.limite_disponivel}`);
        }
      }

      const { error } = await supabase
        .from('cartoes_credito')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      // ✅ Refetch para garantir dados frescos
      await fetchCartoes();
      
      toast({
        title: 'Sucesso',
        description: 'Cartão atualizado com sucesso!',
      });
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
    if (!loadingUsuarioId) {
      fetchCartoes();
    }
  }, [usuarioId, loadingUsuarioId]);

  return {
    cartoes,
    loading,
    addCartao,
    updateCartao,
    deleteCartao,
    refetch: fetchCartoes,
  };
}
