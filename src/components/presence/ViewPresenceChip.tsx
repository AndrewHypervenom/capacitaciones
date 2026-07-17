import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { usePeersInMyView } from '@/hooks/usePresence'
import { usePresenceStore } from '@/stores/presenceStore'
import { PresenceStack, whereLabel } from './PresenceStack'

/**
 * Aviso de "no estás solo en esta pantalla". Aparece en CUALQUIER vista del
 * panel: si alguien más está en la misma (la lista de módulos, Personas, la
 * bitácora…), se ve una píldora flotante con sus avatares.
 *
 * Es deliberadamente pasivo: no interrumpe, no roba el foco y no tapa la acción
 * (vive abajo a la izquierda, fuera del camino de los botones). Al pasar el
 * cursor detalla quién es cada quien y qué está tocando.
 */
export function ViewPresenceChip() {
  const { t } = useTranslation()
  const peers = usePeersInMyView()
  const [hovered, setHovered] = useState(false)
  const focus = usePresenceStore((s) => s.focus)

  // Llegué siguiendo a alguien que está en la vista entera (no en un ítem):
  // aquí no hay nada que resaltar, así que el aviso se abre solo y lo dice.
  const followingView = focus?.type === 'view'
  const expanded = hovered || followingView

  if (peers.length === 0) return null

  // En pantallas grandes el sidebar (w-56, z-[60]) ocupa esta esquina, así que
  // la tarjeta arranca justo a su derecha. En móvil el menú es un cajón que se
  // superpone y la esquina queda libre.
  return (
    <div className="fixed bottom-4 left-4 md:left-[15rem] z-40 print:hidden">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="rounded-2xl glass-strong border border-glass-border/15 shadow-lg overflow-hidden"
      >
        {followingView && (
          <p className="px-2.5 pt-2 text-[9px] font-semibold uppercase tracking-wide text-neon-green">
            {t('presence.here_in_view', {
              name: focus?.peerName ?? '',
              view: t(focus?.viewKey ?? 'presence.views.somewhere'),
              defaultValue: '{{name}} está en «{{view}}», en toda la vista',
            })}
          </p>
        )}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neon-green" />
          </span>
          <PresenceStack peers={peers} size={22} max={4} showActivity={false} />
          <span className="text-[10px] font-medium text-text-muted whitespace-nowrap">
            {/* Con una sola persona se la nombra: "también está aquí" a secas no
                dice nada si el avatar es de alguien que no reconocés. */}
            {t('presence.in_this_view', { count: peers.length, name: peers[0]?.name })}
          </span>
        </div>

        {/* Detalle al pasar el cursor: quién y qué está tocando */}
        <AnimatePresence>
          {expanded && (
            <motion.ul
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16 }}
              className="border-t border-glass-border/10 max-w-[280px]"
            >
              {peers.map((peer) => (
                <li key={peer.user_id} className="px-2.5 py-1.5 flex items-start gap-1.5">
                  <span
                    className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: peer.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-text leading-tight truncate">
                      {peer.name}
                    </p>
                    <p className="text-[9px] leading-tight text-text-muted break-words">
                      {whereLabel(peer, t)}
                    </p>
                  </div>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
