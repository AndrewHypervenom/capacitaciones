import { useEffect, useRef } from 'react'
import { loadVimeoPlayerAPI, vimeoEmbedUrl } from '@/lib/vimeo'
import { mapVimeoError, sdkLoadError, type VideoPlayerError } from '@/lib/videoError'
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
  /**
   * El video no se pudo reproducir. Sin esto, el aprendiz se queda con la pantalla
   * de error de Vimeo: genérica, pintada con el color de acento de la cuenta (por
   * eso parece nuestra) y con un botón que manda el diagnóstico a Vimeo, no a
   * nosotros. Quien reciba esto debe tapar el iframe con su propio aviso.
   */
  onError?: (err: VideoPlayerError) => void
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
  onError,
}: VimeoPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const vmRef = useRef<any>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const readySignaledRef = useRef(false)

  // Guardamos los callbacks en refs para no recrear el reproductor si cambian de identidad.
  const cbRef = useRef({ onReady, onPlay, onPause, onEnded, onTimeUpdate, onError })
  cbRef.current = { onReady, onPlay, onPause, onEnded, onTimeUpdate, onError }

  useEffect(() => {
    let cancelled = false
    // Un solo aviso por montaje: Vimeo puede emitir `error` y rechazar `ready()`
    // por la misma causa, y el aprendiz no necesita enterarse dos veces.
    let errorSignaled = false
    const fail = (err: VideoPlayerError) => {
      if (cancelled || errorSignaled) return
      errorSignaled = true
      // El sondeo ya no sirve de nada y seguiría pidiendo tiempos a un reproductor roto.
      clearInterval(pollRef.current)
      cbRef.current.onError?.(err)
    }

    loadVimeoPlayerAPI().then(() => {
      if (cancelled || !hostRef.current) return
      const w = window as any

      // Montamos el <iframe> nosotros y le entregamos el elemento ya hecho al SDK.
      //
      // Es deliberado: si al Player se le pasa `{ id }`, el SDK primero hace un fetch
      // a vimeo.com/api/oembed.json para PEDIR el html del embed, y solo después crea
      // el iframe. Ese fetch va a `vimeo.com`, un dominio distinto de los que necesita
      // la reproducción (`player.vimeo.com` y `*.vimeocdn.com`), y es lo primero que
      // cae en un filtro corporativo: el SDK carga, el video no, y el aprendiz recibe
      // "There was an error fetching the embed code from Vimeo" sobre un video que
      // está perfectamente bien. Con el iframe ya montado el SDK se salta esa
      // petición y el reproductor deja de depender de un dominio que no reproduce nada.
      //
      // Las opciones viajan como parámetros de la URL porque el objeto de opciones
      // solo lo lee el SDK cuando es él quien construye el iframe.
      // Nota: ocultar controles requiere que el dueño del video tenga plan Vimeo de
      // pago; en cuentas gratuitas el parámetro se ignora y quedan los nativos.
      const params = [
        `controls=${controls ? 1 : 0}`,
        'pip=0',
        'playsinline=1',
        'title=0',
        'byline=0',
        'portrait=0',
      ].join('&')

      const iframe = document.createElement('iframe')
      // vimeoEmbedUrl añade el hash del video no listado y dnt=1.
      iframe.src = vimeoEmbedUrl(videoId, params)
      iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'
      iframe.allowFullscreen = true
      iframe.setAttribute('frameborder', '0')
      iframe.title = 'Vimeo'
      iframe.className = 'w-full h-full'
      hostRef.current.replaceChildren(iframe)

      const player = new w.Vimeo.Player(iframe)
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
      // Fallo con el reproductor ya en pie (se cayó la red a mitad, el CDN no
      // respondió, el video cambió de privacidad).
      player.on('error', (e: any) => fail(mapVimeoError(e)))
      // Fallo al montar: video borrado, hash de "no listado" que ya no vale, o el
      // dominio no está autorizado en la privacidad del video. El evento `error`
      // no cubre este caso porque el reproductor nunca llega a existir.
      player.ready().catch((e: any) => fail(mapVimeoError(e)))
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
    }).catch(() => {
      // SDK no disponible (offline, CSP, proxy corporativo o extensión que se come
      // el script). Antes el host quedaba vacío en silencio y parecía un video negro.
      fail(sdkLoadError('vimeo'))
    })

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
