import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageCircle, ArrowLeft, Smartphone, Shield, CheckCircle, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import finaxLogo from "@/assets/finax-logo-transparent.png";

const Auth = () => {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const {
    user,
    loading,
    error,
    isAuthenticated,
    otpSent,
    otpLoading,
    verifyLoading,
    countdown,
    requiresWhatsApp,
    whatsappLink,
    sendOTP,
    verifyOTP,
    resetOTP,
    clearError,
  } = useAuth();

  const plan = searchParams.get("plan");

  // Redirecionar se já autenticado
  useEffect(() => {
    if (isAuthenticated && !loading) {
      console.log('🚀 [AUTH PAGE] Usuário autenticado, redirecionando...');
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  // Mostrar erro via toast
  useEffect(() => {
    if (error && !requiresWhatsApp) {
      toast({
        title: "Erro",
        description: error,
        variant: "destructive",
      });
      clearError();
    }
  }, [error, requiresWhatsApp, toast, clearError]);

  // Formatar telefone
  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      toast({
        title: "Número inválido",
        description: "Digite um número de telefone válido com DDD.",
        variant: "destructive",
      });
      return;
    }
    await sendOTP(phone);
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast({
        title: "Código inválido",
        description: "O código deve ter 6 dígitos.",
        variant: "destructive",
      });
      return;
    }
    const success = await verifyOTP(phone, code);
    if (success) {
      toast({
        title: "Bem-vindo! 🎉",
        description: "Login realizado com sucesso.",
      });
      navigate("/dashboard", { replace: true });
    }
  };

  // Loading inicial
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-slate-400">Verificando sessão...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative z-10 bg-slate-800/50 backdrop-blur-xl border-slate-700">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <img src={finaxLogo} alt="Finax" className="h-12" />
          </div>
          <CardTitle className="text-2xl font-bold text-white">
            {otpSent ? "Digite o código" : "Entrar no Finax"}
          </CardTitle>
          <CardDescription className="text-slate-300">
            {otpSent 
              ? "Enviamos um código de 6 dígitos no seu WhatsApp"
              : "Use seu número de WhatsApp para acessar"
            }
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!otpSent ? (
            <form onSubmit={handleSendOTP} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-slate-200">
                  Número de WhatsApp
                </Label>
                <div className="relative">
                  <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(65) 9 9999-9999"
                    value={phone}
                    onChange={handlePhoneChange}
                    className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                    disabled={otpLoading}
                    maxLength={16}
                  />
                </div>
              </div>

              {/* ⚠️ Aviso de janela 24h */}
              {requiresWhatsApp && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
                  <p className="text-amber-300 text-sm">
                    {error || "Para receber o código, envie um 'oi' para o Finax no WhatsApp primeiro."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-amber-500/50 text-amber-300 hover:bg-amber-500/20"
                    onClick={() => window.open(whatsappLink || "https://wa.me/5565981034588?text=oi", "_blank")}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir WhatsApp
                  </Button>
                  <p className="text-xs text-amber-300/60 text-center">
                    Após enviar, volte aqui e clique em "Enviar código"
                  </p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-primary to-blue-500 hover:opacity-90"
                disabled={otpLoading}
              >
                {otpLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="mr-2 h-4 w-4" />
                )}
                {requiresWhatsApp ? "Tentar novamente" : "Receber código no WhatsApp"}
              </Button>

              {/* Info box */}
              {!requiresWhatsApp && (
                <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
                  <div className="flex items-start gap-2 text-sm text-slate-300">
                    <Shield className="w-4 h-4 mt-0.5 text-emerald-400" />
                    <span>Usamos seu número do WhatsApp como identidade única. Sem senha!</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-slate-300">
                    <CheckCircle className="w-4 h-4 mt-0.5 text-emerald-400" />
                    <span>Código válido por 5 minutos. Máximo 3 tentativas.</span>
                  </div>
                </div>
              )}

              {/* Link para começar trial */}
              <div className="text-center pt-4 border-t border-slate-700">
                <p className="text-sm text-slate-400 mb-2">Ainda não usa o Finax?</p>
                <Button
                  type="button"
                  variant="outline"
                  className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                  onClick={() => window.open("https://wa.me/5565981034588?text=Oi", "_blank")}
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Começar Trial Grátis
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="code" className="text-slate-200">
                  Código de verificação
                </Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-2xl tracking-widest bg-slate-700/50 border-slate-600 text-white"
                  disabled={verifyLoading}
                  maxLength={6}
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-primary to-blue-500 hover:opacity-90"
                disabled={verifyLoading || code.length !== 6}
              >
                {verifyLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="mr-2 h-4 w-4" />
                )}
                Verificar e entrar
              </Button>

              <div className="flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:text-white"
                  onClick={resetOTP}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Trocar número
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:text-white disabled:opacity-50"
                  onClick={() => sendOTP(phone)}
                  disabled={countdown > 0 || otpLoading}
                >
                  {countdown > 0 ? (
                    <span>Reenviar em {countdown}s</span>
                  ) : (
                    <span>Reenviar código</span>
                  )}
                </Button>
              </div>

              {/* Número atual */}
              <p className="text-center text-sm text-slate-400">
                Código enviado para <span className="text-white font-medium">{phone}</span>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
