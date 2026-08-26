/**
 * Fila de opción con interruptor: ícono, nombre, una explicación breve y el
 * Toggle a la derecha.
 *
 * Nace de "Manual / paso a paso", que estaba escrito dos veces (importar módulo y
 * crear curso con IA) como una tarjeta de cinco renglones. Dentro de un modal esa
 * tarjeta sola empujaba los botones fuera de la pantalla. Aquí la explicación se
 * recorta a dos líneas y el texto completo queda en el tooltip, así la opción se
 * entiende igual sin costar media ventana.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Toggle } from '@/components/ui/Toggle'
import { Tooltip } from '@/components/ui/Tooltip'

interface Props {
  on: boolean
  onChange: (next: boolean) => void
  icon: ReactNode
  title: string
  /** Explicación breve; si es larga se recorta y el globo muestra el resto. */
  description?: string
  disabled?: boolean
  className?: string
}

export function OptionToggleRow({
  on, onChange, icon, title, description, disabled = false, className,
}: Props) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors',
        on ? 'border-brand-violet/30 bg-brand-violet/[0.07]' : 'border-glass-border/15 bg-glass/[0.03]',
        disabled && 'cursor-wait opacity-60',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          on ? 'bg-brand-violet/15 text-brand-violet' : 'bg-glass/8 text-text-muted',
        )}
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text">{title}</p>
        {description && (
          <Tooltip label={description} maxWidth={320} anchor="element">
            <p className="line-clamp-2 text-[11px] leading-snug text-text-muted">{description}</p>
          </Tooltip>
        )}
      </div>

      <Toggle on={on} onClick={() => onChange(!on)} label={title} disabled={disabled} />
    </div>
  )
}
