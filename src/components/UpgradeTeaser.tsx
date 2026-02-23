import { useState } from 'react';
import { Lock, Zap, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlanoStatus, Feature } from '@/hooks/usePlanoStatus';
import { CheckoutModal } from '@/components/checkout/CheckoutModal';

interface UpgradeTeaserProps {
  feature: Feature;
  title: string;
  preview?: React.ReactNode;
  compact?: boolean;
}

export function UpgradeTeaser({ feature, title, preview, compact = false }: UpgradeTeaserProps) {
  const { getUpgradeMessage } = usePlanoStatus();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  if (compact) {
    return (
      <>
        <div className="relative overflow-hidden border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5 rounded-2xl p-4 flex items-center gap-4">
          <div className="bg-gradient-to-br from-primary to-blue-500 p-3 rounded-xl shrink-0">
            <Lock className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-foreground text-sm">{title}</h4>
            <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{getUpgradeMessage(feature)}</p>
          </div>
          <Button
            size="sm"
            className="bg-gradient-to-r from-primary to-blue-500 hover:opacity-90 shrink-0"
            onClick={() => setCheckoutOpen(true)}
          >
            <Crown className="w-3.5 h-3.5 mr-1" />
            Pro
          </Button>
        </div>
        <CheckoutModal open={checkoutOpen} onOpenChange={setCheckoutOpen} plan="pro" />
      </>
    );
  }

  return (
    <>
      <div className="relative overflow-hidden border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5 rounded-2xl">
        {/* Preview com blur */}
        {preview && (
          <div className="blur-sm opacity-40 pointer-events-none select-none">
            {preview}
          </div>
        )}

        {/* Overlay */}
        <div className={`${preview ? 'absolute inset-0' : ''} bg-card/80 backdrop-blur-sm flex flex-col items-center justify-center p-8`}>
          <div className="bg-gradient-to-br from-primary to-blue-500 p-4 rounded-full mb-4 shadow-lg shadow-primary/30">
            <Lock className="w-8 h-8 text-primary-foreground" />
          </div>

          <h3 className="text-xl font-bold mb-2 text-center text-foreground">{title}</h3>
          <p className="text-muted-foreground text-center max-w-md mb-6 text-sm">
            {getUpgradeMessage(feature)}
          </p>

          <Button
            size="lg"
            className="bg-gradient-to-r from-primary to-blue-500 hover:opacity-90 shadow-lg shadow-primary/20"
            onClick={() => setCheckoutOpen(true)}
          >
            <Zap className="w-4 h-4 mr-2" />
            Fazer Upgrade Pro — R$ 29,90/mês
          </Button>

          <p className="text-xs text-muted-foreground mt-4">
            Apenas +R$ 10/mês para acelerar sua liberdade
          </p>
        </div>
      </div>
      <CheckoutModal open={checkoutOpen} onOpenChange={setCheckoutOpen} plan="pro" />
    </>
  );
}
