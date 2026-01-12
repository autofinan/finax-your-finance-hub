// ============================================================================
// 🎯 INTENT: GOALS (Metas de Economia)
// ============================================================================
// Comandos:
// - "criar meta de 15000 para viagem europa até dezembro"
// - "quanto falta pra minha meta do carro?"
// - "adiciona 500 na meta viagem"
// - "minhas metas"
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordMetric } from "../governance/config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// 📦 INTERFACES
// ============================================================================

export interface CreateGoalParams {
  userId: string;
  name: string;
  targetAmount: number;
  deadline?: Date;
  category?: string;
  autoSavePercentage?: number;
}

export interface UpdateGoalParams {
  goalId: string;
  addAmount?: number;
  newTarget?: number;
  newDeadline?: Date;
  status?: "active" | "paused" | "completed";
}

// ============================================================================
// 🎯 CRIAR META
// ============================================================================

export async function createGoal(params: CreateGoalParams): Promise<string> {
  const {
    userId,
    name,
    targetAmount,
    deadline,
    category,
    autoSavePercentage
  } = params;

  console.log(`🎯 [GOALS] Criando meta: ${name} - R$ ${targetAmount}`);

  try {
    const { data, error } = await supabase.from("savings_goals").insert({
      user_id: userId,
      name,
      target_amount: targetAmount,
      current_amount: 0,
      deadline: deadline?.toISOString(),
      category,
      auto_save_percentage: autoSavePercentage,
      status: "active"
    }).select("id").single();

    if (error) {
      console.error("❌ [GOALS] Erro ao criar meta:", error);
      return "❌ Não consegui criar a meta. Tenta de novo?";
    }

    // Registrar métrica
    await recordMetric("goal_created", 1, { goal_id: data.id, user_id: userId });

    let response = `🎯 *Meta criada!*\n\n`;
    response += `📌 ${name}\n`;
    response += `💰 Objetivo: *R$ ${targetAmount.toFixed(2)}*\n`;
    
    if (deadline) {
      const deadlineStr = deadline.toLocaleDateString("pt-BR");
      response += `📅 Prazo: ${deadlineStr}\n`;
    }

    if (autoSavePercentage) {
      response += `🔄 Auto-save: ${autoSavePercentage}% das entradas\n`;
    }

    response += `\n_Manda "adiciona X na meta ${name}" pra contribuir!_`;

    return response;
  } catch (err) {
    console.error("❌ [GOALS] Erro ao criar meta:", err);
    return "❌ Erro ao criar meta. Tenta novamente!";
  }
}

// ============================================================================
// 💰 ADICIONAR VALOR À META
// ============================================================================

