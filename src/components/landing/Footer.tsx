import { Link } from "react-router-dom";
import finaxLogo from "@/assets/finax-logo.png";

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-card border-t border-border py-12 md:py-16">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-4 gap-8 md:gap-12">
          {/* Brand */}
          <div className="md:col-span-2 space-y-4">
            <Link to="/" className="inline-block">
              <img src={finaxLogo} alt="Finax" className="h-10 w-auto" />
            </Link>
            <p className="text-muted-foreground max-w-sm">
              Seu assistente financeiro inteligente no WhatsApp. Converse, organize e evolua financeiramente.
            </p>
            <p className="text-lg font-semibold text-gradient">
              Converse. Organize. Evolua.
            </p>
          </div>

          {/* Links */}
          <div className="space-y-4">
            <h4 className="font-semibold">Produto</h4>
            <ul className="space-y-3 text-muted-foreground">
              <li>
                <a href="#como-funciona" className="hover:text-foreground transition-colors">
                  Como Funciona
                </a>
              </li>
              <li>
                <a href="#funcionalidades" className="hover:text-foreground transition-colors">
                  Funcionalidades
                </a>
              </li>
              <li>
                <a href="#planos" className="hover:text-foreground transition-colors">
                  Planos
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-foreground transition-colors">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          {/* Legal & Contact */}
          <div className="space-y-4">
            <h4 className="font-semibold">Legal & Contato</h4>
            <ul className="space-y-3 text-muted-foreground">
              <li>
                <Link to="/termos" className="hover:text-foreground transition-colors">
                  Termos de Uso
                </Link>
              </li>
              <li>
                <Link to="/privacidade" className="hover:text-foreground transition-colors">
                  Política de Privacidade
                </Link>
              </li>
              <li>
                <a
                  href="mailto:contato@finax.app"
                  className="hover:text-foreground transition-colors"
                >
                  contato@finax.app
                </a>
              </li>
              <li>
                <a
                  href="https://wa.me/5511999999999"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  WhatsApp
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {currentYear} Finax. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4">
            <a
              href="https://instagram.com/finax"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Instagram
            </a>
            <a
              href="https://twitter.com/finax"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Twitter
            </a>
            <a
              href="https://linkedin.com/company/finax"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              LinkedIn
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
