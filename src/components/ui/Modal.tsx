/**
 * El chasis de los modales del sitio.
 *
 * El problema que resuelve: los modales escritos a mano crecían con su contenido
 * hasta pasarse de la pantalla. El encabezado quedaba arriba fuera de vista, los
 * botones de Cancelar/Guardar caían por debajo del borde y había que desplazar la
 * PÁGINA entera para llegar a ellos. En pantallas de portátil, un formulario con
 * tres avisos ya no cabía.
 *
 * Aquí el panel nunca pasa de `max-h`: el encabezado y el pie quedan SIEMPRE a la
 * vista y lo único que se desplaza es el cuerpo, con dos degradados que aparecen
 * en los bordes solo cuando queda contenido por ver (así se sabe que hay más sin
 * tener que adivinar).
 *
 * Se monta por portal en <body> a propósito: dentro de un ancestro con `transform`
 * (cualquier animación de Motion) un `fixed` se ancla a ESE elemento y el modal
 * aparece descuadrado. Ver la trampa de Reveal + fixed.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ease } from '@/components/ui/motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import i18n from '@/i18n'

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
} as const

interface Props {
  onClose: () => void
  title: ReactNode
  /** Una línea bajo el título. Si el texto es largo, va en el cuerpo. */
  subtitle?: ReactNode
  /** Ícono del encabezado; se dibuja en una pastilla con el acento del modal. */
  icon?: ReactNode
  /** Acento del ícono y del filo superior. */
  accent?: 'violet' | 'green' | 'neutral'
  size?: keyof typeof WIDTHS
  /** Barra de acciones fija abajo. Lo que va a la derecha. */
  footer?: ReactNode
  /** Zona izquierda del pie: notas, contadores, avisos de una línea. */
  footerLeft?: ReactNode
  /** `false` mientras hay una operación en curso: no se cierra por fondo ni Esc. */
  dismissible?: boolean
  /** Por encima de otros modales cuando uno abre a otro. */
  z?: number
  className?: string
  children: ReactNode
}

export function Modal({
  onClose, title, subtitle, icon, accent = 'neutral', size = 'md',
  footer, footerLeft, dismissible = true, z = 80, className, children,
}: Props) {
  const reduce = useReducedMotion()
  const backdrop = useBackdropDismiss(onClose, dismissible)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Degradados de borde: solo cuando de verdad hay contenido oculto.
  const [shade, setShade] = useState({ top: false, bottom: false })

  useEffect(() => {
    if (!dismissible) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismissible, onClose])

  // La página de atrás no debe desplazarse mientras el modal está abierto: si lo
  // hace, al cerrar uno aparece en otro punto del listado.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => setShade({
      top: el.scrollTop > 4,
      bottom: el.scrollHeight - el.clientHeight - el.scrollTop > 4,
    })
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', measure); ro.disconnect() }
  }, [])

  const accentRing = accent === 'violet'
    ? 'bg-brand-violet/12 text-brand-violet ring-brand-violet/20'
    : accent === 'green'
      ? 'bg-brand-green/12 text-brand-green ring-brand-green/20'
      : 'bg-glass/10 text-text-muted ring-glass-border/20'

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-6"
      style={{ zIndex: z }}
      {...backdrop}
    >
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
        aria-hidden
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.34, ease }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-glass-lg',
          // El techo es lo que impide que el modal se salga de la pantalla.
          'max-h-[min(86vh,880px)]',
          WIDTHS[size],
          className,
        )}
      >
        {/* Filo superior de color: da identidad sin robar altura. */}
        {accent !== 'neutral' && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 h-px',
              accent === 'violet'
                ? 'bg-gradient-to-r from-transparent via-brand-violet/60 to-transparent'
                : 'bg-gradient-to-r from-transparent via-brand-green/60 to-transparent',
            )}
          />
        )}

        {/* ── Encabezado (siempre visible) ── */}
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3.5 pt-4">
          {icon && (
            <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1', accentRing)}>
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold leading-tight tracking-[-0.01em] text-text">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px] leading-snug text-text-muted">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={i18n.t('common.close', 'Cerrar')}
            className="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-subtle transition-colors hover:bg-glass/8 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Cuerpo: lo ÚNICO que se desplaza ── */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={bodyRef}
            className="h-full overflow-y-auto overscroll-contain px-5 pb-4 pt-0.5"
          >
            {children}
          </div>
          {/* "Hay más arriba / abajo": se desvanece el contenido, no se corta. */}
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-bg to-transparent transition-opacity duration-200',
              shade.top ? 'opacity-100' : 'opacity-0',
            )}
          />
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-bg to-transparent transition-opacity duration-200',
              shade.bottom ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>

        {/* ── Pie de acciones (siempre visible) ── */}
        {(footer || footerLeft) && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-line/70 bg-surface/40 px-5 py-3">
            {/* `min-w` a propósito: un aviso largo baja a su propia línea en vez
                de estrujarse en una columna de cuatro renglones junto a los
                botones. */}
            {footerLeft && (
              <div className="min-w-[15rem] flex-1 text-[11px] leading-snug text-text-subtle">{footerLeft}</div>
            )}
            <div className="flex shrink-0 items-center gap-2">{footer}</div>
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  )
}
