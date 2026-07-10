import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Loader2, BarChart3, RotateCcw, Award, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '@/components/ui/GlassCard'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import {
  getUserCoursesAdmin,
  resetUserCourseAdmin,
  type AdminUserCourse,
} from '@/services/courses.service'

interface UserCourseResetModalProps {
  /** Persona cuyos cursos ve/restablece el superadmin. */
  user: { id: string; display_name: string | null }
  onClose: () => void
}

/**
 * Vista superadmin de los cursos de una persona con su desempeño y fecha de
 * finalización, y un botón para restablecer cada curso (borra su progreso para
 * que lo haga de nuevo). Los datos vienen de RPCs SECURITY DEFINER porque la RLS
 * no deja leer/escribir el `user_progress` de otra persona desde el cliente.
 */
export function UserCourseResetModal({ user, onClose }: UserCourseResetModalProps) {
  const { t, i18n } = useTranslation()
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [courses, setCourses] = useState<AdminUserCourse[]>([])
  const [resettingId, setResettingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getUserCoursesAdmin(user.id)
      .then((cs) => alive && setCourses(cs))
      .catch(() => toast.error(t('admin.users.reset_error')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [user.id, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : null

  const handleReset = async (course: AdminUserCourse) => {
    const ok = await confirm({
      title: t('admin.users.reset_title'),
      description: t('admin.users.reset_desc', {
        name: user.display_name || user.id.slice(0, 8),
        course: course.title_es,
      }),
      confirmLabel: t('admin.users.reset_course'),
    })
    if (!ok) return
    setResettingId(course.course_id)
    try {
      await resetUserCourseAdmin(user.id, course.course_id)
      // Reflejamos el reset en la UI sin recargar todo.
      setCourses((prev) =>
        prev.map((c) =>
          c.course_id === course.course_id
            ? { ...c, score: null, completed_at: null, certified: false }
            : c,
        ),
      )
      toast.success(t('admin.users.reset_ok'))
    } catch {
      toast.error(t('admin.users.reset_error'))
    } finally {
      setResettingId(null)
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
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
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
                  <BarChart3 className="h-4 w-4 text-text-muted" />
                  {t('admin.users.courses_progress')}
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
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 text-text-subtle animate-spin" />
                </div>
              ) : courses.length === 0 ? (
                <p className="text-[13px] text-text-muted py-8 text-center">
                  {t('admin.users.no_courses_assigned')}
                </p>
              ) : (
                <div className="space-y-2">
                  {courses.map((c, i) => {
                    const completed = fmtDate(c.completed_at)
                    const hasActivity = c.score != null || completed != null
                    // Separador visual entre cursos asignados y el resto del catálogo.
                    const prev = courses[i - 1]
                    const showCatalogHeader = !c.is_assigned && (i === 0 || prev?.is_assigned)
                    return (
                    <div key={`wrap-${c.course_id}`}>
                    {showCatalogHeader && (
                      <div className="pt-2 pb-1 text-[11px] uppercase tracking-wider text-text-subtle">
                        {t('admin.users.catalog_courses')}
                      </div>
                    )}
                      <GlassCard key={c.course_id} intensity="subtle" rounded="2xl" padding="none">
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[13px] font-medium text-text truncate">
                                {c.title_es}
                              </span>
                              {c.is_assigned && (
                                <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[rgba(34,197,94,0.15)] text-[#16a34a]">
                                  {c.is_mandatory ? t('admin.users.mandatory_badge') : t('admin.users.assigned_badge')}
                                </span>
                              )}
                              {c.certified && (
                                <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[rgba(245,158,11,0.15)] text-[#d97706]">
                                  <Award className="h-3 w-3" />
                                  {t('admin.users.certified_badge')}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                              {c.score != null ? (
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                                  {t('admin.users.col_score')}: <b className="text-text">{c.score}%</b>
                                </span>
                              ) : (
                                <span>{t('admin.users.no_activity')}</span>
                              )}
                              {completed && (
                                <span>
                                  {t('admin.users.col_completed')}: {completed}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleReset(c)}
                            disabled={resettingId === c.course_id || !hasActivity}
                            className={cn(
                              'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors border min-h-[40px]',
                              hasActivity
                                ? 'border-danger/30 text-danger hover:bg-danger/10'
                                : 'border-line text-text-subtle cursor-not-allowed',
                            )}
                            title={t('admin.users.reset_course')}
                          >
                            {resettingId === c.course_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            {t('admin.users.reset_course')}
                          </button>
                        </div>
                      </GlassCard>
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
