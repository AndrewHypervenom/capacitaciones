import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { throwAiError, useAiCreditsStore } from '@/lib/aiCredits'
import { logActivity } from '@/services/audit.service'
import {
  DEFAULT_EXAM,
  type CourseExam,
  type ExamDifficulty,
  type ExamDomain,
  type ExamOption,
  type ExamQuestion,
  type ExamQuestionKind,
  type ExamResultRow,
} from '@/types/exam'

/* ────────────────────────────────────────────────────────────────────────────
   Examen final — lado del capacitador / superadmin.

   Todo el CRUD del banco pasa por tabla con RLS `exam_can_manage`: el staff sí
   ve las respuestas correctas (las escribe), el aprendiz no las ve nunca.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Cliente sin el tipado generado para las tablas del examen.
 *
 * El esquema de `src/types/database.ts` no las cubre a propósito: sus columnas
 * jsonb (`options`, `correct`, `domain_scores`) ya están modeladas con tipos
 * reales en `src/types/exam.ts`, y duplicarlas como `Json` obligaría a castear
 * en cada consulta y perdería exactamente la seguridad que buscamos.
 */
const db = supabase as unknown as SupabaseClient

/** Ids de opción estables: nunca cambian aunque se reordene o se traduzca. */
const OPTION_IDS = 'abcdefghij'.split('')

export function newOptionId(existing: ExamOption[]): string {
  const used = new Set(existing.map((o) => o.id))
  return OPTION_IDS.find((id) => !used.has(id)) ?? `o${existing.length + 1}`
}

/** Crea el par de opciones de una pregunta Verdadero/Falso. */
export function trueFalseOptions(): ExamOption[] {
  return [
    { id: 'a', text_es: 'Verdadero', text_en: 'True', text_pt: 'Verdadeiro' },
    { id: 'b', text_es: 'Falso', text_en: 'False', text_pt: 'Falso' },
  ]
}

// ─── Examen ───────────────────────────────────────────────────────────────

/** Examen del curso, o `null` si todavía no se creó. */
export async function getCourseExam(courseId: string): Promise<CourseExam | null> {
  const { data, error } = await db
    .from('course_exams')
    .select('*')
    .eq('course_id', courseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    // 42P01 = tabla inexistente (SQL sin correr). La pestaña debe explicarlo,
    // no romper el editor del curso entero.
    if (error.code === '42P01') return null
    throw error
  }
  if (!data) return null
  // `target_level` es una columna nueva: si el SQL todavía no se corrió, el
  // examen se comporta como "mixta" en vez de romper la pestaña entera.
  const row = data as CourseExam
  return { ...row, target_level: row.target_level ?? 'mixta' }
}

/** Crea el examen del curso con los valores por defecto. */
export async function createCourseExam(
  courseId: string,
  campaignId: string | null,
  patch: Partial<CourseExam> = {},
): Promise<CourseExam> {
  const { data: userData } = await supabase.auth.getUser()
  const { data, error } = await db
    .from('course_exams')
    .insert({
      ...DEFAULT_EXAM,
      ...patch,
      course_id: courseId,
      campaign_id: campaignId,
      created_by: userData.user?.id ?? null,
    })
    .select('*')
    .single()
  if (error) throw error

  await logActivity({
    action: 'insert',
    entityType: 'course_exams',
    entityId: (data as CourseExam).id,
    entityLabel: (data as CourseExam).title_es,
    campaignId,
  }).catch(() => {})

  return data as CourseExam
}

export async function updateCourseExam(
  examId: string,
  patch: Partial<CourseExam>,
): Promise<void> {
  const { error } = await db.from('course_exams').update(patch).eq('id', examId)
  if (!error) return

  // 42703 = columna inexistente. Solo puede ser `target_level` (lo demás lleva
  // meses en la tabla): se guarda el resto y se avisa de que falta el SQL, en
  // vez de perderle al capacitador todos los ajustes por una columna nueva.
  if (error.code === '42703' && 'target_level' in patch) {
    const { target_level: _lvl, ...rest } = patch
    void _lvl
    const retry = await db.from('course_exams').update(rest).eq('id', examId)
    if (retry.error) throw retry.error
    throw new Error('target_level_missing')
  }
  throw error
}

