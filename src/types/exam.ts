/**
 * Examen final de certificación + ruta de refuerzo.
 *
 * El modelo es el de una certificación de la industria (Microsoft / Pearson VUE):
 * un banco de preguntas etiquetadas por DOMINIO, un sorteo por peso, un informe
 * por dominio y una ruta de refuerzo obligatoria cuando se reprueba.
 *
 * Tablas y RPC: supabase/sql/2026-08-11_course_exams.sql
 */

export type ExamQuestionKind = 'single' | 'multi' | 'true_false'
export type ExamDifficulty = 'basico' | 'medio' | 'avanzado'
/** Nivel al que evalúa el examen. `mixta` = acepta preguntas de cualquier nivel. */
export type ExamTargetLevel = 'mixta' | ExamDifficulty
export type ExamQuestionSource = 'manual' | 'ai' | 'imported' | 'reused'
export type ExamShowAnswers = 'never' | 'after_fail' | 'after_pass' | 'always'
export type ExamUnlockRule = 'after_modules' | 'from_start' | 'after_module'
export type ExamAttemptStatus = 'in_progress' | 'submitted' | 'expired'

/** Una opción de respuesta. El `id` es estable ("a", "b", …) y es lo que se
 *  guarda como respuesta: barajar las opciones nunca corrompe la clave. */
export interface ExamOption {
  id: string
  text_es: string
  text_en?: string | null
  text_pt?: string | null
}

export interface ExamQuestion {
  id: string
  exam_id: string
  domain_id: string | null
  kind: ExamQuestionKind
  text_es: string
  text_en: string | null
  text_pt: string | null
  options: ExamOption[]
  /** Ids de las opciones correctas. Solo llega al staff (RLS). */
  correct: string[]
  explanation_es: string | null
  explanation_en: string | null
  explanation_pt: string | null
  difficulty: ExamDifficulty
  source: ExamQuestionSource
  source_ref: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

/** Pregunta tal como la recibe el aprendiz: sin `correct` ni explicación. */
export interface ExamQuestionForLearner {
  id: string
  kind: ExamQuestionKind
  domain_id: string | null
  text_es: string
  text_en: string | null
  text_pt: string | null
  options: ExamOption[]
}

export interface ExamDomain {
  id: string
  exam_id: string
  name_es: string
  name_en: string | null
  name_pt: string | null
  description_es: string | null
  description_en: string | null
  description_pt: string | null
  /** % de las preguntas del examen que se sortean de este dominio. */
  weight_pct: number
  /** Mínimo propio del dominio; 0 = usa el del examen. */
  min_score: number
  color: string
  icon: string
  sort_order: number
  /** Módulos que se mandan a repasar si se reprueba el dominio. */
  module_ids?: string[]
  /** Solo lectura: cuántas preguntas activas tiene. */
  question_count?: number
}

export interface CourseExam {
  id: string
  course_id: string
  campaign_id: string | null
  title_es: string
  title_en: string | null
  title_pt: string | null
  description_es: string | null
  description_en: string | null
  description_pt: string | null
  is_published: boolean
  /**
   * Nivel al que evalúa el examen. Es un contrato, no una etiqueta: si no es
   * `mixta`, la IA solo escribe preguntas de ese nivel, los quizzes de módulo
   * de otro nivel no se pueden copiar y no se puede publicar con preguntas
   * fuera de nivel en el banco.
   */
  target_level: ExamTargetLevel
  question_count: number
  pass_score: number
  /** 0 = sin límite de tiempo. */
  time_limit_min: number
  /** 0 = intentos ilimitados. */
  max_attempts: number
  cooldown_hours: number
  shuffle_questions: boolean
  shuffle_options: boolean
  show_answers: ExamShowAnswers
  require_reinforcement: boolean
  lock_after_attempts: boolean
  unlock_rule: ExamUnlockRule
  unlock_module_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Valores por defecto de un examen nuevo (coinciden con el DEFAULT del SQL). */
export const DEFAULT_EXAM: Omit<
  CourseExam,
  'id' | 'course_id' | 'campaign_id' | 'created_by' | 'created_at' | 'updated_at'
> = {
  title_es: 'Examen final de certificación',
  title_en: null,
  title_pt: null,
  description_es: null,
  description_en: null,
  description_pt: null,
  is_published: false,
  target_level: 'mixta',
  question_count: 20,
  pass_score: 80,
  time_limit_min: 45,
  max_attempts: 3,
  cooldown_hours: 24,
  shuffle_questions: true,
  shuffle_options: true,
  show_answers: 'after_pass',
  require_reinforcement: true,
  lock_after_attempts: true,
  unlock_rule: 'after_modules',
  unlock_module_id: null,
}

/** Puntaje de un dominio dentro de un intento. */
export interface ExamDomainScore {
  domain_id: string
  name_es: string
  name_en?: string | null
  name_pt?: string | null
  color: string
  icon: string
  total: number
  correct: number
  pct: number
  passed: boolean
}

/** Ruta de refuerzo pendiente. */
export interface ExamReinforcement {
  id: string
  module_ids: string[]
  done_ids: string[]
  domain_ids: string[]
  created_at: string
}

/** Lo que devuelve `get_exam_state`: todo lo que la pantalla del aprendiz necesita. */
export interface ExamState {
  exam_id: string
  course_id: string
  title_es: string
  title_en: string | null
  title_pt: string | null
  description_es: string | null
  description_en: string | null
  description_pt: string | null
  is_published: boolean
  /** Preguntas que tendrá el intento (ya acotado al tamaño real del banco). */
  question_count: number
  bank_size: number
  pass_score: number
  time_limit_min: number
  max_attempts: number
  cooldown_hours: number
  show_answers: ExamShowAnswers
  require_reinforcement: boolean
  domains: Array<
    Pick<ExamDomain, 'id' | 'name_es' | 'name_en' | 'name_pt' | 'description_es' | 'weight_pct' | 'color' | 'icon'> & {
      question_count: number
    }
  >

