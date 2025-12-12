export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      cartoes_credito: {
        Row: {
          created_at: string | null
          dia_fechamento: number | null
          dia_vencimento: number | null
          id: string
          limite_disponivel: number | null
          limite_total: number | null
          nome: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string | null
          dia_fechamento?: number | null
          dia_vencimento?: number | null
          id?: string
          limite_disponivel?: number | null
          limite_total?: number | null
          nome?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string | null
          dia_fechamento?: number | null
          dia_vencimento?: number | null
          id?: string
          limite_disponivel?: number | null
          limite_total?: number | null
          nome?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cartoes_credito_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cartoes_credito_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      categorias: {
        Row: {
          created_at: string | null
          id: string
          nome: string
          tipo: string
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
          tipo: string
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
          tipo?: string
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorias_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string | null
          id: string
          name: string
          password: string
          role: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          password: string
          role?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          password?: string
          role?: string | null
        }
        Relationships: []
      }
      faturas: {
        Row: {
          cartao_nome: string
          created_at: string | null
          fechado: boolean | null
          id: string
          mes_referencia: string
          updated_at: string | null
          usuario_id: string
          valor_pago: number | null
          valor_total: number | null
        }
        Insert: {
          cartao_nome: string
          created_at?: string | null
          fechado?: boolean | null
          id?: string
          mes_referencia: string
          updated_at?: string | null
          usuario_id: string
          valor_pago?: number | null
          valor_total?: number | null
        }
        Update: {
          cartao_nome?: string
          created_at?: string | null
          fechado?: boolean | null
          id?: string
          mes_referencia?: string
          updated_at?: string | null
          usuario_id?: string
          valor_pago?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "faturas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      faturas_cartao: {
        Row: {
          ano: number | null
          cartao_id: string | null
          created_at: string | null
          id: string
          mes: number | null
          status: string | null
          usuario_id: string | null
          valor_pago: number | null
          valor_total: number | null
        }
        Insert: {
          ano?: number | null
          cartao_id?: string | null
          created_at?: string | null
          id?: string
          mes?: number | null
          status?: string | null
          usuario_id?: string | null
          valor_pago?: number | null
          valor_total?: number | null
        }
        Update: {
          ano?: number | null
          cartao_id?: string | null
          created_at?: string | null
          id?: string
          mes?: number | null
          status?: string | null
          usuario_id?: string | null
          valor_pago?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "faturas_cartao_cartao_id_fkey"
            columns: ["cartao_id"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_cartao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_cartao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      gastos_recorrentes: {
        Row: {
          ativo: boolean | null
          categoria: string
          categoria_detalhada: string | null
          created_at: string | null
          descricao: string | null
          dia_mes: number | null
          dia_semana: string | null
          id: string
          num_parcelas: number | null
          origem: string | null
          parcela_atual: number | null
          proxima_execucao: string | null
          tipo_recorrencia: string
          ultima_execucao: string | null
          updated_at: string | null
          usuario_id: string | null
          valor_parcela: number
          valor_total: number | null
        }
        Insert: {
          ativo?: boolean | null
          categoria: string
          categoria_detalhada?: string | null
          created_at?: string | null
          descricao?: string | null
          dia_mes?: number | null
          dia_semana?: string | null
          id?: string
          num_parcelas?: number | null
          origem?: string | null
          parcela_atual?: number | null
          proxima_execucao?: string | null
          tipo_recorrencia: string
          ultima_execucao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
          valor_parcela: number
          valor_total?: number | null
        }
        Update: {
          ativo?: boolean | null
          categoria?: string
          categoria_detalhada?: string | null
          created_at?: string | null
          descricao?: string | null
          dia_mes?: number | null
          dia_semana?: string | null
          id?: string
          num_parcelas?: number | null
          origem?: string | null
          parcela_atual?: number | null
          proxima_execucao?: string | null
          tipo_recorrencia?: string
          ultima_execucao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
          valor_parcela?: number
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gastos_recorrentes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_recorrentes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      historico_conversas: {
        Row: {
          ai_response: string | null
          created_at: string | null
          id: number
          phone_number: string
          resumo: string | null
          tipo: string | null
          tokens: number | null
          user_id: string | null
          user_message: string | null
        }
        Insert: {
          ai_response?: string | null
          created_at?: string | null
          id?: number
          phone_number: string
          resumo?: string | null
          tipo?: string | null
          tokens?: number | null
          user_id?: string | null
          user_message?: string | null
        }
        Update: {
          ai_response?: string | null
          created_at?: string | null
          id?: number
          phone_number?: string
          resumo?: string | null
          tipo?: string | null
          tokens?: number | null
          user_id?: string | null
          user_message?: string | null
        }
        Relationships: []
      }
      parcelamentos: {
        Row: {
          ativa: boolean | null
          created_at: string | null
          descricao: string | null
          id: string
          num_parcelas: number | null
          parcela_atual: number | null
          usuario_id: string | null
          valor_parcela: number | null
          valor_total: number | null
        }
        Insert: {
          ativa?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          num_parcelas?: number | null
          parcela_atual?: number | null
          usuario_id?: string | null
          valor_parcela?: number | null
          valor_total?: number | null
        }
        Update: {
          ativa?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          num_parcelas?: number | null
          parcela_atual?: number | null
          usuario_id?: string | null
          valor_parcela?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      perfil_cliente: {
        Row: {
          atualizado_em: string | null
          id: string
          insights: string | null
          metas_financeiras: string | null
          preferencia_estilo: string | null
          score_economia: number | null
          usuario_id: string | null
        }
        Insert: {
          atualizado_em?: string | null
          id?: string
          insights?: string | null
          metas_financeiras?: string | null
          preferencia_estilo?: string | null
          score_economia?: number | null
          usuario_id?: string | null
        }
        Update: {
          atualizado_em?: string | null
          id?: string
          insights?: string | null
          metas_financeiras?: string | null
          preferencia_estilo?: string | null
          score_economia?: number | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "perfil_cliente_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "perfil_cliente_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      resumo_mensal: {
        Row: {
          ano: number | null
          atualizado_em: string | null
          id: string
          mes: number | null
          saldo_final: number | null
          total_cartao: number | null
          total_essenciais: number | null
          total_fixos: number | null
          total_gastos: number | null
          total_lazer: number | null
          usuario_id: string | null
        }
        Insert: {
          ano?: number | null
          atualizado_em?: string | null
          id?: string
          mes?: number | null
          saldo_final?: number | null
          total_cartao?: number | null
          total_essenciais?: number | null
          total_fixos?: number | null
          total_gastos?: number | null
          total_lazer?: number | null
          usuario_id?: string | null
        }
        Update: {
          ano?: number | null
          atualizado_em?: string | null
          id?: string
          mes?: number | null
          saldo_final?: number | null
          total_cartao?: number | null
          total_essenciais?: number | null
          total_fixos?: number | null
          total_gastos?: number | null
          total_lazer?: number | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resumo_mensal_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resumo_mensal_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      transacoes: {
        Row: {
          atualizado_em: string | null
          categoria: string
          created_at: string | null
          data: string
          essencial: boolean | null
          fatura_id: string | null
          hash_unico: string | null
          id: string
          merchant: string | null
          observacao: string | null
          origem: string | null
          parcela: string | null
          parcelamento_id: string | null
          recorrente: boolean | null
          tipo: string
          usuario_id: string | null
          valor: number
        }
        Insert: {
          atualizado_em?: string | null
          categoria: string
          created_at?: string | null
          data?: string
          essencial?: boolean | null
          fatura_id?: string | null
          hash_unico?: string | null
          id?: string
          merchant?: string | null
          observacao?: string | null
          origem?: string | null
          parcela?: string | null
          parcelamento_id?: string | null
          recorrente?: boolean | null
          tipo: string
          usuario_id?: string | null
          valor: number
        }
        Update: {
          atualizado_em?: string | null
          categoria?: string
          created_at?: string | null
          data?: string
          essencial?: boolean | null
          fatura_id?: string | null
          hash_unico?: string | null
          id?: string
          merchant?: string | null
          observacao?: string | null
          origem?: string | null
          parcela?: string | null
          parcelamento_id?: string | null
          recorrente?: boolean | null
          tipo?: string
          usuario_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      usuarios: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string
          limite_transacoes_mes: number | null
          nome: string | null
          phone_number: string
          plano: string | null
          saldo_mensal: number | null
          ultimo_resumo: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          limite_transacoes_mes?: number | null
          nome?: string | null
          phone_number: string
          plano?: string | null
          saldo_mensal?: number | null
          ultimo_resumo?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          limite_transacoes_mes?: number | null
          nome?: string | null
          phone_number?: string
          plano?: string | null
          saldo_mensal?: number | null
          ultimo_resumo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      vw_dashboard_usuario: {
        Row: {
          saldo_final: number | null
          total_cartao_ultimo_mes: number | null
          total_fixos_ultimo_mes: number | null
          total_gastos_ultimo_mes: number | null
          transacoes_no_mes: number | null
          usuario_id: string | null
        }
        Relationships: []
      }
      vw_faturas_em_aberto: {
        Row: {
          ano: number | null
          cartao_id: string | null
          created_at: string | null
          id: string | null
          mes: number | null
          status: string | null
          usuario_id: string | null
          valor_pago: number | null
          valor_total: number | null
        }
        Insert: {
          ano?: number | null
          cartao_id?: string | null
          created_at?: string | null
          id?: string | null
          mes?: number | null
          status?: string | null
          usuario_id?: string | null
          valor_pago?: number | null
          valor_total?: number | null
        }
        Update: {
          ano?: number | null
          cartao_id?: string | null
          created_at?: string | null
          id?: string | null
          mes?: number | null
          status?: string | null
          usuario_id?: string | null
          valor_pago?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "faturas_cartao_cartao_id_fkey"
            columns: ["cartao_id"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_cartao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_cartao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_parcelas_abertas: {
        Row: {
          ativa: boolean | null
          created_at: string | null
          descricao: string | null
          id: string | null
          num_parcelas: number | null
          parcela_atual: number | null
          parcelas_restantes: number | null
          usuario_id: string | null
          valor_parcela: number | null
          valor_total: number | null
        }
        Insert: {
          ativa?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          num_parcelas?: number | null
          parcela_atual?: number | null
          parcelas_restantes?: never
          usuario_id?: string | null
          valor_parcela?: number | null
          valor_total?: number | null
        }
        Update: {
          ativa?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          num_parcelas?: number | null
          parcela_atual?: number | null
          parcelas_restantes?: never
          usuario_id?: string | null
          valor_parcela?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_parcelas_pendentes_usuario: {
        Row: {
          descricao: string | null
          num_parcelas: number | null
          parcela_atual: number | null
          parcelamento_id: string | null
          restantes: number | null
          usuario_id: string | null
        }
        Insert: {
          descricao?: string | null
          num_parcelas?: number | null
          parcela_atual?: number | null
          parcelamento_id?: string | null
          restantes?: never
          usuario_id?: string | null
        }
        Update: {
          descricao?: string | null
          num_parcelas?: number | null
          parcela_atual?: number | null
          parcelamento_id?: string | null
          restantes?: never
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_recorrencias_ativas: {
        Row: {
          ativo: boolean | null
          categoria: string | null
          categoria_detalhada: string | null
          created_at: string | null
          descricao: string | null
          dia_mes: number | null
          dia_semana: string | null
          id: string | null
          num_parcelas: number | null
          origem: string | null
          parcela_atual: number | null
          proxima_execucao: string | null
          tipo_recorrencia: string | null
          ultima_execucao: string | null
          updated_at: string | null
          usuario_id: string | null
          valor_parcela: number | null
          valor_total: number | null
        }
        Insert: {
          ativo?: boolean | null
          categoria?: string | null
          categoria_detalhada?: string | null
          created_at?: string | null
          descricao?: string | null
          dia_mes?: number | null
          dia_semana?: string | null
          id?: string | null
          num_parcelas?: number | null
          origem?: string | null
          parcela_atual?: number | null
          proxima_execucao?: string | null
          tipo_recorrencia?: string | null
          ultima_execucao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
          valor_parcela?: number | null
          valor_total?: number | null
        }
        Update: {
          ativo?: boolean | null
          categoria?: string | null
          categoria_detalhada?: string | null
          created_at?: string | null
          descricao?: string | null
          dia_mes?: number | null
          dia_semana?: string | null
          id?: string | null
          num_parcelas?: number | null
          origem?: string | null
          parcela_atual?: number | null
          proxima_execucao?: string | null
          tipo_recorrencia?: string | null
          ultima_execucao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
          valor_parcela?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gastos_recorrentes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_recorrentes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_transacoes_mes: {
        Row: {
          mes_inicio: string | null
          total_entradas: number | null
          total_gastos: number | null
          total_transacoes: number | null
          usuario_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_transacoes_mes_atual: {
        Row: {
          atualizado_em: string | null
          categoria: string | null
          created_at: string | null
          data: string | null
          essencial: boolean | null
          fatura_id: string | null
          hash_unico: string | null
          id: string | null
          merchant: string | null
          observacao: string | null
          origem: string | null
          parcela: string | null
          parcelamento_id: string | null
          recorrente: boolean | null
          tipo: string | null
          usuario_id: string | null
          valor: number | null
        }
        Insert: {
          atualizado_em?: string | null
          categoria?: string | null
          created_at?: string | null
          data?: string | null
          essencial?: boolean | null
          fatura_id?: string | null
          hash_unico?: string | null
          id?: string | null
          merchant?: string | null
          observacao?: string | null
          origem?: string | null
          parcela?: string | null
          parcelamento_id?: string | null
          recorrente?: boolean | null
          tipo?: string | null
          usuario_id?: string | null
          valor?: number | null
        }
        Update: {
          atualizado_em?: string | null
          categoria?: string | null
          created_at?: string | null
          data?: string | null
          essencial?: boolean | null
          fatura_id?: string | null
          hash_unico?: string | null
          id?: string | null
          merchant?: string | null
          observacao?: string | null
          origem?: string | null
          parcela?: string | null
          parcelamento_id?: string | null
          recorrente?: boolean | null
          tipo?: string | null
          usuario_id?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
    }
    Functions: {
      atualizar_resumo_mensal: {
        Args: { p_usuario: string }
        Returns: undefined
      }
      fn_close_card_faturas: { Args: never; Returns: undefined }
      fn_daily_jobs: { Args: never; Returns: undefined }
      fn_generate_parcelas: {
        Args: { p_parcelamento_id: string }
        Returns: undefined
      }
      fn_process_recorrentes: { Args: never; Returns: undefined }
      fn_update_resumo_mensal: {
        Args: { p_ano: number; p_mes: number; p_user_id: string }
        Returns: undefined
      }
      rpc_registrar_transacao: {
        Args: {
          p_categoria: string
          p_data: string
          p_descricao: string
          p_tipo: string
          p_usuario_id: string
          p_valor: number
        }
        Returns: {
          id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
