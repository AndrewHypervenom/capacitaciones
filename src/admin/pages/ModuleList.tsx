import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronRight, Eye, EyeOff, GraduationCap, Monitor, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'
import { useAuth } from '@/hooks/useAuth'
import {
  getModulesForCampaigns,
  toggleModulePublished,
  deleteModule,
  type DbModuleRow,
} from '@/services/modules.service'
import { getAllCourses, type CourseWithModules } from '@/services/courses.service'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { getAudiences, type AudienceRule } from '@/services/audiences.service'
import { toast } from '@/stores/toastStore'
import { deletionToast } from '@/lib/deletionToast'
import { GlassCard } from '@/components/ui/GlassCard'
import { FadeIn, PulseHint } from '@/components/ui/motion'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { ContentFilterBar, ContentFilterPrompt, useContentFilters } from '@/admin/components/ContentFilterBar'
import { AiAuthoredBadge, AI_AUTHORED_TINT } from '@/admin/components/AiAuthoredBadge'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { ensureVideoQuizTimes } from '@/admin/lib/ensureVideoQuizTimes'
import { ResourcePresence } from '@/components/presence/ResourcePresence'
import { usePresenceFocus } from '@/hooks/usePresenceFocus'
import { LearnerPreviewModal } from '@/admin/components/LearnerPreviewModal'
import { rowText } from '@/lib/contentLang'

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

  /* Ya no hay programas en pantalla: se listan TODOS los módulos a los que se
     tiene acceso (la base decide cuáles). `campaignIds` es solo fontanería. */
  const [campaignIds, setCampaignIds] = useState<string[] | null>(null)
  /* Buscador y filtros: los mismos que en Cursos (ver ContentFilterBar). País,
     área y CR miran la regla del curso del que cuelga cada módulo. */
  const filters = useContentFilters()
  const [audiences, setAudiences] = useState<Map<string, AudienceRule>>(new Map())
  const [modules, setModules] = useState<DbModuleRow[]>([])
  const [courses, setCourses] = useState<CourseWithModules[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Se incrementa para volver a leer la lista (ver useFreshOnFocus más abajo). */
  const [refreshKey, setRefreshKey] = useState(0)

  // Vista previa en modal: el módulo que se está mirando como aprendiz.
  const [previewModule, setPreviewModule] = useState<DbModuleRow | null>(null)

  // Foco que manda la barra de presencia: la campaña y el módulo donde está la
  // persona que se pulsó.
  const { focusId } = usePresenceFocus('module')

  useEffect(() => {
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then((data) => setCampaignIds(data.map((c) => c.id)))
      .catch(() => setCampaignIds([]))
  }, [isSuperAdmin, authCampaignId, user?.id])

  // Traer a la vista el módulo resaltado (la lista puede ser larga).
  const focusRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!focusId || loading) return
    focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, loading, modules])

  useEffect(() => {
    // Nada se lee hasta elegir país / área / CR o buscar (ver useContentFilters).
    if (!campaignIds || !filters.armed) return
    // Esqueleto solo la primera vez: los refrescos de fondo no deben parpadear.
    if (modules.length === 0) setLoading(true)
    setError(null)
    Promise.all([
      getModulesForCampaigns(campaignIds),
      getAllCourses().catch(() => [] as CourseWithModules[]),
    ])
      .then(([mods, crs]) => {
        setModules(mods)
        setCourses(crs)
        getAudiences(crs.map((c) => c.id)).then(setAudiences).catch(() => setAudiences(new Map()))
      })
      .catch(() => setError(t('admin.modules.error_load')))
      .finally(() => setLoading(false))
    // `modules` solo decide el esqueleto; no puede volver a disparar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignIds, t, refreshKey, filters.armed])

  // Trae lo último al volver a esta pestaña o cuando otra guarda un módulo/curso.
  useFreshOnFocus(() => setRefreshKey((k) => k + 1), {
    topics: ['modules', 'courses'],
    enabled: !!campaignIds && filters.armed,
  })

  const handleTogglePublished = async (mod: DbModuleRow) => {
    // No se publica con quiz de video en 0:00 (nunca se disparan).
    if (!mod.is_published && !(await ensureVideoQuizTimes([mod.id]))) return
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
      description: t('confirm.delete_module_desc', { title: rowText(mod) }),
    })
    if (!ok) return
    try {
      const result = await deleteModule(mod.id)
      setModules((prev) => prev.filter((m) => m.id !== mod.id))
      toast.success(deletionToast(result, t('admin.modules.deleted_ok')))
    } catch {
      setError(t('admin.modules.error_delete'))
    }
  }

  // Agrupar módulos por curso para reflejar la jerarquía Campaña → Curso → Módulo.
  const { courseGroups, orphans, visibleCount } = useMemo(() => {
    const courseTitle = new Map(courses.map((c) => [c.id, rowText(c)]))
    const byCourse = new Map<string, DbModuleRow[]>()
    const orphanList: DbModuleRow[] = []
    for (const m of modules) {
      // El título del curso también se busca: «inducción» trae sus módulos.
      const passes = filters.matches({
        texts: [rowText(m), m.course_id ? courseTitle.get(m.course_id) ?? '' : ''],
        isPublished: m.is_published,
        rule: m.course_id ? audiences.get(m.course_id) : null,
      })
      if (!passes) continue
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
        title: rowText(c),
        color: c.color,
        modules: (byCourse.get(c.id) ?? []).sort(
          (a, b) => (a.course_sort_order ?? 0) - (b.course_sort_order ?? 0),
        ),
      }))
      .filter((g) => g.modules.length > 0)
    // Se cuenta lo que se pinta (un módulo de un curso fuera de la lista no sale).
    const shown = groups.reduce((n, g) => n + g.modules.length, 0) + orphanList.length
    return { courseGroups: groups, orphans: orphanList, visibleCount: shown }
    // `filters.matches` cambia con cada filtro, que ya van en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules, courses, audiences, filters.search, filters.country, filters.area, filters.cr, filters.status])

  // Con más de un módulo, dos columnas de tarjetas: se leen de izquierda a
  // derecha, fila a fila, y el número de cada tarjeta marca el orden.
  const moduleGrid = (count: number) =>
    cn('grid grid-cols-1 gap-3', count > 1 && 'lg:grid-cols-2')

  const renderModule = (mod: DbModuleRow, idx: number) => (
    <GlassCard
      key={mod.id}
      intensity="subtle"
      rounded="2xl"
      ref={mod.id === focusId ? focusRef : undefined}
      className={cn(
        'group h-full hover:border-glass-border/15 transition-colors duration-300 ease-apple',
        mod.is_published && 'hover:border-glass-border/15',
        // Lo escrito por IA se distingue de un vistazo, sin leer el título.
        mod.ai_generated && AI_AUTHORED_TINT,
        // Resalte al venir siguiendo a alguien: señala la fila sin abrirla.
        mod.id === focusId && 'ring-2 ring-primary/70 border-primary/40',
      )}
    >
      <div className="flex h-full flex-col gap-3 px-4 py-3.5">
        <div className="flex items-start gap-3 min-w-0">
          {/* Número: el orden del módulo dentro del curso */}
          <span className="mt-px font-mono text-[12px] font-medium tabular-nums text-text-subtle shrink-0">
            {String(idx + 1).padStart(2, '0')}
          </span>

          {/* Info: título en una línea; estado y duración como una sola línea
              discreta, sin insignias grandes que compitan con el título. */}
          <div className="flex-1 min-w-0">
            <span
              className="block truncate text-[14px] font-medium leading-snug text-text"
              title={rowText(mod)}
            >
              {rowText(mod)}
            </span>
            <div className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap text-[12px] text-text-subtle">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 font-medium',
                  mod.is_published ? 'text-primary' : 'text-text-muted',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    mod.is_published ? 'bg-primary' : 'bg-text-subtle',
                  )}
                />
                {mod.is_published ? t('admin.modules.published') : t('admin.modules.draft')}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {mod.duration_min} min ·{' '}
                {t('admin.modules.sections_count', { n: mod.module_sections?.length ?? 0 })}
              </span>
              {mod.ai_generated && <AiAuthoredBadge scope="module" />}
              <ResourcePresence type="module" id={mod.id} />
            </div>
          </div>
        </div>

        {/* Acciones — con etiqueta de texto, igual que en Cursos: los iconos
            sueltos se confundían (el ojo de "despublicar" parecía "ver"). La
            vista previa es la principal; editar queda a la derecha. En pantalla
            táctil conservan los 44px de alto; con ratón bajan a 32px. */}
        <div className="mt-auto flex items-center gap-1 flex-wrap border-t border-line pt-2.5 -mx-1">
          <PulseHint active={!previewHintSeen}>
            <button
              onClick={() => { markPreviewHintSeen(); setPreviewModule(mod) }}
              title={t('admin.preview.button_hint')}
              className="min-h-[44px] sm:min-h-0 sm:h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <Monitor className="h-3.5 w-3.5" />
              {t('admin.modules.preview')}
            </button>
          </PulseHint>

          <button
            onClick={() => handleTogglePublished(mod)}
            className="min-h-[44px] sm:min-h-0 sm:h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
          >
            {mod.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {mod.is_published ? t('admin.modules.unpublish') : t('admin.modules.publish')}
          </button>

          <button
            onClick={() => handleDelete(mod)}
            className="min-h-[44px] sm:min-h-0 sm:h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-text-subtle hover:text-danger hover:bg-danger/8 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('admin.modules.delete')}
          </button>

          <Link
            to={`/admin/modules/${mod.id}`}
            className="ml-auto min-h-[44px] sm:min-h-0 sm:h-8 flex items-center gap-1 pl-3 pr-2 rounded-lg text-[12px] font-medium text-text border border-line hover:bg-glass/8 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('admin.modules.edit')}
            <ChevronRight className="h-3.5 w-3.5 text-text-subtle transition-transform group-hover:translate-x-0.5" />
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
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
            <Link
              to="/admin/import"
              className="w-full sm:w-auto"
            >
              <Button variant="secondary" className="flex items-center gap-1.5 w-full sm:w-auto" title={t('admin.modules.import_ai_hint')}>
                <Sparkles className="h-3.5 w-3.5" />
                {t('admin.modules.import_ai')}
              </Button>
            </Link>
            <Link
              to="/admin/modules/new"
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

      <ContentFilterBar filters={filters} searchPlaceholder={t('admin.modules.search_ph')} />

      {/* Qué se está viendo, en palabras, y cómo volver a verlo todo. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted">
        {filters.hasSelection && (
          <span className="tabular-nums">
            {t('admin.modules.showing_count', { count: visibleCount, total: modules.length })}
          </span>
        )}
        {filters.reachOn && <span>{t('admin.modules.reach_filter_hint')}</span>}
        {filters.active && (
          <button onClick={filters.clear} className="font-medium text-primary hover:underline">
            {t('admin.courses.clear_filters')}
          </button>
        )}
      </div>

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
        ) : !filters.hasSelection ? (
          <ContentFilterPrompt kind="modules" />
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
        ) : visibleCount === 0 ? (
          <p className="py-10 text-center text-[13px] text-text-muted">{t('admin.modules.filter_empty')}</p>
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
                <div className={moduleGrid(group.modules.length)}>
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
                <div className={moduleGrid(orphans.length)}>
                  {orphans.map((mod, idx) => renderModule(mod, idx))}
                </div>
              </div>
            )}
          </FadeIn>
        )}
      </div>

      {modules.length > 0 && (
        <p className="text-[11px] text-text-subtle mt-4 text-center">
          Usa <Monitor className="h-3 w-3 inline" /> Vista previa para ver cada módulo tal como lo ve el aprendiz, sin salir de esta pantalla
        </p>
      )}

      {previewModule && (
        <LearnerPreviewModal
          path={`/modules/${previewModule.slug}`}
          context={rowText(previewModule)}
          onClose={() => setPreviewModule(null)}
        />
      )}

    </div>
  )
}
