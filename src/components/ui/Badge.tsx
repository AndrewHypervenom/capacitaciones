import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'brand' | 'success' | 'magenta' | 'warning';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneMap: Record<Tone, string> = {
  neutral: 'bg-subtle text-text-muted border border-line',
  brand: 'bg-brand-green/10 text-brand-green border border-brand-green/25',
  success: 'bg-success/10 text-success border border-success/25',
  magenta: 'bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/25',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25',
};

export function Badge({ className, tone = 'neutral', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-wide',
        toneMap[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
