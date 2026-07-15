import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Save, Loader2, Search, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import {
  getCoursesForCampaign,
  getUserCourseAssignments,
  setCourseAssignment,
  removeCourseAssignment,
  type CourseWithModules,
  type CourseAssignmentRow,
} from '@/services/courses.service'

interface UserCoursesModalProps {
  /** Persona a la que se le asignan cursos. */
  user: { id: string; display_name: string | null; campaign_id: string | null }
  onClose: () => void
}

/**
 * Asignación de cursos centrada en la persona: curso fijo → tabla `course_assignments`.
 * Es el "transpuesto" de la pestaña Asignar del editor de curso; ambos escriben la
 * misma tabla, así que el aprendiz ve el resultado sin cambios. Patrón borrador→guardar.
 */
export function UserCoursesModal({ user, onClose }: UserCoursesModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [courses, setCourses] = useState<CourseWithModules[]>([])
  const [assignments, setAssignments] = useState<CourseAssignmentRow[]>([])
  // Borrador local: courseId → is_mandatory. Presencia = asignado.
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      user.campaign_id ? getCoursesForCampaign(user.campaign_id) : Promise.resolve([]),
      getUserCourseAssignments(user.id),
    ])
      .then(([cs, as]) => {
        if (!alive) return
        setCourses(cs)
        setAssignments(as)
        setDraft(Object.fromEntries(as.map((r) => [r.course_id, r.is_mandatory])))
      })
      .catch(() => toast.error(t('admin.courses.error_save')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [user.id, user.campaign_id, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return courses
    return courses.filter((c) => (c.title_es ?? '').toLowerCase().includes(q))
  }, [courses, search])

  const dirty = useMemo(() => {
    const base = new Map(assignments.map((a) => [a.course_id, a.is_mandatory]))
    if (base.size !== Object.keys(draft).length) return true
    return !Object.entries(draft).every(([id, m]) => base.has(id) && base.get(id) === m)
  }, [assignments, draft])

  const toggle = (courseId: string) =>
    setDraft((prev) => {
      const next = { ...prev }
      if (courseId in next) delete next[courseId]
      else next[courseId] = false
      return next
    })

  const setMandatory = (courseId: string, isMandatory: boolean) =>
    setDraft((prev) => ({ ...prev, [courseId]: isMandatory }))

  const save = async () => {
    setSaving(true)
    try {
      const base = new Map(assignments.map((a) => [a.course_id, a.is_mandatory]))
      const ids = new Set([...base.keys(), ...Object.keys(draft)])
      for (const id of ids) {
        const inDraft = id in draft
        if (!inDraft && base.has(id)) {
          await removeCourseAssignment(id, user.id)
        } else if (inDraft && (!base.has(id) || base.get(id) !== draft[id])) {
          await setCourseAssignment(id, user.id, draft[id])
        }
      }
      const fresh = await getUserCourseAssignments(user.id)
      setAssignments(fresh)
      setDraft(Object.fromEntries(fresh.map((r) => [r.course_id, r.is_mandatory])))
      toast.success(t('admin.courses.assign_saved_ok'))
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
                  <BookOpen className="h-4 w-4 text-text-muted" />
                  {t('admin.users.assign_courses')}
                </h3>
                <p className="text-[12px] text-text-muted mt-0.5 truncate">
                  {user.display_name || user.id.slice(0, 8)}
                </p>
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
              {!user.campaign_id ? (
                <p className="text-[13px] text-text-muted py-8 text-center">
                  {t('admin.users.assign_no_campaign')}
                </p>
              ) : loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 text-text-subtle animate-spin" />
                </div>
              ) : courses.length === 0 ? (
                <p className="text-[13px] text-text-muted py-8 text-center">
                  {t('admin.users.assign_no_courses')}
                </p>
              ) : (
                <>
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('admin.users.search_courses_ph')}
                      className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-[14px] text-text outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    {filtered.map((c) => {
                      const isAssigned = c.id in draft
                      const isMandatory = draft[c.id]
                      return (
                        <GlassCard key={c.id} intensity="subtle" rounded="2xl" padding="none">
                          <div className="flex items-center gap-3 px-4 py-2.5">
                            <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isAssigned}
                                onChange={() => toggle(c.id)}
                                className="h-4 w-4 accent-[rgb(var(--primary))]"
                              />
                              <span className="min-w-0">
                                <span className="block text-[13px] text-text truncate">
                                  {c.title_es}
                                </span>
                                {!c.is_published && (
                                  <span className="block text-[11px] text-text-subtle">
                                    {t('admin.users.course_draft')}
                                  </span>
                                )}
                              </span>
                            </label>
                            {isAssigned && (
                              <button
                                onClick={() => setMandatory(c.id, !isMandatory)}
                                className={cn(
                                  'shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors border',
                                  isMandatory
                                    ? 'bg-danger/10 border-danger/30 text-danger'
                                    : 'border-line text-text-muted hover:text-text',
                                )}
                              >
                                {isMandatory
                                  ? t('admin.courses.mandatory')
                                  : t('admin.courses.optional')}
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
                {dirty ? t('admin.courses.unsaved_changes') : ' '}
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
                  {saving ? t('admin.courses.saving') : t('admin.courses.save_assignments')}
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
