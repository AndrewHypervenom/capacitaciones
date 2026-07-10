import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search, Award, Shield, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import {
  getAllCoursesProgressAdmin,
  type AdminOverview as Overview,
  type AdminOverviewCourse,
} from '@/services/courses.service'

interface CampaignLite {
  id: string
  name: string
}

// Umbrales de color para el desempeño de una celda (score 0-100).
function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

export default function AdminOverview() {
  const { t } = useTranslation()
  const roleLabel = (r: Overview['users'][number]['role']) => t(`roles.${r}`)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Overview>({ users: [], courses: [], progress: [] })
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [search, setSearch] = useState('')
  const [filterCampaign, setFilterCampaign] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([
      getAllCoursesProgressAdmin(),
      supabase.from('campaigns').select('id,name').order('name'),
    ])
      .then(([overview, camps]) => {
        if (!alive) return
        setData(overview)
        setCampaigns((camps.data ?? []) as CampaignLite[])
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

  // Celdas indexadas por "userId|courseId" para lookup O(1).
  const cellMap = useMemo(() => {
    const m = new Map<string, Overview['progress'][number]>()
    for (const p of data.progress) m.set(`${p.user_id}|${p.course_id}`, p)
    return m
  }, [data.progress])

  // Cursos visibles según filtro de campaña.
  const visibleCourses = useMemo<AdminOverviewCourse[]>(() => {
    if (!filterCampaign) return data.courses
    return data.courses.filter((c) => c.campaign_id === filterCampaign)
  }, [data.courses, filterCampaign])

  // Filas (usuarios) filtradas por campaña, rol, búsqueda y "con actividad".
  const rows = useMemo(() => {
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

  const totalCells = rows.length * visibleCourses.length
  const activeCells = useMemo(() => {
    let n = 0
    for (const u of rows)
      for (const c of visibleCourses) if (cellMap.has(`${u.id}|${c.course_id}`)) n++
    return n
  }, [rows, visibleCourses, cellMap])

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">
          {t('admin.overview.title')}
        </h1>
        <p className="text-[13px] text-text-muted">{t('admin.overview.subtitle')}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
            <Kpi label={t('admin.overview.kpi_users')} value={String(data.users.length)} />
            <Kpi label={t('admin.overview.kpi_courses')} value={String(data.courses.length)} />
            <Kpi label={t('admin.overview.kpi_enrollments')} value={String(data.progress.length)} />
            <Kpi
              label={t('admin.overview.kpi_coverage')}
              value={totalCells > 0 ? `${Math.round((activeCells / totalCells) * 100)}%` : '—'}
            />
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
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
          </div>

          {rows.length === 0 || visibleCourses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center text-[13px] text-text-muted">
              {t('admin.overview.no_data')}
            </div>
          ) : (
            <div className="rounded-2xl border border-line overflow-auto max-h-[70vh]">
              <table className="border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 bg-subtle text-left px-4 py-3 text-[11px] uppercase tracking-wider text-text-muted border-b border-line min-w-[200px]">
                      {t('admin.overview.col_user')}
                    </th>
                    {visibleCourses.map((c) => (
                      <th
                        key={c.course_id}
                        className="sticky top-0 z-10 bg-subtle px-3 py-3 border-b border-l border-line font-medium text-text-muted"
                        title={c.title_es}
                      >
                        <div className="w-[110px] truncate">
                          {c.icon} {c.title_es}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((u) => (
                    <tr key={u.id} className="hover:bg-subtle/40">
                      <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 border-r border-line">
                        <div className="flex items-center gap-2 min-w-0">
                          {u.role === 'superadmin' ? (
                            <Shield className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                          ) : null}
                          <div className="min-w-0">
                            <Link
                              to={`/admin/feedback?user=${u.id}`}
                              className="block text-[13px] text-text truncate hover:text-primary"
                            >
                              {u.display_name ?? t('admin.users.no_name', 'Sin nombre')}
                            </Link>
                            <div className="text-[10px] text-text-subtle truncate">
                              {u.campaign_id ? campaignName.get(u.campaign_id) ?? '—' : roleLabel(u.role)}
                            </div>
                          </div>
                        </div>
                      </td>
                      {visibleCourses.map((c) => {
                        const cell = cellMap.get(`${u.id}|${c.course_id}`)
                        return (
                          <td key={c.course_id} className="px-3 py-2.5 text-center border-l border-line">
                            {!cell ? (
                              <span className="text-text-subtle/50">—</span>
                            ) : cell.certified ? (
                              <span
                                className="inline-flex items-center gap-1 font-semibold"
                                style={{ color: '#d97706' }}
                                title={t('admin.users.certified_badge')}
                              >
                                <Award className="h-3.5 w-3.5" />
                                {cell.score != null ? `${cell.score}%` : ''}
                              </span>
                            ) : cell.score != null ? (
                              <span className="font-semibold tabular-nums" style={{ color: scoreColor(cell.score) }}>
                                {cell.score}%
                              </span>
                            ) : (
                              <span className="text-text-subtle">·</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Leyenda */}
          <div className="flex flex-wrap items-center gap-4 mt-4 text-[11px] text-text-muted">
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
              <span className="text-text-subtle/50">—</span> {t('admin.overview.legend_none')}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-1.5">
      <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate">{label}</span>
      <span className="text-2xl sm:text-3xl font-bold text-text tabular-nums">{value}</span>
    </div>
  )
}
