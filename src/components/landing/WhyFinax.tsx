import { Brain, ShieldCheck, TrendingDown, Layers, Smartphone } from "lucide-react";

const differentiators = [
  {
    icon: Brain,
    title: "Inteligência contextual",
    description:
      "O Finax entende o momento financeiro do usuário, não apenas transações isoladas. Ele aprende com você.",
  },
  {
    icon: ShieldCheck,
    title: "Confirmação antes de errar",
    description:
      "Nada é registrado sem validação. Sem bagunça, sem erro silencioso. Você sempre confirma.",
  },
  {
    icon: TrendingDown,
    title: "Foco em sair do vermelho",
    description:
      "Alertas, insights e orientações para reduzir dívidas e evitar novos problemas financeiros.",
  },
  {
    icon: Layers,
    title: "Controle progressivo",
    description:
      "Do básico ao avançado, conforme o usuário evolui. Sem complexidade desnecessária no início.",
  },
  {
    icon: Smartphone,
    title: "Multicanal consciente",
    description:
      "WhatsApp para o simples. Dashboard para o complexo. Cada coisa no seu lugar.",
  },
];

const WhyFinax = () => {
  return (
    <section className="py-20 md:py-32 bg-secondary/30">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
            O Finax não é só onde você anota —{" "}
            <span className="text-gradient">é quem te acompanha</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Todos registram. Poucos acompanham. Menos ainda ajudam de verdade.
          </p>
        </div>

        {/* Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {differentiators.map((item, index) => (
            <div
              key={item.title}
              className={`group relative p-8 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 ${
                index === 4 ? "lg:col-span-1 lg:col-start-2" : ""
              }`}
            >
              {/* Gradient Accent */}
              <div className="absolute inset-0 gradient-brand opacity-0 group-hover:opacity-5 rounded-2xl transition-opacity duration-300" />

              {/* Icon */}
              <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center mb-6 shadow-lg shadow-primary/20 group-hover:scale-110 transition-transform">
                <item.icon className="w-7 h-7 text-white" />
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold mb-3">{item.title}</h3>
              <p className="text-muted-foreground leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        {/* Bottom Quote */}
        <div className="mt-16 text-center">
          <blockquote className="text-xl md:text-2xl font-medium text-foreground/80 italic max-w-2xl mx-auto">
            "O Finax não julga. Ele ajuda. Um assistente que te avisa antes de dar errado."
          </blockquote>
        </div>
      </div>
    </section>
  );
};

export default WhyFinax;
