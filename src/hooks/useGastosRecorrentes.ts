import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { GastoRecorrente } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';

export function useGastosRecorrentes(usuarioId?: string) {
  const [gastos, setGastos] = useState<GastoRecorrente[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchGastos = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('gastos_recorrentes')
        .select('*')
        .order('created_at', { ascending: false });

      if (usuarioId) {
        query = query.eq('usuario_id', usuarioId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setGastos((data as GastoRecorrente[]) || []);
    } catch (error) {
      console.error('Erro ao buscar gastos recorrentes:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os gastos recorrentes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addGasto = async (gasto: Omit<GastoRecorrente, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const { data, error } = await supabase
        .from('gastos_recorrentes')
        .insert([gasto])
        .select()
        .single();

      if (error) throw error;

      setGastos((prev) => [data as GastoRecorrente, ...prev]);
      toast({
        title: 'Sucesso',
        description: 'Gasto recorrente adicionado com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao adicionar gasto recorrente:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível adicionar o gasto recorrente.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const updateGasto = async (id: string, updates: Partial<GastoRecorrente>) => {
    try {
      const { data, error } = await supabase
        .from('gastos_recorrentes')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setGastos((prev) =>
        prev.map((g) => (g.id === id ? (data as GastoRecorrente) : g))
      );
      toast({
        title: 'Sucesso',
        description: 'Gasto recorrente atualizado com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao atualizar gasto recorrente:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar o gasto recorrente.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const deleteGasto = async (id: string) => {
    try {
      const { error } = await supabase.from('gastos_recorrentes').delete().eq('id', id);

      if (error) throw error;

      setGastos((prev) => prev.filter((g) => g.id !== id));
      toast({
        title: 'Sucesso',
        description: 'Gasto recorrente removido com sucesso!',
      });
    } catch (error) {
      console.error('Erro ao deletar gasto recorrente:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível remover o gasto recorrente.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchGastos();
  }, [usuarioId]);

  return {
    gastos,
    loading,
    addGasto,
    updateGasto,
    deleteGasto,
    refetch: fetchGastos,
  };
}
