import React from 'react';
import { MessageCircle, Mail, MapPin, Instagram, Linkedin, Twitter, Heart, Shield, Zap, TrendingUp } from 'lucide-react';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  const productLinks = [
    { label: "Como Funciona", href: "#como-funciona" },
    { label: "Funcionalidades", href: "#funcionalidades" },
    { label: "Planos & Preços", href: "#planos" },
    { label: "Depoimentos", href: "#depoimentos" }
  ];

  const supportLinks = [
    { label: "Central de Ajuda", href: "#faq" },
    { label: "Status do Sistema", href: "#" },
    { label: "Documentação", href: "#" },
    { label: "Falar com Suporte", href: "https://wa.me/5511999999999" }
  ];

  const legalLinks = [
    { label: "Termos de Uso", href: "/termos" },
    { label: "Política de Privacidade", href: "/privacidade" },
    { label: "LGPD", href: "/lgpd" },
    { label: "Segurança", href: "#seguranca" }
  ];

  const socialLinks = [
    { icon: Instagram, href: "https://instagram.com/finax", label: "Instagram" },
    { icon: Twitter, href: "https://twitter.com/finax", label: "Twitter" },
    { icon: Linkedin, href: "https://linkedin.com/company/finax", label: "LinkedIn" }
  ];

  const features = [
    { icon: Shield, text: "100% Seguro" },
    { icon: Zap, text: "Setup em 2min" },
    { icon: TrendingUp, text: "Resultados reais" }
  ];

  return (
    <footer className="relative overflow-hidden bg-gradient-to-b from-slate-900 to-slate-950 border-t border-white/10">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Main Footer Content */}
        <div className="py-12 md:py-16">
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-8 md:gap-12">
            {/* Brand Column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Logo */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <MessageCircle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white">Finax</h3>
                  <p className="text-xs text-slate-400">Assistente Financeiro IA</p>
                </div>
              </div>

              {/* Tagline */}
              <p className="text-slate-300 max-w-sm leading-relaxed">
                Seu assistente financeiro inteligente no WhatsApp. 
                <span className="block mt-2 text-lg font-semibold bg-gradient-to-r from-indigo-400 to-blue-400 bg-clip-text text-transparent">
                  Converse. Organize. Evolua.
                </span>
              </p>

              {/* Features */}
              <div className="flex flex-wrap gap-3">
                {features.map((feature) => (
                  <div
                    key={feature.text}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10"
                  >
                    <feature.icon className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs text-slate-300 font-medium">{feature.text}</span>
                  </div>
                ))}
              </div>

              {/* Contact */}
              <div className="space-y-2 pt-2">
                <a
                  href="mailto:contato@finax.app"
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-indigo-400 transition-colors group"
                >
                  <Mail className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  contato@finax.app
                </a>
                <a
                  href="https://wa.me/5511999999999"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-indigo-400 transition-colors group"
                >
                  <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  WhatsApp Suporte
                </a>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <MapPin className="w-4 h-4" />
                  São Paulo, Brasil
                </div>
              </div>
            </div>

            {/* Product Links */}
            <div className="space-y-4">
              <h4 className="font-semibold text-white text-sm uppercase tracking-wider">Produto</h4>
              <ul className="space-y-3">
                {productLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-slate-400 hover:text-indigo-400 transition-colors text-sm flex items-center gap-2 group"
                    >
                      <span className="w-1 h-1 rounded-full bg-slate-600 group-hover:bg-indigo-400 transition-colors" />
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Support Links */}
            <div className="space-y-4">
              <h4 className="font-semibold text-white text-sm uppercase tracking-wider">Suporte</h4>
              <ul className="space-y-3">
                {supportLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-slate-400 hover:text-indigo-400 transition-colors text-sm flex items-center gap-2 group"
                      target={link.href.startsWith('http') ? '_blank' : undefined}
                      rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    >
                      <span className="w-1 h-1 rounded-full bg-slate-600 group-hover:bg-indigo-400 transition-colors" />
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal Links */}
            <div className="space-y-4">
              <h4 className="font-semibold text-white text-sm uppercase tracking-wider">Legal</h4>
              <ul className="space-y-3">
                {legalLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-slate-400 hover:text-indigo-400 transition-colors text-sm flex items-center gap-2 group"
                    >
                      <span className="w-1 h-1 rounded-full bg-slate-600 group-hover:bg-indigo-400 transition-colors" />
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-6 border-t border-white/10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            {/* Copyright */}
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>© {currentYear} Finax.</span>
              <span className="hidden sm:inline">Feito com</span>
              <Heart className="w-4 h-4 text-red-400 fill-red-400" />
              <span className="hidden sm:inline">no Brasil</span>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-4">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 flex items-center justify-center transition-all duration-300 hover:scale-110 group"
                  aria-label={social.label}
                >
                  <social.icon className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 transition-colors" />
                </a>
              ))}
            </div>

            {/* Security Badges */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium">LGPD</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-xs text-indigo-400 font-medium">SSL</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
