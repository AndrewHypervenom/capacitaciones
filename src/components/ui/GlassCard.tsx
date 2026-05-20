import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

type GlassIntensity = 'subtle' | 'default' | 'strong';
type GlassGlow = 'none' | 'green' | 'violet' | 'cyan';
type GlassPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';
type GlassRounded = 'xl' | '2xl' | '3xl' | '4xl';

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  intensity?: GlassIntensity;
  glow?: GlassGlow;
  padding?: GlassPadding;
  interactive?: boolean;
  shimmer?: boolean;
  rounded?: GlassRounded;
}

const intensityMap: Record<GlassIntensity, string> = {
  subtle:  'glass',
  default: 'glass-md',
  strong:  'glass-strong',
};

const glowMap: Record<GlassGlow, string> = {
  none:   '',
  green:  'glass-glow-green',
  violet: 'glass-glow-violet',
  cyan:   'glass-glow-cyan',
};

const padMap: Record<GlassPadding, string> = {
  none: '',
  sm:   'p-4',
  md:   'p-6',
  lg:   'p-8',
  xl:   'p-10 md:p-12',
};

const roundedMap: Record<GlassRounded, string> = {
  xl:   'rounded-xl',
  '2xl': 'rounded-2xl',
  '3xl': 'rounded-3xl',
  '4xl': 'rounded-4xl',
};

function ShimmerBorder() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit] overflow-hidden"
    >
      <span
        className="absolute inset-0 rounded-[inherit]"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgb(var(--neon-green) / 0.14) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 3s linear infinite',
        }}
      />
    </span>
  );
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  (
    {
      className,
      intensity = 'default',
      glow = 'none',
      padding = 'none',
      interactive = false,
      shimmer = false,
      rounded = '3xl',
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          'relative overflow-hidden',
          intensityMap[intensity],
          glowMap[glow],
          roundedMap[rounded],
          padMap[padding],
          interactive &&
            'cursor-pointer hover:-translate-y-0.5 hover:shadow-card-hover transition-all duration-300 ease-apple',
          className,
        )}
        {...props}
      >
        {shimmer && <ShimmerBorder />}
        {children}
      </div>
    );
  },
);

GlassCard.displayName = 'GlassCard';
