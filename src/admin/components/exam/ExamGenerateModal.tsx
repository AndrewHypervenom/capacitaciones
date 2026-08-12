import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  BookOpen,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Recycle,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui/Select'
import { NumberField } from '@/components/ui/NumberField'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import {
  aiDraftToQuestions,
  classifyQuestionDifficulty,
  generateExamFromDocument,
  generateExamWithAi,
  getReusableQuestions,
  parseExamSheet,
  reusableToQuestion,
  saveQuizDifficulties,
  SOURCE_CHAR_LIMIT,
  type CourseSource,
  type AiExamDraft,
  type NewExamQuestion,
  type ParsedImportRow,
  type ReusableQuestion,
} from '@/services/exams.admin.service'
import {
  ACCEPTED_DOC_EXTENSIONS,
  extractDocumentText,
  type ExtractProgress,
  type ExtractedDocument,
} from '@/lib/documentExtract'
import type { ExamDomain, ExamDifficulty, ExamTargetLevel } from '@/types/exam'
import { DIFFICULTIES, difficultyLabel, isLevelLocked, levelFits } from '@/lib/examLevel'
import { AiLevelField, LevelGuard, LevelPill } from './ExamLevelBits'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'

const ease = [0.16, 1, 0.3, 1] as const

type Source = 'ai' | 'reuse' | 'file'

export interface ExamCourseContext {
  courseId: string
  courseTitle: string
  /**
   * El contenido real del curso en texto plano: es la fuente ÚNICA con la que
   * la IA escribe. `null` mientras se está leyendo de la base.
   */
  source: CourseSource | null
}

/* ────────────────────────────────────────────────────────────────────────────
   Llenar el banco de preguntas: las cuatro vías en un solo sitio.

   · IA (Claude) a partir del temario real del curso — también propone los
     dominios y sus pesos.
   · Reutilizar los quizzes que ya existen en los módulos (se COPIAN: editar la
     del examen no toca la del módulo).
   · Importar una hoja de cálculo, con vista previa fila a fila antes de
     guardar nada.
   · A mano vive en el otro modal (ExamQuestionModal).

   Nada se guarda hasta que el capacitador ve lo que va a entrar y lo confirma.
   ──────────────────────────────────────────────────────────────────────────── */

