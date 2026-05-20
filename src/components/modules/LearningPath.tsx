import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Check,
  Lock,
  Sparkles,
  Headphones,
  HeartHandshake,
  Globe,
  Shield,
  FileCheck,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { LearningModule } from '@/data/modules';
import type { Language } from '@/stores/userStore';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Reveal } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';

const iconMap: Record<string, typeof Sparkles> = {
  Sparkles,
  Headphones,
  HeartHandshake,
  Globe,
  Shield,
  FileCheck,
};

interface LearningPathProps {
  modules: LearningModule[];
  language: Language;
  completedIds: string[];
}

type Status = 'completed' | 'available' | 'locked';

export function LearningPath({ modules, language, completedIds }: LearningPathProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  const items = modules.map((m, idx) => {
    let status: Status;
    if (completedIds.includes(m.id)) status = 'completed';
    else if (idx === 0 || completedIds.includes(modules[idx - 1].id)) status = 'available';
    else status = 'locked';
    return { module: m, status, idx };
  });

  return (
    <ol className="relative">
      {items.map(({ module, status, idx }) => {
        const Icon = iconMap[module.icon] ?? Sparkles;
        const isLast = idx === items.length - 1;
        const numLabel = String(idx + 1).padStart(2, '0');
        const interactive = status !== 'locked';
        const Wrapper: React.ElementType = interactive ? Link : 'div';
        const wrapperProps = interactive ? { to: `/modules/${module.id}` } : {};

        return (
          <Reveal as="li" key={module.id} delay={idx * 60} className="relative pl-16 md:pl-20 pb-6">
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[22px] md:left-[26px] top-12 bottom-0 w-px',
                  status === 'completed'
                    ? 'bg-gradient-to-b from-glass-border/30 to-glass-border/8'
                    : 'bg-glass-border/10',
                )}
              />
            )}

            {/* Pulse ring glow for next-available module */}
            {status === 'available' && !reducedMotion && (
              <motion.span
                aria-hidden
                className="absolute left-0 top-3 h-12 w-12 rounded-full"
                style={{ boxShadow: '0 0 0 2px rgb(var(--neon-green) / 0.15)' }}
                animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.8 }}
              />
            )}

            <span
              aria-hidden
              className={cn(
                'absolute left-0 top-3 inline-flex items-center justify-center h-12 w-12 rounded-full text-[13px] font-semibold tabular-nums transition-colors',
                status === 'completed' &&
                  'bg-neon-green text-black',
                status === 'available' &&
                  'glass border-glass-border/20 text-text',
                status === 'locked' &&
                  'glass border-glass-border/8 text-text-subtle',
              )}
            >
              {status === 'completed' ? <Check className="h-5 w-5" strokeWidth={3} /> : numLabel}
            </span>

            <motion.div
              whileHover={interactive && !reducedMotion ? { y: -2 } : undefined}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-[1.25rem]"
            >
              <Wrapper
                {...wrapperProps}
                className={cn(
                  'group block rounded-[1.25rem] p-5 md:p-6 transition-all duration-300',
                  status === 'completed' && 'glass border-glass-border/15',
                  status === 'available' && 'glass-md border-glass-border/12 hover:border-glass-border/22',
                  status === 'locked' && 'glass opacity-50 pointer-events-none',
                )}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      'shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-2xl ring-1',
                      status === 'completed'
                        ? 'bg-neon-green/8 text-neon-green ring-neon-green/12'
                        : 'bg-glass/8 text-text-muted ring-glass-border/8',
                    )}
                  >
                    {status === 'locked' ? <Lock className="h-4 w-4" /> : <Icon className="h-5 w-5" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-text-subtle">
                        {t('module.of_modules', { idx: idx + 1, total: items.length })}
                      </span>
                      <span className="text-text-subtle">·</span>
                      <span className="text-[11px] text-text-subtle">
                        {t('module.duration', { min: module.duration })}
                      </span>
                      <span className="text-text-subtle">·</span>
                      <StatusBadge status={status} />
                    </div>
                    <h3 className="text-title font-semibold tracking-tight mb-1.5">
                      {module.title[language]}
                    </h3>
                    <p className="text-[14px] text-text-muted leading-relaxed line-clamp-2">
                      {module.subtitle[language]}
                    </p>
                  </div>

                  {interactive && (
                    <ArrowRight className="hidden sm:block shrink-0 h-4 w-4 text-text-muted mt-2 group-hover:translate-x-0.5 transition-transform" />
                  )}
                </div>
              </Wrapper>
            </motion.div>
          </Reveal>
        );
      })}
    </ol>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const { t } = useTranslation();
  if (status === 'completed') {
    return <span className="text-[11px] text-neon-green font-medium">{t('dashboard.status_completed')}</span>;
  }
  if (status === 'available') {
    return <span className="text-[11px] text-text-muted font-medium">{t('dashboard.status_available')}</span>;
  }
  return <span className="text-[11px] text-text-subtle">{t('dashboard.status_locked')}</span>;
}
