// ============================================================================
// 🎪 HOOK: useEventos - Gerenciar eventos/viagens temporários
// ============================================================================

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Evento {
  id: string;
  user_id: string;
  label: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: 'active' | 'completed' | 'cancelled';
  auto_tag: boolean;
  total_spent: number;
  transaction_count: number;
  created_at: string;
  updated_at: string;
}

// Normaliza status do banco para tipo seguro
function normalizeEventoStatus(status: string): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status;
  return 'active';
}

function normalizeEvento(data: any): Evento {
  return {
    ...data,
    status: normalizeEventoStatus(data.status),
  };
}

export interface CriarEventoInput {
  label: string;
  description?: string;
  start_date: string;
  end_date: string;
  auto_tag?: boolean;
}

export function useEventos(usuarioId?: string) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // ========================================================================
  // 📥 CARREGAR EVENTOS
  // ========================================================================
  useEffect(() => {
    if (!usuarioId) {
      setEventos([]);
      setLoading(false);
      return;
    }

    async function loadEventos() {
      try {
        const { data, error } = await supabase
          .from('user_contexts')
          .select('*')
          .eq('user_id', usuarioId)
          .order('start_date', { ascending: false });

        if (error) throw error;
        setEventos((data || []).map(normalizeEvento));
      } catch (error: any) {
        console.error('Erro ao carregar eventos:', error);
        toast({
          title: 'Erro ao carregar eventos',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    }

    loadEventos();
  }, [usuarioId, toast]);

  // ========================================================================
  // ➕ CRIAR EVENTO
  // ========================================================================
  async function criarEvento(input: CriarEventoInput) {
    if (!usuarioId) {
      toast({
        title: 'Erro',
        description: 'Usuário não autenticado',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_contexts')
        .insert({
          user_id: usuarioId,
          label: input.label,
          description: input.description || null,
          start_date: input.start_date,
          end_date: input.end_date,
          auto_tag: input.auto_tag ?? true,
          status: 'active',
          total_spent: 0,
          transaction_count: 0,
        })
        .select()
        .single();

      if (error) throw error;

      setEventos((prev) => [normalizeEvento(data), ...prev]);
      
      toast({
        title: 'Evento criado!',
        description: `${input.label} foi criado com sucesso.`,
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao criar evento:', error);
      toast({
        title: 'Erro ao criar evento',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // ✏️ ATUALIZAR EVENTO
  // ========================================================================
  async function atualizarEvento(id: string, updates: Partial<CriarEventoInput>) {
    try {
      const { data, error } = await supabase
        .from('user_contexts')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', usuarioId)
        .select()
        .single();

      if (error) throw error;

      setEventos((prev) =>
        prev.map((e) => (e.id === id ? normalizeEvento(data) : e))
      );

      toast({
        title: 'Evento atualizado',
        description: 'Alterações salvas com sucesso.',
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao atualizar evento:', error);
      toast({
        title: 'Erro ao atualizar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // ✅ FINALIZAR EVENTO
  // ========================================================================
  async function finalizarEvento(id: string) {
    try {
      const { data, error } = await supabase
        .from('user_contexts')
        .update({
          status: 'completed',
          end_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', usuarioId)
        .select()
        .single();

      if (error) throw error;

      setEventos((prev) =>
        prev.map((e) => (e.id === id ? normalizeEvento(data) : e))
      );

      toast({
        title: 'Evento finalizado!',
        description: `Total gasto: ${formatCurrency(data.total_spent)}`,
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao finalizar evento:', error);
      toast({
        title: 'Erro ao finalizar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // ❌ CANCELAR EVENTO
  // ========================================================================
  async function cancelarEvento(id: string) {
    try {
      const { data, error } = await supabase
        .from('user_contexts')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', usuarioId)
        .select()
        .single();

      if (error) throw error;

      setEventos((prev) =>
        prev.map((e) => (e.id === id ? normalizeEvento(data) : e))
      );

      toast({
        title: 'Evento cancelado',
        description: 'O evento foi cancelado.',
        variant: 'destructive',
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao cancelar evento:', error);
      toast({
        title: 'Erro ao cancelar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // 🗑️ DELETAR EVENTO
  // ========================================================================
  async function deletarEvento(id: string) {
    try {
      const { error } = await supabase
        .from('user_contexts')
        .delete()
        .eq('id', id)
        .eq('user_id', usuarioId);

      if (error) throw error;

      setEventos((prev) => prev.filter((e) => e.id !== id));

      toast({
        title: 'Evento removido',
        description: 'O evento foi deletado.',
      });
    } catch (error: any) {
      console.error('Erro ao deletar evento:', error);
      toast({
        title: 'Erro ao deletar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // 📊 HELPERS
  // ========================================================================
  function getEventosAtivos() {
    return eventos.filter((e) => e.status === 'active');
  }

  function getEventosFinalizados() {
    return eventos.filter((e) => e.status === 'completed');
  }

  function getEventosCancelados() {
    return eventos.filter((e) => e.status === 'cancelled');
  }

  function calcularDiasRestantes(endDate: string) {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  }

  function formatCurrency(value: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  return {
    eventos,
    loading,
    criarEvento,
    atualizarEvento,
    finalizarEvento,
    cancelarEvento,
    deletarEvento,
    getEventosAtivos,
    getEventosFinalizados,
    getEventosCancelados,
    calcularDiasRestantes,
    formatCurrency,
  };
}
