import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Categoria } from '@/types/finance';
import { useToast } from '@/hooks/use-toast';

export function useCategorias(usuarioId?: string) {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchCategorias = async () => {
    try {
      setLoading(true);
      
      // Buscar categorias globais (usuario_id = null) e do usuário
      let query = supabase
        .from('categorias')
        .select('*')
        .order('nome', { ascending: true });

      // RLS deve filtrar automaticamente, mas podemos ser específicos
      if (usuarioId) {
        query = query.or(`usuario_id.eq.${usuarioId},usuario_id.is.null`);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCategorias((data as Categoria[]) || []);
    } catch (error) {
      console.error('Erro ao buscar categorias:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as categorias.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addCategoria = async (categoria: Omit<Categoria, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const { data, error } = await supabase
        .from('categorias')
        .insert([categoria])
        .select()
        .single();

      if (error) throw error;

      setCategorias((prev) => [...prev, data as Categoria].sort((a, b) => a.nome.localeCompare(b.nome)));
      toast({
        title: 'Sucesso',
        description: 'Categoria adicionada com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao adicionar categoria:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível adicionar a categoria.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const updateCategoria = async (id: string, updates: Partial<Categoria>) => {
    try {
      const { data, error } = await supabase
        .from('categorias')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setCategorias((prev) =>
        prev.map((c) => (c.id === id ? (data as Categoria) : c))
      );
      toast({
        title: 'Sucesso',
        description: 'Categoria atualizada com sucesso!',
      });
      return data;
    } catch (error) {
      console.error('Erro ao atualizar categoria:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar a categoria.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchCategorias();
  }, [usuarioId]);

  // Separar categorias por tipo
  const categoriasEntrada = categorias.filter((c) => c.tipo === 'entrada');
  const categoriasSaida = categorias.filter((c) => c.tipo === 'saida');

  return {
    categorias,
    categoriasEntrada,
    categoriasSaida,
    loading,
    addCategoria,
    updateCategoria,
    refetch: fetchCategorias,
  };
}
