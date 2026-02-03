import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
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

interface AuthContextType {
  // User state
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  
  // Plan status
  isTrialExpirado: boolean;
  isPro: boolean;
  isBasico: boolean;
  isTrial: boolean;
  
  // OTP state
  otpSent: boolean;
  otpLoading: boolean;
  verifyLoading: boolean;
  countdown: number;
  error: string | null;
  requiresWhatsApp: boolean;
  whatsappLink: string | null;
  
  // Actions
  sendOTP: (phone: string) => Promise<boolean>;
  verifyOTP: (phone: string, code: string) => Promise<boolean>;
  logout: () => void;
  resetOTP: () => void;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'finax_session_token';
const REFRESH_TOKEN_KEY = 'finax_refresh_token';
const USER_KEY = 'finax_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  // User state
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // OTP state
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [requiresWhatsApp, setRequiresWhatsApp] = useState(false);
  const [whatsappLink, setWhatsappLink] = useState<string | null>(null);

  // ========================================================================
  // 🔄 REFRESH USER - Validar sessão no servidor
  // ========================================================================
  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    
    if (!token) {
      console.log('⚠️ [AUTH] Nenhum token encontrado');
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      console.log('🔄 [AUTH] Validando sessão...');
      const response = await supabase.functions.invoke('validate-session', {
        body: { token },
      });

      // Se há erro ou resposta inválida, limpar sessão
      if (response.error || !response.data?.valid || !response.data?.user) {
        console.log('⚠️ [AUTH] Sessão inválida ou expirada, limpando dados locais...');
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        setUser(null);
        setLoading(false);
        return;
      }

      // Sessão válida
      console.log('✅ [AUTH] Sessão válida:', response.data.user.nome);
      localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
      setUser(response.data.user);
      setLoading(false);
      
    } catch (err) {
      console.error('❌ [AUTH] Erro ao validar sessão:', err);
      // Em caso de erro de rede ou qualquer exceção, limpar sessão
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      setUser(null);
      setLoading(false);
    }
  }, []);

  // ========================================================================
  // 📱 SEND OTP - Enviar código via WhatsApp
  // ========================================================================
  const sendOTP = useCallback(async (phone: string): Promise<boolean> => {
    setOtpLoading(true);
    setError(null);
    setRequiresWhatsApp(false);
    setWhatsappLink(null);
    
    try {
      console.log('📱 [AUTH] Enviando OTP para:', phone);
      const { data, error: invokeError } = await supabase.functions.invoke('send-otp', {
        body: { phone },
      });

      if (invokeError) {
        console.error('❌ [AUTH] Erro ao enviar OTP:', invokeError);
        setError(invokeError.message || 'Erro ao enviar código');
        return false;
      }

      // Tratamento especial: fora da janela de 24h
      if (data?.requiresWhatsApp) {
        console.log('⚠️ [AUTH] Fora da janela 24h');
        setRequiresWhatsApp(true);
        setWhatsappLink(data.whatsappLink || 'https://wa.me/5565981034588?text=oi');
        setError(data.message || 'Envie um "oi" para o Finax no WhatsApp primeiro');
        return false;
      }

      if (data?.error) {
        setError(data.message || data.error);
        return false;
      }

      if (data?.success) {
        console.log('✅ [AUTH] OTP enviado com sucesso');
        setOtpSent(true);
        setCountdown(60);
        return true;
      }

      return false;
      
    } catch (err: any) {
      console.error('❌ [AUTH] Erro inesperado:', err);
      setError(err.message || 'Erro ao enviar código');
      return false;
    } finally {
      setOtpLoading(false);
    }
  }, []);

  // ========================================================================
  // 🔐 VERIFY OTP - Verificar código e criar sessão
  // ========================================================================
  const verifyOTP = useCallback(async (phone: string, code: string): Promise<boolean> => {
    setVerifyLoading(true);
    setError(null);
    
    try {
      console.log('🔐 [AUTH] Verificando OTP...');
      const { data, error: invokeError } = await supabase.functions.invoke('verify-otp', {
        body: { phone, code },
      });

      if (invokeError) {
        console.error('❌ [AUTH] Erro ao verificar OTP:', invokeError);
        setError(invokeError.message || 'Erro ao verificar código');
        return false;
      }

      if (data?.error) {
        setError(data.message || data.error);
        return false;
      }

      if (data?.success && data.token && data.user) {
        console.log('✅ [AUTH] Login bem-sucedido:', data.user.nome);
        
        // Salvar sessão
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        
        // Atualizar estado
        setUser(data.user);
        setOtpSent(false);
        setCountdown(0);
        
        return true;
      }

      setError('Resposta inesperada do servidor');
      return false;
      
    } catch (err: any) {
      console.error('❌ [AUTH] Erro inesperado:', err);
      setError(err.message || 'Erro ao verificar código');
      return false;
    } finally {
      setVerifyLoading(false);
    }
  }, []);

  // ========================================================================
  // 👋 LOGOUT
  // ========================================================================
  const logout = useCallback(() => {
    console.log('👋 [AUTH] Fazendo logout...');
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setOtpSent(false);
    setCountdown(0);
    setError(null);
    setRequiresWhatsApp(false);
    setWhatsappLink(null);
  }, []);

  // ========================================================================
  // 🔄 RESET OTP - Voltar para tela de telefone
  // ========================================================================
  const resetOTP = useCallback(() => {
    setOtpSent(false);
    setCountdown(0);
    setError(null);
    setRequiresWhatsApp(false);
    setWhatsappLink(null);
  }, []);

  // ========================================================================
  // 🧹 CLEAR ERROR
  // ========================================================================
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ========================================================================
  // ⏱️ COUNTDOWN TIMER
  // ========================================================================
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // ========================================================================
  // 🚀 CARREGAR SESSÃO AO INICIAR
  // ========================================================================
  useEffect(() => {
    const loadSession = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);

      if (!token) {
        console.log('⚠️ [AUTH] Sem token, não autenticado');
        setLoading(false);
        return;
      }

      // Mostrar UI rápida com dados locais
      if (savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          console.log('📱 [AUTH] Usuário local:', parsedUser.nome);
          setUser(parsedUser);
        } catch {
          // Ignora erro de parse
        }
      }

      // Validar no servidor
      await refreshUser();
    };

    loadSession();
  }, [refreshUser]);

  // ========================================================================
  // 📦 CONTEXT VALUE
  // ========================================================================
  const value: AuthContextType = {
    // User state
    user,
    loading,
    isAuthenticated: !!user,
    
    // Plan status
    isTrialExpirado: user?.planoStatus === 'trial_expirado',
    isPro: user?.plano === 'pro',
    isBasico: user?.plano === 'basico',
    isTrial: user?.plano === 'trial' && user?.planoStatus === 'trial_ativo',
    
    // OTP state
    otpSent,
    otpLoading,
    verifyLoading,
    countdown,
    error,
    requiresWhatsApp,
    whatsappLink,
    
    // Actions
    sendOTP,
    verifyOTP,
    logout,
    resetOTP,
    refreshUser,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
