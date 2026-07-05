import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  Eye,
  EyeOff,
  FolderOpen,
  GraduationCap,
  ImagePlus,
  Info,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  getCourseById,
  updateCourse,
  addModuleToCourse,
  removeModuleFromCourse,
  reorderCourseModules,
  getCourseCampaigns,
  setCourseCampaign,
  removeCourseCampaign,
  getCourseAssignments,
  setCourseAssignment,
  removeCourseAssignment,
  uploadCourseCover,
  type CourseWithModules,
  type CourseCampaignRow,
  type CourseAssignmentRow,
} from '@/services/courses.service'
import { getModulesRaw, type DbModuleRow } from '@/services/modules.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import type { Campaign, Profile } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'

type Tab = 'info' | 'modules' | 'assign'
type Lang = 'es' | 'en' | 'pt'

const COLOR_PRESETS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6']

export default function CourseEditor() {
  const { courseId } = useParams<{ courseId: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isSuperAdmin, campaignId: authCampaignId } = useAuth()

  const [course, setCourse] = useState<CourseWithModules | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('info')
  const [lang, setLang] = useState<Lang>('es')
  const [saving, setSaving] = useState(false)

  // Información editable
  const [form, setForm] = useState({
    title_es: '', title_en: '', title_pt: '',
    description_es: '', description_en: '', description_pt: '',
    color: '#6366F1',
    level: 'basico' as 'basico' | 'medio' | 'avanzado',
    category: '',
    visibility: 'assigned' as 'assigned' | 'catalog',
  })
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [uploadingCover, setUploadingCover] = useState(false)

  // Módulos
  const [campaignModules, setCampaignModules] = useState<DbModuleRow[]>([])

  // Asignaciones
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [courseCampaigns, setCourseCampaigns] = useState<CourseCampaignRow[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<CourseAssignmentRow[]>([])
  const [userSearch, setUserSearch] = useState('')

  const reload = useCallback(async () => {
    if (!courseId) return
    const c = await getCourseById(courseId)
    if (!c) {
      navigate('/admin/courses', { replace: true })
      return
    }
    setCourse(c)
    setForm({
      title_es: c.title_es ?? '',
      title_en: c.title_en ?? '',
      title_pt: c.title_pt ?? '',
      description_es: c.description_es ?? '',
      description_en: c.description_en ?? '',
      description_pt: c.description_pt ?? '',
      color: c.color,
      level: c.level,
      category: c.category ?? '',
      visibility: c.visibility,
    })
  }, [courseId, navigate])

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))
  }, [reload])

  // Módulos de la campaña dueña (para poder agregarlos al curso)
  useEffect(() => {
    if (!course?.campaign_id) return
    getModulesRaw(course.campaign_id).then(setCampaignModules).catch(() => {})
  }, [course?.campaign_id, course?.modules.length])

  // Datos de asignación
  useEffect(() => {
    if (!courseId || !course) return
    getCourseCampaigns(courseId).then(setCourseCampaigns).catch(() => {})
    getCourseAssignments(courseId).then(setAssignments).catch(() => {})
    supabase
      .from('campaigns')
      .select('*')
      .order('name')
      .then(({ data }) => setCampaigns(data ?? []))
    supabase
      .from('profiles')
      .select('*')
      .eq('role', 'learner')
      .order('display_name')
      .then(({ data }) => setProfiles((data ?? []) as Profile[]))
  }, [courseId, course?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const availableModules = useMemo(
    () => campaignModules.filter((m) => !m.course_id),
    [campaignModules],
  )

  const visibleCampaigns = useMemo(
    () => (isSuperAdmin ? campaigns : campaigns.filter((c) => c.id === authCampaignId)),
    [campaigns, isSuperAdmin, authCampaignId],
  )

  const filteredProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter((p) => (p.display_name ?? '').toLowerCase().includes(q))
  }, [profiles, userSearch])

  if (loading || !course) {
    return (
      <div className="p-4 sm:p-8 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 rounded-2xl animate-pulse glass" />
        ))}
      </div>
    )
  }

  // ─── Handlers ──────────────────────────────────────────────────

  const handleSaveInfo = async () => {
    setSaving(true)
    try {
      await updateCourse(course.id, {
        title_es: form.title_es.trim() || course.title_es,
        title_en: form.title_en.trim() || null,
        title_pt: form.title_pt.trim() || null,
        description_es: form.description_es.trim() || null,
        description_en: form.description_en.trim() || null,
        description_pt: form.description_pt.trim() || null,
        color: form.color,
        level: form.level,
        category: form.category.trim() || null,
        visibility: form.visibility,
      })
      toast.success(t('admin.courses.saved_ok'))
      invalidateModulesCache()
      await reload()
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePublished = async () => {
    try {
      await updateCourse(course.id, { is_published: !course.is_published })
      setCourse({ ...course, is_published: !course.is_published })
      invalidateModulesCache()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleCoverUpload = async (file: File) => {
    setUploadingCover(true)
    try {
      const url = await uploadCourseCover(file, course.id)
      await updateCourse(course.id, { cover_url: url })
      setCourse({ ...course, cover_url: url })
      toast.success(t('admin.courses.cover_ok'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setUploadingCover(false)
    }
  }

  const handleAddModule = async (mod: DbModuleRow) => {
    try {
      const maxOrder = Math.max(0, ...course.modules.map((m) => m.course_sort_order))
      await addModuleToCourse(course.id, mod.id, maxOrder + 1)
      invalidateModulesCache()
      await reload()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleRemoveModule = async (moduleId: string) => {
    try {
      await removeModuleFromCourse(moduleId)
      invalidateModulesCache()
      await reload()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleMoveModule = async (idx: number, dir: -1 | 1) => {
    const mods = [...course.modules]
    const target = idx + dir
    if (target < 0 || target >= mods.length) return
    ;[mods[idx], mods[target]] = [mods[target], mods[idx]]
    try {
      await reorderCourseModules(mods.map((m, i) => ({ id: m.id, course_sort_order: i + 1 })))
      invalidateModulesCache()
      await reload()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const campaignAssignment = (campaignId: string) =>
    courseCampaigns.find((cc) => cc.campaign_id === campaignId)

  const handleToggleCampaign = async (campaignId: string) => {
    const current = campaignAssignment(campaignId)
    try {
      if (current) {
        await removeCourseCampaign(course.id, campaignId)
        setCourseCampaigns((prev) => prev.filter((cc) => cc.campaign_id !== campaignId))
      } else {
        await setCourseCampaign(course.id, campaignId, false)
        setCourseCampaigns((prev) => [
          ...prev,
          { course_id: course.id, campaign_id: campaignId, is_mandatory: false },
        ])
      }
      invalidateModulesCache()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleCampaignMandatory = async (campaignId: string, isMandatory: boolean) => {
    try {
      await setCourseCampaign(course.id, campaignId, isMandatory)
      setCourseCampaigns((prev) =>
        prev.map((cc) => (cc.campaign_id === campaignId ? { ...cc, is_mandatory: isMandatory } : cc)),
      )
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const userAssignment = (userId: string) => assignments.find((a) => a.user_id === userId)

  const handleToggleUser = async (userId: string) => {
    const current = userAssignment(userId)
    try {
      if (current) {
        await removeCourseAssignment(course.id, userId)
        setAssignments((prev) => prev.filter((a) => a.user_id !== userId))
      } else {
        await setCourseAssignment(course.id, userId, false)
        setAssignments((prev) => [
          ...prev,
          { course_id: course.id, user_id: userId, is_mandatory: false },
        ])
      }
      invalidateModulesCache()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleUserMandatory = async (userId: string, isMandatory: boolean) => {
    try {
      await setCourseAssignment(course.id, userId, isMandatory)
      setAssignments((prev) =>
        prev.map((a) => (a.user_id === userId ? { ...a, is_mandatory: isMandatory } : a)),
      )
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
    { id: 'info', label: t('admin.courses.tab_info'), icon: Info },
    { id: 'modules', label: t('admin.courses.tab_modules'), icon: BookOpen },
    { id: 'assign', label: t('admin.courses.tab_assign'), icon: Users },
  ]

  const inputCls =
    'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-primary'

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      {/* Header */}
      <Link
        to="/admin/courses"
        className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('admin.courses.back_to_list')}
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md"
            style={{ background: course.color }}
          >
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <GradientHeading as="h1" variant="white" size="title">
              {course.title_es}
            </GradientHeading>
            <div className="flex items-center gap-2 mt-1">
              <NeonBadge color={course.is_published ? 'green' : 'neutral'} dot={course.is_published}>
                {course.is_published ? t('admin.courses.published') : t('admin.courses.draft')}
              </NeonBadge>
              {course.visibility === 'catalog' && (
                <NeonBadge color="cyan">{t('admin.courses.catalog_badge')}</NeonBadge>
              )}
            </div>
          </div>
        </div>
        <Button
          variant={course.is_published ? 'glass' : 'neon'}
          size="sm"
          onClick={handleTogglePublished}
          className="shrink-0 flex items-center gap-1.5"
        >
          {course.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {course.is_published ? t('admin.courses.unpublish') : t('admin.courses.publish')}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-line">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors',
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Información ── */}
      {tab === 'info' && (
        <div className="space-y-5">
          {/* Portada */}
          <GlassCard intensity="subtle" rounded="2xl" className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div
                className="h-24 flex-1 rounded-xl overflow-hidden border border-line"
                style={{
                  background: course.cover_url
                    ? undefined
                    : `linear-gradient(120deg, ${form.color}33, ${form.color}0D)`,
                }}
              >
                {course.cover_url && (
                  <img src={course.cover_url} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="shrink-0">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleCoverUpload(f)
                    e.target.value = ''
                  }}
                />
                <Button
                  variant="glass"
                  size="sm"
                  disabled={uploadingCover}
                  onClick={() => coverInputRef.current?.click()}
                  className="flex items-center gap-1.5"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  {uploadingCover ? t('admin.courses.uploading') : t('admin.courses.upload_cover')}
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard intensity="subtle" rounded="2xl" className="p-4 sm:p-5 space-y-4">
            {/* Selector de idioma */}
            <div className="flex gap-1">
              {(['es', 'en', 'pt'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[12px] font-semibold uppercase transition-colors',
                    lang === l ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-glass/8',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">
                {t('admin.courses.field_title')} ({lang.toUpperCase()})
              </label>
              <input
                value={form[`title_${lang}`]}
                onChange={(e) => setForm({ ...form, [`title_${lang}`]: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">
                {t('admin.courses.field_description')} ({lang.toUpperCase()})
              </label>
              <textarea
                value={form[`description_${lang}`]}
                onChange={(e) => setForm({ ...form, [`description_${lang}`]: e.target.value })}
                rows={3}
                className={cn(inputCls, 'resize-none')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">
                  {t('admin.courses.field_level')}
                </label>
                <div className="flex gap-1.5">
                  {(['basico', 'medio', 'avanzado'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setForm({ ...form, level: lvl })}
                      className={cn(
                        'px-3 py-2 rounded-lg text-[12px] font-medium transition-colors border',
                        form.level === lvl
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-line text-text-muted hover:text-text',
                      )}
                    >
                      {t(`admin.courses.level_${lvl}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">
                  {t('admin.courses.field_category')}
                </label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder={t('admin.courses.field_category_ph')}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">
                {t('admin.courses.field_color')}
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className={cn(
                      'h-8 w-8 rounded-lg transition-transform hover:scale-110',
                      form.color === c && 'ring-2 ring-offset-2 ring-offset-bg ring-primary',
                    )}
                    style={{ background: c }}
                    aria-label={c}
                  >
                    {form.color === c && <Check className="h-4 w-4 text-white mx-auto" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Visibilidad en catálogo */}
            <label className="flex items-start gap-3 rounded-xl border border-line p-3.5 cursor-pointer hover:border-primary/40 transition-colors">
              <input
                type="checkbox"
                checked={form.visibility === 'catalog'}
                onChange={(e) =>
                  setForm({ ...form, visibility: e.target.checked ? 'catalog' : 'assigned' })
                }
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]"
              />
              <span>
                <span className="block text-[13px] font-medium text-text">
                  {t('admin.courses.field_catalog')}
                </span>
                <span className="block text-[12px] text-text-muted mt-0.5">
                  {t('admin.courses.field_catalog_hint')}
                </span>
              </span>
            </label>

            <div className="flex justify-end pt-1">
              <Button variant="neon" size="sm" onClick={handleSaveInfo} disabled={saving}>
                {saving ? t('admin.courses.saving') : t('admin.courses.save')}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ── Módulos ── */}
      {tab === 'modules' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-[14px] font-semibold text-text mb-1">
              {t('admin.courses.course_modules_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-3">
              {t('admin.courses.course_modules_hint')}
            </p>
            {course.modules.length === 0 ? (
              <GlassCard intensity="subtle" rounded="2xl" className="text-center p-8">
                <BookOpen className="h-8 w-8 text-text-muted mx-auto mb-2" />
                <p className="text-[13px] text-text-muted">{t('admin.courses.no_modules')}</p>
              </GlassCard>
            ) : (
              <div className="space-y-2">
                {course.modules.map((mod, idx) => (
                  <GlassCard key={mod.id} intensity="subtle" rounded="2xl" padding="none">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-[11px] font-mono text-text-subtle w-5 text-right shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-text truncate">
                            {mod.title_es}
                          </span>
                          {!mod.is_published && (
                            <NeonBadge color="neutral">{t('admin.courses.draft')}</NeonBadge>
                          )}
                        </div>
                        <span className="text-[11px] text-text-subtle">{mod.duration_min} min</span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => handleMoveModule(idx, -1)}
                          disabled={idx === 0}
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 disabled:opacity-30 transition-colors"
                          aria-label={t('admin.courses.move_up')}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleMoveModule(idx, 1)}
                          disabled={idx === course.modules.length - 1}
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 disabled:opacity-30 transition-colors"
                          aria-label={t('admin.courses.move_down')}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <Link
                          to={`/admin/modules/${mod.id}`}
                          className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                        >
                          {t('admin.courses.edit')}
                        </Link>
                        <button
                          onClick={() => handleRemoveModule(mod.id)}
                          title={t('admin.courses.remove_from_course')}
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[14px] font-semibold text-text mb-1">
                  {t('admin.courses.available_modules_title')}
                </h3>
                <p className="text-[12px] text-text-muted">
                  {t('admin.courses.available_modules_hint')}
                </p>
              </div>
              <Link to={`/admin/modules/new?courseId=${course.id}`}>
                <Button variant="glass" size="sm" className="flex items-center gap-1.5 shrink-0">
                  <Plus className="h-3.5 w-3.5" />
                  {t('admin.courses.new_module')}
                </Button>
              </Link>
            </div>
            {availableModules.length === 0 ? (
              <p className="text-[12px] text-text-subtle py-4 text-center">
                {t('admin.courses.no_available_modules')}
              </p>
            ) : (
              <div className="space-y-2">
                {availableModules.map((mod) => (
                  <GlassCard key={mod.id} intensity="subtle" rounded="2xl" padding="none">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <BookOpen className="h-4 w-4 text-text-subtle shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[14px] text-text truncate block">{mod.title_es}</span>
                        <span className="text-[11px] text-text-subtle">{mod.duration_min} min</span>
                      </div>
                      <Button
                        variant="glass"
                        size="sm"
                        onClick={() => handleAddModule(mod)}
                        className="flex items-center gap-1 shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('admin.courses.add')}
                      </Button>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Asignación ── */}
      {tab === 'assign' && (
        <div className="space-y-8">
          {/* Campañas */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <FolderOpen className="h-4 w-4 text-text-muted" />
              {t('admin.courses.assign_campaigns_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-3">
              {t('admin.courses.assign_campaigns_hint')}
            </p>
            <div className="space-y-2">
              {visibleCampaigns.map((c) => {
                const assigned = campaignAssignment(c.id)
                return (
                  <GlassCard key={c.id} intensity="subtle" rounded="2xl" padding="none">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!assigned}
                          onChange={() => handleToggleCampaign(c.id)}
                          className="h-4 w-4 accent-[rgb(var(--primary))]"
                        />
                        <span className="text-[14px] text-text truncate">{c.name}</span>
                      </label>
                      {assigned && (
                        <button
                          onClick={() => handleCampaignMandatory(c.id, !assigned.is_mandatory)}
                          className={cn(
                            'shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors border',
                            assigned.is_mandatory
                              ? 'bg-danger/10 border-danger/30 text-danger'
                              : 'border-line text-text-muted hover:text-text',
                          )}
                        >
                          {assigned.is_mandatory
                            ? t('admin.courses.mandatory')
                            : t('admin.courses.optional')}
                        </button>
                      )}
                    </div>
                  </GlassCard>
                )
              })}
            </div>
          </div>

          {/* Personas */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <Users className="h-4 w-4 text-text-muted" />
              {t('admin.courses.assign_users_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-3">{t('admin.courses.assign_users_hint')}</p>

            <div className="relative mb-3 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={t('admin.courses.search_users_ph')}
                className={cn(inputCls, 'pl-9')}
              />
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {filteredProfiles.length === 0 ? (
                <p className="text-[12px] text-text-subtle py-4 text-center">
                  {t('admin.courses.no_users')}
                </p>
              ) : (
                filteredProfiles.map((p) => {
                  const assigned = userAssignment(p.id)
                  const campaignName = campaigns.find((c) => c.id === p.campaign_id)?.name
                  return (
                    <GlassCard key={p.id} intensity="subtle" rounded="2xl" padding="none">
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!assigned}
                            onChange={() => handleToggleUser(p.id)}
                            className="h-4 w-4 accent-[rgb(var(--primary))]"
                          />
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold uppercase text-primary">
                            {(p.display_name || '?').charAt(0)}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] text-text truncate">
                              {p.display_name || p.id.slice(0, 8)}
                            </span>
                            {campaignName && (
                              <span className="block text-[11px] text-text-subtle truncate">
                                {campaignName}
                              </span>
                            )}
                          </span>
                        </label>
                        {assigned && (
                          <button
                            onClick={() => handleUserMandatory(p.id, !assigned.is_mandatory)}
                            className={cn(
                              'shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors border',
                              assigned.is_mandatory
                                ? 'bg-danger/10 border-danger/30 text-danger'
                                : 'border-line text-text-muted hover:text-text',
                            )}
                          >
                            {assigned.is_mandatory
                              ? t('admin.courses.mandatory')
                              : t('admin.courses.optional')}
                          </button>
                        )}
                      </div>
                    </GlassCard>
                  )
                })
              )}
            </div>
            {assignments.length > 0 && (
              <p className="text-[12px] text-text-subtle mt-3">
                {t('admin.courses.assigned_users_count', { n: assignments.length })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
