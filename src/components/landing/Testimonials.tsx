import { Star, Quote, TrendingUp, Users, MessageCircle, Shield } from "lucide-react";

const testimonials = [
  {
    name: "Maria Silva",
    role: "Empreendedora",
    avatar: "M",
    quote:
      "Com o Finax descobri onde estava gastando demais. Agora controlo tudo direto no WhatsApp, sem complicação!",
    rating: 5,
    color: "from-pink-500 to-rose-500",
  },
  {
    name: "João Pedro",
    role: "Desenvolvedor",
    avatar: "J",
    quote:
      "Finalmente um app que não preciso lembrar de abrir. Só mando mensagem e tá registrado. Genial!",
    rating: 5,
    color: "from-blue-500 to-cyan-500",
  },
  {
    name: "Ana Costa",
    role: "Professora",
    avatar: "A",
    quote:
      "Os alertas me salvaram várias vezes de estourar o orçamento. O Finax virou meu parceiro financeiro.",
    rating: 5,
    color: "from-purple-500 to-violet-500",
  },
  {
    name: "Carlos Mendes",
    role: "Gerente de Vendas",
    avatar: "C",
    quote:
      "Uso o plano Pro com minha esposa. A gestão familiar mudou nossa relação com dinheiro.",
    rating: 5,
    color: "from-emerald-500 to-teal-500",
  },
];

const stats = [
  { value: "500+", label: "Usuários ativos", icon: Users, color: "text-primary" },
  { value: "4.9", label: "Avaliação média", icon: Star, color: "text-warning" },
  { value: "50k+", label: "Transações registradas", icon: MessageCircle, color: "text-accent" },
  { value: "98%", label: "Satisfação", icon: TrendingUp, color: "text-success" },
];

const Testimonials = () => {
  return (
    <section className="py-20 md:py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-secondary/30 to-transparent" />
      
      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
            Quem usa, <span className="text-gradient">recomenda</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Veja o que nossos usuários estão dizendo sobre o Finax.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-16">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="relative group text-center p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className={`inline-flex p-3 rounded-xl bg-primary/10 mb-3 group-hover:scale-110 transition-transform`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div className="text-3xl md:text-4xl font-bold text-gradient mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          {testimonials.map((testimonial, index) => (
            <div
              key={testimonial.name}
              className="relative group p-8 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1"
            >
              {/* Quote Icon */}
              <Quote className="absolute top-6 right-6 w-8 h-8 text-primary/10 group-hover:text-primary/20 transition-colors" />

              {/* Rating - Filled Stars */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="w-5 h-5 fill-warning text-warning drop-shadow-sm"
                  />
                ))}
              </div>

              {/* Quote */}
              <blockquote className="text-lg text-foreground/90 mb-6 leading-relaxed">
                "{testimonial.quote}"
              </blockquote>

              {/* Author */}
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${testimonial.color} flex items-center justify-center text-white font-bold shadow-lg`}>
                  {testimonial.avatar}
                </div>
                <div>
                  <div className="font-semibold">{testimonial.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {testimonial.role}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust Seal */}
        <div className="mt-12 flex justify-center">
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-card border border-border">
            <Shield className="w-5 h-5 text-success" />
            <span className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Dados verificados</span> — Depoimentos reais de usuários
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
