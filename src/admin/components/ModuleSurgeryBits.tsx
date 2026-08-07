import { type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Clock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/components/ui/Tooltip'

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
  tooltip,
  children,
}: {
  busy: boolean
  disabled?: boolean
  onClick: () => void
  /** Qué va a pasar al pulsarlo, o por qué está bloqueado. */
  tooltip?: string
  children: ReactNode
}) {
  return (
    <Tooltip label={tooltip} maxWidth={260} className="shrink-0">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="group relative flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl border border-brand-magenta/35 bg-brand-magenta/10 px-4 text-[12.5px] font-semibold text-brand-magenta transition-colors hover:bg-brand-magenta/[0.16] disabled:opacity-40 disabled:pointer-events-none"
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
    </Tooltip>
  )
}

/** Duración editable de un módulo resultante. `null` = volver al cálculo automático. */
export interface OutcomeMinutes {
  /** Minutos que se van a guardar (el valor a mano si lo hay, si no el calculado). */
  value: number
  /** Lo que sale del cálculo; se usa al pulsar "recalcular". */
  auto: number
  /** El capacitador lo escribió a mano (deja de seguir al cálculo). */
  overridden: boolean
  onChange: (v: number | null) => void
  label: string
  suffix: string
  resetLabel: string
  /** Qué hace el botón de recalcular. */
  autoHint?: string
  disabled?: boolean
}

/**
 * Tarjeta de resultado (una por módulo resultante).
 *
 * Aquí NO se mira, se edita: el título y la duración son campos con borde,
 * etiqueta y lápiz visible. Antes eran un input transparente y un número suelto,
 * y nadie adivinaba que se podían tocar. Las secciones y los quizzes sí son
 * cifras de solo lectura, porque salen del contenido y no de una decisión.
 */
