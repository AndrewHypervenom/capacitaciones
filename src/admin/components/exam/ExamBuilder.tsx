import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardCheck,
  EyeOff,
  Flag,
  GraduationCap,
  Layers,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  Trash2,
  TriangleAlert,
  Unlock,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '@/components/ui/GlassCard'
import { Select } from '@/components/ui/Select'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { NumberField } from '@/components/ui/NumberField'
import { Tooltip } from '@/components/ui/Tooltip'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useUndoHistory, type RegisterUndo } from '@/hooks/useUndoHistory'
import { toast } from '@/stores/toastStore'
import {
  checkExamHealth,
  createCourseExam,
  createExamDomain,
  createExamQuestions,
  deleteExamDomain,
  deleteExamQuestion,
  getCourseExam,
  getExamDomains,
  getCourseSource,
  getExamQuestions,
  getExamResults,
  getReusableQuestions,
  grantExamAttempt,
  questionFingerprint,
  reusableToQuestion,
  setExamPublished,
  split100,
  updateCourseExam,
  updateExamDomain,
  updateExamQuestion,
  type CourseSource,
  type NewExamQuestion,
} from '@/services/exams.admin.service'
import type {
  CourseExam,
  ExamDomain,
  ExamQuestion,
  ExamResultRow,
  ExamShowAnswers,
  ExamTargetLevel,
  ExamUnlockRule,
} from '@/types/exam'
import { difficultyLabel, isLevelLocked } from '@/lib/examLevel'
import { ExamQuestionModal, type QuestionDraft } from './ExamQuestionModal'
import { ExamGenerateModal } from './ExamGenerateModal'
import { ExamLevelPicker, LevelPill } from './ExamLevelBits'
import { cn } from '@/lib/cn'

const ease = [0.16, 1, 0.3, 1] as const

const DOMAIN_COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899']

/**
 * Id de mentira para lo que todavía no existe en la base (una pregunta recién
 * escrita, un tema que acaba de proponer la IA). Al guardar se cambia por el
 * id de verdad. Mismo truco que los ids locales de los bloques del módulo.
 */
let draftSeq = 0
const draftId = (kind: 'q' | 'd') => `draft-${kind}-${Date.now().toString(36)}-${draftSeq++}`
const isDraftId = (id: string) => id.startsWith('draft-')

/** Pregunta nueva en el borrador: mismo aspecto que una de la base, sin fila. */
function newDraftQuestion(
  examId: string,
  patch: Partial<ExamQuestion>,
  sortOrder: number,
  source: ExamQuestion['source'] = 'manual',
): ExamQuestion {
  return {
    id: draftId('q'),
    exam_id: examId,
    domain_id: null,
    kind: 'single',
    text_es: '',
    text_en: null,
    text_pt: null,
    options: [],
    correct: [],
    explanation_es: null,
    explanation_en: null,
    explanation_pt: null,
    difficulty: 'medio',
    source,
    source_ref: null,
    is_active: true,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
    ...patch,
  }
}

/** Tema nuevo en el borrador. */
function newDraftDomain(
  examId: string,
  sortOrder: number,
  patch: Partial<ExamDomain>,
): ExamDomain {
  return {
    id: draftId('d'),
    exam_id: examId,
    name_es: '',
    name_en: null,
    name_pt: null,
    description_es: null,
    description_en: null,
    description_pt: null,
    weight_pct: 0,
    min_score: 0,
    color: DOMAIN_COLORS[sortOrder % DOMAIN_COLORS.length],
    icon: '',
    sort_order: sortOrder,
    module_ids: [],
    ...patch,
  }
}

export interface ExamBuilderModule {
  id: string
  slug: string
  title_es: string
  objectives_es?: string[] | null
  key_takeaways_es?: string[] | null
  subtitle_es?: string | null
}

/** Interruptor on/off (mismo patrón visual que el editor del curso). */
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
        on ? 'border-primary bg-primary' : 'border-line bg-subtle',
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

/* ────────────────────────────────────────────────────────────────────────────
   Constructor del examen final de certificación.

   Está pensado para que armar un examen sea cuestión de minutos, no de una
   tarde: se crea con un clic, la IA propone las áreas y las preguntas a partir
   del temario, y un semáforo dice en todo momento qué falta para poder
   publicarlo. Nada de publicar un examen roto y descubrirlo cuando alguien
   está presentándolo.
   ──────────────────────────────────────────────────────────────────────────── */

