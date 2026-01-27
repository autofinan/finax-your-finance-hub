// ============================================================================
// 🔗 HOOK: useUsuarioId - Pega ID do usuário logado via OTP WhatsApp
// ============================================================================
// O AuthContext já retorna o user com id da tabela usuarios.
// Este hook apenas expõe isso de forma consistente para os outros hooks.
// ============================================================================

import { useAuth } from '@/contexts/AuthContext';

export interface UsuarioData {
  id: string;
  nome: string | null;
  phone_number: string | null;
  plano: string | null;
  ativo: boolean;
}

export function useUsuarioId() {
  const { user, loading } = useAuth();

  // O user do AuthContext já é o usuário da tabela usuarios
  // Não precisa buscar nada, só usar o que já tem
  const usuarioId = user?.id || null;
  
  const usuario: UsuarioData | null = user ? {
    id: user.id,
    nome: user.nome,
    phone_number: user.phone,
    plano: user.plano,
    ativo: true,
  } : null;

  return {
    usuarioId,
    usuario,
    loading,
    error: null,
    isLinked: !!usuarioId
  };
}
