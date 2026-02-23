import { useState } from 'react';
import { Crown, Clock, Sparkles, AlertTriangle, ArrowRight, Zap } from 'lucide-react';
import { usePlanoStatus } from '@/hooks/usePlanoStatus';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { CheckoutModal } from '@/components/checkout/CheckoutModal';

export function PlanoCard() {
  const { plano, isTrialExpirado, isPro, isBasico, isTrial, diasRestantesTrial, alertaTrial, loading } = usePlanoStatus();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<'basico' | 'pro'>('pro');

  if (loading) return null;

  const openCheckout = (plan: 'basico' | 'pro') => {
    setCheckoutPlan(plan);
    setCheckoutOpen(true);
  };

  const getPlanoConfig = () => {
    if (isPro) return { icon: Crown, label: 'Pro', bgColor: 'bg-amber-500/10', textColor: 'text-amber-400', borderColor: 'border-amber-500/30' };
    if (isBasico) return { icon: Sparkles, label: 'Básico', bgColor: 'bg-primary/10', textColor: 'text-primary', borderColor: 'border-primary/30' };
    if (isTrialExpirado) return { icon: AlertTriangle, label: 'Trial Expirado', bgColor: 'bg-destructive/10', textColor: 'text-destructive', borderColor: 'border-destructive/30' };
    return { icon: Clock, label: 'Trial', bgColor: 'bg-accent/50', textColor: 'text-accent-foreground', borderColor: 'border-accent' };
  };

  const config = getPlanoConfig();
  const Icon = config.icon;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "bg-card/40 backdrop-blur-xl border rounded-2xl p-6 transition-all duration-500",
          isTrialExpirado
            ? "border-destructive/50 hover:shadow-[0_0_40px_-15px_hsl(var(--destructive)/0.3)]"
            : "border-border hover:border-primary/30 hover:shadow-[0_0_40px_-15px_hsl(var(--primary)/0.2)]"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={cn("p-2.5 rounded-xl", config.bgColor)}>
              <Icon className={cn("w-5 h-5", config.textColor)} />
            </div>
            <h3 className="font-bold text-lg text-foreground">Seu Plano</h3>
          </div>
        </div>

        {/* Badge */}
        <div className="flex items-center justify-between mb-6">
          <div className={cn("px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2", config.bgColor, config.textColor)}>
            <Icon className="w-4 h-4" />
            {config.label}
          </div>
          {isTrial && diasRestantesTrial && (
            <div className={cn(
              "px-3 py-1.5 rounded-full text-xs font-bold",
              alertaTrial === 'urgente' ? 'bg-destructive/10 text-destructive' :
              alertaTrial === 'aviso' ? 'bg-amber-500/10 text-amber-400' :
              'bg-muted text-muted-foreground'
            )}>
              {diasRestantesTrial} dias restantes
            </div>
          )}
        </div>

        {/* TRIAL EXPIRADO */}
        {isTrialExpirado && (
          <div className="space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
              <p className="text-sm text-destructive leading-relaxed">
                ⏰ Seu período de teste acabou. Escolha um plano para continuar usando o Finax.
              </p>
            </div>
            <div className="space-y-2">
              <button onClick={() => openCheckout('pro')} className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl text-white font-bold shadow-lg hover:scale-[1.02] transition-all flex items-center justify-center gap-2">
                <Crown className="w-4 h-4" /> Assinar Pro <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={() => openCheckout('basico')} className="w-full py-3 px-4 bg-muted/50 border border-border rounded-xl text-foreground font-bold hover:bg-muted transition-all flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4" /> Plano Básico
              </button>
            </div>
          </div>
        )}

        {/* TRIAL ATIVO COM URGÊNCIA */}
        {isTrial && alertaTrial === 'urgente' && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <p className="text-sm text-amber-400 leading-relaxed">
                ⚠️ Seu trial está acabando! Escolha um plano para não perder seus dados.
              </p>
            </div>
            <button onClick={() => openCheckout('pro')} className="w-full py-3 px-4 bg-gradient-to-r from-primary to-blue-500 rounded-xl text-primary-foreground font-bold shadow-lg hover:scale-[1.02] transition-all flex items-center justify-center gap-2">
              <Zap className="w-4 h-4" /> Escolher Plano Agora <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* PLANO ATIVO (PRO OU BÁSICO) */}
        {(isPro || isBasico) && (
          <div className="space-y-4">
            <div className={cn("p-4 rounded-xl border", isPro ? "bg-amber-500/10 border-amber-500/20" : "bg-primary/10 border-primary/20")}>
              <p className={cn("text-sm leading-relaxed", isPro ? "text-amber-300" : "text-primary")}>
                {isPro
                  ? '✨ Você tem acesso a todas as funcionalidades premium do Finax.'
                  : '📊 Funcionalidades essenciais para organizar suas finanças.'
                }
              </p>
            </div>
            <div className="space-y-2">
              {isPro ? (
                <>
                  <FeatureDot color="bg-amber-500" label="Insights preditivos com IA" />
                  <FeatureDot color="bg-amber-500" label="Simulador de quitação" />
                  <FeatureDot color="bg-amber-500" label="Consultor IA semanal" />
                </>
              ) : (
                <>
                  <FeatureDot color="bg-primary" label="Orçamentos e metas" />
                  <FeatureDot color="bg-primary" label="Relatórios semanais/mensais" />
                  <FeatureDot color="bg-primary" label="Recorrentes e parcelamentos" />
                </>
              )}
            </div>
            {isBasico && (
              <button onClick={() => openCheckout('pro')} className="w-full py-2.5 bg-muted/50 border border-border rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-all flex items-center justify-center gap-2">
                Fazer upgrade para Pro <Crown className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </motion.div>
      <CheckoutModal open={checkoutOpen} onOpenChange={setCheckoutOpen} plan={checkoutPlan} />
    </>
  );
}

function FeatureDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className={cn("w-1.5 h-1.5 rounded-full", color)} />
      {label}
    </div>
  );
}
