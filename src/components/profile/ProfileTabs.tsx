import { type ElementType } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

export interface ProfileTab {
  id: string;
  label: string;
  icon: ElementType;
  /** Contador opcional a la derecha del rótulo (certificados, logros…). */
  count?: number;
}

/**
 * Control segmentado del perfil. El indicador se desliza con `layoutId`, así
 * que la pastilla viaja de una pestaña a otra en vez de parpadear.
 *
 * `layoutGroup` distingue instancias: si dos controles distintos comparten el
 * mismo layoutId, Motion intenta animar entre ellos y la pastilla "salta" de un
 * componente al otro.
 */
export function ProfileTabs({
  tabs,
  active,
  onChange,
  layoutGroup = 'profile-tabs',
  className,
}: {
  tabs: ProfileTab[];
  active: string;
  onChange: (id: string) => void;
  layoutGroup?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <div
      role="tablist"
      className={cn(
        'flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1.5',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map(({ id, label, icon: Icon, count }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={cn(
              'relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors',
              isActive ? 'text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`${layoutGroup}-pill`}
                className="absolute inset-0 rounded-xl border border-line bg-subtle"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 420, damping: 34 }
                }
              />
            )}
            <Icon className="relative h-4 w-4" />
            <span className="relative whitespace-nowrap">{label}</span>
            {count != null && count > 0 && (
              <span
                className={cn(
                  'relative rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                  isActive ? 'bg-primary/15 text-primary' : 'bg-subtle text-text-subtle',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
