import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'success' | 'danger' | 'warning';
  delay?: number;
}

export function StatCard({ 
  title, 
  value, 
  icon, 
  trend, 
  variant = 'default',
  delay = 0 
}: StatCardProps) {
  
  const variantStyles = {
    default: 'bg-indigo-500/10 text-indigo-400 shadow-indigo-500/20',
    success: 'bg-emerald-500/10 text-emerald-400 shadow-emerald-500/20',
    danger: 'bg-red-500/10 text-red-400 shadow-red-500/20',
    warning: 'bg-amber-500/10 text-amber-400 shadow-amber-500/20',
  };

  const trendStyles = trend && trend.value >= 0
    ? 'bg-emerald-500/10 text-emerald-400'
    : 'bg-red-500/10 text-red-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className="group relative bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:border-indigo-500/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(79,70,229,0.2)] overflow-hidden"
    >
      {/* Glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-transparent to-transparent opacity-0 group-hover:opacity-10 transition-opacity duration-500" />
      
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div
            className={cn(
              'p-3 rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-110',
              variantStyles[variant]
            )}
          >
            {icon}
          </div>
          {trend && (
            <span
              className={cn(
                'text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm',
                trendStyles
              )}
            >
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
            </span>
          )}
        </div>

        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
          {title}
        </p>
        
        <p className="text-3xl font-black text-white tracking-tight">
          {value}
        </p>

        {trend && (
          <p className="text-xs text-slate-500 mt-2">
            {trend.label}
          </p>
        )}
      </div>
    </motion.div>
  );
}