export function ExamGenerateModal({
  context,
  domains,
  targetLevel = 'mixta',
  onImport,
  onCreateDomains,
  onClose,
}: {
  context: ExamCourseContext
  domains: ExamDomain[]
  /**
   * Nivel al que evalúa el examen. Si es fijo, manda sobre las tres vías: la IA
   * solo escribe a ese nivel, los quizzes de otro nivel no se copian y las
   * filas del Excel que no cuadren no se importan.
   */
  targetLevel?: ExamTargetLevel
  /** Guarda las preguntas elegidas en el banco. */
  onImport: (questions: NewExamQuestion[]) => Promise<void>
  /** Crea los dominios que propuso la IA y devuelve su id por nombre. */
  onCreateDomains: (
    drafts: { name_es: string; description_es: string; weight_pct: number }[],
  ) => Promise<Map<string, string>>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [source, setSource] = useState<Source>('ai')
  const [busy, setBusy] = useState(false)
  const backdrop = useBackdropDismiss(onClose, !busy)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const tabs: { id: Source; label: string; icon: typeof Sparkles }[] = [
    { id: 'ai', label: t('admin.exam.src_ai', 'Con IA'), icon: Sparkles },
    { id: 'reuse', label: t('admin.exam.src_reuse', 'Reutilizar quizzes'), icon: Recycle },
    { id: 'file', label: t('admin.exam.src_file', 'Importar archivo'), icon: FileSpreadsheet },
  ]

  // Portal a <body> + z-[120] (estándar del sitio): dentro del árbol del panel,
  // un ancestro con `transform`/`filter` encierra al `fixed` en su contexto de
  // apilamiento y el modal se iba POR DEBAJO de la barra lateral (z-[60]).
  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      {...backdrop}
    >
      <motion.div
        initial={reduce ? undefined : { opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-text">
              {t('admin.exam.gen_title', 'Añadir preguntas al banco')}
            </h2>
            <p className="truncate text-[12px] text-text-muted">{context.courseTitle}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text disabled:opacity-40"
            aria-label={t('common.close', 'Cerrar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-line px-6">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSource(id)}
              disabled={busy}
              className={cn(
                'relative flex items-center gap-1.5 px-3.5 py-3 text-[13px] font-medium transition-colors disabled:opacity-50',
                source === id ? 'text-primary' : 'text-text-muted hover:text-text',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {source === id && (
                <motion.span
                  layoutId="exam-src-underline"
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
            </button>
          ))}
        </div>

        {isLevelLocked(targetLevel) && (
          <div className="flex items-start gap-2.5 border-b border-line bg-primary/[0.04] px-6 py-2.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="text-[12px] leading-relaxed text-text-muted">
              {t('admin.exam.gen_level_banner', {
                level: difficultyLabel(t, targetLevel),
                defaultValue:
                  'Este examen evalúa a nivel {{level}}: solo entran al banco preguntas de ese nivel, vengan de donde vengan.',
              })}
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {source === 'ai' && (
            <AiPanel
              context={context}
              domains={domains}
              targetLevel={targetLevel}
              busy={busy}
              setBusy={setBusy}
              abortRef={abortRef}
              onImport={onImport}
              onCreateDomains={onCreateDomains}
              onDone={onClose}
            />
          )}
          {source === 'reuse' && (
            <ReusePanel
              courseId={context.courseId}
              courseTitle={context.courseTitle}
              domains={domains}
              targetLevel={targetLevel}
              busy={busy}
              setBusy={setBusy}
              onImport={onImport}
              onDone={onClose}
            />
          )}
          {source === 'file' && (
            <FilePanel
              courseTitle={context.courseTitle}
              domains={domains}
              targetLevel={targetLevel}
              busy={busy}
              setBusy={setBusy}
              onImport={onImport}
              onCreateDomains={onCreateDomains}
              onDone={onClose}
            />
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

/* ── Lo que la IA va a leer ────────────────────────────────────────────────
   La promesa "solo evalúa tu material" no vale nada si no se puede ver cuál es
   ese material. Esta tarjeta dice cuántos módulos entran, cuánto texto hay y
   qué módulos están vacíos — que son justo los que antes se rellenaban con
   conocimiento general del modelo sin que nadie se enterara. */
function SourceCard({ source, enough }: { source: CourseSource | null; enough: boolean }) {
  const { t } = useTranslation()

  if (!source) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-line px-4 py-3 text-[12.5px] text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('admin.exam.source_loading', 'Leyendo el contenido del curso…')}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        enough ? 'border-line' : 'border-amber-500/40 bg-amber-500/[0.06]',
      )}
    >
      <div className="flex items-start gap-2.5">
        {enough ? (
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">
            {enough
              ? t('admin.exam.source_title', 'Lo que la IA va a leer')
              : t('admin.exam.source_thin_title', 'Casi no hay contenido que evaluar')}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
            {enough
              ? t('admin.exam.source_body', {
                  modules: source.modules,
                  sections: source.sections,
                  chars: source.chars.toLocaleString('es-CO'),
                  defaultValue:
                    'El texto escrito de {{modules}} módulos y {{sections}} secciones ({{chars}} caracteres). Nada más: no busca en internet ni usa lo que el modelo sabe por su cuenta. Si algo no está escrito en tus módulos, no puede salir en el examen.',
                })
              : t(
                  'admin.exam.source_thin_body',
                  'Tus módulos casi no tienen texto (quizá son de puro video o imagen). La IA no puede escribir preguntas fieles sin material: escribe el contenido en los módulos, o usa "Importar archivo" y súbele el manual del curso.',
                )}
          </p>

          {source.truncated && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
              {t('admin.exam.source_truncated', {
                chars: SOURCE_CHAR_LIMIT.toLocaleString('es-CO'),
                defaultValue:
                  'El curso es muy largo: se leyeron los primeros {{chars}} caracteres. Para cubrir el final, pide otra tanda con una indicación que apunte a esos módulos.',
              })}
            </p>
          )}

          {source.emptyModules.length > 0 && enough && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-text-subtle">
              {t('admin.exam.source_empty_modules', {
                list: source.emptyModules.join(', '),
                defaultValue:
                  'Sin texto para evaluar (no entran al examen): {{list}}.',
              })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 1. Con IA ─────────────────────────────────────────────────────────────── */

function AiPanel({
  context,
  domains,
  targetLevel,
  busy,
  setBusy,
  abortRef,
  onImport,
  onCreateDomains,
  onDone,
}: {
  context: ExamCourseContext
  domains: ExamDomain[]
  targetLevel: ExamTargetLevel
  busy: boolean
  setBusy: (b: boolean) => void
  abortRef: React.MutableRefObject<AbortController | null>
  onImport: (q: NewExamQuestion[]) => Promise<void>
  onCreateDomains: (
    d: { name_es: string; description_es: string; weight_pct: number }[],
  ) => Promise<Map<string, string>>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [count, setCount] = useState(20)
  // Arranca en el nivel del examen: es el único que va a aceptar el banco.
  const [difficulty, setDifficulty] = useState<ExamTargetLevel>(targetLevel)
  const [instruction, setInstruction] = useState('')
  const [useOwnDomains, setUseOwnDomains] = useState(domains.length > 0)
  const levelOk = !isLevelLocked(targetLevel) || difficulty === targetLevel
  const src = context.source
  /** Con menos de esto no hay materia: la IA tendría que inventar para llenar. */
  const enoughSource = (src?.text.trim().length ?? 0) >= 800

  const inputCls =
    'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none transition-colors focus:border-primary'

  const run = async () => {
    if (!levelOk || !enoughSource) return
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      const { data } = await generateExamWithAi({
        courseTitle: context.courseTitle,
        outline: src?.text ?? '',
        count,
        domains: useOwnDomains ? domains.map((d) => d.name_es) : undefined,
        difficulty,
        instruction: instruction.trim() || undefined,
        signal: abortRef.current.signal,
      })

      // Los dominios existentes mandan; los nuevos solo se crean si la IA los
      // propuso porque no había ninguno.
      let byName = new Map(domains.map((d) => [d.name_es.toLowerCase().trim(), d.id]))
      if (!useOwnDomains && data.domains.length > 0) {
        byName = await onCreateDomains(data.domains)
      }

      const all = aiDraftToQuestions(data, byName)
      // Se le pidió el nivel del examen, pero el modelo a veces devuelve alguna
      // de otro nivel. Esas NO entran: el banco de un examen de nivel fijo se
      // mantiene puro sin que el capacitador tenga que ir a cazarlas después.
      const questions = all.filter((q) => levelFits(targetLevel, q.difficulty))
      const dropped = all.length - questions.length

      if (questions.length === 0) {
        toast.error(
          dropped > 0
            ? t('admin.exam.ai_all_off_level', {
                level: difficultyLabel(t, targetLevel),
                defaultValue:
                  'Ninguna de las preguntas que escribió la IA quedó en nivel {{level}}. Vuelve a intentarlo o añade material más exigente al curso.',
              })
            : t('admin.exam.ai_empty', 'La IA no devolvió preguntas utilizables.'),
        )
        return
      }
      await onImport(questions)
      toast.success(
        dropped > 0
          ? t('admin.exam.ai_ok_dropped', {
              n: questions.length,
              dropped,
              level: difficultyLabel(t, targetLevel),
              defaultValue:
                'Preguntas añadidas: {{n}}. Se descartaron {{dropped}} que no quedaron en nivel {{level}}.',
            })
          : t('admin.exam.ai_ok', {
              n: questions.length,
              defaultValue: 'Preguntas añadidas al banco: {{n}}',
            }),
      )
      onDone()
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-[13.5px] leading-relaxed text-text-muted">
        {t(
          'admin.exam.ai_intro_v2',
          'Claude lee el contenido escrito de tus módulos y escribe preguntas de aplicación con sus opciones y su explicación. Genera en español; la traducción se pide después.',
        )}
      </p>

      <SourceCard source={src} enough={enoughSource} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
            {t('admin.exam.ai_count', 'Cuántas preguntas')}
          </label>
          <NumberField
            value={count}
            onChange={setCount}
            min={1}
            max={40}
            className={inputCls}
            aria-label={t('admin.exam.ai_count', 'Cuántas preguntas')}
          />
          <p className="mt-1.5 text-[11.5px] text-text-subtle">
            {t('admin.exam.ai_count_hint', 'Máximo 40 por tanda. Puedes pedir varias.')}
          </p>
        </div>
        <AiLevelField
          value={difficulty}
          onChange={setDifficulty}
          target={targetLevel}
          disabled={busy}
        />
      </div>

      {domains.length > 0 && (
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-4 py-3">
          <input
            type="checkbox"
            checked={useOwnDomains}
            onChange={(e) => setUseOwnDomains(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[rgb(var(--neon-green))]"
          />
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium text-text">
              {t('admin.exam.ai_use_domains_v2', 'Usar mis temas')}
            </span>
            <span className="block text-[12px] text-text-muted">
              {t('admin.exam.ai_use_domains_hint', {
                list: domains.map((d) => d.name_es).join(', '),
                defaultValue: 'Repartirá las preguntas entre tus temas: {{list}}',
              })}
            </span>
          </span>
        </label>
      )}

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
          {t('admin.exam.ai_instruction', 'Indicación (opcional)')}
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
          placeholder={t(
            'admin.exam.ai_instruction_ph',
            'Enfócate en el proceso de reclamos y en casos de clientes molestos.',
          )}
          className={cn(inputCls, 'resize-y leading-relaxed')}
        />
      </div>

      <AiReviewNotice />

      {!levelOk && isLevelLocked(targetLevel) && (
        <LevelGuard
          title={t('admin.exam.ai_level_blocked_title', 'La IA no puede escribir a ese nivel')}
          body={t('admin.exam.ai_level_blocked_body', {
            level: difficultyLabel(t, targetLevel),
            defaultValue:
              'Este examen evalúa a nivel {{level}} y no admite preguntas de otro nivel. Usa el nivel del examen, o cámbialo en "Reglas del examen".',
          })}
          actionLabel={t('admin.exam.use_exam_level', {
            level: difficultyLabel(t, targetLevel),
            defaultValue: 'Usar nivel {{level}}',
          })}
          onAction={() => setDifficulty(targetLevel)}
        />
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {busy && (
          <button
            onClick={() => abortRef.current?.abort()}
            className="rounded-full px-4 py-2.5 text-[13.5px] text-text-muted transition-colors hover:text-text"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
        )}
        <button
          onClick={run}
          disabled={busy || !levelOk || !enoughSource}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy
            ? t('admin.exam.ai_working', 'Escribiendo el examen…')
            : t('admin.exam.ai_run', 'Generar preguntas')}
        </button>
      </div>
    </div>
  )
}

/* ── 2. Reutilizar quizzes de los módulos ──────────────────────────────────── */

function ReusePanel({
  courseId,
  courseTitle,
  domains,
  targetLevel,
  busy,
  setBusy,
  onImport,
  onDone,
}: {
  courseId: string
  courseTitle: string
  domains: ExamDomain[]
  targetLevel: ExamTargetLevel
  busy: boolean
  setBusy: (b: boolean) => void
  onImport: (q: NewExamQuestion[]) => Promise<void>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ReusableQuestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [domainId, setDomainId] = useState('')
  // Nivel de cada pregunta: viene guardado del quiz, lo estima la IA o lo
  // corrige el capacitador. Lo que se toque aquí se guarda en el quiz.
  const [levels, setLevels] = useState<Record<string, ExamDifficulty>>({})
  const [rating, setRating] = useState(false)
  /** El SQL del nivel guardado no está corrido: se avisa una sola vez. */
  const [noStore, setNoStore] = useState(false)
  const [filter, setFilter] = useState<'todas' | ExamDifficulty>('todas')

  useEffect(() => {
    getReusableQuestions(courseId)
      .then((r) => {
        setItems(r)
        setPicked(new Set(r.map((q) => q.key)))
        // El nivel que ya está guardado en el quiz se respeta tal cual: si
        // alguien lo estimó (o lo corrigió) la semana pasada, no hay que volver
        // a pedírselo a la IA ni a él.
        const saved: Record<string, ExamDifficulty> = {}
        for (const q of r) if (q.difficulty) saved[q.key] = q.difficulty
        setLevels(saved)
      })
      .catch(() => setItems([]))
  }, [courseId])

  const levelOf = (key: string): ExamDifficulty => levels[key] ?? 'medio'
  /** Preguntas que todavía no tienen nivel: son las únicas que hay que calificar. */
  const pending = useMemo(() => (items ?? []).filter((q) => !levels[q.key]), [items, levels])
  const rated = items !== null && items.length > 0 && pending.length === 0

  /** Guarda el nivel en el quiz de sección. Silencioso: es una comodidad. */
  const persist = useCallback(
    async (entries: { quizId: string; difficulty: ExamDifficulty }[]) => {
      try {
        const ok = await saveQuizDifficulties(entries)
        if (!ok) setNoStore(true)
      } catch {
        setNoStore(true)
      }
    },
    [],
  )

  /** Corrección a mano: se guarda igual que la estimación de la IA. */
  const setLevel = (key: string, difficulty: ExamDifficulty) => {
    setLevels((prev) => ({ ...prev, [key]: difficulty }))
    void persist([{ quizId: key, difficulty }])
  }

  /**
   * Los quizzes de sección no traen nivel, y el examen reparte por dificultad:
   * sin esto, todo el banco reutilizado entraba como "medio" y desbalanceaba el
   * sorteo. Solo se le pregunta a la IA por las que aún no tienen nivel, y el
   * resultado se guarda en el quiz para no repetir el gasto en cada visita.
   */
  const rate = async (all = false) => {
    if (!items?.length) return
    const todo = all ? items : pending
    if (todo.length === 0) return
    setRating(true)
    try {
      const out = await classifyQuestionDifficulty(
        courseTitle,
        todo.map((q) => ({
          text: q.text_es,
          options: q.options.map((o) => o.text_es),
          correct: q.correct
            .map((id) => q.options.findIndex((o) => o.id === id))
            .filter((i) => i >= 0),
        })),
      )
      const next: Record<string, ExamDifficulty> = { ...levels }
      todo.forEach((q, i) => (next[q.key] = out[i] ?? 'medio'))
      setLevels(next)
      void persist(todo.map((q, i) => ({ quizId: q.key, difficulty: out[i] ?? 'medio' })))

      // Con el examen a un nivel fijo, las que no dan la talla se desmarcan
      // solas: es lo que el capacitador haría a mano, y así el bloqueo del
      // botón no lo obliga a repasar treinta casillas una por una.
      if (isLevelLocked(targetLevel)) {
        const fit = items.filter((q) => next[q.key] === targetLevel)
        setPicked(new Set(fit.map((q) => q.key)))
        const off = items.length - fit.length
        if (off > 0) {
          toast.info(
            t('admin.exam.reuse_rated_off', {
              n: off,
              level: difficultyLabel(t, targetLevel),
              defaultValue:
                'Se desmarcaron {{n}} preguntas que no son de nivel {{level}}: este examen no las admite.',
            }),
          )
          return
        }
      }
      toast.success(
        t('admin.exam.reuse_rated_v2', 'Listo: el nivel quedó guardado en cada quiz.'),
      )
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRating(false)
    }
  }

  const visible = useMemo(
    // Sin nivel asignado, una pregunta no pertenece a ningún filtro de nivel:
    // colarla bajo "Medio" era inventarle una calificación que nadie hizo.
    () => (items ?? []).filter((q) => filter === 'todas' || levels[q.key] === filter),
    [items, filter, levels],
  )

  const byModule = useMemo(() => {
    const map = new Map<string, ReusableQuestion[]>()
    for (const q of visible) {
      const arr = map.get(q.moduleTitle) ?? []
      arr.push(q)
      map.set(q.moduleTitle, arr)
    }
    return [...map.entries()]
  }, [visible])

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /** Seleccionadas que NO son del nivel del examen: bloquean la copia. */
  const offLevelPicked = useMemo(
    () =>
      isLevelLocked(targetLevel)
        ? (items ?? []).filter((q) => picked.has(q.key) && levels[q.key] !== targetLevel)
        : [],
    [items, picked, levels, targetLevel],
  )

  const dropOffLevel = () =>
    setPicked((prev) => {
      const next = new Set(prev)
      for (const q of offLevelPicked) next.delete(q.key)
      return next
    })

  const run = async () => {
    // Sin nivel estimado no se copia nada: ver el aviso de arriba.
    if (!rated || offLevelPicked.length > 0) return
    const chosen = (items ?? []).filter((q) => picked.has(q.key))
    if (chosen.length === 0) return
    setBusy(true)
    try {
      await onImport(chosen.map((q) => reusableToQuestion(q, domainId || null, levelOf(q.key))))
      toast.success(
        t('admin.exam.reuse_ok', {
          n: chosen.length,
          defaultValue: 'Preguntas copiadas al banco: {{n}}',
        }),
      )
      onDone()
    } catch {
      toast.error(t('admin.exam.reuse_error', 'No se pudieron copiar las preguntas.'))
    } finally {
      setBusy(false)
    }
  }

  if (items === null) {
    return (
      <div className="grid h-40 place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <Recycle className="mx-auto mb-3 h-7 w-7 text-text-subtle" />
        <p className="text-[13.5px] text-text-muted">
          {t(
            'admin.exam.reuse_empty',
            'Los módulos de este curso todavía no tienen quizzes de sección que reutilizar.',
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-[13.5px] leading-relaxed text-text-muted">
        {t(
          'admin.exam.reuse_intro',
          'Se copian al examen: editarlas aquí no toca el quiz del módulo, y al revés.',
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1">
          <Select
            value={domainId}
            onChange={setDomainId}
            placeholder={t('admin.exam.q_no_domain_v2', 'Sin tema')}
            options={[
              { value: '', label: t('admin.exam.q_no_domain_v2', 'Sin tema') },
              ...domains.map((d) => ({ value: d.id, label: d.name_es, color: d.color })),
            ]}
          />
        </div>
        {/* "Elegir todas" nunca selecciona lo que el examen no admite: sería
            proponer un clic que el botón de copiar va a bloquear enseguida. */}
        <button
          onClick={() => {
            const selectable =
              rated && isLevelLocked(targetLevel)
                ? items.filter((q) => levelOf(q.key) === targetLevel)
                : items
            setPicked(
              picked.size >= selectable.length && selectable.length > 0
                ? new Set()
                : new Set(selectable.map((q) => q.key)),
            )
          }}
          className="rounded-full border border-line px-3.5 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:text-text"
        >
          {picked.size > 0
            ? t('admin.exam.select_none', 'Quitar todas')
            : t('admin.exam.select_all', 'Elegir todas')}
        </button>
      </div>

      {/* Nivel de las preguntas reutilizadas: el examen reparte por dificultad,
          así que sin nivel real NO se pueden copiar (entrarían todas como
          "medio" y el sorteo por nivel quedaría mintiendo). */}
      <div
        className={cn(
          'rounded-2xl border px-4 py-3',
          rated ? 'border-line' : 'border-amber-500/30 bg-amber-500/[0.05]',
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-text">
              {!rated && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
              {t('admin.exam.reuse_rate_title', 'Nivel de estas preguntas')}
            </p>
            <p className="text-[11.5px] leading-relaxed text-text-muted">
              {rated
                ? isLevelLocked(targetLevel)
                  ? t('admin.exam.reuse_rate_done_locked_v2', {
                      level: difficultyLabel(t, targetLevel),
                      defaultValue:
                        'Ya tienen nivel y queda guardado en cada quiz: no hay que volver a estimarlo. Solo se copian las de nivel {{level}}; si crees que alguna está mal calificada, cámbiala aquí.',
                    })
                  : t(
                      'admin.exam.reuse_rate_done_v2',
                      'Ya tienen nivel y queda guardado en cada quiz: no hay que volver a estimarlo. Si alguna no te cuadra, cámbiala aquí y se guarda.',
                    )
                : (items ?? []).some((q) => levels[q.key])
                  ? t('admin.exam.reuse_rate_partial', {
                      n: pending.length,
                      defaultValue:
                        'Faltan {{n}} por calificar. Las demás ya tienen nivel guardado, así que la IA solo mira las que faltan.',
                    })
                  : t(
                      'admin.exam.reuse_rate_required_v2',
                      'Los quizzes de módulo no traen nivel y el examen reparte por dificultad. Calcúlalo una vez: queda guardado en el quiz y no vuelve a pedirse.',
                    )}
            </p>
            {noStore && (
              <p className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                {t('admin.exam.reuse_rate_nostore', {
                  file: 'supabase/sql/2026-08-12_section_quiz_difficulty.sql',
                  defaultValue:
                    'Ojo: el nivel no se pudo guardar porque falta correr {{file}}. Funciona igual, pero se perderá al cerrar.',
                })}
              </p>
            )}
          </div>
          <button
            onClick={() => void rate(rated)}
            disabled={rating || busy}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line px-3.5 py-2 text-[12.5px] font-medium text-text transition-colors hover:bg-subtle disabled:opacity-50"
          >
            {rating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {rating
              ? t('admin.exam.reuse_rating', 'Calificando…')
              : rated
                ? t('admin.exam.reuse_rate_again', 'Volver a estimar')
                : t('admin.exam.reuse_rate_pending', {
                    n: pending.length,
                    defaultValue: 'Calcular el nivel de {{n}}',
                  })}
          </button>
        </div>

        {items.some((q) => levels[q.key]) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(['todas', ...DIFFICULTIES] as const).map((f) => {
              const n =
                f === 'todas' ? items.length : items.filter((q) => levels[q.key] === f).length
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                    filter === f
                      ? 'border-primary/40 bg-primary/[0.08] text-primary'
                      : 'border-line text-text-muted hover:text-text',
                  )}
                >
                  {f === 'todas' ? t('admin.exam.filter_all', 'Todas') : difficultyLabel(t, f)} ·{' '}
                  {n}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {byModule.map(([moduleTitle, qs]) => (
          <div key={moduleTitle}>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-subtle">
              {moduleTitle}
            </h3>
            <div className="space-y-1.5">
              {qs.map((q) => (
                <div
                  key={q.key}
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
                    picked.has(q.key) ? 'border-primary/40 bg-primary/[0.04]' : 'border-line',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(q.key)}
                    onChange={() => toggle(q.key)}
                    aria-label={q.text_es}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--neon-green))]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] text-text">{q.text_es}</p>
                    <p className="mt-0.5 text-[11.5px] text-text-subtle">
                      {q.sectionHeading} · {q.options.length}{' '}
                      {t('admin.exam.options_short', 'opciones')}
                    </p>
                  </div>
                  {levels[q.key] ? (
                    <div className="flex shrink-0 items-center gap-2">
                      {!levelFits(targetLevel, levelOf(q.key)) && (
                        <LevelPill level={levelOf(q.key)} target={targetLevel} />
                      )}
                      <div className="w-[128px]">
                        <Select
                          value={levelOf(q.key)}
                          onChange={(v) => setLevel(q.key, v as ExamDifficulty)}
                          options={DIFFICULTIES.map((d) => ({
                            value: d,
                            label: difficultyLabel(t, d),
                          }))}
                        />
                      </div>
                    </div>
                  ) : (
                    // Sin estimar, mostrar "Medio" sería inventarle un nivel.
                    <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-text-subtle">
                      {t('admin.exam.reuse_no_level', 'Sin nivel')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {t('admin.exam.reuse_filter_empty', 'Ninguna pregunta quedó en este nivel.')}
          </p>
        )}
      </div>

      {offLevelPicked.length > 0 && isLevelLocked(targetLevel) && (
        <LevelGuard
          title={t('admin.exam.reuse_level_blocked_title', 'Hay quizzes de otro nivel')}
          body={t('admin.exam.reuse_level_blocked_body', {
            n: offLevelPicked.length,
            level: difficultyLabel(t, targetLevel),
            defaultValue:
              'Seleccionaste {{n}} preguntas que no son de nivel {{level}} y este examen solo evalúa a ese nivel. Quítalas, corrígeles el nivel si crees que la IA se equivocó, o cambia el nivel del examen.',
          })}
          actionLabel={t('admin.exam.reuse_drop_off', {
            n: offLevelPicked.length,
            defaultValue: 'Quitar las {{n}}',
          })}
          onAction={dropOffLevel}
        />
      )}

      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t border-line bg-surface px-6 py-3">
        <span className="mr-auto text-[12.5px] text-text-muted">
          {!rated
            ? t('admin.exam.reuse_blocked', 'Primero define el nivel de las preguntas.')
            : offLevelPicked.length > 0
              ? t('admin.exam.reuse_blocked_level', {
                  n: offLevelPicked.length,
                  defaultValue: 'Quita las {{n}} que no son del nivel del examen.',
                })
              : t('admin.exam.selected_n', { n: picked.size, defaultValue: '{{n}} seleccionadas' })}
        </span>
        <button
          onClick={run}
          disabled={busy || !rated || picked.size === 0 || offLevelPicked.length > 0}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('admin.exam.reuse_cta', 'Copiar al banco')}
        </button>
      </div>
    </div>
  )
}


/* ── 3. Importar archivo ───────────────────────────────────────────────────── */

/**
 * Dos maneras de traer preguntas desde un archivo, y el propio archivo decide
 * cuál es:
 *
 *  · BANCO YA ESCRITO — un Excel/CSV con la columna "Pregunta": se interpreta
 *    fila a fila y se muestra la vista previa, sin IA de por medio.
 *  · DOCUMENTO FUENTE — un manual, procedimiento, presentación o PDF: se lee
 *    igual que al crear un curso o un módulo (el navegador extrae el texto y,
 *    si viene escaneado, las páginas como imagen) y la IA escribe las preguntas
 *    usando SOLO ese documento. Nada de conocimiento general, nada inventado.
 *
 * En los dos casos se ve lo que va a entrar antes de guardar nada.
 */
function FilePanel({
  courseTitle,
  domains,
  targetLevel,
  busy,
  setBusy,
  onImport,
  onCreateDomains,
  onDone,
}: {
  courseTitle: string
  domains: ExamDomain[]
  targetLevel: ExamTargetLevel
  busy: boolean
  setBusy: (b: boolean) => void
  onImport: (q: NewExamQuestion[]) => Promise<void>
  onCreateDomains: (
    d: { name_es: string; description_es: string; weight_pct: number }[],
  ) => Promise<Map<string, string>>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ParsedImportRow[] | null>(null)
  const [doc, setDoc] = useState<ExtractedDocument | null>(null)
  const [reading, setReading] = useState<ExtractProgress | null>(null)
  const [fileName, setFileName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Ajustes de la generación desde documento.
  const [count, setCount] = useState(20)
  const [difficulty, setDifficulty] = useState<ExamTargetLevel>(targetLevel)
  const [instruction, setInstruction] = useState('')
  const [draft, setDraft] = useState<AiExamDraft | null>(null)
  const [pickedQ, setPickedQ] = useState<Set<number>>(new Set())
  const levelOk = !isLevelLocked(targetLevel) || difficulty === targetLevel

  useEffect(() => () => abortRef.current?.abort(), [])

  const inputCls =
    'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none transition-colors focus:border-primary'

  const ok = useMemo(() => (rows ?? []).filter((r) => r.question && !r.error), [rows])
  const bad = useMemo(() => (rows ?? []).filter((r) => r.error), [rows])
  /** Filas válidas cuya columna "Dificultad" no es la del examen. */
  const offLevelRows = useMemo(
    () => ok.filter((r) => !levelFits(targetLevel, r.question!.difficulty)),
    [ok, targetLevel],
  )

  /** Reetiqueta las filas al nivel del examen, sin tocar el archivo original. */
  const fixRowsLevel = () => {
    if (!isLevelLocked(targetLevel)) return
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.question && !r.error
          ? { ...r, question: { ...r.question, difficulty: targetLevel } }
          : r,
      ),
    )
  }

  const handleFile = useCallback(async (file: File) => {
    setRows(null)
    setDoc(null)
    setDraft(null)
    setPickedQ(new Set())
    setFileName(file.name)

    // ¿Es un banco ya escrito? Solo si es hoja de cálculo Y alguna fila trae una
    // pregunta utilizable. Si no, la hoja es material de origen: va por la vía
    // del documento.
    if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
      try {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array', cellText: true })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
        const parsed = parseExamSheet(json)
        if (parsed.some((r) => r.question && !r.error)) {
          setRows(parsed)
          return
        }
      } catch {
        // hoja ilegible como banco: se intenta como documento
      }
    }

    setReading({ stage: 'reading', ratio: 0.02 })
    try {
      const extracted = await extractDocumentText(file, setReading)
      setDoc(extracted)
    } catch (err) {
      toast.error((err as Error).message)
      setFileName('')
    } finally {
      setReading(null)
    }
  }, [])

  /** Plantilla con el formato exacto que espera el importador del banco. */
  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        Pregunta: 'Un cliente reclama un cobro duplicado. ¿Qué haces primero?',
        Dominio: 'Facturación',
        Tipo: 'single',
        'Opcion A': 'Verificar el movimiento en el sistema',
        'Opcion B': 'Prometer la devolución de inmediato',
        'Opcion C': 'Transferir la llamada a otra área',
        'Opcion D': 'Pedirle que llame más tarde',
        Correcta: 'A',
        Explicacion: 'Primero se confirma el cobro; prometer sin verificar genera incumplimientos.',
        Dificultad: 'medio',
      },
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Preguntas')
    XLSX.writeFile(wb, 'plantilla-examen.xlsx')
  }

  // ─── Banco ya escrito ───────────────────────────────────────────────────

  const importBank = async () => {
    if (ok.length === 0 || offLevelRows.length > 0) return
    setBusy(true)
    try {
      // Los dominios nombrados en el archivo que aún no existen se crean, para
      // que la importación no pierda la clasificación por área.
      const byName = new Map(domains.map((d) => [d.name_es.toLowerCase().trim(), d.id]))
      const missing = [
        ...new Set(
          ok
            .map((r) => r.domainName?.trim())
            .filter((n): n is string => Boolean(n) && !byName.has(n!.toLowerCase())),
        ),
      ]
      let resolved = byName
      if (missing.length > 0) {
        resolved = await onCreateDomains(
          missing.map((name_es) => ({ name_es, description_es: '', weight_pct: 0 })),
        )
      }

      await onImport(
        ok.map((r) => ({
          ...r.question!,
          domain_id: r.domainName
            ? resolved.get(r.domainName.toLowerCase().trim()) ?? null
            : null,
        })),
      )
      toast.success(
        t('admin.exam.file_ok', { n: ok.length, defaultValue: 'Preguntas importadas: {{n}}' }),
      )
      onDone()
    } catch {
      toast.error(t('admin.exam.file_import_error', 'No se pudieron importar las preguntas.'))
    } finally {
      setBusy(false)
    }
  }

  // ─── Documento fuente ───────────────────────────────────────────────────

  const generateFromDoc = async () => {
    if (!doc || !levelOk) return
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      // Las páginas rasterizadas solo se mandan si el documento no tiene texto
      // (PDF escaneado, presentación de puras imágenes): son la única forma de
      // leerlo, y pesan.
      const scanned = doc.text.trim().length < 400
      const images = scanned
        ? [...doc.contextImages, ...doc.images].slice(0, 12).map((i) => ({
            mediaType: i.mediaType,
            dataBase64: i.dataBase64,
          }))
        : []

      const { data } = await generateExamFromDocument({
        courseTitle,
        documentName: doc.fileName,
        documentText: doc.text,
        images,
        count,
        domains: domains.length > 0 ? domains.map((d) => d.name_es) : undefined,
        difficulty,
        instruction: instruction.trim() || undefined,
        signal: abortRef.current.signal,
      })

      if (data.questions.length === 0) {
        toast.error(
          t(
            'admin.exam.doc_empty',
            'El documento no dio material evaluable. Prueba con uno que tenga procedimientos o contenido de estudio.',
          ),
        )
        return
      }
      setDraft(data)
      // Las que no quedaron al nivel del examen entran desmarcadas y avisadas:
      // se ven (para juzgar si la IA se equivocó) pero no se importan solas.
      setPickedQ(
        new Set(
          data.questions
            .map((q, i) => (levelFits(targetLevel, q.difficulty ?? 'medio') ? i : -1))
            .filter((i) => i >= 0),
        ),
      )
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const importDraft = async () => {
    if (!draft) return
    const chosen = draft.questions.filter(
      (q, i) => pickedQ.has(i) && levelFits(targetLevel, q.difficulty ?? 'medio'),
    )
    if (chosen.length === 0) return
    setBusy(true)
    try {
      // Los dominios del capacitador mandan; los que propuso la IA (porque no
      // había ninguno) se crean con el peso que ella repartió.
      let byName = new Map(domains.map((d) => [d.name_es.toLowerCase().trim(), d.id]))
      if (domains.length === 0 && draft.domains.length > 0) {
        byName = await onCreateDomains(draft.domains)
      }
      const questions = aiDraftToQuestions({ ...draft, questions: chosen }, byName)
      if (questions.length === 0) {
        toast.error(t('admin.exam.ai_empty', 'La IA no devolvió preguntas utilizables.'))
        return
      }
      await onImport(questions)
      toast.success(
        t('admin.exam.file_ok', {
          n: questions.length,
          defaultValue: 'Preguntas importadas: {{n}}',
        }),
      )
      onDone()
    } catch {
      toast.error(t('admin.exam.file_import_error', 'No se pudieron importar las preguntas.'))
    } finally {
      setBusy(false)
    }
  }

  const toggleQ = (i: number) =>
    setPickedQ((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  // ─── Interfaz ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <p className="text-[13.5px] leading-relaxed text-text-muted">
        {t(
          'admin.exam.file_intro_v2',
          'Sube el material del curso (Word, PDF, PowerPoint, Excel o texto) y la IA escribe las preguntas usando SOLO ese documento. Si el archivo ya es un banco de preguntas (Excel con la columna "Pregunta"), se importa tal cual.',
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || !!reading}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-[13px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {t('admin.exam.file_pick', 'Elegir archivo')}
        </button>
        <button
          onClick={downloadTemplate}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
        >
          <Download className="h-3.5 w-3.5" />
          {t('admin.exam.file_template', 'Descargar plantilla')}
        </button>
        {fileName && <span className="text-[12.5px] text-text-subtle">{fileName}</span>}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_DOC_EXTENSIONS}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {reading && (
        <div className="rounded-2xl border border-line px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] text-text">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {reading.stage === 'images'
              ? t('admin.exam.file_reading_images', 'Leyendo las imágenes del documento…')
              : t('admin.exam.file_reading', 'Leyendo el documento…')}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round(reading.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Documento fuente: ajustes y generación ── */}
      {doc && !draft && (
        <>
          <div className="flex items-start gap-3 rounded-2xl border border-line px-4 py-3">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text">{doc.fileName}</p>
              <p className="text-[11.5px] text-text-muted">
                {t('admin.exam.doc_read', {
                  chars: doc.text.length.toLocaleString('es-CO'),
                  defaultValue: '{{chars}} caracteres leídos',
                })}
                {doc.contextImages.length > 0 &&
                  ` · ${t('admin.exam.doc_pages', {
                    n: doc.contextImages.length,
                    defaultValue: '{{n}} páginas como imagen',
                  })}`}
              </p>
            </div>
          </div>

          <p className="text-[12.5px] leading-relaxed text-text-muted">
            {t(
              'admin.exam.doc_fidelity',
              'La IA solo puede preguntar por lo que está en este documento: si algo no aparece ahí, no entra al examen. Si el documento no da para tantas preguntas, devolverá menos antes que inventar.',
            )}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
                {t('admin.exam.ai_count', 'Cuántas preguntas')}
              </label>
              <NumberField
                value={count}
                onChange={setCount}
                min={1}
                max={40}
                className={inputCls}
                aria-label={t('admin.exam.ai_count', 'Cuántas preguntas')}
              />
              <p className="mt-1.5 text-[11.5px] text-text-subtle">
                {t('admin.exam.ai_count_hint', 'Máximo 40 por tanda. Puedes pedir varias.')}
              </p>
            </div>
            <AiLevelField
              value={difficulty}
              onChange={setDifficulty}
              target={targetLevel}
              disabled={busy}
            />
          </div>

          {domains.length > 0 && (
            <p className="text-[12px] text-text-muted">
              {t('admin.exam.ai_use_domains_hint', {
                list: domains.map((d) => d.name_es).join(', '),
                defaultValue: 'Repartirá las preguntas entre tus temas: {{list}}',
              })}
            </p>
          )}

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
              {t('admin.exam.ai_instruction', 'Indicación (opcional)')}
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder={t(
                'admin.exam.doc_instruction_ph',
                'Concéntrate en el capítulo de reclamos y en los plazos de respuesta.',
              )}
              className={cn(inputCls, 'resize-y leading-relaxed')}
            />
          </div>

          <AiReviewNotice />

          {!levelOk && isLevelLocked(targetLevel) && (
            <LevelGuard
              title={t('admin.exam.ai_level_blocked_title', 'La IA no puede escribir a ese nivel')}
              body={t('admin.exam.ai_level_blocked_body', {
                level: difficultyLabel(t, targetLevel),
                defaultValue:
                  'Este examen evalúa a nivel {{level}} y no admite preguntas de otro nivel. Usa el nivel del examen, o cámbialo en "Reglas del examen".',
              })}
              actionLabel={t('admin.exam.use_exam_level', {
                level: difficultyLabel(t, targetLevel),
                defaultValue: 'Usar nivel {{level}}',
              })}
              onAction={() => setDifficulty(targetLevel)}
            />
          )}

          <div className="flex items-center justify-end gap-2">
            {busy && (
              <button
                onClick={() => abortRef.current?.abort()}
                className="rounded-full px-4 py-2.5 text-[13.5px] text-text-muted transition-colors hover:text-text"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
            )}
            <button
              onClick={() => void generateFromDoc()}
              disabled={busy || !levelOk}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {busy
                ? t('admin.exam.doc_working', 'Leyendo el documento y escribiendo…')
                : t('admin.exam.doc_run', 'Escribir preguntas del documento')}
            </button>
          </div>
        </>
      )}

      {/* ── Vista previa de lo que escribió la IA ── */}
      {draft && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-text">
              <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} />
              {t('admin.exam.doc_written', {
                n: draft.questions.length,
                defaultValue: 'Escritas desde el documento: {{n}}',
              })}
            </span>
            <button
              onClick={() => {
                const selectable = draft.questions
                  .map((q, i) => (levelFits(targetLevel, q.difficulty ?? 'medio') ? i : -1))
                  .filter((i) => i >= 0)
                setPickedQ(
                  pickedQ.size > 0 ? new Set() : new Set(selectable),
                )
              }}
              className="ml-auto rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-text-muted transition-colors hover:text-text"
            >
              {pickedQ.size > 0
                ? t('admin.exam.select_none', 'Quitar todas')
                : t('admin.exam.select_all', 'Elegir todas')}
            </button>
          </div>

          {isLevelLocked(targetLevel) &&
            draft.questions.some((q) => !levelFits(targetLevel, q.difficulty ?? 'medio')) && (
              <LevelGuard
                title={t('admin.exam.doc_off_level_title', 'Algunas no quedaron al nivel pedido')}
                body={t('admin.exam.doc_off_level_body', {
                  n: draft.questions.filter(
                    (q) => !levelFits(targetLevel, q.difficulty ?? 'medio'),
                  ).length,
                  level: difficultyLabel(t, targetLevel),
                  defaultValue:
                    'La IA escribió {{n}} preguntas que no son de nivel {{level}}: quedan marcadas y no se pueden importar. Si necesitas más, vuelve a generar.',
                })}
              />
            )}

          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {draft.questions.map((q, i) => {
              const fits = levelFits(targetLevel, q.difficulty ?? 'medio')
              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border px-3.5 py-2.5',
                    !fits
                      ? 'border-amber-500/30 bg-amber-500/[0.05]'
                      : pickedQ.has(i)
                        ? 'border-primary/40 bg-primary/[0.04]'
                        : 'border-line',
                  )}
                >
                  {/* Las de otro nivel no se pueden marcar: el examen no las
                      admite, y dejar la casilla viva sería prometer algo que el
                      botón de importar iba a negar. */}
                  <input
                    type="checkbox"
                    checked={pickedQ.has(i)}
                    disabled={!fits}
                    onChange={() => toggleQ(i)}
                    aria-label={q.text_es}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--neon-green))] disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px] text-text', !fits && 'opacity-70')}>
                      {q.text_es}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-text-subtle">
                      {q.domain ? `${q.domain} · ` : ''}
                      {q.options.length} {t('admin.exam.options_short', 'opciones')}
                    </p>
                  </div>
                  <LevelPill level={q.difficulty ?? 'medio'} target={targetLevel} />
                </div>
              )
            })}
          </div>

          <AiReviewNotice />

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setDraft(null)}
              disabled={busy}
              className="rounded-full px-4 py-2.5 text-[13.5px] text-text-muted transition-colors hover:text-text disabled:opacity-50"
            >
              {t('admin.exam.doc_back', 'Volver a generar')}
            </button>
            <button
              onClick={() => void importDraft()}
              disabled={busy || pickedQ.size === 0}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('admin.exam.file_cta', {
                n: pickedQ.size,
                defaultValue: 'Importar {{n}} preguntas',
              })}
            </button>
          </div>
        </>
      )}

      {/* ── Banco ya escrito (Excel/CSV) ── */}
      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-text">
              <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} />
              {t('admin.exam.file_valid', { n: ok.length, defaultValue: 'Válidas: {{n}}' })}
            </span>
            {bad.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('admin.exam.file_invalid', {
                  n: bad.length,
                  defaultValue: 'Con problemas (se omiten): {{n}}',
                })}
              </span>
            )}
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {rows.map((r) => {
              const off = Boolean(r.question) && !r.error && !levelFits(targetLevel, r.question!.difficulty)
              return (
                <div
                  key={r.row}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-[12.5px]',
                    r.error || off ? 'border-amber-500/30 bg-amber-500/[0.05]' : 'border-line',
                  )}
                >
                  <span className="w-8 shrink-0 tabular-nums text-text-subtle">{r.row}</span>
                  <span className="min-w-0 flex-1 text-text">
                    {r.question?.text_es ?? t('admin.exam.file_row_empty', '(fila vacía)')}
                    {r.domainName && (
                      <span className="ml-2 text-text-subtle">· {r.domainName}</span>
                    )}
                  </span>
                  {off && <LevelPill level={r.question!.difficulty} target={targetLevel} />}
                  {r.error && (
                    <span className="shrink-0 text-amber-600">
                      {t(`admin.exam.file_err_${r.error}`, r.error)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {offLevelRows.length > 0 && isLevelLocked(targetLevel) && (
            <LevelGuard
              title={t('admin.exam.file_level_blocked_title', 'El archivo trae otro nivel')}
              body={t('admin.exam.file_level_blocked_body', {
                n: offLevelRows.length,
                level: difficultyLabel(t, targetLevel),
                defaultValue:
                  'La columna "Dificultad" de {{n}} filas no dice {{level}}, que es el nivel de este examen. Corrígelas en el archivo, o márcalas todas como {{level}} si de verdad evalúan a ese nivel.',
              })}
              actionLabel={t('admin.exam.file_fix_level', {
                level: difficultyLabel(t, targetLevel),
                defaultValue: 'Marcar todas como {{level}}',
              })}
              onAction={fixRowsLevel}
            />
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => void importBank()}
              disabled={busy || ok.length === 0 || offLevelRows.length > 0}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('admin.exam.file_cta', {
                n: ok.length,
                defaultValue: 'Importar {{n}} preguntas',
              })}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