  unlocked: boolean
  attempts_used: number
  /** null = ilimitados. */
  attempts_left: number | null
  best_score: number
  passed: boolean
  last_attempt_id: string | null
  last_score: number | null
  last_passed: boolean | null
  last_submitted_at: string | null
  open_attempt_id: string | null
  open_expires_at: string | null
  /** Fecha a partir de la cual se puede reintentar (espera entre intentos). */
  next_attempt_at: string | null
  reinforcement: ExamReinforcement | null
}

/** Intento en curso devuelto por `start_exam_attempt`. */
export interface ExamAttemptSession {
  attempt_id: string
  attempt_no: number
  started_at: string
  expires_at: string | null
  time_limit_min: number
  pass_score: number
  answers: Record<string, string[]>
  flagged: string[]
  questions: ExamQuestionForLearner[]
}

/** Detalle pregunta a pregunta del informe (solo si el examen lo permite). */
export interface ExamAnswerDetail {
  question_id: string
  domain_id: string | null
  kind: ExamQuestionKind
  text_es: string
  text_en: string | null
  text_pt: string | null
  options: ExamOption[]
  given: string[]
  correct: string[]
  ok: boolean
  explanation_es: string | null
  explanation_en: string | null
  explanation_pt: string | null
}

/** Informe de un intento enviado. */
export interface ExamReport {
  attempt_id: string
  score_pct: number
  passed: boolean
  expired?: boolean
  correct?: number
  total: number
  pass_score: number
  domain_scores: ExamDomainScore[]
  show_answers: ExamShowAnswers
  detail: ExamAnswerDetail[]
  submitted_at?: string | null
  time_spent_sec?: number
  attempt_no?: number
}

/** Fila del panel de resultados del capacitador. */
export interface ExamResultRow {
  user_id: string
  display_name: string | null
  email: string | null
  attempts: number
  best_score: number | null
  last_score: number | null
  passed: boolean
  last_at: string | null
  weak_domains: ExamDomainScore[]
  reinforcement: 'pending' | 'completed' | null
}

/** Motivos por los que el examen puede estar cerrado (los devuelve la RPC). */
export type ExamBlockReason =
  | 'locked'
  | 'cooldown'
  | 'no_attempts_left'
  | 'reinforcement_pending'
  | 'already_passed'
  | 'empty_bank'
  | 'not_published'
  | 'no_access'
