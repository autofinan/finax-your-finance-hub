import React, { useState } from 'react';
import { ChevronDown, HelpCircle, CheckCircle, MessageCircle } from 'lucide-react';

const faqs = [
  {
    question: "O que acontece depois do trial de 14 dias?",
    answer: "Após o trial, você pode escolher continuar com o plano Pro ou fazer downgrade para o plano Básico. Você será notificado antes do término do trial e pode cancelar a qualquer momento sem compromisso.",
    category: "trial"
  },
  {
    question: "Qual a diferença entre o plano Básico e o Pro?",
    answer: "O Básico inclui registro de gastos, relatórios e orçamentos simples — perfeito para quem quer organização. O Pro adiciona controle de cartões, parcelamentos, insights preditivos, gestão familiar e recomendações personalizadas — ideal para quem quer evoluir financeiramente.",
    category: "plans"
  },
  {
    question: "Preciso cadastrar cartão de crédito para o trial?",
    answer: "Não! O trial de 14 dias do plano Pro é completamente gratuito e não requer cartão de crédito. Você só cadastra se decidir continuar após o período de teste.",
    category: "trial"
  },
  {
    question: "Posso cancelar quando quiser?",
    answer: "Sim! Não há fidelidade ou multa de cancelamento. Você pode cancelar sua assinatura a qualquer momento diretamente pelo WhatsApp ou dashboard.",
    category: "plans"
  },
  {
    question: "Como funciona a ativação do Finax?",
    answer: "É simples: após a assinatura, você recebe um código de ativação. Basta enviar esse código para o Finax no WhatsApp e pronto — sua conta é ativada instantaneamente.",
    category: "setup"
  },
  {
    question: "O Finax funciona no meu país?",
    answer: "O Finax funciona em qualquer lugar que tenha WhatsApp! A moeda padrão é Real (BRL), mas você pode configurar outras moedas nas configurações.",
    category: "setup"
  },
  {
    question: "O que é gestão familiar?",
    answer: "A gestão familiar (disponível no Pro) permite que você compartilhe o controle financeiro com membros da sua família. Cada pessoa pode registrar gastos individualmente, e todos têm visão do orçamento compartilhado.",
    category: "features"
  },
  {
    question: "Meus dados estão seguros?",
    answer: "Absolutamente! Usamos criptografia de ponta a ponta, nossos servidores são certificados e nunca compartilhamos seus dados. Você pode exportar ou deletar tudo quando quiser.",
    category: "security"
  },
];

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState(null);

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-20 md:py-32 relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 right-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 backdrop-blur-sm mb-4">
            <HelpCircle className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-blue-300">Central de ajuda</span>
          </div>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
            Perguntas{" "}
            <span className="bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
              frequentes
            </span>
          </h2>
          <p className="text-lg text-slate-300">
            Tire suas dúvidas sobre o Finax. Se não encontrar a resposta, fale com a gente!
          </p>
        </div>

        {/* FAQ Accordion */}
        <div className="max-w-3xl mx-auto space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className={`rounded-2xl bg-white/5 border transition-all duration-300 backdrop-blur-sm ${
                openIndex === index
                  ? 'border-indigo-500/50 bg-white/10 shadow-lg shadow-indigo-500/10'
                  : 'border-white/10 hover:border-indigo-500/30 hover:bg-white/10'
              }`}
            >
              <button
                onClick={() => toggleFAQ(index)}
                className="w-full text-left px-6 py-6 flex items-center justify-between gap-4 group"
              >
                <div className="flex items-start gap-4 flex-1">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                    openIndex === index
                      ? 'bg-gradient-to-br from-indigo-500 to-blue-500'
                      : 'bg-indigo-500/10 group-hover:bg-indigo-500/20'
                  }`}>
                    {openIndex === index ? (
                      <CheckCircle className="w-5 h-5 text-white" />
                    ) : (
                      <HelpCircle className="w-5 h-5 text-indigo-400" />
                    )}
                  </div>
                  <span className="font-semibold text-white pt-1.5">{faq.question}</span>
                </div>
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 flex-shrink-0 transition-transform duration-300 ${
                    openIndex === index ? 'rotate-180 text-indigo-400' : ''
                  }`}
                />
              </button>
              
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  openIndex === index ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="px-6 pb-6 pl-20">
                  <p className="text-slate-300 leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Still Have Questions */}
        <div className="mt-16 text-center">
          <div className="inline-flex flex-col items-center gap-4 p-8 rounded-2xl bg-gradient-to-b from-indigo-950/50 to-indigo-900/30 border border-indigo-500/30 backdrop-blur-sm">
            <MessageCircle className="w-12 h-12 text-indigo-400" />
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Ainda tem dúvidas?</h3>
              <p className="text-slate-300 mb-4">Nossa equipe está pronta para ajudar você</p>
            </div>
            <button className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white font-semibold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all duration-300 hover:scale-[1.02] flex items-center gap-2">
              Falar com suporte
              <MessageCircle className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-8">
          {[
            { value: "< 2h", label: "Tempo médio de resposta" },
            { value: "99%", label: "Problemas resolvidos" },
            { value: "24/7", label: "Suporte disponível" }
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent mb-1">
                {stat.value}
              </div>
              <div className="text-xs text-slate-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQ;
