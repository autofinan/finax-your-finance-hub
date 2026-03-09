import { useMemo } from 'react';
import { Transacao } from '@/types/finance';
import { useDividas } from '@/hooks/useDividas';

export interface ProjecaoCenario {
  label: string;
  meses: number;
  dados: ProjecaoMes[];
  saldoFinal: number;
  economiaPotencial: number;
  dividaRestante: number;
}

export interface ProjecaoMes {
  mes: string;
  mesNum: number;
  entradas: number;
  saidas: number;
  saldo: number;
  saldoAcumulado: number;
  dividaRestante: number;
}

export function useProjecoes(transacoes: Transacao[], usuarioId?: string) {
  const { saldoTotal, minimoTotal, dividasAtivas } = useDividas();

  return useMemo(() => {
    if (!transacoes.length) {
      return { cenarios: [], mediaEntradas: 0, mediaSaidas: 0, tendencia: 'estavel' as const };
    }

    // Calcular médias dos últimos 3 meses
    const agora = new Date();
    const tresMesesAtras = new Date(agora);
    tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);

    const transacoesRecentes = transacoes.filter(t => new Date(t.data) >= tresMesesAtras);

    const totalEntradas = transacoesRecentes
      .filter(t => t.tipo === 'entrada')
      .reduce((sum, t) => sum + Number(t.valor), 0);
    const totalSaidas = transacoesRecentes
      .filter(t => t.tipo === 'saida')
      .reduce((sum, t) => sum + Number(t.valor), 0);

    const mesesComDados = Math.max(1, Math.min(3, 
      new Set(transacoesRecentes.map(t => t.data.substring(0, 7))).size
    ));

    const mediaEntradas = totalEntradas / mesesComDados;
    const mediaSaidas = totalSaidas / mesesComDados;
    const margemMensal = mediaEntradas - mediaSaidas;

    // Tendência: comparar último mês com penúltimo
    const mesAtual = agora.toISOString().substring(0, 7);
    const mesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1).toISOString().substring(0, 7);
    
    const gastosMesAtual = transacoes
      .filter(t => t.data.substring(0, 7) === mesAtual && t.tipo === 'saida')
      .reduce((sum, t) => sum + Number(t.valor), 0);
    const gastosMesAnterior = transacoes
      .filter(t => t.data.substring(0, 7) === mesAnterior && t.tipo === 'saida')
      .reduce((sum, t) => sum + Number(t.valor), 0);

    const tendencia = gastosMesAnterior > 0
      ? gastosMesAtual > gastosMesAnterior * 1.1 ? 'subindo' as const
        : gastosMesAtual < gastosMesAnterior * 0.9 ? 'descendo' as const
        : 'estavel' as const
      : 'estavel' as const;

    const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    function gerarCenario(label: string, numMeses: number, fatorEconomia: number): ProjecaoCenario {
      const dados: ProjecaoMes[] = [];
      let saldoAcumulado = 0;
      let dividaAtual = saldoTotal;
      const saidasAjustadas = mediaSaidas * fatorEconomia;

      for (let i = 1; i <= numMeses; i++) {
        const mesDate = new Date(agora.getFullYear(), agora.getMonth() + i);
        const saldoMes = mediaEntradas - saidasAjustadas;
        saldoAcumulado += saldoMes;

        // Abater dívida com margem positiva
        if (saldoMes > 0 && dividaAtual > 0) {
          dividaAtual = Math.max(0, dividaAtual - saldoMes);
        }

        dados.push({
          mes: `${mesesNomes[mesDate.getMonth()]}/${mesDate.getFullYear().toString().slice(2)}`,
          mesNum: i,
          entradas: mediaEntradas,
          saidas: saidasAjustadas,
          saldo: saldoMes,
          saldoAcumulado,
          dividaRestante: dividaAtual,
        });
      }

      return {
        label,
        meses: numMeses,
        dados,
        saldoFinal: saldoAcumulado,
        economiaPotencial: (mediaSaidas - saidasAjustadas) * numMeses,
        dividaRestante: dividaAtual,
      };
    }

    // 3 cenários: Realista (mantém gastos), Otimista (-10%), Econômico (-20%)
    const cenarios: ProjecaoCenario[] = [
      // 3 meses
      gerarCenario('3 meses — Realista', 3, 1.0),
      gerarCenario('3 meses — Otimista (-10%)', 3, 0.9),
      gerarCenario('3 meses — Econômico (-20%)', 3, 0.8),
      // 6 meses
      gerarCenario('6 meses — Realista', 6, 1.0),
      gerarCenario('6 meses — Otimista (-10%)', 6, 0.9),
      gerarCenario('6 meses — Econômico (-20%)', 6, 0.8),
      // 12 meses
      gerarCenario('12 meses — Realista', 12, 1.0),
      gerarCenario('12 meses — Otimista (-10%)', 12, 0.9),
      gerarCenario('12 meses — Econômico (-20%)', 12, 0.8),
    ];

    return { cenarios, mediaEntradas, mediaSaidas, tendencia };
  }, [transacoes, saldoTotal]);
}
