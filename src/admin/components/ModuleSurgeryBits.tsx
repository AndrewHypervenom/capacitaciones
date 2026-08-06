import { type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ────────────────────────────────────────────────────────────────────────────
   Piezas compartidas por los dos modales de cirugía de módulos (separar/unir).
   Viven aparte para que ambos modales se vean y se sientan como la misma
   herramienta: mismos interruptores, mismo pulso del botón de IA, mismo cristal.
   ──────────────────────────────────────────────────────────────────────────── */

/** Curva corporativa (la misma del kit de movimiento). */
export const EASE = [0.16, 1, 0.3, 1] as const

export const SPRING = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 }

/** Interruptor con recorrido de resorte: decide qué hace la IA. */
export function AiToggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40',
        checked
          ? 'border-brand-magenta/35 bg-brand-magenta/[0.07]'
          : 'border-line bg-glass/[0.03] hover:bg-glass/[0.07]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors',
          checked ? 'justify-end border-brand-magenta/50 bg-brand-magenta/25' : 'justify-start border-line bg-glass/10',
        )}
      >
        <motion.span
          layout
          transition={SPRING}
          className={cn(
            'block h-4 w-4 rounded-full',
            checked ? 'bg-brand-magenta shadow-[0_0_10px_rgba(179,61,158,0.7)]' : 'bg-text-subtle',
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-text">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">{hint}</span>}
      </span>
      <AnimatePresence>
        {checked && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={SPRING}
            className="mt-0.5 text-brand-magenta"
          >
            <Check className="h-3.5 w-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

/**
 * Botón de IA con un halo que respira mientras trabaja. El brillo es un
 * gradiente girando detrás del botón, no un borde animado: así no reflowea.
 */
export function AiRunButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="group relative flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl border border-brand-magenta/35 bg-brand-magenta/10 px-4 text-[12.5px] font-semibold text-brand-magenta transition-colors hover:bg-brand-magenta/[0.16] disabled:opacity-40"
    >
      {busy && (
        <motion.span
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgba(179,61,158,0.45) 90deg, transparent 200deg)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <motion.span
        animate={busy ? { rotate: [0, 12, -12, 0], scale: [1, 1.15, 1] } : { rotate: 0, scale: 1 }}
        transition={busy ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : SPRING}
      >
        <Sparkles className="h-4 w-4" />
      </motion.span>
      {children}
    </button>
  )
}

/** Tarjeta de resultado (una por módulo resultante) con números que cuentan. */
export function OutcomeCard({
  tone,
  eyebrow,
  title,
  onTitleChange,
  stats,
  editableTitle = true,
}: {
  tone: 'green' | 'magenta'
  eyebrow: string
  title: string
  onTitleChange?: (v: string) => void
  stats: Array<{ label: string; value: string }>
  editableTitle?: boolean
}) {
  const ring = tone === 'green' ? 'border-brand-green/35' : 'border-brand-magenta/35'
  const glow =
    tone === 'green'
      ? 'shadow-[0_0_28px_-14px_rgba(16,212,81,0.8)]'
      : 'shadow-[0_0_28px_-14px_rgba(179,61,158,0.8)]'
  const text = tone === 'green' ? 'text-brand-green' : 'text-brand-magenta'

  return (
    <motion.div
      layout
      transition={SPRING}
      className={cn('rounded-2xl border bg-glass/[0.04] p-3.5', ring, glow)}
    >
      <span className={cn('text-[10.5px] font-semibold uppercase tracking-wider', text)}>{eyebrow}</span>
      {editableTitle && onTitleChange ? (
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[13.5px] font-semibold text-text outline-none transition-colors hover:border-line focus:border-line focus:bg-bg"
        />
      ) : (
        <p className="mt-1 truncate px-1.5 py-1 text-[13.5px] font-semibold text-text">{title}</p>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 px-1.5">
        {stats.map((s) => (
          <span key={s.label} className="text-[11px] text-text-muted">
            <motion.span
              key={s.value}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="inline-block font-semibold text-text"
            >
              {s.value}
            </motion.span>{' '}
            {s.label}
          </span>
        ))}
      </div>
    </motion.div>
  )
}
