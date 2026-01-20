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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'finax_session_token';
const USER_KEY = 'finax_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSession = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);

      if (!token) {
        setLoading(false);
        return;
      }

      // Usar usuário salvo primeiro para UI rápida
      if (savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          setUser(parsedUser);
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
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem('finax_refresh_token');
          setUser(null);
        } else {
          // Sessão válida - atualizar dados do usuário
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
          setUser(data.user);
        }
      } catch (err) {
        console.error('Erro ao validar sessão:', err);
        // Manter usuário local se tiver (offline mode)
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, []);

  const logout = () => {
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
