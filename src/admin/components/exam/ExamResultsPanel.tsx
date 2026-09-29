import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  Check,
  Clock,
  Download,
  GraduationCap,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { rowText } from '@/lib/contentLang'
import { fold } from '@/lib/normalize'
import { stripMarkdown } from '@/components/ui/RichText'
import { downloadWorkbook, type Sheet, type SheetRow } from '@/lib/exportXlsx'
import {
  getExamAttemptsDetail,
  type ExamAttemptDetail,
} from '@/services/exams.admin.service'
import {
  buildExamDetailSheets,
  minutesBetween,
  verdictLabels,
  verdictOf,
  type Verdict,
} from '@/admin/lib/examExport'
import type { ReinforcementStudyAudit } from '@/services/reinforcementStudy.service'
import type { ExamDomain, ExamQuestion, ExamResultRow } from '@/types/exam'

/* ── Resultados del examen final ─────────────────────────────────────────
 *
 * Tablero del examen dentro del editor del curso: cabecera con el pulso del
 * grupo (aprobación, nota, reparto de notas), las personas en tarjetas y un
 * modal por persona con sus intentos pregunta por pregunta —lo que marcó y
 * cuál era la correcta—.
 *
 * El Excel baja exactamente lo que se está viendo (buscar a una persona y
 * exportar da el archivo de esa persona) y desde el modal, el de esa persona.
 * Las respuestas se piden aparte y una sola vez, al abrir el primer detalle o
 * al exportar: las tarjetas no las necesitan y pesan. */

type Filter = 'all' | 'passed' | 'failed' | 'reinforcement'
type Sort = 'recent' | 'name' | 'score'
type Detail = { attempts: ExamAttemptDetail[]; questions: Map<string, ExamQuestion> }
/** "Rubén Gutiérrez Joaquinero" → "RG". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Tono estable por persona: el mismo nombre, el mismo color, siempre. */
const AVATAR_TONES = [
  'from-sky-400/80 to-indigo-500/80',
  'from-emerald-400/80 to-teal-600/80',
  'from-fuchsia-400/80 to-purple-600/80',
  'from-amber-400/80 to-orange-600/80',
  'from-rose-400/80 to-pink-600/80',
  'from-cyan-400/80 to-blue-600/80',
]
function toneOf(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

/** Anillo de progreso. `tone` pinta con currentColor. */
function Ring({
  pct,
  size = 56,
  stroke = 5,
  tone,
  children,
}: {
  pct: number
  size?: number
  stroke?: number
  tone: string
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', tone)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - clamped / 100) }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  )
}

function Avatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br font-bold text-white shadow-sm',
        toneOf(id),
        size === 'lg' ? 'h-14 w-14 text-[18px]' : 'h-11 w-11 text-[13px]',
      )}
    >
      {initials(name)}
    </span>
  )
}