/** Cambia el nivel de varias preguntas de una vez ("ajustar al nivel del examen"). */
export async function setQuestionsDifficulty(
  ids: string[],
  difficulty: ExamDifficulty,
): Promise<void> {
  if (ids.length === 0) return
  const { error } = await db.from('exam_questions').update({ difficulty }).in('id', ids)
  if (error) throw error
}

/**
 * Publica o despublica el examen. Publicar con el banco vacío dejaría a los
 * aprendices frente a una pantalla rota, así que se valida aquí.
 */
export async function setExamPublished(examId: string, published: boolean): Promise<void> {
  if (published) {
    const { count, error } = await db
      .from('exam_questions')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', examId)
      .eq('is_active', true)
    if (error) throw error
    if (!count) throw new Error('empty_bank')
  }
  await updateCourseExam(examId, { is_published: published })
}

/** Borrado suave (el histórico de intentos se conserva). */
export async function deleteCourseExam(examId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  const { error } = await db
    .from('course_exams')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userData.user?.id ?? null,
      is_published: false,
    })
    .eq('id', examId)
  if (error) throw error
}

// ─── Dominios ─────────────────────────────────────────────────────────────

/** Dominios del examen con sus módulos de refuerzo ya resueltos. */
export async function getExamDomains(examId: string): Promise<ExamDomain[]> {
  const { data, error } = await db
    .from('exam_domains')
    .select('*')
    .eq('exam_id', examId)
    .order('sort_order')
  if (error) throw error
  const domains = (data ?? []) as ExamDomain[]
  if (domains.length === 0) return []

  const { data: links } = await db
    .from('exam_domain_modules')
    .select('domain_id, module_id, sort_order')
    .in('domain_id', domains.map((d) => d.id))
    .order('sort_order')

  const byDomain = new Map<string, string[]>()
  for (const l of (links ?? []) as { domain_id: string; module_id: string }[]) {
    const arr = byDomain.get(l.domain_id) ?? []
    arr.push(l.module_id)
    byDomain.set(l.domain_id, arr)
  }

  // Contador de preguntas por dominio (para avisar de dominios vacíos).
  const { data: qs } = await db
    .from('exam_questions')
    .select('domain_id')
    .eq('exam_id', examId)
    .eq('is_active', true)
  const counts = new Map<string, number>()
  for (const q of (qs ?? []) as { domain_id: string | null }[]) {
    if (q.domain_id) counts.set(q.domain_id, (counts.get(q.domain_id) ?? 0) + 1)
  }

  return domains.map((d) => ({
    ...d,
    module_ids: byDomain.get(d.id) ?? [],
    question_count: counts.get(d.id) ?? 0,
  }))
}

export async function createExamDomain(
  examId: string,
  patch: Partial<ExamDomain> & { name_es: string },
): Promise<ExamDomain> {
  const { module_ids, question_count: _count, ...fields } = patch
  void _count
  const { data, error } = await db
    .from('exam_domains')
    .insert({ ...fields, exam_id: examId })
    .select('*')
    .single()
  if (error) throw error
  const domain = data as ExamDomain
  if (module_ids?.length) await setDomainModules(domain.id, module_ids)
  return { ...domain, module_ids: module_ids ?? [] }
}

export async function updateExamDomain(
  domainId: string,
  patch: Partial<ExamDomain>,
): Promise<void> {
  const { module_ids, question_count: _count, id: _id, exam_id: _exam, ...fields } = patch
  void _count; void _id; void _exam
  if (Object.keys(fields).length > 0) {
    const { error } = await db.from('exam_domains').update(fields).eq('id', domainId)
    if (error) throw error
  }
  if (module_ids) await setDomainModules(domainId, module_ids)
}

