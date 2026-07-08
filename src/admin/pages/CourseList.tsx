import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, ChevronRight, Eye, EyeOff, FileText, GraduationCap, Loader2, Pencil, Plus, Search, Share2, Sparkles, Trash2, Upload, UserPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  getCoursesForCampaign,
  getAllCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getShareableCourses,
  addModuleToCourse,
  type CourseWithModules,
  type AdminCourse,
  type ShareableCourse,
} from '@/services/courses.service'
import { generateModuleOutline, generateModuleSection, type GeneratedModule } from '@/services/ai.service'
import { saveGeneratedModule } from '@/services/modules.service'
import {
  extractDocumentText, ACCEPTED_DOC_EXTENSIONS,
  type ExtractedDocument, type ExtractStage,
} from '@/lib/documentExtract'
import { invalidateModulesCache } from '@/hooks/useModules'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { EnrollLearnersModal } from '@/admin/components/EnrollLearnersModal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'

// Opción "Todas las campañas" en el selector de campaña (solo superadmin).
const ALL_CAMPAIGNS = '__all__'

export default function CourseList() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(authCampaignId ?? '')
  const [courses, setCourses] = useState<AdminCourse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Catálogo compartido por otras campañas (matrícula viva)
  const [view, setView] = useState<'mine' | 'shared'>('mine')
  const [sharedCourses, setSharedCourses] = useState<ShareableCourse[]>([])
  const [sharedLoading, setSharedLoading] = useState(false)
  const [sharedSearch, setSharedSearch] = useState('')
  const [sharedCampaignFilter, setSharedCampaignFilter] = useState<string>('')
  const [enrollCourse, setEnrollCourse] = useState<ShareableCourse | null>(null)

  // Modal de creación
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  // Asistente "Crear curso con IA" (documento → 1 módulo → mundo, todo en borrador)
  const aiFileRef = useRef<HTMLInputElement>(null)
  const [showAi, setShowAi] = useState(false)
  const [aiTitle, setAiTitle] = useState('')
  const [aiDoc, setAiDoc] = useState<ExtractedDocument | null>(null)
  const [aiReadingName, setAiReadingName] = useState('')
  const [aiExtracting, setAiExtracting] = useState(false)
  const [aiProgress, setAiProgress] = useState<{ stage: ExtractStage; ratio: number }>({ stage: 'reading', ratio: 0 })
  const [aiBusy, setAiBusy] = useState(false)
  const [aiStepMsg, setAiStepMsg] = useState<string | null>(null)

  const openAi = () => {
    setAiTitle(''); setAiDoc(null); setAiReadingName(''); setAiStepMsg(null)
    setAiProgress({ stage: 'reading', ratio: 0 })
    setShowAi(true)
  }

  const handleAiFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAiReadingName(file.name)
    setAiProgress({ stage: 'reading', ratio: 0 })
    setAiExtracting(true)
    try {
      const extracted = await extractDocumentText(file, (p) => setAiProgress(p))
      setAiDoc(extracted)
      if (!aiTitle.trim()) setAiTitle(extracted.fileName.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setAiDoc(null)
      toast.error(err instanceof Error ? err.message : t('admin.courses.ai_read_error'))
    } finally {
      setAiExtracting(false)
      if (aiFileRef.current) aiFileRef.current.value = ''
    }
  }

  const handleAiCreate = async () => {
    if (!aiTitle.trim() || !aiDoc || !selectedCampaignId || aiBusy) return
    setAiBusy(true)
    try {
      const description = aiTitle.trim()
      const docContext = {
        documentText: aiDoc.text || undefined,
        images: aiDoc.images.length ? aiDoc.images : undefined,
        contextImages: aiDoc.contextImages.length ? aiDoc.contextImages : undefined,
      }

      // 1) Esquema del módulo (llamada chica). Antes de crear el curso, así un
      //    fallo temprano no deja un curso vacío.
      setAiStepMsg(t('admin.courses.ai_step_outline'))
      const { data: outline } = await generateModuleOutline({ description, ...docContext })
      const headings = outline.sections.map((h) => h.heading_es)

      // 2) Cada sección por separado (a prueba de límites de tokens) con progreso.
      const sections: GeneratedModule['sections'] = []
      for (let s = 0; s < outline.sections.length; s++) {
        setAiStepMsg(t('admin.courses.ai_step_section', { n: s + 1, total: outline.sections.length }))
        const h = outline.sections[s]
        try {
          const { data } = await generateModuleSection({
            description,
            moduleTitle: outline.metadata.title_es,
            moduleSubtitle: outline.metadata.subtitle_es,
            objectives: outline.metadata.objectives_es,
            sectionHeading: h.heading_es,
            sectionIndex: s,
            totalSections: outline.sections.length,
            allHeadings: headings,
            ...docContext,
          })
          sections.push({ ...h, blocks: data.blocks })
        } catch { /* si una sección falla, se omite y seguimos */ }
      }
      if (!sections.length) throw new Error(t('admin.courses.ai_no_sections'))
      const generated: GeneratedModule = { metadata: outline.metadata, sections }

      // 3) Crear el curso (borrador) y engancharle el módulo (borrador).
      setAiStepMsg(t('admin.courses.ai_step_course'))
      const course = await createCourse(selectedCampaignId, { title_es: description, description_es: null })
      const moduleId = await saveGeneratedModule(selectedCampaignId, generated, aiDoc.images)
      await addModuleToCourse(course.id, moduleId, 1)

      // El mundo (gamificación) NO se crea acá: es opcional y se arma aparte,
      // en la sección Mundos, con la cantidad de regiones/niveles/preguntas que
      // elija el capacitador. Crear el curso solo crea el curso y su módulo.

      invalidateModulesCache()
      toast.success(t('admin.courses.ai_created_ok'))
      setShowAi(false)
      navigate(`/admin/courses/${course.id}`)
    } catch (e) {
      toast.error(t('admin.courses.ai_created_error'), (e as Error).message)
    } finally {
      setAiBusy(false)
      setAiStepMsg(null)
    }
  }

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase
      .from('campaigns')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setCampaigns(data ?? [])
        if (!selectedCampaignId && data?.[0]) setSelectedCampaignId(data[0].id)
      })
  }, [isSuperAdmin, selectedCampaignId])

  useEffect(() => {
    if (!selectedCampaignId) return
    setLoading(true)
    setError(null)
    const load = selectedCampaignId === ALL_CAMPAIGNS
      ? getAllCourses()
      : getCoursesForCampaign(selectedCampaignId).then((cs) =>
          cs.map((c) => ({ ...c, campaign_name: null }) as AdminCourse),
        )
    load
      .then(setCourses)
      .catch(() => setError(t('admin.courses.error_load')))
      .finally(() => setLoading(false))
  }, [selectedCampaignId, t])

  useEffect(() => {
    if (view !== 'shared' || !selectedCampaignId || selectedCampaignId === ALL_CAMPAIGNS) return
    setSharedLoading(true)
    getShareableCourses(selectedCampaignId)
      .then(setSharedCourses)
      .catch(() => setError(t('admin.courses.error_load')))
      .finally(() => setSharedLoading(false))
  }, [view, selectedCampaignId, t])

  // Campañas dueñas presentes en el catálogo compartido (para el filtro)
  const sharedCampaignOptions = useMemo(() => {
    const names = new Map<string, string>()
    for (const c of sharedCourses) {
      if (c.campaign_name) names.set(c.campaign_name, c.campaign_name)
    }
    return [{ value: '', label: t('admin.courses.filter_all_campaigns') },
      ...[...names.keys()].sort().map((n) => ({ value: n, label: n }))]
  }, [sharedCourses, t])

  const filteredShared = useMemo(() => {
    const q = sharedSearch.trim().toLowerCase()
    return sharedCourses.filter((c) => {
      if (sharedCampaignFilter && c.campaign_name !== sharedCampaignFilter) return false
      if (!q) return true
      return `${c.title_es} ${c.description_es ?? ''} ${c.category ?? ''}`.toLowerCase().includes(q)
    })
  }, [sharedCourses, sharedSearch, sharedCampaignFilter])

  const handleCreate = async () => {
    if (!newTitle.trim() || !selectedCampaignId) return
    setCreating(true)
    try {
      const course = await createCourse(selectedCampaignId, {
        title_es: newTitle.trim(),
        description_es: newDescription.trim() || null,
      })
      // El mundo gamificado es opcional: no se crea aquí. Se activa a demanda desde
      // el curso (toggle "mundo") o se genera con IA, para no gastar IA de más.
      toast.success(t('admin.courses.created_ok'))
      navigate(`/admin/courses/${course.id}`)
    } catch {
      toast.error(t('admin.courses.error_create'))
    } finally {
      setCreating(false)
    }
  }

  const handleTogglePublished = async (course: CourseWithModules) => {
    const next = !course.is_published
    try {
      await updateCourse(course.id, { is_published: next })
      setCourses((prev) =>
        prev.map((c) => (c.id === course.id ? { ...c, is_published: next } : c)),
      )
      invalidateModulesCache()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleDelete = async (course: CourseWithModules) => {
    const ok = await confirm({
      title: t('admin.courses.confirm_delete_title'),
      description: t('admin.courses.confirm_delete_desc', { title: course.title_es }),
    })
    if (!ok) return
    try {
      await deleteCourse(course.id)
      setCourses((prev) => prev.filter((c) => c.id !== course.id))
      invalidateModulesCache()
      toast.success(t('admin.courses.deleted_ok'))
    } catch {
      toast.error(t('admin.courses.error_delete'))
    }
  }

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="relative mb-6 sm:mb-8">
        <div
          className="absolute -top-8 right-0 h-40 w-72 rounded-full pointer-events-none"
          aria-hidden
          style={{
            background:
              'radial-gradient(ellipse at center, rgb(var(--neon-green) / 0.04) 0%, transparent 70%)',
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="text-[11px] text-text-subtle uppercase tracking-wider mb-3">
              Admin / {t('admin.nav.courses')}
            </p>
            <GradientHeading as="h1" variant="white" size="headline">
              {t('admin.courses.title')}
            </GradientHeading>
            <p className="text-text-muted text-[13px] mt-1">{t('admin.courses.subtitle')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
            <Button
              variant="glass"
              className="flex items-center gap-1.5 w-full sm:w-auto"
              onClick={openAi}
              disabled={selectedCampaignId === ALL_CAMPAIGNS}
              title={selectedCampaignId === ALL_CAMPAIGNS ? t('admin.courses.pick_campaign_to_create') : undefined}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('admin.courses.ai_create')}
            </Button>
            <Button
              variant="neon"
              className="flex items-center gap-1.5 w-full sm:w-auto"
              onClick={() => setShowCreate(true)}
              disabled={selectedCampaignId === ALL_CAMPAIGNS}
              title={selectedCampaignId === ALL_CAMPAIGNS ? t('admin.courses.pick_campaign_to_create') : undefined}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('admin.courses.new_course')}
            </Button>
          </div>
        </div>
      </div>

      {/* Selector de campaña (superadmin) */}
      {isSuperAdmin && campaigns.length > 1 && (
        <div className="mb-6">
          <FilterDropdown
            value={selectedCampaignId}
            onChange={(v) => {
              // La vista de catálogo compartido necesita una campaña dueña concreta.
              if (v === ALL_CAMPAIGNS) setView('mine')
              setSelectedCampaignId(v)
            }}
            options={[
              { value: ALL_CAMPAIGNS, label: t('admin.courses.filter_all_campaigns') },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
            className="max-w-xs"
          />
        </div>
      )}

      {/* Tabs: Mis cursos / Cursos compartidos */}
      <div className="mb-5 flex items-center gap-1 rounded-xl bg-subtle p-1 w-fit">
        <button
          onClick={() => setView('mine')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors min-h-[40px] ${view === 'mine' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
        >
          <GraduationCap className="h-4 w-4" />
          {t('admin.courses.title')}
        </button>
        <button
          onClick={() => setView('shared')}
          disabled={selectedCampaignId === ALL_CAMPAIGNS}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed ${view === 'shared' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
        >
          <Share2 className="h-4 w-4" />
          {t('admin.courses.tab_shared')}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-[13px] text-danger glass border-danger/20">
          {error}
        </div>
      )}

      {/* Catálogo compartido: inscribir a mis aprendices en cursos de otras campañas */}
      {view === 'shared' && (
        <div>
          <p className="text-text-muted text-[13px] mb-4">{t('admin.courses.shared_hint')}</p>

          {/* Buscador + filtro por campaña dueña */}
          <div className="mb-4 flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
              <input
                value={sharedSearch}
                onChange={(e) => setSharedSearch(e.target.value)}
                placeholder={t('admin.courses.search_shared_ph')}
                className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-[14px] text-text outline-none focus:border-primary"
              />
            </div>
            {sharedCampaignOptions.length > 1 && (
              <FilterDropdown
                value={sharedCampaignFilter}
                onChange={setSharedCampaignFilter}
                options={sharedCampaignOptions}
                className="max-w-xs"
              />
            )}
          </div>

          {sharedLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-44 rounded-2xl animate-pulse glass" />
              ))}
            </div>
          ) : filteredShared.length === 0 ? (
            <GlassCard intensity="subtle" padding="none" rounded="3xl" className="text-center p-6 sm:p-10 md:p-12">
              <Share2 className="h-10 w-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-muted text-[14px]">{t('admin.courses.shared_empty')}</p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredShared.map((course) => (
                <GlassCard key={course.id} intensity="subtle" rounded="2xl" padding="none" className="flex flex-col overflow-hidden">
                  <div
                    className="h-20 w-full relative"
                    style={{ background: course.cover_url ? undefined : `linear-gradient(120deg, ${course.color}33, ${course.color}0D)` }}
                  >
                    {course.cover_url && <img src={course.cover_url} alt="" className="h-full w-full object-cover" />}
                    <div className="absolute -bottom-5 left-4 flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-md" style={{ background: course.color }}>
                      <GraduationCap className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="flex-1 px-4 pt-7 pb-3">
                    <div className="text-[15px] font-semibold text-text truncate mb-1">{course.title_es}</div>
                    {course.description_es && (
                      <p className="text-[12px] text-text-muted line-clamp-2 mb-2">{course.description_es}</p>
                    )}
                    <div className="flex items-center gap-1.5 text-[12px] text-text-subtle">
                      <BookOpen className="h-3.5 w-3.5" />
                      {t('admin.courses.modules_count', { n: course.modules.length })}
                    </div>
                    <p className="text-[11px] text-text-subtle mt-1">
                      {t('admin.courses.shared_from', { name: course.campaign_name ?? '—' })}
                    </p>
                  </div>
                  <div className="px-3 pb-3 flex justify-end">
                    <Button
                      variant="neon"
                      size="sm"
                      className="flex items-center gap-1.5"
                      onClick={() => setEnrollCourse(course)}
                      disabled={!selectedCampaignId}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {t('admin.courses.enroll_learners')}
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de inscripción de aprendices en un curso compartido */}
      {enrollCourse && selectedCampaignId && (
        <EnrollLearnersModal
          course={{ id: enrollCourse.id, title_es: enrollCourse.title_es }}
          campaignId={selectedCampaignId}
          onClose={() => setEnrollCourse(null)}
          onSaved={() => {
            invalidateModulesCache()
          }}
        />
      )}

      {/* Lista */}
      {view === 'mine' && (loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-44 rounded-2xl animate-pulse glass" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <GlassCard intensity="subtle" padding="none" rounded="3xl" className="text-center p-6 sm:p-10 md:p-12">
          <GraduationCap className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted text-[14px] mb-2">{t('admin.courses.empty_title')}</p>
          <p className="text-text-subtle text-[12px] mb-6">{t('admin.courses.empty_hint')}</p>
          <Button
            variant="neon"
            className="flex items-center gap-1.5 mx-auto"
            onClick={() => setShowCreate(true)}
            disabled={selectedCampaignId === ALL_CAMPAIGNS}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('admin.courses.new_course')}
          </Button>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map((course) => (
            <GlassCard
              key={course.id}
              intensity="subtle"
              rounded="2xl"
              className="group flex flex-col hover:border-glass-border/15 transition-all duration-200 overflow-hidden"
              padding="none"
            >
              {/* Portada / franja de color */}
              <div
                className="h-20 w-full relative"
                style={{
                  background: course.cover_url
                    ? undefined
                    : `linear-gradient(120deg, ${course.color}33, ${course.color}0D)`,
                }}
              >
                {course.cover_url && (
                  <img src={course.cover_url} alt="" className="h-full w-full object-cover" />
                )}
                <div
                  className="absolute -bottom-5 left-4 flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-md"
                  style={{ background: course.color }}
                >
                  <GraduationCap className="h-5 w-5" />
                </div>
              </div>

              <div className="flex-1 px-4 pt-7 pb-3">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[15px] font-semibold text-text truncate">{course.title_es}</span>
                  <NeonBadge color={course.is_published ? 'green' : 'neutral'} dot={course.is_published}>
                    {course.is_published ? t('admin.courses.published') : t('admin.courses.draft')}
                  </NeonBadge>
                  {course.visibility === 'catalog' && (
                    <NeonBadge color="cyan">{t('admin.courses.catalog_badge')}</NeonBadge>
                  )}
                </div>
                {course.description_es && (
                  <p className="text-[12px] text-text-muted line-clamp-2 mb-2">{course.description_es}</p>
                )}
                <div className="flex items-center gap-1.5 text-[12px] text-text-subtle">
                  <BookOpen className="h-3.5 w-3.5" />
                  {t('admin.courses.modules_count', { n: course.modules.length })}
                  <span>·</span>
                  {t(`admin.courses.level_${course.level}`)}
                </div>
                {selectedCampaignId === ALL_CAMPAIGNS && course.campaign_name && (
                  <p className="text-[11px] text-text-subtle mt-1">
                    {t('admin.courses.shared_from', { name: course.campaign_name })}
                  </p>
                )}
              </div>

              {/* Acciones */}
              <div className="flex items-center justify-end gap-1 px-3 pb-3 opacity-100 sm:opacity-60 sm:group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleTogglePublished(course)}
                  title={course.is_published ? t('admin.courses.unpublish') : t('admin.courses.publish')}
                  className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                >
                  {course.is_published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleDelete(course)}
                  title={t('admin.courses.delete')}
                  className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <Link
                  to={`/admin/courses/${course.id}`}
                  className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[13px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t('admin.courses.edit')}
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </GlassCard>
          ))}
        </div>
      ))}

      {/* Modal de creación */}
      {showCreate && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-bg border border-line p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[17px] font-semibold text-text">{t('admin.courses.new_course')}</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8"
                aria-label={t('admin.nav.close_menu')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block text-[12px] font-medium text-text-muted mb-1.5">
              {t('admin.courses.field_title')}
            </label>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder={t('admin.courses.field_title_ph')}
              className="w-full mb-4 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-primary"
            />
            <label className="block text-[12px] font-medium text-text-muted mb-1.5">
              {t('admin.courses.field_description')}
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              placeholder={t('admin.courses.field_description_ph')}
              className="w-full mb-5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-primary resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)} disabled={creating}>
                {t('admin.courses.cancel')}
              </Button>
              <Button
                variant="neon"
                size="sm"
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
              >
                {creating ? t('admin.courses.creating') : t('admin.courses.create_and_edit')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Asistente: Crear curso con IA desde un documento */}
      {showAi && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !aiBusy && !aiExtracting && setShowAi(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-bg border border-line p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[17px] font-semibold text-text flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-violet" />
                {t('admin.courses.ai_create')}
              </h2>
              <button
                onClick={() => !aiBusy && setShowAi(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8"
                aria-label={t('admin.nav.close_menu')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[12px] text-text-muted mb-4">{t('admin.courses.ai_create_hint')}</p>

            {/* Título */}
            <label className="block text-[12px] font-medium text-text-muted mb-1.5">
              {t('admin.courses.field_title')}
            </label>
            <input
              value={aiTitle}
              onChange={(e) => setAiTitle(e.target.value)}
              placeholder={t('admin.courses.field_title_ph')}
              disabled={aiBusy}
              className="w-full mb-4 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-primary disabled:opacity-60"
            />

            {/* Documento */}
            <label className="block text-[12px] font-medium text-text-muted mb-1.5">
              {t('admin.courses.ai_document')}
            </label>
            {aiExtracting ? (
              <div className="rounded-xl bg-brand-violet/6 border border-brand-violet/15 px-3.5 py-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="relative h-8 w-8 shrink-0 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-brand-violet/70" />
                    <FileText className="absolute h-3.5 w-3.5 text-brand-violet" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-text font-medium truncate">{aiReadingName}</div>
                    <div className="text-[11px] text-text-muted">{t(`admin.import.stage_${aiProgress.stage}`)}</div>
                  </div>
                  <span className="text-[12px] font-semibold text-brand-violet tabular-nums shrink-0">
                    {Math.round(aiProgress.ratio * 100)}%
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 w-full rounded-full bg-glass/10 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-violet transition-all" style={{ width: `${Math.max(4, aiProgress.ratio * 100)}%` }} />
                </div>
              </div>
            ) : aiDoc ? (
              <div className="flex items-center gap-2 mb-4 text-[12px] text-brand-violet px-3.5 py-2.5 rounded-xl bg-brand-violet/6 border border-brand-violet/15">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate flex-1">
                  {aiDoc.fileName} — {(aiDoc.text.length / 1000).toFixed(1)}k {t('admin.courses.ai_chars')}
                  {aiDoc.images.length > 0 && ` · ${aiDoc.images.length} ${t('admin.courses.ai_figures')}`}
                </span>
                {!aiBusy && (
                  <button onClick={() => setAiDoc(null)} className="text-text-muted hover:text-danger shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => aiFileRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 px-4 py-6 mb-4 rounded-xl border border-dashed border-glass-border/25 hover:border-brand-violet/40 hover:bg-glass/4 transition-all"
              >
                <Upload className="h-5 w-5 text-text-muted" />
                <span className="text-[12px] text-text font-medium">{t('admin.import.upload')}</span>
                <span className="text-[11px] text-text-subtle">{t('admin.import.formats')}</span>
              </button>
            )}
            <input ref={aiFileRef} type="file" accept={ACCEPTED_DOC_EXTENSIONS} className="hidden" onChange={handleAiFile} />

            {/* Estado de generación */}
            {aiBusy && aiStepMsg && (
              <div className="flex items-center gap-2 mb-4 rounded-xl bg-brand-violet/6 border border-brand-violet/15 px-3.5 py-2.5 text-[12px] text-text">
                <Loader2 className="h-4 w-4 animate-spin text-brand-violet shrink-0" />
                <span className="truncate">{aiStepMsg}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAi(false)} disabled={aiBusy}>
                {t('admin.courses.cancel')}
              </Button>
              <Button
                variant="neon"
                size="sm"
                onClick={handleAiCreate}
                disabled={aiBusy || aiExtracting || !aiTitle.trim() || !aiDoc}
                className="flex items-center gap-1.5"
              >
                {aiBusy
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('admin.courses.ai_generating')}</>
                  : <><Sparkles className="h-3.5 w-3.5" /> {t('admin.courses.ai_generate')}</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
