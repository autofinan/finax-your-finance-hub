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
      actions: {
        Row: {
          action_hash: string
          action_type: string
          created_at: string | null
          entity_id: string | null
          id: string
          meta: Json | null
          slots: Json | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          action_hash: string
          action_type: string
          created_at?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
          slots?: Json | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          action_hash?: string
          action_type?: string
          created_at?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
          slots?: Json | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_corrections: {
        Row: {
          applied_count: number | null
          confirmed_by_user: boolean | null
          corrected_classification: Json | null
          correction_confidence: number | null
          correction_type: string | null
          created_at: string | null
          decision_version: string | null
          id: string
          last_confirmed_at: string | null
          original_classification: Json | null
          original_message: string
          pattern_hash: string | null
          user_correction: string | null
          user_id: string | null
        }
        Insert: {
          applied_count?: number | null
          confirmed_by_user?: boolean | null
          corrected_classification?: Json | null
          correction_confidence?: number | null
          correction_type?: string | null
          created_at?: string | null
          decision_version?: string | null
          id?: string
          last_confirmed_at?: string | null
          original_classification?: Json | null
          original_message: string
          pattern_hash?: string | null
          user_correction?: string | null
          user_id?: string | null
        }
        Update: {
          applied_count?: number | null
          confirmed_by_user?: boolean | null
          corrected_classification?: Json | null
          correction_confidence?: number | null
          correction_type?: string | null
          created_at?: string | null
          decision_version?: string | null
          id?: string
          last_confirmed_at?: string | null
          original_classification?: Json | null
          original_message?: string
          pattern_hash?: string | null
          user_correction?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_corrections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ai_corrections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_corrections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "ai_corrections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      ai_decision_versions: {
        Row: {
          active: boolean | null
          auto_apply_corrections: boolean | null
          auto_apply_patterns: boolean | null
          created_at: string | null
          description: string | null
          global_corrections_enabled: boolean | null
          proactive_alerts_enabled: boolean | null
          version: string
        }
        Insert: {
          active?: boolean | null
          auto_apply_corrections?: boolean | null
          auto_apply_patterns?: boolean | null
          created_at?: string | null
          description?: string | null
          global_corrections_enabled?: boolean | null
          proactive_alerts_enabled?: boolean | null
          version: string
        }
        Update: {
          active?: boolean | null
          auto_apply_corrections?: boolean | null
          auto_apply_patterns?: boolean | null
          created_at?: string | null
          description?: string | null
          global_corrections_enabled?: boolean | null
          proactive_alerts_enabled?: boolean | null
          version?: string
        }
        Relationships: []
      }
      ai_decisions: {
        Row: {
          actual_classification: string | null
          ai_classification: string
          ai_confidence: number
          ai_reasoning: string | null
          ai_slots: Json
          ai_source: string | null
          confirmed_at: string | null
          correct_classification: string | null
          correction_details: Json | null
          created_at: string | null
          executed_at: string | null
          execution_error: string | null
          execution_result: string | null
          feedback: string | null
          id: string
          message: string
          message_id: string | null
          message_type: string | null
          model_version: string | null
          user_confirmed: boolean | null
          user_feedback: string | null
          user_id: string
          was_executed: boolean | null
        }
        Insert: {
          actual_classification?: string | null
          ai_classification: string
          ai_confidence: number
          ai_reasoning?: string | null
          ai_slots?: Json
          ai_source?: string | null
          confirmed_at?: string | null
          correct_classification?: string | null
          correction_details?: Json | null
          created_at?: string | null
          executed_at?: string | null
          execution_error?: string | null
          execution_result?: string | null
          feedback?: string | null
          id?: string
          message: string
          message_id?: string | null
          message_type?: string | null
          model_version?: string | null
          user_confirmed?: boolean | null
          user_feedback?: string | null
          user_id: string
          was_executed?: boolean | null
        }
        Update: {
          actual_classification?: string | null
          ai_classification?: string
          ai_confidence?: number
          ai_reasoning?: string | null
          ai_slots?: Json
          ai_source?: string | null
          confirmed_at?: string | null
          correct_classification?: string | null
          correction_details?: Json | null
          created_at?: string | null
          executed_at?: string | null
          execution_error?: string | null
          execution_result?: string | null
          feedback?: string | null
          id?: string
          message?: string
          message_id?: string | null
          message_type?: string | null
          model_version?: string | null
          user_confirmed?: boolean | null
          user_feedback?: string | null
          user_id?: string
          was_executed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decisions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ai_decisions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decisions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "ai_decisions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      ai_prompts: {
        Row: {
          active: boolean | null
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          performance: Json | null
          status: string | null
          version: number
        }
        Insert: {
          active?: boolean | null
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          performance?: Json | null
          status?: string | null
          version?: number
        }
        Update: {
          active?: boolean | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          performance?: Json | null
          status?: string | null
          version?: number
        }
        Relationships: []
      }
      alert_feedback: {
        Row: {
          alert_id: string | null
          comment: string | null
          created_at: string | null
          feedback: string
          id: string
          user_id: string | null
        }
        Insert: {
          alert_id?: string | null
          comment?: string | null
          created_at?: string | null
          feedback: string
          id?: string
          user_id?: string | null
        }
        Update: {
          alert_id?: string | null
          comment?: string | null
          created_at?: string | null
          feedback?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_feedback_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "spending_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alert_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "alert_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      bank_connections: {
        Row: {
          access_token_encrypted: string | null
          created_at: string | null
          id: string
          institution_id: string | null
          institution_name: string | null
          last_sync_at: string | null
          provider: string
          refresh_token_encrypted: string | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          created_at?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          last_sync_at?: string | null
          provider: string
          refresh_token_encrypted?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          created_at?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          last_sync_at?: string | null
          provider?: string
          refresh_token_encrypted?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bank_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "bank_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      cancelamentos: {
        Row: {
          created_at: string
          data_cancelamento: string
          detalhes: string | null
          id: string
          meses_assinante: number | null
          motivo: string | null
          ofertas_recusadas: string[] | null
          phone_number: string
          plano_anterior: string | null
          stripe_subscription_id: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          data_cancelamento?: string
          detalhes?: string | null
          id?: string
          meses_assinante?: number | null
          motivo?: string | null
          ofertas_recusadas?: string[] | null
          phone_number: string
          plano_anterior?: string | null
          stripe_subscription_id?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          data_cancelamento?: string
          detalhes?: string | null
          id?: string
          meses_assinante?: number | null
          motivo?: string | null
          ofertas_recusadas?: string[] | null
          phone_number?: string
          plano_anterior?: string | null
          stripe_subscription_id?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cancelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cancelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "cancelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      cartoes_credito: {
        Row: {
          ativo: boolean | null
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
          ativo?: boolean | null
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
          ativo?: boolean | null
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "cartoes_credito_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "categorias_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      chart_cache: {
        Row: {
          chart_data: Json
          chart_type: string
          created_at: string | null
          expires_at: string
          id: string
          image_path: string | null
          signed_url: string | null
          user_id: string
        }
        Insert: {
          chart_data: Json
          chart_type: string
          created_at?: string | null
          expires_at: string
          id?: string
          image_path?: string | null
          signed_url?: string | null
          user_id: string
        }
        Update: {
          chart_data?: Json
          chart_type?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          image_path?: string | null
          signed_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chart_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "chart_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      codigos_ativacao: {
        Row: {
          codigo: string
          criado_em: string | null
          email_comprador: string | null
          id: string
          origem: string | null
          phone_number_destino: string | null
          plano_destino: string | null
          transaction_id: string | null
          usado: boolean | null
          usado_em: string | null
          usuario_id: string | null
          valido_ate: string
          valor_pago: number | null
        }
        Insert: {
          codigo: string
          criado_em?: string | null
          email_comprador?: string | null
          id?: string
          origem?: string | null
          phone_number_destino?: string | null
          plano_destino?: string | null
          transaction_id?: string | null
          usado?: boolean | null
          usado_em?: string | null
          usuario_id?: string | null
          valido_ate: string
          valor_pago?: number | null
        }
        Update: {
          codigo?: string
          criado_em?: string | null
          email_comprador?: string | null
          id?: string
          origem?: string | null
          phone_number_destino?: string | null
          plano_destino?: string | null
          transaction_id?: string | null
          usado?: boolean | null
          usado_em?: string | null
          usuario_id?: string | null
          valido_ate?: string
          valor_pago?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "codigos_ativacao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "codigos_ativacao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "codigos_ativacao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "codigos_ativacao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      contas_pagar: {
        Row: {
          ativa: boolean | null
          created_at: string | null
          dia_vencimento: number | null
          id: string
          lembrar_dias_antes: number | null
          nome: string
          tipo: string
          ultimo_lembrete: string | null
          updated_at: string | null
          usuario_id: string
          valor_estimado: number | null
        }
        Insert: {
          ativa?: boolean | null
          created_at?: string | null
          dia_vencimento?: number | null
          id?: string
          lembrar_dias_antes?: number | null
          nome: string
          tipo?: string
          ultimo_lembrete?: string | null
          updated_at?: string | null
          usuario_id: string
          valor_estimado?: number | null
        }
        Update: {
          ativa?: boolean | null
          created_at?: string | null
          dia_vencimento?: number | null
          id?: string
          lembrar_dias_antes?: number | null
          nome?: string
          tipo?: string
          ultimo_lembrete?: string | null
          updated_at?: string | null
          usuario_id?: string
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      conversas_ativas: {
        Row: {
          atualizado_em: string | null
          campos_pendentes: string[] | null
          contexto: Json | null
          criado_em: string | null
          dados_coletados: Json | null
          estado: string
          etapa: string | null
          expira_em: string | null
          expires_at: string | null
          id: string
          lock_acao: string | null
          mensagens_usuario: string[] | null
          tipo_operacao: string
          ultima_pergunta_ia: string | null
          ultima_resposta: string | null
          ultimo_evento_id: string | null
          ultimo_intent: string | null
          ultimo_intent_at: string | null
          usuario_id: string | null
        }
        Insert: {
          atualizado_em?: string | null
          campos_pendentes?: string[] | null
          contexto?: Json | null
          criado_em?: string | null
          dados_coletados?: Json | null
          estado: string
          etapa?: string | null
          expira_em?: string | null
          expires_at?: string | null
          id?: string
          lock_acao?: string | null
          mensagens_usuario?: string[] | null
          tipo_operacao: string
          ultima_pergunta_ia?: string | null
          ultima_resposta?: string | null
          ultimo_evento_id?: string | null
          ultimo_intent?: string | null
          ultimo_intent_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          atualizado_em?: string | null
          campos_pendentes?: string[] | null
          contexto?: Json | null
          criado_em?: string | null
          dados_coletados?: Json | null
          estado?: string
          etapa?: string | null
          expira_em?: string | null
          expires_at?: string | null
          id?: string
          lock_acao?: string | null
          mensagens_usuario?: string[] | null
          tipo_operacao?: string
          ultima_pergunta_ia?: string | null
          ultima_resposta?: string | null
          ultimo_evento_id?: string | null
          ultimo_intent?: string | null
          ultimo_intent_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversas_ativas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversas_ativas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_ativas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "conversas_ativas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      conversation_context: {
        Row: {
          created_at: string | null
          current_topic: string | null
          expires_at: string | null
          interaction_count: number | null
          last_card_id: string | null
          last_card_name: string | null
          last_category: string | null
          last_end_date: string | null
          last_goal_id: string | null
          last_goal_name: string | null
          last_intent: string | null
          last_interaction_at: string | null
          last_query_scope: string | null
          last_start_date: string | null
          last_time_range: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_topic?: string | null
          expires_at?: string | null
          interaction_count?: number | null
          last_card_id?: string | null
          last_card_name?: string | null
          last_category?: string | null
          last_end_date?: string | null
          last_goal_id?: string | null
          last_goal_name?: string | null
          last_intent?: string | null
          last_interaction_at?: string | null
          last_query_scope?: string | null
          last_start_date?: string | null
          last_time_range?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_topic?: string | null
          expires_at?: string | null
          interaction_count?: number | null
          last_card_id?: string | null
          last_card_name?: string | null
          last_category?: string | null
          last_end_date?: string | null
          last_goal_id?: string | null
          last_goal_name?: string | null
          last_intent?: string | null
          last_interaction_at?: string | null
          last_query_scope?: string | null
          last_start_date?: string | null
          last_time_range?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_context_last_card_id_fkey"
            columns: ["last_card_id"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_context_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversation_context_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_context_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "conversation_context_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      conversation_state: {
        Row: {
          current_transaction_id: string | null
          id: string
          last_message_at: string | null
          pending_slot: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          current_transaction_id?: string | null
          id?: string
          last_message_at?: string | null
          pending_slot?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          current_transaction_id?: string | null
          id?: string
          last_message_at?: string | null
          pending_slot?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversation_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "conversation_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      dividas: {
        Row: {
          ativa: boolean | null
          created_at: string | null
          data_contratacao: string | null
          data_vencimento: string | null
          id: string
          nome: string
          saldo_devedor: number
          taxa_juros: number | null
          tipo: string
          updated_at: string | null
          usuario_id: string
          valor_minimo: number | null
        }
        Insert: {
          ativa?: boolean | null
          created_at?: string | null
          data_contratacao?: string | null
          data_vencimento?: string | null
          id?: string
          nome: string
          saldo_devedor: number
          taxa_juros?: number | null
          tipo: string
          updated_at?: string | null
          usuario_id: string
          valor_minimo?: number | null
        }
        Update: {
          ativa?: boolean | null
          created_at?: string | null
          data_contratacao?: string | null
          data_vencimento?: string | null
          id?: string
          nome?: string
          saldo_devedor?: number
          taxa_juros?: number | null
          tipo?: string
          updated_at?: string | null
          usuario_id?: string
          valor_minimo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dividas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "dividas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "dividas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
      erros_interpretacao: {
        Row: {
          ai_classification: string | null
          confidence: number | null
          created_at: string | null
          erro: string | null
          evento_id: string | null
          id: string
          message: string | null
          reason: string | null
          resposta_ia: Json | null
          user_id: string | null
        }
        Insert: {
          ai_classification?: string | null
          confidence?: number | null
          created_at?: string | null
          erro?: string | null
          evento_id?: string | null
          id?: string
          message?: string | null
          reason?: string | null
          resposta_ia?: Json | null
          user_id?: string | null
        }
        Update: {
          ai_classification?: string | null
          confidence?: number | null
          created_at?: string | null
          erro?: string | null
          evento_id?: string | null
          id?: string
          message?: string | null
          reason?: string | null
          resposta_ia?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      eventos_brutos: {
        Row: {
          conteudo: Json
          created_at: string | null
          id: string
          interpretacao: Json | null
          interpretado: boolean | null
          media_attempts: number | null
          media_downloaded: boolean | null
          media_error: string | null
          media_status: string | null
          message_id: string | null
          origem: string
          phone_number: string | null
          status: string | null
          tipo_midia: string | null
          user_id: string | null
        }
        Insert: {
          conteudo: Json
          created_at?: string | null
          id?: string
          interpretacao?: Json | null
          interpretado?: boolean | null
          media_attempts?: number | null
          media_downloaded?: boolean | null
          media_error?: string | null
          media_status?: string | null
          message_id?: string | null
          origem: string
          phone_number?: string | null
          status?: string | null
          tipo_midia?: string | null
          user_id?: string | null
        }
        Update: {
          conteudo?: Json
          created_at?: string | null
          id?: string
          interpretacao?: Json | null
          interpretado?: boolean | null
          media_attempts?: number | null
          media_downloaded?: boolean | null
          media_error?: string | null
          media_status?: string | null
          message_id?: string | null
          origem?: string
          phone_number?: string | null
          status?: string | null
          tipo_midia?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_brutos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "eventos_brutos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_brutos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "eventos_brutos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "faturas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
          updated_at: string | null
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
          updated_at?: string | null
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
          updated_at?: string | null
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
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
          {
            foreignKeyName: "faturas_cartao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      finax_logs: {
        Row: {
          action_type: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          job_id: string | null
          message_id: string | null
          new_data: Json | null
          old_data: Json | null
          step: string | null
          trace_id: string | null
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          job_id?: string | null
          message_id?: string | null
          new_data?: Json | null
          old_data?: Json | null
          step?: string | null
          trace_id?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          job_id?: string | null
          message_id?: string | null
          new_data?: Json | null
          old_data?: Json | null
          step?: string | null
          trace_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      finax_metrics: {
        Row: {
          created_at: string | null
          id: string
          metric_name: string
          tags: Json | null
          value: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          metric_name: string
          tags?: Json | null
          value: number
        }
        Update: {
          created_at?: string | null
          id?: string
          metric_name?: string
          tags?: Json | null
          value?: number
        }
        Relationships: []
      }
      gastos_recorrentes: {
        Row: {
          ativo: boolean | null
          cartao_id: string | null
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
          cartao_id?: string | null
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
          cartao_id?: string | null
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
            foreignKeyName: "gastos_recorrentes_cartao_id_fkey"
            columns: ["cartao_id"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_recorrentes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "gastos_recorrentes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
      logs_sistema: {
        Row: {
          action_type: string | null
          component: string
          confidence: number | null
          duration_ms: number | null
          error_message: string | null
          error_name: string | null
          error_stack: string | null
          id: string
          level: string
          message: string | null
          message_id: string | null
          metadata: Json | null
          slots: Json | null
          timestamp: string | null
          user_id: string | null
        }
        Insert: {
          action_type?: string | null
          component: string
          confidence?: number | null
          duration_ms?: number | null
          error_message?: string | null
          error_name?: string | null
          error_stack?: string | null
          id?: string
          level: string
          message?: string | null
          message_id?: string | null
          metadata?: Json | null
          slots?: Json | null
          timestamp?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string | null
          component?: string
          confidence?: number | null
          duration_ms?: number | null
          error_message?: string | null
          error_name?: string | null
          error_stack?: string | null
          id?: string
          level?: string
          message?: string | null
          message_id?: string | null
          metadata?: Json | null
          slots?: Json | null
          timestamp?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_sistema_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "logs_sistema_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_sistema_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "logs_sistema_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      media_analysis: {
        Row: {
          confidence: number | null
          created_at: string | null
          evento_bruto_id: string | null
          id: string
          message_id: string | null
          parsed: Json | null
          processed: boolean | null
          raw_ocr: string | null
          source: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          evento_bruto_id?: string | null
          id?: string
          message_id?: string | null
          parsed?: Json | null
          processed?: boolean | null
          raw_ocr?: string | null
          source?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          evento_bruto_id?: string | null
          id?: string
          message_id?: string | null
          parsed?: Json | null
          processed?: boolean | null
          raw_ocr?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_analysis_evento_bruto_id_fkey"
            columns: ["evento_bruto_id"]
            isOneToOne: false
            referencedRelation: "eventos_brutos"
            referencedColumns: ["id"]
          },
        ]
      }
      messages_outbox: {
        Row: {
          created_at: string | null
          id: string
          message: string
          phone: string
          processed_at: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          phone: string
          processed_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          phone?: string
          processed_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "messages_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "messages_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      metas_frequencia: {
        Row: {
          ativa: boolean | null
          categoria: string
          created_at: string | null
          id: string
          limite_mensal: number
          nome: string
          palavras_chave: string[] | null
          updated_at: string | null
          usuario_id: string
        }
        Insert: {
          ativa?: boolean | null
          categoria: string
          created_at?: string | null
          id?: string
          limite_mensal: number
          nome: string
          palavras_chave?: string[] | null
          updated_at?: string | null
          usuario_id: string
        }
        Update: {
          ativa?: boolean | null
          categoria?: string
          created_at?: string | null
          id?: string
          limite_mensal?: number
          nome?: string
          palavras_chave?: string[] | null
          updated_at?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_frequencia_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "metas_frequencia_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_frequencia_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "metas_frequencia_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          alerta_100_enviado: boolean | null
          alerta_50_enviado: boolean | null
          alerta_80_enviado: boolean | null
          ativo: boolean | null
          categoria: string | null
          contexto_id: string | null
          created_at: string | null
          gasto_atual: number | null
          id: string
          limite: number
          periodo: string | null
          tipo: string
          updated_at: string | null
          usuario_id: string
        }
        Insert: {
          alerta_100_enviado?: boolean | null
          alerta_50_enviado?: boolean | null
          alerta_80_enviado?: boolean | null
          ativo?: boolean | null
          categoria?: string | null
          contexto_id?: string | null
          created_at?: string | null
          gasto_atual?: number | null
          id?: string
          limite: number
          periodo?: string | null
          tipo: string
          updated_at?: string | null
          usuario_id: string
        }
        Update: {
          alerta_100_enviado?: boolean | null
          alerta_50_enviado?: boolean | null
          alerta_80_enviado?: boolean | null
          ativo?: boolean | null
          categoria?: string | null
          contexto_id?: string | null
          created_at?: string | null
          gasto_atual?: number | null
          id?: string
          limite?: number
          periodo?: string | null
          tipo?: string
          updated_at?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_contexto_id_fkey"
            columns: ["contexto_id"]
            isOneToOne: false
            referencedRelation: "user_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_contexto_id_fkey"
            columns: ["contexto_id"]
            isOneToOne: false
            referencedRelation: "vw_active_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "orcamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "orcamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          attempts: number
          code: string
          created_at: string
          expires_at: string
          id: string
          phone_e164: string
          phone_number: string
          used: boolean
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          phone_e164: string
          phone_number: string
          used?: boolean
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone_e164?: string
          phone_number?: string
          used?: boolean
        }
        Relationships: []
      }
      pagamentos: {
        Row: {
          conta_id: string
          created_at: string | null
          data_pagamento: string | null
          id: string
          mes_referencia: string
          observacao: string | null
          status: string | null
          transacao_id: string | null
          usuario_id: string
          valor_pago: number
        }
        Insert: {
          conta_id: string
          created_at?: string | null
          data_pagamento?: string | null
          id?: string
          mes_referencia: string
          observacao?: string | null
          status?: string | null
          transacao_id?: string | null
          usuario_id: string
          valor_pago: number
        }
        Update: {
          conta_id?: string
          created_at?: string | null
          data_pagamento?: string | null
          id?: string
          mes_referencia?: string
          observacao?: string | null
          status?: string | null
          transacao_id?: string | null
          usuario_id?: string
          valor_pago?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "contas_pagar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "vw_contas_a_vencer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_transacao_id_fkey"
            columns: ["transacao_id"]
            isOneToOne: false
            referencedRelation: "transacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_transacao_id_fkey"
            columns: ["transacao_id"]
            isOneToOne: false
            referencedRelation: "vw_transacoes_mes_atual"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pagamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "pagamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      parcelas: {
        Row: {
          cartao_id: string | null
          created_at: string | null
          descricao: string | null
          fatura_id: string | null
          id: string
          mes_referencia: string
          numero_parcela: number
          parcelamento_id: string | null
          status: string | null
          total_parcelas: number
          usuario_id: string
          valor: number
        }
        Insert: {
          cartao_id?: string | null
          created_at?: string | null
          descricao?: string | null
          fatura_id?: string | null
          id?: string
          mes_referencia: string
          numero_parcela: number
          parcelamento_id?: string | null
          status?: string | null
          total_parcelas: number
          usuario_id: string
          valor: number
        }
        Update: {
          cartao_id?: string | null
          created_at?: string | null
          descricao?: string | null
          fatura_id?: string | null
          id?: string
          mes_referencia?: string
          numero_parcela?: number
          parcelamento_id?: string | null
          status?: string | null
          total_parcelas?: number
          usuario_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "parcelas_cartao_id_fkey"
            columns: ["cartao_id"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelas_fatura_id_fkey"
            columns: ["fatura_id"]
            isOneToOne: false
            referencedRelation: "faturas_cartao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelas_fatura_id_fkey"
            columns: ["fatura_id"]
            isOneToOne: false
            referencedRelation: "vw_faturas_em_aberto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelas_parcelamento_id_fkey"
            columns: ["parcelamento_id"]
            isOneToOne: false
            referencedRelation: "transacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcelas_parcelamento_id_fkey"
            columns: ["parcelamento_id"]
            isOneToOne: false
            referencedRelation: "vw_transacoes_mes_atual"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_messages: {
        Row: {
          created_at: string | null
          id: string
          message_id: string
          message_text: string
          processed: boolean | null
          processed_at: string | null
          processing: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_id: string
          message_text: string
          processed?: boolean | null
          processed_at?: string | null
          processing?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_id?: string
          message_text?: string
          processed?: boolean | null
          processed_at?: string | null
          processing?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pending_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "pending_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      pending_selections: {
        Row: {
          awaiting_field: string | null
          consumed: boolean | null
          created_at: string | null
          expires_at: string
          id: string
          options: Json
          token: string | null
          user_id: string
        }
        Insert: {
          awaiting_field?: string | null
          consumed?: boolean | null
          created_at?: string | null
          expires_at: string
          id?: string
          options: Json
          token?: string | null
          user_id: string
        }
        Update: {
          awaiting_field?: string | null
          consumed?: boolean | null
          created_at?: string | null
          expires_at?: string
          id?: string
          options?: Json
          token?: string | null
          user_id?: string
        }
        Relationships: []
      }
      perfil_cliente: {
        Row: {
          alertas_financeiros: Json | null
          atualizado_em: string | null
          id: string
          insights: string | null
          limites: Json | null
          metas_financeiras: string | null
          operation_mode: string | null
          preferencia_estilo: string | null
          preferencias: Json | null
          score_economia: number | null
          usuario_id: string | null
        }
        Insert: {
          alertas_financeiros?: Json | null
          atualizado_em?: string | null
          id?: string
          insights?: string | null
          limites?: Json | null
          metas_financeiras?: string | null
          operation_mode?: string | null
          preferencia_estilo?: string | null
          preferencias?: Json | null
          score_economia?: number | null
          usuario_id?: string | null
        }
        Update: {
          alertas_financeiros?: Json | null
          atualizado_em?: string | null
          id?: string
          insights?: string | null
          limites?: Json | null
          metas_financeiras?: string | null
          operation_mode?: string | null
          preferencia_estilo?: string | null
          preferencias?: Json | null
          score_economia?: number | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "perfil_cliente_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "perfil_cliente_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      plano_features: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          feature: string
          id: string
          plano: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          feature: string
          id?: string
          plano: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          feature?: string
          id?: string
          plano?: string
        }
        Relationships: []
      }
      processed_messages: {
        Row: {
          id: string
          message_id: string
          phone_number: string
          processed_at: string | null
          source: string | null
        }
        Insert: {
          id?: string
          message_id: string
          phone_number: string
          processed_at?: string | null
          source?: string | null
        }
        Update: {
          id?: string
          message_id?: string
          phone_number?: string
          processed_at?: string | null
          source?: string | null
        }
        Relationships: []
      }
      resumo_mensal: {
        Row: {
          alertas: string | null
          ano: number | null
          atualizado_em: string | null
          categoria_mais_cara: string | null
          id: string
          mes: number | null
          saldo_final: number | null
          total_cartao: number | null
          total_entradas: number | null
          total_essenciais: number | null
          total_fixos: number | null
          total_gastos: number | null
          total_lazer: number | null
          total_parcelado: number | null
          total_recorrente: number | null
          usuario_id: string | null
        }
        Insert: {
          alertas?: string | null
          ano?: number | null
          atualizado_em?: string | null
          categoria_mais_cara?: string | null
          id?: string
          mes?: number | null
          saldo_final?: number | null
          total_cartao?: number | null
          total_entradas?: number | null
          total_essenciais?: number | null
          total_fixos?: number | null
          total_gastos?: number | null
          total_lazer?: number | null
          total_parcelado?: number | null
          total_recorrente?: number | null
          usuario_id?: string | null
        }
        Update: {
          alertas?: string | null
          ano?: number | null
          atualizado_em?: string | null
          categoria_mais_cara?: string | null
          id?: string
          mes?: number | null
          saldo_final?: number | null
          total_cartao?: number | null
          total_entradas?: number | null
          total_essenciais?: number | null
          total_fixos?: number | null
          total_gastos?: number | null
          total_lazer?: number | null
          total_parcelado?: number | null
          total_recorrente?: number | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resumo_mensal_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "resumo_mensal_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      savings_goals: {
        Row: {
          auto_save_percentage: number | null
          categoria_alvo: string | null
          category: string | null
          created_at: string | null
          current_amount: number | null
          deadline: string | null
          frequencia_atual: number | null
          frequencia_maxima: number | null
          id: string
          name: string
          periodo: string | null
          progress_percentage: number | null
          status: string | null
          target_amount: number
          tipo: string | null
          updated_at: string | null
          user_id: string
          weekly_checkin_enabled: boolean | null
        }
        Insert: {
          auto_save_percentage?: number | null
          categoria_alvo?: string | null
          category?: string | null
          created_at?: string | null
          current_amount?: number | null
          deadline?: string | null
          frequencia_atual?: number | null
          frequencia_maxima?: number | null
          id?: string
          name: string
          periodo?: string | null
          progress_percentage?: number | null
          status?: string | null
          target_amount: number
          tipo?: string | null
          updated_at?: string | null
          user_id: string
          weekly_checkin_enabled?: boolean | null
        }
        Update: {
          auto_save_percentage?: number | null
          categoria_alvo?: string | null
          category?: string | null
          created_at?: string | null
          current_amount?: number | null
          deadline?: string | null
          frequencia_atual?: number | null
          frequencia_maxima?: number | null
          id?: string
          name?: string
          periodo?: string | null
          progress_percentage?: number | null
          status?: string | null
          target_amount?: number
          tipo?: string | null
          updated_at?: string | null
          user_id?: string
          weekly_checkin_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "savings_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "savings_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "savings_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "savings_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      semantic_categories: {
        Row: {
          categoria: string
          confidence: number | null
          created_at: string | null
          decision_version: string | null
          id: string
          last_used_at: string | null
          source: string | null
          termo: string
          termo_normalized: string
          usage_count: number | null
        }
        Insert: {
          categoria: string
          confidence?: number | null
          created_at?: string | null
          decision_version?: string | null
          id?: string
          last_used_at?: string | null
          source?: string | null
          termo: string
          termo_normalized: string
          usage_count?: number | null
        }
        Update: {
          categoria?: string
          confidence?: number | null
          created_at?: string | null
          decision_version?: string | null
          id?: string
          last_used_at?: string | null
          source?: string | null
          termo?: string
          termo_normalized?: string
          usage_count?: number | null
        }
        Relationships: []
      }
      shared_reports: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          is_revoked: boolean | null
          max_views: number | null
          report_type: string | null
          token: string
          user_id: string
          view_count: number | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          is_revoked?: boolean | null
          max_views?: number | null
          report_type?: string | null
          token: string
          user_id: string
          view_count?: number | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          is_revoked?: boolean | null
          max_views?: number | null
          report_type?: string | null
          token?: string
          user_id?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "shared_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "shared_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      short_links: {
        Row: {
          campaign: string | null
          clicks: number | null
          created_at: string | null
          expires_at: string | null
          id: string
          long_url: string
          short_code: string
          user_id: string | null
        }
        Insert: {
          campaign?: string | null
          clicks?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          long_url: string
          short_code: string
          user_id?: string | null
        }
        Update: {
          campaign?: string | null
          clicks?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          long_url?: string
          short_code?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "short_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "short_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "short_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "short_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      spending_alerts: {
        Row: {
          alert_type: string
          category: string | null
          created_at: string | null
          decision_version: string | null
          delivery_mode: string | null
          dismissed_at: string | null
          id: string
          message: string | null
          sent_at: string | null
          severity: string | null
          status: string | null
          trigger_data: Json | null
          user_id: string
          utility_score: number | null
        }
        Insert: {
          alert_type: string
          category?: string | null
          created_at?: string | null
          decision_version?: string | null
          delivery_mode?: string | null
          dismissed_at?: string | null
          id?: string
          message?: string | null
          sent_at?: string | null
          severity?: string | null
          status?: string | null
          trigger_data?: Json | null
          user_id: string
          utility_score?: number | null
        }
        Update: {
          alert_type?: string
          category?: string | null
          created_at?: string | null
          decision_version?: string | null
          delivery_mode?: string | null
          dismissed_at?: string | null
          id?: string
          message?: string | null
          sent_at?: string | null
          severity?: string | null
          status?: string | null
          trigger_data?: Json | null
          user_id?: string
          utility_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "spending_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "spending_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spending_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "spending_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      transacoes: {
        Row: {
          atualizado_em: string | null
          auto_imported: boolean | null
          bank_connection_id: string | null
          cartao_id: string | null
          categoria: string
          context_id: string | null
          created_at: string | null
          data: string
          data_transacao: string | null
          descricao: string | null
          essencial: boolean | null
          expense_type: string | null
          external_id: string | null
          fatura_id: string | null
          forma_pagamento: string | null
          hash_unico: string | null
          hora_transacao: string | null
          id: string
          id_cartao: string | null
          id_recorrente: string | null
          idempotency_key: string | null
          is_parcelado: boolean | null
          merchant: string | null
          observacao: string | null
          origem: string | null
          parcela: string | null
          parcela_atual: number | null
          parcelamento_id: string | null
          recorrente: boolean | null
          status: string | null
          tags: string[] | null
          tipo: string
          total_parcelas: number | null
          usuario_id: string | null
          valor: number
        }
        Insert: {
          atualizado_em?: string | null
          auto_imported?: boolean | null
          bank_connection_id?: string | null
          cartao_id?: string | null
          categoria: string
          context_id?: string | null
          created_at?: string | null
          data?: string
          data_transacao?: string | null
          descricao?: string | null
          essencial?: boolean | null
          expense_type?: string | null
          external_id?: string | null
          fatura_id?: string | null
          forma_pagamento?: string | null
          hash_unico?: string | null
          hora_transacao?: string | null
          id?: string
          id_cartao?: string | null
          id_recorrente?: string | null
          idempotency_key?: string | null
          is_parcelado?: boolean | null
          merchant?: string | null
          observacao?: string | null
          origem?: string | null
          parcela?: string | null
          parcela_atual?: number | null
          parcelamento_id?: string | null
          recorrente?: boolean | null
          status?: string | null
          tags?: string[] | null
          tipo: string
          total_parcelas?: number | null
          usuario_id?: string | null
          valor: number
        }
        Update: {
          atualizado_em?: string | null
          auto_imported?: boolean | null
          bank_connection_id?: string | null
          cartao_id?: string | null
          categoria?: string
          context_id?: string | null
          created_at?: string | null
          data?: string
          data_transacao?: string | null
          descricao?: string | null
          essencial?: boolean | null
          expense_type?: string | null
          external_id?: string | null
          fatura_id?: string | null
          forma_pagamento?: string | null
          hash_unico?: string | null
          hora_transacao?: string | null
          id?: string
          id_cartao?: string | null
          id_recorrente?: string | null
          idempotency_key?: string | null
          is_parcelado?: boolean | null
          merchant?: string | null
          observacao?: string | null
          origem?: string | null
          parcela?: string | null
          parcela_atual?: number | null
          parcelamento_id?: string | null
          recorrente?: boolean | null
          status?: string | null
          tags?: string[] | null
          tipo?: string
          total_parcelas?: number | null
          usuario_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_cartao_id_fkey"
            columns: ["cartao_id"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_context_id_fkey"
            columns: ["context_id"]
            isOneToOne: false
            referencedRelation: "user_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_context_id_fkey"
            columns: ["context_id"]
            isOneToOne: false
            referencedRelation: "vw_active_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_id_cartao_fkey"
            columns: ["id_cartao"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_id_recorrente_fkey"
            columns: ["id_recorrente"]
            isOneToOne: false
            referencedRelation: "gastos_recorrentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_id_recorrente_fkey"
            columns: ["id_recorrente"]
            isOneToOne: false
            referencedRelation: "vw_recorrencias_ativas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      user_contexts: {
        Row: {
          auto_tag: boolean
          created_at: string
          description: string | null
          end_date: string
          id: string
          label: string
          start_date: string
          status: string
          total_spent: number | null
          transaction_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_tag?: boolean
          created_at?: string
          description?: string | null
          end_date: string
          id?: string
          label: string
          start_date: string
          status?: string
          total_spent?: number | null
          transaction_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_tag?: boolean
          created_at?: string
          description?: string | null
          end_date?: string
          id?: string
          label?: string
          start_date?: string
          status?: string
          total_spent?: number | null
          transaction_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      user_onboarding: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_step: string | null
          financial_state: string | null
          first_name: string | null
          goal_amount: number | null
          goal_deadline: string | null
          goal_monthly: number | null
          goal_type: string | null
          main_problem: string | null
          monthly_income: number | null
          problem_details: Json | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          financial_state?: string | null
          first_name?: string | null
          goal_amount?: number | null
          goal_deadline?: string | null
          goal_monthly?: number | null
          goal_type?: string | null
          main_problem?: string | null
          monthly_income?: number | null
          problem_details?: Json | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          financial_state?: string | null
          first_name?: string | null
          goal_amount?: number | null
          goal_deadline?: string | null
          goal_monthly?: number | null
          goal_type?: string | null
          main_problem?: string | null
          monthly_income?: number | null
          problem_details?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_onboarding_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_onboarding_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_onboarding_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "user_onboarding_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      user_patterns: {
        Row: {
          confidence: number | null
          created_at: string | null
          decision_version: string | null
          expires_at: string | null
          id: string
          inferred_card_id: string | null
          inferred_category: string | null
          inferred_payment_method: string | null
          last_confirmed_by_user: boolean | null
          last_used_at: string | null
          merchant: string
          merchant_normalized: string
          source_transaction_id: string | null
          usage_count: number | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          decision_version?: string | null
          expires_at?: string | null
          id?: string
          inferred_card_id?: string | null
          inferred_category?: string | null
          inferred_payment_method?: string | null
          last_confirmed_by_user?: boolean | null
          last_used_at?: string | null
          merchant: string
          merchant_normalized: string
          source_transaction_id?: string | null
          usage_count?: number | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          decision_version?: string | null
          expires_at?: string | null
          id?: string
          inferred_card_id?: string | null
          inferred_category?: string | null
          inferred_payment_method?: string | null
          last_confirmed_by_user?: boolean | null
          last_used_at?: string | null
          merchant?: string
          merchant_normalized?: string
          source_transaction_id?: string | null
          usage_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_patterns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_patterns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_patterns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "user_patterns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          ip_address: string | null
          last_used_at: string
          phone_e164: string
          refresh_token: string | null
          revoked: boolean
          token: string
          user_agent: string | null
          usuario_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          last_used_at?: string
          phone_e164: string
          refresh_token?: string | null
          revoked?: boolean
          token: string
          user_agent?: string | null
          usuario_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          last_used_at?: string
          phone_e164?: string
          refresh_token?: string | null
          revoked?: boolean
          token?: string
          user_agent?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_sessions_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sessions_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "user_sessions_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      usuarios: {
        Row: {
          ativo: boolean | null
          auth_id: string | null
          created_at: string | null
          estado_financeiro: string | null
          id: string
          interacoes_hoje: number | null
          limite_transacoes_mes: number | null
          nome: string | null
          onboarding_status: string | null
          onboarding_step: string | null
          phone_e164: string | null
          phone_number: string
          plano: string | null
          preferencia_saudacao: string | null
          relatorio_mensal_pendente: boolean | null
          relatorio_semanal_pendente: boolean | null
          saldo_mensal: number | null
          trial_fim: string | null
          trial_inicio: string | null
          ultima_interacao: string | null
          ultimo_relatorio_mensal: string | null
          ultimo_relatorio_semanal: string | null
          ultimo_resumo: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          auth_id?: string | null
          created_at?: string | null
          estado_financeiro?: string | null
          id?: string
          interacoes_hoje?: number | null
          limite_transacoes_mes?: number | null
          nome?: string | null
          onboarding_status?: string | null
          onboarding_step?: string | null
          phone_e164?: string | null
          phone_number: string
          plano?: string | null
          preferencia_saudacao?: string | null
          relatorio_mensal_pendente?: boolean | null
          relatorio_semanal_pendente?: boolean | null
          saldo_mensal?: number | null
          trial_fim?: string | null
          trial_inicio?: string | null
          ultima_interacao?: string | null
          ultimo_relatorio_mensal?: string | null
          ultimo_relatorio_semanal?: string | null
          ultimo_resumo?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          auth_id?: string | null
          created_at?: string | null
          estado_financeiro?: string | null
          id?: string
          interacoes_hoje?: number | null
          limite_transacoes_mes?: number | null
          nome?: string | null
          onboarding_status?: string | null
          onboarding_step?: string | null
          phone_e164?: string | null
          phone_number?: string
          plano?: string | null
          preferencia_saudacao?: string | null
          relatorio_mensal_pendente?: boolean | null
          relatorio_semanal_pendente?: boolean | null
          saldo_mensal?: number | null
          trial_fim?: string | null
          trial_inicio?: string | null
          ultima_interacao?: string | null
          ultimo_relatorio_mensal?: string | null
          ultimo_relatorio_semanal?: string | null
          ultimo_resumo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      webhook_jobs: {
        Row: {
          attempts: number | null
          created_at: string | null
          dead_letter: boolean | null
          error: string | null
          id: string
          last_error: string | null
          max_retries: number | null
          message_id: string
          next_retry_at: string | null
          payload: Json
          priority: number | null
          processed_at: string | null
          retry_count: number | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          dead_letter?: boolean | null
          error?: string | null
          id?: string
          last_error?: string | null
          max_retries?: number | null
          message_id: string
          next_retry_at?: string | null
          payload: Json
          priority?: number | null
          processed_at?: string | null
          retry_count?: number | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          dead_letter?: boolean | null
          error?: string | null
          id?: string
          last_error?: string | null
          max_retries?: number | null
          message_id?: string
          next_retry_at?: string | null
          payload?: Json
          priority?: number | null
          processed_at?: string | null
          retry_count?: number | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ai_accuracy_summary: {
        Row: {
          accuracy_percent: number | null
          ai_classification: string | null
          avg_confidence: number | null
          correct_count: number | null
          error_count: number | null
          total_decisions: number | null
        }
        Relationships: []
      }
      queue_status: {
        Row: {
          current_transaction_id: string | null
          pending: number | null
          pending_slot: string | null
          phone_number: string | null
          processed_total: number | null
          processing: number | null
          state_updated_at: string | null
          user_id: string | null
          user_name: string | null
        }
        Relationships: []
      }
      vw_active_contexts: {
        Row: {
          auto_tag: boolean | null
          created_at: string | null
          description: string | null
          end_date: string | null
          id: string | null
          label: string | null
          start_date: string | null
          status: string | null
          time_remaining: string | null
          total_spent: number | null
          transaction_count: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          auto_tag?: boolean | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string | null
          label?: string | null
          start_date?: string | null
          status?: string | null
          time_remaining?: never
          total_spent?: number | null
          transaction_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          auto_tag?: boolean | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string | null
          label?: string | null
          start_date?: string | null
          status?: string | null
          time_remaining?: never
          total_spent?: number | null
          transaction_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "user_contexts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_brain_summary: {
        Row: {
          confianca_media_cache: number | null
          correcoes_confiantes: number | null
          padroes_ativos: number | null
          termos_aprendidos_ia: number | null
          termos_feedback: number | null
          termos_seed: number | null
        }
        Relationships: []
      }
      vw_cognitive_evolution: {
        Row: {
          dia: string | null
          metric_name: string | null
          ocorrencias: number | null
          total: number | null
        }
        Relationships: []
      }
      vw_contas_a_vencer: {
        Row: {
          ativa: boolean | null
          created_at: string | null
          dia_vencimento: number | null
          dias_ate_vencimento: number | null
          id: string | null
          lembrar_dias_antes: number | null
          nome: string | null
          phone_number: string | null
          tipo: string | null
          ultimo_lembrete: string | null
          updated_at: string | null
          usuario_id: string | null
          usuario_nome: string | null
          valor_estimado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_dashboard_usuario"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "contas_pagar_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_dashboard_usuario: {
        Row: {
          parcelas_ativas: number | null
          saldo_mes: number | null
          total_cartao_mes: number | null
          total_entradas_mes: number | null
          total_fixos_mes: number | null
          total_gastos_mes: number | null
          transacoes_no_mes: number | null
          usuario_id: string | null
        }
        Relationships: []
      }
      vw_faturas_em_aberto: {
        Row: {
          ano: number | null
          cartao_id: string | null
          cartao_nome: string | null
          created_at: string | null
          dia_vencimento: number | null
          id: string | null
          mes: number | null
          status: string | null
          updated_at: string | null
          usuario_id: string | null
          valor_pago: number | null
          valor_total: number | null
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
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
          {
            foreignKeyName: "faturas_cartao_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_gastos_categoria: {
        Row: {
          categoria: string | null
          mes: string | null
          quantidade: number | null
          total: number | null
          usuario_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "parcelamentos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "gastos_recorrentes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_resumo_mensal: {
        Row: {
          mes: string | null
          saldo: number | null
          total_entradas: number | null
          total_saidas: number | null
          total_transacoes: number | null
          usuario_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_resumo_mes_atual: {
        Row: {
          mes: string | null
          saldo_final: number | null
          total_entradas: number | null
          total_saidas: number | null
          total_transacoes: number | null
          usuario_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_semantic_learning: {
        Row: {
          categoria: string | null
          confidence: number | null
          created_at: string | null
          last_used_at: string | null
          source: string | null
          source_label: string | null
          termo: string | null
          usage_count: number | null
        }
        Insert: {
          categoria?: string | null
          confidence?: number | null
          created_at?: string | null
          last_used_at?: string | null
          source?: string | null
          source_label?: never
          termo?: string | null
          usage_count?: number | null
        }
        Update: {
          categoria?: string | null
          confidence?: number | null
          created_at?: string | null
          last_used_at?: string | null
          source?: string | null
          source_label?: never
          termo?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      vw_status_plano: {
        Row: {
          ativo: boolean | null
          dias_restantes_trial: number | null
          plano: string | null
          trial_fim: string | null
          trial_inicio: string | null
          usuario_id: string | null
        }
        Insert: {
          ativo?: never
          dias_restantes_trial?: never
          plano?: string | null
          trial_fim?: string | null
          trial_inicio?: string | null
          usuario_id?: string | null
        }
        Update: {
          ativo?: never
          dias_restantes_trial?: never
          plano?: string | null
          trial_fim?: string | null
          trial_inicio?: string | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      vw_transacoes_agrupadas_categoria: {
        Row: {
          categoria: string | null
          mes: string | null
          quantidade: number | null
          total: number | null
          usuario_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
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
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      vw_transacoes_mes_atual: {
        Row: {
          atualizado_em: string | null
          cartao_nome: string | null
          categoria: string | null
          created_at: string | null
          data: string | null
          descricao: string | null
          essencial: boolean | null
          fatura_id: string | null
          hash_unico: string | null
          id: string | null
          id_cartao: string | null
          id_recorrente: string | null
          merchant: string | null
          observacao: string | null
          origem: string | null
          parcela: string | null
          parcela_atual: number | null
          parcelamento_id: string | null
          recorrente: boolean | null
          status: string | null
          tipo: string | null
          total_parcelas: number | null
          usuario_id: string | null
          valor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transacoes_id_cartao_fkey"
            columns: ["id_cartao"]
            isOneToOne: false
            referencedRelation: "cartoes_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_id_recorrente_fkey"
            columns: ["id_recorrente"]
            isOneToOne: false
            referencedRelation: "gastos_recorrentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_id_recorrente_fkey"
            columns: ["id_recorrente"]
            isOneToOne: false
            referencedRelation: "vw_recorrencias_ativas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "queue_status"
            referencedColumns: ["user_id"]
          },
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
          {
            foreignKeyName: "transacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "vw_status_plano"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
    }
    Functions: {
      atualizar_limite_cartao: {
        Args: { p_cartao_id: string; p_operacao: string; p_valor: number }
        Returns: undefined
      }
      atualizar_resumo_mensal: {
        Args: { p_usuario: string }
        Returns: undefined
      }
      cleanup_expired_sessions: { Args: never; Returns: undefined }
      cleanup_old_pending_messages: { Args: never; Returns: number }
      feature_permitida: {
        Args: { p_feature: string; p_usuario_id: string }
        Returns: boolean
      }
      fn_adjust_alert_utility: { Args: never; Returns: undefined }
      fn_analise_consultiva: { Args: { p_usuario_id: string }; Returns: Json }
      fn_atualizar_interacao: {
        Args: { p_usuario_id: string }
        Returns: undefined
      }
      fn_cleanup_expired_contexts: { Args: never; Returns: undefined }
      fn_cleanup_expired_patterns: { Args: never; Returns: undefined }
      fn_cleanup_expired_selections: { Args: never; Returns: undefined }
      fn_close_card_faturas: { Args: never; Returns: undefined }
      fn_close_expired_contexts: { Args: never; Returns: undefined }
      fn_contas_para_lembrar: {
        Args: never
        Returns: {
          conta_id: string
          dia_vencimento: number
          dias_ate_vencimento: number
          nome: string
          phone_number: string
          usuario_id: string
          usuario_nome: string
          valor_estimado: number
        }[]
      }
      fn_daily_jobs: { Args: never; Returns: undefined }
      fn_disable_decision_version: {
        Args: { p_version: string }
        Returns: undefined
      }
      fn_generate_parcelas: {
        Args: { p_parcelamento_id: string }
        Returns: undefined
      }
      fn_process_recorrentes: { Args: never; Returns: undefined }
      fn_relatorio_mensal: {
        Args: { p_ano?: number; p_mes?: number; p_usuario_id: string }
        Returns: Json
      }
      fn_relatorio_semanal:
        | {
            Args: {
              p_data_fim?: string
              p_data_inicio?: string
              p_usuario_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_data_fim?: string
              p_data_inicio?: string
              p_tipo_periodo?: string
              p_usuario_id: string
            }
            Returns: Json
          }
      fn_update_resumo_mensal: {
        Args: { p_ano: number; p_mes: number; p_user_id: string }
        Returns: undefined
      }
      fn_verificar_alertas_orcamento: {
        Args: { p_usuario_id: string }
        Returns: {
          alerta_nivel: string
          categoria: string
          gasto_atual: number
          limite: number
          orcamento_id: string
          percentual: number
          tipo: string
        }[]
      }
      gerar_codigo_ativacao: {
        Args: {
          p_dias_validade?: number
          p_email?: string
          p_origem?: string
          p_phone_destino?: string
          p_plano?: string
          p_transaction_id?: string
          p_valor?: number
        }
        Returns: string
      }
      get_alert_stats: { Args: never; Returns: Json }
      is_service_role: { Args: never; Returns: boolean }
      is_user_owner: { Args: { target_user_id: string }; Returns: boolean }
      limpar_conversas_expiradas: { Args: never; Returns: undefined }
      normalize_phone_e164: { Args: { phone: string }; Returns: string }
      reset_user_conversation_state: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      rpc_criar_parcelamento: {
        Args: {
          p_categoria?: string
          p_data_primeira_parcela?: string
          p_descricao: string
          p_id_cartao?: string
          p_num_parcelas: number
          p_usuario_id: string
          p_valor_total: number
        }
        Returns: string
      }
      rpc_registrar_transacao: {
        Args: {
          p_categoria: string
          p_data?: string
          p_descricao?: string
          p_essencial?: boolean
          p_id_cartao?: string
          p_id_recorrente?: string
          p_origem?: string
          p_parcela_atual?: number
          p_parcelamento_id?: string
          p_status?: string
          p_tipo: string
          p_total_parcelas?: number
          p_usuario_id: string
          p_valor: number
        }
        Returns: {
          id: string
        }[]
      }
      validar_codigo_ativacao:
        | { Args: { p_codigo: string; p_usuario_id: string }; Returns: Json }
        | { Args: { p_codigo: string; p_usuario_id: string }; Returns: Json }
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
