import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Award,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Eye,
  FolderOpen,
  Globe,
  GraduationCap,
  ImagePlus,
  Info,
  ListChecks,
  Lock,
  PhoneCall,
  Plus,
  Save,
  Search,
  Share2,
  Sparkles,
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
  getCourseStats,
  type CourseWithModules,
  type CourseCampaignRow,
  type CourseAssignmentRow,
  type CourseStats,
} from '@/services/courses.service'
import { getModulesRaw, toggleModulePublished, type DbModuleRow } from '@/services/modules.service'
import { getCourseWorld, syncCourseWorldById, setCourseWorldPublished, type WorldRow } from '@/services/worlds.service'
import { getAllScenariosAdmin, updateScenario, type ScenarioRow } from '@/services/scenarios.admin.service'
import { getAllChoiceScenariosAdmin, updateChoiceScenario, type ChoiceScenarioRow } from '@/services/choiceScenarios.admin.service'
import { getCourseEvaluationResults } from '@/services/certification.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import type { Campaign, CertConditions, Profile, CourseEvaluationResult } from '@/types/database'
import { DEFAULT_CERT_CONDITIONS } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'

type Tab = 'info' | 'modules' | 'assign' | 'evaluation'
type Lang = 'es' | 'en' | 'pt'

const COLOR_PRESETS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6']

/**
 * Extrae un mensaje legible de un error de Supabase/PostgREST para mostrarlo en el
 * toast (además de loguearlo). Sin esto, un fallo de RLS/columna/trigger queda oculto
 * tras un mensaje genérico y es imposible diagnosticar por qué "no guarda".
 */
function errMsg(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    const parts = [o.message, o.details, o.hint].filter(Boolean)
    const base = parts.join(' — ') || String(e)
    return o.code ? `[${o.code}] ${base}` : base
  }
  return String(e)
}

