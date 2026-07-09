import { supabase } from '@/lib/supabase'
import type {
  CourseCertStatus,
  Certification,
  CourseEvaluationResult,
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
