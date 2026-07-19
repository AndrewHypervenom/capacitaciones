import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { Loader2, Search, ChevronDown, ChevronRight, Zap, Bot, HelpCircle, MessageSquare } from 'lucide-react'
import {
  fetchHelpKpis, fetchHelpLogs, fetchTopUnanswered,
  type HelpKpis, type HelpLogRow, type HelpLogSource,
} from '@/services/helpLog.service'
import { FadeIn } from '@/components/ui/motion'

const SOURCE_META: Record<HelpLogSource, { labelKey: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  faq:      { labelKey: 'admin.chat_logs.src_faq',      color: '#22c55e', icon: Zap },
  ai:       { labelKey: 'admin.chat_logs.src_ai',       color: '#8b5cf6', icon: Bot },
  no_match: { labelKey: 'admin.chat_logs.src_no_match', color: '#ef4444', icon: HelpCircle },
}

type FilterSource = HelpLogSource | 'all'

const FEED_LIMIT = 200

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ChatLogs() {
  const { t } = useTranslation()
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
    { key: 'all', label: t('admin.chat_logs.filter_all'), count: kpis?.total },
    { key: 'faq', label: t(SOURCE_META.faq.labelKey), color: SOURCE_META.faq.color, count: kpis?.faq },
    { key: 'ai', label: t(SOURCE_META.ai.labelKey), color: SOURCE_META.ai.color, count: kpis?.ai },
    { key: 'no_match', label: t(SOURCE_META.no_match.labelKey), color: SOURCE_META.no_match.color, count: kpis?.no_match },
  ], [kpis, t])

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{t('admin.chat_logs.title')}</h1>
        <p className="text-[13px] text-text-muted">{t('admin.chat_logs.subtitle')}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          <FadeIn as="section" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-5" y={12}>
            <KpiCard label={t('admin.chat_logs.kpi_total')} value={String(kpis?.total ?? 0)} />
            <KpiCard label={t('admin.chat_logs.src_faq')} value={`${pct(kpis?.faq ?? 0)}%`} sub={`${kpis?.faq ?? 0}`} color={SOURCE_META.faq.color} />
            <KpiCard label={t('admin.chat_logs.kpi_ai')} value={`${pct(kpis?.ai ?? 0)}%`} sub={`${kpis?.ai ?? 0}`} color={SOURCE_META.ai.color} />
            <KpiCard label={t('admin.chat_logs.src_no_match')} value={`${pct(kpis?.no_match ?? 0)}%`} sub={`${kpis?.no_match ?? 0}`} color={SOURCE_META.no_match.color} />
          </FadeIn>

          {/* ── Vacíos de conocimiento ── */}
          {gaps.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-4 sm:mb-5">
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{t('admin.chat_logs.gaps_title')}</h3>
              <p className="text-[13px] text-text-muted mb-4">{t('admin.chat_logs.gaps_subtitle')}</p>
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
                placeholder={t('admin.chat_logs.search_ph')}
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
              <div className="text-[15px] font-medium text-text mb-1">{t('admin.chat_logs.empty_title')}</div>
              <div className="text-[13px] text-text-muted">{t('admin.chat_logs.empty_desc')}</div>
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
                          <span className="hidden sm:inline">{t(meta.labelKey)}</span>
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13px] text-text truncate">{r.question}</div>
                          <div className="text-[11px] text-text-muted truncate">
                            {r.display_name ?? t('admin.chat_logs.user_fallback')}{r.campaign_name ? ` · ${r.campaign_name}` : ''} · {fmtDate(r.created_at)}
                          </div>
                        </div>
                        {isOpen ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 bg-subtle/40 border-t border-line space-y-3">
                          <Field label={t('admin.chat_logs.col_question')} value={r.question} />
                          <Field label={t('admin.chat_logs.col_answer')} value={r.answer || '—'} />
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-text-muted">
                            <span>{t('admin.chat_logs.meta_role')} {r.role ?? '—'}</span>
                            <span>{t('admin.chat_logs.meta_lang')} {r.lang ?? '—'}</span>
                            <span>{t('admin.chat_logs.meta_page')} {r.page ?? '—'}</span>
                            {r.faq_id && <span>{t('admin.chat_logs.meta_entry')} {r.faq_id}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {rows.length >= FEED_LIMIT && (
                <p className="text-center text-[11.5px] text-text-subtle mt-3">
                  {t('admin.chat_logs.showing_recent', { limit: FEED_LIMIT })}
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
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-1.5 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
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
