import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { DRIVING_ICON, type RoadQuestion } from '@/components/games/drivingModel'
import { generateExamWithAi, getCourseSource } from '@/services/exams.admin.service'
import { requestDeletion } from '@/services/audit.service'

/**
 * Rutas por niveles del juego de autos: un curso tiene hasta tres juegos
 * (básico, medio y avanzado) en `arena_quizzes` con `course_id` y `level`.
 * Un nivel se desbloquea al superar el anterior; el resultado vive en
 * `arena_progress` (completed = superado), sin XP: sigue siendo práctica.
 */
export type DrivingLevel = 'basico' | 'medio' | 'avanzado'
export const LEVELS: DrivingLevel[] = ['basico', 'medio', 'avanzado']
export const LEVEL_LABEL: Record<DrivingLevel, string> = { basico: 'Básico', medio: 'Medio', avanzado: 'Avanzado' }
/** Porcentaje de aciertos para superar un nivel cuando el juego no define `min_score_pct`. */
export const DEFAULT_PASS_PCT = 70

export interface LevelGame { id: string; course_id: string | null; level: string | null; status: string }

export const isLevel = (value: unknown): value is DrivingLevel => LEVELS.includes(value as DrivingLevel)

/** Juegos de la misma ruta, en orden de nivel (solo los que tienen nivel). */
export function routeOf<G extends LevelGame>(games: G[], courseId: string): G[] {
  return games
    .filter(g => g.course_id === courseId && isLevel(g.level))
    .sort((a, b) => LEVELS.indexOf(a.level as DrivingLevel) - LEVELS.indexOf(b.level as DrivingLevel))
}

/**
 * Qué juegos puede abrir el aprendiz. Los sueltos (sin ruta) siempre; en una
 * ruta, el primer nivel publicado y cada uno cuyo anterior publicado ya superó.
 */
export function unlockedIds(games: LevelGame[], passed: Set<string>): Set<string> {
  const open = new Set<string>()
  const courses = new Set<string>()
  for (const g of games) {
    if (g.course_id && isLevel(g.level)) courses.add(g.course_id)
    else open.add(g.id)
  }
  for (const course of courses) {
    const route = routeOf(games.filter(g => g.status === 'published'), course)
    route.forEach((g, i) => { if (i === 0 || passed.has(route[i - 1].id)) open.add(g.id) })
  }
  return open
}

/** Ids de los juegos que el usuario ya superó. */
export async function passedGames(userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabase.from('arena_progress').select('quiz_id').eq('user_id', userId).eq('completed', true).in('quiz_id', ids)
  if (error) throw error
  return new Set((data ?? []).map(r => r.quiz_id))
}

/**
 * Guarda el resultado de una partida. Nunca empeora lo ya logrado: un nivel
 * superado sigue superado aunque la siguiente partida salga peor.
 */
export async function saveDrivingResult(opts: { userId: string; quizId: string; campaignId: string | null; score: number; total: number; passed: boolean }) {
  const { data: previous } = await supabase.from('arena_progress').select('score, completed, completed_at').eq('user_id', opts.userId).eq('quiz_id', opts.quizId).maybeSingle()
  const completed = !!previous?.completed || opts.passed
  const { error } = await supabase.from('arena_progress').upsert({
    user_id: opts.userId, quiz_id: opts.quizId, campaign_id: opts.campaignId,
    xp_earned: 0, score: Math.max(previous?.score ?? 0, opts.score), total_questions: opts.total,
    completed, completed_at: previous?.completed_at ?? (opts.passed ? new Date().toISOString() : null),
  }, { onConflict: 'user_id,quiz_id' })
  if (error) throw error
}

const GAME_RULES: Record<DrivingLevel, string> = {
  basico: 'Nivel básico: reconocer conceptos, pasos y reglas clave del curso.',
  medio: 'Nivel medio: aplicar lo aprendido a situaciones concretas del trabajo.',
  avanzado: 'Nivel avanzado: decidir en casos complejos, con excepciones o prioridades, entre opciones defendibles.',
}

/**
 * Pide a la IA las preguntas de un nivel y las convierte en semáforos. Usa la
 * misma función que los exámenes (contenido real del curso, sin inventar) y
 * descarta lo que el juego no admite: solo vale una respuesta correcta.
 */
