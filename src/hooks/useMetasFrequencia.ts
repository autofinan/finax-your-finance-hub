import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface MetaFrequencia {
  id: string;
  usuario_id: string;
  nome: string;
  categoria: string;
  limite_mensal: number;
  palavras_chave: string[];
  ativa: boolean;
  created_at: string;
  updated_at: string;
  // computed
  frequencia_atual?: number;
}

export interface CriarMetaFrequenciaInput {
  nome: string;
  categoria: string;
  limite_mensal: number;
  palavras_chave?: string[];
}

export function useMetasFrequencia(usuarioId?: string) {
  const [metas, setMetas] = useState<MetaFrequencia[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchMetas = useCallback(async () => {
    if (!usuarioId) { setMetas([]); setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('metas_frequencia')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Calculate current month frequency from transacoes
      const mesAtual = new Date().toISOString().substring(0, 7);
      const { data: transacoes } = await supabase
        .from('transacoes')
        .select('categoria, observacao, data')
        .eq('usuario_id', usuarioId)
        .eq('tipo', 'saida')
        .gte('data', `${mesAtual}-01`)
        .lte('data', `${mesAtual}-31`);

      const metasComFrequencia = (data || []).map((meta: any) => {
        const freq = (transacoes || []).filter((t: any) => {
          const matchCategoria = t.categoria?.toLowerCase() === meta.categoria?.toLowerCase();
          const matchPalavra = (meta.palavras_chave || []).some((p: string) =>
            t.observacao?.toLowerCase()?.includes(p.toLowerCase())
          );
          return matchCategoria || matchPalavra;
        }).length;

        return { ...meta, frequencia_atual: freq } as MetaFrequencia;
      });

      setMetas(metasComFrequencia);
    } catch (error: any) {
      console.error('Erro ao carregar metas frequência:', error);
    } finally {
      setLoading(false);
    }
  }, [usuarioId]);

  useEffect(() => { fetchMetas(); }, [fetchMetas]);

  async function criarMeta(input: CriarMetaFrequenciaInput) {
    if (!usuarioId) return;
    try {
      const { error } = await supabase.from('metas_frequencia').insert({
        usuario_id: usuarioId,
        nome: input.nome,
        categoria: input.categoria,
        limite_mensal: input.limite_mensal,
        palavras_chave: input.palavras_chave || [],
      });
      if (error) throw error;
      toast({ title: 'Meta de frequência criada!' });
      fetchMetas();
    } catch (error: any) {
      toast({ title: 'Erro ao criar meta', description: error.message, variant: 'destructive' });
    }
  }

  async function deletarMeta(id: string) {
    try {
      const { error } = await supabase.from('metas_frequencia').delete().eq('id', id);
      if (error) throw error;
      setMetas(prev => prev.filter(m => m.id !== id));
      toast({ title: 'Meta removida' });
    } catch (error: any) {
      toast({ title: 'Erro ao remover', variant: 'destructive' });
    }
  }

  async function toggleMeta(id: string, ativa: boolean) {
    try {
      const { error } = await supabase.from('metas_frequencia').update({ ativa }).eq('id', id);
      if (error) throw error;
      setMetas(prev => prev.map(m => m.id === id ? { ...m, ativa } : m));
    } catch (error: any) {
      toast({ title: 'Erro ao atualizar', variant: 'destructive' });
    }
  }

  return { metas, loading, criarMeta, deletarMeta, toggleMeta, refetch: fetchMetas };
}
