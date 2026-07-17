import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { kindKeyForType, viewKeyForRoute, type Peer } from '@/stores/presenceStore'
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

// Medidas del tooltip flotante: al ir en un portal con posición fija hay que
// saberlas para centrarlo y para decidir si cabe debajo del avatar.
const TOOLTIP_W = 240
const TOOLTIP_H = 64

/**
 * Etiqueta legible de DÓNDE EXACTAMENTE está un compañero. Siempre nombra el
 * tipo de recurso y su título para que nadie abra lo que otro ya tiene abierto:
 *   "Editando el módulo «Ventas» · Sección: Introducción"
 *   "Estudiando el curso «Inducción»"
 * Si no está dentro de un recurso concreto, cae a la vista de la ruta:
 *   "En: Catálogo de cursos"
 */
export function whereLabel(
  peer: Peer,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  const activity = peer.activity
  if (activity?.title) {
    const kind = t(kindKeyForType(activity.type))
    const verb =
      activity.mode === 'view'
        ? 'presence.in_kind'
        : activity.dirty
          ? 'presence.editing_kind'
          : 'presence.open_kind'
    const base = t(verb, { kind, title: activity.title })
    return activity.detail ? `${base} · ${activity.detail}` : base
  }
  return t('presence.at', { view: t(viewKeyForRoute(peer.route ?? '')) })
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
  // Guardamos la posición en pantalla del avatar señalado: el tooltip se pinta
  // en un portal sobre <body> porque estos avatares viven dentro de tarjetas con
  // overflow recortado (listas de módulos/cursos), que si no lo tapan a medias.
  const [hovered, setHovered] = useState<{ id: string; rect: DOMRect } | null>(null)

  if (peers.length === 0) return null

  const visible = peers.slice(0, max)
  const overflow = peers.length - visible.length
  const overlap = Math.round(size * 0.35)
  const hoveredPeer = hovered ? peers.find((p) => p.user_id === hovered.id) : null

  return (
    <div className={cn('flex items-center', className)}>
      <AnimatePresence initial={false}>
        {visible.map((peer, idx) => {
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
                zIndex: hovered?.id === peer.user_id ? 50 : visible.length - idx,
              }}
              onMouseEnter={(e) =>
                setHovered({ id: peer.user_id, rect: e.currentTarget.getBoundingClientRect() })
              }
              onMouseLeave={() => setHovered((h) => (h?.id === peer.user_id ? null : h))}
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

            </motion.div>
          )
        })}
      </AnimatePresence>

      {/* Tooltip en portal sobre <body>: ninguna tarjeta con overflow lo recorta */}
      {hoveredPeer &&
        createPortal(
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.14 }}
            className="pointer-events-none fixed z-[9999]"
            style={{
              // Centrado bajo el avatar, pero sin salirse por los bordes de la
              // ventana (los avatares suelen ir pegados al borde de la tarjeta).
              left: Math.min(
                Math.max(8, hovered!.rect.left + hovered!.rect.width / 2 - TOOLTIP_W / 2),
                window.innerWidth - TOOLTIP_W - 8,
              ),
              width: TOOLTIP_W,
              ...(hovered!.rect.bottom + TOOLTIP_H > window.innerHeight
                ? { bottom: window.innerHeight - hovered!.rect.top + 8 }
                : { top: hovered!.rect.bottom + 8 }),
            }}
          >
            <div className="rounded-lg bg-surface border border-glass-border/20 px-2.5 py-1.5 shadow-xl">
              <p className="text-[12px] font-semibold text-text leading-snug break-words">
                {hoveredPeer.name}
              </p>
              {showActivity && (
                <p
                  className="text-[10px] leading-snug mt-0.5 flex items-start gap-1 break-words"
                  style={{ color: hoveredPeer.color }}
                >
                  <span
                    className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: hoveredPeer.activity?.dirty ? '#F59E0B' : hoveredPeer.color }}
                  />
                  {whereLabel(hoveredPeer, t)}
                </p>
              )}
            </div>
          </motion.div>,
          document.body,
        )}

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
