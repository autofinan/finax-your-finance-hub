import { 
  TrendingDown, 
  TrendingUp, 
  RefreshCcw, 
  CreditCard,
  MessageCircle,
  Target,
  Plus,
  Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface QuickActionsProps {
  onAddTransaction: () => void;
}

export function QuickActions({ onAddTransaction }: QuickActionsProps) {
  const navigate = useNavigate();

  const actions = [
    {
      label: 'Novo Gasto',
      icon: TrendingDown,
      onClick: onAddTransaction,
      color: 'from-red-500 to-rose-500',
      bgColor: 'bg-red-500/10',
      textColor: 'text-red-400',
      featured: true,
    },
    {
      label: 'Nova Entrada',
      icon: TrendingUp,
      onClick: onAddTransaction,
      color: 'from-emerald-500 to-green-500',
      bgColor: 'bg-emerald-500/10',
      textColor: 'text-emerald-400',
      featured: false,
    },
    {
      label: 'Recorrentes',
      icon: RefreshCcw,
      onClick: () => navigate('/recorrentes'),
      color: 'from-cyan-500 to-blue-500',
      bgColor: 'bg-cyan-500/10',
      textColor: 'text-cyan-400',
      featured: false,
    },
    {
      label: 'Cartões',
      icon: CreditCard,
      onClick: () => navigate('/cartoes'),
      color: 'from-purple-500 to-pink-500',
      bgColor: 'bg-purple-500/10',
      textColor: 'text-purple-400',
      featured: false,
    },
    {
      label: 'Metas',
      icon: Target,
      onClick: () => navigate('/metas'),
      color: 'from-amber-500 to-orange-500',
      bgColor: 'bg-amber-500/10',
      textColor: 'text-amber-400',
      featured: false,
    },
    {
      label: 'Falar com Fin',
      icon: MessageCircle,
      onClick: () => navigate('/chat'),
      color: 'from-indigo-500 to-blue-500',
      bgColor: 'bg-indigo-500/10',
      textColor: 'text-indigo-400',
      featured: false,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(79,70,229,0.2)]"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl bg-indigo-500/10">
          <Zap className="w-5 h-5 text-indigo-400" />
        </div>
        <h3 className="font-bold text-lg text-white">Ações Rápidas</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {actions.map((action, index) => {
          const Icon = action.icon;
          
          return (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              onClick={action.onClick}
              className={cn(
                "group relative p-4 rounded-xl border border-white/5 transition-all duration-300 hover:border-white/20 hover:scale-[1.02] active:scale-95",
                action.featured 
                  ? `bg-gradient-to-br ${action.color} shadow-lg` 
                  : "bg-white/5 hover:bg-white/10"
              )}
            >
              {/* Glow effect */}
              {action.featured && (
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              )}

              <div className="relative flex flex-col items-center gap-2">
                <div className={cn(
                  "p-3 rounded-xl transition-transform duration-300 group-hover:scale-110",
                  action.featured ? "bg-white/20" : action.bgColor
                )}>
                  <Icon className={cn(
                    "w-5 h-5",
                    action.featured ? "text-white" : action.textColor
                  )} />
                </div>
                <span className={cn(
                  "text-xs font-bold text-center",
                  action.featured ? "text-white" : "text-slate-300"
                )}>
                  {action.label}
                </span>
              </div>

              {/* Featured badge */}
              {action.featured && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full animate-pulse" />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Quick Tip */}
      <div className="mt-6 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
        <p className="text-xs text-indigo-300 leading-relaxed">
          💡 <span className="font-semibold">Dica:</span> Use o WhatsApp para registrar gastos instantaneamente!
        </p>
      </div>
    </motion.div>
  );
}
