import i18n from '@/i18n'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { MIN_VIDEO_QUIZ_SECONDS } from '@/types/blocks'
import { findEarlyVideoQuizzes } from '@/services/videoQuizAudit.service'

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Guarda previa a PUBLICAR: si algún módulo tiene quizzes DENTRO de un video
 * demasiado al principio (0:00), NO se publica.
 *
 * No los corregimos automáticamente: un quiz de video no se puede saltar en la
 * línea de tiempo, así que moverlo por nuestra cuenta cambiaría el recorrido del
 * aprendiz sin que el capacitador lo vea. El aviso dice dónde están y publicar
 * queda bloqueado hasta que él mismo ajuste el tiempo.
 *
 * Devuelve `true` si se puede publicar.
 */
export async function ensureVideoQuizTimes(moduleIds: string[]): Promise<boolean> {
  const t = i18n.t.bind(i18n)

  let issues: Awaited<ReturnType<typeof findEarlyVideoQuizzes>>
  try {
    issues = await findEarlyVideoQuizzes(moduleIds)
  } catch {
    // Si la consulta falla no dejamos al capacitador sin poder publicar.
    return true
  }
  if (issues.length === 0) return true

  const multiModule = new Set(issues.map((i) => i.moduleId)).size > 1

  await confirmDialog({
    tone: 'danger',
    hideCancel: true,
    title: t('admin.modules.publish_quiz_zero.title'),
    confirmLabel: t('admin.modules.publish_quiz_zero.understood'),
    description: (
      <div className="space-y-2">
        <p>{t('admin.modules.publish_quiz_zero.desc', { count: issues.length })}</p>
        <ul className="space-y-1">
          {issues.slice(0, 6).map((it, idx) => (
            <li key={`${it.sectionId}-${idx}`} className="text-text">
              •{' '}
              {multiModule && it.moduleTitle ? `${it.moduleTitle} · ` : ''}
              {it.sectionHeading ||
                t('admin.modules.publish_quiz_zero.section_n', { n: it.sectionNumber })}{' '}
              <span className="text-text-muted">({fmtTime(it.timeSeconds)})</span>
            </li>
          ))}
          {issues.length > 6 && (
            <li className="text-text-muted">
              {t('admin.modules.publish_quiz_zero.and_more', { count: issues.length - 6 })}
            </li>
          )}
        </ul>
        <p className="text-text-muted">
          {t('admin.modules.publish_quiz_zero.hint', { s: MIN_VIDEO_QUIZ_SECONDS })}
        </p>
      </div>
    ),
  })
  return false
}
