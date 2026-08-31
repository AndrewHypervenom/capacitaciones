import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Plus, X, Pencil, Trash2, ArrowLeft, ChevronRight, Sparkles, BookOpen, AlertTriangle, Play, Lock } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { EmojiPicker } from '@/components/ui/EmojiPicker'
import { SaveDock } from '@/admin/components/SaveDock'
import { useUndoHistory } from '@/hooks/useUndoHistory'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { generateLevelsForRegion, generateBulkModuleRegions, WORLD_LEVELS_EVENT } from '@/services/worlds.service'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import type { WorldRow, WorldGenOptions } from '@/services/worlds.service'
import { WorldModulePickerModal, type PickedModule } from '@/admin/components/WorldModulePickerModal'
import { ArenaEditorModal, normalizeArenaRow, type ArenaQuiz } from '@/admin/components/ArenaEditorModal'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { useEditingPresence } from '@/hooks/usePresence'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'
import { PresenceStack } from '@/components/presence/PresenceStack'
import { EditingBanner } from '@/components/presence/EditingBanner'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { LevelTransition } from '@/components/worlds/LevelTransition'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'
import { rowText } from '@/lib/contentLang'

interface World {
  id: string; name: string; description: string | null
  campaign_id: string | null; course_id: string | null; icon: string; color: string
  bg_type: string; status: string
  sound_theme: string; transition_type: string; character_emoji: string
}
interface CourseModule { id: string; title_es: string; icon: string | null }
interface Region { id: string; name: string; description: string; icon: string; order_index: number; world_id: string; module_id: string | null }
interface Level  { id: string; name: string; description: string; icon: string; order_index: number; region_id: string; world_id: string; quiz_id: string | null; min_score_pct: number | null }
interface Quiz   { id: string; title: string }

const BG_LABELS: Record<string,string> = { airline:'admin.arena.theme_airline', bank:'admin.arena.theme_bank', health:'admin.arena.theme_health', corporate:'admin.arena.theme_corporate', tech:'admin.arena.theme_tech' }
const SOUND_LABELS: Record<string,string> = { airport:'admin.worlds.sound_airport', bank:'admin.arena.theme_bank', nature:'admin.worlds.sound_nature', tech:'admin.arena.theme_tech', neutral:'admin.worlds.sound_neutral' }
const TRANS_LABELS: Record<string,string> = { clouds:'admin.worlds.trans_clouds', cards:'admin.worlds.trans_cards', pulse:'admin.worlds.trans_pulse', rocket:'admin.worlds.trans_rocket', terminal:'admin.worlds.trans_terminal', confetti:'admin.worlds.trans_confetti', scan:'admin.worlds.trans_scan', warp:'admin.worlds.trans_warp', portal:'admin.worlds.trans_portal', shatter:'admin.worlds.trans_shatter', splitflap:'admin.worlds.trans_splitflap', dna:'admin.worlds.trans_dna', matrix:'admin.worlds.trans_matrix', fireworks:'admin.worlds.trans_fireworks', curtain:'admin.worlds.trans_curtain', glitch:'admin.worlds.trans_glitch', doors:'admin.worlds.trans_doors', sunrise:'admin.worlds.trans_sunrise', equalizer:'admin.worlds.trans_equalizer', tunnel:'admin.worlds.trans_tunnel' }

// Preguntas por sección por defecto (P1, P2… en el recorrido del aprendiz).
// El capacitador puede cambiarlo al generar; se guarda en cada quiz
// (arena_quizzes.section_size) y el ArenaPlayer lo respeta.
const DEFAULT_QUESTIONS_PER_SECTION = 3

/* ── Carcasa de modal reutilizable ──
   Centraliza el fondo (fade) y el panel (resorte con entrada Y salida) para que
   los 5 modales del editor compartan la misma transición. Va siempre dentro de
   un <AnimatePresence> y bajo un guard `{cond && <ModalShell/>}` para que la
   salida anime con los datos que tenía al cerrarse. Respeta reduced-motion. */
function ModalShell({ onClose, className, reduce, children }: {
  onClose: () => void
  className?: string
  reduce: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      {...backdropDismiss(onClose)}
    >
      <motion.div
        className={cn('w-full rounded-2xl bg-surface border border-line overflow-hidden flex flex-col', className)}
        style={{ maxHeight: '90vh' }}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 10 }}
        transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 26 }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

/**
 * Id de mentira para lo que todavía no existe en la base (una región o un nivel
 * recién creados en el borrador). Al guardar se cambia por el id real que
 * devuelve la base, y los niveles se recuelgan de la región de verdad.
 */
let draftSeq = 0
const draftId = (kind: 'r' | 'l') => `draft-${kind}-${Date.now().toString(36)}-${draftSeq++}`
const isDraftId = (id: string) => id.startsWith('draft-')

