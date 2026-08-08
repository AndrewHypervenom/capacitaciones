import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  RefreshCw,
  Award,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Combine,
  Copy,
  Eye,
  FolderOpen,
  Globe,
  GraduationCap,
  ImagePlus,
  Info,
  Languages,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Map as MapIcon,
  Monitor,
  PhoneCall,
  Plus,
  Rocket,
  Flag,
  Scissors,
  Search,
  Share2,
  Sparkles,
  Unlink,
  Unlock,
  Users,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useEditingPresence } from '@/hooks/usePresence'
import { PresenceStack } from '@/components/presence/PresenceStack'
import { EditingBanner } from '@/components/presence/EditingBanner'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { supabase } from '@/lib/supabase'
import {
  getCourseById,
  updateCourse,
  moveCourseToCampaign,
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
  getLearnerCountsByCampaign,
  type CourseWithModules,
  type CourseCampaignRow,
  type CourseAssignmentRow,
  type CourseStats,
} from '@/services/courses.service'
import { cloneModule, getLibraryModules, toggleModulePublished, type DbModuleRow } from '@/services/modules.service'
import { ensureVideoQuizTimes } from '@/admin/lib/ensureVideoQuizTimes'
import { ModuleLibraryModal } from '@/admin/components/ModuleLibraryModal'
import { ModuleSplitModal } from '@/admin/components/ModuleSplitModal'
import { ModuleMergeModal } from '@/admin/components/ModuleMergeModal'
import { SurgeryUndoBar } from '@/admin/components/SurgeryUndoBar'
import type { PendingSurgery } from '@/services/moduleSurgery.service'
import { LearnerPreviewModal } from '@/admin/components/LearnerPreviewModal'
import { TranslationModal } from '@/admin/components/TranslationModal'
import { getCourseTranslationState } from '@/services/translation.service'
import { getCourseWorld, syncCourseWorldById, setCourseWorldPublished, getLinkableWorlds, linkWorldToCourse, unlinkWorldFromCourse, type WorldRow } from '@/services/worlds.service'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { getAllScenariosAdmin, updateScenario, type ScenarioRow } from '@/services/scenarios.admin.service'
import { getAllChoiceScenariosAdmin, updateChoiceScenario, type ChoiceScenarioRow } from '@/services/choiceScenarios.admin.service'
import {
  getCourseEvaluationResults,
  getCourseRecertStatus,
  requestCourseRecertification,
} from '@/services/certification.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import { invalidateLearnerCoursesCache } from '@/hooks/useLearnerCourses'
import type { Campaign, CertConditions, Profile, CourseEvaluationResult, CourseRecertStatus } from '@/types/database'
import { DEFAULT_CERT_CONDITIONS } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { CourseCover, courseHasCover, COVER_BOX } from '@/components/course/CourseCover'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Select } from '@/components/ui/Select'
import { Tooltip } from '@/components/ui/Tooltip'
import { Button } from '@/components/ui/Button'
import { RichTextArea } from '@/components/ui/RichTextArea'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useUnsavedWork } from '@/hooks/useUnsavedWork'
import { useStaleGuard, type StaleGuard } from '@/hooks/useStaleGuard'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'
import { StaleNotice } from '@/components/ui/StaleNotice'
import { useUnsavedFlag } from '@/hooks/useUnsavedFlag'
import { useUndoHistory } from '@/hooks/useUndoHistory'
import { SaveDock, DirtyDot } from '@/admin/components/SaveDock'
import { fingerprint } from '@/lib/fingerprint'

type Tab = 'info' | 'modules' | 'assign' | 'evaluation'

/** Rótulo i18n de cada pestaña; se reusa en las pestañas y en la presencia. */
const TAB_LABEL_KEY: Record<Tab, string> = {
  info: 'admin.courses.tab_info',
  modules: 'admin.courses.tab_modules',
  assign: 'admin.courses.tab_assign',
  evaluation: 'admin.courses.tab_evaluation',
}
type Lang = 'es' | 'en' | 'pt'

const COLOR_PRESETS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6']

/** Columnas de portada (una imagen independiente por tipo de pantalla). */
type CoverSlot = 'cover_url' | 'cover_url_mobile' | 'cover_url_tablet'

