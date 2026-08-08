import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Save, Undo2 } from 'lucide-react'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

/**
 * Barra única de guardado de los editores.
 *
 * El problema que resuelve: el editor de curso tenía CINCO botones "Guardar"
 * repartidos por la página (ficha, asignaciones, condiciones, mundo, simulador)
 * y el de módulo otros tres más un autoguardado invisible. Nadie sabía cuál
 * guardaba qué, ni si al cambiar de pestaña se perdía lo escrito: la respuesta
 * honesta era "depende del botón", y eso es exactamente lo que no se puede
 * pedirle a quien está armando un curso.
 *
 * Aquí hay UN solo lugar donde guardar, siempre en el mismo sitio de la
 * pantalla, que además dice QUÉ está pendiente (y lleva ahí de un clic). La
 * barra solo existe cuando hay algo que guardar: en reposo la pantalla queda
 * limpia.
 *
 * Es OPACA (no de vidrio): se lee sin pelear con lo que hay detrás. Y como es
 * opaca, reserva su propio hueco al final de la página (`spacer`), para no
 * dejar nada tapado ni sin poder pulsarse.
 *
 * Va por portal a `document.body` a propósito: dentro del panel admin cualquier
 * ancestro con `transform` (las animaciones de entrada) se vuelve el bloque
 * contenedor de lo `fixed` y la barra aparecería flotando en mitad del
 * contenido. Ver [[reveal_transform_fixed_trap]].
 */

/** Una parte del editor con cambios sin guardar. */
export interface SaveDockItem {
  id: string
  /** Nombre visible ("Información", "Asignación"…). */
  label: string
  /** Lleva a esa parte del editor (cambiar de pestaña, hacer scroll…). */
  onFocus?: () => void
}

export interface SaveDockProps {
  /** Qué hay sin guardar ahora mismo. Vacío = la barra no se pinta. */
  pending: SaveDockItem[]
  /** Guarda TODO lo pendiente. Si devuelve una promesa, la barra la espera. */
  onSave: () => unknown
  /** Guardado en curso (lo controla la página; también se detecta solo). */
  saving?: boolean
  /**
   * El editor guarda solo pasados unos segundos. Cambia el texto de apoyo: la
   * barra deja de ser una orden ("guarda o lo pierdes") y pasa a ser un estado.
   */
  autoSave?: boolean
  /** Bloquea el guardado (falta algo obligatorio) y explica por qué. */
  blockedReason?: string
  /** Desplaza la barra para no chocar con otra cosa fija (px). */
  bottomOffset?: number
  /** Deshacer (Ctrl+Z). Sin esto el botón no aparece. */
  onUndo?: () => void
  canUndo?: boolean
  /**
   * Reserva el hueco de la barra al final de la página. Se apaga en editores
   * cuyo contenedor es flex: ahí el hueco va como padding del panel que
   * scrollea, no como un hermano (sería una columna más del flex).
   */
  spacer?: boolean
}

/** Cuánto se queda el "Todo guardado" antes de irse. */
const SAVED_MS = 1800
/** Alto que ocupa la barra + su margen, para el hueco reservado. */
const DOCK_HEIGHT = 84