export default function WorldDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const reduce = useReducedMotion()
  const { user, isSuperAdmin, campaignId, loading: authLoading } = useAuth()
  // El capacitador puede ver/editar los mundos de TODAS sus campañas (casa +
  // colaboraciones), igual que la lista de /admin/worlds. Comparar solo contra la
  // campaña casa daba "Acceso denegado" en mundos que sí figuraban en la lista.
  const scopedToCampaign = !isSuperAdmin
  // undefined = todavía cargando; [] = sin campañas.
  const [myCampaignIds, setMyCampaignIds] = useState<string[] | undefined>(undefined)

  useEffect(() => {
    if (authLoading) return
    if (!scopedToCampaign) { setMyCampaignIds([]); return }
    let active = true
    getAccessibleCampaigns({ isSuperAdmin, homeCampaignId: campaignId, userId: user?.id ?? null })
      .then((camps) => { if (active) setMyCampaignIds(camps.map((c) => c.id)) })
      .catch(() => { if (active) setMyCampaignIds(campaignId ? [campaignId] : []) })
    return () => { active = false }
  }, [authLoading, scopedToCampaign, isSuperAdmin, campaignId, user?.id])

  const [world, setWorld]     = useState<World | null>(null)
  /** Lo que hay guardado del mundo: contra esto se mide qué está sin guardar. */
  const [savedWorld, setSavedWorld] = useState<World | null>(null)

  // Presencia colaborativa: coeditores que tienen abierto este mundo.
  const coeditors = useEditingPresence(
    id ? { type: 'world', id, title: world?.name ?? '' } : null,
  )

  const [regions, setRegions] = useState<Region[]>([])
  const [levels, setLevels]   = useState<Level[]>([])
  /* Regiones y niveles también son borrador. Lo que hay en la base vive aquí:
     contra esto se cuenta lo pendiente y se calcula qué insertar, actualizar o
     borrar al guardar. */
  const [savedRegions, setSavedRegions] = useState<Region[]>([])
  const [savedLevels, setSavedLevels]   = useState<Level[]>([])
  /** Quizzes que se quedarán sin nivel al guardar: se limpian entonces, no antes. */
  const [quizzesToCheck, setQuizzesToCheck] = useState<string[]>([])
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string,boolean>>({})

  // Curso ligado (si el mundo tiene course_id) y sus módulos, para basar regiones.
  const [linkedCourse, setLinkedCourse] = useState<{ id: string; title_es: string } | null>(null)
  const [courseModules, setCourseModules] = useState<CourseModule[]>([])

  // Region modal
  const [regionModal, setRegionModal] = useState(false)
  const [editingRegion, setEditingRegion] = useState<Region | null>(null)
  const [regionForm, setRegionForm] = useState({ name:'', description:'', icon:'📍', order_index:0 })
  const [regionModuleId, setRegionModuleId] = useState<string>('') // '' = región personalizada (sin módulo)

  // Level modal
  const [levelModal, setLevelModal] = useState(false)
  const [editingLevel, setEditingLevel] = useState<Level | null>(null)
  // Crear/editar un quiz inline (sin salir del modal de nivel).
  const [quizEditorOpen, setQuizEditorOpen] = useState(false)
  // Quiz completo a editar (null = crear uno nuevo).
  const [editingQuizFull, setEditingQuizFull] = useState<ArenaQuiz | null>(null)
  const [loadingQuizEdit, setLoadingQuizEdit] = useState(false)
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const [levelForm, setLevelForm] = useState({ name:'', description:'', icon:'⭐', order_index:0, quiz_id:'', min_score_pct: null as number | null })
  const [levelScoreError, setLevelScoreError] = useState<string | null>(null)

  // Generar niveles con IA (por región)
  const [aiRegion, setAiRegion] = useState<Region | null>(null)
  const [aiLevels, setAiLevels] = useState<number | ''>('')
  const [aiSections, setAiSections] = useState<number | ''>(2)
  const [aiPerSection, setAiPerSection] = useState<number | ''>(DEFAULT_QUESTIONS_PER_SECTION)
  const [aiMinScore, setAiMinScore] = useState<number | ''>(80)

  // Previsualizar la transición de nivel elegida, sin tener que jugar un nivel.
  const [previewTrans, setPreviewTrans] = useState(false)
  useEffect(() => {
    if (!previewTrans) return
    const id = setTimeout(() => setPreviewTrans(false), reduce ? 1200 : 2600)
    return () => clearTimeout(id)
  }, [previewTrans, reduce])

  // Elegir módulos de CUALQUIER curso accesible (no solo el curso enlazado) para
  // crear una región por módulo.
  const [pickerOpen, setPickerOpen] = useState(false)

  // Generar en bloque todas las regiones del curso (una por módulo) con sus niveles.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkLevels, setBulkLevels] = useState<number | ''>(3)
  const [bulkSections, setBulkSections] = useState<number | ''>(2)
  const [bulkPerSection, setBulkPerSection] = useState<number | ''>(DEFAULT_QUESTIONS_PER_SECTION)

  // Reset progress
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetToast, setResetToast] = useState(false)
  const [resetError, setResetError] = useState(false)

  useEffect(() => {
    if (!id) return
    async function load() {
      if (!id) return
      const { data: wData } = await supabase.from('worlds').select('*').eq('id', id).single()
      if (wData) {
        const raw = wData as Record<string,unknown>
        const loaded = {
          ...wData,
          sound_theme:     (raw.sound_theme     as string) ?? 'neutral',
          transition_type: (raw.transition_type as string) ?? 'clouds',
          character_emoji: (raw.character_emoji as string) ?? '🧑',
        }
        setWorld(loaded)
        setSavedWorld(loaded)
        // Solo los quizzes de ESTE mundo (no toda la campaña), para que el picker
        // no se llene con quizzes de otros mundos.
        const { data: qData } = await supabase
          .from('arena_quizzes').select('id, title').eq('world_id', id).order('created_at')
        setQuizzes((qData ?? []) as Quiz[])
        // Curso ligado + sus módulos (para basar regiones y anclar la IA).
        if (wData.course_id) {
          const { data: cData } = await supabase.from('courses').select('id, title_es').eq('id', wData.course_id).maybeSingle()
          setLinkedCourse((cData as { id: string; title_es: string } | null) ?? null)
          const { data: mData } = await supabase.from('modules').select('id, title_es, icon').eq('course_id', wData.course_id).order('course_sort_order')
          setCourseModules((mData ?? []) as CourseModule[])
        }
      }
      const { data: rData } = await supabase.from('world_regions').select('*').eq('world_id', id).order('order_index')
      const regionList = (rData ?? []) as Region[]
      setRegions(regionList)
      setSavedRegions(regionList)
      // Expand first region by default
      if (regionList.length > 0) setExpanded({ [regionList[0].id]: true })

      const { data: lData } = await supabase.from('world_levels').select('*').eq('world_id', id).order('order_index')
      setLevels((lData ?? []) as Level[])
      setSavedLevels((lData ?? []) as Level[])
      setLoading(false)
    }
    load()
  }, [id])

  // Refresca regiones/niveles/quizzes cuando una generación en 2º plano de ESTE
  // mundo termina (total, parcial o cancelada), sin recargar la página.
  /**
   * Relee regiones, niveles y quizzes de este mundo. Aquí no hace falta guardia
   * de versión —cada campo del mundo se guarda al tocarlo, no hay borrador en
   * pantalla que se pueda perder—, así que refrescar sin preguntar es correcto.
   */
  const refreshWorldContent = useCallback(async () => {
    if (!id) return
    const [{ data: rData }, { data: lData }, { data: qData }] = await Promise.all([
      supabase.from('world_regions').select('*').eq('world_id', id).order('order_index'),
      supabase.from('world_levels').select('*').eq('world_id', id).order('order_index'),
      supabase.from('arena_quizzes').select('id, title').eq('world_id', id).order('created_at'),
    ])
    const rows = (rData ?? []) as Region[]
    const lvls = (lData ?? []) as Level[]
    setSavedRegions(rows)
    setSavedLevels(lvls)
    // Lo que llega de fuera (otra pestaña, una generación que terminó) NO puede
    // borrar lo que se está editando aquí. Si hay borrador a medias, solo se
    // actualiza la línea base; la pantalla se queda con lo del capacitador.
    if (!contentDirtyRef.current) {
      setRegions(rows)
      setLevels(lvls)
    }
    setQuizzes((qData ?? []) as Quiz[])
  }, [id])

  // Otra pestaña generó niveles o tocó el mundo: traer lo último al volver aquí.
  useFreshOnFocus(refreshWorldContent, {
    topics: ['worlds', 'arena'],
    enabled: !!id && !loading,
  })

  useEffect(() => {
    if (!id) return
    const onGenerated = async (e: Event) => {
      if ((e as CustomEvent).detail?.worldId !== id) return
      await refreshWorldContent()
    }
    window.addEventListener(WORLD_LEVELS_EVENT, onGenerated)
    return () => window.removeEventListener(WORLD_LEVELS_EVENT, onGenerated)
  }, [id, refreshWorldContent])

  /* ── Ambientación: borrador, como en el resto del panel ──
     Antes cada control escribía en la base en cuanto lo movías (autoguardado
     invisible): no había forma de probar un color y arrepentirse, ni de saber
     si lo que veías ya estaba guardado. Ahora se acumula en la barra del pie y
     se guarda con Ctrl+S. */
  const handleTheme = (field: string, value: string) => {
    setWorld(prev => prev ? { ...prev, [field]: value } : prev)
  }

  const themeDirty = JSON.stringify(world) !== JSON.stringify(savedWorld)
  const contentDirty =
    JSON.stringify(regions) !== JSON.stringify(savedRegions) ||
    JSON.stringify(levels) !== JSON.stringify(savedLevels) ||
    quizzesToCheck.length > 0
  /** Para que el refresco de fondo sepa si puede pisar la pantalla. */
  const contentDirtyRef = useRef(false)
  useEffect(() => { contentDirtyRef.current = contentDirty }, [contentDirty])
  /** Id de mentira → id real del último guardado (para generar con IA). */
  const regionIdMap = useRef(new Map<string, string>())

  /**
   * Deshacer de toda la pantalla (Ctrl+Z): ambientación, regiones y niveles.
   *
   * Va sobre el borrador completo, así que cubre lo que antes daba miedo:
   * borrar una región con sus niveles se recupera con una tecla. Es lo que
   * permite que quitar cosas de aquí ya no pregunte "¿seguro?".
   */
  const undoState = useMemo(
    () => ({ world, regions, levels }),
    [world, regions, levels],
  )
  const { undo, canUndo } = useUndoHistory({
    state: undoState,
    apply: useCallback((snap: { world: World | null; regions: Region[]; levels: Level[] }) => {
      setWorld(snap.world)
      setRegions(snap.regions)
      setLevels(snap.levels)
    }, []),
    enabled: !loading && !!world,
  })

  /**
   * Guarda TODO el mundo: ambientación, regiones y niveles.
   *
   * Las regiones van antes que los niveles porque un nivel nuevo puede colgar
   * de una región que tampoco existe todavía: hay que cambiarle el id de
   * mentira (`draft-r-…`) por el que devuelve la base antes de insertarlo.
   */
  const saveWorldAll = async (): Promise<boolean> => {
    if (!world || !savedWorld) return true
    try {
      /* ── 1. Ambientación ── */
      const patch: Record<string, unknown> = {}
      for (const k of ['sound_theme','transition_type','character_emoji','color'] as const) {
        if (world[k as keyof World] !== savedWorld[k as keyof World]) patch[k] = world[k as keyof World]
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('worlds').update(patch as never).eq('id', world.id)
        if (error) throw error
      }

      /* ── 2. Niveles y regiones que ya no están ── */
      const goneLevels = savedLevels.filter(l => !levels.some(x => x.id === l.id)).map(l => l.id)
      if (goneLevels.length > 0) {
        const { error } = await supabase.from('world_levels').delete().in('id', goneLevels)
        if (error) throw error
      }
      const goneRegions = savedRegions.filter(r => !regions.some(x => x.id === r.id)).map(r => r.id)
      if (goneRegions.length > 0) {
        // Por si quedó algún nivel colgando del lado del servidor.
        await supabase.from('world_levels').delete().in('region_id', goneRegions)
        const { error } = await supabase.from('world_regions').delete().in('id', goneRegions)
        if (error) throw error
      }

      /* ── 3. Regiones: nuevas y editadas ── */
      // Se reutiliza el Map del ref (no se reemplaza) para no escribir en
      // `.current` desde aquí: así el mapa sigue vivo para "Generar con IA".
      const realRegion = regionIdMap.current
      realRegion.clear()
      // Solo las columnas que esta pantalla edita: `select('*')` trae de vuelta
      // cosas como `created_at`, y reenviarlas en un update es pedir problemas.
      const regionPayload = (r: Region) => ({
        name: r.name, description: r.description, icon: r.icon,
        order_index: r.order_index, world_id: r.world_id, module_id: r.module_id,
      })
      for (const r of regions) {
        const payload = regionPayload(r)
        if (isDraftId(r.id)) {
          const { data, error } = await supabase.from('world_regions').insert(payload).select().single()
          if (error) throw error
          realRegion.set(r.id, (data as Region).id)
        } else {
          const before = savedRegions.find(x => x.id === r.id)
          if (before && JSON.stringify(before) !== JSON.stringify(r)) {
            const { error } = await supabase.from('world_regions').update(payload).eq('id', r.id)
            if (error) throw error
          }
        }
      }

      /* ── 4. Niveles: nuevos y editados, ya con la región de verdad ── */
      for (const l of levels) {
        const payload = {
          name: l.name, description: l.description, icon: l.icon,
          order_index: l.order_index, quiz_id: l.quiz_id, min_score_pct: l.min_score_pct,
          world_id: l.world_id,
          region_id: realRegion.get(l.region_id) ?? l.region_id,
        }
        if (isDraftId(l.id)) {
          const { error } = await supabase.from('world_levels').insert(payload).select().single()
          if (error) throw error
        } else {
          const before = savedLevels.find(x => x.id === l.id)
          if (before && JSON.stringify(before) !== JSON.stringify(l)) {
            const { error } = await supabase.from('world_levels').update(payload).eq('id', l.id)
            if (error) throw error
          }
        }
      }

      /* ── 5. Quizzes que se quedaron sin ningún nivel ── */
      for (const qid of quizzesToCheck) await deleteQuizIfOrphan(qid)
      setQuizzesToCheck([])

      setSavedWorld(world)
      // Relee: los ids de mentira pasan a ser los de verdad y la línea base
      // vuelve a coincidir con la base.
      contentDirtyRef.current = false
      await refreshWorldContent()
      return true
    } catch (err) {
      toast.error(
        i18n.t('admin.worlds.save_error', { defaultValue: 'No se pudo guardar el mundo.' }),
        (err as Error).message,
      )
      return false
    }
  }

  /* ── Publicar / despublicar ──
     La vista previa del aprendiz (/world) solo carga mundos publicados: si el
     mundo está en borrador, previsualizar terminaba en una pantalla vacía. Por
     eso el botón de publicar vive aquí, al lado de "Vista previa". */
  const [publishing, setPublishing] = useState(false)
  const handlePublish = async () => {
    if (!world || publishing) return
    const next = world.status === 'published' ? 'draft' : 'published'
    setPublishing(true)
    const { error } = await supabase.from('worlds').update({ status: next }).eq('id', world.id)
    setPublishing(false)
    if (error) { toast.error(i18n.t('admin.worlds.publish_error'), error.message); return }
    setWorld(prev => prev ? { ...prev, status: next } : prev)
    setSavedWorld(prev => prev ? { ...prev, status: next } : prev)
    toast.success(next === 'published' ? i18n.t('admin.worlds.publish_ok') : i18n.t('admin.worlds.unpublish_ok'))
  }

  /**
   * Deshacer DENTRO de los dos formularios en modal (región y nivel).
   *
   * El historial de la pantalla cubre el borrador del mundo, pero estos dos
   * formularios viven en su propio estado y no entran ahí: dentro del modal,
   * Ctrl+Z no tenía a quién preguntar. Solo están vivos mientras su modal está
   * abierto —si no, se quedarían con pasos de la vez anterior y le robarían el
   * atajo a la pantalla de detrás— y se olvidan al abrirlos (`reset`), porque
   * rellenar el formulario al abrir no es una edición de nadie.
   */
  const regionUndo = useUndoHistory({ state: regionForm, apply: setRegionForm, enabled: regionModal, trustChanges: true })
  const levelUndo = useUndoHistory({ state: levelForm, apply: setLevelForm, enabled: levelModal, trustChanges: true })

  /* ── Region CRUD ── */
  const openNewRegion = () => {
    regionUndo.reset()
    setEditingRegion(null)
    setRegionForm({ name:'', description:'', icon:'📍', order_index: regions.length })
    setRegionModuleId('')
    setRegionModal(true)
  }
  const openEditRegion = (r: Region) => {
    regionUndo.reset()
    setEditingRegion(r)
    setRegionForm({ name:r.name, description:r.description, icon:r.icon, order_index:r.order_index })
    setRegionModuleId(r.module_id ?? '')
    setRegionModal(true)
  }
  // Al elegir un módulo del curso, prellena nombre/ícono para dejar clara la
  // correspondencia región ↔ módulo (fuente de la IA).
  const pickRegionModule = (moduleId: string) => {
    setRegionModuleId(moduleId)
    const m = courseModules.find(x => x.id === moduleId)
    if (m) setRegionForm(f => ({
      ...f,
      name: f.name.trim() ? f.name : rowText(m),
      icon: (m.icon && m.icon.length <= 2) ? m.icon : f.icon,
    }))
  }
  const saveRegion = () => {
    if (!regionForm.name.trim() || !world) return
    const payload = { name:regionForm.name.trim(), description:regionForm.description.trim(), icon:regionForm.icon||'📍', order_index:regionForm.order_index, world_id:world.id, module_id: regionModuleId || null }
    if (editingRegion) {
      setRegions(prev => prev.map(r => r.id === editingRegion.id ? { ...r, ...payload } : r))
    } else {
      const nueva = { ...payload, id: draftId('r') } as Region
      setRegions(prev => [...prev, nueva])
      setExpanded(prev => ({ ...prev, [nueva.id]: true }))
    }
    setRegionModal(false)
  }
  // Borra el arena_quiz de un nivel si ningún otro nivel lo usa (evita quizzes
  // huérfanos que después ensucian el picker "Quiz del nivel").
  const deleteQuizIfOrphan = async (quizId: string | null) => {
    if (!quizId) return
    const { count } = await supabase
      .from('world_levels').select('id', { count: 'exact', head: true }).eq('quiz_id', quizId)
    if ((count ?? 0) === 0) {
      await supabase.from('arena_quizzes').delete().eq('id', quizId)
      setQuizzes(prev => prev.filter(q => q.id !== quizId))
    }
  }

  /**
   * Quitar una región es borrador: sale en la barra y se puede descartar. Sus
   * niveles se van con ella, y los quizzes que queden sin dueño se limpian al
   * guardar (no antes: hasta entonces no ha pasado nada en la base).
   */
  /**
   * Sin "¿seguro?": la región se va al borrador, sale en la barra, se recupera
   * con Ctrl+Z y no toca la base hasta que se guarda. Pedir permiso para algo
   * que todavía no ha pasado —y que se deshace con una tecla— es solo ruido.
   */
  const deleteRegion = (r: Region) => {
    const quizIds = Array.from(new Set(
      levels.filter(x => x.region_id === r.id).map(x => x.quiz_id).filter(Boolean),
    )) as string[]
    setRegions(prev => prev.filter(x => x.id !== r.id))
    setLevels(prev => prev.filter(x => x.region_id !== r.id))
    setQuizzesToCheck(prev => [...new Set([...prev, ...quizIds])])
  }

  /* ── Level CRUD ── */
  const openNewLevel = (regionId: string) => {
    levelUndo.reset()
    setEditingLevel(null)
    setActiveRegionId(regionId)
    setLevelForm({ name:'', description:'', icon:'⭐', order_index: levels.length, quiz_id:'', min_score_pct: null })
    setLevelModal(true)
  }
  const openEditLevel = (l: Level) => {
    levelUndo.reset()
    setEditingLevel(l)
    setActiveRegionId(l.region_id)
    setLevelForm({ name:l.name, description:l.description, icon:l.icon, order_index:l.order_index, quiz_id:l.quiz_id||'', min_score_pct: l.min_score_pct ?? null })
    setLevelModal(true)
  }
  const saveLevel = () => {
    if (!levelForm.name.trim() || !world || !activeRegionId) return
    if (levelForm.min_score_pct !== null && (levelForm.min_score_pct < 0 || levelForm.min_score_pct > 100)) {
      setLevelScoreError('El valor debe estar entre 0 y 100.')
      return
    }
    setLevelScoreError(null)
    const payload = { name:levelForm.name.trim(), description:levelForm.description.trim(), icon:levelForm.icon||'⭐', order_index:levelForm.order_index, quiz_id:levelForm.quiz_id||null, min_score_pct:levelForm.min_score_pct, region_id:activeRegionId, world_id:world.id }
    if (editingLevel) {
      setLevels(prev => prev.map(l => l.id === editingLevel.id ? { ...l, ...payload } : l))
    } else {
      setLevels(prev => [...prev, { ...payload, id: draftId('l') } as Level])
    }
    setLevelModal(false)
  }
  const deleteLevel = (l: Level) => {
    setLevels(prev => prev.filter(x => x.id !== l.id))
    if (l.quiz_id) setQuizzesToCheck(prev => [...new Set([...prev, l.quiz_id as string])])
  }

  // Quizzes de este mundo que no están asignados a ningún nivel (huérfanos,
  // típicamente restos de niveles borrados o de generaciones descartadas).
  const orphanQuizzes = quizzes.filter(q => !levels.some(l => l.quiz_id === q.id))

  // Borra los quizzes huérfanos de este mundo. Guarda contra referencias cruzadas
  // (un quiz usado por un nivel de otro mundo no se toca).
  const cleanupOrphanQuizzes = async () => {
    if (!world || orphanQuizzes.length === 0) return
    const orphanIds = orphanQuizzes.map(q => q.id)
    const { data: refs } = await supabase.from('world_levels').select('quiz_id').in('quiz_id', orphanIds)
    const referenced = new Set((refs ?? []).map(r => (r as { quiz_id: string | null }).quiz_id))
    const toDelete = orphanIds.filter(qid => !referenced.has(qid))
    if (toDelete.length === 0) return
    const ok = await confirm({
      title: t('admin.worlds.cleanup_quizzes_title', { defaultValue: 'Limpiar quizzes sin usar' }),
      description: t('admin.worlds.cleanup_quizzes_desc', { count: toDelete.length, defaultValue: `Se eliminarán ${toDelete.length} quiz(zes) que no están asignados a ningún nivel de este mundo. Esta acción no se puede deshacer.` }),
    })
    if (!ok) return
    const { error } = await supabase.from('arena_quizzes').delete().in('id', toDelete)
    if (!error) {
      setQuizzes(prev => prev.filter(q => !toDelete.includes(q.id)))
      toast.success(t('admin.worlds.cleanup_quizzes_ok', { count: toDelete.length, defaultValue: `${toDelete.length} quiz(zes) eliminados` }))
    } else {
      console.error('Error limpiando quizzes huérfanos:', error)
      toast.error(t('admin.worlds.cleanup_quizzes_error', { defaultValue: 'No se pudieron eliminar los quizzes' }), error.message)
    }
  }

  // Abre el editor de quiz: sin id crea uno nuevo; con id carga el quiz completo
  // para editar sus preguntas sin salir del modal de nivel.
  const openQuizEditor = async (quizId: string | null) => {
    if (!quizId) { setEditingQuizFull(null); setQuizEditorOpen(true); return }
    setLoadingQuizEdit(true)
    const { data, error } = await supabase.from('arena_quizzes').select('*').eq('id', quizId).single()
    setLoadingQuizEdit(false)
    if (error || !data) {
      toast.error(t('admin.worlds.quiz_load_error', { defaultValue: 'No se pudo cargar el quiz' }))
      return
    }
    setEditingQuizFull(normalizeArenaRow(data as Record<string, unknown>))
    setQuizEditorOpen(true)
  }

  const closeQuizEditor = () => { setQuizEditorOpen(false); setEditingQuizFull(null) }

  // Quiz creado o editado inline → actualizo su título en la lista (o lo sumo) y
  // lo dejo seleccionado en el nivel.
  const onQuizSaved = (q: ArenaQuiz) => {
    setQuizzes(prev => prev.some(x => x.id === q.id)
      ? prev.map(x => (x.id === q.id ? { id: q.id, title: q.title } : x))
      : [...prev, { id: q.id, title: q.title }])
    setLevelForm(f => ({ ...f, quiz_id: q.id }))
    closeQuizEditor()
  }

  /* ── Generar niveles con IA (por región) ── */
  const openAiGen = (region: Region) => {
    setAiRegion(region)
    setAiLevels(3)
    setAiSections(2)
    setAiPerSection(DEFAULT_QUESTIONS_PER_SECTION)
    setAiMinScore(80)
  }
  // Dispara la generación EN SEGUNDO PLANO (cancelable) y cierra el modal: el
  // avance vive en el indicador global. Al terminar, WORLD_LEVELS_EVENT refresca.
  /**
   * La generación corre en el servidor y escribe los niveles directamente, así
   * que necesita una región que exista de verdad. Si hay algo sin guardar, se
   * guarda primero y se toma el id real de la región recién creada: es lo que
   * el capacitador haría a mano, y así "Generar con IA" nunca falla en silencio.
   */
  const ensureSaved = async (): Promise<boolean> => {
    if (!themeDirty && !contentDirty) return true
    const ok = await saveWorldAll()
    if (ok) toast.info(i18n.t('admin.worlds.saved_before_ai', { defaultValue: 'Se guardaron los cambios pendientes antes de generar.' }))
    return ok
  }

  const runAiGen = async () => {
    if (!world || !aiRegion) return
    if (!(await ensureSaved())) return
    const realId = regionIdMap.current.get(aiRegion.id) ?? aiRegion.id
    if (isDraftId(realId)) return
    const region = { ...aiRegion, id: realId }
    const perSection = aiPerSection === '' ? DEFAULT_QUESTIONS_PER_SECTION : Number(aiPerSection)
    generateLevelsForRegion({
      worldId: world.id,
      regionId: region.id,
      regionName: region.name,
      regionDescription: region.description,
      moduleId: region.module_id,
      levelCount: aiLevels === '' ? 3 : Number(aiLevels),
      questionsPerLevel: (aiSections === '' ? 2 : Number(aiSections)) * perSection,
      sectionSize: perSection,
      minScorePct: aiMinScore === '' ? 80 : Number(aiMinScore),
    })
    setExpanded(prev => ({ ...prev, [region.id]: true }))
    toast.success(i18n.t('admin.worlds.ai_gen_started'))
    setAiRegion(null)
  }

  // Módulos del curso que todavía no tienen su región en este mundo.
  const modulesWithoutRegion = courseModules.filter(
    m => !regions.some(r => r.module_id === m.id),
  )

  /* ── Generar en bloque: una región por módulo pendiente + sus niveles ── */
  // En SEGUNDO PLANO (cancelable): crea la región y genera niveles por cada módulo
  // pendiente. Al terminar, WORLD_LEVELS_EVENT refresca la vista.
  const runBulkGen = async () => {
    if (!world || modulesWithoutRegion.length === 0) return
    if (!(await ensureSaved())) return
    const lvl = bulkLevels === '' ? 3 : Number(bulkLevels)
    const perSection = bulkPerSection === '' ? DEFAULT_QUESTIONS_PER_SECTION : Number(bulkPerSection)
    const qpl = (bulkSections === '' ? 2 : Number(bulkSections)) * perSection
    generateBulkModuleRegions(
      world as unknown as WorldRow,
      modulesWithoutRegion.map(m => ({ id: m.id, title_es: m.title_es, icon: m.icon })),
      regions.length,
      { levelCount: lvl, questionsPerLevel: qpl, sectionSize: perSection },
    )
    toast.success(i18n.t('admin.worlds.ai_gen_started'))
    setBulkOpen(false)
  }

  /* ── Generar regiones desde módulos elegidos a mano (multi-curso) ── */
  // Mismo motor que el bloque del curso enlazado, pero la fuente son módulos de
  // cualquier curso accesible: cada uno se vuelve una región completa.
  const runPickerGen = async (mods: PickedModule[], opts: WorldGenOptions) => {
    if (!world || mods.length === 0) return
    if (!(await ensureSaved())) return
    generateBulkModuleRegions(world as unknown as WorldRow, mods, regions.length, opts)
    toast.success(i18n.t('admin.worlds.ai_gen_started'))
    setPickerOpen(false)
  }

  const resetProgress = async () => {
    if (!world || !user) return
    setResetting(true)
    const { data: levelRows } = await supabase.from('world_levels').select('id').eq('world_id', world.id)
    const levelIds = (levelRows || []).map(l => l.id)
    const { error } = await supabase.from('world_progress').delete().eq('user_id', user.id).in('level_id', levelIds)
    setResetting(false)
    setShowResetConfirm(false)
    if (error) {
      console.error('world_progress delete error:', error, { userId: user.id, worldId: world.id })
      setResetError(true)
      setTimeout(() => setResetError(false), 3000)
    } else {
      setResetToast(true)
      setTimeout(() => setResetToast(false), 3000)
    }
  }

  if (loading || authLoading) return <div className="p-8 text-text-muted">{i18n.t('admin.worlds.loading')}</div>
  if (!world) return <div className="p-8 text-text-muted">{i18n.t('admin.worlds.world_not_found')}</div>
  if (scopedToCampaign) {
    if (myCampaignIds === undefined) {
      return <div className="p-8 text-text-muted">{i18n.t('admin.worlds.loading')}</div>
    }
    if (myCampaignIds.length === 0) {
      return <div className="p-8 text-text-muted">{i18n.t('admin.worlds.no_campaign_desc')}</div>
    }
  }
  const worldInMyCampaigns =
    !!world.campaign_id && !!myCampaignIds?.includes(world.campaign_id)
  if (scopedToCampaign && !worldInMyCampaigns) {
    return (
      <div className="p-4 sm:p-8">
        <button onClick={() => navigate('/admin/worlds')}
          className="flex items-center gap-2 text-text-muted hover:text-text transition-colors mb-5 sm:mb-6 text-[13px] min-h-[44px]">
          <ArrowLeft className="h-4 w-4" /> {i18n.t('admin.worlds.back_to_worlds')}
        </button>
        <div
          className="rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}
        >
          <div className="text-[15px] font-medium mb-2" style={{ color: '#ef4444' }}>{i18n.t('admin.worlds.access_denied')}</div>
          <div className="text-[13px] text-text-muted">{i18n.t('admin.worlds.access_denied_desc')}</div>
        </div>
      </div>
    )
  }

  const tc = world.color
  const isPublished = world.status === 'published'

  return (
    <>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">

        {/* ── Back ── */}
        <button onClick={() => navigate('/admin/worlds')}
          className="flex items-center gap-2 text-text-muted hover:text-text transition-colors mb-5 sm:mb-6 text-[13px] min-h-[44px]">
          <ArrowLeft className="h-4 w-4" /> {i18n.t('admin.worlds.back_to_worlds')}
        </button>

        <EditingBanner coeditors={coeditors} />

        {/* ── World header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6 mt-3 p-4 sm:p-5 rounded-2xl bg-surface border border-line">
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-[28px] flex-shrink-0" style={{ background:`${tc}18` }}>
            {world.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-[18px] sm:text-[20px] font-bold text-text leading-none">{world.name}</h1>
              {coeditors.length > 0 && <PresenceStack peers={coeditors} size={26} />}
            </div>
            {world.description && <p className="text-[13px] text-text-muted leading-relaxed">{world.description}</p>}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background:`${tc}15`, color:tc }}>{BG_LABELS[world.bg_type] ? i18n.t(BG_LABELS[world.bg_type]) : world.bg_type}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${isPublished ? 'text-[#10D451]' : 'text-text-muted'}`} style={{ background: isPublished ? 'rgba(16,212,81,0.1)' : 'rgb(var(--glass-border) / 0.06)' }}>
                {isPublished ? 'Publicado' : 'Borrador'}
              </span>
              {/* Vínculo con el curso: la fuente de conocimiento del mundo. */}
              {linkedCourse ? (
                <button
                  onClick={() => navigate(`/admin/courses/${linkedCourse.id}`)}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors"
                  style={{ background:'rgba(99,102,241,0.12)', color:'#6366F1', border:'1px solid rgba(99,102,241,0.25)' }}
                  title={i18n.t('admin.worlds.go_to_course')}>
                  <BookOpen className="h-3 w-3" /> {i18n.t('admin.worlds.linked_course')}: {rowText(linkedCourse)}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background:'rgba(245,158,11,0.10)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.25)' }}
                  title={i18n.t('admin.worlds.not_linked_hint')}>
                  <AlertTriangle className="h-3 w-3" /> {i18n.t('admin.worlds.not_linked')}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-row sm:flex-col gap-2">
            {/* Publicar habilita la vista previa: en borrador el mundo no es
                visitable y previsualizar solo llevaba a una pantalla vacía. */}
            <button onClick={handlePublish} disabled={publishing}
              className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-60"
              style={
                isPublished
                  ? { background:'rgb(var(--glass-border) / 0.06)', color:'rgb(var(--text-muted))', border:'1px solid rgb(var(--glass-border) / 0.10)' }
                  : { background:'rgba(16,212,81,0.10)', color:'#10D451', border:'1px solid rgba(16,212,81,0.22)' }
              }>
              {isPublished ? 'Despublicar' : 'Publicar'}
            </button>
            <button
              onClick={() => navigate(`/world`, { state:{ from:'admin', worldId:world.id } })}
              disabled={!isPublished}
              title={isPublished ? undefined : 'Publica el mundo para poder previsualizarlo'}
              className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:cursor-not-allowed"
              style={
                isPublished
                  ? { background:`${tc}15`, color:tc, border:`1px solid ${tc}30` }
                  : { background:'rgb(var(--glass-border) / 0.04)', color:'rgb(var(--text-subtle))', border:'1px solid rgb(var(--glass-border) / 0.10)' }
              }>
              {!isPublished && <Lock className="h-3.5 w-3.5 mr-1.5" />}
              Vista previa
            </button>
            {isSuperAdmin && (
              <button onClick={() => setShowResetConfirm(true)}
                className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors"
                style={{ background:'rgba(239,68,68,0.07)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.22)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.13)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.07)' }}>
                Reiniciar mi progreso
              </button>
            )}
          </div>
        </div>

        {/* ── Theme config ── */}
        <div className="rounded-2xl bg-surface border border-line p-4 sm:p-5 mb-6">
          <h2 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-4">{i18n.t('admin.worlds.visual_config')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.sound')}</label>
              <Select value={world.sound_theme||'neutral'} onChange={v => handleTheme('sound_theme',v)}
                options={Object.entries(SOUND_LABELS).map(([k,v]) => ({ value: k, label: i18n.t(v) }))} />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.transition')}</label>
              <Select value={world.transition_type||'clouds'} onChange={v => handleTheme('transition_type',v)}
                options={Object.entries(TRANS_LABELS).map(([k,v]) => ({ value: k, label: i18n.t(v) }))} />
              <button type="button" onClick={() => setPreviewTrans(true)}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium transition-opacity hover:opacity-70"
                style={{ color: world.color }}>
                <Play className="h-3 w-3" /> {i18n.t('admin.worlds.preview_transition', { defaultValue: 'Previsualizar' })}
              </button>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.character')}</label>
              <EmojiPicker value={world.character_emoji || '🧑'} onSelect={v => handleTheme('character_emoji', v)}
                aria-label={i18n.t('admin.worlds.character')} />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.color_emoji')}</label>
              <input type="color" value={world.color} onChange={e => handleTheme('color',e.target.value)}
                className="h-[42px] w-full rounded-xl border border-line bg-bg cursor-pointer p-1"/>
            </div>
          </div>
          <p className="text-[11px] text-text-muted mt-3 opacity-60">{i18n.t('admin.worlds.auto_save_hint')}</p>
        </div>

        {/* ── Aviso de vínculo con el curso ── */}
        {linkedCourse ? (
          <div className="flex items-start gap-2.5 mb-4 rounded-xl px-3.5 py-3" style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.20)' }}>
            <BookOpen className="h-4 w-4 shrink-0 mt-0.5" style={{ color:'#6366F1' }} />
            <p className="text-[12px] text-text-muted leading-relaxed">{i18n.t('admin.worlds.course_linked_banner')}</p>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 mb-4 rounded-xl px-3.5 py-3" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.20)' }}>
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color:'#f59e0b' }} />
            <p className="text-[12px] text-text-muted leading-relaxed">{i18n.t('admin.worlds.not_linked_banner')}</p>
          </div>
        )}

        {/* ── Generar regiones desde el curso (una por módulo) ── */}
        {linkedCourse && modulesWithoutRegion.length > 0 && (
          <div className="mb-4 rounded-2xl p-4 sm:p-5" style={{ background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.22)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background:'rgba(139,92,246,0.14)' }}>
                <Sparkles className="h-5 w-5" style={{ color:'#8B5CF6' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-text">
                  {modulesWithoutRegion.length === courseModules.length
                    ? i18n.t('admin.worlds.bulk_cta_title', { name: rowText(linkedCourse), count: modulesWithoutRegion.length, defaultValue: `Arma este mundo desde “${rowText(linkedCourse)}”` })
                    : i18n.t('admin.worlds.bulk_cta_more', { count: modulesWithoutRegion.length, defaultValue: `${modulesWithoutRegion.length} módulo(s) del curso todavía sin región` })}
                </div>
                <div className="text-[12px] text-text-muted mt-0.5">
                  {i18n.t('admin.worlds.bulk_cta_desc', { count: modulesWithoutRegion.length, defaultValue: `La IA crea una región por módulo y genera sus niveles y preguntas a partir del contenido. Todo queda editable.` })}
                </div>
              </div>
              <button onClick={() => setBulkOpen(true)}
                className="flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-semibold shrink-0 transition-colors"
                style={{ background:'rgba(139,92,246,0.16)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.30)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.24)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.16)'}>
                <Sparkles className="h-4 w-4" />
                {i18n.t('admin.worlds.bulk_cta_btn', { count: modulesWithoutRegion.length, defaultValue: `Generar ${modulesWithoutRegion.length} regiones` })}
              </button>
            </div>
          </div>
        )}

        {/* ── Preview en vivo del recorrido ── */}
        {regions.length > 0 && (
          <div className="mb-4 rounded-2xl bg-surface border border-line p-3.5 sm:p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[16px]">{world.character_emoji || '🧑'}</span>
              <span className="text-[12px] font-semibold text-text-muted uppercase tracking-wider">
                {i18n.t('admin.worlds.preview_title', { defaultValue: 'Así se verá el recorrido' })}
              </span>
            </div>
            <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
              {regions.sort((a,b) => a.order_index - b.order_index).map((region, ri) => {
                const rLevels = levels.filter(l => l.region_id === region.id).sort((a,b) => a.order_index - b.order_index)
                return (
                  <div key={region.id} className="flex items-center gap-2 shrink-0">
                    {ri > 0 && <ChevronRight className="h-3.5 w-3.5 text-text-subtle/50 shrink-0" />}
                    <button
                      onClick={() => setExpanded(prev => ({ ...prev, [region.id]: true }))}
                      title={region.name}
                      className="flex flex-col items-center gap-1.5 rounded-xl px-3 py-2 border transition-colors hover:bg-bg"
                      style={{ borderColor:`${tc}22`, background:`${tc}08` }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[15px]">{region.icon}</span>
                        <span className="text-[12px] font-medium text-text max-w-[120px] truncate">{region.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {rLevels.length === 0 ? (
                          <span className="text-[10px] text-amber-500">{i18n.t('admin.worlds.preview_empty_region', { defaultValue: 'sin niveles' })}</span>
                        ) : rLevels.map(l => (
                          <span key={l.id} title={l.name}
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={l.quiz_id
                              ? { background: tc }
                              : { background:'transparent', border:'1.5px solid #f59e0b' }} />
                        ))}
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-3 mt-2.5 text-[10.5px] text-text-muted">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background:tc }} /> {i18n.t('admin.worlds.preview_with_quiz', { defaultValue: 'nivel con quiz' })}</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background:'transparent', border:'1.5px solid #f59e0b' }} /> {i18n.t('admin.worlds.preview_no_quiz', { defaultValue: 'sin quiz' })}</span>
            </div>
          </div>
        )}

        {/* ── Regions ── */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-[15px] sm:text-[16px] font-bold text-text">{i18n.t('admin.worlds.regions_levels')}</h2>
            <p className="text-[12px] text-text-muted mt-0.5 hidden sm:block">{i18n.t('admin.worlds.regions_hint')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {orphanQuizzes.length > 0 && (
              <button onClick={cleanupOrphanQuizzes}
                title={i18n.t('admin.worlds.cleanup_quizzes_title', { defaultValue: 'Limpiar quizzes sin usar' })}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] sm:text-[13px] font-medium transition-colors min-h-[44px]"
                style={{ background:'rgba(245,158,11,0.10)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.25)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(245,158,11,0.18)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='rgba(245,158,11,0.10)'}>
                <Trash2 className="h-3.5 w-3.5"/>
                <span className="hidden sm:inline">{i18n.t('admin.worlds.cleanup_quizzes_btn', { count: orphanQuizzes.length, defaultValue: `Limpiar ${orphanQuizzes.length} quiz sin usar` })}</span>
                <span className="sm:hidden">{orphanQuizzes.length}</span>
              </button>
            )}
            {/* Regiones desde módulos de cualquier curso (no solo el enlazado) */}
            <button onClick={() => setPickerOpen(true)}
              title={i18n.t('admin.worlds.from_modules_hint', { defaultValue: 'Elige módulos de tus cursos: cada uno se vuelve una región generada con IA.' })}
              className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[12px] sm:text-[13px] font-medium transition-colors min-h-[44px]"
              style={{ background:'rgba(139,92,246,0.12)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.25)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.20)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.12)'}>
              <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4"/>
              <span className="hidden sm:inline">{i18n.t('admin.worlds.from_modules_btn', { defaultValue: 'Desde módulos' })}</span>
            </button>
            <button onClick={openNewRegion}
              className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[12px] sm:text-[13px] font-medium transition-colors min-h-[44px]"
              style={{ background:'rgba(16,212,81,0.12)', color:'#10D451', border:'1px solid rgba(16,212,81,0.25)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(16,212,81,0.20)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='rgba(16,212,81,0.12)'}>
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4"/> <span className="hidden xs:inline">{i18n.t('admin.worlds.new_f')}</span> región
            </button>
          </div>
        </div>

        {regions.length === 0 ? (
          <div className="rounded-2xl p-6 sm:p-10 text-center border border-dashed border-line">
            <div className="text-3xl mb-3">🗺️</div>
            <div className="text-[14px] font-medium text-text mb-1">{i18n.t('admin.worlds.no_regions')}</div>
            <div className="text-[12px] text-text-muted mb-4">{i18n.t('admin.worlds.no_regions_hint')}</div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button onClick={() => setPickerOpen(true)} className="flex items-center justify-center gap-2 min-h-[44px] text-[13px] font-semibold px-4 py-2 rounded-xl" style={{ background:'rgba(139,92,246,0.16)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.30)' }}>
                <Sparkles className="h-4 w-4"/>
                {i18n.t('admin.worlds.from_modules_cta', { defaultValue: 'Armar desde módulos de mis cursos' })}
              </button>
              <button onClick={openNewRegion} className="flex items-center justify-center min-h-[44px] text-[13px] font-medium px-4 py-2 rounded-xl" style={{ background:'rgba(16,212,81,0.12)', color:'#10D451', border:'1px solid rgba(16,212,81,0.25)' }}>
                + {i18n.t('admin.worlds.new_region')}
              </button>
            </div>
          </div>
        ) : (
          <Stagger className="flex flex-col gap-3">
            {regions.sort((a,b) => a.order_index - b.order_index).map((region, ri) => {
              const regionLevels = levels.filter(l => l.region_id === region.id).sort((a,b) => a.order_index - b.order_index)
              const isOpen = expanded[region.id] ?? false
              return (
                <StaggerItem key={region.id} className="rounded-2xl border border-line bg-surface overflow-hidden">
                  {/* Region header */}
                  <div className="flex items-center gap-3 px-3 sm:px-5 py-3 sm:py-4 cursor-pointer select-none"
                    onClick={() => setExpanded(prev => ({ ...prev, [region.id]: !isOpen }))}>
                    <div className="h-8 w-8 rounded-xl flex items-center justify-center text-[16px] flex-shrink-0" style={{ background:`${tc}15` }}>
                      {region.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-text">{region.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-subtle text-text-muted font-medium">#{ri+1}</span>
                        <span className="text-[10px] text-text-muted">{regionLevels.length} {regionLevels.length === 1 ? 'nivel' : 'niveles'}</span>
                      </div>
                      {region.description && <p className="text-[12px] text-text-muted truncate mt-0.5">{region.description}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); openAiGen(region) }}
                        title={i18n.t('admin.worlds.ai_gen_levels')}
                        className="flex items-center justify-center gap-1.5 h-9 px-2.5 rounded-lg text-[11px] font-medium transition-colors"
                        style={{ background:'rgba(139,92,246,0.12)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.25)' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.20)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='rgba(139,92,246,0.12)'}>
                        <Sparkles className="h-3.5 w-3.5"/> <span className="hidden sm:inline">{t('admin.worlds.ai_badge')}</span>
                      </button>
                      <button onClick={e => { e.stopPropagation(); openEditRegion(region) }}
                        className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-subtle">
                        <Pencil className="h-4 w-4"/>
                      </button>
                      <button onClick={e => { e.stopPropagation(); deleteRegion(region) }}
                        className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                        <Trash2 className="h-4 w-4"/>
                      </button>
                      <ChevronRight className={`h-4 w-4 text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}/>
                    </div>
                  </div>

                  {/* Levels */}
                  <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className="border-t border-line overflow-hidden"
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {regionLevels.length === 0 ? (
                        <div className="px-5 py-6 text-center">
                          <div className="text-[12px] text-text-muted mb-3">{i18n.t('admin.worlds.no_levels_hint')}</div>
                          <div className="flex items-center justify-center gap-2 flex-wrap">
                            <button onClick={() => openAiGen(region)}
                              className="flex items-center justify-center gap-1.5 min-h-[44px] text-[12px] font-medium px-3 py-1.5 rounded-lg"
                              style={{ background:'rgba(139,92,246,0.12)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.25)' }}>
                              <Sparkles className="h-3.5 w-3.5"/> {i18n.t('admin.worlds.ai_gen_levels')}
                            </button>
                            <button onClick={() => openNewLevel(region.id)}
                              className="flex items-center justify-center min-h-[44px] text-[12px] font-medium px-3 py-1.5 rounded-lg"
                              style={{ background:`${tc}12`, color:tc, border:`1px solid ${tc}25` }}>
                              + {i18n.t('admin.worlds.add_level')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          {regionLevels.map((level, li) => {
                            const quiz = quizzes.find(q => q.id === level.quiz_id)
                            return (
                              <div key={level.id} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 border-b border-line/50 last:border-b-0 hover:bg-bg/40 transition-colors group">
                                {/* Order indicator */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-800" style={{ background:`${tc}15`, color:tc, fontWeight:700 }}>
                                    {li+1}
                                  </div>
                                  <span className="text-[16px]">{level.icon}</span>
                                </div>
                                {/* Level info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[13px] font-medium text-text">{level.name}</span>
                                    {quiz && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium truncate max-w-[140px]" style={{ background:`${tc}10`, color:tc, border:`1px solid ${tc}20` }}>
                                        📋 {quiz.title}
                                      </span>
                                    )}
                                    {!quiz && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full text-amber-500 bg-amber-500/10 border border-amber-500/20">
                                        ⚠️ Sin quiz
                                      </span>
                                    )}
                                  </div>
                                  {level.description && <p className="text-[11px] text-text-muted mt-0.5 truncate">{level.description}</p>}
                                </div>
                                {/* Actions */}
                                <div className="flex items-center gap-1.5 flex-shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => navigate(`/arena/${level.quiz_id}`, { state:{ from:'admin', worldId:world.id, levelId:level.id } })}
                                    disabled={!level.quiz_id}
                                    className="flex items-center justify-center min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-30"
                                    style={{ background:`${tc}12`, color:tc, border:`1px solid ${tc}25` }}>
                                    Probar
                                  </button>
                                  <button onClick={() => openEditLevel(level)}
                                    className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:bg-subtle">
                                    <Pencil className="h-4 w-4"/>
                                  </button>
                                  <button onClick={() => deleteLevel(level)}
                                    className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-400">
                                    <Trash2 className="h-4 w-4"/>
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                          {/* Add level button */}
                          <div className="px-3 sm:px-5 py-3 border-t border-line/30">
                            <button onClick={() => openNewLevel(region.id)}
                              className="flex items-center gap-2 text-[12px] font-medium transition-colors"
                              style={{ color:tc }}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity='.7'}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity='1'}>
                              <Plus className="h-3.5 w-3.5"/> {i18n.t('admin.worlds.add_level')}
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                  </AnimatePresence>
                </StaggerItem>
              )
            })}
          </Stagger>
        )}
      </div>

      {/* ── Region Modal ── */}
      <AnimatePresence>
      {regionModal && (
        <ModalShell onClose={() => setRegionModal(false)} className="max-w-md" reduce={reduce}>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[15px] font-semibold text-text">{editingRegion ? i18n.t('admin.worlds.edit_region') : i18n.t('admin.worlds.new_region')}</h2>
              <button onClick={() => setRegionModal(false)} className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-subtle">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {/* Basar la región en un módulo del curso → la IA genera sus niveles
                  anclada al contenido del módulo (sin inventar). */}
              {linkedCourse && (
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.region_from_module')}</label>
                  <Select value={regionModuleId} onChange={v => pickRegionModule(v)}
                    options={[
                      { value: '', label: i18n.t('admin.worlds.region_custom') },
                      ...courseModules
                        .filter(m => m.id === regionModuleId || !regions.some(r => r.module_id === m.id))
                        .map(m => ({ value: m.id, label: rowText(m) })),
                    ]} />
                  <p className="text-[11px] text-text-muted mt-1">
                    {regionModuleId ? i18n.t('admin.worlds.region_module_hint') : i18n.t('admin.worlds.region_custom_hint')}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.name_required')}</label>
                <input required value={regionForm.name} onChange={e => setRegionForm(f => ({...f,name:e.target.value}))}
                  placeholder={i18n.t('admin.worlds.ph_region_name')}
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.description')}</label>
                <input value={regionForm.description} onChange={e => setRegionForm(f => ({...f,description:e.target.value}))}
                  placeholder={i18n.t('admin.worlds.desc_optional')}
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.icon')}</label>
                  <input value={regionForm.icon} onChange={e => setRegionForm(f => ({...f,icon:e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-[20px] bg-bg border border-line text-text focus:outline-none text-center min-h-[44px]" maxLength={2}/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.order')}</label>
                  <input type="number" value={regionForm.order_index} onChange={e => setRegionForm(f => ({...f,order_index:parseInt(e.target.value)||0}))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              <button onClick={() => setRegionModal(false)} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">{i18n.t('confirm.cancel')}</button>
              <button onClick={saveRegion} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50"
                style={{ background:'rgba(16,212,81,0.14)', color:'#10D451', border:'1px solid rgba(16,212,81,0.28)' }}>
                {editingRegion ? i18n.t('common.save') : i18n.t('admin.worlds.create_region')}
              </button>
            </div>
        </ModalShell>
      )}
      </AnimatePresence>

      {/* ── Level Modal ── */}
      <AnimatePresence>
      {levelModal && (
        <ModalShell onClose={() => setLevelModal(false)} className="max-w-md" reduce={reduce}>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[15px] font-semibold text-text">{editingLevel ? i18n.t('admin.worlds.edit_level') : i18n.t('admin.worlds.new_level')}</h2>
              <button onClick={() => setLevelModal(false)} className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-subtle">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.name_required')}</label>
                <input required value={levelForm.name} onChange={e => setLevelForm(f => ({...f,name:e.target.value}))}
                  placeholder={i18n.t('admin.worlds.ph_level_name')}
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-[12px] font-medium text-text-muted">{i18n.t('admin.worlds.arena_quiz')}</label>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Editar el quiz seleccionado (sus preguntas) sin salir del nivel */}
                    {levelForm.quiz_id && (
                      <button type="button" onClick={() => openQuizEditor(levelForm.quiz_id)} disabled={loadingQuizEdit}
                        className="flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-70 disabled:opacity-50"
                        style={{ color:'#8B5CF6' }}>
                        <Pencil className="h-3 w-3" /> {loadingQuizEdit ? i18n.t('common.loading', { defaultValue: 'Cargando…' }) : i18n.t('admin.worlds.quiz_edit', { defaultValue: 'Editar quiz' })}
                      </button>
                    )}
                    <button type="button" onClick={() => openQuizEditor(null)}
                      className="flex items-center gap-1 text-[11px] font-medium transition-opacity hover:opacity-70"
                      style={{ color:'#10D451' }}>
                      <Plus className="h-3 w-3" /> {i18n.t('admin.worlds.quiz_new', { defaultValue: 'Crear quiz nuevo' })}
                    </button>
                  </div>
                </div>
                {/* Todos los quizzes de este mundo. Los que ya usa otro nivel se
                    marcan "· en uso" pero se pueden reutilizar (mismo banco de
                    preguntas en varios niveles). */}
                <Select value={levelForm.quiz_id} onChange={v => setLevelForm(f => ({...f,quiz_id:v}))}
                  options={[
                    { value: '', label: i18n.t('admin.worlds.no_quiz_assigned') },
                    ...quizzes.map(q => {
                      const usedElsewhere = levels.some(l => l.quiz_id === q.id && l.id !== editingLevel?.id)
                      return { value: q.id, label: usedElsewhere ? `${q.title} · ${i18n.t('admin.worlds.quiz_in_use', { defaultValue: 'en uso' })}` : q.title }
                    }),
                  ]} />
                <p className="text-[11px] text-text-muted mt-1">
                  {quizzes.length === 0
                    ? i18n.t('admin.worlds.quiz_none_yet', { defaultValue: 'Todavía no hay quizzes. Crea uno con “Crear quiz nuevo”.' })
                    : i18n.t('admin.worlds.quiz_pick_edit_create', { defaultValue: 'Elige un quiz (puedes reutilizar el mismo en varios niveles), edita el seleccionado o crea uno nuevo.' })}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.icon')}</label>
                  <input value={levelForm.icon} onChange={e => setLevelForm(f => ({...f,icon:e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-[20px] bg-bg border border-line text-text focus:outline-none text-center min-h-[44px]" maxLength={2}/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.description')}</label>
                  <input value={levelForm.description} onChange={e => setLevelForm(f => ({...f,description:e.target.value}))}
                    placeholder={i18n.t('admin.worlds.optional')}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.min_score')}</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={levelForm.min_score_pct ?? ''}
                  onChange={e => {
                    setLevelScoreError(null)
                    setLevelForm(f => ({
                      ...f,
                      min_score_pct: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }}
                  placeholder={i18n.t('admin.worlds.ph_min_score')}
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border text-text placeholder-text-subtle focus:outline-none transition-colors min-h-[44px]"
                  style={{ borderColor: levelScoreError ? '#ef4444' : undefined }}/>
                {levelScoreError && (
                  <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{levelScoreError}</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              <button onClick={() => setLevelModal(false)} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">{i18n.t('confirm.cancel')}</button>
              <button onClick={saveLevel} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50"
                style={{ background:'rgba(16,212,81,0.14)', color:'#10D451', border:'1px solid rgba(16,212,81,0.28)' }}>
                {editingLevel ? i18n.t('common.save') : i18n.t('admin.worlds.create_level')}
              </button>
            </div>
        </ModalShell>
      )}
      </AnimatePresence>

      {/* ── Generar niveles con IA (modal) ── */}
      <AnimatePresence>
      {aiRegion && (
        <ModalShell onClose={() => setAiRegion(null)} className="max-w-md" reduce={reduce}>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[15px] font-semibold text-text flex items-center gap-2">
                <Sparkles className="h-4 w-4" style={{ color:'#8B5CF6' }} />
                {i18n.t('admin.worlds.ai_gen_title')}
              </h2>
              <button onClick={() => setAiRegion(null)} className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-subtle">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div className="flex items-center gap-3 rounded-xl bg-bg border border-line px-3.5 py-3">
                <div className="h-9 w-9 rounded-lg flex items-center justify-center text-[18px] shrink-0" style={{ background:`${tc}15` }}>{aiRegion.icon}</div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-text truncate">{aiRegion.name}</div>
                  {aiRegion.description && <div className="text-[11px] text-text-muted truncate">{aiRegion.description}</div>}
                </div>
              </div>
              <p className="text-[12px] text-text-muted">{i18n.t('admin.worlds.ai_gen_desc')}</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.gen_levels_label')}</label>
                  <input type="number" min={1} max={10} value={aiLevels}
                    onChange={e => setAiLevels(e.target.value === '' ? '' : Math.max(1, Math.min(10, Number(e.target.value))))}
                    placeholder={i18n.t('admin.worlds.gen_levels_ph')}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.gen_sections_label')}</label>
                  <input type="number" min={1} max={5} value={aiSections}
                    onChange={e => setAiSections(e.target.value === '' ? '' : Math.max(1, Math.min(5, Number(e.target.value))))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.gen_per_section_label', { defaultValue: 'Preg./sección' })}</label>
                  <input type="number" min={1} max={5} value={aiPerSection}
                    onChange={e => setAiPerSection(e.target.value === '' ? '' : Math.max(1, Math.min(5, Number(e.target.value))))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
              </div>
              <p className="text-[11px] text-text-muted -mt-1">{i18n.t('admin.worlds.gen_sections_hint', { total: (aiSections === '' ? 2 : Number(aiSections)) * (aiPerSection === '' ? DEFAULT_QUESTIONS_PER_SECTION : Number(aiPerSection)) })}</p>
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.gen_min_score_label')}</label>
                <div className="relative">
                  <input type="number" min={0} max={100} value={aiMinScore}
                    onChange={e => setAiMinScore(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))}
                    className="w-full px-3 py-2.5 pr-8 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-text-muted pointer-events-none">%</span>
                </div>
                <p className="text-[11px] text-text-muted mt-1">{i18n.t('admin.worlds.gen_min_score_hint')}</p>
              </div>
              <AiReviewNotice />
            </div>
            <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              <button onClick={() => setAiRegion(null)}
                className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">
                {i18n.t('confirm.cancel')}
              </button>
              <button onClick={() => void runAiGen()}
                className="flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium"
                style={{ background:'rgba(139,92,246,0.16)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.30)' }}>
                <Sparkles className="h-4 w-4"/> {i18n.t('admin.worlds.ai_gen_submit')}
              </button>
            </div>
        </ModalShell>
      )}
      </AnimatePresence>

      {/* ── Crear quiz nuevo inline (desde el modal de nivel) ── */}
      {quizEditorOpen && world && (
        <ArenaEditorModal
          editing={editingQuizFull}
          defaultCampaignId={world.campaign_id}
          worldId={world.id}
          scopedToCampaign
          campaigns={[]}
          crumb={i18n.t('admin.worlds.crumb_worlds', { name: world.name })}
          onClose={closeQuizEditor}
          onSaved={onQuizSaved}
        />
      )}

      {/* ── Elegir módulos de cualquier curso → una región por módulo ── */}
      {pickerOpen && world && (
        <WorldModulePickerModal
          excludeModuleIds={regions.map(r => r.module_id).filter(Boolean) as string[]}
          subtitle={i18n.t('admin.worlds.picker_subtitle_world', { name: world.name, defaultValue: `Cada módulo que elijas se vuelve una región de “${world.name}”, generada desde su contenido. Puedes mezclar módulos de distintos cursos.` })}
          onClose={() => setPickerOpen(false)}
          onConfirm={runPickerGen}
        />
      )}

      {/* ── Generar regiones desde el curso (modal en bloque) ── */}
      <AnimatePresence>
      {bulkOpen && (
        <ModalShell onClose={() => setBulkOpen(false)} className="max-w-md" reduce={reduce}>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[15px] font-semibold text-text flex items-center gap-2">
                <Sparkles className="h-4 w-4" style={{ color:'#8B5CF6' }} />
                {i18n.t('admin.worlds.bulk_modal_title', { defaultValue: 'Generar regiones desde el curso' })}
              </h2>
              <button onClick={() => setBulkOpen(false)} className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-subtle">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3" style={{ background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.20)' }}>
                <BookOpen className="h-4 w-4 shrink-0 mt-0.5" style={{ color:'#8B5CF6' }} />
                <p className="text-[12px] text-text-muted leading-relaxed">
                  {i18n.t('admin.worlds.bulk_modal_desc', { count: modulesWithoutRegion.length, defaultValue: `Se crearán ${modulesWithoutRegion.length} regiones (una por módulo) y la IA generará sus niveles y preguntas desde el contenido de cada módulo.` })}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.gen_levels_label')}</label>
                  <input type="number" min={1} max={10} value={bulkLevels}
                    onChange={e => setBulkLevels(e.target.value === '' ? '' : Math.max(1, Math.min(10, Number(e.target.value))))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.gen_sections_label')}</label>
                  <input type="number" min={1} max={5} value={bulkSections}
                    onChange={e => setBulkSections(e.target.value === '' ? '' : Math.max(1, Math.min(5, Number(e.target.value))))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.gen_per_section_label', { defaultValue: 'Preg./sección' })}</label>
                  <input type="number" min={1} max={5} value={bulkPerSection}
                    onChange={e => setBulkPerSection(e.target.value === '' ? '' : Math.max(1, Math.min(5, Number(e.target.value))))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
              </div>
              <p className="text-[11px] text-text-muted opacity-70">{i18n.t('admin.worlds.gen_sections_hint', { total: (bulkSections === '' ? 2 : Number(bulkSections)) * (bulkPerSection === '' ? DEFAULT_QUESTIONS_PER_SECTION : Number(bulkPerSection)) })}</p>
              <AiReviewNotice />
            </div>
            <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              <button onClick={() => setBulkOpen(false)}
                className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">
                {i18n.t('confirm.cancel')}
              </button>
              <button onClick={() => void runBulkGen()}
                className="flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium"
                style={{ background:'rgba(139,92,246,0.16)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.30)' }}>
                <Sparkles className="h-4 w-4"/>
                {i18n.t('admin.worlds.bulk_modal_submit', { count: modulesWithoutRegion.length, defaultValue: `Generar ${modulesWithoutRegion.length} regiones` })}
              </button>
            </div>
        </ModalShell>
      )}
      </AnimatePresence>

      {/* ── Reset confirm modal ── */}
      <AnimatePresence>
      {showResetConfirm && (
        <ModalShell onClose={() => setShowResetConfirm(false)} className="max-w-sm" reduce={reduce}>
            <div className="px-4 sm:px-6 pt-6 pb-4 text-center">
              <div className="text-[2rem] mb-3">⚠️</div>
              <h3 className="text-[16px] font-semibold text-text mb-2">{i18n.t('admin.worlds.sure')}</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                Esto borrará todo tu progreso en este mundo.
              </p>
            </div>
            <div className="flex items-center gap-3 px-4 sm:px-6 pb-6">
              <button onClick={() => setShowResetConfirm(false)}
                className="flex-1 flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">
                {i18n.t('confirm.cancel')}
              </button>
              <button onClick={resetProgress} disabled={resetting}
                className="flex-1 flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                style={{ background:'rgba(239,68,68,0.12)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.28)' }}>
                {resetting ? 'Borrando…' : 'Confirmar'}
              </button>
            </div>
        </ModalShell>
      )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {resetToast && (
          <motion.div key="ok" className="fixed bottom-6 left-1/2 z-50 px-5 py-3 rounded-xl text-[13px] font-medium"
            initial={reduce ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={reduce ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 12, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            style={{ background:'rgba(16,212,81,0.15)', color:'#10D451', border:'1px solid rgba(16,212,81,0.30)', boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}>
            {i18n.t('admin.worlds.toast_reset_ok')}
          </motion.div>
        )}
        {resetError && (
          <motion.div key="err" className="fixed bottom-6 left-1/2 z-50 px-5 py-3 rounded-xl text-[13px] font-medium"
            initial={reduce ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={reduce ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 12, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            style={{ background:'rgba(239,68,68,0.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.30)', boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}>
            ✗ No se pudo reiniciar el progreso, intenta de nuevo
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Previsualización de la transición de nivel (clic para cerrar) ── */}
      <AnimatePresence>
        {previewTrans && (
          <div onClick={() => setPreviewTrans(false)} style={{ cursor: 'pointer' }}>
            <LevelTransition
              type={world.transition_type || 'clouds'}
              color={world.color}
              reduce={reduce}
              caption={i18n.t('admin.worlds.preview_transition_caption', { defaultValue: 'Vista previa · toca para cerrar' })}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Una sola barra: cuenta lo pendiente y guarda con Ctrl+S. */}
      <SaveDock
        pending={[
          ...(themeDirty
            ? [{ id: 'world', label: i18n.t('admin.worlds.theme', { defaultValue: 'Ambientación' }) }]
            : []),
          ...(contentDirty
            ? [{ id: 'content', label: i18n.t('admin.worlds.regions_levels', { defaultValue: 'Regiones y niveles' }) }]
            : []),
        ]}
        onSave={saveWorldAll}
        onUndo={undo}
        canUndo={canUndo}
      />
    </>
  )
}