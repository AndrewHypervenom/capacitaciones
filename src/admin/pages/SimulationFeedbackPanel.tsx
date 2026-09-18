import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown, ChevronRight, Download, Loader2, Search, ListChecks,
  HeartHandshake, Clock, CheckCircle2, XCircle, Sparkles, PhoneCall, AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { readAllPages } from '@/services/readAllPages'
import { getMyPeopleIds } from '@/services/org.service'
import { getAudience, matchesAudience, type AudienceRule } from '@/services/audiences.service'
import { useAuth } from '@/hooks/useAuth'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { getOrganizations, getOrgUnits } from '@/services/org.service'
import type { OrgUnit } from '@/types/database'
import { hideInactiveUnlessSuperAdmin } from '@/lib/activeUsers'
import { fold } from '@/lib/normalize'
import { PanelHeader, InsightBanner, StatStrip, PickCourseFirst } from './progress/ProgressChrome'
import { cn } from '@/lib/cn'
import { pickLang } from '@/lib/contentLang'
import { toUtcMs } from '@/lib/datetime'
import { Tooltip } from '@/components/ui/Tooltip'

const SIM_ACCENT = 'rgb(var(--brand-cyan, 6 182 212))'

// ── Tipos de datos ───────────────────────────────────────────
/* Tipo local reducido: la vista pide `select('*')` pero solo usa unos pocos
   campos, y declararlos aquí evita arrastrar el Row entero de la base. */
interface Profile {
  id: string
  display_name: string | null
  campaign_id: string | null
  is_active?: boolean | null
  role?: string | null
  country?: string | null
  operation_id?: string | null
  area_id?: string | null
  is_client?: boolean | null
}

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

// El `hint` es lo que dice el globo: qué hizo falta exactamente para merecer
// ese chip. Sin él, "Dominado" y "Practicando" se leen como una opinión del
// sistema en vez de como una regla que se puede comprobar.
const STATUS_META: Record<LearnerStatus, { color: string; labelKey: string; fallback: string; hintKey: string; hintFallback: string }> = {
  completed: {
    color: '#22c55e', labelKey: 'admin.sim_panel.status_completed', fallback: 'Dominado',
    hintKey: 'admin.sim_panel.status_completed_hint',
    hintFallback: 'Su mejor puntaje llega al 80% Y cerró al menos una llamada llegando al final por sus propios medios.',
  },
  in_progress: {
    color: '#3b82f6', labelKey: 'admin.sim_panel.status_in_progress', fallback: 'Practicando',
    hintKey: 'admin.sim_panel.status_in_progress_hint',
    hintFallback: 'Ya practicó y su puntaje pasa del 60%, pero todavía no termina ninguna llamada: o colgó, o la conversación se cortó antes del cierre.',
  },
  at_risk: {
    color: '#ef4444', labelKey: 'admin.sim_panel.status_at_risk', fallback: 'En riesgo',
    hintKey: 'admin.sim_panel.status_at_risk_hint',
    hintFallback: 'Su mejor puntaje se queda por debajo del 60%. Conviene acompañarlo en la práctica.',
  },
  not_started: {
    color: '#94a3b8', labelKey: 'admin.sim_panel.status_not_started', fallback: 'Sin intentos',
    hintKey: 'admin.sim_panel.status_not_started_hint',
    hintFallback: 'Todavía no ha entrado al simulador dentro de este alcance.',
  },
}
const STATUS_ORDER: LearnerStatus[] = ['at_risk', 'not_started', 'in_progress', 'completed']

/** Valor del filtro para los intentos que no cuelgan de ningún curso. */
const NO_COURSE = '__no_course__'

/** Datos base del aprendiz (sin agregación), guardados tras la carga. */
interface LearnerBase {
  userId: string
  displayName: string
  /** País, CR y área de la persona: con ellos se decide si le llega el curso. */
  country?: string | null
  operationId?: string | null
  areaId?: string | null
  isClient?: boolean | null
  /**
   * Practicó contenido de este alcance pero NO está en la lista de gente del
   * capacitador (otra audiencia, cuenta dada de baja, o un perfil que la RLS no
   * deja leer). Se muestra igual: descartarlo era lo que hacía decir "todavía
   * no hay simulaciones registradas" con los intentos delante.
   */
  outsider?: boolean
  /**
   * El que practicó es staff (capacitador/superadmin/RH), no un aprendiz. Pasa
   * a menudo —el capacitador prueba su propio simulador— y hay que distinguirlo
   * a la vista: su intento no es participación de la gente formada.
   */
  staff?: boolean
}

interface LearnerRow extends LearnerBase {
  attempts: SimAttempt[]
  attemptsCount: number
  scenariosCount: number
  avgScore: number
  bestScore: number
  /** `null` cuando ningún intento las mide (simulador de opción múltiple). */
  avgEmpathy: number | null
  avgChecklist: number | null
  /** Cuántos de sus intentos traen empatía/checklist reales. */
  softCount: number
  resolvedRate: number
  status: LearnerStatus
  lastAt: number
}

type SortKey = 'name' | 'estado' | 'intentos' | 'desempeno' | 'empatia' | 'ultima'

const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

/**
 * Estado del aprendiz.
 *
 * "Dominado" exige puntaje ALTO **y** al menos una llamada resuelta. Sin lo
 * segundo, un ensayo abortado a los 18 segundos —acertó lo poco que alcanzó a
 * contestar y colgó— salía como "Dominado" con 100%, y quien lo leía no podía
 * reconciliarlo con su memoria: no había practicado la simulación completa.
 * Puntaje alto sin cerrar ninguna llamada es "Practicando", no dominio.
 */
