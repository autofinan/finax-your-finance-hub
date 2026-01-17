import { useState, useEffect } from "react";
import { Check, CheckCheck, Send } from "lucide-react";
import finaxLogo from "@/assets/finax-logo-transparent.png";

interface Message {
  id: number;
  text: string;
  sender: "user" | "finax";
  delay: number;
}

const conversations = [
  // Conversa 1: Gasto simples
  [
    { id: 1, text: "Gastei 50 no uber", sender: "user" as const, delay: 800 },
    { id: 2, text: "✅ Registrado!\n\n🚗 Uber - R$ 50,00\n📂 Transporte\n💳 Débito\n📅 Hoje, 14:32\n\n💡 Você já gastou R$ 320,00 em transporte este mês", sender: "finax" as const, delay: 2200 },
  ],
  
  // Conversa 2: Múltiplos cartões
  [
    { id: 3, text: "Paguei 150 de luz no Nubank", sender: "user" as const, delay: 800 },
    { id: 4, text: "⚡ Conta de Luz registrada!\n\n💡 R$ 150,00\n💳 Nubank\n📂 Moradia\n\n📊 Fatura atual: R$ 1.234,50\n📅 Fecha em 5 dias\n\n⚠️ Você tá perto do limite!", sender: "finax" as const, delay: 2200 },
  ],
  
  // Conversa 3: Relatório
  [
    { id: 5, text: "Quanto gastei essa semana?", sender: "user" as const, delay: 800 },
    { id: 6, text: "📊 Resumo da Semana:\n\n💰 Total: R$ 487,50\n\n🍽️ Alimentação: R$ 180,00\n🚗 Transporte: R$ 120,00\n🎮 Lazer: R$ 87,50\n📦 Outros: R$ 100,00\n\n🎉 Você gastou 15% menos que a semana passada!", sender: "finax" as const, delay: 2200 },
  ],
  
  // Conversa 4: Meta
  [
    { id: 7, text: "Quero juntar 5000 pra uma viagem", sender: "user" as const, delay: 800 },
    { id: 8, text: "🎯 Meta criada!\n\n✈️ Viagem - R$ 5.000,00\n\n📊 Progresso: R$ 0,00 (0%)\n📅 Se economizar R$ 416/mês, alcança em 12 meses\n\n💡 Quer que eu sugira onde cortar gastos?", sender: "finax" as const, delay: 2200 },
  ],
];

