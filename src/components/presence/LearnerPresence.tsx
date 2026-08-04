import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useOnlineLearners } from '@/hooks/usePresence'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { shortName, type Peer } from '@/stores/presenceStore'
import { ease } from '@/components/ui/motion'
import { cn } from '@/lib/cn'

/* ────────────────────────────────────────────────────────────────────────
   "Hay más gente aquí" — presencia para el APRENDIZ.

   Estudiar solo desanima; ver que otros están conectados en este momento es
   compañía, y eso basta. Por eso esta pieza es deliberadamente pobre en datos:
   muestra CARAS y NOMBRE CORTO ("Andres F."), nunca qué módulo lleva cada
   quien, cuánto ha avanzado ni dónde está en el sitio. El recorte no es de
   pantalla (que se olvida): los datos ya llegan vacíos desde el store
   (`redactForViewer`), así que aquí no hay nada que se pueda filtrar por
   descuido.

   Y es discreta por diseño: si no hay nadie más en línea, no existe — ningún
   "0 en línea" recordándole al aprendiz que está solo.
   ──────────────────────────────────────────────────────────────────────── */

/** Cuántas caras se apilan en la barra antes del "+N". */
const STACK_MAX = 3
/** Cuántas personas se listan en el panel antes de resumir el resto. */
const LIST_MAX = 8

const PANEL_W = 236

const GREEN = '#10D451'

/** Punto verde que respira. El latido es la única señal de "en vivo" que hace falta. */
function LiveDot({ size = 6, className }: { size?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <span
      className={cn('relative inline-flex shrink-0 rounded-full', className)}
      style={{ width: size, height: size, background: GREEN }}
    >
      {!reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: GREEN }}
          animate={{ scale: [1, 2.4], opacity: [0.5, 0] }}
          transition={{ duration: 2.2, ease: 'easeOut', repeat: Infinity, repeatDelay: 0.6 }}
        />
      )}
    </span>
  )
}

/** Cara circular con anillo del color estable de la persona. */
function Face({ peer, size }: { peer: Peer; size: number }) {
  return (
    <span
      className="relative block rounded-full ring-2 ring-bg"
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: `0 0 0 1.5px ${peer.color}` }}
      />
      <span
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-full font-bold uppercase text-white select-none"
        style={{
          background: peer.avatar_url ? undefined : peer.color,
          fontSize: Math.round(size * 0.42),
        }}
      >
        {peer.avatar_url ? (
          <img
            src={peer.avatar_url}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          (peer.name || '?').trim().charAt(0) || '?'
        )}
      </span>
    </span>
  )
}

/**
 * Punto de entrada: si no hay nadie más en línea, aquí no hay nada que mostrar.
 *
 * La píldora vive en un componente aparte a propósito: al quedarse solo el
 * aprendiz, ese componente se desmonta y con él se va el estado de "panel
 * abierto". Si el estado viviera aquí, al reconectarse alguien más tarde el
 * panel reaparecería abierto solo, sin que nadie lo haya pedido.
 */
export function LearnerPresence({ className }: { className?: string }) {
  const peers = useOnlineLearners()
  return (
    <AnimatePresence initial={false}>
      {peers.length > 0 && <PresencePill key="learner-presence" peers={peers} className={className} />}
    </AnimatePresence>
  )
}

/**
 * Píldora de la barra superior: caras apiladas + cuántos hay. Al pulsarla se
 * abre el panel con los nombres cortos.
 */
