import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, BookOpen, Check, Crosshair, Globe, GraduationCap, Loader2,
  MessagesSquare, PhoneCall, RotateCcw, Trophy,
} from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { rowText } from '@/lib/contentLang'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { toast } from '@/stores/toastStore'
import {
  getUserCourseStepsAdmin,
  setUserCourseProgressAdmin,
  type AdminCourseSteps,
} from '@/services/notifications.service'

const EASE = [0.16, 1, 0.3, 1] as const
const GREEN = '#10D451'

type StepKind = 'module' | 'call' | 'choice' | 'world' | 'exam'

interface Step {
  key: string
  kind: StepKind
  title: string
  /** Lo que tiene hecho HOY. */
  done: boolean
  /** Número dentro de su etapa (Módulo 3), para la etiqueta del rastro. */
  ordinal: number
}

interface Props {
  userId: string
  userName: string
  courseId: string
  courseTitle: string
  onClose: () => void
  /** Tras guardar: la ficha vuelve a pedir el detalle del curso. */
  onDone: () => void
}

/**
 * «¿Dónde dejamos a esta persona?»
 *
 * El recorrido del curso en el mismo orden que usa el porcentaje (módulos →
 * simulaciones → mundo → examen). Se elige un paso y la persona QUEDA PARADA
 * AHÍ: todo lo anterior hecho, ese paso y lo que sigue por hacer. Antes de
 * guardar se ve el porcentaje de ahora y el que quedará, y qué se marca y qué se
 * borra, porque borrar intentos de verdad no tiene deshacer.
 *
 * Pensado para pruebas: dejar a un aprendiz justo antes del examen, a mitad del
 * temario o con el onboarding terminado, sin tener que recorrerlo a mano.
 */
