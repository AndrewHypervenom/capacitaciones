import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, ChevronRight, Eye, EyeOff, GraduationCap, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  getCoursesForCampaign,
  createCourse,
  updateCourse,
  deleteCourse,
  type CourseWithModules,
} from '@/services/courses.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'

export default function CourseList() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(authCampaignId ?? '')
  const [courses, setCourses] = useState<CourseWithModules[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal de creación
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

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
    getCoursesForCampaign(selectedCampaignId)
      .then(setCourses)
      .catch(() => setError(t('admin.courses.error_load')))
      .finally(() => setLoading(false))
  }, [selectedCampaignId, t])

  const handleCreate = async () => {
    if (!newTitle.trim() || !selectedCampaignId) return
    setCreating(true)
    try {
      const course = await createCourse(selectedCampaignId, {
        title_es: newTitle.trim(),
        description_es: newDescription.trim() || null,
      })
      toast.success(t('admin.courses.created_ok'))
      navigate(`/admin/courses/${course.id}`)
    } catch {
      toast.error(t('admin.courses.error_create'))
    } finally {
      setCreating(false)
    }
  }

  const handleTogglePublished = async (course: CourseWithModules) => {
    try {
      await updateCourse(course.id, { is_published: !course.is_published })
      setCourses((prev) =>
        prev.map((c) => (c.id === course.id ? { ...c, is_published: !course.is_published } : c)),
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
          <Button
            variant="neon"
            className="shrink-0 flex items-center gap-1.5 w-full sm:w-auto"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('admin.courses.new_course')}
          </Button>
        </div>
      </div>

      {/* Selector de campaña (superadmin) */}
      {isSuperAdmin && campaigns.length > 1 && (
        <div className="mb-6">
          <FilterDropdown
            value={selectedCampaignId}
            onChange={setSelectedCampaignId}
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            className="max-w-xs"
          />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-[13px] text-danger glass border-danger/20">
          {error}
        </div>
      )}

      {/* Lista */}
      {loading ? (
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
          <Button variant="neon" className="flex items-center gap-1.5 mx-auto" onClick={() => setShowCreate(true)}>
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
      )}

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
    </div>
  )
}
