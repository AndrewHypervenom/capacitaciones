import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { throwAiError, useAiCreditsStore } from '@/lib/aiCredits'
import { logActivity } from '@/services/audit.service'
import { questionQuotas } from '@/lib/examQuotas'
import { currentAiLang } from '@/lib/aiLang'
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
import type { ContentBlock, QuizBlock, VideoMarkerRaw } from '@/types/blocks'
import { pickLang } from '@/lib/contentLang'

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
    entityLabel: pickLang((data as CourseExam).title_es, (data as CourseExam).title_en, (data as CourseExam).title_pt, 'es'),
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
  // Normalizar a 100 y repartir con el mismo resto mayor que las cuotas.
  return questionQuotas(100, base.map((w) => (Math.max(0, w) * 100) / total))
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

/**
 * Borra preguntas del banco. Siempre por lista, aunque sea una.
 *
 * Existe porque vaciar el banco borraba de una en una: con 107 preguntas eran
 * 107 viajes al servidor en fila, y el guardado se iba a decenas de segundos
 * con la pantalla bloqueada. Un `in` los deja en uno. Se trocea porque la lista
 * de ids viaja en la URL y una lo bastante larga la rechaza el servidor.
 */
export async function deleteExamQuestions(ids: string[]): Promise<void> {
  const CHUNK = 100
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await db
      .from('exam_questions')
      .delete()
      .in('id', ids.slice(i, i + CHUNK))
    if (error) throw error
  }
}

/** Reordena el banco de una sola vez (arrastrar y soltar). */
export async function reorderExamQuestions(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) => db.from('exam_questions').update({ sort_order: i }).eq('id', id)),
  )
}

// ─── Reutilizar los quizzes que ya existen en los módulos ──────────────────

/**
 * Dónde vive exactamente una pregunta reutilizable, para poder volver a ella y
 * escribirle el nivel. Se guarda como dato, no como texto: la clave sintética
 * (`block:<sección>:0`) sirve para identificarla en la pantalla, pero volver a
 * partirla para escribir sería inventar un formato frágil.
 */
export type ReusableLocator =
  | { kind: 'quiz'; quizId: string }
  | { kind: 'block'; sectionId: string; index: number }
  | { kind: 'video'; sectionId: string; markerId: string; index: number }

