import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, CheckCircle, TrendingUp, MessageCircle } from "lucide-react";
import WhatsAppMockup from "./WhatsAppMockup";

const WHATSAPP_NUMBER = '556581034588';
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=Oi`;

const Hero = () => {
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleStartTrial = () => {
    window.open(WHATSAPP_LINK, '_blank');
  };

  return (
    <section className="relative min-h-screen flex items-center pt-24 pb-16 overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Gradient Orbs */}
        <div className="absolute top-20 -left-40 w-96 h-96 bg-primary/30 rounded-full blur-3xl animate-pulse" style={{ animationDuration: "4s" }} />
        <div className="absolute top-40 right-0 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: "6s", animationDelay: "1s" }} />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: "5s", animationDelay: "2s" }} />
        
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--primary))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--primary))_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-[0.03]" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          
          {/* Left Content */}
          <div className="text-center lg:text-left space-y-8">
            
            {/* Badge with glow */}
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-primary/20 to-blue-500/20 border border-primary/30 backdrop-blur-sm shadow-lg shadow-primary/20">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-medium text-white">
                500+ usuários economizando 15% ao mês
              </span>
            </div>

            {/* Main Headline */}
            <div className="space-y-6">
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight">
                <span className="block text-white">
                  Pare de perder
                </span>
                <span className="block bg-gradient-to-r from-primary via-blue-500 to-emerald-400 bg-clip-text text-transparent">
                  dinheiro sem saber
                </span>
                <span className="block text-white">
                  onde.
                </span>
              </h1>
              
              <p className="text-xl md:text-2xl text-slate-300 max-w-2xl leading-relaxed">
                Sua IA financeira está no <span className="text-emerald-400 font-semibold">WhatsApp</span>.
                <br />
                Manda <span className="text-primary">áudio</span>, <span className="text-blue-400">foto</span> ou <span className="text-white">texto</span>.
                <br />
                A Finax organiza <span className="font-bold text-white">TUDO</span> automaticamente.
              </p>
            </div>

            {/* Value Props */}
            <div className="flex flex-col sm:flex-row gap-6 justify-center lg:justify-start">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                  <CheckCircle className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="text-left">
                  <div className="text-2xl font-bold text-white">15%</div>
                  <div className="text-sm text-slate-400">economia média</div>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                  <TrendingUp className="w-6 h-6 text-primary" />
                </div>
                <div className="text-left">
                  <div className="text-2xl font-bold text-white">2.3x</div>
                  <div className="text-sm text-slate-400">mais controle</div>
                </div>
              </div>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start pt-4">
              <Button
                size="lg"
                className="text-lg px-8 py-7 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-2xl shadow-emerald-500/40 hover:shadow-emerald-500/60 hover:scale-105 active:scale-95 border-0 text-white font-semibold"
                onClick={handleStartTrial}
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                Começar Trial Grátis
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
              
              <Button
                variant="outline"
                size="lg"
                className="text-lg px-8 py-7 border-2 border-white/20 hover:border-primary hover:bg-primary/10 transition-all backdrop-blur-sm text-white"
                onClick={() => scrollToSection("como-funciona")}
              >
                Ver como funciona
              </Button>
            </div>

            {/* Trust Indicators */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 pt-6">
              <div className="flex items-center gap-2 text-slate-300 text-sm">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                Sem cartão de crédito
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-600" />
              <div className="flex items-center gap-2 text-slate-300 text-sm">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                Cancele quando quiser
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-600" />
              <div className="flex items-center gap-2 text-slate-300 text-sm">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                14 dias grátis
              </div>
            </div>
          </div>

          {/* Right Content - WhatsApp Mockup */}
          <div className="relative flex justify-center lg:justify-end">
            {/* Glow effect behind mockup */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/30 to-blue-500/30 blur-3xl opacity-50" />
            
            <div className="relative">
              <WhatsAppMockup />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-900 to-transparent" />
    </section>
  );
};

export default Hero;
