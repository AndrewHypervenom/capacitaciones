import { useEffect, useRef } from 'react'
import { loadVimeoPlayerAPI } from '@/lib/vimeo'
import type { PlayerLike } from '@/lib/youtube'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface VimeoPlayerProps {
  /** Valor guardado del video: "123456789" o "123456789/hash" (no listado). */
  videoId: string
  className?: string
  /** Si `true`, muestra los controles nativos de Vimeo (útil en el editor). */
  controls?: boolean
  /**
   * Ref que recibe un objeto compatible con la parte de HTMLVideoElement que usa el
   * reproductor/editor (play/pause/currentTime/duration/volume/muted/playbackRate).
   * Se puebla al crear el reproductor y se limpia al desmontar.
   */
  playerRef: React.MutableRefObject<PlayerLike | null>
  onReady?: () => void
  onPlay?: () => void
  onPause?: () => void
  onEnded?: () => void
  /** Se invoca ~4 veces por segundo mientras el reproductor está listo (equivale a `timeupdate`). */
  onTimeUpdate?: () => void
}

export function VimeoPlayer({
  videoId,
  className,
  controls = false,
  playerRef,
  onReady,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
}: VimeoPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const vmRef = useRef<any>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const readySignaledRef = useRef(false)

  // Guardamos los callbacks en refs para no recrear el reproductor si cambian de identidad.
  const cbRef = useRef({ onReady, onPlay, onPause, onEnded, onTimeUpdate })
  cbRef.current = { onReady, onPlay, onPause, onEnded, onTimeUpdate }

  useEffect(() => {
    let cancelled = false

    loadVimeoPlayerAPI().then(() => {
      if (cancelled || !hostRef.current) return
      const w = window as any
      const [id, hash] = videoId.split('/')

      const player = new w.Vimeo.Player(hostRef.current, {
        id: Number(id),
        ...(hash ? { h: hash } : {}),
        responsive: false,
        width: '100%',
        // Nota: ocultar controles requiere que el dueño del video tenga plan Vimeo de
        // pago; en cuentas gratuitas el parámetro se ignora y quedan los nativos.
        controls,
        dnt: true,
        pip: false,
        playsinline: true,
        title: false,
        byline: false,
        portrait: false,
      })
      vmRef.current = player

      // El SDK de Vimeo es asíncrono (todo devuelve promesas); cacheamos los valores
      // para exponer la interfaz síncrona PlayerLike que comparten <video> y YouTube.
      const cache = { time: 0, duration: 0, volume: 1, muted: false, rate: 1 }

      const handle: PlayerLike = {
        play: () => { player.play().catch(() => {}) },
        pause: () => { player.pause().catch(() => {}) },
        get currentTime() { return cache.time },
        set currentTime(v: number) {
          cache.time = v
          player.setCurrentTime(v).catch(() => {})
        },
        get duration() { return cache.duration },
        get volume() { return cache.volume },
        set volume(v: number) {
          cache.volume = v
          player.setVolume(v).catch(() => {})
        },
        get muted() { return cache.muted },
        set muted(v: boolean) {
          cache.muted = v
          player.setMuted(v).catch(() => {})
        },
        get playbackRate() { return cache.rate },
        set playbackRate(v: number) {
          cache.rate = v
          player.setPlaybackRate(v).catch(() => {})
        },
      }
      playerRef.current = handle

      player.on('timeupdate', (d: any) => {
        cache.time = d.seconds
        if (d.duration) cache.duration = d.duration
      })
      player.on('seeked', (d: any) => { cache.time = d.seconds })
      player.on('volumechange', (d: any) => { cache.volume = d.volume })
      player.on('playbackratechange', (d: any) => { cache.rate = d.playbackRate })
      player.on('play', () => cbRef.current.onPlay?.())
      player.on('pause', () => cbRef.current.onPause?.())
      player.on('ended', () => cbRef.current.onEnded?.())
      player.on('loaded', () => {
        player.getDuration().then((dur: number) => { cache.duration = dur }).catch(() => {})
      })

      // Sondeo de tiempo (mismo patrón que YouTubePlayer): refresca la caché aunque
      // el video esté pausado y señala "metadata lista" una sola vez cuando hay duración.
      pollRef.current = setInterval(() => {
        player.getCurrentTime().then((s: number) => { cache.time = s }).catch(() => {})
        if (!cache.duration) {
          player.getDuration().then((dur: number) => { if (dur) cache.duration = dur }).catch(() => {})
        }
        cbRef.current.onTimeUpdate?.()
        if (!readySignaledRef.current && cache.duration > 0) {
          readySignaledRef.current = true
          cbRef.current.onReady?.()
        }
      }, 250)
    }).catch(() => { /* SDK no disponible (offline/CSP): el host queda vacío */ })

    return () => {
      cancelled = true
      clearInterval(pollRef.current)
      readySignaledRef.current = false
      playerRef.current = null
      try { vmRef.current?.destroy?.() } catch { /* ignore */ }
      vmRef.current = null
    }
    // Recrear solo si cambia el video o el modo de controles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, controls])

  // Host donde el SDK inserta el <iframe>. El div externo mantiene el tamaño.
  return (
    <div className={className}>
      <div ref={hostRef} className="w-full h-full [&_iframe]:w-full [&_iframe]:h-full" />
    </div>
  )
}
