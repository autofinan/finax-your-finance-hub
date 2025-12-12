import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowUpDown,
  RefreshCcw,
  MessageCircle,
  Settings,
  TrendingUp,
  Wallet,
  CreditCard,
  Receipt,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
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
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
            <Wallet className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg">FinBot</h1>
            <p className="text-xs text-muted-foreground">Finanças Pessoais</p>
          </div>
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
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
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
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
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
