import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Crown, Clock, Sparkles, AlertTriangle } from 'lucide-react';
import { usePlanoStatus } from '@/hooks/usePlanoStatus';

export function PlanoCard() {
  const { planoStatus, loading, isTrialExpirado, isPro, isBasico, isTrial } = usePlanoStatus();

  if (loading || !planoStatus) return null;

  const getPlanoIcon = () => {
    if (isPro) return <Crown className="w-5 h-5 text-warning" />;
    if (isBasico) return <Sparkles className="w-5 h-5 text-primary" />;
    if (isTrialExpirado) return <AlertTriangle className="w-5 h-5 text-destructive" />;
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  const getPlanoLabel = () => {
    if (isPro) return 'Pro';
    if (isBasico) return 'Básico';
    if (isTrial) return 'Trial';
    if (isTrialExpirado) return 'Trial Expirado';
    return 'Indefinido';
  };

  const getBadgeVariant = () => {
    if (isPro) return 'default';
    if (isBasico) return 'secondary';
    if (isTrialExpirado) return 'destructive';
    return 'outline';
  };

  return (
    <Card className={isTrialExpirado ? 'border-destructive' : ''}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {getPlanoIcon()}
          Seu Plano
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant={getBadgeVariant()} className="text-sm px-3 py-1">
            {getPlanoLabel()}
          </Badge>
          {isTrial && planoStatus.diasRestantesTrial && (
            <span className={`text-sm font-medium ${
              planoStatus.alertaTrial === 'urgente' 
                ? 'text-destructive' 
                : planoStatus.alertaTrial === 'aviso'
                ? 'text-warning'
                : 'text-muted-foreground'
            }`}>
              {planoStatus.diasRestantesTrial} dias restantes
            </span>
          )}
        </div>

        {isTrialExpirado && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Seu período de teste acabou. Escolha um plano para continuar usando o Finax.
            </p>
            <div className="flex flex-col gap-2">
              <Button size="sm" className="w-full">
                <Crown className="w-4 h-4 mr-2" />
                Assinar Pro
              </Button>
              <Button size="sm" variant="outline" className="w-full">
                <Sparkles className="w-4 h-4 mr-2" />
                Plano Básico
              </Button>
            </div>
          </div>
        )}

        {isTrial && planoStatus.alertaTrial === 'urgente' && (
          <div className="p-3 bg-destructive/10 rounded-lg">
            <p className="text-sm text-destructive">
              ⏰ Seu trial está acabando! Escolha um plano para não perder seus dados.
            </p>
            <Button size="sm" className="mt-2 w-full" variant="destructive">
              Escolher Plano
            </Button>
          </div>
        )}

        {(isPro || isBasico) && (
          <p className="text-sm text-muted-foreground">
            {isPro 
              ? '✨ Você tem acesso a todas as funcionalidades do Finax.'
              : '📊 Funcionalidades essenciais para organizar suas finanças.'
            }
          </p>
        )}
      </CardContent>
    </Card>
  );
}
