import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { Loader2, Search, ChevronDown, ChevronRight, Bot, Coins, Cpu, Users, AlertCircle } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { FadeIn } from '@/components/ui/motion'
import {
  fetchAiUsage, fetchAiUsageUsers, functionLabel, functionColor, FUNCTION_META,
  type AiUsageData, type AiUsageFilters, type AiUsageRow, type UserOption,
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

  const maxCost = useMemo(
    () => Math.max(1e-9, ...(data?.timeseries.map((ts) => ts.costUsd) ?? [0])),
    [data],
  )

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
          <FadeIn as="section" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5" y={12}>
            <KpiCard icon={Bot} label={t('admin.ai_usage.kpi_calls')} value={fmtInt(data.kpis.calls)} color="#8b5cf6" />
            <KpiCard icon={Coins} label={t('admin.ai_usage.kpi_cost')} value={fmtUsd(data.kpis.costUsd)} color="#22c55e" />
            <KpiCard icon={Cpu} label={t('admin.ai_usage.kpi_tokens')} value={fmtTokens(data.kpis.tokens)} color="#06b6d4" />
            <KpiCard icon={Users} label={t('admin.ai_usage.kpi_active_users')} value={fmtInt(data.kpis.activeUsers)} color="#f59e0b" />
          </FadeIn>

          {/* ── Gráfico de costo por día ── */}
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.ai_usage.chart_title')}</h3>
              <span className="text-[12px] text-text-muted">{t('admin.ai_usage.total_label')} <span className="text-text font-semibold tabular-nums">{fmtUsd(data.kpis.costUsd)}</span></span>
            </div>
            {data.timeseries.length === 0 ? (
              <div className="text-[13px] text-text-muted py-6 text-center">{t('admin.ai_usage.no_data_range')}</div>
            ) : (
              <div className="flex items-end gap-1 h-40 overflow-x-auto">
                {data.timeseries.map((ts) => (
                  <div key={ts.day} className="flex-1 min-w-[10px] flex flex-col items-center justify-end group relative">
                    <div
                      className="w-full rounded-t bg-[rgb(var(--brand-green))]/70 group-hover:bg-[rgb(var(--brand-green))] transition-colors"
                      style={{ height: `${Math.max(2, (ts.costUsd / maxCost) * 100)}%` }}
                    />
                    <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded-lg bg-bg border border-line px-2 py-1 text-[11px] text-text shadow-lg z-10">
                      <div className="font-medium">{fmtDayLabel(ts.day)}</div>
                      <div className="text-text-muted">{fmtUsd(ts.costUsd)} · {ts.calls} {t('admin.ai_usage.calls_suffix')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {data.timeseries.length > 1 && (
              <div className="flex justify-between mt-2 text-[10.5px] text-text-subtle tabular-nums">
                <span>{fmtDayLabel(data.timeseries[0].day)}</span>
                <span>{fmtDayLabel(data.timeseries[data.timeseries.length - 1].day)}</span>
              </div>
            )}
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

// ─── Componentes ─────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-2 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate">{label}</span>
      </div>
      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-text">{value}</span>
    </div>
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
