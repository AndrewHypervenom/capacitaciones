import { supabase } from '@/lib/supabase'
import { pickLang } from '@/lib/contentLang'
import type {
  ExamAttemptSession,
  ExamBlockReason,
  ExamReport,
  ExamState,
} from '@/types/exam'

/* ────────────────────────────────────────────────────────────────────────────
   Examen final — lado del aprendiz.

   Todo pasa por RPC SECURITY DEFINER: el cliente NUNCA lee `exam_questions`
   (la RLS se lo impide) y por lo tanto no puede sacarse la clave de respuestas
   inspeccionando la red. La calificación también es del servidor.
   ──────────────────────────────────────────────────────────────────────────── */

/** Error de negocio del examen (bloqueado, sin intentos, en espera, …). */
export class ExamBlockedError extends Error {
  constructor(public reason: ExamBlockReason) {
    super(reason)
    this.name = 'ExamBlockedError'
  }
}

const BLOCK_REASONS: ExamBlockReason[] = [
  'locked',
  'cooldown',
  'no_attempts_left',
  'reinforcement_pending',
  'already_passed',
  'empty_bank',
  'not_published',
  'no_access',
]

/** Alias de los `RAISE EXCEPTION` del SQL que no se llaman igual que el motivo. */
const REASON_ALIASES: Record<string, ExamBlockReason> = {
  exam_not_available: 'not_published',
  no_auth: 'no_access',
}

/**
 * Traduce el `RAISE EXCEPTION 'cooldown'` de Postgres a un error tipado.
 *
 * Si el mensaje NO es uno de los motivos de negocio es un fallo real del SQL:
 * se deja rastro en consola, porque si no el aprendiz ve "no se pudo abrir el
 * examen" y no queda ninguna pista de qué reventó.
 */
function toExamError(message: string): Error {
  const alias = Object.keys(REASON_ALIASES).find((k) => message.includes(k))
  if (alias) return new ExamBlockedError(REASON_ALIASES[alias])

  const hit = BLOCK_REASONS.find((r) => message.includes(r))
  if (hit) return new ExamBlockedError(hit)

  console.error('[exam] la RPC falló con un error inesperado:', message)
  return new Error(message)
}

/**
 * Estado completo del examen de un curso para el usuario actual: reglas,
 * dominios, intentos usados, mejor puntaje, espera pendiente y ruta de refuerzo.
 * Devuelve `null` si el curso no tiene examen (o no está publicado).
 */
export async function getExamState(courseId: string): Promise<ExamState | null> {
  const { data, error } = await supabase.rpc('get_exam_state', { p_course_id: courseId })
  if (error) {
    // 42883 = RPC inexistente (SQL sin correr todavía). La página del curso
    // debe seguir funcionando sin examen, no reventar.
    if (error.code === '42883') return null
    throw error
  }
  return (data as ExamState | null) ?? null
}

/**
 * Abre (o retoma) un intento. Devuelve las preguntas ya sorteadas y barajadas,
 * sin la respuesta correcta.
 *
 * Si el examen está cerrado lanza `ExamBlockedError` con el motivo exacto, que
 * es lo que la pantalla usa para explicar POR QUÉ no puede entrar.
 */
export async function startExamAttempt(courseId: string): Promise<ExamAttemptSession> {
  const { data, error } = await supabase.rpc('start_exam_attempt', { p_course_id: courseId })
  if (error) throw toExamError(error.message)
  return data as unknown as ExamAttemptSession
}

/**
 * Autoguardado del examen en curso. Es best-effort a propósito: si falla la red
 * el aprendiz sigue respondiendo con su estado local y el envío final manda
 * todas las respuestas de nuevo.
 */
export async function saveExamProgress(
  attemptId: string,
  answers: Record<string, string[]>,
  flagged: string[],
): Promise<void> {
  const { error } = await supabase.rpc('save_exam_progress', {
    p_attempt_id: attemptId,
    p_answers: answers,
    p_flagged: flagged,
  })
  if (error) {
    // No-fatal: el envío final es el que manda.
    console.warn('[exam] autoguardado falló', error.message)
  }
}

