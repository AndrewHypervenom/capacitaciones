import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { toast } from '@/stores/toastStore'
import { deadlineInfo, formatDueDate } from '@/lib/courseDeadline'
import type { OnboardingGate } from '@/lib/onboarding'
import { rowText } from '@/lib/contentLang'

/**
 * El aviso de plazo, en pantalla, al entrar.
 *
 * La campana ya recibe el aviso que escribe la tarea diaria del servidor (SQL
 * 42), pero un aviso que hay que ir a buscar no sirve para algo que vence:
 * cuando el plazo de la inducción está a tres días o menos, se dice al entrar.
 *
 * Una vez al día y por curso (huella en localStorage con la fecha): entrar tres
 * veces en la mañana no puede convertirse en tres avisos iguales, y al día
 * siguiente —cuando queda un día menos— vuelve a decirlo.
 */
const KEY = 'learningai.deadlineToasts'

function alreadyShown(stamp: string): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]).includes(stamp) : false
  } catch {
    // Almacenamiento bloqueado: mejor avisar de más que callar un vencimiento.
    return false
  }
}

function remember(stamp: string) {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as string[]) : []
    // Solo lo de hoy: la lista no puede crecer sin fin.
    const today = stamp.split('|')[0]
    const next = [...list.filter((s) => s.startsWith(today)), stamp]
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* sin almacenamiento: volverá a salir en la próxima entrada */
  }
}

export function useDeadlineToasts(gate: OnboardingGate) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()

  useEffect(() => {
    if (!user?.id || !gate.settled || !gate.active) return
    const today = new Date().toISOString().slice(0, 10)

    for (const course of gate.pending) {
      const info = deadlineInfo(course, { assignedAt: course.assignedAt, completed: false })
      if (info.state !== 'soon' && info.state !== 'overdue') continue
      const stamp = `${today}|${user.id}|${course.id}|${info.state}|${info.daysLeft}`
      if (alreadyShown(stamp)) continue
      remember(stamp)

      const title = rowText(course)
      const date = info.dueMs ? formatDueDate(info.dueMs, i18n.language) : ''
      if (info.blocked) {
        toast.error(t('onboarding_gate.toast_closed_title', { course: title }), t('onboarding_gate.ask_extension'))
      } else if (info.state === 'overdue') {
        toast.error(t('onboarding_gate.toast_overdue_title', { course: title }), t('onboarding_gate.deadline_overdue', { date }))
      } else if (info.daysLeft <= 0) {
        toast.info(t('onboarding_gate.toast_today_title', { course: title }), t('onboarding_gate.deadline_today', { date }))
      } else {
        toast.info(
          t('onboarding_gate.toast_soon_title', { count: info.daysLeft, course: title }),
          t('onboarding_gate.deadline_ok', { date }),
        )
      }
    }
    // `gate.pending` cambia de identidad en cada render del padre, pero la
    // huella diaria evita que eso se note: como mucho se recalcula y no avisa.
  }, [user?.id, gate.settled, gate.active, gate.pending, t, i18n.language])
}
