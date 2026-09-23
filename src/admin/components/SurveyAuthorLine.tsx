import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import type { SurveyAuthor } from '@/services/survey.service'

/**
 * Quién escribió una respuesta de la encuesta, con lo necesario para buscarlo:
 * nombre, CR y correo (para copiarlo). La encuesta dejó de ser anónima
 * justo para que el capacitador pueda ampliar la conversación con la persona.
 *
 * `onOpen` abre su ficha cuando la pantalla la tiene a mano (tablero de
 * progreso); si no, el nombre es solo texto.
 */
export function SurveyAuthorLine({
  author,
  onOpen,
  className,
}: {
  author: SurveyAuthor | null | undefined
  onOpen?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  if (!author) {
    return (
      <span className={cn('text-[11px] italic text-text-subtle', className)}>
        {t('admin.courses.survey.author_unknown')}
      </span>
    )
  }

  const name = author.name || author.email || t('admin.courses.survey.author_unknown')

  const copy = async () => {
    if (!author.email) return
    try {
      await navigator.clipboard.writeText(author.email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* navegador sin permiso de portapapeles: no hay respaldo */ }
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <Avatar src={author.avatarUrl} name={name} size={22} />
      <div className="min-w-0 leading-tight">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[12px] font-semibold text-text hover:text-primary hover:underline"
          >
            {name}
          </button>
        ) : (
          <span className="block truncate text-[12px] font-semibold text-text">{name}</span>
        )}
        <span className="block truncate text-[10.5px] text-text-subtle">
          {[author.cr, !author.isActive && t('admin.courses.survey.author_inactive')].filter(Boolean).join(' · ') || author.email}
        </span>
      </div>
      {author.email && (
        <span className="ml-auto flex shrink-0 items-center">
          <Tooltip label={copied ? t('admin.courses.survey.author_copied') : t('admin.courses.survey.author_copy')} anchor="element">
            <button
              type="button"
              onClick={copy}
              aria-label={t('admin.courses.survey.author_copy')}
              className="rounded-md p-1 text-text-subtle hover:bg-subtle hover:text-text"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>
        </span>
      )}
    </div>
  )
}