/** Interruptor on/off accesible y consistente (track + perilla). */
function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40',
        on ? 'bg-primary border-primary' : 'bg-subtle border-line',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-200',
          on ? 'translate-x-[22px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

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
  const [openingWorld, setOpeningWorld] = useState(false)
  // Estado del mundo del curso: undefined = cargando, null = no existe, objeto = existe (draft/published)
  const [world, setWorld] = useState<WorldRow | null | undefined>(undefined)
  const [publishingWorld, setPublishingWorld] = useState(false)

  // Información editable
  const [form, setForm] = useState({
    title_es: '', title_en: '', title_pt: '',
    description_es: '', description_en: '', description_pt: '',
    color: '#6366F1',
    level: 'basico' as 'basico' | 'medio' | 'avanzado',
    category: '',
    visibility: 'assigned' as 'assigned' | 'catalog',
    is_shareable: false,
  })
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [uploadingCover, setUploadingCover] = useState(false)

  // Métricas agregadas (matriculados / avance) — solo dueño/superadmin
  const [stats, setStats] = useState<CourseStats | null>(null)

  // Módulos
  const [campaignModules, setCampaignModules] = useState<DbModuleRow[]>([])

  // Asignaciones — `*Base` = lo que hay en BD; `draft*` = edición local pendiente de guardar
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [courseCampaigns, setCourseCampaigns] = useState<CourseCampaignRow[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<CourseAssignmentRow[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [campaignSearch, setCampaignSearch] = useState('')
  // Borradores: id → obligatorio (solo entradas asignadas). Ausente = no asignado.
  const [draftCampaigns, setDraftCampaigns] = useState<Record<string, boolean>>({})
  const [draftUsers, setDraftUsers] = useState<Record<string, boolean>>({})
  const [savingAssign, setSavingAssign] = useState(false)

  // ── Evaluación (condiciones del certificado + simulador + resultados) ──
  const [cond, setCond] = useState<CertConditions>(DEFAULT_CERT_CONDITIONS)
  const [simRule, setSimRule] = useState<'after_modules' | 'from_start' | 'after_module'>('after_modules')
  const [simUnlockModuleId, setSimUnlockModuleId] = useState<string | null>(null)
  const [savingEval, setSavingEval] = useState(false)
  const [campaignScenarios, setCampaignScenarios] = useState<ScenarioRow[]>([])
  const [campaignChoiceScenarios, setCampaignChoiceScenarios] = useState<ChoiceScenarioRow[]>([])
  // Resultados por aprendiz (para ver/descargar sus certificados).
  const [results, setResults] = useState<CourseEvaluationResult[]>([])
  const [resultsLoading, setResultsLoading] = useState(false)
  // El simulador es opcional y poco frecuente: la sección va plegada por defecto
  // y se auto-expande solo si el curso ya lo usa (escenarios ligados o requerido).
  const [simOpen, setSimOpen] = useState(false)
  // Escenario que se está publicando desde el curso (para el estado del botón).
  const [publishingScenarioId, setPublishingScenarioId] = useState<string | null>(null)

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
      is_shareable: c.is_shareable ?? false,
    })
    setCond({ ...DEFAULT_CERT_CONDITIONS, ...(c.cert_conditions ?? {}) })
    setSimRule(c.sim_unlock_rule ?? 'after_modules')
    setSimUnlockModuleId(c.sim_unlock_module_id ?? null)
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

  // Métricas agregadas del curso (el RPC autoriza solo al dueño/superadmin;
  // si no está autorizado o falla, simplemente no se muestra el panel).
  useEffect(() => {
    if (!courseId) return
    getCourseStats(courseId).then(setStats).catch(() => setStats(null))
  }, [courseId])

  // Estado del mundo (juego) del curso, para mostrarlo en la barra de publicación:
  // si no existe (hay que crearlo), si está en borrador o si ya está publicado.
  useEffect(() => {
    if (!courseId) return
    let active = true
    getCourseWorld(courseId)
      .then((w) => { if (active) setWorld(w) })
      .catch(() => { if (active) setWorld(null) })
    return () => { active = false }
  }, [courseId])

  // Datos de asignación
  useEffect(() => {
    if (!courseId || !course) return
    getCourseCampaigns(courseId)
      .then((rows) => {
        setCourseCampaigns(rows)
        setDraftCampaigns(Object.fromEntries(rows.map((r) => [r.campaign_id, r.is_mandatory])))
      })
      .catch(() => {})
    getCourseAssignments(courseId)
      .then((rows) => {
        setAssignments(rows)
        setDraftUsers(Object.fromEntries(rows.map((r) => [r.user_id, r.is_mandatory])))
      })
      .catch(() => {})
    supabase
      .from('campaigns')
      .select('*')
      .order('name')
      .then(({ data }) => setCampaigns(data ?? []))
    // El capacitador solo asigna a los aprendices de su propia campaña; el
    // superadmin puede asignar a CUALQUIER usuario del sitio (todos los roles y
    // campañas), por lo que no se filtra ni por rol ni por campaña.
    {
      let profilesQuery = supabase
        .from('profiles')
        .select('*')
        .order('display_name')
      if (!isSuperAdmin) {
        profilesQuery = profilesQuery.eq('role', 'learner')
        if (authCampaignId) profilesQuery = profilesQuery.eq('campaign_id', authCampaignId)
      }
      profilesQuery.then(({ data }) => setProfiles((data ?? []) as Profile[]))
    }
  }, [courseId, course?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const availableModules = useMemo(
    () => campaignModules.filter((m) => !m.course_id),
    [campaignModules],
  )

  const visibleCampaigns = useMemo(
    () => (isSuperAdmin ? campaigns : campaigns.filter((c) => c.id === authCampaignId)),
    [campaigns, isSuperAdmin, authCampaignId],
  )

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase()
    if (!q) return visibleCampaigns
    return visibleCampaigns.filter((c) => (c.name ?? '').toLowerCase().includes(q))
  }, [visibleCampaigns, campaignSearch])

  const filteredProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter((p) => (p.display_name ?? '').toLowerCase().includes(q))
  }, [profiles, userSearch])

  // ¿Hay cambios pendientes respecto a lo guardado en BD?
  const assignDirty = useMemo(() => {
    const sameMap = (
      base: Array<{ id: string; is_mandatory: boolean }>,
      draft: Record<string, boolean>,
    ) => {
      if (base.length !== Object.keys(draft).length) return false
      return base.every((b) => b.id in draft && draft[b.id] === b.is_mandatory)
    }
    const campSame = sameMap(
      courseCampaigns.map((c) => ({ id: c.campaign_id, is_mandatory: c.is_mandatory })),
      draftCampaigns,
    )
    const userSame = sameMap(
      assignments.map((a) => ({ id: a.user_id, is_mandatory: a.is_mandatory })),
      draftUsers,
    )
    return !campSame || !userSame
  }, [courseCampaigns, assignments, draftCampaigns, draftUsers])

  // Escenarios de la campaña (para ligarlos al curso) + resultados de evaluación.
  // Estos hooks van ANTES de cualquier return temprano (Reglas de Hooks).
  // Los escenarios se cargan al montar (no solo en la pestaña Evaluación) para que
  // la barra de "Publicación" pueda reflejar el estado del simulador en todo momento.
  const loadScenarios = useCallback(async () => {
    if (!course?.campaign_id) return
    getAllScenariosAdmin(course.campaign_id).then(setCampaignScenarios).catch(() => {})
    getAllChoiceScenariosAdmin(course.campaign_id).then(setCampaignChoiceScenarios).catch(() => {})
  }, [course?.campaign_id])

  useEffect(() => {
    void loadScenarios()
  }, [loadScenarios])

  const loadEvalData = useCallback(async () => {
    await loadScenarios()
    if (courseId) {
      setResultsLoading(true)
      getCourseEvaluationResults(courseId)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setResultsLoading(false))
    }
  }, [loadScenarios, courseId])

  useEffect(() => {
    if (tab === 'evaluation') void loadEvalData()
  }, [tab, loadEvalData])

  const courseScenarios = useMemo(
    () => campaignScenarios.filter((s) => s.course_id === courseId),
    [campaignScenarios, courseId],
  )
  const otherScenarios = useMemo(
    () => campaignScenarios.filter((s) => s.course_id !== courseId),
    [campaignScenarios, courseId],
  )
  const courseChoiceScenarios = useMemo(
    () => campaignChoiceScenarios.filter((s) => s.course_id === courseId),
    [campaignChoiceScenarios, courseId],
  )
  const otherChoiceScenarios = useMemo(
    () => campaignChoiceScenarios.filter((s) => s.course_id !== courseId),
    [campaignChoiceScenarios, courseId],
  )
  const courseScenarioCount = courseScenarios.length + courseChoiceScenarios.length
  // Escenarios ligados al curso pero en borrador: el aprendiz filtra por
  // is_published=true, así que estos NO aparecen en su vista del curso.
  const unpublishedLinkedCount =
    courseScenarios.filter((s) => !s.is_published).length +
    courseChoiceScenarios.filter((s) => !s.is_published).length

  // Requiere el simulador para certificar, pero no hay escenarios ligados:
  // ningún aprendiz podría certificarse. Se resalta como configuración incompleta.
  const simRequiredButEmpty = cond.require_simulator && courseScenarioCount === 0

  // Auto-expandir la sección del simulador cuando el curso sí lo usa.
  useEffect(() => {
    if (courseScenarioCount > 0 || cond.require_simulator) setSimOpen(true)
  }, [courseScenarioCount, cond.require_simulator])

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
        is_shareable: form.is_shareable,
      })
      toast.success(t('admin.courses.saved_ok'))
      invalidateModulesCache()
      await reload()
    } catch (e) {
      console.error('[CourseEditor] handleSaveInfo', e)
      toast.error(t('admin.courses.error_save'), errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePublished = async () => {
    const next = !course.is_published
    try {
      await updateCourse(course.id, { is_published: next })
      setCourse({ ...course, is_published: next })
      invalidateModulesCache()
      toast.success(next ? t('admin.courses.course_published') : t('admin.courses.course_unpublished'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handlePublishAllModules = async () => {
    try {
      for (const m of course.modules.filter((m) => !m.is_published)) {
        await toggleModulePublished(m.id, true)
      }
      invalidateModulesCache()
      await reload()
      toast.success(t('admin.courses.modules_all_published'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  // Publica el contenido del curso: curso + módulos. NO toca los mundos: la
  // gamificación se crea y gestiona aparte, en la sección Mundos.
  const handlePublishAll = async () => {
    try {
      if (!course.is_published) {
        await updateCourse(course.id, { is_published: true })
        setCourse({ ...course, is_published: true })
      }
      for (const m of course.modules.filter((m) => !m.is_published)) {
        await toggleModulePublished(m.id, true)
      }
      invalidateModulesCache()
      await reload()
      toast.success(t('admin.courses.published_all_ok'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  // Publica de una vez todos los escenarios ligados que estén en borrador, para que
  // el aprendiz pueda verlos en el simulador del curso.
  const handlePublishAllScenarios = async () => {
    setPublishingScenarioId('__all__')
    try {
      for (const s of courseScenarios.filter((x) => !x.is_published)) {
        await updateScenario(s.id, { is_published: true })
      }
      for (const s of courseChoiceScenarios.filter((x) => !x.is_published)) {
        await updateChoiceScenario(s.id, { is_published: true })
      }
      await loadScenarios()
      toast.success(t('admin.courses.sim_published_ok'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setPublishingScenarioId(null)
    }
  }

  // Publica / despublica el mundo del curso (independiente de "Publicar todo",
  // que solo toca curso + módulos). El mundo es opcional: el aprendiz solo lo juega
  // si está publicado.
  const handleToggleWorldPublished = async () => {
    if (!world) return
    const next = world.status !== 'published'
    setPublishingWorld(true)
    try {
      await setCourseWorldPublished(course.id, next)
      setWorld({ ...world, status: next ? 'published' : 'draft' })
      toast.success(next ? t('admin.courses.world_published') : t('admin.courses.world_unpublished'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setPublishingWorld(false)
    }
  }

  // Abre el mundo del curso. Si aún no existe, lo crea LIGADO al curso: una región
  // por módulo (ancladas a su contenido), SIN generar niveles todavía. Los niveles
  // se generan luego, región por región, desde el detalle del mundo (con IA anclada
  // al contenido del módulo). Nunca se inventa ni se crea un mundo suelto.
  const handleViewWorld = async () => {
    setOpeningWorld(true)
    try {
      const world = await getCourseWorld(course.id).catch(() => null)
      if (world) {
        navigate(`/admin/worlds/${world.id}`)
      } else {
        const { world: created } = await syncCourseWorldById(course.id, { createIfMissing: true })
        if (created) navigate(`/admin/worlds/${created.id}`)
        else toast.error(t('admin.courses.error_save'))
      }
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setOpeningWorld(false)
    }
  }

  // Alcance del curso (público/catálogo vs. solo asignados). Se guarda al
  // instante, como el estado de publicado; el resto de la asignación usa borradores.
  const handleSetVisibility = async (v: 'assigned' | 'catalog') => {
    if (form.visibility === v) return
    const prev = form.visibility
    setForm((f) => ({ ...f, visibility: v }))
    try {
      await updateCourse(course.id, { visibility: v })
      setCourse({ ...course, visibility: v })
      invalidateModulesCache()
      toast.success(t('admin.courses.visibility_saved'))
    } catch {
      setForm((f) => ({ ...f, visibility: prev }))
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
    } catch (e) {
      console.error('[CourseEditor] handleCoverUpload', e)
      toast.error(t('admin.courses.error_save'), errMsg(e))
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

  // Publicar/despublicar un módulo desde el curso: un módulo en borrador no lo
  // ve el aprendiz aunque el curso esté publicado.
  const handleToggleModulePublished = async (moduleId: string, isPublished: boolean) => {
    try {
      await toggleModulePublished(moduleId, isPublished)
      invalidateModulesCache()
      await reload()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  // ── Asignación: edición local (los cambios se persisten con "Guardar asignaciones") ──

  const handleToggleCampaign = (campaignId: string) => {
    setDraftCampaigns((prev) => {
      const next = { ...prev }
      if (campaignId in next) delete next[campaignId]
      else next[campaignId] = false
      return next
    })
  }

  const handleCampaignMandatory = (campaignId: string, isMandatory: boolean) => {
    setDraftCampaigns((prev) => ({ ...prev, [campaignId]: isMandatory }))
  }

  const handleToggleUser = (userId: string) => {
    setDraftUsers((prev) => {
      const next = { ...prev }
      if (userId in next) delete next[userId]
      else next[userId] = false
      return next
    })
  }

  const handleUserMandatory = (userId: string, isMandatory: boolean) => {
    setDraftUsers((prev) => ({ ...prev, [userId]: isMandatory }))
  }

  const saveAssignments = async () => {
    setSavingAssign(true)
    try {
      // Campañas: diff borrador vs. BD
      const baseCamp = new Map(courseCampaigns.map((c) => [c.campaign_id, c.is_mandatory]))
      const campIds = new Set([...baseCamp.keys(), ...Object.keys(draftCampaigns)])
      for (const id of campIds) {
        const inDraft = id in draftCampaigns
        if (!inDraft && baseCamp.has(id)) {
          await removeCourseCampaign(course.id, id)
        } else if (inDraft && (!baseCamp.has(id) || baseCamp.get(id) !== draftCampaigns[id])) {
          await setCourseCampaign(course.id, id, draftCampaigns[id])
        }
      }
      // Personas: diff borrador vs. BD
      const baseUser = new Map(assignments.map((a) => [a.user_id, a.is_mandatory]))
      const userIds = new Set([...baseUser.keys(), ...Object.keys(draftUsers)])
      for (const id of userIds) {
        const inDraft = id in draftUsers
        if (!inDraft && baseUser.has(id)) {
          await removeCourseAssignment(course.id, id)
        } else if (inDraft && (!baseUser.has(id) || baseUser.get(id) !== draftUsers[id])) {
          await setCourseAssignment(course.id, id, draftUsers[id])
        }
      }
      // Recargar la línea base desde BD (confirma que quedó persistido y que "lee bien")
      const [cc, aa] = await Promise.all([
        getCourseCampaigns(course.id),
        getCourseAssignments(course.id),
      ])
      setCourseCampaigns(cc)
      setDraftCampaigns(Object.fromEntries(cc.map((r) => [r.campaign_id, r.is_mandatory])))
      setAssignments(aa)
      setDraftUsers(Object.fromEntries(aa.map((r) => [r.user_id, r.is_mandatory])))
      invalidateModulesCache()
      toast.success(t('admin.courses.assign_saved_ok'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setSavingAssign(false)
    }
  }

  const handleSaveConditions = async () => {
    if (!course) return
    setSavingEval(true)
    try {
      await updateCourse(course.id, {
        cert_conditions: cond,
        sim_unlock_rule: simRule,
        sim_unlock_module_id: simRule === 'after_module' ? simUnlockModuleId : null,
      })
      toast.success(t('admin.courses.saved_ok'))
      await reload()
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setSavingEval(false)
    }
  }

  const handleToggleScenarioCourse = async (s: ScenarioRow, attach: boolean) => {
    try {
      await updateScenario(s.id, { course_id: attach ? (courseId ?? null) : null })
      await loadEvalData()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleScenarioPassScore = async (s: ScenarioRow, pass_score: number) => {
    try {
      await updateScenario(s.id, { pass_score })
      setCampaignScenarios((prev) => prev.map((x) => (x.id === s.id ? { ...x, pass_score } : x)))
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleToggleChoiceScenarioCourse = async (s: ChoiceScenarioRow, attach: boolean) => {
    try {
      await updateChoiceScenario(s.id, { course_id: attach ? (courseId ?? null) : null })
      await loadEvalData()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handleChoiceScenarioPassScore = async (s: ChoiceScenarioRow, pass_score: number) => {
    try {
      await updateChoiceScenario(s.id, { pass_score })
      setCampaignChoiceScenarios((prev) => prev.map((x) => (x.id === s.id ? { ...x, pass_score } : x)))
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  // Publicar un escenario ligado directamente desde el curso, sin ir a su editor,
  // para que el aprendiz pueda verlo en el simulador del curso.
  const handlePublishScenario = async (s: ScenarioRow) => {
    setPublishingScenarioId(s.id)
    try {
      await updateScenario(s.id, { is_published: true })
      setCampaignScenarios((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_published: true } : x)))
      toast.success(t('admin.courses.sim_published_ok'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setPublishingScenarioId(null)
    }
  }
  const handlePublishChoiceScenario = async (s: ChoiceScenarioRow) => {
    setPublishingScenarioId(s.id)
    try {
      await updateChoiceScenario(s.id, { is_published: true })
      setCampaignChoiceScenarios((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_published: true } : x)))
      toast.success(t('admin.courses.sim_published_ok'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    } finally {
      setPublishingScenarioId(null)
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
    { id: 'info', label: t('admin.courses.tab_info'), icon: Info },
    { id: 'modules', label: t('admin.courses.tab_modules'), icon: BookOpen },
    { id: 'assign', label: t('admin.courses.tab_assign'), icon: Users },
    { id: 'evaluation', label: t('admin.courses.tab_evaluation'), icon: Award },
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
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="glass"
            size="sm"
            onClick={handleViewWorld}
            disabled={openingWorld}
            className="flex items-center gap-1.5"
          >
            <Globe className="h-3.5 w-3.5" />
            {openingWorld ? t('admin.courses.opening_world') : t('admin.courses.view_world')}
          </Button>
        </div>
      </div>

      {/* Barra compacta de publicación: estado del curso + módulos + acción única.
          El mundo (gamificación) se gestiona aparte, en el botón "Ver mundo" del header. */}
      {(() => {
        const total = course.modules.length
        const pubModules = course.modules.filter((m) => m.is_published).length
        const modulesAllPublished = total === 0 || pubModules === total
        // El simulador es opcional: solo cuenta si hay escenarios ligados al curso.
        const simAllPublished = unpublishedLinkedCount === 0
        const everythingPublished = course.is_published && modulesAllPublished && simAllPublished
        return (
          <div className="rounded-2xl border border-line bg-surface px-4 py-3 mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle"
                title={t('admin.courses.publish_panel_hint')}
              >
                {t('admin.courses.publish_panel_title')}
              </span>

              {/* Chip: Curso */}
              <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-1.5">
                <GraduationCap className="h-4 w-4 text-text-muted shrink-0" />
                <span className="text-[13px] font-medium text-text">{t('admin.courses.publish_course')}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  course.is_published ? 'bg-primary/10 text-primary' : 'bg-glass/8 text-text-muted')}>
                  {course.is_published ? t('admin.courses.published') : t('admin.courses.draft')}
                </span>
                <Toggle on={course.is_published} onClick={handleTogglePublished} label={t('admin.courses.publish_course')} />
              </div>

              {/* Chip: Módulos */}
              <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-1.5">
                <BookOpen className="h-4 w-4 text-text-muted shrink-0" />
                <span className="text-[13px] font-medium text-text">{t('admin.courses.publish_modules')}</span>
                {total === 0 ? (
                  <span className="rounded-full bg-glass/8 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                    {t('admin.courses.no_modules_short')}
                  </span>
                ) : modulesAllPublished ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {t('admin.courses.modules_published_count', { n: pubModules, total })}
                  </span>
                ) : (
                  <>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                      {t('admin.courses.modules_published_count', { n: pubModules, total })}
                    </span>
                    <button
                      onClick={handlePublishAllModules}
                      className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium transition-colors"
                      style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                    >
                      <Eye className="h-3 w-3" /> {t('admin.courses.publish_all_modules')}
                    </button>
                  </>
                )}
              </div>

              {/* Chip: Mundo (juego) — opcional. Muestra si hay que crearlo, si está en borrador o publicado. */}
              <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-1.5">
                <Globe className="h-4 w-4 text-text-muted shrink-0" />
                <span className="text-[13px] font-medium text-text">{t('admin.courses.world_label')}</span>
                {world === undefined ? (
                  <span className="h-3 w-3 rounded-full bg-glass/20 animate-pulse" aria-hidden />
                ) : world === null ? (
                  <button
                    onClick={handleViewWorld}
                    disabled={openingWorld}
                    className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium text-text-muted border border-line transition-colors hover:text-text disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3" /> {t('admin.courses.world_create')}
                  </button>
                ) : world.status === 'published' ? (
                  <>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {t('admin.courses.published')}
                    </span>
                    <Toggle on onClick={handleToggleWorldPublished} label={t('admin.courses.publish_world')} />
                  </>
                ) : (
                  <>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                      {t('admin.courses.draft')}
                    </span>
                    <button
                      onClick={handleToggleWorldPublished}
                      disabled={publishingWorld}
                      className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                      style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                    >
                      <Eye className="h-3 w-3" /> {t('admin.courses.world_publish')}
                    </button>
                  </>
                )}
              </div>

              {/* Chip: Simulador — opcional. Solo aparece si hay escenarios ligados al curso. */}
              {courseScenarioCount > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-1.5">
                  <PhoneCall className="h-4 w-4 text-text-muted shrink-0" />
                  <span className="text-[13px] font-medium text-text">{t('admin.courses.sim_chip_label')}</span>
                  {simAllPublished ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {t('admin.courses.published')}
                    </span>
                  ) : (
                    <>
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                        {t('admin.courses.sim_unpublished_count', { n: unpublishedLinkedCount, total: courseScenarioCount })}
                      </span>
                      <button
                        onClick={handlePublishAllScenarios}
                        disabled={publishingScenarioId === '__all__'}
                        className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                        style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                      >
                        <Eye className="h-3 w-3" /> {t('admin.courses.sim_publish_all')}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Acción principal / estado global (curso + módulos; el mundo va aparte) */}
              <div className="ml-auto flex items-center gap-2">
                {everythingPublished ? (
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
                    <Check className="h-3.5 w-3.5" /> {t('admin.courses.all_published')}
                  </span>
                ) : (
                  <Button variant="neon" size="sm" onClick={handlePublishAll} className="flex items-center gap-1.5 shrink-0">
                    <Eye className="h-3.5 w-3.5" /> {t('admin.courses.publish_all')}
                  </Button>
                )}
              </div>
            </div>

            {/* Avisos: curso publicado pero falta contenido por publicar */}
            {course.is_published && !modulesAllPublished && (
              <p className="flex items-start gap-1.5 mt-2 text-[11px] text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {t('admin.courses.missing_modules')}
              </p>
            )}
            {course.is_published && world && world.status !== 'published' && (
              <p className="flex items-start gap-1.5 mt-2 text-[11px] text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {t('admin.courses.missing_world')}
              </p>
            )}
            {course.is_published && !simAllPublished && (
              <p className="flex items-start gap-1.5 mt-2 text-[11px] text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                {unpublishedLinkedCount === 1
                  ? t('admin.courses.sim_unpublished_warn_one')
                  : t('admin.courses.sim_unpublished_warn_many', { n: unpublishedLinkedCount })}
              </p>
            )}
          </div>
        )
      })()}

      {/* Métricas de matrícula (acotadas a la campaña del que consulta) */}
      {stats && stats.enrolled > 0 && (
        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-[13px] font-semibold text-text">{t('admin.courses.stats_your_learners')}</h3>
            {stats.is_owner && stats.global_enrolled > stats.enrolled && (
              <span className="text-[11px] text-text-subtle">
                {t('admin.courses.stats_global_reach', { n: stats.global_enrolled })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: t('admin.courses.stats_enrolled'), value: stats.enrolled },
              { label: t('admin.courses.stats_completed'), value: `${stats.completion_pct}%` },
              { label: t('admin.courses.stats_avg_progress'), value: `${stats.avg_progress_pct}%` },
            ].map((s) => (
              <GlassCard key={s.label} intensity="subtle" rounded="2xl" className="px-4 py-3">
                <div className="text-[22px] font-bold tabular-nums text-text leading-none">{s.value}</div>
                <div className="text-[11px] text-text-muted mt-1.5">{s.label}</div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}

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

            {/* El alcance (público vs. asignados) se gestiona en la pestaña
                "Asignación" con la sección "¿Quién puede ver este curso?". */}

            {/* Publicar al catálogo compartido (otros capacitadores inscriben a sus aprendices) */}
            <div
              className={cn(
                'rounded-2xl border p-4 transition-colors',
                form.is_shareable ? 'border-primary/50 bg-primary/6 ring-1 ring-primary/20' : 'border-line',
              )}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors',
                    form.is_shareable ? 'bg-primary/15 text-primary' : 'bg-glass/10 text-text-muted',
                  )}
                >
                  <Share2 className="h-4 w-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-text">
                      {t('admin.courses.field_shareable')}
                    </span>
                    {form.is_shareable && (
                      <NeonBadge color="green" dot>{t('admin.courses.shareable_on_badge')}</NeonBadge>
                    )}
                  </span>
                  <span className="block text-[12px] text-text-muted mt-1 leading-relaxed">
                    {t('admin.courses.field_shareable_hint')}
                  </span>
                </span>
                {/* Interruptor */}
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={form.is_shareable}
                  onChange={(e) => setForm({ ...form, is_shareable: e.target.checked })}
                />
                <span
                  aria-hidden
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 mt-0.5 items-center rounded-full border transition-colors duration-200',
                    form.is_shareable ? 'bg-primary border-primary' : 'bg-subtle border-line',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-200',
                      form.is_shareable ? 'translate-x-[22px]' : 'translate-x-[2px]',
                    )}
                  />
                </span>
              </label>
              {form.is_shareable && !course.is_published && (
                <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {t('admin.courses.shareable_needs_publish')}
                </p>
              )}
            </div>

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
            {course.modules.some((m) => !m.is_published) && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-2.5 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[12px] text-text-muted">{t('admin.courses.draft_modules_notice')}</p>
              </div>
            )}
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
                        {mod.is_published ? (
                          <button
                            onClick={() => handleToggleModulePublished(mod.id, false)}
                            title={t('admin.modules.unpublish')}
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleToggleModulePublished(mod.id, true)}
                            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition-colors"
                            style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                          >
                            <Eye className="h-3.5 w-3.5" /> {t('admin.courses.publish')}
                          </button>
                        )}
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
          {/* Aviso de borrador: aunque esté "público" o asignado, no llega a nadie sin publicar */}
          {!course.is_published && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-text">{t('admin.courses.draft_notice_title')}</p>
                <p className="text-[12px] text-text-muted mt-0.5">{t('admin.courses.draft_notice_desc')}</p>
              </div>
              <button
                onClick={handleTogglePublished}
                className="shrink-0 flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-xl text-[13px] font-medium transition-colors"
                style={{ background: 'rgba(16,212,81,0.14)', color: '#10D451', border: '1px solid rgba(16,212,81,0.30)' }}
              >
                <Eye className="h-4 w-4" /> {t('admin.courses.publish')}
              </button>
            </div>
          )}

          {/* ¿Quién puede ver este curso? (alcance) */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <Eye className="h-4 w-4 text-text-muted" />
              {t('admin.courses.audience_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-3">{t('admin.courses.audience_hint')}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {([
                { v: 'catalog' as const, icon: Globe, title: t('admin.courses.audience_public'), desc: t('admin.courses.audience_public_desc') },
                { v: 'assigned' as const, icon: Lock, title: t('admin.courses.audience_restricted'), desc: t('admin.courses.audience_restricted_desc') },
              ]).map(({ v, icon: Icon, title, desc }) => {
                const active = form.visibility === v
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleSetVisibility(v)}
                    className={cn(
                      'text-left rounded-2xl border p-4 transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/6 ring-1 ring-primary/30'
                        : 'border-line hover:border-primary/30',
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-text-muted')} />
                      <span className="text-[13px] font-semibold text-text">{title}</span>
                      {active && <Check className="h-4 w-4 text-primary ml-auto" />}
                    </div>
                    <p className="text-[12px] text-text-muted leading-relaxed">{desc}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Campañas */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <FolderOpen className="h-4 w-4 text-text-muted" />
              {t('admin.courses.assign_campaigns_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-3">
              {form.visibility === 'catalog'
                ? t('admin.courses.assign_campaigns_hint_public')
                : t('admin.courses.assign_campaigns_hint')}
            </p>
            {visibleCampaigns.length > 1 && (
              <div className="relative mb-3 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
                <input
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                  placeholder={t('admin.courses.search_campaigns_ph')}
                  className={cn(inputCls, 'pl-9')}
                />
              </div>
            )}
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {filteredCampaigns.length === 0 ? (
                <p className="text-[12px] text-text-subtle py-4 text-center">
                  {t('admin.courses.no_campaigns')}
                </p>
              ) : (
              filteredCampaigns.map((c) => {
                const isAssigned = c.id in draftCampaigns
                const isMandatory = draftCampaigns[c.id]
                return (
                  <GlassCard key={c.id} intensity="subtle" rounded="2xl" padding="none">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() => handleToggleCampaign(c.id)}
                          className="h-4 w-4 accent-[rgb(var(--primary))]"
                        />
                        <span className="text-[14px] text-text truncate">{c.name}</span>
                      </label>
                      {isAssigned && (
                        <button
                          onClick={() => handleCampaignMandatory(c.id, !isMandatory)}
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
              })
              )}
            </div>
          </div>

          {/* Personas */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <Users className="h-4 w-4 text-text-muted" />
              {t('admin.courses.assign_users_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-3">
              {form.visibility === 'catalog'
                ? t('admin.courses.assign_users_hint_public')
                : t('admin.courses.assign_users_hint')}
            </p>

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
                  const isAssigned = p.id in draftUsers
                  const isMandatory = draftUsers[p.id]
                  const campaignName = campaigns.find((c) => c.id === p.campaign_id)?.name
                  return (
                    <GlassCard key={p.id} intensity="subtle" rounded="2xl" padding="none">
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={() => handleToggleUser(p.id)}
                            className="h-4 w-4 accent-[rgb(var(--primary))]"
                          />
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold uppercase text-primary">
                            {(p.display_name || '?').charAt(0)}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="block text-[13px] text-text truncate">
                                {p.display_name || p.id.slice(0, 8)}
                              </span>
                              {p.role !== 'learner' && (
                                <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                                  {t(`roles.${p.role}`)}
                                </span>
                              )}
                            </span>
                            {campaignName && (
                              <span className="block text-[11px] text-text-subtle truncate">
                                {campaignName}
                              </span>
                            )}
                          </span>
                        </label>
                        {isAssigned && (
                          <button
                            onClick={() => handleUserMandatory(p.id, !isMandatory)}
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
                })
              )}
            </div>
            {Object.keys(draftUsers).length > 0 && (
              <p className="text-[12px] text-text-subtle mt-3">
                {t('admin.courses.assigned_users_count', { n: Object.keys(draftUsers).length })}
              </p>
            )}
          </div>

          {/* Barra de guardado */}
          <div className="sticky bottom-0 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 border-t border-line bg-bg/80 backdrop-blur flex items-center justify-between gap-3">
            <span className="text-[12px] text-text-muted">
              {assignDirty ? t('admin.courses.unsaved_changes') : ' '}
            </span>
            <Button
              variant="neon"
              size="sm"
              onClick={saveAssignments}
              disabled={savingAssign || !assignDirty}
              className="flex items-center gap-1.5 shrink-0"
            >
              <Save className="h-3.5 w-3.5" />
              {savingAssign ? t('admin.courses.saving') : t('admin.courses.save_assignments')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Evaluación: condiciones del certificado + simulador + resultados ── */}
      {tab === 'evaluation' && (
        <div className="space-y-10">
          {/* 1. Condiciones del certificado */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <Award className="h-4 w-4 text-text-muted" />
              {t('admin.courses.cert_conditions_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-4">{t('admin.courses.cert_conditions_hint')}</p>

            <div className="space-y-3">
              {/* Completar módulos */}
              <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
                <BookOpen className="h-4 w-4 text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-text">{t('admin.courses.cond_modules')}</div>
                  {cond.require_all_modules ? (
                    <div className="text-[11px] text-text-muted">{t('admin.courses.cond_modules_all')}</div>
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-text-muted">{t('admin.courses.cond_modules_pct')}</span>
                      <input
                        type="number" min={0} max={100}
                        value={cond.min_modules_pct}
                        onChange={(e) => setCond({ ...cond, min_modules_pct: Math.max(0, Math.min(100, +e.target.value)) })}
                        className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-[13px] text-text"
                      />
                      <span className="text-[11px] text-text-muted">%</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setCond({ ...cond, require_all_modules: !cond.require_all_modules })}
                  className={cn('shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold border',
                    cond.require_all_modules ? 'bg-primary/10 border-primary/30 text-primary' : 'border-line text-text-muted')}
                >
                  {cond.require_all_modules ? t('admin.courses.cond_all') : t('admin.courses.cond_partial')}
                </button>
              </div>

              {/* Puntaje mínimo por módulo: define qué es "completar un módulo" */}
              <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
                <Check className="h-4 w-4 text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-text">{t('admin.courses.cond_module_score')}</div>
                  <div className="text-[11px] text-text-muted">{t('admin.courses.cond_module_score_hint')}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number" min={0} max={100}
                    value={cond.module_pass_pct}
                    onChange={(e) => setCond({ ...cond, module_pass_pct: Math.max(0, Math.min(100, +e.target.value)) })}
                    className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-[13px] text-text"
                  />
                  <span className="text-[12px] text-text-muted">%</span>
                </div>
              </div>

              {/* Requiere simulador */}
              <div className="rounded-xl border border-line px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <PhoneCall className="h-4 w-4 text-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text">{t('admin.courses.cond_simulator')}</div>
                    <div className="text-[11px] text-text-muted">{t('admin.courses.cond_simulator_hint')}</div>
                  </div>
                  <Toggle on={cond.require_simulator} onClick={() => setCond({ ...cond, require_simulator: !cond.require_simulator })} />
                </div>
                {cond.require_simulator && (
                  <div className="flex items-center gap-2 mt-3 pl-7">
                    <span className="text-[12px] text-text-muted">{t('admin.courses.cond_min_score')}</span>
                    <input
                      type="number" min={0} max={100}
                      value={cond.min_score}
                      onChange={(e) => setCond({ ...cond, min_score: Math.max(0, Math.min(100, +e.target.value)) })}
                      className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-[13px] text-text"
                    />
                    <span className="text-[12px] text-text-muted">/ 100</span>
                  </div>
                )}
              </div>

              {/* Config incompleta: requiere simulador pero no hay escenarios */}
              {simRequiredButEmpty && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-[12px] text-text-muted">
                    <span className="block font-semibold text-text mb-0.5">
                      {t('admin.courses.sim_missing_scenarios_title')}
                    </span>
                    {t('admin.courses.sim_missing_scenarios_warn')}
                  </div>
                </div>
              )}
            </div>

            {/* Vista previa de las condiciones */}
            <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
              <p className="text-[12px] text-text-muted mb-1 font-medium">{t('admin.courses.cond_preview')}</p>
              <ul className="text-[13px] text-text space-y-0.5">
                {cond.require_all_modules && <li>· {t('admin.courses.cond_preview_modules_all')}</li>}
                {!cond.require_all_modules && <li>· {t('admin.courses.cond_preview_modules_pct', { pct: cond.min_modules_pct })}</li>}
                <li>· {t('admin.courses.cond_preview_module_score', { pct: cond.module_pass_pct })}</li>
                {cond.require_simulator && <li>· {t('admin.courses.cond_preview_simulator', { score: cond.min_score })}</li>}
              </ul>
            </div>

            <div className="flex justify-end mt-4">
              <Button variant="neon" size="sm" onClick={handleSaveConditions} disabled={savingEval}>
                <Save className="h-3.5 w-3.5" />
                {savingEval ? t('admin.courses.saving') : t('admin.courses.save')}
              </Button>
            </div>
          </div>

          {/* 2. Simulador del curso — opcional y poco frecuente: sección plegable */}
          <div className={cn('rounded-2xl border overflow-hidden', simRequiredButEmpty ? 'border-amber-500/40' : 'border-line')}>
            <button
              type="button"
              onClick={() => setSimOpen((v) => !v)}
              aria-expanded={simOpen}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-glass/5 transition-colors"
            >
              <PhoneCall className="h-4 w-4 text-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-text">{t('admin.courses.sim_section_title')}</span>
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {t('admin.courses.sim_optional_tag')}
                  </span>
                  {simRequiredButEmpty && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> {t('admin.courses.sim_action_needed')}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-text-muted mt-0.5">
                  {courseScenarioCount > 0
                    ? t('admin.courses.sim_summary_count', { n: courseScenarioCount })
                    : t('admin.courses.sim_summary_none')}
                </p>
              </div>
              <ChevronDown className={cn('h-4 w-4 text-text-muted shrink-0 transition-transform', simOpen && 'rotate-180')} />
            </button>

            {simOpen && (
              <div className="border-t border-line px-4 pb-4 pt-4 space-y-4">
                <p className="text-[12px] text-text-muted">{t('admin.courses.sim_section_hint')}</p>

                {/* Regla de desbloqueo */}
                <div className="rounded-xl border border-line px-3.5 py-3">
                  <div className="text-[12px] font-medium text-text-muted mb-2">{t('admin.courses.sim_unlock_label')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['after_modules', 'from_start', 'after_module'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setSimRule(r)}
                        className={cn('px-3 py-1.5 rounded-lg text-[12px] font-medium border',
                          simRule === r ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line text-text-muted hover:text-text')}
                      >
                        {t(`admin.courses.sim_unlock_${r}`)}
                      </button>
                    ))}
                  </div>
                  {simRule === 'after_module' && (
                    <Select
                      className="mt-3"
                      value={simUnlockModuleId ?? ''}
                      onChange={(v) => setSimUnlockModuleId(v || null)}
                      placeholder={t('admin.courses.sim_unlock_pick_module')}
                      options={[
                        { value: '', label: t('admin.courses.sim_unlock_pick_module') },
                        ...course.modules.map((m) => ({ value: m.id, label: m.title_es })),
                      ]}
                    />
                  )}
                  <div className="flex justify-end mt-3">
                    <Button variant="glass" size="sm" onClick={handleSaveConditions} disabled={savingEval}>
                      <Save className="h-3.5 w-3.5" /> {t('admin.courses.save')}
                    </Button>
                  </div>
                </div>

                {/* Escenarios ligados al curso */}
                <div>
                  <div className="text-[12px] font-medium text-text-muted mb-2">{t('admin.courses.sim_in_course')}</div>
                  {courseScenarioCount === 0 ? (
                    <div className={cn(
                      'flex items-start gap-2.5 rounded-xl px-3.5 py-3 border',
                      cond.require_simulator ? 'border-amber-500/30 bg-amber-500/8' : 'border-dashed border-line',
                    )}>
                      {cond.require_simulator && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                      <p className="text-[12px] text-text-muted">
                        {cond.require_simulator
                          ? t('admin.courses.sim_missing_scenarios_warn')
                          : t('admin.courses.sim_none_in_course')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {unpublishedLinkedCount > 0 && (
                        <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 border border-amber-500/30 bg-amber-500/8">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <p className="text-[12px] text-text-muted">
                            {unpublishedLinkedCount === 1
                              ? t('admin.courses.sim_unpublished_warn_one')
                              : t('admin.courses.sim_unpublished_warn_many', { n: unpublishedLinkedCount })}
                          </p>
                        </div>
                      )}
                      {courseScenarios.map((s) => (
                        <div
                          key={s.id}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
                            s.is_published ? 'border-line' : 'border-amber-500/40 bg-amber-500/5',
                          )}
                        >
                          <PhoneCall className="h-4 w-4 text-primary shrink-0" />
                          <span className="flex-1 min-w-0 text-[13px] text-text truncate">
                            {s.title_es}
                            {!s.is_published && (
                              <span
                                title={t('admin.courses.sim_unpublished_hint')}
                                className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                              >
                                {t('admin.courses.sim_unpublished_badge')}
                              </span>
                            )}
                          </span>
                          {!s.is_published && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handlePublishScenario(s)}
                              disabled={publishingScenarioId === s.id}
                              className="flex items-center gap-1.5 shrink-0"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {publishingScenarioId === s.id ? t('admin.courses.sim_publishing') : t('admin.courses.sim_publish')}
                            </Button>
                          )}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] text-text-muted">{t('admin.courses.sim_pass')}</span>
                            <input
                              type="number" min={0} max={100} defaultValue={s.pass_score}
                              onBlur={(e) => handleScenarioPassScore(s, Math.max(0, Math.min(100, +e.target.value)))}
                              className="w-14 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-text"
                            />
                          </div>
                          <button
                            onClick={() => handleToggleScenarioCourse(s, false)}
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8"
                            title={t('admin.courses.remove_from_course')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      {courseChoiceScenarios.map((s) => (
                        <div
                          key={s.id}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
                            s.is_published ? 'border-line' : 'border-amber-500/40 bg-amber-500/5',
                          )}
                        >
                          <ListChecks className="h-4 w-4 text-primary shrink-0" />
                          <span className="flex-1 min-w-0 text-[13px] text-text truncate">
                            {s.title_es}
                            <span className="ml-2 rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                              {t('admin.courses.sim_type_choice')}
                            </span>
                            {!s.is_published && (
                              <span
                                title={t('admin.courses.sim_unpublished_hint')}
                                className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                              >
                                {t('admin.courses.sim_unpublished_badge')}
                              </span>
                            )}
                          </span>
                          {!s.is_published && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handlePublishChoiceScenario(s)}
                              disabled={publishingScenarioId === s.id}
                              className="flex items-center gap-1.5 shrink-0"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {publishingScenarioId === s.id ? t('admin.courses.sim_publishing') : t('admin.courses.sim_publish')}
                            </Button>
                          )}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] text-text-muted">{t('admin.courses.sim_pass')}</span>
                            <input
                              type="number" min={0} max={100} defaultValue={s.pass_score}
                              onBlur={(e) => handleChoiceScenarioPassScore(s, Math.max(0, Math.min(100, +e.target.value)))}
                              className="w-14 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-text"
                            />
                          </div>
                          <button
                            onClick={() => handleToggleChoiceScenarioCourse(s, false)}
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8"
                            title={t('admin.courses.remove_from_course')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Escenarios disponibles para agregar */}
                {(otherScenarios.length > 0 || otherChoiceScenarios.length > 0) && (
                  <div>
                    <div className="text-[12px] font-medium text-text-muted mb-2">{t('admin.courses.sim_available')}</div>
                    <div className="space-y-2">
                      {otherScenarios.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
                          <PhoneCall className="h-4 w-4 text-text-subtle shrink-0" />
                          <span className="flex-1 min-w-0 text-[13px] text-text truncate">
                            {s.title_es}
                            {s.course_id && <span className="ml-2 text-[10px] text-text-subtle">{t('admin.courses.sim_in_other_course')}</span>}
                          </span>
                          <Button variant="glass" size="sm" onClick={() => handleToggleScenarioCourse(s, true)} className="flex items-center gap-1 shrink-0">
                            <Plus className="h-3.5 w-3.5" /> {t('admin.courses.add')}
                          </Button>
                        </div>
                      ))}
                      {otherChoiceScenarios.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
                          <ListChecks className="h-4 w-4 text-text-subtle shrink-0" />
                          <span className="flex-1 min-w-0 text-[13px] text-text truncate">
                            {s.title_es}
                            <span className="ml-2 rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                              {t('admin.courses.sim_type_choice')}
                            </span>
                            {s.course_id && <span className="ml-2 text-[10px] text-text-subtle">{t('admin.courses.sim_in_other_course')}</span>}
                          </span>
                          <Button variant="glass" size="sm" onClick={() => handleToggleChoiceScenarioCourse(s, true)} className="flex items-center gap-1 shrink-0">
                            <Plus className="h-3.5 w-3.5" /> {t('admin.courses.add')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Resultados por aprendiz — ver/descargar sus certificados */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <GraduationCap className="h-4 w-4 text-text-muted" />
              {t('admin.courses.results_title')}
            </h3>
            <p className="text-[12px] text-text-muted mb-4">{t('admin.courses.results_hint')}</p>

            {resultsLoading ? (
              <div className="text-[13px] text-text-muted">{t('admin.courses.results_loading')}</div>
            ) : results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-text-muted">
                {t('admin.courses.results_empty')}
              </div>
            ) : (
              <div className="space-y-2">
                {results.map((r) => {
                  const pct = r.modules_total > 0 ? Math.round((r.modules_done / r.modules_total) * 100) : 0
                  return (
                    <div key={r.user_id} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
                      <div className="h-8 w-8 shrink-0 rounded-full bg-subtle border border-line flex items-center justify-center text-[12px] font-semibold text-text-muted">
                        {(r.display_name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text truncate">
                          {r.display_name || r.user_id.slice(0, 8)}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          {t('admin.courses.results_modules', { done: r.modules_done, total: r.modules_total })} · {pct}%
                        </div>
                      </div>
                      {r.certified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
                          <Award className="h-3 w-3" /> {t('admin.courses.results_certified')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold text-text-muted shrink-0">
                          {t('admin.courses.results_in_progress')}
                        </span>
                      )}
                      {r.certified && (
                        <Link
                          to={`/certificate/${courseId}/${r.user_id}`}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-text hover:bg-glass/5"
                        >
                          <Eye className="h-3.5 w-3.5" /> {t('admin.courses.view_certificate')}
                        </Link>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
