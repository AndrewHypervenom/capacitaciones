import { useState, type ReactNode } from 'react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/components/ui/Tooltip'

/* ────────────────────────────────────────────────────────────────────────
   "Chrome" premium compartido por las vistas de Progreso (Módulos, Mundos,
   Simulaciones). Da un lenguaje visual único: encabezado con chip de degradado,
   tarjetas KPI con ícono y acento, y una franja de "insight" accionable.
   Los acentos se pasan como color CSS (hex o rgb(var(--brand-*))); los tintes
   se calculan con color-mix para que funcionen con variables de tema.
   ──────────────────────────────────────────────────────────────────────── */

/** Tinte translúcido de un color CSS arbitrario (sirve para rgb(var(--...))). */
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`
/** Mezcla hacia negro para el segundo stop del degradado del chip. */
const darken = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, #000)`


/* ────────────────────────────────────────────────────────────────────────
   La TIRA de cifras.
   Reemplaza a la rejilla de nueve tarjetas que ocupaba la primera pantalla
   entera. El problema no era que las cifras sobraran: era que empujaban la
   tabla fuera de vista, así que al pulsar una para filtrar "no pasaba nada"
   — pasaba novecientos píxeles más abajo.
   Aquí cada cifra sigue siendo clicable y filtra igual, pero la tabla queda
   inmediatamente debajo y el filtro se ve al instante. Las cifras de segunda
   fila viven detrás de un desplegable: no se borran, se ordenan.
   ──────────────────────────────────────────────────────────────────────── */

export interface StatItem {
  key: string
  label: string
  /** Ya formateado: "793", "6%", "—". */
  value: string
  /** La línea pequeña de debajo. Opcional pero es lo que da el contexto. */
  hint?: string
  accent?: string
  /** Si se pasa, la cifra es un filtro y se puede pulsar. */
  onClick?: () => void
  /** Filtro aplicado ahora mismo. */
  active?: boolean
}

