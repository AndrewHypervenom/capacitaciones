import { useCallback, useEffect, useMemo, useState } from 'react'
import i18n from '@/i18n'
import { ChevronDown, ChevronRight, Download, Loader2, Search, Globe2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getMyPeopleIds, getOrganizations, getOrgUnits } from '@/services/org.service'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { getAudience, matchesAudience, type AudienceRule } from '@/services/audiences.service'
import { cn } from '@/lib/cn'
import { useAuth } from '@/hooks/useAuth'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { getStarsFromScore, getStarsDisplay } from '@/lib/scoring'
import { hideInactiveUnlessSuperAdmin } from '@/lib/activeUsers'
import { fold } from '@/lib/normalize'
import { pickLang } from '@/lib/contentLang'
import StarDisplay from '@/components/StarDisplay'
import { PanelHeader, InsightBanner, StatStrip, PickCourseFirst } from './progress/ProgressChrome'
import type { OrgUnit } from '@/types/database'

const WORLD_ACCENT = 'rgb(var(--brand-green))'

interface Campaign { id: string; name: string }
interface World { id: string; name: string; icon: string; campaign_id: string | null; course_id: string | null }
interface WorldLevel { id: string; name: string; world_id: string; order_index: number; min_score_pct: number | null }
/* Tipo local reducido: esta vista pide `select('*')` pero solo usa un puñado de
   campos, y declararlos aquí evita arrastrar el Row entero de la base. */
interface Profile {
  id: string
  display_name: string | null
  campaign_id: string | null
  is_active?: boolean | null
  country?: string | null
  operation_id?: string | null
  area_id?: string | null
  is_client?: boolean | null
}
interface Progress { user_id: string; level_id: string; world_id: string; score: number }
interface Attempt { id: string; level_id: string; score: number; completed_at: string }

// Aprendiz que empezó pero no ha terminado y con promedio por debajo de este score → "en riesgo".
const RISK_SCORE = 60

type LearnerStatus = 'not_started' | 'in_progress' | 'at_risk' | 'completed'

// Colores de estado — legibles en claro y oscuro. Se usan en dona, chips y badges.
const STATUS_META: Record<LearnerStatus, { color: string; labelKey: string; fallback: string }> = {
  completed:   { color: '#22c55e', labelKey: 'admin.feedback_panel.status_completed',   fallback: 'Completado' },
  in_progress: { color: '#3b82f6', labelKey: 'admin.feedback_panel.status_in_progress', fallback: 'En progreso' },
  at_risk:     { color: '#ef4444', labelKey: 'admin.feedback_panel.status_at_risk',     fallback: 'En riesgo' },
  not_started: { color: '#94a3b8', labelKey: 'admin.feedback_panel.status_not_started', fallback: 'Sin empezar' },
}
// Orden de severidad para el sort por estado y para pintar la dona/leyenda.
const STATUS_ORDER: LearnerStatus[] = ['at_risk', 'not_started', 'in_progress', 'completed']

function statusLabel(s: LearnerStatus) {
  return i18n.t(STATUS_META[s].labelKey, STATUS_META[s].fallback)
}

interface WorldStat {
  worldId: string
  worldName: string
  worldIcon: string
  /** Curso DEL MUNDO (no de la persona): con eso filtran los selectores. */
  courseId: string | null
  completedLevels: number
  totalLevels: number
  avgStars: number
  avgScore: number
}

interface LearnerRow {
  userId: string
  displayName: string
  /** CR y área de la persona: los ejes con los que ahora se acota todo. */
  operationId: string | null
  areaId: string | null
  worlds: WorldStat[]
  completedLevels: number
  totalLevels: number
  avgStars: number
  avgScore: number
  status: LearnerStatus
}

type SortKey = 'name' | 'estado' | 'avance' | 'desempeno' | 'estrellas'

const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

function computeStatus(completed: number, total: number, avgScore: number): LearnerStatus {
  if (completed === 0) return 'not_started'
  if (total > 0 && completed >= total) return 'completed'
  if (avgScore < RISK_SCORE) return 'at_risk'
  return 'in_progress'
}