export function SaveDock({
  pending,
  onSave,
  saving: savingProp,
  autoSave = false,
  blockedReason,
  bottomOffset = 0,
  onUndo,
  canUndo = false,
  spacer = true,
}: SaveDockProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()

  const [savingSelf, setSavingSelf] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saving = savingProp || savingSelf
  const count = pending.length
  const blocked = !!blockedReason

  /** Hubo un intento de guardar cuyo desenlace todavía no se ha acusado. */
  const attemptedRef = useRef(false)

  const save = useCallback(async () => {
    if (saving || blocked || count === 0) return
    setSavingSelf(true)
    attemptedRef.current = true
    try {
      await onSave()
    } catch {
      // El editor ya avisa del error a su manera (toast). Aquí solo hay que no
      // dejar caer una promesa rechazada y no cantar victoria.
    } finally {
      setSavingSelf(false)
    }
  }, [saving, blocked, count, onSave])

  // El acuse ("Todo guardado") se da cuando de verdad no queda nada pendiente,
  // no cuando la promesa termina: si el guardado falló, la lista sigue llena y
  // la barra se queda ahí con lo que falta. Sin acuse la gente vuelve a pulsar
  // por las dudas, y en editores lentos eso son dos guardados seguidos.
  useEffect(() => {
    if (!attemptedRef.current || saving || count > 0) return
    attemptedRef.current = false
    setJustSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_MS)
  }, [saving, count])

  // Con autoguardado nadie pulsa nada, pero el acuse sigue haciendo falta: la
  // barra se iría en silencio y no habría forma de saber si guardó.
  useEffect(() => {
    if (autoSave && count > 0) attemptedRef.current = true
  }, [autoSave, count])

  // Ctrl/Cmd+S guarda todo. Antes cada panel se registraba su propio atajo y
  // guardaba solo lo suyo: la misma tecla hacía cosas distintas según dónde
  // estuviera el foco.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        void saveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  // Si todo queda limpio sin pasar por el botón (autoguardado, guardado desde
  // otro sitio), `pending` se vacía y la barra se va sola.
  const visible = count > 0 || saving || justSaved
  const state: 'saved' | 'saving' | 'dirty' =
    justSaved && count === 0 ? 'saved' : saving ? 'saving' : 'dirty'

  const dock = typeof document === 'undefined' ? null : createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          key="save-dock"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.96, filter: 'blur(6px)' }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97, filter: 'blur(4px)' }}
          transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
          style={{ bottom: 20 + bottomOffset }}
          className="fixed inset-x-0 z-[9985] flex justify-center px-3 pointer-events-none print:hidden"
        >
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'pointer-events-auto flex w-full max-w-[min(46rem,100%)] items-center gap-3 rounded-2xl',
              // Opaca de verdad: `bg-surface` es el color de tarjeta, sin alfa.
              'bg-surface border px-3 py-2.5 shadow-[0_18px_50px_-12px_rgb(0_0_0/0.5)]',
              'transition-colors duration-300 ease-apple',
              state === 'saved' ? 'border-neon-green/45' : 'border-amber-400/45',
            )}
          >
            {/* Estado */}
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={state}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -25 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 20 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-xl',
                    state === 'saved'
                      ? 'bg-neon-green/15 text-neon-green'
                      : 'bg-amber-400/15 text-amber-500',
                  )}
                >
                  {state === 'saved' ? (
                    <Check className="h-4 w-4" />
                  ) : state === 'saving' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </motion.span>
              </AnimatePresence>
              {/* Latido solo mientras hay trabajo encima: llama la atención sin
                  gritar, y desaparece en cuanto está guardado. */}
              {state === 'dirty' && !reduce && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-xl border border-amber-400/40"
                  animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.35, 1] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </span>

            {/* Qué está pendiente */}
            <div className="min-w-0 flex-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={state === 'saved' ? 'saved' : `n${count}`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    'truncate text-[13px] font-semibold leading-tight',
                    state === 'saved' ? 'text-neon-green' : 'text-text',
                  )}
                >
                  {state === 'saved'
                    ? t('admin.savedock.saved')
                    : state === 'saving'
                      ? t('admin.savedock.saving')
                      : count === 1
                        ? t('admin.savedock.pending_one')
                        : t('admin.savedock.pending_other', { n: count })}
                </motion.p>
              </AnimatePresence>

              {state !== 'saved' && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {pending.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.onFocus}
                      disabled={!item.onFocus}
                      className={cn(
                        'rounded-full border border-line px-2 py-0.5 text-[11px] text-text-muted transition-colors',
                        item.onFocus && 'hover:border-amber-400/40 hover:text-text',
                        !item.onFocus && 'cursor-default',
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                  {autoSave && (
                    <span className="px-1 text-[11px] text-text-subtle">
                      {t('admin.savedock.autosave')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Acciones */}
            {state !== 'saved' && (
              <div className="flex shrink-0 items-center gap-2">
                {/* Deshacer: el mismo Ctrl+Z, pero visible. Sin botón, nadie
                    descubre que el editor tiene historial. */}
                {onUndo && (
                  <motion.button
                    type="button"
                    onClick={onUndo}
                    disabled={!canUndo}
                    title={`${t('admin.savedock.undo')} (${t('admin.savedock.shortcut_undo')})`}
                    aria-label={t('admin.savedock.undo')}
                    whileTap={reduce || !canUndo ? undefined : { scale: 0.94 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3',
                      'text-[12px] font-medium text-text-muted transition-colors',
                      'hover:text-text hover:border-glass-border/30',
                      'disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-text-muted',
                    )}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('admin.savedock.undo')}</span>
                  </motion.button>
                )}
                <span className="hidden md:inline text-[11px] text-text-subtle tabular-nums">
                  {t('admin.savedock.shortcut')}
                </span>
                <motion.button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || blocked}
                  title={blockedReason}
                  whileTap={reduce || saving || blocked ? undefined : { scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold',
                    'bg-neon-green text-black transition-[filter,opacity] duration-200 ease-apple',
                    'hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saving ? t('admin.savedock.saving') : t('admin.savedock.save')}
                </motion.button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )

  return (
    <>
      {/* Hueco al final de la página. La barra es opaca: sin esto, lo último
          del formulario quedaría debajo y sin poder pulsarse. */}
      {spacer && (
        <div
          aria-hidden
          className="shrink-0 transition-[height] duration-300 ease-apple"
          style={{ height: visible ? DOCK_HEIGHT + bottomOffset : 0 }}
        />
      )}
      {dock}
    </>
  )
}

/**
 * Punto de "hay cambios aquí" para las pestañas del editor. Sin él, la barra
 * dice "2 cambios sin guardar" pero la pestaña donde están no se distingue.
 */
export function DirtyDot({ className }: { className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      aria-hidden
      initial={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
      animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400', className)}
    />
  )
}
