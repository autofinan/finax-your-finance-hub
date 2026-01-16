import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface PlanoStatus {
  plano: string;
  statusPlano: 'ativo' | 'trial_ativo' | 'trial_expirado' | 'indefinido';
  diasRestantesTrial: number | null;
  alertaTrial: 'urgente' | 'aviso' | 'ok' | null;
  trialInicio: string | null;
  trialFim: string | null;
}

export function usePlanoStatus() {
  const [planoStatus, setPlanoStatus] = useState<PlanoStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlanoStatus = async () => {
      try {
        // Obter usuário autenticado
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setLoading(false);
          return;
        }

        // Buscar usuário na tabela usuarios pelo email ou id
        // Note: vw_status_plano usa usuario_id da tabela usuarios (não auth.users)
        // Precisamos mapear auth.user para usuarios
        const { data: usuario } = await supabase
          .from('usuarios')
          .select('id, plano, trial_inicio, trial_fim')
          .eq('phone_number', user.phone || user.email || '')
          .maybeSingle();

        if (!usuario) {
          // Fallback: tentar buscar pelo ID diretamente
          const { data: usuarioById } = await supabase
            .from('usuarios')
            .select('id, plano, trial_inicio, trial_fim')
            .eq('id', user.id)
            .maybeSingle();
          
          if (usuarioById) {
            processUsuario(usuarioById);
          }
          setLoading(false);
          return;
        }

        processUsuario(usuario);
      } catch (error) {
        console.error('Erro ao buscar status do plano:', error);
      } finally {
        setLoading(false);
      }
    };

    const processUsuario = (usuario: { id: string; plano: string | null; trial_inicio: string | null; trial_fim: string | null }) => {
      const plano = usuario.plano || 'trial';
      const trialFim = usuario.trial_fim ? new Date(usuario.trial_fim) : null;
      const agora = new Date();
      
      let statusPlano: PlanoStatus['statusPlano'] = 'indefinido';
      let diasRestantesTrial: number | null = null;
      let alertaTrial: PlanoStatus['alertaTrial'] = null;
      
      if (plano === 'pro' || plano === 'basico') {
        statusPlano = 'ativo';
      } else if (plano === 'trial') {
        if (trialFim && trialFim > agora) {
          statusPlano = 'trial_ativo';
          diasRestantesTrial = Math.ceil((trialFim.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
          
          if (diasRestantesTrial <= 2) {
            alertaTrial = 'urgente';
          } else if (diasRestantesTrial <= 4) {
            alertaTrial = 'aviso';
          } else {
            alertaTrial = 'ok';
          }
        } else {
          statusPlano = 'trial_expirado';
        }
      }
      
      setPlanoStatus({
        plano,
        statusPlano,
        diasRestantesTrial,
        alertaTrial,
        trialInicio: usuario.trial_inicio,
        trialFim: usuario.trial_fim,
      });
    };

    fetchPlanoStatus();
  }, []);

  const isTrialExpirado = planoStatus?.statusPlano === 'trial_expirado';
  const isPro = planoStatus?.plano === 'pro';
  const isBasico = planoStatus?.plano === 'basico';
  const isTrial = planoStatus?.plano === 'trial' && planoStatus?.statusPlano === 'trial_ativo';

  return {
    planoStatus,
    loading,
    isTrialExpirado,
    isPro,
    isBasico,
    isTrial,
  };
}
