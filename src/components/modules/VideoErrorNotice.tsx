import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { AlertTriangle, Camera, Check, Copy, RotateCcw, Send, WifiOff } from 'lucide-react'
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
 * Está pensado como PANTALLAZO: en la práctica el aprendiz no aprieta "Reportar", le
 * toma una foto a la pantalla y la manda por WhatsApp. Por eso el aviso ocupa todo el
 * espacio que tenga —el área del video, o la pantalla entera si está en pantalla
 * completa— y siempre deja a la vista los datos que el staff necesita para
 * diagnosticar: referencia, código del proveedor, video, segundo, sección, página y
 * hora. Un pantallazo del aviso vale tanto como un reporte enviado.
 *
 * Lo usan el reproductor interactivo, el embed pasivo y el video suelto, así que el
 * texto, el diagnóstico y el reporte viven en un solo sitio.
 */
interface VideoErrorNoticeProps {
  err: VideoPlayerError
  /** Remonta el reproductor. Si no se pasa, no se ofrece reintentar. */
  onRetry?: () => void
  /** Contexto del reporte: sin esto el staff recibe un error sin saber de dónde salió. */
  sectionId?: string | null
  sectionTitle?: string | null
  videoUrl?: string | null
  /** Segundo en el que se cayó, si se puede saber. Se lee al montar, para el pantallazo. */
  getAtSeconds?: () => number | null
  lang: string
}

/**
 * Cuánto espacio hay. No es una preferencia de quien llama sino lo que se mide: el
 * mismo aviso vive en un embed de 300px dentro del texto y en una pantalla completa
 * de 27", y en el segundo caso el pantallazo tiene que leerse desde el celular de
 * quien lo recibe.
 */
type Tier = 'xs' | 'sm' | 'md' | 'lg'

function tierFor(w: number, h: number): Tier {
  if (w < 380 || h < 220) return 'xs'
  if (w < 620 || h < 340) return 'sm'
  if (w < 1000 || h < 620) return 'md'
  return 'lg'
}

/**
 * Foto del momento de la falla: referencia, hora y segundo. Va colgada del propio
 * objeto de error y no del componente porque el aviso SE REMONTA —entrar y salir de
 * pantalla completa lo cambia de sitio en el árbol—, y un pantallazo con una
 * referencia distinta a la del reporte enviado no se puede casar con nada.
 */
interface ErrorStamp {
  ref: string
  when: Date
  at: number | null
}

const stamps = new WeakMap<VideoPlayerError, ErrorStamp>()

function stampFor(err: VideoPlayerError, at: number | null): ErrorStamp {
  const seen = stamps.get(err)
  if (seen) return seen
  const time = Date.now().toString(36).slice(-5)
  const rand = Math.random().toString(36).slice(2, 5)
  const made: ErrorStamp = { ref: `V-${time}${rand}`.toUpperCase(), when: new Date(), at }
  stamps.set(err, made)
  return made
}

