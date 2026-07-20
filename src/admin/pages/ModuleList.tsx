import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, BookOpen, ChevronRight, Eye, EyeOff, ExternalLink, GraduationCap, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import {
  getModulesRaw,
  getModuleCampaignId,
  toggleModulePublished,
  deleteModule,
  moveModuleToCampaign,
  type DbModuleRow,
} from '@/services/modules.service'
import { getCoursesForCampaign, type CourseWithModules } from '@/services/courses.service'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { toast } from '@/stores/toastStore'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { FadeIn, PulseHint } from '@/components/ui/motion'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { Select } from '@/components/ui/Select'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import { ResourcePresence } from '@/components/presence/ResourcePresence'
import { usePresenceFocus } from '@/hooks/usePresenceFocus'
import { usePresenceStore } from '@/stores/presenceStore'
import { useCampaignScope, resolveCreationCampaignId } from '@/stores/campaignScopeStore'

// Marca de que el staff ya usó la vista previa (apaga el pulso de la fila).
const PREVIEW_HINT_KEY = 'module-preview-hint-seen'

export default function ModuleList() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { campaignId: authCampaignId, isSuperAdmin, user } = useAuth()

  // El pulso que señala "Vista previa" late hasta que se usa una vez y luego no
  // vuelve: es ayuda de descubrimiento, no un adorno permanente.
  const [previewHintSeen, setPreviewHintSeen] = useState(() => {
    try { return localStorage.getItem(PREVIEW_HINT_KEY) === '1' } catch { return true }
  })
  const markPreviewHintSeen = () => {
    setPreviewHintSeen(true)
    try { localStorage.setItem(PREVIEW_HINT_KEY, '1') } catch { /* modo privado */ }
  }

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // Arranca vacío y se resuelve al cargar las campañas accesibles: partir de la
  // campaña "casa" la dejaba fija aunque el capacitador ya no la tuviera.
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>('')
  const [modules, setModules] = useState<DbModuleRow[]>([])
  const [courses, setCourses] = useState<CourseWithModules[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mover un módulo suelto a otra campaña (los módulos dentro de un curso se
  // mueven con el curso). moveModule = módulo elegido; el resto es el diálogo.
  const [moveModule, setMoveModule] = useState<DbModuleRow | null>(null)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [movingModule, setMovingModule] = useState(false)

  // Foco que manda la barra de presencia: la campaña y el módulo donde está la
  // persona que se pulsó.
  const { focusId, focusCampaignId, peerName } = usePresenceFocus('module')

  // Superadmin: todas. Capacitador: su campaña casa + donde colabora (equipos).
  useEffect(() => {
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then((data) => {
        setCampaigns(data)
        setSelectedCampaignId(
          (prev) => prev || resolveCreationCampaignId(null, data.map((c) => c.id)),
        )
      })
      .catch(() => {})
  }, [isSuperAdmin, authCampaignId, user?.id])

  // La campaña que se está mirando es la que se usará al crear contenido.
  const setActiveCampaignId = useCampaignScope((s) => s.setActiveCampaignId)
  useEffect(() => {
    if (selectedCampaignId) setActiveCampaignId(selectedCampaignId)
  }, [selectedCampaignId, setActiveCampaignId])

  // Si la presencia no trajo la campaña (hay vistas que no la publican), la
  // resolvemos desde el módulo mismo. Sin esto la lista se queda en la campaña
  // equivocada y el módulo señalado sencillamente "no aparece".
  const [resolvedCampaignId, setResolvedCampaignId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusId || focusCampaignId) return
    let alive = true
    getModuleCampaignId(focusId)
      .then((id) => { if (alive) setResolvedCampaignId(id) })
      .catch(() => {})
    return () => { alive = false }
  }, [focusId, focusCampaignId])

  // Venimos siguiendo a alguien: plantarse en SU campaña. Solo si es una a la
  // que tengo acceso — un capacitador no puede saltar a la campaña de otro.
  const targetCampaignId = focusCampaignId ?? resolvedCampaignId
  useEffect(() => {
    if (!targetCampaignId) return
    if (campaigns.length > 0 && !campaigns.some((c) => c.id === targetCampaignId)) return
    setSelectedCampaignId(targetCampaignId)
  }, [targetCampaignId, campaigns])

  // Publico qué campaña estoy mirando, para que quien me siga aterrice en ella.
  const setViewCampaign = usePresenceStore((s) => s.setViewCampaign)
  useEffect(() => {
    setViewCampaign(selectedCampaignId || null)
    return () => setViewCampaign(null)
  }, [selectedCampaignId, setViewCampaign])

  // Traer a la vista el módulo resaltado (la lista puede ser larga).
  const focusRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!focusId || loading) return
    focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, loading, modules])

  // Mantiene el nombre de la campaña seleccionada en sincronía.
  useEffect(() => {
    setSelectedCampaignName(campaigns.find((c) => c.id === selectedCampaignId)?.name ?? '')
  }, [campaigns, selectedCampaignId])

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
      const result = await deleteModule(mod.id)
      setModules((prev) => prev.filter((m) => m.id !== mod.id))
      if (result === 'pending') toast.success(t('deletion.pending_generic'))
    } catch {
      setError(t('admin.modules.error_delete'))
    }
  }

  const handleMoveModule = async () => {
    if (!moveModule || !moveTargetId || moveTargetId === selectedCampaignId) return
    setMovingModule(true)
    try {
      await moveModuleToCampaign(moveModule.id, moveTargetId)
      setModules((prev) => prev.filter((m) => m.id !== moveModule.id))
      const targetName = campaigns.find((c) => c.id === moveTargetId)?.name ?? ''
      toast.success(t('admin.modules.move_ok', { name: targetName }))
      setMoveModule(null)
      setMoveTargetId('')
    } catch (e) {
      toast.error(
        t('admin.modules.move_error'),
        e instanceof Error ? e.message : undefined,
      )
    } finally {
      setMovingModule(false)
    }
  }

  const moveBackdrop = useBackdropDismiss(() => setMoveModule(null), !movingModule)

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

  const renderModule = (mod: DbModuleRow, idx: number, movable = false) => (
    <GlassCard
      key={mod.id}
      intensity="subtle"
      rounded="2xl"
      ref={mod.id === focusId ? focusRef : undefined}
      className={cn(
        'group hover:border-glass-border/15 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover',
        mod.is_published && 'hover:border-glass-border/15',
        // Resalte al venir siguiendo a alguien: señala la fila sin abrirla.
        mod.id === focusId && 'ring-2 ring-primary/70 border-primary/40',
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
              <ResourcePresence type="module" id={mod.id} />
            </div>
            <div className="text-[12px] text-text-subtle mt-0.5">
              {mod.duration_min} min ·{' '}
              {t('admin.modules.sections_count', { n: mod.module_sections?.length ?? 0 })}
            </div>
          </div>
        </div>

        {/* Acciones — con etiqueta de texto, igual que en Cursos: los iconos
            sueltos se confundían (el ojo de "despublicar" parecía "ver"). La
            vista previa es la principal; eliminar va al final y separada. */}
        <div className="flex items-center gap-1.5 sm:shrink-0 flex-wrap opacity-100 sm:opacity-60 sm:group-hover:opacity-100 transition-opacity">
          <PulseHint active={!previewHintSeen}>
            <Link
              to={`/admin/modules/${mod.id}/preview`}
              onClick={markPreviewHintSeen}
              className="min-h-[44px] flex items-center justify-center gap-1.5 px-3 rounded-xl text-[13px] font-semibold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/15 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('admin.modules.preview')}
            </Link>
          </PulseHint>

          <button
            onClick={() => handleTogglePublished(mod)}
            className="min-h-[44px] flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
          >
            {mod.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {mod.is_published ? t('admin.modules.unpublish') : t('admin.modules.publish')}
          </button>

          {movable && campaigns.length > 1 && (
            <button
              onClick={() => { setMoveModule(mod); setMoveTargetId('') }}
              className="min-h-[44px] flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {t('admin.modules.move_action')}
            </button>
          )}

          <button
            onClick={() => handleDelete(mod)}
            className="min-h-[44px] flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-text-subtle hover:text-danger hover:bg-danger/8 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('admin.modules.delete')}
          </button>

          <Link
            to={`/admin/modules/${mod.id}`}
            className="min-h-[44px] flex items-center justify-center gap-1 px-3 rounded-xl text-[13px] font-medium text-text-muted border border-line hover:text-text hover:bg-glass/8 transition-colors"
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
            <Link
              to={`/admin/modules/new${selectedCampaignId ? `?campaign=${selectedCampaignId}` : ''}`}
              className="w-full sm:w-auto"
            >
              <Button variant="neon" className="flex items-center gap-1.5 w-full sm:w-auto">
                <Plus className="h-3.5 w-3.5" />
                {t('admin.modules.new_module')}
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Selector de campaña (superadmin, o capacitador con varias campañas) */}
      {campaigns.length > 1 && (
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
            <Link to={`/admin/modules/new${selectedCampaignId ? `?campaign=${selectedCampaignId}` : ''}`}>
              <Button variant="neon" className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {t('admin.modules.create_first')}
              </Button>
            </Link>
          </GlassCard>
        ) : (
          <FadeIn className="space-y-8" y={14}>
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
                  {orphans.map((mod, idx) => renderModule(mod, idx, true))}
                </div>
              </div>
            )}
          </FadeIn>
        )}
      </div>

      {modules.length > 0 && (
        <p className="text-[11px] text-text-subtle mt-4 text-center">
          Usa el ícono <ExternalLink className="h-3 w-3 inline" /> para previsualizar cómo verá el aprendiz cada módulo
        </p>
      )}

      {/* Mover un módulo suelto a otra campaña */}
      {moveModule && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" {...moveBackdrop}>
          <div className="w-full max-w-md rounded-2xl bg-bg border border-line p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[17px] font-semibold text-text flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-text-muted" />
                {t('admin.modules.move_title')}
              </h2>
              <button
                onClick={() => setMoveModule(null)}
                className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[12px] text-text-muted mb-4">
              {t('admin.modules.move_hint', { title: moveModule.title_es })}
            </p>
            <Select
              value={moveTargetId}
              onChange={setMoveTargetId}
              disabled={movingModule}
              placeholder={t('admin.modules.move_placeholder')}
              options={[
                { value: '', label: t('admin.modules.move_placeholder') },
                ...campaigns
                  .filter((c) => c.id !== selectedCampaignId)
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="ghost" size="sm" onClick={() => setMoveModule(null)} disabled={movingModule}>
                {t('admin.modules.move_cancel')}
              </Button>
              <Button
                variant="neon"
                size="sm"
                onClick={handleMoveModule}
                disabled={movingModule || !moveTargetId}
                className="flex items-center gap-1.5"
              >
                {movingModule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
                {t('admin.modules.move_action')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
