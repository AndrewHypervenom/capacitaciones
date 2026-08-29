import { useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionBadge } from './ConnectionBadge'
import { useConnectionQuality } from '@/hooks/useConnectionQuality'
import { useVideoSeekGate } from '@/hooks/useVideoSeekGate'
import { buildVideoWatchId } from '@/lib/videoWatch'
import { mapMediaError, type VideoPlayerError } from '@/lib/videoError'
import { VideoErrorNotice } from './VideoErrorNotice'

/**
 * Video suelto (sin capítulos ni quiz): usa los controles nativos del navegador
 * y le añade en la esquina el mismo semáforo de conexión que el reproductor
 * grande, para que la respuesta a "¿es mi internet?" no dependa de qué tipo de
 * bloque le tocó al aprendiz.
 *
 * También lleva el candado de la primera pasada. Aquí la barra es del navegador
 * y no se puede pintar, así que el candado se aplica devolviendo el video a su
 * sitio en cuanto alguien lo arrastra hacia adelante — con el aviso a la vista,
 * porque un video que "se rebobina solo" y sin explicación es exactamente el
 * reporte de falla que se quiere evitar.
 */
export function SimpleVideo({
  src,
  title,
  sectionId,
  blockIndex,
}: {
  src: string
  title?: string
  /** Dónde vive el video, para la identidad del candado (ver `buildVideoWatchId`). */
  sectionId?: string
  blockIndex?: number
}) {
  const { t, i18n } = useTranslation()
  const [el, setEl] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)

  // ── Fallo de reproducción ──
  // El <video> nativo avisa por `onError`, pero antes nadie lo escuchaba: un
  // archivo caído o un 404 dejaban un rectángulo negro sin explicación, y el
  // aprendiz no tenía cómo contárnoslo.
  const [err, setErr] = useState<VideoPlayerError | null>(null)
  // Cambiarlo remonta el <video>, que es lo que fuerza a pedir el archivo de nuevo.
  const [retryNonce, setRetryNonce] = useState(0)
  const retry = useCallback(() => {
    setErr(null)
    setRetryNonce((n) => n + 1)
  }, [])
  const quality = useConnectionQuality(el, playing)
  // Mismo encabezado sintético que usa `inlineVideoSection`, para que un bloque
  // de video tenga la misma identidad se reproduzca por donde se reproduzca.
  const seekGate = useVideoSeekGate(
    buildVideoWatchId(sectionId, `vb:${sectionId ?? ''}:${blockIndex ?? 0}`, src),
  )

  return (
    <div>
      {/* Envoltura propia del video: el aviso de error y el semáforo se posicionan
          contra ESTO y no contra el bloque entero, para no taparle el texto del
          candado que va debajo. */}
      <div className="relative rounded-2xl overflow-hidden">
        <video
          key={retryNonce}
          ref={setEl}
          src={src}
          title={title}
          controls
          preload="metadata"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            seekGate.note(v.currentTime, v.duration)
            // A un suspiro del final cuenta como visto: hay videos cuyo último
            // segundo el navegador nunca reporta y el candado se quedaría puesto.
            if (v.duration > 0 && v.currentTime >= v.duration - 1.5) seekGate.markDone(v.duration)
          }}
          onEnded={(e) => seekGate.markDone(e.currentTarget.duration)}
          onError={(e) => {
            setErr(mapMediaError(e.currentTarget.error))
            // Si no, la barra se queda en "reproduciendo" sobre un video muerto.
            setPlaying(false)
          }}
          onSeeking={(e) => {
            const v = e.currentTarget
            const allowed = seekGate.clamp(v.currentTime)
            if (allowed < v.currentTime) v.currentTime = allowed
          }}
          className="w-full rounded-2xl border border-line block bg-black"
        />
        {/* Arriba a la derecha: abajo están los controles nativos y ahí estorbaría. */}
        <div className="absolute top-2 right-2 rounded-lg bg-black/45 p-1.5 backdrop-blur-sm">
          <ConnectionBadge quality={quality} />
        </div>

        <AnimatePresence>
          {seekGate.notice && (
            <motion.div
              key="no-skip"
              className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
            >
              <span className="flex max-w-[min(92%,26rem)] items-start gap-2 rounded-2xl border border-amber-400/25 bg-zinc-900/95 px-4 py-2.5 text-[12px] leading-snug text-amber-100/90 shadow-xl backdrop-blur-sm">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                {t('video.no_skip_notice')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {err && (
            <VideoErrorNotice
              err={err}
              onRetry={retry}
              sectionId={sectionId}
              sectionTitle={title}
              videoUrl={src}
              getAtSeconds={() => el?.currentTime ?? null}
              lang={i18n.language}
            />
          )}
        </AnimatePresence>
      </div>

      {/* La regla, anunciada de entrada y no solo cuando se choca con ella. */}
      {seekGate.active && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-amber-600 dark:text-amber-400">
          <span className="flex items-center gap-1.5">
            <Lock className="h-3 w-3 shrink-0" /> {t('video.no_skip_hint')}
          </span>
          {/* Llave de mantenimiento: el staff ve el candado igual que el
              aprendiz, pero puede quitárselo para revisar. */}
          {seekGate.canOverride && (
            <button
              type="button"
              onClick={seekGate.override}
              title={t('video.staff_unlock_hint')}
              className="font-semibold underline underline-offset-2 hover:text-amber-500"
            >
              {t('video.staff_unlock')}
            </button>
          )}
        </p>
      )}
    </div>
  )
}
