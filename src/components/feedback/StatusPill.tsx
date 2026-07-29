import { useTranslation } from 'react-i18next'
import type { FeedbackStatus } from '@/services/siteFeedback.service'
import { cn } from '@/lib/cn'

/** Colores del ciclo de vida de una opinión: llega → se revisa → se resuelve. */
export const STATUS_COLOR: Record<FeedbackStatus, string> = {
  new: '#38bdf8',
  in_review: '#f59e0b',
  planned: '#8b5cf6',
  done: '#10D451',
  archived: '#94a3b8',
}

export const STATUSES: FeedbackStatus[] = ['new', 'in_review', 'planned', 'done', 'archived']

export function StatusPill({ status, className }: { status: FeedbackStatus; className?: string }) {
  const { t } = useTranslation()
  const color = STATUS_COLOR[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
        className,
      )}
      style={{ background: `${color}1a`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {t(`site_feedback.status.${status}`)}
    </span>
  )
}
