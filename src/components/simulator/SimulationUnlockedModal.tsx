import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Flame, ListChecks, PhoneCall, Sparkles, Unlock } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { backdropDismiss } from '@/lib/backdropDismiss';
import { cn } from '@/lib/cn';
import type { UnlockedSimulation } from '@/services/moduleSimulations.service';

/* ───────────────────────────────────────────────────────────────────────────
   "Desbloqueaste la práctica" — el momento en que termina un módulo y se abre
   la simulación que colgaba de él.

   Es el premio del módulo, así que se comporta como un premio: entra con
   resorte, dos aros que se expanden desde el candado abierto y una lluvia corta
   de chispas. Todo se apaga solo; nada late para siempre (un modal que palpita
   sin parar deja de ser una celebración y pasa a ser una alarma).

   Con `prefers-reduced-motion` no hay aros, ni chispas, ni resortes: solo un
   fundido. La información es exactamente la misma.
   ─────────────────────────────────────────────────────────────────────────── */

export interface SimulationUnlockedModalProps {
  open: boolean;
  /** Módulo recién terminado: es el motivo de la celebración, se nombra. */
  moduleTitle: string;
  simulations: UnlockedSimulation[];
  /**
   * Color del curso, en HEX. Tiene que ser hex porque los tintes se arman
   * concatenando el alfa (`${color}1F`): con `rgb(var(--x))` saldría una
   * declaración inválida y la cabecera se quedaría sin color.
   */
  color?: string;
  onStart: (sim: UnlockedSimulation) => void;
  onClose: () => void;
  /** Acción secundaria: seguir al módulo siguiente (si lo hay). */
  onNext?: () => void;
}

const ease = [0.16, 1, 0.3, 1] as const;
const LEVEL_KEY = { basico: 'basic', medio: 'medium', avanzado: 'advanced' } as const;

/** Chispas: ángulos fijos (no aleatorios) para que la explosión sea pareja. */
const SPARKS = Array.from({ length: 12 }, (_, i) => ({
  angle: (i / 12) * Math.PI * 2,
  distance: 54 + (i % 3) * 16,
  delay: 0.12 + (i % 4) * 0.045,
}));

