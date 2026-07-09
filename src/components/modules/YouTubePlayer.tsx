import { useEffect, useRef } from 'react'
import { loadYouTubeIframeAPI, type PlayerLike } from '@/lib/youtube'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface YouTubePlayerProps {
  /** ID de 11 caracteres del video de YouTube. */
  videoId: string
  className?: string
  /** Si `true`, muestra los controles nativos de YouTube (útil en el editor). */
  controls?: boolean
  /**
   * Ref que recibe un objeto compatible con la parte de HTMLVideoElement que usa el
   * reproductor/editor (play/pause/currentTime/duration/volume/muted/playbackRate).
   * Se puebla en onReady y se limpia al desmontar.
   */
  playerRef: React.MutableRefObject<PlayerLike | null>
  onReady?: () => void
  onPlay?: () => void
  onPause?: () => void
  onEnded?: () => void
  /** Se invoca ~4 veces por segundo mientras el reproductor está listo (equivale a `timeupdate`). */
  onTimeUpdate?: () => void
}

// Estados de la IFrame API de YouTube.
const YT_PLAYING = 1
const YT_PAUSED = 2
const YT_ENDED = 0

export function YouTubePlayer({
  videoId,
  className,
  controls = false,
  playerRef,
  onReady,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
}: YouTubePlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const ytRef = useRef<any>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const readySignaledRef = useRef(false)

  // Guardamos los callbacks en refs para no recrear el reproductor si cambian de identidad.
  const cbRef = useRef({ onReady, onPlay, onPause, onEnded, onTimeUpdate })
  cbRef.current = { onReady, onPlay, onPause, onEnded, onTimeUpdate }

  useEffect(() => {
    let cancelled = false

    loadYouTubeIframeAPI().then(() => {
      if (cancelled || !hostRef.current) return
      const w = window as any

      const player = new w.YT.Player(hostRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          controls: controls ? 1 : 0,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          playsinline: 1,
          disablekb: controls ? 0 : 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            // Adaptador que expone la interfaz PlayerLike sobre la API de YouTube.
            const handle: PlayerLike = {
              play: () => player.playVideo(),
              pause: () => player.pauseVideo(),
              get currentTime() { return player.getCurrentTime?.() ?? 0 },
              set currentTime(v: number) { player.seekTo(v, true) },
              get duration() { return player.getDuration?.() ?? 0 },
              get volume() { return (player.getVolume?.() ?? 100) / 100 },
              set volume(v: number) { player.setVolume(Math.round(v * 100)) },
              get muted() { return player.isMuted?.() ?? false },
              set muted(v: boolean) { v ? player.mute() : player.unMute() },
              get playbackRate() { return player.getPlaybackRate?.() ?? 1 },
              set playbackRate(v: number) { player.setPlaybackRate(v) },
            }
            playerRef.current = handle

            // Sondeo de tiempo (la API no emite un evento continuo como <video>).
            pollRef.current = setInterval(() => {
              cbRef.current.onTimeUpdate?.()
              // Esperamos a que la duración esté disponible para señalar "metadata lista"
              // una sola vez (así el reanudar/duración funcionan igual que con <video>).
              if (!readySignaledRef.current && (player.getDuration?.() ?? 0) > 0) {
                readySignaledRef.current = true
                cbRef.current.onReady?.()
              }
            }, 250)
          },
          onStateChange: (e: any) => {
            if (e.data === YT_PLAYING) cbRef.current.onPlay?.()
            else if (e.data === YT_PAUSED) cbRef.current.onPause?.()
            else if (e.data === YT_ENDED) cbRef.current.onEnded?.()
          },
        },
      })
      ytRef.current = player
    })

    return () => {
      cancelled = true
      clearInterval(pollRef.current)
      readySignaledRef.current = false
      playerRef.current = null
      try { ytRef.current?.destroy?.() } catch { /* ignore */ }
      ytRef.current = null
    }
    // Recrear solo si cambia el video o el modo de controles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, controls])

  // Host que la API reemplaza por el <iframe>. El div externo mantiene el tamaño.
  return (
    <div className={className}>
      <div ref={hostRef} className="w-full h-full" />
    </div>
  )
}
