import { useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { notificationText } from '@/lib/notificationText'
import { toast } from '@/stores/toastStore'

/**
 * Sincroniza las notificaciones del aprendiz y APLICA los restablecimientos que
 * el superadmin haya hecho: limpia la caché local (progressStore) para que la UI
 * deje de mostrar 100%, y muestra un aviso emergente. Se monta una vez en AppShell.
 *
 * Fuentes de disparo: al montar, al volver el foco a la pestaña, y en vivo por
 * Supabase Realtime sobre user_notifications (si está habilitado en el proyecto).
 */
export function useResetNotifications() {
  const { user } = useAuth()
  const refresh = useNotificationsStore((s) => s.refresh)
  const justApplied = useNotificationsStore((s) => s.justApplied)
  const clearJustApplied = useNotificationsStore((s) => s.clearJustApplied)

  // Carga inicial + al recuperar el foco.
  useEffect(() => {
    if (!user?.id) return
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [user?.id, refresh])

  // Realtime: nueva notificación → refrescar (aplica reset + avisa).
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`user_notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` },
        () => void refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, refresh])

  // Aviso emergente por cada reset recién aplicado.
  useEffect(() => {
    if (justApplied.length === 0) return
    for (const n of justApplied) {
      const { title, body } = notificationText(n)
      toast.info(title, body)
    }
    clearJustApplied()
  }, [justApplied, clearJustApplied])
}
