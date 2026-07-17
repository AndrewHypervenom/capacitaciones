import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePeersInMyView } from '@/hooks/usePresence'
import {
  colorForUser,
  secondsSinceSeen,
  STALE_AFTER_MS,
  usePresenceStore,
  type Peer,
} from '@/stores/presenceStore'
import { PresenceStack, whereLabel } from './PresenceStack'
import { cn } from '@/lib/cn'

const initial = (name: string) => (name || '?').charAt(0).toUpperCase()

/** "ahora" / "hace 45 s" / "hace 3 min" — compacto para la fila. */
function agoLabel(seconds: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (seconds < 15) return t('presence.now', { defaultValue: 'ahora' })
  if (seconds < 60) return t('presence.ago_s', { count: seconds, defaultValue: 'hace {{count}} s' })
  return t('presence.ago_m', { count: Math.round(seconds / 60), defaultValue: 'hace {{count}} min' })
}

/** Avatar redondo con anillo del color estable de la persona (o inicial). */
function Avatar({ peer, size = 26 }: { peer: Peer; size?: number }) {
  const color = peer.color ?? colorForUser(peer.user_id)
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full flex items-center justify-center font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: peer.avatar_url ? undefined : color,
        boxShadow: `0 0 0 1.5px rgb(var(--surface)), 0 0 0 3px ${color}`,
      }}
    >
      {peer.avatar_url ? (
        <img src={peer.avatar_url} alt={peer.name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initial(peer.name)
      )}
    </div>
  )
}

/**
 * Aviso de "no estás solo en esta pantalla". Aparece en CUALQUIER vista del
 * panel: si alguien más está en la misma (la lista de módulos, Personas, la
 * bitácora…), se ve una píldora flotante con sus avatares.
 *
 * Es deliberadamente pasivo: no interrumpe, no roba el foco y no tapa la acción
 * (vive abajo a la izquierda, fuera del camino de los botones). Al pasar el
 * cursor (o tocar, en móvil) detalla quién es cada quien y qué está tocando,
 * con estilo de presencia tipo Figma/Linear: avatar, rol y estado en vivo.
 *
 * Pensado para escalar: con muchísima gente la píldora colapsada no crece (solo
 * avatares + "+N") y la lista abierta tiene tope de alto con scroll y de ancho
 * al viewport, para que nunca se coma la pantalla ni entorpezca en el celular.
 */
