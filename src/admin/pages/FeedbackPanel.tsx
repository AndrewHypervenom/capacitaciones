import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { getStarsFromScore, getStarsDisplay } from '@/lib/scoring'
import StarDisplay from '@/components/StarDisplay'

interface Campaign { id: string; name: string }
interface World { id: string; name: string; icon: string; campaign_id: string | null }
interface WorldLevel { id: string; name: string; world_id: string; order_index: number; min_score_pct: number | null }
interface Profile { id: string; display_name: string | null; campaign_id: string | null }
interface Progress { user_id: string; level_id: string; world_id: string; score: number }
interface Attempt { id: string; level_id: string; score: number; completed_at: string }

interface LearnerRow {
  userId: string
  displayName: string
  campaignId: string | null
  campaignName: string
  worldId: string
  worldName: string
  worldIcon: string
  completedLevels: number
  totalLevels: number
  avgStars: number
}


export default function FeedbackPanel() {
  const { isSuperAdmin, isCapacitador, campaignId, loading: authLoading } = useAuth()
  // 'admin' ya no existe como rol; solo superadmin llega aquí
  const isAdminOnly = false

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<LearnerRow[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [worlds, setWorlds] = useState<World[]>([])
  const [levels, setLevels] = useState<WorldLevel[]>([])
  const [filterCampaign, setFilterCampaign] = useState('all')
  const [filterWorld, setFilterWorld] = useState('all')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [attemptsLoading, setAttemptsLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (isAdminOnly && !campaignId) { setLoading(false); return }

    async function load() {
      const [campRes, worldRes, levelRes, profileRes, progressRes] = await Promise.all([
        supabase.from('campaigns').select('id,name').order('name'),
        (() => {
          let q = supabase.from('worlds').select('id,name,icon,campaign_id')
          if (isAdminOnly && campaignId) q = q.eq('campaign_id', campaignId)
          return q
        })(),
        supabase.from('world_levels').select('id,name,world_id,order_index,min_score_pct').order('order_index'),
        (() => {
          let q = supabase.from('profiles').select('id,display_name,campaign_id').eq('role', 'learner')
          if (isAdminOnly && campaignId) q = q.eq('campaign_id', campaignId)
          return q
        })(),
        (() => {
          let q = supabase.from('world_progress').select('user_id,level_id,world_id,score').eq('completed', true)
          if (isAdminOnly && campaignId) q = q.eq('campaign_id', campaignId)
          return q
        })(),
      ])

      if (progressRes.error) console.error('world_progress query error:', progressRes.error)
      if (profileRes.error) console.error('profiles query error:', profileRes.error)

      const camps = (campRes.data ?? []) as Campaign[]
      const ws = (worldRes.data ?? []) as World[]
      const lvls = (levelRes.data ?? []) as WorldLevel[]
      const profiles = (profileRes.data ?? []) as Profile[]
      const progress = (progressRes.data ?? []) as Progress[]

      setCampaigns(camps)
      setWorlds(ws)
      setLevels(lvls)

      const campMap = new Map(camps.map(c => [c.id, c.name]))
      const worldMap = new Map(ws.map(w => [w.id, w]))
      const levelsByWorld = new Map<string, WorldLevel[]>()
      lvls.forEach(l => {
        const arr = levelsByWorld.get(l.world_id) ?? []
        arr.push(l)
        levelsByWorld.set(l.world_id, arr)
      })

      const progressByUserWorld = new Map<string, Progress[]>()
      progress.forEach(p => {
        const key = `${p.user_id}|${p.world_id}`
        const arr = progressByUserWorld.get(key) ?? []
        arr.push(p)
        progressByUserWorld.set(key, arr)
      })

      const result: LearnerRow[] = []

      for (const profile of profiles) {
        const campaignWorlds = ws.filter(w => w.campaign_id === profile.campaign_id)
        if (campaignWorlds.length === 0) continue

        for (const w of campaignWorlds) {
          const wLevels = levelsByWorld.get(w.id) ?? []
          const key = `${profile.id}|${w.id}`
          const progs = progressByUserWorld.get(key) ?? []
          const starValues = progs.map(p => {
            const lvl = lvls.find(l => l.id === p.level_id)
            return getStarsFromScore(p.score, lvl?.min_score_pct ?? null)
          })
          const avgStars = starValues.length > 0
            ? starValues.reduce((a, b) => a + b, 0) / starValues.length
            : 0

          result.push({
            userId: profile.id,
            displayName: profile.display_name ?? 'Sin nombre',
            campaignId: profile.campaign_id,
            campaignName: profile.campaign_id ? (campMap.get(profile.campaign_id) ?? '—') : '—',
            worldId: w.id,
            worldName: w.name,
            worldIcon: w.icon,
            completedLevels: progs.length,
            totalLevels: wLevels.length,
            avgStars: Math.round(avgStars * 10) / 10,
          })
        }
      }

      result.sort((a, b) => b.completedLevels - a.completedLevels || b.avgStars - a.avgStars)
      setRows(result)
      setLoading(false)
    }
    load()
  }, [authLoading, isAdminOnly, campaignId])

  const filtered = rows.filter(r => {
    if (filterCampaign !== 'all' && r.campaignId !== filterCampaign) return false
    if (filterWorld !== 'all' && r.worldId !== filterWorld) return false
    return true
  })

  const canExport = !isSuperAdmin && isCapacitador

  const handleExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const userIds = [...new Set(filtered.map(r => r.userId))]
      const worldIds = [...new Set(filtered.map(r => r.worldId))]

      const { data: allAttempts } = await supabase
        .from('world_level_attempts')
        .select('id,user_id,level_id,world_id,score,completed_at')
        .in('user_id', userIds)
        .in('world_id', worldIds)
        .order('completed_at', { ascending: false })

      const profileMap = new Map(filtered.map(r => [r.userId, r.displayName]))
      const worldNameMap = new Map(worlds.map(w => [w.id, w.name]))
      const lvlMap = new Map(levels.map(l => [l.id, l]))

      const sheet1 = filtered.map(r => ({
        Nombre: r.displayName,
        Mundo: r.worldName,
        'Niveles completados': r.completedLevels,
        'Total de niveles': r.totalLevels,
        'Promedio de estrellas': r.avgStars,
      }))

      const sheet2 = (allAttempts ?? []).map(a => {
        const lvl = lvlMap.get(a.level_id)
        const minPct = lvl?.min_score_pct ?? null
        return {
          Aprendiz: profileMap.get(a.user_id) ?? a.user_id,
          Mundo: worldNameMap.get(a.world_id) ?? a.world_id,
          Nivel: lvl?.name ?? a.level_id,
          'Score (%)': a.score,
          Estrellas: getStarsFromScore(a.score, minPct),
          Aprobado: minPct === null || a.score >= minPct ? 'Sí' : 'No',
          Fecha: new Date(a.completed_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }),
        }
      })

      const attemptsByLevel = new Map<string, Array<{ user_id: string; score: number }>>()
      for (const a of (allAttempts ?? [])) {
        const arr = attemptsByLevel.get(a.level_id) ?? []
        arr.push({ user_id: a.user_id, score: a.score })
        attemptsByLevel.set(a.level_id, arr)
      }

      const sheet3 = levels
        .filter(l => worldIds.includes(l.world_id))
        .map(l => {
          const atts = attemptsByLevel.get(l.id) ?? []
          const w = worlds.find(x => x.id === l.world_id)
          const minPct = l.min_score_pct
          const uniquePassed = new Set(
            atts.filter(a => minPct === null || a.score >= minPct).map(a => a.user_id),
          ).size
          const avgScore = atts.length > 0
            ? Math.round(atts.reduce((s, a) => s + a.score, 0) / atts.length)
            : 0
          return {
            Nivel: l.name,
            Mundo: w?.name ?? l.world_id,
            'Total de intentos': atts.length,
            'Aprendices que aprobaron': uniquePassed,
            'Score promedio (%)': avgScore,
          }
        })

      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet1), 'Resumen por aprendiz')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2), 'Detalle de intentos')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet3), 'Resumen por nivel')

      const campName = campaigns.find(c => c.id === campaignId)?.name ?? 'General'
      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `progreso_${campName.replace(/\s+/g, '_')}_${date}.xlsx`)
    } finally {
      setExporting(false)
    }
  }, [filtered, worlds, levels, campaigns, campaignId, exporting])

  const handleExpand = async (userId: string, worldId: string) => {
    const key = `${userId}|${worldId}`
    if (expandedKey === key) { setExpandedKey(null); return }

    setExpandedKey(key)
    setAttemptsLoading(true)

    const { data } = await supabase
      .from('world_level_attempts')
      .select('id,level_id,score,completed_at')
      .eq('user_id', userId)
      .eq('world_id', worldId)
      .order('completed_at', { ascending: false })

    setAttempts((data ?? []) as Attempt[])
    setAttemptsLoading(false)
  }

  if (!authLoading && isAdminOnly && !campaignId) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">Progreso de Aprendices</h1>
        <div
          className="mt-8 rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}
        >
          <div className="text-[15px] font-medium text-text mb-2">Sin campaña asignada</div>
          <div className="text-[13px] text-text-muted">No tienes una campaña asignada. Contacta al superadmin.</div>
        </div>
      </div>
    )
  }

  const levelMap = new Map(levels.map(l => [l.id, l]))

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">Progreso de Aprendices</h1>
          <p className="text-[13px] text-text-muted">Seguimiento del avance en Mundos y niveles completados.</p>
        </div>
        {canExport && !loading && filtered.length > 0 && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'rgb(var(--brand-green) / 0.12)', color: 'rgb(var(--brand-green))', border: '1px solid rgb(var(--brand-green) / 0.25)' }}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar a Excel
          </button>
        )}
      </div>

      {/* Filters — superadmin only */}
      {isSuperAdmin && (
        <div className="flex flex-wrap gap-3 mb-5">
          <FilterDropdown
            value={filterCampaign === 'all' ? '' : filterCampaign}
            onChange={v => setFilterCampaign(v || 'all')}
            options={[{ value: '', label: 'Todas las campañas' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
            className="max-w-xs"
          />
          <FilterDropdown
            value={filterWorld === 'all' ? '' : filterWorld}
            onChange={v => setFilterWorld(v || 'all')}
            options={[{ value: '', label: 'Todos los mundos' }, ...worlds.map(w => ({ value: w.id, label: `${w.icon} ${w.name}` }))]}
            className="max-w-xs"
          />
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
          <div className="text-[2rem] mb-3">📊</div>
          <div className="text-[15px] font-medium text-text mb-2">Sin datos de progreso</div>
          <div className="text-[13px] text-text-muted">Aún no hay aprendices con progreso en Mundos.</div>
        </div>
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="hidden md:block rounded-2xl border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                {/* Header */}
                <div
                  className="grid gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle"
                  style={{ gridTemplateColumns: isSuperAdmin ? '1fr 1fr 1fr auto auto auto' : '1fr 1fr auto auto auto' }}
                >
                  <span>Aprendiz</span>
                  {isSuperAdmin && <span>Campaña</span>}
                  <span>Mundo</span>
                  <span>Niveles</span>
                  <span>Prom. ⭐</span>
                  <span />
                </div>
                {/* Rows */}
                <div className="divide-y divide-line">
                  {filtered.map(row => {
                    const key = `${row.userId}|${row.worldId}`
                    const isOpen = expandedKey === key
                    return (
                      <div key={key}>
                        <div
                          className="grid gap-4 px-5 py-3.5 items-center cursor-pointer hover:bg-subtle/50 transition-colors"
                          style={{ gridTemplateColumns: isSuperAdmin ? '1fr 1fr 1fr auto auto auto' : '1fr 1fr auto auto auto' }}
                          onClick={() => handleExpand(row.userId, row.worldId)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-subtle text-[13px] font-medium text-text">
                              {row.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="text-[13px] text-text truncate">{row.displayName}</div>
                          </div>
                          {isSuperAdmin && (
                            <div className="text-[12px] text-text-muted truncate">{row.campaignName}</div>
                          )}
                          <div className="flex items-center gap-2 text-[12px] text-text-muted">
                            <span>{row.worldIcon}</span>
                            <span className="truncate">{row.worldName}</span>
                          </div>
                          <div className="text-[13px] text-text tabular-nums">
                            <span className="font-medium">{row.completedLevels}</span>
                            <span className="text-text-muted">/{row.totalLevels}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <StarDisplay value={row.avgStars} size={14} />
                            <span className="text-[11px] text-text-muted tabular-nums">{row.avgStars.toFixed(1)}</span>
                          </div>
                          <div className="text-text-muted">
                            {isOpen
                              ? <ChevronDown className="h-4 w-4" />
                              : <ChevronRight className="h-4 w-4" />}
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isOpen && (
                          <div className="px-5 py-4 bg-subtle/40 border-t border-line">
                            <AttemptsList
                              loading={attemptsLoading}
                              attempts={attempts}
                              levelMap={levelMap}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Mobile cards ── */}
          <div className="md:hidden space-y-3">
            {filtered.map(row => {
              const key = `${row.userId}|${row.worldId}`
              const isOpen = expandedKey === key
              return (
                <div key={key} className="rounded-2xl border border-line bg-surface overflow-hidden">
                  <button
                    className="w-full px-4 py-4 text-left"
                    onClick={() => handleExpand(row.userId, row.worldId)}
                  >
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 bg-subtle text-[15px] font-medium text-text">
                          {row.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium text-text truncate">{row.displayName}</div>
                          {isSuperAdmin && (
                            <div className="text-[11px] text-text-muted truncate">{row.campaignName}</div>
                          )}
                        </div>
                      </div>
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
                      <span className="flex items-center gap-1.5 text-text-muted">
                        <span>{row.worldIcon}</span> {row.worldName}
                      </span>
                      <span className="text-text tabular-nums">
                        <span className="font-medium">{row.completedLevels}</span>/{row.totalLevels} niveles
                      </span>
                      <span className="flex items-center gap-1">
                        <StarDisplay value={row.avgStars} size={14} />
                        <span className="text-text-muted tabular-nums">{row.avgStars.toFixed(1)}</span>
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 py-3 bg-subtle/40 border-t border-line">
                      <AttemptsCards
                        loading={attemptsLoading}
                        attempts={attempts}
                        levelMap={levelMap}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Attempt detail sub-components ── */

function AttemptsList({ loading, attempts, levelMap }: {
  loading: boolean
  attempts: Attempt[]
  levelMap: Map<string, WorldLevel>
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-text-muted text-[13px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando intentos…
      </div>
    )
  }
  if (attempts.length === 0) {
    return <div className="py-4 text-[13px] text-text-muted">Sin intentos registrados.</div>
  }
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Historial de intentos</div>
      <div className="rounded-xl border border-line overflow-hidden">
        <div
          className="grid gap-4 px-4 py-2.5 text-[10px] uppercase tracking-wider text-text-muted bg-subtle"
          style={{ gridTemplateColumns: '1fr auto auto auto' }}
        >
          <span>Nivel</span>
          <span>Score</span>
          <span>Estrellas</span>
          <span>Fecha</span>
        </div>
        <div className="divide-y divide-line">
          {attempts.map(a => {
            const lvl = levelMap.get(a.level_id)
            return (
              <div
                key={a.id}
                className="grid gap-4 px-4 py-2.5 items-center text-[12px]"
                style={{ gridTemplateColumns: '1fr auto auto auto' }}
              >
                <div className="text-text truncate">{lvl?.name ?? a.level_id.slice(0, 8)}</div>
                <div className="text-text tabular-nums font-medium">{a.score}%</div>
                <div><StarDisplay value={getStarsDisplay(a.score)} size={14} /></div>
                <div className="text-text-muted tabular-nums">
                  {new Date(a.completed_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AttemptsCards({ loading, attempts, levelMap }: {
  loading: boolean
  attempts: Attempt[]
  levelMap: Map<string, WorldLevel>
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-text-muted text-[13px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  }
  if (attempts.length === 0) {
    return <div className="py-3 text-[13px] text-text-muted">Sin intentos registrados.</div>
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">Historial de intentos</div>
      {attempts.map(a => {
        const lvl = levelMap.get(a.level_id)
        return (
          <div key={a.id} className="rounded-xl border border-line bg-surface px-3.5 py-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[13px] text-text font-medium truncate">{lvl?.name ?? a.level_id.slice(0, 8)}</div>
              <div className="text-[12px] text-text-muted tabular-nums shrink-0">
                {new Date(a.completed_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
              </div>
            </div>
            <div className="flex items-center gap-3 text-[12px]">
              <span className="text-text tabular-nums font-medium">{a.score}%</span>
              <StarDisplay value={getStarsDisplay(a.score)} size={14} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
