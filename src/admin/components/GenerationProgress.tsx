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
}

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

export function GenerationProgress({ steps, active, title = 'Generando con Claude...', stepIndex, note }: Props) {
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
  const progress = phase === 'done'
    ? 100
    : controlled
      ? Math.min(95, ((currentStep + 0.5) / steps.length) * 100)
      : Math.min(95, (elapsed / totalDuration) * 100)
  const elapsedSec = Math.floor(elapsed / 1000)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.3 }}
        className="rounded-2xl border border-brand-violet/20 bg-brand-violet/5 overflow-hidden"
      >
        {/* Encabezado */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-brand-violet/10">
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
            <span className="ml-auto text-[11px] text-text-subtle tabular-nums">
              {elapsedSec}s
            </span>
          )}
        </div>

        {/* Pasos */}
        <div className="px-5 py-4 space-y-2.5">
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
                    <motion.div
                      className="h-2.5 w-2.5 rounded-full bg-brand-violet"
                      animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    />
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
          {note && phase === 'running' && (
            <motion.p
              key={note}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="pl-[26px] text-[11px] leading-relaxed text-text-subtle"
            >
              {note}
            </motion.p>
          )}
        </div>

        {/* Barra de progreso */}
        <div className="px-5 pb-4">
          <div className="h-1 rounded-full bg-glass-border/10 overflow-hidden">
            <motion.div
              className={cn(
                'h-full rounded-full',
                phase === 'done' ? 'bg-brand-green' : 'bg-brand-violet',
              )}
              initial={{ width: '0%' }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
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
export const SIM_STEP_WRITE: GenerationStep = { label: 'admin.gen.writing_scenario', durationMs: 1 }
export const SIM_STEP_IMPROVE: GenerationStep = { label: 'admin.gen.improving_scenario', durationMs: 1 }
export const SIM_STEP_TRANSLATE: GenerationStep = { label: 'admin.gen.translating_langs', durationMs: 1 }
export const SIM_STEP_FINALIZE: GenerationStep = { label: 'admin.gen.finalizing_scenario', durationMs: 1 }

// (Los pasos por temporizador de simulación se retiraron: el panel usa los reales de arriba.)
