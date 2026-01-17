import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import finaxLogo from "@/assets/finax-logo.png";

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-background/80 backdrop-blur-xl border-b border-border/50 shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <img src={finaxLogo} alt="Finax" className="h-8 md:h-10 w-auto" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <button
              onClick={() => scrollToSection("como-funciona")}
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              Como Funciona
            </button>
            <button
              onClick={() => scrollToSection("funcionalidades")}
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              Funcionalidades
            </button>
            <button
              onClick={() => scrollToSection("planos")}
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              Planos
            </button>
            <button
              onClick={() => scrollToSection("faq")}
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              FAQ
            </button>
          </div>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm">
                Entrar
              </Button>
            </Link>
            <Button
              size="sm"
              className="gradient-brand hover:opacity-90 transition-opacity"
              onClick={() => scrollToSection("planos")}
            >
              Começar Grátis
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-foreground"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-16 left-0 right-0 bg-background/95 backdrop-blur-xl border-b border-border shadow-lg animate-fade-in">
            <div className="flex flex-col p-4 gap-4">
              <button
                onClick={() => scrollToSection("como-funciona")}
                className="text-left py-2 text-foreground/70 hover:text-foreground transition-colors"
              >
                Como Funciona
              </button>
              <button
                onClick={() => scrollToSection("funcionalidades")}
                className="text-left py-2 text-foreground/70 hover:text-foreground transition-colors"
              >
                Funcionalidades
              </button>
              <button
                onClick={() => scrollToSection("planos")}
                className="text-left py-2 text-foreground/70 hover:text-foreground transition-colors"
              >
                Planos
              </button>
              <button
                onClick={() => scrollToSection("faq")}
                className="text-left py-2 text-foreground/70 hover:text-foreground transition-colors"
              >
                FAQ
              </button>
              <div className="flex flex-col gap-2 pt-4 border-t border-border">
                <Link to="/auth" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full">
                    Entrar
                  </Button>
                </Link>
                <Button
                  className="w-full gradient-brand"
                  onClick={() => scrollToSection("planos")}
                >
                  Começar Grátis
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