function mmss(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec)) return null
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Navegador y sistema en dos palabras: el `userAgent` entero no cabe ni se lee. */
function browserLabel(): string {
  if (typeof navigator === 'undefined') return '—'
  const ua = navigator.userAgent
  const raw =
    /Edg\/[\d.]+/.exec(ua)?.[0].replace('Edg/', 'Edge ') ??
    /OPR\/[\d.]+/.exec(ua)?.[0].replace('OPR/', 'Opera ') ??
    /Firefox\/[\d.]+/.exec(ua)?.[0].replace('/', ' ') ??
    /Chrome\/[\d.]+/.exec(ua)?.[0].replace('/', ' ') ??
    (/Safari\//.test(ua) ? 'Safari' : 'Navegador')
  const os =
    /Windows NT/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : ''
  // Solo la versión mayor: "Chrome 126" identifica igual de bien que el build entero.
  return [raw.split('.')[0], os].filter(Boolean).join(' · ')
}

export function VideoErrorNotice({
  err,
  onRetry,
  sectionId,
  sectionTitle,
  videoUrl,
  getAtSeconds,
  lang,
}: VideoErrorNoticeProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [tier, setTier] = useState<Tier>('sm')

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stamp = useMemo(() => stampFor(err, getAtSeconds?.() ?? null), [err])
  const ref = stamp.ref
  const at = mmss(stamp.at)
  const when = useMemo(
    () => stamp.when.toLocaleString(lang || 'es', { dateStyle: 'short', timeStyle: 'short' }),
    [stamp, lang],
  )

  // ── Ocupar todo el espacio disponible ──
  // El aviso mide su propia caja en vez de recibir un `compact`: dentro del
  // reproductor en pantalla completa esa caja pasa de 640px a la pantalla entera sin
  // que quien lo llama tenga que enterarse.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setTier(tierFor(el.clientWidth, el.clientHeight))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Si quien está en pantalla completa es el iframe del proveedor o el <video>
  // nativo, este aviso queda pintado DEBAJO y el aprendiz sigue viendo el error de
  // ellos. Como no podemos dibujar dentro de ese elemento, se sale de pantalla
  // completa para que el aviso —y su pantallazo— sí se vean.
  useEffect(() => {
    const fs = document.fullscreenElement
    if (!fs || (rootRef.current && fs.contains(rootRef.current))) return
    try {
      void document.exitFullscreen()?.catch(() => {})
    } catch {
      // Navegador que no deja salir por código: queda el error del proveedor debajo,
      // pero al volver de pantalla completa este aviso está esperando.
    }
  }, [])

  const details = useMemo<Array<[string, string]>>(
    () => [
      [t('video.error.d_ref'), ref],
      [t('video.error.d_code'), `${err.source} · ${err.code} · ${err.kind}`],
      [t('video.error.d_video'), videoUrl || '—'],
      ...(at ? ([[t('video.error.d_at'), at]] as Array<[string, string]>) : []),
      [t('video.error.d_section'), sectionTitle || sectionId || '—'],
      [t('video.error.d_page'), window.location.pathname],
      [t('video.error.d_when'), when],
      [t('video.error.d_browser'), browserLabel()],
      ...(err.raw ? ([[t('video.error.d_detail'), err.raw]] as Array<[string, string]>) : []),
    ],
    [t, ref, err, videoUrl, at, sectionTitle, sectionId, when],
  )

  const send = useCallback(async () => {
    if (state === 'sending' || state === 'sent') return
    setState('sending')
    try {
      await reportVideoIssue({
        err,
        ref,
        sectionId,
        sectionTitle,
        videoUrl,
        // El mismo segundo que muestra el aviso: si se lee otra vez al enviar, el
        // reporte y el pantallazo dirían cosas distintas.
        atSeconds: stamp.at,
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
  }, [err, ref, stamp, sectionId, sectionTitle, videoUrl, lang, state])

  // Copiar el diagnóstico como texto, para quien prefiere pegarlo antes que mandar
  // una foto. No pasa por el evento `copy` que intercepta ContentProtection: esto no
  // es contenido del curso, es el detalle de una falla nuestra.
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(details.map(([k, v]) => `${k}: ${v}`).join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      // Sin permiso de portapapeles queda el pantallazo, que es el camino principal.
    }
  }, [details])

  const big = tier === 'lg'
  const wide = tier === 'md' || tier === 'lg'

  return (
    <motion.div
      ref={rootRef}
      key="video-error"
      className={cn(
        'absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-zinc-950/95 backdrop-blur-sm',
        tier === 'xs' ? 'px-4 py-4' : big ? 'px-10 py-10' : 'px-6 py-6',
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className={cn(
          'w-full text-center',
          tier === 'xs' ? 'max-w-xs' : tier === 'sm' ? 'max-w-sm' : tier === 'md' ? 'max-w-xl' : 'max-w-3xl',
        )}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className={cn(
            'mx-auto flex items-center justify-center rounded-2xl bg-amber-400/12 ring-1 ring-amber-400/25',
            big ? 'h-16 w-16' : wide ? 'h-14 w-14' : 'h-11 w-11',
          )}
        >
          {err.kind === 'network' || err.kind === 'blocked' ? (
            <WifiOff className={cn('text-amber-300', big ? 'h-8 w-8' : wide ? 'h-6 w-6' : 'h-5 w-5')} />
          ) : (
            <AlertTriangle className={cn('text-amber-300', big ? 'h-8 w-8' : wide ? 'h-6 w-6' : 'h-5 w-5')} />
          )}
        </div>

        <p
          className={cn(
            'font-semibold text-white text-balance',
            big ? 'mt-6 text-[26px]' : wide ? 'mt-5 text-[19px]' : 'mt-4 text-[15px]',
          )}
        >
          {t(`video.error.${err.kind}.title`)}
        </p>
        {tier !== 'xs' && (
          <p
            className={cn(
              'leading-relaxed text-white/60 text-balance',
              big ? 'mt-3 text-[15px]' : wide ? 'mt-2 text-[13.5px]' : 'mt-1.5 text-[12.5px]',
            )}
          >
            {t(`video.error.${err.kind}.hint`)}
          </p>
        )}

        <div className={cn('flex flex-wrap items-center justify-center gap-2.5', big ? 'mt-8' : 'mt-6')}>
          {/* Reintentar solo cuando de verdad puede servir: con un video borrado o
              privado, el botón sería una promesa falsa. */}
          {onRetry && isRetryable(err) && (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                'inline-flex items-center gap-2 rounded-full bg-neon-green font-semibold text-black transition-transform duration-200 hover:scale-[1.03]',
                big ? 'px-7 py-3 text-[15px]' : 'px-5 py-2.5 text-[13px]',
              )}
            >
              <RotateCcw className={big ? 'h-5 w-5' : 'h-4 w-4'} />
              {t('video.error.retry')}
            </button>
          )}

          <button
            type="button"
            onClick={send}
            disabled={state === 'sending' || state === 'sent'}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border font-medium transition-colors',
              big ? 'px-6 py-3 text-[15px]' : 'px-4 py-2.5 text-[13px]',
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

          {/* Copiar solo donde el diagnóstico está a la vista: en el embed pequeño
              sería un botón que promete unos datos que ahí no se muestran. */}
          {wide && (
            <button
              type="button"
              onClick={copy}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border border-white/15 font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white',
                big ? 'px-6 py-3 text-[15px]' : 'px-4 py-2.5 text-[13px]',
              )}
            >
              {copied ? <Check className="h-4 w-4 text-neon-green" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('video.error.copied') : t('video.error.copy')}
            </button>
          )}
        </div>

        {state === 'sent' && (
          <p className={cn('text-white/45', big ? 'mt-4 text-[13px]' : 'mt-3 text-[11.5px]')}>
            {t('video.error.reported_hint')}
          </p>
        )}

        {/* ── Datos para el pantallazo ──
            El camino real de un reporte es una foto de la pantalla, así que el
            diagnóstico se muestra SIEMPRE y legible, no escondido tras un botón. En
            un embed diminuto no cabe la tabla: ahí queda la línea mínima, que es lo
            único que de verdad no puede faltar. */}
        {tier === 'xs' ? (
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-wider text-white/30">
            {ref} · {err.source} · {err.code}
          </p>
        ) : (
          <div
            className={cn(
              'mx-auto rounded-2xl border border-white/10 bg-white/[0.04] text-left',
              big ? 'mt-8 max-w-2xl p-5' : 'mt-6 p-4',
            )}
          >
            <p
              className={cn(
                'flex items-center gap-2 font-semibold uppercase tracking-wider text-white/40',
                big ? 'text-[12px]' : 'text-[10.5px]',
              )}
            >
              <Camera className={big ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
              {t('video.error.details_title')}
            </p>
            <p className={cn('mt-1 text-white/45', big ? 'text-[13px]' : 'text-[11.5px]')}>
              {t('video.error.screenshot_hint')}
            </p>
            <dl
              className={cn(
                'mt-3 grid gap-x-6 gap-y-1.5',
                wide ? 'grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_1fr]' : 'grid-cols-[auto_1fr]',
              )}
            >
              {details.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt
                    className={cn(
                      'whitespace-nowrap font-medium uppercase tracking-wide text-white/35',
                      big ? 'text-[11.5px]' : 'text-[10.5px]',
                    )}
                  >
                    {k}
                  </dt>
                  {/* El texto libre del proveedor puede venir sin espacios: sin esto
                      rompe el ancho de la tarjeta y el pantallazo sale cortado. */}
                  <dd
                    className={cn(
                      'break-words font-mono text-white/70 [overflow-wrap:anywhere]',
                      big ? 'text-[12.5px]' : 'text-[11px]',
                    )}
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
