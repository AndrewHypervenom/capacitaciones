import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass' | 'neon';
type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand-green text-white dark:text-black hover:brightness-110 active:brightness-95',
  secondary:
    'bg-surface text-text border border-line hover:bg-subtle',
  ghost:
    'bg-transparent text-text-muted hover:text-text hover:bg-subtle',
  danger:
    'bg-danger text-white hover:brightness-110 active:brightness-95',
  glass:
    'glass text-text hover:bg-glass/10 hover:border-glass-border/14',
  neon:
    'bg-neon-green/10 border border-neon-green/20 text-neon-green hover:bg-neon-green/16 hover:border-neon-green/30',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px] rounded-full',
  md: 'h-11 px-6 text-[15px] rounded-full',
  lg: 'h-12 px-7 text-[15px] rounded-full',
  xl: 'h-14 px-9 text-[16px] rounded-full',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium tracking-tight',
          'transition-[background-color,border-color,opacity] duration-200 ease-apple',
          'active:scale-[0.98]',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
