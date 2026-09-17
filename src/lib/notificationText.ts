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

  // El plazo del curso aprieta o ya venció (tarea diaria del servidor).
  if (n.kind === 'course_deadline') {
    const stage = p.stage === 'overdue' || p.stage === 'today' ? p.stage : 'soon'
    const date = p.due_at
      ? new Date(p.due_at).toLocaleDateString(i18n.language, {
          day: 'numeric', month: 'long', year: 'numeric',
        })
      : '—'
    return {
      // El contador solo tiene sentido en «faltan N días»: pasarlo en los
      // otros dos haría que i18next buscara un plural que no existe.
      title: stage === 'soon'
        ? t('notifications.deadline.soon_title', { count: p.days_left ?? 0 })
        : t(`notifications.deadline.${stage}_title`),
      body: stage === 'soon'
        ? t('notifications.deadline.soon_body', { course: course || '—', date, count: p.days_left ?? 0 })
        : t(`notifications.deadline.${stage}_body`, { course: course || '—', date }),
    }
  }

  /* Resumen al equipo: a quién se le pasó el plazo.
     El `kind` sigue llamándose 'onboarding_overdue' por los avisos que ya
     estaban mandados (renombrarlo los dejaría sin texto), pero desde el SQL 44
     la tarea cubre CUALQUIER curso con plazo, no solo la inducción. El payload
     trae `onboarding` en false cuando hay cursos normales en el resumen: decir
     "inducción vencida" de un curso que no lo es manda al equipo a buscar por
     donde no es. */
  if (n.kind === 'onboarding_overdue') {
    const who = (p.who ?? []).filter(Boolean)
    const count = Number(p.count) > 0 ? Number(p.count) : who.length
    const group = p.onboarding === false ? 'deadline_overdue' : 'onboarding_overdue'
    // DE QUÉ CURSO es lo primero que pregunta quien recibe esto: sin el nombre,
    // el aviso manda a buscar entre todos los cursos con plazo. El payload
    // siempre lo trae (`courses`); los avisos viejos que no, caen al texto sin
    // curso en vez de quedarse en blanco.
    const courses = (p.courses ?? []).filter(Boolean)
    const list = courses.join(' · ')
    const suffix = courses.length > 0 ? '_course' : ''
    return {
      title: t(`notifications.${group}.title`, { count }),
      body: who.length > 0
        ? t(`notifications.${group}.body${suffix}`, { who: who.join(', '), count, courses: list })
        : t(`notifications.${group}.body_plain${suffix}`, { count, courses: list }),
    }
  }

  // Un superadmin dejó el curso en un punto concreto (pruebas).
  if (p.adjust) {
    return {
      title: t('notifications.reset.adjust_title'),
      body: t('notifications.reset.adjust_body', { course, where: p.stop_label ?? '—' }),
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