function computeStatus(count: number, best: number, anyResolved: boolean): LearnerStatus {
  if (count === 0) return 'not_started'
  if (best >= PASS_SCORE && anyResolved) return 'completed'
  if (best < RISK_SCORE) return 'at_risk'
  return 'in_progress'
}

/**
 * ¿Este intento trae empatía y checklist DE VERDAD?
 *
 * El simulador de opción múltiple NO los mide: guarda el puntaje copiado en las
 * tres columnas (ver ChoiceSimulatorRun.tsx). Mostrarlos como "Empatía 56%" era
 * inventarse un dato — ese 56% era el promedio de sus puntajes, nada más. Se
 * reconocen por el slug; para un escenario fuera del alcance del capacitador
 * (que no aparece en ninguna de las dos tablas) queda la firma que los delata:
 * los tres porcentajes idénticos al puntaje.
 */
function hasSoftMetrics(a: SimAttempt, kinds: Map<string, 'call' | 'choice'>): boolean {
  const kind = kinds.get(a.scenario_slug)
  if (kind === 'choice') return false
  if (kind === 'call') return true
  return !(a.checklist_pct === a.score && a.empathy_pct === a.score)
}

/** Agrega los intentos de un aprendiz (ya filtrados por escenario si aplica). */
function aggregate(base: LearnerBase, attempts: SimAttempt[], kinds: Map<string, 'call' | 'choice'>): LearnerRow {
  const list = [...attempts].sort((a, b) => (toUtcMs(b.created_at) ?? 0) - (toUtcMs(a.created_at) ?? 0))
  // Mejor puntaje por escenario → promedio justo (no infla con reintentos).
  const bestByScenario = new Map<string, number>()
  for (const a of list) {
    const prev = bestByScenario.get(a.scenario_slug)
    if (prev === undefined || a.score > prev) bestByScenario.set(a.scenario_slug, a.score)
  }
  const bests = [...bestByScenario.values()]
  const soft = list.filter((a) => hasSoftMetrics(a, kinds))
  const count = list.length
  const bestScore = bests.length ? Math.max(...bests) : 0
  return {
    ...base,
    attempts: list,
    attemptsCount: count,
    scenariosCount: bestByScenario.size,
    avgScore: Math.round(avg(bests)),
    bestScore,
    // Solo los intentos que de verdad las miden (ver hasSoftMetrics). Si no hay
    // ninguno, `null`: la columna dice "—" en vez de un promedio fabricado.
    avgEmpathy: soft.length ? Math.round(avg(soft.map((a) => a.empathy_pct))) : null,
    avgChecklist: soft.length ? Math.round(avg(soft.map((a) => a.checklist_pct))) : null,
    softCount: soft.length,
    resolvedRate: count ? Math.round((list.filter((a) => a.resolved).length / count) * 100) : 0,
    // Puntaje alto y resolución deben pertenecer al MISMO intento. Un 100%
    // abortado y un 20% resuelto no equivalen a una ejecución dominada.
    status: computeStatus(count, bestScore, list.some((a) => a.resolved && a.score >= PASS_SCORE)),
    lastAt: list.length ? (toUtcMs(list[0].created_at) ?? 0) : 0,
  }
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Fecha y hora exactas del intento: lo que zanja un "no recuerdo haberlo hecho". */
function fmtDateTime(ms: number, locale: string): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(locale, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Fecha corta para la columna: "10 sep" y, si es de otro año, con año. */
function fmtDateShort(ms: number, locale: string): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** Distancia en días, para el renglón de apoyo ("hoy", "ayer", "hace 5 d"). */
function daysAgo(ms: number): number {
  const start = (x: number) => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime() }
  return Math.round((start(Date.now()) - start(ms)) / 86400000)
}

export default function SimulationFeedbackPanel() {
  const { t, i18n } = useTranslation()
  const { isSuperAdmin, isCapacitador, user, loading: authLoading } = useAuth()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [learners, setLearners] = useState<LearnerBase[]>([])
  const [allAttempts, setAllAttempts] = useState<SimAttempt[]>([])
  /** slug → título legible del escenario (llamada u opción). */
  const [scenarioTitles, setScenarioTitles] = useState<Map<string, string>>(new Map())
  /** slug → de qué simulador viene. Decide si empatía y checklist son reales. */
  const [scenarioKinds, setScenarioKinds] = useState<Map<string, 'call' | 'choice'>>(new Map())
  /* CR y área: los mismos cortes que el Panorama y que Mundos. Tres pantallas,
     un idioma. Se comparan por id, no por nombre. */
  const [filterOperation, setFilterOperation] = useState('all')
  const [filterArea, setFilterArea] = useState('all')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [filterScenario, setFilterScenario] = useState('all')
  /* El CURSO es obligatorio: sin él no se muestra nada. Mismo criterio que
     Módulos y Mundos, para que las tres vistas se usen igual. */
  const [filterCourse, setFilterCourse] = useState('all')
  const courseChosen = filterCourse !== 'all'
  /** A quién le llega el curso elegido: asignación individual + regla. */
  const [reach, setReach] = useState<{ courseId: string; assigned: Set<string>; rule: AudienceRule | null; published: boolean } | null>(null)
  /** curso → título, para el filtro (solo los cursos que tienen intentos). */
  const [courseTitles, setCourseTitles] = useState<Map<string, string>>(new Map())
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<LearnerStatus | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'intentos', dir: 'desc' })
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const statusLabel = useCallback(
    (s: LearnerStatus) => t(STATUS_META[s].labelKey, STATUS_META[s].fallback),
    [t],
  )

  /* El catálogo de CR y áreas. Noventa y cinco filas de dos columnas: se pide
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
    // Guarda de cancelación: si el panel se desmonta (cambio rápido de vista) o
    // el efecto se vuelve a disparar, no tocamos estado de una carga vieja.
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(false)
      try {
      // La RLS resuelve el alcance actual por curso; las campañas antiguas
      // no son un requisito para consultar contenido ni intentos autorizados.
      const myPeople = !isSuperAdmin ? await getMyPeopleIds() : null

      const [profileRes, attemptRes, callRes, choiceRes] = await Promise.all([
        readAllPages((from, to) => {
          // `*` a propósito: ver src/lib/activeUsers.ts (las cuentas dadas de
          // baja se filtran en memoria para no depender de la columna).
          let q = supabase.from('profiles').select('*').eq('role', 'learner')
          if (myPeople !== null) q = q.in('id', myPeople.length ? myPeople : ['00000000-0000-0000-0000-000000000000'])
          return q.order('id').range(from, to)
        }),
        readAllPages((from, to) => {
          const q = supabase
            .from('simulator_attempts')
            .select('id,user_id,course_id,campaign_id,scenario_slug,score,checklist_pct,empathy_pct,resolved,duration_sec,ai_feedback,created_at')
          return q.order('id').range(from, to)
        }),
        readAllPages((from, to) => {
          const q = supabase.from('scenarios').select('slug,title_es,title_en,title_pt,campaign_id,course_id').is('deleted_at', null)
          return q.order('slug').range(from, to)
        }),
        readAllPages((from, to) => {
          const q = supabase.from('choice_scenarios').select('slug,title_es,campaign_id,course_id').is('deleted_at', null)
          return q.order('slug').range(from, to)
        }),
      ])

      if (attemptRes.error) console.error('simulator_attempts query error:', attemptRes.error)

      // El capacitador ve a su gente vigente; las bajas quedan para el superadmin.
      const profiles = hideInactiveUnlessSuperAdmin((profileRes.data ?? []) as Profile[], isSuperAdmin)
      const attempts = (attemptRes.data ?? []) as SimAttempt[]

      // Mapa slug → título en el idioma actual (llamada tiene 3 idiomas; opción, es).
      const lang = i18n.resolvedLanguage ?? 'es'
      const titles = new Map<string, string>()
      const kinds = new Map<string, 'call' | 'choice'>()
      for (const s of (callRes.data ?? []) as Array<{ slug: string; title_es: string; title_en: string | null; title_pt: string | null }>) {
        titles.set(s.slug, pickLang(s.title_es, s.title_en, s.title_pt, lang) || s.slug)
        kinds.set(s.slug, 'call')
      }
      for (const s of (choiceRes.data ?? []) as Array<{ slug: string; title_es: string }>) {
        if (!titles.has(s.slug)) titles.set(s.slug, s.title_es || s.slug)
        if (!kinds.has(s.slug)) kinds.set(s.slug, 'choice')
      }
      // Títulos de los cursos que los intentos mencionan: es lo único que hace
      // falta para el filtro por curso, y así no se trae el catálogo entero.
      // Cursos: los que tienen simuladores y los que mencionan los intentos. Con
      // el curso obligatorio, un curso con simulador y sin intentos todavía
      // tiene que poder elegirse (es justo donde hay gente por empezar).
      const scenarioCourseIds = [
        ...((callRes.data ?? []) as Array<{ course_id: string | null }>),
        ...((choiceRes.data ?? []) as Array<{ course_id: string | null }>),
      ].map((r) => r.course_id)
      const courseIds = [...new Set([...attempts.map((a) => a.course_id), ...scenarioCourseIds].filter(Boolean))] as string[]
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

      /* ── Quien practicó pero no está en la lista de gente ─────────────
         `profiles` se pide acotado a "mi gente" (get_my_people_ids) y a rol
         learner. Un intento cuyo autor no salga de ahí —otra audiencia, cuenta
         dada de baja, rol distinto, o un perfil que la RLS no deja leer— se
         perdía ENTERO: no había fila que lo sostuviera, y el panel acababa
         diciendo "todavía no hay simulaciones registradas" mientras el filtro
         de curso se construía con esos mismos intentos. Se rescatan aquí: se
         piden sus perfiles por id y, si tampoco llegan, la fila se crea igual
         con lo que el intento ya sabe. Un intento guardado nunca desaparece de
         la vista sin decirlo. */
      const known = new Set(profiles.map((p) => p.id))
      const missingIds = [...new Set(attempts.map((a) => a.user_id))].filter((id) => !known.has(id))
      const rescued: Profile[] = []
      if (missingIds.length > 0) {
        const { data: extra } = await supabase
          .from('profiles')
          .select('id,display_name,campaign_id,is_active,role,country,operation_id,area_id,is_client')
          .in('id', missingIds)
        rescued.push(...((extra ?? []) as Profile[]))
      }
      const rescuedById = new Map(rescued.map((p) => [p.id, p]))

      if (cancelled) return
      setCourseTitles(courseMap)
      setScenarioTitles(titles)
      setScenarioKinds(kinds)
      const nameOf = (p: Profile) => p.display_name ?? t('admin.sim_panel.no_name', 'Sin nombre')
      setLearners([
        ...profiles.map((p) => ({
          userId: p.id,
          displayName: nameOf(p),
          country: p.country ?? null,
          operationId: p.operation_id ?? null,
          areaId: p.area_id ?? null,
          isClient: p.is_client ?? null,
        })),
        ...missingIds.map((id) => {
          const p = rescuedById.get(id)
          return {
            userId: id,
            displayName: p
              ? nameOf(p)
              : t('admin.sim_panel.outsider_name', 'Persona fuera de tu alcance'),
            country: p?.country ?? null,
            operationId: p?.operation_id ?? null,
            areaId: p?.area_id ?? null,
            outsider: true,
            staff: !!p?.role && p.role !== 'learner',
          }
        }),
      ])
      setAllAttempts(attempts)
      } catch (e) {
        if (!cancelled) { setLoadError(true); console.error('SimulationFeedbackPanel load error:', e) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isSuperAdmin, user?.id, i18n.resolvedLanguage])

  /* A quién le llega el curso elegido. El programa ya no entrega cursos: cuenta
     quien lo tiene asignado y quien cumple su regla país/área/CR. Quien ya
     practicó entra siempre, le toque hoy o no. */
  useEffect(() => {
    if (!courseChosen || filterCourse === NO_COURSE) return
    let vivo = true
    void Promise.all([
      readAllPages((from, to) => supabase.from('course_assignments').select('user_id').eq('course_id', filterCourse).order('user_id').range(from, to)),
      getAudience(filterCourse),
      supabase.from('courses').select('is_published').eq('id', filterCourse).maybeSingle(),
    ]).then(([asg, rule, course]) => {
      if (!vivo) return
      if (asg.error || course.error) throw asg.error || course.error
      setReach({
        courseId: filterCourse,
        assigned: new Set(((asg.data ?? []) as Array<{ user_id: string }>).map((a) => a.user_id)),
        rule,
        published: (course.data as { is_published?: boolean } | null)?.is_published === true,
      })
    }).catch(e => { if (vivo) { setLoadError(true); console.error('SimulationFeedbackPanel reach error:', e) } })
    return () => { vivo = false }
  }, [courseChosen, filterCourse])

  /** "Sin curso asociado" no tiene a quién llegarle: solo cuenta quien practicó. */
  const reachReady = courseChosen && (filterCourse === NO_COURSE || reach?.courseId === filterCourse)

  const campaignAttempts = allAttempts
  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units])

  /** Cursos con simulador o con intentos (más "sin curso", si los hay). */
  const courseOptions = useMemo(() => {
    const ids = new Set<string>(courseTitles.keys());
    let loose = false
    for (const a of campaignAttempts) {
      if (a.course_id) ids.add(a.course_id); else loose = true
    }
    const list = [...ids]
      .map((id) => ({ value: id, label: courseTitles.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label))
    // Los intentos sueltos (practicados fuera de un curso) tienen que poder
    // mirarse: si no, son horas de práctica que ningún filtro alcanza.
    if (loose && list.length > 0) {
      list.push({ value: NO_COURSE, label: t('admin.sim_panel.no_course', 'Sin curso asociado') })
    }
    return list
  }, [campaignAttempts, courseTitles, t])

  /** Curso elegido, validado: uno que ya no está en la lista no puede quedar puesto. */
  const activeCourse = useMemo(
    () => (filterCourse !== 'all' && !courseOptions.some((c) => c.value === filterCourse) ? 'all' : filterCourse),
    [filterCourse, courseOptions],
  )

  const courseAttempts = useMemo(
    () => (activeCourse === 'all'
      ? []
      : campaignAttempts.filter((a) => (activeCourse === NO_COURSE ? !a.course_id : a.course_id === activeCourse))),
    [campaignAttempts, activeCourse],
  )

  // Opciones del filtro de escenario: los escenarios con intentos dentro de la
  // curso elegido, ordenados por título.
  const scenarioOptions = useMemo(() => {
    const slugs = new Set(courseAttempts.map((a) => a.scenario_slug))
    return [...slugs]
      .map((slug) => ({ value: slug, label: scenarioTitles.get(slug) ?? slug }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [courseAttempts, scenarioTitles])

  /** Los intentos que quedan tras los tres filtros. */
  const scopedAttempts = useMemo(
    () => (filterScenario === 'all'
      ? courseAttempts
      : courseAttempts.filter((a) => a.scenario_slug === filterScenario)),
    [courseAttempts, filterScenario],
  )

  // Intentos por aprendiz: todo se recomputa solo con los intentos del alcance.
  const rows = useMemo<LearnerRow[]>(() => {
    const byUser = new Map<string, SimAttempt[]>()
    for (const a of scopedAttempts) {
      const arr = byUser.get(a.user_id) ?? []
      arr.push(a)
      byUser.set(a.user_id, arr)
    }
    return learners.map((base) => aggregate(base, byUser.get(base.userId) ?? [], scenarioKinds))
  }, [learners, scopedAttempts, scenarioKinds])

  /**
   * Quién se ve.
   *
   * La gente a la que le llega el curso elegido (asignada o por regla país/área/
   * CR) MÁS quien haya practicado sus simuladores, le toque hoy o no.
   *
   * Antes, al afinar por curso o escenario, la lista se recortaba a quien ya
   * había practicado: justo la gente que falta —la que no ha entrado nunca al
   * simulador— desaparecía de la vista, y el panel parecía decir que todo el
   * mundo iba bien. Se quedan, con estado "Sin intentos": el chip de estado y
   * los KPIs siguen ahí para mirar solo a quien practicó cuando eso es lo que
   * se busca.
   */
  const scoped = useMemo(() => {
    const practiced = new Set(scopedAttempts.map((a) => a.user_id))
    return rows.filter((r) => {
      /* CR y área se comprueban SIEMPRE, también sobre quien ya practicó: si no,
         filtrar por un CR seguiría mostrando a gente de otro solo por tener
         intentos, y el número de arriba no cuadraría con la tabla. */
      if (filterOperation !== 'all' && r.operationId !== filterOperation) return false
      if (filterArea !== 'all' && r.areaId !== filterArea) return false
      if (practiced.has(r.userId)) return true
      // El rescatado solo existe por sus intentos: fuera de ellos no es "gente
      // pendiente de practicar" y no debe engordar el total ni la participación.
      if (r.outsider) return false
      // Quien no practicó entra solo si el curso le llega: asignado o por regla.
      if (!reach || reach.courseId !== activeCourse) return false
      if (reach.assigned.has(r.userId)) return true
      return !!reach.rule && reach.published && matchesAudience(reach.rule, {
        country: r.country, operation_id: r.operationId, area_id: r.areaId, is_client: r.isClient,
      })
    })
  }, [rows, scopedAttempts, reach, activeCourse, filterOperation, filterArea])

  const stats = useMemo(() => {
    const learners = scoped.length
    const withAttempts = scoped.filter((r) => r.attemptsCount > 0)
    const totalAttempts = scoped.reduce((s, r) => s + r.attemptsCount, 0)
    const statusCounts: Record<LearnerStatus, number> = { not_started: 0, in_progress: 0, at_risk: 0, completed: 0 }
    for (const r of scoped) statusCounts[r.status]++
    // Mismas tasas normalizadas que en las otras vistas de Progreso, para que
    // "participación" signifique lo mismo en las tres.
    const practiced = withAttempts.length
    return {
      learners,
      totalAttempts,
      desempeno: Math.round(avg(withAttempts.map((r) => r.avgScore))),
      resolucion: totalAttempts > 0
        ? Math.round(scoped.reduce((sum, r) => sum + r.attempts.filter(a => a.resolved).length, 0) / totalAttempts * 100)
        : 0,
      // Promedio solo sobre quien las tiene medidas; si nadie, no hay KPI que dar.
      empatia: (() => {
        const vals = withAttempts.map((r) => r.avgEmpathy).filter((v): v is number => v !== null)
        return vals.length ? Math.round(avg(vals)) : null
      })(),
      statusCounts,
      practiced,
      participation: learners > 0 ? Math.round((practiced / learners) * 100) : 0,
      attemptsPerLearner: practiced > 0 ? Math.round((totalAttempts / practiced) * 10) / 10 : 0,
    }
  }, [scoped])

  const tableRows = useMemo(() => {
    const q = fold(search)
    let list = scoped.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (q && !fold(r.displayName).includes(q)) return false
      return true
    })
    const m = sort.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case 'name': return a.displayName.localeCompare(b.displayName) * m
        case 'estado': return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * m
        case 'intentos': return (a.attemptsCount - b.attemptsCount) * m
        case 'desempeno': return (a.avgScore - b.avgScore) * m
        case 'empatia': {
          // Sin empatía medida no compite: se va al fondo en los dos sentidos.
          if (a.avgEmpathy === null || b.avgEmpathy === null) {
            return (a.avgEmpathy === null ? 1 : 0) - (b.avgEmpathy === null ? 1 : 0)
          }
          return (a.avgEmpathy - b.avgEmpathy) * m
        }
        case 'ultima': return (a.lastAt - b.lastAt) * m
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
        'Empatía prom. (%)': r.avgEmpathy ?? '',
        'Checklist prom. (%)': r.avgChecklist ?? '',
        'Tasa de resolución (%)': r.resolvedRate,
        'Última práctica': r.lastAt ? fmtDateTime(r.lastAt, i18n.language) : '—',
      }))
      const sheet2 = tableRows.flatMap((r) =>
        r.attempts.map((a) => ({
          Aprendiz: r.displayName,
          Escenario: scenarioTitle(a.scenario_slug),
          'Puntaje (%)': a.score,
          'Empatía (%)': hasSoftMetrics(a, scenarioKinds) ? a.empathy_pct : '',
          'Checklist (%)': hasSoftMetrics(a, scenarioKinds) ? a.checklist_pct : '',
          Resuelto: a.resolved ? 'Sí' : 'No',
          'Duración (s)': a.duration_sec,
          Fecha: fmtDateTime(toUtcMs(a.created_at) ?? 0, i18n.language),
        })),
      )
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet1), 'Resumen por aprendiz')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2), 'Detalle de intentos')
      const courseName = courseTitles.get(activeCourse) ?? 'General'
      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `simulaciones_${courseName.replace(/[^\p{L}\p{N}]+/gu, '_')}_${date}.xlsx`)
    } finally {
      setExporting(false)
    }
  }, [tableRows, courseTitles, activeCourse, exporting, statusLabel, scenarioTitle, scenarioKinds, i18n.language])

  const setSortKey = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  if (loadError) return <p role="alert" className="p-6 text-text-muted">{t('admin.progress_overview.stats_unavailable')}</p>
  const statusChips: Array<LearnerStatus | 'all'> = ['all', ...STATUS_ORDER]

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

      {/* Filtros. El CURSO va primero y es obligatorio —resaltado mientras no
          se elige—, igual que en Módulos y Mundos. CR, área y escenario
          recortan dentro del curso. */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className={cn('rounded-xl', !courseChosen && 'ring-2 ring-[rgb(var(--brand-green))] ring-offset-2 ring-offset-bg')}>
          <FilterDropdown
            value={courseChosen ? filterCourse : ''}
            onChange={(v) => { setFilterCourse(v || 'all'); setFilterScenario('all') }}
            options={[{ value: '', label: t('admin.progress_overview.pick_course', 'Elige un curso (obligatorio)') }, ...courseOptions]}
            className="max-w-xs"
          />
        </div>
        <FilterDropdown
          value={filterOperation === 'all' ? '' : filterOperation}
          onChange={(v) => setFilterOperation(v || 'all')}
          options={[
            { value: '', label: t('admin.progress_overview.all_operations', 'Todos los CR') },
            ...units.filter((u) => u.kind === 'operation').map((u) => ({ value: u.id, label: u.name })),
          ]}
          className="max-w-xs"
        />
        <FilterDropdown
          value={filterArea === 'all' ? '' : filterArea}
          onChange={(v) => setFilterArea(v || 'all')}
          options={[
            { value: '', label: t('admin.progress_overview.all_areas', 'Todas las áreas') },
            ...units.filter((u) => u.kind === 'area').map((u) => ({ value: u.id, label: u.name })),
          ]}
          className="max-w-xs"
        />
        {courseChosen && scenarioOptions.length > 1 && (
          <FilterDropdown
            value={filterScenario === 'all' ? '' : filterScenario}
            onChange={(v) => setFilterScenario(v || 'all')}
            options={[{ value: '', label: t('admin.sim_panel.all_scenarios', 'Todos los escenarios') }, ...scenarioOptions]}
            className="max-w-xs"
          />
        )}
      </div>

      {!loading && !courseChosen ? (
        <PickCourseFirst
          accent={SIM_ACCENT}
          title={t('admin.progress_overview.pick_course_title', 'Primero elige un curso')}
          body={t('admin.sim_panel.pick_course_body', 'Todo lo de abajo habla de UN curso: quién practicó sus simuladores, con qué nota y quién todavía no entra. Después puedes recortar por CR, área o escenario.')}
        />
      ) : loading || !reachReady ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : scoped.length === 0 ? (
        /* Estado vacío honesto. "Todavía no hay simulaciones registradas" es
           verdad solo cuando NO hay un intento en toda la vista; con un filtro
           puesto, lo que pasa es que ese filtro no deja nada, y decir lo primero
           mandaba a buscar un fallo de guardado que no existe. */
        <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
          <div className="text-[2rem] mb-3">🎧</div>
          {allAttempts.length === 0 ? (
            <>
              <div className="text-[15px] font-medium text-text mb-2">{t('admin.sim_panel.no_data', 'Todavía no hay simulaciones registradas')}</div>
              <div className="text-[13px] text-text-muted">{t('admin.sim_panel.no_data_desc', 'Cuando tus aprendices practiquen en los simuladores, sus resultados aparecerán aquí.')}</div>
            </>
          ) : (
            <>
              <div className="text-[15px] font-medium text-text mb-2">
                {t('admin.sim_panel.filtered_out', 'Ningún aprendiz con estos filtros')}
              </div>
              <div className="text-[13px] text-text-muted">
                {t('admin.sim_panel.filtered_out_desc', { count: allAttempts.length, defaultValue: 'Hay {{count}} intentos registrados fuera de este alcance. Prueba con otro curso, CR o área, o quita los filtros.' })}
              </div>
              {(filterOperation !== 'all' || filterArea !== 'all' || filterScenario !== 'all') && (
                <button
                  type="button"
                  onClick={() => { setFilterOperation('all'); setFilterArea('all'); setFilterScenario('all') }}
                  className="mt-4 inline-flex items-center justify-center rounded-xl border border-line px-4 py-2 text-[12.5px] font-semibold text-text-muted transition-colors hover:text-text"
                >
                  {t('admin.sim_panel.clear_filters', 'Quitar los filtros')}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* Ojo con lo que se puede afirmar aquí: esto es desempeño en un
              entorno SIMULADO, no en el puesto real. Anticipa cómo va a
              atender, no demuestra cómo atiende. El orden va de cuánta gente
              practica a con qué calidad lo hace.
              En tira y no en tarjetas, por lo mismo que en las otras dos
              vistas: la tabla tiene que caber en la primera pantalla. */}
          <StatStrip
            moreLabel={t('admin.progress_overview.more_stats', 'Más cifras')}
            lessLabel={t('admin.progress_overview.less_stats', 'Menos cifras')}
            items={[
              {
                key: 'learners',
                label: t('admin.sim_panel.kpi_learners', 'Aprendices alcanzados'),
                value: String(stats.learners),
                accent: SIM_ACCENT,
                hint: stats.statusCounts.not_started > 0
                  ? t('admin.sim_panel.kpi_learners_idle', { count: stats.statusCounts.not_started, defaultValue: '{{count}} sin empezar' })
                  : t('admin.sim_panel.kpi_learners_hint', 'Personas con simuladores disponibles en este alcance.'),
              },
              {
                key: 'participation',
                label: t('admin.sim_panel.kpi_participation', 'Participación'),
                value: `${stats.participation}%`,
                accent: '#3b82f6',
                onClick: () => setStatusFilter(statusFilter === 'not_started' ? 'all' : 'not_started'),
                active: statusFilter === 'not_started',
                hint: `${stats.practiced}/${stats.learners} · ${t('admin.sim_panel.kpi_participation_hint', 'Quiénes han practicado al menos una vez.')}`,
              },
              {
                key: 'score',
                label: t('admin.sim_panel.kpi_score', 'Desempeño'),
                value: `${stats.desempeno}%`,
                accent: SIM_ACCENT,
                hint: t('admin.sim_panel.kpi_score_short', 'Puntaje promedio de quienes practicaron. Es desempeño en simulación.'),
              },
              {
                key: 'risk',
                label: t('admin.sim_panel.kpi_at_risk', 'En riesgo'),
                value: String(stats.statusCounts.at_risk),
                accent: '#ef4444',
                onClick: () => setStatusFilter(statusFilter === 'at_risk' ? 'all' : 'at_risk'),
                active: statusFilter === 'at_risk',
                hint: t('admin.sim_panel.kpi_at_risk_hint', 'Practicaron, pero su mejor puntaje no llega al 60%.'),
              },
            ]}
            secondary={[
              {
                key: 'attempts',
                label: t('admin.sim_panel.kpi_attempts', 'Intentos de práctica'),
                value: String(stats.totalAttempts),
                accent: SIM_ACCENT,
                hint: t('admin.sim_panel.kpi_attempts_sub', { n: stats.attemptsPerLearner, defaultValue: '{{n}} por persona' }),
              },
              {
                key: 'resolved',
                label: t('admin.sim_panel.kpi_resolved', 'Tasa de resolución'),
                value: `${stats.resolucion}%`,
                accent: '#22c55e',
                hint: t('admin.sim_panel.kpi_resolved_hint', 'Llamadas SIMULADAS que terminaron resueltas. Anticipa el resultado de negocio, pero no lo sustituye: el FCR real vive en los sistemas del contact center.'),
              },
            ]}
          />

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
                      style={{ gridTemplateColumns: '1.4fr 1fr auto auto 1fr auto auto auto' }}
                    >
                      <SortTh label={t('admin.sim_panel.col_learner', 'Aprendiz')} col="name" sort={sort} onSort={setSortKey} />
                      <span>{t('admin.progress_overview.col_cr', 'CR')}</span>
                      <SortTh label={t('admin.sim_panel.col_status', 'Estado')} col="estado" sort={sort} onSort={setSortKey} />
                      <SortTh
                        label={t('admin.sim_panel.col_attempts', 'Intentos')}
                        col="intentos"
                        sort={sort}
                        onSort={setSortKey}
                        hint={t('admin.sim_panel.col_attempts_hint', 'Cuántas veces practicó y sobre cuántos escenarios distintos. Dos intentos en un solo escenario no cubren el simulador entero.')}
                      />
                      <SortTh
                        label={t('admin.sim_panel.col_score', 'Desempeño')}
                        col="desempeno"
                        sort={sort}
                        onSort={setSortKey}
                        hint={t('admin.sim_panel.col_score_hint', 'Promedio de su MEJOR puntaje en cada escenario que practicó. Es el porcentaje de aciertos sobre las opciones que alcanzó a contestar, no cuánto del escenario recorrió: mira la columna "Intentos · N esc." para saber el alcance real.')}
                      />
                      <SortTh label={t('admin.sim_panel.col_empathy', 'Empatía')} col="empatia" sort={sort} onSort={setSortKey} />
                      <SortTh label={t('admin.sim_panel.col_last', 'Última práctica')} col="ultima" sort={sort} onSort={setSortKey} />
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
                              style={{ gridTemplateColumns: '1.4fr 1fr auto auto 1fr auto auto auto' }}
                              onClick={() => setExpandedUser((p) => (p === row.userId ? null : row.userId))}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-subtle text-[13px] font-medium text-text">
                                  {row.displayName.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[13px] text-text truncate">{row.displayName}</div>
                                  {/* Practicó tu contenido pero no está en tu lista de
                                      gente: se dice, en vez de esconderlo. */}
                                  {row.outsider && (
                                    <div className="text-[11px] text-text-subtle truncate">
                                      {row.staff
                                        ? t('admin.sim_panel.staff_hint', 'Del equipo, no es un aprendiz')
                                        : t('admin.sim_panel.outsider_hint', 'Practicó este curso, pero hoy no le llega')}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className={cn('text-[12px] truncate', row.operationId ? 'text-text-muted' : 'text-amber-600 dark:text-amber-400')}>
                                {(row.operationId && unitName.get(row.operationId)) || t('admin.progress_overview.no_cr', 'Sin CR asignado')}
                              </div>
                              <StatusBadge status={row.status} label={statusLabel(row.status)} />
                              <div className="text-[13px] text-text tabular-nums"><span className="font-medium">{row.attemptsCount}</span><span className="text-text-muted"> · {row.scenariosCount} esc.</span></div>
                              <ScoreBar value={row.avgScore} />
                              <EmpathyCell value={row.avgEmpathy} />
                              <LastPractice at={row.lastAt} locale={i18n.language} />
                              <div className="text-text-muted">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</div>
                            </div>
                            {isOpen && (
                              <div className="px-5 py-4 bg-subtle/40 border-t border-line">
                                <AttemptList attempts={row.attempts} scenarioTitle={scenarioTitle} kinds={scenarioKinds} />
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
                              <div className="text-[11px] text-text-muted truncate">
                                {(row.operationId && unitName.get(row.operationId)) || t('admin.progress_overview.no_cr', 'Sin CR asignado')}
                              </div>
                              {row.outsider && (
                                <div className="text-[11px] text-text-subtle truncate">
                                  {row.staff
                                    ? t('admin.sim_panel.staff_hint', 'Del equipo, no es un aprendiz')
                                    : t('admin.sim_panel.outsider_hint', 'Practicó este curso, pero hoy no le llega')}
                                </div>
                              )}
                            </div>
                          </div>
                          {isOpen ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <StatusBadge status={row.status} label={statusLabel(row.status)} />
                          <span className="text-[12px] text-text tabular-nums">{row.attemptsCount} {t('admin.sim_panel.attempts_short', 'intentos')}</span>
                          {row.avgEmpathy !== null && (
                            <span className="inline-flex items-center gap-1 text-[12px] text-text tabular-nums"><HeartHandshake className="h-3.5 w-3.5 text-pink-500" />{row.avgEmpathy}%</span>
                          )}
                          {row.lastAt > 0 && (
                            <span className="text-[12px] text-text-muted tabular-nums">{fmtDateTime(row.lastAt, i18n.language)}</span>
                          )}
                        </div>
                        <ScoreBar value={row.avgScore} />
                      </button>
                      {isOpen && (
                        <div className="px-4 py-3 bg-subtle/40 border-t border-line">
                          <AttemptList attempts={row.attempts} scenarioTitle={scenarioTitle} kinds={scenarioKinds} />
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
  const { t } = useTranslation()
  const meta = STATUS_META[status]
  return (
    <Tooltip label={t(meta.hintKey, meta.hintFallback)} anchor="element" maxWidth={280}>
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium w-fit" style={{ background: `${meta.color}1a`, color: meta.color }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
        {label}
      </span>
    </Tooltip>
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

function SortTh({ label, col, sort, onSort, hint }: { label: string; col: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; hint?: string }) {
  const active = sort.key === col
  const btn = (
    <button onClick={() => onSort(col)} className={`flex items-center gap-1 text-left uppercase tracking-wider ${active ? 'text-text' : 'hover:text-text'} transition-colors`}>
      {label}
      <ChevronDown className={`h-3 w-3 transition-transform ${active ? 'opacity-100' : 'opacity-0'} ${active && sort.dir === 'asc' ? 'rotate-180' : ''}`} />
    </button>
  )
  // El globo explica QUÉ mide la columna: sin eso, "Desempeño 100%" se lee como
  // "hizo la simulación entera y perfecta", que no es lo que dice el número.
  return hint ? <Tooltip label={hint} anchor="element" maxWidth={300}>{btn}</Tooltip> : btn
}

/**
 * Empatía promedio, o el hueco honesto.
 *
 * El simulador de opción múltiple no mide empatía: antes se veía "56%" que en
 * realidad era el promedio de los puntajes. Sin dato real va una raya, y el
 * globo explica por qué — mejor un hueco que una cifra inventada.
 */
function EmpathyCell({ value }: { value: number | null }) {
  const { t } = useTranslation()
  if (value === null) {
    return (
      <Tooltip
        label={t('admin.sim_panel.empathy_na', 'El simulador de opción múltiple no mide empatía.')}
        anchor="element"
        maxWidth={220}
      >
        <div className="text-[12px] text-text-muted tabular-nums">—</div>
      </Tooltip>
    )
  }
  return (
    <div className="flex items-center gap-1 text-[12px] text-text tabular-nums">
      <HeartHandshake className="h-3.5 w-3.5 text-pink-500 shrink-0" />{value}%
    </div>
  )
}

/**
 * Cuándo practicó por última vez.
 *
 * Por qué existe: la tabla decía "100% de desempeño" sin decir CUÁNDO, y quien
 * lo leía no podía reconciliarlo con su memoria ("no recuerdo haber practicado
 * la simulación"). Un puntaje sin fecha no se puede verificar. Arriba va la
 * fecha corta, debajo la distancia en días, y el globo trae la hora exacta.
 */
function LastPractice({ at, locale }: { at: number; locale: string }) {
  const { t } = useTranslation()
  if (!at) return <div className="text-[12px] text-text-muted tabular-nums">—</div>
  const d = daysAgo(at)
  const rel =
    d <= 0 ? t('admin.sim_panel.last_today', 'hoy')
    : d === 1 ? t('admin.sim_panel.last_yesterday', 'ayer')
    : d < 30 ? t('admin.sim_panel.last_days', { count: d, defaultValue: 'hace {{count}} d' })
    : t('admin.sim_panel.last_months', { count: Math.round(d / 30), defaultValue: 'hace {{count}} m' })
  return (
    <Tooltip label={fmtDateTime(at, locale)} anchor="element">
      <div className="text-right leading-tight">
        <div className="text-[12px] text-text tabular-nums whitespace-nowrap">{fmtDateShort(at, locale)}</div>
        <div className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">{rel}</div>
      </div>
    </Tooltip>
  )
}

/* ── Detalle: lista de intentos del aprendiz ── */
function AttemptList({ attempts, scenarioTitle, kinds }: { attempts: SimAttempt[]; scenarioTitle: (slug: string) => string; kinds: Map<string, 'call' | 'choice'> }) {
  const { t, i18n } = useTranslation()
  if (attempts.length === 0) return <div className="py-3 text-[13px] text-text-muted">{t('admin.sim_panel.no_attempts', 'Sin intentos todavía.')}</div>
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{t('admin.sim_panel.attempts_history', 'Historial de intentos')}</div>
      {attempts.map((a) => (
        <div key={a.id} className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-medium text-text truncate flex-1 min-w-[120px]">{scenarioTitle(a.scenario_slug)}</span>
            <span className="inline-flex items-center gap-1 text-[12px] tabular-nums font-semibold" style={{ color: scoreColor(a.score) }}>{a.score}%</span>
            {/* Solo si el simulador las mide: en el de opción múltiple estas dos
                columnas son copias del puntaje, y repetir 100% tres veces hacía
                pasar por medición lo que era el mismo número. */}
            {hasSoftMetrics(a, kinds) && (
              <>
                <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums" title={t('admin.sim_panel.empathy', 'Empatía')}><HeartHandshake className="h-3.5 w-3.5 text-pink-500" />{a.empathy_pct}%</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums" title={t('admin.sim_panel.checklist', 'Checklist')}><ListChecks className="h-3.5 w-3.5 text-blue-500" />{a.checklist_pct}%</span>
              </>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums" title={t('admin.sim_panel.duration', 'Duración')}><Clock className="h-3.5 w-3.5" />{fmtDuration(a.duration_sec)}</span>
            {a.resolved
              ? (
                <Tooltip label={t('admin.sim_panel.resolved_hint', 'Llegó al final de la llamada por sus propios medios y con al menos la mitad de los puntos.')} anchor="element" maxWidth={280}>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" />{t('admin.sim_panel.resolved', 'Resuelto')}</span>
                </Tooltip>
              )
              : (
                <Tooltip label={t('admin.sim_panel.unresolved_hint', 'La llamada no llegó a su cierre: colgó, se cortó sola o terminó en un desenlace malo. Es independiente del puntaje — se puede acertar lo poco que alcanzó a contestar y aun así no resolver.')} anchor="element" maxWidth={300}>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-red-500 dark:text-red-400"><XCircle className="h-3.5 w-3.5" />{t('admin.sim_panel.unresolved', 'No resuelto')}</span>
                </Tooltip>
              )}
            <span className="text-[11px] text-text-muted/70 tabular-nums w-full sm:w-auto sm:ml-auto">{fmtDateTime(toUtcMs(a.created_at) ?? 0, i18n.language)}</span>
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
