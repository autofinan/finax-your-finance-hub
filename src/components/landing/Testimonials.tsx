import React from 'react';
import { Star, Quote, TrendingUp, Users, MessageCircle, Shield, CheckCircle } from 'lucide-react';

const testimonials = [
  {
    name: "Maria Silva",
    role: "Empreendedora",
    avatar: "M",
    quote: "Com o Finax descobri onde estava gastando demais. Agora controlo tudo direto no WhatsApp, sem complicação!",
    rating: 5,
    color: "from-pink-500 to-rose-500",
    highlight: "Economizou 30%"
  },
  {
    name: "João Pedro",
    role: "Desenvolvedor",
    avatar: "J",
    quote: "Finalmente um app que não preciso lembrar de abrir. Só mando mensagem e tá registrado. Genial!",
    rating: 5,
    color: "from-blue-500 to-cyan-500",
    highlight: "5 min/mês"
  },
  {
    name: "Ana Costa",
    role: "Professora",
    avatar: "A",
    quote: "Os alertas me salvaram várias vezes de estourar o orçamento. O Finax virou meu parceiro financeiro.",
    rating: 5,
    color: "from-purple-500 to-violet-500",
    highlight: "Zero surpresas"
  },
  {
    name: "Carlos Mendes",
    role: "Gerente de Vendas",
    avatar: "C",
    quote: "Uso o plano Pro com minha esposa. A gestão familiar mudou nossa relação com dinheiro.",
    rating: 5,
    color: "from-emerald-500 to-teal-500",
    highlight: "Casal feliz"
  },
];

const stats = [
  { value: "500+", label: "Usuários ativos", icon: Users, color: "text-indigo-400" },
  { value: "4.9", label: "Avaliação média", icon: Star, color: "text-amber-400" },
  { value: "50k+", label: "Transações registradas", icon: MessageCircle, color: "text-blue-400" },
  { value: "98%", label: "Satisfação", icon: TrendingUp, color: "text-emerald-400" },
];

const Testimonials = () => {
  return (
    <section className="py-20 md:py-32 relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      
      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 backdrop-blur-sm mb-4">
            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            <span className="text-sm font-medium text-amber-300">4.9 de 5 estrelas</span>
          </div>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
            Quem usa,{" "}
            <span className="bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
              recomenda
            </span>
          </h2>
          <p className="text-lg text-slate-300">
            Veja o que nossos usuários estão dizendo sobre o Finax.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-16">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="group text-center p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/10 hover:-translate-y-1 backdrop-blur-sm"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="inline-flex p-3 rounded-xl bg-indigo-500/10 mb-3 group-hover:scale-110 transition-transform">
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-slate-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8 mb-12">
          {testimonials.map((testimonial, index) => (
            <div
              key={testimonial.name}
              className="group relative p-8 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1 backdrop-blur-sm"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Highlight Badge */}
              <div className="absolute -top-3 right-6">
                <div className="px-3 py-1 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 text-xs font-bold text-white shadow-lg shadow-indigo-500/30">
                  {testimonial.highlight}
                </div>
              </div>

              {/* Quote Icon */}
              <Quote className="absolute top-6 right-6 w-8 h-8 text-indigo-500/20 group-hover:text-indigo-500/30 transition-colors" />

              {/* Rating */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="w-5 h-5 fill-amber-400 text-amber-400"
                  />
                ))}
              </div>

              {/* Quote */}
              <blockquote className="text-lg text-slate-200 mb-6 leading-relaxed">
                "{testimonial.quote}"
              </blockquote>

              {/* Author */}
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${testimonial.color} flex items-center justify-center text-white font-bold shadow-lg text-lg`}>
                  {testimonial.avatar}
                </div>
                <div>
                  <div className="font-semibold text-white">{testimonial.name}</div>
                  <div className="text-sm text-slate-400">{testimonial.role}</div>
                </div>
              </div>

              {/* Verified Badge */}
              <div className="absolute bottom-6 right-6">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-emerald-400 font-medium">Verificado</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust Seal */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span className="text-sm text-slate-300">
              <span className="font-medium text-white">Depoimentos verificados</span> • Usuários reais do Finax
            </span>
          </div>
        </div>

        {/* Call to Action */}
        <div className="mt-16 text-center">
          <p className="text-slate-400 mb-6">Junte-se a centenas de pessoas que já transformaram suas finanças</p>
          <button className="px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white font-semibold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all duration-300 hover:scale-[1.02] flex items-center gap-2 mx-auto">
            Começar agora grátis
            <Star className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
