import { Check, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const plans = [
  {
    name: "Básico",
    description: "Organização + Consciência",
    price: "19,90",
    period: "/mês",
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
  },
  {
    name: "Pro",
    description: "Controle Profundo + Evolução",
    price: "29,90",
    period: "/mês",
    features: [
      "Tudo do plano Básico",
      "Controle de cartões com limite",
      "Parcelamentos rastreados",
      "Insights preditivos",
      "Projeções financeiras",
      "Gestão familiar",
      "Comparativos de períodos",
      "Recomendações de economia",
    ],
    cta: "Começar Trial Pro",
    popular: true,
    trial: true,
  },
];

const Pricing = () => {
  const handleCTA = (planName: string) => {
    // TODO: Integrate with Stripe
    window.open("https://wa.me/5511999999999?text=Quero assinar o plano " + planName, "_blank");
  };

  return (
    <section id="planos" className="py-20 md:py-32 bg-secondary/30">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
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
              className={`relative p-8 rounded-3xl bg-card border-2 transition-all duration-300 hover:shadow-xl ${
                plan.popular
                  ? "border-primary shadow-xl shadow-primary/10"
                  : "border-border hover:border-primary/30"
              }`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="gradient-brand border-0 px-4 py-1 text-sm shadow-lg">
                    <Sparkles className="w-4 h-4 mr-1" />
                    Mais Popular
                  </Badge>
                </div>
              )}

              {/* Trial Badge */}
              {plan.trial && (
                <Badge variant="secondary" className="mb-4 bg-success/10 text-success border-0">
                  14 dias grátis
                </Badge>
              )}

              {/* Plan Info */}
              <div className="mb-6">
                <h3 className="text-2xl font-bold mb-1">{plan.name}</h3>
                <p className="text-muted-foreground">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-muted-foreground">R$</span>
                  <span className="text-5xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-4 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        plan.popular
                          ? "gradient-brand"
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
                className={`w-full text-lg py-6 ${
                  plan.popular
                    ? "gradient-brand hover:opacity-90"
                    : "bg-secondary hover:bg-secondary/80 text-foreground"
                }`}
                onClick={() => handleCTA(plan.name)}
              >
                {plan.cta}
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>

              {/* No Card Note */}
              {plan.trial && (
                <p className="text-center text-sm text-muted-foreground mt-4">
                  Sem cartão de crédito • Cancele quando quiser
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Pricing;
