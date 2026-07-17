import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  FolderOpen,
  Layers,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { cloneModule, type DbModuleRow } from '@/services/modules.service'
import { addModuleToCourse, getCourseTitlesForCampaign } from '@/services/courses.service'
import { NeonBadge } from '@/components/ui/NeonBadge'

type Filter = 'all' | 'free' | 'used'

interface ModuleLibraryModalProps {
  campaignId: string
  courseId: string
  courseTitle: string
  /** Módulos de la campaña, ya cargados por el editor del curso. */
  modules: DbModuleRow[]
  /** Orden más alto usado en el curso, para encolar los nuevos al final. */
  maxSortOrder: number
  onClose: () => void
  /** Recarga el curso tras mover/copiar. */
  onChanged: () => void | Promise<void>
}

/**
 * Biblioteca de módulos de la campaña para poblar un curso.
 *
 * El punto clave del diseño: `modules.course_id` es una FK directa, así que un
 * módulo vive en UN solo curso. Antes esto se traducía en un picker que solo
 * mostraba módulos huérfanos — los ya usados eran invisibles y no había forma de
 * reutilizarlos. Aquí se muestran TODOS y el que ya está en otro curso se COPIA
 * (deep-copy independiente), que es la única semántica que el esquema permite.
 */
export function ModuleLibraryModal({
  campaignId,
  courseId,
  courseTitle,
  modules,
  maxSortOrder,
  onClose,
  onChanged,
}: ModuleLibraryModalProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [courseTitles, setCourseTitles] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [justDone, setJustDone] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busyId && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busyId])

  useEffect(() => {
    getCourseTitlesForCampaign(campaignId)
      .then(setCourseTitles)
      .catch(() => setCourseTitles({}))
  }, [campaignId])

  const counts = useMemo(() => {
    let free = 0
    let used = 0
    for (const m of modules) {
      if (m.course_id === courseId) continue
      if (m.course_id) used++
      else free++
    }
    return { free, used, all: free + used }
  }, [modules, courseId])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return modules
      .filter((m) => {
        if (m.course_id === courseId) return false
        if (filter === 'free' && m.course_id) return false
        if (filter === 'used' && !m.course_id) return false
        if (q && !(m.title_es ?? '').toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => {
        // Los libres primero: son los que no obligan a duplicar contenido.
        if (!a.course_id !== !b.course_id) return a.course_id ? 1 : -1
        return (a.title_es ?? '').localeCompare(b.title_es ?? '')
      })
  }, [modules, courseId, filter, search])

  const finish = async (id: string) => {
    setJustDone(id)
    await onChanged()
    setTimeout(() => setJustDone(null), 1200)
  }

  const handleMove = async (mod: DbModuleRow) => {
    setBusyId(mod.id)
    try {
      await addModuleToCourse(courseId, mod.id, maxSortOrder + 1)
      toast.success(t('admin.courses.library.moved', { title: mod.title_es }))
      await finish(mod.id)
    } catch (e) {
      console.error('[ModuleLibrary] move', e)
      toast.error(t('admin.courses.error_save'))
    } finally {
      setBusyId(null)
    }
  }

  const handleCopy = async (mod: DbModuleRow) => {
    setBusyId(mod.id)
    setProgress({ done: 0, total: mod.module_sections?.length ?? 0 })
    try {
      await cloneModule(mod.id, {
        targetCourseId: courseId,
        courseSortOrder: maxSortOrder + 1,
        titleSuffix: t('admin.courses.library.copy_suffix'),
        onProgress: (done, total) => setProgress({ done, total }),
      })
      toast.success(t('admin.courses.library.copied', { title: mod.title_es }))
      await finish(mod.id)
    } catch (e) {
      console.error('[ModuleLibrary] copy', e)
      toast.error(t('admin.courses.library.copy_error'))
    } finally {
      setBusyId(null)
      setProgress(null)
    }
  }

  const filterTabs: Array<{ key: Filter; label: string; n: number }> = [
    { key: 'all', label: t('admin.courses.library.filter_all'), n: counts.all },
    { key: 'free', label: t('admin.courses.library.filter_free'), n: counts.free },
    { key: 'used', label: t('admin.courses.library.filter_used'), n: counts.used },
  ]

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={t('admin.courses.library.title')}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          {...backdropDismiss(() => !busyId && onClose())}
        />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-2xl"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* ── Header ── */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <Layers className="h-4 w-4 text-text-muted" />
                  {t('admin.courses.library.title')}
                </h3>
                <p className="mt-0.5 truncate text-[12px] text-text-muted">
                  {t('admin.courses.library.subtitle', { course: courseTitle })}
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={!!busyId}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text disabled:opacity-30"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Buscador + filtros ── */}
            <div className="space-y-3 border-b border-line px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('admin.courses.library.search_placeholder')}
                  className="h-11 w-full rounded-xl border border-line bg-bg pl-9 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-subtle focus:border-brand-green/50"
                />
              </div>
              <div className="flex gap-1.5">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setFilter(tab.key)}
                    className={cn(
                      'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                      filter === tab.key ? 'text-text' : 'text-text-muted hover:text-text',
                    )}
                  >
                    {filter === tab.key && (
                      <motion.span
                        layoutId="library-filter-pill"
                        className="absolute inset-0 rounded-lg border border-brand-green/30 bg-brand-green/10"
                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                      />
                    )}
                    <span className="relative">{tab.label}</span>
                    <span className="relative text-[11px] text-text-subtle">{tab.n}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Lista ── */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {rows.length === 0 ? (
                <div className="py-10 text-center">
                  <FolderOpen className="mx-auto mb-2 h-8 w-8 text-text-subtle" />
                  <p className="text-[13px] text-text-muted">
                    {search.trim()
                      ? t('admin.courses.library.empty_search')
                      : t('admin.courses.library.empty')}
                  </p>
                </div>
              ) : (
                <motion.ul layout className="space-y-2">
                  <AnimatePresence initial={false} mode="popLayout">
                    {rows.map((mod, i) => {
                      const inOtherCourse = !!mod.course_id
                      const isBusy = busyId === mod.id
                      const isDone = justDone === mod.id
                      const disabled = !!busyId && !isBusy
                      const sections = mod.module_sections?.length ?? 0

                      return (
                        <motion.li
                          key={mod.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: disabled ? 0.45 : 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                          transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.2 }}
                          className={cn(
                            'group relative rounded-2xl border bg-glass/[0.03] transition-colors',
                            isDone
                              ? 'border-brand-green/60'
                              : 'border-line hover:border-brand-green/40 hover:bg-glass/[0.06]',
                          )}
                        >
                          {/* Borde animado mientras se clona: el deep-copy puede tardar
                              en módulos largos y el foco debe quedarse en la fila. */}
                          {isBusy && <span className="module-lib-border" aria-hidden />}

                          <div className="relative flex items-center gap-3 px-4 py-3">
                            <div
                              className={cn(
                                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors',
                                isDone
                                  ? 'border-brand-green/40 bg-brand-green/15 text-brand-green'
                                  : 'border-line bg-glass/[0.06] text-text-subtle',
                              )}
                            >
                              <AnimatePresence mode="wait" initial={false}>
                                {isDone ? (
                                  <motion.span
                                    key="done"
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                                  >
                                    <Check className="h-4 w-4" />
                                  </motion.span>
                                ) : (
                                  <motion.span key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                    <BookOpen className="h-4 w-4" />
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[14px] font-medium text-text">
                                  {mod.title_es}
                                </span>
                                {!mod.is_published && (
                                  <NeonBadge color="neutral">{t('admin.courses.draft')}</NeonBadge>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-subtle">
                                <span>{t('admin.courses.library.meta', { min: mod.duration_min, count: sections })}</span>
                                <span aria-hidden>·</span>
                                {inOtherCourse ? (
                                  <span className="truncate text-brand-magenta">
                                    {t('admin.courses.library.in_course', {
                                      course: courseTitles[mod.course_id!] ?? '—',
                                    })}
                                  </span>
                                ) : (
                                  <span className="text-brand-green">
                                    {t('admin.courses.library.free')}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* ── Acciones ── */}
                            <div className="flex shrink-0 items-center gap-1.5">
                              {isBusy ? (
                                <span className="flex items-center gap-2 px-2 text-[12px] text-text-muted">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {progress && progress.total > 0
                                    ? t('admin.courses.library.copying_progress', {
                                        done: progress.done,
                                        total: progress.total,
                                      })
                                    : t('admin.courses.library.working')}
                                </span>
                              ) : (
                                <>
                                  {/* Mover solo tiene sentido si el módulo no está en otro
                                      curso: mover uno usado lo arrancaría de su curso actual. */}
                                  {!inOtherCourse && (
                                    <button
                                      onClick={() => handleMove(mod)}
                                      disabled={disabled}
                                      title={t('admin.courses.library.move_hint')}
                                      className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-text-muted transition-colors hover:border-line hover:bg-glass/8 hover:text-text disabled:opacity-40"
                                    >
                                      <ArrowRight className="h-3.5 w-3.5" />
                                      {t('admin.courses.library.move')}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleCopy(mod)}
                                    disabled={disabled}
                                    title={t('admin.courses.library.copy_hint')}
                                    className="flex h-9 items-center gap-1.5 rounded-lg border border-brand-green/30 bg-brand-green/10 px-2.5 text-[12px] font-medium text-brand-green transition-colors hover:bg-brand-green/20 disabled:opacity-40"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    {inOtherCourse
                                      ? t('admin.courses.library.copy_here')
                                      : t('admin.courses.library.copy')}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </motion.ul>
              )}
            </div>

            {/* ── Footer: leyenda mover vs copiar ── */}
            <div className="border-t border-line px-5 py-3">
              <p className="text-[11px] leading-relaxed text-text-subtle">
                <span className="font-medium text-text-muted">{t('admin.courses.library.copy')}</span>{' '}
                {t('admin.courses.library.legend_copy')}
                <span className="mx-1.5 opacity-40" aria-hidden>
                  |
                </span>
                <span className="font-medium text-text-muted">{t('admin.courses.library.move')}</span>{' '}
                {t('admin.courses.library.legend_move')}
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
