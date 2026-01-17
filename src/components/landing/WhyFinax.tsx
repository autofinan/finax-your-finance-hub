import { useState, useEffect } from "react";
import { Brain, ShieldCheck, TrendingDown, Zap, CheckCircle, AlertTriangle, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const differentiators = [
  {
    icon: Brain,
    title: "IA que te conhece",
    description: "Aprende seus padrões de gastos e sugere economias personalizadas. Quanto mais você usa, mais inteligente fica.",
    example: "Você gasta R$ 450/mês com delivery. Cortando 30%, economiza R$ 1.620/ano",
    gradient: "from-[#6366F1] to-[#8B5CF6]",
  },
  {
    icon: ShieldCheck,
    title: "Zero erro silencioso",
    description: "Tudo é confirmado antes de registrar. Você nunca perde o controle por causa de um registro errado.",
    example: "Gastei 50 no mercado → Confirma: R$ 50 Alimentação? ✓",
    gradient: "from-[#10B981] to-[#14B8A6]",
  },
  {
    icon: TrendingDown,
    title: "Foco em sair do vermelho",
    description: "Alertas proativos quando você está gastando demais. Te avisa ANTES de estourar o orçamento.",
    example: "⚠️ Você atingiu 85% do limite de Lazer. Restam R$ 75 até o fim do mês",
    gradient: "from-[#F59E0B] to-[#EF4444]",
  },
  {
    icon: Zap,
    title: "Do básico ao avançado",
    description: "Começa simples: só registrar gastos. Depois evolui: metas, investimentos, consultoria personalizada.",
    example: "Semana 1: Registrando → Mês 3: Economizando 15% → Ano 1: Investindo",
    gradient: "from-[#3B82F6] to-[#06B6D4]",
  },
];

const liveExamples = [
  {
    title: "Registro instantâneo",
    messages: [
      { sender: "user", text: "Gastei 80 no mercado", time: "14:32" },
      { sender: "finax", text: "✅ R$ 80,00 - Mercado\n📂 Alimentação\n💳 Débito\n\n💡 Total em alimentação: R$ 650/mês", time: "14:32" },
    ],
  },
  {
    title: "Alerta inteligente",
    messages: [
      { sender: "finax", text: "⚠️ Atenção!\n\nVocê já gastou R$ 420 em Lazer este mês (84% do orçamento)\n\nRestam apenas R$ 80 até o limite\n\n💡 Que tal cortar 1 delivery?", time: "10:15" },
    ],
  },
  {
    title: "Insights valiosos",
    messages: [
      { sender: "user", text: "Como tá meu mês?", time: "18:45" },
      { sender: "finax", text: "📊 Resumo de Janeiro:\n\n💰 Saldo: +R$ 1.250\n📈 15% melhor que dezembro\n\n🎯 Se manter o ritmo:\n• Atinge meta viagem em 8 meses\n• Economiza R$ 15.000 no ano", time: "18:45" },
    ],
  },
];

const WhyFinax = () => {
  const [activeExample, setActiveExample] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveExample((prev) => (prev + 1) % liveExamples.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#6366F1]/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#10B981]/10 rounded-full blur-3xl" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center max-w-4xl mx-auto mb-20 space-y-6">
          <Badge className="bg-[#6366F1]/20 text-[#6366F1] border border-[#6366F1]/30 px-4 py-2 text-sm font-semibold">
            <Trophy className="w-4 h-4 mr-2" />
            Diferencial competitivo
          </Badge>
          
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
            <span className="text-white">Finax não é só onde você</span>
            <br />
            <span className="bg-gradient-to-r from-[#6366F1] via-[#3B82F6] to-[#10B981] bg-clip-text text-transparent">
              anota gastos
            </span>
          </h2>
          
          <p className="text-xl text-slate-300 leading-relaxed">
            É quem <span className="text-white font-semibold">te acompanha, alerta e evolui</span> com você.
            <br />
            Todos registram. Poucos acompanham. <span className="text-[#10B981] font-semibold">Menos ainda ajudam de verdade</span>.
          </p>
        </div>

        {/* Differentiators Grid */}
        <div className="grid md:grid-cols-2 gap-8 mb-24">
          {differentiators.map((item, index) => (
            <div
              key={item.title}
              className="group relative bg-slate-900/50 backdrop-blur-sm border border-white/10 rounded-2xl p-8 hover:border-white/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#6366F1]/10"
            >
              {/* Gradient Glow */}
              <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${item.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300 blur-xl`} />

              {/* Icon */}
              <div className={`relative w-16 h-16 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                <item.icon className="w-8 h-8 text-white" />
              </div>

              {/* Content */}
              <h3 className="text-2xl font-bold text-white mb-3">{item.title}</h3>
              <p className="text-slate-300 leading-relaxed mb-4">{item.description}</p>

              {/* Example */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 mt-4">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-[#10B981] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {item.example}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Live Examples Section */}
        <div className="bg-slate-900/80 backdrop-blur-xl border-2 border-[#6366F1]/30 rounded-3xl p-8 md:p-12">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Veja o Finax <span className="bg-gradient-to-r from-[#6366F1] to-[#10B981] bg-clip-text text-transparent">em ação</span>
            </h3>
            <p className="text-lg text-slate-400">
              Exemplos reais de como o Finax te ajuda no dia a dia
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {liveExamples.map((example, index) => (
              <div
                key={example.title}
                className={`relative transition-all duration-500 ${
                  index === activeExample ? "scale-105 opacity-100" : "scale-100 opacity-60 hover:opacity-80"
                }`}
              >
                {/* Example Title */}
                <div className="text-center mb-4">
                  <Badge className={`${
                    index === activeExample
                      ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white"
                      : "bg-slate-800 text-slate-400"
                  } px-4 py-2 text-sm font-semibold transition-all duration-500`}>
                    {example.title}
                  </Badge>
                </div>

                {/* Chat Container */}
                <div className="bg-[#0b141a] rounded-2xl overflow-hidden border-2 border-slate-700/50 shadow-xl">
                  {/* Header */}
                  <div className="bg-gradient-to-b from-[#202c33] to-[#111b21] px-4 py-3 flex items-center gap-3 border-b border-[#2a3942]">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6366F1] to-[#3B82F6] flex items-center justify-center">
                      <Zap className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-white font-semibold text-sm">Finax</p>
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-pulse" />
                        <p className="text-[#00a884] text-xs">online</p>
                      </div>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="p-4 space-y-3 min-h-[200px] bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIgZmlsbD0iIzBiMTQxYSIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMjAiIHI9IjEiIGZpbGw9IiMxZjJjMzQiIG9wYWNpdHk9Ii4zIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2EpIi8+PC9zdmc+')]">
                    {example.messages.map((msg, msgIndex) => (
                      <div
                        key={msgIndex}
                        className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} ${
                          index === activeExample ? "animate-scale-in" : ""
                        }`}
                        style={{ animationDelay: `${msgIndex * 300}ms` }}
                      >
                        <div
                          className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-line shadow-lg ${
                            msg.sender === "user"
                              ? "bg-[#005c4b] text-white rounded-tr-none"
                              : "bg-[#202c33] text-[#e9edef] rounded-tl-none"
                          }`}
                        >
                          {msg.text}
                          <div className={`flex items-center gap-1 mt-1 ${msg.sender === "user" ? "justify-end" : ""}`}>
                            <span className="text-[10px] text-[#8696a0]">{msg.time}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Indicators */}
          <div className="flex justify-center gap-2 mt-8">
            {liveExamples.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveExample(i)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === activeExample ? "bg-[#6366F1] w-8" : "bg-slate-700 w-2"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Bottom Quote */}
        <div className="mt-20 text-center">
          <div className="inline-block relative">
            <div className="absolute inset-0 bg-gradient-to-r from-[#6366F1]/20 to-[#10B981]/20 blur-2xl" />
            <blockquote className="relative text-2xl md:text-3xl font-bold text-white italic max-w-3xl mx-auto px-8 py-6">
              "O Finax não julga. Ele <span className="text-[#10B981]">ajuda</span>.
              <br />
              Um assistente que te <span className="text-[#6366F1]">avisa antes</span> de dar errado."
            </blockquote>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-8 mt-16 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent mb-2">
              15%
            </div>
            <div className="text-sm text-slate-400">economia média</div>
          </div>
          <div className="text-center">
            <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-[#10B981] to-[#14B8A6] bg-clip-text text-transparent mb-2">
              500+
            </div>
            <div className="text-sm text-slate-400">usuários ativos</div>
          </div>
          <div className="text-center">
            <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#06B6D4] bg-clip-text text-transparent mb-2">
              4.9★
            </div>
            <div className="text-sm text-slate-400">avaliação média</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default WhyFinax;
