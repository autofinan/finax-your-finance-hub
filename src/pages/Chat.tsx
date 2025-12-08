import { AppLayout } from '@/components/layout/AppLayout';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { useChat } from '@/hooks/useChat';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

const Chat = () => {
  const { messages, isLoading, sendMessage, clearMessages } = useChat();

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">FinBot</h1>
            <p className="text-muted-foreground">
              Seu assistente financeiro com IA
            </p>
          </div>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={clearMessages} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Nova conversa
            </Button>
          )}
        </div>

        <div className="glass rounded-2xl p-4 lg:p-6">
          <ChatInterface
            messages={messages}
            isLoading={isLoading}
            onSendMessage={sendMessage}
          />
        </div>
      </div>
    </AppLayout>
  );
};

export default Chat;
