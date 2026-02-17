// ============================================================================
// 👤 PERFIL DO CLIENTE - Extraído de index.ts para modularização
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function ensurePerfilCliente(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("perfil_cliente")
    .select("id")
    .eq("usuario_id", userId)
    .single();
  
  if (!existing) {
    console.log(`👤 [PERFIL] Criando perfil automático para: ${userId}`);
    await supabase.from("perfil_cliente").insert({
      usuario_id: userId,
      operation_mode: "normal",
      limites: { mensal: 0 },
      score_economia: 50,
      preferencias: {},
      metas_financeiras: {},
      insights: {}
    });
  }
}