export async function generateLevelQuestions(opts: {
  courseTitle: string; outline: string; level: DrivingLevel; count: number
  avoid: string[]; instruction?: string; signal?: AbortSignal
}): Promise<RoadQuestion[]> {
  const avoid = opts.avoid.length ? '\nNo repitas ni reformules estas preguntas de otros niveles:\n' + opts.avoid.map(q => '- ' + q.slice(0, 160)).join('\n') : ''
  const instruction = [
    'Son preguntas para un juego de conducción: cada una se lee en un panel pequeño junto a un semáforo.',
    'Todas "kind": "single" con 4 opciones y exactamente una correcta. Enunciados de máximo 220 caracteres y opciones cortas.',
    GAME_RULES[opts.level],
    'Cada "explanation_es" es para alguien que está aprendiendo: 2 o 3 frases completas en lenguaje cotidiano, sin fórmulas, flechas ni abreviaturas (nada de "de + os = dos").',
    'Primero di cuál es la respuesta correcta y qué significa; luego explica por qué, con un ejemplo corto.',
    'Si el curso enseña un idioma, pon la traducción entre paréntesis de cada palabra o frase en ese idioma, en las preguntas, las opciones y la explicación. Ejemplo: "Usamos «dos» (de los) porque «de» + «os» se juntan en una sola palabra: «o livro dos alunos» (el libro de los alumnos)."',
    opts.instruction?.trim() ?? '',
  ].filter(Boolean).join(' ') + avoid
  const { data } = await generateExamWithAi({
    courseTitle: opts.courseTitle, outline: opts.outline, count: opts.count,
    difficulty: opts.level, instruction, signal: opts.signal,
  })
  return data.questions
    .filter(q => q.text_es?.trim() && q.correct.length === 1 && q.options.length >= 2 && q.options.every(o => o?.trim()))
    .map(q => ({
      id: crypto.randomUUID(),
      question: q.text_es.trim(),
      context: '',
      options: q.options.slice(0, 4).map((text, i) => ({
        id: crypto.randomUUID(), text: text.trim(), correct: q.correct[0] === i,
        explanation: q.correct[0] === i ? q.explanation_es?.trim() ?? '' : '',
      })),
    }))
    .filter(q => q.options.some(o => o.correct))
}

/**
 * Borra juegos (uno o una ruta entera) por la vía común del proyecto: el RPC
 * `request_deletion` los oculta y los deja 30 días en la papelera del
 * superadmin, desde donde se pueden restaurar. El índice único ignora los
 * borrados, así que el nivel se puede volver a crear enseguida.
 */
export async function deleteGames(ids: string[]) {
  for (const id of ids) await requestDeletion('arena_quizzes', id)
}

export interface CourseOption { id: string; title_es: string; campaign_id: string | null }

export async function listCourses(): Promise<CourseOption[]> {
  const { data, error } = await supabase.from('courses').select('id, title_es, campaign_id').is('deleted_at', null).order('title_es')
  if (error) throw error
  return (data ?? []) as CourseOption[]
}

/**
 * Crea (o rehace) la ruta de un curso: un borrador por nivel pedido. Los
 * niveles que ya existen se reemplazan en su misma fila y vuelven a borrador,
 * para que nada generado llegue al aprendiz sin revisión.
 */
export async function createCourseRoute(opts: {
  course: CourseOption; levels: DrivingLevel[]; count: number; instruction?: string
  campaignId: string | null; signal?: AbortSignal
  onProgress: (level: DrivingLevel, index: number) => void
}): Promise<number> {
  const source = await getCourseSource(opts.course.id)
  if (!source.text.trim()) throw new Error('Este curso todavía no tiene contenido en sus módulos: la IA no tendría de dónde sacar preguntas.')
  const { data: existing, error } = await supabase.from('arena_quizzes').select('id, level, steps').eq('course_id', opts.course.id).eq('theme_icon', DRIVING_ICON).is('deleted_at', null)
  if (error) throw error
  const byLevel = new Map((existing ?? []).map(g => [g.level, g]))
  // Lo que ya tienen los niveles que no se rehacen tampoco debe repetirse.
  const avoid = (existing ?? []).filter(g => !opts.levels.includes(g.level as DrivingLevel))
    .flatMap(g => (Array.isArray(g.steps) ? g.steps as unknown as RoadQuestion[] : []).map(s => s.question))
  let created = 0
  for (const [i, level] of opts.levels.entries()) {
    opts.onProgress(level, i)
    const steps = await generateLevelQuestions({ courseTitle: opts.course.title_es, outline: source.text, level, count: opts.count, avoid, instruction: opts.instruction, signal: opts.signal })
    if (steps.length === 0) throw new Error('La IA no devolvió preguntas válidas para el nivel ' + LEVEL_LABEL[level] + '. Intenta de nuevo.')
    avoid.push(...steps.map(s => s.question))
    const payload = {
      title: opts.course.title_es + ' · ' + LEVEL_LABEL[level],
      description: GAME_RULES[level],
      steps: steps as unknown as Json, status: 'draft', min_score_pct: DEFAULT_PASS_PCT,
    }
    const current = byLevel.get(level)
    const { error: failure } = current
      ? await supabase.from('arena_quizzes').update(payload).eq('id', current.id)
      : await supabase.from('arena_quizzes').insert({
          ...payload, course_id: opts.course.id, level, world_id: null,
          campaign_id: opts.course.campaign_id ?? opts.campaignId,
          theme_icon: DRIVING_ICON, theme_type: 'corporate', theme_color: '#10D451', xp_per_question: 10, section_size: 1,
        })
    if (failure) throw failure
    created++
  }
  return created
}
