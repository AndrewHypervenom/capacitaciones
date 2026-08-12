/* ────────────────────────────────────────────────────────────────────────────
   La marca de "esto lo escribió la IA".

   Un módulo generado y uno escrito a mano se veían idénticos, y no lo son: lo
   generado hay que leerlo antes de publicarlo, y a los tres meses ya nadie se
   acuerda de cuál fue cuál.

   Tenue a propósito: es un dato de contexto, no una alarma. Va en violeta
   porque en todo el panel el violeta ya significa IA (el asistente, el
   documento del importador), y el verde está tomado por "publicado".

   Se pinta solo cuando `ai_generated` es `true`. Mientras la migración no se
   corra el campo llega `undefined` y no se pinta nada — ni marca, ni hueco.
   ──────────────────────────────────────────────────────────────────────────── */

import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'

/*
 * El tinte se declara en los dos temas. El violeta corporativo cambia de tono
 * entre claro y oscuro (`--neon-violet`), y una sola opacidad no sirve para los
 * dos: la que se ve bien sobre negro desaparece sobre blanco.
 */

/** Fondo tenue + borde, para la tarjeta de un módulo generado por IA. */
export const AI_AUTHORED_TINT =
  'bg-brand-violet/[0.10] dark:bg-brand-violet/[0.08] border-brand-violet/30'

/** Solo el fondo, para una fila de lista (la barra de secciones). */
export const AI_AUTHORED_ROW = 'bg-brand-violet/[0.10] dark:bg-brand-violet/[0.08]'

/** La línea del canto izquierdo que hace de marcador en las filas. */
export const AI_AUTHORED_EDGE = 'border-l-2 border-l-brand-violet/60'

/**
 * Chip "IA" con su explicación. `variant`:
 *  - 'chip' → con la palabra IA, para tarjetas anchas (lista de módulos).
 *  - 'dot'  → solo el ícono, para filas angostas (barra de secciones).
 */
export function AiAuthoredBadge({
  variant = 'chip',
  scope,
  className,
}: {
  variant?: 'chip' | 'dot'
  /** Qué se generó: cambia el texto del globo. */
  scope: 'module' | 'section'
  className?: string
}) {
  const { t } = useTranslation()
  const label = t(`admin.ai_authored.hint_${scope}`)

  if (variant === 'dot') {
    return (
      <Tooltip label={label} maxWidth={220} describedBy>
        <span className={cn('inline-flex items-center text-brand-violet/70', className)}>
          <Sparkles className="h-2.5 w-2.5" />
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip label={label} maxWidth={240} describedBy>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
          'bg-brand-violet/10 text-brand-violet ring-1 ring-brand-violet/20',
          'text-[10px] font-semibold uppercase tracking-wider',
          className,
        )}
      >
        <Sparkles className="h-2.5 w-2.5" />
        {t('admin.ai_authored.tag')}
      </span>
    </Tooltip>
  )
}
