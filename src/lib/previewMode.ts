/**
 * Modo "vista previa del aprendiz".
 *
 * El panel abre la RUTA REAL del aprendiz (`/modules/:slug`, `/courses/:slug`)
 * dentro de un <iframe> en un modal. Ese iframe es otro contexto de navegación
 * con su propio JavaScript, así que esta bandera —que se calcula una sola vez al
 * arrancar— vale `true` SOLO dentro de la vista previa y `false` en la pestaña
 * del panel y en la sesión normal del aprendiz.
 *
 * Para qué sirve: dentro de la vista previa la app no debe ESCRIBIR nada. Sin
 * esto, el capacitador que revisa su curso quedaría con intentos, XP, tiempo de
 * módulo y racha propios (y con el progreso del aprendiz contaminado en el
 * espejo a BD). Ver los guardas en:
 *   · services/activity.service.ts   → intentos de quizzes y juegos
 *   · services/progress.service.ts   → espejo de progreso/XP
 *   · services/moduleTime.service.ts → cronómetro del módulo
 *   · hooks/useProgressSync.ts       → no hidrata ni espeja
 *   · stores/progressStore.ts        → progreso en memoria, no en localStorage
 *
 * `window.name` se marca al arrancar para que la bandera sobreviva a la
 * navegación interna (el aprendiz entra al curso, abre un módulo…) y a una
 * recarga completa dentro del iframe, aunque el `?preview=1` ya no esté.
 */

export const PREVIEW_PARAM = 'preview'
export const PREVIEW_WINDOW_NAME = 'positivos-learner-preview'

function detectPreview(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.name === PREVIEW_WINDOW_NAME) return true
    return new URLSearchParams(window.location.search).get(PREVIEW_PARAM) === '1'
  } catch {
    return false
  }
}

export const IS_LEARNER_PREVIEW = detectPreview()

if (IS_LEARNER_PREVIEW && typeof window !== 'undefined') {
  try {
    window.name = PREVIEW_WINDOW_NAME
  } catch {
    /* algunos navegadores en modo restringido no dejan escribirlo */
  }
}

/** URL de la ruta del aprendiz marcada como vista previa (conserva el #ancla). */
export function learnerPreviewUrl(path: string): string {
  const [base, hash] = path.split('#')
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${PREVIEW_PARAM}=1${hash ? `#${hash}` : ''}`
}
