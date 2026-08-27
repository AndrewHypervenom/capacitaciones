import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, RotateCcw, Send, WifiOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isRetryable, type VideoPlayerError } from '@/lib/videoError'
import { reportVideoIssue } from '@/services/videoIssue.service'

/**
 * Aviso propio cuando un video no se pudo reproducir. Tapa el iframe del proveedor.
 *
 * Existe porque sin él el aprendiz se queda con la pantalla de error del proveedor:
 * la de Vimeo es genérica, va pintada con el color de acento de la cuenta (por eso
 * parece nuestra) y su botón "enviar registro de errores" manda el diagnóstico a la
 * telemetría de Vimeo, no a nosotros. Aquí decimos la causa real, ofrecemos reintentar
 * solo cuando puede servir, y el reporte sí llega a la bandeja.
 *
 * Lo usan tanto el reproductor interactivo como el embed pasivo, así que el texto y
 * el reporte viven en un solo sitio.
 */
interface VideoErrorNoticeProps {
  err: VideoPlayerError
  /** Remonta el reproductor. Si no se pasa, no se ofrece reintentar. */
  onRetry?: () => void
  /** Contexto del reporte: sin esto el staff recibe un error sin saber de dónde salió. */
  sectionId?: string | null
  sectionTitle?: string | null
  videoUrl?: string | null
  /** Segundo en el que se cayó, si se puede saber. Se lee al enviar, no antes. */
  getAtSeconds?: () => number | null
  lang: string
  /** Aviso reducido: en un embed pequeño no cabe el texto largo ni el código. */
  compact?: boolean
}

export function VideoErrorNotice({
  err,
  onRetry,
  sectionId,
  sectionTitle,
  videoUrl,
  getAtSeconds,
  lang,
  compact = false,
}: VideoErrorNoticeProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const send = useCallback(async () => {
    if (state === 'sending' || state === 'sent') return
    setState('sending')
    try {
      await reportVideoIssue({
        err,
        sectionId,
        sectionTitle,
        videoUrl,
        atSeconds: getAtSeconds?.() ?? null,
        lang,
        page: window.location.pathname,
        pageLabel: sectionTitle ?? 'Módulo',
      })
      setState('sent')
    } catch {
      // Que el reporte falle no puede dejar el botón girando para siempre: se
      // ofrece reintentarlo, y el aviso del video sigue en pie igual.
      setState('failed')
    }
  }, [err, sectionId, sectionTitle, videoUrl, getAtSeconds, lang, state])

  return (
    <motion.div
      key="video-error"
      className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/92 px-6 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="w-full max-w-sm text-center"
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/12 ring-1 ring-amber-400/25">
          {err.kind === 'network' || err.kind === 'blocked' ? (
            <WifiOff className="h-5 w-5 text-amber-300" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          )}
        </div>

        <p className="mt-4 text-[15px] font-semibold text-white">{t(`video.error.${err.kind}.title`)}</p>
        {!compact && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60 text-balance">
            {t(`video.error.${err.kind}.hint`)}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {/* Reintentar solo cuando de verdad puede servir: con un video borrado o
              privado, el botón sería una promesa falsa. */}
          {onRetry && isRetryable(err) && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-full bg-neon-green px-5 py-2.5 text-[13px] font-semibold text-black transition-transform duration-200 hover:scale-[1.03]"
            >
              <RotateCcw className="h-4 w-4" />
              {t('video.error.retry')}
            </button>
          )}

          <button
            type="button"
            onClick={send}
            disabled={state === 'sending' || state === 'sent'}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-medium transition-colors',
              state === 'sent'
                ? 'border-neon-green/30 text-neon-green cursor-default'
                : 'border-white/20 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50',
            )}
          >
            {state === 'sent' ? <Check className="h-4 w-4" /> : <Send className="h-3.5 w-3.5" />}
            {state === 'sent'
              ? t('video.error.reported')
              : state === 'sending'
                ? t('video.error.reporting')
                : state === 'failed'
                  ? t('video.error.report_retry')
                  : t('video.error.report')}
          </button>
        </div>

        {state === 'sent' && (
          <p className="mt-3 text-[11.5px] text-white/45">{t('video.error.reported_hint')}</p>
        )}

        {/* El código crudo del proveedor, discreto: al aprendiz no le dice nada,
            pero es lo primero que pide quien va a diagnosticarlo. */}
        {!compact && (
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-wider text-white/25">
            {err.source} · {err.code}
          </p>
        )}
      </motion.div>
    </motion.div>
  )
}
