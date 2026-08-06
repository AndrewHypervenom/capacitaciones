import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

/**
 * "La IA puede cometer errores. Verifica la información antes de publicar o eliminar."
 *
 * Acompaña a TODO lo que genere o modifique contenido con IA (módulos, cursos,
 * mundos, simulaciones, traducciones) y también a los botones de publicar de los
 * editores: la idea es que el recordatorio esté siempre a la vista y nadie
 * publique lo generado sin leerlo. No se puede cerrar, a propósito.
 *
 * `variant`:
 *  - 'block'  → tarjeta, para paneles y modales de generación.
 *  - 'inline' → una línea discreta, para barras de acciones junto a Publicar.
 */
export function AiReviewNotice({
  variant = 'block',
  className,
}: {
  variant?: 'block' | 'inline'
  className?: string
}) {
  const { t } = useTranslation()

  if (variant === 'inline') {
    return (
      <p className={cn('flex items-center gap-1.5 text-[11px] text-amber-500/90', className)}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>{t('common.ai_review_notice')}</span>
      </p>
    )
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5',
        className,
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
      <p className="text-[11.5px] leading-snug text-amber-500">
        {t('common.ai_review_notice')}
      </p>
    </div>
  )
}
