import React from 'react';
import { ArrowRight, Sparkles, Zap, TrendingUp, Shield, CheckCircle } from 'lucide-react';

const FinalCTA = () => {
  const scrollToPlans = () => {
    const element = document.getElementById("planos");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const benefits = [
    { icon: Zap, text: "Configure em 2 minutos" },
    { icon: Shield, text: "Sem cartão de crédito" },
    { icon: TrendingUp, text: "Resultados desde o dia 1" },
    { icon: CheckCircle, text: "Cancele quando quiser" }
  ];

  return (
    <section className="py-20 md:py-32 relative overflow-hidden bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-900">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-indigo-600/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.05)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center max-w-4xl mx-auto space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-indigo-500/20 to-blue-500/20 border border-indigo-500/30 backdrop-blur-sm">
            <Sparkles className="w-4 h-4 text-indigo-300" />
            <span className="text-sm font-medium text-indigo-200">
              Junte-se a 500+ pessoas que já transformaram suas finanças
            </span>
          </div>

          {/* Main Title */}
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            Pronto para assumir o{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
              controle?
            </span>
          </h2>

          {/* Description */}
          <p className="text-xl md:text-2xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Comece agora e transforme sua relação com o dinheiro. 
            São apenas <span className="text-white font-semibold">14 dias</span> para descobrir uma nova forma de cuidar das suas finanças.
          </p>

          {/* Benefits Grid */}
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto py-6">
            {benefits.map((benefit, index) => (
              <div
                key={benefit.text}
                className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 hover:border-indigo-500/30 transition-all duration-300"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                  <benefit.icon className="w-4 h-4 text-indigo-400" />
                </div>
                <span className="text-sm text-slate-200 font-medium text-left">{benefit.text}</span>
              </div>
            ))}
          </div>

          {/* Main CTA */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={scrollToPlans}
              className="group px-10 py-5 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white text-lg font-bold shadow-2xl shadow-indigo-500/40 hover:shadow-indigo-500/60 transition-all duration-300 hover:scale-[1.02] flex items-center gap-3"
            >
              <Sparkles className="w-5 h-5" />
              Começar Meu Trial Grátis
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {/* Trust Elements */}
          <div className="flex flex-wrap items-center justify-center gap-6 pt-6">
            {[
              "✓ Sem cartão de crédito",
              "✓ Sem compromisso",
              "✓ Cancele quando quiser",
              "✓ Suporte em português"
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 text-sm text-slate-400"
              >
                <span>{item}</span>
              </div>
            ))}
          </div>

          {/* Social Proof */}
          <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-8 text-slate-400 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {['M', 'J', 'A', 'C'].map((letter, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold border-2 border-slate-900"
                  >
                    {letter}
                  </div>
                ))}
              </div>
              <span className="text-slate-300 ml-2">
                <span className="font-semibold text-white">500+</span> já começaram
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <svg
                    key={star}
                    className="w-4 h-4 text-amber-400 fill-amber-400"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <span className="text-slate-300">
                <span className="font-semibold text-white">4.9/5</span> avaliação
              </span>
            </div>
          </div>

          {/* Final Push */}
          <div className="pt-6">
            <p className="text-slate-400 text-lg">
              Não deixe para amanhã o controle que você pode ter{" "}
              <span className="text-white font-semibold">hoje</span>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FinalCTA;