/** Reparte los pesos de todos los temas de una vez (los repartos asistidos). */
export async function setDomainWeights(
  weights: { id: string; weight_pct: number }[],
): Promise<void> {
  const results = await Promise.all(
    weights.map((w) =>
      db.from('exam_domains').update({ weight_pct: w.weight_pct }).eq('id', w.id),
    ),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

/**
 * Reparte 100 puntos entre `n` partes con el método del resto mayor.
 *
 * Redondear cada parte por su cuenta deja sumas de 99 o 101, que es justo el
 * error que este ayudante viene a evitar. Con `weights` reparte proporcional a
 * ellos; sin `weights`, en partes iguales.
 */
export function split100(n: number, weights?: number[]): number[] {
  if (n <= 0) return []
  const base = weights?.length === n && weights.some((w) => w > 0) ? weights : Array(n).fill(1)
  const total = base.reduce((s, w) => s + Math.max(0, w), 0)
  const exact = base.map((w) => (Math.max(0, w) * 100) / total)
  const floors = exact.map(Math.floor)
  let left = 100 - floors.reduce((s, v) => s + v, 0)
  // Los puntos que sobran van a las partes con mayor resto, de mayor a menor.
  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest)
  const out = [...floors]
  for (const { i } of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

export async function deleteExamDomain(domainId: string): Promise<void> {
  // Las preguntas del dominio NO se borran: quedan sin dominio (ON DELETE SET NULL)
  // y siguen entrando al sorteo general. Borrar un área no debe borrar el trabajo.
  const { error } = await db.from('exam_domains').delete().eq('id', domainId)
  if (error) throw error
}

/** Reemplaza la ruta de refuerzo del dominio (qué módulos repasar si falla). */
export async function setDomainModules(domainId: string, moduleIds: string[]): Promise<void> {
  await db.from('exam_domain_modules').delete().eq('domain_id', domainId)
  if (moduleIds.length === 0) return
  const { error } = await db.from('exam_domain_modules').insert(
    moduleIds.map((module_id, i) => ({ domain_id: domainId, module_id, sort_order: i })),
  )
  if (error) throw error
}

// ─── Preguntas ────────────────────────────────────────────────────────────

export async function getExamQuestions(examId: string): Promise<ExamQuestion[]> {
  const { data, error } = await db
    .from('exam_questions')
    .select('*')
    .eq('exam_id', examId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as ExamQuestion[]
}

export type NewExamQuestion = Omit<
  ExamQuestion,
  'id' | 'exam_id' | 'created_at' | 'is_active' | 'sort_order' | 'source_ref'
> & { sort_order?: number; source_ref?: string | null }

export async function createExamQuestions(
  examId: string,
  questions: NewExamQuestion[],
): Promise<ExamQuestion[]> {
  if (questions.length === 0) return []
  const { data: userData } = await supabase.auth.getUser()
  const { count } = await db
    .from('exam_questions')
    .select('id', { count: 'exact', head: true })
    .eq('exam_id', examId)
  const base = count ?? 0

  const { data, error } = await db
    .from('exam_questions')
    .insert(
      questions.map((q, i) => ({
        ...q,
        exam_id: examId,
        sort_order: q.sort_order ?? base + i,
        created_by: userData.user?.id ?? null,
      })),
    )
    .select('*')
  if (error) throw error
  return (data ?? []) as ExamQuestion[]
}

export async function updateExamQuestion(
  questionId: string,
  patch: Partial<ExamQuestion>,
): Promise<void> {
  const { id: _id, exam_id: _e, created_at: _c, ...fields } = patch
  void _id; void _e; void _c
  const { error } = await db.from('exam_questions').update(fields).eq('id', questionId)
  if (error) throw error
}

export async function deleteExamQuestion(questionId: string): Promise<void> {
  const { error } = await db.from('exam_questions').delete().eq('id', questionId)
  if (error) throw error
}

/** Reordena el banco de una sola vez (arrastrar y soltar). */
export async function reorderExamQuestions(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) => db.from('exam_questions').update({ sort_order: i }).eq('id', id)),
  )
}

// ─── Reutilizar los quizzes que ya existen en los módulos ──────────────────

export interface ReusableQuestion {
  key: string
  moduleId: string
  moduleTitle: string
  sectionHeading: string
  text_es: string
  text_en: string | null
  text_pt: string | null
  options: ExamOption[]
  correct: string[]
  explanation_es: string | null
  explanation_en: string | null
  explanation_pt: string | null
  /** Nivel ya guardado en el quiz. `null` = nadie lo ha calificado todavía. */
  difficulty: ExamDifficulty | null
}

/**
 * Lee los quizzes de sección (KNOWLEDGE_CHECK) de los módulos del curso para
 * poder importarlos al examen. Se importan como COPIA: editar la pregunta del
 * examen no toca el quiz del módulo, y al revés (misma regla que la biblioteca
 * de módulos — reutilizar es clonar).
 */
export async function getReusableQuestions(courseId: string): Promise<ReusableQuestion[]> {
  const { data: modules, error: mErr } = await supabase
    .from('modules')
    .select('id, title_es, course_sort_order')
    .eq('course_id', courseId)
    .is('deleted_at', null)
    .order('course_sort_order')
  if (mErr) throw mErr
  const mods = (modules ?? []) as { id: string; title_es: string }[]
  if (mods.length === 0) return []

  const { data: sections, error: sErr } = await supabase
    .from('module_sections')
    .select('id, module_id, heading_es, sort_order')
    .in('module_id', mods.map((m) => m.id))
    .order('sort_order')
  if (sErr) throw sErr
  const secs = (sections ?? []) as {
    id: string; module_id: string; heading_es: string
  }[]
  if (secs.length === 0) return []

  const { data: quizzes, error: qErr } = await supabase
    .from('section_quizzes')
    .select('*')
    .in('section_id', secs.map((s) => s.id))
  if (qErr) throw qErr

  const modById = new Map(mods.map((m) => [m.id, m]))
  const secById = new Map(secs.map((s) => [s.id, s]))

  type QuizRow = {
    id: string; section_id: string
    question_es: string; question_en: string | null; question_pt: string | null
    options_es: string[]; options_en: string[] | null; options_pt: string[] | null
    correct_index: number
    explanation_es: string | null; explanation_en: string | null; explanation_pt: string | null
    /** Puede no venir: la columna es nueva (ver 2026-08-12_section_quiz_difficulty.sql). */
    difficulty?: string | null
  }
  const LEVELS: ExamDifficulty[] = ['basico', 'medio', 'avanzado']

  return ((quizzes ?? []) as QuizRow[]).flatMap((q) => {
    const sec = secById.get(q.section_id)
    const mod = sec ? modById.get(sec.module_id) : null
    if (!sec || !mod) return []
    const options: ExamOption[] = (q.options_es ?? []).map((text, i) => ({
      id: OPTION_IDS[i] ?? `o${i}`,
      text_es: text,
      text_en: q.options_en?.[i] ?? null,
      text_pt: q.options_pt?.[i] ?? null,
    }))
    if (options.length < 2) return []
    const correctId = options[q.correct_index]?.id ?? options[0].id
    return [{
      key: q.id,
      moduleId: mod.id,
      moduleTitle: mod.title_es,
      sectionHeading: sec.heading_es,
      text_es: q.question_es,
      text_en: q.question_en,
      text_pt: q.question_pt,
      options,
      correct: [correctId],
      explanation_es: q.explanation_es,
      explanation_en: q.explanation_en,
      explanation_pt: q.explanation_pt,
      difficulty: LEVELS.includes(q.difficulty as ExamDifficulty)
        ? (q.difficulty as ExamDifficulty)
        : null,
    }]
  })
}

/**
 * Huella de una pregunta para saber si YA está en el banco.
 *
 * El `source_ref` es la vía fiable, pero no cubre todo: preguntas copiadas a
 * mano, importadas de un Excel o traídas antes de que existiera esa columna
 * quedan sin referencia y volvían a ofrecerse como si fueran nuevas. Comparar
 * también el enunciado normalizado (sin acentos, ni signos, ni mayúsculas, ni
 * dobles espacios) las reconoce igual, y aguanta los retoques de redacción que
 * no cambian la pregunta.
 */
export function questionFingerprint(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Guarda el nivel en el propio quiz de sección, para no volver a pagarle a la
 * IA la misma estimación cada vez que se abre "Reutilizar quizzes" (y para que
 * la corrección que hizo el capacitador a mano no se pierda al cerrar).
 *
 * Devuelve `false` si la columna todavía no existe (falta correr el SQL): el
 * modal sigue funcionando con los niveles en memoria y lo avisa.
 */
export async function saveQuizDifficulties(
  levels: { quizId: string; difficulty: ExamDifficulty }[],
): Promise<boolean> {
  if (levels.length === 0) return true
  const now = new Date().toISOString()
  const results = await Promise.all(
    levels.map((l) =>
      db
        .from('section_quizzes')
        .update({ difficulty: l.difficulty, difficulty_rated_at: now })
        .eq('id', l.quizId),
    ),
  )
  const failed = results.find((r) => r.error)
  if (!failed) return true
  // 42703 = falta la columna. Cualquier otro error sí es un problema real.
  if (failed.error?.code === '42703') return false
  throw failed.error
}

/**
 * Convierte una pregunta reutilizada al formato del banco del examen.
 *
 * La dificultad entra por parámetro porque el examen reparte por nivel: un quiz
 * de sección no la trae, así que o la estima la IA (`classifyDifficulty`) o la
 * elige el capacitador. Sin eso, todo el banco reutilizado caía en "medio" y el
 * sorteo por nivel quedaba desbalanceado.
 */
export function reusableToQuestion(
  r: ReusableQuestion,
  domainId: string | null,
  difficulty: ExamDifficulty = 'medio',
): NewExamQuestion {
  return {
    domain_id: domainId,
    kind: 'single',
    text_es: r.text_es,
    text_en: r.text_en,
    text_pt: r.text_pt,
    options: r.options,
    correct: r.correct,
    explanation_es: r.explanation_es,
    explanation_en: r.explanation_en,
    explanation_pt: r.explanation_pt,
    difficulty,
    source: 'reused',
    source_ref: r.key,
    created_by: null,
    updated_at: new Date().toISOString(),
  } as unknown as NewExamQuestion
}

// ─── Importar desde archivo (Excel / CSV) ─────────────────────────────────

export interface ParsedImportRow {
  row: number
  question: NewExamQuestion | null
  domainName: string | null
  error: string | null
}

/**
 * Interpreta una hoja de cálculo con el banco de preguntas.
 *
 * Columnas reconocidas (sin distinguir mayúsculas ni tildes):
 *   pregunta | dominio | tipo | opcion a..j | correcta | explicacion | dificultad
 *
 * `correcta` acepta "a", "A", "a,c" o "1" (índice 1-based). Se valida fila a
 * fila y se devuelve TODO el resultado, con errores por fila, para que el
 * capacitador vea la vista previa antes de guardar nada (misma filosofía que
 * la carga masiva de usuarios).
 */
export function parseExamSheet(rows: Record<string, unknown>[]): ParsedImportRow[] {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

  const pick = (row: Record<string, unknown>, ...names: string[]): string => {
    for (const key of Object.keys(row)) {
      if (names.includes(norm(key))) return String(row[key] ?? '').trim()
    }
    return ''
  }

  return rows.map((row, i) => {
    const out: ParsedImportRow = { row: i + 2, question: null, domainName: null, error: null }

    const text = pick(row, 'pregunta', 'question', 'enunciado')
    if (!text) {
      out.error = 'sin_pregunta'
      return out
    }

    const options: ExamOption[] = []
    for (const letter of OPTION_IDS) {
      const v = pick(row, `opcion ${letter}`, `opcion_${letter}`, `option ${letter}`, letter)
      if (v) options.push({ id: letter, text_es: v, text_en: null, text_pt: null })
    }

    const rawKind = norm(pick(row, 'tipo', 'kind') || 'single')
    let kind: ExamQuestionKind =
      rawKind.startsWith('multi') ? 'multi'
      : rawKind.startsWith('v') || rawKind.startsWith('true') || rawKind.startsWith('bool')
        ? 'true_false'
        : 'single'

    let opts = options
    if (kind === 'true_false' && opts.length < 2) opts = trueFalseOptions()
    if (opts.length < 2) {
      out.error = 'faltan_opciones'
      return out
    }
    if (kind !== 'true_false' && opts.length < 2) kind = 'single'

    const rawCorrect = pick(row, 'correcta', 'correcta(s)', 'correct', 'respuesta')
    const correct = rawCorrect
      .split(/[,;/ ]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const asIndex = Number(t)
        if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= opts.length) {
          return opts[asIndex - 1].id
        }
        const lower = norm(t)
        // "verdadero"/"falso" en V/F, o la letra de la opción.
        if (kind === 'true_false') {
          if (lower.startsWith('v') || lower.startsWith('t')) return 'a'
          if (lower.startsWith('f')) return 'b'
        }
        const byLetter = opts.find((o) => o.id === lower)
        if (byLetter) return byLetter.id
        const byText = opts.find((o) => norm(o.text_es) === lower)
        return byText?.id ?? ''
      })
      .filter(Boolean)

    if (correct.length === 0) {
      out.error = 'sin_respuesta_correcta'
      return out
    }
    if (kind === 'single' && correct.length > 1) kind = 'multi'

    const rawDiff = norm(pick(row, 'dificultad', 'difficulty'))
    const difficulty: ExamDifficulty =
      rawDiff.startsWith('bas') || rawDiff.startsWith('eas') ? 'basico'
      : rawDiff.startsWith('ava') || rawDiff.startsWith('hard') || rawDiff.startsWith('dif')
        ? 'avanzado'
        : 'medio'

    out.domainName = pick(row, 'dominio', 'domain', 'area', 'área') || null
    out.question = {
      domain_id: null,
      kind,
      text_es: text,
      text_en: null,
      text_pt: null,
      options: opts,
      correct: [...new Set(correct)],
      explanation_es: pick(row, 'explicacion', 'explanation', 'retroalimentacion') || null,
      explanation_en: null,
      explanation_pt: null,
      difficulty,
      source: 'imported',
      source_ref: null,
      created_by: null,
      updated_at: new Date().toISOString(),
    } as unknown as NewExamQuestion
    return out
  })
}

