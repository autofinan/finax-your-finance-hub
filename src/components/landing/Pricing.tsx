import React, { useState } from 'react';
import { Check, Sparkles, ArrowRight, Crown, Zap, Star, Users, TrendingUp, MessageCircle } from 'lucide-react';
import { CheckoutModal } from '@/components/checkout/CheckoutModal';

const WHATSAPP_NUMBER = '556581034588';
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=Oi`;

const plans = [
  {
    name: "Básico",
    description: "Organização + Consciência",
    price: "19,90",
    period: "/mês",
    icon: Zap,
    features: [
      "Registro automático de gastos",
      "Relatórios semanais e mensais",
      "Orçamentos por categoria",
      "Alertas de gastos",
      "Histórico completo",
      "Consulta de saldo instantânea",
    ],
    cta: "Assinar Básico",
    popular: false,
    plan: "basico" as const,
    users: "200+ usuários"
  },
  {
    name: "Pro",
    description: "Controle Profundo + Evolução",
    price: "29,90",
    period: "/mês",
    icon: Crown,
    features: [
      "Tudo do plano Básico",
      "Controle de cartões com limite",
      "Parcelamentos rastreados",
      "Insights preditivos com IA",
      "Consultor de compras inteligente",
      "Contextos temporários (viagens)",
      "Metas de economia avançadas",
      "Gestão familiar compartilhada",
      "Projeções financeiras",
      "Recomendações personalizadas",
    ],
    cta: "Começar Trial Pro Grátis",
    popular: true,
    trial: true,
    plan: "pro" as const,
    users: "300+ usuários"
  },
];

const Pricing = () => {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'basico' | 'pro'>('pro');

  const handleCTA = (plan: typeof plans[0]) => {
    if (plan.trial) {
      // Trial grátis → WhatsApp
      window.open(WHATSAPP_LINK, '_blank');
    } else {
      // Plano pago → Checkout
      setSelectedPlan(plan.plan);
      setCheckoutOpen(true);
    }
  };

  return (
    <section id="planos" className="py-20 md:py-32 relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      
      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-sm mb-4">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">
              14 dias grátis no plano Pro • Sem cartão de crédito
            </span>
          </div>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
            Planos que cabem no seu{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">
              bolso
            </span>
          </h2>
          <p className="text-lg text-slate-300">
            O Básico organiza sua vida financeira. O Pro te ajuda a{" "}
            <span className="text-white font-semibold">evoluir de verdade</span>.
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, index) => (
            <div
              key={plan.name}
              className={`relative p-8 rounded-3xl transition-all duration-300 ${
                plan.popular
                  ? "bg-gradient-to-b from-indigo-950/50 to-indigo-900/30 border-2 border-indigo-500/50 shadow-2xl shadow-indigo-500/20 hover:shadow-indigo-500/30 hover:border-indigo-400/60"
                  : "bg-white/5 border-2 border-white/10 hover:bg-white/10 hover:border-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/10"
              } backdrop-blur-sm hover:-translate-y-1`}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 border-0 shadow-lg shadow-indigo-500/50">
                    <Sparkles className="w-4 h-4 text-white" />
                    <span className="text-sm font-bold text-white">Mais Popular</span>
                  </div>
                </div>
              )}

              {/* Plan Header */}
              <div className="flex items-start justify-between mb-6">
                <div className="flex-1">
                  {/* Trial Badge */}
                  {plan.trial && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-3">
                      <Star className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-300">14 dias grátis</span>
                    </div>
                  )}
                  <h3 className="text-2xl font-bold mb-1 flex items-center gap-2 text-white">
                    {plan.name}
                    {plan.popular && <Crown className="w-5 h-5 text-amber-400" />}
                  </h3>
                  <p className="text-slate-400 mb-2">{plan.description}</p>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Users className="w-3.5 h-3.5" />
                    <span>{plan.users}</span>
                  </div>
                </div>
                <div className={`p-3 rounded-xl ${plan.popular ? 'bg-gradient-to-br from-indigo-500 to-blue-500 shadow-lg shadow-indigo-500/30' : 'bg-indigo-500/10'}`}>
                  <plan.icon className={`w-6 h-6 ${plan.popular ? 'text-white' : 'text-indigo-400'}`} />
                </div>
              </div>

              {/* Price */}
              <div className="mb-8 pb-8 border-b border-white/10">
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-slate-400 font-medium">R$</span>
                  <span className="text-5xl font-bold tracking-tight text-white">{plan.price}</span>
                  <span className="text-slate-400 font-medium">{plan.period}</span>
                </div>
                {plan.trial && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <p className="text-sm text-emerald-400 font-medium">Comece grátis, pague depois</p>
                  </div>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-3.5 mb-8">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        plan.popular
                          ? "bg-gradient-to-br from-indigo-500 to-blue-500 shadow-sm"
                          : "bg-indigo-500/20"
                      }`}
                    >
                      <Check
                        className={`w-3 h-3 ${
                          plan.popular ? "text-white" : "text-indigo-400"
                        }`}
                      />
                    </div>
                    <span className="text-slate-300 text-sm leading-relaxed">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                className={`w-full text-base font-semibold py-4 px-6 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 ${
                  plan.popular
                    ? "bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-[1.02]"
                    : "bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:border-indigo-500/50"
                }`}
                onClick={() => handleCTA(plan)}
              >
                {plan.trial ? (
                  <>
                    <MessageCircle className="w-5 h-5" />
                    {plan.cta}
                  </>
                ) : (
                  <>
                    {plan.cta}
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              {/* No Card Note */}
              {plan.trial && (
                <p className="text-center text-xs text-slate-500 mt-4 flex items-center justify-center gap-4">
                  <span className="flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Sem cartão
                  </span>
                  <span className="flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Cancele quando quiser
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Money Back Guarantee */}
        <div className="mt-16 text-center">
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm">
            <span className="text-2xl">🔒</span>
            <span className="text-sm text-slate-300">
              <span className="font-semibold text-white">Satisfação garantida</span> ou seu dinheiro de volta em até 7 dias
            </span>
          </div>
        </div>

        {/* Social Proof */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-8">
          {[
            { value: "500+", label: "Usuários ativos" },
            { value: "4.9", label: "Avaliação média" },
            { value: "98%", label: "Satisfação" }
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent mb-1">
                {stat.value}
              </div>
              <div className="text-xs text-slate-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Checkout Modal */}
      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        plan={selectedPlan}
      />
    </section>
  );
};

export default Pricing;
