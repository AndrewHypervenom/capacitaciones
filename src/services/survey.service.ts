import { supabase } from '@/lib/supabase'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

/* ────────────────────────────────────────────────────────────────────────────
   Encuesta de satisfacción del curso

   Es el paso de cierre entre aprobar y ver el certificado. Tres preguntas:

     1. De 0 a 10, quien dictó el curso o —si no hay a quién calificar— el
        contenido y los materiales.
     2. De 0 a 10, la experiencia general.
     3. Ideas, sugerencias y comentarios (abierta).

   Las dos escalas miden cosas distintas a propósito. La primera versión
   preguntaba dos veces "tu satisfacción con la capacitación" y la gente veía
   la misma pregunta repetida: ningún par de variantes puede volver a
   solaparse.

   Y una cuarta condicional —"¿qué pasó?"— que solo aparece si alguna de las
   dos notas cae en el umbral (5 por defecto) y que SIEMPRE es opcional.

   Sobre el cronómetro: lo pidió el negocio y está, pero limita la SESIÓN, no
   el derecho a certificarse. Al vencerse se reintenta con tiempo limpio, sin
   límite de reintentos. Un examen que se vence te reprueba; una encuesta que
   se vence no puede dejar a nadie sin diploma.

   Todo lo que degrada: si el SQL no está corrido, los RPC devuelven 42883 y
   estas funciones responden "no hay encuesta" en vez de reventar la pantalla.
   Mismo patrón que exams.service.ts.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Qué califica la pregunta 1.
 * · `instructor` → a quien dictó el curso (con su nombre y su foto delante).
 * · `campaign`   → el contenido y los materiales, cuando no hay una persona a
 *                  quien calificar. El nombre `campaign` se queda como está
 *                  porque ya vive escrito en la base y en las respuestas
 *                  guardadas; renombrarlo solo agregaría una migración.
 */
export type Q1Mode = 'instructor' | 'campaign'

/**
 * Cómo nombra la pregunta 2 —la experiencia general— a lo que se cursó.
 * · `training` → "esta capacitación": cursos dictados, con sesiones.
 * · `content`  → "este curso": autoservicio, se recorre solo.
 */
export type Q2Mode = 'training' | 'content'

/** Estado de la encuesta para el usuario en sesión en un curso. */
export interface SurveyGate {
  enabled: boolean
  /** Le falta contestarla: hay que llevarlo a la encuesta antes del diploma. */
  needs_survey: boolean
  /** Se la estamos pidiendo a alguien que YA estaba certificado. */
  is_retroactive: boolean
  time_limit_min: number
  followup_enabled: boolean
  followup_threshold: number
  /** Ya viene resuelto: si el curso no tiene instructor, llega `campaign`. */
  q1_mode: Q1Mode
  q2_mode: Q2Mode
  campaign_name: string | null
  instructor_id: string | null
  instructor_name: string | null
  instructor_avatar: string | null
  /** Intento abierto (si volvió después de cerrar la pestaña). */
  open_attempt_id: string | null
  started_at: string | null
  seconds_left: number | null
}

const OFF: SurveyGate = {
  enabled: false,
  needs_survey: false,
  is_retroactive: false,
  time_limit_min: 60,
  followup_enabled: false,
  followup_threshold: 5,
  q1_mode: 'instructor',
  q2_mode: 'training',
  campaign_name: null,
  instructor_id: null,
  instructor_name: null,
  instructor_avatar: null,
  open_attempt_id: null,
  started_at: null,
  seconds_left: null,
}

/** `true` cuando el error es "esa función no existe" (SQL sin correr). */
function isMissingRpc(err: { code?: string } | null): boolean {
  return err?.code === '42883'
}

/**
 * Estado de la encuesta del curso para quien está en sesión.
 *
 * Nunca lanza: si el SQL no está corrido, si la RLS no deja o si la red falla,
 * devuelve la encuesta apagada. El certificado no puede quedar inalcanzable
 * por un fallo de la encuesta — eso convertiría un problema nuestro en un
 * problema de la persona que ya hizo el curso.
 */
