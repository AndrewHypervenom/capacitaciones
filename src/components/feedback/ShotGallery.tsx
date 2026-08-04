import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { FeedbackShot } from '@/services/siteFeedback.service'
import { cn } from '@/lib/cn'

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/* ═══════════════════════════ Miniatura ═══════════════════════════ */

export interface ShotThumbProps {
  shot: FeedbackShot
  /** Lista completa: al abrir el visor se puede pasar de una a otra. */
  shots: FeedbackShot[]
  onRemove?: () => void
  size?: 'sm' | 'md'
}

export function ShotThumb({ shot, shots, onRemove, size = 'sm' }: ShotThumbProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [viewer, setViewer] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const index = Math.max(0, shots.findIndex((s) => s.path === shot.path))

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setViewer(true)}
        whileHover={reduce ? undefined : { y: -3, scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 24 }}
        aria-label={t('site_feedback.shots.open', 'Ver la captura')}
        className={cn(
          'group relative overflow-hidden rounded-xl border border-line bg-subtle',
          size === 'sm' ? 'h-[4.5rem] w-[4.5rem]' : 'h-24 w-32',
        )}
      >
        {/* Fondo mientras carga: evita el parpadeo blanco en tema oscuro */}
        {!loaded && <span className="absolute inset-0 animate-pulse bg-line/60" aria-hidden />}
        <img
          src={shot.url}
          alt={shot.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            'h-full w-full object-cover transition-all duration-500 ease-apple',
            loaded ? 'opacity-100' : 'opacity-0',
            !reduce && 'group-hover:scale-110',
          )}
        />
        {/* Velo con la lupa: solo al pasar por encima, para no ensuciar la rejilla */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="h-4 w-4 text-white" />
        </span>

        {onRemove && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t('site_feedback.shots.remove', 'Quitar la captura')}
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onRemove() } }}
            // Siempre visible en táctil (donde no hay hover) y al pasar en escritorio.
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white opacity-100 backdrop-blur transition-all hover:bg-red-500 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <X className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {viewer && (
          <ShotViewer shots={shots} startAt={index} onClose={() => setViewer(false)} />
        )}
      </AnimatePresence>
    </>
  )
}

/* ═══════════════════════════ Galería ═══════════════════════════ */

/** Fila de miniaturas para las vistas de solo lectura (mis sugerencias, panel). */
export function ShotGallery({ shots, size = 'sm', className }: {
  shots: FeedbackShot[] | null | undefined
  size?: 'sm' | 'md'
  className?: string
}) {
  if (!shots?.length) return null
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {shots.map((s) => (
        <ShotThumb key={s.path} shot={s} shots={shots} size={size} />
      ))}
    </div>
  )
}

/* ═══════════════════════════ Visor ═══════════════════════════ */

/**
 * Visor a pantalla completa: flechas del teclado para moverse, Escape para
 * salir y un zoom de un toque para leer la letra pequeña de una captura.
 */
function ShotViewer({ shots, startAt, onClose }: {
  shots: FeedbackShot[]
  startAt: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [i, setI] = useState(startAt)
  const [dir, setDir] = useState(0)
  const [zoom, setZoom] = useState(false)
  const shot = shots[i]

  const go = useCallback((delta: number) => {
    setDir(delta)
    setZoom(false)
    setI((cur) => (cur + delta + shots.length) % shots.length)
  }, [shots.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && shots.length > 1) go(1)
      else if (e.key === 'ArrowLeft' && shots.length > 1) go(-1)
    }
    window.addEventListener('keydown', onKey)
    // El fondo no debe scrollear detrás del visor.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [go, onClose, shots.length])

  if (!shot) return null

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      // Por encima del panel de opiniones (9992) y de todo lo demás.
      className="fixed inset-0 z-[9999] flex flex-col bg-black/92 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={shot.name}
    >
      {/* ── Barra superior ── */}
      <div
        className="flex shrink-0 items-center gap-3 px-4 py-3 text-white/85"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{shot.name}</p>
          <p className="text-[11px] text-white/50">
            {shot.w}×{shot.h} · {prettySize(shot.size)}
            {shots.length > 1 && ` · ${i + 1}/${shots.length}`}
          </p>
        </div>
        <IconBtn
          label={zoom ? t('site_feedback.shots.zoom_out', 'Alejar') : t('site_feedback.shots.zoom_in', 'Acercar')}
          onClick={() => setZoom((z) => !z)}
        >
          {zoom ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
        </IconBtn>
        <IconBtn label={t('site_feedback.shots.download', 'Descargar')} href={shot.url}>
          <Download className="h-4 w-4" />
        </IconBtn>
        <IconBtn label={t('site_feedback.close', 'Cerrar')} onClick={onClose}>
          <X className="h-4 w-4" />
        </IconBtn>
      </div>

      {/* ── Imagen ── */}
      <div className={cn('relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-14', zoom && 'overflow-auto')}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.img
            key={shot.path}
            src={shot.url}
            alt={shot.name}
            custom={dir}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -40, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => { e.stopPropagation(); setZoom((z) => !z) }}
            className={cn(
              'rounded-lg shadow-2xl shadow-black/60',
              zoom
                ? 'max-w-none cursor-zoom-out'
                : 'max-h-full max-w-full cursor-zoom-in object-contain',
            )}
            style={zoom ? { width: shot.w } : undefined}
          />
        </AnimatePresence>

        {shots.length > 1 && (
          <>
            <NavBtn side="left" label={t('site_feedback.shots.prev', 'Anterior')} onClick={() => go(-1)}>
              <ChevronLeft className="h-5 w-5" />
            </NavBtn>
            <NavBtn side="right" label={t('site_feedback.shots.next', 'Siguiente')} onClick={() => go(1)}>
              <ChevronRight className="h-5 w-5" />
            </NavBtn>
          </>
        )}
      </div>

      {/* ── Puntos de posición ── */}
      {shots.length > 1 && (
        <div className="flex shrink-0 justify-center gap-1.5 pb-5" onClick={(e) => e.stopPropagation()}>
          {shots.map((s, n) => (
            <button
              key={s.path}
              onClick={() => { setDir(n > i ? 1 : -1); setZoom(false); setI(n) }}
              aria-label={`${n + 1}`}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                n === i ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60',
              )}
            />
          ))}
        </div>
      )}
    </motion.div>,
    document.body,
  )
}

function IconBtn({ label, onClick, href, children }: {
  label: string
  onClick?: () => void
  href?: string
  children: React.ReactNode
}) {
  const cls = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20'
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" download aria-label={label} title={label} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cls}>
      {children}
    </button>
  )
}

function NavBtn({ side, label, onClick, children }: {
  side: 'left' | 'right'
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
      className={cn(
        'absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-all hover:bg-white/25',
        side === 'left' ? 'left-1 sm:left-4' : 'right-1 sm:right-4',
      )}
    >
      {children}
    </button>
  )
}
