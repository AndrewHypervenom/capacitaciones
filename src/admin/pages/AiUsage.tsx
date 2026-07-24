import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { Loader2, Search, ChevronDown, ChevronRight, Bot, Coins, Cpu, Users, AlertCircle, TrendingUp, TrendingDown, Trophy, Building2, Minus } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { FadeIn, Stagger, StaggerItem, ease } from '@/components/ui/motion'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { motion } from 'framer-motion'
import {
  fetchAiUsage, fetchAiUsageUsers, functionLabel, functionColor, FUNCTION_META,
  type AiUsageData, type AiUsageFilters, type AiUsageRow, type UserOption, type TimePoint, type Breakdown,
} from '@/services/aiUsage.service'
import { useAiCreditsStore, updateAiCreditsSetting, loadAiCreditsSetting } from '@/lib/aiCredits'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'

// ─── Presets de rango de fechas ──────────────────────────────────────
type Preset = 'today' | '7d' | '30d' | 'month' | 'all'

const PRESETS: { key: Preset; labelKey: string }[] = [
  { key: 'today', labelKey: 'admin.ai_usage.preset_today' },
  { key: '7d', labelKey: 'admin.ai_usage.preset_7d' },
  { key: '30d', labelKey: 'admin.ai_usage.preset_30d' },
  { key: 'month', labelKey: 'admin.ai_usage.preset_month' },
  { key: 'all', labelKey: 'admin.ai_usage.preset_all' },
]

function rangeFor(preset: Preset): { from?: string } {
  const now = new Date()
  const start = new Date(now)
  switch (preset) {
    case 'today': start.setHours(0, 0, 0, 0); return { from: start.toISOString() }
    case '7d': start.setDate(now.getDate() - 6); start.setHours(0, 0, 0, 0); return { from: start.toISOString() }
    case '30d': start.setDate(now.getDate() - 29); start.setHours(0, 0, 0, 0); return { from: start.toISOString() }
    case 'month': return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
    case 'all': return {}
  }
}

const MODEL_OPTIONS = [
  { value: 'all', labelKey: 'admin.ai_usage.model_all' },
  { value: 'claude-sonnet-4-6', labelKey: 'admin.ai_usage.model_sonnet' },
  { value: 'claude-haiku-4-5', labelKey: 'admin.ai_usage.model_haiku' },
]

// ─── Formateo ────────────────────────────────────────────────────────
function fmtUsd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
function fmtInt(n: number): string {
  return n.toLocaleString(i18n.language)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtDayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' })
}