const WhatsAppMockup = () => {
  const [currentConversation, setCurrentConversation] = useState(0);
  const [visibleMessages, setVisibleMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    // Reset state
    setVisibleMessages([]);
    setIsTyping(false);

    const messages = conversations[currentConversation];
    const timers: NodeJS.Timeout[] = [];

    messages.forEach((message) => {
      // Show typing before Finax messages
      if (message.sender === "finax") {
        const typingTimer = setTimeout(() => {
          setIsTyping(true);
        }, message.delay - 1000);
        timers.push(typingTimer);
      }

      // Show message
      const messageTimer = setTimeout(() => {
        setIsTyping(false);
        setVisibleMessages((prev) => [...prev, message]);
      }, message.delay);
      timers.push(messageTimer);
    });

    // Move to next conversation after 6s
    const nextTimer = setTimeout(() => {
      setCurrentConversation((prev) => (prev + 1) % conversations.length);
    }, 6000);
    timers.push(nextTimer);

    return () => timers.forEach(clearTimeout);
  }, [currentConversation]);

  return (
    <div className="relative w-full max-w-sm mx-auto">
      {/* Phone Frame with improved design */}
      <div className="relative bg-gradient-to-b from-slate-800 to-slate-900 rounded-[3rem] p-3 shadow-2xl border border-slate-700/50">
        {/* Phone Notch/Island */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-36 h-7 bg-black rounded-b-3xl z-20 flex items-center justify-center">
          <div className="w-16 h-1 bg-slate-800 rounded-full mt-1" />
        </div>
        
        {/* Screen */}
        <div className="bg-[#0b141a] rounded-[2.5rem] overflow-hidden shadow-inner">
          {/* WhatsApp Header - Improved */}
          <div className="relative bg-gradient-to-b from-[#202c33] to-[#111b21] px-5 py-4 flex items-center gap-3 border-b border-[#2a3942]">
            {/* Back button (decorative) */}
            <svg className="w-6 h-6 text-[#aebac1]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            
            {/* Avatar */}
            <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-[#6366F1] to-[#3B82F6] flex items-center justify-center overflow-hidden border-2 border-[#2a3942] shadow-lg">
              <img src={finaxLogo} alt="Finax" className="w-7 h-7 object-contain" />
            </div>
            
            {/* Info */}
            <div className="flex-1">
              <p className="text-white font-semibold text-base">Finax</p>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-[#00a884] rounded-full animate-pulse" />
                <p className="text-[#00a884] text-xs font-medium">online</p>
              </div>
            </div>
            
            {/* Icons (decorative) */}
            <div className="flex gap-6">
              <svg className="w-6 h-6 text-[#aebac1]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <svg className="w-6 h-6 text-[#aebac1]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
              </svg>
            </div>
          </div>

          {/* Chat Area with improved background */}
          <div className="h-[440px] p-4 space-y-3 overflow-hidden bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIgZmlsbD0iIzBiMTQxYSIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMjAiIHI9IjEiIGZpbGw9IiMxZjJjMzQiIG9wYWNpdHk9Ii4zIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2EpIi8+PC9zdmc+')] relative">
            {/* Date separator */}
            <div className="flex justify-center sticky top-0 z-10">
              <div className="bg-[#182229] px-3 py-1.5 rounded-lg shadow-md">
                <span className="text-[#8696a0] text-xs font-medium">HOJE</span>
              </div>
            </div>

            {visibleMessages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"} animate-scale-in`}
              >
                <div
                  className={`max-w-[82%] px-3.5 py-2.5 rounded-lg text-[15px] whitespace-pre-line shadow-lg ${
                    message.sender === "user"
                      ? "bg-[#005c4b] text-white rounded-tr-none"
                      : "bg-[#202c33] text-[#e9edef] rounded-tl-none"
                  }`}
                >
                  {message.text}
                  <div className={`flex items-center gap-1.5 mt-1.5 ${message.sender === "user" ? "justify-end" : ""}`}>
                    <span className="text-[10px] text-[#8696a0]">14:32</span>
                    {message.sender === "user" && (
                      <CheckCheck className="w-4 h-4 text-[#53bdeb]" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Typing Indicator - Improved */}
            {isTyping && (
              <div className="flex justify-start animate-fade-in">
                <div className="bg-[#202c33] text-white px-4 py-3.5 rounded-lg rounded-tl-none shadow-lg">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-[#8696a0] rounded-full animate-typing" />
                    <span className="w-2 h-2 bg-[#8696a0] rounded-full animate-typing" style={{ animationDelay: "0.2s" }} />
                    <span className="w-2 h-2 bg-[#8696a0] rounded-full animate-typing" style={{ animationDelay: "0.4s" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input Area - Improved */}
          <div className="bg-[#202c33] px-4 py-3 flex items-center gap-3 border-t border-[#2a3942]">
            <button className="text-[#8696a0] hover:text-white transition-colors">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
              </svg>
            </button>
            
            <div className="flex-1 bg-[#2a3942] rounded-full px-4 py-2.5 flex items-center gap-2">
              <span className="text-[#8696a0] text-[15px]">Mensagem</span>
            </div>
            
            <button className="w-11 h-11 rounded-full bg-[#00a884] flex items-center justify-center shadow-lg hover:bg-[#00c896] transition-all hover:scale-105 active:scale-95">
              <Send className="w-5 h-5 text-white" fill="white" />
            </button>
          </div>
        </div>
      </div>

      {/* Decorative glow effects */}
      <div className="absolute -top-8 -right-8 w-32 h-32 bg-[#6366F1]/20 rounded-full blur-2xl animate-pulse" />
      <div className="absolute -bottom-8 -left-8 w-28 h-28 bg-[#3B82F6]/20 rounded-full blur-2xl animate-pulse" style={{ animationDelay: "1s" }} />
      
      {/* Conversation Indicators */}
      <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex gap-2">
        {conversations.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === currentConversation ? "bg-[#6366F1] w-8" : "bg-slate-700 w-1.5"
            }`}
          />
        ))}
      </div>
    </div>
  );
};

export default WhatsAppMockup;
