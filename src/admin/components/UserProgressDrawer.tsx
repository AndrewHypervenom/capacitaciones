import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  X, Loader2, Award, BookOpen, ChevronDown, Globe, PhoneCall,
  CheckCircle2, Circle, Flame, Sparkles, Search, IdCard, BarChart3,
  ListChecks, GraduationCap, ArrowUpRight, AlertTriangle,
} from 'lucide-react'

import { Avatar } from '@/components/ui/Avatar'
import { EntityIcon } from '@/components/ui/EntityIcon'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'
import { Tooltip } from '@/components/ui/Tooltip'
import { fold } from '@/lib/normalize'
import { getUserCoursesAdmin, courseState, isCourseFinished, type AdminUserCourse } from '@/services/courses.service'
import { getUserCourseDetailAdmin, type AdminCourseDetail } from '@/services/notifications.service'
import { getUserGamification, type GamificationSummary } from '@/services/progress.service'
import type { Profile } from '@/types/database'
import { rowText } from '@/lib/contentLang'

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = '#10D451'
const MAGENTA = '#B33D9E'

interface UserProgressDrawerProps {
  user: Profile & { email?: string }
  /** Nombre de la campaña casa, para el encabezado (opcional). */
  campaignName?: string | null
  onClose: () => void
}

type DetailState = AdminCourseDetail | 'loading' | 'error'

/**
 * Progreso de una persona SIN salir de la lista de usuarios: un panel que entra
 * por el costado con su avance real —cursos, módulos y actividades— y deja la
 * tabla visible detrás para saltar de una persona a otra.
 *
 * El detalle por curso (módulos/secciones/mundo/simulador) llega por RPC uno a
 * uno; se precargan en segundo plano los cursos ASIGNADOS (de a tres) para que
 * las barras se llenen solas mientras se lee el encabezado, y el resto del
 * catálogo se pide solo al desplegarlo.
 */
