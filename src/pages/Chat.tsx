import { AppLayout } from '@/components/layout/AppLayout';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { useChat } from '@/hooks/useChat';
import { Button } from '@/components/ui/button';
import { RotateCcw, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const Chat = () => {
  const { messages, isLoading, sendMessage, clearMessages } = useChat();

  return (
    <AppLayout>
      <div className="min-h-screen p-6 lg:p-8">
        <div className="relative z-10 max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between"
          >
            <div>
              <p className="text-muted-foreground font-medium mb-1">Assistente</p>
              <h1 className="text-3xl lg:text-4xl font-bold text-foreground flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-primary-foreground" />
                </div>
                FinBot
              </h1>
            </div>
            {messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearMessages} className="gap-2">
                <RotateCcw className="w-4 h-4" />
                Nova conversa
              </Button>
            )}
          </motion.div>

          {/* Chat Interface */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card/50 backdrop-blur-sm border border-border rounded-2xl p-4 lg:p-6"
          >
            <ChatInterface
              messages={messages}
              isLoading={isLoading}
              onSendMessage={sendMessage}
            />
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Chat;