function PresencePill({ peers, className }: { peers: Peer[]; className?: string }) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const visible = peers.slice(0, STACK_MAX)
  const overflow = peers.length - visible.length

  return (
    <motion.div
      layout
      initial={reduce ? false : { opacity: 0, scale: 0.8, width: 0 }}
      animate={{ opacity: 1, scale: 1, width: 'auto' }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, width: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className={cn('overflow-hidden', className)}
    >
      <motion.button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileHover={reduce ? undefined : { scale: 1.04 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
        aria-expanded={open}
        aria-label={t('presence.learners.aria', { count: peers.length })}
        className={cn(
          'group inline-flex h-8 items-center gap-1.5 rounded-full pl-1 pr-2 transition-colors',
          open ? 'bg-subtle' : 'hover:bg-subtle',
        )}
      >
        <span className="flex items-center">
          <AnimatePresence initial={false}>
            {visible.map((peer, idx) => (
              <motion.span
                key={peer.user_id}
                layout
                initial={reduce ? false : { opacity: 0, scale: 0.3, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.3, filter: 'blur(4px)' }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="relative block"
                style={{ marginLeft: idx === 0 ? 0 : -7, zIndex: STACK_MAX - idx }}
              >
                <Face peer={peer} size={22} />
              </motion.span>
            ))}
          </AnimatePresence>
          {overflow > 0 && (
            <motion.span
              layout
              className="relative z-0 -ml-[7px] flex items-center justify-center rounded-full ring-2 ring-bg glass-strong text-[9px] font-semibold text-text-muted"
              style={{ width: 22, height: 22 }}
            >
              +{overflow}
            </motion.span>
          )}
        </span>
        <LiveDot />
        {/* El número solo en pantallas anchas: en móvil las caras ya lo dicen. */}
        <span className="hidden md:inline text-[12px] tabular-nums text-text-muted group-hover:text-text transition-colors">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={peers.length}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease }}
              className="inline-block"
            >
              {peers.length}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.button>

      <LearnerPresencePanel
        open={open}
        peers={peers}
        anchor={btnRef}
        onClose={() => setOpen(false)}
      />
    </motion.div>
  )
}

/**
 * Panel flotante con los nombres cortos. Va en un portal sobre <body> porque la
 * barra superior tiene `overflow-x-hidden` y lo recortaría.
 */
function LearnerPresencePanel({
  open,
  peers,
  anchor,
  onClose,
}: {
  open: boolean
  peers: Peer[]
  anchor: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Se ancla al botón y se recalcula si la ventana cambia de tamaño. La barra es
  // sticky, así que el scroll de la página no lo mueve.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      setPos({
        top: r.bottom + 10,
        left: Math.min(
          Math.max(8, r.left + r.width / 2 - PANEL_W / 2),
          window.innerWidth - PANEL_W - 8,
        ),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const listed = peers.slice(0, LIST_MAX)
  const rest = peers.length - listed.length

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <>
          {/* Capa para cerrar al pulsar fuera; invisible y sin oscurecer nada:
              esto es un detalle al margen, no un modal que reclame la pantalla. */}
          <div className="fixed inset-0 z-[9998]" onClick={onClose} />

          <motion.div
            role="dialog"
            aria-label={t('presence.learners.title')}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{ top: pos.top, left: pos.left, width: PANEL_W }}
            className="fixed z-[9999] origin-top overflow-hidden rounded-2xl glass-strong shadow-2xl"
          >
            {/* Destello que cruza el borde superior al abrir: un guiño, una vez. */}
            {!reduce && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${GREEN}, transparent)`,
                }}
                initial={{ x: '-100%', opacity: 0 }}
                animate={{ x: '100%', opacity: [0, 1, 0] }}
                transition={{ duration: 1.1, ease, delay: 0.05 }}
              />
            )}

            <div className="px-3 pt-2.5 pb-2">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
                <LiveDot size={5} />
                {t('presence.learners.title')}
              </p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-text-muted">
                {t('presence.learners.subtitle', { count: peers.length })}
              </p>
            </div>

            <motion.ul
              className="max-h-64 overflow-y-auto px-1.5 pb-1.5"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.06 } } }}
            >
              <AnimatePresence initial={false}>
                {listed.map((peer) => (
                  <motion.li
                    key={peer.user_id}
                    layout
                    variants={{
                      hidden: reduce ? {} : { opacity: 0, x: -8, filter: 'blur(4px)' },
                      show: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.35, ease } },
                    }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: 8, height: 0 }}
                    className="flex items-center gap-2 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-subtle"
                  >
                    <Face peer={peer} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-text">
                        {shortName(peer.name)}
                      </span>
                      <span className="block text-[10px] text-text-muted">
                        {t('presence.online_only')}
                      </span>
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>

            {rest > 0 && (
              <p className="px-3 pb-2 text-[10.5px] text-text-muted">
                {t('presence.learners.more', { count: rest })}
              </p>
            )}

            <p className="border-t border-line px-3 py-1.5 text-[9.5px] leading-snug text-text-muted/80">
              {t('presence.learners.privacy')}
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
