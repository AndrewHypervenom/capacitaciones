import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp, ChevronLeft, ChevronRight, EyeOff, LifeBuoy,
  MessageCircle, MessageSquarePlus, X,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useHelpChatStore } from '@/stores/helpChatStore'
import { useSiteFeedbackStore } from '@/stores/siteFeedbackStore'
import { useFloatingDockStore } from '@/stores/floatingDockStore'
import { shouldShowFeedbackFab } from '@/components/feedback/config'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'
import { cn } from '@/lib/cn'

/**
 * Rincón flotante único: chat de ayuda, "tu opinión" y "volver arriba".
 *
 * Antes eran tres botones fijos apilados (una columna de ~13rem de alto) que se
 * quedaban encima del contenido y tapaban botones reales: llegar a lo que había
 * debajo era imposible. Aquí viven los tres detrás de UN botón de 3rem que:
 *
 *  • se aparta solo al bajar por la página (y mientras está apartado no captura
 *    clics: lo que quede debajo se puede tocar sin pelear con él);
 *  • vuelve al subir, al llegar arriba del todo o cuando el mouse se acerca;
 *  • se puede mandar al otro lado o esconder del todo, y la elección se recuerda.
 *
 * Se monta una sola vez, en la raíz de la app.
 */

/** Vistas donde ningún flotante debe aparecer: examen, juego o impresión. */
const HIDDEN_ROUTES = [
  /^\/$/, /^\/login/, /^\/reset-password/, /^\/verify\//,
  /^\/certificate/,             // se imprime / descarga como PDF
  /^\/quiz/,                    // quiz en vivo: cada segundo y cada clic cuentan
  /^\/mission\//,               // misión a pantalla completa
  /^\/simulator\/(run|choice)/, // simulación en curso
]

/** Píxeles de scroll seguidos que hacen falta para apartarlo o traerlo. */
const SCROLL_DELTA = 8
/** Debajo de esta altura de scroll siempre está a la vista. */
const TOP_ZONE = 120
/** A partir de aquí tiene sentido ofrecer "volver arriba". */
const SCROLL_TOP_AT = 400
/** Cerca del rincón (en px) el mouse lo hace reaparecer. */
const NEAR_X = 240
const NEAR_Y = 220