export default function FeedbackPanel() {
  const { isSuperAdmin, isCapacitador, campaignId, user, loading: authLoading } = useAuth()
  // El capacitador ve el progreso de sus campañas (casa + colaboraciones); el superadmin todas.
  const scopedToCampaign = !isSuperAdmin

  const [loading, setLoading] = useState(true)
  /* Datos en bruto: las filas se arman en memoria para el CURSO elegido. */
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [progress, setProgress] = useState<Progress[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [worlds, setWorlds] = useState<World[]>([])
  const [levels, setLevels] = useState<WorldLevel[]>([])
  /* CR y área: los mismos cortes que el Panorama, para que las tres vistas de
     Progreso se filtren igual. Se comparan por id, no por nombre. */
  const [filterOperation, setFilterOperation] = useState('all')
  const [filterArea, setFilterArea] = useState('all')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [filterWorld, setFilterWorld] = useState('all')
  /* El CURSO es obligatorio: sin él no se muestra nada. Es el mismo criterio
     del Panorama y de Simulaciones, para que las tres vistas se usen igual. */
  const [filterCourse, setFilterCourse] = useState('all')
  const courseChosen = filterCourse !== 'all'
  /** A quién le llega el curso elegido: asignación individual + regla. */
  const [reach, setReach] = useState<{ courseId: string; assigned: Set<string>; rule: AudienceRule | null; published: boolean } | null>(null)
  /** curso → título, solo de los cursos que tienen mundos. */
  const [courseTitles, setCourseTitles] = useState<Map<string, string>>(new Map())
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<LearnerStatus | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'avance', dir: 'desc' })
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [expandedWorldKey, setExpandedWorldKey] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [attemptsLoading, setAttemptsLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  /* El catálogo de CR y áreas: noventa y cinco filas de dos columnas. Se pide
     siempre porque es lo que hay que poder elegir. */
  useEffect(() => {
    let vivo = true
    void getOrganizations()
      .then((orgs) => (orgs[0] ? getOrgUnits(orgs[0].id) : []))
      .then((list) => { if (vivo) setUnits(list) })
      .catch(() => { if (vivo) setUnits([]) })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (authLoading) return
    // Guarda de cancelación + carga a prueba de fallos: si un query falla o el
    // panel se desmonta (cambio rápido de vista), no dejamos el spinner colgado.
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
      // Campañas accesibles (superadmin: todas; capacitador: casa + colaboraciones).
      const accessible = await getAccessibleCampaigns({
        isSuperAdmin,
        homeCampaignId: campaignId,
        userId: user?.id ?? null,
      }).catch(() => [] as Campaign[])
      const ids = accessible.map((c) => c.id)
      if (scopedToCampaign && ids.length === 0) {
        if (!cancelled) { setCampaigns([]); setProfiles([]); setProgress([]) }
        return
      }
      const scope = ids.length ? ids : ['']

      // Quién es "mi gente" ahora: los aprendices alcanzados por mis cursos.
      // `null` = el RPC todavía no existe → se cae al filtro por campaña.
      const myPeople = scopedToCampaign ? await getMyPeopleIds().catch(() => null) : null

      const [campRes, worldRes, levelRes, profileRes, progressRes] = await Promise.all([
        Promise.resolve({ data: accessible }),
        (() => {
          let q = supabase.from('worlds').select('id,name,icon,campaign_id,course_id')
          if (scopedToCampaign) q = q.in('campaign_id', scope)
          return q
        })(),
        supabase.from('world_levels').select('id,name,world_id,order_index,min_score_pct').order('order_index'),
        (() => {
          // `*` a propósito: ver src/lib/activeUsers.ts (las cuentas dadas de
          // baja se filtran en memoria para no depender de la columna).
          let q = supabase.from('profiles').select('*').eq('role', 'learner')
          // Mi gente = los aprendices alcanzados por mis cursos (ver
          // get_my_people_ids). `myPeople` es null si el SQL no se ha corrido:
          // entonces se cae al filtro por campaña de siempre.
          if (scopedToCampaign) {
            q = myPeople
              ? q.in('id', myPeople.length ? myPeople : [''])
              : q.in('campaign_id', scope)
          }
          return q
        })(),
        (() => {
          let q = supabase.from('world_progress').select('user_id,level_id,world_id,score').eq('completed', true)
          if (scopedToCampaign) q = q.in('campaign_id', scope)
          return q
        })(),
      ])

      if (progressRes.error) console.error('world_progress query error:', progressRes.error)
      if (profileRes.error) console.error('profiles query error:', profileRes.error)

      const camps = (campRes.data ?? []) as Campaign[]
      const ws = (worldRes.data ?? []) as World[]
      const lvls = (levelRes.data ?? []) as WorldLevel[]
      // El capacitador ve a su gente vigente; las bajas quedan para el superadmin.
      const profiles = hideInactiveUnlessSuperAdmin((profileRes.data ?? []) as Profile[], isSuperAdmin)
      const progress = (progressRes.data ?? []) as Progress[]

      // Títulos de los cursos a los que cuelgan los mundos: solo eso hace falta
      // para el filtro por curso, así no se trae el catálogo entero.
      const courseIds = [...new Set(ws.map(w => w.course_id).filter(Boolean))] as string[]
      const courseMap = new Map<string, string>()
      if (courseIds.length > 0) {
        const { data: courseRows } = await supabase
          .from('courses')
          .select('id,title_es,title_en,title_pt')
          .in('id', courseIds)
        for (const c of (courseRows ?? []) as Array<{ id: string; title_es: string; title_en: string | null; title_pt: string | null }>) {
          courseMap.set(c.id, pickLang(c.title_es, c.title_en, c.title_pt, i18n.resolvedLanguage ?? 'es') || c.title_es)
        }
      }

      if (cancelled) return
      setCampaigns(camps)
      setWorlds(ws)
      setCourseTitles(courseMap)
      setLevels(lvls)
      setProfiles(profiles)
      setProgress(progress)

      } catch (e) {
        if (!cancelled) console.error('FeedbackPanel load error:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopedToCampaign, campaignId, user?.id])

  /* A quién le llega el curso elegido. El programa ya no entrega cursos: cuenta
     quien lo tiene asignado, quien cumple su regla país/área/CR y quien ya jugó
     su mundo (aunque hoy no le toque, su progreso existe). */
  useEffect(() => {
    if (!courseChosen) return
    let vivo = true
    void Promise.all([
      supabase.from('course_assignments').select('user_id').eq('course_id', filterCourse),
      getAudience(filterCourse).catch(() => null),
      supabase.from('courses').select('is_published').eq('id', filterCourse).maybeSingle(),
    ]).then(([asg, rule, course]) => {
      if (!vivo) return
      setReach({
        courseId: filterCourse,
        assigned: new Set(((asg.data ?? []) as Array<{ user_id: string }>).map((a) => a.user_id)),
        rule,
        published: (course.data as { is_published?: boolean } | null)?.is_published === true,
      })
    })
    return () => { vivo = false }
  }, [courseChosen, filterCourse])

  const reachReady = courseChosen && reach?.courseId === filterCourse

  /** Una fila por persona alcanzada por el curso, con los mundos DE ese curso. */
  const rows = useMemo<LearnerRow[]>(() => {
    if (!reachReady || !reach) return []
    const courseWorlds = worlds.filter(w => w.course_id === filterCourse)
    if (courseWorlds.length === 0) return []
    const worldIds = new Set(courseWorlds.map(w => w.id))
    const levelsByWorld = new Map<string, WorldLevel[]>()
    for (const l of levels) {
      if (!worldIds.has(l.world_id)) continue
      const arr = levelsByWorld.get(l.world_id) ?? []
      arr.push(l)
      levelsByWorld.set(l.world_id, arr)
    }
    const levelMap = new Map(levels.map(l => [l.id, l]))
    const progressByUserWorld = new Map<string, Progress[]>()
    for (const p of progress) {
      if (!worldIds.has(p.world_id)) continue
      const key = `${p.user_id}|${p.world_id}`
      const arr = progressByUserWorld.get(key) ?? []
      arr.push(p)
      progressByUserWorld.set(key, arr)
    }
    const played = new Set(progress.filter(p => worldIds.has(p.world_id)).map(p => p.user_id))

    const result: LearnerRow[] = []
    for (const profile of profiles) {
      const byRule = !!reach.rule && reach.published && matchesAudience(reach.rule, profile)
      if (!reach.assigned.has(profile.id) && !byRule && !played.has(profile.id)) continue

      const worldStats: WorldStat[] = []
      const allStars: number[] = []
      const allScores: number[] = []
      let totalCompleted = 0
      let totalLevels = 0
      for (const w of courseWorlds) {
        const wLevels = levelsByWorld.get(w.id) ?? []
        const progs = progressByUserWorld.get(`${profile.id}|${w.id}`) ?? []
        const starVals = progs.map(p => getStarsFromScore(p.score, levelMap.get(p.level_id)?.min_score_pct ?? null))
        const scoreVals = progs.map(p => p.score)
        allStars.push(...starVals)
        allScores.push(...scoreVals)
        totalCompleted += progs.length
        totalLevels += wLevels.length
        worldStats.push({
          worldId: w.id,
          worldName: w.name,
          worldIcon: w.icon,
          courseId: w.course_id,
          completedLevels: progs.length,
          totalLevels: wLevels.length,
          avgStars: Math.round(avg(starVals) * 10) / 10,
          avgScore: Math.round(avg(scoreVals)),
        })
      }
      const avgScore = Math.round(avg(allScores))
      result.push({
        userId: profile.id,
        displayName: profile.display_name ?? 'Sin nombre',
        operationId: profile.operation_id ?? null,
        areaId: profile.area_id ?? null,
        worlds: worldStats,
        completedLevels: totalCompleted,
        totalLevels,
        avgStars: Math.round(avg(allStars) * 10) / 10,
        avgScore,
        status: computeStatus(totalCompleted, totalLevels, avgScore),
      })
    }
    return result
  }, [reachReady, reach, worlds, levels, progress, profiles, filterCourse])

  // Ámbito: curso (obligatorio) + mundo + CR/área. Alimenta KPIs, dona y chips.
  const scoped = useMemo(() => rows.filter(r => {
    if (filterWorld !== 'all' && !r.worlds.some(w => w.worldId === filterWorld)) return false
    if (filterOperation !== 'all' && r.operationId !== filterOperation) return false
    if (filterArea !== 'all' && r.areaId !== filterArea) return false
    return true
  }), [rows, filterWorld, filterOperation, filterArea])

  /** Cursos que tienen mundos. */
  const courseOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const w of worlds) if (w.course_id) ids.add(w.course_id)
    return [...ids]
      .map(id => ({ value: id, label: courseTitles.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [worlds, courseTitles])

  const unitName = useMemo(() => new Map(units.map(u => [u.id, u.name])), [units])

  /** Mundos que ofrece el selector: los del curso elegido, si hay uno. */
  const worldOptions = useMemo(
    () => worlds.filter(w => w.course_id === filterCourse),
    [worlds, filterCourse],
  )

  // KPIs + distribución por estado, derivados del ámbito.
  const stats = useMemo(() => {
    const learners = scoped.length
    let totalCompleted = 0
    let totalLevels = 0
    const scores: number[] = []
    const starsPerLearner: number[] = []
    const statusCounts: Record<LearnerStatus, number> = { not_started: 0, in_progress: 0, at_risk: 0, completed: 0 }

    for (const r of scoped) {
      totalCompleted += r.completedLevels
      totalLevels += r.totalLevels
      if (r.completedLevels > 0) { scores.push(r.avgScore); starsPerLearner.push(r.avgStars) }
      statusCounts[r.status]++
    }

    // Tasas normalizadas (las que pide cualquier informe de formación):
    // participación = quién empezó de quién podía; finalización = quién terminó
    // de quién empezó. Se calculan sobre el mismo conjunto para que sumen.
    const started = learners - statusCounts.not_started
    return {
      learners,
      avance: totalLevels > 0 ? Math.round((totalCompleted / totalLevels) * 100) : 0,
      desempeno: Math.round(avg(scores)),
      avgStars: avg(starsPerLearner),
      statusCounts,
      started,
      participation: learners > 0 ? Math.round((started / learners) * 100) : 0,
      completion: started > 0 ? Math.round((statusCounts.completed / started) * 100) : 0,
    }
  }, [scoped])

  // Filas de la tabla: ámbito + chip de estado + búsqueda, ordenadas.
  const tableRows = useMemo(() => {
    const q = fold(search)
    let list = scoped.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (q && !fold(r.displayName).includes(q)) return false
      return true
    })
    const m = sort.dir === 'asc' ? 1 : -1
    const ratio = (r: LearnerRow) => (r.totalLevels > 0 ? r.completedLevels / r.totalLevels : 0)
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case 'name': return a.displayName.localeCompare(b.displayName) * m
        case 'estado': return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * m
        case 'avance': return (ratio(a) - ratio(b)) * m
        case 'desempeno': return (a.avgScore - b.avgScore) * m
        case 'estrellas': return (a.avgStars - b.avgStars) * m
        default: return 0
      }
    })
    return list
  }, [scoped, statusFilter, search, sort])

  const canExport = !isSuperAdmin && isCapacitador

  const handleExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const worldRows = tableRows.flatMap(r => r.worlds.map(w => ({ ...w, userId: r.userId, displayName: r.displayName })))
      const userIds = [...new Set(tableRows.map(r => r.userId))]
      const worldIds = [...new Set(worldRows.map(w => w.worldId))]

      const { data: allAttempts } = await supabase
        .from('world_level_attempts')
        .select('id,user_id,level_id,world_id,score,completed_at')
        .in('user_id', userIds)
        .in('world_id', worldIds)
        .order('completed_at', { ascending: false })

      const profileMap = new Map(tableRows.map(r => [r.userId, r.displayName]))
      const worldNameMap = new Map(worlds.map(w => [w.id, w.name]))
      const lvlMap = new Map(levels.map(l => [l.id, l]))

      const sheet1 = tableRows.map(r => ({
        Nombre: r.displayName,
        Estado: statusLabel(r.status),
        'Niveles completados': r.completedLevels,
        'Total de niveles': r.totalLevels,
        'Desempeño (%)': r.avgScore,
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

      const courseName = courseTitles.get(filterCourse) ?? 'General'
      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `progreso_mundos_${courseName.replace(/[^\p{L}\p{N}]+/gu, '_')}_${date}.xlsx`)
    } finally {
      setExporting(false)
    }
  }, [tableRows, worlds, levels, courseTitles, filterCourse, exporting])

  const toggleUser = (userId: string) => {
    setExpandedUser(prev => (prev === userId ? null : userId))
    setExpandedWorldKey(null)
  }

  const handleExpandWorld = async (userId: string, worldId: string) => {
    const key = `${userId}|${worldId}`
    if (expandedWorldKey === key) { setExpandedWorldKey(null); return }

    setExpandedWorldKey(key)
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

  const setSortKey = (key: SortKey) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' })
  }

  if (!authLoading && !loading && scopedToCampaign && campaigns.length === 0) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{i18n.t('admin.feedback_panel.title')}</h1>
        <div
          className="mt-8 rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}
        >
          <div className="text-[15px] font-medium text-text mb-2">{i18n.t('admin.worlds.no_campaign_title')}</div>
          <div className="text-[13px] text-text-muted">{i18n.t('admin.worlds.no_campaign_desc')}</div>
        </div>
      </div>
    )
  }

  const levelMap = new Map(levels.map(l => [l.id, l]))
  const statusChips: Array<LearnerStatus | 'all'> = ['all', ...STATUS_ORDER]

  return (
    <div className="p-4 sm:p-8">
      <PanelHeader
        icon={<Globe2 className="h-6 w-6" />}
        accent={WORLD_ACCENT}
        title={i18n.t('admin.feedback_panel.title')}
        subtitle={i18n.t('admin.feedback_panel.subtitle')}
        actions={canExport && !loading && tableRows.length > 0 ? (
          <button
            onClick={handleExport}
            disabled={exporting}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'rgb(var(--brand-green) / 0.12)', color: 'rgb(var(--brand-green))', border: '1px solid rgb(var(--brand-green) / 0.25)' }}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar a Excel
          </button>
        ) : undefined}
      />

      {/* Filtros. El CURSO va primero y es obligatorio —resaltado mientras no
          se elige—: sin él la tabla mezclaba mundos de cursos distintos y la
          gente se perdía. CR, área y mundo recortan dentro del curso. */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className={cn('rounded-xl', !courseChosen && 'ring-2 ring-[rgb(var(--brand-green))] ring-offset-2 ring-offset-bg')}>
          <FilterDropdown
            value={courseChosen ? filterCourse : ''}
            onChange={v => { setFilterCourse(v || 'all'); setFilterWorld('all') }}
            options={[{ value: '', label: i18n.t('admin.progress_overview.pick_course', 'Elige un curso (obligatorio)') }, ...courseOptions]}
            className="max-w-xs"
          />
        </div>
        <FilterDropdown
          value={filterOperation === 'all' ? '' : filterOperation}
          onChange={v => setFilterOperation(v || 'all')}
          options={[
            { value: '', label: i18n.t('admin.progress_overview.all_operations', 'Todos los CR') },
            ...units.filter(u => u.kind === 'operation').map(u => ({ value: u.id, label: u.name })),
          ]}
          className="max-w-xs"
        />
        <FilterDropdown
          value={filterArea === 'all' ? '' : filterArea}
          onChange={v => setFilterArea(v || 'all')}
          options={[
            { value: '', label: i18n.t('admin.progress_overview.all_areas', 'Todas las áreas') },
            ...units.filter(u => u.kind === 'area').map(u => ({ value: u.id, label: u.name })),
          ]}
          className="max-w-xs"
        />
        {courseChosen && worldOptions.length > 1 && (
          <FilterDropdown
            value={filterWorld === 'all' ? '' : filterWorld}
            onChange={v => setFilterWorld(v || 'all')}
            options={[{ value: '', label: i18n.t('admin.feedback_panel.all_worlds', 'Todos los mundos') }, ...worldOptions.map(w => ({ value: w.id, label: `${w.icon} ${w.name}` }))]}
            className="max-w-xs"
          />
        )}
      </div>

      {/* Loading */}
      {!loading && !courseChosen ? (
        <PickCourseFirst accent={WORLD_ACCENT} title={i18n.t('admin.progress_overview.pick_course_title', 'Primero elige un curso')} body={i18n.t('admin.feedback_panel.pick_course_body', 'Todo lo de abajo habla de UN curso: quién tiene su mundo, cuántos niveles lleva y con qué nota. Después puedes recortar por CR, área o mundo.')} />
      ) : loading || !reachReady ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : scoped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
          <div className="text-[2rem] mb-3">📊</div>
          <div className="text-[15px] font-medium text-text mb-2">{i18n.t('admin.feedback_panel.no_data')}</div>
          <div className="text-[13px] text-text-muted">{i18n.t('admin.feedback_panel.no_data_desc')}</div>
        </div>
      ) : (
        <>
          {/* ── Las cifras, en una tira ──────────────────────────────────
              Mismo criterio que el Panorama: seis tarjetas altas empujaban la
              tabla fuera de la primera pantalla, así que pulsar una para
              filtrar parecía no hacer nada. Siguen siendo las mismas seis y
              siguen filtrando igual; ahora la tabla está justo debajo. */}
          <StatStrip
            moreLabel={i18n.t('admin.progress_overview.more_stats', 'Más cifras')}
            lessLabel={i18n.t('admin.progress_overview.less_stats', 'Menos cifras')}
            items={[
              {
                key: 'learners',
                label: i18n.t('admin.feedback_panel.kpi_learners', 'Aprendices alcanzados'),
                value: String(stats.learners),
                accent: WORLD_ACCENT,
                hint: stats.statusCounts.not_started > 0
                  ? i18n.t('admin.feedback_panel.kpi_learners_idle', { count: stats.statusCounts.not_started, defaultValue: '{{count}} sin empezar' })
                  : i18n.t('admin.feedback_panel.kpi_learners_hint', 'Personas con mundos disponibles en este alcance.'),
              },
              {
                key: 'participation',
                label: i18n.t('admin.feedback_panel.kpi_participation', 'Participación'),
                value: `${stats.participation}%`,
                accent: '#3b82f6',
                onClick: () => setStatusFilter(statusFilter === 'not_started' ? 'all' : 'not_started'),
                active: statusFilter === 'not_started',
                hint: `${stats.started}/${stats.learners} · ${i18n.t('admin.feedback_panel.kpi_participation_hint', 'Quiénes empezaron, de todos los que podían.')}`,
              },
              {
                key: 'completion',
                label: i18n.t('admin.feedback_panel.kpi_completion', 'Finalización'),
                value: `${stats.completion}%`,
                accent: '#22c55e',
                onClick: () => setStatusFilter(statusFilter === 'completed' ? 'all' : 'completed'),
                active: statusFilter === 'completed',
                hint: `${stats.statusCounts.completed}/${stats.started} · ${i18n.t('admin.feedback_panel.kpi_completion_hint', 'De los que empezaron, cuántos terminaron todos sus niveles.')}`,
              },
              {
                key: 'risk',
                label: i18n.t('admin.feedback_panel.kpi_at_risk', 'En riesgo'),
                value: String(stats.statusCounts.at_risk),
                accent: '#ef4444',
                onClick: () => setStatusFilter(statusFilter === 'at_risk' ? 'all' : 'at_risk'),
                active: statusFilter === 'at_risk',
                hint: i18n.t('admin.feedback_panel.kpi_at_risk_hint', 'Empezaron pero su desempeño promedio no llega al 60%.'),
              },
            ]}
            secondary={[
              {
                key: 'avance',
                label: i18n.t('admin.feedback_panel.kpi_avance', 'Avance de niveles'),
                value: `${stats.avance}%`,
                accent: WORLD_ACCENT,
                hint: i18n.t('admin.feedback_panel.kpi_avance_hint', 'Niveles completados sobre los niveles que les tocan.'),
              },
              {
                key: 'stars',
                label: i18n.t('admin.feedback_panel.kpi_avg_stars', 'Estrellas promedio'),
                value: `${stats.avgStars.toFixed(1)} / 3`,
                accent: '#f59e0b',
                hint: i18n.t('admin.feedback_panel.kpi_stars_hint', 'Calidad con la que superan los niveles, no solo si los superan.'),
              },
            ]}
          />

          {/* Insight accionable: aprendices en riesgo */}
          {stats.statusCounts.at_risk > 0 && statusFilter !== 'at_risk' && (
            <InsightBanner
              icon={<AlertTriangle className="h-5 w-5" />}
              title={i18n.t('admin.feedback_panel.risk_title', { count: stats.statusCounts.at_risk, defaultValue: '{{count}} aprendices en riesgo' })}
              detail={i18n.t('admin.feedback_panel.risk_detail', 'Empezaron pero su desempeño promedio está por debajo del 60%.')}
              actionLabel={i18n.t('admin.feedback_panel.risk_action', 'Ver quiénes')}
              onAction={() => setStatusFilter('at_risk')}
            />
          )}

          {/* ── Distribución por estado ── */}
          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-4 sm:mb-5">
            <div className="mb-5 sm:mb-6">
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-1">
                {i18n.t('admin.feedback_panel.distribution_title', 'Distribución por estado')}
              </h3>
              <p className="text-[13px] text-text-muted">
                {i18n.t('admin.feedback_panel.distribution_subtitle', 'Cómo se reparten los aprendices según su avance')}
              </p>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
              <StatusDonut total={stats.learners} counts={stats.statusCounts} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 w-full">
                {STATUS_ORDER.map(s => {
                  const count = stats.statusCounts[s]
                  const pct = stats.learners > 0 ? Math.round((count / stats.learners) * 100) : 0
                  return (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(prev => (prev === s ? 'all' : s))}
                      className="flex items-center gap-3 min-w-0 text-left rounded-lg -mx-2 px-2 py-1 hover:bg-subtle/60 transition-colors"
                    >
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

          {/* ── Toolbar: búsqueda + chips de estado ── */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="relative sm:max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/70" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={i18n.t('admin.feedback_panel.search_ph', 'Buscar aprendiz…')}
                className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-muted/60 outline-none focus:border-[rgb(var(--brand-green))]/40 transition-colors"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {statusChips.map(s => {
                const active = statusFilter === s
                const label = s === 'all' ? i18n.t('admin.feedback_panel.status_all', 'Todos') : statusLabel(s)
                const count = s === 'all' ? stats.learners : stats.statusCounts[s]
                const color = s === 'all' ? undefined : STATUS_META[s].color
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
                    style={active
                      ? { borderColor: color ?? 'rgb(var(--brand-green))', color: color ?? 'rgb(var(--brand-green))', background: `${color ?? 'rgb(var(--brand-green))'}1a` }
                      : undefined}
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
              <div className="text-[13px] text-text-muted">{i18n.t('admin.feedback_panel.no_match', 'Ningún aprendiz coincide con los filtros.')}</div>
            </div>
          ) : (
          <>
          {/* ── Desktop table ── */}
          <div className="hidden md:block rounded-2xl border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                {/* Header */}
                <div
                  className="grid gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle"
                  style={{ gridTemplateColumns: '1.4fr 1fr auto 1.2fr auto auto auto' }}
                >
                  <SortTh label={i18n.t('admin.feedback_panel.col_learner')} col="name" sort={sort} onSort={setSortKey} />
                  <span>{i18n.t('admin.progress_overview.col_cr', 'CR')}</span>
                  <SortTh label={i18n.t('admin.feedback_panel.col_status', 'Estado')} col="estado" sort={sort} onSort={setSortKey} />
                  <SortTh label={i18n.t('admin.feedback_panel.col_progress', 'Avance')} col="avance" sort={sort} onSort={setSortKey} />
                  <SortTh label={i18n.t('admin.feedback_panel.col_performance', 'Desempeño')} col="desempeno" sort={sort} onSort={setSortKey} />
                  <SortTh label={i18n.t('admin.feedback_panel.col_avg')} col="estrellas" sort={sort} onSort={setSortKey} />
                  <span />
                </div>
                {/* Rows */}
                <div className="divide-y divide-line">
                  {tableRows.map(row => {
                    const isOpen = expandedUser === row.userId
                    const atRisk = row.status === 'at_risk'
                    return (
                      <div key={row.userId} style={atRisk ? { boxShadow: 'inset 3px 0 0 #ef4444' } : undefined}>
                        <div
                          className="grid gap-4 px-5 py-3.5 items-center cursor-pointer hover:bg-subtle/50 transition-colors"
                          style={{ gridTemplateColumns: '1.4fr 1fr auto 1.2fr auto auto auto' }}
                          onClick={() => toggleUser(row.userId)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-subtle text-[13px] font-medium text-text">
                              {row.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="text-[13px] text-text truncate">{row.displayName}</div>
                          </div>
                          <div className={cn('text-[12px] truncate', row.operationId ? 'text-text-muted' : 'text-amber-600 dark:text-amber-400')}>
                            {(row.operationId && unitName.get(row.operationId)) || i18n.t('admin.progress_overview.no_cr', 'Sin CR asignado')}
                          </div>
                          <StatusBadge status={row.status} />
                          <ProgressBar completed={row.completedLevels} total={row.totalLevels} />
                          <div className="text-[13px] text-text tabular-nums font-medium">{row.avgScore}%</div>
                          <div className="flex items-center gap-1.5">
                            <StarDisplay value={row.avgStars} size={14} />
                            <span className="text-[11px] text-text-muted tabular-nums">{row.avgStars.toFixed(1)}</span>
                          </div>
                          <div className="text-text-muted">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </div>
                        </div>

                        {/* Expanded detail: worlds + attempts */}
                        {isOpen && (
                          <div className="px-5 py-4 bg-subtle/40 border-t border-line">
                            <WorldBreakdown
                              worlds={row.worlds}
                              userId={row.userId}
                              expandedWorldKey={expandedWorldKey}
                              onToggleWorld={handleExpandWorld}
                              attempts={attempts}
                              attemptsLoading={attemptsLoading}
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
            {tableRows.map(row => {
              const isOpen = expandedUser === row.userId
              const atRisk = row.status === 'at_risk'
              return (
                <div
                  key={row.userId}
                  className="rounded-2xl border border-line bg-surface overflow-hidden"
                  style={atRisk ? { boxShadow: 'inset 3px 0 0 #ef4444' } : undefined}
                >
                  <button className="w-full px-4 py-4 text-left" onClick={() => toggleUser(row.userId)}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 bg-subtle text-[15px] font-medium text-text">
                          {row.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium text-text truncate">{row.displayName}</div>
                          <div className="text-[11px] text-text-muted truncate">
                            {(row.operationId && unitName.get(row.operationId)) || i18n.t('admin.progress_overview.no_cr', 'Sin CR asignado')}
                          </div>
                        </div>
                      </div>
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <StatusBadge status={row.status} />
                      <span className="text-[12px] text-text tabular-nums">{row.avgScore}%</span>
                      <span className="flex items-center gap-1">
                        <StarDisplay value={row.avgStars} size={14} />
                        <span className="text-[11px] text-text-muted tabular-nums">{row.avgStars.toFixed(1)}</span>
                      </span>
                    </div>
                    <ProgressBar completed={row.completedLevels} total={row.totalLevels} />
                  </button>

                  {isOpen && (
                    <div className="px-4 py-3 bg-subtle/40 border-t border-line">
                      <WorldBreakdown
                        worlds={row.worlds}
                        userId={row.userId}
                        expandedWorldKey={expandedWorldKey}
                        onToggleWorld={handleExpandWorld}
                        attempts={attempts}
                        attemptsLoading={attemptsLoading}
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
        </>
      )}
    </div>
  )
}

/* ── Dashboard sub-components ── */

function StatusDonut({ total, counts }: { total: number; counts: Record<LearnerStatus, number> }) {
  const C = 2 * Math.PI * 40
  let offset = 0
  return (
    <div className="relative w-44 h-44 sm:w-56 sm:h-56 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="transparent" strokeWidth="12" className="text-line" stroke="currentColor" />
        {STATUS_ORDER.map(s => {
          const share = total > 0 ? counts[s] / total : 0
          const len = share * C
          if (len <= 0) return null
          const circle = (
            <circle
              key={s}
              cx="50"
              cy="50"
              r="40"
              fill="transparent"
              strokeWidth="12"
              stroke={STATUS_META[s].color}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
            />
          )
          offset += len
          return circle
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl sm:text-4xl font-bold text-text tabular-nums">{total}</span>
        <span className="text-[10px] uppercase tracking-widest text-text-muted">
          {i18n.t('admin.feedback_panel.kpi_learners', 'Aprendices')}
        </span>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: LearnerStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium w-fit"
      style={{ background: `${meta.color}1a`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {statusLabel(status)}
    </span>
  )
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 flex-1 max-w-[120px] rounded-full bg-line overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'rgb(var(--brand-green))' }} />
      </div>
      <span className="text-[12px] text-text tabular-nums shrink-0">
        <span className="font-medium">{completed}</span>
        <span className="text-text-muted">/{total}</span>
      </span>
    </div>
  )
}

function SortTh({ label, col, sort, onSort }: {
  label: string
  col: SortKey
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (k: SortKey) => void
}) {
  const active = sort.key === col
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-left uppercase tracking-wider ${active ? 'text-text' : 'hover:text-text'} transition-colors`}
    >
      {label}
      <ChevronDown className={`h-3 w-3 transition-transform ${active ? 'opacity-100' : 'opacity-0'} ${active && sort.dir === 'asc' ? 'rotate-180' : ''}`} />
    </button>
  )
}

/* ── Expanded: per-world breakdown + attempts ── */

function WorldBreakdown({ worlds, userId, expandedWorldKey, onToggleWorld, attempts, attemptsLoading, levelMap }: {
  worlds: WorldStat[]
  userId: string
  expandedWorldKey: string | null
  onToggleWorld: (userId: string, worldId: string) => void
  attempts: Attempt[]
  attemptsLoading: boolean
  levelMap: Map<string, WorldLevel>
}) {
  if (worlds.length === 0) {
    return <div className="py-3 text-[13px] text-text-muted">{i18n.t('admin.feedback_panel.no_worlds', 'Sin mundos asignados.')}</div>
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{i18n.t('admin.feedback_panel.by_world', 'Por mundo')}</div>
      {worlds.map(w => {
        const key = `${userId}|${w.worldId}`
        const isOpen = expandedWorldKey === key
        return (
          <div key={w.worldId} className="rounded-xl border border-line bg-surface overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-subtle/50 transition-colors"
              onClick={() => onToggleWorld(userId, w.worldId)}
            >
              <span className="text-[15px]">{w.worldIcon}</span>
              <span className="text-[13px] text-text font-medium truncate flex-1">{w.worldName}</span>
              <span className="text-[12px] text-text tabular-nums shrink-0">
                <span className="font-medium">{w.completedLevels}</span>
                <span className="text-text-muted">/{w.totalLevels}</span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <StarDisplay value={w.avgStars} size={13} />
              </span>
              <span className="text-[12px] text-text-muted tabular-nums shrink-0 w-10 text-right">{w.avgScore}%</span>
              {isOpen ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
            </button>
            {isOpen && (
              <div className="px-4 py-3 border-t border-line bg-subtle/30">
                <AttemptsList loading={attemptsLoading} attempts={attempts} levelMap={levelMap} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AttemptsList({ loading, attempts, levelMap }: {
  loading: boolean
  attempts: Attempt[]
  levelMap: Map<string, WorldLevel>
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-text-muted text-[13px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando intentos…
      </div>
    )
  }
  if (attempts.length === 0) {
    return <div className="py-3 text-[13px] text-text-muted">{i18n.t('admin.feedback_panel.no_attempts')}</div>
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">{i18n.t('admin.feedback_panel.attempts_history')}</div>
      <div className="space-y-1.5">
        {attempts.map(a => {
          const lvl = levelMap.get(a.level_id)
          return (
            <div key={a.id} className="flex items-center gap-3 text-[12px]">
              <div className="text-text truncate flex-1">{lvl?.name ?? a.level_id.slice(0, 8)}</div>
              <div className="text-text tabular-nums font-medium shrink-0 w-10 text-right">{a.score}%</div>
              <div className="shrink-0"><StarDisplay value={getStarsDisplay(a.score)} size={13} /></div>
              <div className="text-text-muted tabular-nums shrink-0 w-24 text-right">
                {new Date(a.completed_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
