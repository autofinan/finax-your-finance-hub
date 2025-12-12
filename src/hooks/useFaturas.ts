import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FaturaCartao, FaturaEmAberto } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';

export function useFaturas(usuarioId?: string) {
  const [faturas, setFaturas] = useState<FaturaCartao[]>([]);
  const [faturasEmAberto, setFaturasEmAberto] = useState<FaturaEmAberto[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchFaturas = async () => {
    try {
      setLoading(true);
      
      // Buscar todas as faturas
      let query = supabase
        .from('faturas_cartao')
        .select('*')
        .order('ano', { ascending: false })
        .order('mes', { ascending: false });

      if (usuarioId) {
        query = query.eq('usuario_id', usuarioId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setFaturas((data as FaturaCartao[]) || []);

      // Buscar faturas em aberto via view
      let queryAberto = supabase
        .from('vw_faturas_em_aberto')
        .select('*');

      if (usuarioId) {
        queryAberto = queryAberto.eq('usuario_id', usuarioId);
      }

      const { data: dataAberto, error: errorAberto } = await queryAberto;

      if (errorAberto) {
        console.error('Erro ao buscar faturas em aberto:', errorAberto);
      } else {
        setFaturasEmAberto((dataAberto as FaturaEmAberto[]) || []);
      }

    } catch (error) {
      console.error('Erro ao buscar faturas:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as faturas.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const pagarFatura = async (id: string, valorPago: number) => {
    try {
      const { data, error } = await supabase
        .from('faturas_cartao')
        .update({ valor_pago: valorPago, status: 'paga' })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setFaturas((prev) =>
        prev.map((f) => (f.id === id ? (data as FaturaCartao) : f))
      );
      
      // Atualizar faturas em aberto
      setFaturasEmAberto((prev) => prev.filter((f) => f.id !== id));
      
      toast({
        title: 'Sucesso',
        description: 'Fatura paga com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao pagar fatura:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível registrar o pagamento.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchFaturas();
  }, [usuarioId]);

  return {
    faturas,
    faturasEmAberto,
    loading,
    pagarFatura,
    refetch: fetchFaturas,
  };
}
