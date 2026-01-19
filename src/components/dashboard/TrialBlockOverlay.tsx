import { motion } from 'framer-motion';
import { Lock, Crown, Sparkles, ArrowRight, Zap, Shield, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { CheckoutModal } from '@/components/checkout/CheckoutModal';

interface TrialBlockOverlayProps {
  onClose?: () => void;
}

export function TrialBlockOverlay({ onClose }: TrialBlockOverlayProps) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'basico' | 'pro'>('pro');

  const handleSelectPlan = (plan: 'basico' | 'pro') => {
    setSelectedPlan(plan);
    setCheckoutOpen(true);
  };

  const features = {
    basico: [
      'Registro automático via WhatsApp',
      'Relatórios semanais',
      'Controle de gastos recorrentes',
      'Suporte via chat',
    ],
    pro: [
      'Tudo do Básico +',
      'Insights preditivos com IA',
      'Gestão familiar (até 5 pessoas)',
      'Metas financeiras avançadas',
      'Alertas inteligentes personalizados',
      'Suporte prioritário',
    ],
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        {/* Backdrop with blur */}
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" />

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative w-full max-w-4xl"
        >
          {/* Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.2 }}
              className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center"
            >
              <Lock className="w-12 h-12 text-amber-400" />
            </motion.div>
            <h1 className="text-4xl font-black text-white mb-4">
              Seu período de teste acabou
            </h1>
            <p className="text-xl text-slate-400 max-w-xl mx-auto leading-relaxed">
              Foram <span className="text-white font-bold">14 dias</span> organizando sua vida financeira juntos. 
              <br />
              Quer continuar evoluindo comigo? 💙
            </p>
          </div>

          {/* Plans Grid */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Básico */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-6 hover:border-indigo-500/30 transition-all group"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-indigo-500/10">
                  <Sparkles className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Básico</h3>
                  <p className="text-sm text-slate-400">Para começar a organizar</p>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black text-white">R$ 19</span>
                  <span className="text-slate-400">,90/mês</span>
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {features.basico.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-slate-300">
                    <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                      <Zap className="w-3 h-3 text-indigo-400" />
                    </div>
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleSelectPlan('basico')}
                variant="outline"
                className="w-full py-6 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 font-bold group-hover:border-indigo-500/50"
              >
                Escolher Básico
              </Button>
            </motion.div>

            {/* Pro */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="relative bg-gradient-to-br from-amber-950/40 to-orange-950/40 backdrop-blur-xl border border-amber-500/30 rounded-3xl p-6 hover:border-amber-500/50 transition-all group"
            >
              {/* Popular Badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full text-xs font-bold text-white shadow-lg shadow-amber-500/30">
                  ⭐ MAIS POPULAR
                </div>
              </div>

              <div className="flex items-center gap-3 mb-4 pt-2">
                <div className="p-3 rounded-xl bg-amber-500/20">
                  <Crown className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Pro</h3>
                  <p className="text-sm text-amber-400/80">Controle total das finanças</p>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black text-white">R$ 29</span>
                  <span className="text-amber-400/80">,90/mês</span>
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {features.pro.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-slate-300">
                    <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <Crown className="w-3 h-3 text-amber-400" />
                    </div>
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleSelectPlan('pro')}
                className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold shadow-lg shadow-amber-500/30 group-hover:shadow-amber-500/40"
              >
                <Crown className="w-4 h-4 mr-2" />
                Assinar Pro
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>
          </div>

          {/* Trust Badges */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="flex flex-wrap justify-center gap-6 text-slate-500 text-sm"
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Pagamento seguro
            </div>
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Cancele quando quiser
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Ativação instantânea
            </div>
          </motion.div>
        </motion.div>
      </motion.div>

      <CheckoutModal 
        open={checkoutOpen} 
        onOpenChange={setCheckoutOpen}
        plan={selectedPlan}
      />
    </>
  );
}
