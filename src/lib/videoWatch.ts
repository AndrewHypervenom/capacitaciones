/**
 * Marca de "hasta dónde vio de verdad" cada video.
 *
 * Sirve para una sola cosa: la primera vez que un aprendiz ve un video no puede
 * adelantarlo. Solo avanza el tope viendo, no arrastrando la barra. Cuando el
 * video llega al final una vez, queda liberado para siempre (repasar, buscar un
 * minuto concreto, saltar a un capítulo) — el candado es para la primera pasada,
 * no un castigo permanente.
 *
 * Vive en `localStorage` y por usuario: en un equipo compartido —lo normal en
 * los pisos de operación— la marca de uno no le sirve al siguiente.
 */

const PREFIX = 'video_watch_v1'

export interface WatchMark {
  /** Segundo más lejano alcanzado REPRODUCIENDO (nunca por un salto). */
  max: number
  /** El video ya se terminó al menos una vez: se acabó el candado. */
  done: boolean
}

export const EMPTY_MARK: WatchMark = { max: 0, done: false }

export function videoWatchKey(userId: string | null | undefined, videoId: string): string {
  return `${PREFIX}:${userId || 'anon'}:${videoId}`
}

/**
 * La identidad de un video para el candado.
 *
 * Lleva DÓNDE está (sección + encabezado) y QUÉ es (la fuente). Lo segundo es
 * lo que impide que reemplazar el archivo dentro del mismo bloque herede el
 * "ya lo vi" del video anterior: contenido nuevo, candado nuevo. Y lo primero
 * mantiene separados dos bloques que apuntan al mismo video en módulos
 * distintos, que son dos cosas que ver.
 *
 * De la URL se descarta lo que no identifica nada —parámetros y ancla—, para
 * que un cache-buster o un `?t=` no parezcan un video distinto. En YouTube y
 * Vimeo la fuente ya es el id pelado.
 */
export function buildVideoWatchId(
  sectionId: string | null | undefined,
  headingEs: string | null | undefined,
  source: string | null | undefined,
): string | null {
  if (!source) return null
  const clean = source.split('#')[0].split('?')[0]
  return `${sectionId ?? ''}|${headingEs ?? ''}|${clean}`
}

export function readWatchMark(key: string): WatchMark {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { ...EMPTY_MARK }
    const parsed = JSON.parse(raw) as Partial<WatchMark>
    const max = Number(parsed?.max)
    return { max: Number.isFinite(max) && max > 0 ? max : 0, done: parsed?.done === true }
  } catch {
    return { ...EMPTY_MARK }
  }
}

export function writeWatchMark(key: string, mark: WatchMark): void {
  try {
    localStorage.setItem(key, JSON.stringify(mark))
  } catch {
    /* modo incógnito o cuota llena: el candado degrada a "no hay marca" */
  }
}