export function ProgressPositionModal({ userId, userName, courseId, courseTitle, onClose, onDone }: Props) {
  const { t, i18n } = useTranslation()
  const reduce = useReducedMotion()

  const [data, setData] = useState<AdminCourseSteps | 'loading' | 'error'>('loading')
  /** Índice donde queda parada. `steps.length` = curso completo. null = sin elegir. */
  const [stop, setStop] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    getUserCourseStepsAdmin(userId, courseId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData('error'))
    return () => { alive = false }
  }, [userId, courseId])

  const steps = useMemo<Step[]>(() => {
    if (data === 'loading' || data === 'error') return []
    const out: Step[] = []
    data.modules.forEach((m, i) =>
      out.push({ key: `m:${m.id}`, kind: 'module', title: rowText(m), done: m.done, ordinal: i + 1 }))
    data.practice.forEach((p, i) =>
      out.push({ key: `p:${p.slug}`, kind: p.kind, title: rowText(p), done: p.done, ordinal: i + 1 }))
    if (data.world) {
      const w = data.world
      out.push({
        key: `w:${w.id}`, kind: 'world', done: w.done, ordinal: 1,
        title: rowText({ name_es: w.name, name_en: w.name_en, name_pt: w.name_pt }, 'name'),
      })
    }
    if (data.exam) out.push({ key: `e:${data.exam.id}`, kind: 'exam', title: rowText(data.exam), done: data.exam.done, ordinal: 1 })
    return out
  }, [data])

  const total = steps.length
  const nowDone = steps.filter((s) => s.done).length
  const willDone = (i: number) => stop !== null && i < stop
  const changes = useMemo(() => {
    if (stop === null) return { mark: 0, erase: 0 }
    let mark = 0
    let erase = 0
    steps.forEach((s, i) => {
      const next = i < stop
      if (next && !s.done) mark += 1
      if (!next && s.done) erase += 1
    })
    return { mark, erase }
  }, [steps, stop])
  const dirty = changes.mark + changes.erase > 0

  const numbered = (k: StepKind) => k === 'module' || k === 'call' || k === 'choice'
  const stageLabel = (k: StepKind) => t(`admin.users.adjust_stage_${k}`)
  const stopLabel = (i: number) =>
    i >= total
      ? t('admin.users.adjust_complete')
      : `${stageLabel(steps[i].kind)}${numbered(steps[i].kind) ? ` ${steps[i].ordinal}` : ''} · ${steps[i].title}`

  const pick = (i: number) => {
    setStop(i)
    setConfirming(false)
  }

  const save = async () => {
    if (stop === null) return
    if (changes.erase > 0 && !confirming) {
      setConfirming(true)
      return
    }
    setSaving(true)
    try {
      const done = steps.filter((_, i) => i < stop)
      await setUserCourseProgressAdmin(userId, courseId, {
        doneModuleIds: done.filter((s) => s.kind === 'module').map((s) => s.key.slice(2)),
        doneScenarioSlugs: done.filter((s) => s.kind === 'call' || s.kind === 'choice').map((s) => s.key.slice(2)),
        worldDone: done.some((s) => s.kind === 'world'),
        examDone: done.some((s) => s.kind === 'exam'),
        stopLabel: stopLabel(stop),
        doneSteps: stop,
        totalSteps: total,
      })
      toast.success(
        t('admin.users.adjust_saved_title'),
        t('admin.users.adjust_saved_body', { name: userName, where: stopLabel(stop) }),
      )
      onDone()
      onClose()
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? ''
      toast.error(t('admin.users.adjust_error'), msg)
      setSaving(false)
      setConfirming(false)
    }
  }

  const pctNow = total > 0 ? nowDone / total : 0
  const pctNext = stop === null ? pctNow : total > 0 ? stop / total : 0

  // Encabezados de etapa: se pintan al cambiar de clase de paso.
  const groupOf = (k: StepKind) => (k === 'call' || k === 'choice' ? 'practice' : k)

  return (
    <Modal
      onClose={onClose}
      dismissible={!saving}
      z={10000}
      size="lg"
      accent="green"
      icon={<Crosshair className="h-4 w-4" />}
      title={t('admin.users.adjust_title', { name: userName })}
      subtitle={courseTitle}
      footerLeft={
        stop !== null && dirty ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            {changes.mark > 0 && (
              <span className="rounded-full bg-[rgba(16,212,81,0.14)] px-2 py-0.5 font-semibold text-[#0ca23e]">
                {t('admin.users.adjust_mark', { count: changes.mark })}
              </span>
            )}
            {changes.erase > 0 && (
              <span className="rounded-full bg-danger/12 px-2 py-0.5 font-semibold text-danger">
                {t('admin.users.adjust_erase', { count: changes.erase })}
              </span>
            )}
          </span>
        ) : null
      }
      footer={
        <>
          <button
            onClick={onClose}
            disabled={saving}
            className="min-h-[40px] rounded-xl px-4 text-[13px] font-medium text-text-muted transition-colors hover:bg-subtle hover:text-text disabled:opacity-50"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            onClick={save}
            disabled={stop === null || !dirty || saving}
            className={cn(
              'inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40',
              confirming ? 'bg-danger text-white' : 'text-black',
            )}
            style={confirming ? undefined : { background: GREEN }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : confirming ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {confirming ? t('admin.users.adjust_confirm') : t('admin.users.adjust_save')}
          </button>
        </>
      }
    >
      {data === 'loading' ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
        </div>
      ) : data === 'error' ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-[13px] text-text-muted">
          {t('admin.users.adjust_load_error')}
        </div>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-[13px] text-text-muted">
          {t('admin.users.adjust_empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Ahora → Quedará ─────────────────────────────────────────── */}
          <div className="rounded-2xl border border-line bg-subtle/50 p-4">
            <div className="grid grid-cols-2 gap-4">
              <Meter label={t('admin.users.adjust_now')} value={pctNow} caption={t('admin.users.adjust_steps', { done: nowDone, total })} tone="muted" reduce={reduce} />
              <Meter
                label={t('admin.users.adjust_next')}
                value={pctNext}
                caption={stop === null ? t('admin.users.adjust_pick_hint') : t('admin.users.adjust_steps', { done: stop, total })}
                tone={stop === null ? 'muted' : 'green'}
                reduce={reduce}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <QuickChip active={stop === 0} onClick={() => pick(0)} icon={<RotateCcw className="h-3 w-3" />} label={t('admin.users.adjust_from_zero')} />
              <QuickChip active={stop === total} onClick={() => pick(total)} icon={<Trophy className="h-3 w-3" />} label={t('admin.users.adjust_complete')} />
            </div>
          </div>

          {data.last_adjustment && (
            <p className="px-1 text-[11.5px] text-text-subtle">
              {t('admin.users.adjust_last', {
                who: data.last_adjustment.by_name ?? '—',
                date: new Date(data.last_adjustment.at).toLocaleString(i18n.language),
                where: data.last_adjustment.label ?? '—',
              })}
            </p>
          )}

          {/* ── Línea de tiempo ─────────────────────────────────────────── */}
          <div className="relative">
            <span aria-hidden className="absolute bottom-4 left-[17px] top-4 w-px bg-line" />
            {steps.map((s, i) => {
              const header = i === 0 || groupOf(steps[i - 1].kind) !== groupOf(s.kind)
              const preview = stop !== null
              const doneAfter = preview ? willDone(i) : s.done
              const isStop = stop === i
              const changed = preview && doneAfter !== s.done
              return (
                <div key={s.key}>
                  {header && (
                    <p className={cn('relative z-[1] mb-1 flex items-center gap-2 pl-[44px] text-[10.5px] font-bold uppercase tracking-wider text-text-subtle', i === 0 ? 'mt-0' : 'mt-3')}>
                      {t(`admin.users.adjust_group_${groupOf(s.kind)}`)}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => pick(i)}
                    className={cn(
                      'group relative flex w-full items-center gap-3 rounded-xl py-2 pl-1 pr-2 text-left transition-colors',
                      isStop ? 'bg-primary/[0.08]' : 'hover:bg-subtle',
                    )}
                  >
                    <StepDot kind={s.kind} done={doneAfter} isStop={isStop} reduce={reduce} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px]', doneAfter || isStop ? 'text-text' : 'text-text-muted')}>
                        {s.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-text-subtle">
                        {stageLabel(s.kind)}
                        {numbered(s.kind) && ` ${s.ordinal}`}
                        {!preview && s.done && <span className="text-[#0ca23e]">· {t('admin.users.adjust_done_now')}</span>}
                      </span>
                    </span>
                    <AnimatePresence initial={false}>
                      {isStop ? (
                        <motion.span
                          key="stop"
                          initial={reduce ? false : { opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.85 }}
                          className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-on-primary"
                        >
                          {t('admin.users.adjust_here')}
                        </motion.span>
                      ) : changed ? (
                        <motion.span
                          key="chg"
                          initial={reduce ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            doneAfter ? 'bg-[rgba(16,212,81,0.14)] text-[#0ca23e]' : 'bg-danger/12 text-danger',
                          )}
                        >
                          {doneAfter ? t('admin.users.adjust_tag_mark') : t('admin.users.adjust_tag_erase')}
                        </motion.span>
                      ) : (
                        <span className="shrink-0 text-[10.5px] font-medium text-text-subtle opacity-0 transition-opacity group-hover:opacity-100">
                          {t('admin.users.adjust_leave_here')}
                        </span>
                      )}
                    </AnimatePresence>
                  </button>
                </div>
              )
            })}

            {/* Meta: curso completo */}
            <button
              type="button"
              onClick={() => pick(total)}
              className={cn(
                'group relative mt-2 flex w-full items-center gap-3 rounded-xl py-2 pl-1 pr-2 text-left transition-colors',
                stop === total ? 'bg-primary/[0.08]' : 'hover:bg-subtle',
              )}
            >
              <span
                className={cn(
                  'relative z-[1] flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  stop === total ? 'border-transparent text-black' : 'border-line bg-surface text-text-subtle',
                )}
                style={stop === total ? { background: GREEN } : undefined}
              >
                <Trophy className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] font-medium text-text">{t('admin.users.adjust_complete')}</span>
              {stop === total ? (
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-on-primary">
                  {t('admin.users.adjust_here')}
                </span>
              ) : (
                <span className="shrink-0 text-[10.5px] font-medium text-text-subtle opacity-0 transition-opacity group-hover:opacity-100">
                  {t('admin.users.adjust_leave_here')}
                </span>
              )}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {confirming && (
              <motion.div
                initial={reduce ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/[0.06] px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <p className="text-[12px] leading-relaxed text-text-muted">
                    <b className="text-text">{t('admin.users.adjust_warn_title', { count: changes.erase })}</b>
                    <br />
                    {t('admin.users.adjust_warn_body')}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="px-1 text-[11px] leading-relaxed text-text-subtle">{t('admin.users.adjust_footnote')}</p>
        </div>
      )}
    </Modal>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function StepDot({ kind, done, isStop, reduce }: { kind: StepKind; done: boolean; isStop: boolean; reduce: boolean }) {
  const Icon =
    kind === 'module' ? BookOpen
      : kind === 'call' ? PhoneCall
        : kind === 'choice' ? MessagesSquare
          : kind === 'world' ? Globe
            : GraduationCap
  return (
    <span className="relative z-[1] flex h-[34px] w-[34px] shrink-0 items-center justify-center">
      {isStop && !reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/30"
          animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <motion.span
        className={cn(
          'relative flex h-[34px] w-[34px] items-center justify-center rounded-full border-2',
          done ? 'border-transparent text-black' : isStop ? 'border-primary bg-surface text-primary' : 'border-line bg-surface text-text-subtle',
        )}
        animate={{ backgroundColor: done ? GREEN : 'rgb(var(--surface))' }}
        transition={{ duration: reduce ? 0 : 0.25 }}
      >
        {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-3.5 w-3.5" />}
      </motion.span>
    </span>
  )
}

function Meter({ label, value, caption, tone, reduce }: {
  label: string; value: number; caption: string; tone: 'muted' | 'green'; reduce: boolean
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-text-subtle">{label}</span>
        <span className={cn('text-[20px] font-bold tabular-nums', tone === 'green' ? 'text-text' : 'text-text-muted')}>{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/60">
        <motion.div
          className="h-full rounded-full"
          style={{ background: tone === 'green' ? GREEN : 'rgb(var(--text-subtle))' }}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
        />
      </div>
      <p className="mt-1 truncate text-[11px] text-text-muted">{caption}</p>
    </div>
  )
}

function QuickChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        active ? 'border-primary bg-primary/10 text-primary' : 'border-line text-text-muted hover:border-text-subtle hover:text-text',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
