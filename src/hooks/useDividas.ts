import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUsuarioId } from '@/hooks/useUsuarioId';
import { useToast } from '@/hooks/use-toast';

export interface Divida {
  id: string;
  usuario_id: string;
  tipo: string;
  nome: string;
  saldo_devedor: number;
  taxa_juros: number | null;
  valor_minimo: number | null;
  data_vencimento: string | null;
  data_contratacao: string | null;
  ativa: boolean;
  created_at: string;
  updated_at: string;
}

export type DividaInsert = Omit<Divida, 'id' | 'created_at' | 'updated_at' | 'ativa'>;

const TIPOS_DIVIDA = [
  { value: 'cartao', label: 'Cartão de Crédito' },
  { value: 'emprestimo', label: 'Empréstimo' },
  { value: 'financiamento', label: 'Financiamento' },
  { value: 'cheque_especial', label: 'Cheque Especial' },
] as const;

export function useDividas() {
  const { usuarioId } = useUsuarioId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: dividas = [], isLoading } = useQuery({
    queryKey: ['dividas', usuarioId],
    queryFn: async () => {
      if (!usuarioId) return [];
      const { data, error } = await supabase
        .from('dividas')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('ativa', { ascending: false })
        .order('saldo_devedor', { ascending: false });
      if (error) throw error;
      return data as Divida[];
    },
    enabled: !!usuarioId,
  });

  const addDivida = useMutation({
    mutationFn: async (divida: Omit<DividaInsert, 'usuario_id'>) => {
      if (!usuarioId) throw new Error('Usuário não autenticado');
      const { error } = await supabase.from('dividas').insert({ ...divida, usuario_id: usuarioId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividas'] });
      toast({ title: 'Dívida registrada!' });
    },
    onError: () => toast({ title: 'Erro ao registrar dívida', variant: 'destructive' }),
  });

  const updateDivida = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Divida> & { id: string }) => {
      const { error } = await supabase.from('dividas').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividas'] });
      toast({ title: 'Dívida atualizada!' });
    },
    onError: () => toast({ title: 'Erro ao atualizar', variant: 'destructive' }),
  });

  const deleteDivida = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('dividas').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividas'] });
      toast({ title: 'Dívida removida!' });
    },
    onError: () => toast({ title: 'Erro ao remover', variant: 'destructive' }),
  });

  const dividasAtivas = dividas.filter(d => d.ativa);
  const saldoTotal = dividasAtivas.reduce((sum, d) => sum + d.saldo_devedor, 0);
  const minimoTotal = dividasAtivas.reduce((sum, d) => sum + (d.valor_minimo || 0), 0);

  return {
    dividas,
    dividasAtivas,
    saldoTotal,
    minimoTotal,
    isLoading,
    addDivida,
    updateDivida,
    deleteDivida,
    TIPOS_DIVIDA,
  };
}
