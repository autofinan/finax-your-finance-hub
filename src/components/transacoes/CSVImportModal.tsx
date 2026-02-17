import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { CATEGORIAS } from '@/types/finance';
import { motion } from 'framer-motion';

interface CSVImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usuarioId: string;
  onSuccess: () => void;
}

interface ParsedRow {
  data: string;
  descricao: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  categoria: string;
  valid: boolean;
  error?: string;
}

export function CSVImportModal({ open, onOpenChange, usuarioId, onSuccess }: CSVImportModalProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const reset = () => {
    setRows([]);
    setDone(false);
    setImportedCount(0);
  };

  const parseCSV = (text: string) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return;

    // Detect separator
    const sep = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].toLowerCase().split(sep).map(h => h.trim().replace(/"/g, ''));

    // Find column indices
    const iData = header.findIndex(h => ['data', 'date'].includes(h));
    const iDesc = header.findIndex(h => ['descricao', 'descrição', 'description', 'observacao', 'observação'].includes(h));
    const iValor = header.findIndex(h => ['valor', 'value', 'amount'].includes(h));
    const iTipo = header.findIndex(h => ['tipo', 'type'].includes(h));
    const iCat = header.findIndex(h => ['categoria', 'category'].includes(h));

    if (iData === -1 || iValor === -1) {
      toast({ title: 'CSV inválido', description: 'Colunas obrigatórias: data, valor', variant: 'destructive' });
      return;
    }

    const parsed: ParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 2 || cols.every(c => !c)) continue;

      const rawData = cols[iData] || '';
      const rawValor = cols[iValor] || '0';
      const rawDesc = iDesc >= 0 ? cols[iDesc] || '' : '';
      const rawTipo = iTipo >= 0 ? cols[iTipo]?.toLowerCase() || '' : '';
      const rawCat = iCat >= 0 ? cols[iCat]?.toLowerCase() || '' : '';

      // Parse date (DD/MM/YYYY or YYYY-MM-DD)
      let parsedDate = '';
      if (rawData.includes('/')) {
        const parts = rawData.split('/');
        if (parts.length === 3) {
          parsedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      } else {
        parsedDate = rawData;
      }

      // Parse value
      const cleanVal = rawValor.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
      const valor = Math.abs(parseFloat(cleanVal));

      // Detect tipo
      let tipo: 'entrada' | 'saida' = 'saida';
      if (rawTipo.includes('entrada') || rawTipo.includes('receita') || rawTipo.includes('income')) {
        tipo = 'entrada';
      } else if (parseFloat(cleanVal) > 0 && !rawTipo) {
        // Positive values without explicit type might be income (bank convention)
      }
      if (rawTipo.includes('saida') || rawTipo.includes('despesa') || rawTipo.includes('expense')) {
        tipo = 'saida';
      }

      // Match category
      let categoria = 'outros';
      const matchedCat = CATEGORIAS.find(c =>
        c.value === rawCat || c.label.toLowerCase() === rawCat
      );
      if (matchedCat) categoria = matchedCat.value;

      const valid = !isNaN(valor) && valor > 0 && !!parsedDate && parsedDate.match(/^\d{4}-\d{2}-\d{2}$/) !== null;

      parsed.push({
        data: parsedDate,
        descricao: rawDesc || rawCat || 'Importado CSV',
        valor,
        tipo,
        categoria,
        valid,
        error: !valid ? 'Data ou valor inválido' : undefined,
      });
    }

    setRows(parsed);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImport = async () => {
    const validRows = rows.filter(r => r.valid);
    if (validRows.length === 0) return;

    setImporting(true);
    try {
      const inserts = validRows.map(r => ({
        usuario_id: usuarioId,
        data: r.data,
        valor: r.valor,
        tipo: r.tipo,
        categoria: r.categoria,
        observacao: r.descricao,
        origem: 'csv_import',
        status: 'confirmada',
      }));

      const { error } = await supabase.from('transacoes').insert(inserts);
      if (error) throw error;

      setImportedCount(validRows.length);
      setDone(true);
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Erro na importação', description: err.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const validCount = rows.filter(r => r.valid).length;
  const invalidCount = rows.filter(r => !r.valid).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-700 text-white max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
            Importar Extrato CSV
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="py-8 flex flex-col items-center gap-3">
            <CheckCircle2 className="w-16 h-16 text-emerald-400" />
            <p className="text-lg font-bold text-white">{importedCount} transações importadas!</p>
            <Button onClick={() => { reset(); onOpenChange(false); }} variant="outline" className="border-slate-700 text-slate-300">
              Fechar
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {/* Instructions */}
            <div className="p-4 rounded-xl bg-slate-800/40 border border-white/5 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Formato esperado (CSV)</p>
              <p className="text-xs text-slate-500">Colunas: <code className="text-indigo-400">data</code>, <code className="text-indigo-400">valor</code> (obrigatórias), descricao, tipo, categoria</p>
              <p className="text-xs text-slate-500">Separador: vírgula ou ponto-e-vírgula. Datas: DD/MM/YYYY ou YYYY-MM-DD</p>
              <div className="mt-2 p-2 bg-slate-950/50 rounded-lg font-mono text-xs text-slate-400">
                data;descricao;valor;tipo;categoria<br/>
                15/01/2026;Supermercado;150,00;saida;alimentacao<br/>
                01/01/2026;Salário;5000;entrada;salario
              </div>
            </div>

            {/* File Input */}
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-indigo-500/50 rounded-xl p-8 text-center cursor-pointer transition-colors"
            >
              <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Clique para selecionar arquivo .csv</p>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
            </div>

            {/* Preview */}
            {rows.length > 0 && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-emerald-400 font-bold">{validCount} válidas</span>
                  {invalidCount > 0 && <span className="text-red-400 font-bold">{invalidCount} com erro</span>}
                </div>

                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800 sticky top-0">
                      <tr>
                        <th className="p-2 text-left text-slate-400">Data</th>
                        <th className="p-2 text-left text-slate-400">Descrição</th>
                        <th className="p-2 text-right text-slate-400">Valor</th>
                        <th className="p-2 text-center text-slate-400">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 20).map((r, i) => (
                        <tr key={i} className={cn("border-t border-slate-800", !r.valid && "opacity-50")}>
                          <td className="p-2 text-slate-300">{r.data}</td>
                          <td className="p-2 text-slate-300 truncate max-w-[120px]">{r.descricao}</td>
                          <td className="p-2 text-right font-mono text-white">{r.valor.toFixed(2)}</td>
                          <td className={cn("p-2 text-center", r.tipo === 'entrada' ? 'text-emerald-400' : 'text-red-400')}>
                            {r.tipo === 'entrada' ? '↑' : '↓'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 20 && (
                    <p className="text-xs text-slate-500 p-2 text-center">+{rows.length - 20} linhas...</p>
                  )}
                </div>

                <Button
                  onClick={handleImport}
                  disabled={importing || validCount === 0}
                  className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:opacity-90"
                >
                  {importing ? 'Importando...' : `Importar ${validCount} transações`}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
