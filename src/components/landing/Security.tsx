import React from 'react';
import { Shield, Lock, Eye, Server, CheckCircle } from 'lucide-react';

const securityItems = [
  {
    icon: Lock,
    title: "Criptografia de ponta",
    description: "Seus dados são criptografados em trânsito e em repouso com padrão bancário",
  },
  {
    icon: Shield,
    title: "Privacidade garantida",
    description: "Nunca compartilhamos ou vendemos suas informações. Zero terceiros.",
  },
  {
    icon: Eye,
    title: "Você no controle",
    description: "Acesse, exporte ou delete seus dados a qualquer momento. Sem burocacia.",
  },
  {
    icon: Server,
    title: "Infraestrutura segura",
    description: "Hospedado em servidores certificados com uptime de 99.9%",
  },
];

const Security = () => {
  return (
    <section className="py-20 md:py-32 relative overflow-hidden bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-0 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 backdrop-blur-sm mb-4">
            <Shield className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-medium text-indigo-300">Segurança de nível bancário</span>
          </div>
          
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
            Sua segurança é nossa{" "}
            <span className="bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
              prioridade
            </span>
          </h2>
          <p className="text-lg text-slate-300">
            Lidamos com dinheiro. Por isso, levamos segurança <span className="text-white font-semibold">muito</span> a sério.
          </p>
        </div>

        {/* Security Items */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {securityItems.map((item, index) => (
            <div
              key={item.title}
              className="group p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <item.icon className="w-7 h-7 text-indigo-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">
                {item.title}
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-8">
          {[
            { icon: Lock, text: "SSL 256-bit" },
            { icon: Shield, text: "LGPD Compliant" },
            { icon: Server, text: "Dados no Brasil" },
            { icon: CheckCircle, text: "SOC 2 Type II" }
          ].map((badge, index) => (
            <div
              key={badge.text}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300"
            >
              <badge.icon className="w-4 h-4 text-indigo-400" />
              <span className="text-sm text-slate-300 font-medium">{badge.text}</span>
            </div>
          ))}
        </div>

        {/* Final Statement */}
        <div className="mt-12 text-center">
          <p className="text-slate-400 max-w-2xl mx-auto">
            Seus dados financeiros são tratados com o mesmo nível de segurança usado por bancos digitais. 
            <span className="text-white font-semibold"> Auditados e certificados.</span>
          </p>
        </div>
      </div>
    </section>
  );
};

export default Security;
