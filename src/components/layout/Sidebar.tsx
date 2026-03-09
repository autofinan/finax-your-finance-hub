import { NavLink } from 'react-router-dom';
import finaxLogo from '@/assets/finax-logo-transparent.png';
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
  Sparkles,
  LogOut,
  User,
  Palmtree,
  Target,
  Landmark,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transacoes', icon: ArrowUpDown, label: 'Transações' },
  { to: '/recorrentes', icon: RefreshCcw, label: 'Recorrentes' },
  { to: '/cartoes', icon: CreditCard, label: 'Cartões' },
  { to: '/faturas', icon: Receipt, label: 'Faturas' },
  { to: '/contas', icon: Receipt, label: 'Contas a Pagar' },
  { to: '/parcelamentos', icon: Layers, label: 'Parcelamentos' },
  { to: '/eventos', icon: Palmtree, label: 'Eventos & Viagens' },
  { to: '/metas', icon: Target, label: 'Metas' },
  { to: '/dividas', icon: Landmark, label: 'Dívidas' },
  { to: '/relatorios', icon: TrendingUp, label: 'Relatórios' },
  { to: '/chat', icon: MessageCircle, label: 'Fin Chat' },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <aside className="hidden lg:flex flex-col w-72 h-screen bg-slate-950 border-r border-white/10 fixed left-0 top-0 z-40">
      {/* Background Effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/20 via-transparent to-purple-950/20 pointer-events-none" />
      
      {/* Logo */}
      <div className="relative p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <img src={finaxLogo} alt="Finax" className="w-12 h-12 rounded-2xl object-contain" />
          <div>
            <h2 className="text-xl font-black text-white">Finax</h2>
            <p className="text-xs text-slate-500 font-medium">Converse. Organize. Evolua.</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 relative p-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item, index) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 relative',
                isActive
                  ? 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Active Indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-xl"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                
                {/* Content */}
                <div className="relative z-10 flex items-center gap-3 w-full">
                  <item.icon className={cn(
                    "w-5 h-5 transition-transform duration-300",
                    isActive && "scale-110"
                  )} />
                  <span>{item.label}</span>
                  
                  {/* Hover Glow */}
                  {!isActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/0 via-indigo-500/5 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" />
                  )}
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User Section */}
      <div className="relative p-4 border-t border-white/10 space-y-2">
        {/* Settings */}
        <NavLink
          to="/configuracoes"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300',
              isActive
                ? 'bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            )
          }
        >
          <Settings className="w-5 h-5" />
          <span>Configurações</span>
        </NavLink>

        {/* User Profile */}
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
        <p className="text-center text-xs text-slate-600 font-medium">
          Finax v3.0 • 2026
        </p>
      </div>
    </aside>
  );
}
