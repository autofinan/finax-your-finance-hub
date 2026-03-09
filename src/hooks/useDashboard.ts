import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DashboardUsuario, ResumoMensal } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';

export function useDashboard(usuarioId?: string) {
  const [dashboard, setDashboard] = useState<DashboardUsuario | null>(null);
  const [resumoMensal, setResumoMensal] = useState<ResumoMensal | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);

      // Buscar dados do dashboard via view
      let dashboardQuery = supabase
        .from('vw_dashboard_usuario')
        .select('*');

      if (usuarioId) {
        dashboardQuery = dashboardQuery.eq('usuario_id', usuarioId);
      }

      const { data: dashboardData, error: dashboardError } = await dashboardQuery.maybeSingle();

      if (dashboardError) {
        console.error('Erro ao buscar dashboard:', dashboardError);
      } else {
        setDashboard(dashboardData as DashboardUsuario);
      }

      // Buscar resumo mensal atual
      const mesAtual = new Date().getMonth() + 1;
      const anoAtual = new Date().getFullYear();

      let resumoQuery = supabase
        .from('resumo_mensal')
        .select('*')
        .eq('mes', mesAtual)
        .eq('ano', anoAtual);

      if (usuarioId) {
        resumoQuery = resumoQuery.eq('usuario_id', usuarioId);
      }

      const { data: resumoData, error: resumoError } = await resumoQuery.maybeSingle();

      if (resumoError) {
        console.error('Erro ao buscar resumo mensal:', resumoError);
      } else {
        setResumoMensal(resumoData as ResumoMensal);
      }

    } catch (error) {
      console.error('Erro ao buscar dados do dashboard:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar o dashboard.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [usuarioId, toast]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // ✅ REALTIME: Atualizar dashboard quando transações mudam
  useEffect(() => {
    if (!usuarioId) return;

    const channel = supabase
      .channel('dashboard-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transacoes',
          filter: `usuario_id=eq.${usuarioId}`,
        },
        () => {
          // Refetch dashboard quando houver mudanças
          fetchDashboard();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [usuarioId, fetchDashboard]);

  return {
    dashboard,
    resumoMensal,
    loading,
    refetch: fetchDashboard,
  };
}