// ─── Fuente del curso para la IA ──────────────────────────────────────────

/**
 * El contenido del curso que la IA puede evaluar vive en `@/lib/courseSource`:
 * baja el TEXTO real de cada sección (párrafos, avisos y bloques), no el
 * índice. Antes aquí se armaba un esqueleto de títulos y objetivos, y con eso
 * el modelo no tenía cómo escribir cuatro opciones sin ponerlas de su cosecha
 * — que es exactamente lo que el capacitador reclamaba.
 */
export { getCourseSource, SOURCE_CHAR_LIMIT, type CourseSource } from '@/lib/courseSource'

// ─── Generar con IA (Claude) ──────────────────────────────────────────────

export interface AiExamDomainDraft {
  name_es: string
  description_es: string
  weight_pct: number
}

export interface AiExamQuestionDraft {
  domain: string | null
  kind: ExamQuestionKind
  text_es: string
  options: string[]
  correct: number[]
  explanation_es: string
  difficulty: ExamDifficulty
}

export interface AiExamDraft {
  domains: AiExamDomainDraft[]
  questions: AiExamQuestionDraft[]
}

export interface GenerateExamOptions {
  courseTitle: string
  /** Resumen del contenido del curso (títulos, objetivos y puntos clave). */
  outline: string
  /** Cuántas preguntas pedir. */
  count: number
  /** Dominios ya definidos por el capacitador; si van vacíos, la IA los propone. */
  domains?: string[]
  difficulty?: 'mixta' | ExamDifficulty
  /** Indicación libre ("enfócate en el proceso de reclamos", "más casos prácticos"). */
  instruction?: string
  signal?: AbortSignal
}

