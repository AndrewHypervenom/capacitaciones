import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

type Placement = 'top' | 'bottom'

/**
 * Tooltip flotante renderizado en un portal a <body>, por lo que NUNCA lo
 * recorta el `overflow-hidden` de una tarjeta contenedora. Se coloca arriba del
 * trigger y voltea abajo si no hay espacio. Animación sutil de aparición.
 */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; placement: Placement } | null>(null)

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const preferTop = r.top > 52
    setPos({
      x: r.left + r.width / 2,
      y: preferTop ? r.top - 8 : r.bottom + 8,
      placement: preferTop ? 'top' : 'bottom',
    })
  }
  const hide = () => setPos(null)

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="inline-flex"
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {pos && label && (
            <motion.span
              key="tt"
              initial={{ opacity: 0, y: pos.placement === 'top' ? 4 : -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.placement === 'top' ? 4 : -4, scale: 0.96 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                transform: pos.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
                zIndex: 9999,
                pointerEvents: 'none',
              }}
              className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium leading-tight whitespace-nowrap shadow-lg shadow-black/25 bg-[rgb(var(--text))] text-[rgb(var(--bg))]"
            >
              {label}
              <span
                aria-hidden
                className="absolute left-1/2 -translate-x-1/2 border-[5px] border-transparent"
                style={
                  pos.placement === 'top'
                    ? { top: '100%', borderTopColor: 'rgb(var(--text))' }
                    : { bottom: '100%', borderBottomColor: 'rgb(var(--text))' }
                }
              />
            </motion.span>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  )
}