export async function getSurveyGate(courseId: string): Promise<SurveyGate> {
  // En la vista previa del capacitador no se pide nada: está mirando su curso,
  // no cursándolo.
  if (IS_LEARNER_PREVIEW) return OFF
  try {
    const { data, error } = await supabase.rpc('get_course_survey_gate', {
      p_course_id: courseId,
    })
    if (error) {
      if (isMissingRpc(error)) return OFF
      throw error
    }
    const g = { ...OFF, ...(data as Partial<SurveyGate> | null) }
    // Mismo saneado que en la configuración: una variante que no reconocemos
    // no puede dejar al aprendiz frente a una pregunta en blanco.
    return {
      ...g,
      q1_mode: g.q1_mode === 'campaign' ? 'campaign' : 'instructor',
      q2_mode: g.q2_mode === 'content' ? 'content' : 'training',
    }
  } catch {
    return OFF
  }
}

export interface SurveyAttempt {
  attempt_id: string
  started_at: string
  seconds_left: number
}

/**
 * Arranca o retoma el intento. Retomar es el caso normal: si cerró la pestaña
 * y volvió, recupera el intento abierto con el reloj corriendo desde donde iba.
 *
 * El tiempo restante lo calcula el servidor contra `started_at`, no el
 * navegador: recargar no regala tiempo y el reloj del equipo no importa.
 */
export async function startSurveyAttempt(courseId: string): Promise<SurveyAttempt> {
  const { data, error } = await supabase.rpc('start_survey_attempt', {
    p_course_id: courseId,
  })
  if (error) throw error
  return data as unknown as SurveyAttempt
}

export interface SurveySubmission {
  attemptId: string
  q1: number
  q2: number
  q3: string
  followup?: string | null
  lang: string
}

/**
 * Envía la respuesta y cierra el intento.
 *
 * `{ expired: true }` no es un error: es "se te acabó el tiempo, vuelve a
 * empezar". El front ofrece Reintentar y nadie pierde el certificado.
 */
export async function submitSurvey(
  s: SurveySubmission,
): Promise<{ ok: boolean; expired?: boolean; already?: boolean }> {
  if (IS_LEARNER_PREVIEW) return { ok: true }
  const { data, error } = await supabase.rpc('submit_survey', {
    p_attempt_id: s.attemptId,
    p_q1: s.q1,
    p_q2: s.q2,
    p_q3: s.q3,
    p_followup: s.followup?.trim() ? s.followup.trim() : null,
    p_lang: s.lang,
  })
  if (error) throw error
  return data as unknown as { ok: boolean; expired?: boolean; already?: boolean }
}

/* ── Configuración (panel) ─────────────────────────────────────────────────── */

export interface SurveyConfig {
  enabled: boolean
  time_limit_min: number
  followup_enabled: boolean
  followup_threshold: number
  repeat_on_recert: boolean
  retroactive: boolean
  q1_mode: Q1Mode
  q2_mode: Q2Mode
  /**
   * Quién dictó el curso, escrito a mano. Es la fuente de verdad de lo que ve
   * el aprendiz.
   *
   * Texto libre y no un desplegable porque muchas capacitaciones las dicta
   * gente de afuera —invitados, proveedores, especialistas— que no tiene
   * cuenta en el sitio. Con una lista cerrada esos cursos se quedaban sin
   * poder nombrar a quien de verdad los dictó.
   */
  instructor_name: string | null
  /**
   * Enlace opcional al perfil de esa persona, cuando sí existe en el sitio.
   * Solo aporta la foto; el nombre siempre sale de `instructor_name`.
   *
   * Deliberadamente separado de `courses.created_by`: de ese campo depende
   * quién puede administrar el curso, así que escribir ahí el instructor le
   * quitaría el curso a su dueño sin avisar. Quien lo administra y quien lo
   * dictó son dos cosas distintas.
   */
  instructor_id: string | null
}

