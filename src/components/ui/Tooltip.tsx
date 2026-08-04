import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

type Placement = 'top' | 'bottom'

/** Separación entre la punta del cursor y el globo. */
const GAP = 16

/**
 * Tooltip flotante renderizado en un portal a <body>, por lo que NUNCA lo
 * recorta el `overflow-hidden` de una tarjeta contenedora.
 *
 * Sigue al puntero (no al centro del elemento): con un botón ancho, un globo
 * anclado al centro aparece lejos de donde está mirando la persona. Se coloca
 * encima del cursor y baja si no hay espacio arriba, y se recorta contra los
 * bordes de la ventana para no salirse.
 *
 * Sin flecha a propósito: apuntando al cursor no hay a qué apuntar, y el
 * triangulito solo se leía como un pliegue raro debajo del globo.
 *
 * La posición se calcula en `left`/`top` y NO con `transform`: framer-motion
 * escribe su propio `transform` al animar la aparición y borraría cualquier
 * `translate(-50%)` que pusiéramos aquí (era justo el motivo de que el globo
 * saliera descuadrado).
 *
 * `className` va al envoltorio (típicamente `shrink-0` o `min-w-0`, para que
 * dentro de una fila flex no altere cómo encoge el botón que envuelve).
 * `maxWidth` deja que una explicación larga se reparta en varias líneas en vez
 * de irse a lo ancho de la pantalla en una sola.
 */
export function Tooltip({
  label,
  children,
  className = '',
  maxWidth,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
  maxWidth?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  // El puntero dispara muchísimos eventos: se guarda el último y se aplica uno
  // por cuadro, así moverse sobre el botón no provoca cien renders.
  const frame = useRef(0)
  const latest = useRef<{ x: number; y: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; placement: Placement } | null>(null)
  // Tamaño real del globo, para centrarlo y recortarlo contra la ventana. Se
  // mide con offsetWidth/Height (no getBoundingClientRect) porque esos NO
  // cambian con la escala de la animación de entrada.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  const place = (x: number, y: number) => {
    const above = y > 64
    setPos({ x, y: above ? y - GAP : y + GAP + 6, placement: above ? 'top' : 'bottom' })
  }

  const track = (e: ReactMouseEvent) => {
    latest.current = { x: e.clientX, y: e.clientY }
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (latest.current) place(latest.current.x, latest.current.y)
    })
  }

  // Con foco de teclado no hay puntero: ahí sí se ancla al elemento.
  const showAtElement = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) place(r.left + r.width / 2, r.top)
  }

  const hide = () => {
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
    latest.current = null
    setPos(null)
    setSize(null)
  }

  // Corre antes de pintar: el primer cuadro visible ya sale en su sitio.
  useLayoutEffect(() => {
    const el = bubble.current
    if (!pos || !el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (!size || size.w !== w || size.h !== h) setSize({ w, h })
  }, [pos, size, label])

  const half = (size?.w ?? 0) / 2
  const left = pos
    ? size
      ? Math.min(Math.max(pos.x - half, 8), window.innerWidth - size.w - 8)
      : pos.x
    : 0
  const top = pos ? (pos.placement === 'top' ? pos.y - (size?.h ?? 0) : pos.y) : 0

  return (
    <span
      ref={ref}
      onMouseEnter={track}
      onMouseMove={track}
      onMouseLeave={hide}
      onFocus={showAtElement}
      onBlur={hide}
      className={`inline-flex ${className}`}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {pos && label && (
            <motion.span
              key="tt"
              ref={bubble}
              initial={{ opacity: 0, y: pos.placement === 'top' ? 4 : -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.placement === 'top' ? 4 : -4, scale: 0.96 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'fixed',
                left,
                top,
                zIndex: 9999,
                pointerEvents: 'none',
                ...(maxWidth ? { maxWidth, whiteSpace: 'normal', textAlign: 'center' } : {}),
              }}
              className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium leading-tight whitespace-nowrap shadow-lg shadow-black/25 bg-[rgb(var(--text))] text-[rgb(var(--bg))]"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  )
}
