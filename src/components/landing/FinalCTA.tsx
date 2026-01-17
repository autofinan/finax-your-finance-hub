import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

const FinalCTA = () => {
  const scrollToPlans = () => {
    const element = document.getElementById("planos");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="py-20 md:py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 gradient-brand" />
      
      {/* Decorative Elements */}
      <div className="absolute top-10 left-10 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-white/10 rounded-full blur-3xl" />

      <div className="container mx-auto px-4 relative">
        <div className="text-center max-w-3xl mx-auto space-y-8">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>

          {/* Title */}
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
            Pronto para assumir o controle?
          </h2>

          {/* Description */}
          <p className="text-xl text-white/80 max-w-xl mx-auto">
            Comece agora e transforme sua relação com o dinheiro. São apenas 14 dias para descobrir uma nova forma de cuidar das suas finanças.
          </p>

          {/* CTA */}
          <div className="pt-4">
            <Button
              size="lg"
              variant="secondary"
              className="text-lg px-10 py-7 bg-white text-primary hover:bg-white/90 shadow-xl"
              onClick={scrollToPlans}
            >
              Começar Meu Trial Grátis
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </div>

          {/* Trust Note */}
          <p className="text-white/60 text-sm">
            Sem cartão de crédito • Sem compromisso • Cancele quando quiser
          </p>
        </div>
      </div>
    </section>
  );
};

export default FinalCTA;
