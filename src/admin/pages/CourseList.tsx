import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownAZ, BookOpen, ChevronRight, Clock, Eye, EyeOff, FileText, GraduationCap, ImageDown, Languages, ListChecks, Loader2, Pencil, Plus, Send, Sparkles, Trash2, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'
import { useAuth } from '@/hooks/useAuth'
import {
  approvalStatusOf,
  canPublishNow,
  requestCoursePublication,
} from '@/services/courseApprovals.service'
import {
  getAllCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  type CourseWithModules,
  type AdminCourse,
} from '@/services/courses.service'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { runCourseAiGeneration, COURSE_AI_CREATED_EVENT } from '@/services/courseAi.service'
import {
  extractDocumentText, ACCEPTED_DOC_EXTENSIONS,
  type ExtractedDocument, type ExtractStage,
} from '@/lib/documentExtract'
import { invalidateModulesCache } from '@/hooks/useModules'
import { usePresenceFocus } from '@/hooks/usePresenceFocus'
import { resolveCreationCampaignId } from '@/stores/campaignScopeStore'
import { cn } from '@/lib/cn'
import { GlassCard } from '@/components/ui/GlassCard'
import { FileDropZone } from '@/components/ui/FileDropZone'
import { Modal } from '@/components/ui/Modal'
import { OptionToggleRow } from '@/components/ui/OptionToggleRow'
import { CourseCardCover, courseHasCardImage, CARD_COVER_BOX } from '@/components/course/CourseCover'
import { RichTextArea } from '@/components/ui/RichTextArea'
import { FadeIn, PulseHint } from '@/components/ui/motion'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { getAudiences, ruleIsEmpty, type AudienceRule } from '@/services/audiences.service'
import { audienceSummary } from '@/admin/components/AudienceRulePicker'
import { AiCreditsNotice, AiCreditsDot } from '@/components/ui/AiCreditsNotice'
import { AiQuotaNotice } from '@/components/ui/AiQuotaNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Tooltip } from '@/components/ui/Tooltip'
import { recompressSiteImages, type SiteImageProgress } from '@/services/mediaMaintenance'
import { ResourcePresence } from '@/components/presence/ResourcePresence'
import { LearnerPreviewModal } from '@/admin/components/LearnerPreviewModal'
import { toast } from '@/stores/toastStore'
import { deletionToast } from '@/lib/deletionToast'
import { rowText } from '@/lib/contentLang'
import { TranslationModal } from '@/admin/components/TranslationModal'
import { CourseReachTable } from '@/admin/components/CourseReachTable'
import { useCourseReach } from '@/admin/components/courseReach'
import { ContentFilterBar, ContentFilterPrompt, useContentFilters } from '@/admin/components/ContentFilterBar'
import { EnrollLearnersModal } from '@/admin/components/EnrollLearnersModal'
import { getActiveOrgId } from '@/services/org.service'
import { EntityIcon } from '@/components/ui/EntityIcon'

// Opción "Todas las campañas" en el selector de campaña (solo superadmin).
const ALL_CAMPAIGNS = '__all__'

// Marca de que el staff ya usó "Ver como aprendiz" (apaga el pulso de la tarjeta).
const PREVIEW_HINT_KEY = 'course-preview-hint-seen'

// Orden de la lista. 'default' es el que trae la consulta (lo más reciente
// primero); las otras dos son alfabéticas por título.
type CourseSort = 'default' | 'az' | 'za'
const COURSE_SORT_KEY = 'admin-courses-sort'

// Cómo se ve la lista: tarjetas, o la tabla de «a quién le llega cada curso».
type CourseLayout = 'cards' | 'reach'
const COURSE_LAYOUT_KEY = 'admin-courses-layout'

