// ============================================================================
// 🔗 HOOK: useUsuarioId - Vinculação Site ↔ WhatsApp
// ============================================================================
// Busca o usuario_id da tabela usuarios.
// Suporta tanto login OTP (WhatsApp) quanto login com email/senha.
// ============================================================================

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface UsuarioData {
  id: string;
  nome: string | null;
  phone_number: string | null;
  plano: string | null;
  ativo: boolean;
}

export function useUsuarioId() {
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<UsuarioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsuario = async () => {
      try {
        setLoading(true);
        setError(null);

        // CASO 1: Verificar sessão customizada OTP (localStorage)
        const otpToken = localStorage.getItem('finax_session_token');
        const otpUserStr = localStorage.getItem('finax_user');
        
        if (otpToken && otpUserStr) {
          try {
            const otpUser = JSON.parse(otpUserStr);
            if (otpUser && otpUser.id) {
              console.log('✅ [useUsuarioId] Login OTP detectado:', otpUser.id);
              setUsuarioId(otpUser.id);
              setUsuario({
                id: otpUser.id,
                nome: otpUser.nome || null,
                phone_number: otpUser.phone || null,
                plano: otpUser.plano || null,
                ativo: true,
              });
              setLoading(false);
              return;
            }
          } catch (e) {
            console.warn('⚠️ [useUsuarioId] Erro ao parsear OTP user:', e);
          }
        }

        // CASO 2: Verificar sessão Supabase Auth (email/senha)
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session;
        
        if (!session?.user) {
          console.log('⚠️ [useUsuarioId] Sem sessão ativa');
          setLoading(false);
          return;
        }

        const authId = session.user.id;
        console.log('🔍 [useUsuarioId] Buscando usuário por auth_id:', authId);
        
        // Tentar buscar pelo auth_id primeiro
        const { data: dataByAuth, error: errorAuth } = await supabase
          .from('usuarios')
          .select('id, nome, phone_number, plano, ativo')
          .eq('auth_id', authId)
          .maybeSingle();
        
        if (dataByAuth) {
          console.log('✅ [useUsuarioId] Usuário encontrado via auth_id:', dataByAuth.id);
          setUsuarioId(dataByAuth.id);
          setUsuario(dataByAuth as UsuarioData);
          setLoading(false);
          return;
        }

        // Tentar buscar pelo phone do user metadata
        const userPhone = session.user.phone || session.user.user_metadata?.phone;
        if (userPhone) {
          const phoneLast8 = userPhone.replace(/\D/g, '').slice(-8);
          
          const { data: dataByPhone } = await supabase
            .from('usuarios')
            .select('id, nome, phone_number, plano, ativo')
            .or(`phone_number.ilike.%${phoneLast8}%,phone_e164.ilike.%${phoneLast8}%`)
            .maybeSingle();
          
          if (dataByPhone) {
            console.log('✅ [useUsuarioId] Usuário encontrado via phone:', dataByPhone.id);
            setUsuarioId(dataByPhone.id);
            setUsuario(dataByPhone as UsuarioData);
            setLoading(false);
            return;
          }
        }

        // FALLBACK: Buscar primeiro usuário pro com dados (para teste/demo)
        // Isso é temporário - em produção, o usuário precisa estar vinculado
        console.log('⚠️ [useUsuarioId] Usuário não vinculado, tentando fallback...');
        
        // Busca por qualquer indicação no email
        const userEmail = session.user.email;
        if (userEmail) {
          // Pegar a primeira parte do email antes do @
          const emailPrefix = userEmail.split('@')[0];
          
          const { data: dataByName } = await supabase
            .from('usuarios')
            .select('id, nome, phone_number, plano, ativo')
            .ilike('nome', `%${emailPrefix}%`)
            .maybeSingle();
          
          if (dataByName) {
            console.log('✅ [useUsuarioId] Usuário encontrado via nome/email:', dataByName.id);
            setUsuarioId(dataByName.id);
            setUsuario(dataByName as UsuarioData);
            setLoading(false);
            return;
          }
        }

        console.log('⚠️ [useUsuarioId] Nenhum usuário encontrado');
        setError('Usuário não vinculado. Faça login via WhatsApp para vincular sua conta.');
        
      } catch (err) {
        console.error('❌ [useUsuarioId] Erro:', err);
        setError('Erro ao carregar dados');
      } finally {
        setLoading(false);
      }
    };

    fetchUsuario();

    // Listener para mudanças de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchUsuario();
    });

    return () => subscription.unsubscribe();
  }, []);

  return {
    usuarioId,
    usuario,
    loading,
    error,
    isLinked: !!usuarioId
  };
}