export interface ReusableQuestion {
  key: string
  /** Dónde está, y por tanto dónde se le guarda el nivel. */
  locator: ReusableLocator
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

/** Una pregunta del curso que NO se puede copiar al examen, y por qué. */
export interface SkippedQuestion {
  moduleTitle: string
  sectionHeading: string
  text_es: string
  /**
   * `few_options` — menos de dos opciones escritas.
   * `blank_answer` — la marcada como correcta está en blanco.
   * `no_text`      — la pregunta no tiene enunciado.
   */
  reason: 'few_options' | 'blank_answer' | 'no_text'
}

/** Lo que hay en los módulos: lo copiable y lo que se quedó fuera. */
export interface ReusableScan {
  items: ReusableQuestion[]
  skipped: SkippedQuestion[]
}

/**
 * Arma las opciones del examen a partir de los tres idiomas del quiz.
 *
 * Las opciones en blanco se caen (un quiz con cuatro huecos y dos escritos son
 * dos opciones, no cuatro), pero eso RENUMERA la lista, y ahí estaba el fallo:
 * se filtraba y se mapeaba de un tirón, así que el índice de después se usaba
 * para leer las traducciones y para localizar la respuesta correcta, que se
 * guardan por la posición ORIGINAL. Resultado: con un hueco en medio, la
 * pregunta entraba al examen con el inglés de otra opción y, peor, con la
 * respuesta correcta cambiada de sitio.
 *
 * Por eso devuelve también `origin`: `origin[i]` es la posición que ocupaba la
 * opción `i` antes de quitar los huecos. Quien sepa cuál era la correcta la
 * traduce con `mapCorrect`.
 */
/** Título/enunciado en el primer idioma con texto (el examen no puede quedar mudo). */
const modTitle = (m: { title_es: string; title_en?: string | null; title_pt?: string | null }) =>
  pickLang(m.title_es, m.title_en, m.title_pt, 'es')
const secHeading = (s: { heading_es: string; heading_en?: string | null; heading_pt?: string | null }) =>
  pickLang(s.heading_es, s.heading_en, s.heading_pt, 'es')
const qText = (q: { question_es: string; question_en?: string | null; question_pt?: string | null }) =>
  pickLang(q.question_es, q.question_en, q.question_pt, 'es')

function toExamOptions(
  es: string[],
  en: (string | null)[] | null | undefined,
  pt: (string | null)[] | null | undefined,
): { options: ExamOption[]; origin: number[] } {
  const options: ExamOption[] = []
  const origin: number[] = []
  // Qué lista manda: la primera que tenga opciones escritas. Recorriendo siempre
  // el español, un quiz escrito en inglés o portugués daba CERO opciones y la
  // pregunta se descartaba con "pocas opciones" sin que nadie entendiera por qué.
  const filled = (a: (string | null)[] | null | undefined) => (a ?? []).filter((t) => (t ?? '').trim()).length
  const ref: (string | null)[] = filled(es) ? es : filled(en) ? (en as (string | null)[]) : filled(pt) ? (pt as (string | null)[]) : (es ?? [])
  ref.forEach((text, i) => {
    if ((text ?? '').trim() === '') return
    options.push({
      id: OPTION_IDS[options.length] ?? `o${options.length}`,
      // El examen siempre tiene que poder pintar algo: si falta el español se
      // usa el texto del idioma de referencia (traducir es decisión aparte).
      text_es: (es?.[i] ?? '').trim() || (text as string),
      text_en: en?.[i] ?? null,
      text_pt: pt?.[i] ?? null,
    })
    origin.push(i)
  })
  return { options, origin }
}

/**
 * La respuesta correcta después de quitar los huecos.
 *
 * `null` = la correcta era una opción vacía. Esa pregunta está rota en el
 * módulo y no se puede copiar: marcar la primera "por si acaso" sería meter en
 * el examen una pregunta con la respuesta equivocada.
 */
function mapCorrect(origin: number[], correctIndex: number): string | null {
  const at = origin.indexOf(correctIndex)
  return at === -1 ? null : (OPTION_IDS[at] ?? `o${at}`)
}

/**
 * Recorre un árbol de bloques y devuelve los `quiz`, en orden de lectura.
 * Entra en las columnas: un quiz metido dentro de una columna sigue siendo una
 * pregunta del curso, y no verlo era justo el motivo de que el panel dijera
 * "este curso no tiene quizzes" teniéndolos.
 */
function collectQuizBlocks(blocks: unknown): QuizBlock[] {
  if (!Array.isArray(blocks)) return []
  const out: QuizBlock[] = []
  for (const b of blocks as ContentBlock[]) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'quiz') out.push(b as QuizBlock)
    else if (b.type === 'columns') {
      for (const col of b.columns ?? []) out.push(...collectQuizBlocks(col?.blocks))
    }
  }
  return out
}

/**
 * Lee TODAS las preguntas que ya existen dentro de los módulos del curso para
 * poder importarlas al examen. Se importan como COPIA: editar la pregunta del
 * examen no toca la del módulo, y al revés (misma regla que la biblioteca de
 * módulos — reutilizar es clonar).
 *
 * Hay tres sitios donde el capacitador puede haber escrito una pregunta, y los
 * tres cuentan:
 *
 *   · `section_quizzes` — la comprobación al final de la sección.
 *   · bloques `quiz` dentro de `blocks_data` — preguntas sueltas en medio del
 *     contenido, que es como las escribe la IA y como quedan al importar un
 *     documento.
 *   · marcadores de video de tipo `quiz` — las que interrumpen el video.
 *
 * Solo las primeras tienen fila propia (`quizId`); las otras se identifican con
 * una clave sintética estable (sección + posición), que es lo que va a
 * `source_ref` para reconocer después lo que ya se copió.
 */
