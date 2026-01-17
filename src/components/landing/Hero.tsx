import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Sparkles, CreditCard, CheckCircle, Star } from "lucide-react";
import WhatsAppMockup from "./WhatsAppMockup";

const Hero = () => {
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative min-h-screen flex items-center pt-20 pb-16 overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 -z-10">
        {/* Gradient Orbs */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/20 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: "1.5s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-primary/10 to-accent/10 rounded-full blur-3xl" />
        
        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--primary)/0.03)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--primary)/0.03)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
        
        {/* Floating Icons */}
        <div className="absolute top-32 right-1/4 text-success/30 animate-float hidden lg:block">
          <CheckCircle size={32} />
        </div>
        <div className="absolute bottom-40 left-1/4 text-warning/30 animate-float hidden lg:block" style={{ animationDelay: "1s" }}>
          <Star size={28} fill="currentColor" />
        </div>
      </div>

      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          {/* Left Content */}
          <div className="text-center lg:text-left space-y-8 animate-fade-in">
            {/* Badge */}
            <Badge variant="secondary" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gradient-to-r from-primary/10 to-accent/10 text-primary border border-primary/20 shadow-sm">
              <Sparkles className="w-4 h-4 text-accent" />
              Trial Pro de 14 dias grátis
            </Badge>

            {/* Title */}
            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
                <span className="text-gradient">Converse.</span>{" "}
                <span className="text-gradient-reverse">Organize.</span>{" "}
                <span className="relative">
                  Evolua.
                  <svg className="absolute -bottom-2 left-0 w-full" height="8" viewBox="0 0 100 8" preserveAspectRatio="none">
                    <path d="M0 7 Q 50 0 100 7" stroke="url(#gradient)" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="hsl(217 91% 60%)" />
                        <stop offset="100%" stopColor="hsl(258 90% 66%)" />
                      </linearGradient>
                    </defs>
                  </svg>
                </span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed">
                O Finax transforma conversas em controle financeiro real — com IA que te ajuda a sair das dívidas, organizar seus gastos e evoluir financeiramente.
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Button
                size="lg"
                className="gradient-brand hover:opacity-90 transition-all text-lg px-8 py-6 shadow-xl shadow-primary/30 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98]"
                onClick={() => scrollToSection("planos")}
              >
                Comece seu Trial Grátis
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="text-lg px-8 py-6 border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all"
                onClick={() => scrollToSection("como-funciona")}
              >
                Ver como funciona
              </Button>
            </div>

            {/* Trust Badges */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 text-sm">
              <div className="flex items-center gap-2 bg-card/80 backdrop-blur px-4 py-2 rounded-full border border-border shadow-sm">
                <CreditCard className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">Sem cartão de crédito</span>
              </div>
              <div className="flex items-center gap-2 bg-card/80 backdrop-blur px-4 py-2 rounded-full border border-border shadow-sm">
                <CheckCircle className="w-4 h-4 text-success" />
                <span className="text-muted-foreground">Cancele quando quiser</span>
              </div>
            </div>

            {/* Social Proof */}
            <div className="flex items-center justify-center lg:justify-start gap-6 pt-4">
              <div className="flex -space-x-3">
                {["M", "J", "A", "C"].map((letter, i) => (
                  <div
                    key={letter}
                    className="w-10 h-10 rounded-full gradient-brand flex items-center justify-center text-white font-semibold text-sm border-2 border-background shadow-lg"
                    style={{ zIndex: 4 - i }}
                  >
                    {letter}
                  </div>
                ))}
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">500+</span> usuários ativos
                </p>
              </div>
            </div>
          </div>

          {/* Right Content - WhatsApp Mockup */}
          <div className="flex justify-center lg:justify-end animate-slide-up" style={{ animationDelay: "0.2s" }}>
            <WhatsAppMockup />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
