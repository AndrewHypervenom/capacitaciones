import { AlertCircle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAiOutOfCredits } from '@/lib/aiCredits'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

interface Props {
  className?: string
  /** `banner` (por defecto): recuadro discreto. `inline`: solo una línea de texto. */
  variant?: 'banner' | 'inline'
}

/**
 * Aviso sutil de que la API de Claude no tiene créditos. Solo se muestra a
 * capacitadores y superadmin (los que usan la IA) y solo cuando de verdad no hay
 * saldo (manual o detectado en vivo). Para aprendices no aparece nunca.
 *
 * Colócalo arriba de cualquier panel donde se ofrezca generar con IA.
 */
export function AiCreditsNotice({ className, variant = 'banner' }: Props) {
  const { isAdminOrCapacitador } = useAuth()
  const outOfCredits = useAiOutOfCredits()

  if (!isAdminOrCapacitador || !outOfCredits) return null

  if (variant === 'inline') {
    return (
      <p className={cn('flex items-center gap-1.5 text-[11px] text-amber-500/90', className)}>
        <AlertCircle className="h-3 w-3 shrink-0" />
        {i18n.t('ai_credits.notice_short')}
      </p>
    )
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-2.5',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
          {i18n.t('ai_credits.notice_title')}
        </p>
        <p className="text-[11px] text-text-subtle mt-0.5 leading-relaxed">
          {i18n.t('ai_credits.notice_body')}
        </p>
      </div>
    </div>
  )
}

/**
 * Puntito ámbar discreto para encabezados de paneles de IA (incluso colapsados),
 * así el staff nota que la IA está pausada sin tener que abrir el panel. Solo se
 * muestra a capacitador/superadmin cuando de verdad no hay créditos.
 */
export function AiCreditsDot({ className }: { className?: string }) {
  const { isAdminOrCapacitador } = useAuth()
  const outOfCredits = useAiOutOfCredits()

  if (!isAdminOrCapacitador || !outOfCredits) return null

  return (
    <span
      title={i18n.t('ai_credits.notice_short')}
      aria-label={i18n.t('ai_credits.notice_short')}
      className={cn('relative flex h-2 w-2 shrink-0', className)}
    >
      <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400/60 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
    </span>
  )
}
