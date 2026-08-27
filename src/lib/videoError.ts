// Normaliza los fallos de reproducción de los tres backends de video (Vimeo,
// YouTube y el <video> nativo) a una sola forma.
//
// Sin esto, cuando el reproductor de un proveedor se rompe el aprendiz se queda
// con la pantalla de error del PROVEEDOR: en el caso de Vimeo, un cartel genérico
// ("el reproductor está teniendo problemas") pintado con nuestro verde corporativo
// —el color de acento sale de la cuenta de Vimeo, no de aquí— cuyo botón "enviar
// registro de errores" manda el diagnóstico a la telemetría de Vimeo y a nosotros
// no nos llega nada. El resultado es un error que parece nuestro, no dice qué pasó
// y no deja rastro. Con esta normalización el reproductor puede poner su propio
// aviso encima, decir la causa real y ofrecer un reporte que sí llegue.

/** Qué le pasó al video, ya traducido desde la jerga de cada proveedor. */
export type VideoErrorKind =
  /** El video ya no existe: borrado del proveedor o el ID quedó mal guardado. */
  | 'unavailable'
  /** Existe, pero su privacidad no permite verlo aquí (dominio, contraseña, no listado sin hash). */
  | 'private'
  /** Algo del lado del usuario cortó la carga: proxy corporativo, extensión, CSP. */
  | 'blocked'
  /** La red se cayó o el CDN no respondió. Es lo único que suele arreglarse reintentando. */
  | 'network'
  /** No se pudo clasificar. Se reintenta igual: perder nada cuesta poco. */
  | 'unknown'

export type VideoErrorSource = 'vimeo' | 'youtube' | 'file'

export interface VideoPlayerError {
  kind: VideoErrorKind
  source: VideoErrorSource
  /** Código o nombre crudo del proveedor. Es lo que sirve para depurar el reporte. */
  code: string
  /** Mensaje crudo del proveedor, si vino. Se recorta: algunos son párrafos enteros. */
  raw?: string
}

/**
 * Si tiene sentido volver a intentar. Un video borrado o privado no se arregla
 * reintentando, y ofrecer el botón sería mentirle al aprendiz.
 */
export function isRetryable(err: VideoPlayerError): boolean {
  return err.kind === 'network' || err.kind === 'blocked' || err.kind === 'unknown'
}

/**
 * Errores del SDK de Vimeo. Llegan por dos vías con la misma forma `{ name, message }`:
 * el evento `error` del reproductor ya creado y el rechazo de `player.ready()`
 * cuando el video ni siquiera pudo montarse.
 */
export function mapVimeoError(e: unknown): VideoPlayerError {
  const o = (e ?? {}) as { name?: string; message?: string }
  const name = o.name ?? 'Error'
  const raw = o.message?.slice(0, 300)

  // Nombres del SDK de Vimeo (player.js).
  const kind: VideoErrorKind =
    name === 'NotFoundError' ? 'unavailable'
    : name === 'PrivacyError' || name === 'PasswordError' ? 'private'
    // El SDK usa TypeError para el ID mal formado y para el dominio no autorizado;
    // el mensaje es lo único que los separa.
    : name === 'TypeError' && /domain|private|permission/i.test(raw ?? '') ? 'private'
    : name === 'TypeError' || name === 'InvalidParameterError' ? 'unavailable'
    : 'network'

  return { kind, source: 'vimeo', code: name, raw }
}

/** Fallo al descargar el SDK del proveedor: o no hay red, o algo lo está bloqueando. */
export function sdkLoadError(source: VideoErrorSource): VideoPlayerError {
  return {
    // Con el navegador offline es red; con red disponible, casi siempre es un
    // proxy o una extensión comiéndose el script del reproductor.
    kind: typeof navigator !== 'undefined' && navigator.onLine === false ? 'network' : 'blocked',
    source,
    code: 'SDK_LOAD_FAILED',
  }
}

/** Códigos del evento `onError` de la IFrame API de YouTube. */
export function mapYouTubeError(code: number): VideoPlayerError {
  const kind: VideoErrorKind =
    code === 2 ? 'unavailable'          // ID inválido
    : code === 100 ? 'unavailable'      // borrado o privado
    : code === 101 || code === 150 ? 'private' // el dueño no permite incrustarlo
    : 'network'                         // 5: fallo del reproductor HTML5
  return { kind, source: 'youtube', code: `YT_${code}` }
}

/** Códigos de `MediaError` del <video> nativo (archivos servidos por nosotros). */
export function mapMediaError(err: MediaError | null): VideoPlayerError {
  const code = err?.code ?? 0
  const kind: VideoErrorKind =
    code === 2 ? 'network'        // MEDIA_ERR_NETWORK
    : code === 3 ? 'unknown'      // MEDIA_ERR_DECODE: archivo corrupto o códec raro
    : code === 4 ? 'unavailable'  // MEDIA_ERR_SRC_NOT_SUPPORTED: 404 o formato no servible
    : 'unknown'                   // 1: MEDIA_ERR_ABORTED
  return { kind, source: 'file', code: `MEDIA_${code}`, raw: err?.message?.slice(0, 300) }
}
