// ============================================================================
// 🔗 HOOK: useUsuarioId - Pega ID do usuário logado via AuthContext
// ============================================================================
// REGRA: usuarios.id é o ÚNICO identificador canônico.
// Telefone NÃO é identidade. LocalStorage NÃO é fonte de verdade.
// Frontend SEMPRE usa AuthContext.user.id
// ============================================================================

import { useAuth } from "@/contexts/AuthContext";

export function useUsuarioId() {
  const { user, loading } = useAuth();

  return {
    usuarioId: user?.id ?? null,
    usuario: user ?? null,
    loading,
    isAuthenticated: !!user,
  };
}