export function StatStrip({
  items, secondary, loading, moreLabel, lessLabel,
}: {
  items: StatItem[]
  /** Cifras de segundo plano: se muestran al desplegar. */
  secondary?: StatItem[]
  loading?: boolean
  moreLabel: string
  lessLabel: string
}) {
  const [open, setOpen] = useState(false)
  const pintar = (x: StatItem) => {
    const clicable = Boolean(x.onClick)
    return (
      <button
        key={x.key}
        type="button"
        onClick={x.onClick}
        disabled={!clicable}
        aria-pressed={clicable ? Boolean(x.active) : undefined}
        className={cn(
          'group flex min-w-0 flex-1 basis-[150px] flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition-colors',
          clicable && 'hover:bg-glass/6',
          !clicable && 'cursor-default',
          x.active && 'bg-glass/8',
        )}
        style={x.active && x.accent ? { boxShadow: `inset 0 0 0 1px ${tint(x.accent, 45)}` } : undefined}
      >
        <span className="flex items-baseline gap-1.5">
          <span
            className="text-[20px] font-semibold leading-none tabular-nums"
            style={{ color: x.accent ?? 'var(--text)' }}
          >
            {loading ? '·' : x.value}
          </span>
          <span className="truncate text-[12px] font-medium text-text">{x.label}</span>
        </span>
        {x.hint && (
          /* Dos líneas como techo: el contexto ayuda, pero un párrafo dentro de
             una tira la convierte otra vez en un muro. */
          <span className="line-clamp-2 text-[11px] leading-snug text-text-subtle">{x.hint}</span>
        )}
      </button>
    )
  }

  return (
    <div className="mb-4 rounded-2xl border border-line bg-subtle/40">
      <div className="flex flex-wrap items-stretch gap-1 p-1.5">{items.map(pintar)}</div>
      {secondary && secondary.length > 0 && (
        <>
          {open && (
            <div className="flex flex-wrap items-stretch gap-1 border-t border-line px-1.5 pb-1.5 pt-1.5">
              {secondary.map(pintar)}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-line py-1.5 text-[11px] text-text-subtle transition-colors hover:text-text"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            {open ? lessLabel : moreLabel}
          </button>
        </>
      )}
    </div>
  )
}

/** Encabezado de panel: chip de degradado + título + subtítulo + acciones. */
export function PanelHeader({
  icon, title, subtitle, accent = 'rgb(var(--brand-green))', actions,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  accent?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5 sm:mb-6">
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          className="grid h-11 w-11 sm:h-12 sm:w-12 place-items-center rounded-2xl shrink-0 text-white shadow-lg"
          style={{ background: `linear-gradient(135deg, ${accent}, ${darken(accent, 72)})`, boxShadow: `0 8px 22px -8px ${tint(accent, 55)}` }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          {/* Ni `truncate` ni `line-clamp`: el título y el subtítulo de un panel
              son la única explicación de lo que se está mirando. */}
          <h1 className="text-[20px] sm:text-[25px] font-bold text-text leading-tight tracking-tight">{title}</h1>
          <p className="text-[12.5px] sm:text-[13px] text-text-muted mt-1 leading-snug">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * Fila de KPIs. Se estrecha por pasos (1 → 2 → 3 → 4) en vez de mantener cuatro
 * columnas siempre: con cuatro fijas, en un portátil la etiqueta no cabía y
 * terminaba recortada a media palabra.
 */
export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rise-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-5', className)}>
      {children}
    </div>
  )
}

/**
 * Tarjeta KPI premium, con el mismo lenguaje que el Panorama de Módulos:
 *
 * · El ícono va anclado arriba a la derecha y NO le quita ancho al texto.
 * · La etiqueta se parte en dos líneas antes que recortarse.
 * · Al pasar por encima, el tooltip da el nombre completo y qué mide; si la
 *   métrica está definida por una norma, la referencia va al pie, discreta.
 * · Si es clicable, filtra: un KPI que no lleva a ninguna parte es un adorno.
 */
export function Kpi({
  icon, label, value, sub, accent = 'rgb(var(--brand-green))', highlight,
  hint, frame, onClick, active,
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  accent?: string
  /** Resalta el valor con el acento (para el KPI principal). */
  highlight?: boolean
  /** Qué mide exactamente y cómo se calcula (va al tooltip y bajo el número). */
  hint?: string
  /** Referencia de la norma. Solo al pie del tooltip, nunca como sello visible. */
  frame?: string
  onClick?: () => void
  active?: boolean
}) {
  const Tag: React.ElementType = onClick ? 'button' : 'div'
  return (
    <Tooltip
      anchor="element"
      delay={120}
      maxWidth={290}
      className="h-full w-full"
      label={
        <span className="block">
          <span className="block font-semibold">{label}</span>
          {hint && <span className="mt-0.5 block opacity-80">{hint}</span>}
          {frame && <span className="mt-1 block text-[10.5px] uppercase tracking-wider opacity-70">{frame}</span>}
        </span>
      }
    >
      <Tag
        onClick={onClick}
        type={onClick ? 'button' : undefined}
        aria-pressed={onClick ? !!active : undefined}
        className={cn(
          'group relative h-full w-full overflow-hidden rounded-3xl border bg-surface p-5 text-left transition-all duration-500 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover',
          onClick && 'cursor-pointer',
          active || highlight ? '' : 'border-line',
        )}
        style={{ borderColor: active ? tint(accent, 55) : highlight ? tint(accent, 35) : undefined }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full blur-2xl opacity-[0.10] group-hover:opacity-25 transition-opacity"
          style={{ background: accent }}
        />
        <span
          className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-2xl text-white shadow-lg transition-transform duration-500 ease-apple group-hover:scale-110 group-hover:-rotate-3"
          style={{
            background: `linear-gradient(135deg, ${accent}, ${darken(accent, 65)})`,
            boxShadow: `0 10px 24px -12px ${tint(accent, 70)}`,
          }}
        >
          {icon}
        </span>

        <div className="relative min-w-0">
          <p className="min-h-[2.1em] pr-12 text-[10.5px] font-bold uppercase leading-tight tracking-[0.06em] text-text-muted">
            {label}
          </p>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span
              className="text-[30px] font-bold leading-none tracking-tight text-text tabular-nums"
              style={highlight ? { color: accent } : undefined}
            >
              {value}
            </span>
            {sub && <span className="text-[12px] text-text-muted tabular-nums">{sub}</span>}
          </div>
          {hint && (
            <p className="mt-2 line-clamp-2 text-[11.5px] leading-snug text-text-muted [overflow-wrap:anywhere]">{hint}</p>
          )}
        </div>
      </Tag>
    </Tooltip>
  )
}

/** Franja de "insight" accionable (p. ej. aprendices en riesgo → filtrar). */
export function InsightBanner({
  icon, title, detail, actionLabel, onAction, accent = '#ef4444',
}: {
  icon: ReactNode
  title: string
  detail?: string
  actionLabel?: string
  onAction?: () => void
  accent?: string
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border px-4 py-3 mb-4 sm:mb-5"
      style={{ borderColor: tint(accent, 30), background: tint(accent, 6) }}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: tint(accent, 15), color: accent }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">{title}</div>
        {detail && <div className="mt-0.5 text-[12px] leading-snug text-text-muted">{detail}</div>}
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="shrink-0 inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-transform hover:translate-x-0.5"
          style={{ background: tint(accent, 14), color: accent }}
        >
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
