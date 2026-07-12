import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronRight, Eye, EyeOff, ExternalLink, GraduationCap, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  getModulesRaw,
  toggleModulePublished,
  deleteModule,
  type DbModuleRow,
} from '@/services/modules.service'
import { getCoursesForCampaign, type CourseWithModules } from '@/services/courses.service'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useConfirm } from '@/components/ui/ConfirmDialog'

export default function ModuleList() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(authCampaignId ?? '')
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>('')
  const [modules, setModules] = useState<DbModuleRow[]>([])
  const [courses, setCourses] = useState<CourseWithModules[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase
      .from('campaigns')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setCampaigns(data ?? [])
        if (!selectedCampaignId && data?.[0]) {
          setSelectedCampaignId(data[0].id)
          setSelectedCampaignName(data[0].name)
        }
      })
  }, [isSuperAdmin, selectedCampaignId])

  useEffect(() => {
    if (isSuperAdmin || !authCampaignId) return
    supabase
      .from('campaigns')
      .select('name')
      .eq('id', authCampaignId)
      .single()
      .then(({ data }) => {
        if (data) setSelectedCampaignName(data.name)
      })
  }, [isSuperAdmin, authCampaignId])

  useEffect(() => {
    if (!selectedCampaignId) return
    setLoading(true)
    setError(null)
    Promise.all([
      getModulesRaw(selectedCampaignId),
      getCoursesForCampaign(selectedCampaignId).catch(() => [] as CourseWithModules[]),
    ])
      .then(([mods, crs]) => {
        setModules(mods)
        setCourses(crs)
      })
      .catch(() => setError(t('admin.modules.error_load')))
      .finally(() => setLoading(false))
  }, [selectedCampaignId, t])

  const handleTogglePublished = async (mod: DbModuleRow) => {
    try {
      await toggleModulePublished(mod.id, !mod.is_published)
      setModules((prev) =>
        prev.map((m) => (m.id === mod.id ? { ...m, is_published: !mod.is_published } : m)),
      )
    } catch {
      setError(t('admin.modules.error_toggle'))
    }
  }

  const handleDelete = async (mod: DbModuleRow) => {
    const ok = await confirm({
      title: t('confirm.delete_module_title'),
      description: t('confirm.delete_module_desc', { title: mod.title_es }),
    })
    if (!ok) return
    try {
      await deleteModule(mod.id)
      setModules((prev) => prev.filter((m) => m.id !== mod.id))
    } catch {
      setError(t('admin.modules.error_delete'))
    }
  }

  // Agrupar módulos por curso para reflejar la jerarquía Campaña → Curso → Módulo.
  const { courseGroups, orphans } = useMemo(() => {
    const byCourse = new Map<string, DbModuleRow[]>()
    const orphanList: DbModuleRow[] = []
    for (const m of modules) {
      if (m.course_id) {
        const arr = byCourse.get(m.course_id) ?? []
        arr.push(m)
        byCourse.set(m.course_id, arr)
      } else {
        orphanList.push(m)
      }
    }
    const groups = [...courses]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({
        id: c.id,
        title: c.title_es,
        color: c.color,
        modules: (byCourse.get(c.id) ?? []).sort(
          (a, b) => (a.course_sort_order ?? 0) - (b.course_sort_order ?? 0),
        ),
      }))
      .filter((g) => g.modules.length > 0)
    return { courseGroups: groups, orphans: orphanList }
  }, [modules, courses])

  const renderModule = (mod: DbModuleRow, idx: number) => (
    <GlassCard
      key={mod.id}
      intensity="subtle"
      rounded="2xl"
      className={cn(
        'group hover:border-glass-border/15 transition-all duration-200',
        mod.is_published && 'hover:border-glass-border/15',
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4">
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          {/* Número */}
          <span className="text-[11px] font-mono text-text-subtle w-5 shrink-0 text-right">
            {idx + 1}
          </span>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-semibold text-text truncate">
                {mod.title_es}
              </span>
              <NeonBadge color={mod.is_published ? 'green' : 'neutral'} dot={mod.is_published}>
                {mod.is_published ? t('admin.modules.published') : t('admin.modules.draft')}
              </NeonBadge>
            </div>
            <div className="text-[12px] text-text-subtle mt-0.5">
              {mod.duration_min} min ·{' '}
              {t('admin.modules.sections_count', { n: mod.module_sections?.length ?? 0 })}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 sm:shrink-0 flex-wrap opacity-100 sm:opacity-60 sm:group-hover:opacity-100 transition-opacity">
          <Link
            to={`/admin/modules/${mod.id}/preview`}
            title={t('admin.modules.preview')}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>

          <button
            onClick={() => handleTogglePublished(mod)}
            title={mod.is_published ? t('admin.modules.unpublish') : t('admin.modules.publish')}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
          >
            {mod.is_published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>

          <button
            onClick={() => handleDelete(mod)}
            title={t('admin.modules.delete')}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <Link
            to={`/admin/modules/${mod.id}`}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[13px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors min-h-[44px]"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('admin.modules.edit')}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </GlassCard>
  )

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="relative mb-6 sm:mb-8">
        <div
          className="absolute -top-8 right-0 h-40 w-72 rounded-full pointer-events-none"
          aria-hidden
          style={{
            background: 'radial-gradient(ellipse at center, rgb(var(--neon-green) / 0.04) 0%, transparent 70%)',
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="text-[11px] text-text-subtle uppercase tracking-wider mb-3">
              {t('admin.modules.crumb')}
            </p>
            <GradientHeading as="h1" variant="white" size="headline">
              {t('admin.modules.title')}
            </GradientHeading>
            {selectedCampaignName && (
              <p className="text-text-muted text-[13px] mt-1">
                {t('admin.modules.campaign_label')} <span className="font-medium text-text">{selectedCampaignName}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
            <Link
              to={`/admin/import${selectedCampaignId ? `?campaign=${selectedCampaignId}` : ''}`}
              className="w-full sm:w-auto"
            >
              <Button variant="secondary" className="flex items-center gap-1.5 w-full sm:w-auto" title={t('admin.modules.import_ai_hint')}>
                <Sparkles className="h-3.5 w-3.5" />
                {t('admin.modules.import_ai')}
              </Button>
            </Link>
            <Link to="/admin/modules/new" className="w-full sm:w-auto">
              <Button variant="neon" className="flex items-center gap-1.5 w-full sm:w-auto">
                <Plus className="h-3.5 w-3.5" />
                {t('admin.modules.new_module')}
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Campaign selector (superadmin) */}
      {isSuperAdmin && campaigns.length > 1 && (
        <div className="mb-6">
          <FilterDropdown
            value={selectedCampaignId}
            onChange={(v) => {
              setSelectedCampaignId(v)
              setSelectedCampaignName(
                campaigns.find((c) => c.id === v)?.name ?? '',
              )
            }}
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
            className="max-w-xs"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-[13px] text-danger glass border-danger/20">
          {error}
        </div>
      )}

      {/* Module list */}
      <div>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl animate-pulse glass" />
            ))}
          </div>
        ) : modules.length === 0 ? (
          <GlassCard intensity="subtle" padding="none" rounded="3xl" className="text-center p-6 sm:p-10 md:p-12">
            <BookOpen className="h-10 w-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-[14px] mb-2">{t('admin.modules.empty_title')}</p>
            <p className="text-text-subtle text-[12px] mb-6">{t('admin.modules.empty_hint')}</p>
            <Link to="/admin/modules/new">
              <Button variant="neon" className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {t('admin.modules.create_first')}
              </Button>
            </Link>
          </GlassCard>
        ) : (
          <div className="space-y-8">
            {courseGroups.map((group) => (
              <div key={group.id}>
                <div className="flex items-center gap-2.5 mb-3 px-1">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-md text-white shrink-0"
                    style={{ background: group.color }}
                  >
                    <GraduationCap className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-[13px] font-semibold text-text truncate">{group.title}</h3>
                  <span className="text-[11px] text-text-subtle shrink-0">{group.modules.length}</span>
                </div>
                <div className="space-y-3">
                  {group.modules.map((mod, idx) => renderModule(mod, idx))}
                </div>
              </div>
            ))}

            {orphans.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 mb-3 px-1">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-subtle text-text-muted shrink-0">
                    <BookOpen className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-[13px] font-semibold text-text">
                    {t('admin.modules.no_course_group')}
                  </h3>
                  <span className="text-[11px] text-text-subtle shrink-0">{orphans.length}</span>
                </div>
                <div className="space-y-3">
                  {orphans.map((mod, idx) => renderModule(mod, idx))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {modules.length > 0 && (
        <p className="text-[11px] text-text-subtle mt-4 text-center">
          Usa el ícono <ExternalLink className="h-3 w-3 inline" /> para previsualizar cómo verá el aprendiz cada módulo
        </p>
      )}
    </div>
  )
}
