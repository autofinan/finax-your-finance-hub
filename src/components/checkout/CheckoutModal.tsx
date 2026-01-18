import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CreditCard, CheckCircle, Smartphone, Info } from 'lucide-react';

interface CheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: 'basico' | 'pro';
}

const planDetails = {
  basico: {
    name: 'Básico',
    price: 'R$ 19,90',
    description: 'Organização + Consciência',
  },
  pro: {
    name: 'Pro',
    price: 'R$ 29,90',
    description: 'Controle Profundo + Evolução',
  },
};

export function CheckoutModal({ open, onOpenChange, plan }: CheckoutModalProps) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const details = planDetails[plan];

  // Formatar telefone
  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleCheckout = async () => {
    const digits = phone.replace(/\D/g, '');
    
    if (digits.length < 10) {
      toast({
        title: 'Número inválido',
        description: 'Digite seu número de WhatsApp completo com DDD.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const baseUrl = window.location.origin;
      
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          plan,
          phone: '+55' + digits,
          successUrl: `${baseUrl}/dashboard?success=true&plan=${plan}`,
          cancelUrl: `${baseUrl}/?canceled=true`,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('URL de checkout não retornada');
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      toast({
        title: 'Erro ao iniciar pagamento',
        description: 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-slate-900 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" />
            Assinar Plano {details.name}
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            {details.price}/mês • {details.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Número de telefone */}
          <div className="space-y-2">
            <Label htmlFor="checkout-phone" className="text-slate-200">
              Seu número de WhatsApp
            </Label>
            <div className="relative">
              <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                id="checkout-phone"
                type="tel"
                placeholder="(65) 9 9999-9999"
                value={phone}
                onChange={handlePhoneChange}
                className="pl-10 bg-slate-800 border-slate-600 text-white placeholder:text-slate-400"
                maxLength={16}
              />
            </div>
          </div>

          {/* Explicação de ativação */}
          <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Info className="w-5 h-5 text-primary mt-0.5" />
              <h4 className="font-medium text-white">Como funciona a ativação</h4>
            </div>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
                <span>Se você já usa o Finax com este número, seu plano é ativado <strong className="text-white">automaticamente</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
                <span>Se for um número novo, você receberá um <strong className="text-white">código de ativação</strong> no WhatsApp</span>
              </li>
            </ul>
          </div>

          {/* Botão de checkout */}
          <Button
            onClick={handleCheckout}
            disabled={loading || phone.replace(/\D/g, '').length < 10}
            className="w-full bg-gradient-to-r from-primary to-blue-500 hover:opacity-90 h-12 text-base"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Prosseguir para pagamento
              </>
            )}
          </Button>

          {/* Segurança */}
          <p className="text-center text-xs text-slate-500">
            🔒 Pagamento seguro processado pelo Stripe
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