/**
 * Pide a Claude un examen final a partir del contenido real del curso.
 *
 * Solo español: traducir aquí costaba plata en preguntas que casi siempre se
 * editan después. En/pt se piden luego con "Traducir" (misma decisión que en
 * la generación de módulos).
 */
export async function generateExamWithAi(
  opts: GenerateExamOptions,
): Promise<{ data: AiExamDraft; usage: unknown }> {
  const { signal, ...body } = opts
  const result = await callGenerateExam({ ...body, mode: 'generate' }, signal)
  return { data: result.data as AiExamDraft, usage: result.usage }
}

/** Imagen de una página del documento, tal como la devuelve `documentExtract`. */
export interface ExamDocImage {
  mediaType: string
  dataBase64: string
}

export interface GenerateExamFromDocumentOptions {
  courseTitle: string
  documentName: string
  /** Texto ya extraído en el navegador (Word, PDF, PowerPoint, Excel, texto). */
  documentText: string
  /** Páginas rasterizadas: solo para documentos sin texto legible (escaneados). */
  images?: ExamDocImage[]
  count: number
  domains?: string[]
  difficulty?: 'mixta' | ExamDifficulty
  instruction?: string
  signal?: AbortSignal
}

/**
 * Escribe preguntas leyendo SOLO el documento que subió el capacitador.
 *
 * Misma vía que "generar un módulo desde un documento": el navegador extrae el
 * texto (y, si el PDF viene escaneado, las páginas como imagen) y el modelo
 * trabaja con esa fuente cerrada. No es conocimiento general del modelo: si no
 * está en el documento, no puede aparecer en el examen.
 */
