import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { useNotificationPrefs } from '@/stores/notificationPrefsStore'
import { notificationText } from '@/lib/notificationText'
import { playNotificationSound } from '@/lib/notificationSound'
import { toast } from '@/stores/toastStore'

/**
 * Sincroniza las notificaciones de la persona conectada y reacciona a lo que
 * llega mientras la app está abierta:
 *
 *  - Restablecimientos del superadmin → limpia la caché local (progressStore)
 *    para que la UI deje de mostrar 100%, y avisa con un emergente.
 *  - Retroalimentación del capacitador → aviso emergente.
 *  - "Alguien escribió al chat de ayuda" (solo superadmin), "llegó una opinión
 *    del sitio" y "respondieron en una opinión" (superadmin + capacitadores de
 *    la campaña) → suenan y los recoge `StaffPings`, que pinta la tarjeta con
 *    quién escribió y qué dijo.
 *  - "El equipo respondió tu opinión" (a quien opinó) → suena y sale de emergente.
 *
 * Se monta UNA sola vez, a nivel de toda la app (`NotificationsSync` en
 * App.tsx). Antes vivía en AppShell, que no envuelve /admin/* — el superadmin,
 * que se pasa el día en el panel, era justo quien no recibía nada en vivo.
 *
 * Fuentes de disparo: al montar, al volver el foco a la pestaña, y en vivo por
 * Supabase Realtime sobre user_notifications.
 */
export function useResetNotifications() {
  const { user } = useAuth()
  const refresh = useNotificationsStore((s) => s.refresh)
  const justApplied = useNotificationsStore((s) => s.justApplied)
  const clearJustApplied = useNotificationsStore((s) => s.clearJustApplied)
  const justArrived = useNotificationsStore((s) => s.justArrived)
  const clearJustArrived = useNotificationsStore((s) => s.clearJustArrived)

  // Carga inicial + al recuperar el foco.
  useEffect(() => {
    if (!user?.id) return
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [user?.id, refresh])

  // Realtime: notificación nueva o actualizada → refrescar (aplica reset y avisa).
  // El UPDATE importa porque los avisos del chat de ayuda se AGRUPAN: la segunda
  // pregunta seguida de la misma persona no inserta otra fila, engorda la suya.
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`user_notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` },
        () => void refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, refresh])

  // Aviso emergente por cada reset recién aplicado a la caché local.
  useEffect(() => {
    if (justApplied.length === 0) return
    for (const n of justApplied) {
      const { title, body } = notificationText(n)
      toast.info(title, body)
    }
    clearJustApplied()
  }, [justApplied, clearJustApplied])

  // ── Sonido y aviso de lo que acaba de llegar ──────────────────────────────
  // Una notificación agrupada vuelve a "llegar" cada vez que crece, así que la
  // huella incluye el contador: suena una vez por evento, nunca dos por el mismo.
  const chimed = useRef(new Set<string>())
  useEffect(() => {
    if (justArrived.length === 0) return
    const { helpAlerts, feedbackAlerts } = useNotificationPrefs.getState()
    const handled: string[] = []

    for (const n of justArrived) {
      const stamp = `${n.id}:${n.payload?.count ?? 1}`
      const isHelp = n.kind === 'help_chat'
      const isSiteFeedback = n.kind === 'site_feedback'
      // La respuesta en el hilo de una opinión llega a los dos lados: al equipo
      // (que la ve como tarjeta) y a quien opinó (que la ve como emergente).
      // Suena en ambos: que te contesten es justo lo que estabas esperando.
      const isReply = n.kind === 'site_feedback_reply'
      const forStaff = isReply && n.payload?.for_staff === true
      // Cada tipo se puede silenciar por separado desde el engranaje de la
      // campana. El aviso de respuesta al aprendiz no se silencia: es suyo, no
      // es una bandeja de trabajo.
      const alertsOn = isHelp ? helpAlerts : (isSiteFeedback || forStaff) ? feedbackAlerts : true

      if (!chimed.current.has(stamp)) {
        chimed.current.add(stamp)
        if (alertsOn) {
          playNotificationSound(isHelp || isSiteFeedback || isReply ? 'ping' : 'info')
        }
      }

      // Los del chat de ayuda, las opiniones y las respuestas AL EQUIPO los
      // pinta StaffPings (tarjeta con lo que escribieron) y él mismo los saca de
      // la cola; los resets ya avisaron por justApplied.
      if (isHelp || isSiteFeedback || forStaff) continue
      if (n.kind === 'feedback' || isReply) {
        const { title, body } = notificationText(n)
        toast.info(title, body)
      }
      handled.push(n.id)
    }

    for (const id of handled) clearJustArrived(id)
  }, [justArrived, clearJustArrived])
}
