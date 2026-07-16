import { useTranslation } from 'react-i18next'
import { useWorkspacePeers } from '@/hooks/usePresence'
import { PresenceStack } from './PresenceStack'
import { cn } from '@/lib/cn'

interface WorkspacePresenceBarProps {
  className?: string
}

/**
 * "Quién está en línea" del espacio de trabajo. Se muestra en el sidebar del
 * panel para que, en cualquier página, el staff vea quién más está conectado.
 * Se autooculta si no hay nadie más.
 */
export function WorkspacePresenceBar({ className }: WorkspacePresenceBarProps) {
  const { t } = useTranslation()
  const peers = useWorkspacePeers()
  if (peers.length === 0) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl px-2.5 py-2 glass border border-glass-border/10',
        className,
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-60 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-green" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle shrink-0">
        {t('presence.online_count', { count: peers.length })}
      </span>
      <div className="ml-auto">
        <PresenceStack peers={peers} size={24} max={4} />
      </div>
    </div>
  )
}
