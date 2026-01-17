import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowUpDown,
  RefreshCcw,
  MessageCircle,
  Settings,
  TrendingUp,
  CreditCard,
  Receipt,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import finaxLogo from '@/assets/finax-logo-transparent.png';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transacoes', icon: ArrowUpDown, label: 'Transações' },
  { to: '/recorrentes', icon: RefreshCcw, label: 'Recorrentes' },
  { to: '/cartoes', icon: CreditCard, label: 'Cartões' },
  { to: '/faturas', icon: Receipt, label: 'Faturas' },
  { to: '/parcelamentos', icon: Layers, label: 'Parcelamentos' },
  { to: '/relatorios', icon: TrendingUp, label: 'Relatórios' },
  { to: '/chat', icon: MessageCircle, label: 'FinBot' },
];

export function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-64 h-screen bg-card border-r border-border fixed left-0 top-0">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <img src={finaxLogo} alt="Finax" className="h-10 w-auto" />
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'gradient-brand text-white shadow-lg shadow-primary/25'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
              )
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <NavLink
          to="/configuracoes"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
              isActive
                ? 'gradient-brand text-white'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
            )
          }
        >
          <Settings className="w-5 h-5" />
          Configurações
        </NavLink>
      </div>
    </aside>
  );
}
