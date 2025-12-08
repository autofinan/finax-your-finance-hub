import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useGastosRecorrentes } from '@/hooks/useGastosRecorrentes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, RefreshCcw, Calendar, DollarSign } from 'lucide-react';
import { CATEGORIAS, CategoriaTransacao, GastoRecorrente } from '@/types/finance';
import { cn } from '@/lib/utils';

const Recorrentes = () => {
  const { gastos, loading, addGasto, updateGasto, deleteGasto } = useGastosRecorrentes();
  const [formOpen, setFormOpen] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [valorParcela, setValorParcela] = useState('');
  const [categoria, setCategoria] = useState<CategoriaTransacao>('outros');
  const [tipoRecorrencia, setTipoRecorrencia] = useState<'mensal' | 'semanal' | 'parcelado'>('mensal');
  const [diaMes, setDiaMes] = useState('1');
  const [numParcelas, setNumParcelas] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valorParcela || parseFloat(valorParcela) <= 0) return;

    setFormLoading(true);
    try {
      await addGasto({
        descricao,
        valor_parcela: parseFloat(valorParcela),
        valor_total: tipoRecorrencia === 'parcelado' 
          ? parseFloat(valorParcela) * parseInt(numParcelas || '1')
          : null,
        categoria,
        tipo_recorrencia: tipoRecorrencia,
        dia_mes: tipoRecorrencia === 'mensal' ? parseInt(diaMes) : null,
        dia_semana: null,
        num_parcelas: tipoRecorrencia === 'parcelado' ? parseInt(numParcelas || '1') : null,
        parcela_atual: 1,
        ativo: true,
        usuario_id: null,
      });
      resetForm();
      setFormOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const resetForm = () => {
    setDescricao('');
    setValorParcela('');
    setCategoria('outros');
    setTipoRecorrencia('mensal');
    setDiaMes('1');
    setNumParcelas('');
  };

  const toggleAtivo = async (gasto: GastoRecorrente) => {
    await updateGasto(gasto.id, { ativo: !gasto.ativo });
  };

  const getCategoriaInfo = (categoria: string) => {
    return CATEGORIAS.find((c) => c.value === categoria) || { label: categoria, cor: 'hsl(220, 10%, 50%)' };
  };

  const totalMensal = gastos
    .filter((g) => g.ativo)
    .reduce((acc, g) => acc + Number(g.valor_parcela), 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Gastos Recorrentes</h1>
            <p className="text-muted-foreground">
              Total mensal: <span className="font-semibold text-foreground">{formatCurrency(totalMensal)}</span>
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Gasto
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-muted" />
                  <div className="flex-1">
                    <div className="h-4 bg-muted rounded w-32 mb-2" />
                    <div className="h-3 bg-muted rounded w-20" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : gastos.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <RefreshCcw className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum gasto recorrente cadastrado.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {gastos.map((gasto, index) => {
              const categoriaInfo = getCategoriaInfo(gasto.categoria);
              return (
                <div
                  key={gasto.id}
                  className={cn(
                    'glass rounded-xl p-4 animate-slide-up transition-opacity',
                    !gasto.ativo && 'opacity-50'
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="p-3 rounded-xl"
                      style={{ backgroundColor: `${categoriaInfo.cor}20` }}
                    >
                      <RefreshCcw className="w-6 h-6" style={{ color: categoriaInfo.cor }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium truncate">
                          {gasto.descricao || categoriaInfo.label}
                        </p>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${categoriaInfo.cor}20`,
                            color: categoriaInfo.cor,
                          }}
                        >
                          {categoriaInfo.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {gasto.tipo_recorrencia === 'mensal' && `Dia ${gasto.dia_mes}`}
                          {gasto.tipo_recorrencia === 'semanal' && 'Semanal'}
                          {gasto.tipo_recorrencia === 'parcelado' && 
                            `${gasto.parcela_atual}/${gasto.num_parcelas} parcelas`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-bold text-lg">
                          {formatCurrency(Number(gasto.valor_parcela))}
                        </p>
                        <p className="text-xs text-muted-foreground">por mês</p>
                      </div>
                      <Switch
                        checked={gasto.ativo}
                        onCheckedChange={() => toggleAtivo(gasto)}
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir gasto recorrente?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteGasto(gasto.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Gasto Recorrente</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                placeholder="Ex: Netflix, Aluguel..."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={valorParcela}
                onChange={(e) => setValorParcela(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaTransacao)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.filter((c) => c.value !== 'salario').map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tipo de Recorrência</Label>
              <Select value={tipoRecorrencia} onValueChange={(v) => setTipoRecorrencia(v as typeof tipoRecorrencia)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="parcelado">Parcelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {tipoRecorrencia === 'mensal' && (
              <div className="space-y-2">
                <Label>Dia do Mês</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={diaMes}
                  onChange={(e) => setDiaMes(e.target.value)}
                />
              </div>
            )}

            {tipoRecorrencia === 'parcelado' && (
              <div className="space-y-2">
                <Label>Número de Parcelas</Label>
                <Input
                  type="number"
                  min="1"
                  value={numParcelas}
                  onChange={(e) => setNumParcelas(e.target.value)}
                  required
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={formLoading}>
              {formLoading ? 'Salvando...' : 'Adicionar'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Recorrentes;
