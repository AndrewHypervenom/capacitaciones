import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

export interface GenerationStep {
  label: string
  /** Milliseconds to show this step before advancing to the next */
  durationMs: number
}

interface Props {
  steps: GenerationStep[]
  active: boolean
  title?: string
  /**
   * Paso actual REAL (índice). Si viene, manda sobre los temporizadores: los pasos
   * dejan de ser una animación y reflejan en qué anda de verdad el proceso.
   */
  stepIndex?: number
  /** Explicación de lo que está pasando ahora (por qué se está demorando). */
  note?: string
  /**
   * Avance DENTRO del paso actual (p. ej. momentos escritos / totales). Con esto la
   * barra deja de saltar de paso en paso y se mueve de verdad mientras Claude escribe.
   */
  subProgress?: { done: number; total: number }
  /** Expectativa de tiempo, visible desde el arranque (no una sorpresa a los 5 min). */
  hint?: string
}

/** mm:ss — a los 3 minutos, "184s" deja de significar algo. */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Mensajes que van apareciendo con el tiempo. La espera larga es real (un escenario
 * extenso con documento puede irse a varios minutos); lo que no puede pasar es que
 * el capacitador crea que se colgó.
 */
const PATIENCE_AT: { afterMs: number; key: string }[] = [
  { afterMs: 60_000, key: 'admin.gen.patience_1' },
  { afterMs: 150_000, key: 'admin.gen.patience_2' },
  { afterMs: 300_000, key: 'admin.gen.patience_3' },
]

function PulsingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1 w-1 rounded-full bg-brand-violet"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

