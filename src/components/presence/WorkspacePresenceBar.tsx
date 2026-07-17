import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspacePeers } from '@/hooks/usePresence'
import {
  colorForUser,
  focusForPeer,
  safeDestinationForRoute,
  secondsSinceSeen,
  STALE_AFTER_MS,
  usePresenceStore,
  type Peer,
} from '@/stores/presenceStore'
import { PresenceStack, whereLabel } from './PresenceStack'
import { cn } from '@/lib/cn'

/** "ahora" / "hace 45 s" / "hace 3 min" */
function agoLabel(seconds: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (seconds < 15) return t('presence.now', { defaultValue: 'ahora' })
  if (seconds < 60) return t('presence.ago_s', { count: seconds, defaultValue: 'hace {{count}} s' })
  return t('presence.ago_m', { count: Math.round(seconds / 60), defaultValue: 'hace {{count}} min' })
}

interface WorkspacePresenceBarProps {
  className?: string
}

const initial = (name: string) => (name || '?').charAt(0).toUpperCase()

/**
 * A dónde ir al pulsar a una persona. Lleva al ÁREA donde está (la lista), nunca
 * adentro de lo que tiene abierto — ver `safeDestinationForRoute`.
 */
function destinationFor(peer: Peer): string | null {
  return safeDestinationForRoute(peer.route ?? '')
}

/**
 * "Quién está en línea" del espacio de trabajo. Se muestra en el sidebar del
 * panel. Al hacer clic se expande y muestra PUNTUALMENTE en qué vista está
 * cada persona (p. ej. "Editando: Módulo de ventas") para evitar que dos
 * personas choquen editando el mismo recurso. Se autooculta si no hay nadie.
 */
