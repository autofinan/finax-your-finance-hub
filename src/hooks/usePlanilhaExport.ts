import { useCallback } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';
import { CATEGORIAS } from '@/types/finance';
import {
  FINAX_COLORS,
  CELL_STYLES,
  COLUMN_WIDTHS,
} from '@/utils/excelStyles';

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

interface Transacao {
  data: string;
  tipo: 'entrada' | 'saida';
  valor: number;
  categoria: string;
  observacao?: string;
  formaPagamento?: string;
  forma_pagamento?: string;
  cartao?: string;
}

interface ExportData {
  startDate: Date;
  endDate: Date;
  transacoes: Transacao[];
  usuario: { nome: string } | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAPEAMENTO DE CATEGORIAS PARA GRUPOS FINANCEIROS
// ═══════════════════════════════════════════════════════════════════════════

const GRUPO_CATEGORIAS: Record<string, string> = {
  moradia: 'Necessidades Básicas',
  alimentacao: 'Necessidades Básicas',
  transporte: 'Necessidades Básicas',
  saude: 'Necessidades Básicas',
  educacao_basica: 'Necessidades Básicas',
  servicos: 'Necessidades Básicas',
  contas: 'Necessidades Básicas',
  lazer: 'Lazer',
  restaurante: 'Lazer',
  viagem: 'Lazer',
  assinaturas: 'Lazer',
  entretenimento: 'Lazer',
  compras: 'Lazer',
  investimento: 'Investimentos',
  poupanca: 'Investimentos',
  reserva: 'Investimentos',
  outros: 'Outros',
};

const GRUPOS_ORDEM = ['Necessidades Básicas', 'Lazer', 'Investimentos', 'Outros'];

const PERCENTUAIS_ORCAMENTO: Record<string, number> = {
  'Necessidades Básicas': 0.50,
  'Lazer': 0.30,
  'Investimentos': 0.20,
  'Outros': 0,
};

function getGrupo(categoriaValue: string): string {
  const lower = categoriaValue?.toLowerCase() || '';
  for (const [key, grupo] of Object.entries(GRUPO_CATEGORIAS)) {
    if (lower.includes(key)) return grupo;
  }
  return 'Outros';
}

function getCategoriaLabel(value: string): string {
  return CATEGORIAS.find((c) => c.value === value)?.label || value;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK: usePlanilhaExport
// ═══════════════════════════════════════════════════════════════════════════

export function usePlanilhaExport() {
  
  // ─── Aplicar estilo a uma célula ────────────────────────────────────────
  const applyStyle = useCallback((cell: ExcelJS.Cell, style: any) => {
    if (style.font) {
      cell.font = {
        name: style.font.name,
        size: style.font.size,
        bold: style.font.bold,
        italic: style.font.italic,
        color: style.font.color ? { argb: style.font.color } : undefined,
      };
    }
    if (style.alignment) cell.alignment = style.alignment;
    if (style.fill) cell.fill = style.fill;
    if (style.border) cell.border = style.border;
    if (style.numFmt) cell.numFmt = style.numFmt;
  }, []);

  // ─── Criar aba de RESUMO ────────────────────────────────────────────────
  const criarAbaResumo = useCallback((
    workbook: ExcelJS.Workbook,
    data: ExportData,
    entradas: Transacao[],
    saidas: Transacao[],
    totalEnt: number,
    totalSai: number,
    porGrupo: Record<string, number>,
    porCat: Record<string, { valor: number; grupo: string }>
  ) => {
    const sheet = workbook.addWorksheet('📊 Resumo', {
      views: [{ showGridLines: false }],
    });

    let row = 1;

    // ── Título ──
    sheet.mergeCells(`A${row}:F${row}`);
    const titleCell = sheet.getCell(`A${row}`);
    titleCell.value = 'RELATÓRIO FINANCEIRO';
    applyStyle(titleCell, CELL_STYLES.title);
    row++;

    sheet.mergeCells(`A${row}:F${row}`);
    const subtitleCell = sheet.getCell(`A${row}`);
    subtitleCell.value = 'Gerado pelo FINAX — Seu Assistente Financeiro';
    applyStyle(subtitleCell, { ...CELL_STYLES.note, alignment: { horizontal: 'center', vertical: 'middle' } });
    row += 2;

    // ── Informações do relatório ──
    const infoRows = [
      ['Usuário:', data.usuario?.nome || 'Usuário'],
      ['Período:', `${format(data.startDate, 'dd/MM/yyyy')} a ${format(data.endDate, 'dd/MM/yyyy')}`],
      ['Gerado em:', format(new Date(), "dd/MM/yyyy 'às' HH:mm")],
    ];

    infoRows.forEach(([label, value]) => {
      sheet.getCell(`A${row}`).value = label;
      applyStyle(sheet.getCell(`A${row}`), { font: { ...CELL_STYLES.dataRow.font, bold: true } });
      sheet.getCell(`B${row}`).value = value;
      applyStyle(sheet.getCell(`B${row}`), CELL_STYLES.dataRow);
      row++;
    });
    row++;

    // ── SEÇÃO: RESUMO DO PERÍODO ──
    sheet.mergeCells(`A${row}:F${row}`);
    const sectionCell = sheet.getCell(`A${row}`);
    sectionCell.value = '═══ RESUMO DO PERÍODO ═══';
    applyStyle(sectionCell, CELL_STYLES.sectionHeader);
    row++;

    // Headers
    ['', 'Valor (R$)', 'Participação'].forEach((header, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = header;
      applyStyle(cell, CELL_STYLES.tableHeader);
    });
    row++;

    // Dados do resumo
    const saldoLabel = totalEnt - totalSai >= 0 ? 'POSITIVO ✓' : 'NEGATIVO ✗';
    const resumoRows = [
      ['Total de Receitas', totalEnt, '100%'],
      ['Total de Despesas', totalSai, totalEnt > 0 ? `${((totalSai / totalEnt) * 100).toFixed(1)}%` : '0%'],
      ['Saldo do Período', totalEnt - totalSai, saldoLabel],
      ['Total de Transações', `${entradas.length + saidas.length}`, `${entradas.length} receitas / ${saidas.length} despesas`],
    ];

    resumoRows.forEach(([label, valor, extra], idx) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = typeof valor === 'number' ? valor : valor;
      sheet.getCell(row, 3).value = extra;
      
      const isZebra = idx % 2 === 0;
      applyStyle(sheet.getCell(row, 1), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      
      if (typeof valor === 'number') {
        const valCell = sheet.getCell(row, 2);
        if (label.includes('Receitas')) {
          applyStyle(valCell, CELL_STYLES.currencyPositive);
        } else if (label.includes('Despesas')) {
          applyStyle(valCell, CELL_STYLES.currencyNegative);
        } else {
          applyStyle(valCell, valor >= 0 ? CELL_STYLES.currencyPositive : CELL_STYLES.currencyNegative);
        }
      } else {
        applyStyle(sheet.getCell(row, 2), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      }
      
      applyStyle(sheet.getCell(row, 3), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      row++;
    });
    row++;

    // ── SEÇÃO: DESPESAS POR GRUPO ──
    sheet.mergeCells(`A${row}:F${row}`);
    const grupoSectionCell = sheet.getCell(`A${row}`);
    grupoSectionCell.value = '═══ DESPESAS POR GRUPO FINANCEIRO ═══';
    applyStyle(grupoSectionCell, CELL_STYLES.sectionHeader);
    row++;

    ['Grupo', 'Total Gasto (R$)', '% das Despesas'].forEach((header, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = header;
      applyStyle(cell, CELL_STYLES.tableHeader);
    });
    row++;

    GRUPOS_ORDEM.filter(g => porGrupo[g] > 0).forEach((grupo, idx) => {
      const valor = porGrupo[grupo];
      sheet.getCell(row, 1).value = grupo;
      sheet.getCell(row, 2).value = valor;
      sheet.getCell(row, 3).value = totalSai > 0 ? (valor / totalSai) : 0;

      const isZebra = idx % 2 === 0;
      applyStyle(sheet.getCell(row, 1), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      applyStyle(sheet.getCell(row, 2), { ...CELL_STYLES.currency, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
      applyStyle(sheet.getCell(row, 3), { ...CELL_STYLES.percent, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
      row++;
    });
    row++;

    // ── SEÇÃO: DESPESAS POR CATEGORIA ──
    sheet.mergeCells(`A${row}:F${row}`);
    const catSectionCell = sheet.getCell(`A${row}`);
    catSectionCell.value = '═══ DESPESAS POR CATEGORIA ═══';
    applyStyle(catSectionCell, CELL_STYLES.sectionHeader);
    row++;

    ['Categoria', 'Grupo', 'Total Gasto (R$)', '% das Despesas'].forEach((header, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = header;
      applyStyle(cell, CELL_STYLES.tableHeader);
    });
    row++;

    Object.entries(porCat)
      .sort((a, b) => b[1].valor - a[1].valor)
      .forEach(([cat, { valor, grupo }], idx) => {
        sheet.getCell(row, 1).value = cat;
        sheet.getCell(row, 2).value = grupo;
        sheet.getCell(row, 3).value = valor;
        sheet.getCell(row, 4).value = totalSai > 0 ? (valor / totalSai) : 0;

        const isZebra = idx % 2 === 0;
        [1, 2].forEach(col => applyStyle(sheet.getCell(row, col), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt));
        applyStyle(sheet.getCell(row, 3), { ...CELL_STYLES.currency, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
        applyStyle(sheet.getCell(row, 4), { ...CELL_STYLES.percent, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
        row++;
      });

    // Larguras de colunas
    sheet.getColumn(1).width = COLUMN_WIDTHS.description;
    sheet.getColumn(2).width = COLUMN_WIDTHS.group;
    sheet.getColumn(3).width = COLUMN_WIDTHS.currency;
    sheet.getColumn(4).width = COLUMN_WIDTHS.percent;
  }, [applyStyle]);

  // ─── Criar aba de TRANSAÇÕES ────────────────────────────────────────────
  const criarAbaTransacoes = useCallback((
    workbook: ExcelJS.Workbook,
    filtered: Transacao[],
    totalEnt: number,
    totalSai: number
  ) => {
    const sheet = workbook.addWorksheet('📋 Transações', {
      views: [{ showGridLines: false }],
    });

    const headers = ['Data', 'Descrição', 'Categoria', 'Grupo Financeiro', 'Tipo', 'Valor (R$)', 'Forma Pgto', 'Cartão'];
    
    headers.forEach((header, i) => {
      const cell = sheet.getCell(1, i + 1);
      cell.value = header;
      applyStyle(cell, CELL_STYLES.tableHeader);
    });

    const sortedTx = [...filtered].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    sortedTx.forEach((t, idx) => {
      const row = idx + 2;
      const isZebra = idx % 2 === 0;

      sheet.getCell(row, 1).value = format(new Date(t.data), 'dd/MM/yyyy');
      sheet.getCell(row, 2).value = t.observacao || getCategoriaLabel(t.categoria);
      sheet.getCell(row, 3).value = getCategoriaLabel(t.categoria);
      sheet.getCell(row, 4).value = t.tipo === 'saida' ? getGrupo(t.categoria) : 'Receita';
      sheet.getCell(row, 5).value = t.tipo === 'entrada' ? 'Receita' : 'Despesa';
      sheet.getCell(row, 6).value = Number(t.valor);
      sheet.getCell(row, 7).value = t.formaPagamento || t.forma_pagamento || '';
      sheet.getCell(row, 8).value = t.cartao || '';

      [1, 2, 3, 4, 5, 7, 8].forEach(col => {
        applyStyle(sheet.getCell(row, col), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      });

      const valCell = sheet.getCell(row, 6);
      if (t.tipo === 'entrada') {
        applyStyle(valCell, { ...CELL_STYLES.currencyPositive, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
      } else {
        applyStyle(valCell, { ...CELL_STYLES.currencyNegative, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
      }
    });

    // Linha de total
    const totalRow = sortedTx.length + 3;
    sheet.getCell(totalRow, 5).value = 'TOTAIS →';
    sheet.getCell(totalRow, 6).value = totalEnt - totalSai;
    [5, 6].forEach(col => applyStyle(sheet.getCell(totalRow, col), CELL_STYLES.totalRow));

    // Larguras
    sheet.getColumn(1).width = COLUMN_WIDTHS.date;
    sheet.getColumn(2).width = COLUMN_WIDTHS.description;
    sheet.getColumn(3).width = COLUMN_WIDTHS.category;
    sheet.getColumn(4).width = COLUMN_WIDTHS.group;
    sheet.getColumn(5).width = COLUMN_WIDTHS.type;
    sheet.getColumn(6).width = COLUMN_WIDTHS.currency;
    sheet.getColumn(7).width = COLUMN_WIDTHS.payment;
    sheet.getColumn(8).width = COLUMN_WIDTHS.card;
  }, [applyStyle]);

  // ─── Criar aba de RECEITAS ──────────────────────────────────────────────
  const criarAbaReceitas = useCallback((
    workbook: ExcelJS.Workbook,
    entradas: Transacao[],
    totalEnt: number
  ) => {
    const sheet = workbook.addWorksheet('💰 Receitas', {
      views: [{ showGridLines: false }],
    });

    const headers = ['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Forma Pgto', 'Cartão'];
    
    headers.forEach((header, i) => {
      const cell = sheet.getCell(1, i + 1);
      cell.value = header;
      applyStyle(cell, CELL_STYLES.tableHeader);
    });

    const sortedEnt = [...entradas].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    sortedEnt.forEach((t, idx) => {
      const row = idx + 2;
      const isZebra = idx % 2 === 0;

      sheet.getCell(row, 1).value = format(new Date(t.data), 'dd/MM/yyyy');
      sheet.getCell(row, 2).value = t.observacao || getCategoriaLabel(t.categoria);
      sheet.getCell(row, 3).value = getCategoriaLabel(t.categoria);
      sheet.getCell(row, 4).value = Number(t.valor);
      sheet.getCell(row, 5).value = t.formaPagamento || t.forma_pagamento || '';
      sheet.getCell(row, 6).value = t.cartao || '';

      [1, 2, 3, 5, 6].forEach(col => {
        applyStyle(sheet.getCell(row, col), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      });

      applyStyle(sheet.getCell(row, 4), { ...CELL_STYLES.currencyPositive, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
    });

    // Total
    const totalRow = sortedEnt.length + 3;
    sheet.getCell(totalRow, 3).value = 'TOTAL DE RECEITAS';
    sheet.getCell(totalRow, 4).value = totalEnt;
    [3, 4].forEach(col => applyStyle(sheet.getCell(totalRow, col), CELL_STYLES.totalRow));

    // Larguras
    sheet.getColumn(1).width = COLUMN_WIDTHS.date;
    sheet.getColumn(2).width = COLUMN_WIDTHS.description;
    sheet.getColumn(3).width = COLUMN_WIDTHS.category;
    sheet.getColumn(4).width = COLUMN_WIDTHS.currency;
    sheet.getColumn(5).width = COLUMN_WIDTHS.payment;
    sheet.getColumn(6).width = COLUMN_WIDTHS.card;
  }, [applyStyle]);

  // ─── Criar aba de DESPESAS ──────────────────────────────────────────────
  const criarAbaDespesas = useCallback((
    workbook: ExcelJS.Workbook,
    saidas: Transacao[],
    totalSai: number
  ) => {
    const sheet = workbook.addWorksheet('💸 Despesas', {
      views: [{ showGridLines: false }],
    });

    const headers = ['Data', 'Descrição', 'Categoria', 'Grupo Financeiro', 'Valor (R$)', 'Forma Pgto', 'Cartão'];
    
    headers.forEach((header, i) => {
      const cell = sheet.getCell(1, i + 1);
      cell.value = header;
      applyStyle(cell, CELL_STYLES.tableHeader);
    });

    const sortedSai = [...saidas].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    sortedSai.forEach((t, idx) => {
      const row = idx + 2;
      const isZebra = idx % 2 === 0;

      sheet.getCell(row, 1).value = format(new Date(t.data), 'dd/MM/yyyy');
      sheet.getCell(row, 2).value = t.observacao || getCategoriaLabel(t.categoria);
      sheet.getCell(row, 3).value = getCategoriaLabel(t.categoria);
      sheet.getCell(row, 4).value = getGrupo(t.categoria);
      sheet.getCell(row, 5).value = Number(t.valor);
      sheet.getCell(row, 6).value = t.formaPagamento || t.forma_pagamento || '';
      sheet.getCell(row, 7).value = t.cartao || '';

      [1, 2, 3, 4, 6, 7].forEach(col => {
        applyStyle(sheet.getCell(row, col), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      });

      applyStyle(sheet.getCell(row, 5), { ...CELL_STYLES.currencyNegative, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
    });

    // Total
    const totalRow = sortedSai.length + 3;
    sheet.getCell(totalRow, 4).value = 'TOTAL DE DESPESAS';
    sheet.getCell(totalRow, 5).value = totalSai;
    [4, 5].forEach(col => applyStyle(sheet.getCell(totalRow, col), CELL_STYLES.totalRow));

    // Larguras
    sheet.getColumn(1).width = COLUMN_WIDTHS.date;
    sheet.getColumn(2).width = COLUMN_WIDTHS.description;
    sheet.getColumn(3).width = COLUMN_WIDTHS.category;
    sheet.getColumn(4).width = COLUMN_WIDTHS.group;
    sheet.getColumn(5).width = COLUMN_WIDTHS.currency;
    sheet.getColumn(6).width = COLUMN_WIDTHS.payment;
    sheet.getColumn(7).width = COLUMN_WIDTHS.card;
  }, [applyStyle]);

  // ─── Criar aba de ORÇAMENTO ─────────────────────────────────────────────
  const criarAbaOrcamento = useCallback((
    workbook: ExcelJS.Workbook,
    totalEnt: number,
    porGrupo: Record<string, number>
  ) => {
    const sheet = workbook.addWorksheet('🎯 Orçamento', {
      views: [{ showGridLines: false }],
    });

    let row = 1;

    // Título
    sheet.mergeCells(`A${row}:F${row}`);
    const titleCell = sheet.getCell(`A${row}`);
    titleCell.value = 'ACOMPANHAMENTO DE ORÇAMENTO';
    applyStyle(titleCell, CELL_STYLES.sectionHeader);
    row++;

    sheet.mergeCells(`A${row}:F${row}`);
    const subtitleCell = sheet.getCell(`A${row}`);
    subtitleCell.value = `Baseado na Regra 50/30/20 | Receita do período: R$ ${totalEnt.toFixed(2)}`;
    applyStyle(subtitleCell, CELL_STYLES.note);
    row += 2;

    // Headers
    const headers = ['Grupo Financeiro', 'Planejado (%)', 'Planejado (R$)', 'Gasto Real (R$)', 'Disponível (R$)', 'Status'];
    headers.forEach((header, i) => {
      const cell = sheet.getCell(row, i + 1);
      cell.value = header;
      applyStyle(cell, CELL_STYLES.tableHeader);
    });
    row++;

    GRUPOS_ORDEM.forEach((grupo, idx) => {
      const perc = PERCENTUAIS_ORCAMENTO[grupo] || 0;
      const planejado = totalEnt * perc;
      const gasto = porGrupo[grupo] || 0;
      const disponivel = planejado - gasto;
      const status = grupo === 'Outros' ? '—'
        : disponivel >= 0 ? '✓ Dentro do orçamento'
        : `✗ Excedido em R$ ${Math.abs(disponivel).toFixed(2)}`;

      const isZebra = idx % 2 === 0;

      sheet.getCell(row, 1).value = grupo;
      sheet.getCell(row, 2).value = perc > 0 ? perc : '—';
      sheet.getCell(row, 3).value = perc > 0 ? planejado : '—';
      sheet.getCell(row, 4).value = gasto;
      sheet.getCell(row, 5).value = perc > 0 ? disponivel : '—';
      sheet.getCell(row, 6).value = status;

      applyStyle(sheet.getCell(row, 1), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);

      if (perc > 0) {
        applyStyle(sheet.getCell(row, 2), { ...CELL_STYLES.percent, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
        applyStyle(sheet.getCell(row, 3), { ...CELL_STYLES.currency, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
      } else {
        [2, 3].forEach(col => applyStyle(sheet.getCell(row, col), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt));
      }

      applyStyle(sheet.getCell(row, 4), { ...CELL_STYLES.currency, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });

      if (perc > 0) {
        const dispCell = sheet.getCell(row, 5);
        if (disponivel >= 0) {
          applyStyle(dispCell, { ...CELL_STYLES.currencyPositive, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
        } else {
          applyStyle(dispCell, { ...CELL_STYLES.currencyNegative, fill: isZebra ? undefined : CELL_STYLES.dataRowAlt.fill });
        }
      } else {
        applyStyle(sheet.getCell(row, 5), isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      }

      const statusCell = sheet.getCell(row, 6);
      if (grupo === 'Outros') {
        applyStyle(statusCell, isZebra ? CELL_STYLES.dataRow : CELL_STYLES.dataRowAlt);
      } else if (disponivel >= 0) {
        applyStyle(statusCell, CELL_STYLES.statusPositive);
      } else {
        applyStyle(statusCell, CELL_STYLES.statusNegative);
      }

      row++;
    });

    row++;

    // Notas
    const notas = [
      '* Necessidades Básicas: moradia, alimentação, transporte, saúde',
      '* Lazer: restaurantes, assinaturas, entretenimento, compras',
      '* Investimentos: poupança, reserva de emergência, aplicações',
    ];

    notas.forEach(nota => {
      sheet.mergeCells(`A${row}:F${row}`);
      const noteCell = sheet.getCell(`A${row}`);
      noteCell.value = nota;
      applyStyle(noteCell, CELL_STYLES.note);
      row++;
    });

    // Larguras
    sheet.getColumn(1).width = 25;
    sheet.getColumn(2).width = 15;
    sheet.getColumn(3).width = COLUMN_WIDTHS.currency;
    sheet.getColumn(4).width = COLUMN_WIDTHS.currency;
    sheet.getColumn(5).width = COLUMN_WIDTHS.currency;
    sheet.getColumn(6).width = COLUMN_WIDTHS.status;
  }, [applyStyle]);

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNÇÃO PRINCIPAL DE EXPORTAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════

  const exportarPlanilha = useCallback(async (data: ExportData) => {
    const { startDate, endDate, transacoes, usuario } = data;

    const entradas = transacoes.filter(t => t.tipo === 'entrada');
    const saidas = transacoes.filter(t => t.tipo === 'saida');
    const totalEnt = entradas.reduce((s, t) => s + Number(t.valor), 0);
    const totalSai = saidas.reduce((s, t) => s + Number(t.valor), 0);

    // Agregar por categoria
    const porCat: Record<string, { valor: number; grupo: string }> = {};
    saidas.forEach(t => {
      const cat = getCategoriaLabel(t.categoria);
      const grupo = getGrupo(t.categoria);
      if (!porCat[cat]) porCat[cat] = { valor: 0, grupo };
      porCat[cat].valor += Number(t.valor);
    });

    // Agregar por grupo
    const porGrupo: Record<string, number> = {};
    GRUPOS_ORDEM.forEach(g => { porGrupo[g] = 0; });
    Object.values(porCat).forEach(({ valor, grupo }) => {
      porGrupo[grupo] = (porGrupo[grupo] || 0) + valor;
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FINAX - Assistente Financeiro';
    workbook.created = new Date();

    criarAbaResumo(workbook, data, entradas, saidas, totalEnt, totalSai, porGrupo, porCat);
    criarAbaTransacoes(workbook, transacoes, totalEnt, totalSai);
    criarAbaReceitas(workbook, entradas, totalEnt);
    criarAbaDespesas(workbook, saidas, totalSai);
    criarAbaOrcamento(workbook, totalEnt, porGrupo);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fileName = `Finax_Relatorio_${format(startDate, 'yyyy-MM-dd')}_a_${format(endDate, 'yyyy-MM-dd')}.xlsx`;
    
    saveAs(blob, fileName);
  }, [criarAbaResumo, criarAbaTransacoes, criarAbaReceitas, criarAbaDespesas, criarAbaOrcamento]);

  return { exportarPlanilha };
}