export default function CourseList() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user, campaignId: authCampaignId, creationCampaignId: homeSpace, isSuperAdmin, canApproveCourses } = useAuth()
  // Curso abierto en la vista previa (modal con la página del aprendiz).
  const [previewCourse, setPreviewCourse] = useState<AdminCourse | null>(null)
  // El pulso que señala la vista previa late hasta que se usa una vez y luego
  // no vuelve: es una ayuda de descubrimiento, no un adorno permanente.
  const [previewHintSeen, setPreviewHintSeen] = useState(() => {
    try { return localStorage.getItem(PREVIEW_HINT_KEY) === '1' } catch { return true }
  })

  // El superadmin arranca viendo TODOS los cursos (no una campaña suelta como
  // filtro). El resto arranca vacío y cae en su campaña al cargarlas: partir de
  // la campaña "casa" la dejaba fija aunque ya no fuera accesible.
  // Traducir TODO: cursos (con sus módulos, simuladores, mundos y examen) y los
  // módulos sueltos. Solo superadmin: es la operación de IA más cara del sitio.
  const [showTranslateAll, setShowTranslateAll] = useState(false)
  /* Ya no hay programas en pantalla: todos ven la lista entera (la base decide
     qué filas le llegan a cada quien). El espacio donde se GUARDA un curso nuevo
     se elige solo, por dentro, y nadie tiene que saber que existe. */
  const selectedCampaignId = ALL_CAMPAIGNS
  const [creationCampaignId, setCreationCampaignId] = useState<string>('')
  /* Buscador y filtros, COMUNES a tarjetas y tabla, y los mismos que en
     Módulos (ver ContentFilterBar). */
  const filters = useContentFilters()
  /** El catálogo de CR y áreas, para escribir la regla con nombres. */
  const units = filters.units
  const [courses, setCourses] = useState<AdminCourse[]>([])
  // Cursos que la otra org del grupo comparte (LATAM ↔ Brasil): no se editan
  // desde aquí, solo se inscribe a la gente propia.
  const [sharedWithMe, setSharedWithMe] = useState<AdminCourse[]>([])
  const [enrollFor, setEnrollFor] = useState<AdminCourse | null>(null)
  /** Regla de audiencia por curso: qué país / área / CR tiene definidos. */
  const [audiences, setAudiences] = useState<Map<string, AudienceRule>>(new Map())
  /** Del aviso de arriba: deja solo los publicados que no le llegan a nadie. */
  const [onlyNobody, setOnlyNobody] = useState(false)
  // El orden elegido se recuerda: quien trabaja alfabéticamente no quiere
  // volver a elegirlo cada vez que entra al panel.
  const [sort, setSort] = useState<CourseSort>(() => {
    try {
      const saved = localStorage.getItem(COURSE_SORT_KEY)
      return saved === 'az' || saved === 'za' ? saved : 'default'
    } catch { return 'default' }
  })
  const [layout, setLayout] = useState<CourseLayout>(() => {
    try { return localStorage.getItem(COURSE_LAYOUT_KEY) === 'reach' ? 'reach' : 'cards' } catch { return 'cards' }
  })
  const changeLayout = (next: CourseLayout) => {
    setLayout(next)
    try { localStorage.setItem(COURSE_LAYOUT_KEY, next) } catch { /* modo privado */ }
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Se incrementa para forzar recarga de la lista (p. ej. cuando una creación con
  // IA en segundo plano termina mientras seguimos en esta pantalla).
  const [refreshKey, setRefreshKey] = useState(0)
  const [optimizing, setOptimizing] = useState(false)
  const [optProgress, setOptProgress] = useState<SiteImageProgress | null>(null)

  // Foco que manda la barra de presencia al pulsar a una persona.
  const { focusId } = usePresenceFocus('course')
  const focusRef = useRef<HTMLDivElement | null>(null)

  const view = 'mine' as const

  // Modal de creación
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  // Asistente "Crear curso con IA" (documento → 1 módulo → mundo, todo en borrador)
  const aiLastFileRef = useRef<File | null>(null)
  const [showAi, setShowAi] = useState(false)
  const [aiTitle, setAiTitle] = useState('')
  const [aiDoc, setAiDoc] = useState<ExtractedDocument | null>(null)
  const [aiReadingName, setAiReadingName] = useState('')
  const [aiExtracting, setAiExtracting] = useState(false)
  const [aiManualMode, setAiManualMode] = useState(false)
  const [aiProgress, setAiProgress] = useState<{ stage: ExtractStage; ratio: number }>({ stage: 'reading', ratio: 0 })

  /**
   * Optimiza las imágenes que YA estaban subidas en todo el sitio: portadas,
   * medios e imágenes de los bloques de cada módulo, y fotos de perfil. Lo que
   * se suba de aquí en adelante ya sale optimizado solo, así que esto se corre
   * una vez y de vez en cuando.
   */
  const handleOptimizeImages = async () => {
    const ok = await confirm({
      title: t('admin.courses.optimize_images'),
      description: t('admin.courses.optimize_images_confirm'),
      confirmLabel: t('admin.courses.optimize_images'),
      tone: 'default',
    })
    if (!ok) return
    setOptimizing(true)
    setOptProgress(null)
    try {
      const result = await recompressSiteImages(undefined, setOptProgress)
      setRefreshKey((k) => k + 1)
      // Las imágenes de los módulos viven en la caché de `useModules`: sin esto
      // el capacitador seguiría viendo las URLs viejas hasta recargar.
      invalidateModulesCache()
      toast.success(
        t('admin.courses.optimize_images_done', {
          n: result.optimized,
          mb: (result.bytesSaved / (1024 * 1024)).toFixed(1),
        }),
      )
      if (result.failed > 0) toast.error(t('admin.courses.optimize_images_failed', { n: result.failed }))
    } catch (err) {
      toast.error(t('admin.courses.error_save'), (err as Error).message)
    } finally {
      setOptimizing(false)
      setOptProgress(null)
    }
  }

  const openAi = () => {
    setAiTitle(''); setAiDoc(null); setAiReadingName(''); setAiManualMode(false)
    aiLastFileRef.current = null
    setAiProgress({ stage: 'reading', ratio: 0 })
    setShowAi(true)
  }

  // Extrae texto e imágenes del documento. `manual` controla el modo paso a paso,
  // que además renderiza las páginas del PDF como contexto visual (aunque haya texto)
  // y, en PDFs escaneados, permite recortar las capturas de cada paso.
  const extractAiFile = async (file: File, manual: boolean) => {
    setAiReadingName(file.name)
    setAiProgress({ stage: 'reading', ratio: 0 })
    setAiExtracting(true)
    try {
      const extracted = await extractDocumentText(file, (p) => setAiProgress(p), { manualMode: manual })
      setAiDoc(extracted)
      if (!aiTitle.trim()) setAiTitle(extracted.fileName.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setAiDoc(null)
      toast.error(err instanceof Error ? err.message : t('admin.courses.ai_read_error'))
    } finally {
      setAiExtracting(false)
    }
  }

  const handleAiFile = async (file: File) => {
    aiLastFileRef.current = file
    await extractAiFile(file, aiManualMode)
  }

  // Al cambiar el modo manual re-extraemos el mismo archivo (cambia el set de imágenes).
  const handleToggleAiManual = async (next: boolean) => {
    setAiManualMode(next)
    if (aiLastFileRef.current) await extractAiFile(aiLastFileRef.current, next)
  }

  // La generación con IA corre en SEGUNDO PLANO (bgTaskStore global): cerramos el
  // modal de inmediato y el proceso continúa aunque el usuario navegue a otra vista.
  // El mundo (gamificación) NO se crea acá: es opcional y se arma aparte en Mundos.
  const handleAiCreate = () => {
    if (!aiTitle.trim() || !aiDoc || !creationCampaignId) return
    const input = {
      campaignId: creationCampaignId,
      title: aiTitle.trim(),
      doc: aiDoc,
      manualMode: aiManualMode,
    }
    setShowAi(false)
    toast.success(t('admin.courses.ai_started_bg'))
    void runCourseAiGeneration(input)
  }

  useEffect(() => {
    // Dónde se guarda lo que se crea: su espacio de casa si lo tiene, si no el
    // primero al que tiene acceso. Es fontanería: no se enseña.
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then((data) => {
        const ids = data.map((c) => c.id)
        setCreationCampaignId(
          homeSpace && ids.includes(homeSpace)
            ? homeSpace
            : resolveCreationCampaignId(null, ids),
        )
      })
      .catch(() => {})
  }, [isSuperAdmin, authCampaignId, homeSpace, user?.id])

  useEffect(() => {
    if (!focusId || loading) return
    focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, loading, courses])

  useEffect(() => {
    if (!selectedCampaignId) return
    // Esqueleto solo la primera vez: los refrescos de fondo no deben parpadear.
    if (courses.length === 0) setLoading(true)
    setError(null)
    Promise.all([getAllCourses(), getActiveOrgId()])
      .then(([all, activeOrgId]) => {
        /* La lista es de la org ACTIVA. Lo que la otra org del grupo comparte
         * va aparte (se puede inscribir gente, no editar), y lo del resto de
         * orgs no sale: el superadmin lo ve cambiando de org en el selector. */
        const cs = activeOrgId ? all.filter((c) => c.campaign_org_id === activeOrgId) : all
        setSharedWithMe(
          activeOrgId
            ? all.filter((c) => c.campaign_org_id !== activeOrgId && c.shared_with_group && c.is_published)
            : [],
        )
        setCourses(cs)
        /* Las reglas, en una sola consulta para toda la lista. Es lo que
         * permite decir curso por curso si ya sabe a quién le llega o si
         * todavía depende del programa. Va aparte del catálogo a propósito:
         * si `course_audiences` no existiera, la lista sigue pintándose. */
        getAudiences(cs.map((c) => c.id))
          .then(setAudiences)
          .catch(() => setAudiences(new Map()))
      })
      .catch(() => setError(t('admin.courses.error_load')))
      .finally(() => setLoading(false))
    // `courses` solo decide el esqueleto; no puede volver a disparar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, refreshKey])

  /** A cuánta gente le llega cada curso (por regla y a mano). Lo leen las
   *  tarjetas, el aviso y la tabla: una sola fuente, un solo número. */
  // El censo es lo más pesado del panel: no se pide hasta que se filtra.
  const reach = useCourseReach(courses, audiences, isSuperAdmin, refreshKey, filters.armed)

  /**
   * Publicados que de verdad no le llegan a NADIE: sin regla y sin personas
   * marcadas a mano. Antes contaba «sin regla» a secas y metía cursos con 22
   * personas asignadas a mano: el aviso decía 7 y la tabla 2.
   * Solo el superadmin ve todas las asignaciones; para los demás el 0 no es
   * fiable, así que el aviso no sale.
   */
  const nobodyPublished = useMemo(
    () => courses.filter((c) => c.is_published && reach.get(c.id)?.group === 'nobody').length,
    [courses, reach],
  )

  // Trae lo último cuando se vuelve a esta pestaña o cuando otra avisa que
  // cambió un curso o un módulo (los módulos cambian el conteo de la tarjeta).
  useFreshOnFocus(() => setRefreshKey((k) => k + 1), {
    topics: ['courses', 'modules'],
  })

  // Cuando una creación de curso con IA (en segundo plano) termina, refrescamos la
  // lista.
  useEffect(() => {
    const onCreated = () => setRefreshKey((k) => k + 1)
    window.addEventListener(COURSE_AI_CREATED_EVENT, onCreated)
    return () => window.removeEventListener(COURSE_AI_CREATED_EVENT, onCreated)
  }, [])

  const changeSort = (v: string) => {
    const next = (v === 'az' || v === 'za' ? v : 'default') as CourseSort
    setSort(next)
    try { localStorage.setItem(COURSE_SORT_KEY, next) } catch { /* modo privado */ }
  }

  const sortOptions = [
    { value: 'default', label: t('admin.courses.sort_default') },
    { value: 'az', label: t('admin.courses.sort_az') },
    { value: 'za', label: t('admin.courses.sort_za') },
  ]

  // El panel siempre muestra el título en español (es el idioma canónico del
  // contenido), así que ordenamos por `title_es` con las reglas del español:
  // acentos y "ñ" en su sitio, y números comparados como números ("Módulo 10"
  // después de "Módulo 9").
  const sortByTitle = useMemo(() => {
    return <T extends { title_es: string }>(list: T[]): T[] => {
      if (sort === 'default') return list
      const cmp = (a: T, b: T) =>
        rowText(a).localeCompare(rowText(b), 'es', { sensitivity: 'base', numeric: true })
      return [...list].sort(sort === 'az' ? cmp : (a, b) => cmp(b, a))
    }
  }, [sort])

  const filtersOn = filters.active || onlyNobody

  const clearFilters = () => {
    filters.clear()
    setOnlyNobody(false)
  }

  const visibleCourses = sortByTitle(
    courses.filter((c) => {
      if (onlyNobody && !(c.is_published && reach.get(c.id)?.group === 'nobody')) return false
      return filters.matches({ texts: [rowText(c)], isPublished: c.is_published, rule: audiences.get(c.id) })
    }),
  )

  const handleCreate = async () => {
    if (!newTitle.trim() || !creationCampaignId) return
    setCreating(true)
    try {
      const course = await createCourse(creationCampaignId, {
        title_es: newTitle.trim(),
        description_es: newDescription.trim() ? newDescription : null,
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
    // Publicar pasa por una aprobación (ver courseApprovals.service): sin ella
    // el botón no publica, pide la revisión. Sin esto el clic solo conseguiría
    // el rechazo del trigger, que en la lista se vería como un error suelto.
    if (next && !canPublishNow(course, canApproveCourses)) {
      try {
        await requestCoursePublication(course.id)
        setCourses((prev) =>
          prev.map((c) => (c.id === course.id ? { ...c, approval_status: 'pending' } : c)),
        )
        toast.success(t('admin.courses.approval_requested'), t('admin.courses.approval_requested_body'))
      } catch {
        toast.error(t('admin.courses.approval_request_error'))
      }
      return
    }
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

  // Apaga para siempre el pulso que señala la vista previa.
  const markPreviewHintSeen = () => {
    setPreviewHintSeen(true)
    try { localStorage.setItem(PREVIEW_HINT_KEY, '1') } catch { /* modo privado */ }
  }

  // Vista previa en modal: la página real del aprendiz dentro de un <iframe>
  // marcado como vista previa. No matricula a nadie y nada de lo que se haga ahí
  // se guarda: es LA forma de revisar un curso, publicado o en borrador. Antes
  // convivía con "Ver como aprendiz", que sí matriculaba al staff de verdad y
  // lo sumaba a los contadores de aprendices; eso ya no existe.
  const handleQuickPreview = (course: AdminCourse) => {
    markPreviewHintSeen()
    setPreviewCourse(course)
  }

  const handleDelete = async (course: CourseWithModules) => {
    const ok = await confirm({
      title: t('admin.courses.confirm_delete_title'),
      description: t('admin.courses.confirm_delete_desc', { title: rowText(course) }),
    })
    if (!ok) return
    try {
      const result = await deleteCourse(course.id)
      setCourses((prev) => prev.filter((c) => c.id !== course.id))
      invalidateModulesCache()
      toast.success(deletionToast(result, t('admin.courses.deleted_ok')))
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
            {isSuperAdmin && (
              <Tooltip label={t('admin.translate.site_hint')} maxWidth={300}>
                <Button
                  variant="glass"
                  className="flex items-center gap-1.5 w-full sm:w-auto"
                  onClick={() => setShowTranslateAll(true)}
                >
                  <span className="relative flex items-center">
                    <Languages className="h-3.5 w-3.5" />
                    <AiCreditsDot className="absolute -top-1.5 -right-1.5" />
                  </span>
                  {t('admin.translate.site_button')}
                </Button>
              </Tooltip>
            )}
            {isSuperAdmin && (
              <Tooltip label={t('admin.courses.optimize_images_hint')} maxWidth={280}>
                <Button
                  variant="glass"
                  className="flex items-center gap-1.5 w-full sm:w-auto"
                  onClick={handleOptimizeImages}
                  disabled={optimizing}
                >
                  {optimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}
                  {/* Durante el inventario todavía no hay total que mostrar. */}
                  {!optimizing
                    ? t('admin.courses.optimize_images')
                    : optProgress && optProgress.phase !== 'scan'
                      ? `${optProgress.done}/${optProgress.total}`
                      : t('admin.courses.optimize_images_scanning')}
                </Button>
              </Tooltip>
            )}
            <Button
              variant="glass"
              className="flex items-center gap-1.5 w-full sm:w-auto"
              onClick={openAi}
              disabled={!creationCampaignId}
            >
              <span className="relative flex items-center">
                <Sparkles className="h-3.5 w-3.5" />
                <AiCreditsDot className="absolute -top-1.5 -right-1.5" />
              </span>
              {t('admin.courses.ai_create')}
            </Button>
            <Button
              variant="neon"
              className="flex items-center gap-1.5 w-full sm:w-auto"
              onClick={() => setShowCreate(true)}
              disabled={!creationCampaignId}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('admin.courses.new_course')}
            </Button>
          </div>
        </div>
      </div>

      {/* Vista (tarjetas / a quién le llega) y orden, y debajo el buscador con
          los filtros. Son los mismos para las dos vistas: cambiar de vista no
          pierde lo que buscabas. */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="tablist" className="inline-flex shrink-0 self-start rounded-xl border border-line p-1">
          {(['cards', 'reach'] as const).map((l) => (
            <button
              key={l}
              role="tab"
              aria-selected={layout === l}
              onClick={() => changeLayout(l)}
              className={cn(
                'min-h-[36px] rounded-lg px-3 text-[13px] font-medium transition-colors',
                layout === l ? 'bg-primary/15 text-primary' : 'text-text-muted hover:text-text',
              )}
            >
              {t(l === 'cards' ? 'admin.courses.layout_cards' : 'admin.courses.layout_reach')}
            </button>
          ))}
        </div>
        {courses.length > 1 && (
          <FilterDropdown
            value={sort}
            onChange={changeSort}
            options={sortOptions}
            leadingIcon={<ArrowDownAZ className="h-4 w-4 text-text-subtle" />}
            aria-label={t('admin.courses.sort_label')}
            className="w-full sm:w-auto sm:ml-auto sm:min-w-[13rem]"
          />
        )}
      </div>

      <ContentFilterBar filters={filters} searchPlaceholder={t('admin.courses.reach_search_ph')} />

      {/* Qué se está viendo, en palabras, y cómo volver a verlo todo. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted">
        {(filters.hasSelection || onlyNobody) && (
          <span className="tabular-nums">
            {t('admin.courses.showing_count', { count: visibleCourses.length, total: courses.length })}
          </span>
        )}
        {filters.reachOn && <span>{t('admin.courses.reach_filter_hint')}</span>}
        {filtersOn && (
          <button onClick={clearFilters} className="font-medium text-primary hover:underline">
            {t('admin.courses.clear_filters')}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-[13px] text-danger glass border-danger/20">
          {error}
        </div>
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
            disabled={!creationCampaignId}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('admin.courses.new_course')}
          </Button>
        </GlassCard>
      ) : !filters.hasSelection && !onlyNobody ? (
        /* Nada hasta elegir para quién o buscar: no se pinta el catálogo entero. */
        <ContentFilterPrompt kind="courses" />
      ) : (
        <>
        {/* Publicados que no le llegan a nadie: ni regla ni personas a mano.
            Mismo número que el grupo «Sin asignar a nadie» de la tabla. Se
            apaga solo cuando no queda ninguno. */}
        {isSuperAdmin && nobodyPublished > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-amber-500">
                {t('admin.courses.nobody_title', { count: nobodyPublished })}
              </p>
              <p className="mt-0.5 text-[12px] text-text-muted">
                {t('admin.courses.nobody_body')}
              </p>
            </div>
            <Button
              variant={onlyNobody ? 'neon' : 'ghost'}
              className="shrink-0"
              onClick={() => setOnlyNobody((v) => !v)}
            >
              {onlyNobody ? t('admin.courses.migrate_show_all') : t('admin.courses.migrate_filter')}
            </Button>
          </div>
        )}
        {layout === 'reach' ? (
          <CourseReachTable courses={visibleCourses} reach={reach} units={units} />
        ) : visibleCourses.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-text-muted">{t('admin.courses.reach_empty')}</p>
        ) : <>
        <FadeIn className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" y={16}>
          {visibleCourses.map((course) => (
            <GlassCard
              key={course.id}
              intensity="subtle"
              rounded="2xl"
              ref={course.id === focusId ? focusRef : undefined}
              className={cn(
                'group flex flex-col hover:border-glass-border/15 transition-all duration-300 ease-apple hover:-translate-y-1 hover:shadow-card-hover overflow-hidden',
                // Resalte al venir siguiendo a alguien: señala sin abrir.
                course.id === focusId && 'ring-2 ring-primary/70 border-primary/40',
              )}
              padding="none"
            >
              {/* Imagen de la tarjeta, 16:9 completa: la misma que ve el aprendiz
                  en el catálogo (estilo «póster + vitrina», 2026-09-22). El
                  estado (publicado/borrador) va encima como pastilla de vidrio y
                  el título sube en un panel al pasar el cursor. */}
              <div
                className={`relative shrink-0 overflow-hidden ${CARD_COVER_BOX}`}
                style={{
                  background: courseHasCardImage(course)
                    ? `linear-gradient(120deg, ${course.color}1F, ${course.color}08)`
                    : `linear-gradient(135deg, ${course.color}40, ${course.color}0D)`,
                }}
              >
                {courseHasCardImage(course) ? (
                  <CourseCardCover
                    course={course}
                    alt={rowText(course)}
                    fit={course.cover_fit}
                    loading="lazy"
                    className="transition-transform duration-[900ms] ease-apple group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center px-6">
                    <span className="line-clamp-3 text-balance text-[20px] font-semibold leading-tight tracking-tight text-text">
                      {rowText(course)}
                    </span>
                  </div>
                )}
                {/* Panel de vidrio con el título: dentro del overflow-hidden,
                    que lo esconde por debajo hasta el hover. */}
                <div className="pointer-events-none absolute inset-x-2.5 bottom-3.5 z-20 grid translate-y-[calc(100%+20px)] gap-1 rounded-[14px] bg-black/60 px-3 py-2.5 text-white backdrop-blur-md transition-transform duration-[550ms] ease-apple group-hover:translate-y-0 group-focus-within:translate-y-0 motion-reduce:transition-none">
                  <span className="truncate text-[13px] font-semibold leading-snug">{rowText(course)}</span>
                  <span className="text-[11.5px] text-white/80">
                    {t('admin.courses.modules_count', { count: course.modules.length })}
                    <span className="mx-1.5 text-white/40">·</span>
                    {t(`admin.courses.level_${course.level}`)}
                  </span>
                </div>
                <div className="absolute top-2 left-2 z-10">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm',
                      course.is_published
                        ? 'bg-black/45 text-white ring-1 ring-white/20'
                        : 'bg-black/45 text-white/75 ring-1 ring-white/15',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        course.is_published ? 'bg-neon-green animate-glow-pulse' : 'bg-white/50',
                      )}
                    />
                    {course.is_published ? t('admin.courses.published') : t('admin.courses.draft')}
                  </span>
                </div>
                <div className="absolute top-2 right-2 z-10">
                  <ResourcePresence type="course" id={course.id} />
                </div>
              </div>

              {/* Sin título ni descripción en reposo: el título ya viene en la
                  imagen y sube en el panel al pasar el cursor. */}
              <div className="flex-1 px-4 pt-3 pb-3">
                {/* Datos del curso como pastillas: cada dato se lee solo, sin
                    puntos medios que se confunden con separadores de acciones. */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-text-muted">
                    <BookOpen className="h-3 w-3" />
                    {t('admin.courses.modules_count', { count: course.modules.length })}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-line bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-text-muted">
                    {t(`admin.courses.level_${course.level}`)}
                  </span>
                  {course.visibility === 'catalog' && (
                    <NeonBadge color="cyan">{t('admin.courses.catalog_badge')}</NeonBadge>
                  )}
                  {/* A quién le llega, escrito en la propia tarjeta.
                      Es la pieza que faltaba para migrar sin abrir curso por
                      curso: o dice "Colombia · Área: Operativa · CR: CLARO
                      MILLA", o dice en rojo que todavía reparte por programa. */}
                  {(() => {
                    const r = reach.get(course.id)
                    const regla = audiences.get(course.id)
                    const personas = (n: number | null | undefined) =>
                      n == null ? '' : ` · ${t('admin.courses.people_count', { count: n })}`
                    if (!regla || ruleIsEmpty(regla)) {
                      // Sin regla puede ser «a mano» (válido) o «a nadie» (el
                      // problema). Antes las dos salían en rojo como «Sin regla».
                      const nadie = r?.group === 'nobody'
                      return (
                        <Tooltip
                          label={nadie ? t('admin.courses.chip_nobody_hint') : t('admin.courses.chip_by_hand_hint')}
                          maxWidth={300}
                        >
                          <span
                            className={cn(
                              'inline-flex cursor-help items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                              nadie
                                ? 'border-amber-500/45 bg-amber-500/10 text-amber-500'
                                : 'border-line bg-glass/8 text-text-muted',
                            )}
                          >
                            <Users className="h-3 w-3" />
                            {nadie
                              ? t('admin.courses.chip_nobody')
                              : `${t('admin.courses.chip_by_hand')}${personas(r?.byHand)}`}
                          </span>
                        </Tooltip>
                      )
                    }
                    const resumen = audienceSummary(regla, units, t)
                    const total = r?.byRule == null ? null : r.byRule + (r.byHand ?? 0)
                    return (
                      <Tooltip label={`${resumen}${personas(total)}`} maxWidth={320}>
                        <span className="inline-flex max-w-[260px] cursor-help items-center gap-1 rounded-full border border-line bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-text-muted">
                          <Users className="h-3 w-3 shrink-0" />
                          <span className="truncate">{resumen}</span>
                          {total != null && <span className="shrink-0 tabular-nums text-text-subtle">· {total}</span>}
                        </span>
                      </Tooltip>
                    )
                  })()}
                </div>
              </div>

              {/* Acciones — todas con etiqueta de texto: los iconos sueltos se
                  confundían entre sí (el ojo de "despublicar" parecía "ver"). La
                  acción principal va arriba y sola; publicar/borrar van abajo,
                  más discretas y con la destructiva separada a la derecha. */}
              <div className="border-t border-line/70 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  {/* Vista previa en modal: la única forma de ver el curso como
                      lo ve el aprendiz. Funciona igual publicado o en borrador y
                      no deja rastro en la matrícula. */}
                  <PulseHint active={!previewHintSeen} className="flex-1 min-w-0">
                    <button
                      onClick={() => handleQuickPreview(course)}
                      title={t('admin.preview.button_hint')}
                      className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all duration-200 text-primary bg-primary/10 border border-primary/25 hover:bg-primary/15 hover:border-primary/40 active:scale-[0.98]"
                    >
                      <Eye className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t('admin.preview.button')}</span>
                    </button>
                  </PulseHint>
                  <Link
                    to={`/admin/courses/${course.id}`}
                    className="min-h-[44px] shrink-0 flex items-center justify-center gap-1 px-3 rounded-xl text-[13px] font-semibold text-text-muted border border-line hover:text-text hover:bg-glass/8 hover:border-glass-border/25 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t('admin.courses.edit')}
                    <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </div>

                <div className="flex items-center gap-2">
                  {/* El botón dice lo que de verdad va a pasar: publicar si se
                      puede, pedir la aprobación si no, y nada mientras está en
                      revisión. */}
                  {(() => {
                    const allowed = canPublishNow(course, canApproveCourses)
                    const status = approvalStatusOf(course)
                    const waiting = !allowed && status === 'pending'
                    return (
                      <button
                        onClick={() => handleTogglePublished(course)}
                        disabled={waiting}
                        className="min-h-[36px] flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors disabled:opacity-60 disabled:pointer-events-none"
                      >
                        {course.is_published
                          ? <><EyeOff className="h-3.5 w-3.5" /> {t('admin.courses.unpublish')}</>
                          : allowed
                            ? <><Eye className="h-3.5 w-3.5" /> {t('admin.courses.publish')}</>
                            : waiting
                              ? <><Clock className="h-3.5 w-3.5" /> {t('admin.courses.approval_pending_badge')}</>
                              : <><Send className="h-3.5 w-3.5" /> {t('admin.courses.approval_request')}</>}
                      </button>
                    )
                  })()}
                  <button
                    onClick={() => handleDelete(course)}
                    className="min-h-[36px] ml-auto flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-text-subtle hover:text-danger hover:bg-danger/8 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('admin.courses.delete')}
                  </button>
                </div>
              </div>
            </GlassCard>
          ))}
        </FadeIn>
        </>}
        </>
      ))}

      {/* Compartidos por la otra org del grupo: se inscribe a la gente propia,
          el curso lo sigue editando su dueña. */}
      {view === 'mine' && !loading && sharedWithMe.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-semibold text-text">{t('admin.courses.shared_with_me_title')}</h2>
          <p className="mt-1 mb-4 text-[12.5px] text-text-muted">{t('admin.courses.shared_with_me_hint')}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortByTitle(sharedWithMe).map((c) => (
              <GlassCard key={c.id} intensity="subtle" padding="none" rounded="2xl" className="flex items-center gap-3 p-4">
                <EntityIcon value={c.icon} fallback="🎓" size={24} className="shrink-0" />
                <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text">{rowText(c)}</p>
                <Button
                  variant="glass"
                  className="flex shrink-0 items-center gap-1.5"
                  onClick={() => setEnrollFor(c)}
                  disabled={!homeSpace}
                >
                  <Users className="h-3.5 w-3.5" />
                  {t('admin.courses.enroll_my_people')}
                </Button>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {enrollFor && homeSpace && (
        <EnrollLearnersModal
          course={{ id: enrollFor.id, title_es: rowText(enrollFor) }}
          campaignId={homeSpace}
          onClose={() => setEnrollFor(null)}
        />
      )}

      {/* Modal de creación */}
      {showCreate && (
        <Modal
          onClose={() => setShowCreate(false)}
          title={t('admin.courses.new_course')}
          icon={<GraduationCap className="h-4 w-4" />}
          accent="green"
          dismissible={!creating}
          footer={
            <>
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
            </>
          }
        >
          <div className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
                {t('admin.courses.field_title')}
              </label>
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder={t('admin.courses.field_title_ph')}
                className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
                {t('admin.courses.field_description')}
              </label>
              <RichTextArea
                value={newDescription}
                onChange={setNewDescription}
                rows={3}
                placeholder={t('admin.courses.field_description_ph')}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Asistente: Crear curso con IA desde un documento.
          Cabe en una pantalla de portátil: el aviso de la IA vive en el pie
          (siempre a la vista, junto al botón que publica el encargo) y la nota de
          "sigue en segundo plano" ya la da el toast al generar. */}
      {showAi && (
        <Modal
          onClose={() => setShowAi(false)}
          title={t('admin.courses.ai_create')}
          subtitle={t('admin.courses.ai_create_hint')}
          icon={<Sparkles className="h-4 w-4" />}
          accent="violet"
          dismissible={!aiExtracting}
          footerLeft={<AiReviewNotice variant="inline" />}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowAi(false)}>
                {t('admin.courses.cancel')}
              </Button>
              <Button
                variant="neon"
                size="sm"
                onClick={handleAiCreate}
                disabled={aiExtracting || !aiTitle.trim() || !aiDoc}
                className="flex items-center gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" /> {t('admin.courses.ai_generate')}
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <AiCreditsNotice />
            <AiQuotaNotice />

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
                {t('admin.courses.field_title')}
              </label>
              <input
                value={aiTitle}
                onChange={(e) => setAiTitle(e.target.value)}
                placeholder={t('admin.courses.field_title_ph')}
                className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none focus:border-primary disabled:opacity-60"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
                {t('admin.courses.ai_document')}
              </label>
              {aiExtracting ? (
                <div className="rounded-xl border border-brand-violet/15 bg-brand-violet/6 px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-brand-violet/70" />
                      <FileText className="absolute h-3.5 w-3.5 text-brand-violet" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-text">{aiReadingName}</div>
                      <div className="text-[11px] text-text-muted">{t(`admin.import.stage_${aiProgress.stage}`)}</div>
                    </div>
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums text-brand-violet">
                      {Math.round(aiProgress.ratio * 100)}%
                    </span>
                  </div>
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-glass/10">
                    <div className="h-full rounded-full bg-brand-violet transition-all" style={{ width: `${Math.max(4, aiProgress.ratio * 100)}%` }} />
                  </div>
                </div>
              ) : aiDoc ? (
                <div className="flex items-center gap-2 rounded-xl border border-brand-violet/15 bg-brand-violet/6 px-3.5 py-2.5 text-[12px] text-brand-violet">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">
                    {aiDoc.fileName} — {aiDoc.text.trim()
                      ? `${(aiDoc.text.length / 1000).toFixed(1)}k ${t('admin.courses.ai_chars')}`
                      : t('admin.courses.ai_scanned')}
                    {aiDoc.images.length > 0 && aiDoc.text.trim() && ` · ${aiDoc.images.length} ${t('admin.courses.ai_figures')}`}
                    {aiDoc.contextImages.length > 0 && ` · ${aiDoc.contextImages.length} ${aiManualMode && !aiDoc.text.trim() ? t('admin.courses.ai_pages_crop') : t('admin.courses.ai_pages_vision')}`}
                  </span>
                  <button onClick={() => { setAiDoc(null); aiLastFileRef.current = null }} className="shrink-0 text-text-muted hover:text-danger">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <FileDropZone
                  size="sm"
                  accept={ACCEPTED_DOC_EXTENSIONS}
                  onFile={handleAiFile}
                  hint={t('admin.import.formats_short')}
                  hintFull={t('admin.import.formats')}
                />
              )}
            </div>

            <OptionToggleRow
              on={aiManualMode}
              onChange={handleToggleAiManual}
              disabled={aiExtracting}
              icon={<ListChecks className="h-3.5 w-3.5" />}
              title={t('admin.import.manual_mode')}
              description={t('admin.import.manual_mode_hint')}
            />
          </div>
        </Modal>
      )}

      {previewCourse && (
        <LearnerPreviewModal
          path={`/courses/${previewCourse.slug}`}
          context={rowText(previewCourse)}
          onClose={() => setPreviewCourse(null)}
        />
      )}

      {/* Traducir TODO el sitio. El modal enseña qué falta antes de gastar nada. */}
      {showTranslateAll && (
        <TranslationModal
          scope="site"
          id=""
          title={t('admin.translate.site_all_campaigns')}
          campaignId={null}
          onClose={() => setShowTranslateAll(false)}
          onDone={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
