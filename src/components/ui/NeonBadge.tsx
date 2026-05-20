import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type NeonColor = 'green' | 'violet' | 'cyan' | 'magenta' | 'amber' | 'neutral';

interface NeonBadgeProps {
  color?: NeonColor;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const colorMap: Record<NeonColor, string> = {
  green:   'text-neon-green   border-neon-green/12',
  violet:  'text-neon-violet  border-neon-violet/12',
  cyan:    'text-neon-cyan    border-neon-cyan/12',
  magenta: 'text-neon-magenta border-neon-magenta/12',
  amber:   'text-amber-400    border-amber-500/15',
  neutral: 'text-text-subtle  border-glass-border/8',
};

const dotMap: Record<NeonColor, string> = {
  green:   'bg-neon-green',
  violet:  'bg-neon-violet',
  cyan:    'bg-neon-cyan',
  magenta: 'bg-neon-magenta',
  amber:   'bg-amber-400',
  neutral: 'bg-text-subtle',
};

export function NeonBadge({
  color = 'neutral',
  dot = false,
  children,
  className,
}: NeonBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        'px-2.5 py-0.5 rounded-full',
        'text-[10px] font-semibold uppercase tracking-wider',
        'border bg-transparent',
        colorMap[color],
        className,
      )}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotMap[color])} />
      )}
      {children}
    </span>
  );
}
