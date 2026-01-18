import { Crown, Clock, Sparkles, AlertTriangle, ArrowRight, Zap } from 'lucide-react';
import { usePlanoStatus } from '@/hooks/usePlanoStatus';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export function PlanoCard() {
  const { planoStatus, loading, isTrialExpirado, isPro, isBasico, isTrial } = usePlanoStatus();

  if (loading || !planoStatus) return null;

  const getPlanoConfig = () => {
    if (isPro) {
      return {
        icon: Crown,
        label: 'Pro',
        color: 'from-amber-500 to-orange-500',
        bgColor: 'bg-amber-500/10',
        textColor: 'text-amber-400',
        borderColor: 'border-amber-500/30',
      };
    }
    if (isBasico) {
      return {
        icon: Sparkles,
        label: 'Básico',
        color: 'from-indigo-500 to-blue-500',
        bgColor: 'bg-indigo-500/10',
        textColor: 'text-indigo-400',
        borderColor: 'border-indigo-500/30',
      };
    }
    if (isTrialExpirado) {
      return {
        icon: AlertTriangle,
        label: 'Trial Expirado',
        color: 'from-red-500 to-rose-500',
        bgColor: 'bg-red-500/10',
        textColor: 'text-red-400',
        borderColor: 'border-red-500/30',
      };
    }
    return {
      icon: Clock,
      label: 'Trial',
      color: 'from-cyan-500 to-blue-500',
      bgColor: 'bg-cyan-500/10',
      textColor: 'text-cyan-400',
      borderColor: 'border-cyan-500/30',
    };
  };

  const config = getPlanoConfig();
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-slate-900/40 backdrop-blur-xl border rounded-2xl p-6 transition-all duration-500",
        isTrialExpirado 
          ? "border-red-500/50 hover:shadow-[0_0_40px_-15px_rgba(239,68,68,0.3)]" 
          : "border-white/5 hover:border-indigo-500/30 hover:shadow-[0_0_40px_-15px_rgba(79,70,229,0.2)]"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={cn("p-2.5 rounded-xl", config.bgColor)}>
            <Icon className={cn("w-5 h-5", config.textColor)} />
          </div>
          <h3 className="font-bold text-lg text-white">Seu Plano</h3>
        </div>
      </div>

      {/* Badge do Plano */}
      <div className="flex items-center justify-between mb-6">
        <div className={cn(
          "px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2",
          config.bgColor,
          config.textColor
        )}>
          <Icon className="w-4 h-4" />
          {config.label}
        </div>

        {isTrial && planoStatus.diasRestantesTrial && (
          <div className={cn(
            "px-3 py-1.5 rounded-full text-xs font-bold",
            planoStatus.alertaTrial === 'urgente' ? 'bg-red-500/10 text-red-400' :
            planoStatus.alertaTrial === 'aviso' ? 'bg-amber-500/10 text-amber-400' :
            'bg-slate-800 text-slate-400'
          )}>
            {planoStatus.diasRestantesTrial} dias restantes
          </div>
        )}
      </div>

      {/* TRIAL EXPIRADO */}
      {isTrialExpirado && (
        <div className="space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-sm text-red-400 leading-relaxed">
              ⏰ Seu período de teste acabou. Escolha um plano para continuar usando o Finax.
            </p>
          </div>
          
          <div className="space-y-2">
            <button className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl text-white font-bold shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 transition-all hover:scale-[1.02] flex items-center justify-center gap-2">
              <Crown className="w-4 h-4" />
              Assinar Pro
              <ArrowRight className="w-4 h-4" />
            </button>
            <button className="w-full py-3 px-4 bg-white/5 border border-white/10 rounded-xl text-white font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" />
              Plano Básico
            </button>
          </div>
        </div>
      )}

      {/* TRIAL ATIVO COM URGÊNCIA */}
      {isTrial && planoStatus.alertaTrial === 'urgente' && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-sm text-amber-400 leading-relaxed">
              ⚠️ Seu trial está acabando! Escolha um plano para não perder seus dados.
            </p>
          </div>
          <button className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-xl text-white font-bold shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 transition-all hover:scale-[1.02] flex items-center justify-center gap-2">
            <Zap className="w-4 h-4" />
            Escolher Plano Agora
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* PLANO ATIVO (PRO OU BÁSICO) */}
      {(isPro || isBasico) && (
        <div className="space-y-4">
          <div className={cn(
            "p-4 rounded-xl border",
            isPro ? "bg-amber-500/10 border-amber-500/20" : "bg-indigo-500/10 border-indigo-500/20"
          )}>
            <p className={cn(
              "text-sm leading-relaxed",
              isPro ? "text-amber-300" : "text-indigo-300"
            )}>
              {isPro 
                ? '✨ Você tem acesso a todas as funcionalidades premium do Finax.'
                : '📊 Funcionalidades essenciais para organizar suas finanças.'
              }
            </p>
          </div>

          {/* Features List */}
          <div className="space-y-2">
            {isPro ? (
              <>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Insights preditivos com IA
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Gestão familiar
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Metas avançadas
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  Registro automático de gastos
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  Relatórios semanais
                </div>
              </>
            )}
          </div>

          {isBasico && (
            <button className="w-full py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-white transition-all flex items-center justify-center gap-2">
              Fazer upgrade para Pro
              <Crown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
