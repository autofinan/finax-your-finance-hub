import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle, 
  Heart, 
  DollarSign, 
  Clock, 
  Sparkles,
  ArrowLeft,
  Check,
  X,
  Pause,
  MessageCircle,
  Gift
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

type Step = 'confirm' | 'reason' | 'offer' | 'final';

interface Reason {
  id: string;
  label: string;
  icon: React.ReactNode;
  offer?: {
    type: 'discount' | 'pause' | 'downgrade';
    message: string;
    value?: string;
  };
}

const reasons: Reason[] = [
  { 
    id: 'price', 
    label: 'Está muito caro', 
    icon: <DollarSign className="w-5 h-5" />,
    offer: {
      type: 'discount',
      message: 'Que tal 50% de desconto nos próximos 2 meses?',
      value: '50%'
    }
  },
  { 
    id: 'not_using', 
    label: 'Não estou usando', 
    icon: <Clock className="w-5 h-5" />,
    offer: {
      type: 'pause',
      message: 'Você pode pausar sua assinatura por até 3 meses!',
    }
  },
  { 
    id: 'features', 
    label: 'Não tem o que preciso', 
    icon: <Sparkles className="w-5 h-5" />,
    offer: {
      type: 'downgrade',
      message: 'Já experimentou o plano Básico? Pode ser ideal pra você!',
    }
  },
  { 
    id: 'other', 
    label: 'Outro motivo', 
    icon: <MessageCircle className="w-5 h-5" />,
  },
];

