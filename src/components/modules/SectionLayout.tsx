import { cn } from '@/lib/cn';
import type { SectionStyle } from '@/data/modules';

interface Props {
  style?: SectionStyle;
  hasMedia: boolean;
  children: React.ReactNode;
  className?: string;
  feedbackNode?: React.ReactNode;
}

export function SectionLayout({ style = 'default', hasMedia, children, className, feedbackNode }: Props) {

 if (style === 'immersive') {
    return (
      <div className={cn(
        'rounded-3xl px-8 py-10 md:px-12 md:py-14 relative overflow-hidden',
        'glass-md border-neon-green/10',
        className,
      )}>
        {/* Glow superior */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden
          style={{ background: 'var(--gradient-section-glow)' }}
        />
        <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-neon-green/6 blur-3xl pointer-events-none animate-[glow-pulse_4s_ease-in-out_infinite]" aria-hidden />
        <div className="absolute bottom-0 left-0 h-24 w-48 rounded-full bg-neon-green/4 blur-2xl pointer-events-none" aria-hidden />
        {/* Top shimmer line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-green/25 to-transparent" aria-hidden />
        
        {/* Contenido principal y feedback fluyendo de forma relativa */}
        <div className="relative space-y-6">
          {children}
          
          {/* Si hay feedback, lo envolvemos en un contenedor estilizado con backdrop-blur */}
          {feedbackNode && (
            <div className="mt-8 rounded-2xl p-5 border border-neon-green/20 bg-black/40 backdrop-blur-md animate-[fadeIn_0.5s_ease-out]">
              {feedbackNode}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (style === 'hero') {
    return (
      <div className={cn(
        'relative rounded-3xl overflow-hidden min-h-[380px] md:min-h-[460px] flex items-end',
        'border border-glass-border/8',
        className,
      )}>
        {children}
      </div>
    );
  }

  if (style === 'spotlight') {
    return (
      <div className={cn(
        'rounded-3xl px-8 py-10 md:px-12 md:py-14 relative overflow-hidden',
        'glass-strong',
        className,
      )}>
        {/* Corner glow violet */}
        <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-neon-violet/8 blur-3xl pointer-events-none animate-[glow-pulse_3s_ease-in-out_infinite]" aria-hidden />
        <div className="absolute -top-8 -left-8 h-32 w-32 rounded-full bg-neon-violet/4 blur-2xl pointer-events-none" aria-hidden />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-violet/30 to-transparent" aria-hidden />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-violet/10 to-transparent" aria-hidden />
        <div className="relative">{children}{feedbackNode}</div>
      </div>
    );
  }

  if (style === 'feature') {
    return (
      <div className={cn('text-center py-6 md:py-10 max-w-2xl mx-auto relative', className)}>
        {/* Blob central decorativo */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
          <div className="h-64 w-64 rounded-full bg-neon-green/4 blur-3xl animate-[float_6s_ease-in-out_infinite]" />
        </div>
        <div className="relative">{children}{feedbackNode}</div>
      </div>
    );
  }

  return <div className={className}>{children}{feedbackNode}</div>;
}