export async function addToGoal(
  userId: string,
  goalNameOrId: string,
  amount: number
): Promise<string> {
  console.log(`💰 [GOALS] Adicionando R$ ${amount} à meta: ${goalNameOrId}`);

  try {
    // Buscar meta por nome ou id
    const { data: goal, error: findError } = await supabase
      .from("savings_goals")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .or(`id.eq.${goalNameOrId},name.ilike.%${goalNameOrId}%`)
      .single();

    if (findError || !goal) {
      // Tentar busca mais ampla
      const { data: goals } = await supabase
        .from("savings_goals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .ilike("name", `%${goalNameOrId}%`);

      if (!goals || goals.length === 0) {
        return `❌ Não encontrei a meta "${goalNameOrId}".\n\nManda "minhas metas" pra ver suas metas ativas.`;
      }

      if (goals.length > 1) {
        const list = goals.map(g => `• ${g.name}`).join("\n");
        return `🤔 Encontrei várias metas:\n\n${list}\n\nQual delas você quer atualizar?`;
      }

      // Usar a única encontrada
      return await addToGoal(userId, goals[0].id, amount);
    }

    const newAmount = Number(goal.current_amount) + amount;
    const isComplete = newAmount >= Number(goal.target_amount);

    await supabase.from("savings_goals")
      .update({
        current_amount: newAmount,
        status: isComplete ? "completed" : "active",
        updated_at: new Date().toISOString()
      })
      .eq("id", goal.id);

    // Registrar métrica
    await recordMetric("goal_contribution", amount, { goal_id: goal.id, user_id: userId });

    const progress = (newAmount / Number(goal.target_amount) * 100).toFixed(1);
    const remaining = Number(goal.target_amount) - newAmount;

    if (isComplete) {
      await recordMetric("goal_completed", 1, { goal_id: goal.id, user_id: userId });
      return `🎉 *META ALCANÇADA!*\n\n` +
        `📌 ${goal.name}\n` +
        `💰 Total: *R$ ${newAmount.toFixed(2)}*\n\n` +
        `Parabéns! Você conseguiu! 🚀`;
    }

    return `✅ *Contribuição registrada!*\n\n` +
      `📌 ${goal.name}\n` +
      `➕ Adicionado: R$ ${amount.toFixed(2)}\n` +
      `💰 Acumulado: *R$ ${newAmount.toFixed(2)}*\n` +
      `📊 Progresso: ${progress}%\n` +
      `🎯 Faltam: R$ ${remaining.toFixed(2)}`;

  } catch (err) {
    console.error("❌ [GOALS] Erro ao adicionar à meta:", err);
    return "❌ Erro ao atualizar meta. Tenta novamente!";
  }
}

// ============================================================================
// 📋 LISTAR METAS
// ============================================================================

export async function listGoals(userId: string, status: "active" | "all" = "active"): Promise<string> {
  console.log(`📋 [GOALS] Listando metas do usuário: ${userId}`);

  try {
    let query = supabase
      .from("savings_goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (status === "active") {
      query = query.eq("status", "active");
    }

    const { data: goals, error } = await query;

    if (error) {
      console.error("❌ [GOALS] Erro ao listar metas:", error);
      return "❌ Erro ao buscar metas.";
    }

    if (!goals || goals.length === 0) {
      return "📋 Você ainda não tem metas criadas.\n\n" +
        "_Cria uma meta assim: \"criar meta de 10000 para viagem\"_";
    }

    let response = "🎯 *Suas Metas*\n\n";

    for (const goal of goals) {
      const current = Number(goal.current_amount);
      const target = Number(goal.target_amount);
      const progress = (current / target * 100).toFixed(0);
      const remaining = target - current;

      const statusEmoji = 
        goal.status === "completed" ? "✅" :
        goal.status === "paused" ? "⏸️" : "🎯";

      response += `${statusEmoji} *${goal.name}*\n`;
      response += `   💰 R$ ${current.toFixed(2)} / R$ ${target.toFixed(2)} (${progress}%)\n`;
      
      if (goal.status === "active" && remaining > 0) {
        response += `   🎯 Faltam: R$ ${remaining.toFixed(2)}\n`;
      }

      if (goal.deadline) {
        const deadline = new Date(goal.deadline).toLocaleDateString("pt-BR");
        response += `   📅 Prazo: ${deadline}\n`;
      }

      response += "\n";
    }

    const activeCount = goals.filter(g => g.status === "active").length;
    const completedCount = goals.filter(g => g.status === "completed").length;

    response += `📊 ${activeCount} ativas | ${completedCount} concluídas`;

    return response;

  } catch (err) {
    console.error("❌ [GOALS] Erro ao listar metas:", err);
    return "❌ Erro ao buscar metas.";
  }
}

// ============================================================================
// 📊 STATUS DE UMA META ESPECÍFICA
// ============================================================================

export async function getGoalStatus(userId: string, goalName: string): Promise<string> {
  console.log(`📊 [GOALS] Buscando status da meta: ${goalName}`);

  try {
    const { data: goals } = await supabase
      .from("savings_goals")
      .select("*")
      .eq("user_id", userId)
      .ilike("name", `%${goalName}%`);

    if (!goals || goals.length === 0) {
      return `❌ Não encontrei a meta "${goalName}".\n\nManda "minhas metas" pra ver suas metas.`;
    }

    const goal = goals[0];
    const current = Number(goal.current_amount);
    const target = Number(goal.target_amount);
    const progress = (current / target * 100).toFixed(1);
    const remaining = target - current;

    let response = `📊 *${goal.name}*\n\n`;
    response += `💰 Acumulado: *R$ ${current.toFixed(2)}*\n`;
    response += `🎯 Objetivo: R$ ${target.toFixed(2)}\n`;
    response += `📈 Progresso: ${progress}%\n`;

    if (goal.status === "active" && remaining > 0) {
      response += `🏃 Faltam: *R$ ${remaining.toFixed(2)}*\n`;

      if (goal.deadline) {
        const deadline = new Date(goal.deadline);
        const today = new Date();
        const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysLeft > 0) {
          const dailyNeeded = remaining / daysLeft;
          response += `📅 Prazo em ${daysLeft} dias\n`;
          response += `💡 Economize R$ ${dailyNeeded.toFixed(2)}/dia pra alcançar`;
        } else {
          response += `⚠️ Prazo expirado!`;
        }
      }
    } else if (goal.status === "completed") {
      response += `\n✅ *Meta alcançada!* 🎉`;
    }

    return response;

  } catch (err) {
    console.error("❌ [GOALS] Erro ao buscar status:", err);
    return "❌ Erro ao buscar status da meta.";
  }
}

// ============================================================================
// 🛑 PAUSAR/CANCELAR META
// ============================================================================

export async function updateGoalStatus(
  userId: string,
  goalName: string,
  newStatus: "paused" | "active" | "completed"
): Promise<string> {
  console.log(`🔄 [GOALS] Atualizando status de ${goalName} para ${newStatus}`);

  try {
    const { data: goals } = await supabase
      .from("savings_goals")
      .select("*")
      .eq("user_id", userId)
      .ilike("name", `%${goalName}%`);

    if (!goals || goals.length === 0) {
      return `❌ Não encontrei a meta "${goalName}".`;
    }

    const goal = goals[0];

    await supabase.from("savings_goals")
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", goal.id);

    await recordMetric("goal_status_changed", 1, { 
      goal_id: goal.id, 
      user_id: userId,
      new_status: newStatus 
    });

    const statusMessages: Record<string, string> = {
      paused: `⏸️ Meta "${goal.name}" pausada.`,
      active: `▶️ Meta "${goal.name}" reativada!`,
      completed: `✅ Meta "${goal.name}" marcada como concluída!`
    };

    return statusMessages[newStatus];

  } catch (err) {
    console.error("❌ [GOALS] Erro ao atualizar status:", err);
    return "❌ Erro ao atualizar meta.";
  }
}
