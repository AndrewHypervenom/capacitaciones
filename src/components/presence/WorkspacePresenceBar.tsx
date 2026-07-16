import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspacePeers } from '@/hooks/usePresence'
import { colorForUser } from '@/stores/presenceStore'
import { PresenceStack, whereLabel } from './PresenceStack'
import { cn } from '@/lib/cn'

interface WorkspacePresenceBarProps {
  className?: string
}

const initial = (name: string) => (name || '?').charAt(0).toUpperCase()

/**
 * "Quién está en línea" del espacio de trabajo. Se muestra en el sidebar del
 * panel. Al hacer clic se expande y muestra PUNTUALMENTE en qué vista está
 * cada persona (p. ej. "Editando: Módulo de ventas") para evitar que dos
 * personas choquen editando el mismo recurso. Se autooculta si no hay nadie.
 */
export function WorkspacePresenceBar({ className }: WorkspacePresenceBarProps) {
  const { t } = useTranslation()
  const peers = useWorkspacePeers()
  const [open, setOpen] = useState(false)
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
          'w-full flex items-center gap-2 rounded-xl px-2.5 py-2 glass border border-glass-border/10',
          'transition-colors hover:bg-glass/8 cursor-pointer text-left',
        )}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-green" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle shrink-0">
          {t('presence.online_count', { count: peers.length })}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <PresenceStack peers={peers} size={24} max={4} showActivity={false} />
          <ChevronDown
            className={cn('h-3.5 w-3.5 text-text-subtle transition-transform', open && 'rotate-180')}
          />
        </div>
      </button>

      {/* Detalle: quién está exactamente en qué vista */}
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden rounded-xl mt-1.5 glass border border-glass-border/10 divide-y divide-glass-border/8"
          >
            {peers.map((peer) => {
              const role = roleLabel(peer.role)
              return (
                <li key={peer.user_id} className="flex items-center gap-2.5 px-2.5 py-2">
                  <div
                    className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full flex items-center justify-center text-[11px] font-bold text-white select-none"
                    style={{
                      background: peer.avatar_url ? undefined : peer.color ?? colorForUser(peer.user_id),
                      boxShadow: `0 0 0 2px ${peer.color ?? colorForUser(peer.user_id)}`,
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
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-text leading-tight truncate">
                      {peer.name}
                      {role && (
                        <span className="ml-1.5 text-[9px] font-medium uppercase tracking-wide text-text-subtle">
                          {role}
                        </span>
                      )}
                    </p>
                    <p
                      className="text-[10px] leading-tight mt-0.5 truncate flex items-center gap-1"
                      style={{ color: peer.color ?? colorForUser(peer.user_id) }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: peer.activity?.dirty ? '#F59E0B' : '#10D451' }}
                      />
                      {whereLabel(peer, t)}
                    </p>
                  </div>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