export function WorkspacePresenceBar({ className }: WorkspacePresenceBarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const peers = useWorkspacePeers()
  const followPeer = usePresenceStore((s) => s.followPeer)
  const [open, setOpen] = useState(false)
  // Fila con el cursor encima + su posición en pantalla; el tooltip se pinta en
  // un portal sobre <body> para que ningún botón/sidebar lo tape.
  const [hovered, setHovered] = useState<{ id: string; rect: DOMRect } | null>(null)

  // Tic de re-render para que "hace X s" y el atenuado de fantasmas se
  // actualicen aunque no lleguen eventos nuevos de presencia.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [open])

  // Si la lista se cierra, el tooltip no debe quedar flotando.
  useEffect(() => {
    if (!open) setHovered(null)
  }, [open])

  if (peers.length === 0) return null

  const roleLabel = (role?: string) =>
    role === 'superadmin'
      ? t('roles.superadmin', 'Superadmin')
      : role === 'capacitador'
        ? t('roles.capacitador', 'Capacitador')
        : role === 'learner'
          ? t('roles.learner', 'Aprendiz')
          : null

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-center gap-1.5 rounded-xl px-2 py-1.5 glass border border-glass-border/10',
          'transition-colors hover:bg-glass/8 cursor-pointer text-left',
        )}
      >
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-60 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon-green" />
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-text-subtle shrink-0">
          {t('presence.online_count', { count: peers.length })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <PresenceStack peers={peers} size={18} max={3} showActivity={false} />
          <ChevronDown
            className={cn('h-3 w-3 text-text-subtle transition-transform', open && 'rotate-180')}
          />
        </div>
      </button>

      {/* Detalle: quién está exactamente en qué vista */}
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
            animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: 0.18 }}
            className="rounded-xl mt-1.5 glass border border-glass-border/10 divide-y divide-glass-border/8"
          >
            {peers.map((peer) => {
              const role = roleLabel(peer.role)
              const seconds = secondsSinceSeen(peer, now)
              const stale = seconds * 1000 > STALE_AFTER_MS
              const color = peer.color ?? colorForUser(peer.user_id)
              const where = whereLabel(peer, t)
              const target = destinationFor(peer)
              return (
                <li key={peer.user_id}>
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => {
                    if (!target) return
                    setHovered(null)
                    setOpen(false)
                    // El foco hace que la vista cambie de campaña y resalte el
                    // recurso (o avise que la persona está en la vista entera);
                    // sin él uno aterriza sin saber qué mirar.
                    followPeer(focusForPeer(peer))
                    navigate(target)
                  }}
                  title={target ? t('presence.go_there', 'Ir a esa parte del sitio') : undefined}
                  className={cn(
                    'relative w-full flex items-center gap-2 px-2 py-1.5 text-left',
                    stale && 'opacity-45',
                    target ? 'cursor-pointer hover:bg-glass/8 transition-colors' : 'cursor-default',
                  )}
                  onMouseEnter={(e) => setHovered({ id: peer.user_id, rect: e.currentTarget.getBoundingClientRect() })}
                  onMouseLeave={() => setHovered((h) => (h?.id === peer.user_id ? null : h))}
                  onFocus={(e) => setHovered({ id: peer.user_id, rect: e.currentTarget.getBoundingClientRect() })}
                  onBlur={() => setHovered((h) => (h?.id === peer.user_id ? null : h))}
                >
                  <div
                    className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full flex items-center justify-center text-[9px] font-bold text-white select-none"
                    style={{
                      background: peer.avatar_url ? undefined : color,
                      boxShadow: `0 0 0 1.5px ${color}`,
                    }}
                  >
                    {peer.avatar_url ? (
                      <img
                        src={peer.avatar_url}
                        alt={peer.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      initial(peer.name)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-text leading-tight truncate">
                      {peer.name}
                      {role && (
                        <span className="ml-1 text-[8px] font-medium uppercase tracking-wide text-text-subtle">
                          {role}
                        </span>
                      )}
                    </p>
                    <p
                      className="text-[9px] leading-tight mt-0.5 truncate flex items-center gap-1"
                      style={{ color }}
                    >
                      <span
                        className="inline-block h-1 w-1 rounded-full shrink-0"
                        style={{ background: stale ? '#9CA3AF' : peer.activity?.dirty ? '#F59E0B' : '#10D451' }}
                      />
                      <span className="truncate">{where}</span>
                      <span className="text-text-subtle shrink-0">· {agoLabel(seconds, t)}</span>
                    </p>
                  </div>
                  {target && (
                    <ArrowUpRight className="h-3 w-3 shrink-0 text-text-subtle" aria-hidden />
                  )}
                </button>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Tooltip en portal sobre <body>: nada lo tapa y el fondo es sólido en claro/oscuro */}
      {hovered &&
        (() => {
          const peer = peers.find((p) => p.user_id === hovered.id)
          if (!peer) return null
          const role = roleLabel(peer.role)
          const seconds = secondsSinceSeen(peer, now)
          const stale = seconds * 1000 > STALE_AFTER_MS
          const color = peer.color ?? colorForUser(peer.user_id)
          const { rect } = hovered
          // Arriba de la fila si hay espacio; si no, debajo.
          const above = rect.top > 110
          return createPortal(
            <motion.div
              initial={{ opacity: 0, y: above ? 3 : -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none fixed z-[9999]"
              style={{
                left: rect.left,
                width: rect.width,
                ...(above
                  ? { bottom: window.innerHeight - rect.top + 6 }
                  : { top: rect.bottom + 6 }),
              }}
            >
              <div className="rounded-lg bg-surface border border-glass-border/20 px-2.5 py-1.5 shadow-xl">
                <p className="text-[11px] font-semibold text-text leading-snug break-words">
                  {peer.name}
                  {role && (
                    <span className="ml-1.5 text-[8px] font-medium uppercase tracking-wide text-text-subtle">
                      {role}
                    </span>
                  )}
                </p>
                <p className="text-[10px] leading-snug mt-0.5 break-words" style={{ color }}>
                  {whereLabel(peer, t)}
                </p>
                <p className="text-[9px] leading-snug mt-0.5 text-text-subtle">
                  {agoLabel(seconds, t)}
                  {stale && (
                    <> · {t('presence.maybe_gone', 'Sin señal reciente — puede haberse desconectado')}</>
                  )}
                </p>
                {destinationFor(peer) && (
                  <p className="text-[9px] leading-snug mt-1 font-medium flex items-start gap-1 text-text-muted">
                    <ArrowUpRight className="h-2.5 w-2.5 mt-0.5 shrink-0" aria-hidden />
                    <span>
                      {t('presence.go_there', 'Ir a esa parte del sitio')}
                      <span className="block text-text-subtle font-normal">
                        {t('presence.go_there_hint', 'Sin abrir lo que tiene entre manos')}
                      </span>
                    </span>
                  </p>
                )}
              </div>
            </motion.div>,
            document.body,
          )
        })()}
    </div>
  )
}
