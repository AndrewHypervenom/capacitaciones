import { supabase } from '@/lib/supabase'

/** Alcance de un restablecimiento hecho por el superadmin. */
export type ResetScope = 'course' | 'module' | 'section' | 'world' | 'simulator'

/**
 * Datos que viajan en la notificación para que el cliente del aprendiz limpie su
 * caché local (localStorage/progressStore) y pinte el texto. Todos opcionales
 * según el alcance.
 */
export interface ResetPayload {
  /** Slugs de módulo a quitar de completedModules. */
  module_slugs?: string[]
  /** UUIDs de módulo cuyas respuestas (checkAnswers) hay que borrar. */
  check_answer_keys?: string[]
  /** Slugs de escenarios cuyos intentos de simulador hay que borrar del store. */
  scenario_slugs?: string[]
  /** Reiniciar contadores locales de mundo (solo reset de curso). */
  clear_world?: boolean
  course_id?: string | null
  course_title?: string | null
  module_title?: string | null
  section_heading?: string | null
}

export interface AppNotification {
  id: string
  scope: ResetScope
  kind: string
  course_id: string | null
  payload: ResetPayload
  created_at: string
  read_at: string | null
}

/** Notificaciones del usuario, de la más reciente a la más antigua. */
export async function getMyNotifications(limit = 30): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, scope, kind, course_id, payload, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as AppNotification[]
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  if (error) throw error
}

export async function markAllNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
  if (error) throw error
}

// ─── Capacitador: aviso de retroalimentación al aprendiz ────────────────────

/**
 * Notifica al aprendiz que su capacitador dejó una retroalimentación. Inserta una
 * fila en user_notifications del aprendiz vía RPC SECURITY DEFINER (el capacitador
 * no puede escribir directo en filas de otro usuario por RLS). La campana del
 * aprendiz la muestra en vivo (Realtime) y enlaza a /feedback.
 */
export async function notifyLearnerFeedback(params: {
  userId: string
  courseId?: string | null
  moduleTitle?: string | null
  sectionHeading?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('notify_learner_feedback', {
    p_user_id: params.userId,
    p_course_id: params.courseId ?? null,
    p_payload: {
      module_title: params.moduleTitle ?? null,
      section_heading: params.sectionHeading ?? null,
    },
  })
  if (error) throw error
}

// ─── Superadmin: restablecimientos granulares ───────────────────────────────

export async function resetUserModuleAdmin(userId: string, moduleId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_user_module_admin', {
    p_user_id: userId,
    p_module_id: moduleId,
  })
  if (error) throw error
}

export async function resetUserSectionAdmin(userId: string, sectionId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_user_section_admin', {
    p_user_id: userId,
    p_section_id: sectionId,
  })
  if (error) throw error
}

export async function resetUserWorldAdmin(userId: string, courseId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_user_world_admin', {
    p_user_id: userId,
    p_course_id: courseId,
  })
  if (error) throw error
}

export async function resetUserSimulatorAdmin(userId: string, courseId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_user_simulator_admin', {
    p_user_id: userId,
    p_course_id: courseId,
  })
  if (error) throw error
}

// ─── Superadmin: estructura del curso + actividad del usuario (para el modal) ──

export interface AdminCourseDetailSection {
  id: string
  heading_es: string
  has_attempt: boolean
}
export interface AdminCourseDetailModule {
  id: string
  slug: string
  title_es: string
  completed: boolean
  sections: AdminCourseDetailSection[]
}
export interface AdminCourseDetail {
  has_world: boolean
  world_done: boolean
  has_sim: boolean
  sim_done: boolean
  modules: AdminCourseDetailModule[]
}

export async function getUserCourseDetailAdmin(
  userId: string,
  courseId: string,
): Promise<AdminCourseDetail> {
  const { data, error } = await supabase.rpc('get_user_course_detail_admin', {
    p_user_id: userId,
    p_course_id: courseId,
  })
  if (error) throw error
  return (data ?? {
    has_world: false,
    world_done: false,
    has_sim: false,
    sim_done: false,
    modules: [],
  }) as unknown as AdminCourseDetail
}
