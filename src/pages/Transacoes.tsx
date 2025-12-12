import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { TransactionList } from '@/components/transacoes/TransactionList';
import { TransactionForm } from '@/components/transacoes/TransactionForm';
import { useTransacoes } from '@/hooks/useTransacoes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, Filter } from 'lucide-react';
import { CATEGORIAS } from '@/types/finance';
import { useMemo } from 'react';

const Transacoes = () => {
  const { transacoes, loading, addTransacao, deleteTransacao } = useTransacoes();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategoria, setFilterCategoria] = useState<string>('all');
  const [filterTipo, setFilterTipo] = useState<string>('all');

  const filteredTransacoes = useMemo(() => {
    return transacoes.filter((t) => {
      const matchSearch =
        !search ||
        t.observacao?.toLowerCase().includes(search.toLowerCase()) ||
        t.categoria.toLowerCase().includes(search.toLowerCase());

      const matchCategoria = filterCategoria === 'all' || t.categoria === filterCategoria;
      const matchTipo = filterTipo === 'all' || t.tipo === filterTipo;

      return matchSearch && matchCategoria && matchTipo;
    });
  }, [transacoes, search, filterCategoria, filterTipo]);

  const handleAddTransaction = async (data: {
    tipo: 'entrada' | 'saida';
    valor: number;
    categoria: string;
    observacao: string;
    data: string;
  }) => {
    await addTransacao({
      tipo: data.tipo,
      valor: data.valor,
      categoria: data.categoria,
      observacao: data.observacao,
      data: data.data,
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Transações</h1>
            <p className="text-muted-foreground">
              Gerencie suas entradas e saídas
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Nova Transação
          </Button>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar transações..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterCategoria} onValueChange={setFilterCategoria}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {CATEGORIAS.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterTipo} onValueChange={setFilterTipo}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="entrada">Entradas</SelectItem>
                <SelectItem value="saida">Saídas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <TransactionList
          transacoes={filteredTransacoes}
          onDelete={deleteTransacao}
          loading={loading}
        />
      </div>

      <TransactionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleAddTransaction}
      />
    </AppLayout>
  );
};

export default Transacoes;