export function ViewPresenceChip() {
  const { t } = useTranslation()
  const peers = usePeersInMyView()
  // Un único estado abierto/cerrado, gobernado por el clic/tap. Antes el hover
  // también expandía y peleaba con el clic: al hacer clic para cerrar, el puntero
  // seguía encima y lo mantenía abierto ("no deja cerrar"). El clic manda y
  // funciona igual en escritorio y en móvil.
  const [open, setOpen] = useState(false)
  const focus = usePresenceStore((s) => s.focus)

  // Llegué siguiendo a alguien que está en la vista entera (no en un ítem):
  // aquí no hay nada que resaltar, así que el aviso se ABRE SOLO una vez… pero
  // sin quedar clavado: el usuario puede colapsarlo con el chevron cuando quiera.
  const followingView = focus?.type === 'view'
  const expanded = open

  // Tic para que "hace X" y el atenuado de fantasmas se refresquen aunque no
  // lleguen eventos nuevos; solo corre mientras el detalle está a la vista.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expanded) return
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [expanded])

  // Al llegar siguiendo a alguien, abrir el detalle una vez para que se lea el
  // aviso. El efecto solo corre cuando `followingView` cambia a true, así que si
  // luego lo colapsás, no se vuelve a abrir solo (respeta tu decisión).
  useEffect(() => {
    if (followingView) setOpen(true)
  }, [followingView])

  // Si la gente de la vista se vacía, no dejar el panel abierto en el aire.
  useEffect(() => {
    if (peers.length === 0 && open) setOpen(false)
  }, [peers.length, open])

  if (peers.length === 0) return null

  const count = peers.length

  const roleLabel = (role?: string) =>
    role === 'superadmin'
      ? t('roles.superadmin', 'Superadmin')
      : role === 'capacitador'
        ? t('roles.capacitador', 'Capacitador')
        : role === 'learner'
          ? t('roles.learner', 'Aprendiz')
          : null

  // En pantallas grandes el sidebar (w-56, z-[60]) ocupa esta esquina, así que
  // la tarjeta arranca justo a su derecha. En móvil el menú es un cajón que se
  // superpone y la esquina queda libre.
  return (
    <div className="fixed bottom-4 left-4 md:left-[15rem] z-40 print:hidden max-w-[calc(100vw-2rem)]">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          // Un latido al llegar siguiendo a alguien: sin robar el foco ni tapar nada.
          boxShadow: followingView
            ? ['0 0 0 0px rgba(16,212,81,0)', '0 0 0 6px rgba(16,212,81,0.18)', '0 0 0 0px rgba(16,212,81,0)']
            : undefined,
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 30,
          boxShadow: { duration: 1.6, repeat: followingView ? 2 : 0 },
        }}
        className={cn(
          // Superficie sólida (adapta claro/oscuro por token) en vez de glass
          // translúcido, para que se lea limpio sobre cualquier contenido detrás.
          'rounded-2xl bg-surface/95 backdrop-blur-xl border border-glass-border/12 overflow-hidden',
          'ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-xl',
          'max-w-[min(20rem,calc(100vw-2rem))]',
        )}
      >
        {followingView && expanded && (
          <p className="px-3 pt-2.5 text-[9px] font-semibold uppercase tracking-wide text-neon-green">
            {t('presence.here_in_view', {
              name: focus?.peerName ?? '',
              view: t(focus?.viewKey ?? 'presence.views.somewhere'),
              defaultValue: '{{name}} está en «{{view}}», en toda la vista',
            })}
          </p>
        )}
        {/* Fila principal: el botón que abre/cierra (clic o tap). */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expanded}
          className="group w-full flex items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer transition-colors hover:bg-glass/6"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-green shadow-[0_0_6px_rgba(16,212,81,0.7)]" />
          </span>
          <PresenceStack peers={peers} size={24} max={4} showActivity={false} />
          <span className="text-[11px] font-medium text-text-muted whitespace-nowrap truncate min-w-0">
            {/* El plural i18next ya resuelve: con una persona la nombra; con
                muchas cuenta a secas ("N personas más aquí"), sin alargar. */}
            {t('presence.in_this_view', { count, name: peers[0]?.name })}
          </span>
          {/* Apunta en el sentido de la acción: colapsado el panel crece hacia
              arriba (↑ = abrir); expandido se contrae hacia abajo (↓ = cerrar). */}
          <ChevronUp
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 text-text-subtle transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
              expanded && 'rotate-180',
            )}
          />
        </button>

        {/* Detalle al abrir: quién y qué está tocando cada quien.
            Con tope de alto + scroll para que muchísima gente no reviente. */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{
                // La altura frena suave (expo-out); la opacidad entra un pelín
                // después al abrir y sale antes al cerrar, sin golpes.
                height: { duration: 0.34, ease: [0.16, 1, 0.3, 1] },
                opacity: { duration: 0.22, ease: 'easeOut' },
              }}
              className="border-t border-glass-border/10"
            >
              {/* Cabecera del panel: solo el contador. El chevron de la fila de
                  arriba es el único control para colapsar (sin X redundante). */}
              <div className="px-3 py-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-text-subtle">
                  {t('presence.online_count', { count })}
                </span>
              </div>
              <ul className="max-h-[min(50vh,17rem)] overflow-y-auto overscroll-contain pb-1">
                {peers.map((peer) => {
                  const role = roleLabel(peer.role)
                  const seconds = secondsSinceSeen(peer, now)
                  const stale = seconds * 1000 > STALE_AFTER_MS
                  const color = peer.color ?? colorForUser(peer.user_id)
                  const statusColor = stale
                    ? '#9CA3AF'
                    : peer.activity?.dirty
                      ? '#F59E0B'
                      : '#10D451'
                  return (
                    <li
                      key={peer.user_id}
                      className={cn(
                        'mx-1 rounded-lg px-2 py-1.5 flex items-center gap-2.5 transition-colors hover:bg-glass/8',
                        stale && 'opacity-55',
                      )}
                    >
                      <Avatar peer={peer} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-[11px] font-semibold text-text leading-tight truncate">
                            {peer.name}
                          </p>
                          {role && (
                            <span className="shrink-0 rounded-full bg-glass/10 px-1.5 py-px text-[8px] font-medium uppercase tracking-wide text-text-subtle">
                              {role}
                            </span>
                          )}
                        </div>
                        <p
                          className="text-[9px] leading-tight mt-0.5 flex items-center gap-1 min-w-0"
                          style={{ color }}
                        >
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: statusColor }}
                          />
                          <span className="truncate">{whereLabel(peer, t)}</span>
                          <span className="text-text-subtle shrink-0 whitespace-nowrap">
                            · {agoLabel(seconds, t)}
                          </span>
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