export function OutcomeCard({
  tone,
  eyebrow,
  title,
  onTitleChange,
  titleLabel,
  minutes,
  stats,
  editableTitle = true,
  disabled,
}: {
  tone: 'green' | 'magenta'
  eyebrow: string
  title: string
  onTitleChange?: (v: string) => void
  titleLabel?: string
  minutes?: OutcomeMinutes
  stats: Array<{ label: string; value: string }>
  editableTitle?: boolean
  disabled?: boolean
}) {
  const ring = tone === 'green' ? 'border-brand-green/35' : 'border-brand-magenta/35'
  const glow =
    tone === 'green'
      ? 'shadow-[0_0_28px_-14px_rgba(16,212,81,0.8)]'
      : 'shadow-[0_0_28px_-14px_rgba(179,61,158,0.8)]'
  const text = tone === 'green' ? 'text-brand-green' : 'text-brand-magenta'
  const focus =
    tone === 'green'
      ? 'focus:border-brand-green/70 focus:ring-2 focus:ring-brand-green/20'
      : 'focus:border-brand-magenta/70 focus:ring-2 focus:ring-brand-magenta/20'

  return (
    <motion.div
      layout
      transition={SPRING}
      className={cn('rounded-2xl border bg-glass/[0.04] p-3.5', ring, glow)}
    >
      <span className={cn('text-[10.5px] font-semibold uppercase tracking-wider', text)}>{eyebrow}</span>

      {/* ── Título ── */}
      {editableTitle && onTitleChange ? (
        <label className="mt-2 block">
          <span className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-text-subtle">
            <Pencil className="h-2.5 w-2.5" />
            {titleLabel}
          </span>
          <input
            value={title}
            disabled={disabled}
            onChange={(e) => onTitleChange(e.target.value)}
            className={cn(
              'w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-[13.5px] font-semibold text-text outline-none transition-colors disabled:opacity-50',
              focus,
            )}
          />
        </label>
      ) : (
        <p className="mt-1 truncate px-1.5 py-1 text-[13.5px] font-semibold text-text">{title}</p>
      )}

      {/* ── Duración ── */}
      {minutes && (
        <div className="mt-2.5">
          <span className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-text-subtle">
            <Clock className="h-2.5 w-2.5" />
            {minutes.label}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={999}
              inputMode="numeric"
              aria-label={minutes.label}
              disabled={disabled || minutes.disabled}
              value={minutes.value}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (raw === '') return minutes.onChange(null)
                const n = Number.parseInt(raw, 10)
                if (Number.isFinite(n)) minutes.onChange(Math.min(999, Math.max(1, n)))
              }}
              className={cn(
                'h-9 w-[72px] rounded-lg border border-line bg-bg px-2 text-center text-[13.5px] font-semibold tabular-nums text-text outline-none transition-colors disabled:opacity-50',
                focus,
              )}
            />
            <span className="text-[11.5px] text-text-muted">{minutes.suffix}</span>
            <AnimatePresence>
              {minutes.overridden && minutes.value !== minutes.auto && (
                <Tooltip label={minutes.autoHint} maxWidth={240} className="shrink-0">
                <motion.button
                  type="button"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  disabled={disabled || minutes.disabled}
                  onClick={() => minutes.onChange(null)}
                  className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[10.5px] text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-40 disabled:pointer-events-none"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  {minutes.resetLabel} {minutes.auto}
                </motion.button>
                </Tooltip>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── Cifras que salen del contenido (no se editan) ── */}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2">
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

/* ════════════════════════════════════════════════════════════════════════════
   VER LO QUE ESCRIBIÓ LA IA.

   El aviso decía "revisa lo que propuso la IA" pero solo se veía el título: el
   subtítulo, los objetivos, los puntos clave y los textos de enlace se guardaban
   a ciegas. Estas piezas los sacan a la vista y los dejan editar antes de
   confirmar — que es lo único que hace que "revisar" signifique algo.
   ════════════════════════════════════════════════════════════════════════════ */

const FIELD_BASE =
  'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-text outline-none transition-colors placeholder:text-text-subtle focus:border-brand-magenta/60 disabled:opacity-50'

/** Campo de texto de una o varias líneas, con su etiqueta. */
export function SurgeryField({
  label,
  value,
  onChange,
  placeholder,
  rows,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-text-subtle">
        {label}
      </span>
      {rows && rows > 1 ? (
        <textarea
          rows={rows}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(FIELD_BASE, 'resize-y leading-relaxed')}
        />
      ) : (
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_BASE}
        />
      )}
    </label>
  )
}

/** Lista de frases (objetivos, puntos clave): se edita, se quita, se añade. */
export function SurgeryList({
  label,
  items,
  onChange,
  addLabel,
  removeLabel,
  placeholder,
  disabled,
}: {
  label: string
  items: string[]
  onChange: (v: string[]) => void
  addLabel: string
  removeLabel: string
  placeholder?: string
  disabled?: boolean
}) {
  const setAt = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)))
  const removeAt = (i: number) => onChange(items.filter((_, idx) => idx !== i))

  return (
    <div>
      <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-text-subtle">
        {label}
      </span>
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {items.map((item, i) => (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="flex items-start gap-1.5"
            >
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-magenta/60" />
              <textarea
                rows={1}
                value={item}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(e) => setAt(i, e.target.value)}
                className={cn(FIELD_BASE, 'min-h-[32px] resize-y leading-snug')}
              />
              <Tooltip label={removeLabel} className="mt-0.5 shrink-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeAt(i)}
                  aria-label={removeLabel}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-30 disabled:pointer-events-none"
                >
                  <X className="h-3 w-3" />
                </button>
              </Tooltip>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...items, ''])}
        className="mt-1.5 flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[10.5px] text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-30 disabled:pointer-events-none"
      >
        <Plus className="h-2.5 w-2.5" />
        {addLabel}
      </button>
    </div>
  )
}