/** Metadata de cada slot: rótulo i18n, tamaño recomendado y rango de pantalla. */
// Cada medida es la proporción EXACTA que COVER_BOX usa en ese rango de
// pantalla (3:1, 14:3 y 26:5): subida así, la portada llena la caja sin franjas
// y sin recorte, tanto en el hero del curso como en las tarjetas.
// `box` es la proporción de ese slot: la miniatura se ve con la forma real que
// tendrá la portada en ese dispositivo, no con la del monitor del capacitador.
const COVER_SLOTS: { slot: CoverSlot; labelKey: string; size: string; range: string; box: string }[] = [
  { slot: 'cover_url_mobile', labelKey: 'admin.courses.cover_slot_mobile', size: '1200×400', range: '<640px', box: 'aspect-[3/1]' },
  { slot: 'cover_url_tablet', labelKey: 'admin.courses.cover_slot_tablet', size: '1680×360', range: '640–895px', box: 'aspect-[14/3]' },
  { slot: 'cover_url', labelKey: 'admin.courses.cover_slot_desktop', size: '1664×320', range: '≥896px', box: 'aspect-[26/5]' },
]

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
  const confirm = useConfirm()
  const { isSuperAdmin, campaignId: authCampaignId, user } = useAuth()

  const [course, setCourse] = useState<CourseWithModules | null>(null)
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('info')

  // Presencia colaborativa: coeditores que tienen abierto este curso. Publicamos
  // también la pestaña abierta para que se vea el punto exacto donde están.
  const coeditors = useEditingPresence(
    courseId
      ? {
          type: 'course',
          id: courseId,
          title: course?.title_es ?? '',
          detail: t('presence.detail_tab', { name: t(TAB_LABEL_KEY[tab]) }),
          campaignId: course?.campaign_id ?? undefined,
        }
      : null,
  )
  const [lang, setLang] = useState<Lang>('es')
  const [saving, setSaving] = useState(false)
  const [openingWorld, setOpeningWorld] = useState(false)
  // Vista previa del curso en modal (la página real del aprendiz en un iframe).
  const [previewOpen, setPreviewOpen] = useState(false)
  const [openingPreview, setOpeningPreview] = useState(false)
  // Traducción diferida: cuántas piezas del curso siguen solo en español.
  const [transPending, setTransPending] = useState(0)
  const [translateOpen, setTranslateOpen] = useState(false)
  // Estado del mundo del curso: undefined = cargando, null = no existe, objeto = existe (draft/published)
  const [world, setWorld] = useState<WorldRow | null | undefined>(undefined)
  const [publishingWorld, setPublishingWorld] = useState(false)
  // Mundos sueltos de la campaña, candidatos a enlazar cuando el curso no tiene mundo.
  const [linkableWorlds, setLinkableWorlds] = useState<WorldRow[]>([])
  const [linkingWorld, setLinkingWorld] = useState(false)

  // Información editable
  const [form, setForm] = useState({
    title_es: '', title_en: '', title_pt: '',
    description_es: '', description_en: '', description_pt: '',
    color: '#6366F1',
    level: 'basico' as 'basico' | 'medio' | 'avanzado',
    category: '',
    visibility: 'assigned' as 'assigned' | 'catalog',
    is_shareable: false,
    cover_fit: 'cover' as 'cover' | 'contain',
  })
  const coverInputRef = useRef<HTMLInputElement>(null)
  // Qué variante de portada dispara la subida (móvil/tablet/pc/nítida).
  const coverSlotRef = useRef<CoverSlot>('cover_url')
  const [uploadingSlot, setUploadingSlot] = useState<CoverSlot | null>(null)

  // Métricas agregadas (matriculados / avance) — solo dueño/superadmin
  const [stats, setStats] = useState<CourseStats | null>(null)

  // Módulos
  const [campaignModules, setCampaignModules] = useState<DbModuleRow[]>([])

  // Cirugía de módulos: unir varios en uno o separar uno largo en dos.
  // `pendingSurgery` sostiene la operación mientras corre la ventana de Deshacer.
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [splitModuleId, setSplitModuleId] = useState<string | null>(null)
  const [pendingSurgery, setPendingSurgery] = useState<{
    key: number
    label: string
    pending: PendingSurgery
  } | null>(null)

  // Asignaciones — `*Base` = lo que hay en BD; `draft*` = edición local pendiente de guardar
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // Campañas a las que ESTE usuario puede mover el curso (casa + colaboraciones;
  // superadmin: todas). A diferencia de `campaigns`, ya viene acotado a lo suyo.
  const [accessibleCampaigns, setAccessibleCampaigns] = useState<Campaign[]>([])
  const [moveTargetId, setMoveTargetId] = useState('')
  const [movingCampaign, setMovingCampaign] = useState(false)
  const [courseCampaigns, setCourseCampaigns] = useState<CourseCampaignRow[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<CourseAssignmentRow[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [campaignSearch, setCampaignSearch] = useState('')
  // Borradores: id → obligatorio (solo entradas asignadas). Ausente = no asignado.
  const [draftCampaigns, setDraftCampaigns] = useState<Record<string, boolean>>({})
  const [draftUsers, setDraftUsers] = useState<Record<string, boolean>>({})
  const [savingAssign, setSavingAssign] = useState(false)
  // Aprendices por campaña: lo que la lista de personas NO muestra. Sin esto,
  // "N personas con el curso asignado" parecía contradecir a "Matriculados".
  const [learnersByCampaign, setLearnersByCampaign] = useState<Record<string, number>>({})

  // ── Evaluación (condiciones del certificado + simulador + resultados) ──
  const [cond, setCond] = useState<CertConditions>(DEFAULT_CERT_CONDITIONS)
  const [simRule, setSimRule] = useState<'after_modules' | 'from_start' | 'after_module'>('after_modules')
  const [simUnlockModuleId, setSimUnlockModuleId] = useState<string | null>(null)
  // Desbloqueo del mundo (juego), mismo esquema que el simulador.
  const [worldRule, setWorldRule] = useState<'after_modules' | 'from_start' | 'after_module'>('after_modules')
  const [worldUnlockModuleId, setWorldUnlockModuleId] = useState<string | null>(null)
  const [savingEval, setSavingEval] = useState(false)
  const [campaignScenarios, setCampaignScenarios] = useState<ScenarioRow[]>([])
  const [campaignChoiceScenarios, setCampaignChoiceScenarios] = useState<ChoiceScenarioRow[]>([])
  // Resultados por aprendiz (para ver/descargar sus certificados).
  const [results, setResults] = useState<CourseEvaluationResult[]>([])
  const [resultsLoading, setResultsLoading] = useState(false)
  // Recertificación: quién quedó con el certificado "viejo" tras publicar contenido.
  const [recert, setRecert] = useState<CourseRecertStatus[]>([])
  const [recertBusy, setRecertBusy] = useState(false)
  // El simulador es opcional y poco frecuente: la sección va plegada por defecto
  // y se auto-expande solo si el curso ya lo usa (escenarios ligados o requerido).
  const [simOpen, setSimOpen] = useState(false)
  // Escenario que se está publicando desde el curso (para el estado del botón).
  const [publishingScenarioId, setPublishingScenarioId] = useState<string | null>(null)

  // `reload` se declara antes que el guardia de versión (que necesita `courseId`
  // y vive más abajo, junto al resto de hooks de frescura). El ref rompe esa
  // dependencia circular: reload fija la referencia sin conocer el guardia.
  const staleGuardRef = useRef<StaleGuard<CourseWithModules> | null>(null)

  // Línea base de lo guardado, por parte del editor. La barra única de guardado
  // necesita saber QUÉ cambió (ficha / evaluación), no solo que "algo" cambió:
  // se compara contra la fila tal como vino de la BD, no contra el estado —
  // así el editor nunca nace "sucio" por un setState que aún no se aplicó.
  const [baseline, setBaseline] = useState<{ info: string; evaluation: string }>({
    info: '',
    evaluation: '',
  })

  const reload = useCallback(async () => {
    if (!courseId) return
    const c = await getCourseById(courseId)
    if (!c) {
      navigate('/admin/courses', { replace: true })
      return
    }
    setCourse(c)
    const nextForm = {
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
      cover_fit: c.cover_fit ?? 'cover',
    }
    const nextEval = {
      cond: { ...DEFAULT_CERT_CONDITIONS, ...(c.cert_conditions ?? {}) },
      simRule: c.sim_unlock_rule ?? 'after_modules',
      simUnlockModuleId: c.sim_unlock_module_id ?? null,
      worldRule: c.world_unlock_rule ?? 'after_modules',
      worldUnlockModuleId: c.world_unlock_module_id ?? null,
    }
    setForm(nextForm)
    setCond(nextEval.cond)
    setSimRule(nextEval.simRule)
    setSimUnlockModuleId(nextEval.simUnlockModuleId)
    setWorldRule(nextEval.worldRule)
    setWorldUnlockModuleId(nextEval.worldUnlockModuleId)
    setBaseline({ info: fingerprint(nextForm), evaluation: fingerprint(nextEval) })
    staleGuardRef.current?.mark(c)
  }, [courseId, navigate])

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))
  }, [reload])

  // Cambios sin guardar de la ficha: alimenta el aviso de "Nueva versión
  // disponible" y el de cerrar la pestaña (ver lib/unsavedWork.ts).
  const unsaved = useUnsavedWork(
    { form, cond, simRule, simUnlockModuleId, worldRule, worldUnlockModuleId },
    { label: form.title_es || t('common.untitled'), enabled: !loading },
  )

  // Guardia de versión de la ficha del curso. Se ignoran `modules` y los
  // contadores derivados: cambian cada vez que alguien toca un módulo del curso
  // y dispararían el aviso sin que la ficha —lo único que este editor
  // sobrescribe— haya cambiado.
  const staleGuard = useStaleGuard<CourseWithModules>({
    fetch: () => getCourseById(courseId!),
    topic: 'courses',
    id: courseId,
    ignoreKeys: ['modules', 'module_count', 'enrolled_count'],
  })
  useEffect(() => {
    staleGuardRef.current = staleGuard
  })

  // Trae lo último al volver a la pestaña, pero nunca encima de algo a medias.
  useFreshOnFocus(
    () => {
      void reload().then(() => unsaved.markSaved())
    },
    { topics: ['courses'], enabled: !loading && !unsaved.dirty },
  )

  // Módulos disponibles para la Biblioteca: superadmin ve TODOS (traer cualquier
  // módulo a cualquier curso); el capacitador, los de sus campañas accesibles.
  const reloadModules = useCallback(async () => {
    if (!isSuperAdmin && accessibleCampaigns.length === 0) return
    try {
      setCampaignModules(
        await getLibraryModules({
          isSuperAdmin,
          campaignIds: accessibleCampaigns.map((c) => c.id),
        }),
      )
    } catch {
      /* la biblioteca queda con lo último bueno */
    }
  }, [isSuperAdmin, accessibleCampaigns])

  useEffect(() => {
    void reloadModules()
  }, [reloadModules, course?.modules.length])

  // Campañas a las que este usuario puede mover el curso.
  useEffect(() => {
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then(setAccessibleCampaigns)
      .catch(() => setAccessibleCampaigns([]))
  }, [isSuperAdmin, authCampaignId, user?.id])

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

  // Mundos sueltos de la campaña (candidatos a enlazar) — solo hacen falta cuando
  // el curso todavía no tiene mundo.
  useEffect(() => {
    if (!course?.campaign_id || world) { setLinkableWorlds([]); return }
    let active = true
    getLinkableWorlds(course.campaign_id)
      .then((ws) => { if (active) setLinkableWorlds(ws) })
      .catch(() => { if (active) setLinkableWorlds([]) })
    return () => { active = false }
  }, [course?.campaign_id, world])

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

  // Cuánta gente alcanza cada campaña marcada (se recalcula al marcar/desmarcar).
  const draftCampaignIds = useMemo(() => Object.keys(draftCampaigns), [draftCampaigns])
  useEffect(() => {
    if (draftCampaignIds.length === 0) { setLearnersByCampaign({}); return }
    getLearnerCountsByCampaign(draftCampaignIds)
      .then(setLearnersByCampaign)
      .catch(() => {})
  }, [draftCampaignIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Alcance total estimado: asignaciones individuales + aprendices de las
  // campañas marcadas. Las personas que ya tienen fila propia no se cuentan dos
  // veces solo si están en `profiles` (la vista del capacitador es su campaña).
  const audienceReach = useMemo(() => {
    const direct = Object.keys(draftUsers)
    const campaignLearners = draftCampaignIds.reduce(
      (sum, id) => sum + (learnersByCampaign[id] ?? 0),
      0,
    )
    // Descuento los individuales que ya vienen incluidos en una campaña marcada.
    const overlap = direct.filter((uid) => {
      const p = profiles.find((x) => x.id === uid)
      return !!p && p.role === 'learner' && !!p.campaign_id && draftCampaignIds.includes(p.campaign_id)
    }).length
    return {
      direct: direct.length,
      campaigns: draftCampaignIds.length,
      campaignLearners,
      total: direct.length + campaignLearners - overlap,
    }
  }, [draftUsers, draftCampaignIds, learnersByCampaign, profiles])

  const [libraryOpen, setLibraryOpen] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  // Cuánto del curso sigue solo en español (el contenido se genera es-only y se
  // traduce a pedido). Alimenta el contador del botón "Traducir".
  const refreshTranslationState = useCallback(async () => {
    if (!courseId) return
    try {
      const state = await getCourseTranslationState(courseId)
      setTransPending(state.pendingCount)
    } catch {
      setTransPending(0) // sin datos preferimos no mostrar un contador falso
    }
  }, [courseId])

  useEffect(() => { void refreshTranslationState() }, [refreshTranslationState])

  // Cuántos módulos de la campaña se pueden traer a este curso. A diferencia del
  // picker anterior (que solo listaba huérfanos), incluye los que ya están en OTRO
  // curso: a esos la biblioteca los copia en vez de moverlos, porque modules.course_id
  // es una FK directa y un módulo no puede estar en dos cursos a la vez.
  const libraryCount = useMemo(
    () => campaignModules.filter((m) => m.course_id !== courseId).length,
    [campaignModules, courseId],
  )

  // moduleId -> título del módulo del que se copió. Sale de campaignModules
  // (getModulesRaw hace select *) y no del embed del curso, que lista columnas
  // explícitas: pedir copied_from ahí rompería la vista del aprendiz mientras el
  // SQL 2026-07-16 no esté corrido.
  const lineage = useMemo(() => {
    const byId = new Map(campaignModules.map((m) => [m.id, m]))
    const out: Record<string, string> = {}
    for (const m of campaignModules) {
      if (m.copied_from) out[m.id] = byId.get(m.copied_from)?.title_es ?? ''
    }
    return out
  }, [campaignModules])

  // El capacitador asigna el curso a CUALQUIERA de sus campañas (casa +
  // colaboraciones), no solo a la casa: con varias campañas antes no podía
  // asignar el curso a la campaña donde realmente vive el contenido, y sin fila
  // en course_campaigns el curso no aparece en la vista de aprendiz.
  const visibleCampaigns = useMemo(() => {
    if (isSuperAdmin) return campaigns
    const allowed = new Set(accessibleCampaigns.map((c) => c.id))
    if (authCampaignId) allowed.add(authCampaignId)
    return campaigns.filter((c) => allowed.has(c.id))
  }, [campaigns, isSuperAdmin, accessibleCampaigns, authCampaignId])

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

  // Deshacer/rehacer de TODO el editor: la ficha, las condiciones y también las
  // asignaciones (destildar media campaña sin querer no tenía vuelta atrás).
  const undoHistory = useUndoHistory({
    state: { form, cond, simRule, simUnlockModuleId, worldRule, worldUnlockModuleId, draftCampaigns, draftUsers },
    apply: (s) => {
      setForm(s.form)
      setCond(s.cond)
      setSimRule(s.simRule)
      setSimUnlockModuleId(s.simUnlockModuleId)
      setWorldRule(s.worldRule)
      setWorldUnlockModuleId(s.worldUnlockModuleId)
      setDraftCampaigns(s.draftCampaigns)
      setDraftUsers(s.draftUsers)
    },
    enabled: !loading,
  })

  // Las asignaciones se editan en borrador y no las cubre `useUnsavedWork` (que
  // solo mira la ficha): sin esto, cerrar la pestaña con gente marcada y sin
  // guardar se las llevaba sin decir nada.
  useUnsavedFlag(assignDirty, t(TAB_LABEL_KEY.assign))

  // ¿Qué parte del editor tiene cambios? Alimenta la barra única de guardado y
  // el punto de las pestañas.
  const infoDirty = useMemo(
    () => !loading && fingerprint(form) !== baseline.info,
    [form, loading, baseline.info],
  )
  const evalDirty = useMemo(
    () =>
      !loading &&
      fingerprint({ cond, simRule, simUnlockModuleId, worldRule, worldUnlockModuleId }) !==
        baseline.evaluation,
    [cond, simRule, simUnlockModuleId, worldRule, worldUnlockModuleId, loading, baseline.evaluation],
  )

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
      // Independiente de los resultados: si el SQL no está corrido devuelve [].
      getCourseRecertStatus(courseId)
        .then(setRecert)
        .catch(() => setRecert([]))
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

  // Aprendices ya certificados a los que les falta ver contenido publicado
  // después de su certificado. Informativo: no invalida nada por sí solo.
  // OJO: van ANTES del early return de carga. Estaban después, así que el
  // render de "cargando" ejecutaba 2 hooks menos que el render con datos y
  // React reventaba con "rendered more hooks than during the previous render".
  const outdatedCerts = useMemo(
    () => recert.filter((r) => r.new_module_ids.length > 0),
    [recert],
  )
  const pendingRecert = useMemo(() => recert.filter((r) => r.needs_recert), [recert])

  // ── Cirugía de módulos ────────────────────────────────────────────────────
  // También ANTES del early return, por lo mismo que los dos de arriba.

  // Cuántas secciones tiene cada módulo. Sale de la biblioteca de la campaña
  // (que trae `module_sections(id)`), porque el embed del curso no las lista y
  // sin ese número no se sabe si un módulo se puede separar.
  const sectionCountById = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of campaignModules) out[m.id] = m.module_sections?.length ?? 0
    return out
  }, [campaignModules])

  /**
   * Los módulos elegidos SIEMPRE se unen en el orden del curso, no en el orden
   * en que se marcaron: es lo que el aprendiz va a leer y lo que el capacitador
   * ve en pantalla.
   */
  const mergeOrder = useMemo(
    () => (course?.modules ?? []).filter((m) => selectedForMerge.includes(m.id)).map((m) => m.id),
    [course, selectedForMerge],
  )

  /** Cierra la operación: refresca el curso y limpia la selección. */
  const afterSurgery = useCallback(async () => {
    setSelectedForMerge([])
    invalidateModulesCache()
    invalidateLearnerCoursesCache()
    await Promise.all([reload(), reloadModules()])
  }, [reload, reloadModules])

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

  /**
   * Guarda la ficha. `silent` lo usa la barra única de guardado, que puede
   * escribir varias partes de una vez y da UN solo acuse al final (tres toasts
   * seguidos por una sola pulsación se leen como tres guardados distintos).
   * Devuelve si de verdad quedó guardado.
   */
  const handleSaveInfo = async (opts?: { silent?: boolean }): Promise<boolean> => {
    // ¿Sigue siendo la ficha que se abrió? Si otra pestaña la guardó mientras
    // tanto, se pregunta en vez de pisarla.
    if (courseId && !(await staleGuard.isSafeToSave())) {
      const overwrite = await confirm({
        title: t('common.stale.confirm_title'),
        description: t('common.stale.confirm_body'),
        confirmLabel: t('common.stale.confirm_overwrite'),
      })
      if (!overwrite) return false
    }

    setSaving(true)
    try {
      await updateCourse(course.id, {
        title_es: form.title_es.trim() || course.title_es,
        title_en: form.title_en.trim() || null,
        title_pt: form.title_pt.trim() || null,
        // Preserva saltos y espacio arriba/abajo tal cual se escribió (solo se
        // descarta si es puro espacio en blanco). Un .trim() aquí borraba el
        // "margen" que el capacitador agrega con el editor enriquecido.
        description_es: form.description_es.trim() ? form.description_es : null,
        description_en: form.description_en.trim() ? form.description_en : null,
        description_pt: form.description_pt.trim() ? form.description_pt : null,
        color: form.color,
        level: form.level,
        category: form.category.trim() || null,
        visibility: form.visibility,
        is_shareable: form.is_shareable,
        cover_fit: form.cover_fit,
      })
      if (!opts?.silent) toast.success(t('admin.courses.saved_ok'))
      invalidateModulesCache()
      invalidateLearnerCoursesCache() // que la portada del aprendiz refleje el cambio (no quede en caché)
      await reload()
      unsaved.markSaved()
      return true
    } catch (e) {
      console.error('[CourseEditor] handleSaveInfo', e)
      toast.error(t('admin.courses.error_save'), errMsg(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  // Vista previa del curso: guarda la ficha (para que el modal muestre lo que
  // acabas de escribir) y abre la página real del aprendiz en el modal.
  const handleOpenPreview = async () => {
    setOpeningPreview(true)
    try {
      await handleSaveInfo()
    } finally {
      setOpeningPreview(false)
    }
    setPreviewOpen(true)
  }

  // Mueve el curso (y todo su contenido: módulos, mundo, simuladores) a otra
  // campaña. Resuelve el caso del capacitador que creó el curso en la campaña
  // equivocada y no tenía cómo reubicarlo.
  const handleMoveCampaign = async () => {
    if (!moveTargetId || moveTargetId === course.campaign_id) return
    const targetName = accessibleCampaigns.find((c) => c.id === moveTargetId)?.name ?? ''
    const ok = await confirm({
      title: t('admin.courses.move_campaign_title'),
      description: t('admin.courses.move_campaign_confirm', { name: targetName }),
    })
    if (!ok) return
    setMovingCampaign(true)
    try {
      await moveCourseToCampaign(course.id, moveTargetId)
      invalidateModulesCache()
      toast.success(t('admin.courses.move_campaign_ok', { name: targetName }))
      setMoveTargetId('')
      await reload()
    } catch (e) {
      console.error('[CourseEditor] handleMoveCampaign', e)
      toast.error(t('admin.courses.move_campaign_error'), errMsg(e))
    } finally {
      setMovingCampaign(false)
    }
  }

  const handleTogglePublished = async () => {
    const next = !course.is_published
    // Al publicar el curso el aprendiz ve sus módulos publicados: no se publica
    // si alguno tiene quiz de video en 0:00 (nunca se disparan).
    if (next && !(await ensureVideoQuizTimes(course.modules.map((m) => m.id)))) return
    try {
      await updateCourse(course.id, { is_published: next })
      setCourse({ ...course, is_published: next })
      invalidateModulesCache()

      // Publicar debe bastar para que el curso aparezca en la vista de aprendiz.
      // Un curso publicado sin fila en course_campaigns (ni asignación directa)
      // queda invisible para todos, que era la confusión de "lo publiqué y no
      // le sale a nadie". Al publicar por primera vez lo asignamos a su propia
      // campaña; el capacitador puede quitarla o añadir más en "Asignar".
      let assignedNow = false
      if (next && course.campaign_id && courseCampaigns.length === 0 && assignments.length === 0) {
        try {
          await setCourseCampaign(course.id, course.campaign_id, false)
          const rows = await getCourseCampaigns(course.id)
          setCourseCampaigns(rows)
          setDraftCampaigns(Object.fromEntries(rows.map((r) => [r.campaign_id, r.is_mandatory])))
          assignedNow = true
        } catch (e) {
          // No es fatal: el curso queda publicado y el aviso de "sin asignar"
          // le dice al capacitador que lo haga a mano.
          console.error('[CourseEditor] auto-assign on publish', e)
        }
      }

      if (!next) toast.success(t('admin.courses.course_unpublished'))
      else if (assignedNow) {
        toast.success(
          t('admin.courses.course_published'),
          t('admin.courses.published_auto_assigned', {
            name: campaigns.find((c) => c.id === course.campaign_id)?.name ?? '',
          }),
        )
      } else toast.success(t('admin.courses.course_published'))
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const handlePublishAllModules = async () => {
    const pending = course.modules.filter((m) => !m.is_published)
    // No se publica con quiz de video en 0:00 (nunca se disparan).
    if (!(await ensureVideoQuizTimes(pending.map((m) => m.id)))) return
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
    // No se publica con quiz de video en 0:00 (nunca se disparan).
    const pending = course.modules.filter((m) => !m.is_published)
    if (!(await ensureVideoQuizTimes(pending.map((m) => m.id)))) return
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

  // Enlaza un mundo suelto existente a este curso (sin tocar sus regiones).
  const handleLinkWorld = async (worldId: string) => {
    if (!worldId || !course) return
    setLinkingWorld(true)
    try {
      const linked = await linkWorldToCourse(worldId, course.id)
      setWorld(linked)
      toast.success(t('admin.courses.world_linked', { defaultValue: 'Mundo enlazado al curso' }))
    } catch (e) {
      toast.error(t('admin.courses.error_save'), (e as Error)?.message)
    } finally {
      setLinkingWorld(false)
    }
  }

  // Desenlaza el mundo del curso (sigue existiendo como mundo suelto en Mundos).
  const handleUnlinkWorld = async () => {
    if (!course || !world) return
    const ok = await confirm({
      title: t('admin.courses.world_unlink_title', { defaultValue: 'Desenlazar mundo' }),
      description: t('admin.courses.world_unlink_desc', { name: world.name, defaultValue: `“${world.name}” dejará de estar ligado a este curso, pero no se borra: seguirá disponible en Mundos como mundo suelto.` }),
    })
    if (!ok) return
    setLinkingWorld(true)
    try {
      await unlinkWorldFromCourse(course.id)
      setWorld(null)
      toast.success(t('admin.courses.world_unlinked', { defaultValue: 'Mundo desenlazado' }))
    } catch (e) {
      toast.error(t('admin.courses.error_save'), (e as Error)?.message)
    } finally {
      setLinkingWorld(false)
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

  const handleCoverUpload = async (file: File, slot: CoverSlot) => {
    setUploadingSlot(slot)
    try {
      const url = await uploadCourseCover(file, course.id, course.campaign_id)
      await updateCourse(course.id, { [slot]: url })
      setCourse({ ...course, [slot]: url })
      toast.success(t('admin.courses.cover_ok'))
    } catch (e) {
      console.error('[CourseEditor] handleCoverUpload', e)
      toast.error(t('admin.courses.error_save'), errMsg(e))
    } finally {
      setUploadingSlot(null)
    }
  }

  const handleCoverRemove = async (slot: CoverSlot) => {
    try {
      await updateCourse(course.id, { [slot]: null })
      setCourse({ ...course, [slot]: null })
    } catch (e) {
      toast.error(t('admin.courses.error_save'), errMsg(e))
    }
  }

  // Duplica un módulo dentro de este mismo curso (variantes de un contenido).
  // Copiar desde otro curso se hace en la biblioteca (ModuleLibraryModal).
  const handleDuplicateModule = async (moduleId: string, title: string) => {
    setDuplicatingId(moduleId)
    try {
      const maxOrder = Math.max(0, ...course.modules.map((m) => m.course_sort_order))
      await cloneModule(moduleId, {
        targetCourseId: course.id,
        courseSortOrder: maxOrder + 1,
        titleSuffix: t('admin.courses.library.copy_suffix'),
      })
      toast.success(t('admin.courses.library.copied', { title }))
      invalidateModulesCache()
      await reload()
    } catch (e) {
      console.error('[CourseEditor] handleDuplicateModule', e)
      toast.error(t('admin.courses.library.copy_error'), errMsg(e))
    } finally {
      setDuplicatingId(null)
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
    // No se publica con quiz de video en 0:00 (nunca se disparan).
    if (isPublished && !(await ensureVideoQuizTimes([moduleId]))) return
    try {
      await toggleModulePublished(moduleId, isPublished)
      invalidateModulesCache()
      await reload()
    } catch {
      toast.error(t('admin.courses.error_save'))
    }
  }

  const toggleMergeSelection = (moduleId: string) => {
    setSelectedForMerge((prev) =>
      prev.includes(moduleId) ? prev.filter((id) => id !== moduleId) : [...prev, moduleId],
    )
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

  const saveAssignments = async (opts?: { silent?: boolean }): Promise<boolean> => {
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
      if (!opts?.silent) toast.success(t('admin.courses.assign_saved_ok'))
      return true
    } catch {
      toast.error(t('admin.courses.error_save'))
      return false
    } finally {
      setSavingAssign(false)
    }
  }

  const handleSaveConditions = async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!course) return false
    setSavingEval(true)
    try {
      await updateCourse(course.id, {
        cert_conditions: cond,
        sim_unlock_rule: simRule,
        sim_unlock_module_id: simRule === 'after_module' ? simUnlockModuleId : null,
        world_unlock_rule: worldRule,
        world_unlock_module_id: worldRule === 'after_module' ? worldUnlockModuleId : null,
      })
      if (!opts?.silent) toast.success(t('admin.courses.saved_ok'))
      // La vista de aprendiz sirve los cursos desde una caché en memoria: sin
      // esto, cambiar la regla de desbloqueo y pasar a "Ver como aprendiz" (que
      // navega dentro de la misma pestaña) seguía leyendo la regla vieja y
      // parecía que el ajuste no hacía nada.
      invalidateLearnerCoursesCache()
      await reload()
      return true
    } catch {
      toast.error(t('admin.courses.error_save'))
      return false
    } finally {
      setSavingEval(false)
    }
  }

  /**
   * Guarda de una vez todo lo que esté pendiente, sin importar en qué pestaña
   * se hizo el cambio.
   *
   * Antes había cinco botones "Guardar" repartidos por el editor (ficha,
   * asignaciones, condiciones del certificado, mundo y simulador), cada uno
   * guardando solo su trozo. Cambiar dos cosas en pestañas distintas y pulsar
   * uno de ellos guardaba una y perdía la otra en silencio.
   */
  const saveAll = async () => {
    // Orden deliberado: primero la ficha (es la que puede toparse con el aviso
    // de "otra pestaña lo guardó" y cancelar todo el guardado).
    if (infoDirty && !(await handleSaveInfo({ silent: true }))) return
    if (evalDirty && !(await handleSaveConditions({ silent: true }))) return
    if (assignDirty && !(await saveAssignments({ silent: true }))) return
    toast.success(t('admin.courses.saved_ok'))
  }

  /** Lo que la barra de guardado tiene que ofrecer ahora mismo. */
  const pendingSaves = [
    infoDirty && { id: 'info', label: t(TAB_LABEL_KEY.info), onFocus: () => setTab('info') },
    assignDirty && { id: 'assign', label: t(TAB_LABEL_KEY.assign), onFocus: () => setTab('assign') },
    evalDirty && { id: 'evaluation', label: t(TAB_LABEL_KEY.evaluation), onFocus: () => setTab('evaluation') },
  ].filter(Boolean) as Array<{ id: string; label: string; onFocus: () => void }>

  /** Pestañas con cambios pendientes, para el punto del rótulo. */
  const dirtyTabs = new Set<Tab>(pendingSaves.map((p) => p.id as Tab))

  /**
   * Pide recertificación a TODO el curso. Es deliberadamente explícito y con
   * confirmación: marca el corte y deja desactualizados los certificados
   * anteriores. No los borra — siguen siendo verificables públicamente.
   */
  const handleRequestRecert = async () => {
    if (!courseId) return
    const ok = await confirm({
      title: t('admin.courses.recert_confirm_title'),
      description: t('admin.courses.recert_confirm_msg', { count: recert.length }),
      confirmLabel: t('admin.courses.recert_confirm_cta'),
      tone: 'default', // no es destructivo: los certificados viejos siguen válidos
    })
    if (!ok) return
    setRecertBusy(true)
    try {
      const affected = await requestCourseRecertification(courseId)
      toast.success(t('admin.courses.recert_done', { count: affected }))
      setRecert(await getCourseRecertStatus(courseId))
    } catch {
      toast.error(t('admin.courses.recert_error'))
    } finally {
      setRecertBusy(false)
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
    { id: 'info', label: t(TAB_LABEL_KEY.info), icon: Info },
    { id: 'modules', label: t(TAB_LABEL_KEY.modules), icon: BookOpen },
    { id: 'assign', label: t(TAB_LABEL_KEY.assign), icon: Users },
    { id: 'evaluation', label: t(TAB_LABEL_KEY.evaluation), icon: Award },
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
          {coeditors.length > 0 && (
            <div className="pr-2 mr-1 border-r border-glass-border/10">
              <PresenceStack peers={coeditors} size={30} />
            </div>
          )}
          {/* Vista previa: la página del curso del aprendiz, en un modal, sin
              salir del editor. Funciona aunque el curso siga en borrador. */}
          <Tooltip label={t('admin.preview.button_hint')} className="shrink-0" maxWidth={230}>
            <Button
              variant="glass"
              size="sm"
              onClick={handleOpenPreview}
              disabled={openingPreview}
              className="flex items-center gap-1.5 disabled:pointer-events-none"
            >
              {openingPreview
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Monitor className="h-3.5 w-3.5" />}
              {t('admin.preview.button')}
            </Button>
          </Tooltip>

          <Tooltip label={t('admin.courses.tip_view_world')} className="shrink-0" maxWidth={230}>
            <Button
              variant="glass"
              size="sm"
              onClick={handleViewWorld}
              disabled={openingWorld}
              className="flex items-center gap-1.5 disabled:pointer-events-none"
            >
              <Globe className="h-3.5 w-3.5" />
              {openingWorld ? t('admin.courses.opening_world') : t('admin.courses.view_world')}
            </Button>
          </Tooltip>

          {/* Traducción diferida: el contenido nace en español y se traduce una
              sola vez, cuando el capacitador da el curso por terminado. Publicar
              el curso ES esa señal de "terminado": mientras esté en borrador el
              botón queda bloqueado para no pagar traducciones que se reescriben. */}
          <Tooltip
            label={
              !course.is_published
                ? t('admin.translate.locked_hint')
                : transPending > 0
                  ? t('admin.translate.pending_hint', { n: transPending })
                  : t('admin.translate.ready_hint')
            }
            className="shrink-0"
            maxWidth={260}
          >
            <Button
              variant="glass"
              size="sm"
              onClick={() => setTranslateOpen(true)}
              disabled={!course.is_published}
              className="flex items-center gap-1.5 disabled:pointer-events-none"
            >
              <Languages className="h-3.5 w-3.5" />
              {t('admin.translate.button')}
              {course.is_published && transPending > 0 && (
                <span className="ml-0.5 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
                  {transPending}
                </span>
              )}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="mb-3 -mt-2">
        <EditingBanner coeditors={coeditors} />
      </div>

      {staleGuard.stale && (
        <StaleNotice
          className="mb-3"
          onReload={async () => {
            await reload()
            unsaved.markSaved()
            toast.success(t('common.stale.reloaded'))
          }}
          onDismiss={staleGuard.dismiss}
        />
      )}

      {/* Recordatorio permanente: lo generado con IA se revisa antes de publicar. */}
      <AiReviewNotice variant="inline" className="mb-4" />

      {/* Barra compacta de publicación: estado del curso + módulos + acción única.
          El mundo (gamificación) se gestiona aparte, en el botón "Ver mundo" del header. */}
      {(() => {
        const total = course.modules.length
        const pubModules = course.modules.filter((m) => m.is_published).length
        const modulesAllPublished = total === 0 || pubModules === total
        // El simulador es opcional: solo cuenta si hay escenarios ligados al curso.
        const simAllPublished = unpublishedLinkedCount === 0
        const everythingPublished = course.is_published && modulesAllPublished && simAllPublished
        // Quién puede ver el curso: campañas asignadas, personas asignadas o
        // catálogo abierto. Espeja el filtro de getLearnerCourses().
        const hasAudience =
          courseCampaigns.length > 0 || assignments.length > 0 || course.visibility === 'catalog'
        return (
          <div className="rounded-2xl border border-line bg-surface px-4 py-3 mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip label={t('admin.courses.publish_panel_hint')} maxWidth={250}>
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  {t('admin.courses.publish_panel_title')}
                </span>
              </Tooltip>

              {/* Chip: Curso */}
              <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-1.5">
                <GraduationCap className="h-4 w-4 text-text-muted shrink-0" />
                <span className="text-[13px] font-medium text-text">{t('admin.courses.publish_course')}</span>
                <Tooltip label={t('admin.courses.tip_publish_course')} maxWidth={250}>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    course.is_published ? 'bg-primary/10 text-primary' : 'bg-glass/8 text-text-muted')}>
                    {course.is_published ? t('admin.courses.published') : t('admin.courses.draft')}
                  </span>
                </Tooltip>
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
                  <>
                    <button
                      onClick={handleViewWorld}
                      disabled={openingWorld || linkingWorld}
                      className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium text-text-muted border border-line transition-colors hover:text-text disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3" /> {t('admin.courses.world_create')}
                    </button>
                    {/* Enlazar un mundo suelto ya existente de la campaña. */}
                    {linkableWorlds.length > 0 && (
                      <div className="min-w-[180px]">
                        <Select
                          value=""
                          onChange={handleLinkWorld}
                          disabled={linkingWorld}
                          placeholder={t('admin.courses.world_link_existing', { defaultValue: 'Enlazar existente…' })}
                          options={[
                            { value: '', label: t('admin.courses.world_link_existing', { defaultValue: 'Enlazar existente…' }) },
                            ...linkableWorlds.map((w) => ({ value: w.id, label: `${w.icon ?? '🌍'} ${w.name}` })),
                          ]}
                        />
                      </div>
                    )}
                  </>
                ) : world.status === 'published' ? (
                  <>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {t('admin.courses.published')}
                    </span>
                    <Toggle on onClick={handleToggleWorldPublished} label={t('admin.courses.publish_world')} />
                    <button
                      onClick={() => navigate(`/admin/worlds/${world.id}`)}
                      className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium transition-colors"
                      style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                    >
                      <MapIcon className="h-3 w-3" /> {t('admin.courses.world_open', { defaultValue: 'Abrir mundo' })}
                    </button>
                    <Tooltip label={t('admin.courses.tip_unlink_world')} className="shrink-0" maxWidth={230}>
                      <button
                        onClick={handleUnlinkWorld}
                        disabled={linkingWorld}
                        aria-label={t('admin.courses.world_unlink_title', { defaultValue: 'Desenlazar mundo' })}
                        className="flex items-center justify-center h-6 w-6 rounded-lg text-text-muted border border-line transition-colors hover:text-danger hover:border-danger/40 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Unlink className="h-3 w-3" />
                      </button>
                    </Tooltip>
                  </>
                ) : (
                  <>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                      {t('admin.courses.draft')}
                    </span>
                    <button
                      onClick={() => navigate(`/admin/worlds/${world.id}`)}
                      className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium text-text-muted border border-line transition-colors hover:text-text"
                    >
                      <MapIcon className="h-3 w-3" /> {t('admin.courses.world_open', { defaultValue: 'Abrir mundo' })}
                    </button>
                    <button
                      onClick={handleToggleWorldPublished}
                      disabled={publishingWorld}
                      className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                      style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                    >
                      <Eye className="h-3 w-3" /> {t('admin.courses.world_publish')}
                    </button>
                    <Tooltip label={t('admin.courses.tip_unlink_world')} className="shrink-0" maxWidth={230}>
                      <button
                        onClick={handleUnlinkWorld}
                        disabled={linkingWorld}
                        aria-label={t('admin.courses.world_unlink_title', { defaultValue: 'Desenlazar mundo' })}
                        className="flex items-center justify-center h-6 w-6 rounded-lg text-text-muted border border-line transition-colors hover:text-danger hover:border-danger/40 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Unlink className="h-3 w-3" />
                      </button>
                    </Tooltip>
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

            {/* Aviso clave: publicado ≠ visible. Sin campañas ni personas
                asignadas (y sin catálogo abierto) el curso no le aparece a
                NADIE en la vista de aprendiz. */}
            {course.is_published && !hasAudience && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {t('admin.courses.no_audience_warn')}
                </p>
                <button
                  onClick={() => setTab('assign')}
                  className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-medium transition-colors"
                  style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                >
                  <Users className="h-3 w-3" /> {t('admin.courses.no_audience_cta')}
                </button>
              </div>
            )}

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
            <h2 className="text-[13px] font-semibold text-text">{t('admin.courses.stats_your_learners')}</h2>
            {stats.is_owner && stats.global_enrolled > stats.enrolled && (
              <span className="text-[11px] text-text-subtle">
                {t('admin.courses.stats_global_reach', { n: stats.global_enrolled })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'enrolled', label: t('admin.courses.stats_enrolled'), value: stats.enrolled },
              { id: 'completed', label: t('admin.courses.stats_completed'), value: `${stats.completion_pct}%` },
              { id: 'avg', label: t('admin.courses.stats_avg_progress'), value: `${stats.avg_progress_pct}%` },
            ].map((s) => (
              <GlassCard key={s.id} intensity="subtle" rounded="2xl" className="px-4 py-3">
                <div className="text-[22px] font-bold tabular-nums text-text leading-none">{s.value}</div>
                <div className="text-[11px] text-text-muted mt-1.5">{s.label}</div>
              </GlassCard>
            ))}
          </div>
          {/* De dónde sale el número de matriculados: sin este desglose, la lista
              de asignaciones individuales parecía no cuadrar con el contador. */}
          {(stats.campaign_reach > 0 || stats.staff_preview > 0) && (
            <p className="text-[11px] text-text-subtle mt-2">
              {stats.campaign_reach > 0 &&
                t('admin.courses.stats_breakdown', {
                  direct: stats.direct_assigned,
                  campaign: stats.campaign_reach,
                })}
              {stats.campaign_reach > 0 && stats.staff_preview > 0 && ' · '}
              {stats.staff_preview > 0 &&
                t('admin.courses.stats_staff_excluded', { n: stats.staff_preview })}
            </p>
          )}
        </div>
      )}

      {/* Tabs. El subrayado es una sola pieza que se desliza entre pestañas
          (layoutId): deja ver de dónde vienes, en vez de parpadear de sitio.
          El punto ámbar marca dónde quedaron cambios sin guardar. */}
      <div className="flex gap-1 mb-6 border-b border-line">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'relative flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium -mb-px transition-colors',
              tab === id ? 'text-primary' : 'text-text-muted hover:text-text',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {dirtyTabs.has(id) && <DirtyDot />}
            {tab === id && (
              <motion.span
                layoutId="course-tab-underline"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Información ── */}
      {tab === 'info' && (
        <div className="space-y-5">
          {/* Portada + vista previa (cómo se verá en la tarjeta, antes de publicar) */}
          <GlassCard intensity="subtle" rounded="2xl" className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-[13px] font-semibold text-text">{t('admin.courses.cover_title')}</h2>
                <p className="text-[11px] text-text-muted mt-0.5">{t('admin.courses.cover_preview_hint')}</p>
                <p className="text-[11px] text-text-subtle mt-1">{t('admin.courses.cover_size_hint')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Ajuste: Rellenar (recorta) vs Ajustar (muestra completa, sin deformar) — aplica a todas las variantes */}
                {courseHasCover(course) && (
                  <div className="flex rounded-lg border border-line p-0.5">
                    {(['cover', 'contain'] as const).map((fit) => (
                      <button
                        key={fit}
                        type="button"
                        onClick={() => setForm({ ...form, cover_fit: fit })}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                          form.cover_fit === fit ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text',
                        )}
                      >
                        {t(`admin.courses.cover_fit_${fit}`)}
                      </button>
                    ))}
                  </div>
                )}
                {/* Un solo input; coverSlotRef recuerda qué variante se está subiendo */}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleCoverUpload(f, coverSlotRef.current)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>

            {/* Un slot de subida por tipo de pantalla (art-direction). */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {COVER_SLOTS.map(({ slot, labelKey, size, range, box }) => {
                const url = course[slot]
                const busy = uploadingSlot === slot
                return (
                  <div key={slot} className="rounded-xl border border-line p-2 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-[11px] font-semibold text-text">{t(labelKey)}</span>
                      <span className="text-[10px] text-text-subtle">{range}</span>
                    </div>
                    <div
                      className={cn('relative w-full min-h-0 overflow-hidden rounded-lg border border-line', box)}
                      style={{ background: url ? undefined : `linear-gradient(120deg, ${form.color}22, ${form.color}0A)` }}
                    >
                      {url && (
                        <img
                          src={url}
                          alt=""
                          className={cn('h-full w-full', form.cover_fit === 'contain' ? 'object-contain' : 'object-cover')}
                        />
                      )}
                      {busy && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-text-subtle text-center">{size} px</p>
                    <div className="flex gap-1">
                      <Button
                        variant="glass"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          coverSlotRef.current = slot
                          coverInputRef.current?.click()
                        }}
                        className="flex-1 flex items-center justify-center gap-1 !px-2 !py-1 text-[11px]"
                      >
                        <ImagePlus className="h-3 w-3" />
                        {url ? t('admin.courses.cover_replace') : t('admin.courses.upload_cover')}
                      </Button>
                      {url && (
                        <Tooltip label={t('common.remove')} className="shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCoverRemove(slot)}
                            className="rounded-md border border-line px-1.5 text-text-muted hover:text-danger hover:border-danger/40 transition-colors"
                            aria-label={t('common.remove')}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Simulación de la tarjeta real: mismo alto/proporción + insignia */}
            <div className="relative w-full max-w-sm">
              <div
                className={cn('rounded-xl overflow-hidden border border-line', COVER_BOX)}
                style={{
                  background: courseHasCover(course)
                    ? form.cover_fit === 'contain'
                      ? `linear-gradient(120deg, ${form.color}22, ${form.color}0A)`
                      : undefined
                    : `linear-gradient(120deg, ${form.color}33, ${form.color}0D)`,
                }}
              >
                <CourseCover
                  course={course}
                  className={cn('h-full w-full', form.cover_fit === 'contain' ? 'object-contain' : 'object-cover')}
                />
              </div>
              <div
                className="absolute -bottom-4 left-4 flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-md"
                style={{ background: form.color }}
              >
                <GraduationCap className="h-5 w-5" />
              </div>
            </div>
            <div className="h-3" aria-hidden />
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
              <RichTextArea
                value={form[`description_${lang}`]}
                onChange={(v) => setForm({ ...form, [`description_${lang}`]: v })}
                rows={5}
              />
              <p className="mt-1.5 text-[11px] text-text-subtle">
                {t('admin.courses.description_format_hint', {
                  defaultValue: 'Usa la barra para poner negrita, cursiva, títulos o listas. Deja un renglón en blanco para separar párrafos.',
                })}
              </p>
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

          </GlassCard>

          {/* Mover el curso a otra campaña. Solo aparece si el usuario tiene más de
              una campaña a la que moverlo (capacitador multi-campaña o superadmin). */}
          {accessibleCampaigns.length > 1 && (
            <GlassCard intensity="subtle" rounded="2xl" className="p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-glass/8 text-text-muted">
                  <ArrowLeftRight className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold text-text">{t('admin.courses.move_campaign_title')}</h2>
                  <p className="text-[11px] text-text-muted mt-0.5">{t('admin.courses.move_campaign_hint')}</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={moveTargetId}
                    onChange={setMoveTargetId}
                    disabled={movingCampaign}
                    placeholder={t('admin.courses.move_campaign_placeholder')}
                    options={[
                      { value: '', label: t('admin.courses.move_campaign_placeholder') },
                      ...accessibleCampaigns
                        .filter((c) => c.id !== course.campaign_id)
                        .map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                </div>
                <Button
                  variant="glass"
                  size="sm"
                  onClick={handleMoveCampaign}
                  disabled={movingCampaign || !moveTargetId || moveTargetId === course.campaign_id}
                  className="flex items-center gap-1.5 shrink-0"
                >
                  {movingCampaign ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
                  {t('admin.courses.move_campaign_action')}
                </Button>
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {/* ── Módulos ── */}
      {tab === 'modules' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-[14px] font-semibold text-text mb-1">
              {t('admin.courses.course_modules_title')}
            </h2>
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
                {course.modules.map((mod, idx) => {
                  const picked = selectedForMerge.includes(mod.id)
                  const sectionCount = sectionCountById[mod.id] ?? 0
                  return (
                  <GlassCard
                    key={mod.id}
                    intensity="subtle"
                    rounded="2xl"
                    padding="none"
                    className={cn(
                      'transition-colors',
                      picked && 'border-brand-green/45 bg-brand-green/[0.06]',
                    )}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Marcar dos o más módulos hace aparecer la barra de unir.
                          Sin modos ni menús: la casilla está siempre a la vista. */}
                      {course.modules.length > 1 && (
                        <Tooltip label={t('admin.courses.tip_select_merge')} className="shrink-0">
                          <button
                            onClick={() => toggleMergeSelection(mod.id)}
                            role="checkbox"
                            aria-checked={picked}
                            aria-label={t('admin.surgery.select_for_merge')}
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                              picked
                                ? 'border-brand-green bg-brand-green/20 text-brand-green'
                                : 'border-line text-transparent hover:border-brand-green/50',
                            )}
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      )}
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
                          {mod.id in lineage && (
                            <span
                              title={
                                lineage[mod.id]
                                  ? t('admin.courses.library.copy_of', { title: lineage[mod.id] })
                                  : t('admin.courses.library.copy_of_deleted')
                              }
                            >
                              <NeonBadge color="magenta">{t('admin.courses.library.copy_badge')}</NeonBadge>
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-text-subtle">{mod.duration_min} min</span>
                      </div>
                      {/* Fila de acciones: casi todo son iconos sueltos, así que
                          cada uno lleva su globo explicando QUÉ pasa al pulsarlo.
                          Los deshabilitados llevan `disabled:pointer-events-none`
                          a propósito: sin eso el navegador se traga el hover del
                          botón inerte y el globo —que es justo el que explica por
                          qué está apagado— no llegaría a salir nunca. */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        {mod.is_published ? (
                          <Tooltip label={t('admin.courses.tip_unpublish_module')} className="shrink-0">
                            <button
                              onClick={() => handleToggleModulePublished(mod.id, false)}
                              aria-label={t('admin.modules.unpublish')}
                              className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </Tooltip>
                        ) : (
                          <Tooltip label={t('admin.courses.tip_publish_module')} className="shrink-0">
                            <button
                              onClick={() => handleToggleModulePublished(mod.id, true)}
                              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition-colors"
                              style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
                            >
                              <Eye className="h-3.5 w-3.5" /> {t('admin.courses.publish')}
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip label={t('admin.courses.tip_move_up')} className="shrink-0">
                          <button
                            onClick={() => handleMoveModule(idx, -1)}
                            disabled={idx === 0}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            aria-label={t('admin.courses.move_up')}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('admin.courses.tip_move_down')} className="shrink-0">
                          <button
                            onClick={() => handleMoveModule(idx, 1)}
                            disabled={idx === course.modules.length - 1}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            aria-label={t('admin.courses.move_down')}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        {/* Separar: solo tiene sentido con 2+ secciones — con una
                            sola no hay por dónde cortar, y el globo lo dice. */}
                        <Tooltip
                          label={
                            sectionCount < 2
                              ? t('admin.surgery.too_short')
                              : t('admin.surgery.split_action_hint')
                          }
                          className="shrink-0"
                          maxWidth={220}
                        >
                          <button
                            onClick={() => setSplitModuleId(mod.id)}
                            disabled={sectionCount < 2}
                            aria-label={t('admin.surgery.split_action')}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-brand-magenta hover:bg-brand-magenta/8 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                          >
                            <Scissors className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip
                          label={t('admin.courses.library.duplicate_hint')}
                          className="shrink-0"
                          maxWidth={220}
                        >
                          <button
                            onClick={() => handleDuplicateModule(mod.id, mod.title_es)}
                            disabled={duplicatingId !== null}
                            aria-label={t('admin.courses.library.duplicate')}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                          >
                            {duplicatingId === mod.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        </Tooltip>
                        <Tooltip label={t('admin.courses.tip_edit_module')} className="shrink-0" maxWidth={220}>
                          <Link
                            to={`/admin/modules/${mod.id}`}
                            className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                          >
                            {t('admin.courses.edit')}
                          </Link>
                        </Tooltip>
                        <Tooltip label={t('admin.courses.tip_remove_module')} className="shrink-0" maxWidth={230}>
                          <button
                            onClick={() => handleRemoveModule(mod.id)}
                            aria-label={t('admin.courses.remove_from_course')}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </GlassCard>
                  )
                })}
              </div>
            )}

            {/* Barra de unir: sube desde abajo en cuanto hay 2 marcados. Es el
                único momento en que la acción existe, así que no hay que
                explicarla — aparece justo cuando aplica. */}
            <AnimatePresence>
              {selectedForMerge.length >= 2 && (
                <motion.div
                  initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-green/35 bg-brand-green/[0.07] px-4 py-3"
                >
                  <Combine className="h-4 w-4 shrink-0 text-brand-green" />
                  <p className="flex-1 text-[12.5px] text-text">
                    {t('admin.surgery.selected_count', { n: selectedForMerge.length })}
                  </p>
                  <button
                    onClick={() => setSelectedForMerge([])}
                    className="h-9 rounded-xl px-3 text-[12px] font-medium text-text-muted transition-colors hover:bg-glass/8 hover:text-text"
                  >
                    {t('admin.surgery.clear_selection')}
                  </button>
                  <button
                    onClick={() => setMergeOpen(true)}
                    className="flex h-9 items-center gap-2 rounded-xl border border-brand-green/40 bg-brand-green/15 px-3.5 text-[12px] font-semibold text-brand-green transition-colors hover:bg-brand-green/25"
                  >
                    <Combine className="h-3.5 w-3.5" />
                    {t('admin.surgery.merge_action', { n: selectedForMerge.length })}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Dos formas de sumar contenido: traerlo de la biblioteca de la campaña
              (reutilizar/copiar) o crearlo de cero. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => setLibraryOpen(true)}
              className="group relative overflow-hidden rounded-2xl border border-line bg-glass/[0.03] p-4 text-left transition-colors hover:border-brand-green/40 hover:bg-glass/[0.06]"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-green/25 bg-brand-green/10 text-brand-green transition-transform group-hover:scale-105">
                  <Layers className="h-4 w-4" />
                </span>
                <span className="text-[14px] font-semibold text-text">
                  {t('admin.courses.library.open')}
                </span>
                {libraryCount > 0 && (
                  <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[11px] text-text-subtle">
                    {libraryCount}
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed text-text-muted">
                {t('admin.courses.library.open_hint')}
              </p>
            </button>

            <Link
              to={`/admin/modules/new?courseId=${course.id}`}
              className="group relative overflow-hidden rounded-2xl border border-line bg-glass/[0.03] p-4 transition-colors hover:border-brand-magenta/40 hover:bg-glass/[0.06]"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-magenta/25 bg-brand-magenta/10 text-brand-magenta transition-transform group-hover:scale-105">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="text-[14px] font-semibold text-text">
                  {t('admin.courses.new_module')}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-text-muted">
                {t('admin.courses.library.new_module_hint')}
              </p>
            </Link>
          </div>
        </div>
      )}

      {translateOpen && (
        <TranslationModal
          scope="course"
          id={course.id}
          title={course.title_es}
          campaignId={course.campaign_id}
          onClose={() => setTranslateOpen(false)}
          onDone={refreshTranslationState}
        />
      )}

      {previewOpen && (
        <LearnerPreviewModal
          path={`/courses/${course.slug}`}
          context={course.title_es}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* ── Separar un módulo en dos ── */}
      {splitModuleId && (
        <ModuleSplitModal
          moduleId={splitModuleId}
          campaignId={course.campaign_id}
          onClose={() => setSplitModuleId(null)}
          onApplied={async ({ pending }) => {
            setSplitModuleId(null)
            setPendingSurgery({ key: Date.now(), label: t('admin.surgery.split_done'), pending })
            await afterSurgery()
          }}
        />
      )}

      {/* ── Unir módulos ── */}
      {mergeOpen && mergeOrder.length >= 2 && (
        <ModuleMergeModal
          moduleIds={mergeOrder}
          campaignId={course.campaign_id}
          onClose={() => setMergeOpen(false)}
          onApplied={async ({ pending }) => {
            setMergeOpen(false)
            setPendingSurgery({
              key: Date.now(),
              label: t('admin.surgery.merge_done', { n: mergeOrder.length }),
              pending,
            })
            await afterSurgery()
          }}
        />
      )}

      {/* La franja de Deshacer se remonta con `key` para que cada operación
          arranque su propio contador desde cero. */}
      {pendingSurgery && (
        <SurgeryUndoBar
          key={pendingSurgery.key}
          label={pendingSurgery.label}
          onUndo={async () => {
            await pendingSurgery.pending.undo()
            await afterSurgery()
          }}
          onFinalize={async () => {
            await pendingSurgery.pending.finalize()
          }}
          onDone={() => setPendingSurgery(null)}
        />
      )}

      {libraryOpen && (
        <ModuleLibraryModal
          campaignId={course.campaign_id}
          courseId={course.id}
          courseTitle={course.title_es}
          modules={campaignModules}
          campaignNames={Object.fromEntries(accessibleCampaigns.map((c) => [c.id, c.name]))}
          canMoveAny={isSuperAdmin}
          onClose={() => setLibraryOpen(false)}
          onChanged={async () => {
            invalidateModulesCache()
            await Promise.all([reload(), reloadModules()])
          }}
        />
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
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <Eye className="h-4 w-4 text-text-muted" />
              {t('admin.courses.audience_title')}
            </h2>
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
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <FolderOpen className="h-4 w-4 text-text-muted" />
              {t('admin.courses.assign_campaigns_title')}
            </h2>
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
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <Users className="h-4 w-4 text-text-muted" />
              {t('admin.courses.assign_users_title')}
            </h2>
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
            {audienceReach.direct > 0 && (
              <p className="text-[12px] text-text-subtle mt-3">
                {t('admin.courses.assigned_users_count', { n: audienceReach.direct })}
              </p>
            )}
          </div>

          {/* Alcance total — el contador de arriba solo cuenta asignaciones una a
              una; quien recibe el curso por campaña no aparece en esa lista, y esa
              es la diferencia contra "Matriculados". */}
          {(audienceReach.direct > 0 || audienceReach.campaigns > 0 || form.visibility === 'catalog') && (
            <GlassCard intensity="subtle" rounded="2xl" className="px-4 py-3.5">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text mb-1.5">
                <Users className="h-4 w-4 text-text-muted" />
                {t('admin.courses.reach_title')}
              </h3>
              <p className="text-[20px] font-bold tabular-nums text-text leading-none mb-2">
                {t('admin.courses.reach_people', { n: audienceReach.total })}
              </p>
              <ul className="space-y-1 text-[12px] text-text-muted">
                <li>{t('admin.courses.reach_direct', { n: audienceReach.direct })}</li>
                {audienceReach.campaigns > 0 && (
                  <li>
                    {t('admin.courses.reach_campaigns', {
                      n: audienceReach.campaignLearners,
                      c: audienceReach.campaigns,
                    })}
                  </li>
                )}
                {form.visibility === 'catalog' && <li>{t('admin.courses.reach_catalog')}</li>}
              </ul>
            </GlassCard>
          )}

          {/* El guardado de las asignaciones vive en la barra única del pie. */}
        </div>
      )}

      {/* ── Evaluación: condiciones del certificado + simulador + resultados ── */}
      {tab === 'evaluation' && (
        <div className="space-y-10">
          {/* 1. Condiciones del certificado */}
          <div>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <Award className="h-4 w-4 text-text-muted" />
              {t('admin.courses.cert_conditions_title')}
            </h2>
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

          </div>

          {/* 2. Mundo del curso — juego aparte del simulador (son cosas distintas).
              Sección propia y visible: aquí el capacitador decide si el mundo
              queda libre o se desbloquea, sin que quede escondido bajo el simulador. */}
          {world && (
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
                <MapIcon className="h-4 w-4 text-text-muted" />
                {t('admin.courses.world_gate_title')}
              </h2>
              <p className="text-[12px] text-text-muted mb-4">{t('admin.courses.world_gate_hint')}</p>

              <div className="space-y-2.5">
                {([
                  { id: 'from_start', icon: Rocket },
                  { id: 'after_modules', icon: Check },
                  { id: 'after_module', icon: Flag },
                ] as const).map(({ id, icon: Icon }) => {
                  const selected = worldRule === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setWorldRule(id)}
                      className={cn(
                        'w-full flex items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all',
                        selected
                          ? 'border-primary/50 bg-primary/8 ring-1 ring-primary/20'
                          : 'border-line hover:border-primary/25 hover:bg-glass/5',
                      )}
                    >
                      <div className={cn(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                        selected ? 'bg-primary/15 text-primary' : 'bg-subtle text-text-muted',
                      )}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13.5px] font-semibold text-text">
                            {t(`admin.courses.world_gate_${id}_title`)}
                          </span>
                          {id === 'from_start' && (
                            <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              {t('admin.courses.world_gate_free_tag')}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-text-muted mt-0.5">
                          {t(`admin.courses.world_gate_${id}_desc`)}
                        </p>
                        {id === 'after_module' && selected && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <Select
                              className="mt-2.5"
                              value={worldUnlockModuleId ?? ''}
                              onChange={(v) => setWorldUnlockModuleId(v || null)}
                              placeholder={t('admin.courses.world_gate_pick_module')}
                              options={[
                                { value: '', label: t('admin.courses.world_gate_pick_module') },
                                ...course.modules.map((m) => ({ value: m.id, label: m.title_es })),
                              ]}
                            />
                          </div>
                        )}
                      </div>
                      <div className={cn(
                        'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                        selected ? 'border-primary bg-primary' : 'border-line',
                      )}>
                        {selected && <Check className="h-3 w-3 text-on-primary" />}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Vista previa de lo que verá el aprendiz */}
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
                {worldRule === 'from_start'
                  ? <Unlock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  : <Lock className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                <div className="text-[12px] text-text">
                  <span className="block font-medium text-text-muted mb-0.5">{t('admin.courses.world_gate_preview_label')}</span>
                  {worldRule === 'from_start' && t('admin.courses.world_gate_preview_from_start')}
                  {worldRule === 'after_modules' && t('admin.courses.world_gate_preview_after_modules')}
                  {worldRule === 'after_module' && (
                    worldUnlockModuleId
                      ? t('admin.courses.world_gate_preview_after_module', {
                          title: course.modules.find((m) => m.id === worldUnlockModuleId)?.title_es ?? '',
                        })
                      : t('admin.courses.world_gate_preview_after_module_generic')
                  )}
                </div>
              </div>

            </div>
          )}

          {/* 3. Simulador del curso — opcional y poco frecuente: sección plegable */}
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
                              <Tooltip label={t('admin.courses.sim_unpublished_hint')} maxWidth={250}>
                                <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                  {t('admin.courses.sim_unpublished_badge')}
                                </span>
                              </Tooltip>
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
                          <Tooltip label={t('admin.courses.tip_remove_sim')} className="shrink-0" maxWidth={230}>
                            <button
                              onClick={() => handleToggleScenarioCourse(s, false)}
                              className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8"
                              aria-label={t('admin.courses.remove_from_course')}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </Tooltip>
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
                              <Tooltip label={t('admin.courses.sim_unpublished_hint')} maxWidth={250}>
                                <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                  {t('admin.courses.sim_unpublished_badge')}
                                </span>
                              </Tooltip>
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
                          <Tooltip label={t('admin.courses.tip_remove_sim')} className="shrink-0" maxWidth={230}>
                            <button
                              onClick={() => handleToggleChoiceScenarioCourse(s, false)}
                              className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8"
                              aria-label={t('admin.courses.remove_from_course')}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </Tooltip>
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
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-1">
              <GraduationCap className="h-4 w-4 text-text-muted" />
              {t('admin.courses.results_title')}
            </h2>
            <p className="text-[12px] text-text-muted mb-4">{t('admin.courses.results_hint')}</p>

            {/* ── Aviso de contenido nuevo posterior a certificados emitidos ──
                Aparece SOLO si hay aprendices certificados que se perdieron
                módulos publicados después. El certificado que ya ganaron sigue
                siendo válido; recertificar es una decisión explícita. */}
            {outdatedCerts.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3.5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-text mb-0.5">
                      {t('admin.courses.recert_new_content_title', { count: outdatedCerts.length })}
                    </div>
                    <p className="text-[12px] text-text-muted">
                      {t('admin.courses.recert_new_content_hint')}
                    </p>

                    {pendingRecert.length > 0 && (
                      <p className="text-[12px] text-amber-500 mt-1.5 font-medium">
                        {t('admin.courses.recert_pending', { count: pendingRecert.length })}
                      </p>
                    )}

                    <div className="mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRequestRecert}
                        disabled={recertBusy}
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', recertBusy && 'animate-spin')} />
                        {recertBusy
                          ? t('admin.courses.recert_working')
                          : t('admin.courses.recert_cta')}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                  const rc = recert.find((x) => x.user_id === r.user_id)
                  const missedModules = rc?.new_module_ids.length ?? 0
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
                          {/* Contexto del certificado: cuántos módulos tenía el
                              curso cuando se certificó vs. cuántos hay hoy. */}
                          {rc && missedModules > 0 && (
                            <>
                              {' · '}
                              <span className="text-amber-500">
                                {t('admin.courses.recert_row_new', {
                                  count: missedModules,
                                  at: rc.modules_at_issue,
                                })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {r.certified && rc?.needs_recert ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-500 shrink-0"
                          title={
                            rc.expired
                              ? t('admin.courses.recert_badge_expired_hint')
                              : t('admin.courses.recert_badge_requested_hint')
                          }
                        >
                          <RefreshCw className="h-3 w-3" />
                          {rc.expired
                            ? t('admin.courses.recert_badge_expired')
                            : t('admin.courses.recert_badge')}
                        </span>
                      ) : r.certified ? (
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

      {/* Único lugar donde se guarda este editor. */}
      <SaveDock
        pending={pendingSaves}
        onSave={saveAll}
        // Solo cuenta como "guardando" si había algo pendiente: guardar la ficha
        // para abrir la vista previa no tiene por qué asomar la barra.
        saving={pendingSaves.length > 0 && (saving || savingAssign || savingEval)}
        onUndo={undoHistory.undo}
        canUndo={undoHistory.canUndo}
      />
    </div>
  )
}