export function SimulationUnlockedModal({
  open,
  moduleTitle,
  simulations,
  color = '#10D451', // verde corporativo, el mismo en claro y oscuro
  onStart,
  onClose,
  onNext,
}: SimulationUnlockedModalProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const many = simulations.length > 1;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-label={t('module.sim_unlocked.title')}
        >
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" {...backdropDismiss(onClose)} />

          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 24 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
            transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 24, mass: 0.9 }}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-line bg-surface shadow-glass-lg"
          >
            {/* ── Cabecera: el momento ─────────────────────────────────────── */}
            <div className="relative overflow-hidden px-6 pb-6 pt-9 text-center sm:px-8">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-56"
                style={{ background: `radial-gradient(120% 100% at 50% 0%, ${color}26, transparent 70%)` }}
              />

              <div className="relative mx-auto mb-5 h-16 w-16">
                {/* Aros: dos ondas que salen del candado. Se ven una vez. */}
                {!reduce &&
                  [0, 0.35].map((delay) => (
                    <motion.span
                      key={delay}
                      aria-hidden
                      className="absolute inset-0 rounded-3xl border"
                      style={{ borderColor: color }}
                      initial={{ opacity: 0.55, scale: 0.85 }}
                      animate={{ opacity: 0, scale: 2.1 }}
                      transition={{ duration: 1.5, ease: 'easeOut', delay: 0.1 + delay }}
                    />
                  ))}

                {/* Chispas. */}
                {!reduce &&
                  SPARKS.map((s, i) => (
                    <motion.span
                      key={i}
                      aria-hidden
                      className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
                      style={{ background: color }}
                      initial={{ opacity: 0, x: -3, y: -3, scale: 0.6 }}
                      animate={{
                        opacity: [0, 1, 0],
                        x: Math.cos(s.angle) * s.distance - 3,
                        y: Math.sin(s.angle) * s.distance - 3,
                        scale: [0.6, 1, 0.3],
                      }}
                      transition={{ duration: 0.95, ease: 'easeOut', delay: s.delay }}
                    />
                  ))}

                <motion.div
                  initial={reduce ? false : { scale: 0.5, rotate: -12 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.06 }}
                  className="relative flex h-16 w-16 items-center justify-center rounded-3xl"
                  style={{ background: `${color}1F`, color }}
                >
                  <Unlock className="h-7 w-7" strokeWidth={2.2} />
                </motion.div>
              </div>

              <motion.p
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease, delay: 0.14 }}
                className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em]"
                style={{ color }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('module.sim_unlocked.kicker')}
              </motion.p>

              <motion.h2
                initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(5px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.55, ease, delay: 0.18 }}
                className="text-balance text-[24px] font-semibold leading-[1.15] tracking-[-0.03em] text-text sm:text-[28px]"
              >
                {many
                  ? t('module.sim_unlocked.title_many', { n: simulations.length })
                  : t('module.sim_unlocked.title')}
              </motion.h2>

              <motion.p
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease, delay: 0.24 }}
                className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-text-muted"
              >
                {t('module.sim_unlocked.subtitle', { title: moduleTitle })}
              </motion.p>
            </div>

            {/* ── Lo que se ganó ───────────────────────────────────────────── */}
            <div className="space-y-2 px-5 pb-5 sm:px-7">
              {simulations.map((sim, i) => {
                const Icon = sim.kind === 'call' ? PhoneCall : ListChecks;
                const flames = sim.kind === 'call' ? sim.difficulty ?? 0 : 0;
                return (
                  <motion.button
                    key={sim.rowId}
                    type="button"
                    onClick={() => onStart(sim)}
                    initial={reduce ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease, delay: 0.3 + i * 0.07 }}
                    whileHover={reduce ? undefined : { y: -3 }}
                    whileTap={reduce ? undefined : { scale: 0.99 }}
                    className="group flex w-full items-center gap-3.5 rounded-2xl border border-line px-4 py-3.5 text-left transition-shadow duration-500 ease-apple hover:shadow-card-hover"
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                      style={{ background: `${color}1A`, color }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium tracking-tight text-text">{sim.title}</div>
                      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                        <span className="truncate">
                          {sim.kind === 'call'
                            ? t('course_practice.picker_type_call')
                            : t('course_practice.picker_type_choice')}
                        </span>
                        <span className="text-text-subtle/50">·</span>
                        <span className="shrink-0 tabular-nums">
                          {t('course_practice.stop_pass', { score: sim.passScore })}
                        </span>
                        {flames > 0 && (
                          <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
                            {[1, 2, 3].map((d) => (
                              <Flame
                                key={d}
                                className={cn('h-3 w-3', d > flames && 'text-line')}
                                style={d <= flames ? { color } : undefined}
                                fill={d <= flames ? 'currentColor' : 'none'}
                              />
                            ))}
                          </span>
                        )}
                        {sim.kind === 'choice' && sim.level && (
                          <span className="hidden shrink-0 sm:inline">
                            {t(`simulator.choice.level_${LEVEL_KEY[sim.level]}`)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle transition-transform duration-500 ease-apple group-hover:translate-x-1 group-hover:text-text" />
                  </motion.button>
                );
              })}
            </div>

            {/* ── Salidas ──────────────────────────────────────────────────── */}
            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, ease, delay: 0.42 }}
              className="flex flex-col-reverse items-center gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-between sm:px-7"
            >
              <button
                type="button"
                onClick={onClose}
                className="text-[13px] text-text-subtle transition-colors duration-300 hover:text-text"
              >
                {t('module.sim_unlocked.later')}
              </button>
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
                >
                  {t('module.sim_unlocked.next_module')}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
