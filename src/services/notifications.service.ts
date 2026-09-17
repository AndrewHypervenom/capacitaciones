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
  /** Ajuste de avance del superadmin (no un simple reset): trae qué marcar. */
  adjust?: boolean
  /** Dónde quedó la persona: "Módulo 3 · …", "Curso completo". */
  stop_label?: string | null
  /** Módulos que el ajuste deja HECHOS (UUID y slug, como el progreso local). */
  complete_module_ids?: string[]
  complete_module_slugs?: string[]
  /** Plazo de un curso (kind 'course_deadline'): en qué momento va. */
  stage?: 'soon' | 'today' | 'overdue'
  onboarding?: boolean
  course_slug?: string | null
  due_at?: string | null
  days_left?: number
  /** Resumen diario al equipo (kind 'onboarding_overdue'). Cubre cualquier
   *  curso con plazo; `onboarding` viene en false si hay cursos normales. */
  courses?: string[]
  who?: string[]
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
  /** Id del mensaje del hilo (solo en kind = 'site_feedback_reply'). */
  event_id?: string
  /**
   * El aviso de respuesta va a los dos lados con la misma forma: true cuando lo
   * recibe el equipo (respondió quien opinó) y false cuando lo recibe quien
   * opinó. Es lo que decide a dónde lleva el clic.
   */
  for_staff?: boolean
}

/**
 * Datos de los avisos de la puerta de publicación: 'course_publish_request' (a
 * los aprobadores: alguien pide publicar un curso) y 'course_publish_resolved'
 * (de vuelta al autor: aprobado, devuelto o bajado). Los arman el trigger
 * `courses_publication_guard` y los RPC de aprobación.
 */
export interface PublishApprovalPayload {
  /** true = aprobado y publicado. false = devuelto o bajado. */
  approved?: boolean
  /** true cuando se bajó un curso que YA estaba en aire (no un rechazo). */
  revoked?: boolean
}

/** Todo lo que puede venir en `payload`, según el `kind` de la notificación. */
export type NotificationPayload = ResetPayload &
  HelpChatPayload &
  SiteFeedbackNotificationPayload &
  PublishApprovalPayload

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

// ─── Superadmin: dejar a una persona en un punto exacto de un curso ─────────

export interface CourseStepsTitle {
  title_es: string
  title_en: string | null
  title_pt: string | null
}

export interface AdminCourseSteps {
  modules: Array<CourseStepsTitle & { id: string; slug: string; done: boolean }>
  practice: Array<CourseStepsTitle & { slug: string; kind: 'call' | 'choice'; done: boolean }>
  world: { id: string; name: string; name_en: string | null; name_pt: string | null; levels: number; done: boolean } | null
  exam: (CourseStepsTitle & { id: string; done: boolean }) | null
  last_adjustment: {
    at: string
    label: string | null
    done_steps: number
    total_steps: number
    by_name: string | null
  } | null
}

/** El recorrido del curso paso a paso, con lo que esa persona ya tiene hecho. */
export async function getUserCourseStepsAdmin(userId: string, courseId: string): Promise<AdminCourseSteps> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_user_course_steps_admin', {
    p_user_id: userId,
    p_course_id: courseId,
  })
  if (error) throw error
  const d = (data ?? {}) as Partial<AdminCourseSteps>
  return {
    modules: d.modules ?? [],
    practice: d.practice ?? [],
    world: d.world ?? null,
    exam: d.exam ?? null,
    last_adjustment: d.last_adjustment ?? null,
  }
}

export interface CourseProgressTarget {
  doneModuleIds: string[]
  doneScenarioSlugs: string[]
  worldDone: boolean
  examDone: boolean
  /** "Módulo 3 · Atención al cliente", "Curso completo"… queda en el rastro. */
  stopLabel: string
  doneSteps: number
  totalSteps: number
}

/**
 * Deja el curso de la persona EXACTAMENTE así: lo marcado queda hecho y todo lo
 * demás se borra (intentos, mundo, examen y, si ya no está completo, el
 * certificado). Solo superadmin; el RPC avisa al navegador del aprendiz.
 */
export async function setUserCourseProgressAdmin(
  userId: string,
  courseId: string,
  target: CourseProgressTarget,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_user_course_progress_admin', {
    p_user_id: userId,
    p_course_id: courseId,
    p_done_module_ids: target.doneModuleIds,
    p_done_scenario_slugs: target.doneScenarioSlugs,
    p_world_done: target.worldDone,
    p_exam_done: target.examDone,
    p_stop_label: target.stopLabel,
    p_done_steps: target.doneSteps,
    p_total_steps: target.totalSteps,
  })
  if (error) throw error
}
