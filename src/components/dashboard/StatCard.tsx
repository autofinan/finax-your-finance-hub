import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'success' | 'danger';
}

export function StatCard({ title, value, icon, trend, variant = 'default' }: StatCardProps) {
  return (
    <div className="glass rounded-2xl p-6 animate-scale-in">
      <div className="flex items-start justify-between mb-4">
        <div
          className={cn(
            'p-3 rounded-xl',
            variant === 'success' && 'bg-green-500/10 text-green-600 dark:text-green-400',
            variant === 'danger' && 'bg-red-500/10 text-red-600 dark:text-red-400',
            variant === 'default' && 'bg-primary/10 text-primary'
          )}
        >
          {icon}
        </div>
        {trend && (
          <span
            className={cn(
              'text-xs font-medium px-2 py-1 rounded-full',
              trend.value >= 0
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            )}
          >
            {trend.value >= 0 ? '+' : ''}
            {trend.value}% {trend.label}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-1">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
