import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Loader2, Search, Award, Shield, Users, Download,
  ArrowUp, ArrowDown, GraduationCap, BookOpen, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import {
  getAllCoursesProgressAdmin,
  type AdminOverview as Overview,
  type AdminOverviewCourse,
  type AdminOverviewUser,
} from '@/services/courses.service'

interface CampaignLite {
  id: string
  name: string
}

interface CourseTitles {
  title_es: string
  title_en: string | null
  title_pt: string | null
}

type SortKey = 'name' | 'avg' | 'certified' | 'enrolled' | `course:${string}`
interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface RowStat {
  enrolled: number
  avg: number | null
  certified: number
}

// Umbrales de color para el desempeño (score 0-100).
function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

function pickText(t: CourseTitles | undefined, fallback: string, lang: string): string {
  if (!t) return fallback
  if (lang === 'en') return t.title_en || t.title_es || fallback
  if (lang === 'pt') return t.title_pt || t.title_es || fallback
  return t.title_es || fallback
}

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function AdminOverview() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'es'
  const roleLabel = (r: AdminOverviewUser['role']) => t(`roles.${r}`)

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Overview>({ users: [], courses: [], progress: [] })
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [titles, setTitles] = useState<Map<string, CourseTitles>>(new Map())
  const [search, setSearch] = useState('')
  const [filterCampaign, setFilterCampaign] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })

  useEffect(() => {
    let alive = true
    Promise.all([
      getAllCoursesProgressAdmin(),
      supabase.from('campaigns').select('id,name').order('name'),
      supabase.from('courses').select('id,title_es,title_en,title_pt'),
    ])
      .then(([overview, camps, crs]) => {
        if (!alive) return
        setData(overview)
        setCampaigns((camps.data ?? []) as CampaignLite[])
        const m = new Map<string, CourseTitles>()
        for (const c of (crs.data ?? []) as (CourseTitles & { id: string })[]) {
          m.set(c.id, { title_es: c.title_es, title_en: c.title_en, title_pt: c.title_pt })
        }
        setTitles(m)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const campaignName = useMemo(
    () => new Map(campaigns.map((c) => [c.id, c.name])),
    [campaigns],
  )

  const courseLabel = (c: AdminOverviewCourse) => pickText(titles.get(c.course_id), c.title_es, lang)

  // Celdas indexadas por "userId|courseId" para lookup O(1).
  const cellMap = useMemo(() => {
    const m = new Map<string, Overview['progress'][number]>()
    for (const p of data.progress) m.set(`${p.user_id}|${p.course_id}`, p)
    return m
  }, [data.progress])

  // Cursos visibles según filtro de campaña.
  const visibleCourses = useMemo<AdminOverviewCourse[]>(() => {
    const list = filterCampaign
      ? data.courses.filter((c) => c.campaign_id === filterCampaign)
      : data.courses
    return [...list].sort((a, b) => courseLabel(a).localeCompare(courseLabel(b)))
  }, [data.courses, filterCampaign, titles, lang])

  // Usuarios filtrados (sin ordenar todavía).
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.users.filter((u) => {
      if (filterCampaign && u.campaign_id !== filterCampaign) return false
      if (filterRole && u.role !== filterRole) return false
      if (q && !(u.display_name ?? '').toLowerCase().includes(q) && !u.id.toLowerCase().includes(q))
        return false
      if (onlyActive) {
        const hasAny = visibleCourses.some((c) => cellMap.has(`${u.id}|${c.course_id}`))
        if (!hasAny) return false
      }
      return true
    })
  }, [data.users, search, filterCampaign, filterRole, onlyActive, visibleCourses, cellMap])

  // Resumen por usuario (fila): inscritos, promedio, certificados.
  const rowStat = useMemo(() => {
    const m = new Map<string, RowStat>()
    for (const u of filteredUsers) {
      let enrolled = 0
      let certified = 0
      let sum = 0
      let scored = 0
      for (const c of visibleCourses) {
        const cell = cellMap.get(`${u.id}|${c.course_id}`)
        if (!cell) continue
        enrolled++
        if (cell.certified) certified++
        if (cell.score != null) {
          sum += cell.score
          scored++
        }
      }
      m.set(u.id, { enrolled, certified, avg: scored > 0 ? Math.round(sum / scored) : null })
    }
    return m
  }, [filteredUsers, visibleCourses, cellMap])

  // Resumen por curso (columna): inscritos, promedio, certificados (sobre lo filtrado).
  const colStat = useMemo(() => {
    const m = new Map<string, RowStat>()
    for (const c of visibleCourses) {
      let enrolled = 0
      let certified = 0
      let sum = 0
      let scored = 0
      for (const u of filteredUsers) {
        const cell = cellMap.get(`${u.id}|${c.course_id}`)
        if (!cell) continue
        enrolled++
        if (cell.certified) certified++
        if (cell.score != null) {
          sum += cell.score
          scored++
        }
      }
      m.set(c.course_id, { enrolled, certified, avg: scored > 0 ? Math.round(sum / scored) : null })
    }
    return m
  }, [visibleCourses, filteredUsers, cellMap])

  // Filas ordenadas.
  const rows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const value = (u: AdminOverviewUser): string | number => {
      if (sort.key === 'name') return (u.display_name ?? '').toLowerCase()
      if (sort.key === 'avg') return rowStat.get(u.id)?.avg ?? -1
      if (sort.key === 'certified') return rowStat.get(u.id)?.certified ?? -1
      if (sort.key === 'enrolled') return rowStat.get(u.id)?.enrolled ?? -1
      // course:<id>
      const id = sort.key.slice('course:'.length)
      const cell = cellMap.get(`${u.id}|${id}`)
      if (!cell) return -1
      return cell.certified ? 101 : cell.score ?? 0
    }
    return [...filteredUsers].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir
      return ((va as number) - (vb as number)) * dir
    })
  }, [filteredUsers, sort, rowStat, cellMap])

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )

  // KPIs globales.
  const totalCells = rows.length * visibleCourses.length
  const activeCells = useMemo(() => {
    let n = 0
    for (const u of rows)
      for (const c of visibleCourses) if (cellMap.has(`${u.id}|${c.course_id}`)) n++
    return n
  }, [rows, visibleCourses, cellMap])
  const totalCertified = useMemo(() => {
    let n = 0
    for (const s of rowStat.values()) n += s.certified
    return n
  }, [rowStat])

  const hasFilters = !!search || !!filterCampaign || !!filterRole || onlyActive
  const clearFilters = () => {
    setSearch('')
    setFilterCampaign('')
    setFilterRole('')
    setOnlyActive(false)
  }

  const exportCsv = () => {
    const header = [
      t('admin.overview.col_user'),
      t('admin.overview.role_col'),
      t('admin.users.all_campaigns'),
      ...visibleCourses.map((c) => courseLabel(c)),
      t('admin.overview.avg_col'),
      t('admin.overview.legend_certified'),
    ]
    const lines = rows.map((u) => {
      const rs = rowStat.get(u.id)
      const cells = visibleCourses.map((c) => {
        const cell = cellMap.get(`${u.id}|${c.course_id}`)
        if (!cell) return ''
        if (cell.certified) return t('admin.overview.legend_certified')
        return cell.score != null ? String(cell.score) : '·'
      })
      return [
        u.display_name ?? u.id,
        roleLabel(u.role),
        u.campaign_id ? campaignName.get(u.campaign_id) ?? '' : '',
        ...cells,
        rs?.avg != null ? String(rs.avg) : '',
        String(rs?.certified ?? 0),
      ]
    })
    const csv = [header, ...lines].map((r) => r.map(csvEscape).join(';')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vista-global-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sort.key === k ? (
      sort.dir === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )
    ) : null

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-screen overflow-hidden p-4 sm:p-8">
      <div className="shrink-0 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">
            {t('admin.overview.title')}
          </h1>
          <p className="text-[13px] text-text-muted">{t('admin.overview.subtitle')}</p>
        </div>
        {!loading && (
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] font-medium text-text hover:bg-subtle transition-colors min-h-[44px] disabled:opacity-40 disabled:pointer-events-none"
          >
            <Download className="h-4 w-4" />
            {t('admin.overview.export_csv')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
            <Kpi icon={Users} label={t('admin.overview.kpi_users')} value={String(rows.length)} tint="#6366f1" />
            <Kpi icon={BookOpen} label={t('admin.overview.kpi_courses')} value={String(visibleCourses.length)} tint="#0ea5e9" />
            <Kpi icon={GraduationCap} label={t('admin.overview.kpi_certified')} value={String(totalCertified)} tint="#d97706" />
            <Kpi
              icon={Award}
              label={t('admin.overview.kpi_coverage')}
              value={totalCells > 0 ? `${Math.round((activeCells / totalCells) * 100)}%` : '—'}
              tint="#22c55e"
            />
          </div>

          {/* Filtros */}
          <div className="shrink-0 flex flex-wrap items-center gap-2.5 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.overview.search_ph')}
                className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-[14px] text-text outline-none focus:border-primary min-h-[44px]"
              />
            </div>
            <FilterDropdown
              value={filterCampaign}
              onChange={setFilterCampaign}
              options={[
                { value: '', label: t('admin.users.all_campaigns') },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
              className="max-w-xs"
            />
            <FilterDropdown
              value={filterRole}
              onChange={setFilterRole}
              options={[
                { value: '', label: t('admin.overview.all_roles') },
                { value: 'learner', label: t('roles.learner') },
                { value: 'capacitador', label: t('roles.capacitador') },
                { value: 'superadmin', label: t('roles.superadmin') },
              ]}
              className="max-w-xs"
            />
            <button
              onClick={() => setOnlyActive((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors min-h-[44px]"
              style={
                onlyActive
                  ? { borderColor: 'rgb(var(--brand-green))', color: 'rgb(var(--brand-green))', background: 'rgb(var(--brand-green) / 0.1)' }
                  : { borderColor: 'rgb(var(--line))', color: 'rgb(var(--text-muted))' }
              }
            >
              <Users className="h-4 w-4" />
              {t('admin.overview.only_active')}
            </button>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-text-muted hover:text-text transition-colors min-h-[44px]"
              >
                <X className="h-4 w-4" />
                {t('admin.overview.clear_filters')}
              </button>
            )}
          </div>

          {rows.length === 0 || visibleCourses.length === 0 ? (
            <div className="flex-1 min-h-0 rounded-2xl border border-dashed border-line p-10 text-center text-[13px] text-text-muted">
              {t('admin.overview.no_data')}
            </div>
          ) : (
            <div className="flex-1 min-h-0 rounded-2xl border border-line overflow-auto">
              <table className="border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 bg-subtle text-left align-bottom px-4 py-3 pb-3 border-b border-r border-line min-w-[220px]">
                      <button
                        onClick={() => toggleSort('name')}
                        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-text-muted hover:text-text transition-colors"
                      >
                        {t('admin.overview.col_user')}
                        <SortIcon k="name" />
                      </button>
                    </th>
                    {visibleCourses.map((c) => {
                      const cs = colStat.get(c.course_id)
                      const active = sort.key === `course:${c.course_id}`
                      return (
                        <th
                          key={c.course_id}
                          className={cn(
                            'sticky top-0 z-20 bg-subtle border-b border-l border-line p-0 align-bottom',
                            active && '!bg-primary/5',
                          )}
                          title={courseLabel(c)}
                        >
                          <button
                            onClick={() => toggleSort(`course:${c.course_id}`)}
                            className="flex h-[168px] w-[42px] flex-col items-center justify-end gap-1.5 pb-2 pt-2 group"
                          >
                            <span
                              className="flex-1 min-h-0 flex items-center justify-center text-text-muted group-hover:text-text transition-colors"
                              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                            >
                              {!c.is_published && (
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500/70 shrink-0 mb-1" />
                              )}
                              <span className="text-[11.5px] font-medium truncate max-h-[128px]">
                                {courseLabel(c)}
                              </span>
                            </span>
                            {cs && cs.avg != null ? (
                              <span
                                className="text-[10px] font-bold tabular-nums leading-none"
                                style={{ color: scoreColor(cs.avg) }}
                                title={`${t('admin.overview.avg_col')} ${cs.avg}%`}
                              >
                                {cs.avg}
                              </span>
                            ) : (
                              <span className="text-[10px] text-text-subtle leading-none">·</span>
                            )}
                            <span
                              className={cn(
                                'h-0.5 w-5 rounded-full transition-colors',
                                active ? 'bg-primary' : 'bg-transparent',
                              )}
                            />
                          </button>
                        </th>
                      )
                    })}
                    <th className="sticky right-0 top-0 z-30 bg-subtle align-bottom px-3 py-2.5 pb-3 border-b border-l border-line min-w-[130px]">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => toggleSort('avg')}
                          className="inline-flex items-center gap-0.5 text-[11px] uppercase tracking-wider text-text-muted hover:text-text transition-colors"
                          title={t('admin.overview.avg_col')}
                        >
                          {t('admin.overview.avg_col')}
                          <SortIcon k="avg" />
                        </button>
                        <button
                          onClick={() => toggleSort('certified')}
                          className="inline-flex items-center gap-0.5 text-text-muted hover:text-text transition-colors"
                          title={t('admin.overview.legend_certified')}
                        >
                          <Award className="h-3.5 w-3.5" style={{ color: '#d97706' }} />
                          <SortIcon k="certified" />
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((u) => {
                    const rs = rowStat.get(u.id)
                    return (
                      <tr key={u.id} className="hover:bg-subtle/40">
                        <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 border-r border-line">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-bold uppercase text-primary">
                              {(u.display_name || '?').charAt(0)}
                            </span>
                            <div className="min-w-0">
                              <Link
                                to={`/admin/progress?view=worlds&user=${u.id}`}
                                className="flex items-center gap-1.5 text-[13px] text-text truncate hover:text-primary"
                              >
                                {u.role === 'superadmin' && (
                                  <Shield className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                                )}
                                <span className="truncate">
                                  {u.display_name ?? t('admin.users.no_name', 'Sin nombre')}
                                </span>
                              </Link>
                              <div className="text-[10px] text-text-subtle truncate">
                                {u.role !== 'learner' && (
                                  <span className="text-text-muted font-medium">{roleLabel(u.role)}</span>
                                )}
                                {u.role !== 'learner' && u.campaign_id && ' · '}
                                {u.campaign_id ? campaignName.get(u.campaign_id) ?? '—' : (u.role === 'learner' ? '—' : '')}
                              </div>
                            </div>
                          </div>
                        </td>
                        {visibleCourses.map((c) => {
                          const cell = cellMap.get(`${u.id}|${c.course_id}`)
                          const active = sort.key === `course:${c.course_id}`
                          return (
                            <td
                              key={c.course_id}
                              className={cn(
                                'p-1 text-center border-l border-line',
                                active && 'bg-primary/5',
                              )}
                            >
                              {!cell ? (
                                <span className="text-text-subtle/40 text-[11px]">—</span>
                              ) : cell.certified ? (
                                <Link
                                  to={`/certificate/${c.course_id}/${u.id}`}
                                  className="mx-auto flex h-6 w-6 items-center justify-center rounded-md hover:opacity-80 transition-opacity"
                                  style={{ color: '#d97706', background: '#d977061a' }}
                                  title={`${t('admin.users.certified_badge')}${cell.score != null ? ` · ${cell.score}%` : ''}`}
                                >
                                  <Award className="h-3.5 w-3.5" />
                                </Link>
                              ) : cell.score != null ? (
                                <Link
                                  to={`/admin/progress?view=worlds&user=${u.id}`}
                                  className="mx-auto flex h-6 min-w-[26px] items-center justify-center rounded-md px-1 text-[11px] font-bold tabular-nums hover:opacity-80 transition-opacity"
                                  style={{ color: scoreColor(cell.score), background: `${scoreColor(cell.score)}1a` }}
                                  title={`${courseLabel(c)} · ${cell.score}%`}
                                >
                                  {cell.score}
                                </Link>
                              ) : (
                                <Link to={`/admin/progress?view=worlds&user=${u.id}`} className="text-text-subtle hover:text-text" title={t('admin.overview.enrolled_no_score')}>
                                  ·
                                </Link>
                              )}
                            </td>
                          )
                        })}
                        <td className="sticky right-0 z-10 bg-surface px-3 py-2.5 border-l border-line">
                          <div className="flex items-center justify-center gap-2">
                            {rs && rs.avg != null ? (
                              <span
                                className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                                style={{ color: scoreColor(rs.avg), background: `${scoreColor(rs.avg)}1a` }}
                              >
                                {rs.avg}%
                              </span>
                            ) : (
                              <span className="text-[11px] text-text-subtle">—</span>
                            )}
                            {rs && rs.certified > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums" style={{ color: '#d97706' }}>
                                <Award className="h-3.5 w-3.5" />
                                {rs.certified}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Leyenda */}
          {rows.length > 0 && visibleCourses.length > 0 && (
            <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 pr-16 text-[11px] text-text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Award className="h-3.5 w-3.5" style={{ color: '#d97706' }} /> {t('admin.overview.legend_certified')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#22c55e' }} /> ≥ 80%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#f59e0b' }} /> 60–79%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#ef4444' }} /> &lt; 60%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-text-subtle">·</span> {t('admin.overview.enrolled_no_score')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-text-subtle/40">—</span> {t('admin.overview.legend_none')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500/70" /> {t('admin.overview.draft')}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({
  label, value, icon: Icon, tint,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  tint: string
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex items-center gap-3.5">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${tint}1a`, color: tint }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <span className="block text-2xl sm:text-3xl font-bold text-text tabular-nums leading-none">{value}</span>
        <span className="block text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate mt-1">{label}</span>
      </div>
    </div>
  )
}
