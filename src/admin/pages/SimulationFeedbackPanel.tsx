import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown, ChevronRight, Download, Loader2, Search, Phone, ListChecks,
  HeartHandshake, Clock, CheckCircle2, XCircle, Sparkles, PhoneCall, AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { useAuth } from '@/hooks/useAuth'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { PanelHeader, KpiRow, Kpi, InsightBanner } from './progress/ProgressChrome'

const SIM_ACCENT = 'rgb(var(--brand-cyan, 6 182 212))'

// ── Tipos de datos ───────────────────────────────────────────
interface Campaign { id: string; name: string }
interface Profile { id: string; display_name: string | null; campaign_id: string | null }

interface AiFeedback { summary?: string; strengths?: string[]; improvements?: string[] }

interface SimAttempt {
  id: string
  user_id: string
  course_id: string | null
  campaign_id: string | null
  scenario_slug: string
  score: number
  checklist_pct: number
  empathy_pct: number
  resolved: boolean
  duration_sec: number
  ai_feedback: AiFeedback | null
  created_at: string
}

// Un escenario empezado con desempeño bajo → "en riesgo".
const RISK_SCORE = 60
const PASS_SCORE = 80

type LearnerStatus = 'not_started' | 'in_progress' | 'at_risk' | 'completed'

const STATUS_META: Record<LearnerStatus, { color: string; labelKey: string; fallback: string }> = {
  completed:   { color: '#22c55e', labelKey: 'admin.sim_panel.status_completed',   fallback: 'Dominado' },
  in_progress: { color: '#3b82f6', labelKey: 'admin.sim_panel.status_in_progress', fallback: 'Practicando' },
  at_risk:     { color: '#ef4444', labelKey: 'admin.sim_panel.status_at_risk',     fallback: 'En riesgo' },
  not_started: { color: '#94a3b8', labelKey: 'admin.sim_panel.status_not_started', fallback: 'Sin intentos' },
}
const STATUS_ORDER: LearnerStatus[] = ['at_risk', 'not_started', 'in_progress', 'completed']

/** Datos base del aprendiz (sin agregación), guardados tras la carga. */
interface LearnerBase {
  userId: string
  displayName: string
  campaignId: string | null
  campaignName: string
}

interface LearnerRow extends LearnerBase {
  attempts: SimAttempt[]
  attemptsCount: number
  scenariosCount: number
  avgScore: number
  bestScore: number
  avgEmpathy: number
  avgChecklist: number
  resolvedRate: number
  status: LearnerStatus
  lastAt: number
}

type SortKey = 'name' | 'estado' | 'intentos' | 'desempeno' | 'empatia'

const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

function computeStatus(count: number, best: number): LearnerStatus {
  if (count === 0) return 'not_started'
  if (best >= PASS_SCORE) return 'completed'
  if (best < RISK_SCORE) return 'at_risk'
  return 'in_progress'
}

