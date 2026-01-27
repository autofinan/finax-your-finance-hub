// ============================================================================
// 🔗 HOOK: useUsuarioId - CORRIGIDO - Usa usuario.id direto do AuthContext
// ============================================================================
// REGRA DE OURO:
// - Telefone é a identidade raiz
// - AuthContext.user já tem o usuario_id correto da tabela usuarios
// - NÃO usa auth_id (não é necessário)
// - NÃO usa localStorage diretamente (só via AuthContext)
// ============================================================================

import { useAuth } from "@/contexts/AuthContext";

export interface UsuarioData {
  id: string;
  nome: string | null;
  phone: string;
  phoneE164: string;
  plano: string;
  planoStatus: string;
  diasRestantesTrial: number | null;
}

export function useUsuarioId() {
  const { user, loading, isAuthenticated } = useAuth();

  return {
    // ✅ ÚNICO identificador canônico - usuarios.id
    usuarioId: user?.id ?? null,
    
    // ✅ Dados completos do usuário
    usuario: user ? {
      id: user.id,
      nome: user.nome,
      phone: user.phone,
      phoneE164: user.phoneE164,
      plano: user.plano,
      planoStatus: user.planoStatus,
      diasRestantesTrial: user.diasRestantesTrial,
    } : null,
    
    // Estado
    loading,
    isAuthenticated,
    
    // Flags de plano
    isPro: user?.plano === 'pro',
    isBasico: user?.plano === 'basico',
    isTrial: user?.plano === 'trial' && user?.planoStatus === 'trial_ativo',
    isTrialExpirado: user?.planoStatus === 'trial_expirado',
  };
}
