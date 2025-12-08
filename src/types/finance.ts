export interface Usuario {
  id: string;
  created_at: string;
  updated_at: string;
  phone_number: string;
  nome: string | null;
}

export interface Transacao {
  id: string;
  usuario_id: string | null;
  data: string;
  valor: number;
  recorrente: boolean;
  created_at: string;
  categoria: string;
  observacao: string | null;
  tipo: 'entrada' | 'saida';
  parcela: string | null;
}

export interface GastoRecorrente {
  id: string;
  usuario_id: string | null;
  valor_total: number | null;
  valor_parcela: number;
  parcela_atual: number;
  num_parcelas: number | null;
  dia_mes: number | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  tipo_recorrencia: 'mensal' | 'semanal' | 'parcelado';
  dia_semana: string | null;
  descricao: string | null;
  categoria: string;
}

export interface HistoricoConversa {
  id: number;
  created_at: string;
  phone_number: string;
  user_message: string | null;
  ai_response: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DashboardStats {
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  gastosRecorrentes: number;
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

export const CATEGORIAS: { value: CategoriaTransacao; label: string; cor: string }[] = [
  { value: 'alimentacao', label: 'Alimentação', cor: 'hsl(38, 92%, 50%)' },
  { value: 'transporte', label: 'Transporte', cor: 'hsl(217, 91%, 60%)' },
  { value: 'moradia', label: 'Moradia', cor: 'hsl(280, 65%, 60%)' },
  { value: 'saude', label: 'Saúde', cor: 'hsl(340, 75%, 55%)' },
  { value: 'educacao', label: 'Educação', cor: 'hsl(180, 70%, 45%)' },
  { value: 'lazer', label: 'Lazer', cor: 'hsl(320, 70%, 55%)' },
  { value: 'vestuario', label: 'Vestuário', cor: 'hsl(25, 85%, 55%)' },
  { value: 'servicos', label: 'Serviços', cor: 'hsl(200, 70%, 50%)' },
  { value: 'salario', label: 'Salário', cor: 'hsl(142, 76%, 36%)' },
  { value: 'investimentos', label: 'Investimentos', cor: 'hsl(260, 70%, 55%)' },
  { value: 'outros', label: 'Outros', cor: 'hsl(220, 10%, 50%)' },
];
