import { usePeersForResource } from '@/hooks/usePresence'
import type { PresenceResourceType } from '@/stores/presenceStore'
import { PresenceStack } from './PresenceStack'
import { cn } from '@/lib/cn'

interface ResourcePresenceProps {
  type: PresenceResourceType
  id: string
  size?: number
  className?: string
}

/**
 * Píldora compacta para listas: muestra los avatares de quienes están dentro de
 * un recurso (módulo, curso…) ahora mismo. Se autooculta si no hay nadie.
 */
export function ResourcePresence({ type, id, size = 26, className }: ResourcePresenceProps) {
  const peers = usePeersForResource(type, id)
  if (peers.length === 0) return null
  return (
    <div
      className={cn(
        'flex items-center rounded-full glass px-1.5 py-1 border border-glass-border/10',
        className,
      )}
    >
      <PresenceStack peers={peers} size={size} max={3} />
    </div>
  )
}
