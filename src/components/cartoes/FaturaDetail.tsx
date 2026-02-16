import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ChevronDown, ChevronUp, Receipt } from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';

interface FaturaTransaction {
  id: string;
  descricao: string | null;
  valor: number;
  categoria: string;
  data: string;
  parcela: string | null;
  is_parcelado: boolean | null;
}

interface FaturaDetailProps {
  faturaId: string;
  cartaoId: string;
  mes: number | null;
  ano: number | null;
  valorTotal: number | null;
}

const categoryEmojis: Record<string, string> = {
  alimentacao: "🍔",
  mercado: "🛒",
  transporte: "🚗",
  saude: "🏥",
  lazer: "🎮",
  moradia: "🏠",
  compras: "🛍️",
  servicos: "✂️",
  educacao: "📚",
  vestuario: "👕",
  outros: "📦"
};

export function FaturaDetail({ faturaId, valorTotal }: FaturaDetailProps) {
  const [open, setOpen] = useState(false);
  const [transactions, setTransactions] = useState<FaturaTransaction[]>([]);
  const [parcelas, setParcelas] = useState<FaturaTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDetails = async () => {
    if (!open || transactions.length > 0) return;
    setLoading(true);
    
    try {
      // Buscar transações vinculadas a esta fatura
      const { data: txData } = await supabase
        .from('transacoes')
        .select('id, descricao, valor, categoria, data, parcela, is_parcelado')
        .eq('fatura_id', faturaId)
        .eq('tipo', 'saida')
        .order('data', { ascending: false });

      // Buscar parcelas vinculadas a esta fatura
      const { data: parcelasData } = await supabase
        .from('parcelas')
        .select('id, descricao, valor, status, numero_parcela, total_parcelas, mes_referencia')
        .eq('fatura_id', faturaId)
        .order('numero_parcela', { ascending: true });

      setTransactions((txData || []).map(t => ({
        id: t.id,
        descricao: t.descricao,
        valor: Number(t.valor),
        categoria: t.categoria || 'outros',
        data: t.data,
        parcela: t.parcela,
        is_parcelado: t.is_parcelado,
      })));

      setParcelas((parcelasData || []).map(p => ({
        id: p.id,
        descricao: p.descricao || 'Parcela',
        valor: Number(p.valor),
        categoria: 'outros',
        data: p.mes_referencia || '',
        parcela: `${p.numero_parcela}/${p.total_parcelas}`,
        is_parcelado: true,
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchDetails();
  }, [open]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  // Merge transactions + parcelas (dedup by description where tx already covers parcela)
  const allItems = [...transactions];
  // Add parcelas that don't have a matching transaction
  for (const p of parcelas) {
    const hasTx = transactions.some(t => t.parcela === p.parcela && t.descricao === p.descricao);
    if (!hasTx) allItems.push(p);
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
      >
        <Receipt className="w-4 h-4" />
        Detalhar fatura
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : allItems.length === 0 ? (
                <p className="text-sm text-slate-500 py-3 text-center">
                  Nenhuma compra nesta fatura ainda
                </p>
              ) : (
                <>
                  {allItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2.5 bg-slate-800/30 rounded-lg border border-white/5"
                    >
                      <span className="text-lg flex-shrink-0">
                        {categoryEmojis[item.categoria] || "📦"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">
                          {item.descricao || item.categoria}
                        </p>
                        <div className="flex items-center gap-2">
                          {item.parcela && (
                            <span className="text-xs text-indigo-400 font-medium">
                              {item.parcela}
                            </span>
                          )}
                          <span className="text-xs text-slate-500">
                            {item.data ? new Date(item.data).toLocaleDateString('pt-BR') : ''}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-red-400 flex-shrink-0">
                        {formatCurrency(item.valor)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2 border-t border-slate-700/50">
                    <span className="text-xs text-slate-500">
                      {allItems.length} {allItems.length === 1 ? 'item' : 'itens'}
                    </span>
                    <span className="text-sm font-bold text-white">
                      Total: {formatCurrency(valorTotal || 0)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
