import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/utils';
import { TrendingDown, Zap, Target, Clock } from 'lucide-react';
import type { Divida } from '@/hooks/useDividas';

interface CenarioResult {
  nome: string;
  meses: number;
  totalJuros: number;
  totalPago: number;
  pagamentoMensal: number;
  ordemQuitacao: { nome: string; meses: number }[];
}

function simularCenario(
  dividas: Divida[],
  margemExtra: number,
  nome: string
): CenarioResult {
  if (dividas.length === 0) {
    return { nome, meses: 0, totalJuros: 0, totalPago: 0, pagamentoMensal: 0, ordemQuitacao: [] };
  }

  const minimoTotal = dividas.reduce((s, d) => s + (d.valor_minimo || 0), 0);
  const pagamentoMensal = minimoTotal + margemExtra;

  let saldos = dividas.map(d => ({
    nome: d.nome,
    saldo: d.saldo_devedor,
    taxa: (d.taxa_juros || 0) / 100,
    minimo: d.valor_minimo || 0,
    quitada: false,
    mesQuitacao: 0,
  })).sort((a, b) => b.taxa - a.taxa);

  let meses = 0;
  let totalJuros = 0;
  let totalPago = 0;
  const ordemQuitacao: { nome: string; meses: number }[] = [];
  const MAX_MESES = 600;

  while (saldos.some(s => !s.quitada && s.saldo > 0) && meses < MAX_MESES) {
    meses++;
    let extraDisponivel = margemExtra;

    for (const s of saldos) {
      if (s.quitada || s.saldo <= 0) continue;
      const juros = s.saldo * s.taxa;
      totalJuros += juros;
      s.saldo += juros;
    }

    for (const s of saldos) {
      if (s.quitada || s.saldo <= 0) continue;
      const pagamento = Math.min(s.minimo, s.saldo);
      s.saldo -= pagamento;
      totalPago += pagamento;
      if (s.saldo <= 0.01) {
        s.quitada = true;
        s.saldo = 0;
        s.mesQuitacao = meses;
        ordemQuitacao.push({ nome: s.nome, meses });
      }
    }

    for (const s of saldos) {
      if (s.quitada || s.saldo <= 0 || extraDisponivel <= 0) continue;
      const pagamento = Math.min(extraDisponivel, s.saldo);
      s.saldo -= pagamento;
      totalPago += pagamento;
      extraDisponivel -= pagamento;
      if (s.saldo <= 0.01) {
        s.quitada = true;
        s.saldo = 0;
        s.mesQuitacao = meses;
        ordemQuitacao.push({ nome: s.nome, meses });
      }
    }
  }

  return {
    nome,
    meses,
    totalJuros: Math.round(totalJuros * 100) / 100,
    totalPago: Math.round(totalPago * 100) / 100,
    pagamentoMensal: Math.round(pagamentoMensal * 100) / 100,
    ordemQuitacao,
  };
}

interface SimuladorProps {
  dividasAtivas: Divida[];
  receitaMensal?: number;
  gastoEssencialMensal?: number;
}

