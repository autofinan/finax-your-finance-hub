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
  [
    { id: 1, text: "Gastei 50 reais no mercado", sender: "user" as const, delay: 500 },
    { id: 2, text: "✅ Registrado!\n\n🛒 Mercado - R$ 50,00\n📁 Categoria: Alimentação\n📅 Hoje, 14:32\n\nSeu gasto com Alimentação este mês: R$ 850,00", sender: "finax" as const, delay: 1500 },
  ],
  [
    { id: 3, text: "Quanto gastei essa semana?", sender: "user" as const, delay: 500 },
    { id: 4, text: "📊 Resumo da Semana:\n\n💰 Total: R$ 487,50\n\n🍽️ Alimentação: R$ 180,00\n🚗 Transporte: R$ 120,00\n🎮 Lazer: R$ 87,50\n📦 Outros: R$ 100,00\n\n💡 Você gastou 15% menos que a semana passada! 🎉", sender: "finax" as const, delay: 1500 },
  ],
  [
    { id: 5, text: "Paguei 150 de luz no Nubank", sender: "user" as const, delay: 500 },
    { id: 6, text: "⚡ Registrado!\n\n💡 Conta de Luz - R$ 150,00\n💳 Cartão: Nubank\n📁 Categoria: Moradia\n\n📈 Sua fatura do Nubank: R$ 1.234,50\n📅 Fecha em 5 dias", sender: "finax" as const, delay: 1500 },
  ],
  [
    { id: 7, text: "Quero criar um orçamento de 500 reais para lazer", sender: "user" as const, delay: 500 },
    { id: 8, text: "🎯 Orçamento criado!\n\n🎮 Lazer: R$ 500,00/mês\n\n📊 Uso atual: R$ 87,50 (17%)\n💪 Você ainda pode gastar: R$ 412,50\n\n✨ Vou te avisar quando chegar em 80%!", sender: "finax" as const, delay: 1500 },
  ],
];

const WhatsAppMockup = () => {
  const [currentConversation, setCurrentConversation] = useState(0);
  const [visibleMessages, setVisibleMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    setVisibleMessages([]);
    setIsTyping(false);

    const messages = conversations[currentConversation];
    const timers: NodeJS.Timeout[] = [];

    messages.forEach((message) => {
      // Show typing indicator before Finax messages
      if (message.sender === "finax") {
        const typingTimer = setTimeout(() => {
          setIsTyping(true);
        }, message.delay - 800);
        timers.push(typingTimer);
      }

      const messageTimer = setTimeout(() => {
        setIsTyping(false);
        setVisibleMessages((prev) => [...prev, message]);
      }, message.delay);
      timers.push(messageTimer);
    });

    // Move to next conversation
    const nextTimer = setTimeout(() => {
      setCurrentConversation((prev) => (prev + 1) % conversations.length);
    }, 5000);
    timers.push(nextTimer);

    return () => timers.forEach(clearTimeout);
  }, [currentConversation]);

  return (
    <div className="relative w-full max-w-sm">
      {/* Phone Frame */}
      <div className="relative bg-gradient-to-b from-card to-card/95 rounded-[2.5rem] p-2 shadow-2xl shadow-primary/20 border border-border/50">
        {/* Phone Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-foreground rounded-b-2xl" />
        
        {/* Screen */}
        <div className="bg-[#0b141a] rounded-[2rem] overflow-hidden">
          {/* WhatsApp Header */}
          <div className="bg-gradient-to-r from-[#1f2c34] to-[#25333d] px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center overflow-hidden border border-white/20">
              <img src={finaxLogo} alt="Finax" className="w-8 h-8 object-contain" />
            </div>
            <div className="flex-1">
              <p className="text-white font-medium text-sm">Finax</p>
              <p className="text-[#00a884] text-xs flex items-center gap-1">
                <span className="w-2 h-2 bg-[#00a884] rounded-full animate-pulse"></span>
                online
              </p>
            </div>
          </div>

          {/* Chat Area */}
          <div className="h-[420px] p-3 space-y-2 overflow-hidden bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIgZmlsbD0iIzBiMTQxYSIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMjAiIHI9IjEiIGZpbGw9IiMxZjJjMzQiIG9wYWNpdHk9Ii4zIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2EpIi8+PC9zdmc+')]">
            {visibleMessages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"} animate-scale-in`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-line shadow-md ${
                    message.sender === "user"
                      ? "bg-[#005c4b] text-white rounded-tr-none"
                      : "bg-[#1f2c34] text-white rounded-tl-none"
                  }`}
                >
                  {message.text}
                  <div className={`flex items-center gap-1 mt-1 ${message.sender === "user" ? "justify-end" : ""}`}>
                    <span className="text-[10px] text-[#8696a0]">14:32</span>
                    {message.sender === "user" && (
                      <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex justify-start animate-fade-in">
                <div className="bg-[#1f2c34] text-white px-4 py-3 rounded-lg rounded-tl-none shadow-md">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-[#8696a0] rounded-full animate-typing" />
                    <span className="w-2 h-2 bg-[#8696a0] rounded-full animate-typing" style={{ animationDelay: "0.2s" }} />
                    <span className="w-2 h-2 bg-[#8696a0] rounded-full animate-typing" style={{ animationDelay: "0.4s" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="bg-[#1f2c34] px-3 py-2 flex items-center gap-2">
            <div className="flex-1 bg-[#2a3942] rounded-full px-4 py-2.5 flex items-center">
              <span className="text-[#8696a0] text-sm">Mensagem</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center shadow-lg cursor-pointer hover:bg-[#00c896] transition-colors">
              <Send className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Decorative Elements */}
      <div className="absolute -top-6 -right-6 w-24 h-24 bg-accent/30 rounded-full blur-xl animate-pulse-slow" />
      <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-primary/30 rounded-full blur-xl animate-pulse-slow" style={{ animationDelay: "1s" }} />
      
      {/* Conversation Indicators */}
      <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex gap-2">
        {conversations.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i === currentConversation ? "bg-primary w-6" : "bg-muted-foreground/30"
            }`}
          />
        ))}
      </div>
    </div>
  );
};

export default WhatsAppMockup;