export function ExamResultsPanel({
  courseTitle,
  courseId,
  results,
  domains,
  studyByUser,
  onGrant,
}: {
  courseId: string
  courseTitle: string
  results: ExamResultRow[]
  domains: ExamDomain[]
  studyByUser: Map<string, ReinforcementStudyAudit[]>
  onGrant: (userId: string, name: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [openUser, setOpenUser] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const presented = useMemo(() => results.filter((r) => r.attempts > 0), [results])

  const kpis = useMemo(() => {
    const passed = presented.filter((r) => r.passed).length
    const best = presented.map((r) => r.best_score).filter((s): s is number => s !== null)
    // Reparto de notas en cinco tramos: dice más que el promedio solo.
    const bins = [0, 0, 0, 0, 0]
    for (const s of best) bins[s < 60 ? 0 : s < 70 ? 1 : s < 80 ? 2 : s < 90 ? 3 : 4]++
    return {
      taken: presented.length,
      passed,
      passRate: presented.length ? Math.round((passed / presented.length) * 100) : 0,
      avg: best.length ? Math.round(best.reduce((s, v) => s + v, 0) / best.length) : null,
      attemptsAvg: presented.length
        ? Math.round((presented.reduce((s, r) => s + r.attempts, 0) / presented.length) * 10) / 10
        : 0,
      reinforcement: presented.filter((r) => r.reinforcement === 'pending').length,
      bins,
    }
  }, [presented])

  const counts: Record<Filter, number> = {
    all: presented.length,
    passed: kpis.passed,
    failed: presented.length - kpis.passed,
    reinforcement: kpis.reinforcement,
  }

  const visible = useMemo(() => {
    const q = fold(query.trim())
    const list = presented.filter((r) => {
      if (filter === 'passed' && !r.passed) return false
      if (filter === 'failed' && r.passed) return false
      if (filter === 'reinforcement' && r.reinforcement !== 'pending') return false
      if (!q) return true
      return fold(r.display_name ?? '').includes(q) || fold(r.email ?? '').includes(q)
    })
    return [...list].sort((a, b) => {
      if (sort === 'name') return (a.display_name ?? '').localeCompare(b.display_name ?? '')
      if (sort === 'score') return (b.best_score ?? -1) - (a.best_score ?? -1)
      return (b.last_at ?? '').localeCompare(a.last_at ?? '')
    })
  }, [presented, query, filter, sort])

  /** Nombre de un tema: el de la configuración actual y, si ya no existe, el
      que quedó sellado en el intento. */
  const domainName = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of detail?.attempts ?? []) {
      for (const d of a.domain_scores) map.set(d.domain_id, rowText(d, 'name'))
    }
    for (const d of domains) map.set(d.id, rowText(d, 'name'))
    return (id: string | null | undefined) => (id ? map.get(id) ?? '' : '')
  }, [detail, domains])

  const attemptsByUser = useMemo(() => {
    const map = new Map<string, ExamAttemptDetail[]>()
    for (const a of detail?.attempts ?? []) {
      const list = map.get(a.user_id)
      if (list) list.push(a)
      else map.set(a.user_id, [a])
    }
    for (const list of map.values()) list.sort((a, b) => a.attempt_no - b.attempt_no)
    return map
  }, [detail])

  const loadDetail = async (): Promise<Detail | null> => {
    if (detail) return detail
    setDetailLoading(true)
    try {
      const d = await getExamAttemptsDetail(courseId)
      setDetail(d)
      return d
    } catch (err) {
      toast.error(
        t('admin.exam.detail_error', 'No se pudieron cargar las respuestas'),
        err instanceof Error ? err.message : undefined,
      )
      return null
    } finally {
      setDetailLoading(false)
    }
  }

  const openPerson = (userId: string) => {
    setOpenUser(userId)
    void loadDetail()
  }

  const fmtDate = (iso: string | null | undefined, withTime = true) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language, {
          day: 'numeric', month: 'short', year: 'numeric',
          ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
        })
      : ''

  const verdictLabel = verdictLabels(t)

  /* ── Excel ─────────────────────────────────────────────────────────── */

  const exportExcel = async (who: ExamResultRow[]) => {
    if (who.length === 0) return
    setExporting(true)
    try {
      const d = await loadDetail()
      if (!d) return
      const people = new Map(who.map((r) => [r.user_id, r]))
      const attempts = d.attempts.filter((a) => people.has(a.user_id))
      const C = {
        person: t('admin.exam.x_person', 'Persona'),
        email: t('admin.exam.x_email', 'Correo'),
        attempt: t('admin.exam.x_attempt', 'Intento'),
        yes: t('admin.exam.x_yes', 'Sí'),
        no: t('admin.exam.x_no', 'No'),
      }
      const personCols = (userId: string) => {
        const r = people.get(userId)
        return { [C.person]: r?.display_name ?? '', [C.email]: r?.email ?? '' }
      }

      const summary: Sheet = {
        name: t('admin.exam.x_sheet_summary', 'Resumen'),
        rows: who.map<SheetRow>((r) => ({
          ...personCols(r.user_id),
          [t('admin.exam.x_attempts', 'Intentos')]: r.attempts,
          [t('admin.exam.x_best', 'Mejor nota (%)')]: r.best_score ?? '',
          [t('admin.exam.x_last', 'Última nota (%)')]: r.last_score ?? '',
          [t('admin.exam.x_passed', 'Aprobó')]: r.passed ? C.yes : C.no,
          [t('admin.exam.x_reinforcement', 'Refuerzo')]:
            r.reinforcement === 'pending'
              ? t('admin.exam.x_reinf_pending', 'Pendiente')
              : r.reinforcement === 'completed'
                ? t('admin.exam.x_reinf_done', 'Hecho')
                : '',
          [t('admin.exam.x_weak', 'Temas flojos')]: r.weak_domains
            .map((w) => `${rowText(w, 'name')} (${w.pct}%)`)
            .join(' · '),
          [t('admin.exam.x_last_at', 'Último intento')]: fmtDate(r.last_at),
        })),
      }

      const detailSheets = buildExamDetailSheets(
        [{
          courseTitle,
          attempts,
          questions: d.questions,
          domainNames: new Map(domains.map((x) => [x.id, rowText(x, 'name')])),
        }],
        new Map(who.map((r) => [r.user_id, { name: r.display_name ?? '', email: r.email ?? '' }])),
        t,
        i18n.language,
      )
      const single = who.length === 1 ? who[0].display_name ?? '' : ''
      const base = fold(`examen ${courseTitle} ${single}`)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80)
      await downloadWorkbook(
        base || 'examen',
        [summary, detailSheets.attempts, detailSheets.domains, detailSheets.answers, detailSheets.analysis],
        { subtitle: single ? `${courseTitle} · ${single}` : courseTitle },
      )
      toast.success(t('admin.exam.x_done', {
        n: who.length,
        defaultValue: 'Excel descargado: {{n}} persona(s) con todas sus respuestas',
      }))
    } catch (err) {
      toast.error(
        t('admin.exam.x_error', 'No se pudo generar el Excel'),
        err instanceof Error ? err.message : undefined,
      )
    } finally {
      setExporting(false)
    }
  }

  if (presented.length === 0) return null

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: t('admin.exam.f_all', 'Todos') },
    { key: 'passed', label: t('admin.exam.f_passed', 'Aprobados') },
    { key: 'failed', label: t('admin.exam.f_failed', 'No aprobados') },
    { key: 'reinforcement', label: t('admin.exam.f_in_reinforcement', 'En refuerzo') },
  ]
  const binLabels = ['<60', '60s', '70s', '80s', '90+']
  const binMax = Math.max(1, ...kpis.bins)
  const openRow = openUser ? presented.find((r) => r.user_id === openUser) ?? null : null

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface/40">
      {/* ── Cabecera: el pulso del grupo ── */}
      <div className="relative overflow-hidden border-b border-line px-5 py-5 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {t('admin.exam.results_kicker', 'Examen final')}
            </div>
            <h3 className="mt-1 text-[20px] font-bold tracking-tight text-text">
              {t('admin.exam.results_title', 'Resultados del examen')}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-text-muted">
              {t('admin.exam.results_summary', {
                n: kpis.taken,
                passed: kpis.passed,
                defaultValue: 'Lo han presentado: {{n}} · aprobados: {{passed}}',
              })}
            </p>
          </div>
          <Tooltip
            label={t(
              'admin.exam.x_tip',
              'Descarga a las personas que ves en la lista (usa el buscador para una sola), con cada intento y cada respuesta: lo que marcó y cuál era la correcta.',
            )}
            maxWidth={280}
          >
            <button
              onClick={() => void exportExcel(visible)}
              disabled={exporting || visible.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-[12.5px] font-semibold text-on-primary shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/25 disabled:translate-y-0 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {visible.length === 1
                ? t('admin.exam.x_button_one', 'Excel de esta persona')
                : t('admin.exam.x_button', { n: visible.length, defaultValue: 'Excel detallado ({{n}})' })}
            </button>
          </Tooltip>
        </div>

        <div className="relative mt-5 grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          {/* Aprobación en grande */}
          <div className="flex items-center gap-4">
            <Ring pct={kpis.passRate} size={92} stroke={8} tone="text-primary">
              <span className="text-center leading-none">
                <span className="block text-[22px] font-bold tabular-nums text-text">{kpis.passRate}%</span>
                <span className="mt-1 block text-[9.5px] font-semibold uppercase tracking-wide text-text-subtle">
                  {t('admin.exam.k_pass', 'Aprobación')}
                </span>
              </span>
            </Ring>
            <div className="text-[12px] text-text-muted">
              <span className="block text-[15px] font-semibold text-text tabular-nums">
                {kpis.passed}/{kpis.taken}
              </span>
              {t('admin.exam.k_passed_people', 'personas aprobadas')}
            </div>
          </div>

          {/* Indicadores */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('admin.exam.k_taken', 'Presentaron'), value: String(kpis.taken) },
              { label: t('admin.exam.k_avg', 'Nota promedio'), value: kpis.avg === null ? '—' : `${kpis.avg}%` },
              {
                label: t('admin.exam.k_attempts', 'Intentos promedio'),
                value: String(kpis.attemptsAvg),
                sub: kpis.reinforcement
                  ? t('admin.exam.k_reinf', { n: kpis.reinforcement, defaultValue: '{{n}} en refuerzo' })
                  : undefined,
              },
            ].map((k) => (
              <div key={k.label} className="rounded-2xl border border-line bg-surface/60 px-3.5 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">{k.label}</div>
                <div className="mt-1 text-[20px] font-bold tabular-nums leading-none text-text">{k.value}</div>
                {k.sub && <div className="mt-1 text-[10.5px] text-amber-600">{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Reparto de notas */}
          <div className="rounded-2xl border border-line bg-surface/60 px-3.5 py-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
              {t('admin.exam.k_distribution', 'Reparto de notas')}
            </div>
            <div className="flex h-12 items-end gap-1.5">
              {kpis.bins.map((n, i) => (
                <Tooltip key={i} label={`${binLabels[i]}: ${n}`}>
                  <span className="flex w-7 flex-col items-center gap-1">
                    <motion.span
                      className={cn('w-full rounded-md', i < 2 ? 'bg-neon-magenta/60' : 'bg-primary/70')}
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(n ? 12 : 3, (n / binMax) * 40)}px` }}
                      transition={{ duration: 0.6, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </span>
                </Tooltip>
              ))}
            </div>
            <div className="mt-1 flex gap-1.5">
              {binLabels.map((l) => (
                <span key={l} className="w-7 text-center text-[9px] text-text-subtle">{l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Herramientas ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.exam.search_person', 'Buscar persona o correo…')}
            className="h-10 w-full rounded-2xl border border-line bg-surface/60 pl-9 pr-9 text-[12.5px] text-text outline-none transition-colors focus:border-primary/50"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label={t('common.clear', 'Limpiar')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-subtle hover:text-text"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {/* Control segmentado */}
        <div className="flex rounded-2xl border border-line bg-surface/60 p-1">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                'relative rounded-xl px-3 py-1.5 text-[11.5px] font-medium transition-colors',
                filter === f.key ? 'text-text' : 'text-text-muted hover:text-text',
              )}
            >
              {filter === f.key && (
                <motion.span
                  layoutId="exam-results-filter"
                  className="absolute inset-0 rounded-xl bg-primary/10 ring-1 ring-primary/30"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative">
                {f.label} <span className="tabular-nums opacity-60">{counts[f.key]}</span>
              </span>
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label={t('admin.exam.sort', 'Ordenar')}
          className="h-10 rounded-2xl border border-line bg-surface/60 px-3 text-[12px] text-text-muted outline-none"
        >
          <option value="recent">{t('admin.exam.sort_recent', 'Más recientes')}</option>
          <option value="score">{t('admin.exam.sort_score', 'Mejor nota')}</option>
          <option value="name">{t('admin.exam.sort_name', 'Nombre')}</option>
        </select>
      </div>

      {/* ── Personas en tarjetas ── */}
      <div className="px-5 py-5 sm:px-6">
        {visible.length === 0 ? (
          <p className="py-10 text-center text-[12.5px] text-text-subtle">
            {t('admin.exam.no_match', 'Nadie coincide con la búsqueda o el filtro.')}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((r, idx) => {
              const name = r.display_name ?? r.email ?? r.user_id.slice(0, 8)
              const score = r.best_score ?? 0
              const weak = r.weak_domains
              return (
                <motion.div
                  key={r.user_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(idx, 12) * 0.03 }}
                  className="group relative flex flex-col gap-3 rounded-2xl border border-line bg-surface/70 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-black/5"
                >
                  <button
                    onClick={() => openPerson(r.user_id)}
                    className="flex items-start gap-3 text-left"
                    aria-label={t('admin.exam.see_answers', 'Ver respuestas')}
                  >
                    <Avatar id={r.user_id} name={name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-text">{name}</span>
                      <span className="block truncate text-[11.5px] text-text-subtle">{r.email}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {r.passed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">
                            <GraduationCap className="h-3 w-3" />
                            {t('exam.status_passed', 'Aprobado')}
                          </span>
                        ) : (
                          <span className="rounded-full bg-neon-magenta/10 px-2 py-0.5 text-[10.5px] font-semibold text-neon-magenta">
                            {t('admin.exam.not_passed', 'No aprobado')}
                          </span>
                        )}
                        {r.reinforcement === 'pending' && (
                          <Tooltip
                            label={t(
                              'admin.exam.tip_reinforcing',
                              'Tiene un repaso pendiente: no puede volver a presentar el examen hasta terminar los módulos de los temas que reprobó.',
                            )}
                            maxWidth={270}
                          >
                            <span className="cursor-help rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-600">
                              {t('admin.exam.results_reinforcing', 'en refuerzo')}
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </span>
                    <Ring pct={score} tone={r.passed ? 'text-primary' : 'text-neon-magenta'}>
                      <span className="text-[13px] font-bold tabular-nums text-text">{score}%</span>
                    </Ring>
                  </button>

                  {weak.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {weak.slice(0, 2).map((w) => (
                        <span
                          key={w.domain_id}
                          className="max-w-full truncate rounded-lg border border-neon-magenta/20 bg-neon-magenta/5 px-2 py-0.5 text-[10.5px] text-neon-magenta"
                        >
                          {rowText(w, 'name')} · {w.pct}%
                        </span>
                      ))}
                      {weak.length > 2 && (
                        <span className="rounded-lg border border-line px-2 py-0.5 text-[10.5px] text-text-subtle">
                          +{weak.length - 2}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/70 pt-3">
                    <span className="flex min-w-0 items-center gap-3 text-[11px] text-text-subtle">
                      <span className="inline-flex items-center gap-1">
                        <RotateCcw className="h-3 w-3" />
                        {t('admin.exam.results_attempts', { n: r.attempts, defaultValue: 'Intentos: {{n}}' })}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <Clock className="h-3 w-3 shrink-0" />
                        {fmtDate(r.last_at, false)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {!r.passed && (
                        <Tooltip
                          label={t(
                            'admin.exam.tip_grant',
                            'Le suma un intento extra y le levanta la ruta de refuerzo pendiente: puede volver a presentarlo enseguida, sin esperar.',
                          )}
                          maxWidth={260}
                        >
                          <button
                            onClick={() => onGrant(r.user_id, name)}
                            className="rounded-xl border border-line px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
                          >
                            {t('admin.exam.grant_short', 'Dar otro intento')}
                          </button>
                        </Tooltip>
                      )}
                      <button
                        onClick={() => openPerson(r.user_id)}
                        className="inline-flex items-center gap-1 rounded-xl bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15"
                      >
                        {t('admin.exam.see_answers', 'Ver respuestas')}
                        <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </button>
                    </span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {openRow && (
        <PersonExamModal
          row={openRow}
          attempts={attemptsByUser.get(openRow.user_id) ?? []}
          questions={detail?.questions ?? new Map()}
          loading={detailLoading && !detail}
          study={studyByUser.get(openRow.user_id) ?? []}
          domainName={domainName}
          fmtDate={fmtDate}
          verdictLabel={verdictLabel}
          exporting={exporting}
          onExport={() => void exportExcel([openRow])}
          onGrant={() => onGrant(openRow.user_id, openRow.display_name ?? openRow.email ?? '')}
          onClose={() => setOpenUser(null)}
        />
      )}
    </section>
  )
}

/* ── Modal de una persona: sus intentos, pregunta por pregunta ─────────── */

function PersonExamModal({
  row,
  attempts,
  questions,
  loading,
  study,
  domainName,
  fmtDate,
  verdictLabel,
  exporting,
  onExport,
  onGrant,
  onClose,
}: {
  row: ExamResultRow
  attempts: ExamAttemptDetail[]
  questions: Map<string, ExamQuestion>
  loading: boolean
  study: ReinforcementStudyAudit[]
  domainName: (id: string | null | undefined) => string
  fmtDate: (iso: string | null | undefined, withTime?: boolean) => string
  verdictLabel: Record<Verdict, string>
  exporting: boolean
  onExport: () => void
  onGrant: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<string | null>(null)
  const [onlyWrong, setOnlyWrong] = useState(false)
  const name = row.display_name ?? row.email ?? row.user_id.slice(0, 8)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const current = attempts.find((a) => a.id === picked) ?? attempts[attempts.length - 1]
  const items = current
    ? current.question_ids.map((id, i) => {
        const q = questions.get(id)
        const marked = current.answers[id] ?? []
        return { id, i, q, marked, v: verdictOf(q, marked) }
      })
    : []
  const right = items.filter((x) => x.v === 'correct').length
  const wrong = items.filter((x) => x.v === 'wrong').length
  const blank = items.filter((x) => x.v === 'blank').length
  const shown = onlyWrong ? items.filter((x) => x.v !== 'correct') : items
  const minutes = current ? minutesBetween(current.started_at, current.submitted_at) : null
  const studiedMin = Math.round(study.reduce((acc, s) => acc + s.creditedMs, 0) / 60_000)

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={name}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-glass-lg"
        >
          {/* Cabecera */}
          <div className="relative overflow-hidden border-b border-line px-5 py-5 sm:px-6">
            <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative flex items-start gap-4">
              <Avatar id={row.user_id} name={name} size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[18px] font-bold tracking-tight text-text">{name}</h3>
                <p className="truncate text-[12px] text-text-muted">{row.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {row.passed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                      <GraduationCap className="h-3 w-3" />
                      {t('exam.status_passed', 'Aprobado')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-neon-magenta/10 px-2.5 py-0.5 text-[11px] font-semibold text-neon-magenta">
                      {t('admin.exam.not_passed', 'No aprobado')}
                    </span>
                  )}
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-text-muted">
                    {t('admin.exam.results_attempts', { n: row.attempts, defaultValue: 'Intentos: {{n}}' })}
                  </span>
                  {row.reinforcement === 'pending' && (
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600">
                      {t('admin.exam.results_reinforcing', 'en refuerzo')}
                    </span>
                  )}
                  {study.length > 0 && (
                    <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-text-muted">
                      {t('admin.exam.results_study', {
                        done: study.filter((s) => s.completedAt).length,
                        total: study.length,
                        min: studiedMin,
                        defaultValue: 'repaso: {{done}}/{{total}} módulos · {{min}} min',
                      })}
                    </span>
                  )}
                </div>
              </div>
              <Ring pct={row.best_score ?? 0} size={72} stroke={7} tone={row.passed ? 'text-primary' : 'text-neon-magenta'}>
                <span className="text-center leading-none">
                  <span className="block text-[17px] font-bold tabular-nums text-text">{row.best_score ?? 0}%</span>
                  <span className="mt-0.5 block text-[8.5px] font-semibold uppercase tracking-wide text-text-subtle">
                    {t('admin.exam.best_short', 'Mejor')}
                  </span>
                </span>
              </Ring>
              <button
                onClick={onClose}
                className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-subtle transition-colors hover:bg-glass/6 hover:text-text"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Un botón por intento */}
            {attempts.length > 0 && (
              <div className="relative mt-4 flex gap-2 overflow-x-auto pb-1">
                {attempts.map((a) => {
                  const active = a.id === current?.id
                  return (
                    <button
                      key={a.id}
                      onClick={() => setPicked(a.id)}
                      aria-pressed={active}
                      className={cn(
                        'shrink-0 rounded-2xl border px-3.5 py-2 text-left transition-all',
                        active
                          ? 'border-primary/40 bg-primary/10 shadow-sm'
                          : 'border-line bg-surface/60 hover:border-primary/30',
                      )}
                    >
                      <span className="flex items-center gap-2 text-[12px] font-semibold text-text">
                        {t('admin.exam.attempt_n', { n: a.attempt_no, defaultValue: 'Intento {{n}}' })}
                        <span className={cn('tabular-nums', a.passed ? 'text-primary' : 'text-neon-magenta')}>
                          {a.score_pct ?? 0}%
                        </span>
                      </span>
                      <span className="block text-[10.5px] text-text-subtle">{fmtDate(a.submitted_at ?? a.started_at)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Cuerpo */}
          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12.5px] text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('admin.exam.loading_answers', 'Cargando respuestas…')}
              </div>
            ) : !current ? (
              <p className="py-16 text-center text-[12.5px] text-text-subtle">
                {t('admin.exam.no_attempts_detail', 'No hay intentos cerrados para mostrar.')}
              </p>
            ) : (
              <>
                {/* Resumen del intento */}
                <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: verdictLabel.correct, value: right, tone: 'text-primary' },
                      { label: verdictLabel.wrong, value: wrong, tone: 'text-neon-magenta' },
                      { label: verdictLabel.blank, value: blank, tone: 'text-text-muted' },
                    ].map((s) => (
                      <div key={s.label} className="rounded-2xl border border-line px-3 py-2.5 text-center">
                        <div className={cn('text-[20px] font-bold tabular-nums leading-none', s.tone)}>{s.value}</div>
                        <div className="mt-1 text-[10px] text-text-subtle">{s.label}</div>
                      </div>
                    ))}
                    <div className="col-span-3 flex items-center justify-center gap-3 text-[11px] text-text-subtle">
                      {minutes !== null && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {t('admin.exam.took_min', { n: minutes, defaultValue: '{{n}} min' })}
                        </span>
                      )}
                      {current.status === 'expired' && (
                        <span className="text-amber-600">{t('admin.exam.x_expired', 'Se le acabó el tiempo')}</span>
                      )}
                    </div>
                  </div>
                  {/* Nota por tema en barras */}
                  {current.domain_scores.length > 0 && (
                    <div className="space-y-2 rounded-2xl border border-line px-3.5 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                        {t('admin.exam.by_domain_title', 'Por tema')}
                      </div>
                      {current.domain_scores.map((d) => (
                        <div key={d.domain_id}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px]">
                            <span className="truncate text-text">{rowText(d, 'name')}</span>
                            <span className={cn('shrink-0 font-semibold tabular-nums', d.passed ? 'text-primary' : 'text-neon-magenta')}>
                              {d.pct}% <span className="font-normal text-text-subtle">({d.correct}/{d.total})</span>
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-line">
                            <motion.div
                              className={cn('h-full rounded-full', d.passed ? 'bg-primary' : 'bg-neon-magenta')}
                              initial={{ width: 0 }}
                              animate={{ width: `${d.pct}%` }}
                              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mb-3 mt-5 flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-text">
                    {t('admin.exam.right_of', { ok: right, n: items.length, defaultValue: '{{ok}} de {{n}} correctas' })}
                  </h4>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-text-muted">
                    <input
                      type="checkbox"
                      checked={onlyWrong}
                      onChange={(e) => setOnlyWrong(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[rgb(var(--primary))]"
                    />
                    {t('admin.exam.only_wrong', 'Solo las que falló')}
                  </label>
                </div>

                <ol className="space-y-2.5">
                  {shown.map(({ id, i, q, marked, v }) => (
                    <li
                      key={id}
                      className={cn(
                        'rounded-2xl border px-4 py-3',
                        v === 'correct' ? 'border-line' : v === 'wrong' ? 'border-neon-magenta/25' : 'border-line border-dashed',
                      )}
                    >
                      <div className="mb-2 flex items-start gap-2.5">
                        <span
                          className={cn(
                            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                            v === 'correct' && 'bg-primary/15 text-primary',
                            v === 'wrong' && 'bg-neon-magenta/15 text-neon-magenta',
                            (v === 'blank' || v === 'deleted') && 'bg-line text-text-subtle',
                          )}
                          aria-label={verdictLabel[v]}
                        >
                          {v === 'correct' ? <Check className="h-3.5 w-3.5" /> : v === 'wrong' ? <X className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-subtle">
                            {t('admin.exam.question_n', { n: i + 1, defaultValue: 'Pregunta {{n}}' })}
                            {q?.domain_id ? ` · ${domainName(q.domain_id)}` : ''}
                            {v === 'blank' && ` · ${verdictLabel.blank}`}
                          </div>
                          <div className="mt-0.5 text-[13px] font-medium leading-snug text-text">
                            {q ? stripMarkdown(rowText(q, 'text')) : verdictLabel.deleted}
                          </div>
                        </div>
                      </div>
                      {q && (
                        <ul className="space-y-1.5 pl-8">
                          {q.options.map((o) => {
                            const isMarked = marked.includes(o.id)
                            const isRight = q.correct.includes(o.id)
                            return (
                              <li
                                key={o.id}
                                className={cn(
                                  'flex items-start gap-2 rounded-xl px-2.5 py-1.5 text-[12px]',
                                  isRight && 'bg-primary/10 text-text',
                                  isMarked && !isRight && 'bg-neon-magenta/10 text-text',
                                  !isMarked && !isRight && 'text-text-muted',
                                )}
                              >
                                <span className="min-w-0 flex-1">{stripMarkdown(rowText(o, 'text'))}</span>
                                {isMarked && (
                                  <span className={cn('shrink-0 text-[10.5px] font-semibold', isRight ? 'text-primary' : 'text-neon-magenta')}>
                                    {t('admin.exam.marked', 'Marcó')}
                                  </span>
                                )}
                                {isRight && !isMarked && (
                                  <span className="shrink-0 text-[10.5px] font-semibold text-primary">
                                    {t('admin.exam.was_right', 'Correcta')}
                                  </span>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  ))}
                  {shown.length === 0 && (
                    <li className="rounded-2xl border border-primary/20 bg-primary/5 py-6 text-center text-[12.5px] font-medium text-primary">
                      {t('admin.exam.all_right', '¡Acertó todas en este intento!')}
                    </li>
                  )}
                </ol>
              </>
            )}
          </div>

          {/* Pie */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5 sm:px-6">
            {!row.passed && (
              <button
                onClick={onGrant}
                className="rounded-2xl border border-line px-4 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                {t('admin.exam.grant_short', 'Dar otro intento')}
              </button>
            )}
            <button
              onClick={onExport}
              disabled={exporting || loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-[12.5px] font-semibold text-on-primary shadow-lg shadow-primary/20 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t('admin.exam.x_button_one', 'Excel de esta persona')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

