import { supabase } from '@/lib/supabase'

/** Alcance de un restablecimiento hecho por el superadmin. */
export type ResetScope = 'course' | 'module' | 'section' | 'world' | 'simulator'

/**
 * Datos que viajan en la notificación para que el cliente del aprendiz limpie su
 * caché local (localStorage/progressStore) y pinte el texto. Todos opcionales
 * según el alcance.
 */
export interface ResetPayload {
  /**
   * UUIDs de módulo a quitar del progreso. Clave nueva; el RPC de reset debería
   * emitirla siempre (ver docs/plan-migracion-progreso-uuid.md, fase 5).
   */
  module_ids?: string[]
  /**
   * Slugs de módulo a quitar del progreso.
   * @deprecated clave legada. Mientras el RPC solo mande esto, el cliente
   * traduce a UUID con su índice local para que el reset limpie de verdad.
   */
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

/**
 * Datos del aviso "alguien escribió al chat de ayuda" (kind = 'help_chat'), que
 * solo reciben los superadmin. Lo arma el RPC notify_superadmins_help_chat con
 * los datos de quien pregunta, para que el aviso se pinte completo (avatar,
 * nombre, campaña) sin una consulta extra.
 */
export interface HelpChatPayload {
  from_user_id?: string
  from_name?: string
  from_role?: string
  from_avatar?: string | null
  campaign_name?: string | null
  question?: string
  page?: string | null
  lang?: string
  /** Preguntas agrupadas en este mismo aviso (ver el SQL: ventana de 10 min). */
  count?: number
}

/**
 * Datos del aviso "alguien escribió una opinión del sitio" (kind =
 * 'site_feedback'), que reciben los superadmin y los capacitadores de la
 * campaña de quien opina. Lo arma el RPC notify_staff_site_feedback.
 *
 * Comparte los campos `from_*` y `count` con el aviso del chat de ayuda: las
 * dos tarjetas se pintan con el mismo componente.
 */
export interface SiteFeedbackNotificationPayload {
  /** Id de la fila en site_feedback (para abrirla directamente en la bandeja). */
  feedback_id?: string
  /** bug | idea | praise | question. */
  feedback_kind?: string
  /** Lo que escribió, recortado a 400 caracteres por el RPC. */
  message?: string
  page_label?: string | null
}

/** Todo lo que puede venir en `payload`, según el `kind` de la notificación. */
export type NotificationPayload = ResetPayload &
  HelpChatPayload &
  SiteFeedbackNotificationPayload

export interface AppNotification {
  id: string
  scope: ResetScope
  kind: string
  course_id: string | null
  payload: NotificationPayload
  created_at: string
  read_at: string | null
}

/** Notificaciones del usuario, de la más reciente a la más antigua. */
export async function getMyNotifications(limit = 30): Promise<AppNotification[]> {
  // Filtro EXPLÍCITO por el usuario actual: no confiamos solo en RLS. El staff
  // (superadmin/capacitador) tiene políticas "read-all" sobre muchas tablas, así
  // que sin este filtro un capacitador vería las notificaciones (p. ej. avisos de
  // retroalimentación) de TODOS los aprendices. La campana es estrictamente
  // personal → siempre acotamos a auth.uid().
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, scope, kind, course_id, payload, created_at, read_at')
    .eq('user_id', uid)
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

// ─── Aviso al superadmin: alguien escribió al chat de ayuda ─────────────────

/**
 * Avisa a los superadmin que esta persona acaba de mandar una pregunta al chat
 * de ayuda. Va por RPC SECURITY DEFINER porque quien pregunta no puede escribir
 * en las notificaciones de otro usuario (la campana es estrictamente personal).
 *
 * Nunca lanza: es un aviso, no puede estropear el chat de quien pide ayuda. El
 * RPC aún no está en los tipos generados de la BD → se llama con cast.
 */
export async function notifySuperadminsHelpChat(params: {
  question: string
  page?: string | null
  lang?: string
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('notify_superadmins_help_chat', {
      p_question: params.question,
      p_page: params.page ?? null,
      p_lang: params.lang ?? 'es',
    })
  } catch {
    // Silencioso a propósito (igual que el registro del chat).
  }
}

// ─── Aviso al staff: llegó una opinión del sitio ────────────────────────────

/**
 * Avisa a los superadmin y a los capacitadores de la campaña que acaba de
 * entrar una opinión. Igual que el del chat de ayuda, va por RPC SECURITY
 * DEFINER (quien opina no puede escribir en la campana de nadie) y el RPC
 * decide a quién le toca: aquí no se manda ninguna lista de destinatarios.
 *
 * Nunca lanza: la opinión YA está guardada cuando esto corre, y que falle el
 * aviso no puede convertirse en un error delante de quien acaba de opinar.
 */
export async function notifyStaffSiteFeedback(feedbackId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('notify_staff_site_feedback', { p_id: feedbackId })
  } catch {
    // Silencioso a propósito.
  }
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
