import { useCallback, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { YouTubePlayer } from './YouTubePlayer'
import { VimeoPlayer } from './VimeoPlayer'
import { VideoErrorNotice } from './VideoErrorNotice'
import type { VideoPlayerError } from '@/lib/videoError'
import type { PlayerLike } from '@/lib/youtube'

/**
 * Embed de YouTube/Vimeo para ver y ya: sin marcadores, sin quizzes y sin candado
 * de la primera pasada. Usa los controles nativos del proveedor.
 *
 * Va por el SDK y no por un `<iframe>` crudo por una sola razón: el iframe no nos
 * cuenta nada cuando falla. Con el embed crudo, un video borrado o un CDN caído
 * dejaban al aprendiz frente a la pantalla de error del proveedor —la de Vimeo,
 * encima, pintada con el verde de la cuenta, así que parecía nuestra— sin decir qué
 * pasó y con un botón de reporte que va a la telemetría de ellos. Por el SDK sí
 * llega el evento `error` y podemos poner nuestro propio aviso.
 */
interface PassiveVideoEmbedProps {
  kind: 'youtube' | 'vimeo'
  /** Valor guardado: ID de YouTube, o "id" / "id/hash" en Vimeo. */
  videoId: string
  /** Idioma de la interfaz, para el aviso de error y su reporte. */
  lang: string
  sectionId?: string | null
  sectionTitle?: string | null
  className?: string
}

export function PassiveVideoEmbed({
  kind,
  videoId,
  lang,
  sectionId,
  sectionTitle,
  className,
}: PassiveVideoEmbedProps) {
  const [err, setErr] = useState<VideoPlayerError | null>(null)
  // Cambiar este número remonta el reproductor: es la única forma de reintentar,
  // porque el efecto que lo crea solo depende del video y del modo de controles.
  const [retryNonce, setRetryNonce] = useState(0)
  // El SDK exige un ref donde dejar el mando, aunque aquí no lo pilotemos: sirve
  // para saber en qué segundo se cayó al reportar.
  const playerRef = useRef<PlayerLike | null>(null)

  const retry = useCallback(() => {
    setErr(null)
    setRetryNonce((n) => n + 1)
  }, [])

  const Player = kind === 'youtube' ? YouTubePlayer : VimeoPlayer

  return (
    <div className={className}>
      <div className="relative w-full bg-black" style={{ paddingTop: '56.25%' }}>
        <Player
          key={`${kind}:${videoId}:${retryNonce}`}
          videoId={videoId}
          playerRef={playerRef}
          controls
          className="absolute inset-0 w-full h-full"
          onError={setErr}
        />
        <AnimatePresence>
          {err && (
            <VideoErrorNotice
              err={err}
              onRetry={retry}
              sectionId={sectionId}
              sectionTitle={sectionTitle}
              videoUrl={videoId}
              getAtSeconds={() => playerRef.current?.currentTime ?? null}
              lang={lang}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
