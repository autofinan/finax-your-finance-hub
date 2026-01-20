import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  isTrialExpirado: boolean;
  isPro: boolean;
  isBasico: boolean;
  isTrial: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'finax_session_token';
const USER_KEY = 'finax_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('validate-session', {
        body: { token },
      });

      if (error) {
        console.error('❌ Erro ao validar sessão:', error);
        throw error;
      }

      if (!data || !data.valid || !data.user) {
        console.log('⚠️ Sessão inválida ou expirada');
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem('finax_refresh_token');
        setUser(null);
        setLoading(false);
        return;
      }

      // Sessão válida - atualizar dados do usuário
      console.log('✅ Sessão válida, usuário:', data.user);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setUser(data.user);
      setLoading(false);
      
    } catch (err) {
      console.error('❌ Erro ao validar sessão:', err);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('finax_refresh_token');
      setUser(null);
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadSession = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);

      if (!token) {
        console.log('⚠️ Nenhum token encontrado');
        setLoading(false);
        return;
      }

      // Usar usuário salvo TEMPORARIAMENTE para UI rápida
      if (savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          console.log('📱 Usuário local carregado:', parsedUser);
          setUser(parsedUser);
        } catch (e) {
          console.error('❌ Erro ao parsear usuário salvo:', e);
        }
      }

      // SEMPRE validar sessão no servidor
      await refreshUser();
    };

    loadSession();
  }, []);

  const logout = () => {
    console.log('👋 Fazendo logout...');
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('finax_refresh_token');
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    loading,
    isAuthenticated: !!user,
    logout,
    refreshUser,
    isTrialExpirado: user?.planoStatus === 'trial_expirado',
    isPro: user?.plano === 'pro',
    isBasico: user?.plano === 'basico',
    isTrial: user?.plano === 'trial' && user?.planoStatus === 'trial_ativo',
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
