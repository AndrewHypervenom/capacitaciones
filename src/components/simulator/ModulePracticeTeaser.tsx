import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ChevronRight, ListChecks, Lock, PhoneCall, Sparkles } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';
import type { UnlockedSimulation } from '@/services/moduleSimulations.service';

/* ───────────────────────────────────────────────────────────────────────────
   El premio del módulo, dentro del módulo.

   Antes de completarlo: anuncia qué práctica se abre al terminar — un módulo
   que promete algo se termina más que uno que no promete nada.
   Después: es la puerta de entrada, para el que cerró la celebración y volvió.

   No es un candado de castigo: bloqueado se ve tranquilo (línea punteada, gris)
   y abierto se enciende con el color de marca.
   ─────────────────────────────────────────────────────────────────────────── */

export interface ModulePracticeTeaserProps {
  simulations: UnlockedSimulation[];
  /** ¿El módulo ya está completado? Entonces la práctica está abierta. */
  unlocked: boolean;
  onStart: (sim: UnlockedSimulation) => void;
  className?: string;
}

const ease = [0.16, 1, 0.3, 1] as const;

export function ModulePracticeTeaser({
  simulations,
  unlocked,
  onStart,
  className,
}: ModulePracticeTeaserProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  if (simulations.length === 0) return null;
  const many = simulations.length > 1;

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease }}
      className={cn(
        'relative overflow-hidden rounded-2xl border px-5 py-4',
        unlocked ? 'border-brand-green/35' : 'border-dashed border-line',
        className,
      )}
    >
      {unlocked && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(100deg, rgb(var(--brand-green) / 0.10), transparent 60%)',
          }}
        />
      )}

      <div className="relative flex items-start gap-3.5">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl',
            unlocked
              ? 'bg-brand-green/12 text-brand-green'
              : 'bg-subtle text-text-subtle',
          )}
        >
          {unlocked ? <Sparkles className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium tracking-tight text-text">
            {unlocked
              ? many
                ? t('module.practice_teaser.open_title_many', { n: simulations.length })
                : t('module.practice_teaser.open_title')
              : many
                ? t('module.practice_teaser.locked_title_many', { n: simulations.length })
                : t('module.practice_teaser.locked_title')}
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">
            {unlocked ? t('module.practice_teaser.open_hint') : t('module.practice_teaser.locked_hint')}
          </p>

          <div className="mt-3 space-y-1.5">
            {simulations.map((sim) => {
              const Icon = sim.kind === 'call' ? PhoneCall : ListChecks;
              if (!unlocked) {
                return (
                  <div
                    key={sim.rowId}
                    className="flex items-center gap-2.5 text-[13px] text-text-muted"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
                    <span className="truncate">{sim.title}</span>
                  </div>
                );
              }
              return (
                <motion.button
                  key={sim.rowId}
                  type="button"
                  onClick={() => onStart(sim)}
                  whileHover={reduce ? undefined : { x: 3 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                  className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-300 hover:bg-brand-green/8"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-brand-green" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
                    {sim.title}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-text-subtle">
                    {t('course_practice.stop_pass', { score: sim.passScore })}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-subtle transition-transform duration-500 ease-apple group-hover:translate-x-1" />
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
