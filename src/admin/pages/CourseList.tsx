import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownAZ, BookOpen, ChevronRight, Clock, Eye, EyeOff, FileText, GraduationCap, ListChecks, Loader2, Pencil, Plus, Search, Send, Share2, Sparkles, Trash2, Upload, UserPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'
import { useAuth } from '@/hooks/useAuth'
import {
  approvalStatusOf,
  canPublishNow,
  requestCoursePublication,
} from '@/services/courseApprovals.service'
import {
  getCoursesForCampaign,
  getAllCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getShareableCourses,
  type CourseWithModules,
  type AdminCourse,
  type ShareableCourse,
} from '@/services/courses.service'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { runCourseAiGeneration, COURSE_AI_CREATED_EVENT } from '@/services/courseAi.service'
import {
  extractDocumentText, ACCEPTED_DOC_EXTENSIONS,
  type ExtractedDocument, type ExtractStage,
} from '@/lib/documentExtract'
import { invalidateModulesCache } from '@/hooks/useModules'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import { usePresenceFocus } from '@/hooks/usePresenceFocus'
import { usePresenceStore } from '@/stores/presenceStore'
import { useCampaignScope, resolveCreationCampaignId } from '@/stores/campaignScopeStore'
import { cn } from '@/lib/cn'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { CourseCover, courseHasCover, COVER_BOX } from '@/components/course/CourseCover'
import { stripMarkdown } from '@/components/ui/RichText'
import { RichTextArea } from '@/components/ui/RichTextArea'
import { FadeIn, PulseHint } from '@/components/ui/motion'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { AiCreditsNotice, AiCreditsDot } from '@/components/ui/AiCreditsNotice'
import { AiQuotaNotice } from '@/components/ui/AiQuotaNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { EnrollLearnersModal } from '@/admin/components/EnrollLearnersModal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { ResourcePresence } from '@/components/presence/ResourcePresence'
import { LearnerPreviewModal } from '@/admin/components/LearnerPreviewModal'
import { toast } from '@/stores/toastStore'
import { deletionToast } from '@/lib/deletionToast'

// Opción "Todas las campañas" en el selector de campaña (solo superadmin).
const ALL_CAMPAIGNS = '__all__'

// Marca de que el staff ya usó "Ver como aprendiz" (apaga el pulso de la tarjeta).
const PREVIEW_HINT_KEY = 'course-preview-hint-seen'

// Orden de la lista. 'default' es el que trae la consulta (lo más reciente
// primero); las otras dos son alfabéticas por título.
type CourseSort = 'default' | 'az' | 'za'
const COURSE_SORT_KEY = 'admin-courses-sort'

