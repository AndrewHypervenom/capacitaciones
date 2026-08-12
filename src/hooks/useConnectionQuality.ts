import { useEffect, useRef, useState } from 'react'

/**
 * Diagnóstico de conexión durante la reproducción de un video.
 *
 * Para qué sirve: cuando un video se traba, el aprendiz no sabe si el problema
 * es su internet o el sitio. Este hook mide lo que de verdad importa —cuánto
 * video lleva descargado por delante y cuántas veces se quedó esperando datos—
 * y lo cruza con lo que el navegador dice de la red.
 *
 * Por qué el buffer manda sobre la Network Information API: `navigator.connection`
 * no existe en Safari ni en Firefox, y donde existe da una estimación gruesa del
 * enlace, no del flujo real de ESTE video. El buffer del `<video>` es la medida
 * honesta: si hay 20 s cargados por delante, la conexión está bien aunque el
 * navegador diga "3g". La API de red queda como respaldo y como dato extra.
 *
 * En YouTube/Vimeo no hay `<video>` que mirar (va dentro de un iframe de otro
 * dominio), así que ahí `measured` es false y el diagnóstico es solo de red.
 */

export type ConnLevel = 'good' | 'fair' | 'poor' | 'offline'

export interface ConnectionQuality {
  level: ConnLevel
  /** Segundos de video ya descargados por delante del punto actual. null si no se puede medir. */
  bufferAhead: number | null
  /** Veces que el video se quedó esperando datos en el último minuto. */
  stalls: number
  /** Ahora mismo esperando datos. */
  stalling: boolean
  /** Mbps estimados por el navegador. null si no expone la API. */
  downlink: number | null
  /** '4g' | '3g' | '2g' | 'slow-2g' según el navegador. null si no la expone. */
  effectiveType: string | null
  /** true si el diagnóstico incluye datos del reproductor (no solo de la red). */
  measured: boolean
}

/** Ventana en la que un corte sigue contando para el diagnóstico. */
const STALL_WINDOW_MS = 60_000

/** Cada cuánto se lee el buffer. Un segundo basta y no cuesta nada. */
const POLL_MS = 1000

/** Por debajo de esto, el video está a un tropezón de pararse. */
const BUFFER_POOR_S = 1.5
const BUFFER_FAIR_S = 5

type NetworkInfo = {
  downlink?: number
  effectiveType?: string
  addEventListener?: (type: 'change', fn: () => void) => void
  removeEventListener?: (type: 'change', fn: () => void) => void
}

function getNetwork(): NetworkInfo | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & { connection?: NetworkInfo }
  return nav.connection ?? null
}

/** Segundos cargados por delante del punto de reproducción. */
function bufferAheadOf(v: HTMLVideoElement): number | null {
  try {
    const { buffered, currentTime } = v
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime + 0.25 && buffered.end(i) >= currentTime) {
        return Math.max(0, buffered.end(i) - currentTime)
      }
    }
    return 0
  } catch {
    return null
  }
}

/**
 * @param video   El `<video>` nativo, o null para embeds (solo diagnóstico de red).
 * @param playing Si está reproduciendo. Con el video en pausa el buffer no dice nada:
 *                un video pausado siempre acaba con el buffer lleno o quieto.
 */
export function useConnectionQuality(
  video: HTMLVideoElement | null,
  playing: boolean,
): ConnectionQuality {
  const net = getNetwork()

  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [downlink, setDownlink] = useState<number | null>(net?.downlink ?? null)
  const [effectiveType, setEffectiveType] = useState<string | null>(net?.effectiveType ?? null)
  const [bufferAhead, setBufferAhead] = useState<number | null>(null)
  const [stalling, setStalling] = useState(false)
  const [stalls, setStalls] = useState(0)

  /** Marcas de tiempo de los cortes recientes; se podan a la ventana. */
  const stallTimes = useRef<number[]>([])

  // ── Online / offline ──
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  // ── Network Information API (Chrome/Edge/Android; ausente en Safari y Firefox) ──
  useEffect(() => {
    const n = getNetwork()
    if (!n?.addEventListener) return
    const onChange = () => {
      setDownlink(n.downlink ?? null)
      setEffectiveType(n.effectiveType ?? null)
    }
    onChange()
    n.addEventListener('change', onChange)
    return () => n.removeEventListener?.('change', onChange)
  }, [])

  // ── Señales del reproductor ──
  useEffect(() => {
    if (!video) {
      setBufferAhead(null)
      setStalling(false)
      return
    }

    const pushStall = () => {
      const now = Date.now()
      stallTimes.current = [...stallTimes.current.filter((t) => now - t < STALL_WINDOW_MS), now]
      setStalls(stallTimes.current.length)
      setStalling(true)
    }
    const clearStall = () => setStalling(false)

    video.addEventListener('waiting', pushStall)
    video.addEventListener('stalled', pushStall)
    video.addEventListener('playing', clearStall)
    video.addEventListener('canplay', clearStall)
    video.addEventListener('seeking', clearStall)

    // El buffer se lee por reloj, no por eventos: `progress` deja de dispararse
    // justo cuando la red se cae, que es cuando más falta hace el dato.
    const tick = () => {
      setBufferAhead(bufferAheadOf(video))
      const now = Date.now()
      const live = stallTimes.current.filter((t) => now - t < STALL_WINDOW_MS)
      if (live.length !== stallTimes.current.length) {
        stallTimes.current = live
        setStalls(live.length)
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)

    return () => {
      clearInterval(id)
      video.removeEventListener('waiting', pushStall)
      video.removeEventListener('stalled', pushStall)
      video.removeEventListener('playing', clearStall)
      video.removeEventListener('canplay', clearStall)
      video.removeEventListener('seeking', clearStall)
    }
  }, [video])

  const measured = !!video && bufferAhead !== null

  let level: ConnLevel = 'good'
  if (!online) {
    level = 'offline'
  } else if (measured) {
    // Con datos del reproductor mandan el buffer y los cortes: es lo que el
    // aprendiz está viviendo, no lo que el navegador cree del enlace.
    const nearEnd = !!video && video.duration > 0 && video.duration - video.currentTime < BUFFER_FAIR_S
    if (stalling || stalls >= 2) level = 'poor'
    else if (playing && !nearEnd && (bufferAhead as number) < BUFFER_POOR_S) level = 'poor'
    else if (stalls === 1) level = 'fair'
    else if (playing && !nearEnd && (bufferAhead as number) < BUFFER_FAIR_S) level = 'fair'
  } else if (effectiveType === 'slow-2g' || effectiveType === '2g') {
    level = 'poor'
  } else if (effectiveType === '3g' || (downlink !== null && downlink < 1.5)) {
    level = 'fair'
  }

  return { level, bufferAhead, stalls, stalling, downlink, effectiveType, measured }
}
