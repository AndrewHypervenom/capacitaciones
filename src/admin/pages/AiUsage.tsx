import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ChevronDown, ChevronRight, Bot, Coins, Cpu, Users } from 'lucide-react'
import {
  fetchAiUsage, fetchAiUsageUsers, functionLabel, functionColor, FUNCTION_META,
  type AiUsageData, type AiUsageFilters, type AiUsageRow, type UserOption,
} from '@/services/aiUsage.service'

// ─── Presets de rango de fechas ──────────────────────────────────────
type Preset = 'today' | '7d' | '30d' | 'month' | 'all'

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: 'month', label: 'Este mes' },
  { key: 'all', label: 'Todo' },
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
  { value: 'all', label: 'Todos los modelos' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet (calidad)' },
  { value: 'claude-haiku-4-5', label: 'Haiku (económico)' },
]

// ─── Formateo ────────────────────────────────────────────────────────
function fmtUsd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
function fmtInt(n: number): string {
  return n.toLocaleString('es')
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtDayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: '2-digit', month: 'short' })
}

export default function AiUsage() {
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
    () => Math.max(1e-9, ...(data?.timeseries.map((t) => t.costUsd) ?? [0])),
    [data],
  )

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">Uso de IA y costos</h1>
        <p className="text-[13px] text-text-muted">
          Todo lo generado con IA: quién, qué, cuándo y cuánto costó. Los registros son de solo lectura.
        </p>
      </div>

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
                {p.label}
              </button>
            )
          })}
        </div>

        {/* Función + modelo + usuario + búsqueda */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <select
            value={functionName}
            onChange={(e) => setFunctionName(e.target.value)}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-[rgb(var(--brand-green))]/40"
          >
            <option value="all">Todos los tipos</option>
            {Object.entries(FUNCTION_META).map(([key, m]) => (
              <option key={key} value={key}>{m.icon} {m.label}</option>
            ))}
          </select>

          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-[rgb(var(--brand-green))]/40"
          >
            {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-[rgb(var(--brand-green))]/40 sm:max-w-[200px]"
          >
            <option value="all">Todos los usuarios</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>

          <form
            className="relative sm:max-w-xs w-full"
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput) }}
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/70" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por título, operación…"
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
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
            <KpiCard icon={Bot} label="Llamadas de IA" value={fmtInt(data.kpis.calls)} color="#8b5cf6" />
            <KpiCard icon={Coins} label="Costo estimado" value={fmtUsd(data.kpis.costUsd)} color="#22c55e" />
            <KpiCard icon={Cpu} label="Tokens" value={fmtTokens(data.kpis.tokens)} color="#06b6d4" />
            <KpiCard icon={Users} label="Usuarios activos" value={fmtInt(data.kpis.activeUsers)} color="#f59e0b" />
          </section>

          {/* ── Gráfico de costo por día ── */}
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted">Costo por día (USD)</h3>
              <span className="text-[12px] text-text-muted">Total: <span className="text-text font-semibold tabular-nums">{fmtUsd(data.kpis.costUsd)}</span></span>
            </div>
            {data.timeseries.length === 0 ? (
              <div className="text-[13px] text-text-muted py-6 text-center">Sin datos en este rango.</div>
            ) : (
              <div className="flex items-end gap-1 h-40 overflow-x-auto">
                {data.timeseries.map((t) => (
                  <div key={t.day} className="flex-1 min-w-[10px] flex flex-col items-center justify-end group relative">
                    <div
                      className="w-full rounded-t bg-[rgb(var(--brand-green))]/70 group-hover:bg-[rgb(var(--brand-green))] transition-colors"
                      style={{ height: `${Math.max(2, (t.costUsd / maxCost) * 100)}%` }}
                    />
                    <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded-lg bg-bg border border-line px-2 py-1 text-[11px] text-text shadow-lg z-10">
                      <div className="font-medium">{fmtDayLabel(t.day)}</div>
                      <div className="text-text-muted">{fmtUsd(t.costUsd)} · {t.calls} llamadas</div>
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
            <BreakdownCard title="Por tipo de IA" rows={data.byFunction} totalCost={data.kpis.costUsd} />
            <BreakdownCard title="Por modelo" rows={data.byModel} totalCost={data.kpis.costUsd} />
          </section>

          {/* ── Feed ── */}
          {data.rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
              <Bot className="h-7 w-7 text-text-subtle mx-auto mb-3" />
              <div className="text-[15px] font-medium text-text mb-1">Sin registros</div>
              <div className="text-[13px] text-text-muted">No hay actividad de IA con estos filtros.</div>
            </div>
          ) : (
            <>
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Detalle ({fmtInt(data.rows.length)})</h3>
              <div className="rounded-2xl border border-line overflow-hidden divide-y divide-line">
                {data.rows.map((r) => (
                  <FeedItem key={r.id} row={r} open={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
                ))}
              </div>
              {data.truncated && (
                <p className="text-center text-[11.5px] text-text-subtle mt-3">
                  Mostrando los primeros registros del rango. Acota con filtros o un rango de fechas más corto.
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
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-2">
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
        <div className="text-[13px] text-text-muted py-2">Sin datos.</div>
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
            {row.display_name ?? 'Usuario'}{row.operation ? ` · ${row.operation}` : ''} · {fmtDate(row.created_at)}
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
            <Field label="Modelo" value={row.model || '—'} />
            <Field label="Tokens" value={fmtInt(tokens)} />
            <Field label="Entrada / salida" value={`${fmtInt(row.input_tokens)} / ${fmtInt(row.output_tokens)}`} />
            <Field label="Caché (write/read)" value={`${fmtInt(row.cache_creation_input_tokens)} / ${fmtInt(row.cache_read_input_tokens)}`} />
          </div>
          {row.metadata && Object.keys(row.metadata).length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Contexto</div>
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
