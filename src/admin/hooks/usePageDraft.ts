import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUndoHistory } from '@/hooks/useUndoHistory'

/**
 * Editar como borrador en cualquier pantalla del panel.
 *
 * El editor de curso y el de módulo ya funcionaban así: se toca lo que sea, la
 * barra del pie dice "N cambios sin guardar", y hasta que no se guarda no se
 * escribe nada. El resto del panel no: cada control disparaba su propia
 * escritura al instante, así que no había forma de saber si algo estaba
 * pendiente, ni de arrepentirse, ni de deshacer. Dos comportamientos distintos
 * en el mismo sitio es peor que cualquiera de los dos.
 *
 * Esto es lo mínimo para que una pantalla se comporte como los editores:
 * borrador, saber si hay cambios, deshacer (Ctrl+Z) y un guardado único que la
 * barra dispara con Ctrl+S.
 *
 * ```tsx
 * const draft = usePageDraft({ saved: settings, onSave: (d) => saveSettings(d) })
 * // …editar con draft.set(...)
 * <SaveDock pending={draft.pending(t('Ajustes'))} onSave={draft.save}
 *           saving={draft.saving} onUndo={draft.undo} canUndo={draft.canUndo} />
 * ```
 */
export interface PageDraft<T> {
  /** Lo que se está editando. `null` mientras carga. */
  value: T | null
  /** Cambia el borrador (acepta valor o función, como `setState`). */
  set: (next: T | ((prev: T) => T)) => void
  dirty: boolean
  saving: boolean
  /** Guarda. Devuelve `false` si falló (la barra se queda como está). */
  save: () => Promise<boolean>
  /** Vuelve a lo guardado, sin tocar la base. */
  discard: () => void
  undo: () => void
  canUndo: boolean
  /** Lo que espera `SaveDock.pending`: vacío si no hay nada sin guardar. */
  pending: (label: string, onFocus?: () => void) => { id: string; label: string; onFocus?: () => void }[]
}

export function usePageDraft<T>({
  saved,
  onSave,
  id = 'page',
  enabled = true,
  fingerprint,
}: {
  /** Lo que hay en la base. Al cambiar (una recarga), redefine la línea base. */
  saved: T | null
  /**
   * Escribe el borrador. Si devuelve `false` se considera fallido y el borrador
   * se queda intacto para reintentar; cualquier otra cosa es éxito.
   */
  onSave: (draft: T) => Promise<boolean | void>
  id?: string
  /** Apaga el historial mientras carga (ver [[undo_phantom_steps]]). */
  enabled?: boolean
  /**
   * Cómo se compara "igual". Por defecto el JSON entero, pero hay pantallas con
   * ruido cosmético que NO es un cambio (un `#888` que el selector de color
   * expande solo a `#888888`, un espacio al final de un nombre): sin esto la
   * barra diría "1 cambio sin guardar" nada más abrir la página.
   */
  fingerprint?: (value: T) => string
}): PageDraft<T> {
  const [value, setValue] = useState<T | null>(saved)
  const [saving, setSaving] = useState(false)
  /**
   * La foto de lo guardado. No se usa `saved` directamente porque la página lo
   * puede recargar por su cuenta y entonces el borrador en curso se compararía
   * contra algo que ya cambió.
   */
  const [baseline, setBaseline] = useState<T | null>(saved)

  // Llega (o vuelve a llegar) del servidor: es punto de partida, no una edición.
  const print = useCallback(
    (v: T | null) => (v === null ? 'null' : fingerprint ? fingerprint(v) : JSON.stringify(v)),
    [fingerprint],
  )
  const savedKey = useMemo(() => print(saved), [print, saved])
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastKey.current === savedKey) return
    lastKey.current = savedKey
    setValue(saved)
    setBaseline(saved)
  }, [savedKey, saved])

  const dirty = useMemo(
    () => value !== null && print(value) !== print(baseline),
    [print, value, baseline],
  )

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      if (prev === null) return prev
      return typeof next === 'function' ? (next as (p: T) => T)(prev) : next
    })
  }, [])

  const { undo, canUndo, adopt } = useUndoHistory({
    state: value,
    apply: setValue,
    enabled: enabled && value !== null,
  })

  const save = useCallback(async (): Promise<boolean> => {
    if (value === null || !dirty) return true
    setSaving(true)
    try {
      const ok = await onSave(value)
      if (ok === false) return false
      // Guardado: lo que acaba de entrar es la nueva línea base, y para el
      // historial no es un paso (nadie "editó" nada al guardar).
      setBaseline(value)
      lastKey.current = print(value)
      adopt()
      return true
    } finally {
      setSaving(false)
    }
  }, [value, dirty, onSave, adopt, print])

  const discard = useCallback(() => setValue(baseline), [baseline])

  const pending = useCallback(
    (label: string, onFocus?: () => void) => (dirty ? [{ id, label, onFocus }] : []),
    [dirty, id],
  )

  return { value, set, dirty, saving, save, discard, undo, canUndo, pending }
}
