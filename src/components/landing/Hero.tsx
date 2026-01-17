import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Sparkles, CreditCard } from "lucide-react";
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
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: "1.5s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-primary/5 to-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          {/* Left Content */}
          <div className="text-center lg:text-left space-y-8 animate-fade-in">
            {/* Badge */}
            <Badge variant="secondary" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary/10 text-primary border-0">
              <Sparkles className="w-4 h-4" />
              Trial Pro de 14 dias grátis
            </Badge>

            {/* Title */}
            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                <span className="text-gradient">Converse.</span>{" "}
                <span className="text-gradient-reverse">Organize.</span>{" "}
                <span className="text-foreground">Evolua.</span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed">
                O Finax transforma conversas em controle financeiro real — com IA que te ajuda a sair das dívidas, organizar seus gastos e evoluir financeiramente.
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Button
                size="lg"
                className="gradient-brand hover:opacity-90 transition-opacity text-lg px-8 py-6 shadow-lg shadow-primary/25"
                onClick={() => scrollToSection("planos")}
              >
                Comece seu Trial Grátis
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="text-lg px-8 py-6"
                onClick={() => scrollToSection("como-funciona")}
              >
                Ver como funciona
              </Button>
            </div>

            {/* Trust Badge */}
            <div className="flex items-center justify-center lg:justify-start gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 bg-secondary/50 px-3 py-1.5 rounded-full">
                <CreditCard className="w-4 h-4" />
                <span>Sem cartão de crédito</span>
              </div>
              <span>•</span>
              <span>Cancele quando quiser</span>
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
