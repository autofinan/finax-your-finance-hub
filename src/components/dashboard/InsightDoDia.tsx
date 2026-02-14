import { useMemo } from 'react';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { CATEGORIAS } from '@/types/finance';

interface Transacao {
  tipo: string;
  valor: number;
  categoria: string;
  data: string;
}

interface Stats {
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
}

export function InsightDoDia({ transacoes, stats }: { transacoes: Transacao[]; stats: Stats }) {
  const insight = useMemo(() => {
    if (!transacoes.length) {
      return { text: 'Registre suas primeiras transações para receber insights personalizados!', type: 'empty' };
    }

    const agora = new Date();
    const inicioMes = startOfMonth(agora);
    const fimMes = endOfMonth(agora);
    const inicioMesAnterior = startOfMonth(subMonths(agora, 1));
    const fimMesAnterior = endOfMonth(subMonths(agora, 1));

    const saidasMes = transacoes.filter(t => {
      const d = new Date(t.data);
      return t.tipo === 'saida' && d >= inicioMes && d <= fimMes;
    });

    const saidasMesAnterior = transacoes.filter(t => {
      const d = new Date(t.data);
      return t.tipo === 'saida' && d >= inicioMesAnterior && d <= fimMesAnterior;
    });

    // Comparar por categoria
    const porCatAtual: Record<string, number> = {};
    saidasMes.forEach(t => { porCatAtual[t.categoria] = (porCatAtual[t.categoria] || 0) + Number(t.valor); });

    const porCatAnterior: Record<string, number> = {};
    saidasMesAnterior.forEach(t => { porCatAnterior[t.categoria] = (porCatAnterior[t.categoria] || 0) + Number(t.valor); });

    // Encontrar maior redução
    let maiorReducao = { cat: '', pct: 0 };
    let maiorAumento = { cat: '', pct: 0 };

    for (const cat of Object.keys({ ...porCatAtual, ...porCatAnterior })) {
      const atual = porCatAtual[cat] || 0;
      const anterior = porCatAnterior[cat] || 0;
      if (anterior > 0) {
        const variacao = ((atual - anterior) / anterior) * 100;
        if (variacao < maiorReducao.pct) maiorReducao = { cat, pct: variacao };
        if (variacao > maiorAumento.pct) maiorAumento = { cat, pct: variacao };
      }
    }

    const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }).format(v);
    const catLabel = (v: string) => CATEGORIAS.find(c => c.value === v)?.label || v;

    if (maiorReducao.pct < -10) {
      return {
        text: `Você está gastando ${Math.abs(Math.round(maiorReducao.pct))}% a menos em ${catLabel(maiorReducao.cat)} este mês comparado ao anterior. Continue assim! 🎉`,
        type: 'positive',
      };
    }

    if (maiorAumento.pct > 20) {
      return {
        text: `Atenção: seus gastos com ${catLabel(maiorAumento.cat)} aumentaram ${Math.round(maiorAumento.pct)}% em relação ao mês passado. Vale ficar de olho! 👀`,
        type: 'warning',
      };
    }

    if (stats.saldo > 0) {
      return {
        text: `Seu saldo está positivo em ${formatCurrency(stats.saldo)} este mês. Ótimo controle financeiro! 💪`,
        type: 'positive',
      };
    }

    return {
      text: `Você já gastou ${formatCurrency(stats.totalSaidas)} este mês. Fique atento ao seu orçamento!`,
      type: 'neutral',
    };
  }, [transacoes, stats]);

  return (
    <p className="text-slate-300 leading-relaxed">
      {insight.text}
    </p>
  );
}
