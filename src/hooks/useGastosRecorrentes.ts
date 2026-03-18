import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { GastoRecorrente } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';
import { useUsuarioId } from '@/hooks/useUsuarioId';

export function useGastosRecorrentes(usuarioIdProp?: string) {
  const [gastos, setGastos] = useState<GastoRecorrente[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  
  // Usar hook para buscar usuario_id via telefone do auth
  const { usuarioId: resolvedUsuarioId, loading: loadingUsuarioId } = useUsuarioId();
  
  // Priorizar prop, depois o resolvido via auth
  const usuarioId = usuarioIdProp || resolvedUsuarioId;

  const fetchGastos = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('gastos_recorrentes')
        .select('*')
        .eq('ativo', true)
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

  const addGasto = async (gasto: {
    descricao?: string | null;
    categoria: string;
    categoria_detalhada?: string | null;
    tipo_recorrencia: string;
    valor_parcela: number;
    valor_total?: number | null;
    dia_mes?: number | null;
    dia_semana?: string | null;
    num_parcelas?: number | null;
    parcela_atual?: number | null;
    ativo?: boolean | null;
    proxima_execucao?: string | null;
    ultima_execucao?: string | null;
    origem?: string | null;
    usuario_id?: string | null;
  }) => {
    // Validar que temos usuarioId
    if (!usuarioId) {
      toast({
        title: 'Erro',
        description: 'Você precisa estar conectado via WhatsApp para adicionar gastos recorrentes.',
        variant: 'destructive',
      });
      throw new Error('Usuario não vinculado');
    }

    try {
      const gastoData = {
        descricao: gasto.descricao || null,
        categoria: gasto.categoria,
        categoria_detalhada: gasto.categoria_detalhada || null,
        tipo_recorrencia: gasto.tipo_recorrencia,
        valor_parcela: gasto.valor_parcela,
        valor_total: gasto.valor_total || null,
        dia_mes: gasto.dia_mes || null,
        dia_semana: gasto.dia_semana || null,
        num_parcelas: gasto.num_parcelas || null,
        parcela_atual: gasto.parcela_atual || 1,
        ativo: gasto.ativo ?? true,
        proxima_execucao: gasto.proxima_execucao || null,
        ultima_execucao: gasto.ultima_execucao || null,
        origem: gasto.origem || 'manual',
        usuario_id: usuarioId,
      };

      const { data, error } = await supabase
        .from('gastos_recorrentes')
        .insert([gastoData])
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
      const { error, count } = await supabase
        .from('gastos_recorrentes')
        .delete({ count: 'exact' })
        .eq('id', id);

      if (error) throw error;

      // RLS may silently block delete (0 rows affected)
      if (count === 0) {
        console.warn('⚠️ Delete retornou 0 rows - tentando refresh de sessão...');
        // Try refreshing the Supabase Auth session
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          console.error('❌ Refresh de sessão falhou:', refreshError);
          throw new Error('Sessão expirada. Faça login novamente.');
        }

        // Retry delete after refresh
        const { error: retryError, count: retryCount } = await supabase
          .from('gastos_recorrentes')
          .delete({ count: 'exact' })
          .eq('id', id);

        if (retryError) throw retryError;
        if (retryCount === 0) {
          throw new Error('Não foi possível remover. Tente fazer login novamente.');
        }
      }

      setGastos((prev) => prev.filter((g) => g.id !== id));
      toast({
        title: 'Sucesso',
        description: 'Gasto recorrente removido com sucesso!',
      });
    } catch (error: any) {
      console.error('Erro ao deletar gasto recorrente:', error);
      toast({
        title: 'Erro',
        description: error?.message || 'Não foi possível remover o gasto recorrente.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  useEffect(() => {
    if (!loadingUsuarioId) {
      fetchGastos();
    }
  }, [usuarioId, loadingUsuarioId]);

  return {
    gastos,
    loading,
    addGasto,
    updateGasto,
    deleteGasto,
    refetch: fetchGastos,
  };
}
