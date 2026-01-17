import {
  Wallet,
  PieChart,
  Bell,
  Calendar,
  CreditCard,
  TrendingUp,
  Users,
  Target,
  Zap,
  BarChart3,
  Shield,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const basicFeatures = [
  {
    icon: Wallet,
    title: "Registro automático",
    description: "Registre gastos naturalmente por mensagem de texto",
  },
  {
    icon: PieChart,
    title: "Relatórios semanais",
    description: "Resumos claros dos seus gastos toda semana",
  },
  {
    icon: Target,
    title: "Orçamentos simples",
    description: "Defina limites por categoria e acompanhe",
  },
  {
    icon: Bell,
    title: "Alertas de gastos",
    description: "Notificações quando se aproximar do limite",
  },
  {
    icon: Calendar,
    title: "Histórico completo",
    description: "Consulte transações passadas facilmente",
  },
  {
    icon: Shield,
    title: "Dados seguros",
    description: "Suas informações protegidas e privadas",
  },
];

const proFeatures = [
  {
    icon: CreditCard,
    title: "Cartões com limite",
    description: "Controle múltiplos cartões e faturas",
  },
  {
    icon: Zap,
    title: "Parcelamentos",
    description: "Rastreie todas as parcelas automaticamente",
  },
  {
    icon: TrendingUp,
    title: "Insights preditivos",
    description: "Projeções e tendências do seu dinheiro",
  },
  {
    icon: BarChart3,
    title: "Comparativos",
    description: "Compare períodos e identifique padrões",
  },
  {
    icon: Users,
    title: "Gestão familiar",
    description: "Compartilhe controle com sua família",
  },
  {
    icon: Sparkles,
    title: "Recomendações IA",
    description: "Dicas personalizadas de economia",
  },
];

const Features = () => {
  return (
    <section id="funcionalidades" className="py-20 md:py-32">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
            Tudo que você precisa para{" "}
            <span className="text-gradient">evoluir</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Do básico ao avançado, conforme você evolui financeiramente.
          </p>
        </div>

        {/* Basic Features */}
        <div className="mb-16">
          <div className="flex items-center gap-3 mb-8">
            <h3 className="text-2xl font-bold">Plano Básico</h3>
            <Badge variant="secondary" className="text-sm">
              Organização + Consciência
            </Badge>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {basicFeatures.map((feature) => (
              <div
                key={feature.title}
                className="group p-6 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h4 className="font-semibold mb-2">{feature.title}</h4>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Pro Features */}
        <div className="relative">
          {/* Gradient Border */}
          <div className="absolute inset-0 gradient-brand rounded-3xl opacity-10" />
          
          <div className="relative bg-card rounded-3xl border border-primary/20 p-8 md:p-12">
            <div className="flex flex-wrap items-center gap-3 mb-8">
              <h3 className="text-2xl font-bold">Plano Pro</h3>
              <Badge className="gradient-brand border-0 text-sm">
                Controle Profundo + Evolução
              </Badge>
              <Badge variant="outline" className="text-sm border-accent text-accent">
                Mais Popular
              </Badge>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {proFeatures.map((feature) => (
                <div
                  key={feature.title}
                  className="group p-6 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all duration-300"
                >
                  <div className="w-12 h-12 rounded-xl gradient-brand flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-primary/20">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <h4 className="font-semibold mb-2">{feature.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Features;
