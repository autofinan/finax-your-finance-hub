import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Parcelamento, ParcelaAberta } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';
import { useUsuarioId } from '@/hooks/useUsuarioId';

export function useParcelamentos(usuarioIdProp?: string) {
  const [parcelamentos, setParcelamentos] = useState<Parcelamento[]>([]);
  const [parcelasAbertas, setParcelasAbertas] = useState<ParcelaAberta[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  
  // Usar hook para buscar usuario_id via auth_id
  const { usuarioId: resolvedUsuarioId, loading: loadingUsuarioId } = useUsuarioId();
  const usuarioId = usuarioIdProp || resolvedUsuarioId;

  const fetchParcelamentos = async () => {
    if (loadingUsuarioId) return;
    
    try {
      setLoading(true);
      
      // Buscar todos os parcelamentos
      let query = supabase
        .from('parcelamentos')
        .select('*')
        .eq('ativa', true)
        .order('created_at', { ascending: false });

      if (usuarioId) {
        query = query.eq('usuario_id', usuarioId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setParcelamentos((data as Parcelamento[]) || []);

      // Buscar parcelas abertas via view
      let queryAbertas = supabase
        .from('vw_parcelas_abertas')
        .select('*');

      if (usuarioId) {
        queryAbertas = queryAbertas.eq('usuario_id', usuarioId);
      }

      const { data: dataAbertas, error: errorAbertas } = await queryAbertas;

      if (errorAbertas) {
        console.error('Erro ao buscar parcelas abertas:', errorAbertas);
      } else {
        setParcelasAbertas((dataAbertas as ParcelaAberta[]) || []);
      }

    } catch (error) {
      console.error('Erro ao buscar parcelamentos:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os parcelamentos.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addParcelamento = async (parcelamento: Omit<Parcelamento, 'id' | 'created_at'>) => {
    // Validar que temos usuarioId
    if (!usuarioId) {
      toast({
        title: 'Erro',
        description: 'Você precisa estar conectado via WhatsApp para adicionar parcelamentos.',
        variant: 'destructive',
      });
      throw new Error('Usuario não vinculado');
    }

    try {
      const { data, error } = await supabase
        .from('parcelamentos')
        .insert([{ ...parcelamento, usuario_id: usuarioId }])
        .select()
        .single();

      if (error) throw error;

      setParcelamentos((prev) => [data as Parcelamento, ...prev]);
      toast({
        title: 'Sucesso',
        description: 'Parcelamento adicionado com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao adicionar parcelamento:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível adicionar o parcelamento.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const updateParcelamento = async (id: string, updates: Partial<Parcelamento>) => {
    try {
      const { data, error } = await supabase
        .from('parcelamentos')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setParcelamentos((prev) =>
        prev.map((p) => (p.id === id ? (data as Parcelamento) : p))
      );
      toast({
        title: 'Sucesso',
        description: 'Parcelamento atualizado com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao atualizar parcelamento:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar o parcelamento.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const deleteParcelamento = async (id: string) => {
    try {
      const { error } = await supabase.from('parcelamentos').delete().eq('id', id);

      if (error) throw error;

      setParcelamentos((prev) => prev.filter((p) => p.id !== id));
      toast({
        title: 'Sucesso',
        description: 'Parcelamento removido com sucesso!',
      });
    } catch (error) {
      console.error('Erro ao deletar parcelamento:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível remover o parcelamento.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  useEffect(() => {
    if (!loadingUsuarioId) {
      fetchParcelamentos();
    }
  }, [usuarioId, loadingUsuarioId]);

  // Realtime subscription para atualizações via WhatsApp
  useEffect(() => {
    if (!usuarioId) return;

    const channel = supabase
      .channel('parcelamentos_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'parcelamentos',
          filter: `usuario_id=eq.${usuarioId}`,
        },
        () => {
          console.log('🔄 [REALTIME] Parcelamentos atualizados');
          fetchParcelamentos();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [usuarioId]);

  return {
    parcelamentos,
    parcelasAbertas,
    loading,
    addParcelamento,
    updateParcelamento,
    deleteParcelamento,
    refetch: fetchParcelamentos,
  };
}
