/**
 * Registro de lo que hay sin guardar en esta pestaña, ahora mismo.
 *
 * Nace de dos avisos que hasta ahora disparaban a ciegas:
 *
 * - **"Nueva versión disponible"**: al subir cambios al repositorio, el sitio
 *   invita a recargar. Recargar en medio de un módulo a medio escribir se lo
 *   lleva todo. Antes se preguntaba SIEMPRE ("podrías perder progreso"), incluso
 *   mirando una lista donde no hay nada que perder — y un aviso que sale siempre
 *   se acepta sin leer, justo el día que sí había trabajo encima.
 * - **Cerrar la pestaña**: no avisaba nada.
 *
 * Con este registro los dos avisos pasan a decir la verdad: salen solo cuando
 * hay algo real que perder, y dicen QUÉ es.
 *
 * Es deliberadamente global y no un contexto de React: lo consultan el aviso de
 * versión, el `beforeunload` y cualquier cosa que quiera recargar la página.
 */

/** id del editor → nombre legible de lo que tiene sin guardar. */
const entries = new Map<string, string>()
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

/** Registra (o quita, con `label` nulo) trabajo sin guardar. */
export function setUnsavedWork(id: string, label: string | null): void {
  if (label) {
    if (entries.get(id) === label) return
    entries.set(id, label)
  } else {
    if (!entries.has(id)) return
    entries.delete(id)
  }
  emit()
}

export function hasUnsavedWork(): boolean {
  return entries.size > 0
}

/** Nombres de lo que está sin guardar, para poder decirlo en el aviso. */
export function unsavedWorkLabels(): string[] {
  return [...entries.values()]
}

export function subscribeUnsavedWork(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Aviso del navegador al cerrar la pestaña o navegar fuera. El texto lo decide
 * el navegador (no se puede personalizar desde hace años); lo que aportamos es
 * que solo aparezca cuando de verdad hay algo sin guardar.
 */
let beforeUnloadInstalled = false

export function installUnsavedWorkGuard(): void {
  if (beforeUnloadInstalled || typeof window === 'undefined') return
  beforeUnloadInstalled = true
  window.addEventListener('beforeunload', (e) => {
    if (!hasUnsavedWork()) return
    e.preventDefault()
    // Compatibilidad: navegadores viejos exigen asignar returnValue.
    e.returnValue = ''
  })
}
