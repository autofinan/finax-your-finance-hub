import { MessageSquare, Brain, Sparkles, ArrowRight, CheckCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const steps = [
  {
    icon: MessageSquare,
    title: "Manda mensagem",
    description: "Texto, áudio ou foto. Como você já faz no WhatsApp todo dia.",
    examples: [
      { text: '"Gastei 50 no uber"', type: "text" },
      { text: "🎤 Áudio de 3s", type: "audio" },
      { text: "📷 Foto do cupom", type: "image" },
    ],
    gradient: "from-[#6366F1] to-[#8B5CF6]",
  },
  {
    icon: Brain,
    title: "IA organiza tudo",
    description: "A Finax entende, categoriza e registra automaticamente. Você não precisa fazer nada.",
    examples: [
      { text: "Detectou: Uber", type: "ai" },
      { text: "Categoria: Transporte", type: "ai" },
      { text: "Forma: Débito", type: "ai" },
    ],
    gradient: "from-[#3B82F6] to-[#06B6D4]",
  },
  {
    icon: Sparkles,
    title: "Vê os resultados",
    description: "Relatórios, insights e alertas. Tudo no WhatsApp, quando você precisa.",
    examples: [
      { text: "Economizou 15%", type: "success" },
      { text: "Meta: 80% atingida", type: "goal" },
      { text: "Alerta: Limite próximo", type: "warning" },
    ],
    gradient: "from-[#10B981] to-[#14B8A6]",
  },
];

const HowItWorks = () => {
  return (
    <section id="como-funciona" className="relative py-24 md:py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-slate-900/50 to-background" />
      <div className="absolute top-20 left-0 w-96 h-96 bg-[#6366F1]/10 rounded-full blur-3xl" />
      <div className="absolute bottom-20 right-0 w-96 h-96 bg-[#3B82F6]/10 rounded-full blur-3xl" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-20 space-y-6">
          <Badge className="bg-[#6366F1]/10 text-[#6366F1] border border-[#6366F1]/30 px-4 py-2 text-sm">
            <Zap className="w-4 h-4 mr-2" />
            Mais fácil impossível
          </Badge>
          
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
            <span className="text-white">Simples como mandar</span>
            <br />
            <span className="bg-gradient-to-r from-[#6366F1] via-[#3B82F6] to-[#10B981] bg-clip-text text-transparent">
              uma mensagem
            </span>
          </h2>
          
          <p className="text-xl text-slate-400">
            Se você sabe usar o WhatsApp, <span className="text-white font-semibold">você já sabe usar o Finax</span>.
          </p>
        </div>

        {/* Steps Grid */}
        <div className="grid md:grid-cols-3 gap-8 relative">
          {/* Connecting Lines (Desktop) */}
          <div className="hidden md:block absolute top-12 left-[16.66%] right-[16.66%] h-1">
            <div className="h-full bg-gradient-to-r from-[#6366F1] via-[#3B82F6] to-[#10B981] opacity-20 rounded-full" />
          </div>

          {steps.map((step, index) => (
            <div key={step.title} className="relative group">
              {/* Step Number Badge */}
              <div className="absolute -top-3 -left-3 z-10">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${step.gradient} flex items-center justify-center shadow-lg shadow-${step.gradient}/50`}>
                  <span className="text-white font-bold text-lg">{index + 1}</span>
                </div>
              </div>

              {/* Card */}
              <div className="relative h-full bg-slate-900/50 backdrop-blur-sm border border-white/10 rounded-2xl p-8 transition-all duration-300 hover:border-white/20 hover:shadow-2xl hover:shadow-[#6366F1]/10 hover:-translate-y-2">
                {/* Gradient Border Glow */}
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${step.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300 blur-xl`} />

                {/* Icon */}
                <div className={`relative w-16 h-16 rounded-xl bg-gradient-to-br ${step.gradient} flex items-center justify-center mb-6 shadow-lg`}>
                  <step.icon className="w-8 h-8 text-white" />
                </div>

                {/* Content */}
                <h3 className="text-2xl font-bold text-white mb-3">{step.title}</h3>
                <p className="text-slate-400 mb-6 leading-relaxed">{step.description}</p>

                {/* Examples */}
                <div className="space-y-2">
                  {step.examples.map((example, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 p-3 rounded-lg ${
                        example.type === "text"
                          ? "bg-slate-800/50 border border-slate-700/50"
                          : example.type === "audio"
                          ? "bg-[#6366F1]/10 border border-[#6366F1]/20"
                          : example.type === "image"
                          ? "bg-[#3B82F6]/10 border border-[#3B82F6]/20"
                          : example.type === "ai"
                          ? "bg-[#3B82F6]/10 border border-[#3B82F6]/20"
                          : example.type === "success"
                          ? "bg-[#10B981]/10 border border-[#10B981]/20"
                          : example.type === "goal"
                          ? "bg-[#14B8A6]/10 border border-[#14B8A6]/20"
                          : "bg-[#F59E0B]/10 border border-[#F59E0B]/20"
                      }`}
                    >
                      <div
                        className={`w-2 h-2 rounded-full ${
                          example.type === "success"
                            ? "bg-[#10B981]"
                            : example.type === "warning"
                            ? "bg-[#F59E0B]"
                            : example.type === "goal"
                            ? "bg-[#14B8A6]"
                            : "bg-[#6366F1]"
                        } ${example.type === "success" || example.type === "warning" ? "animate-pulse" : ""}`}
                      />
                      <span className="text-sm text-slate-300 font-medium">{example.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Arrow (Mobile) */}
              {index < steps.length - 1 && (
                <div className="md:hidden flex justify-center my-6">
                  <ArrowRight className="w-8 h-8 text-slate-600 rotate-90 animate-bounce" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <div className="inline-flex items-center gap-3 bg-slate-900/50 backdrop-blur-sm border border-white/10 rounded-full px-6 py-4">
            <CheckCircle className="w-6 h-6 text-[#10B981]" />
            <span className="text-slate-300">
              <span className="text-white font-semibold">500+ usuários</span> já estão economizando com a Finax
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
