import { supabase } from '@/lib/supabase'
import type {
  CourseCertStatus,
  Certification,
  CourseEvaluationResult,
  PublicCertificate,
  SimulatorAttemptRow,
} from '@/types/database'

// ─── Intentos del simulador ──────────────────────────────────────────────

export interface NewSimulatorAttempt {
  courseId: string | null
  campaignId: string | null
  scenarioSlug: string
  score: number
  checklistPct: number
  empathyPct: number
  resolved: boolean
  durationSec: number
}

/** Persiste un intento del simulador en BD (auditable, visible al capacitador). */
export async function saveSimulatorAttempt(userId: string, a: NewSimulatorAttempt): Promise<void> {
  const { error } = await supabase.from('simulator_attempts').insert({
    user_id: userId,
    course_id: a.courseId,
    campaign_id: a.campaignId,
    scenario_slug: a.scenarioSlug,
    score: Math.round(a.score),
    checklist_pct: Math.round(a.checklistPct * 100),
    empathy_pct: Math.round(a.empathyPct * 100),
    resolved: a.resolved,
    duration_sec: Math.round(a.durationSec),
  })
  if (error) throw error
}

/** Intentos del usuario actual para un curso (para "mejor puntaje", nº de intentos). */
export async function getCourseAttempts(
  courseId: string,
  userId: string,
): Promise<SimulatorAttemptRow[]> {
  const { data, error } = await supabase
    .from('simulator_attempts')
    .select('*')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

interface RawAttempt {
  module_id?: string
  section_id?: string
  game_type?: string
  score?: number
  started_at?: string
  submitted_answers?: { quiz_key?: string | null; marker_id?: string | null } | null
}

export interface CourseActivitySummary {
  /** Desempeño 0-100 (promedio del último intento por unidad), o null si no hay actividad. */
  score: number | null
  /** Fecha (ISO) del último quiz/juego resuelto del curso = cuándo terminó, o null. */
  completedAt: string | null
}

/**
 * Resumen de actividad del aprendiz en un curso, basado en los puntajes de
 * quizzes/juegos guardados en `user_progress.attempts`.
 *
 * Cada actividad se guarda como un intento independiente: los quizzes de sección
 * (KNOWLEDGE_CHECK) generan UNA fila por pregunta con score 100/0, los quizzes de
 * video (VIDEO_QUIZ) y los juegos (CLASSIFY/SORT) guardan un %. Para un puntaje
 * justo tomamos el intento MÁS RECIENTE de cada "unidad" (pregunta o juego) y
 * promediamos todas las unidades del curso. Así una pregunta acertada no infla el
 * módulo entero al 100%. `completedAt` es la fecha del intento más reciente.
 *
 * Estrategia: primero se intenta la RPC server-side `get_course_activity_summary`
 * (SECURITY DEFINER → salta RLS y funciona para que el capacitador/superadmin vea
 * el puntaje de un aprendiz). Si la RPC no está desplegada o no autoriza, se cae al
 * cálculo desde el cliente (que solo puede leer el `user_progress` del propio
 * usuario por RLS). Si se pasa `targetUserId` calcula el resumen de ESE aprendiz.
 */
export async function getCourseActivitySummary(
  courseId: string,
  moduleIds: string[],
  targetUserId?: string | null,
): Promise<CourseActivitySummary> {
  const empty: CourseActivitySummary = { score: null, completedAt: null }

  let uid = targetUserId ?? null
  if (!uid) {
    const { data: userData } = await supabase.auth.getUser()
    uid = userData.user?.id ?? null
  }
  if (!uid) return empty

  // 1) RPC server-side (salta RLS; la única vía para la vista del capacitador).
  try {
    const { data, error } = await supabase.rpc('get_course_activity_summary', {
      p_course_id: courseId,
      p_user_id: uid,
    })
    if (!error && data != null) {
      const d = data as { score: number | null; completed_at: string | null }
      const score = d.score == null ? null : Math.round(Math.max(0, Math.min(100, d.score)))
      return { score, completedAt: d.completed_at ?? null }
    }
  } catch {
    /* RPC no desplegada → cae al cálculo cliente */
  }

  // 2) Fallback: cálculo desde el cliente (solo funciona para el propio usuario).
  return activitySummaryFromClient(moduleIds, uid)
}

/** Cálculo del resumen leyendo `user_progress` directo (limitado por RLS al propio usuario). */
async function activitySummaryFromClient(
  moduleIds: string[],
  uid: string,
): Promise<CourseActivitySummary> {
  const empty: CourseActivitySummary = { score: null, completedAt: null }
  if (moduleIds.length === 0) return empty

  const { data, error } = await supabase
    .from('user_progress')
    .select('attempts')
    .eq('user_id', uid)
  if (error) return empty

  const wanted = new Set(moduleIds)
  // Por cada unidad guardamos el intento más reciente { score, ts }.
  const latestByUnit = new Map<string, { score: number; ts: number }>()
  let latestTs = 0

  for (const row of data ?? []) {
    const attempts: RawAttempt[] = Array.isArray(row.attempts)
      ? row.attempts
      : typeof row.attempts === 'string'
        ? JSON.parse(row.attempts)
        : []
    for (const a of attempts) {
      const mid = a?.module_id
      if (!mid || !wanted.has(mid)) continue
      const score = typeof a?.score === 'number' ? a.score : null
      if (score == null) continue

      const sa = a.submitted_answers ?? {}
      // Unidad estable: cada pregunta / marcador / juego cuenta una sola vez.
      const unit = `${mid}|${a.game_type ?? ''}|${sa.quiz_key ?? sa.marker_id ?? a.section_id ?? ''}`
      const ts = a.started_at ? Date.parse(a.started_at) : 0
      if (ts > latestTs) latestTs = ts
      const prev = latestByUnit.get(unit)
      if (!prev || ts >= prev.ts) latestByUnit.set(unit, { score, ts })
    }
  }

  if (latestByUnit.size === 0) return empty
  const vals = [...latestByUnit.values()].map((u) => u.score)
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length
  return {
    score: Math.round(Math.max(0, Math.min(100, avg))),
    completedAt: latestTs > 0 ? new Date(latestTs).toISOString() : null,
  }
}

// ─── Certificación ───────────────────────────────────────────────────────

/** Estado de certificación (server-side) del curso para el usuario actual. */
export async function getCourseCertStatus(courseId: string): Promise<CourseCertStatus> {
  const { data, error } = await supabase.rpc('get_course_certification_status', {
    p_course_id: courseId,
  })
  if (error) throw error
  return data as unknown as CourseCertStatus
}

/** Emite la certificación (valida condiciones server-side; idempotente). */
export async function issueCertification(
  courseId: string,
): Promise<{ cert_id: string; score: number; issued_at: string; already: boolean }> {
  const { data, error } = await supabase.rpc('issue_certification', { p_course_id: courseId })
  if (error) throw error
  return data as unknown as { cert_id: string; score: number; issued_at: string; already: boolean }
}

/** Certificado emitido del usuario actual para un curso (o null). */
export async function getMyCertification(courseId: string): Promise<Certification | null> {
  const { data: userData } = await supabase.auth.getUser()
  const uid = userData.user?.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('certifications')
    .select('*')
    .eq('course_id', courseId)
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw error
  return data
}

// ─── Verificación pública (LinkedIn) ─────────────────────────────────────

/**
 * Lee un certificado por su `cert_id` SIN requerir sesión (RPC SECURITY
 * DEFINER `get_public_certificate`). Es lo que consume la página pública
 * /verify/:certId que se comparte en LinkedIn. Devuelve `null` si no existe.
 */
export async function getPublicCertificate(certId: string): Promise<PublicCertificate | null> {
  const { data, error } = await supabase.rpc('get_public_certificate', { p_cert_id: certId })
  if (error) throw error
  if (data == null) return null
  // El RPC puede devolver el objeto directamente o dentro de un array.
  const row = Array.isArray(data) ? data[0] : data
  return (row ?? null) as PublicCertificate | null
}

// ─── Panel del capacitador ───────────────────────────────────────────────

/** Resultados de evaluación por aprendiz de un curso (solo dueño/superadmin). */
export async function getCourseEvaluationResults(
  courseId: string,
): Promise<CourseEvaluationResult[]> {
  const { data, error } = await supabase.rpc('get_course_evaluation_results', {
    p_course_id: courseId,
  })
  if (error) throw error
  return (data ?? []) as CourseEvaluationResult[]
}
