import {
  Mic,
  Camera,
  Brain,
  CreditCard,
  Target,
  Bell,
  TrendingUp,
  Calendar,
  ShoppingBag,
  Zap,
  Shield,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const basicFeatures = [
  {
    icon: Mic,
    title: "Áudio inteligente",
    description: 'Manda áudio: "Gastei 50 no mercado" - A IA transcreve e registra tudo',
    gradient: "from-[#6366F1] to-[#8B5CF6]",
  },
  {
    icon: Camera,
    title: "Foto de cupom",
    description: "Tira foto do recibo. A IA lê valor, descrição e forma de pagamento",
    gradient: "from-[#3B82F6] to-[#06B6D4]",
  },
  {
    icon: Brain,
    title: "Categorização automática",
    description: '"Uber" = Transporte. "Mercado" = Alimentação. Sem você fazer nada.',
    gradient: "from-[#10B981] to-[#14B8A6]",
  },
  {
    icon: TrendingUp,
    title: "Relatórios semanais",
    description: "Toda segunda chega resumo: quanto gastou, onde economizou, tendências",
    gradient: "from-[#F59E0B] to-[#EF4444]",
  },
  {
    icon: Bell,
    title: "Alertas proativos",
    description: 'Avisa quando tá gastando demais: "Você atingiu 80% do limite de lazer"',
    gradient: "from-[#EC4899] to-[#8B5CF6]",
  },
  {
    icon: Calendar,
    title: "Gastos recorrentes",
    description: 'Registra uma vez: "Netflix 50 todo mês" - Finax lembra e cobra sempre',
    gradient: "from-[#06B6D4] to-[#3B82F6]",
  },
];

const proFeatures = [
  {
    icon: CreditCard,
    title: "Múltiplos cartões",
    description: "Controla Nubank, Itaú, Inter... Vê fatura, limite e quanto falta fechar",
    gradient: "from-[#6366F1] to-[#8B5CF6]",
    badge: "Pro",
  },
  {
    icon: Target,
    title: "Metas de economia",
    description: '"Quero juntar 15mil pra viagem Europa" - Acompanha progresso e sugere economias',
    gradient: "from-[#10B981] to-[#14B8A6]",
    badge: "Pro",
  },
  {
    icon: ShoppingBag,
    title: "Consultor de compras",
    description: '"Vale a pena comprar iPhone?" - IA analisa seu momento e recomenda',
    gradient: "from-[#F59E0B] to-[#EF4444]",
    badge: "Pro",
  },
  {
    icon: Zap,
    title: "Contextos (viagens)",
    description: '"Vou viajar pra Paris de 09 a 20" - Separa gastos da viagem automaticamente',
    gradient: "from-[#EC4899] to-[#8B5CF6]",
    badge: "Pro",
  },
  {
    icon: Users,
    title: "Gestão familiar",
    description: "Compartilha com cônjuge/filhos. Cada um manda gasto, tudo fica junto",
    gradient: "from-[#3B82F6] to-[#06B6D4]",
    badge: "Pro",
  },
  {
    icon: Shield,
    title: "Insights preditivos",
    description: '"No ritmo atual, você vai fechar o mês com R$ 300 negativos" + sugestões',
    gradient: "from-[#6366F1] to-[#3B82F6]",
    badge: "Pro",
  },
];

const Features = () => {
  return (
    <section id="funcionalidades" className="relative py-24 md:py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-slate-950" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-20 space-y-6">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
            <span className="text-white">Tudo que você precisa</span>
            <br />
            <span className="bg-gradient-to-r from-[#6366F1] via-[#3B82F6] to-[#10B981] bg-clip-text text-transparent">
              pra evoluir de verdade
            </span>
          </h2>
          <p className="text-xl text-slate-400">
            Do básico ao avançado. Conforme você evolui financeiramente.
          </p>
        </div>

        {/* Basic Features */}
        <div className="mb-24">
          <div className="flex items-center justify-center gap-4 mb-12">
            <h3 className="text-3xl font-bold text-white">Plano Básico</h3>
            <Badge className="bg-[#6366F1]/20 text-[#6366F1] border border-[#6366F1]/30 px-4 py-1 text-sm font-semibold">
              Organização + Consciência
            </Badge>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {basicFeatures.map((feature, index) => (
              <div
                key={feature.title}
                className="group relative bg-slate-900/50 backdrop-blur-sm border border-white/10 rounded-2xl p-6 hover:border-white/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#6366F1]/10"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {/* Gradient Glow */}
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300 blur-xl`} />

                {/* Icon */}
                <div className={`relative w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <feature.icon className="w-7 h-7 text-white" />
                </div>

                {/* Content */}
                <h4 className="text-lg font-bold text-white mb-2">{feature.title}</h4>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Pro Features */}
        <div className="relative">
          {/* Gradient Border Container */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#6366F1] via-[#8B5CF6] to-[#3B82F6] rounded-3xl blur-xl opacity-20" />
          
          <div className="relative bg-slate-900/80 backdrop-blur-xl border-2 border-[#6366F1]/30 rounded-3xl p-8 md:p-12">
            <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
              <h3 className="text-3xl font-bold text-white">Plano Pro</h3>
              <Badge className="bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white border-0 px-4 py-1.5 text-sm font-bold shadow-lg">
                Controle Profundo + Evolução
              </Badge>
              <Badge className="bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/30 px-4 py-1 text-sm font-semibold">
                14 dias grátis
              </Badge>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {proFeatures.map((feature, index) => (
                <div
                  key={feature.title}
                  className="group relative bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-6 hover:border-[#6366F1]/50 hover:bg-slate-800/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#6366F1]/20"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  {/* Pro Badge */}
                  <div className="absolute -top-3 -right-3">
                    <Badge className="bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white border-0 px-3 py-1 text-xs font-bold shadow-lg">
                      {feature.badge}
                    </Badge>
                  </div>

                  {/* Gradient Glow */}
                  <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300 blur-xl`} />

                  {/* Icon */}
                  <div className={`relative w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    <feature.icon className="w-7 h-7 text-white" />
                  </div>

                  {/* Content */}
                  <h4 className="text-lg font-bold text-white mb-2">{feature.title}</h4>
                  <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <p className="text-slate-400 mb-6">
            Todas as funcionalidades Pro disponíveis no <span className="text-white font-semibold">trial gratuito de 14 dias</span>
          </p>
          <button
            onClick={() => {
              const element = document.getElementById("planos");
              element?.scrollIntoView({ behavior: "smooth" });
            }}
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] hover:opacity-90 rounded-full text-white font-semibold transition-all hover:scale-105 active:scale-95 shadow-xl shadow-[#6366F1]/50"
          >
            Começar Trial Grátis
            <Zap className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default Features;
