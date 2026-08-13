import { cn } from '@/lib/cn'

/**
 * Interruptor on/off accesible y consistente (track + perilla).
 *
 * Vivía suelto dentro de CourseEditor; salió a `ui/` cuando la pestaña de
 * encuesta necesitó el mismo control. Un segundo interruptor pintado a mano
 * habría abierto la puerta a dos aspectos distintos para la misma cosa.
 */
export function Toggle({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean
  onClick: () => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50',
        on ? 'bg-primary border-primary' : 'bg-subtle border-line',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-200',
          on ? 'translate-x-[22px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}
