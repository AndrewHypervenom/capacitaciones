import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useMotionValue, animate } from 'framer-motion'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { EASE, SPRING } from './ModuleSurgeryBits'

interface SurgeryUndoBarProps {
  /** Qué acaba de pasar, en una frase. */
  label: string
  /** Segundos de gracia antes de confirmar. */
  seconds?: number
  /** Revierte la operación. */
  onUndo: () => Promise<void>
  /** Confirma: migra el progreso y consuma los borrados. */
  onFinalize: () => Promise<void>
  /** Se llama cuando la franja termina su trabajo (deshecha o confirmada). */
  onDone: () => void
}

/**
 * Franja de "Deshacer" que aparece tras separar o unir módulos.
 *
 * Es la pieza que hace segura toda la operación: durante estos segundos NADA
 * irreversible ha ocurrido todavía — el progreso de los aprendices no se ha
 * tocado y el módulo absorbido sigue existiendo. Al agotarse el tiempo (o al
 * salir de la pantalla) se confirma; si se pulsa Deshacer, se revierte entero.
 *
 * El anillo que se vacía no es decoración: es el único aviso de cuánto queda.
 */
export function SurgeryUndoBar({
  label,
  seconds = 10,
  onUndo,
  onFinalize,
  onDone,
}: SurgeryUndoBarProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [state, setState] = useState<'waiting' | 'undoing' | 'finalizing' | 'closed'>('waiting')
  const progress = useMotionValue(1)
  const [dash, setDash] = useState(0)

  // Refs para que el temporizador no se reinicie en cada render y para poder
  // confirmar desde la limpieza del efecto sin capturar callbacks viejos.
  const settled = useRef(false)
  const onFinalizeRef = useRef(onFinalize)
  const onDoneRef = useRef(onDone)
  onFinalizeRef.current = onFinalize
  onDoneRef.current = onDone

  const CIRC = 2 * Math.PI * 9

  useEffect(() => {
    const controls = animate(progress, 0, {
      duration: seconds,
      ease: 'linear',
      onUpdate: (v) => setDash(CIRC * (1 - v)),
    })

    const timer = window.setTimeout(() => {
      if (settled.current) return
      settled.current = true
      setState('finalizing')
      void onFinalizeRef.current()
        .catch(() => {})
        .finally(() => {
          setState('closed')
          onDoneRef.current()
        })
    }, seconds * 1000)

    return () => {
      controls.stop()
      window.clearTimeout(timer)
      // Salir de la pantalla cuenta como aceptar: si no se confirmara aquí, el
      // módulo absorbido quedaría vacío y suelto para siempre.
      if (!settled.current) {
        settled.current = true
        void onFinalizeRef.current().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds])

  const undo = async () => {
    if (settled.current) return
    settled.current = true
    setState('undoing')
    try {
      await onUndo()
    } finally {
      setState('closed')
      onDone()
    }
  }

  return createPortal(
    <AnimatePresence>
      {state !== 'closed' && (
        <motion.div
          initial={{ opacity: 0, y: 24, filter: reduce ? 'none' : 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="fixed bottom-5 left-1/2 z-[140] -translate-x-1/2 px-4"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-glass-lg backdrop-blur-xl">
            <motion.span
              layout
              transition={SPRING}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-brand-green/30 bg-brand-green/10 text-brand-green"
            >
              {state === 'waiting' ? (
                <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
                  <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
                  <circle
                    cx="11"
                    cy="11"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={CIRC}
                    strokeDashoffset={dash}
                    transform="rotate(-90 11 11)"
                  />
                </svg>
              ) : state === 'undoing' || state === 'finalizing' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </motion.span>

            <p className="max-w-[46ch] text-[12.5px] text-text">
              {state === 'undoing'
                ? t('admin.surgery.undoing')
                : state === 'finalizing'
                  ? t('admin.surgery.finalizing')
                  : label}
            </p>

            {state === 'waiting' && (
              <button
                onClick={undo}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-[12px] font-semibold text-text transition-colors hover:bg-glass/8"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('admin.surgery.undo')}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