export function GenerationProgress({ steps, active, title = 'Generando con Claude...', stepIndex, note, subProgress, hint }: Props) {
  const controlled = stepIndex != null
  const [timedStep, setTimedStep] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(0)

  useEffect(() => {
    if (active) {
      setPhase('running')
      setTimedStep(0)
      setElapsed(0)
      startRef.current = Date.now()

      intervalRef.current = setInterval(() => {
        const el = Date.now() - startRef.current
        setElapsed(el)

        let step = 0
        let acc = 0
        for (let i = 0; i < steps.length - 1; i++) {
          acc += steps[i].durationMs
          if (el >= acc) step = i + 1
          else break
        }
        setTimedStep(step)
      }, 200)

      return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (phase === 'running') {
        setPhase('done')
        setTimedStep(steps.length - 1)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (phase === 'idle') return null

  const currentStep = controlled ? Math.min(stepIndex!, steps.length - 1) : timedStep
  const totalDuration = steps.reduce((s, step) => s + step.durationMs, 0)
  // Fracción DENTRO del paso: si el paso reporta avance real (14 de 28 momentos), la
  // barra se mueve continuamente en vez de quedarse quieta minutos entre pasos.
  const inStep = subProgress && subProgress.total > 0
    ? Math.min(1, subProgress.done / subProgress.total)
    : 0.5
  const progress = phase === 'done'
    ? 100
    : controlled
      ? Math.min(97, ((currentStep + inStep) / steps.length) * 100)
      : Math.min(95, (elapsed / totalDuration) * 100)

  const patience = phase === 'running'
    ? [...PATIENCE_AT].reverse().find((p) => elapsed >= p.afterMs)?.key
    : undefined

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.3 }}
        className="relative rounded-2xl border border-brand-violet/20 bg-brand-violet/5 overflow-hidden"
      >
        {/* Aurora de fondo: dos manchas de color que se mueven lento mientras Claude
            trabaja. Es lo que quita la sensación de pantalla congelada. */}
        {phase === 'running' && (
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 opacity-60">
            <motion.span
              className="absolute -top-16 -left-10 h-40 w-40 rounded-full bg-brand-violet/20 blur-3xl"
              animate={{ x: [0, 60, 0], y: [0, 20, 0] }}
              transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.span
              className="absolute -bottom-20 right-0 h-40 w-40 rounded-full bg-neon-green/15 blur-3xl"
              animate={{ x: [0, -50, 0], y: [0, -18, 0] }}
              transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            />
          </motion.div>
        )}

        {/* Encabezado */}
        <div className="relative flex items-center gap-2.5 px-5 py-3.5 border-b border-brand-violet/10">
          <motion.div
            animate={{ rotate: phase === 'running' ? 360 : 0 }}
            transition={{ duration: 3, repeat: phase === 'running' ? Infinity : 0, ease: 'linear' }}
          >
            <Sparkles className={cn(
              'h-4 w-4 shrink-0',
              phase === 'done' ? 'text-brand-green' : 'text-brand-violet',
            )} />
          </motion.div>
          <span className={cn(
            'text-[13px] font-medium transition-colors',
            phase === 'done' ? 'text-brand-green' : 'text-text',
          )}>
            {phase === 'done' ? i18n.t('admin.gen.done') : title}
          </span>
          {phase === 'running' && (
            <span className="ml-auto flex items-center gap-2 shrink-0">
              {/* Contador real de momentos: lo más tranquilizador que puede haber. */}
              {subProgress && subProgress.total > 0 && (
                <span className="rounded-md bg-brand-violet/12 px-1.5 py-0.5 text-[10px] font-medium text-brand-violet tabular-nums">
                  {subProgress.done}/{subProgress.total}
                </span>
              )}
              <span className="text-[11px] text-text-subtle tabular-nums">{formatElapsed(elapsed)}</span>
            </span>
          )}
        </div>

        {/* Pasos */}
        <div className="relative px-5 py-4 space-y-2.5">
          {steps.map((step, i) => {
            const isDone = phase === 'done' || i < currentStep
            const isActive = phase === 'running' && i === currentStep
            const isPending = !isDone && !isActive

            return (
              <motion.div
                key={i}
                initial={false}
                animate={{ opacity: isPending ? 0.35 : 1 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-2.5"
              >
                {/* Ícono */}
                <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                  {isDone ? (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      <CheckCircle2 className="h-4 w-4 text-brand-green" />
                    </motion.div>
                  ) : isActive ? (
                    // Punto que late CON un aro que se expande: el paso en curso se
                    // distingue de lejos, incluso sin leer la etiqueta.
                    <span className="relative flex items-center justify-center">
                      <motion.span
                        className="absolute h-2.5 w-2.5 rounded-full bg-brand-violet/50"
                        animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                      />
                      <motion.span
                        className="relative h-2.5 w-2.5 rounded-full bg-brand-violet"
                        animate={{ scale: [1, 1.25, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    </span>
                  ) : (
                    <div className="h-2.5 w-2.5 rounded-full border border-glass-border/30" />
                  )}
                </div>

                {/* Etiqueta */}
                <span className={cn(
                  'text-[12px] transition-colors',
                  isDone && 'text-brand-green',
                  isActive && 'text-text font-medium',
                  isPending && 'text-text-subtle',
                )}>
                  {i18n.t(step.label)}
                  {isActive && <PulsingDots />}
                </span>
              </motion.div>
            )
          })}

          {/* Por qué se está demorando: detalle real del paso en curso. */}
          <AnimatePresence mode="wait">
            {note && phase === 'running' && (
              <motion.p
                key={note}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="pl-[26px] text-[11px] leading-relaxed text-text-subtle"
              >
                {note}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Expectativa de tiempo: se dice desde el arranque, no como excusa tardía. */}
          {hint && phase === 'running' && (
            <p className="pl-[26px] text-[11px] leading-relaxed text-text-subtle/80">{hint}</p>
          )}

          {/* Y si de verdad se está tomando su tiempo, se lo decimos con calma. */}
          <AnimatePresence mode="wait">
            {patience && (
              <motion.p
                key={patience}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.35 }}
                className="pl-[26px] text-[11px] leading-relaxed text-brand-violet/90"
              >
                {i18n.t(patience)}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Barra de progreso */}
        <div className="relative px-5 pb-4">
          <div className="relative h-1.5 rounded-full bg-glass-border/10 overflow-hidden">
            <motion.div
              className={cn(
                'relative h-full rounded-full overflow-hidden',
                phase === 'done'
                  ? 'bg-brand-green'
                  : 'bg-gradient-to-r from-brand-violet via-brand-violet to-neon-green',
              )}
              initial={{ width: '0%' }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            >
              {/* Brillo que recorre lo ya avanzado: la barra se siente viva incluso
                  cuando el porcentaje no cambia durante un rato. */}
              {phase === 'running' && (
                <motion.span
                  className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                  animate={{ x: ['-100%', '600%'] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </motion.div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Configuraciones predefinidas de pasos ────────────────────

export const MODULE_GENERATION_STEPS: GenerationStep[] = [
  { label: 'admin.gen.analyzing_desc',      durationMs: 2500  },
  { label: 'admin.gen.building_prompt',     durationMs: 3000  },
  { label: 'admin.gen.sending_claude',      durationMs: 2000  },
  { label: 'admin.gen.structuring',         durationMs: 12000 },
  { label: 'admin.gen.generating_3langs',   durationMs: 15000 },
  { label: 'admin.gen.reviewing_pedagogy',  durationMs: 8000  },
  { label: 'admin.gen.finalizing',          durationMs: 99999 },
]

export const ASSIST_STEPS: GenerationStep[] = [
  { label: 'admin.gen.analyzing_content',   durationMs: 1500  },
  { label: 'admin.gen.processing_claude',   durationMs: 5000  },
  { label: 'admin.gen.finalizing',          durationMs: 99999 },
]

// Pasos REALES de una simulación: el panel arma la lista según lo que va a pasar
// (¿hay módulo base?, ¿se traduce ahora?) y va marcando el avance de verdad.
export const SIM_STEP_READ_MODULE: GenerationStep = { label: 'admin.gen.reading_module', durationMs: 1 }
/** Solo aparece con documentos largos: Haiku los condensa antes de escribir. */
export const SIM_STEP_CONDENSE_DOC: GenerationStep = { label: 'admin.gen.condensing_doc', durationMs: 1 }
/** Etapa 1: la IA dibuja el mapa de la conversación antes de escribir un solo diálogo. */
export const SIM_STEP_OUTLINE: GenerationStep = { label: 'admin.gen.outlining_scenario', durationMs: 1 }
export const SIM_STEP_WRITE: GenerationStep = { label: 'admin.gen.writing_scenario', durationMs: 1 }
export const SIM_STEP_IMPROVE: GenerationStep = { label: 'admin.gen.improving_scenario', durationMs: 1 }
export const SIM_STEP_TRANSLATE: GenerationStep = { label: 'admin.gen.translating_langs', durationMs: 1 }
export const SIM_STEP_FINALIZE: GenerationStep = { label: 'admin.gen.finalizing_scenario', durationMs: 1 }

// (Los pasos por temporizador de simulación se retiraron: el panel usa los reales de arriba.)
