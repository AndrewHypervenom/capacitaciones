import { useCallback, useEffect, useRef, useState } from 'react'
import { fingerprint } from '@/lib/fingerprint'

/**
 * Deshacer y rehacer (Ctrl+Z / Ctrl+Shift+Z) para un editor entero.
 *
 * Hasta ahora la única forma de volver atrás era acordarse de lo que había
 * antes y volver a escribirlo. Borrar un bloque, reordenar secciones o mover un
 * interruptor no tenía vuelta: si te equivocabas, lo rehacías a mano.
 *
 * En vez de que cada control lleve su propio historial, se guardan fotos del
 * estado editable completo (el mismo objeto que ya se usa para saber si hay
 * cambios sin guardar) y se vuelve a la anterior. Es tosco a propósito: no
 * distingue "qué" cambió, pero nunca se queda a medias ni deja el editor en un
 * estado que no existió.
 *
 * Dentro de un campo de texto NO se intercepta el atajo: ahí el Ctrl+Z del
 * navegador deshace letra por letra, que es lo que se espera al escribir.
 *
 * ```ts
 * const undo = useUndoHistory({
 *   state: { form, cond },
 *   apply: (s) => { setForm(s.form); setCond(s.cond) },
 *   enabled: !loading,
 * })
 * ```
 */
export interface UndoHistory {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  /** Olvida el historial (al cargar otro registro). */
  reset: () => void
}

/** Cuánto se espera a que la edición "se asiente" antes de tomar la foto. */
const SETTLE_MS = 450
/** Fotos guardadas como máximo (el contenido de un módulo pesa). */
const DEFAULT_LIMIT = 40

export function useUndoHistory<T>(opts: {
  /** Estado editable completo. Puede ser un literal nuevo en cada render. */
  state: T
  /** Devuelve el editor a una foto anterior. */
  apply: (state: T) => void
  /** Mientras sea false no se graba nada (p. ej. mientras carga). */
  enabled?: boolean
  limit?: number
}): UndoHistory {
  const { state, enabled = true, limit = DEFAULT_LIMIT } = opts

  const applyRef = useRef(opts.apply)
  const stateRef = useRef(state)
  useEffect(() => {
    applyRef.current = opts.apply
    stateRef.current = state
  })

  const pastRef = useRef<T[]>([])
  const futureRef = useRef<T[]>([])
  /** Última foto confirmada, con su huella para no recalcularla. */
  const currentRef = useRef<{ value: T; fp: string } | null>(null)
  // El tamaño de las pilas vive en estado (las pilas, en refs): leer un ref
  // durante el render no vuelve a pintar el botón cuando cambia.
  const [counts, setCounts] = useState({ past: 0, future: 0 })
  const syncCounts = useCallback(() => {
    setCounts({ past: pastRef.current.length, future: futureRef.current.length })
  }, [])

  useEffect(() => {
    if (!enabled) return
    const fp = fingerprint(state)

    // Primera foto: el punto de partida. No es "un cambio".
    if (currentRef.current === null) {
      currentRef.current = { value: state, fp }
      return
    }
    if (fp === currentRef.current.fp) return

    // Con retardo: escribir un título son veinte cambios y veinte fotos harían
    // del Ctrl+Z un borrador de letras. Se guarda cuando la edición se detiene.
    const timer = setTimeout(() => {
      const settled = stateRef.current
      pastRef.current = [...pastRef.current, currentRef.current!.value].slice(-limit)
      currentRef.current = { value: settled, fp: fingerprint(settled) }
      // Editar después de deshacer corta la rama: lo rehecho ya no aplica.
      futureRef.current = []
      syncCounts()
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [state, enabled, limit, syncCounts])

  /**
   * Salta a una foto. `currentRef` se fija en el acto (no en el efecto): así
   * el efecto que corre tras el re-render ve la huella igual y no confunde el
   * salto con una edición nueva.
   */
  const jump = useCallback((target: T, from: 'past' | 'future') => {
    const previous = currentRef.current
    if (!previous) return
    if (from === 'past') futureRef.current = [previous.value, ...futureRef.current]
    else pastRef.current = [...pastRef.current, previous.value]
    currentRef.current = { value: target, fp: fingerprint(target) }
    applyRef.current(target)
    syncCounts()
  }, [syncCounts])

  const undo = useCallback(() => {
    const previous = pastRef.current[pastRef.current.length - 1]
    if (previous === undefined) return
    pastRef.current = pastRef.current.slice(0, -1)
    jump(previous, 'past')
  }, [jump])

  const redo = useCallback(() => {
    const next = futureRef.current[0]
    if (next === undefined) return
    futureRef.current = futureRef.current.slice(1)
    jump(next, 'future')
  }, [jump])

  const reset = useCallback(() => {
    pastRef.current = []
    futureRef.current = []
    currentRef.current = null
    syncCounts()
  }, [syncCounts])

  // Atajos. El oyente se instala una sola vez y lee por ref: reinstalarlo en
  // cada cambio de estado haría perder pulsaciones a mitad de render.
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  useEffect(() => {
    undoRef.current = undo
    redoRef.current = redo
  }, [undo, redo])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      // En un campo de texto manda el deshacer del navegador.
      if (isTextEntry(e.target)) return
      e.preventDefault()
      if (key === 'y' || e.shiftKey) redoRef.current()
      else undoRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])

  return {
    canUndo: counts.past > 0,
    canRedo: counts.future > 0,
    undo,
    redo,
    reset,
  }
}

/** ¿El foco está donde el navegador ya sabe deshacer? */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  // Los de valor discreto (casillas, color, rango) no tienen deshacer propio:
  // ahí el atajo sí es nuestro.
  return !['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit'].includes(type)
}
