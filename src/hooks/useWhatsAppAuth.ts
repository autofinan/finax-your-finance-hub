import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface User {
  id: string;
  nome: string | null;
  phone: string;
  phoneE164: string;
  plano: string;
  planoStatus: string;
  diasRestantesTrial: number | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

const TOKEN_KEY = 'finax_session_token';
const REFRESH_TOKEN_KEY = 'finax_refresh_token';
const USER_KEY = 'finax_user';

export function useWhatsAppAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Carregar sessão do localStorage ao iniciar
  useEffect(() => {
    const loadSession = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);

      if (!token) {
        setState({ user: null, loading: false, error: null });
        return;
      }

      // Tentar usar usuário salvo primeiro para UI rápida
      if (savedUser) {
        try {
          const user = JSON.parse(savedUser);
          setState({ user, loading: true, error: null });
        } catch {
          // Ignora erro de parse
        }
      }

      // Validar sessão no servidor
      try {
        const { data, error } = await supabase.functions.invoke('validate-session', {
          body: { token },
        });

        if (error || !data?.valid) {
          // Sessão inválida, limpar
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setState({ user: null, loading: false, error: null });
          return;
        }

        // Sessão válida
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        setState({ user: data.user, loading: false, error: null });
      } catch (err) {
        console.error('Erro ao validar sessão:', err);
        setState({ user: null, loading: false, error: 'Erro ao verificar sessão' });
      }
    };

    loadSession();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Enviar OTP
  const sendOTP = useCallback(async (phone: string) => {
    setOtpLoading(true);
    setState(prev => ({ ...prev, error: null }));

    try {
      const { data, error } = await supabase.functions.invoke('send-otp', {
        body: { phone },
      });

      if (error) {
        throw new Error(error.message || 'Erro ao enviar código');
      }

      if (data?.error) {
        setState(prev => ({ ...prev, error: data.message || data.error }));
        return false;
      }

      setOtpSent(true);
      setCountdown(60); // 60 segundos para reenviar
      return true;
    } catch (err: any) {
      setState(prev => ({ ...prev, error: err.message || 'Erro ao enviar código' }));
      return false;
    } finally {
      setOtpLoading(false);
    }
  }, []);

  // Verificar OTP
  const verifyOTP = useCallback(async (phone: string, code: string) => {
    setVerifyLoading(true);
    setState(prev => ({ ...prev, error: null }));

    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { phone, code },
      });

      if (error) {
        throw new Error(error.message || 'Erro ao verificar código');
      }

      if (data?.error) {
        setState(prev => ({ ...prev, error: data.message || data.error }));
        return false;
      }

      // Salvar sessão
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));

      setState({ user: data.user, loading: false, error: null });
      return true;
    } catch (err: any) {
      setState(prev => ({ ...prev, error: err.message || 'Erro ao verificar código' }));
      return false;
    } finally {
      setVerifyLoading(false);
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ user: null, loading: false, error: null });
    setOtpSent(false);
  }, []);

  // Reset para tentar novo número
  const resetOTP = useCallback(() => {
    setOtpSent(false);
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    isAuthenticated: !!state.user,
    otpSent,
    otpLoading,
    verifyLoading,
    countdown,
    sendOTP,
    verifyOTP,
    logout,
    resetOTP,
    isTrialExpirado: state.user?.planoStatus === 'trial_expirado',
    isPro: state.user?.plano === 'pro',
    isBasico: state.user?.plano === 'basico',
    isTrial: state.user?.plano === 'trial' && state.user?.planoStatus === 'trial_ativo',
  };
}
