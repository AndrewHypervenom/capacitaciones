import i18n from '@/i18n'
import type { AppNotification } from '@/services/notifications.service'

/**
 * Texto legible (título + cuerpo) de una notificación de reset, según su alcance
 * y payload. Usa la instancia de i18next directamente para poder usarse también
 * fuera de componentes (p. ej. en un toast disparado desde un store).
 */
export function notificationText(n: AppNotification): { title: string; body: string } {
  const t = i18n.t.bind(i18n)
  const p = n.payload ?? {}
  const course = p.course_title ?? ''
  const mod = p.module_title ?? ''
  const section = p.section_heading ?? ''

  // Aviso al superadmin: alguien escribió al chat de ayuda (no es un reset).
  if (n.kind === 'help_chat') {
    const who = p.from_name?.trim() || t('notifications.help_chat.someone')
    const count = Number(p.count) > 1 ? Number(p.count) : 1
    return {
      title:
        count > 1
          ? t('notifications.help_chat.title_many', { name: who, count })
          : t('notifications.help_chat.title', { name: who }),
      body: p.question ? `“${p.question}”` : t('notifications.help_chat.body'),
    }
  }

  // Aviso al staff: llegó una opinión del sitio (no es un reset).
  if (n.kind === 'site_feedback') {
    const who = p.from_name?.trim() || t('notifications.site_feedback.someone')
    const count = Number(p.count) > 1 ? Number(p.count) : 1
    const kindLabel = t(`site_feedback.kind.${p.feedback_kind ?? 'idea'}.label`)
    return {
      title:
        count > 1
          ? t('notifications.site_feedback.title_many', { name: who, count })
          : t('notifications.site_feedback.title', { name: who }),
      body: p.message
        ? `“${p.message}”`
        : t('notifications.site_feedback.body', { kind: kindLabel }),
    }
  }

  // Alguien escribió en el hilo de una opinión: al equipo si respondió quien
  // opinó, y a quien opinó si respondió el equipo. El mismo aviso sirve para los
  // dos lados; `for_staff` dice de cuál se trata.
  if (n.kind === 'site_feedback_reply') {
    const who = p.from_name?.trim() || t('notifications.site_feedback.someone')
    return {
      title: p.for_staff
        ? t('notifications.feedback_reply.title_staff', { name: who })
        : t('notifications.feedback_reply.title_learner'),
      body: p.message
        ? `“${p.message}”`
        : t('notifications.feedback_reply.body'),
    }
  }

  // Un capacitador pide que se publique un curso: lo reciben los aprobadores.
  if (n.kind === 'course_publish_request') {
    const who = p.from_name?.trim() || t('notifications.site_feedback.someone')
    return {
      title: t('notifications.publish_request.title', { name: who }),
      body: t('notifications.publish_request.body', { course: course || '—' }),
    }
  }

  // La decisión del aprobador, de vuelta a quien pidió (o escribió) el curso.
  if (n.kind === 'course_publish_resolved') {
    if (p.approved) {
      return {
        title: t('notifications.publish_resolved.approved_title'),
        body: t('notifications.publish_resolved.approved_body', { course: course || '—' }),
      }
    }
    return {
      title: p.revoked
        ? t('notifications.publish_resolved.revoked_title')
        : t('notifications.publish_resolved.rejected_title'),
      body: p.message
        ? `“${p.message}”`
        : t('notifications.publish_resolved.rejected_body', { course: course || '—' }),
    }
  }

  // Aviso de retroalimentación del capacitador (no es un reset).
  if (n.kind === 'feedback') {
    return {
      title: t('notifications.feedback.title'),
      body: mod
        ? t('notifications.feedback.body_module', { module: mod })
        : t('notifications.feedback.body'),
    }
  }

  switch (n.scope) {
    case 'module':
      return {
        title: t('notifications.reset.module_title'),
        body: t('notifications.reset.module_body', { module: mod, course }),
      }
    case 'section':
      return {
        title: t('notifications.reset.section_title'),
        body: t('notifications.reset.section_body', { section, module: mod, course }),
      }
    case 'world':
      return {
        title: t('notifications.reset.world_title'),
        body: t('notifications.reset.world_body', { course }),
      }
    case 'simulator':
      return {
        title: t('notifications.reset.simulator_title'),
        body: t('notifications.reset.simulator_body', { course }),
      }
    case 'course':
    default:
      return {
        title: t('notifications.reset.course_title'),
        body: t('notifications.reset.course_body', { course }),
      }
  }
}
