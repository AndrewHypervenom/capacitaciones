// Utilidades compartidas para YouTube: extracción de ID y carga de la IFrame Player API.
// Se usa tanto para el embed pasivo (MediaUploader) como para el video interactivo con
// quizzes (InteractiveVideoModule / VideoMarkerEditor), donde necesitamos controlar el
// reproductor (play/pause/seek/tiempo) igual que con un <video> nativo.

/** Extrae el ID de 11 caracteres desde una URL de YouTube o desde el ID pelado. */
export function extractYouTubeId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ]
  for (const p of patterns) {
    const m = input.trim().match(p)
    if (m) return m[1]
  }
  return null
}

/**
 * Interfaz mínima común entre un <video> nativo y el reproductor de YouTube.
 * Es el subconjunto de HTMLVideoElement que usan el reproductor y el editor, de modo
 * que ambos backends son intercambiables sin tocar la lógica de marcadores/quizzes.
 */
export interface PlayerLike {
  play: () => void
  pause: () => void
  currentTime: number
  readonly duration: number
  volume: number
  muted: boolean
  playbackRate: number
}

let apiPromise: Promise<void> | null = null

/** Carga la IFrame Player API de YouTube una sola vez y resuelve cuando `window.YT` está lista. */
export function loadYouTubeIframeAPI(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (w.YT && w.YT.Player) return Promise.resolve()
  if (apiPromise) return apiPromise

  apiPromise = new Promise<void>((resolve) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev()
      resolve()
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
  })
  return apiPromise
}
