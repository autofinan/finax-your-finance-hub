// ============================================================================
// 🔗 HOOK: useUsuarioId - Vinculação Site ↔ WhatsApp
// ============================================================================
// Busca o usuario_id da tabela usuarios baseado no telefone do usuário.
// Isso permite que o site mostre os dados do mesmo usuário do WhatsApp.
// ============================================================================

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface UsuarioData {
  id: string;
  nome: string | null;
  phone_number: string | null;
  plano: string | null;
  ativo: boolean;
}

export function useUsuarioId() {
  const { user, isAuthenticated } = useAuth();
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<UsuarioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsuario = async () => {
      if (!isAuthenticated || !user) {
        setUsuarioId(null);
        setUsuario(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Buscar pelo telefone do user metadata (vinculado no login OTP)
        const phone = user.user_metadata?.phone || user.phone;
        
        if (!phone) {
          console.log('⚠️ [useUsuarioId] Sem telefone no user metadata');
          setError('Telefone não encontrado. Faça login via WhatsApp.');
          setLoading(false);
          return;
        }
        
        // Extrair últimos 8 dígitos para matching flexível
        const phoneLast8 = phone.replace(/\D/g, '').slice(-8);
        
        const { data, error: fetchError } = await supabase
          .from('usuarios')
          .select('id, nome, phone_number, plano, ativo')
          .or(`phone_number.ilike.%${phoneLast8}%,phone_e164.ilike.%${phoneLast8}%`)
          .maybeSingle();

        if (fetchError) {
          console.error('Erro ao buscar usuario:', fetchError);
          setError('Erro ao carregar dados do usuário');
          return;
        }

        if (data) {
          setUsuarioId(data.id);
          setUsuario(data as UsuarioData);
          console.log('✅ [useUsuarioId] Usuário encontrado:', data.id);
        } else {
          console.log('⚠️ [useUsuarioId] Nenhum usuário encontrado para telefone:', phoneLast8);
          setError('Usuário não encontrado. Use o Finax via WhatsApp primeiro.');
        }
      } catch (err) {
        console.error('❌ [useUsuarioId] Erro:', err);
        setError('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };

    fetchUsuario();
  }, [user, isAuthenticated]);

  return {
    usuarioId,
    usuario,
    loading,
    error,
    isLinked: !!usuarioId
  };
}