export default function AiUsage() {
  const { t } = useTranslation()
  const [preset, setPreset] = useState<Preset>('30d')
  const [functionName, setFunctionName] = useState<string>('all')
  const [model, setModel] = useState<string>('all')
  const [userId, setUserId] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [data, setData] = useState<AiUsageData | null>(null)
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [metric, setMetric] = useState<ChartMetric>('cost')

  // Opciones de usuario (una vez).
  useEffect(() => {
    fetchAiUsageUsers().then(setUsers).catch((e) => console.error('ai usage users error:', e))
  }, [])

  // Datos: recargan al cambiar cualquier filtro.
  useEffect(() => {
    let alive = true
    setLoading(true)
    const filters: AiUsageFilters = { functionName, model, userId, search, ...rangeFor(preset) }
    fetchAiUsage(filters)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => console.error('ai usage error:', e))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [preset, functionName, model, userId, search])

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{t('admin.ai_usage.title')}</h1>
        <p className="text-[13px] text-text-muted">
          {t('admin.ai_usage.subtitle')}
        </p>
      </div>

      <AiCreditsToggleCard />


      {/* ── Filtros ── */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Rango de fechas */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = preset === p.key
            return (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active
                    ? 'border-[rgb(var(--brand-green))] text-[rgb(var(--brand-green))] bg-[rgb(var(--brand-green))]/10'
                    : 'border-line text-text-muted hover:text-text hover:border-glass-border/30'
                }`}
              >
                {t(p.labelKey)}
              </button>
            )
          })}
        </div>

        {/* Función + modelo + usuario + búsqueda */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Select
            className="sm:w-auto sm:min-w-[180px]"
            value={functionName}
            onChange={setFunctionName}
            options={[
              { value: 'all', label: t('admin.ai_usage.filter_all_types') },
              ...Object.entries(FUNCTION_META).map(([key, m]) => ({
                value: key,
                label: `${m.icon} ${m.label}`,
              })),
            ]}
          />

          <Select
            className="sm:w-auto sm:min-w-[160px]"
            value={model}
            onChange={setModel}
            options={MODEL_OPTIONS.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
          />

          <Select
            className="sm:w-auto sm:min-w-[200px] sm:max-w-[200px]"
            value={userId}
            onChange={setUserId}
            options={[
              { value: 'all', label: t('admin.ai_usage.filter_all_users') },
              ...users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />

          <form
            className="relative sm:max-w-xs w-full"
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput) }}
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/70" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('admin.ai_usage.search_ph')}
              className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-muted/60 outline-none focus:border-[rgb(var(--brand-green))]/40 transition-colors"
            />
          </form>
        </div>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          <Stagger as="section" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5" gap={0.06}>
            <KpiCard icon={Coins} label={t('admin.ai_usage.kpi_cost')} color="#22c55e"
              value={<AnimatedNumber value={data.kpis.costUsd} format={fmtUsd} />}
              delta={data.kpis.costDeltaPct}
              footer={data.kpis.avgPerDay > 0 ? t('admin.ai_usage.kpi_avg_day', { v: fmtUsd(data.kpis.avgPerDay) }) : undefined}
            />
            <KpiCard icon={Bot} label={t('admin.ai_usage.kpi_calls')} color="#8b5cf6"
              value={<AnimatedNumber value={data.kpis.calls} format={(n) => fmtInt(Math.round(n))} />} />
            <KpiCard icon={Cpu} label={t('admin.ai_usage.kpi_tokens')} color="#06b6d4"
              value={<AnimatedNumber value={data.kpis.tokens} format={(n) => fmtTokens(Math.round(n))} />} />
            <KpiCard icon={Users} label={t('admin.ai_usage.kpi_active_users')} color="#f59e0b"
              value={<AnimatedNumber value={data.kpis.activeUsers} format={(n) => fmtInt(Math.round(n))} />} />
          </Stagger>

          {/* ── Línea de tiempo histórica ── */}
          <FadeIn as="section" className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-5" y={12}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.ai_usage.chart_title')}</h3>
                <div className="mt-1 text-[13px] text-text-muted">
                  {t('admin.ai_usage.total_label')}{' '}
                  <span className="text-text font-semibold tabular-nums">
                    {metric === 'cost' ? fmtUsd(data.kpis.costUsd) : metric === 'calls' ? fmtInt(data.kpis.calls) : fmtTokens(data.kpis.tokens)}
                  </span>
                </div>
              </div>
              {/* Selector de métrica */}
              <div className="flex gap-1 rounded-xl border border-line p-0.5">
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                      metric === m.key ? 'bg-subtle text-text' : 'text-text-muted hover:text-text',
                    )}
                  >
                    {t(m.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            {data.timeseries.length === 0 ? (
              <div className="text-[13px] text-text-muted py-10 text-center">{t('admin.ai_usage.no_data_range')}</div>
            ) : (
              <TrendChart points={data.timeseries} metric={metric} />
            )}
          </FadeIn>

          {/* ── Quién consumió + Qué campaña ── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <Leaderboard
              title={t('admin.ai_usage.top_users')} icon={Trophy}
              rows={data.topUsers} totalCost={data.kpis.costUsd}
              empty={t('admin.ai_usage.no_data')} ranked
            />
            <Leaderboard
              title={t('admin.ai_usage.by_campaign')} icon={Building2}
              rows={data.byCampaign} totalCost={data.kpis.costUsd}
              empty={t('admin.ai_usage.no_data')}
            />
          </section>

          {/* ── Desgloses ── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <BreakdownCard title={t('admin.ai_usage.breakdown_by_type')} rows={data.byFunction} totalCost={data.kpis.costUsd} />
            <BreakdownCard title={t('admin.ai_usage.breakdown_by_model')} rows={data.byModel} totalCost={data.kpis.costUsd} />
          </section>

          {/* ── Feed ── */}
          {data.rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
              <Bot className="h-7 w-7 text-text-subtle mx-auto mb-3" />
              <div className="text-[15px] font-medium text-text mb-1">{t('admin.ai_usage.empty_title')}</div>
              <div className="text-[13px] text-text-muted">{t('admin.ai_usage.empty_desc')}</div>
            </div>
          ) : (
            <>
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-2">{t('admin.ai_usage.detail_count', { n: fmtInt(data.rows.length) })}</h3>
              <div className="rounded-2xl border border-line overflow-hidden divide-y divide-line">
                {data.rows.map((r) => (
                  <FeedItem key={r.id} row={r} open={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
                ))}
              </div>
              {data.truncated && (
                <p className="text-center text-[11.5px] text-text-subtle mt-3">
                  {t('admin.ai_usage.truncated')}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Métricas del gráfico de línea de tiempo ─────────────────────────
type ChartMetric = 'cost' | 'calls' | 'tokens'
const METRICS: { key: ChartMetric; labelKey: string }[] = [
  { key: 'cost', labelKey: 'admin.ai_usage.metric_cost' },
  { key: 'calls', labelKey: 'admin.ai_usage.metric_calls' },
  { key: 'tokens', labelKey: 'admin.ai_usage.metric_tokens' },
]
const metricValue = (p: TimePoint, m: ChartMetric) => m === 'cost' ? p.costUsd : m === 'calls' ? p.calls : p.tokens
const metricColor = (m: ChartMetric) => m === 'cost' ? '#22c55e' : m === 'calls' ? '#8b5cf6' : '#06b6d4'
function fmtMetric(v: number, m: ChartMetric) {
  return m === 'cost' ? fmtUsd(v) : m === 'calls' ? fmtInt(v) : fmtTokens(v)
}

// ─── Componentes ─────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, color, delta, footer }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  color: string
  delta?: number | null
  footer?: string
}) {
  return (
    <StaggerItem className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-2 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate">{label}</span>
      </div>
      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-text">{value}</span>
      <div className="flex items-center gap-2 min-h-[16px]">
        {delta != null && <DeltaChip pct={delta} />}
        {footer && <span className="text-[11px] text-text-subtle truncate">{footer}</span>}
      </div>
    </StaggerItem>
  )
}

/** Chip de variación vs período anterior: verde si bajó el gasto, rojo si subió. */
function DeltaChip({ pct }: { pct: number }) {
  const { t } = useTranslation()
  const flat = Math.abs(pct) < 1
  const up = pct > 0
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  // Subir el costo es "malo" (rojo); bajarlo es "bueno" (verde).
  const color = flat ? 'text-text-subtle' : up ? 'text-rose-500' : 'text-emerald-500'
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums', color)}
      title={t('admin.ai_usage.vs_prev')}>
      <Icon className="h-3 w-3" />
      {flat ? '±0%' : `${up ? '+' : ''}${Math.round(pct)}%`}
    </span>
  )
}

/**
 * Curva suave con interpolación MONÓTONA (Fritsch-Carlson): pasa por todos los
 * puntos sin sobrepasarse. Clave con outliers fuertes (p. ej. el día que se
 * dispara el gasto): una spline cardinal se pasaría de largo e inventaría ondas.
 */
function smoothLine(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`
  const f = (v: number) => v.toFixed(1)
  if (n === 2) return `M ${f(pts[0].x)} ${f(pts[0].y)} L ${f(pts[1].x)} ${f(pts[1].y)}`

  const dx: number[] = [], dy: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    dy[i] = pts[i + 1].y - pts[i].y
    m[i] = dy[i] / (dx[i] || 1)
  }
  const t = new Array(n)
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i]
    const h = Math.hypot(a, b)
    if (h > 3) { const k = 3 / h; t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  const d = [`M ${f(pts[0].x)} ${f(pts[0].y)}`]
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3, y1 = pts[i].y + t[i] * dx[i] / 3
    const x2 = pts[i + 1].x - dx[i] / 3, y2 = pts[i + 1].y - t[i + 1] * dx[i] / 3
    d.push(`C ${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(pts[i + 1].x)} ${f(pts[i + 1].y)}`)
  }
  return d.join(' ')
}

