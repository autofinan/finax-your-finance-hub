import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  TrendingDown, 
  TrendingUp, 
  RefreshCcw, 
  CreditCard,
  MessageCircle,
  Target
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QuickActionsProps {
  onAddTransaction: () => void;
}

export function QuickActions({ onAddTransaction }: QuickActionsProps) {
  const navigate = useNavigate();

  const actions = [
    {
      label: 'Novo Gasto',
      icon: TrendingDown,
      onClick: onAddTransaction,
      variant: 'default' as const,
    },
    {
      label: 'Recorrente',
      icon: RefreshCcw,
      onClick: () => navigate('/recorrentes'),
      variant: 'outline' as const,
    },
    {
      label: 'Cartões',
      icon: CreditCard,
      onClick: () => navigate('/cartoes'),
      variant: 'outline' as const,
    },
    {
      label: 'FinBot',
      icon: MessageCircle,
      onClick: () => navigate('/chat'),
      variant: 'outline' as const,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ações Rápidas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              size="sm"
              onClick={action.onClick}
              className="h-auto py-3 flex-col gap-1"
            >
              <action.icon className="w-4 h-4" />
              <span className="text-xs">{action.label}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
