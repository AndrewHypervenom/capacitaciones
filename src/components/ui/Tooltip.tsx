import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

type Placement = 'top' | 'bottom'

/** Separación entre el punto de anclaje y el globo. */
const GAP = 16

/**
 * Cuánto hay que quedarse quieto encima antes de que aparezca. Sin espera, pasar
 * el ratón por una barra de seis botones dispara seis globos en un segundo: el
 * tooltip deja de ser ayuda y pasa a ser ruido que persigue al cursor.
 */
const OPEN_DELAY = 340

/**
 * Ventana de gracia. Si acabas de ver un tooltip, el siguiente sale al instante:
 * ya demostraste que estás explorando la barra, y volver a hacerte esperar en
 * cada botón es justo lo que hace que se sienta lenta.
 */
const GRACE = 500

/** Pulsación larga en pantalla táctil: ahí no hay "pasar por encima". */
const TOUCH_HOLD = 380

/** Última vez que un tooltip estuvo visible, compartida por todos (ver GRACE). */
let lastShownAt = 0

/**
 * Tooltip flotante renderizado en un portal a <body>, por lo que NUNCA lo
 * recorta el `overflow-hidden` de una tarjeta contenedora.
 *
 * Cómo se comporta, y por qué:
 *
 * ─ Espera antes de abrir (`OPEN_DELAY`) y se abre al instante si vienes de otro
 *   tooltip (`GRACE`): explorar una barra es fluido, pero pasar de largo no
 *   dispara nada.
 * ─ Sigue al puntero (con un botón ancho, un globo anclado al centro aparece
 *   lejos de donde estás mirando). Con `anchor="element"` se ancla al elemento:
 *   es lo que quiere el contenido rico, que moviéndose marea.
 * ─ Con foco de teclado no hay puntero, así que ahí siempre se ancla al elemento.
 *   Escape lo cierra, y hacer scroll también — un globo quieto sobre una página
 *   que se mueve señala a un sitio que ya no es.
 * ─ En táctil aparece con pulsación larga y se va al levantar el dedo. No se
 *   cancela el toque: el botón sigue haciendo lo suyo.
 * ─ Respeta `prefers-reduced-motion`.
 *
 * Sin flecha a propósito: apuntando al cursor no hay a qué apuntar, y el
 * triangulito solo se leía como un pliegue raro debajo del globo.
 *
 * La posición se calcula en `left`/`top` y NO con `transform`: framer-motion
 * escribe su propio `transform` al animar la aparición y borraría cualquier
 * `translate(-50%)` que pusiéramos aquí (era justo el motivo de que el globo
 * saliera descuadrado).
 *
 * Accesibilidad: el globo va `aria-hidden`. Casi siempre envuelve un botón que
 * ya tiene su `aria-label`, y anunciar dos veces lo mismo es peor que no
 * anunciarlo. Si el tooltip dice algo que el disparador NO dice, pásale
 * `describedBy` y se expone como descripción.
 */