export default function CourseList() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user, campaignId: authCampaignId, isSuperAdmin, canApproveCourses } = useAuth()
  // Curso abierto en la vista previa (modal con la página del aprendiz).
  const [previewCourse, setPreviewCourse] = useState<AdminCourse | null>(null)
  // El pulso que señala la vista previa late hasta que se usa una vez y luego
  // no vuelve: es una ayuda de descubrimiento, no un adorno permanente.
  const [previewHintSeen, setPreviewHintSeen] = useState(() => {
    try { return localStorage.getItem(PREVIEW_HINT_KEY) === '1' } catch { return true }
  })

  const [searchParams, setSearchParams] = useSearchParams()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // El superadmin arranca viendo TODOS los cursos (no una campaña suelta como
  // filtro). El resto arranca vacío y cae en su campaña al cargarlas: partir de
  // la campaña "casa" la dejaba fija aunque ya no fuera accesible.
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    isSuperAdmin ? ALL_CAMPAIGNS : '',
  )
  const [courses, setCourses] = useState<AdminCourse[]>([])
  // El orden elegido se recuerda: quien trabaja alfabéticamente no quiere
  // volver a elegirlo cada vez que entra al panel.
  const [sort, setSort] = useState<CourseSort>(() => {
    try {
      const saved = localStorage.getItem(COURSE_SORT_KEY)
      return saved === 'az' || saved === 'za' ? saved : 'default'
    } catch { return 'default' }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Se incrementa para forzar recarga de la lista (p. ej. cuando una creación con
  // IA en segundo plano termina mientras seguimos en esta pantalla).
  const [refreshKey, setRefreshKey] = useState(0)

  // Foco que manda la barra de presencia al pulsar a una persona.
  const { focusId, focusCampaignId } = usePresenceFocus('course')
  const focusRef = useRef<HTMLDivElement | null>(null)

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
  const aiLastFileRef = useRef<File | null>(null)
  const [showAi, setShowAi] = useState(false)
  const [aiTitle, setAiTitle] = useState('')
  const [aiDoc, setAiDoc] = useState<ExtractedDocument | null>(null)
  const [aiReadingName, setAiReadingName] = useState('')
  const [aiExtracting, setAiExtracting] = useState(false)
  const [aiManualMode, setAiManualMode] = useState(false)
  const [aiProgress, setAiProgress] = useState<{ stage: ExtractStage; ratio: number }>({ stage: 'reading', ratio: 0 })

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

  const handleAiFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (aiFileRef.current) aiFileRef.current.value = ''
    if (!file) return
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
    if (!aiTitle.trim() || !aiDoc || !selectedCampaignId) return
    const input = {
      campaignId: selectedCampaignId,
      title: aiTitle.trim(),
      doc: aiDoc,
      manualMode: aiManualMode,
    }
    setShowAi(false)
    toast.success(t('admin.courses.ai_started_bg'))
    void runCourseAiGeneration(input)
  }

  useEffect(() => {
    // Superadmin: todas. Capacitador: su campaña casa + donde colabora (equipos).
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then((data) => {
        setCampaigns(data)
        // Superadmin conserva "Todas"; el resto retoma la campaña donde venía
        // trabajando, o su primera campaña accesible.
        setSelectedCampaignId((prev) => {
          if (prev) return prev
          if (isSuperAdmin) return ALL_CAMPAIGNS
          return resolveCreationCampaignId(null, data.map((c) => c.id))
        })
      })
      .catch(() => {})
  }, [isSuperAdmin, authCampaignId, user?.id])

  // La campaña que se está mirando es la que se usará al crear contenido.
  // "Todas" no es una campaña: no fija contexto de creación.
  const setActiveCampaignId = useCampaignScope((s) => s.setActiveCampaignId)
  useEffect(() => {
    if (!selectedCampaignId || selectedCampaignId === ALL_CAMPAIGNS) return
    setActiveCampaignId(selectedCampaignId)
  }, [selectedCampaignId, setActiveCampaignId])

  /* Llegando desde Campañas: `?campaign=<id>` planta la vista en esa campaña.
     No se abre ningún modal: aquí la persona elige si crea el curso a mano o
     con IA. Se limpia la URL para no dejar el parámetro pegado. */
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current) return
    const camp = searchParams.get('campaign')
    if (!camp) return
    deepLinkDone.current = true
    setSelectedCampaignId(camp)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  // Venimos siguiendo a alguien desde la barra de presencia: pararse en SU
  // campaña y resaltar su curso, sin abrirlo.
  useEffect(() => {
    if (!focusCampaignId) return
    if (campaigns.length > 0 && !campaigns.some((c) => c.id === focusCampaignId)) return
    setSelectedCampaignId(focusCampaignId)
  }, [focusCampaignId, campaigns])

  useEffect(() => {
    if (!focusId || loading) return
    focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, loading, courses])

  // Publico qué campaña estoy mirando, para que quien me siga aterrice en ella.
  // "Todas" (superadmin) no es una campaña: no hay nada que seguir.
  const setViewCampaign = usePresenceStore((s) => s.setViewCampaign)
  useEffect(() => {
    setViewCampaign(selectedCampaignId === ALL_CAMPAIGNS ? null : selectedCampaignId || null)
    return () => setViewCampaign(null)
  }, [selectedCampaignId, setViewCampaign])

  useEffect(() => {
    if (!selectedCampaignId) return
    // Esqueleto solo la primera vez: los refrescos de fondo no deben parpadear.
    if (courses.length === 0) setLoading(true)
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
    // `courses` solo decide el esqueleto; no puede volver a disparar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, t, refreshKey])

  // Trae lo último cuando se vuelve a esta pestaña o cuando otra avisa que
  // cambió un curso o un módulo (los módulos cambian el conteo de la tarjeta).
  useFreshOnFocus(() => setRefreshKey((k) => k + 1), {
    topics: ['courses', 'modules'],
    enabled: !!selectedCampaignId,
  })

  // Cuando una creación de curso con IA (en segundo plano) termina, refrescamos la
  // lista si el curso pertenece a la campaña que estamos viendo.
  useEffect(() => {
    const onCreated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { campaignId?: string } | undefined
      if (selectedCampaignId === ALL_CAMPAIGNS || detail?.campaignId === selectedCampaignId) {
        setRefreshKey((k) => k + 1)
      }
    }
    window.addEventListener(COURSE_AI_CREATED_EVENT, onCreated)
    return () => window.removeEventListener(COURSE_AI_CREATED_EVENT, onCreated)
  }, [selectedCampaignId])

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
        a.title_es.localeCompare(b.title_es, 'es', { sensitivity: 'base', numeric: true })
      return [...list].sort(sort === 'az' ? cmp : (a, b) => cmp(b, a))
    }
  }, [sort])

  const visibleCourses = useMemo(() => sortByTitle(courses), [courses, sortByTitle])

  const filteredShared = useMemo(() => {
    const q = sharedSearch.trim().toLowerCase()
    const list = sharedCourses.filter((c) => {
      if (sharedCampaignFilter && c.campaign_name !== sharedCampaignFilter) return false
      if (!q) return true
      return `${c.title_es} ${c.description_es ?? ''} ${c.category ?? ''}`.toLowerCase().includes(q)
    })
    return sortByTitle(list)
  }, [sharedCourses, sharedSearch, sharedCampaignFilter, sortByTitle])

  const handleCreate = async () => {
    if (!newTitle.trim() || !selectedCampaignId) return
    setCreating(true)
    try {
      const course = await createCourse(selectedCampaignId, {
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
      description: t('admin.courses.confirm_delete_desc', { title: course.title_es }),
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

  const createBackdrop = useBackdropDismiss(() => setShowCreate(false), !creating)
  const aiBackdrop = useBackdropDismiss(() => setShowAi(false), !aiExtracting)

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
              disabled={selectedCampaignId === ALL_CAMPAIGNS}
              title={selectedCampaignId === ALL_CAMPAIGNS ? t('admin.courses.pick_campaign_to_create') : undefined}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('admin.courses.new_course')}
            </Button>
          </div>
        </div>
      </div>

      {/* Selector de campaña. Superadmin: todas + "Todas". Capacitador: su campaña
          casa + aquellas donde colabora (solo se muestra si hay más de una). */}
      {campaigns.length > 1 && (
        <div className="mb-6">
          <FilterDropdown
            value={selectedCampaignId}
            onChange={(v) => {
              // La vista de catálogo compartido necesita una campaña dueña concreta.
              if (v === ALL_CAMPAIGNS) setView('mine')
              setSelectedCampaignId(v)
            }}
            options={[
              ...(isSuperAdmin
                ? [{ value: ALL_CAMPAIGNS, label: t('admin.courses.filter_all_campaigns') }]
                : []),
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
            className="max-w-xs"
          />
        </div>
      )}

      {/* Tabs: Mis cursos / Cursos compartidos. El orden vive aquí solo para la
          pestaña propia; la de compartidos tiene el suyo junto a su buscador. */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-subtle p-1 w-fit">
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
        {view === 'mine' && courses.length > 1 && (
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
            <FilterDropdown
              value={sort}
              onChange={changeSort}
              options={sortOptions}
              leadingIcon={<ArrowDownAZ className="h-4 w-4 text-text-subtle" />}
              aria-label={t('admin.courses.sort_label')}
              className="sm:max-w-[13rem]"
            />
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
            <FadeIn className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" y={16}>
              {filteredShared.map((course) => (
                <GlassCard key={course.id} intensity="subtle" rounded="2xl" padding="none" className="flex flex-col overflow-hidden transition-all duration-300 ease-apple hover:-translate-y-1 hover:shadow-card-hover">
                  <div
                    className={`relative ${COVER_BOX}`}
                    style={{ background: courseHasCover(course) ? (course.cover_fit === 'contain' ? `linear-gradient(120deg, ${course.color}22, ${course.color}0A)` : undefined) : `linear-gradient(120deg, ${course.color}33, ${course.color}0D)` }}
                  >
                    <CourseCover course={course} className={`h-full w-full ${course.cover_fit === 'contain' ? 'object-contain' : 'object-cover'}`} />
                    <div className="absolute -bottom-5 left-4 flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-md" style={{ background: course.color }}>
                      <GraduationCap className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="flex-1 px-4 pt-7 pb-3">
                    <div className="text-[15px] font-semibold text-text truncate mb-1">{course.title_es}</div>
                    {course.description_es && (
                      <p className="text-[12px] text-text-muted line-clamp-2 mb-2">{stripMarkdown(course.description_es)}</p>
                    )}
                    <div className="flex items-center gap-1.5 text-[12px] text-text-subtle">
                      <BookOpen className="h-3.5 w-3.5" />
                      {t('admin.courses.modules_count', { count: course.modules.length })}
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
            </FadeIn>
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
              {/* Portada / franja de color. El estado (publicado/borrador) va
                  sobre la portada como pastilla de vidrio: se lee de un vistazo
                  y deja el título libre en una sola línea. */}
              <div
                className={`relative ${COVER_BOX}`}
                style={{
                  background: courseHasCover(course)
                    ? course.cover_fit === 'contain'
                      ? `linear-gradient(120deg, ${course.color}22, ${course.color}0A)`
                      : undefined
                    : `linear-gradient(120deg, ${course.color}44, ${course.color}0D)`,
                }}
              >
                <CourseCover course={course} className={`h-full w-full ${course.cover_fit === 'contain' ? 'object-contain' : 'object-cover'}`} />
                {/* Velo inferior: asegura contraste del avatar y del borde con el cuerpo */}
                <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/45 to-transparent pointer-events-none" />
                <div
                  className="absolute -bottom-5 left-4 flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-lg ring-2 ring-bg/70 transition-transform duration-300 ease-apple group-hover:scale-105"
                  style={{ background: course.color }}
                >
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div className="absolute top-2 left-2">
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
                <div className="absolute top-2 right-2">
                  <ResourcePresence type="course" id={course.id} />
                </div>
              </div>

              <div className="flex-1 px-4 pt-8 pb-4">
                <h3 className="text-[15px] font-semibold text-text leading-snug line-clamp-1 mb-1">
                  {course.title_es}
                </h3>
                {course.description_es && (
                  <p className="text-[12px] leading-relaxed text-text-muted line-clamp-2 mb-3">
                    {stripMarkdown(course.description_es)}
                  </p>
                )}
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
                  {selectedCampaignId === ALL_CAMPAIGNS && course.campaign_name && (
                    <span className="inline-flex items-center rounded-full border border-line bg-glass/8 px-2.5 py-1 text-[11px] font-medium text-text-subtle">
                      {t('admin.courses.shared_from', { name: course.campaign_name })}
                    </span>
                  )}
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
      ))}

      {/* Modal de creación */}
      {showCreate && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          {...createBackdrop}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-bg border border-line p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[17px] font-semibold text-text">{t('admin.courses.new_course')}</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8"
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
            <div className="mb-5">
              <RichTextArea
                value={newDescription}
                onChange={setNewDescription}
                rows={3}
                placeholder={t('admin.courses.field_description_ph')}
              />
            </div>
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
          {...aiBackdrop}
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
                onClick={() => setShowAi(false)}
                className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8"
                aria-label={t('admin.nav.close_menu')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[12px] text-text-muted mb-4">{t('admin.courses.ai_create_hint')}</p>

            <AiCreditsNotice className="mb-4" />
            <AiQuotaNotice className="mb-4" />
            <AiReviewNotice className="mb-4" />

            {/* Título */}
            <label className="block text-[12px] font-medium text-text-muted mb-1.5">
              {t('admin.courses.field_title')}
            </label>
            <input
              value={aiTitle}
              onChange={(e) => setAiTitle(e.target.value)}
              placeholder={t('admin.courses.field_title_ph')}
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
                  {aiDoc.fileName} — {aiDoc.text.trim()
                    ? `${(aiDoc.text.length / 1000).toFixed(1)}k ${t('admin.courses.ai_chars')}`
                    : t('admin.courses.ai_scanned')}
                  {aiDoc.images.length > 0 && aiDoc.text.trim() && ` · ${aiDoc.images.length} ${t('admin.courses.ai_figures')}`}
                  {aiDoc.contextImages.length > 0 && ` · ${aiDoc.contextImages.length} ${aiManualMode && !aiDoc.text.trim() ? t('admin.courses.ai_pages_crop') : t('admin.courses.ai_pages_vision')}`}
                </span>
                <button onClick={() => { setAiDoc(null); aiLastFileRef.current = null }} className="text-text-muted hover:text-danger shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
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

            {/* Modo manual paso a paso (fidelidad máxima a un procedimiento con capturas) */}
            <button
              type="button"
              onClick={() => handleToggleAiManual(!aiManualMode)}
              disabled={aiExtracting}
              className={cn(
                'mb-4 w-full flex items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-all border',
                aiManualMode ? 'bg-brand-violet/8 border-brand-violet/30' : 'bg-glass/4 border-glass-border/10 hover:border-brand-violet/20',
                aiExtracting && 'opacity-60 cursor-wait',
              )}
            >
              <div className={cn(
                'mt-0.5 h-7 w-7 shrink-0 flex items-center justify-center rounded-lg transition-colors',
                aiManualMode ? 'bg-brand-violet/20 text-brand-violet' : 'bg-glass/8 text-text-muted',
              )}>
                <ListChecks className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-text">{t('admin.import.manual_mode')}</span>
                  <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', aiManualMode ? 'bg-brand-violet' : 'bg-glass/20')}>
                    <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', aiManualMode ? 'left-[18px]' : 'left-0.5')} />
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{t('admin.import.manual_mode_hint')}</p>
              </div>
            </button>

            {/* La generación corre en segundo plano: al pulsar "Generar", el modal se
                cierra y el avance se ve en el indicador global de tareas. */}
            <p className="flex items-center gap-1.5 text-[11px] text-text-subtle mb-4">
              <Sparkles className="h-3 w-3 shrink-0" />
              {t('admin.courses.ai_started_bg')}
            </p>

            <div className="flex justify-end gap-2">
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
            </div>
          </div>
        </div>
      )}

      {previewCourse && (
        <LearnerPreviewModal
          path={`/courses/${previewCourse.slug}`}
          context={previewCourse.title_es}
          onClose={() => setPreviewCourse(null)}
        />
      )}
    </div>
  )
}
