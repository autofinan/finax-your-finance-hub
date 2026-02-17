import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Transacao } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';
import { useUsuarioId } from '@/hooks/useUsuarioId';

const PAGE_SIZE = 100;

export function useTransacoes(usuarioIdProp?: string) {
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const { toast } = useToast();
  
  // Usar hook para buscar usuario_id via auth_id
  const { usuarioId: resolvedUsuarioId, loading: loadingUsuarioId } = useUsuarioId();
  
  // Priorizar prop, depois o resolvido via auth
  const usuarioId = usuarioIdProp || resolvedUsuarioId;

  const fetchTransacoes = async (pageNum = 0, append = false) => {
    if (loadingUsuarioId) return; // Aguardar resolver usuario_id
    
    try {
      if (!append) setLoading(true);
      const from = pageNum * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      
      let query = supabase
        .from('transacoes')
        .select('*')
        .order('data', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (usuarioId) {
        query = query.eq('usuario_id', usuarioId);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      const newData = (data as Transacao[]) || [];
      setHasMore(newData.length === PAGE_SIZE);
      
      if (append) {
        setTransacoes((prev) => [...prev, ...newData]);
      } else {
        setTransacoes(newData);
      }
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

  const loadMore = () => {
    if (!hasMore || loading) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchTransacoes(nextPage, true);
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
    // Validar que temos usuarioId
    if (!usuarioId) {
      toast({
        title: 'Erro',
        description: 'Você precisa estar conectado via WhatsApp para adicionar transações.',
        variant: 'destructive',
      });
      throw new Error('Usuario não vinculado');
    }

    try {
      const transacaoData = {
        tipo: transacao.tipo,
        valor: transacao.valor,
        categoria: transacao.categoria,
        observacao: transacao.observacao || null,
        data: transacao.data || new Date().toISOString(),
        usuario_id: usuarioId,
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
    if (!loadingUsuarioId) {
      fetchTransacoes();
    }
  }, [usuarioId, loadingUsuarioId]);

  return {
    transacoes,
    loading,
    hasMore,
    loadMore,
    addTransacao,
    deleteTransacao,
    refetch: () => { setPage(0); fetchTransacoes(0, false); },
  };
}