export async function generateExamFromDocument(
  opts: GenerateExamFromDocumentOptions,
): Promise<{ data: AiExamDraft; usage: unknown }> {
  const { signal, ...body } = opts
  const result = await callGenerateExam({ ...body, mode: 'document' }, signal)
  return { data: result.data as AiExamDraft, usage: result.usage }
}

/**
 * Estima con IA el nivel (básico/medio/avanzado) de preguntas ya escritas.
 *
 * Se usa al reutilizar los quizzes de los módulos: vienen sin dificultad y el
 * examen reparte por nivel. Devuelve un arreglo alineado por índice con el que
 * se mandó.
 */
export async function classifyQuestionDifficulty(
  courseTitle: string,
  items: { text: string; options: string[]; correct: number[] }[],
  signal?: AbortSignal,
): Promise<ExamDifficulty[]> {
  if (items.length === 0) return []
  const result = await callGenerateExam({ mode: 'classify', courseTitle, items }, signal)
  const out = (result.data as { difficulties?: string[] }).difficulties ?? []
  const levels: ExamDifficulty[] = ['basico', 'medio', 'avanzado']
  return items.map((_, i) =>
    levels.includes(out[i] as ExamDifficulty) ? (out[i] as ExamDifficulty) : 'medio',
  )
}

