import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  display?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, display, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full outline-none placeholder:text-text-subtle/70 transition-colors',
          display
            ? 'text-center text-4xl md:text-5xl font-semibold tracking-[-0.035em] py-4 bg-transparent border-b border-line focus:border-brand-green'
            : 'h-12 px-4 text-[15px] rounded-2xl bg-surface border border-line focus:border-brand-green',
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';
