import { MessageSquare, Brain, BarChart3, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: MessageSquare,
    title: "Converse com o Finax",
    description: "Registre seus gastos naturalmente, como se estivesse conversando com um amigo.",
    example: '"Gastei 50 no mercado"',
    color: "primary",
  },
  {
    icon: Brain,
    title: "IA interpreta pra você",
    description: "Sem rótulos estranhos ou botões difíceis. O Finax entende e registra automaticamente.",
    example: "Categoria detectada: Alimentação",
    color: "accent",
  },
  {
    icon: BarChart3,
    title: "Resultados reais",
    description: "Relatórios, alertas, insights e orçamento inteligente. Tudo no WhatsApp.",
    example: "Você economizou 15% este mês!",
    color: "success",
  },
];

const HowItWorks = () => {
  return (
    <section id="como-funciona" className="py-20 md:py-32 bg-secondary/30">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
            Simples como mandar uma{" "}
            <span className="text-gradient">mensagem</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Se você sabe usar o WhatsApp, você já sabe usar o Finax.
          </p>
        </div>

        {/* Steps */}
        <div className="grid md:grid-cols-3 gap-8 lg:gap-12 relative">
          {/* Connection Lines (Desktop) */}
          <div className="hidden md:block absolute top-24 left-1/3 right-1/3 h-0.5 bg-gradient-to-r from-primary via-accent to-success opacity-30" />

          {steps.map((step, index) => (
            <div key={step.title} className="relative group">
              {/* Card */}
              <div className="bg-card border border-border rounded-2xl p-8 h-full transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1">
                {/* Step Number */}
                <div className="absolute -top-4 -left-4 w-8 h-8 rounded-full gradient-brand flex items-center justify-center text-white font-bold text-sm shadow-lg">
                  {index + 1}
                </div>

                {/* Icon */}
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${
                    step.color === "primary"
                      ? "bg-primary/10"
                      : step.color === "accent"
                      ? "bg-accent/10"
                      : "bg-success/10"
                  }`}
                >
                  <step.icon
                    className={`w-8 h-8 ${
                      step.color === "primary"
                        ? "text-primary"
                        : step.color === "accent"
                        ? "text-accent"
                        : "text-success"
                    }`}
                  />
                </div>

                {/* Content */}
                <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                <p className="text-muted-foreground mb-4">{step.description}</p>

                {/* Example */}
                <div className="bg-secondary/50 rounded-lg px-4 py-3 text-sm font-medium text-foreground/80">
                  {step.example}
                </div>
              </div>

              {/* Arrow (Mobile) */}
              {index < steps.length - 1 && (
                <div className="md:hidden flex justify-center my-4">
                  <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
