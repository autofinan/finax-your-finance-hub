import { useState, useEffect } from "react";
import { Check, CheckCheck } from "lucide-react";

interface Message {
  id: number;
  text: string;
  sender: "user" | "finax";
  delay: number;
}

const messages: Message[] = [
  { id: 1, text: "Gastei 50 reais no mercado", sender: "user", delay: 500 },
  { id: 2, text: "✅ Registrado!\n\n🛒 Mercado - R$ 50,00\n📁 Categoria: Alimentação\n📅 Hoje, 14:32\n\nSeu gasto com Alimentação este mês: R$ 850,00", sender: "finax", delay: 1500 },
  { id: 3, text: "Quanto gastei essa semana?", sender: "user", delay: 3500 },
  { id: 4, text: "📊 Resumo da Semana:\n\n💰 Total: R$ 487,50\n\n🍽️ Alimentação: R$ 180,00\n🚗 Transporte: R$ 120,00\n🎮 Lazer: R$ 87,50\n📦 Outros: R$ 100,00\n\n💡 Você gastou 15% menos que a semana passada!", sender: "finax", delay: 5000 },
];

const WhatsAppMockup = () => {
  const [visibleMessages, setVisibleMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [cycleKey, setCycleKey] = useState(0);

  useEffect(() => {
    setVisibleMessages([]);
    setIsTyping(false);

    const timers: NodeJS.Timeout[] = [];

    messages.forEach((message, index) => {
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

    // Reset cycle after all messages
    const resetTimer = setTimeout(() => {
      setCycleKey((prev) => prev + 1);
    }, 8000);
    timers.push(resetTimer);

    return () => timers.forEach(clearTimeout);
  }, [cycleKey]);

  return (
    <div className="relative w-full max-w-sm">
      {/* Phone Frame */}
      <div className="relative bg-card rounded-[2.5rem] p-2 shadow-2xl shadow-foreground/10 border border-border">
        {/* Phone Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-foreground rounded-b-2xl" />
        
        {/* Screen */}
        <div className="bg-[#0b141a] rounded-[2rem] overflow-hidden">
          {/* WhatsApp Header */}
          <div className="bg-[#1f2c34] px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full gradient-brand flex items-center justify-center">
              <span className="text-white font-bold text-sm">F</span>
            </div>
            <div className="flex-1">
              <p className="text-white font-medium text-sm">Finax</p>
              <p className="text-[#8696a0] text-xs">online</p>
            </div>
          </div>

          {/* Chat Area */}
          <div className="h-[400px] p-3 space-y-2 overflow-hidden bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIgZmlsbD0iIzBiMTQxYSIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMjAiIHI9IjEiIGZpbGw9IiMxZjJjMzQiIG9wYWNpdHk9Ii4zIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2EpIi8+PC9zdmc+')]">
            {visibleMessages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"} animate-scale-in`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-line ${
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
                <div className="bg-[#1f2c34] text-white px-4 py-3 rounded-lg rounded-tl-none">
                  <div className="flex gap-1">
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
            <div className="flex-1 bg-[#2a3942] rounded-full px-4 py-2">
              <span className="text-[#8696a0] text-sm">Mensagem</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14v-4H7l5-5 5 5h-4v4h-2z" transform="rotate(90 12 12)" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative Elements */}
      <div className="absolute -top-4 -right-4 w-20 h-20 bg-accent/20 rounded-full blur-xl" />
      <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-primary/20 rounded-full blur-xl" />
    </div>
  );
};

export default WhatsAppMockup;
