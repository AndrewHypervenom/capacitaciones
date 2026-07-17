import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Flame, ListChecks, Lock, PhoneCall, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Scenario } from '@/data/scenarios';
import type { ChoiceScenario } from '@/data/choiceScenarios';
import type { Language } from '@/stores/userStore';
import { CountryFlag } from '@/components/layout/CountryFlag';
import { backdropDismiss } from '@/lib/backdropDismiss';
import { cn } from '@/lib/cn';

export type SimPick = { kind: 'call' | 'choice'; id: string };

/** Fila normalizada: una llamada y una de opción múltiple se pintan igual. */
interface Row {
  kind: 'call' | 'choice';
  id: string;
  title: string;
  summary: string;
  /** 1-3, para ordenar y para las llamas. */
  difficulty: 1 | 2 | 3;
  country?: Scenario['country'];
  level?: ChoiceScenario['level'];
}

interface SimulatorPickerModalProps {
  scenarios: Scenario[];
  choiceScenarios: ChoiceScenario[];
  language: Language;
  /** Color del curso: tiñe el acento del modal. */
  accent: string;
  /** Si está bloqueado, el modal explica por qué en vez de dejar elegir. */
  unlocked: boolean;
  lockedReason: string;
  /** Mejor puntaje del curso, si ya intentó alguna. */
  bestScore?: number;
  onPick: (pick: SimPick) => void;
  onClose: () => void;
}

const LEVEL_DIFFICULTY: Record<ChoiceScenario['level'], 1 | 2 | 3> = {
  basico: 1,
  medio: 2,
  avanzado: 3,
};

/**
 * Selector de simulación del curso.
 *
 * Reemplaza al viejo `scrollIntoView` del botón "Hacer la simulación": el scroll
 * era invisible en pantallas donde la sección ya estaba en viewport, así que el
 * botón parecía muerto. Aquí la decisión pasa al frente: con una sola simulación
 * CoursePage entra directo (sin modal) y con varias se elige aquí.
 */
export function SimulatorPickerModal({
  scenarios,
  choiceScenarios,
  language,
  accent,
  unlocked,
  lockedReason,
  bestScore,
  onPick,
  onClose,
}: SimulatorPickerModalProps) {
  const { t } = useTranslation();

  // Más fácil primero: la primera fila es la que recomendamos para empezar.
  const rows = useMemo<Row[]>(() => {
    const calls: Row[] = scenarios.map((s) => ({
      kind: 'call',
      id: s.id,
      title: s.title[language],
      summary: s.summary[language],
      difficulty: s.difficulty,
      country: s.country,
    }));
    const choices: Row[] = choiceScenarios.map((s) => ({
      kind: 'choice',
      id: s.id,
      title: s.title[language],
      summary: s.description[language],
      difficulty: LEVEL_DIFFICULTY[s.level],
      level: s.level,
    }));
    return [...calls, ...choices].sort((a, b) => a.difficulty - b.difficulty);
  }, [scenarios, choiceScenarios, language]);

  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (!unlocked || rows.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        setCursor((c) => (c + 1) % rows.length);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setCursor((c) => (c - 1 + rows.length) % rows.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[cursor];
        if (row) onPick({ kind: row.kind, id: row.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, unlocked, onPick, onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={t('course_practice.picker_title')}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />

        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 14 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 14 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="relative w-full max-w-2xl"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-glass-lg">
            {/* Halo del color del curso detrás del header */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[130%] -translate-x-1/2 opacity-40 blur-3xl"
              style={{ background: `radial-gradient(closest-side, ${accent}, transparent)` }}
            />

            {/* ── Header ── */}
            <div className="relative flex items-start justify-between gap-3 border-b border-line px-6 py-5">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm"
                    style={{ background: accent }}
                  >
                    {unlocked ? <PhoneCall className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  </span>
                  {unlocked && typeof bestScore === 'number' && bestScore > 0 && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[12px] font-semibold tabular-nums text-primary">
                      {t('course_practice.best_score', { score: bestScore })}
                    </span>
                  )}
                </div>
                <h3 className="text-[18px] font-bold tracking-tight text-text">
                  {unlocked ? t('course_practice.picker_title') : t('course_practice.picker_locked_title')}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
                  {unlocked ? t('course_practice.picker_subtitle', { n: rows.length }) : lockedReason}
                </p>
              </div>
              <button
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Opciones ── */}
            {unlocked && (
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-1 gap-3">
                  {rows.map((row, i) => {
                    const active = i === cursor;
                    return (
                      <motion.button
                        key={`${row.kind}-${row.id}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 + i * 0.06, type: 'spring', stiffness: 420, damping: 32 }}
                        onMouseEnter={() => setCursor(i)}
                        onFocus={() => setCursor(i)}
                        onClick={() => onPick({ kind: row.kind, id: row.id })}
                        whileHover={{ y: -3 }}
                        whileTap={{ scale: 0.985 }}
                        className={cn(
                          'group relative overflow-hidden rounded-2xl border bg-surface p-5 text-left outline-none transition-colors',
                          active ? 'border-primary shadow-card-hover' : 'border-line hover:border-primary/50',
                        )}
                      >
                        {/* Barra de acento: sin AnimatePresence, para que layoutId la
                            deslice de una tarjeta a otra en vez de montar/desmontar. */}
                        {active && (
                          <motion.span
                            aria-hidden
                            layoutId="sim-picker-accent"
                            className="absolute inset-y-0 left-0 w-1"
                            style={{ background: accent }}
                            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                          />
                        )}

                        <div className="mb-2.5 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            {row.kind === 'call' ? (
                              <>
                                {row.country && <CountryFlag code={row.country} size={18} />}
                                <span className="text-[12px] font-medium text-text-muted">
                                  {t('course_practice.picker_type_call')}
                                </span>
                              </>
                            ) : (
                              <>
                                <ListChecks className="h-4 w-4 text-primary" />
                                <span className="text-[12px] font-medium text-text-muted">
                                  {t('course_practice.picker_type_choice')}
                                </span>
                              </>
                            )}
                            {i === 0 && rows.length > 1 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                <Sparkles className="h-3 w-3" />
                                {t('course_practice.picker_recommended')}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {[1, 2, 3].map((d) => (
                              <Flame
                                key={d}
                                className={cn('h-3.5 w-3.5', d <= row.difficulty ? 'text-primary' : 'text-line')}
                                fill={d <= row.difficulty ? 'currentColor' : 'none'}
                              />
                            ))}
                          </div>
                        </div>

                        <h4 className="mb-1 text-[15px] font-semibold tracking-tight text-text">{row.title}</h4>
                        <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-text-muted">{row.summary}</p>

                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                          {t('course_practice.picker_start')}
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Pie ── */}
            {unlocked && rows.length > 1 && (
              <div className="border-t border-line px-6 py-3">
                <p className="text-[12px] text-text-subtle">{t('course_practice.picker_hint')}</p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
