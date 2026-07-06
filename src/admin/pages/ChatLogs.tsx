import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ChevronDown, ChevronRight, Zap, Bot, HelpCircle, MessageSquare } from 'lucide-react'
import {
  fetchHelpKpis, fetchHelpLogs, fetchTopUnanswered,
  type HelpKpis, type HelpLogRow, type HelpLogSource,
} from '@/services/helpLog.service'

const SOURCE_META: Record<HelpLogSource, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  faq:      { label: 'Respuesta rápida', color: '#22c55e', icon: Zap },
  ai:       { label: 'IA',               color: '#8b5cf6', icon: Bot },
  no_match: { label: 'Sin respuesta',    color: '#ef4444', icon: HelpCircle },
}

type FilterSource = HelpLogSource | 'all'

const FEED_LIMIT = 200

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ChatLogs() {
  const [kpis, setKpis] = useState<HelpKpis | null>(null)
  const [gaps, setGaps] = useState<{ label: string; count: number }[]>([])
  const [rows, setRows] = useState<HelpLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [feedLoading, setFeedLoading] = useState(false)
  const [source, setSource] = useState<FilterSource>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Carga inicial: KPIs + vacíos de conocimiento.
  useEffect(() => {
    let alive = true
    Promise.all([fetchHelpKpis(), fetchTopUnanswered(8)])
      .then(([k, g]) => { if (alive) { setKpis(k); setGaps(g) } })
      .catch((e) => console.error('help kpis error:', e))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // Feed: recarga al cambiar filtro/búsqueda.
  useEffect(() => {
    let alive = true
    setFeedLoading(true)
    fetchHelpLogs({ source, search, limit: FEED_LIMIT })
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => console.error('help logs error:', e))
      .finally(() => { if (alive) setFeedLoading(false) })
    return () => { alive = false }
  }, [source, search])

  const pct = (n: number) => (kpis && kpis.total > 0 ? Math.round((n / kpis.total) * 100) : 0)

  const chips: { key: FilterSource; label: string; color?: string; count?: number }[] = useMemo(() => [
    { key: 'all', label: 'Todas', count: kpis?.total },
    { key: 'faq', label: SOURCE_META.faq.label, color: SOURCE_META.faq.color, count: kpis?.faq },
    { key: 'ai', label: SOURCE_META.ai.label, color: SOURCE_META.ai.color, count: kpis?.ai },
    { key: 'no_match', label: SOURCE_META.no_match.label, color: SOURCE_META.no_match.color, count: kpis?.no_match },
  ], [kpis])

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">Chat de ayuda</h1>
        <p className="text-[13px] text-text-muted">Historial y analítica del asistente: qué preguntan, qué se resuelve solo y qué usó IA.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-5">
            <KpiCard label="Consultas totales" value={String(kpis?.total ?? 0)} />
            <KpiCard label="Respuesta rápida" value={`${pct(kpis?.faq ?? 0)}%`} sub={`${kpis?.faq ?? 0}`} color={SOURCE_META.faq.color} />
            <KpiCard label="Resueltas con IA" value={`${pct(kpis?.ai ?? 0)}%`} sub={`${kpis?.ai ?? 0}`} color={SOURCE_META.ai.color} />
            <KpiCard label="Sin respuesta" value={`${pct(kpis?.no_match ?? 0)}%`} sub={`${kpis?.no_match ?? 0}`} color={SOURCE_META.no_match.color} />
          </section>

          {/* ── Vacíos de conocimiento ── */}
          {gaps.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-4 sm:mb-5">
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-1">Preguntas sin respuesta más frecuentes</h3>
              <p className="text-[13px] text-text-muted mb-4">Buenas candidatas para agregar a la base de respuestas rápidas y así ahorrar IA.</p>
              <div className="space-y-2">
                {gaps.map((g, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-[12px] tabular-nums text-text-subtle w-5 text-right">{i + 1}.</span>
                    <span className="text-[13px] text-text flex-1 truncate" title={g.label}>{g.label}</span>
                    <span className="text-[12px] tabular-nums text-text-muted shrink-0 rounded-full bg-subtle px-2 py-0.5">{g.count}×</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Toolbar ── */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <form
              className="relative sm:max-w-xs w-full"
              onSubmit={(e) => { e.preventDefault(); setSearch(searchInput) }}
            >
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/70" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar en las preguntas…"
                className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-muted/60 outline-none focus:border-[rgb(var(--brand-green))]/40 transition-colors"
              />
            </form>
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => {
                const active = source === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => setSource(c.key)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
                    style={active
                      ? { borderColor: c.color ?? 'rgb(var(--brand-green))', color: c.color ?? 'rgb(var(--brand-green))', background: `${c.color ?? 'rgb(var(--brand-green))'}1a` }
                      : undefined}
                  >
                    {c.color && <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />}
                    <span className={active ? '' : 'text-text-muted'}>{c.label}</span>
                    {typeof c.count === 'number' && (
                      <span className={`tabular-nums ${active ? 'opacity-80' : 'text-text-subtle'}`}>{c.count}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Feed ── */}
          {feedLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 text-text-subtle animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
              <MessageSquare className="h-7 w-7 text-text-subtle mx-auto mb-3" />
              <div className="text-[15px] font-medium text-text mb-1">Sin conversaciones</div>
              <div className="text-[13px] text-text-muted">Aún no hay registros con estos filtros.</div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-line overflow-hidden divide-y divide-line">
                {rows.map((r) => {
                  const meta = SOURCE_META[r.source]
                  const Icon = meta.icon
                  const isOpen = expanded === r.id
                  return (
                    <div key={r.id}>
                      <button
                        className="w-full grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3 items-center text-left hover:bg-subtle/50 transition-colors"
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                      >
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10.5px] font-medium shrink-0" style={{ background: `${meta.color}1a`, color: meta.color }}>
                          <Icon className="h-3 w-3" />
                          <span className="hidden sm:inline">{meta.label}</span>
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13px] text-text truncate">{r.question}</div>
                          <div className="text-[11px] text-text-muted truncate">
                            {r.display_name ?? 'Usuario'}{r.campaign_name ? ` · ${r.campaign_name}` : ''} · {fmtDate(r.created_at)}
                          </div>
                        </div>
                        {isOpen ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 bg-subtle/40 border-t border-line space-y-3">
                          <Field label="Pregunta" value={r.question} />
                          <Field label="Respuesta" value={r.answer || '—'} />
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-text-muted">
                            <span>Rol: {r.role ?? '—'}</span>
                            <span>Idioma: {r.lang ?? '—'}</span>
                            <span>Pantalla: {r.page ?? '—'}</span>
                            {r.faq_id && <span>Entrada: {r.faq_id}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {rows.length >= FEED_LIMIT && (
                <p className="text-center text-[11.5px] text-text-subtle mt-3">
                  Mostrando las {FEED_LIMIT} más recientes. Usa la búsqueda o los filtros para acotar.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-1.5">
      <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl sm:text-3xl font-bold tabular-nums" style={color ? { color } : { color: 'var(--text)' }}>{value}</span>
        {sub && <span className="text-[12px] text-text-muted tabular-nums">· {sub}</span>}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{label}</div>
      <div className="text-[13px] text-text whitespace-pre-wrap leading-relaxed">{value}</div>
    </div>
  )
}
