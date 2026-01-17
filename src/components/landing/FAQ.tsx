import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "O que acontece depois do trial de 14 dias?",
    answer:
      "Após o trial, você pode escolher continuar com o plano Pro ou fazer downgrade para o plano Básico. Você será notificado antes do término do trial e pode cancelar a qualquer momento sem compromisso.",
  },
  {
    question: "Qual a diferença entre o plano Básico e o Pro?",
    answer:
      "O Básico inclui registro de gastos, relatórios e orçamentos simples — perfeito para quem quer organização. O Pro adiciona controle de cartões, parcelamentos, insights preditivos, gestão familiar e recomendações personalizadas — ideal para quem quer evoluir financeiramente.",
  },
  {
    question: "Preciso cadastrar cartão de crédito para o trial?",
    answer:
      "Não! O trial de 14 dias do plano Pro é completamente gratuito e não requer cartão de crédito. Você só cadastra se decidir continuar após o período de teste.",
  },
  {
    question: "Posso cancelar quando quiser?",
    answer:
      "Sim! Não há fidelidade ou multa de cancelamento. Você pode cancelar sua assinatura a qualquer momento diretamente pelo WhatsApp ou dashboard.",
  },
  {
    question: "Como funciona a ativação do Finax?",
    answer:
      "É simples: após a assinatura, você recebe um código de ativação. Basta enviar esse código para o Finax no WhatsApp e pronto — sua conta é ativada instantaneamente.",
  },
  {
    question: "O Finax funciona no meu país?",
    answer:
      "O Finax funciona em qualquer lugar que tenha WhatsApp! A moeda padrão é Real (BRL), mas você pode configurar outras moedas nas configurações.",
  },
  {
    question: "O que é gestão familiar?",
    answer:
      "A gestão familiar (disponível no Pro) permite que você compartilhe o controle financeiro com membros da sua família. Cada pessoa pode registrar gastos individualmente, e todos têm visão do orçamento compartilhado.",
  },
  {
    question: "Meus dados estão seguros?",
    answer:
      "Absolutamente! Usamos criptografia de ponta a ponta, nossos servidores são certificados e nunca compartilhamos seus dados. Você pode exportar ou deletar tudo quando quiser.",
  },
];

const FAQ = () => {
  return (
    <section id="faq" className="py-20 md:py-32">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">
            Perguntas <span className="text-gradient">frequentes</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Tire suas dúvidas sobre o Finax.
          </p>
        </div>

        {/* FAQ Accordion */}
        <div className="max-w-3xl mx-auto">
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="bg-card border border-border rounded-xl px-6 data-[state=open]:border-primary/30 transition-colors"
              >
                <AccordionTrigger className="text-left font-semibold hover:no-underline py-6">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground pb-6 leading-relaxed">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FAQ;
