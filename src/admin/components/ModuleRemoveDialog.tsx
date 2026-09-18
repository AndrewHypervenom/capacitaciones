import { useTranslation } from 'react-i18next'
import { EyeOff, Loader2, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * La papelera de un módulo en el curso ofrece dos salidas, y ninguna lo deja
 * suelto (sin curso):
 *
 *  - Despublicar: se queda en el curso como borrador. Quien aprende deja de
 *    verlo y se vuelve a publicar cuando se quiera.
 *  - Borrar: el flujo de siempre (papelera del superadmin / aprobación).
 */
export function ModuleRemoveDialog({
  title, isPublished, busy, onUnpublish, onDelete, onClose,
}: {
  title: string
  isPublished: boolean
  /** Qué acción está en curso, para su spinner. */
  busy: 'unpublish' | 'delete' | null
  onUnpublish: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  const option = (opts: {
    kind: 'unpublish' | 'delete'
    icon: React.ReactNode
    label: string
    body: string
    disabled?: boolean
    note?: string
    onClick: () => void
  }) => (
    <button
      type="button"
      onClick={opts.onClick}
      disabled={opts.disabled || busy !== null}
      className={cn(
        'group flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all active:scale-[0.99]',
        'disabled:pointer-events-none disabled:opacity-50',
        opts.kind === 'delete'
          ? 'border-line hover:border-danger/40 hover:bg-danger/6'
          : 'border-line hover:border-amber-400/40 hover:bg-amber-400/6',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
          opts.kind === 'delete' ? 'bg-danger/10 text-danger' : 'bg-amber-400/12 text-amber-500',
        )}
      >
        {busy === opts.kind ? <Loader2 className="h-4 w-4 animate-spin" /> : opts.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-text">{opts.label}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-text-muted">{opts.body}</span>
        {opts.note && <span className="mt-1 block text-[11.5px] font-medium text-amber-500">{opts.note}</span>}
      </span>
    </button>
  )

  return (
    <Modal
      onClose={onClose}
      dismissible={busy === null}
      size="md"
      accent="neutral"
      icon={<Trash2 className="h-4 w-4" />}
      title={t('admin.courses.remove_module.title')}
      subtitle={title}
      footer={
        <Button variant="glass" size="sm" onClick={onClose} disabled={busy !== null}>
          {t('common.cancel')}
        </Button>
      }
    >
      <div className="space-y-2.5">
        {option({
          kind: 'unpublish',
          icon: <EyeOff className="h-4 w-4" />,
          label: t('admin.courses.remove_module.unpublish'),
          body: t('admin.courses.remove_module.unpublish_body'),
          disabled: !isPublished,
          note: isPublished ? undefined : t('admin.courses.remove_module.already_draft'),
          onClick: onUnpublish,
        })}
        {option({
          kind: 'delete',
          icon: <Trash2 className="h-4 w-4" />,
          label: t('admin.courses.remove_module.delete'),
          body: t('admin.courses.remove_module.delete_body'),
          onClick: onDelete,
        })}
      </div>
    </Modal>
  )
}