export function SimuladorQuitacao({ dividasAtivas, receitaMensal = 0, gastoEssencialMensal = 0 }: SimuladorProps) {
  const minimoTotal = dividasAtivas.reduce((s, d) => s + (d.valor_minimo || 0), 0);

  const [receita, setReceita] = useState(receitaMensal.toString());
  const [gastoFixo, setGastoFixo] = useState(gastoEssencialMensal.toString());
  const [calculado, setCalculado] = useState(false);

  const receitaNum = parseFloat(receita) || 0;
  const gastoFixoNum = parseFloat(gastoFixo) || 0;
  const margemReal = Math.max(0, receitaNum - gastoFixoNum - minimoTotal);

  const cenarios = useMemo(() => {
    if (!calculado || dividasAtivas.length === 0) return null;

    const atual = simularCenario(dividasAtivas, 0, 'Atual');
    const conservador = simularCenario(dividasAtivas, margemReal * 0.5, 'Conservador');
    const agressivo = simularCenario(dividasAtivas, margemReal, 'Agressivo');

    return { atual, conservador, agressivo };
  }, [calculado, dividasAtivas, margemReal]);

  if (dividasAtivas.length === 0) return null;

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-foreground">
          <div className="p-2 rounded-xl bg-primary/10">
            <Target className="w-5 h-5 text-primary" />
          </div>
          Simulador de Quitação
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Descubra como acelerar sua liberdade financeira com 3 cenários
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input area */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Receita Mensal (R$)</label>
            <Input
              type="number"
              step="0.01"
              value={receita}
              onChange={e => { setReceita(e.target.value); setCalculado(false); }}
              placeholder="Ex: 5000"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Gastos Essenciais Fixos (R$)</label>
            <Input
              type="number"
              step="0.01"
              value={gastoFixo}
              onChange={e => { setGastoFixo(e.target.value); setCalculado(false); }}
              placeholder="Ex: 3000"
            />
          </div>
        </div>

        {/* Margem Real display */}
        <div className="bg-muted/50 rounded-xl p-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Margem Real (Receita − Fixos − Mínimos)
          </span>
          <span className={`font-bold ${margemReal > 0 ? 'text-emerald-400' : 'text-destructive'}`}>
            {formatCurrency(margemReal)}
          </span>
        </div>

        <Button onClick={() => setCalculado(true)} className="w-full" disabled={receitaNum <= 0}>
          <Zap className="w-4 h-4 mr-2" />
          Simular Cenários
        </Button>

        {/* Results */}
        {cenarios && (
          <Tabs defaultValue="comparativo" className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="comparativo" className="flex-1 text-xs">Comparativo</TabsTrigger>
              <TabsTrigger value="atual" className="flex-1 text-xs">Atual</TabsTrigger>
              <TabsTrigger value="conservador" className="flex-1 text-xs">50%</TabsTrigger>
              <TabsTrigger value="agressivo" className="flex-1 text-xs">100%</TabsTrigger>
            </TabsList>

            <TabsContent value="comparativo">
              <div className="grid gap-3 mt-2">
                {[cenarios.atual, cenarios.conservador, cenarios.agressivo].map((c, i) => {
                  const economia = cenarios.atual.totalPago - c.totalPago;
                  const mesesEconomia = cenarios.atual.meses - c.meses;
                  const colors = ['text-amber-400', 'text-blue-400', 'text-emerald-400'];
                  const bgs = ['bg-amber-400/10', 'bg-blue-400/10', 'bg-emerald-400/10'];
                  const icons = [Clock, TrendingDown, Zap];
                  const Icon = icons[i];
                  const labels = ['Só Mínimo', '+50% Margem', '+100% Margem'];

                  return (
                    <div key={c.nome} className={`rounded-xl p-4 ${bgs[i]} border border-border`}>
                      <div className="flex items-center gap-3 mb-3">
                        <Icon className={`w-5 h-5 ${colors[i]}`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-bold ${colors[i]}`}>{c.nome}</h4>
                            <Badge variant="outline" className="text-[10px]">{labels[i]}</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Pgto/mês</p>
                          <p className="font-bold text-foreground text-sm">
                            {formatCurrency(c.pagamentoMensal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Prazo</p>
                          <p className="font-bold text-foreground text-sm">
                            {c.meses >= 600 ? '∞' : `${c.meses} meses`}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Total Pago</p>
                          <p className="font-bold text-foreground text-sm">{formatCurrency(c.totalPago)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Juros Pagos</p>
                          <p className="font-bold text-destructive text-sm">{formatCurrency(c.totalJuros)}</p>
                        </div>
                      </div>
                      {mesesEconomia > 0 && i > 0 && (
                        <p className="text-xs text-center mt-2 text-emerald-400">
                          🚀 {mesesEconomia} meses mais rápido • Economia de {formatCurrency(economia)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {[
              { key: 'atual', data: cenarios.atual },
              { key: 'conservador', data: cenarios.conservador },
              { key: 'agressivo', data: cenarios.agressivo },
            ].map(({ key, data }) => (
              <TabsContent key={key} value={key}>
                <div className="space-y-3 mt-2">
                  <div className="bg-muted/50 rounded-xl p-4">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">Pagamento Mensal</p>
                        <p className="text-2xl font-black text-foreground">
                          {formatCurrency(data.pagamentoMensal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Prazo Total</p>
                        <p className="text-2xl font-black text-foreground">
                          {data.meses >= 600 ? '∞' : `${data.meses}`}
                        </p>
                        <p className="text-[10px] text-muted-foreground">meses</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-center mt-4 pt-4 border-t border-border">
                      <div>
                        <p className="text-xs text-muted-foreground">Total Pago</p>
                        <p className="text-lg font-bold text-foreground">{formatCurrency(data.totalPago)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total em Juros</p>
                        <p className="text-lg font-bold text-destructive">{formatCurrency(data.totalJuros)}</p>
                      </div>
                    </div>
                  </div>

                  {data.ordemQuitacao.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Ordem de Quitação (Avalanche)</p>
                      <div className="space-y-1">
                        {data.ordemQuitacao.map((d, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="text-[10px] w-6 h-6 flex items-center justify-center p-0">
                              {i + 1}
                            </Badge>
                            <span className="text-foreground flex-1">{d.nome}</span>
                            <span className="text-muted-foreground text-xs">{d.meses} meses</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
