import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CATEGORIAS, CategoriaTransacao } from '@/types/finance';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TransactionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    tipo: 'entrada' | 'saida';
    valor: number;
    categoria: string;
    observacao: string;
    data: string;
  }) => Promise<void>;
}

export function TransactionForm({ open, onOpenChange, onSubmit }: TransactionFormProps) {
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('saida');
  const [valor, setValor] = useState('');
  const [categoria, setCategoria] = useState<CategoriaTransacao>('outros');
  const [observacao, setObservacao] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valor || parseFloat(valor) <= 0) return;

    setLoading(true);
    try {
      await onSubmit({
        tipo,
        valor: parseFloat(valor),
        categoria,
        observacao,
        data: new Date().toISOString(),
      });
      setValor('');
      setCategoria('outros');
      setObservacao('');
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const categoriasFiltered = CATEGORIAS.filter((c) =>
    tipo === 'entrada'
      ? ['salario', 'investimentos', 'outros'].includes(c.value)
      : !['salario'].includes(c.value)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Transação</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={tipo === 'entrada' ? 'default' : 'outline'}
              onClick={() => setTipo('entrada')}
              className={cn(
                'flex-1',
                tipo === 'entrada' && 'bg-green-600 hover:bg-green-700'
              )}
            >
              <ArrowDownLeft className="w-4 h-4 mr-2" />
              Entrada
            </Button>
            <Button
              type="button"
              variant={tipo === 'saida' ? 'default' : 'outline'}
              onClick={() => setTipo('saida')}
              className={cn(
                'flex-1',
                tipo === 'saida' && 'bg-red-600 hover:bg-red-700'
              )}
            >
              <ArrowUpRight className="w-4 h-4 mr-2" />
              Saída
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="valor">Valor (R$)</Label>
            <Input
              id="valor"
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="text-2xl font-bold h-14"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="categoria">Categoria</Label>
            <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaTransacao)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent>
                {categoriasFiltered.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: cat.cor }}
                      />
                      {cat.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="observacao">Observação (opcional)</Label>
            <Textarea
              id="observacao"
              placeholder="Descreva a transação..."
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !valor}
          >
            {loading ? 'Salvando...' : 'Adicionar Transação'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
