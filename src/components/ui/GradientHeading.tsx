import { type HTMLAttributes, forwardRef, createElement } from 'react';
import { cn } from '@/lib/cn';

type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4';
type GradientVariant = 'white' | 'green' | 'violet' | 'green-violet' | 'cyan-green';
type HeadingSize =
  | 'display-xl'
  | 'display-lg'
  | 'display-md'
  | 'headline'
  | 'title';

export interface GradientHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: HeadingLevel;
  variant?: GradientVariant;
  size?: HeadingSize;
  animate?: boolean;
}

const variantMap: Record<GradientVariant, string> = {
  // Clean text — works in both light and dark mode
  white:
    'text-text',
  // Color variants — used sparingly for hero moments only
  green:
    'bg-gradient-to-r from-neon-green to-neon-green/70 bg-clip-text text-transparent',
  violet:
    'bg-gradient-to-r from-neon-violet to-neon-violet/60 bg-clip-text text-transparent',
  'green-violet':
    'bg-gradient-to-r from-neon-green to-neon-violet bg-clip-text text-transparent',
  'cyan-green':
    'bg-gradient-to-r from-neon-green via-neon-violet/40 to-neon-violet bg-clip-text text-transparent',
};

const sizeMap: Record<HeadingSize, string> = {
  'display-xl': 'text-display-xl font-bold tracking-tight',
  'display-lg': 'text-display-lg font-bold tracking-tight',
  'display-md': 'text-display-md font-bold tracking-tight',
  headline:     'text-headline font-semibold',
  title:        'text-title font-semibold',
};

export const GradientHeading = forwardRef<HTMLHeadingElement, GradientHeadingProps>(
  (
    {
      as = 'h2',
      variant = 'white',
      size = 'headline',
      animate = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return createElement(
      as,
      {
        ref,
        className: cn(
          sizeMap[size],
          variantMap[variant],
          animate && 'animate-fade-in',
          className,
        ),
        ...props,
      },
      children,
    );
  },
);

GradientHeading.displayName = 'GradientHeading';
