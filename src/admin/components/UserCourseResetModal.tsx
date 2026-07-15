import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Loader2, BarChart3, RotateCcw, Award, CheckCircle2,
  ChevronRight, ChevronDown, Globe, PhoneCall, BookOpen, ListChecks,
} from 'lucide-react'
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
import {
  getUserCourseDetailAdmin,
  resetUserModuleAdmin,
  resetUserSectionAdmin,
  resetUserWorldAdmin,
  resetUserSimulatorAdmin,
  type AdminCourseDetail,
} from '@/services/notifications.service'

interface UserCourseResetModalProps {
  /** Persona cuyos cursos ve/restablece el superadmin. */
  user: { id: string; display_name: string | null }
  onClose: () => void
}

/**
 * Vista superadmin de los cursos de una persona con su desempeño, y controles para
 * restablecer TODO el curso o partes concretas (módulo, sección/actividad, mundo,
 * simulador). Cada reset borra en BD y notifica al aprendiz para que su caché local
 * se limpie (deja de verse 100%). Los datos vienen de RPCs SECURITY DEFINER.
 */
export function UserCourseResetModal({ user, onClose }: UserCourseResetModalProps) {
  const { t, i18n } = useTranslation()
  const confirm = useConfirm()
  const [loading, setLoading] = useState(true)
  const [courses, setCourses] = useState<AdminUserCourse[]>([])
  const [resettingKey, setResettingKey] = useState<string | null>(null)

  // Curso expandido + su detalle (módulos/secciones/mundo/simulador) y módulos abiertos.
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, AdminCourseDetail | 'loading'>>({})
  const [openModules, setOpenModules] = useState<Set<string>>(new Set())

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

  const loadDetail = async (courseId: string) => {
    setDetail((d) => ({ ...d, [courseId]: 'loading' }))
    try {
      const dt = await getUserCourseDetailAdmin(user.id, courseId)
      setDetail((d) => ({ ...d, [courseId]: dt }))
    } catch {
      toast.error(t('admin.users.reset_error'))
      setDetail((d) => {
        const next = { ...d }
        delete next[courseId]
        return next
      })
    }
  }

  const toggleExpand = (courseId: string) => {
    if (expanded === courseId) {
      setExpanded(null)
      return
    }
    setExpanded(courseId)
    if (!detail[courseId]) void loadDetail(courseId)
  }

  const toggleModule = (moduleId: string) =>
    setOpenModules((s) => {
      const next = new Set(s)
      next.has(moduleId) ? next.delete(moduleId) : next.add(moduleId)
      return next
    })

  // Tras un reset granular, recargamos el detalle del curso y su resumen (badge).
  const afterGranularReset = async (courseId: string) => {
    await loadDetail(courseId)
    getUserCoursesAdmin(user.id).then(setCourses).catch(() => {})
  }

  const handleResetCourse = async (course: AdminUserCourse) => {
    const ok = await confirm({
      title: t('admin.users.reset_title'),
      description: t('admin.users.reset_desc', {
        name: user.display_name || user.id.slice(0, 8),
        course: course.title_es,
      }),
      confirmLabel: t('admin.users.reset_course'),
    })
    if (!ok) return
    setResettingKey(`course:${course.course_id}`)
    try {
      await resetUserCourseAdmin(user.id, course.course_id)
      setCourses((prev) =>
        prev.map((c) =>
          c.course_id === course.course_id ? { ...c, score: null, completed_at: null, certified: false } : c,
        ),
      )
      if (detail[course.course_id]) void loadDetail(course.course_id)
      toast.success(t('admin.users.reset_ok'))
    } catch {
      toast.error(t('admin.users.reset_error'))
    } finally {
      setResettingKey(null)
    }
  }

  // Reset genérico para alcances granulares (módulo/sección/mundo/simulador).
  const runGranular = async (
    key: string,
    courseId: string,
    fn: () => Promise<void>,
    confirmText: string,
  ) => {
    const ok = await confirm({
      title: t('admin.users.reset_part_title'),
      description: confirmText,
      confirmLabel: t('admin.users.reset_action'),
    })
    if (!ok) return
    setResettingKey(key)
    try {
      await fn()
      await afterGranularReset(courseId)
      toast.success(t('admin.users.reset_ok'))
    } catch {
      toast.error(t('admin.users.reset_error'))
    } finally {
      setResettingKey(null)
    }
  }

  const busy = resettingKey !== null

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
                    const hasActivity = c.score != null || completed != null || c.certified
                    const prev = courses[i - 1]
                    const showCatalogHeader = !c.is_assigned && (i === 0 || prev?.is_assigned)
                    const isOpen = expanded === c.course_id
                    const dt = detail[c.course_id]
                    return (
                    <div key={`wrap-${c.course_id}`}>
                    {showCatalogHeader && (
                      <div className="pt-2 pb-1 text-[11px] uppercase tracking-wider text-text-subtle">
                        {t('admin.users.catalog_courses')}
                      </div>
                    )}
                      <GlassCard key={c.course_id} intensity="subtle" rounded="2xl" padding="none">
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Expandir para ver partes del curso */}
                          <button
                            onClick={() => toggleExpand(c.course_id)}
                            className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-subtle"
                            aria-label={t('admin.users.reset_expand')}
                            aria-expanded={isOpen}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
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
                              ) : !c.certified ? (
                                <span>{t('admin.users.no_activity')}</span>
                              ) : null}
                              {completed && (
                                <span>
                                  {t('admin.users.col_completed')}: {completed}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleResetCourse(c)}
                            disabled={busy || !hasActivity}
                            className={cn(
                              'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors border min-h-[40px]',
                              hasActivity && !busy
                                ? 'border-danger/30 text-danger hover:bg-danger/10'
                                : 'border-line text-text-subtle cursor-not-allowed',
                            )}
                            title={t('admin.users.reset_course')}
                          >
                            {resettingKey === `course:${c.course_id}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            {t('admin.users.reset_course')}
                          </button>
                        </div>

                        {/* Detalle expandido: partes del curso */}
                        {isOpen && (
                          <div className="border-t border-line px-4 py-3 space-y-2">
                            {dt === 'loading' || !dt ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
                              </div>
                            ) : (
                              <>
                                {/* Mundo + Simulador */}
                                {(dt.has_world || dt.has_sim) && (
                                  <div className="flex flex-wrap gap-2">
                                    {dt.has_world && (
                                      <PartButton
                                        icon={<Globe className="h-3.5 w-3.5" />}
                                        label={t('admin.users.reset_world')}
                                        disabled={busy || !dt.world_done}
                                        loading={resettingKey === `world:${c.course_id}`}
                                        onClick={() =>
                                          runGranular(
                                            `world:${c.course_id}`,
                                            c.course_id,
                                            () => resetUserWorldAdmin(user.id, c.course_id),
                                            t('admin.users.reset_world_confirm', { course: c.title_es }),
                                          )
                                        }
                                      />
                                    )}
                                    {dt.has_sim && (
                                      <PartButton
                                        icon={<PhoneCall className="h-3.5 w-3.5" />}
                                        label={t('admin.users.reset_simulator')}
                                        disabled={busy || !dt.sim_done}
                                        loading={resettingKey === `sim:${c.course_id}`}
                                        onClick={() =>
                                          runGranular(
                                            `sim:${c.course_id}`,
                                            c.course_id,
                                            () => resetUserSimulatorAdmin(user.id, c.course_id),
                                            t('admin.users.reset_simulator_confirm', { course: c.title_es }),
                                          )
                                        }
                                      />
                                    )}
                                  </div>
                                )}

                                {/* Módulos y sus secciones */}
                                {dt.modules.length === 0 ? (
                                  <p className="text-[12px] text-text-muted py-1">{t('admin.users.reset_no_modules')}</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {dt.modules.map((m) => {
                                      const mOpen = openModules.has(m.id)
                                      return (
                                        <div key={m.id} className="rounded-xl border border-line">
                                          <div className="flex items-center gap-2 px-3 py-2">
                                            <button
                                              onClick={() => toggleModule(m.id)}
                                              className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-text"
                                              aria-expanded={mOpen}
                                            >
                                              {mOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                            </button>
                                            <BookOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                                            <span className="flex-1 min-w-0 truncate text-[12px] text-text">
                                              {m.title_es}
                                              {m.completed && (
                                                <span className="ml-1.5 text-[10px] text-green-500">✓</span>
                                              )}
                                            </span>
                                            <PartButton
                                              compact
                                              icon={<RotateCcw className="h-3 w-3" />}
                                              label={t('admin.users.reset_module')}
                                              disabled={busy}
                                              loading={resettingKey === `module:${m.id}`}
                                              onClick={() =>
                                                runGranular(
                                                  `module:${m.id}`,
                                                  c.course_id,
                                                  () => resetUserModuleAdmin(user.id, m.id),
                                                  t('admin.users.reset_module_confirm', { module: m.title_es }),
                                                )
                                              }
                                            />
                                          </div>
                                          {mOpen && (
                                            <div className="border-t border-line px-3 py-2 space-y-1">
                                              {m.sections.length === 0 ? (
                                                <p className="text-[11px] text-text-subtle">{t('admin.users.reset_no_sections')}</p>
                                              ) : (
                                                m.sections.map((sec) => (
                                                  <div key={sec.id} className="flex items-center gap-2 pl-1">
                                                    <ListChecks className="h-3 w-3 shrink-0 text-text-subtle" />
                                                    <span className="flex-1 min-w-0 truncate text-[11px] text-text-muted">
                                                      {sec.heading_es}
                                                      {sec.has_attempt && (
                                                        <span className="ml-1.5 text-[10px] text-amber-500">●</span>
                                                      )}
                                                    </span>
                                                    <PartButton
                                                      compact
                                                      icon={<RotateCcw className="h-3 w-3" />}
                                                      label={t('admin.users.reset_activity')}
                                                      disabled={busy || !sec.has_attempt}
                                                      loading={resettingKey === `section:${sec.id}`}
                                                      onClick={() =>
                                                        runGranular(
                                                          `section:${sec.id}`,
                                                          c.course_id,
                                                          () => resetUserSectionAdmin(user.id, sec.id),
                                                          t('admin.users.reset_activity_confirm', { section: sec.heading_es }),
                                                        )
                                                      }
                                                    />
                                                  </div>
                                                ))
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
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

/** Botón compacto de reset para una parte del curso. */
function PartButton({
  icon, label, onClick, disabled, loading, compact,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  compact?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'shrink-0 inline-flex items-center gap-1 rounded-lg border font-medium transition-colors',
        compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-[12px]',
        disabled
          ? 'border-line text-text-subtle cursor-not-allowed'
          : 'border-danger/30 text-danger hover:bg-danger/10',
      )}
      title={label}
    >
      {loading ? <Loader2 className={cn('animate-spin', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} /> : icon}
      {label}
    </button>
  )
}
