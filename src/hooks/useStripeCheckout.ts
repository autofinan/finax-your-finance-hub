import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useStripeCheckout() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const createCheckout = async (plan: 'basico' | 'pro') => {
    setLoading(true);
    
    try {
      // Get current user info
      const { data: { user } } = await supabase.auth.getUser();
      
      const email = user?.email || '';
      const phone = user?.phone || '';

      // Get the current URL for redirects
      const baseUrl = window.location.origin;
      
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          plan,
          email,
          phone,
          successUrl: `${baseUrl}/dashboard?success=true&plan=${plan}`,
          cancelUrl: `${baseUrl}/dashboard?canceled=true`,
        },
      });

      if (error) {
        console.error('Checkout error:', error);
        toast({
          title: 'Erro ao criar checkout',
          description: 'Não foi possível iniciar o pagamento. Tente novamente.',
          variant: 'destructive',
        });
        return null;
      }

      if (data?.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
        return data;
      }

      return null;
    } catch (err) {
      console.error('Checkout error:', err);
      toast({
        title: 'Erro',
        description: 'Ocorreu um erro inesperado. Tente novamente.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    createCheckout,
    loading,
  };
}
