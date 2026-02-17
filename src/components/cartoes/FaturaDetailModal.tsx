import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Package, ShoppingBag, RefreshCw, Loader2 } from 'lucide-react';

interface FaturaItem {
  id: string;
  descricao: string;
  valor: number;
  categoria: string;
  parcela: string | null;
  data: string;
  tipo: 'pontual' | 'parcela' | 'recorrente';
}

interface FaturaDetailModalProps {
  open: boolean;
  onClose: () => void;
  faturaId: string;
  cartaoId?: string;
  cartaoNome: string;
  mes: number | null;
  ano: number | null;
  diaFechamento?: number | null;
  valorTotal: number | null;
  valorPago: number | null;
  status: string | null;
  onPagar?: (faturaId: string, valor: number) => Promise<unknown>;
}

const categoryEmojis: Record<string, string> = {
  alimentacao: "🍔", mercado: "🛒", transporte: "🚗", saude: "🏥",
  lazer: "🎮", moradia: "🏠", compras: "🛍️", servicos: "✂️",
  educacao: "📚", vestuario: "👕", outros: "📦"
};

const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export function FaturaDetailModal({
  open, onClose, faturaId, cartaoId, cartaoNome, mes, ano,
  diaFechamento, valorTotal, valorPago, status, onPagar
}: FaturaDetailModalProps) {
  const [items, setItems] = useState<FaturaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (open && (faturaId || cartaoId)) {
      fetchDetails();
    }
  }, [open, faturaId, cartaoId]);

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const result: FaturaItem[] = [];

      // Strategy: query by cartao_id + date range (billing cycle)
      // If dia_fechamento = 5 and fatura mes=3/ano=2026:
      //   covers Feb 6 to Mar 5
      if (cartaoId && mes && ano) {
        const dia = diaFechamento || 5;
        
        // Start date: previous month, day after fechamento
        const prevMonth = mes === 1 ? 12 : mes - 1;
        const prevYear = mes === 1 ? ano - 1 : ano;
        const startDay = dia + 1;
        const startDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(Math.min(startDay, 28)).padStart(2, '0')}`;
        
        // End date: current month, dia_fechamento
        const endDate = `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, 28)).padStart(2, '0')}`;

        // Fetch ALL transactions for this card in this billing cycle
        const { data: txData } = await supabase
          .from('transacoes')
          .select('id, descricao, valor, categoria, data, parcela, is_parcelado, id_recorrente')
          .eq('cartao_id', cartaoId)
          .eq('tipo', 'saida')
          .gte('data', startDate)
          .lte('data', endDate + 'T23:59:59')
          .order('data', { ascending: false });

        for (const t of (txData || [])) {
          const tipo: FaturaItem['tipo'] = t.id_recorrente ? 'recorrente' : t.is_parcelado ? 'parcela' : 'pontual';
          result.push({
            id: t.id,
            descricao: t.descricao || t.categoria || 'Gasto',
            valor: Number(t.valor),
            categoria: t.categoria || 'outros',
            parcela: t.parcela,
            data: t.data || '',
            tipo,
          });
        }
      }

      // Also fetch by fatura_id (for transactions that were directly linked)
      if (faturaId) {
        const { data: txByFatura } = await supabase
          .from('transacoes')
          .select('id, descricao, valor, categoria, data, parcela, is_parcelado, id_recorrente')
          .eq('fatura_id', faturaId)
          .eq('tipo', 'saida')
          .order('data', { ascending: false });

        for (const t of (txByFatura || [])) {
          if (!result.find(r => r.id === t.id)) {
            const tipo: FaturaItem['tipo'] = t.id_recorrente ? 'recorrente' : t.is_parcelado ? 'parcela' : 'pontual';
            result.push({
              id: t.id,
              descricao: t.descricao || t.categoria || 'Gasto',
              valor: Number(t.valor),
              categoria: t.categoria || 'outros',
              parcela: t.parcela,
              data: t.data || '',
              tipo,
            });
          }
        }
      }

      // Fetch parcelas linked to this fatura
      if (faturaId) {
        const { data: parcelasData } = await supabase
          .from('parcelas')
          .select('id, descricao, valor, numero_parcela, total_parcelas, mes_referencia')
          .eq('fatura_id', faturaId)
          .order('numero_parcela', { ascending: true });

        for (const p of (parcelasData || [])) {
          const parcelaTag = `${p.numero_parcela}/${p.total_parcelas}`;
          if (!result.find(r => r.parcela === parcelaTag && r.descricao === (p.descricao || 'Parcela'))) {
            result.push({
              id: p.id,
              descricao: p.descricao || 'Parcela',
              valor: Number(p.valor),
              categoria: 'compras',
              parcela: parcelaTag,
              data: p.mes_referencia || '',
              tipo: 'parcela',
            });
          }
        }
      }

      // Also fetch parcelas by cartao_id + mes_referencia
      if (cartaoId && mes && ano) {
        const mesRef = `${ano}-${String(mes).padStart(2, '0')}-01`;
        const { data: parcelasCartao } = await supabase
          .from('parcelas')
          .select('id, descricao, valor, numero_parcela, total_parcelas, mes_referencia')
          .eq('cartao_id', cartaoId)
          .eq('mes_referencia', mesRef)
          .order('numero_parcela', { ascending: true });

        for (const p of (parcelasCartao || [])) {
          if (!result.find(r => r.id === p.id)) {
            result.push({
              id: p.id,
              descricao: p.descricao || 'Parcela',
              valor: Number(p.valor),
              categoria: 'compras',
              parcela: `${p.numero_parcela}/${p.total_parcelas}`,
              data: p.mes_referencia || '',
              tipo: 'parcela',
            });
          }
        }
      }

      setItems(result);
    } finally {
      setLoading(false);
    }
  };

  const pontuais = items.filter(i => i.tipo === 'pontual');
  const parcelas = items.filter(i => i.tipo === 'parcela');
  const recorrentes = items.filter(i => i.tipo === 'recorrente');
  const totalPontuais = pontuais.reduce((s, i) => s + i.valor, 0);
  const totalParcelas = parcelas.reduce((s, i) => s + i.valor, 0);
  const totalRecorrentes = recorrentes.reduce((s, i) => s + i.valor, 0);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const mesNome = mes ? mesesNomes[mes - 1] : '';
  const pago = Number(valorPago || 0);
  const total = Number(valorTotal || 0);
  const restante = total - pago;
  const canPay = status !== 'paga' && onPagar && restante > 0;

  const handlePagar = async () => {
    if (!onPagar) return;
    setPaying(true);
    try {
      await onPagar(faturaId, total);
      onClose();
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-700 text-white max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            💳 Fatura {cartaoNome} — {mesNome} {ano}
          </DialogTitle>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-2xl font-bold text-white">{formatCurrency(total)}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              status === 'paga' ? 'bg-emerald-500/20 text-emerald-400' :
              status === 'fechada' ? 'bg-amber-500/20 text-amber-400' :
              'bg-blue-500/20 text-blue-400'
            }`}>
              {status}
            </span>
          </div>
          {pago > 0 && pago < total && (
            <p className="text-sm text-slate-400 mt-1">
              ✅ Pago: {formatCurrency(pago)} • ⚠️ Restante: {formatCurrency(restante)}
            </p>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center">
            <ShoppingBag className="w-12 h-12 mx-auto text-slate-600 mb-3" />
            <p className="text-slate-500">Nenhuma compra registrada nesta fatura</p>
          </div>
        ) : (
          <div className="space-y-5">
            {parcelas.length > 0 && (
              <Section
                icon={<Package className="w-4 h-4" />}
                title="📦 Parcelamentos"
                total={totalParcelas}
                items={parcelas}
                formatCurrency={formatCurrency}
              />
            )}

            {pontuais.length > 0 && (
              <Section
                icon={<ShoppingBag className="w-4 h-4" />}
                title="💸 Gastos Pontuais"
                total={totalPontuais}
                items={pontuais}
                formatCurrency={formatCurrency}
              />
            )}

            {recorrentes.length > 0 && (
              <Section
                icon={<RefreshCw className="w-4 h-4" />}
                title="🔄 Recorrentes"
                total={totalRecorrentes}
                items={recorrentes}
                formatCurrency={formatCurrency}
              />
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {canPay && (
            <Button
              onClick={handlePagar}
              disabled={paying}
              className="bg-gradient-to-r from-emerald-500 to-green-500 hover:opacity-90"
            >
              {paying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Marcar como paga
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ icon, title, total, items, formatCurrency }: {
  icon: React.ReactNode;
  title: string;
  total: number;
  items: FaturaItem[];
  formatCurrency: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          {icon} {title}
        </div>
        <span className="text-sm font-bold text-slate-400">{formatCurrency(total)}</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 p-2.5 bg-slate-800/40 rounded-lg border border-white/5">
            <span className="text-base flex-shrink-0">
              {categoryEmojis[item.categoria] || "📦"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{item.descricao}</p>
              {item.parcela && (
                <span className="text-xs text-indigo-400 font-medium">{item.parcela}</span>
              )}
            </div>
            <span className="text-sm font-bold text-red-400 flex-shrink-0">
              {formatCurrency(item.valor)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