/**
 * Encendida de fábrica. Un curso nuevo pide la encuesta sin que nadie tenga
 * que acordarse de prenderla: si dependiera de un switch olvidado, seis meses
 * después habría cursos enteros sin una sola opinión y nadie sabría por qué.
 * El trigger `course_surveys_seed` crea la fila al nacer el curso para que lo
 * que ve el panel y lo que hace el servidor no se contradigan nunca.
 */
export const DEFAULT_SURVEY_CONFIG: SurveyConfig = {
  enabled: true,
  time_limit_min: 60,
  followup_enabled: true,
  followup_threshold: 5,
  repeat_on_recert: true,
  retroactive: true,
  q1_mode: 'instructor',
  q2_mode: 'training',
  instructor_name: null,
  instructor_id: null,
}

/** Configuración del curso, o los valores por defecto si nunca se guardó. */
export async function getSurveyConfig(courseId: string): Promise<SurveyConfig> {
  const { data, error } = await supabase
    .from('course_surveys')
    .select(
      'enabled, time_limit_min, followup_enabled, followup_threshold, repeat_on_recert, retroactive, q1_mode, q2_mode, instructor_name, instructor_id',
    )
    .eq('course_id', courseId)
    .maybeSingle()
  // 42P01 = la tabla no existe todavía (SQL sin correr). El panel se pinta
  // igual con los valores por defecto en vez de tirar la pestaña entera.
  if (error && error.code !== '42P01') throw error
  if (!data) return DEFAULT_SURVEY_CONFIG
  // Las variantes llegan como `text` de la base. Un valor desconocido (columna
  // recién agregada, fila escrita a mano) cae al de siempre en vez de dejar la
  // pantalla del aprendiz sin pregunta que mostrar.
  return {
    ...DEFAULT_SURVEY_CONFIG,
    ...data,
    q1_mode: data.q1_mode === 'campaign' ? 'campaign' : 'instructor',
    q2_mode: data.q2_mode === 'content' ? 'content' : 'training',
    instructor_name: data.instructor_name ?? null,
    instructor_id: data.instructor_id ?? null,
  }
}

export async function saveSurveyConfig(courseId: string, cfg: SurveyConfig): Promise<void> {
  const { error } = await supabase
    .from('course_surveys')
    .upsert({ course_id: courseId, ...cfg, updated_at: new Date().toISOString() })
  if (error) throw error
}

/**
 * Con qué se rellenan las preguntas en la vista previa del panel: el nombre de
 * la campaña y el del capacitador del curso (si tiene).
 *
 * El panel lo pide por su cuenta en vez de recibirlo por props para no tener
 * que enhebrar dos datos más a través de todo el editor de curso. Es una sola
 * consulta al abrir la pestaña.
 */
export interface CourseInstructorOption {
  id: string
  name: string
  avatar_url: string | null
}

/**
 * A quién se puede elegir como instructor del curso: capacitadores y
 * superadministradores activos.
 *
 * Va por RPC y no leyendo `profiles` desde el front porque un capacitador no
 * necesariamente tiene lectura sobre los perfiles de sus colegas: la lista le
 * saldría vacía y parecería que no hay a quién elegir.
 */
export async function listCourseInstructors(courseId: string): Promise<CourseInstructorOption[]> {
  const { data, error } = await supabase.rpc('get_course_instructor_options', {
    p_course_id: courseId,
  })
  // A propósito NO se traga el error. Una lista vacía y una lista que falló se
  // ven idénticas en un desplegable, y quien lo abre concluye "no hay nadie a
  // quien elegir" cuando en realidad el problema es otro. El panel distingue
  // los dos casos y lo dice.
  if (error) throw error
  return (data as CourseInstructorOption[] | null) ?? []
}