/** Llamada cruda a la Edge Function, con los errores ya traducidos a español. */
async function callGenerateExam(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: unknown; usage: unknown }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-exam`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal,
    },
  )

  if (response.status === 546 || response.status === 502 || response.status === 504) {
    throw new Error(
      'La generación tardó demasiado y el servidor cortó la conexión. Pide menos preguntas de una vez.',
    )
  }
  if (response.status === 503) {
    throw new Error('El servicio de generación no está disponible (la función no arrancó).')
  }

  const result = await response
    .json()
    .catch(() => ({ error: `Error del servidor (${response.status})` }))
  if (!response.ok || result.error) throwAiError(result.error ?? 'Error generando el examen')
  useAiCreditsStore.getState().markOk()

  return { data: result.data, usage: result.usage }
}

/** Convierte el borrador de la IA en preguntas del banco, ligadas a sus dominios. */
export function aiDraftToQuestions(
  draft: AiExamDraft,
  domainIdByName: Map<string, string>,
): NewExamQuestion[] {
  const key = (s: string) => s.toLowerCase().trim()
  return draft.questions.flatMap((q) => {
    const options: ExamOption[] = q.options.map((text, i) => ({
      id: OPTION_IDS[i] ?? `o${i}`,
      text_es: text,
      text_en: null,
      text_pt: null,
    }))
    if (options.length < 2) return []
    const correct = q.correct
      .map((i) => options[i]?.id)
      .filter((v): v is string => Boolean(v))
    if (correct.length === 0) return []

    return [{
      domain_id: q.domain ? domainIdByName.get(key(q.domain)) ?? null : null,
      kind: correct.length > 1 ? 'multi' : q.kind,
      text_es: q.text_es,
      text_en: null,
      text_pt: null,
      options,
      correct,
      explanation_es: q.explanation_es || null,
      explanation_en: null,
      explanation_pt: null,
      difficulty: q.difficulty ?? 'medio',
      source: 'ai',
      source_ref: null,
      created_by: null,
      updated_at: new Date().toISOString(),
    } as unknown as NewExamQuestion]
  })
}

// ─── Resultados (panel del capacitador) ───────────────────────────────────

export async function getExamResults(courseId: string): Promise<ExamResultRow[]> {
  const { data, error } = await supabase.rpc('get_exam_results', { p_course_id: courseId })
  if (error) {
    if (error.code === '42883') return []
    throw error
  }
  return (data ?? []) as unknown as ExamResultRow[]
}

/** Concede intentos extra a alguien que los agotó (y levanta su refuerzo). */
export async function grantExamAttempt(
  courseId: string,
  userId: string,
  extra = 1,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('grant_exam_attempt', {
    p_course_id: courseId,
    p_user_id: userId,
    p_extra: extra,
    p_reason: reason ?? null,
  })
  if (error) throw error

  await logActivity({
    action: 'update',
    entityType: 'exam_unlocks',
    entityId: userId,
    entityLabel: reason ?? null,
    detail: { course_id: courseId, extra },
  }).catch(() => {})
}

// ─── Validación del examen antes de publicar ──────────────────────────────

export interface ExamHealth {
  bank: number
  needed: number
  /** Dominios con peso > 0 pero sin suficientes preguntas para su cuota. */
  thinDomains: { id: string; name: string; have: number; need: number }[]
  weightSum: number
  /** Preguntas sin dominio (no entran en el informe por área). */
  orphanQuestions: number
  /**
   * Preguntas activas cuyo nivel no es el del examen. Con el examen en un nivel
   * fijo, publicar con estas dentro sería vender un examen avanzado y evaluar
   * con preguntas básicas: por eso bloquean la publicación.
   */
  offLevel: { id: string; text: string; difficulty: ExamDifficulty }[]
  canPublish: boolean
}

/**
 * Revisa el examen y devuelve TODO lo que está mal de una vez, en vez de
 * fallar al publicar con un solo error. Es lo que alimenta el semáforo del
 * constructor.
 */
export function checkExamHealth(
  exam: CourseExam,
  domains: ExamDomain[],
  questions: ExamQuestion[],
): ExamHealth {
  const active = questions.filter((q) => q.is_active)
  const needed = exam.question_count
  const weightSum = domains.reduce((s, d) => s + d.weight_pct, 0)

  const thinDomains = domains
    .filter((d) => d.weight_pct > 0)
    .map((d) => {
      const have = active.filter((q) => q.domain_id === d.id).length
      const need = Math.round((needed * d.weight_pct) / 100)
      return { id: d.id, name: d.name_es, have, need }
    })
    .filter((d) => d.have < d.need)

  const target = exam.target_level ?? 'mixta'
  const offLevel =
    target === 'mixta'
      ? []
      : active
          .filter((q) => q.difficulty !== target)
          .map((q) => ({ id: q.id, text: q.text_es, difficulty: q.difficulty }))

  return {
    bank: active.length,
    needed,
    thinDomains,
    weightSum,
    orphanQuestions: active.filter((q) => !q.domain_id).length,
    offLevel,
    canPublish: active.length > 0 && offLevel.length === 0,
  }
}