export async function getReusableQuestions(courseId: string): Promise<ReusableScan> {
  const { data: modules, error: mErr } = await supabase
    .from('modules')
    .select('id, title_es, course_sort_order')
    .eq('course_id', courseId)
    .is('deleted_at', null)
    .order('course_sort_order')
  if (mErr) throw mErr
  const mods = (modules ?? []) as { id: string; title_es: string }[]
  if (mods.length === 0) return { items: [], skipped: [] }

  // La ficha de cada sección: liviana a propósito. Aquí NO viaja `blocks_data`,
  // que es el contenido entero del curso (textos, juegos, capítulos de video) y
  // pesa megas en un curso grande.
  const { data: sections, error: sErr } = await supabase
    .from('module_sections')
    .select('id, module_id, heading_es, sort_order')
    .in('module_id', mods.map((m) => m.id))
    .order('sort_order')
  if (sErr) throw sErr
  const secs = (sections ?? []) as {
    id: string; module_id: string; heading_es: string
  }[]
  if (secs.length === 0) return { items: [], skipped: [] }

  /**
   * El contenido, pero SOLO de las secciones que pueden esconder una pregunta.
   *
   * El filtro lo hace el servidor: se piden las que contienen un bloque `quiz`,
   * las que contienen un bloque `columns` (dentro puede haber un quiz anidado,
   * y la contención de jsonb solo mira el primer nivel) y las que tienen un
   * marcador de video. Una sección de puro texto —la mayoría— ya no se baja.
   *
   * Si el servidor no acepta el filtro, se piden todas: más lento, pero nunca
   * se pierde una pregunta por una consulta que no se entendió.
   */
  type ContentRow = { id: string; blocks_data: unknown; video_markers: unknown }
  let content: ContentRow[] = []
  {
    // Se filtra por módulo, no por la lista de ids de sección: esa lista viaja
    // en la URL y con un curso grande se pasa de largo.
    const withContent = () =>
      supabase
        .from('module_sections')
        .select('id, blocks_data, video_markers')
        .in('module_id', mods.map((m) => m.id))
    const { data, error } = await withContent().or(
      'blocks_data.cs.[{"type":"quiz"}],blocks_data.cs.[{"type":"columns"}],video_markers.not.is.null',
    )
    if (error) {
      const all = await withContent()
      if (all.error) throw all.error
      content = (all.data ?? []) as ContentRow[]
    } else {
      content = (data ?? []) as ContentRow[]
    }
  }
  const contentById = new Map(content.map((c) => [c.id, c]))

  const { data: quizzes, error: qErr } = await supabase
    .from('section_quizzes')
    .select('*')
    .in('section_id', secs.map((s) => s.id))
  if (qErr) throw qErr

  const modById = new Map(mods.map((m) => [m.id, m]))
  const secById = new Map(secs.map((s) => [s.id, s]))

  /* Lo que NO se puede copiar, con su motivo. Antes se descartaba en silencio
     con un `continue`, y el capacitador solo veía que el número no cuadraba con
     las preguntas que él sabe que escribió. Una pregunta que desaparece sin
     explicación es peor que una pregunta rota. */
  const skipped: SkippedQuestion[] = []
  const skip = (
    mod: { title_es: string },
    heading: string,
    text: string,
    reason: SkippedQuestion['reason'],
  ) => skipped.push({ moduleTitle: mod.title_es, sectionHeading: heading, text_es: text, reason })

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

  const out: ReusableQuestion[] = []

  // ── 1. Las de `section_quizzes` ──────────────────────────────────────────
  for (const q of (quizzes ?? []) as QuizRow[]) {
    const sec = secById.get(q.section_id)
    const mod = sec ? modById.get(sec.module_id) : null
    if (!sec || !mod) continue
    const { options, origin } = toExamOptions(q.options_es, q.options_en, q.options_pt)
    if (options.length < 2) {
      skip(mod, secHeading(sec), qText(q), 'few_options')
      continue
    }
    const correctId = mapCorrect(origin, q.correct_index)
    if (!correctId) {
      skip(mod, secHeading(sec), qText(q), 'blank_answer')
      continue
    }
    out.push({
      key: q.id,
      locator: { kind: 'quiz', quizId: q.id },
      moduleId: mod.id,
      moduleTitle: modTitle(mod),
      sectionHeading: secHeading(sec),
      text_es: qText(q),
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
    })
  }

  // ── 2. Las que viven dentro del contenido ────────────────────────────────
  for (const sec of secs) {
    const mod = modById.get(sec.module_id)
    // Sin fila de contenido, la sección no tenía nada que buscar: el filtro del
    // servidor ya la descartó.
    const body = contentById.get(sec.id)
    if (!mod || !body) continue

    // 2a. Bloques `quiz`.
    collectQuizBlocks(body.blocks_data).forEach((b, i) => {
      const es = (b.options ?? []).map((o) => o?.text?.es ?? '')
      const { options, origin } = toExamOptions(
        es,
        (b.options ?? []).map((o) => o?.text?.en ?? null),
        (b.options ?? []).map((o) => o?.text?.pt ?? null),
      )
      const enunciado = (b.question?.es ?? '').trim()
      if (!enunciado) {
        skip(mod, secHeading(sec), '', 'no_text')
        return
      }
      if (options.length < 2) {
        skip(mod, secHeading(sec), enunciado, 'few_options')
        return
      }
      const correctId = mapCorrect(origin, b.correct)
      if (!correctId) {
        skip(mod, secHeading(sec), enunciado, 'blank_answer')
        return
      }
      out.push({
        key: `block:${sec.id}:${i}`,
        locator: { kind: 'block', sectionId: sec.id, index: i },
        moduleId: mod.id,
        moduleTitle: modTitle(mod),
        sectionHeading: secHeading(sec),
        text_es: b.question.es,
        text_en: b.question.en || null,
        text_pt: b.question.pt || null,
        options,
        correct: [correctId],
        explanation_es: b.explanation?.es || null,
        explanation_en: b.explanation?.en || null,
        explanation_pt: b.explanation?.pt || null,
        // El nivel que ya se le calculó vive en el propio bloque.
        difficulty: LEVELS.includes(b.difficulty as ExamDifficulty)
          ? (b.difficulty as ExamDifficulty)
          : null,
      })
    })

    // 2b. Preguntas dentro de los marcadores de video.
    const markers = Array.isArray(body.video_markers)
      ? (body.video_markers as VideoMarkerRaw[])
      : []
    for (const m of markers) {
      if (m?.type !== 'quiz') continue
      ;(m.questions ?? []).forEach((q, i) => {
        const { options, origin } = toExamOptions(q.options_es, q.options_en, q.options_pt)
        const enunciado = qText(q)
        if (!enunciado) {
          skip(mod, secHeading(sec), '', 'no_text')
          return
        }
        if (options.length < 2) {
          skip(mod, secHeading(sec), enunciado, 'few_options')
          return
        }
        const correctId = mapCorrect(origin, q.correct)
        if (!correctId) {
          skip(mod, secHeading(sec), enunciado, 'blank_answer')
          return
        }
        out.push({
          key: `video:${sec.id}:${m.id}:${i}`,
          locator: { kind: 'video', sectionId: sec.id, markerId: m.id, index: i },
          moduleId: mod.id,
          moduleTitle: modTitle(mod),
          sectionHeading: secHeading(sec),
          text_es: qText(q),
          text_en: q.question_en || null,
          text_pt: q.question_pt || null,
          options,
          correct: [correctId],
          explanation_es: q.explanation_es || null,
          explanation_en: q.explanation_en || null,
          explanation_pt: q.explanation_pt || null,
          difficulty: LEVELS.includes(q.difficulty as ExamDifficulty)
            ? (q.difficulty as ExamDifficulty)
            : null,
        })
      })
    }
  }

  return { items: out, skipped }
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
  levels: { locator: ReusableLocator; difficulty: ExamDifficulty }[],
): Promise<boolean> {
  if (levels.length === 0) return true

  /* ── 1. Las que tienen fila propia ── */
  const rows = levels.filter(
    (l): l is { locator: { kind: 'quiz'; quizId: string }; difficulty: ExamDifficulty } =>
      l.locator.kind === 'quiz',
  )
  let ok = true
  if (rows.length > 0) {
    const now = new Date().toISOString()
    const results = await Promise.all(
      rows.map((l) =>
        db
          .from('section_quizzes')
          .update({ difficulty: l.difficulty, difficulty_rated_at: now })
          .eq('id', l.locator.quizId),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed) {
      // 42703 = falta la columna. Cualquier otro error sí es un problema real.
      if (failed.error?.code === '42703') ok = false
      else throw failed.error
    }
  }

  /* ── 2. Las que viven dentro del contenido ──
     Van al propio jsonb de la sección, junto a la pregunta. No hace falta
     ninguna columna nueva, y el nivel viaja con el contenido: si el módulo se
     clona o se mueve de curso, se lo lleva puesto.

     Es leer-modificar-escribir sobre `blocks_data`, así que se lee justo antes
     de escribir y solo se toca el campo `difficulty` de la pregunta concreta:
     lo demás vuelve tal como estaba. Aun así, si alguien está editando ese
     módulo en otra pestaña en este mismo instante, gana quien guarde el último
     — es un dato de conveniencia, no una edición del contenido. */
  const bySection = new Map<string, typeof levels>()
  for (const l of levels) {
    if (l.locator.kind === 'quiz') continue
    const arr = bySection.get(l.locator.sectionId) ?? []
    arr.push(l)
    bySection.set(l.locator.sectionId, arr)
  }

  for (const [sectionId, entries] of bySection) {
    const { data, error } = await supabase
      .from('module_sections')
      .select('blocks_data, video_markers')
      .eq('id', sectionId)
      .maybeSingle()
    if (error) throw error
    if (!data) continue

    const blocks = (data as { blocks_data: unknown }).blocks_data
    const markers = (data as { video_markers: unknown }).video_markers
    const quizBlocks = collectQuizBlocks(blocks)
    const markerList = Array.isArray(markers) ? (markers as VideoMarkerRaw[]) : []

    let touchedBlocks = false
    let touchedMarkers = false
    for (const { locator, difficulty } of entries) {
      if (locator.kind === 'block') {
        const b = quizBlocks[locator.index]
        if (!b) continue
        b.difficulty = difficulty
        touchedBlocks = true
      } else if (locator.kind === 'video') {
        const m = markerList.find((x) => x?.id === locator.markerId)
        const q = m?.questions?.[locator.index]
        if (!q) continue
        q.difficulty = difficulty
        touchedMarkers = true
      }
    }
    if (!touchedBlocks && !touchedMarkers) continue

    const patch: Record<string, unknown> = {}
    if (touchedBlocks) patch.blocks_data = blocks
    if (touchedMarkers) patch.video_markers = markers
    const { error: upErr } = await db.from('module_sections').update(patch).eq('id', sectionId)
    if (upErr) throw upErr
  }

  return ok
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
    /**
     * Solo la referencia de verdad: el id de la fila en `section_quizzes`.
     *
     * Las preguntas que viven dentro del contenido usan una clave sintética
     * (`block:<sección>:<posición>`) que NO es un id de nada — la columna la
     * rechaza y el insert entero se va con un 400. Y aunque cupiera, sería una
     * referencia falsa: reordenar los bloques la cambia. Esas van sin
     * referencia y se reconocen por la huella del enunciado, que es la vía que
     * `questionFingerprint` ya cubre para todo lo que entró sin `source_ref`.
     */
    source_ref: r.locator.kind === 'quiz' ? r.locator.quizId : null,
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
    /* El tipo lo manda el nº de correctas, no la columna "tipo": una fila que
       dice "multi" con una sola correcta produce una pregunta que le pide al
       aprendiz "elige 2" sin haber 2. Se normaliza en ambos sentidos. */
    if (kind === 'single' && correct.length > 1) kind = 'multi'
    if (kind === 'multi' && correct.length < 2) kind = 'single'

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
      // El idioma sale de la interfaz: con el sitio en portugués el examen se
      // escribe en portugués aunque el curso o el documento estén en español.
      body: JSON.stringify({ language: currentAiLang(), ...body }),
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
  // La IA devuelve los campos con nombre "*_es" (contrato de la función), pero el
  // texto está en el idioma de la interfaz: se copia también a esa columna para que
  // el aprendiz que ve el sitio en ese idioma no caiga al de respaldo.
  const lang = currentAiLang()
  const forLang = (text: string | null, l: 'en' | 'pt') => (lang === l ? text : null)
  return draft.questions.flatMap((q) => {
    const options: ExamOption[] = q.options.map((text, i) => ({
      id: OPTION_IDS[i] ?? `o${i}`,
      text_es: text,
      text_en: forLang(text, 'en'),
      text_pt: forLang(text, 'pt'),
    }))
    if (options.length < 2) return []
    const correct = q.correct
      .map((i) => options[i]?.id)
      .filter((v): v is string => Boolean(v))
    if (correct.length === 0) return []

    return [{
      domain_id: q.domain ? domainIdByName.get(key(q.domain)) ?? null : null,
      // Misma normalización que al importar: sin 2 correctas no hay "elige 2".
      kind: correct.length > 1 ? 'multi' : q.kind === 'multi' ? 'single' : q.kind,
      text_es: q.text_es,
      text_en: forLang(q.text_es, 'en'),
      text_pt: forLang(q.text_es, 'pt'),
      options,
      correct,
      explanation_es: q.explanation_es || null,
      explanation_en: forLang(q.explanation_es || null, 'en'),
      explanation_pt: forLang(q.explanation_es || null, 'pt'),
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
  /**
   * Preguntas que sorteará de verdad cada intento. La RPC acota el sorteo al
   * tamaño del banco: pedir 20 con 12 escritas son 12, no 20.
   */
  effective: number
  /** Preguntas que le faltan al banco para el examen que se pidió. 0 = alcanza. */
  bankShortfall: number
  /**
   * Cuántas preguntas le tocan a cada tema y cuántas hay escritas, contadas
   * sobre el BORRADOR (lo que se ve en pantalla), no sobre lo último guardado.
   * El reparto se hace sobre `effective`: prometer "5 de 15" cuando solo se
   * sortean 10 es un número que nunca se va a cumplir.
   */
  domainQuotas: { id: string; name: string; have: number; need: number }[]
  /**
   * `true` cuando el intento se lleva el banco entero. Entonces no hay sorteo:
   * entran todas las preguntas escritas, y quien decide la composición del
   * examen es el banco, no los porcentajes.
   */
  drawsWholeBank: boolean
  /** Dominios con peso > 0 pero sin suficientes preguntas para su cuota. */
  thinDomains: { id: string; name: string; have: number; need: number }[]
  /**
   * Con el banco entero en juego, los temas cuya presencia real no es la que
   * prometen sus porcentajes. No se arregla escribiendo "la que falta" (eso
   * agranda el banco y mueve el problema): o se agranda el banco por encima de
   * las preguntas por intento, o se cuadran los % con lo escrito.
   */
  mismatchDomains: { id: string; name: string; have: number; need: number }[]
  /** Preguntas que hay que escribir para que el reparto cuadre. 0 = cuadra. */
  missingTotal: number
  /**
   * Preguntas de "varias respuestas" con menos de 2 correctas. Al aprendiz se
   * le dice "elige 2" y no hay 2 que elegir: es una pregunta que nadie puede
   * acertar. Bloquea publicar, igual que las de nivel equivocado.
   */
  brokenMulti: { id: string; text: string }[]
  /**
   * Qué falta escribir, tema por tema, para llegar al examen que se pidió.
   * Es la lista que se le pasa a la IA para que rellene el hueco exacto en vez
   * de "generar 20 más" y volver a descuadrarlo todo.
   */
  fillPlan: { id: string; name: string; missing: number }[]
  /** Total de `fillPlan` (o el hueco del banco si no hay temas). */
  fillTotal: number
  /**
   * El examen más grande que el banco de hoy sí sostiene sin que ningún tema
   * se quede corto. `0` = ni con una pregunta por intento cuadra (algún tema
   * tiene peso pero cero preguntas escritas).
   */
  fitCount: number
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

  // Cuántas preguntas hay escritas de cada tema, contadas del borrador: es lo
  // único que coincide con lo que el capacitador tiene delante.
  const have = new Map<string, number>()
  for (const q of active) {
    if (q.domain_id) have.set(q.domain_id, (have.get(q.domain_id) ?? 0) + 1)
  }

  const weights = domains.map((d) => d.weight_pct)
  const counts = domains.map((d) => have.get(d.id) ?? 0)

  /* Dos problemas distintos que antes se confundían en uno:

     1. EL BANCO NO ALCANZA (pediste 15, hay 10). El intento sortea 10, punto.
        Se resuelve escribiendo 5 preguntas más o bajando las preguntas por
        intento. Es lo primero que hay que decir, y con el número exacto.

     2. EL REPARTO NO SE CUMPLE. Solo tiene sentido medirlo contra lo que se
        sortea de verdad, no contra lo que se pidió. */
  const effective = Math.min(needed, active.length)
  const bankShortfall = Math.max(0, needed - active.length)

  const quotas = questionQuotas(effective, weights)
  const domainQuotas = domains.map((d, i) => ({
    id: d.id,
    name: pickLang(d.name_es, d.name_en, d.name_pt, 'es'),
    have: counts[i],
    need: quotas[i] ?? 0,
  }))

  /* Cuando el intento se lleva el banco entero no hay sorteo: entran todas.
     Entonces ningún tema puede quedarse "corto" — pero los porcentajes tampoco
     se cumplen, porque la composición la decide lo escrito. Son avisos
     distintos y el segundo NO se arregla escribiendo la pregunta que falta:
     eso agranda el banco y el mismo aviso reaparece con otro tema. */
  const drawsWholeBank = active.length > 0 && effective >= active.length
  const thinDomains = drawsWholeBank ? [] : domainQuotas.filter((d) => d.have < d.need)
  const mismatchDomains = drawsWholeBank
    ? domainQuotas.filter((d) => d.have !== d.need)
    : []
  const missingTotal = thinDomains.reduce((s, d) => s + (d.need - d.have), 0)

  /* Qué falta para el examen que se PIDIÓ (no para el que cabe hoy): las cuotas
     sobre `needed` menos lo escrito. Con 15 pedidas, 10 escritas y el reparto
     25/30/15/15/15 sale "1 de cada tema" — justo las 5 que faltan, y en el
     sitio donde faltan. */
  const wanted = questionQuotas(needed, weights)
  const fillPlan = domains
    .map((d, i) => ({
      id: d.id,
      name: pickLang(d.name_es, d.name_en, d.name_pt, 'es'),
      missing: Math.max(0, (wanted[i] ?? 0) - counts[i]),
    }))
    .filter((d) => d.missing > 0)
  const fillTotal =
    fillPlan.length > 0 ? fillPlan.reduce((s, d) => s + d.missing, 0) : bankShortfall

  // El examen más grande que el banco de hoy aguanta con este reparto.
  let fitCount = 0
  if (thinDomains.length > 0) {
    for (let n = effective - 1; n >= 1; n--) {
      const q = questionQuotas(n, weights)
      if (counts.every((c, i) => c >= (q[i] ?? 0))) {
        fitCount = n
        break
      }
    }
  }

  /* Varias respuestas con una sola correcta: imposible de acertar. */
  const brokenMulti = active
    .filter((q) => q.kind === 'multi' && (q.correct?.length ?? 0) < 2)
    .map((q) => ({ id: q.id, text: q.text_es }))

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
    effective,
    bankShortfall,
    domainQuotas,
    drawsWholeBank,
    thinDomains,
    mismatchDomains,
    missingTotal,
    brokenMulti,
    fillPlan,
    fillTotal,
    fitCount,
    weightSum,
    orphanQuestions: active.filter((q) => !q.domain_id).length,
    offLevel,
    canPublish: active.length > 0 && offLevel.length === 0 && brokenMulti.length === 0,
  }
}
