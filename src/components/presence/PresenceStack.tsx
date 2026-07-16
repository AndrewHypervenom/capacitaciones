import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import type { Peer } from '@/stores/presenceStore'
import { cn } from '@/lib/cn'

interface PresenceStackProps {
  peers: Peer[]
  /** Diámetro de cada avatar en px. */
  size?: number
  /** Máximo de avatares antes de colapsar en "+N". */
  max?: number
  /** Muestra el estado (editando/viendo) en el tooltip. */
  showActivity?: boolean
  className?: string
}

const initial = (name: string) => (name || '?').charAt(0).toUpperCase()

/** Etiqueta legible del estado de un compañero para el tooltip. */
function activityLabel(peer: Peer, t: (k: string) => string): string | null {
  if (!peer.activity) return t('presence.browsing')
  return peer.activity.dirty ? t('presence.editing_now') : t('presence.viewing')
}

/**
 * Avatares apilados en vivo, estilo Google Docs / SharePoint. Cada uno lleva un
 * anillo del color del usuario, un punto "en línea" que pulsa y un tooltip con
 * el nombre (y opcionalmente qué está haciendo) al pasar el cursor.
 */
export function PresenceStack({
  peers,
  size = 32,
  max = 5,
  showActivity = true,
  className,
}: PresenceStackProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState<string | null>(null)

  if (peers.length === 0) return null

  const visible = peers.slice(0, max)
  const overflow = peers.length - visible.length
  const overlap = Math.round(size * 0.35)

  return (
    <div className={cn('flex items-center', className)}>
      <AnimatePresence initial={false}>
        {visible.map((peer, idx) => {
          const label = showActivity ? activityLabel(peer, t) : null
          return (
            <motion.div
              key={peer.user_id}
              layout
              initial={{ opacity: 0, scale: 0.4, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.4, x: -6 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="relative"
              style={{
                marginLeft: idx === 0 ? 0 : -overlap,
                zIndex: hovered === peer.user_id ? 50 : visible.length - idx,
              }}
              onMouseEnter={() => setHovered(peer.user_id)}
              onMouseLeave={() => setHovered((h) => (h === peer.user_id ? null : h))}
            >
              <motion.div
                whileHover={{ y: -3, scale: 1.08 }}
                transition={{ type: 'spring', stiffness: 600, damping: 24 }}
                className="relative rounded-full ring-2 ring-bg"
                style={{ width: size, height: size }}
              >
                {/* Anillo de color del usuario */}
                <span
                  className="absolute inset-0 rounded-full"
                  style={{ boxShadow: `0 0 0 2px ${peer.color}` }}
                  aria-hidden
                />
                {/* Avatar o inicial */}
                <div
                  className="h-full w-full overflow-hidden rounded-full flex items-center justify-center font-bold text-white select-none"
                  style={{
                    background: peer.avatar_url ? undefined : peer.color,
                    fontSize: Math.round(size * 0.4),
                  }}
                >
                  {peer.avatar_url ? (
                    <img
                      src={peer.avatar_url}
                      alt={peer.name}
                      width={size}
                      height={size}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initial(peer.name)
                  )}
                </div>
                {/* Punto "en línea" que pulsa; ámbar si tiene cambios sin guardar */}
                <span
                  className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-bg"
                  style={{
                    width: Math.max(8, size * 0.28),
                    height: Math.max(8, size * 0.28),
                    background: peer.activity?.dirty ? '#F59E0B' : '#10D451',
                  }}
                >
                  <span
                    className="absolute inset-0 rounded-full animate-ping opacity-60"
                    style={{ background: peer.activity?.dirty ? '#F59E0B' : '#10D451' }}
                  />
                </span>
              </motion.div>

              {/* Tooltip */}
              <AnimatePresence>
                {hovered === peer.user_id && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.9 }}
                    transition={{ duration: 0.14 }}
                    className="absolute left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
                    style={{ top: size + 8 }}
                  >
                    <div className="whitespace-nowrap rounded-lg glass-strong border border-glass-border/15 px-2.5 py-1.5 shadow-xl">
                      <p className="text-[12px] font-semibold text-text leading-tight">
                        {peer.name}
                      </p>
                      {label && (
                        <p
                          className="text-[10px] leading-tight mt-0.5 flex items-center gap-1"
                          style={{ color: peer.color }}
                        >
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: peer.activity?.dirty ? '#F59E0B' : peer.color }}
                          />
                          {label}
                        </p>
                      )}
                    </div>
                    {/* Flecha */}
                    <div className="absolute left-1/2 -top-1 -translate-x-1/2 h-2 w-2 rotate-45 glass-strong border-l border-t border-glass-border/15" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </AnimatePresence>

      {overflow > 0 && (
        <motion.div
          layout
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative flex items-center justify-center rounded-full ring-2 ring-bg glass-strong text-text-muted font-semibold"
          style={{
            width: size,
            height: size,
            marginLeft: -overlap,
            fontSize: Math.round(size * 0.34),
            zIndex: 0,
          }}
          title={peers.slice(max).map((p) => p.name).join(', ')}
        >
          +{overflow}
        </motion.div>
      )}
    </div>
  )
}
