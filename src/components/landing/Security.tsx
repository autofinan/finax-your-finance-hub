import { Shield, Lock, Eye, Server } from "lucide-react";

const securityItems = [
  {
    icon: Lock,
    title: "Criptografia de ponta",
    description: "Seus dados são criptografados em trânsito e em repouso",
  },
  {
    icon: Shield,
    title: "Privacidade garantida",
    description: "Nunca compartilhamos ou vendemos suas informações",
  },
  {
    icon: Eye,
    title: "Você no controle",
    description: "Acesse, exporte ou delete seus dados a qualquer momento",
  },
  {
    icon: Server,
    title: "Infraestrutura segura",
    description: "Hospedado em servidores com certificação de segurança",
  },
];

const Security = () => {
  return (
    <section className="py-20 md:py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-foreground" />
      <div className="absolute inset-0 gradient-brand opacity-90" />

      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
            Sua segurança é nossa prioridade
          </h2>
          <p className="text-lg text-white/80">
            Lidamos com dinheiro. Por isso, levamos segurança muito a sério.
          </p>
        </div>

        {/* Security Items */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {securityItems.map((item) => (
            <div
              key={item.title}
              className="p-6 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/15 transition-all duration-300"
            >
              <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-4">
                <item.icon className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">
                {item.title}
              </h3>
              <p className="text-white/70 text-sm">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Trust Badges */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-white/60 text-sm">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" />
            <span>SSL 256-bit</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span>LGPD Compliant</span>
          </div>
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4" />
            <span>Dados no Brasil</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Security;
