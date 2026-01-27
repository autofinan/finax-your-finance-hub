// ============================================================================
// 🎯 HOOK: useMetas - Gerenciar metas financeiras
// ============================================================================

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Meta {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  category: string | null;
  auto_save_percentage: number | null;
  progress_percentage: number;
  weekly_checkin_enabled: boolean;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface CriarMetaInput {
  name: string;
  target_amount: number;
  deadline?: string;
  category?: string;
  auto_save_percentage?: number;
  weekly_checkin_enabled?: boolean;
}

export function useMetas(usuarioId?: string) {
  const [metas, setMetas] = useState<Meta[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // ========================================================================
  // 📥 CARREGAR METAS
  // ========================================================================
  useEffect(() => {
    if (!usuarioId) {
      setMetas([]);
      setLoading(false);
      return;
    }

    async function loadMetas() {
      try {
        const { data, error } = await supabase
          .from('savings_goals')
          .select('*')
          .eq('user_id', usuarioId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setMetas(data || []);
      } catch (error: any) {
        console.error('Erro ao carregar metas:', error);
        toast({
          title: 'Erro ao carregar metas',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    }

    loadMetas();
  }, [usuarioId, toast]);

  // ========================================================================
  // ➕ CRIAR META
  // ========================================================================
  async function criarMeta(input: CriarMetaInput) {
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
        .from('savings_goals')
        .insert({
          user_id: usuarioId,
          name: input.name,
          target_amount: input.target_amount,
          current_amount: 0,
          deadline: input.deadline || null,
          category: input.category || null,
          auto_save_percentage: input.auto_save_percentage || null,
          weekly_checkin_enabled: input.weekly_checkin_enabled ?? true,
          status: 'active',
        })
        .select()
        .single();

      if (error) throw error;

      setMetas((prev) => [data, ...prev]);
      
      toast({
        title: 'Meta criada!',
        description: `${input.name} foi criada com sucesso.`,
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao criar meta:', error);
      toast({
        title: 'Erro ao criar meta',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // ✏️ ATUALIZAR META
  // ========================================================================
  async function atualizarMeta(id: string, updates: Partial<CriarMetaInput>) {
    try {
      const { data, error } = await supabase
        .from('savings_goals')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', usuarioId)
        .select()
        .single();

      if (error) throw error;

      setMetas((prev) =>
        prev.map((m) => (m.id === id ? data : m))
      );

      toast({
        title: 'Meta atualizada',
        description: 'Alterações salvas com sucesso.',
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao atualizar meta:', error);
      toast({
        title: 'Erro ao atualizar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // 💰 ADICIONAR PROGRESSO
  // ========================================================================
  async function adicionarProgresso(id: string, valor: number) {
    try {
      // Buscar meta atual
      const meta = metas.find((m) => m.id === id);
      if (!meta) throw new Error('Meta não encontrada');

      const novoValor = meta.current_amount + valor;

      const { data, error } = await supabase
        .from('savings_goals')
        .update({
          current_amount: novoValor,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', usuarioId)
        .select()
        .single();

      if (error) throw error;

      setMetas((prev) =>
        prev.map((m) => (m.id === id ? data : m))
      );

      // Verificar se atingiu a meta
      if (novoValor >= meta.target_amount) {
        toast({
          title: '🎉 Meta atingida!',
          description: `Parabéns! Você alcançou ${formatCurrency(meta.target_amount)}`,
        });
      } else {
        toast({
          title: 'Progresso adicionado',
          description: `+${formatCurrency(valor)} na meta ${meta.name}`,
        });
      }

      return data;
    } catch (error: any) {
      console.error('Erro ao adicionar progresso:', error);
      toast({
        title: 'Erro ao adicionar progresso',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // ✅ CONCLUIR META
  // ========================================================================
  async function concluirMeta(id: string) {
    try {
      const { data, error } = await supabase
        .from('savings_goals')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', usuarioId)
        .select()
        .single();

      if (error) throw error;

      setMetas((prev) =>
        prev.map((m) => (m.id === id ? data : m))
      );

      toast({
        title: 'Meta concluída!',
        description: '🎉 Parabéns pela conquista!',
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao concluir meta:', error);
      toast({
        title: 'Erro ao concluir',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // ❌ CANCELAR META
  // ========================================================================
  async function cancelarMeta(id: string) {
    try {
      const { data, error } = await supabase
        .from('savings_goals')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', usuarioId)
        .select()
        .single();

      if (error) throw error;

      setMetas((prev) =>
        prev.map((m) => (m.id === id ? data : m))
      );

      toast({
        title: 'Meta cancelada',
        description: 'A meta foi cancelada.',
        variant: 'destructive',
      });

      return data;
    } catch (error: any) {
      console.error('Erro ao cancelar meta:', error);
      toast({
        title: 'Erro ao cancelar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ========================================================================
  // 🗑️ DELETAR META
  // ========================================================================
  async function deletarMeta(id: string) {
    try {
      const { error } = await supabase
        .from('savings_goals')
        .delete()
        .eq('id', id)
        .eq('user_id', usuarioId);

      if (error) throw error;

      setMetas((prev) => prev.filter((m) => m.id !== id));

      toast({
        title: 'Meta removida',
        description: 'A meta foi deletada.',
      });
    } catch (error: any) {
      console.error('Erro ao deletar meta:', error);
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
  function getMetasAtivas() {
    return metas.filter((m) => m.status === 'active');
  }

  function getMetasConcluidas() {
    return metas.filter((m) => m.status === 'completed');
  }

  function getMetasCanceladas() {
    return metas.filter((m) => m.status === 'cancelled');
  }

  function calcularDiasRestantes(deadline: string | null) {
    if (!deadline) return null;
    const end = new Date(deadline);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  }

  function calcularValorFaltante(meta: Meta) {
    return Math.max(0, meta.target_amount - meta.current_amount);
  }

  function formatCurrency(value: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  return {
    metas,
    loading,
    criarMeta,
    atualizarMeta,
    adicionarProgresso,
    concluirMeta,
    cancelarMeta,
    deletarMeta,
    getMetasAtivas,
    getMetasConcluidas,
    getMetasCanceladas,
    calcularDiasRestantes,
    calcularValorFaltante,
    formatCurrency,
  };
}
