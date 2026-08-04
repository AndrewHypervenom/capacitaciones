import { useResetNotifications } from '@/hooks/useResetNotifications'

/**
 * Monta la sincronización de notificaciones para TODA la app (no pinta nada).
 *
 * Vive en App.tsx, al lado de PresenceSync, porque /admin/* no pasa por
 * AppShell: mientras el hook se montaba allí, el superadmin —que trabaja dentro
 * del panel— era justo quien no recibía nada en vivo.
 */
export function NotificationsSync() {
  useResetNotifications()
  return null
}
