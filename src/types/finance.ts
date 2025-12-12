// ==================== ENTIDADES PRINCIPAIS ====================

export interface Usuario {
  id: string;
  created_at: string;
  updated_at: string;
  phone_number: string;
  nome: string | null;
  plano: string | null;
  ativo: boolean;
  saldo_mensal: number | null;
  limite_transacoes_mes: number | null;
  ultimo_resumo: string | null;
}

export interface Transacao {
  id: string;
  usuario_id: string | null;
  data: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  categoria: string;
  observacao: string | null;
  recorrente: boolean | null;
  parcela: string | null;
  parcelamento_id: string | null;
  fatura_id: string | null;
  essencial: boolean | null;
  merchant: string | null;
  origem: string | null;
  hash_unico: string | null;
  created_at: string;
  atualizado_em: string | null;
}

export interface GastoRecorrente {
  id: string;
  usuario_id: string | null;
  descricao: string | null;
  categoria: string;
  categoria_detalhada: string | null;
  tipo_recorrencia: string;
  valor_parcela: number;
  valor_total: number | null;
  dia_mes: number | null;
  dia_semana: string | null;
  num_parcelas: number | null;
  parcela_atual: number | null;
  ativo: boolean | null;
  proxima_execucao: string | null;
  ultima_execucao: string | null;
  origem: string | null;
  created_at: string;
  updated_at: string;
}

export interface CartaoCredito {
  id: string;
  usuario_id: string | null;
  nome: string | null;
  limite_total: number | null;
  limite_disponivel: number | null;
  dia_fechamento: number | null;
  dia_vencimento: number | null;
  created_at: string;
}

export interface FaturaCartao {
  id: string;
  usuario_id: string | null;
  cartao_id: string | null;
  mes: number | null;
  ano: number | null;
  valor_total: number | null;
  valor_pago: number | null;
  status: string | null;
  created_at: string;
}

export interface Parcelamento {
  id: string;
  usuario_id: string | null;
  descricao: string | null;
  valor_total: number | null;
  num_parcelas: number | null;
  parcela_atual: number | null;
  valor_parcela: number | null;
  ativa: boolean | null;
  created_at: string;
}

export interface Categoria {
  id: string;
  usuario_id: string | null;
  nome: string;
  tipo: string;
  created_at: string;
  updated_at: string;
}

export interface ResumoMensal {
  id: string;
  usuario_id: string | null;
  mes: number | null;
  ano: number | null;
  total_gastos: number | null;
  total_essenciais: number | null;
  total_fixos: number | null;
  total_cartao: number | null;
  total_lazer: number | null;
  saldo_final: number | null;
  atualizado_em: string | null;
}

export interface PerfilCliente {
  id: string;
  usuario_id: string | null;
  metas_financeiras: string | null;
  preferencia_estilo: string | null;
  insights: string | null;
  score_economia: number | null;
  atualizado_em: string | null;
}

export interface HistoricoConversa {
  id: number;
  created_at: string;
  phone_number: string;
  user_id: string | null;
  user_message: string | null;
  ai_response: string | null;
  tipo: string | null;
  resumo: string | null;
  tokens: number | null;
}

// ==================== VIEWS ====================

export interface DashboardUsuario {
  usuario_id: string | null;
  saldo_final: number | null;
  total_gastos_ultimo_mes: number | null;
  total_fixos_ultimo_mes: number | null;
  total_cartao_ultimo_mes: number | null;
  transacoes_no_mes: number | null;
}

export interface TransacaoMes {
  usuario_id: string | null;
  mes_inicio: string | null;
  total_transacoes: number | null;
  total_entradas: number | null;
  total_gastos: number | null;
}

export interface ParcelaAberta {
  id: string | null;
  usuario_id: string | null;
  descricao: string | null;
  valor_total: number | null;
  num_parcelas: number | null;
  parcela_atual: number | null;
  valor_parcela: number | null;
  parcelas_restantes: number | null;
  ativa: boolean | null;
  created_at: string | null;
}

export interface FaturaEmAberto {
  id: string | null;
  usuario_id: string | null;
  cartao_id: string | null;
  mes: number | null;
  ano: number | null;
  valor_total: number | null;
  valor_pago: number | null;
  status: string | null;
  created_at: string | null;
}

export interface RecorrenciaAtiva {
  id: string | null;
  usuario_id: string | null;
  descricao: string | null;
  categoria: string | null;
  categoria_detalhada: string | null;
  tipo_recorrencia: string | null;
  valor_parcela: number | null;
  valor_total: number | null;
  dia_mes: number | null;
  dia_semana: string | null;
  num_parcelas: number | null;
  parcela_atual: number | null;
  ativo: boolean | null;
  proxima_execucao: string | null;
  ultima_execucao: string | null;
  origem: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ==================== TIPOS AUXILIARES ====================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DashboardStats {
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  gastosRecorrentes: number;
  totalCartao: number;
  totalFixos: number;
  transacoesNoMes: number;
}

export type CategoriaTransacao =
  | 'alimentacao'
  | 'transporte'
  | 'moradia'
  | 'saude'
  | 'educacao'
  | 'lazer'
  | 'vestuario'
  | 'servicos'
  | 'salario'
  | 'investimentos'
  | 'outros';

export const CATEGORIAS: { value: CategoriaTransacao; label: string; cor: string; tipo: 'entrada' | 'saida' | 'ambos' }[] = [
  { value: 'alimentacao', label: 'Alimentação', cor: 'hsl(38, 92%, 50%)', tipo: 'saida' },
  { value: 'transporte', label: 'Transporte', cor: 'hsl(217, 91%, 60%)', tipo: 'saida' },
  { value: 'moradia', label: 'Moradia', cor: 'hsl(280, 65%, 60%)', tipo: 'saida' },
  { value: 'saude', label: 'Saúde', cor: 'hsl(340, 75%, 55%)', tipo: 'saida' },
  { value: 'educacao', label: 'Educação', cor: 'hsl(180, 70%, 45%)', tipo: 'saida' },
  { value: 'lazer', label: 'Lazer', cor: 'hsl(320, 70%, 55%)', tipo: 'saida' },
  { value: 'vestuario', label: 'Vestuário', cor: 'hsl(25, 85%, 55%)', tipo: 'saida' },
  { value: 'servicos', label: 'Serviços', cor: 'hsl(200, 70%, 50%)', tipo: 'saida' },
  { value: 'salario', label: 'Salário', cor: 'hsl(142, 76%, 36%)', tipo: 'entrada' },
  { value: 'investimentos', label: 'Investimentos', cor: 'hsl(260, 70%, 55%)', tipo: 'ambos' },
  { value: 'outros', label: 'Outros', cor: 'hsl(220, 10%, 50%)', tipo: 'ambos' },
];

// ==================== RPC TYPES ====================

export interface RegistrarTransacaoParams {
  p_usuario_id: string;
  p_valor: number;
  p_tipo: 'entrada' | 'saida';
  p_categoria: string;
  p_descricao: string;
  p_data: string;
}
