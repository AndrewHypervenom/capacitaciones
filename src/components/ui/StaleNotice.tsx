import { RefreshCw, X, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

/**
 * "Otra pestaña guardó cambios." Aparece en un editor cuando la fila que se está
 * editando ya cambió en la base desde que se abrió.
 *
 * Es un aviso, no una recarga automática: recargar solo se hace si el que edita
 * lo pide, porque lo que tiene en pantalla sin guardar es trabajo suyo.
 */
export function StaleNotice({
  onReload,
  onDismiss,
  className,
}: {
  onReload: () => void
  onDismiss?: () => void
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5',
        className,
      )}
    >
      <GitBranch className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="flex-1 min-w-[12rem] text-[12px] leading-snug text-text-muted">
        {t('common.stale.message')}
      </p>
      <button
        type="button"
        onClick={onReload}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-[11px] font-medium text-amber-500 transition-colors hover:bg-amber-500/10"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {t('common.stale.reload')}
      </button>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.stale.dismiss')}
          className="rounded-lg p-1.5 text-text-subtle transition-colors hover:text-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