export function UserProgressDrawer({ user, campaignName, onClose }: UserProgressDrawerProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [courses, setCourses] = useState<AdminUserCourse[]>([])
  const [detail, setDetail] = useState<Record<string, DetailState>>({})
  const [game, setGame] = useState<GamificationSummary | null>(null)
  /** Cuándo se certificó cada curso (`course_id` → ISO). Es lo que explica los
      "certificado pero le faltan módulos": el certificado es anterior al
      temario de hoy. */
  const [certifiedAt, setCertifiedAt] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tab, setTab] = useState<'assigned' | 'catalog'>('assigned')
  const [query, setQuery] = useState('')

  /* ── Carga inicial ───────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true
    setLoading(true)
    setDenied(false)
    setCourses([])
    setDetail({})
    setExpanded(null)
    setQuery('')
    setTab('assigned')

    getUserCoursesAdmin(user.id)
      .then((cs) => alive && setCourses(cs))
      .catch(() => alive && setDenied(true))
      .finally(() => alive && setLoading(false))

    // La gamificación es decorativa: si la RLS no la autoriza, no se pinta.
    getUserGamification(user.id).then((g) => alive && setGame(g)).catch(() => {})

    return () => { alive = false }
  }, [user.id])

  /* ── Precarga del detalle de los cursos asignados (3 en paralelo) ─────── */
  useEffect(() => {
    const queue = courses.filter((c) => c.is_assigned).map((c) => c.course_id)
    if (queue.length === 0) return
    let alive = true
    let next = 0

    const worker = async () => {
      while (alive && next < queue.length) {
        const id = queue[next++]
        try {
          const dt = await getUserCourseDetailAdmin(user.id, id)
          if (alive) setDetail((d) => (d[id] && d[id] !== 'loading' ? d : { ...d, [id]: dt }))
        } catch {
          if (alive) setDetail((d) => (d[id] ? d : { ...d, [id]: 'error' }))
        }
      }
    }
    void Promise.all([worker(), worker(), worker()])
    return () => { alive = false }
  }, [courses, user.id])

  /* ── Cerrar con Escape + bloquear el scroll de fondo ──────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const loadDetail = async (courseId: string) => {
    setDetail((d) => ({ ...d, [courseId]: 'loading' }))
    try {
      const dt = await getUserCourseDetailAdmin(user.id, courseId)
      setDetail((d) => ({ ...d, [courseId]: dt }))
    } catch {
      setDetail((d) => ({ ...d, [courseId]: 'error' }))
    }
  }

  const toggle = (courseId: string) => {
    if (expanded === courseId) {
      setExpanded(null)
      return
    }
    setExpanded(courseId)
    const dt = detail[courseId]
    if (!dt || dt === 'error') void loadDetail(courseId)
  }

  /* ── Cifras del encabezado ───────────────────────────────────────────── */
  const assigned = useMemo(() => courses.filter((c) => c.is_assigned), [courses])
  const catalog = useMemo(() => courses.filter((c) => !c.is_assigned), [courses])

  // Una sola consulta por persona (no por curso): la fecha de sus certificados.
  useEffect(() => {
    let alive = true
    void supabase
      .from('certifications')
      .select('course_id, issued_at')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (!alive || error || !data) return
        const map: Record<string, string> = {}
        for (const row of data as Array<{ course_id: string; issued_at: string }>) {
          map[row.course_id] = row.issued_at
        }
        setCertifiedAt(map)
      })
    return () => { alive = false }
  }, [user.id])

  const modulesDone = (courseId: string): number | null => {
    const dt = detail[courseId]
    if (!dt || dt === 'loading' || dt === 'error') return null
    return dt.modules.filter((m) => m.completed).length
  }

  const stats = useMemo(() => {
    const done = assigned.filter((c) => isCourseFinished(c, modulesDone(c.course_id))).length
    const scored = assigned.filter((c) => c.score != null)
    const avg = scored.length
      ? Math.round(scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length)
      : null
    const certs = assigned.filter((c) => c.certified).length
    // Denominador SIEMPRE disponible (viene con el curso); el numerador se
    // completa a medida que llega el detalle, así el aro sube solo.
    const totalModules = assigned.reduce((a, c) => a + (c.total_modules ?? 0), 0)
    const doneModules = assigned.reduce((a, c) => a + (modulesDone(c.course_id) ?? 0), 0)
    return {
      total: assigned.length,
      done,
      avg,
      certs,
      totalModules,
      doneModules,
      pct: totalModules > 0 ? Math.round((doneModules / totalModules) * 100) : 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigned, detail])

  /**
   * Los cursos se agrupan por lo que la persona YA HIZO, no por orden
   * alfabético: lo hecho arriba, lo empezado en medio y lo que ni ha tocado al
   * final —y ese último grupo, plegado—.
   *
   * Con veintiséis cursos asignados y cuatro terminados, la lista alfabética
   * obligaba a recorrerla entera para encontrar la única información que se
   * está buscando al abrir la ficha de alguien: qué ha hecho.
   */
  const groups = useMemo(() => {
    const list = tab === 'assigned' ? assigned : catalog
    const q = fold(query)
    const filtered = q ? list.filter((c) => fold(rowText(c)).includes(q)) : list

    const isDone = (c: AdminUserCourse) => isCourseFinished(c, modulesDone(c.course_id))
    const isStarted = (c: AdminUserCourse) =>
      courseState(c, modulesDone(c.course_id)) === 'in_progress'

    const done = filtered.filter(isDone).sort((a, b) => {
      const ta = a.completed_at ? Date.parse(a.completed_at) : 0
      const tb = b.completed_at ? Date.parse(b.completed_at) : 0
      return tb - ta || rowText(a).localeCompare(rowText(b))
    })
    const started = filtered.filter(isStarted).sort((a, b) => rowText(a).localeCompare(rowText(b)))
    const idle = filtered
      .filter((c) => !isDone(c) && !isStarted(c))
      .sort((a, b) => {
        // Lo obligatorio primero: es lo que hay que empujar.
        if (!!a.is_mandatory !== !!b.is_mandatory) return a.is_mandatory ? -1 : 1
        return rowText(a).localeCompare(rowText(b))
      })

    return { done, started, idle, total: filtered.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, assigned, catalog, query, detail])

  /* El grupo "sin empezar" se abre a petición: es el más largo y el que menos
     dice. Con una búsqueda escrita se muestra siempre (buscar es pedirlo). */
  const [showIdle, setShowIdle] = useState(false)
  const idleOpen = showIdle || query.trim().length > 0

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })
      : null

  const roleLabel = t(`roles.${user.role}`)
  const name = user.display_name || t('admin.users.no_name')

  const panel = (
    <motion.aside
      className="fixed inset-y-0 right-0 z-[9995] flex w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-glass-lg"
      initial={reduce ? { opacity: 0 } : { x: '100%' }}
      animate={reduce ? { opacity: 1 } : { x: 0 }}
      exit={reduce ? { opacity: 0 } : { x: '100%' }}
      transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('admin.users.progress_drawer_title')}
    >
      {/* ── Encabezado: quién es ─────────────────────────────────────────── */}
      <div className="relative shrink-0 overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{ background: `radial-gradient(520px circle at 12% -20%, ${GREEN}, transparent 60%), radial-gradient(420px circle at 95% 0%, ${MAGENTA}, transparent 60%)` }}
        />
        <div className="relative flex items-start gap-3 px-5 pb-4 pt-5">
          <Avatar src={user.avatar_url} name={user.display_name} size={52} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold text-text">{name}</h2>
            <p className="mt-0.5 truncate text-[12px] text-text-muted">
              {user.email ?? user.job_title ?? t('admin.users.progress_drawer_subtitle')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(16,212,81,0.14)', color: '#0ca23e' }}
              >
                {roleLabel}
              </span>
              {campaignName && (
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium text-text-muted">
                  {campaignName}
                </span>
              )}
              {game && game.streak > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: 'rgba(245,158,11,0.15)', color: '#d97706' }}
                >
                  <Flame className="h-3 w-3" />
                  {t('admin.users.progress_streak', { count: game.streak })}
                </span>
              )}
              {game && game.xp > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: 'rgba(179,61,158,0.15)', color: MAGENTA }}
                >
                  <Sparkles className="h-3 w-3" />
                  {game.xp} XP
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text"
            aria-label={t('common.close', 'Cerrar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Cifras: aro de avance + tres métricas ──────────────────────── */}
        {!denied && !loading && assigned.length > 0 && (
          <div className="relative flex items-center gap-4 px-5 pb-5">
            <BigRing pct={stats.pct} reduce={reduce} />
            <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
              <Metric
                icon={<GraduationCap className="h-3.5 w-3.5" />}
                label={t('admin.users.courses_completed')}
                value={`${stats.done}/${stats.total}`}
              />
              <Metric
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                label={t('admin.users.avg_score')}
                value={stats.avg != null ? `${stats.avg}%` : '—'}
                accent={MAGENTA}
              />
              <Metric
                icon={<Award className="h-3.5 w-3.5" />}
                label={t('admin.users.certifications')}
                value={String(stats.certs)}
                accent="#d97706"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      {!denied && !loading && courses.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <div className="flex rounded-xl bg-subtle p-0.5">
            {(['assigned', 'catalog'] as const).map((id) => {
              const count = id === 'assigned' ? assigned.length : catalog.length
              if (id === 'catalog' && count === 0) return null
              const active = tab === id
              return (
                <button
                  key={id}
                  onClick={() => { setTab(id); setExpanded(null) }}
                  className={cn(
                    'relative rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                    active ? 'text-text' : 'text-text-muted hover:text-text',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="progress-drawer-tab"
                      className="absolute inset-0 rounded-[10px] bg-surface shadow-sm"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative">
                    {id === 'assigned' ? t('admin.users.assigned_badge') : t('admin.users.catalog_courses')}
                    <span className="ml-1.5 text-text-subtle tabular-nums">{count}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.users.search_courses_ph')}
              className="w-full rounded-xl border border-line bg-subtle py-2 pl-8 pr-3 text-[12px] text-text outline-none transition-colors focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* ── Cursos ───────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-subtle" style={{ animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        ) : denied ? (
          <Empty icon={<BarChart3 className="h-5 w-5" />} text={t('admin.users.courses_only_superadmin')} />
        ) : groups.total === 0 ? (
          <Empty
            icon={<BookOpen className="h-5 w-5" />}
            text={query ? t('admin.users.no_results') : t('admin.users.no_courses_assigned')}
          />
        ) : (
          <motion.div
            className="space-y-2"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.045 } } }}
          >
            {([
              { key: 'done', items: groups.done, label: t('admin.users.group_done', 'Ya los hizo'), tone: '#22c55e' },
              { key: 'started', items: groups.started, label: t('admin.users.group_started', 'En curso'), tone: '#3b82f6' },
            ] as const).map((g) => (
              g.items.length === 0 ? null : (
                <div key={g.key} className="space-y-2">
                  <p className="flex items-center gap-2 px-1 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-text-muted">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.tone }} />
                    {g.label}
                    <span className="tabular-nums text-text-subtle">{g.items.length}</span>
                  </p>
                  {g.items.map((c) => (
                    <CourseCard
                      key={c.course_id}
                      course={c}
                      detail={detail[c.course_id]}
                      open={expanded === c.course_id}
                      onToggle={() => toggle(c.course_id)}
                      completedLabel={fmtDate(c.completed_at)}
                      certifiedLabel={fmtDate(certifiedAt[c.course_id] ?? null)}
                      reduce={reduce}
                    />
                  ))}
                </div>
              )
            ))}

            {groups.idle.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowIdle((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-xl px-1 py-2 text-left text-[10.5px] font-bold uppercase tracking-wider text-text-muted transition-colors hover:text-text"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                  {t('admin.users.group_idle', 'Sin empezar')}
                  <span className="tabular-nums text-text-subtle">{groups.idle.length}</span>
                  {!idleOpen && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold normal-case tracking-normal text-text-muted">
                      {t('admin.users.group_idle_show', 'Ver')}
                      <ChevronDown className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {idleOpen && !query && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold normal-case tracking-normal text-text-muted">
                      {t('admin.users.group_idle_hide', 'Ocultar')}
                      <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                    </span>
                  )}
                </button>
                {idleOpen && groups.idle.map((c) => (
                  <CourseCard
                    key={c.course_id}
                    course={c}
                    detail={detail[c.course_id]}
                    open={expanded === c.course_id}
                    onToggle={() => toggle(c.course_id)}
                    completedLabel={fmtDate(c.completed_at)}
                    certifiedLabel={fmtDate(certifiedAt[c.course_id] ?? null)}
                    reduce={reduce}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* ── Pie: saltar a las vistas completas ───────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
        <button
          onClick={() => { onClose(); navigate(`/admin/users/${user.id}`) }}
          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-subtle px-3 text-[12px] font-medium text-text transition-colors hover:bg-glass/6"
        >
          <IdCard className="h-4 w-4" />
          {t('admin.users.view_profile')}
        </button>
        <button
          /* A SUS MÓDULOS, no a Mundos: quien abre la ficha de alguien viene
             mirando cursos y módulos, y este botón lo sacaba al progreso
             gamificado —otra pantalla, otro tema— sin haberlo pedido. */
          onClick={() => { onClose(); navigate(`/admin/progress?view=modules&tab=inbox&user=${user.id}`) }}
          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-black transition-transform hover:scale-[1.02]"
          style={{ background: GREEN }}
        >
          {t('admin.users.progress_full')}
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </motion.aside>
  )

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="progress-drawer"
        className="fixed inset-0 z-[9994]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" {...backdropDismiss(onClose)} />
        {panel}
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

/** Aro grande de avance por módulos, con el número contando hacia su valor. */
function BigRing({ pct, reduce }: { pct: number; reduce: boolean }) {
  const size = 76
  const stroke = 7
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const { t } = useTranslation()

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="progress-drawer-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={GREEN} />
            <stop offset="100%" stopColor={MAGENTA} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--line))" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#progress-drawer-ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - Math.min(1, Math.max(0, pct / 100))) }}
          transition={{ duration: reduce ? 0 : 1, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[17px] font-bold leading-none text-text tabular-nums">
          {reduce ? pct : <AnimatedNumber value={pct} />}%
        </span>
        <span className="mt-0.5 text-[8px] uppercase tracking-wider text-text-subtle">
          {t('admin.users.progress_modules_short')}
        </span>
      </div>
    </div>
  )
}

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-text-subtle" style={accent ? { color: accent } : undefined}>
        {icon}
        <span className="truncate text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-0.5 text-[15px] font-bold text-text tabular-nums">{value}</div>
    </div>
  )
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <span className="text-text-subtle">{icon}</span>
      <p className="text-[13px] text-text-muted">{text}</p>
    </div>
  )
}

/* ── Tarjeta de curso, desplegable ───────────────────────────────────────── */
function CourseCard({
  course: c, detail: dt, open, onToggle, completedLabel, certifiedLabel, reduce,
}: {
  course: AdminUserCourse
  detail: DetailState | undefined
  open: boolean
  onToggle: () => void
  completedLabel: string | null
  /** Fecha de emisión del certificado, ya formateada (o null). */
  certifiedLabel: string | null
  reduce: boolean
}) {
  const { t } = useTranslation()
  const ready = dt && dt !== 'loading' && dt !== 'error' ? dt : null
  const total = ready ? ready.modules.length : c.total_modules
  const done = ready ? ready.modules.filter((m) => m.completed).length : 0
  const pct = total > 0 ? (done / total) * 100 : 0
  // `ready` = ya llegó el temario; sin él no se puede afirmar que esté completo.
  const state = courseState(c, ready ? done : null)
  const isDone = state === 'certified' || state === 'certified_outdated' || state === 'completed'
  const stateLabel =
    state === 'certified' || state === 'certified_outdated'
      ? t('admin.users.status_certified', 'Certificado')
      : state === 'completed' ? t('admin.users.status_done')
        : state === 'in_progress' ? t('admin.users.status_in_progress', 'En curso')
          : t('admin.users.status_pending')
  // Certificado con el temario incompleto: se dice, y se dice cuánto falta.
  const outdated = state === 'certified_outdated'
  const missing = outdated ? total - done : 0

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } } }}
      className={cn(
        'overflow-hidden rounded-2xl border bg-surface transition-colors',
        open ? 'border-primary/40' : 'border-line hover:border-primary/25',
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: isDone ? 'rgba(16,212,81,0.14)' : 'rgb(var(--subtle))',
            color: isDone ? '#0ca23e' : 'rgb(var(--text-muted))',
          }}
        >
          <EntityIcon value={c.icon} fallback="GraduationCap" size={18} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-text">{rowText(c)}</span>
            {c.is_mandatory && c.is_assigned && (
              <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ background: 'rgba(179,61,158,0.14)', color: MAGENTA }}
              >
                {t('admin.users.mandatory_badge')}
              </span>
            )}
            {c.certified && (
              <Award className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={t('admin.users.certified_badge')} />
            )}
          </span>

          {/* Barra de módulos: se llena cuando llega el detalle */}
          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-subtle">
            <motion.span
              className="block h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${GREEN}, ${MAGENTA})` }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: reduce ? 0 : 0.8, ease: EASE }}
            />
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-text-muted">
            <span className="tabular-nums">
              {ready
                ? t('admin.users.progress_modules_done', { done, count: total })
                : t('courses.modules_count', { count: c.total_modules })}
            </span>
            {c.score != null && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                <b className="text-text tabular-nums">{c.score}%</b>
              </span>
            )}
            {completedLabel && (
              <span>{t('admin.users.last_activity_at', { date: completedLabel, defaultValue: 'Últ. actividad {{date}}' })}</span>
            )}
            {!ready && c.is_assigned && dt !== 'error' && (
              <Loader2 className="h-3 w-3 animate-spin text-text-subtle" />
            )}
          </span>
        </span>

        <span
          className={cn(
            'shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-[10px] font-semibold',
            isDone
              ? 'bg-[rgba(16,212,81,0.15)] text-[#0ca23e]'
              : state === 'in_progress'
                ? 'bg-blue-500/12 text-blue-600 dark:text-blue-400'
                : 'bg-subtle text-text-muted',
          )}
        >
          {stateLabel}
        </span>
        {outdated && (
          <Tooltip
            anchor="element"
            delay={120}
            maxWidth={280}
            label={t('admin.users.cert_outdated_hint', {
              count: missing,
              defaultValue: 'Se certificó con el temario de entonces; después se publicaron {{count}} módulos que no ha hecho. El certificado sigue siendo válido: para ponerlo al día, pide la recertificación desde la pestaña Certificación del curso.',
            })}
          >
            <span className="shrink-0 whitespace-nowrap rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {t('admin.users.cert_outdated', { count: missing, defaultValue: 'Faltan {{count}} módulos' })}
            </span>
          </Tooltip>
        )}
        <motion.span
          className="shrink-0 text-text-subtle"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-4 py-3">
              {/* Por qué está certificado con módulos pendientes. Va VISIBLE, no
                  en un tooltip: es justo la pregunta que el capacitador iba a
                  hacer, y la respuesta tiene fecha. */}
              {outdated && (
                <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <p className="text-[11.5px] leading-relaxed text-text-muted">
                    <b className="text-text">
                      {t('admin.users.cert_outdated_title', 'Certificado antes de que el curso creciera')}
                    </b>
                    <br />
                    {certifiedLabel
                      ? t('admin.users.cert_outdated_when', {
                          date: certifiedLabel, count: missing,
                          defaultValue: 'Se certificó el {{date}}, cuando el temario era más corto. Desde entonces el curso tiene {{count}} módulos que no ha hecho.',
                        })
                      : t('admin.users.cert_outdated_generic', {
                          count: missing,
                          defaultValue: 'Se certificó con el temario que había entonces. Hoy el curso tiene {{count}} módulos que no ha hecho.',
                        })}
                    {' '}
                    {t('admin.users.cert_outdated_action', 'Su certificado sigue siendo válido; para ponerlo al día, pide la recertificación del curso en Contenido → Cursos → pestaña Certificación.')}
                  </p>
                </div>
              )}
              {!dt || dt === 'loading' ? (
                <div className="flex justify-center py-5">
                  <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
                </div>
              ) : dt === 'error' ? (
                <p className="py-3 text-center text-[12px] text-text-muted">{t('admin.users.reset_error')}</p>
              ) : (
                <CourseDetail dt={dt} reduce={reduce} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** Módulos, actividades, mundo y simulador de un curso. */
function CourseDetail({ dt, reduce }: { dt: AdminCourseDetail; reduce: boolean }) {
  const { t } = useTranslation()
  const [openModule, setOpenModule] = useState<string | null>(null)

  return (
    <div className="space-y-2">
      {(dt.has_world || dt.has_sim) && (
        <div className="flex flex-wrap gap-1.5">
          {dt.has_world && (
            <Chip icon={<Globe className="h-3 w-3" />} label={t('admin.users.reset_world')} done={dt.world_done} />
          )}
          {dt.has_sim && (
            <Chip icon={<PhoneCall className="h-3 w-3" />} label={t('admin.users.reset_simulator')} done={dt.sim_done} />
          )}
        </div>
      )}

      {dt.modules.length === 0 ? (
        <p className="py-1 text-[12px] text-text-muted">{t('admin.users.reset_no_modules')}</p>
      ) : (
        <div className="relative space-y-1">
          {/* Línea de tiempo vertical que une los módulos */}
          <span aria-hidden className="absolute bottom-3 left-[13px] top-3 w-px bg-line" />
          {dt.modules.map((m, i) => {
            const attempted = m.sections.filter((s) => s.has_attempt).length
            const isOpen = openModule === m.id
            return (
              <motion.div
                key={m.id}
                initial={reduce ? undefined : { opacity: 0, x: -8 }}
                animate={reduce ? undefined : { opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.03, ease: EASE }}
                className="relative"
              >
                <button
                  onClick={() => setOpenModule(isOpen ? null : m.id)}
                  disabled={m.sections.length === 0}
                  aria-expanded={isOpen}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl py-1.5 pl-0 pr-2 text-left transition-colors',
                    m.sections.length > 0 && 'hover:bg-subtle',
                  )}
                >
                  <span className="relative z-[1] flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full bg-surface">
                    {m.completed ? (
                      <CheckCircle2 className="h-4 w-4" style={{ color: GREEN }} />
                    ) : (
                      <Circle className="h-4 w-4 text-text-subtle" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[12px]', m.completed ? 'text-text' : 'text-text-muted')}>
                      {rowText(m)}
                    </span>
                    {m.sections.length > 0 && (
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {/* Puntos: una actividad cada uno, encendidas las resueltas */}
                        {m.sections.slice(0, 12).map((s) => (
                          <span
                            key={s.id}
                            className="h-1 w-1 rounded-full"
                            style={{ background: s.has_attempt ? GREEN : 'rgb(var(--line))' }}
                          />
                        ))}
                        <span className="text-[10px] text-text-subtle tabular-nums">
                          {t('admin.users.progress_activities', { done: attempted, total: m.sections.length })}
                        </span>
                      </span>
                    )}
                  </span>
                  {m.sections.length > 0 && (
                    <motion.span
                      className="shrink-0 text-text-subtle"
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </motion.span>
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.ul
                      initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      className="overflow-hidden pl-[38px]"
                    >
                      {m.sections.map((s) => (
                        <li key={s.id} className="flex items-center gap-2 py-1">
                          <ListChecks
                            className="h-3 w-3 shrink-0"
                            style={{ color: s.has_attempt ? GREEN : 'rgb(var(--text-subtle))' }}
                          />
                          <span className={cn('min-w-0 flex-1 truncate text-[11px]', s.has_attempt ? 'text-text-muted' : 'text-text-subtle')}>
                            {rowText(s, 'heading')}
                          </span>
                          <span className="shrink-0 text-[10px] text-text-subtle">
                            {s.has_attempt ? t('admin.users.progress_solved') : t('admin.users.status_pending')}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Chip({ icon, label, done }: { icon: React.ReactNode; label: string; done: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium"
      style={done
        ? { background: 'rgba(16,212,81,0.14)', color: '#0ca23e' }
        : { background: 'rgb(var(--subtle))', color: 'rgb(var(--text-muted))' }}
    >
      {icon}
      {label}
      {done && <CheckCircle2 className="h-3 w-3" />}
    </span>
  )
}
