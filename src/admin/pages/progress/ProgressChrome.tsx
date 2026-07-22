import { type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'

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
          <h1 className="text-[20px] sm:text-[25px] font-bold text-text leading-tight truncate tracking-tight">{title}</h1>
          <p className="text-[12.5px] sm:text-[13px] text-text-muted mt-0.5 line-clamp-2">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Fila de KPIs con entrada escalonada 100% CSS (siempre queda visible). */
export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rise-stagger grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-5', className)}>
      {children}
    </div>
  )
}

/** Tarjeta KPI premium: ícono con acento, valor grande y sublínea opcional. */
export function Kpi({
  icon, label, value, sub, accent = 'rgb(var(--brand-green))', highlight,
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  accent?: string
  /** Resalta el valor con el acento (para el KPI principal). */
  highlight?: boolean
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border bg-surface p-4 sm:p-5 h-full transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover"
      style={{ borderColor: highlight ? tint(accent, 35) : undefined }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full blur-2xl opacity-[0.10] group-hover:opacity-20 transition-opacity"
        style={{ background: accent }}
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate pt-1">{label}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: tint(accent, 12), color: accent }}>
          {icon}
        </span>
      </div>
      <div className="relative mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl sm:text-[32px] font-bold text-text tabular-nums leading-none" style={highlight ? { color: accent } : undefined}>
          {value}
        </span>
        {sub && <span className="text-[12px] text-text-muted tabular-nums">{sub}</span>}
      </div>
    </div>
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
        <div className="text-[13px] font-semibold text-text truncate">{title}</div>
        {detail && <div className="text-[12px] text-text-muted truncate">{detail}</div>}
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