/** Gráfico de línea de tiempo: área + curva suave animada, con hover y selector de métrica. */
function TrendChart({ points, metric }: { points: TimePoint[]; metric: ChartMetric }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<number | null>(null)
  const color = metricColor(metric)
  const W = 1000, H = 160, padTop = 26, padBottom = 8

  const { coords, line, area, max } = useMemo(() => {
    const vals = points.map((p) => metricValue(p, metric))
    const mx = Math.max(1e-9, ...vals)
    const n = points.length
    const xAt = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
    const yAt = (v: number) => H - padBottom - (v / mx) * (H - padTop - padBottom)
    const cs = points.map((p, i) => ({ x: xAt(i), y: yAt(metricValue(p, metric)) }))
    const ln = smoothLine(cs)
    const last = cs[cs.length - 1], first = cs[0]
    const ar = `${ln} L ${last.x.toFixed(1)} ${H} L ${first.x.toFixed(1)} ${H} Z`
    return { coords: cs, line: ln, area: ar, max: mx }
  }, [points, metric])

  const n = points.length
  const gid = `ai-grad-${metric}`
  const last = coords[n - 1]
  const hp = hover != null ? points[hover] : null
  const hc = hover != null ? coords[hover] : null
  // Tooltip: arriba del punto salvo que el punto esté muy arriba (entonces, abajo).
  const tipBelow = hc ? (hc.y / H) < 0.32 : false

  return (
    <div className="relative">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-52">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.14" />
              <stop offset="60%" stopColor={color} stopOpacity="0.03" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
            {/* Reveal izquierda→derecha robusto (no depende de pathLength, que con
                el escalado no uniforme dejaba el trazo a medias). */}
            <clipPath id={`${gid}-clip`}>
              <motion.rect x="0" y="0" height={H}
                initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: 1, ease }} />
            </clipPath>
          </defs>
          {/* Rejilla base */}
          {[0, 0.5, 1].map((f) => {
            const y = padTop + f * (H - padTop - padBottom)
            return <line key={f} x1="0" x2={W} y1={y} y2={y}
              stroke="currentColor" className="text-line" strokeWidth="1" strokeDasharray="3 7" opacity="0.6" />
          })}
          <g clipPath={`url(#${gid}-clip)`}>
            <path d={area} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>

        {/* Valor máximo del eje (referencia) */}
        <span className="pointer-events-none absolute left-0 top-0 text-[10.5px] text-text-subtle tabular-nums">
          {fmtMetric(max, metric)}
        </span>

        {/* Punto final siempre visible */}
        <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
          style={{ left: `${(last.x / W) * 100}%`, top: `${(last.y / H) * 100}%`, background: color }} />

        {/* Guía + punto activo (solo en hover) */}
        {hc && (
          <>
            <span className="pointer-events-none absolute top-0 bottom-0 w-px" style={{ left: `${(hc.x / W) * 100}%`, background: `${color}66` }} />
            <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 shadow"
              style={{ left: `${(hc.x / W) * 100}%`, top: `${(hc.y / H) * 100}%`, background: color, boxShadow: `0 0 0 4px ${color}22` }} />
          </>
        )}

        {/* Tooltip (solo en hover). Se ancla a la guía: centrado, pero pegado a la
            izquierda/derecha cerca de los bordes para no despegarse del cursor. */}
        {hp && hc && (() => {
          const px = (hc.x / W) * 100
          const tx = px > 72 ? 'calc(-100% - 10px)' : px < 28 ? '10px' : '-50%'
          return (
            <div className="pointer-events-none absolute z-10"
              style={{
                left: `${px}%`,
                transform: `translateX(${tx})`,
                top: tipBelow ? `${(hc.y / H) * 100 + 6}%` : undefined,
                bottom: tipBelow ? undefined : `${100 - (hc.y / H) * 100 + 6}%`,
              }}>
              <div className="whitespace-nowrap rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[11px] shadow-lg">
                <div className="font-semibold text-text">{fmtDayLabel(hp.day)}</div>
                <div className="tabular-nums font-semibold" style={{ color }}>{fmtMetric(metricValue(hp, metric), metric)}</div>
                {metric !== 'cost' && <div className="text-text-muted tabular-nums">{fmtUsd(hp.costUsd)}</div>}
                <div className="text-text-muted tabular-nums">{hp.calls} {t('admin.ai_usage.calls_suffix')}</div>
              </div>
            </div>
          )
        })()}

        {/* Superficie de hover: elige el punto MÁS CERCANO a la posición real del
            cursor (los puntos no están centrados en columnas iguales, así que un
            flex por punto desalineaba la guía respecto del cursor). */}
        <div
          className="absolute inset-0 cursor-crosshair"
          onMouseMove={(e) => {
            if (n <= 1) { setHover(0); return }
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = (e.clientX - rect.left) / rect.width
            setHover(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))))
          }}
          onMouseLeave={() => setHover(null)}
        />
      </div>

      {/* Eje X: primer, medio y último día */}
      {n > 1 && (
        <div className="flex justify-between mt-2.5 text-[10.5px] text-text-subtle tabular-nums">
          <span>{fmtDayLabel(points[0].day)}</span>
          {n > 2 && <span>{fmtDayLabel(points[Math.floor(n / 2)].day)}</span>}
          <span>{fmtDayLabel(points[n - 1].day)}</span>
        </div>
      )}
    </div>
  )
}