export function ExamBuilder({
  courseId,
  campaignId,
  courseTitle,
  modules,
  onDirtyChange,
  registerSave,
  registerUndo,
}: {
  courseId: string
  campaignId: string | null
  courseTitle: string
  modules: ExamBuilderModule[]
  /** Avisa al editor del curso para que la barra de guardado lo muestre. */
  onDirtyChange?: (dirty: boolean) => void
  /** Entrega al editor del curso la función de guardado de esta pestaña. */
  registerSave?: (fn: (() => Promise<boolean>) | null) => void
  /** …y su deshacer, para que el botón de la barra no quede muerto aquí. */
  registerUndo?: RegisterUndo
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const confirm = useConfirm()

  const [exam, setExam] = useState<CourseExam | null>(null)
  /* El banco y los temas se editan como borrador, igual que la ficha del
     módulo: nada se escribe hasta que se pulsa Guardar (o Ctrl+S). `saved*` es
     lo que hay en la base y contra eso se mide qué está sin guardar. */
  const [domains, setDomains] = useState<ExamDomain[]>([])
  const [savedDomains, setSavedDomains] = useState<ExamDomain[]>([])
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [savedQuestions, setSavedQuestions] = useState<ExamQuestion[]>([])
  const [results, setResults] = useState<ExamResultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [missingTable, setMissingTable] = useState(false)

  // Ajustes en edición (se guardan con la barra única del pie).
  const [form, setForm] = useState<CourseExam | null>(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const [editingQuestion, setEditingQuestion] = useState<ExamQuestion | null | undefined>(undefined)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterDomain, setFilterDomain] = useState('')
  /** Filtro del banco: dejar solo las preguntas que no son del nivel del examen. */
  const [onlyOffLevel, setOnlyOffLevel] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)

  /* ── Carga ── */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const e = await getCourseExam(courseId)
      setExam(e)
      setForm(e)
      if (e) {
        const [d, q] = await Promise.all([getExamDomains(e.id), getExamQuestions(e.id)])
        setDomains(d)
        setSavedDomains(d)
        setQuestions(q)
        setSavedQuestions(q)
      } else {
        setDomains([])
        setSavedDomains([])
        setQuestions([])
        setSavedQuestions([])
      }
    } catch (err) {
      // 42P01 = las tablas del examen no existen todavía (falta correr el SQL).
      if ((err as { code?: string }).code === '42P01') setMissingTable(true)
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!exam) return
    getExamResults(courseId).then(setResults).catch(() => setResults([]))
  }, [courseId, exam])

  /**
   * Con qué reconocer un quiz de módulo que YA está en el banco: por la
   * referencia al quiz original y, para lo que llegó por otra vía (a mano, un
   * Excel, una copia vieja sin referencia), por el enunciado normalizado.
   *
   * Memorizado porque el modal lo usa como dependencia de su carga.
   */
  const bank = useMemo(() => {
    const byRef = new Map<string, string[]>()
    const byPrint = new Map<string, string[]>()
    const add = (map: Map<string, string[]>, key: string, id: string) => {
      const list = map.get(key)
      if (list) list.push(id)
      else map.set(key, [id])
    }
    for (const q of questions) {
      if (q.source_ref) add(byRef, q.source_ref, q.id)
      add(byPrint, questionFingerprint(q.text_es), q.id)
    }
    return { byRef, byPrint }
  }, [questions])

  /**
   * Quitar del banco desde el propio panel de reutilizar: ahí es donde se ve
   * qué quizzes ya están dentro, así que es donde hay que poder sacarlos, sin
   * ir a buscarlos al listado del banco uno por uno.
   */
  const handleRemoveFromBank = async (ids: string[]) => {
    const drop = new Set(ids)
    setQuestions((prev) => prev.filter((q) => !drop.has(q.id)))
  }

  /**
   * Relee banco y temas. `examId` explícito para el examen recién creado, que
   * todavía no está en el estado.
   */
  const reloadBank = useCallback(
    async (examId?: string) => {
      const id = examId ?? exam?.id
      if (!id) return
      const [d, q] = await Promise.all([getExamDomains(id), getExamQuestions(id)])
      setDomains(d)
      setSavedDomains(d)
      setQuestions(q)
      setSavedQuestions(q)
    },
    [exam?.id],
  )

  /* ── Cambios sin guardar ──
     Todo lo que se toca aquí (ajustes, temas y banco de preguntas) es borrador
     hasta que se guarda, para que la barra del editor pueda decir la verdad:
     si aparece "1 cambio sin guardar", es que hay algo sin guardar de verdad. */
  const settingsDirty = useMemo(
    () => Boolean(exam && form) && JSON.stringify(exam) !== JSON.stringify(form),
    [exam, form],
  )
  const domainsDirty = useMemo(
    () => JSON.stringify(domains) !== JSON.stringify(savedDomains),
    [domains, savedDomains],
  )
  const bankDirty = useMemo(
    () => JSON.stringify(questions) !== JSON.stringify(savedQuestions),
    [questions, savedQuestions],
  )
  const dirty = settingsDirty || domainsDirty || bankDirty

  /**
   * Guarda TODO lo pendiente del examen de una vez: ajustes, temas y banco.
   *
   * El orden importa: los temas van primero porque una pregunta nueva puede
   * apuntar a un tema que tampoco existe todavía (los dos los acaba de crear la
   * IA), y hay que cambiarle el id de mentira por el de verdad antes de
   * insertarla.
   */
  const saveExam = useCallback(async (): Promise<boolean> => {
    if (!form || !exam) return true
    setSaving(true)
    try {
      /* ── 1. Temas ── */
      const tmpToReal = new Map<string, string>()
      for (const d of savedDomains) {
        if (!domains.some((x) => x.id === d.id)) await deleteExamDomain(d.id)
      }
      for (const d of domains) {
        if (isDraftId(d.id)) {
          const created = await createExamDomain(exam.id, {
            name_es: d.name_es,
            description_es: d.description_es,
            weight_pct: d.weight_pct,
            min_score: d.min_score,
            color: d.color,
            icon: d.icon,
            sort_order: d.sort_order,
            module_ids: d.module_ids,
          })
          tmpToReal.set(d.id, created.id)
          continue
        }
        const before = savedDomains.find((x) => x.id === d.id)
        if (before && JSON.stringify(before) !== JSON.stringify(d)) {
          await updateExamDomain(d.id, {
            name_es: d.name_es,
            description_es: d.description_es,
            weight_pct: d.weight_pct,
            min_score: d.min_score,
            color: d.color,
            icon: d.icon,
            sort_order: d.sort_order,
            module_ids: d.module_ids,
          })
        }
      }

      /* ── 2. Banco ── */
      const realDomain = (id: string | null) => (id && tmpToReal.get(id)) ?? id
      for (const q of savedQuestions) {
        if (!questions.some((x) => x.id === q.id)) await deleteExamQuestion(q.id)
      }
      const nuevas = questions.filter((q) => isDraftId(q.id))
      if (nuevas.length > 0) {
        await createExamQuestions(
          exam.id,
          nuevas.map((q) => {
            // `sort_order` fuera: lo pone el servicio al final del banco. El
            // índice del borrador chocaría con el de las filas que ya existen.
            const { id: _id, exam_id: _e, created_at: _c, sort_order: _s, ...rest } = q
            return { ...rest, domain_id: realDomain(q.domain_id) } as unknown as NewExamQuestion
          }),
        )
      }
      for (const q of questions) {
        if (isDraftId(q.id)) continue
        const before = savedQuestions.find((x) => x.id === q.id)
        if (!before || JSON.stringify(before) === JSON.stringify(q)) continue
        await updateExamQuestion(q.id, {
          domain_id: realDomain(q.domain_id),
          kind: q.kind,
          text_es: q.text_es,
          text_en: q.text_en,
          text_pt: q.text_pt,
          options: q.options,
          correct: q.correct,
          explanation_es: q.explanation_es,
          explanation_en: q.explanation_en,
          explanation_pt: q.explanation_pt,
          difficulty: q.difficulty,
          is_active: q.is_active,
          sort_order: q.sort_order,
        })
      }

      /* ── 3. Ajustes ── */
      await updateCourseExam(exam.id, form)
      setExam(form)
      // Relee: los ids de mentira pasan a ser los de verdad y la línea base
      // vuelve a coincidir con la base (si no, todo seguiría "sin guardar").
      if (tmpToReal.size > 0 || nuevas.length > 0 || domainsDirty || bankDirty) {
        await reloadBank(exam.id)
      }
      return true
    } catch (err) {
      // El resto de ajustes SÍ se guardó: solo falta la columna del nivel.
      if ((err as Error).message === 'target_level_missing') {
        setExam({ ...form, target_level: exam.target_level })
        toast.error(
          t('admin.exam.level_sql_missing', {
            file: 'supabase/sql/2026-08-12_exam_target_level.sql',
            defaultValue:
              'Se guardó todo menos el nivel del examen: falta correr {{file}} en Supabase.',
          }),
        )
        return false
      }
      toast.error(t('admin.exam.save_error', 'No se pudieron guardar los cambios del examen.'))
      return false
    } finally {
      setSaving(false)
    }
  }, [form, exam, t, domains, savedDomains, questions, savedQuestions, domainsDirty, bankDirty, reloadBank])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    registerSave?.(saveExam)
    return () => registerSave?.(null)
  }, [registerSave, saveExam])

  // Deshacer de los ajustes del examen (nivel, puntaje, intentos…). Sin esto,
  // la barra mostraba "Examen · sin guardar" con un botón Deshacer apagado.
  // Deshacer de TODO el examen: ajustes, temas y banco. Si solo cubriera los
  // ajustes, borrar una pregunta sin querer no tendría vuelta atrás.
  const { undo: undoSettings, canUndo: canUndoSettings } = useUndoHistory({
    state: useMemo(() => ({ form, domains, questions }), [form, domains, questions]),
    apply: useCallback(
      (snap: { form: CourseExam | null; domains: ExamDomain[]; questions: ExamQuestion[] }) => {
        setForm(snap.form)
        setDomains(snap.domains)
        setQuestions(snap.questions)
      },
      [],
    ),
    enabled: !loading && !!form,
  })
  useEffect(() => {
    registerUndo?.(undoSettings, canUndoSettings)
    return () => registerUndo?.(null, false)
  }, [registerUndo, undoSettings, canUndoSettings])

  /* ── Salud del examen: todo lo que falta, de una vez ── */
  const health = useMemo(
    () => (exam ? checkExamHealth(form ?? exam, domains, questions) : null),
    [exam, form, domains, questions],
  )

  /* ── Fuente cerrada para la IA ──
     Se baja el CONTENIDO real de los módulos (párrafos, avisos y bloques), no
     el índice: es lo único que la IA puede evaluar, y con solo los títulos no
     le quedaba más remedio que inventar las opciones. Se lee de la base y no
     de lo que el editor tiene en memoria, para que sea exactamente lo que el
     aprendiz ve publicado. */
  const [source, setSource] = useState<CourseSource | null>(null)
  useEffect(() => {
    getCourseSource(courseId)
      .then(setSource)
      .catch(() => setSource(null))
  }, [courseId])

  /* ── Precarga del banco con los quizzes de los módulos ────────────────────
     Un examen con el banco vacío no sirve para nada, y el curso casi siempre
     ya tiene preguntas escritas sobre su propio contenido: las de los quizzes
     de sección. Entran solas — al crear el examen y también al abrir uno que se
     quedó vacío — en vez de obligar a ir a buscarlas a un modal.

     Se COPIAN (misma regla que "Reutilizar quizzes"): editarlas en el examen no
     toca el quiz del módulo, ni al revés. */

  /** Exámenes a los que ya se les intentó la precarga en esta sesión. */
  const preloadTried = useRef<Set<string>>(new Set())
  /** …y entre sesiones: vaciar el banco a propósito no debe deshacerse solo. */
  const preloadFlag = (examId: string) => `exam-bank-preloaded:${examId}`

  /**
   * Copia al banco los quizzes de sección del curso. Devuelve cuántos entraron.
   *
   * No mira lo que ya hay en el banco porque solo se le llama con el banco
   * vacío (recién creado o vaciado): quien sí compara es el modal, que marca
   * las que ya se usaron. Nunca lanza — es una comodidad, no un requisito: si
   * falla, el examen se queda como estaba y siempre queda el modal a mano.
   */
  const preloadBank = useCallback(
    async (examId: string, targetLevel: ExamTargetLevel) => {
      try {
        const reusable = await getReusableQuestions(courseId)
        const usable = reusable.filter((q) => {
          // Con nivel fijo solo entran los quizzes de ese nivel: colar otros
          // dejaría el examen sin poder publicarse nada más crearlo. Los que
          // nadie ha calificado no se adivinan — se quedan para el modal.
          if (!isLevelLocked(targetLevel)) return true
          return q.difficulty === targetLevel
        })
        if (usable.length === 0) return 0
        await createExamQuestions(
          examId,
          // El nivel guardado en el quiz manda; si nadie lo ha calificado
          // todavía entra como "medio" y se puede ajustar en el banco.
          usable.map((q) => reusableToQuestion(q, null, q.difficulty ?? 'medio')),
        )
        // Solo se anota si de verdad entró algo: si el curso todavía no tenía
        // quizzes, la próxima visita debe volver a mirar (habrá módulos nuevos).
        try {
          localStorage.setItem(preloadFlag(examId), '1')
        } catch {
          /* modo incógnito o almacenamiento lleno: se reintentará, no pasa nada */
        }
        await reloadBank(examId)
        return usable.length
      } catch {
        return 0
      }
    },
    [courseId, reloadBank],
  )

  /**
   * Examen ya creado pero con el banco en cero: se precarga al abrir la
   * pestaña. Una sola vez por examen (queda anotado), para que vaciar el banco
   * a propósito no se deshaga solo en la siguiente visita.
   */
  useEffect(() => {
    if (loading || !exam || questions.length > 0) return
    // Vacío en la base Y sin nada pendiente. Si el banco está vacío porque el
    // capacitador acaba de borrarlo todo y aún no ha guardado, precargarlo
    // sería pisarle el borrador con preguntas que él quitó a propósito.
    if (savedQuestions.length > 0 || dirty) return
    if (preloadTried.current.has(exam.id)) return
    preloadTried.current.add(exam.id)
    let stored: string | null = null
    try {
      stored = localStorage.getItem(preloadFlag(exam.id))
    } catch {
      stored = null
    }
    if (stored) return
    void preloadBank(exam.id, exam.target_level).then((n) => {
      if (n > 0) {
        toast.success(
          t('admin.exam.bank_preloaded', {
            n,
            defaultValue: 'Se añadieron {{n}} preguntas de los quizzes de los módulos.',
          }),
        )
      }
    })
  }, [loading, exam, questions.length, savedQuestions.length, dirty, preloadBank, t])

  /* ── Acciones ── */

  /** Crea el examen y lo deja ya con banco (ver "Precarga del banco"). */
  const handleCreate = async () => {
    try {
      const created = await createCourseExam(courseId, campaignId, {
        title_es: t('admin.exam.default_title', {
          course: courseTitle,
          defaultValue: 'Examen final — {{course}}',
        }),
      })
      // Antes de pintarlo: si no, el efecto de arriba ve un examen con banco
      // vacío mientras esta precarga está a medias y las copia dos veces.
      preloadTried.current.add(created.id)
      setExam(created)
      setForm(created)

      const seeded = await preloadBank(created.id, created.target_level)

      toast.success(
        seeded > 0
          ? t('admin.exam.created_seeded', {
              n: seeded,
              defaultValue:
                'Examen creado con {{n}} preguntas tomadas de los quizzes de los módulos.',
            })
          : t('admin.exam.created', 'Examen creado. Ahora arma el banco de preguntas.'),
      )
    } catch {
      toast.error(t('admin.exam.create_error', 'No se pudo crear el examen.'))
    }
  }

  /**
   * Pone al nivel del examen las preguntas que no lo están.
   *
   * Es la salida honesta al bloqueo: o las ajustas (asumiendo que sí evalúan a
   * ese nivel), o las borras, o bajas el nivel del examen. Lo que no se puede es
   * publicar un examen "avanzado" resuelto con preguntas básicas.
   */
  const handleFixOffLevel = async () => {
    const target = form?.target_level ?? exam?.target_level
    if (!health || !isLevelLocked(target) || health.offLevel.length === 0) return
    const okGo = await confirm({
      title: t('admin.exam.level_fix_title', 'Ajustar el nivel de estas preguntas'),
      description: t('admin.exam.level_fix_body', {
        n: health.offLevel.length,
        level: difficultyLabel(t, target),
        defaultValue:
          'Se marcarán {{n}} preguntas como nivel {{level}}. Cambia la etiqueta, no la pregunta: hazlo solo si de verdad evalúan a ese nivel. Si no, edítalas o quítalas del banco.',
      }),
      confirmLabel: t('admin.exam.level_fix_cta', 'Ajustar'),
      tone: 'default',
    })
    if (!okGo) return
    const fix = new Set(health.offLevel.map((q) => q.id))
    setQuestions((prev) => prev.map((q) => (fix.has(q.id) ? { ...q, difficulty: target } : q)))
    toast.success(t('admin.exam.level_fix_ok_v2', 'Listo: el banco quedó todo al mismo nivel. Recuerda guardar.'))
  }

  const handlePublish = async () => {
    if (!exam) return
    const next = !exam.is_published
    // Nivel: es bloqueo, no aviso. El botón ya viene deshabilitado; esto cubre
    // el atajo de teclado y cualquier camino que no pase por el botón.
    if (next && health && health.offLevel.length > 0) {
      toast.error(
        t('admin.exam.publish_off_level', {
          n: health.offLevel.length,
          level: difficultyLabel(t, (form ?? exam).target_level),
          defaultValue:
            'No se puede publicar: {{n}} preguntas del banco no son de nivel {{level}}.',
        }),
      )
      return
    }
    if (next && health && health.bank < (form?.question_count ?? exam.question_count)) {
      const okGo = await confirm({
        title: t('admin.exam.publish_thin_title', 'El banco es más chico que el examen'),
        description: t('admin.exam.publish_thin_body', {
          bank: health.bank,
          needed: form?.question_count ?? exam.question_count,
          defaultValue:
            'Tienes {{bank}} preguntas y el examen pide {{needed}}. Se presentará con {{bank}} y todos verán las mismas. ¿Publicar igual?',
        }),
        confirmLabel: t('admin.exam.publish', 'Publicar'),
        tone: 'default',
      })
      if (!okGo) return
    }
    setPublishing(true)
    try {
      if (dirty) await saveExam()
      await setExamPublished(exam.id, next)
      setExam({ ...exam, is_published: next })
      setForm((f) => (f ? { ...f, is_published: next } : f))
      toast.success(
        next
          ? t('admin.exam.published', 'Examen publicado. Ya lo ven los aprendices.')
          : t('admin.exam.unpublished', 'Examen despublicado.'),
      )
    } catch (err) {
      toast.error(
        (err as Error).message === 'empty_bank'
          ? t('admin.exam.publish_empty', 'No puedes publicar un examen sin preguntas.')
          : t('admin.exam.publish_error', 'No se pudo cambiar la publicación.'),
      )
    } finally {
      setPublishing(false)
    }
  }

  const handleSaveQuestion = async (draft: QuestionDraft) => {
    if (!exam) return
    const payload = {
      domain_id: draft.domain_id,
      kind: draft.kind,
      text_es: draft.text_es.trim(),
      options: draft.options,
      correct: draft.correct,
      explanation_es: draft.explanation_es.trim() || null,
      difficulty: draft.difficulty,
    }
    if (editingQuestion) {
      setQuestions((prev) =>
        prev.map((q) => (q.id === editingQuestion.id ? { ...q, ...payload } : q)),
      )
      return
    }
    setQuestions((prev) => [...prev, newDraftQuestion(exam.id, payload, prev.length, 'manual')])
  }

  /**
   * Quitar una pregunta ya no pregunta "¿seguro?": ahora es un borrador que se
   * ve en la barra ("1 cambio sin guardar"), se deshace con Ctrl+Z y no toca la
   * base hasta que se guarda. Un diálogo encima de eso sería pedir permiso dos
   * veces para algo que no ha pasado todavía.
   */
  const handleDeleteQuestion = async (q: ExamQuestion) => {
    setQuestions((prev) => prev.filter((x) => x.id !== q.id))
  }

  const handleImportQuestions = async (list: NewExamQuestion[]) => {
    if (!exam) return
    setQuestions((prev) => [
      ...prev,
      ...list.map((q, i) => newDraftQuestion(exam.id, q, prev.length + i)),
    ])
  }

  /** Crea dominios (IA / importación) y devuelve el mapa nombre→id, ya completo. */
  const handleCreateDomains = async (
    drafts: { name_es: string; description_es: string; weight_pct: number }[],
  ): Promise<Map<string, string>> => {
    if (!exam) return new Map()
    const map = new Map(domains.map((d) => [d.name_es.toLowerCase().trim(), d.id]))
    const nuevos: ExamDomain[] = []
    for (const [i, d] of drafts.entries()) {
      const key = d.name_es.toLowerCase().trim()
      if (map.has(key)) continue
      const draft = newDraftDomain(exam.id, domains.length + nuevos.length + i, {
        name_es: d.name_es,
        description_es: d.description_es || null,
        weight_pct: d.weight_pct,
      })
      nuevos.push(draft)
      map.set(key, draft.id)
    }
    if (nuevos.length > 0) setDomains((prev) => [...prev, ...nuevos])
    return map
  }

  /* ── Repartir los porcentajes ──
     Tres formas de llegar a 100, cada una con su preview: partes iguales,
     proporcional a las preguntas que ya hay escritas, y "cuadrar" lo que el
     capacitador ya escribió a mano sin cambiarle las proporciones. */

  const weightPlans = useMemo(() => {
    if (domains.length === 0) return []
    const preview = (ws: number[]) =>
      domains.map((d, i) => `${d.name_es}: ${ws[i]}%`).join(' · ')

    const plans: {
      id: string
      label: string
      tip: string
      weights: number[]
      preview: string
    }[] = []

    const equal = split100(domains.length)
    plans.push({
      id: 'equal',
      label: t('admin.exam.weights_equal', 'Partes iguales'),
      tip: t('admin.exam.weights_equal_tip', {
        n: domains.length,
        defaultValue: 'Le da el mismo peso a los {{n}} temas. Es el reparto más justo si no tienes una razón para darle más importancia a uno.',
      }),
      weights: equal,
      preview: preview(equal),
    })

    const counts = domains.map((d) => d.question_count ?? 0)
    if (counts.some((c) => c > 0)) {
      const byBank = split100(domains.length, counts)
      plans.push({
        id: 'bank',
        label: t('admin.exam.weights_by_bank', 'Según las preguntas que ya tengo'),
        tip: t(
          'admin.exam.weights_by_bank_tip',
          'Reparte según cuántas preguntas escribiste de cada tema. Es el reparto que puedes sostener hoy sin escribir ni una pregunta más.',
        ),
        weights: byBank,
        preview: preview(byBank),
      })
    }

    const current = domains.map((d) => d.weight_pct)
    if (current.some((w) => w > 0) && current.reduce((s, w) => s + w, 0) !== 100) {
      const scaled = split100(domains.length, current)
      plans.push({
        id: 'scale',
        label: t('admin.exam.weights_scale', 'Cuadrar lo que ya puse'),
        tip: t(
          'admin.exam.weights_scale_tip',
          'Mantiene las proporciones que escribiste y solo las estira o encoge hasta que sumen 100%.',
        ),
        weights: scaled,
        preview: preview(scaled),
      })
    }
    return plans
  }, [domains, t])

  const applyWeights = async (weights: number[]) => {
    setDomains((prev) => prev.map((d, i) => ({ ...d, weight_pct: weights[i] ?? d.weight_pct })))
    toast.success(
      t('admin.exam.weights_applied_v2', 'Listo: los porcentajes ya suman 100%. Recuerda guardar.'),
    )
  }

  const handleAddDomain = async () => {
    if (!exam) return
    setDomains((prev) => [
      ...prev,
      newDraftDomain(exam.id, prev.length, {
        name_es: t('admin.exam.domain_new_v2', 'Tema nuevo'),
      }),
    ])
  }

  /** Igual que borrar una pregunta: es borrador, se ve en la barra y se deshace. */
  const handleDeleteDomain = async (d: ExamDomain) => {
    setDomains((prev) => prev.filter((x) => x.id !== d.id))
    // Sus preguntas NO se van: se quedan sin tema, como decía el aviso que
    // esto tenía antes.
    setQuestions((prev) =>
      prev.map((q) => (q.domain_id === d.id ? { ...q, domain_id: null } : q)),
    )
  }

  const handleGrantAttempt = async (userId: string, name: string) => {
    const okGo = await confirm({
      title: t('admin.exam.grant_title', 'Conceder un intento'),
      description: t('admin.exam.grant_body', {
        name,
        defaultValue:
          'Se le habilita un intento adicional a {{name}} y se levanta su ruta de refuerzo pendiente.',
      }),
      confirmLabel: t('admin.exam.grant_cta', 'Conceder'),
      tone: 'default',
    })
    if (!okGo) return
    try {
      await grantExamAttempt(courseId, userId, 1)
      toast.success(t('admin.exam.grant_ok', 'Intento concedido.'))
      setResults(await getExamResults(courseId))
    } catch {
      toast.error(t('admin.exam.grant_error', 'No se pudo conceder el intento.'))
    }
  }

  /* ── Render ── */

  if (missingTable) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="text-[13px] text-text-muted">
          <span className="mb-1 block font-semibold text-text">
            {t('admin.exam.sql_missing_title', 'Falta correr el SQL del examen')}
          </span>
          {t('admin.exam.sql_missing_body', {
            file: 'supabase/sql/2026-08-11_course_exams.sql',
            defaultValue:
              'Ejecuta {{file}} en el editor SQL de Supabase y vuelve a entrar a esta pestaña.',
          })}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-2xl bg-subtle skeleton-shine"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    )
  }

  /* Sin examen todavía: una sola decisión en pantalla. */
  if (!exam || !form) {
    return (
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease }}
        className="rounded-3xl border border-line p-8 text-center"
      >
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <ClipboardCheck className="h-5 w-5" />
        </div>
        <h2 className="mb-1.5 text-[18px] font-semibold tracking-tight text-text">
          {t('admin.exam.empty_title', 'Este curso todavía no tiene examen final')}
        </h2>
        <p className="mx-auto mb-6 max-w-md text-[13.5px] leading-relaxed text-text-muted">
          {t(
            'admin.exam.empty_body',
            'El examen final reemplaza los formularios externos: tus propias preguntas, un resultado tema por tema y un repaso automático para quien no apruebe.',
          )}
        </p>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('admin.exam.empty_cta', 'Crear el examen')}
        </button>
      </motion.div>
    )
  }

  const offLevelIds = new Set((health?.offLevel ?? []).map((q) => q.id))
  const visibleQuestions = questions.filter((q) => {
    if (onlyOffLevel && !offLevelIds.has(q.id)) return false
    if (filterDomain && q.domain_id !== filterDomain) return false
    if (!search.trim()) return true
    return q.text_es.toLowerCase().includes(search.toLowerCase().trim())
  })

  const inputCls =
    'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none transition-colors focus:border-primary'
  const numCls =
    'w-20 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] tabular-nums text-text outline-none focus:border-primary'

  return (
    <div className="space-y-10">
      {/* ── Estado + publicación ── */}
      <GlassCard intensity="subtle" rounded="3xl" className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-2xl',
              exam.is_published ? 'bg-primary/12 text-primary' : 'bg-subtle text-text-subtle',
            )}
          >
            <ClipboardCheck className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-text">
                {t('admin.exam.status_title', 'Examen final')}
              </h2>
              <Tooltip
                label={
                  exam.is_published
                    ? t(
                        'admin.exam.tip_published',
                        'Los aprendices del curso ya lo ven y pueden presentarlo. Los cambios que hagas aquí les afectan al siguiente intento.',
                      )
                    : t(
                        'admin.exam.tip_draft',
                        'Solo tú lo ves. Los aprendices no encuentran el examen en el curso hasta que lo publiques.',
                      )
                }
                maxWidth={250}
                anchor="element"
                describedBy
              >
                <span
                  className={cn(
                    'cursor-help rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
                    exam.is_published
                      ? 'bg-primary/12 text-primary'
                      : 'bg-subtle text-text-muted',
                  )}
                >
                  {exam.is_published
                    ? t('admin.exam.published_tag', 'Publicado')
                    : t('admin.exam.draft_tag', 'Borrador')}
                </span>
              </Tooltip>
            </div>
            <Tooltip
              label={t('admin.exam.tip_bank', {
                bank: health?.bank ?? 0,
                needed: form.question_count,
                defaultValue:
                  'Cada intento sortea {{needed}} preguntas de las {{bank}} del banco. Cuanto más grande el banco, menos se repiten entre aprendices.',
              })}
              maxWidth={260}
              anchor="element"
              describedBy
            >
              <p className="w-fit cursor-help text-[12.5px] text-text-muted">
                {t('admin.exam.status_bank', {
                  bank: health?.bank ?? 0,
                  needed: form.question_count,
                  defaultValue: 'Banco: {{bank}} · el examen sortea {{needed}}',
                })}
                {domains.length > 0 && (
                  <>
                    {' · '}
                    {t('admin.exam.status_domains', {
                      n: domains.length,
                      defaultValue: 'Temas: {{n}}',
                    })}
                  </>
                )}
              </p>
            </Tooltip>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Tooltip
              label={t(
                'admin.exam.tip_add_questions',
                'Genera con IA desde el temario, reutiliza los quizzes de los módulos o importa un Excel.',
              )}
              maxWidth={240}
            >
              <button
                onClick={() => setGenerateOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('admin.exam.add_questions', 'Añadir preguntas')}
              </button>
            </Tooltip>
            <Tooltip
              label={
                (health?.bank ?? 0) === 0
                  ? t(
                      'admin.exam.tip_publish_blocked',
                      'Añade al menos una pregunta antes de publicar.',
                    )
                  : (health?.offLevel.length ?? 0) > 0
                    ? t('admin.exam.tip_publish_off_level', {
                        n: health?.offLevel.length ?? 0,
                        level: difficultyLabel(t, form.target_level),
                        defaultValue:
                          'No se puede publicar: {{n}} preguntas del banco no son de nivel {{level}}. Ajústalas, quítalas o cambia el nivel del examen.',
                      })
                  : exam.is_published
                    ? t(
                        'admin.exam.tip_unpublish',
                        'Deja de mostrarlo en el curso. Los intentos y certificados ya emitidos no se tocan.',
                      )
                    : t(
                        'admin.exam.tip_publish',
                        'Lo abre a los aprendices del curso según la regla de desbloqueo que elegiste abajo.',
                      )
              }
              maxWidth={250}
            >
            <button
              onClick={handlePublish}
              // Despublicar nunca se bloquea: si algo está mal, retirarlo del
              // curso tiene que seguir siendo posible con un clic.
              disabled={publishing || (!exam.is_published && !health?.canPublish)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-opacity disabled:opacity-40',
                exam.is_published
                  ? 'border border-line text-text-muted hover:text-text'
                  : 'bg-primary text-on-primary hover:opacity-90',
              )}
            >
              {publishing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : exam.is_published ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              {exam.is_published
                ? t('admin.exam.unpublish', 'Despublicar')
                : t('admin.exam.publish', 'Publicar')}
            </button>
            </Tooltip>
          </div>
        </div>

        {/* Semáforo: todo lo que falta, junto */}
        {health && (health.bank === 0 || health.offLevel.length > 0 || health.thinDomains.length > 0 || (domains.length > 0 && health.weightSum !== 100)) && (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
            {health.offLevel.length > 0 && (
              <li className="flex flex-wrap items-start gap-2 text-[12.5px] text-text-muted">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="min-w-[200px] flex-1">
                  {t('admin.exam.warn_off_level', {
                    n: health.offLevel.length,
                    level: difficultyLabel(t, form.target_level),
                    defaultValue:
                      'Bloquea la publicación: {{n}} preguntas del banco no son de nivel {{level}}.',
                  })}
                </span>
                <button
                  onClick={() => {
                    setOnlyOffLevel(true)
                    setSearch('')
                    setFilterDomain('')
                    document
                      .getElementById('exam-bank')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className="rounded-full border border-line px-3 py-0.5 text-[11.5px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
                >
                  {t('admin.exam.level_see_off', 'Ver cuáles')}
                </button>
                <button
                  onClick={() => void handleFixOffLevel()}
                  className="rounded-full border border-amber-500/40 px-3 py-0.5 text-[11.5px] font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
                >
                  {t('admin.exam.level_fix_all', 'Ajustar todas al nivel')}
                </button>
              </li>
            )}
            {health.bank === 0 && (
              <li className="flex items-start gap-2 text-[12.5px] text-text-muted">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                {t('admin.exam.warn_empty', 'El banco está vacío: añade preguntas para publicar.')}
              </li>
            )}
            {domains.length > 0 && health.weightSum !== 100 && (
              <li className="flex items-start gap-2 text-[12.5px] text-text-muted">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                {t('admin.exam.warn_weights_v2', {
                  sum: health.weightSum,
                  defaultValue:
                    'Los porcentajes de los temas suman {{sum}}% en vez de 100%. Lo que falte se llena con preguntas de cualquier tema.',
                })}
              </li>
            )}
            {health.thinDomains.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-[12.5px] text-text-muted">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                {t('admin.exam.warn_thin_v2', {
                  name: d.name,
                  have: d.have,
                  need: d.need,
                  defaultValue:
                    'Al tema "{{name}}" le tocan {{need}} preguntas y solo tienes {{have}} escritas.',
                })}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* ── 1. Reglas ── */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-text">
          <Target className="h-4 w-4 text-text-muted" />
          {t('admin.exam.rules_title', 'Reglas del examen')}
        </h2>
        <p className="mb-4 text-[12px] text-text-muted">
          {t(
            'admin.exam.rules_hint',
            'Es lo que el aprendiz ve antes de empezar. Sé explícito: un examen con reglas claras se siente justo.',
          )}
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
              {t('admin.exam.f_title', 'Título')}
            </label>
            <input
              value={form.title_es}
              onChange={(e) => setForm({ ...form, title_es: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
              {t('admin.exam.f_description', 'Descripción')}
            </label>
            <textarea
              value={form.description_es ?? ''}
              onChange={(e) => setForm({ ...form, description_es: e.target.value || null })}
              rows={2}
              placeholder={t(
                'admin.exam.f_description_ph',
                'Qué se evalúa y qué se espera del asesor al aprobarlo.',
              )}
              className={cn(inputCls, 'resize-y leading-relaxed')}
            />
          </div>

          {/* Nivel: primero, porque condiciona todo lo que entra al banco. */}
          <ExamLevelPicker
            value={form.target_level}
            onChange={(v) => setForm({ ...form, target_level: v as ExamTargetLevel })}
            offLevelCount={health?.offLevel.length ?? 0}
            onSeeOffLevel={() => {
              setOnlyOffLevel(true)
              setSearch('')
              setFilterDomain('')
              document
                .getElementById('exam-bank')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                key: 'question_count' as const,
                icon: Layers,
                label: t('admin.exam.f_count', 'Preguntas por intento'),
                hint: t('admin.exam.f_count_hint', 'Se sortean del banco en cada intento.'),
                tip: t(
                  'admin.exam.f_count_tip',
                  'Si el banco tiene menos preguntas que este número, el examen usa todas y todos ven las mismas. Con el banco al doble o más, cada intento se siente distinto.',
                ),
                min: 1,
                max: 200,
              },
              {
                key: 'pass_score' as const,
                icon: Target,
                label: t('admin.exam.f_pass', 'Puntaje mínimo (%)'),
                hint: t('admin.exam.f_pass_hint', 'Estándar de la industria: 70–80%.'),
                tip: t(
                  'admin.exam.f_pass_tip',
                  'Se aplica a la nota total. Además, cada tema se marca para repasar si ese tema por sí solo queda por debajo de este mínimo.',
                ),
                min: 1,
                max: 100,
              },
              {
                key: 'time_limit_min' as const,
                icon: RotateCcw,
                label: t('admin.exam.f_time', 'Tiempo límite (min)'),
                hint: t('admin.exam.f_time_hint', '0 = sin límite.'),
                tip: t(
                  'admin.exam.f_time_tip',
                  'El reloj corre en el servidor: cerrar la pestaña no lo detiene. Al llegar a cero el intento se envía solo con lo respondido.',
                ),
                min: 0,
                max: 300,
              },
              {
                key: 'max_attempts' as const,
                icon: Flag,
                label: t('admin.exam.f_attempts', 'Intentos permitidos'),
                hint: t('admin.exam.f_attempts_hint', '0 = ilimitados.'),
                tip: t(
                  'admin.exam.f_attempts_tip',
                  'Al agotarlos el aprendiz queda bloqueado y solo tú puedes darle otro, desde la lista de resultados de abajo.',
                ),
                min: 0,
                max: 20,
              },
              {
                key: 'cooldown_hours' as const,
                icon: Lock,
                label: t('admin.exam.f_cooldown', 'Espera entre intentos (h)'),
                hint: t('admin.exam.f_cooldown_hint', 'Evita el ensayo y error a ciegas.'),
                tip: t(
                  'admin.exam.f_cooldown_tip',
                  'Tiempo que debe esperar tras reprobar antes de volver a presentarlo. Se suma a la ruta de refuerzo, si la exiges.',
                ),
                min: 0,
                max: 720,
              },
            ].map(({ key, icon: Icon, label, hint, tip, min, max }) => (
              <div
                key={key}
                className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3"
              >
                <Icon className="h-4 w-4 shrink-0 text-text-muted" />
                <Tooltip label={tip} maxWidth={260} anchor="element" describedBy>
                  <div className="min-w-0 flex-1 cursor-help">
                    <div className="text-[13px] font-medium text-text">{label}</div>
                    <div className="text-[11px] text-text-muted">{hint}</div>
                  </div>
                </Tooltip>
                <NumberField
                  value={form[key]}
                  onChange={(n) => setForm({ ...form, [key]: n })}
                  min={min}
                  max={max}
                  aria-label={label}
                  className={numCls}
                />
              </div>
            ))}
          </div>

          {/* Barajado y respuestas */}
          <div className="space-y-2.5">
            {[
              {
                on: form.shuffle_questions,
                toggle: () => setForm({ ...form, shuffle_questions: !form.shuffle_questions }),
                label: t('admin.exam.f_shuffle_q', 'Barajar las preguntas'),
                hint: t('admin.exam.f_shuffle_q_hint', 'Cada aprendiz las recibe en otro orden.'),
                tip: t(
                  'admin.exam.f_shuffle_q_tip',
                  'Dificulta que se pasen las respuestas por posición ("la 3 es la B"). Apágalo solo si el orden de las preguntas tiene una lógica pedagógica.',
                ),
              },
              {
                on: form.shuffle_options,
                toggle: () => setForm({ ...form, shuffle_options: !form.shuffle_options }),
                label: t('admin.exam.f_shuffle_o', 'Barajar las opciones'),
                hint: t('admin.exam.f_shuffle_o_hint', 'La correcta no siempre cae en el mismo lugar.'),
                tip: t(
                  'admin.exam.f_shuffle_o_tip',
                  'El orden se congela al abrir el intento, así que recargar la página no le mueve las opciones al aprendiz.',
                ),
              },
              {
                on: form.require_reinforcement,
                toggle: () =>
                  setForm({ ...form, require_reinforcement: !form.require_reinforcement }),
                label: t('admin.exam.f_reinforcement', 'Exigir refuerzo tras reprobar'),
                hint: t(
                  'admin.exam.f_reinforcement_hint',
                  'Antes de volver a presentarlo, tiene que repasar los módulos de los temas que reprobó.',
                ),
                tip: t(
                  'admin.exam.f_reinforcement_tip',
                  'El repaso se arma solo con los módulos que le pongas a cada tema más abajo. Si un tema no tiene módulos, se manda a repasar el curso completo.',
                ),
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3"
              >
                <Tooltip label={row.tip} maxWidth={270} anchor="element" describedBy>
                  <div className="min-w-0 flex-1 cursor-help">
                    <div className="text-[13px] font-medium text-text">{row.label}</div>
                    <div className="text-[11px] text-text-muted">{row.hint}</div>
                  </div>
                </Tooltip>
                <Toggle on={row.on} onClick={row.toggle} label={row.label} />
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3.5 py-3">
              <div className="min-w-[180px] flex-1">
                <div className="text-[13px] font-medium text-text">
                  {t('admin.exam.f_show_answers', 'Mostrar las respuestas correctas')}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t(
                    'admin.exam.f_show_answers_hint',
                    'Mostrarlas al reprobar acelera el aprendizaje; ocultarlas protege el banco.',
                  )}
                </div>
              </div>
              <div className="w-52">
                <Select
                  value={form.show_answers}
                  onChange={(v) => setForm({ ...form, show_answers: v as ExamShowAnswers })}
                  options={[
                    { value: 'never', label: t('admin.exam.show_never', 'Nunca') },
                    { value: 'after_pass', label: t('admin.exam.show_pass', 'Solo al aprobar') },
                    { value: 'after_fail', label: t('admin.exam.show_fail', 'Solo al reprobar') },
                    { value: 'always', label: t('admin.exam.show_always', 'Siempre') },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Cuándo se abre */}
          <div>
            <h3 className="mb-2 mt-5 text-[13px] font-semibold text-text">
              {t('admin.exam.f_unlock_title', 'Cuándo se abre el examen')}
            </h3>
            <div className="space-y-2.5">
              {(
                [
                  { id: 'after_modules', icon: Check },
                  { id: 'from_start', icon: Unlock },
                  { id: 'after_module', icon: Flag },
                ] as const
              ).map(({ id, icon: Icon }) => {
                const selected = form.unlock_rule === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setForm({ ...form, unlock_rule: id as ExamUnlockRule })}
                    className={cn(
                      'flex w-full items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all',
                      selected
                        ? 'border-primary/50 bg-primary/[0.06] ring-1 ring-primary/20'
                        : 'border-line hover:border-primary/25',
                    )}
                  >
                    <div
                      className={cn(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                        selected ? 'bg-primary/15 text-primary' : 'bg-subtle text-text-muted',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[13.5px] font-semibold text-text">
                        {t(`admin.exam.unlock_${id}_title`, id)}
                      </span>
                      <p className="mt-0.5 text-[12px] text-text-muted">
                        {t(`admin.exam.unlock_${id}_desc`, '')}
                      </p>
                      {id === 'after_module' && selected && (
                        <div onClick={(e) => e.stopPropagation()}>
                          <Select
                            className="mt-2.5"
                            value={form.unlock_module_id ?? ''}
                            onChange={(v) => setForm({ ...form, unlock_module_id: v || null })}
                            placeholder={t('admin.exam.unlock_pick', 'Elige el módulo')}
                            options={[
                              { value: '', label: t('admin.exam.unlock_pick', 'Elige el módulo') },
                              ...modules.map((m) => ({ value: m.id, label: m.title_es })),
                            ]}
                          />
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                        selected ? 'border-primary bg-primary' : 'border-line',
                      )}
                    >
                      {selected && <Check className="h-3 w-3 text-on-primary" />}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Temas del examen ──
         Se llaman "temas" en pantalla y `domains` en la base: "área de
         conocimiento" es lenguaje de certificadora, y aquí lo lee un
         capacitador que solo quiere partir su examen en pedazos. */}
      <section>
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text">
            <Layers className="h-4 w-4 text-text-muted" />
            {t('admin.exam.domains_title_v2', 'Temas del examen')}
          </h2>
          <button
            onClick={handleAddDomain}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('admin.exam.domain_add_v2', 'Añadir tema')}
          </button>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-text-muted">
          {t(
            'admin.exam.domains_hint_v2',
            'Un tema es una parte del curso que quieres medir por separado. Por ejemplo: "Atención al cliente" y "Facturación".',
          )}
        </p>

        {/* Para qué sirven, en tres frases y con el ejemplo puesto. */}
        <ul className="mb-4 grid gap-2 sm:grid-cols-3">
          {[
            {
              icon: Layers,
              title: t('admin.exam.domains_use1_title', 'Cuántas preguntas de cada uno'),
              body: t(
                'admin.exam.domains_use1_body',
                'Si le pones 40%, 4 de cada 10 preguntas del examen serán de ese tema.',
              ),
            },
            {
              icon: Target,
              title: t('admin.exam.domains_use2_title', 'Una nota por tema'),
              body: t(
                'admin.exam.domains_use2_body',
                'Al terminar, la persona ve en qué salió bien y en qué mal, no solo una nota general.',
              ),
            },
            {
              icon: RotateCcw,
              title: t('admin.exam.domains_use3_title', 'Qué le toca repasar'),
              body: t(
                'admin.exam.domains_use3_body',
                'Si reprueba un tema, solo repasa los módulos de ese tema. No el curso entero.',
              ),
            },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-2xl border border-line px-3.5 py-3">
              <div className="mb-1 flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="text-[12.5px] font-semibold text-text">{title}</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-text-muted">{body}</p>
            </li>
          ))}
        </ul>

        {domains.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
            <p className="mx-auto mb-4 max-w-md text-[13px] leading-relaxed text-text-muted">
              {t(
                'admin.exam.domains_empty_v2',
                'Todavía no hay temas. El examen sirve igual sin ellos, pero la persona solo verá una nota general y, si reprueba, tendrá que repasar el curso completo.',
              )}
            </p>
            <button
              onClick={handleAddDomain}
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[13px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('admin.exam.domain_add_first', 'Crear el primer tema')}
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {domains.map((d, i) => (
                <DomainRow
                  key={d.id}
                  domain={d}
                  index={i}
                  modules={modules}
                  examQuestionCount={form.question_count}
                  onChange={(patch) => {
                    setDomains((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...patch } : x)))
                  }}
                  onDelete={() => handleDeleteDomain(d)}
                />
              ))}
            </div>

            {/* Marcador de la suma: el error clásico es dejarla en 90 y no
                enterarse hasta que el examen ya está publicado. */}
            <div
              className={cn(
                'mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12px]',
                (health?.weightSum ?? 0) === 100
                  ? 'border-line text-text-muted'
                  : 'border-amber-500/30 bg-amber-500/[0.05] text-text-muted',
              )}
            >
              {(health?.weightSum ?? 0) === 100 ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={3} />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span className="min-w-0 flex-1">
                {(health?.weightSum ?? 0) === 100
                  ? t(
                      'admin.exam.weights_ok',
                      'Los porcentajes suman 100%: el reparto de preguntas está completo.',
                    )
                  : t('admin.exam.weights_off', {
                      sum: health?.weightSum ?? 0,
                      defaultValue:
                        'Los porcentajes suman {{sum}}% y deberían sumar 100%. Lo que falte se llena con preguntas de cualquier tema.',
                    })}
              </span>
            </div>

            {/* Repartos asistidos: avisar de que la suma está mal sin dar la
                forma de arreglarla es dejar al capacitador haciendo cuentas a
                mano. Cada botón dice el resultado exacto antes de tocarlo. */}
            {(health?.weightSum ?? 0) !== 100 && (
              <div className="mt-2 rounded-xl border border-line px-3.5 py-3">
                <p className="mb-2 text-[12px] font-medium text-text">
                  {t('admin.exam.weights_help_title', '¿Te ayudo a repartirlo?')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {weightPlans.map((plan) => (
                    <Tooltip
                      key={plan.id}
                      label={
                        <span>
                          {plan.tip}
                          <br />
                          <span className="opacity-80">{plan.preview}</span>
                        </span>
                      }
                      maxWidth={300}
                      anchor="element"
                    >
                      <button
                        onClick={() => void applyWeights(plan.weights)}
                        className="rounded-full border border-line px-3.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
                      >
                        {plan.label}
                      </button>
                    </Tooltip>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
                  {t(
                    'admin.exam.weights_help_hint',
                    'Pasa el mouse por encima para ver cómo quedaría cada tema. Siempre puedes escribir los números a mano.',
                  )}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── 3. Banco de preguntas ── */}
      <section id="exam-bank" className="scroll-mt-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text">
            <ClipboardCheck className="h-4 w-4 text-text-muted" />
            {t('admin.exam.bank_title', 'Banco de preguntas')}
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold tabular-nums text-text-muted">
              {questions.length}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditingQuestion(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('admin.exam.q_add', 'A mano')}
            </button>
            <button
              onClick={() => setGenerateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-on-primary transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('admin.exam.q_generate', 'Generar / importar')}
            </button>
          </div>
        </div>

        {/* Chip de "fuera de nivel": aparece solo cuando hay algo que arreglar,
            y es el mismo destino al que llevan el semáforo y las reglas. */}
        {health && health.offLevel.length > 0 && (
          <div className="mb-3 mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOnlyOffLevel((v) => !v)}
              aria-pressed={onlyOffLevel}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors',
                onlyOffLevel
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-line text-text-muted hover:text-text',
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('admin.exam.filter_off_level', {
                n: health.offLevel.length,
                defaultValue: 'Fuera de nivel · {{n}}',
              })}
            </button>
            <Tooltip
              label={t(
                'admin.exam.tip_fix_all',
                'Marca esas preguntas con el nivel del examen. Cambia la etiqueta, no la pregunta: úsalo solo si de verdad evalúan a ese nivel.',
              )}
              maxWidth={270}
            >
              <button
                onClick={() => void handleFixOffLevel()}
                className="rounded-full border border-line px-3.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                {t('admin.exam.level_fix_all', 'Ajustar todas al nivel')}
              </button>
            </Tooltip>
          </div>
        )}

        {questions.length > 6 && (
          <div className="mb-3 mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.exam.bank_search', 'Buscar en el banco…')}
                className={cn(inputCls, 'py-2 pl-9')}
              />
            </div>
            {domains.length > 0 && (
              <div className="w-52">
                <Select
                  value={filterDomain}
                  onChange={setFilterDomain}
                  compact
                  options={[
                    { value: '', label: t('admin.exam.bank_all_domains_v2', 'Todos los temas') },
                    ...domains.map((d) => ({ value: d.id, label: d.name_es, color: d.color })),
                  ]}
                />
              </div>
            )}
          </div>
        )}

        {questions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
            <Sparkles className="mx-auto mb-3 h-6 w-6 text-text-subtle" />
            <p className="mb-4 text-[13px] text-text-muted">
              {t(
                'admin.exam.bank_empty',
                'El banco está vacío. Lo más rápido: deja que la IA lo escriba desde el temario y luego ajusta lo que no te guste.',
              )}
            </p>
            <button
              onClick={() => setGenerateOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-medium text-on-primary transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('admin.exam.bank_empty_cta', 'Generar con IA')}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {visibleQuestions.map((q, i) => {
              const domain = domains.find((d) => d.id === q.domain_id)
              return (
                <div key={q.id} className="group flex items-start gap-3 px-1 py-3">
                  <span className="mt-0.5 w-6 shrink-0 text-right text-[12px] tabular-nums text-text-subtle">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] leading-snug text-text">{q.text_es}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-subtle">
                      {domain ? (
                        <Tooltip
                          label={t('admin.exam.tip_q_domain', {
                            name: domain.name_es,
                            defaultValue:
                              'Tema "{{name}}". Cuenta para las preguntas que le tocan a este tema y para la nota por tema que ve la persona.',
                          })}
                          maxWidth={250}
                        >
                          <span className="inline-flex cursor-help items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: domain.color }}
                            />
                            {domain.name_es}
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip
                          label={t(
                            'admin.exam.tip_q_no_domain',
                            'Sin tema: entra al montón general y no aparece en la nota por tema. Ponle un tema para que el repaso sepa qué mandar a estudiar.',
                          )}
                          maxWidth={260}
                        >
                          <span className="cursor-help italic">
                            {t('admin.exam.q_no_domain_v2', 'Sin tema')}
                          </span>
                        </Tooltip>
                      )}
                      <span>·</span>
                      <span>
                        {t('admin.exam.q_options_n', {
                          n: q.options.length,
                          defaultValue: 'Opciones: {{n}}',
                        })}
                      </span>
                      {q.correct.length > 1 && (
                        <>
                          <span>·</span>
                          <Tooltip
                            label={t(
                              'admin.exam.tip_q_multi',
                              'Solo cuenta como acertada si marca EXACTAMENTE todas las correctas y ninguna de más.',
                            )}
                            maxWidth={250}
                          >
                            <span className="cursor-help">
                              {t('admin.exam.kind_multi', 'Varias respuestas')}
                            </span>
                          </Tooltip>
                        </>
                      )}
                      {q.source === 'ai' && (
                        <>
                          <span>·</span>
                          <Tooltip
                            label={t(
                              'admin.exam.tip_q_ai',
                              'La escribió la IA a partir del temario. Revísala antes de publicar: es tuya la última palabra.',
                            )}
                            maxWidth={250}
                          >
                            <span className="inline-flex cursor-help items-center gap-1">
                              <Sparkles className="h-3 w-3" /> IA
                            </span>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>

                  <LevelPill level={q.difficulty} target={form.target_level} className="mt-0.5" />

                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Tooltip label={t('common.edit', 'Editar')}>
                      <button
                        onClick={() => setEditingQuestion(q)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-text-subtle transition-colors hover:bg-subtle hover:text-text"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip label={t('common.delete', 'Eliminar')}>
                      <button
                        onClick={() => handleDeleteQuestion(q)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              )
            })}
            {visibleQuestions.length === 0 && (
              <div className="py-8 text-center text-[13px] text-text-muted">
                {t('admin.exam.bank_no_match', 'Ninguna pregunta coincide con el filtro.')}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 4. Resultados ── */}
      {results.length > 0 && (
        <section>
          <button
            onClick={() => setResultsOpen((v) => !v)}
            aria-expanded={resultsOpen}
            className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left transition-colors hover:bg-glass/5"
          >
            <Users className="h-4 w-4 shrink-0 text-text-muted" />
            <div className="min-w-0 flex-1">
              <span className="text-[14px] font-semibold text-text">
                {t('admin.exam.results_title', 'Resultados del examen')}
              </span>
              <p className="mt-0.5 text-[12px] text-text-muted">
                {t('admin.exam.results_summary', {
                  n: results.length,
                  passed: results.filter((r) => r.passed).length,
                  defaultValue: 'Lo han presentado: {{n}} · aprobados: {{passed}}',
                })}
              </p>
            </div>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-text-subtle transition-transform',
                resultsOpen && 'rotate-180',
              )}
            />
          </button>

          {resultsOpen && (
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {results.map((r) => (
                <div key={r.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-text">
                      {r.display_name ?? r.email ?? r.user_id.slice(0, 8)}
                    </div>
                    <div className="text-[11.5px] text-text-subtle">
                      {t('admin.exam.results_attempts', {
                        n: r.attempts,
                        defaultValue: 'Intentos: {{n}}',
                      })}
                      {r.weak_domains.length > 0 && (
                        <>
                          {' · '}
                          {t('admin.exam.results_weak', {
                            list: r.weak_domains.map((d) => d.name_es).join(', '),
                            defaultValue: 'flojo en {{list}}',
                          })}
                        </>
                      )}
                      {r.reinforcement === 'pending' && (
                        <>
                          {' · '}
                          <Tooltip
                            label={t(
                              'admin.exam.tip_reinforcing',
                              'Tiene un repaso pendiente: no puede volver a presentar el examen hasta terminar los módulos de los temas que reprobó.',
                            )}
                            maxWidth={270}
                          >
                            <span className="cursor-help underline decoration-dotted underline-offset-2">
                              {t('admin.exam.results_reinforcing', 'en refuerzo')}
                            </span>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>

                  <Tooltip
                    label={t('admin.exam.tip_best_score', {
                      best: r.best_score ?? 0,
                      last: r.last_score ?? 0,
                      defaultValue: 'Mejor puntaje: {{best}}% · último intento: {{last}}%',
                    })}
                    anchor="element"
                    describedBy
                  >
                    <span
                      className={cn(
                        'shrink-0 cursor-help text-[15px] font-semibold tabular-nums',
                        r.passed ? 'text-primary' : 'text-amber-600',
                      )}
                    >
                      {r.best_score ?? 0}%
                    </span>
                  </Tooltip>

                  {r.passed ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      <GraduationCap className="h-3 w-3" />
                      {t('exam.status_passed', 'Aprobado')}
                    </span>
                  ) : (
                    <Tooltip
                      label={t(
                        'admin.exam.tip_grant',
                        'Le suma un intento extra y le levanta la ruta de refuerzo pendiente: puede volver a presentarlo enseguida, sin esperar.',
                      )}
                      maxWidth={260}
                    >
                      <button
                        onClick={() =>
                          handleGrantAttempt(r.user_id, r.display_name ?? r.email ?? '')
                        }
                        className="shrink-0 rounded-full border border-line px-3 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
                      >
                        {t('admin.exam.grant_short', 'Dar otro intento')}
                      </button>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Guardado inline: la barra del pie del editor también lo dispara. */}
      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => {
              // Descartar es descartar TODO lo del examen: dejar el banco a
              // medias mientras la ficha vuelve atrás sería lo peor de ambos.
              setForm(exam)
              setDomains(savedDomains)
              setQuestions(savedQuestions)
            }}
            className="rounded-full px-4 py-2 text-[13px] text-text-muted transition-colors hover:text-text"
          >
            {t('common.discard', 'Descartar')}
          </button>
          <button
            onClick={() => void saveExam()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[13px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('common.save', 'Guardar')}
          </button>
        </div>
      )}

      {/* ── Modales ── */}
      {editingQuestion !== undefined && (
        <ExamQuestionModal
          question={editingQuestion}
          domains={domains}
          targetLevel={form.target_level}
          onSave={handleSaveQuestion}
          onClose={() => setEditingQuestion(undefined)}
        />
      )}

      {generateOpen && (
        <ExamGenerateModal
          context={{ courseId, courseTitle, source }}
          domains={domains}
          targetLevel={form.target_level}
          bank={bank}
          onRemove={handleRemoveFromBank}
          onImport={handleImportQuestions}
          onCreateDomains={handleCreateDomains}
          onClose={() => setGenerateOpen(false)}
        />
      )}
    </div>
  )
}

/* ── Fila de un tema ────────────────────────────────────────────────────────
   Nombre, cuánto pesa y — lo importante — qué módulos se mandan a repasar
   cuando alguien reprueba ESTE tema. Ahí está la magia del refuerzo: no manda
   a estudiar el curso entero, manda exactamente lo que falló.

   El porcentaje se traduce a preguntas de verdad ("≈ 8 de 20") al lado del
   campo: nadie calcula bien un 40% de 20 mientras escribe, y ese número es el
   que de verdad decide cómo se siente el examen. */
function DomainRow({
  domain,
  index,
  modules,
  examQuestionCount,
  onChange,
  onDelete,
}: {
  domain: ExamDomain
  index: number
  modules: ExamBuilderModule[]
  /** Preguntas que tendrá cada intento: convierte el % en preguntas reales. */
  examQuestionCount: number
  onChange: (patch: Partial<ExamDomain>) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [name, setName] = useState(domain.name_es)
  const [weight, setWeight] = useState(domain.weight_pct)

  useEffect(() => setName(domain.name_es), [domain.name_es])
  useEffect(() => setWeight(domain.weight_pct), [domain.weight_pct])

  const linked = domain.module_ids ?? []
  const have = domain.question_count ?? 0
  const need = Math.round((examQuestionCount * weight) / 100)
  const missing = Math.max(0, need - have)

  return (
    <motion.div
      initial={reduce ? undefined : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease, delay: reduce ? 0 : index * 0.05 }}
      className="rounded-2xl border border-line p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="h-9 w-1.5 shrink-0 rounded-full"
          style={{ background: domain.color }}
          aria-hidden
        />

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== domain.name_es && void onChange({ name_es: name.trim() })}
          placeholder={t('admin.exam.domain_name_ph', 'Nombre del tema (por ejemplo: Facturación)')}
          aria-label={t('admin.exam.domain_name', 'Nombre del tema')}
          className="min-w-[160px] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[14px] font-medium text-text outline-none transition-colors hover:border-line focus:border-primary"
        />

        <Tooltip
          label={t('admin.exam.tip_domain_weight_v2', {
            pct: weight,
            n: need,
            total: examQuestionCount,
            defaultValue:
              'Cuánto pesa este tema en el examen. Con {{pct}}%, a este tema le tocan {{n}} de las {{total}} preguntas de cada intento. Entre todos los temas debe sumar 100%.',
          })}
          maxWidth={280}
          anchor="element"
          describedBy
        >
          <div className="flex shrink-0 cursor-help items-center gap-1.5">
            <NumberField
              value={weight}
              onChange={setWeight}
              onCommit={(n) => n !== domain.weight_pct && void onChange({ weight_pct: n })}
              min={0}
              max={100}
              aria-label={t('admin.exam.domain_weight', 'Porcentaje del examen')}
              className="w-16 rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] tabular-nums text-text outline-none focus:border-primary"
            />
            <span className="whitespace-nowrap text-[12px] text-text-muted">
              {t('admin.exam.domain_weight_of', {
                n: need,
                total: examQuestionCount,
                defaultValue: '% → {{n}} de {{total}} preguntas',
              })}
            </span>
          </div>
        </Tooltip>

        <Tooltip
          label={
            missing > 0
              ? t('admin.exam.tip_domain_count_missing', {
                  have,
                  need,
                  defaultValue:
                    'Tienes {{have}} preguntas escritas de este tema y hacen falta {{need}}. Mientras falten, el examen las completa con preguntas de otros temas.',
                })
              : t('admin.exam.tip_domain_count_ok', {
                  have,
                  need,
                  defaultValue:
                    'Tienes {{have}} preguntas escritas de este tema y con {{need}} basta. Cuantas más tengas, menos se repiten entre una persona y otra.',
                })
          }
          maxWidth={280}
          anchor="element"
          describedBy
        >
          <span
            className={cn(
              'shrink-0 cursor-help rounded-full px-2.5 py-0.5 text-[11px] tabular-nums',
              missing > 0
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'bg-subtle text-text-muted',
            )}
          >
            {missing > 0
              ? t('admin.exam.domain_questions_missing', {
                  have,
                  need,
                  defaultValue: 'Escritas: {{have}} de {{need}}',
                })
              : t('admin.exam.domain_questions', {
                  n: have,
                  defaultValue: 'Preguntas: {{n}}',
                })}
          </span>
        </Tooltip>

        <Tooltip label={t('common.delete', 'Eliminar')}>
          <button
            onClick={onDelete}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-4">
        <Tooltip
          label={t(
            'admin.exam.tip_domain_modules_v2',
            'Si alguien reprueba este tema, tendrá que volver a estos módulos antes de poder presentar el examen otra vez.',
          )}
          maxWidth={280}
          anchor="element"
          describedBy
        >
          <span className="cursor-help text-[12px] text-text-muted">
            {t('admin.exam.domain_reinforce_v2', 'Si reprueba este tema, repasa:')}
          </span>
        </Tooltip>
        <div className="min-w-[220px] flex-1">
          <MultiSelect
            values={linked}
            onChange={(v) => void onChange({ module_ids: v })}
            compact
            placeholder={t('admin.exam.domain_pick_modules', 'Elige los módulos')}
            options={modules.map((m) => ({ value: m.id, label: m.title_es }))}
            aria-label={t('admin.exam.domain_reinforce_v2', 'Módulos que se repasan')}
          />
        </div>
      </div>

      {linked.length === 0 && (
        <p className="mt-2 pl-4 text-[11.5px] text-text-subtle">
          {t(
            'admin.exam.domain_no_modules_v2',
            'Si no eliges módulos, quien reprueba este tema tendrá que repasar el curso completo.',
          )}
        </p>
      )}
    </motion.div>
  )
}