const Cancelar = () => {
  const [step, setStep] = useState<Step>('confirm');
  const [selectedReason, setSelectedReason] = useState<Reason | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [offerAccepted, setOfferAccepted] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleConfirmCancel = () => {
    setStep('reason');
  };

  const handleSelectReason = (reason: Reason) => {
    setSelectedReason(reason);
    if (reason.offer) {
      setStep('offer');
    } else {
      setStep('final');
    }
  };

  const handleAcceptOffer = async () => {
    setLoading(true);
    try {
      // TODO: Process offer acceptance
      setOfferAccepted(true);
      toast({
        title: '🎉 Oferta aplicada!',
        description: 'Obrigado por continuar conosco!',
      });
      setTimeout(() => navigate('/dashboard'), 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalCancel = async () => {
    setLoading(true);
    try {
      const sessionToken = localStorage.getItem('finax_session_token');
      const userId = localStorage.getItem('finax_user_id');

      if (!sessionToken || !userId) {
        toast({
          title: 'Erro',
          description: 'Sessão não encontrada. Faça login novamente.',
          variant: 'destructive',
        });
        navigate('/auth');
        return;
      }

      const response = await fetch(
        'https://hhvaqirjrssldsxoezxs.supabase.co/functions/v1/cancel-subscription',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            user_id: userId,
            motivo: selectedReason?.id || 'other',
            detalhes: otherReason || selectedReason?.label,
          }),
        }
      );

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: 'Assinatura cancelada',
          description: 'Sentiremos sua falta. Você pode voltar quando quiser!',
        });
        // Clear session
        localStorage.removeItem('finax_session_token');
        localStorage.removeItem('finax_session_expiry');
        localStorage.removeItem('finax_user_id');
        localStorage.removeItem('finax_phone');
        setTimeout(() => navigate('/'), 2000);
      } else {
        throw new Error(data.error || 'Erro ao cancelar');
      }
    } catch (error) {
      console.error('Cancel error:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível cancelar. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-red-600/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/5 blur-[120px] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-lg"
      >
        {/* Back Button */}
        <button
          onClick={() => step === 'confirm' ? navigate(-1) : setStep('confirm')}
          className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Voltar</span>
        </button>

        <AnimatePresence mode="wait">
          {/* Step 1: Confirm Intent */}
          {step === 'confirm' && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8"
            >
              <div className="text-center mb-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <Heart className="w-10 h-10 text-red-400" />
                </div>
                <h1 className="text-3xl font-bold text-white mb-3">
                  Você quer nos deixar? 😢
                </h1>
                <p className="text-slate-400 leading-relaxed">
                  Eu te ajudei a organizar suas finanças por todo esse tempo. 
                  Tem certeza que quer cancelar?
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={handleConfirmCancel}
                  variant="outline"
                  className="w-full py-6 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                >
                  Sim, quero cancelar
                </Button>
                <Button
                  onClick={() => navigate('/dashboard')}
                  className="w-full py-6 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Mudei de ideia, quero ficar!
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Select Reason */}
          {step === 'reason' && (
            <motion.div
              key="reason"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8"
            >
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-white mb-3">
                  O que aconteceu?
                </h2>
                <p className="text-slate-400">
                  Sua opinião é muito importante para nós
                </p>
              </div>

              <div className="space-y-3">
                {reasons.map((reason) => (
                  <button
                    key={reason.id}
                    onClick={() => handleSelectReason(reason)}
                    className="w-full flex items-center gap-4 p-4 bg-slate-800/50 border border-white/5 rounded-xl hover:border-indigo-500/30 hover:bg-slate-800/80 transition-all group"
                  >
                    <div className="p-3 rounded-xl bg-slate-700/50 text-slate-400 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-colors">
                      {reason.icon}
                    </div>
                    <span className="font-medium text-white flex-1 text-left">
                      {reason.label}
                    </span>
                  </button>
                ))}
              </div>

              {selectedReason?.id === 'other' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4"
                >
                  <Input
                    placeholder="Conta pra gente o que aconteceu..."
                    value={otherReason}
                    onChange={(e) => setOtherReason(e.target.value)}
                    className="bg-slate-800/50 border-white/10"
                  />
                </motion.div>
              )}
            </motion.div>
          )}

          {/* Step 3: Retention Offer */}
          {step === 'offer' && selectedReason?.offer && (
            <motion.div
              key="offer"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8"
            >
              {offerAccepted ? (
                <div className="text-center py-8">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-3">
                    Que bom que você ficou! 🎉
                  </h2>
                  <p className="text-slate-400">
                    Redirecionando você de volta...
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-center mb-8">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center">
                      <Gift className="w-10 h-10 text-amber-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-3">
                      Espera! Tenho uma proposta 🎁
                    </h2>
                    <p className="text-lg text-slate-300 leading-relaxed">
                      {selectedReason.offer.message}
                    </p>
                    {selectedReason.offer.value && (
                      <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-full">
                        <span className="text-3xl font-black text-amber-400">
                          {selectedReason.offer.value}
                        </span>
                        <span className="text-amber-400/80 font-medium">OFF</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Button
                      onClick={handleAcceptOffer}
                      disabled={loading}
                      className="w-full py-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold"
                    >
                      {loading ? 'Aplicando...' : 'Aceitar oferta! 🎉'}
                    </Button>
                    <Button
                      onClick={() => setStep('final')}
                      variant="ghost"
                      className="w-full py-6 text-slate-400 hover:text-red-400"
                    >
                      Não, quero cancelar mesmo
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {/* Step 4: Final Confirmation */}
          {step === 'final' && (
            <motion.div
              key="final"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-slate-900/60 backdrop-blur-xl border border-red-500/20 rounded-3xl p-8"
            >
              <div className="text-center mb-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-10 h-10 text-red-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-3">
                  Última chance
                </h2>
                <p className="text-slate-400 leading-relaxed">
                  Ao cancelar, você perderá acesso a todas as funcionalidades. 
                  Seus dados serão mantidos por 30 dias caso queira voltar.
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={handleFinalCancel}
                  disabled={loading}
                  className="w-full py-6 bg-red-500 hover:bg-red-600 text-white font-bold"
                >
                  {loading ? 'Cancelando...' : 'Confirmar Cancelamento'}
                </Button>
                <Button
                  onClick={() => navigate('/dashboard')}
                  variant="outline"
                  className="w-full py-6 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                >
                  <Heart className="w-4 h-4 mr-2" />
                  Quero continuar no Finax
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default Cancelar;
