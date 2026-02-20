import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FaturaCartao, FaturaEmAberto } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';
import { useUsuarioId } from '@/hooks/useUsuarioId';

export function useFaturas(usuarioIdProp?: string) {
  const [faturas, setFaturas] = useState<FaturaCartao[]>([]);
  const [faturasEmAberto, setFaturasEmAberto] = useState<FaturaEmAberto[]>([]);
  const [faturasFuturas, setFaturasFuturas] = useState<FaturaEmAberto[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  
  // Usar hook para buscar usuario_id via auth_id
  const { usuarioId: resolvedUsuarioId, loading: loadingUsuarioId } = useUsuarioId();
  const usuarioId = usuarioIdProp || resolvedUsuarioId;

  const fetchFaturas = async () => {
    if (loadingUsuarioId) return;
    
    try {
      // Buscar todas as faturas ordenadas por ano/mês desc
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

      // Buscar faturas em aberto (status = 'aberta') via view
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
        // Separar: status='aberta' (ciclo atual) vs status='futura' (próximos meses)
        const todasFaturas = (dataAberto as FaturaEmAberto[]) || [];
        const abertas = todasFaturas.filter(f => f.status === 'aberta');
        const futuras = todasFaturas.filter(f => f.status === 'futura');
        
        setFaturasEmAberto(abertas);
        setFaturasFuturas(futuras);
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
      
      // Atualizar faturas em aberto e futuras
      setFaturasEmAberto((prev) => prev.filter((f) => f.id !== id));
      setFaturasFuturas((prev) => prev.filter((f) => f.id !== id));
      
      // ✅ Recompor limite disponível do cartão
      if (data && data.cartao_id && valorPago > 0) {
        const { data: cartao } = await supabase
          .from('cartoes_credito')
          .select('limite_disponivel')
          .eq('id', data.cartao_id)
          .single();
        
        if (cartao) {
          await supabase
            .from('cartoes_credito')
            .update({ limite_disponivel: (cartao.limite_disponivel || 0) + valorPago })
            .eq('id', data.cartao_id);
        }
      }
      
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
    if (!loadingUsuarioId) {
      fetchFaturas();
    }
  }, [usuarioId, loadingUsuarioId]);

  return {
    faturas,
    faturasEmAberto,
    faturasFuturas,
    loading,
    pagarFatura,
    refetch: fetchFaturas,
  };
}
