import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowUpDown,
  CreditCard,
  MessageCircle,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/transacoes', icon: ArrowUpDown, label: 'Transações' },
  { to: '/cartoes', icon: CreditCard, label: 'Cartões' },
  { to: '/relatorios', icon: TrendingUp, label: 'Relatórios' },
  { to: '/chat', icon: MessageCircle, label: 'FinBot' },
];

export function MobileNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border safe-area-inset-bottom">
      <div className="flex justify-around items-center h-16 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-xl transition-all duration-200 min-w-[60px]',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <div
                  className={cn(
                    'p-1.5 rounded-lg transition-all duration-200',
                    isActive && 'bg-primary/10'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-medium">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