/** Bloque plegable: agrupa lo que redactó la IA sin alargar el modal de golpe. */
export function SurgeryFold({
  open,
  onToggle,
  title,
  badge,
  action,
  children,
}: {
  open: boolean
  onToggle: () => void
  title: string
  badge?: string
  /** Acciones de la cabecera (descartar, etc.). Van FUERA del botón que pliega. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-brand-magenta/25 bg-brand-magenta/[0.04]">
      <div className="flex items-center gap-1.5 pr-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2.5 text-left"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-magenta" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full border border-brand-magenta/35 bg-brand-magenta/10 px-2 py-0.5 text-[10px] font-semibold text-brand-magenta">
              {badge}
            </span>
          )}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2, ease: EASE }}>
            <ChevronDown className="h-3.5 w-3.5 text-text-subtle" />
          </motion.span>
        </button>
        {action}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-brand-magenta/20 px-3.5 py-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** El texto real de una sección, para poder leerlo sin salir del modal. */
export function SectionBody({ lines, empty }: { lines: string[]; empty: string }) {
  const clean = lines.map((l) => l.trim()).filter(Boolean)
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      className="overflow-hidden"
    >
      <div className="mb-1.5 max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-line bg-bg/60 px-3 py-2.5">
        {clean.length === 0 ? (
          <p className="text-[11.5px] italic text-text-subtle">{empty}</p>
        ) : (
          clean.map((p, i) => (
            <p key={i} className="text-[11.5px] leading-relaxed text-text-muted">
              {p}
            </p>
          ))
        )}
      </div>
    </motion.div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   VISTA PREVIA DEL RESULTADO.

   Antes había que aplicar la operación para ver en qué quedaba, y lo único que
   protegía era la franja de Deshacer. Esto muestra el módulo (o los dos) tal y
   como quedarán —título, subtítulo, objetivos, puntos clave y las secciones con
   su texto, en orden— SIN tocar todavía la base de datos.
   ════════════════════════════════════════════════════════════════════════════ */

export interface PreviewSection {
  id: string
  heading: string
  body: string[]
  /** Sección que no existía: el puente que redacta la IA. */
  isNew?: boolean
  hasQuiz?: boolean
  hasMedia?: boolean
}

export interface PreviewModule {
  tone: 'green' | 'magenta'
  eyebrow: string
  title: string
  subtitle?: string
  minutes: number
  objectives: string[]
  takeaways: string[]
  sections: PreviewSection[]
}

export interface PreviewLabels {
  objectives: string
  takeaways: string
  minutes: string
  sections: string
  quiz: string
  isNew: string
  emptyBody: string
  noTitle: string
}

export function SurgeryPreview({
  modules,
  labels,
}: {
  modules: PreviewModule[]
  labels: PreviewLabels
}) {
  return (
    <div className={cn('grid gap-3', modules.length > 1 && 'lg:grid-cols-2')}>
      {modules.map((m, mi) => {
        const accent = m.tone === 'green' ? 'text-brand-green' : 'text-brand-magenta'
        const border = m.tone === 'green' ? 'border-brand-green/35' : 'border-brand-magenta/35'
        const dot = m.tone === 'green' ? 'bg-brand-green' : 'bg-brand-magenta'

        return (
          <motion.article
            key={mi}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: mi * 0.06, ease: EASE }}
            className={cn('overflow-hidden rounded-2xl border bg-glass/[0.03]', border)}
          >
            {/* ── Portada del módulo ── */}
            <header className={cn('border-b px-4 py-3.5', border)}>
              <span className={cn('text-[10.5px] font-semibold uppercase tracking-wider', accent)}>
                {m.eyebrow}
              </span>
              <h4 className="mt-1 text-[15px] font-semibold leading-snug text-text">
                {m.title.trim() || <span className="italic text-text-subtle">{labels.noTitle}</span>}
              </h4>
              {m.subtitle?.trim() && (
                <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{m.subtitle}</p>
              )}
              <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-text-subtle">
                <span>
                  <span className="font-semibold text-text">{m.sections.length}</span> {labels.sections}
                </span>
                <span>
                  <span className="font-semibold text-text">{m.minutes}</span> {labels.minutes}
                </span>
              </p>
            </header>

            <div className="space-y-3 px-4 py-3.5">
              {/* ── Objetivos y puntos clave ── */}
              {m.objectives.filter(Boolean).length > 0 && (
                <section>
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-subtle">
                    {labels.objectives}
                  </p>
                  <ul className="space-y-1">
                    {m.objectives.filter(Boolean).map((o, i) => (
                      <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-text-muted">
                        <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
                        {o}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {m.takeaways.filter(Boolean).length > 0 && (
                <section>
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-subtle">
                    {labels.takeaways}
                  </p>
                  <ul className="space-y-1">
                    {m.takeaways.filter(Boolean).map((k, i) => (
                      <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-text-muted">
                        <Check className={cn('mt-0.5 h-3 w-3 shrink-0', accent)} />
                        {k}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ── El recorrido completo, con el texto de cada sección ── */}
              <section className="space-y-2">
                {m.sections.map((s, i) => {
                  const body = s.body.map((b) => b.trim()).filter(Boolean)
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'rounded-xl border px-3 py-2.5',
                        s.isNew ? 'border-brand-magenta/40 bg-brand-magenta/[0.06]' : 'border-line',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-[10.5px] tabular-nums text-text-subtle">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-text">
                          {s.heading}
                        </span>
                        {s.isNew && (
                          <span className="shrink-0 rounded-full border border-brand-magenta/40 bg-brand-magenta/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-brand-magenta">
                            {labels.isNew}
                          </span>
                        )}
                        {s.hasQuiz && (
                          <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[9.5px] text-text-subtle">
                            {labels.quiz}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 space-y-1 pl-7">
                        {body.length === 0 ? (
                          <p className="text-[11.5px] italic text-text-subtle">{labels.emptyBody}</p>
                        ) : (
                          body.map((p, bi) => (
                            <p key={bi} className="text-[11.5px] leading-relaxed text-text-muted">
                              {p}
                            </p>
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </section>
            </div>
          </motion.article>
        )
      })}
    </div>
  )
}

/** Botón de la cabecera del pliegue: tira a la basura lo que redactó la IA. */
export function DiscardAiButton({
  onDiscard,
  label,
  hint,
  disabled,
}: {
  onDiscard: () => void
  label: string
  /** Qué se pierde exactamente al descartar. */
  hint?: string
  disabled?: boolean
}) {
  return (
    <Tooltip label={hint} maxWidth={260} className="shrink-0">
    <button
      type="button"
      onClick={onDiscard}
      disabled={disabled}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30 disabled:pointer-events-none"
    >
      <Trash2 className="h-3 w-3" />
      {label}
    </button>
    </Tooltip>
  )
}

/**
 * "No me gusta, hazlo otra vez pero…".
 *
 * Volver a pulsar "Aplicar IA" repite el mismo encargo y suele devolver lo
 * mismo. Aquí se escribe qué cambiar ("más corto", "sin tecnicismos", "enfócalo
 * en el cierre de venta") y eso viaja con la petición. Gasta una operación del
 * cupo diario, igual que la primera vez.
 */
export function AiRetryRow({
  note,
  onNote,
  onRetry,
  busy,
  disabled,
  label,
  placeholder,
  button,
  tooltip,
  emptyTooltip,
}: {
  note: string
  onNote: (v: string) => void
  onRetry: () => void
  busy: boolean
  disabled?: boolean
  label: string
  placeholder: string
  button: string
  /** Qué hará al pulsarlo. */
  tooltip?: string
  /** Por qué está bloqueado mientras no se escriba nada. */
  emptyTooltip?: string
}) {
  return (
    <div className="mt-3 border-t border-brand-magenta/20 pt-3">
      <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-text-subtle">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          disabled={disabled || busy}
          placeholder={placeholder}
          onChange={(e) => onNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && note.trim() && !busy && !disabled) {
              e.preventDefault()
              onRetry()
            }
          }}
          className={cn(FIELD_BASE, 'min-w-[200px] flex-1')}
        />
        <Tooltip label={note.trim() ? tooltip : emptyTooltip} maxWidth={260} className="shrink-0">
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled || busy || !note.trim()}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-brand-magenta/35 bg-brand-magenta/10 px-3 text-[11.5px] font-semibold text-brand-magenta transition-colors hover:bg-brand-magenta/[0.18] disabled:opacity-40 disabled:pointer-events-none"
        >
          <motion.span
            animate={busy ? { rotate: 360 } : { rotate: 0 }}
            transition={busy ? { duration: 1.2, repeat: Infinity, ease: 'linear' } : { duration: 0.2 }}
          >
            <RefreshCw className="h-3 w-3" />
          </motion.span>
          {button}
        </button>
        </Tooltip>
      </div>
    </div>
  )
}
