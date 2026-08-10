import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft, ChevronRight, Download, Maximize2, RotateCw, X, ZoomIn, ZoomOut,
} from 'lucide-react'
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

const MIN_SCALE = 1     // 1 = la imagen entera en pantalla
const MAX_SCALE = 8
const STEP = 1.4

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Visor a pantalla completa con zoom de verdad: rueda del ratón, pinza en
 * táctil, doble clic, arrastre para pasear la imagen, rotar y volver a
 * encajarla. El teclado maneja todo: ← → cambian de captura (o pasean si hay
 * zoom), + − ajustan el zoom, 0 encaja, R rota y Escape sale.
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
  const [scale, setScale] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [rot, setRot] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pinching, setPinching] = useState(false)
  /** Ancho al que la captura queda encajada: base para el % y el 1:1. */
  const [baseW, setBaseW] = useState(0)

  const frameRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  /** Punteros activos: uno arrastra, dos hacen pinza. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; scale: number; off: { x: number; y: number } } | null>(null)
  const dragFrom = useRef<{ x: number; y: number; off: { x: number; y: number }; moved: boolean; onImg: boolean } | null>(null)

  const shot = shots[i]
  /** Escala a la que la captura se ve a 1:1 (píxel real); si ya cabe, un 2×. */
  const actualScale = baseW && shot ? clamp(shot.w / baseW, 2, MAX_SCALE) : 2

  const reset = useCallback(() => {
    setScale(1)
    setOff({ x: 0, y: 0 })
    setRot(0)
  }, [])

  const go = useCallback((delta: number) => {
    setDir(delta)
    reset()
    setI((cur) => (cur + delta + shots.length) % shots.length)
  }, [reset, shots.length])

  /** Centro del área visible, para medir el cursor y el zoom. */
  const frameCenter = useCallback(() => {
    const r = frameRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, [])

  /**
   * Zoom conservando bajo el cursor el punto de la imagen que estaba ahí.
   * Sin un ancla se usa el centro, que es lo que esperan los botones.
   */
  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const target = clamp(next, MIN_SCALE, MAX_SCALE)
    setScale((cur) => {
      if (target === cur) return cur
      const c = frameCenter()
      const ax = (anchor?.x ?? c.x) - c.x
      const ay = (anchor?.y ?? c.y) - c.y
      const k = target / cur
      setOff((o) => (target === MIN_SCALE
        ? { x: 0, y: 0 }
        : { x: ax - k * (ax - o.x), y: ay - k * (ay - o.y) }))
      return target
    })
  }, [frameCenter])

  /* ── Teclado ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const zoomed = scale > 1
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(scale * STEP); return }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(scale / STEP); return }
      if (e.key === '0') { reset(); return }
      if (e.key === 'r' || e.key === 'R') { setRot((r) => (r + 90) % 360); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const sign = e.key === 'ArrowRight' ? 1 : -1
        if (zoomed) { e.preventDefault(); setOff((o) => ({ ...o, x: o.x - sign * 60 })) }
        else if (shots.length > 1) go(sign)
        return
      }
      if (zoomed && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const sign = e.key === 'ArrowDown' ? 1 : -1
        setOff((o) => ({ ...o, y: o.y - sign * 60 }))
      }
    }
    window.addEventListener('keydown', onKey)
    // El fondo no debe scrollear detrás del visor.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [go, onClose, reset, scale, shots.length, zoomTo])

  /* ── El encaje cambia con la ventana: hay que volver a medirlo ── */
  useEffect(() => {
    const img = imgRef.current
    if (!img || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBaseW(img.clientWidth))
    ro.observe(img)
    return () => ro.disconnect()
  }, [i])

  /* ── Rueda del ratón: siempre zoom, nunca scroll de la página ── */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0022)
      zoomTo(scale * factor, { x: e.clientX, y: e.clientY })
    }
    // `passive: false` es lo único que permite cancelar el scroll del navegador.
    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [scale, zoomTo])

  /* ── Arrastre y pinza ── */
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale, off }
      dragFrom.current = null
      setPinching(true)
      return
    }
    if (pointers.current.size === 1) {
      // Con captura el `pointerup` llega al marco, así que el objetivo real se
      // anota aquí: sobre la imagen alterna el zoom, sobre el fondo cierra.
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      dragFrom.current = { x: e.clientX, y: e.clientY, off, moved: false, onImg: e.target === imgRef.current }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const c = frameCenter()
      const target = clamp(gesture.current.scale * (dist / gesture.current.dist), MIN_SCALE, MAX_SCALE)
      const k = target / gesture.current.scale
      const ax = mid.x - c.x
      const ay = mid.y - c.y
      setScale(target)
      setOff(target === MIN_SCALE
        ? { x: 0, y: 0 }
        : { x: ax - k * (ax - gesture.current.off.x), y: ay - k * (ay - gesture.current.off.y) })
      return
    }

    const from = dragFrom.current
    if (!from || scale <= 1) return
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (!from.moved && Math.hypot(dx, dy) > 3) { from.moved = true; setDragging(true) }
    if (from.moved) setOff({ x: from.off.x + dx, y: from.off.y + dy })
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) { gesture.current = null; setPinching(false) }
    if (pointers.current.size === 0) {
      const from = dragFrom.current
      dragFrom.current = null
      setDragging(false)
      if (from && !from.moved) {
        // Clic limpio: en la imagen acerca o vuelve al encaje; fuera, cierra.
        if (from.onImg) {
          if (scale > MIN_SCALE) reset()
          else zoomTo(actualScale, { x: e.clientX, y: e.clientY })
        } else onClose()
      }
    }
  }

  if (!shot) return null

  /** Zoom mostrado respecto al tamaño real de la captura, no al encaje. */
  const percent = baseW && shot.w ? Math.round((scale * baseW * 100) / shot.w) : Math.round(scale * 100)

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      // Por encima del panel de opiniones (9992) y también de lo que vive en la
      // esquina superior derecha en 9999 (avisos, presencia): ahí van los botones.
      className="fixed inset-0 z-[10000] flex flex-col bg-black/92 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={shot.name}
    >
      {/* ── Barra superior: el texto se recorta y los botones nunca se salen ── */}
      <div
        className="relative z-10 flex shrink-0 items-start gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white/85 sm:gap-3 sm:px-4"
        style={{ paddingRight: 'max(0.75rem, env(safe-area-inset-right))' }}
      >
        <div className="mt-1 min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{shot.name}</p>
          <p className="truncate text-[11px] text-white/50">
            {shot.w}×{shot.h} · {prettySize(shot.size)}
            {shots.length > 1 && ` · ${i + 1}/${shots.length}`}
          </p>
        </div>

        {/* Grupo de zoom: una sola píldora para que no se amontonen los círculos */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/10 p-0.5 backdrop-blur">
          <IconBtn
            label={t('site_feedback.shots.zoom_out', 'Alejar')}
            onClick={() => zoomTo(scale / STEP)}
            disabled={scale <= MIN_SCALE}
            bare
          >
            <ZoomOut className="h-4 w-4" />
          </IconBtn>
          <button
            type="button"
            onClick={() => (scale === MIN_SCALE ? zoomTo(actualScale) : reset())}
            title={t('site_feedback.shots.fit', 'Encajar en pantalla')}
            className="min-w-[3.25rem] rounded-full px-1 text-center text-[11px] font-semibold tabular-nums text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            {percent}%
          </button>
          <IconBtn
            label={t('site_feedback.shots.zoom_in', 'Acercar')}
            onClick={() => zoomTo(scale * STEP)}
            disabled={scale >= MAX_SCALE}
            bare
          >
            <ZoomIn className="h-4 w-4" />
          </IconBtn>
        </div>

        {/* Nada de un botón de "pantalla completa": el visor ya lo está. Encajar
            vive en el porcentaje de la píldora y en la tecla 0. */}
        <IconBtn label={t('site_feedback.shots.rotate', 'Rotar')} onClick={() => setRot((r) => (r + 90) % 360)}>
          <RotateCw className="h-4 w-4" />
        </IconBtn>
        <IconBtn label={t('site_feedback.shots.download', 'Descargar')} href={shot.url} className="hidden sm:flex">
          <Download className="h-4 w-4" />
        </IconBtn>
        <IconBtn label={t('site_feedback.close', 'Cerrar')} onClick={onClose}>
          <X className="h-4 w-4" />
        </IconBtn>
      </div>

      {/* ── Imagen ── */}
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden px-2 pb-4 sm:px-14"
      >
        {/* La animación de entrada va en el envoltorio: si Motion escribiera el
            `transform` de la imagen, se comería el zoom y el arrastre. */}
        <motion.div
          key={shot.path}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="flex h-full w-full items-center justify-center"
        >
          <img
            ref={imgRef}
            src={shot.url}
            alt={shot.name}
            draggable={false}
            onLoad={(e) => setBaseW(e.currentTarget.clientWidth)}
            className={cn(
              'max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl shadow-black/60',
              dragging ? 'cursor-grabbing' : scale > MIN_SCALE ? 'cursor-grab' : 'cursor-zoom-in',
            )}
            style={{
              // El translate va primero: así el arrastre se mide en píxeles de pantalla.
              transform: `translate3d(${off.x}px, ${off.y}px, 0) scale(${scale}) rotate(${rot}deg)`,
              transition: dragging || pinching ? 'none' : 'transform 180ms cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        </motion.div>

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
        <div className="flex shrink-0 justify-center gap-1.5 pb-5">
          {shots.map((s, n) => (
            <button
              key={s.path}
              onClick={() => { setDir(n > i ? 1 : -1); reset(); setI(n) }}
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

function IconBtn({ label, onClick, href, disabled, bare, className, children }: {
  label: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  /** Dentro de un grupo ya con fondo: sin píldora propia. */
  bare?: boolean
  className?: string
  children: React.ReactNode
}) {
  const cls = cn(
    'flex shrink-0 items-center justify-center rounded-full text-white transition-colors',
    bare ? 'h-8 w-8 hover:bg-white/15' : 'h-9 w-9 bg-white/10 backdrop-blur hover:bg-white/20',
    disabled && 'pointer-events-none opacity-35',
    className,
  )
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" download aria-label={label} title={label} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={cls}>
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
      onPointerDown={(e) => e.stopPropagation()}
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
