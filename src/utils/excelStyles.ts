// ═══════════════════════════════════════════════════════════════════════════
// FINAX - Estilos para Exportação de Planilhas Excel
// Cores, bordas, fontes e formatações profissionais
// ═══════════════════════════════════════════════════════════════════════════

export const FINAX_COLORS = {
  // Paleta principal (tons de slate/indigo do app)
  primary: '6366F1',      // Indigo 500
  primaryLight: '818CF8', // Indigo 400
  primaryDark: '4F46E5',  // Indigo 600
  
  // Tons de fundo
  bgDark: '0F172A',       // Slate 950
  bgMedium: '1E293B',     // Slate 900
  bgLight: 'F1F5F9',      // Slate 100
  
  // Status/Feedback
  success: '22C55E',      // Green 500
  successLight: 'DCFCE7', // Green 100
  danger: 'EF4444',       // Red 500
  dangerLight: 'FEE2E2',  // Red 100
  warning: 'F59E0B',      // Amber 500
  warningLight: 'FEF3C7', // Amber 100
  info: '3B82F6',         // Blue 500
  infoLight: 'DBEAFE',    // Blue 100
  
  // Neutros
  white: 'FFFFFF',
  gray: '64748B',         // Slate 500
  grayLight: 'E2E8F0',    // Slate 200
  grayDark: '334155',     // Slate 700
  black: '000000',
} as const;

export const FINAX_FONTS = {
  header: {
    name: 'Segoe UI',
    size: 14,
    bold: true,
    color: FINAX_COLORS.white,
  },
  subheader: {
    name: 'Segoe UI',
    size: 12,
    bold: true,
    color: FINAX_COLORS.grayDark,
  },
  body: {
    name: 'Segoe UI',
    size: 10,
    bold: false,
    color: FINAX_COLORS.black,
  },
  bodyBold: {
    name: 'Segoe UI',
    size: 10,
    bold: true,
    color: FINAX_COLORS.black,
  },
  small: {
    name: 'Segoe UI',
    size: 9,
    bold: false,
    color: FINAX_COLORS.gray,
  },
  title: {
    name: 'Segoe UI',
    size: 18,
    bold: true,
    color: FINAX_COLORS.primary,
  },
} as const;

export const FINAX_BORDERS = {
  thin: {
    style: 'thin' as const,
    color: { argb: FINAX_COLORS.grayLight },
  },
  medium: {
    style: 'medium' as const,
    color: { argb: FINAX_COLORS.gray },
  },
  thick: {
    style: 'thick' as const,
    color: { argb: FINAX_COLORS.primary },
  },
} as const;

export const FINAX_ALIGNMENTS = {
  left: {
    horizontal: 'left' as const,
    vertical: 'middle' as const,
  },
  center: {
    horizontal: 'center' as const,
    vertical: 'middle' as const,
  },
  right: {
    horizontal: 'right' as const,
    vertical: 'middle' as const,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// ESTILOS PRÉ-DEFINIDOS PARA CÉLULAS
// ═══════════════════════════════════════════════════════════════════════════

export const CELL_STYLES = {
  // Cabeçalho principal (título da planilha)
  title: {
    font: { ...FINAX_FONTS.title },
    alignment: FINAX_ALIGNMENTS.center,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.white },
    },
  },
  
  // Cabeçalho de seção (ex: "═══ RESUMO DO PERÍODO ═══")
  sectionHeader: {
    font: { ...FINAX_FONTS.subheader, color: FINAX_COLORS.white },
    alignment: FINAX_ALIGNMENTS.left,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.primary },
    },
    border: {
      top: FINAX_BORDERS.medium,
      bottom: FINAX_BORDERS.medium,
      left: FINAX_BORDERS.medium,
      right: FINAX_BORDERS.medium,
    },
  },
  
  // Cabeçalho de tabela (colunas)
  tableHeader: {
    font: { ...FINAX_FONTS.bodyBold, color: FINAX_COLORS.white },
    alignment: FINAX_ALIGNMENTS.center,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.grayDark },
    },
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Linha de dados padrão
  dataRow: {
    font: FINAX_FONTS.body,
    alignment: FINAX_ALIGNMENTS.left,
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Linha de dados alternada (zebra)
  dataRowAlt: {
    font: FINAX_FONTS.body,
    alignment: FINAX_ALIGNMENTS.left,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.bgLight },
    },
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Linha de total/subtotal
  totalRow: {
    font: { ...FINAX_FONTS.bodyBold, size: 11 },
    alignment: FINAX_ALIGNMENTS.right,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.grayLight },
    },
    border: {
      top: FINAX_BORDERS.medium,
      bottom: FINAX_BORDERS.medium,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Valor monetário positivo (receita)
  currencyPositive: {
    font: { ...FINAX_FONTS.body, color: FINAX_COLORS.success },
    alignment: FINAX_ALIGNMENTS.right,
    numFmt: 'R$ #,##0.00',
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Valor monetário negativo (despesa)
  currencyNegative: {
    font: { ...FINAX_FONTS.body, color: FINAX_COLORS.danger },
    alignment: FINAX_ALIGNMENTS.right,
    numFmt: 'R$ #,##0.00',
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Valor monetário neutro
  currency: {
    font: FINAX_FONTS.body,
    alignment: FINAX_ALIGNMENTS.right,
    numFmt: 'R$ #,##0.00',
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Percentual
  percent: {
    font: FINAX_FONTS.body,
    alignment: FINAX_ALIGNMENTS.center,
    numFmt: '0.0%',
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Status positivo (dentro do orçamento)
  statusPositive: {
    font: { ...FINAX_FONTS.body, color: FINAX_COLORS.success, bold: true },
    alignment: FINAX_ALIGNMENTS.center,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.successLight },
    },
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Status negativo (excedeu orçamento)
  statusNegative: {
    font: { ...FINAX_FONTS.body, color: FINAX_COLORS.danger, bold: true },
    alignment: FINAX_ALIGNMENTS.center,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.dangerLight },
    },
    border: {
      top: FINAX_BORDERS.thin,
      bottom: FINAX_BORDERS.thin,
      left: FINAX_BORDERS.thin,
      right: FINAX_BORDERS.thin,
    },
  },
  
  // Nota/observação
  note: {
    font: { ...FINAX_FONTS.small, italic: true },
    alignment: FINAX_ALIGNMENTS.left,
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: FINAX_COLORS.warningLight },
    },
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// LARGURAS DE COLUNAS PADRÃO
// ═══════════════════════════════════════════════════════════════════════════

export const COLUMN_WIDTHS = {
  date: 12,
  description: 35,
  category: 20,
  group: 22,
  type: 10,
  currency: 16,
  payment: 14,
  card: 18,
  status: 30,
  percent: 12,
} as const;
