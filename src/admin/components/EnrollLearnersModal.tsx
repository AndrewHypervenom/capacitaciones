import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Save, Loader2, Search, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import {
  getCampaignLearners,
  getCourseAssignments,
  setCourseAssignment,
  removeCourseAssignment,
  getCourseStats,
  type CourseAssignmentRow,
  type CourseStats,
} from '@/services/courses.service'

interface Learner {
  id: string
  display_name: string | null
  campaign_id: string | null
}

interface EnrollLearnersModalProps {
  /** Curso (típicamente compartido por otra campaña) en el que se inscribe. */
  course: { id: string; title_es: string }
  /** Campaña del capacitador: solo puede inscribir a SUS aprendices. */
  campaignId: string
  onClose: () => void
  /** Se llama tras guardar con éxito. */
  onSaved?: () => void
}

/**
 * Inscripción de aprendices en un curso fijo (matrícula viva). Es el transpuesto
 * de UserCoursesModal: curso fijo → escoge personas. Escribe `course_assignments`
 * (RLS valida campaña propia + curso propio/compartido). Patrón borrador→guardar.
 */
export function EnrollLearnersModal({ course, campaignId, onClose, onSaved }: EnrollLearnersModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [learners, setLearners] = useState<Learner[]>([])
  const [assignments, setAssignments] = useState<CourseAssignmentRow[]>([])
  // Borrador local: userId → is_mandatory. Presencia = inscrito.
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [stats, setStats] = useState<CourseStats | null>(null)

  const loadStats = () =>
    getCourseStats(course.id)
      .then(setStats)
      .catch(() => setStats(null))

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([getCampaignLearners(campaignId), getCourseAssignments(course.id)])
      .then(([ls, as]) => {
        if (!alive) return
        setLearners(ls)
        // Solo nos importan las asignaciones de MIS aprendices (RLS ya acota, pero filtramos por si acaso).
        const myIds = new Set(ls.map((l) => l.id))
        const mine = as.filter((a) => myIds.has(a.user_id))
        setAssignments(mine)
        setDraft(Object.fromEntries(mine.map((r) => [r.user_id, r.is_mandatory])))
      })
      .catch(() => toast.error(t('admin.courses.error_save')))
      .finally(() => alive && setLoading(false))
    void loadStats()
    return () => {
      alive = false
    }
  }, [course.id, campaignId, t]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return learners
    return learners.filter((l) => (l.display_name ?? '').toLowerCase().includes(q))
  }, [learners, search])

  const dirty = useMemo(() => {
    const base = new Map(assignments.map((a) => [a.user_id, a.is_mandatory]))
    if (base.size !== Object.keys(draft).length) return true
    return !Object.entries(draft).every(([id, m]) => base.has(id) && base.get(id) === m)
  }, [assignments, draft])

  const toggle = (userId: string) =>
    setDraft((prev) => {
      const next = { ...prev }
      if (userId in next) delete next[userId]
      else next[userId] = false
      return next
    })

  const setMandatory = (userId: string, isMandatory: boolean) =>
    setDraft((prev) => ({ ...prev, [userId]: isMandatory }))

  const selectAll = () => setDraft(Object.fromEntries(filtered.map((l) => [l.id, draft[l.id] ?? false])))

  const save = async () => {
    setSaving(true)
    try {
      const base = new Map(assignments.map((a) => [a.user_id, a.is_mandatory]))
      const ids = new Set([...base.keys(), ...Object.keys(draft)])
      for (const id of ids) {
        const inDraft = id in draft
        if (!inDraft && base.has(id)) {
          await removeCourseAssignment(course.id, id)
        } else if (inDraft && (!base.has(id) || base.get(id) !== draft[id])) {
          await setCourseAssignment(course.id, id, draft[id])
        }
      }
      const fresh = (await getCourseAssignments(course.id)).filter((a) =>
        learners.some((l) => l.id === a.user_id),
      )
      setAssignments(fresh)
      setDraft(Object.fromEntries(fresh.map((r) => [r.user_id, r.is_mandatory])))
      void loadStats()
      toast.success(t('admin.courses.enroll_saved_ok'))
      onSaved?.()
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-lg"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <Users className="h-4 w-4 text-text-muted" />
                  {t('admin.courses.enroll_learners')}
                </h3>
                <p className="text-[12px] text-text-muted mt-0.5 truncate">{course.title_es}</p>
              </div>
              <button
                onClick={onClose}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 text-text-subtle animate-spin" />
                </div>
              ) : learners.length === 0 ? (
                <p className="text-[13px] text-text-muted py-8 text-center">
                  {t('admin.courses.enroll_no_learners')}
                </p>
              ) : (
                <>
                  {stats && stats.enrolled > 0 && (
                    <div className="mb-3 grid grid-cols-3 gap-2">
                      {[
                        { id: 'enrolled', label: t('admin.courses.stats_enrolled'), value: stats.enrolled },
                        { id: 'completed', label: t('admin.courses.stats_completed'), value: `${stats.completion_pct}%` },
                        { id: 'avg', label: t('admin.courses.stats_avg_progress'), value: `${stats.avg_progress_pct}%` },
                      ].map((s) => (
                        <div key={s.id} className="rounded-xl border border-line px-3 py-2">
                          <div className="text-[16px] font-bold tabular-nums text-text leading-none">{s.value}</div>
                          <div className="text-[10px] text-text-muted mt-1">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('admin.courses.search_users_ph')}
                        className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-[14px] text-text outline-none focus:border-primary"
                      />
                    </div>
                    <Button variant="ghost" size="sm" onClick={selectAll} className="shrink-0">
                      {t('admin.courses.select_all')}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {filtered.map((l) => {
                      const isEnrolled = l.id in draft
                      const isMandatory = draft[l.id]
                      return (
                        <GlassCard key={l.id} intensity="subtle" rounded="2xl" padding="none">
                          <div className="flex items-center gap-3 px-4 py-2.5">
                            <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isEnrolled}
                                onChange={() => toggle(l.id)}
                                className="h-4 w-4 accent-[rgb(var(--primary))]"
                              />
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold uppercase text-primary">
                                {(l.display_name || '?').charAt(0)}
                              </span>
                              <span className="block text-[13px] text-text truncate min-w-0">
                                {l.display_name || l.id.slice(0, 8)}
                              </span>
                            </label>
                            {isEnrolled && (
                              <button
                                onClick={() => setMandatory(l.id, !isMandatory)}
                                className={cn(
                                  'shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors border',
                                  isMandatory
                                    ? 'bg-danger/10 border-danger/30 text-danger'
                                    : 'border-line text-text-muted hover:text-text',
                                )}
                              >
                                {isMandatory ? t('admin.courses.mandatory') : t('admin.courses.optional')}
                              </button>
                            )}
                          </div>
                        </GlassCard>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line">
              <span className="text-[12px] text-text-muted">
                {Object.keys(draft).length > 0
                  ? t('admin.courses.enrolled_count', { n: Object.keys(draft).length })
                  : ' '}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  {t('confirm.cancel')}
                </Button>
                <Button
                  variant="neon"
                  size="sm"
                  onClick={save}
                  disabled={saving || !dirty}
                  className="flex items-center gap-1.5"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saving ? t('admin.courses.saving') : t('admin.courses.save_enrollment')}
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