/** Agrega los intentos de un aprendiz (ya filtrados por escenario si aplica). */
function aggregate(base: LearnerBase, attempts: SimAttempt[]): LearnerRow {
  const list = [...attempts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  // Mejor puntaje por escenario → promedio justo (no infla con reintentos).
  const bestByScenario = new Map<string, number>()
  for (const a of list) {
    const prev = bestByScenario.get(a.scenario_slug)
    if (prev === undefined || a.score > prev) bestByScenario.set(a.scenario_slug, a.score)
  }
  const bests = [...bestByScenario.values()]
  const count = list.length
  const bestScore = bests.length ? Math.max(...bests) : 0
  return {
    ...base,
    attempts: list,
    attemptsCount: count,
    scenariosCount: bestByScenario.size,
    avgScore: Math.round(avg(bests)),
    bestScore,
    avgEmpathy: Math.round(avg(list.map((a) => a.empathy_pct))),
    avgChecklist: Math.round(avg(list.map((a) => a.checklist_pct))),
    resolvedRate: count ? Math.round((list.filter((a) => a.resolved).length / count) * 100) : 0,
    status: computeStatus(count, bestScore),
    lastAt: list.length ? Date.parse(list[0].created_at) : 0,
  }
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function SimulationFeedbackPanel() {
  const { t, i18n } = useTranslation()
  const { isSuperAdmin, isCapacitador, campaignId, user, loading: authLoading } = useAuth()
  const scopedToCampaign = !isSuperAdmin

  const [loading, setLoading] = useState(true)
  const [learners, setLearners] = useState<LearnerBase[]>([])
  const [allAttempts, setAllAttempts] = useState<SimAttempt[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  /** slug → título legible del escenario (llamada u opción). */
  const [scenarioTitles, setScenarioTitles] = useState<Map<string, string>>(new Map())
  const [filterCampaign, setFilterCampaign] = useState('all')
  const [filterScenario, setFilterScenario] = useState('all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<LearnerStatus | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'intentos', dir: 'desc' })
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const statusLabel = useCallback(
    (s: LearnerStatus) => t(STATUS_META[s].labelKey, STATUS_META[s].fallback),
    [t],
  )

  useEffect(() => {
    if (authLoading) return
    // Guarda de cancelación: si el panel se desmonta (cambio rápido de vista) o
    // el efecto se vuelve a disparar, no tocamos estado de una carga vieja.
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
      const accessible = await getAccessibleCampaigns({
        isSuperAdmin,
        homeCampaignId: campaignId,
        userId: user?.id ?? null,
      }).catch(() => [] as Campaign[])
      const ids = accessible.map((c) => c.id)
      if (scopedToCampaign && ids.length === 0) {
        if (!cancelled) { setCampaigns([]); setLearners([]); setAllAttempts([]) }
        return
      }
      const scope = ids.length ? ids : ['']

      const [profileRes, attemptRes, callRes, choiceRes] = await Promise.all([
        (() => {
          let q = supabase.from('profiles').select('id,display_name,campaign_id').eq('role', 'learner')
          if (scopedToCampaign) q = q.in('campaign_id', scope)
          return q
        })(),
        (() => {
          let q = supabase
            .from('simulator_attempts')
            .select('id,user_id,course_id,campaign_id,scenario_slug,score,checklist_pct,empathy_pct,resolved,duration_sec,ai_feedback,created_at')
          if (scopedToCampaign) q = q.in('campaign_id', scope)
          return q
        })(),
        (() => {
          let q = supabase.from('scenarios').select('slug,title_es,title_en,title_pt,campaign_id')
          if (scopedToCampaign) q = q.in('campaign_id', scope)
          return q
        })(),
        (() => {
          let q = supabase.from('choice_scenarios').select('slug,title_es,campaign_id')
          if (scopedToCampaign) q = q.in('campaign_id', scope)
          return q
        })(),
      ])

      if (attemptRes.error) console.error('simulator_attempts query error:', attemptRes.error)

      const camps = accessible as Campaign[]
      const profiles = (profileRes.data ?? []) as Profile[]
      const attempts = (attemptRes.data ?? []) as SimAttempt[]

      // Mapa slug → título en el idioma actual (llamada tiene 3 idiomas; opción, es).
      const lang = i18n.resolvedLanguage ?? 'es'
      const titles = new Map<string, string>()
      for (const s of (callRes.data ?? []) as Array<{ slug: string; title_es: string; title_en: string | null; title_pt: string | null }>) {
        titles.set(s.slug, (lang === 'en' ? s.title_en : lang === 'pt' ? s.title_pt : s.title_es) || s.title_es || s.slug)
      }
      for (const s of (choiceRes.data ?? []) as Array<{ slug: string; title_es: string }>) {
        if (!titles.has(s.slug)) titles.set(s.slug, s.title_es || s.slug)
      }
      if (cancelled) return
      const campMap = new Map(camps.map((c) => [c.id, c.name]))
      setScenarioTitles(titles)
      setCampaigns(camps)
      setLearners(profiles.map((p) => ({
        userId: p.id,
        displayName: p.display_name ?? t('admin.sim_panel.no_name', 'Sin nombre'),
        campaignId: p.campaign_id,
        campaignName: p.campaign_id ? (campMap.get(p.campaign_id) ?? '—') : '—',
      })))
      setAllAttempts(attempts)
      } catch (e) {
        if (!cancelled) console.error('SimulationFeedbackPanel load error:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopedToCampaign, campaignId, user?.id, i18n.resolvedLanguage])

  // Intentos por aprendiz, respetando el filtro de escenario (recalcula las
  // estadísticas: al elegir un escenario, todo se recomputa solo con sus intentos).
  const rows = useMemo<LearnerRow[]>(() => {
    const byUser = new Map<string, SimAttempt[]>()
    for (const a of allAttempts) {
      if (filterScenario !== 'all' && a.scenario_slug !== filterScenario) continue
      const arr = byUser.get(a.user_id) ?? []
      arr.push(a)
      byUser.set(a.user_id, arr)
    }
    return learners.map((base) => aggregate(base, byUser.get(base.userId) ?? []))
  }, [learners, allAttempts, filterScenario])

  // Opciones del filtro de escenario: los escenarios con intentos en el ámbito de
  // campaña actual, ordenados por título.
  const scenarioOptions = useMemo(() => {
    const slugs = new Set<string>()
    for (const a of allAttempts) {
      if (filterCampaign !== 'all' && a.campaign_id !== filterCampaign) continue
      slugs.add(a.scenario_slug)
    }
    return [...slugs]
      .map((slug) => ({ value: slug, label: scenarioTitles.get(slug) ?? slug }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allAttempts, filterCampaign, scenarioTitles])

  // Ámbito por filtro de campaña (superadmin / multi-campaña).
  const scoped = useMemo(
    () => rows.filter((r) => filterCampaign === 'all' || r.campaignId === filterCampaign),
    [rows, filterCampaign],
  )

  const stats = useMemo(() => {
    const learners = scoped.length
    const withAttempts = scoped.filter((r) => r.attemptsCount > 0)
    const totalAttempts = scoped.reduce((s, r) => s + r.attemptsCount, 0)
    const statusCounts: Record<LearnerStatus, number> = { not_started: 0, in_progress: 0, at_risk: 0, completed: 0 }
    for (const r of scoped) statusCounts[r.status]++
    return {
      learners,
      totalAttempts,
      desempeno: Math.round(avg(withAttempts.map((r) => r.avgScore))),
      resolucion: Math.round(avg(withAttempts.map((r) => r.resolvedRate))),
      statusCounts,
    }
  }, [scoped])

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = scoped.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (q && !r.displayName.toLowerCase().includes(q)) return false
      return true
    })
    const m = sort.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case 'name': return a.displayName.localeCompare(b.displayName) * m
        case 'estado': return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * m
        case 'intentos': return (a.attemptsCount - b.attemptsCount) * m
        case 'desempeno': return (a.avgScore - b.avgScore) * m
        case 'empatia': return (a.avgEmpathy - b.avgEmpathy) * m
        default: return 0
      }
    })
    return list
  }, [scoped, statusFilter, search, sort])

  const scenarioTitle = useCallback(
    (slug: string) => scenarioTitles.get(slug) ?? slug,
    [scenarioTitles],
  )

  const canExport = !isSuperAdmin && isCapacitador

  const handleExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const sheet1 = tableRows.map((r) => ({
        Aprendiz: r.displayName,
        Estado: statusLabel(r.status),
        Intentos: r.attemptsCount,
        'Escenarios practicados': r.scenariosCount,
        'Desempeño (%)': r.avgScore,
        'Mejor puntaje (%)': r.bestScore,
        'Empatía prom. (%)': r.avgEmpathy,
        'Checklist prom. (%)': r.avgChecklist,
        'Tasa de resolución (%)': r.resolvedRate,
      }))
      const sheet2 = tableRows.flatMap((r) =>
        r.attempts.map((a) => ({
          Aprendiz: r.displayName,
          Escenario: scenarioTitle(a.scenario_slug),
          'Puntaje (%)': a.score,
          'Empatía (%)': a.empathy_pct,
          'Checklist (%)': a.checklist_pct,
          Resuelto: a.resolved ? 'Sí' : 'No',
          'Duración (s)': a.duration_sec,
          Fecha: new Date(a.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }),
        })),
      )
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet1), 'Resumen por aprendiz')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2), 'Detalle de intentos')
      const campName = campaigns.find((c) => c.id === campaignId)?.name ?? 'General'
      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `simulaciones_${campName.replace(/\s+/g, '_')}_${date}.xlsx`)
    } finally {
      setExporting(false)
    }
  }, [tableRows, campaigns, campaignId, exporting, statusLabel, scenarioTitle])

  const setSortKey = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  if (!authLoading && !loading && scopedToCampaign && campaigns.length === 0) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{t('admin.sim_panel.title', 'Progreso de Simulaciones')}</h1>
        <div className="mt-8 rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center" style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}>
          <div className="text-[15px] font-medium text-text mb-2">{t('admin.worlds.no_campaign_title')}</div>
          <div className="text-[13px] text-text-muted">{t('admin.worlds.no_campaign_desc')}</div>
        </div>
      </div>
    )
  }

  const statusChips: Array<LearnerStatus | 'all'> = ['all', ...STATUS_ORDER]
  const multiCampaign = campaigns.length > 1

  return (
    <div className="p-4 sm:p-8">
      <PanelHeader
        icon={<PhoneCall className="h-6 w-6" />}
        accent={SIM_ACCENT}
        title={t('admin.sim_panel.title', 'Progreso de Simulaciones')}
        subtitle={t('admin.sim_panel.subtitle', 'Desempeño de los aprendices en los simuladores de práctica (llamada y opción).')}
        actions={canExport && !loading && tableRows.length > 0 ? (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'rgb(var(--brand-green) / 0.12)', color: 'rgb(var(--brand-green))', border: '1px solid rgb(var(--brand-green) / 0.25)' }}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t('admin.sim_panel.export', 'Exportar a Excel')}
          </button>
        ) : undefined}
      />

      {/* Filtros: campaña (super/multi) + escenario (si hay intentos) */}
      {(isSuperAdmin || multiCampaign || scenarioOptions.length > 0) && (
        <div className="flex flex-wrap gap-3 mb-5">
          {(isSuperAdmin || multiCampaign) && (
            <FilterDropdown
              value={filterCampaign === 'all' ? '' : filterCampaign}
              onChange={(v) => { setFilterCampaign(v || 'all'); setFilterScenario('all') }}
              options={[{ value: '', label: t('common.all_campaigns') }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
              className="max-w-xs"
            />
          )}
          {scenarioOptions.length > 0 && (
            <FilterDropdown
              value={filterScenario === 'all' ? '' : filterScenario}
              onChange={(v) => setFilterScenario(v || 'all')}
              options={[{ value: '', label: t('admin.sim_panel.all_scenarios', 'Todos los escenarios') }, ...scenarioOptions]}
              className="max-w-xs"
            />
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : scoped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
          <div className="text-[2rem] mb-3">🎧</div>
          <div className="text-[15px] font-medium text-text mb-2">{t('admin.sim_panel.no_data', 'Todavía no hay simulaciones registradas')}</div>
          <div className="text-[13px] text-text-muted">{t('admin.sim_panel.no_data_desc', 'Cuando tus aprendices practiquen en los simuladores, sus resultados aparecerán aquí.')}</div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <KpiRow>
            <Kpi accent={SIM_ACCENT} icon={<Sparkles className="h-4 w-4" />} label={t('admin.sim_panel.kpi_learners', 'Aprendices')} value={String(stats.learners)} />
            <Kpi accent={SIM_ACCENT} highlight icon={<Phone className="h-4 w-4" />} label={t('admin.sim_panel.kpi_attempts', 'Intentos')} value={String(stats.totalAttempts)} />
            <Kpi accent={SIM_ACCENT} icon={<ListChecks className="h-4 w-4" />} label={t('admin.sim_panel.kpi_score', 'Desempeño')} value={`${stats.desempeno}%`} />
            <Kpi accent={SIM_ACCENT} icon={<CheckCircle2 className="h-4 w-4" />} label={t('admin.sim_panel.kpi_resolved', 'Resolución')} value={`${stats.resolucion}%`} />
          </KpiRow>

          {/* Insight accionable: aprendices en riesgo */}
          {stats.statusCounts.at_risk > 0 && statusFilter !== 'at_risk' && (
            <InsightBanner
              icon={<AlertTriangle className="h-5 w-5" />}
              title={t('admin.sim_panel.risk_title', { count: stats.statusCounts.at_risk, defaultValue: '{{count}} aprendices en riesgo' })}
              detail={t('admin.sim_panel.risk_detail', 'Su mejor puntaje está por debajo del 60%. Conviene reforzar la práctica.')}
              actionLabel={t('admin.sim_panel.risk_action', 'Ver quiénes')}
              onAction={() => setStatusFilter('at_risk')}
            />
          )}

          {/* Distribución por estado */}
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-4 sm:mb-5">
            <div className="mb-5 sm:mb-6">
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{t('admin.sim_panel.distribution_title', 'Distribución por estado')}</h3>
              <p className="text-[13px] text-text-muted">{t('admin.sim_panel.distribution_subtitle', 'Cómo se reparten los aprendices según su práctica')}</p>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
              <StatusDonut total={stats.learners} counts={stats.statusCounts} learnersLabel={t('admin.sim_panel.kpi_learners', 'Aprendices')} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 w-full">
                {STATUS_ORDER.map((s) => {
                  const count = stats.statusCounts[s]
                  const pct = stats.learners > 0 ? Math.round((count / stats.learners) * 100) : 0
                  return (
                    <button key={s} onClick={() => setStatusFilter((prev) => (prev === s ? 'all' : s))} className="flex items-center gap-3 min-w-0 text-left rounded-lg -mx-2 px-2 py-1 hover:bg-subtle/60 transition-colors">
                      <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: STATUS_META[s].color }} />
                      <div className="min-w-0">
                        <div className="text-[13px] text-text font-medium truncate">{statusLabel(s)}</div>
                        <div className="text-[12px] text-text-muted tabular-nums">{pct}% · {count}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="relative sm:max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/70" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.sim_panel.search_ph', 'Buscar aprendiz…')}
                className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-muted/60 outline-none focus:border-[rgb(var(--brand-green))]/40 transition-colors"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {statusChips.map((s) => {
                const active = statusFilter === s
                const label = s === 'all' ? t('admin.sim_panel.status_all', 'Todos') : statusLabel(s)
                const count = s === 'all' ? stats.learners : stats.statusCounts[s]
                const color = s === 'all' ? undefined : STATUS_META[s].color
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
                    style={active ? { borderColor: color ?? 'rgb(var(--brand-green))', color: color ?? 'rgb(var(--brand-green))', background: `${color ?? 'rgb(var(--brand-green))'}1a` } : undefined}
                  >
                    {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
                    <span className={active ? '' : 'text-text-muted'}>{label}</span>
                    <span className={`tabular-nums ${active ? 'opacity-80' : 'text-text-subtle'}`}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {tableRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 sm:p-10 text-center">
              <div className="text-[13px] text-text-muted">{t('admin.sim_panel.no_match', 'Ningún aprendiz coincide con los filtros.')}</div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block rounded-2xl border border-line overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div
                      className="grid gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle"
                      style={{ gridTemplateColumns: multiCampaign ? '1.4fr 1fr auto auto 1fr auto auto' : '1.6fr auto auto 1fr auto auto' }}
                    >
                      <SortTh label={t('admin.sim_panel.col_learner', 'Aprendiz')} col="name" sort={sort} onSort={setSortKey} />
                      {multiCampaign && <span>{t('admin.worlds.campaign')}</span>}
                      <SortTh label={t('admin.sim_panel.col_status', 'Estado')} col="estado" sort={sort} onSort={setSortKey} />
                      <SortTh label={t('admin.sim_panel.col_attempts', 'Intentos')} col="intentos" sort={sort} onSort={setSortKey} />
                      <SortTh label={t('admin.sim_panel.col_score', 'Desempeño')} col="desempeno" sort={sort} onSort={setSortKey} />
                      <SortTh label={t('admin.sim_panel.col_empathy', 'Empatía')} col="empatia" sort={sort} onSort={setSortKey} />
                      <span />
                    </div>
                    <div className="divide-y divide-line">
                      {tableRows.map((row) => {
                        const isOpen = expandedUser === row.userId
                        const atRisk = row.status === 'at_risk'
                        return (
                          <div key={row.userId} style={atRisk ? { boxShadow: 'inset 3px 0 0 #ef4444' } : undefined}>
                            <div
                              className="grid gap-4 px-5 py-3.5 items-center cursor-pointer hover:bg-subtle/50 transition-colors"
                              style={{ gridTemplateColumns: multiCampaign ? '1.4fr 1fr auto auto 1fr auto auto' : '1.6fr auto auto 1fr auto auto' }}
                              onClick={() => setExpandedUser((p) => (p === row.userId ? null : row.userId))}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-subtle text-[13px] font-medium text-text">
                                  {row.displayName.charAt(0).toUpperCase()}
                                </div>
                                <div className="text-[13px] text-text truncate">{row.displayName}</div>
                              </div>
                              {multiCampaign && <div className="text-[12px] text-text-muted truncate">{row.campaignName}</div>}
                              <StatusBadge status={row.status} label={statusLabel(row.status)} />
                              <div className="text-[13px] text-text tabular-nums"><span className="font-medium">{row.attemptsCount}</span><span className="text-text-muted"> · {row.scenariosCount} esc.</span></div>
                              <ScoreBar value={row.avgScore} />
                              <div className="flex items-center gap-1 text-[12px] text-text tabular-nums"><HeartHandshake className="h-3.5 w-3.5 text-pink-500 shrink-0" />{row.avgEmpathy}%</div>
                              <div className="text-text-muted">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</div>
                            </div>
                            {isOpen && (
                              <div className="px-5 py-4 bg-subtle/40 border-t border-line">
                                <AttemptList attempts={row.attempts} scenarioTitle={scenarioTitle} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {tableRows.map((row) => {
                  const isOpen = expandedUser === row.userId
                  const atRisk = row.status === 'at_risk'
                  return (
                    <div key={row.userId} className="rounded-2xl border border-line bg-surface overflow-hidden" style={atRisk ? { boxShadow: 'inset 3px 0 0 #ef4444' } : undefined}>
                      <button className="w-full px-4 py-4 text-left" onClick={() => setExpandedUser((p) => (p === row.userId ? null : row.userId))}>
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 bg-subtle text-[15px] font-medium text-text">{row.displayName.charAt(0).toUpperCase()}</div>
                            <div className="min-w-0">
                              <div className="text-[14px] font-medium text-text truncate">{row.displayName}</div>
                              {multiCampaign && <div className="text-[11px] text-text-muted truncate">{row.campaignName}</div>}
                            </div>
                          </div>
                          {isOpen ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <StatusBadge status={row.status} label={statusLabel(row.status)} />
                          <span className="text-[12px] text-text tabular-nums">{row.attemptsCount} {t('admin.sim_panel.attempts_short', 'intentos')}</span>
                          <span className="inline-flex items-center gap-1 text-[12px] text-text tabular-nums"><HeartHandshake className="h-3.5 w-3.5 text-pink-500" />{row.avgEmpathy}%</span>
                        </div>
                        <ScoreBar value={row.avgScore} />
                      </button>
                      {isOpen && (
                        <div className="px-4 py-3 bg-subtle/40 border-t border-line">
                          <AttemptList attempts={row.attempts} scenarioTitle={scenarioTitle} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ── Subcomponentes ── */

function StatusDonut({ total, counts, learnersLabel }: { total: number; counts: Record<LearnerStatus, number>; learnersLabel: string }) {
  const C = 2 * Math.PI * 40
  let offset = 0
  return (
    <div className="relative w-44 h-44 sm:w-56 sm:h-56 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="transparent" strokeWidth="12" className="text-line" stroke="currentColor" />
        {STATUS_ORDER.map((s) => {
          const share = total > 0 ? counts[s] / total : 0
          const len = share * C
          if (len <= 0) return null
          const circle = (
            <circle key={s} cx="50" cy="50" r="40" fill="transparent" strokeWidth="12" stroke={STATUS_META[s].color} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
          )
          offset += len
          return circle
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl sm:text-4xl font-bold text-text tabular-nums">{total}</span>
        <span className="text-[10px] uppercase tracking-widest text-text-muted">{learnersLabel}</span>
      </div>
    </div>
  )
}

function StatusBadge({ status, label }: { status: LearnerStatus; label: string }) {
  const meta = STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium w-fit" style={{ background: `${meta.color}1a`, color: meta.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {label}
    </span>
  )
}

const scoreColor = (v: number) => (v >= PASS_SCORE ? '#22c55e' : v >= RISK_SCORE ? '#f59e0b' : '#ef4444')

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 flex-1 max-w-[110px] rounded-full bg-line overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: scoreColor(value) }} />
      </div>
      <span className="text-[12px] text-text tabular-nums shrink-0 font-medium">{value}%</span>
    </div>
  )
}

function SortTh({ label, col, sort, onSort }: { label: string; col: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void }) {
  const active = sort.key === col
  return (
    <button onClick={() => onSort(col)} className={`flex items-center gap-1 text-left uppercase tracking-wider ${active ? 'text-text' : 'hover:text-text'} transition-colors`}>
      {label}
      <ChevronDown className={`h-3 w-3 transition-transform ${active ? 'opacity-100' : 'opacity-0'} ${active && sort.dir === 'asc' ? 'rotate-180' : ''}`} />
    </button>
  )
}

/* ── Detalle: lista de intentos del aprendiz ── */
function AttemptList({ attempts, scenarioTitle }: { attempts: SimAttempt[]; scenarioTitle: (slug: string) => string }) {
  const { t } = useTranslation()
  if (attempts.length === 0) return <div className="py-3 text-[13px] text-text-muted">{t('admin.sim_panel.no_attempts', 'Sin intentos todavía.')}</div>
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{t('admin.sim_panel.attempts_history', 'Historial de intentos')}</div>
      {attempts.map((a) => (
        <div key={a.id} className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-medium text-text truncate flex-1 min-w-[120px]">{scenarioTitle(a.scenario_slug)}</span>
            <span className="inline-flex items-center gap-1 text-[12px] tabular-nums font-semibold" style={{ color: scoreColor(a.score) }}>{a.score}%</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums" title={t('admin.sim_panel.empathy', 'Empatía')}><HeartHandshake className="h-3.5 w-3.5 text-pink-500" />{a.empathy_pct}%</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums" title={t('admin.sim_panel.checklist', 'Checklist')}><ListChecks className="h-3.5 w-3.5 text-blue-500" />{a.checklist_pct}%</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums" title={t('admin.sim_panel.duration', 'Duración')}><Clock className="h-3.5 w-3.5" />{fmtDuration(a.duration_sec)}</span>
            {a.resolved
              ? <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" />{t('admin.sim_panel.resolved', 'Resuelto')}</span>
              : <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-red-500 dark:text-red-400"><XCircle className="h-3.5 w-3.5" />{t('admin.sim_panel.unresolved', 'No resuelto')}</span>}
            <span className="text-[11px] text-text-muted/70 tabular-nums w-full sm:w-auto sm:ml-auto">{new Date(a.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
          {a.ai_feedback?.summary && (
            <div className="mt-2 pt-2 border-t border-line/60 flex items-start gap-2">
              <Sparkles className="h-3.5 w-3.5 text-[rgb(var(--brand-green))] shrink-0 mt-0.5" />
              <p className="text-[12px] text-text-muted leading-relaxed">{a.ai_feedback.summary}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