export function CornerDock() {
  const { t } = useTranslation()
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const reduce = useReducedMotion()

  const side = useFloatingDockStore((s) => s.side)
  const hidden = useFloatingDockStore((s) => s.hidden)
  const helpMounted = useFloatingDockStore((s) => s.helpMounted)
  const setHidden = useFloatingDockStore((s) => s.setHidden)
  const toggleSide = useFloatingDockStore((s) => s.toggleSide)

  const helpOpen = useHelpChatStore((s) => s.isOpen)
  const feedbackOpen = useSiteFeedbackStore((s) => s.isOpen)

  const [expanded, setExpanded] = useState(false)
  /** false = apartado por scroll: se encoge, se desvanece y deja pasar los clics. */
  const [peek, setPeek] = useState(true)
  const [scrolled, setScrolled] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  /** Último contenedor que scrolleó (null = la página). Lo usa "volver arriba". */
  const scrollerRef = useRef<HTMLElement | null>(null)

  const routeAllows = !HIDDEN_ROUTES.some((re) => re.test(location.pathname))
  const showFeedback = shouldShowFeedbackFab(location.pathname)
  const panelOpen = helpOpen || feedbackOpen
  const visible = isAuthenticated && !IS_LEARNER_PREVIEW && routeAllows && (helpMounted || showFeedback)
  // "Volver arriba" no depende de ayuda/opiniones: mientras se baja por un
  // módulo largo es lo único que hace falta, y tiene que verse sin desplegar
  // nada (antes vivía dentro del menú y en la práctica nadie lo encontraba).
  const showTop = isAuthenticated && !IS_LEARNER_PREVIEW && routeAllows && scrolled && !panelOpen

  // Al bajar se aparta; al subir, al llegar arriba o al abrir un panel, vuelve.
  //
  // Se escucha en captura sobre el documento y no solo en `window` porque no
  // todo el sitio scrollea la página: el panel de gestión vive dentro de un
  // contenedor con su propio scroll, y ahí `window.scroll` nunca dispara.
  useEffect(() => {
    let last = 0
    let lastTarget: EventTarget | null = null

    const onScroll = (e: Event) => {
      const target = e.target
      const el = target instanceof HTMLElement ? target : null
      // Scroll de un panel nuestro (chat, opiniones, modales): no es la página.
      if (el?.closest('[role="dialog"], .help-scroll')) return

      const y = el ? el.scrollTop : window.scrollY
      setScrolled(y > SCROLL_TOP_AT)
      scrollerRef.current = el

      // Cambió el contenedor que scrollea: se toma como punto de partida.
      if (target !== lastTarget) {
        lastTarget = target
        last = y
        return
      }

      const dy = y - last
      if (y < TOP_ZONE) {
        setPeek(true)
      } else if (dy > SCROLL_DELTA) {
        setPeek(false)
        setExpanded(false)
      } else if (dy < -SCROLL_DELTA) {
        setPeek(true)
      } else {
        return // movimientos mínimos: ni se aparta ni vuelve
      }
      last = y
    }

    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  // Con mouse basta acercarse al rincón para traerlo de vuelta.
  useEffect(() => {
    if (peek || !visible) return
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const nearBottom = e.clientY > window.innerHeight - NEAR_Y
      const nearSide = side === 'right'
        ? e.clientX > window.innerWidth - NEAR_X
        : e.clientX < NEAR_X
      if (nearBottom && nearSide) setPeek(true)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [peek, visible, side])

  // Con un panel abierto el botón es el "cerrar": tiene que estar a la vista.
  useEffect(() => {
    if (panelOpen) { setPeek(true); setExpanded(false) }
  }, [panelOpen])

  // Cambiar de pantalla cierra el menú (y lo devuelve al rincón).
  useEffect(() => {
    setExpanded(false)
    setPeek(true)
    setScrolled(false)
    scrollerRef.current = null
  }, [location.pathname])

  // Clic fuera y Escape cierran el menú desplegado.
  useEffect(() => {
    if (!expanded) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setExpanded(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  const sideClass = side === 'right' ? 'right-4 sm:right-5' : 'left-4 sm:left-5'
  /** Apartado: se va hacia su borde. Así no queda "medio botón" sobre el contenido. */
  const awayX = side === 'right' ? 64 : -64

  const goTop = () => {
    setExpanded(false)
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
    // Sube lo que de verdad está scrolleando: la página o el contenedor del panel.
    if (scrollerRef.current) scrollerRef.current.scrollTo({ top: 0, behavior })
    else window.scrollTo({ top: 0, behavior })
  }

  /** Hay lanzador debajo (el de ayuda): la flecha se apila encima de él. */
  const launcherBelow = visible && !hidden

  // ── Flecha "volver arriba": vive fuera del dock, así no se aparta al bajar ──
  const topFab = (
    <AnimatePresence key="top">
      {showTop && (
        <motion.button
          type="button"
          onClick={goTop}
          aria-label={t('common.scroll_top', 'Volver arriba')}
          title={t('common.scroll_top', 'Volver arriba')}
          className={cn(
            'fixed z-[9990] flex h-11 w-11 items-center justify-center rounded-full',
            'border border-line bg-surface/90 text-text shadow-lg backdrop-blur',
            'transition-colors hover:bg-subtle',
            sideClass,
            launcherBelow ? 'bottom-[4.75rem] sm:bottom-[5.25rem]' : 'bottom-4 sm:bottom-5',
          )}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          whileHover={reduce ? undefined : { scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.2} />
        </motion.button>
      )}
    </AnimatePresence>
  )

  if (!visible) return createPortal(topFab, document.body)

  // ── Escondido a petición: solo queda una pestañita en el borde ──────────
  if (hidden) {
    return createPortal(
      <>
      {topFab}
      <button
        type="button"
        onClick={() => setHidden(false)}
        aria-label={t('dock.show', 'Mostrar ayuda y opiniones')}
        title={t('dock.show', 'Mostrar ayuda y opiniones')}
        className={cn(
          'fixed bottom-24 z-[9989] flex h-16 w-5 items-center justify-center',
          'border border-line bg-surface/80 text-text-subtle shadow-lg backdrop-blur',
          'transition-colors hover:text-text',
          side === 'right' ? 'right-0 rounded-l-xl border-r-0' : 'left-0 rounded-r-xl border-l-0',
        )}
      >
        {side === 'right'
          ? <ChevronLeft className="h-3.5 w-3.5" />
          : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      </>,
      document.body,
    )
  }

  const openHelp = () => {
    setExpanded(false)
    useSiteFeedbackStore.getState().close()
    useHelpChatStore.getState().toggle()
  }

  const openFeedback = () => {
    setExpanded(false)
    useHelpChatStore.getState().close()
    useSiteFeedbackStore.getState().open()
  }

  const onLauncher = () => {
    // Con un panel abierto el botón cierra, que es lo que la gente espera del
    // aspa; si no, despliega el menú.
    if (panelOpen) {
      useHelpChatStore.getState().close()
      useSiteFeedbackStore.getState().close()
      return
    }
    setExpanded((v) => !v)
  }

  return createPortal(
    <>
    {topFab}
    <motion.div
      ref={rootRef}
      className={cn(
        'fixed bottom-4 z-[9990] flex flex-col items-end gap-2 sm:bottom-5',
        side === 'left' && 'items-start',
        sideClass,
        // Apartado no captura clics: lo que esté debajo se toca sin estorbos.
        !peek && !expanded && 'pointer-events-none',
      )}
      animate={reduce
        ? { opacity: peek || expanded ? 1 : 0.25 }
        : { x: peek || expanded ? 0 : awayX, opacity: peek || expanded ? 1 : 0.3, scale: peek || expanded ? 1 : 0.85 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      {/* ── Acciones desplegadas ──────────────────────────────── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="menu"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn('flex flex-col gap-2', side === 'left' ? 'items-start' : 'items-end')}
          >
            {helpMounted && (
              <DockAction
                side={side}
                icon={<MessageCircle className="h-4.5 w-4.5" />}
                label={t('dock.help', 'Chat de ayuda')}
                tone="green"
                onClick={openHelp}
              />
            )}
            {showFeedback && (
              <DockAction
                side={side}
                icon={<MessageSquarePlus className="h-4.5 w-4.5" />}
                label={t('dock.feedback', 'Tu opinión')}
                tone="fuchsia"
                onClick={openFeedback}
              />
            )}
            <DockAction
              side={side}
              icon={side === 'right'
                ? <ChevronLeft className="h-4.5 w-4.5" />
                : <ChevronRight className="h-4.5 w-4.5" />}
              label={t('dock.switch_side', 'Pasarlo al otro lado')}
              onClick={() => { toggleSide(); setExpanded(false) }}
            />
            <DockAction
              side={side}
              icon={<EyeOff className="h-4.5 w-4.5" />}
              label={t('dock.hide', 'Ocultar por ahora')}
              onClick={() => { setHidden(true); setExpanded(false) }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Botón único ───────────────────────────────────────── */}
      <motion.button
        type="button"
        onClick={onLauncher}
        aria-label={t('dock.open', 'Ayuda y opiniones')}
        aria-expanded={expanded}
        title={t('dock.open', 'Ayuda y opiniones')}
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full',
          // Verde corporativo con el ícono en blanco. El degradado baja a un
          // verde más hondo para que el blanco se lea bien en tema claro y
          // oscuro (el ícono es el único contenido: tiene que contrastar).
          'bg-gradient-to-br from-[#10C44D] to-[#0A8A3A] text-white',
          'shadow-lg shadow-[#0A8A3A]/30 ring-1 ring-white/15',
        )}
        initial={reduce ? false : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.35, type: 'spring', stiffness: 260, damping: 20 }}
        whileHover={reduce ? undefined : { scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {expanded || panelOpen ? (
            <motion.span
              key="x"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
            >
              <X className="h-5 w-5" strokeWidth={2.4} />
            </motion.span>
          ) : (
            <motion.span
              key="dock"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
            >
              <LifeBuoy className="h-5 w-5" strokeWidth={2.2} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </motion.div>
    </>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────
// Cada acción del menú: píldora con ícono y texto (nada de adivinar íconos)
// ─────────────────────────────────────────────────────────────
function DockAction({ icon, label, onClick, side, tone }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  side: 'left' | 'right'
  tone?: 'green' | 'fuchsia'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-full border border-line bg-surface/95 py-2 pl-3 pr-4 shadow-lg backdrop-blur',
        'text-[13px] font-medium text-text transition-colors hover:bg-subtle',
        side === 'left' && 'flex-row-reverse pl-4 pr-3',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          tone === 'green' ? 'bg-neon-green/15 text-neon-green'
            : tone === 'fuchsia' ? 'bg-fuchsia-500/15 text-fuchsia-400'
            : 'bg-subtle text-text-muted',
        )}
      >
        {icon}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
