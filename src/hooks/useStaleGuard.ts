import { useCallback, useEffect, useRef, useState } from 'react'
import { fingerprint } from '@/lib/fingerprint'
import { onTabMessage } from '@/lib/crossTab'

/**
 * Protege un editor de escribir encima de una versión más nueva.
 *
 * El caso real: el mismo simulador abierto en dos pestañas. Se edita en la A y
 * se guarda; la B sigue con lo de hace media hora y, al guardar, deshace todo lo
 * de A sin decir nada. Igual pasa entre dos personas del equipo.
 *
 * Aquí no se recarga por las bravas —eso borraría lo que se está escribiendo—:
 * se compara la huella de la fila guardada contra la que se cargó y se AVISA.
 * Decidir si recargar o sobrescribir es del que está editando.
 *
 * Uso:
 * ```ts
 * const guard = useStaleGuard({ fetch: () => getScenarioAdmin(id), topic: 'simulations', id })
 * // tras cargar:            guard.mark(row)
 * // antes de guardar:       if (!(await guard.isSafeToSave())) { ...preguntar... }
 * // tras guardar con éxito: guard.mark(savedRow)
 * ```
 */
export interface StaleGuard<T> {
  /** Otra pestaña o persona guardó después de que se cargó esto. */
  stale: boolean
  /** Fija la versión de referencia (al cargar y después de cada guardado propio). */
  mark: (row: T | null) => void
  /** Relee la fila y dice si sigue siendo la que se cargó. */
  isSafeToSave: () => Promise<boolean>
  /** Última fila leída del servidor (para ofrecer "recargar" con datos frescos). */
  latest: () => T | null
  /** Olvida el aviso sin recargar (el que edita eligió sobrescribir). */
  dismiss: () => void
}

export function useStaleGuard<T>(opts: {
  /** Relee la fila del servidor. */
  fetch: () => Promise<T | null>
  /** Tema del bus entre pestañas que dispara la comprobación. */
  topic?: string
  /** Id de la fila; si no hay (registro nuevo), el guardia queda inactivo. */
  id?: string | null
  /** Campos a ignorar al comparar (los que cambian solos). */
  ignoreKeys?: string[]
}): StaleGuard<T> {
  const { topic, id, ignoreKeys } = opts

  // `fetch` e `ignoreKeys` suelen ser literales nuevos en cada render; por el
  // ref no reconstruyen los callbacks (y con ellos, los listeners) cada vez.
  // Se actualizan en un efecto, no durante el render: nadie los lee antes.
  const fetchRef = useRef(opts.fetch)
  const ignoreRef = useRef(ignoreKeys)
  useEffect(() => {
    fetchRef.current = opts.fetch
    ignoreRef.current = ignoreKeys
  })

  const baselineRef = useRef<string | null>(null)
  const latestRef = useRef<T | null>(null)
  const [stale, setStale] = useState(false)

  const mark = useCallback((row: T | null) => {
    baselineRef.current = row ? fingerprint(row, ignoreRef.current) : null
    latestRef.current = row
    setStale(false)
  }, [])

  const compare = useCallback(async (): Promise<boolean> => {
    if (!id || baselineRef.current === null) return true
    try {
      const row = await fetchRef.current()
      if (!row) return true
      latestRef.current = row
      return fingerprint(row, ignoreRef.current) === baselineRef.current
    } catch {
      // Sin red no se puede saber: no bloquear el guardado por eso.
      return true
    }
  }, [id])

  const isSafeToSave = useCallback(async () => {
    const same = await compare()
    if (!same) setStale(true)
    return same
  }, [compare])

  // Comprobación pasiva: cuando otra pestaña avisa que tocó este tema, o al
  // volver a esta pestaña. Solo pinta el aviso; no toca lo que se está editando.
  useEffect(() => {
    if (!id) return
    let alive = true
    const check = () => {
      void compare().then((same) => {
        if (alive && !same) setStale(true)
      })
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)

    const off = topic
      ? onTabMessage('data:changed', (msg) => {
          if (msg.topic === topic && (!msg.id || msg.id === id)) check()
        })
      : null

    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      off?.()
    }
  }, [id, topic, compare])

  return {
    stale,
    mark,
    isSafeToSave,
    latest: () => latestRef.current,
    dismiss: () => setStale(false),
  }
}
