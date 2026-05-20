import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'default' | 'subtle' | 'glass' | 'glass-strong';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  tone?: Tone;
  padding?: 'sm' | 'md' | 'lg' | 'xl' | 'none';
}

const padMap = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
  xl: 'p-10 md:p-12',
};

const toneMap: Record<Tone, string> = {
  default:       'bg-surface border border-line',
  subtle:        'bg-subtle border border-line',
  glass:         'glass',
  'glass-strong': 'glass-strong',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, tone = 'default', padding = 'md', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-3xl transition-colors duration-200 ease-apple',
          toneMap[tone],
          interactive && 'cursor-pointer hover:bg-subtle',
          padMap[padding],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = 'Card';
