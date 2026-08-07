/**
 * Registro de los reproductores de video que hay vivos en la página.
 *
 * Nació de un error concreto: cada reproductor escuchaba el teclado en
 * `document`, así que en un módulo con varios videos la barra espaciadora le
 * hablaba a TODOS a la vez — el que estaba sonando se pausaba y el de abajo
 * arrancaba solo. Aquí viven las dos preguntas que ningún reproductor puede
 * contestar por su cuenta:
 *
 *   1. ¿Con cuál está hablando el usuario? (para los atajos de teclado)
 *   2. ¿Cuál sigue? (para encadenar cuando el anterior TERMINA)
 *
 * Regla de oro: un video solo arranca solo si el anterior llegó al final. Una
 * pausa, un clic en otra parte o un salto en la barra nunca encadenan nada.
 */

export interface VideoBusEntry {
  /** Identidad estable del reproductor mientras esté montado. */
  id: string
  /** Título que se muestra en la tarjeta de "a continuación". */
  title: string
  /** Contenedor en el DOM: define el orden real de la lista (arriba → abajo). */
  getElement: () => HTMLElement | null
  play: () => void
  pause: () => void
}

const players = new Map<string, VideoBusEntry>()
let activeId: string | null = null

/** Reproductores en el orden en que aparecen en la página, no en el que se montaron. */
function inDocumentOrder(): VideoBusEntry[] {
  return [...players.values()].sort((a, b) => {
    const ea = a.getElement()
    const eb = b.getElement()
    if (!ea || !eb) return 0
    const rel = ea.compareDocumentPosition(eb)
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })
}

export function registerVideo(entry: VideoBusEntry): () => void {
  players.set(entry.id, entry)
  return () => {
    players.delete(entry.id)
    if (activeId === entry.id) activeId = null
  }
}

/** Marca con quién está interactuando el usuario (clic, play, capítulo…). */
export function focusVideo(id: string): void {
  activeId = id
}

/**
 * ¿Los atajos de teclado son para este reproductor?
 *
 * Si hay uno solo en la página se da por descontado que es él. Con varios, hace
 * falta que el usuario lo haya tocado: es preferible que la barra espaciadora no
 * haga nada a que mueva un video que no se está viendo.
 */
export function ownsKeyboard(id: string): boolean {
  if (players.size <= 1) return true
  return activeId === id
}

/**
 * Este reproductor empezó a sonar: los demás se callan. Dos audios encima nunca
 * son intencionales.
 */
export function announcePlaying(id: string): void {
  activeId = id
  for (const [otherId, entry] of players) {
    if (otherId !== id) entry.pause()
  }
}

/** El siguiente reproductor montado, en orden de página. `null` si es el último. */
export function nextVideoAfter(id: string): VideoBusEntry | null {
  const list = inDocumentOrder()
  const i = list.findIndex((p) => p.id === id)
  if (i === -1) return null
  return list[i + 1] ?? null
}

// ─── Preferencia: encadenar al terminar ──────────────────────────────────────
// Es del usuario y de su navegador, no del módulo: quien no quiere que le sigan
// los videos no lo quiere en ninguno.

const AUTOPLAY_KEY = 'video_autoplay_next'
const listeners = new Set<(on: boolean) => void>()

let autoplayNext: boolean = (() => {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== '0'
  } catch {
    return true
  }
})()

export function getAutoplayNext(): boolean {
  return autoplayNext
}

export function setAutoplayNext(on: boolean): void {
  autoplayNext = on
  try {
    localStorage.setItem(AUTOPLAY_KEY, on ? '1' : '0')
  } catch { /* modo incógnito: vale con la sesión */ }
  for (const fn of listeners) fn(on)
}

export function subscribeAutoplayNext(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