/** Envía el intento. La nota, el aprobado y el desglose por dominio los calcula el servidor. */
export async function submitExamAttempt(
  attemptId: string,
  answers: Record<string, string[]>,
): Promise<ExamReport> {
  const { data, error } = await supabase.rpc('submit_exam_attempt', {
    p_attempt_id: attemptId,
    p_answers: answers,
  })
  if (error) throw toExamError(error.message)
  return data as unknown as ExamReport
}

/** Vuelve a abrir el informe de un intento ya enviado. */
export async function getExamAttemptReport(attemptId: string): Promise<ExamReport | null> {
  const { data, error } = await supabase.rpc('get_exam_attempt_report', {
    p_attempt_id: attemptId,
  })
  if (error) throw error
  return (data as ExamReport | null) ?? null
}

/**
 * Marca un módulo de la ruta de refuerzo como repasado. Cuando se completan
 * todos, la ruta se cierra sola y el reintento queda habilitado.
 */
export async function markReinforcementModule(
  reinforcementId: string,
  moduleId: string,
): Promise<{ status: 'pending' | 'completed'; done_ids: string[] }> {
  const { data, error } = await supabase.rpc('mark_reinforcement_module', {
    p_reinforcement_id: reinforcementId,
    p_module_id: moduleId,
  })
  if (error) throw error
  return data as unknown as { status: 'pending' | 'completed'; done_ids: string[] }
}

/** Estado del examen como requisito del certificado (para /certificate y el curso). */
export interface ExamGate {
  require_exam: boolean
  exam_min_score: number
  exam_exists: boolean
  exam_best: number
  exam_passed: boolean
  exam_ok: boolean
}

export async function getCourseExamGate(
  courseId: string,
  userId?: string | null,
): Promise<ExamGate | null> {
  const { data, error } = await supabase.rpc('get_course_exam_gate', {
    p_course_id: courseId,
    p_user_id: userId ?? null,
  })
  if (error) {
    if (error.code === '42883') return null
    throw error
  }
  return (data as ExamGate | null) ?? null
}

/* ── Utilidades compartidas por las pantallas ──────────────────────────────── */

/** Texto multilingüe con caída a español (misma regla que el resto del sitio). */
export function pickExamText(
  es: string | null | undefined,
  en: string | null | undefined,
  pt: string | null | undefined,
  lang: string,
): string {
  return pickLang(es, en, pt, lang)
}

/** Segundos restantes de un intento con tiempo límite (0 si ya venció). */
export function secondsLeft(expiresAt: string | null | undefined): number {
  if (!expiresAt) return Infinity
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
}

/** "12:04" / "1:05:22" — el reloj del examen. */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec)) return '--:--'
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`
}

/**
 * Cuántas respuestas correctas tiene cada pregunta del intento.
 *
 * Es lo que convierte una pregunta de varias respuestas en una pregunta
 * contestable: como en las certificaciones de la industria, el enunciado dice
 * "elige dos" y la pantalla no deja marcar una tercera. El número de correctas
 * NO es la clave — no dice cuáles son — así que enseñarlo no filtra nada.
 *
 * Si la RPC todavía no está corrida (42883) devuelve `null` y la pantalla
 * degrada al aviso genérico de siempre: el examen nunca se cae por esto.
 */
export async function getExamAnswerCounts(
  attemptId: string,
): Promise<Record<string, number> | null> {
  const { data, error } = await supabase.rpc('get_exam_answer_counts', {
    p_attempt_id: attemptId,
  })
  if (error) {
    if (error.code === '42883') return null
    console.warn('[exam] no se pudo leer el nº de correctas:', error.message)
    return null
  }
  return (data as Record<string, number> | null) ?? null
}
