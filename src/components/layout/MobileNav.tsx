import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowUpDown,
  CreditCard,
  Target,
  Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/transacoes', icon: ArrowUpDown, label: 'Transações' },
  { to: '/cartoes', icon: CreditCard, label: 'Cartões' },
  { to: '/metas', icon: Target, label: 'Metas' },
];

interface MobileNavProps {
  onMenuClick: () => void;
}

export function MobileNav({ onMenuClick }: MobileNavProps) {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-white/10 safe-area-inset-bottom">
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
        
        {/* Menu Button */}
        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-xl transition-all duration-200 min-w-[60px] text-muted-foreground hover:text-primary"
        >
          <div className="p-1.5 rounded-lg transition-all duration-200">
            <Menu className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-medium">Menu</span>
        </button>
      </div>
    </nav>
  );
}