export function Tooltip({
  label,
  children,
  className = '',
  maxWidth,
  anchor = 'cursor',
  variant = 'invert',
  shortcut,
  delay = OPEN_DELAY,
  disabled = false,
  describedBy = false,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
  /** Reparte una explicación larga en varias líneas en vez de una tira. */
  maxWidth?: number
  /** `cursor` sigue al puntero; `element` se queda quieto sobre el disparador. */
  anchor?: 'cursor' | 'element'
  /** `invert` para etiquetas cortas; `panel` para contenido con caras o formato. */
  variant?: 'invert' | 'panel'
  /** Atajo de teclado, en su propia tecla al final del globo. */
  shortcut?: string
  /** Espera antes de abrir. 0 para lo que debe salir ya (un error, un aviso). */
  delay?: number
  /** Apaga el tooltip sin tener que sacar el envoltorio del árbol. */
  disabled?: boolean
  /** Expón el texto a lectores de pantalla (solo si el disparador no lo dice). */
  describedBy?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const id = useId()

  // El puntero dispara muchísimos eventos: se guarda el último y se aplica uno
  // por cuadro, así moverse sobre el botón no provoca cien renders.
  const frame = useRef(0)
  const latest = useRef<{ x: number; y: number } | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; placement: Placement } | null>(null)
  // Tamaño real del globo, para centrarlo y recortarlo contra la ventana. Se
  // mide con offsetWidth/Height (no getBoundingClientRect) porque esos NO
  // cambian con la escala de la animación de entrada.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  // Con algo en pantalla completa, el navegador SOLO pinta ese subárbol: un
  // portal a <body> existe en el DOM pero es invisible. Por eso el destino del
  // portal sigue al elemento en pantalla completa (el reproductor de video) y
  // vuelve a <body> al salir.
  const [fsHost, setFsHost] = useState<Element | null>(null)
  useEffect(() => {
    const sync = () => setFsHost(document.fullscreenElement)
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const place = useCallback((x: number, y: number) => {
    // Arriba salvo que no quepa: cerca del techo de la ventana el globo se
    // saldría de la pantalla, y ahí es mejor taparle un poco menos y bajarlo.
    const above = y > 72
    setPos({ x, y: above ? y - GAP : y + GAP + 6, placement: above ? 'top' : 'bottom' })
  }, [])

  /** Centro superior del disparador: el ancla cuando no hay puntero. */
  const placeAtElement = useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) place(r.left + r.width / 2, r.top)
  }, [place])

  const clearOpenTimer = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }

  const hide = useCallback(() => {
    clearOpenTimer()
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
    latest.current = null
    setPos((cur) => {
      if (cur) lastShownAt = Date.now()
      return null
    })
    setSize(null)
  }, [])

  /** Programa la apertura respetando la espera (y la gracia entre vecinos). */
  const scheduleOpen = useCallback((show: () => void) => {
    if (disabled) return
    clearOpenTimer()
    const warm = Date.now() - lastShownAt < GRACE
    if (warm || delay === 0) { show(); return }
    openTimer.current = setTimeout(() => { openTimer.current = null; show() }, delay)
  }, [delay, disabled])

  /**
   * Ya pulsaste: mientras no salgas del botón, no vuelve a salir el globo.
   * Explicarte lo que acabas de hacer es el momento en que el tooltip estorba —
   * y encima tapa el sitio donde estás mirando el resultado.
   */
  const muted = useRef(false)

  const onPointerEnter = (e: ReactPointerEvent) => {
    if (e.pointerType === 'touch' || disabled) return
    latest.current = { x: e.clientX, y: e.clientY }
    scheduleOpen(() => {
      if (anchor === 'element' || !latest.current) placeAtElement()
      else place(latest.current.x, latest.current.y)
    })
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (e.pointerType === 'touch' || disabled || muted.current) return
    latest.current = { x: e.clientX, y: e.clientY }
    // Mientras el globo no esté abierto, el puntero solo actualiza dónde saldría;
    // una vez abierto, y solo si sigue al cursor, se mueve con él.
    if (!pos) {
      scheduleOpen(() => {
        const p = latest.current
        if (!p) return
        if (anchor === 'element') placeAtElement()
        else place(p.x, p.y)
      })
      return
    }
    if (anchor === 'element') return
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (latest.current) place(latest.current.x, latest.current.y)
    })
  }

  // Pulsación larga en táctil. No se cancela el toque a propósito: el botón que
  // hay debajo tiene que seguir funcionando de un dedazo normal.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || disabled) return
    clearOpenTimer()
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      placeAtElement()
    }, TOUCH_HOLD)
  }

  // Escape cierra y el scroll también: un globo colocado contra la ventana se
  // queda señalando un sitio que ya no es el del elemento.
  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [pos, hide])

  // Nada de temporizadores vivos cuando el botón se va de la pantalla.
  useEffect(() => () => clearOpenTimer(), [])

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
  const open = !!pos && !!label && !disabled

  return (
    <span
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerDown={(e) => {
        // Con ratón el globo se va en el clic, no al soltar: pulsar ya es haber
        // decidido, y el globo estaría tapando lo que va a pasar.
        if (e.pointerType !== 'touch') { muted.current = true; hide() }
        onPointerDown(e)
      }}
      onPointerUp={hide}
      onPointerLeave={() => { muted.current = false; hide() }}
      onPointerCancel={() => { muted.current = false; hide() }}
      onFocus={() => scheduleOpen(placeAtElement)}
      onBlur={hide}
      aria-describedby={describedBy && open ? id : undefined}
      className={`inline-flex ${className}`}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.span
              key="tt"
              ref={bubble}
              id={id}
              role="tooltip"
              aria-hidden={!describedBy}
              initial={reduce
                ? { opacity: 0 }
                : { opacity: 0, y: pos.placement === 'top' ? 4 : -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce
                ? { opacity: 0 }
                : { opacity: 0, y: pos.placement === 'top' ? 4 : -4, scale: 0.96 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'fixed',
                left,
                top,
                zIndex: 9999,
                pointerEvents: 'none',
                ...(maxWidth ? { maxWidth, whiteSpace: 'normal' } : {}),
              }}
              className={
                variant === 'panel'
                  // Para contenido con caras y varias líneas: el fondo invertido
                  // convierte cualquier avatar en un recorte con halo.
                  ? 'rounded-xl border border-line bg-surface px-3 py-2 text-[11.5px] leading-snug text-text shadow-xl shadow-black/25'
                  : 'inline-flex items-center gap-1.5 rounded-lg bg-[rgb(var(--text))] px-2.5 py-1.5 text-[11.5px] font-medium leading-tight text-[rgb(var(--bg))] shadow-lg shadow-black/25'
              }
            >
              <span className={maxWidth && variant !== 'panel' ? 'block text-center' : undefined}>
                {label}
              </span>
              {shortcut && (
                // El atajo como tecla y no como texto: se reconoce sin leerlo, y
                // deja de competir con la frase que explica qué hace el botón.
                <kbd
                  className={
                    variant === 'panel'
                      ? 'ml-1.5 rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted'
                      : 'ml-0.5 shrink-0 rounded bg-[rgb(var(--bg))]/20 px-1.5 py-0.5 font-mono text-[10px]'
                  }
                >
                  {shortcut}
                </kbd>
              )}
            </motion.span>
          )}
        </AnimatePresence>,
        fsHost ?? document.body,
      )}
    </span>
  )
}
