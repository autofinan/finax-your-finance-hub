import { useMemo } from 'react';
import { useDividas } from '@/hooks/useDividas';
import { useDashboard } from '@/hooks/useDashboard';

export interface FreedomMetrics {
  diasParaLiberdade: number;
  dataEstimada: Date | null;
  margemReal: number;
  saldoTotal: number;
  minimoTotal: number;
  progressoPercentual: number;
  impactoPorReal: number; // dias por R$1 gasto
  hasData: boolean;
}

export function useFreedomDays(usuarioId?: string): FreedomMetrics {
  const { dividasAtivas, saldoTotal, minimoTotal } = useDividas();
  const { dashboard } = useDashboard(usuarioId);

  return useMemo(() => {
    const totalEntradas = Number(dashboard?.total_entradas_mes || 0);
    const totalSaidas = Number(dashboard?.total_gastos_mes || 0);

    if (dividasAtivas.length === 0 || totalEntradas === 0) {
      return {
        diasParaLiberdade: 0,
        dataEstimada: null,
        margemReal: 0,
        saldoTotal,
        minimoTotal,
        progressoPercentual: dividasAtivas.length === 0 ? 100 : 0,
        impactoPorReal: 0,
        hasData: false,
      };
    }

    // Margem = entradas - saídas (o que sobra no mês)
    const margemReal = Math.max(0, totalEntradas - totalSaidas);

    // Se margem é 0, liberdade é infinita
    if (margemReal <= 0) {
      return {
        diasParaLiberdade: Infinity,
        dataEstimada: null,
        margemReal: 0,
        saldoTotal,
        minimoTotal,
        progressoPercentual: 0,
        impactoPorReal: 0,
        hasData: true,
      };
    }

    // Dias = saldo_devedor / (margem_diaria)
    const margemDiaria = margemReal / 30;
    const diasParaLiberdade = Math.ceil(saldoTotal / margemDiaria);

    const dataEstimada = new Date();
    dataEstimada.setDate(dataEstimada.getDate() + diasParaLiberdade);

    // Impacto: cada R$1 gasto a mais = X dias a mais
    const impactoPorReal = 1 / margemDiaria;

    // Progresso: baseado em quanto já se reduziu (simplificado)
    const progressoPercentual = 0; // será calculado com histórico futuro

    return {
      diasParaLiberdade,
      dataEstimada,
      margemReal,
      saldoTotal,
      minimoTotal,
      progressoPercentual,
      impactoPorReal,
      hasData: true,
    };
  }, [dividasAtivas, saldoTotal, minimoTotal, dashboard]);
}
