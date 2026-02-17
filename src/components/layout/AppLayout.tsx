import { ReactNode, useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import finaxLogo from '@/assets/finax-logo-transparent.png';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  LayoutDashboard,
  ArrowUpDown,
  RefreshCcw,
  CreditCard,
  Receipt,
  Layers,
  Target,
  Palmtree,
  TrendingUp,
  MessageCircle,
  Settings,
  LogOut,
  User,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: ReactNode;
}

// Navegação principal
const mainNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transacoes', icon: ArrowUpDown, label: 'Transações' },
  { to: '/cartoes', icon: CreditCard, label: 'Cartões' },
  { to: '/metas', icon: Target, label: 'Metas' },
];

// Organização
const orgNavItems = [
  { to: '/recorrentes', icon: RefreshCcw, label: 'Recorrentes' },
  { to: '/faturas', icon: Receipt, label: 'Faturas' },
  { to: '/contas', icon: Receipt, label: 'Contas a Pagar' },
  { to: '/parcelamentos', icon: Layers, label: 'Parcelamentos' },
  { to: '/eventos', icon: Palmtree, label: 'Eventos & Viagens' },
  { to: '/relatorios', icon: TrendingUp, label: 'Relatórios' },
  { to: '/chat', icon: MessageCircle, label: 'Fin Chat' },
];

// Sistema
const systemNavItems = [
  { to: '/configuracoes', icon: Settings, label: 'Configurações' },
];

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // Auto-close drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    setMobileMenuOpen(false);
    navigate('/');
  };

  const NavSection = ({ title, items }: { title: string; items: typeof mainNavItems }) => (
    <div className="space-y-1">
      <p className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
        {title}
      </p>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => setMobileMenuOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200',
              isActive
                ? 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            )
          }
        >
          <item.icon className="w-5 h-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="lg:ml-72 pb-20 lg:pb-0 min-h-screen relative">
        {/* Global Background Effects */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" />
        </div>
        <div className="fixed inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />
        {children}
      </main>
      
      {/* Mobile Navigation */}
      <MobileNav onMenuClick={() => setMobileMenuOpen(true)} />

      {/* Mobile Menu Drawer */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent 
          side="left" 
          className="w-80 bg-slate-950 border-r border-white/10 p-0 overflow-y-auto"
        >
          {/* Header */}
          <SheetHeader className="p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <img src={finaxLogo} alt="Finax" className="w-12 h-12 rounded-2xl object-contain" />
              <div>
                <SheetTitle className="text-xl font-black text-white text-left">Finax</SheetTitle>
                <p className="text-xs text-slate-500 font-medium">Converse. Organize. Evolua.</p>
              </div>
            </div>
          </SheetHeader>

          {/* Navigation */}
          <nav className="p-4 space-y-6">
            <NavSection title="Principal" items={mainNavItems} />
            <NavSection title="Organização" items={orgNavItems} />
            <NavSection title="Sistema" items={systemNavItems} />
          </nav>

          {/* User Section */}
          <div className="p-4 border-t border-white/10 mt-auto">
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm truncate">
                    {user?.nome || 'Usuário'}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span className="text-xs text-amber-400 font-bold">
                      {user?.plano === 'pro' ? 'Pro' : user?.plano === 'basico' ? 'Básico' : 'Trial'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 rounded-lg text-xs font-bold text-slate-400 hover:text-red-400 transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sair
              </button>
            </div>

            {/* Version */}
            <p className="text-center text-xs text-slate-600 font-medium mt-4">
              Finax v2.0 • 2024
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
