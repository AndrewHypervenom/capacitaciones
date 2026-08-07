import { Copy, FileText, Upload, Video, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DuplicateMatch } from '@/services/mediaDuplicates.service'

/**
 * "Este documento ya está en el curso."
 *
 * Aparece en lugar de la zona de subida cuando el archivo elegido ya existe en
 * otro módulo del curso. No bloquea nada: el capacitador decide.
 *
 *  - Huella idéntica ('exact')  → es el mismo archivo con certeza, así que se
 *    ofrece "Usar el mismo archivo": el bloque apunta a la URL que ya existe y
 *    no se sube nada (ni tiempo ni cupo de Storage).
 *  - Solo coincide el nombre ('filename') → sospecha, no certeza (uno de los dos
 *    se subió antes de que existieran las huellas). Se avisa dónde está, pero
 *    reusar sería arriesgado: el contenido podría ser otro.
 */
export function DuplicateMediaNotice({
  match,
  onReuse,
  onUploadAnyway,
  onCancel,
}: {
  match: DuplicateMatch
  onReuse: () => void
  onUploadAnyway: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { use, confidence } = match
  const isPdf = use.kind === 'pdf'
  const Icon = isPdf ? FileText : Video

  const where = [use.moduleTitle, use.sectionHeading].filter(Boolean).join(' · ')

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3.5 space-y-3">
      <div className="flex items-start gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium leading-snug text-amber-500">
            {t(confidence === 'exact'
              ? (isPdf ? 'admin.modules.dup.pdf_exact' : 'admin.modules.dup.video_exact')
              : (isPdf ? 'admin.modules.dup.pdf_by_name' : 'admin.modules.dup.video_by_name'))}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-text-muted">
            {t('admin.modules.dup.located_at')}{' '}
            <span className="text-text">{where || t('admin.modules.dup.unnamed')}</span>
          </p>
          {use.filename && (
            <p className="mt-0.5 text-[11px] text-text-subtle truncate">{use.filename}</p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-text-muted hover:text-text transition-colors shrink-0"
          title={t('common.cancel')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {confidence === 'exact' && (
          <button
            onClick={onReuse}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-[12px] font-medium text-black hover:opacity-90 transition-opacity"
          >
            <Copy className="h-3.5 w-3.5" />
            {t(isPdf ? 'admin.modules.dup.reuse_pdf' : 'admin.modules.dup.reuse_video')}
          </button>
        )}
        <button
          onClick={onUploadAnyway}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] text-text-muted hover:text-text hover:bg-subtle/50 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          {t('admin.modules.dup.upload_anyway')}
        </button>
        <a
          href={use.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11.5px] text-text-muted hover:text-text underline underline-offset-2"
        >
          {t('admin.modules.dup.view_existing')}
        </a>
      </div>
    </div>
  )
}