/** Ranking (quién consumió / qué campaña) con barras animadas y % de participación. */
function Leaderboard({ title, icon: Icon, rows, totalCost, empty, ranked }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  rows: Breakdown[]
  totalCost: number
  empty: string
  ranked?: boolean
}) {
  const maxCost = Math.max(1e-9, ...rows.map((r) => r.costUsd))
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h3 className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-muted mb-4">
        <Icon className="h-3.5 w-3.5" /> {title}
      </h3>
      {rows.length === 0 ? (
        <div className="text-[13px] text-text-muted py-2">{empty}</div>
      ) : (
        <Stagger className="space-y-3.5" gap={0.05}>
          {rows.map((r, i) => {
            const share = totalCost > 0 ? Math.round((r.costUsd / totalCost) * 100) : 0
            const barPct = Math.max(2, (r.costUsd / maxCost) * 100)
            return (
              <StaggerItem key={r.key} className="flex items-center gap-3">
                {ranked && <RankBadge i={i} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-[13px] mb-1">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                      <span className="text-text truncate">{r.label}</span>
                      {r.sublabel && <span className="text-text-subtle text-[11px] truncate hidden sm:inline">· {r.sublabel}</span>}
                    </span>
                    <span className="text-text-muted tabular-nums shrink-0">
                      <span className="text-text font-semibold">{fmtUsd(r.costUsd)}</span>
                      <span className="text-text-subtle"> · {share}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-subtle overflow-hidden">
                    <motion.div className="h-full rounded-full"
                      style={{ background: r.color }}
                      initial={{ width: 0 }} animate={{ width: `${barPct}%` }}
                      transition={{ duration: 0.8, ease, delay: 0.05 * i }} />
                  </div>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </div>
  )
}

/** Medalla para top-3, número para el resto. */
function RankBadge({ i }: { i: number }) {
  const medals = ['#fbbf24', '#cbd5e1', '#d97757'] // oro, plata, bronce
  const isMedal = i < 3
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums',
        isMedal ? 'text-white' : 'bg-subtle text-text-muted',
      )}
      style={isMedal ? { background: medals[i] } : undefined}
    >
      {i + 1}
    </span>
  )
}

function BreakdownCard({ title, rows, totalCost }: {
  title: string
  rows: { key: string; label: string; color: string; calls: number; costUsd: number; tokens: number }[]
  totalCost: number
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-4">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-[13px] text-text-muted py-2">{i18n.t('admin.ai_usage.no_data')}</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const pct = totalCost > 0 ? Math.round((r.costUsd / totalCost) * 100) : 0
            return (
              <div key={r.key}>
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span className="flex items-center gap-2 text-text truncate">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className="text-text-muted tabular-nums shrink-0 ml-2">
                    {fmtUsd(r.costUsd)} · {fmtInt(r.calls)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-subtle overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FeedItem({ row, open, onToggle }: { row: AiUsageRow; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const color = functionColor(row.function_name)
  const meta = FUNCTION_META[row.function_name]
  const title = String(row.metadata?.title ?? '') || row.operation || '—'
  const tokens =
    row.input_tokens + row.output_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens

  return (
    <div>
      <button
        className="w-full grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3 items-center text-left hover:bg-subtle/50 transition-colors"
        onClick={onToggle}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10.5px] font-medium shrink-0" style={{ background: `${color}1a`, color }}>
          <span>{meta?.icon ?? '•'}</span>
          <span className="hidden sm:inline">{functionLabel(row.function_name)}</span>
        </span>
        <div className="min-w-0">
          <div className="text-[13px] text-text truncate">{title}</div>
          <div className="text-[11px] text-text-muted truncate">
            {row.display_name ?? t('admin.ai_usage.user_fallback')}{row.operation ? ` · ${row.operation}` : ''} · {fmtDate(row.created_at)}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[12px] font-semibold tabular-nums text-text">{fmtUsd(Number(row.cost_usd) || 0)}</span>
          {open ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 bg-subtle/40 border-t border-line">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-[12px]">
            <Field label={t('admin.ai_usage.field_model')} value={row.model || '—'} />
            <Field label={t('admin.ai_usage.field_tokens')} value={fmtInt(tokens)} />
            <Field label={t('admin.ai_usage.field_in_out')} value={`${fmtInt(row.input_tokens)} / ${fmtInt(row.output_tokens)}`} />
            <Field label={t('admin.ai_usage.field_cache')} value={`${fmtInt(row.cache_creation_input_tokens)} / ${fmtInt(row.cache_read_input_tokens)}`} />
          </div>
          {row.metadata && Object.keys(row.metadata).length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t('admin.ai_usage.context')}</div>
              <pre className="text-[11.5px] text-text whitespace-pre-wrap break-words leading-relaxed">{JSON.stringify(row.metadata, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">{label}</div>
      <div className="text-[12.5px] text-text tabular-nums break-words">{value}</div>
    </div>
  )
}

/**
 * Toggle global "IA sin créditos". Solo superadmin llega a esta página, así que
 * aquí sí puede prender/apagar el ajuste que ven todos los capacitadores.
 */
function AiCreditsToggleCard() {
  const { t } = useTranslation()
  const manualOut = useAiCreditsStore((s) => s.manualOut)
  const detectedOut = useAiCreditsStore((s) => s.detectedOut)
  const [saving, setSaving] = useState(false)

  // Refresca desde la base al abrir la página (por si otro superadmin lo cambió).
  useEffect(() => { void loadAiCreditsSetting() }, [])

  const toggle = async () => {
    if (saving) return
    setSaving(true)
    try {
      await updateAiCreditsSetting(!manualOut)
      toast.success(t('ai_credits.toggle_saved'))
    } catch {
      toast.error(t('ai_credits.toggle_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={cn(
      'rounded-2xl border p-5 sm:p-6 mb-5 transition-colors',
      manualOut ? 'border-amber-500/30 bg-amber-500/[0.05]' : 'border-line bg-surface',
    )}>
      <div className="flex items-start gap-3">
        <span className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          manualOut ? 'bg-amber-500/15 text-amber-500' : 'bg-[rgb(var(--brand-green))]/12 text-[rgb(var(--brand-green))]',
        )}>
          {manualOut ? <AlertCircle className="h-4 w-4" /> : <Coins className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-text">{t('ai_credits.toggle_title')}</h3>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
              manualOut ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-[rgb(var(--brand-green))]/12 text-[rgb(var(--brand-green))]',
            )}>
              {manualOut ? t('ai_credits.toggle_on') : t('ai_credits.toggle_off')}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-text-muted leading-relaxed">{t('ai_credits.toggle_desc')}</p>
          {detectedOut && !manualOut && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-amber-500">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {t('ai_credits.toggle_detected')}
            </p>
          )}
        </div>

        {/* Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={manualOut}
          aria-label={t('ai_credits.toggle_label')}
          onClick={toggle}
          disabled={saving}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
            manualOut ? 'bg-amber-500' : 'bg-glass/25',
          )}
        >
          <span className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            manualOut ? 'left-[22px]' : 'left-0.5',
          )} />
        </button>
      </div>
    </section>
  )
}
