import { Check, Sparkles, ArrowRight, Crown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { useNavigate } from "react-router-dom";

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
      "Consulta de saldo",
    ],
    cta: "Começar com Básico",
    popular: false,
    plan: "basico" as const,
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
      "Projeções financeiras",
      "Gestão familiar",
      "Comparativos de períodos",
      "Recomendações de economia",
    ],
    cta: "Começar Trial Pro",
    popular: true,
    trial: true,
    plan: "pro" as const,
  },
];

const Pricing = () => {
  const { createCheckout, loading } = useStripeCheckout();
  const navigate = useNavigate();

  const handleCTA = async (plan: 'basico' | 'pro') => {
    // For now, redirect to auth first, then checkout will happen from dashboard
    // In production, you might want to create checkout session directly
    navigate('/auth', { state: { plan } });
  };

  return (
    <section id="planos" className="py-20 md:py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-secondary/30 via-background to-secondary/30" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      
      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <Badge variant="secondary" className="mb-4 bg-success/10 text-success border-success/20">
            14 dias grátis no plano Pro
          </Badge>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
            Planos que cabem no seu{" "}
            <span className="text-gradient">bolso</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            O Básico organiza sua vida financeira. O Pro te ajuda a evoluir de verdade.
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative p-8 rounded-3xl bg-card transition-all duration-300 hover:shadow-2xl ${
                plan.popular
                  ? "border-2 border-primary shadow-xl shadow-primary/10 hover:shadow-primary/20"
                  : "border-2 border-border hover:border-primary/30"
              }`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="gradient-brand border-0 px-4 py-1.5 text-sm shadow-lg shadow-primary/25">
                    <Sparkles className="w-4 h-4 mr-1" />
                    Mais Popular
                  </Badge>
                </div>
              )}

              {/* Plan Header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  {/* Trial Badge */}
                  {plan.trial && (
                    <Badge variant="outline" className="mb-3 bg-success/10 text-success border-success/30">
                      14 dias grátis
                    </Badge>
                  )}
                  <h3 className="text-2xl font-bold mb-1 flex items-center gap-2">
                    {plan.name}
                    {plan.popular && <Crown className="w-5 h-5 text-warning" />}
                  </h3>
                  <p className="text-muted-foreground">{plan.description}</p>
                </div>
                <div className={`p-3 rounded-xl ${plan.popular ? 'gradient-brand' : 'bg-primary/10'}`}>
                  <plan.icon className={`w-6 h-6 ${plan.popular ? 'text-white' : 'text-primary'}`} />
                </div>
              </div>

              {/* Price */}
              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-muted-foreground">R$</span>
                  <span className="text-5xl font-bold tracking-tight">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                {plan.trial && (
                  <p className="text-sm text-success mt-1">Comece grátis, pague depois</p>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-4 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        plan.popular
                          ? "gradient-brand shadow-sm"
                          : "bg-primary/10"
                      }`}
                    >
                      <Check
                        className={`w-3 h-3 ${
                          plan.popular ? "text-white" : "text-primary"
                        }`}
                      />
                    </div>
                    <span className="text-foreground/80">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Button
                size="lg"
                disabled={loading}
                className={`w-full text-lg py-6 transition-all duration-300 ${
                  plan.popular
                    ? "gradient-brand hover:opacity-90 shadow-lg shadow-primary/25 hover:shadow-primary/40"
                    : "bg-secondary hover:bg-secondary/80 text-foreground hover:text-primary"
                }`}
                onClick={() => handleCTA(plan.plan)}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Processando...
                  </span>
                ) : (
                  <>
                    {plan.cta}
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </>
                )}
              </Button>

              {/* No Card Note */}
              {plan.trial && (
                <p className="text-center text-sm text-muted-foreground mt-4">
                  ✓ Sem cartão de crédito • ✓ Cancele quando quiser
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Money Back Guarantee */}
        <div className="mt-12 text-center">
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground bg-card px-4 py-2 rounded-full border border-border">
            <span className="text-lg">🔒</span>
            Satisfação garantida ou seu dinheiro de volta em até 7 dias
          </p>
        </div>
      </div>
    </section>
  );
};

export default Pricing;