export async function getSurveyContext(
  courseId: string,
): Promise<{ campaignName: string | null; defaultInstructorId: string | null }> {
  // Dos consultas planas en vez de un join anidado: la relación
  // courses→campaigns no está declarada en los tipos generados y el join
  // obligaría a un `as unknown as` que taparía errores de verdad.
  const { data: course, error } = await supabase
    .from('courses')
    .select('created_by, campaign_id')
    .eq('id', courseId)
    .maybeSingle()
  if (error || !course) return { campaignName: null, defaultInstructorId: null }

  const camp = course.campaign_id
    ? await supabase.from('campaigns').select('name').eq('id', course.campaign_id).maybeSingle()
    : { data: null }

  return {
    campaignName: camp.data?.name ?? null,
    defaultInstructorId: course.created_by ?? null,
  }
}

/* ── Resultados (panel) ────────────────────────────────────────────────────── */

export interface SurveyComment {
  at: string
  q1: number
  q2: number
  text: string
  followup: string | null
  lang: string
  /** La contestó después de estar ya certificado: opinión de memoria. */
  retro: boolean
}

export interface SurveyResults {
  total: number
  total_fresh: number
  total_retro: number
  /** Promedios SIN las retroactivas (las de memoria distorsionan). */
  q1_avg: number | null
  q2_avg: number | null
  q1_avg_all: number | null
  q2_avg_all: number | null
  q1_hist: Record<string, number>
  q2_hist: Record<string, number>
  comments: SurveyComment[]
  /** Abrieron la encuesta y no la terminaron. NO es el total de asignados. */
  pending: number
  /**
   * En el histórico conviven respuestas hechas con variantes distintas de las
   * preguntas. El promedio sigue siendo válido pero ya no compara lo mismo, y
   * el panel lo dice en vez de fingir que nada pasó.
   */
  mixed_modes: boolean
}

const EMPTY_RESULTS: SurveyResults = {
  total: 0,
  total_fresh: 0,
  total_retro: 0,
  q1_avg: null,
  q2_avg: null,
  q1_avg_all: null,
  q2_avg_all: null,
  q1_hist: {},
  q2_hist: {},
  comments: [],
  pending: 0,
  mixed_modes: false,
}

/**
 * Resultados agregados. Vienen sin `user_id`: el capacitador ve promedios y
 * comentarios, nunca quién los escribió. Ese anonimato es lo que hace que la
 * gente conteste de verdad en vez de poner 10 en todo.
 */
export async function getSurveyResults(courseId: string): Promise<SurveyResults> {
  try {
    const { data, error } = await supabase.rpc('get_course_survey_results', {
      p_course_id: courseId,
    })
    if (error) {
      if (isMissingRpc(error)) return EMPTY_RESULTS
      throw error
    }
    return { ...EMPTY_RESULTS, ...(data as Partial<SurveyResults> | null) }
  } catch {
    return EMPTY_RESULTS
  }
}

/* ── Utilidades compartidas ────────────────────────────────────────────────── */

/**
 * Claves de traducción de las dos primeras preguntas según la variante.
 *
 * Vive aquí y no en cada pantalla porque la pantalla del aprendiz, la vista
 * previa del panel y los rótulos de los resultados tienen que decir
 * exactamente lo mismo. Si cada uno arma su clave a mano, tarde o temprano una
 * de las tres muestra una pregunta que nadie contestó.
 */
export function surveyQuestionKeys(q1: Q1Mode, q2: Q2Mode): { q1: string; q2: string } {
  return { q1: `survey.q1_${q1}`, q2: `survey.q2_${q2}` }
}

/** Rótulos cortos de las dos escalas en los resultados (mismas variantes). */
export function surveyScoreLabelKeys(q1: Q1Mode, q2: Q2Mode): { q1: string; q2: string } {
  return { q1: `survey.label_q1_${q1}`, q2: `survey.label_q2_${q2}` }
}

/** Clave del borrador local. Por persona y curso: dos cuentas no se pisan. */
export function surveyDraftKey(userId: string, courseId: string): string {
  return `survey-draft:${userId}:${courseId}`
}

/** `mm:ss` para el cronómetro. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
