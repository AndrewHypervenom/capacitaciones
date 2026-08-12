import { useState } from 'react'
import { ConnectionBadge } from './ConnectionBadge'
import { useConnectionQuality } from '@/hooks/useConnectionQuality'

/**
 * Video suelto (sin capítulos ni quiz): usa los controles nativos del navegador
 * y le añade en la esquina el mismo semáforo de conexión que el reproductor
 * grande, para que la respuesta a "¿es mi internet?" no dependa de qué tipo de
 * bloque le tocó al aprendiz.
 */
export function SimpleVideo({ src, title }: { src: string; title?: string }) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const quality = useConnectionQuality(el, playing)

  return (
    <div className="relative">
      <video
        ref={setEl}
        src={src}
        title={title}
        controls
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="w-full rounded-2xl border border-line block bg-black"
      />
      {/* Arriba a la derecha: abajo están los controles nativos y ahí estorbaría. */}
      <div className="absolute top-2 right-2 rounded-lg bg-black/45 p-1.5 backdrop-blur-sm">
        <ConnectionBadge quality={quality} />
      </div>
    </div>
  )
}
