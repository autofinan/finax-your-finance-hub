import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Target, AlertTriangle, CheckCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Orcamento {
  id: string;
  tipo: string;
  categoria: string | null;
  limite: number;
  gasto_atual: number;
  ativo: boolean;
}

export function BudgetCard() {
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrcamentos = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('orcamentos')
          .select('*')
          .eq('usuario_id', user.id)
          .eq('ativo', true)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Erro ao buscar orçamentos:', error);
        } else {
          setOrcamentos(data || []);
        }
      } catch (err) {
        console.error('Erro:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrcamentos();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getPercentual = (gasto: number, limite: number) => {
    return Math.min((gasto / limite) * 100, 100);
  };

  const getStatusColor = (percentual: number) => {
    if (percentual >= 100) return 'text-destructive';
    if (percentual >= 80) return 'text-warning';
    return 'text-primary';
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-5 h-5" />
            Orçamentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 animate-pulse bg-muted rounded"></div>
        </CardContent>
      </Card>
    );
  }

  if (orcamentos.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-5 h-5" />
            Orçamentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum orçamento definido.<br />
            <span className="text-xs">Crie pelo WhatsApp: "orçamento de 500 para alimentação"</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="w-5 h-5" />
          Orçamentos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {orcamentos.slice(0, 3).map((orc) => {
          const percentual = getPercentual(orc.gasto_atual, orc.limite);
          const statusColor = getStatusColor(percentual);

          return (
            <div key={orc.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {percentual >= 100 ? (
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  ) : percentual >= 80 ? (
                    <AlertTriangle className="w-4 h-4 text-warning" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-primary" />
                  )}
                  <span className="font-medium text-sm">
                    {orc.tipo === 'global' ? 'Total' : orc.categoria || 'Categoria'}
                  </span>
                </div>
                <span className={`text-sm font-medium ${statusColor}`}>
                  {percentual.toFixed(0)}%
                </span>
              </div>
              <Progress value={percentual} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatCurrency(orc.gasto_atual)}</span>
                <span>de {formatCurrency(orc.limite)}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
