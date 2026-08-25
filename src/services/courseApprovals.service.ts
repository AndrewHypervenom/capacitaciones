import { supabase } from '@/lib/supabase'

/**
 * Aprobación de publicación de cursos.
 *
 * Publicar un curso dejó de ser un interruptor: es una decisión que aprueba el
 * superadmin (o el capacitador que él designe con `profiles.can_approve_courses`
 * desde /admin/users). El capacitador termina su curso, pide la publicación y el
 * aprobador la concede o la devuelve con un motivo.
 *
 * El reparto de responsabilidades entre cliente y base:
 *  - Pedir/retirar la solicitud es un UPDATE normal sobre el propio curso: la
 *    RLS ya limita a quién puede tocarlo y el trigger `courses_publication_guard`
 *    sólo deja los saltos legítimos (draft/rejected → pending → draft).
 *  - Aprobar, rechazar y revocar van por RPC SECURITY DEFINER: un capacitador
 *    aprobador tiene que poder resolver cursos de campañas ajenas sin que le
 *    demos RLS de escritura sobre todas.
 *
 * Si el SQL todavía no se ha corrido, las columnas no existen: en vez de romper
 * la pantalla, las lecturas devuelven vacío y el editor se comporta como antes
 * (ver `approvalsReady`).
 */

/** Estado de la puerta de publicación de un curso. */
export type CourseApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected'

/** Las columnas que el SQL añade a `courses`. Opcionales: pueden no existir aún. */
export interface CourseApprovalFields {
  approval_status?: CourseApprovalStatus | null
  approval_note?: string | null
  approval_requested_at?: string | null
  approval_requested_by?: string | null
  approved_at?: string | null
  approved_by?: string | null
}

/** Una fila de la bandeja del aprobador (RPC get_course_publication_requests). */
export interface CoursePublicationRequest {
  course_id: string
  title: string
  slug: string
  icon: string
  color: string
  campaign_id: string | null
  campaign_name: string | null
  approval_status: CourseApprovalStatus
  approval_note: string | null
  approval_requested_at: string | null
  requested_by: string | null
  requested_by_name: string
  approved_at: string | null
  approved_by_name: string | null
  is_published: boolean
  modules_total: number
  modules_published: number
  /** Campañas + personas con el curso asignado: cuánta gente destraba el sí. */
  audience_count: number
  updated_at: string
}

/**
 * Estado efectivo de un curso cuyo `approval_status` puede venir sin definir
 * (SQL sin correr, o una fila vieja). Un curso ya publicado se lee como
 * aprobado: la regla nueva no puede bajar de producción lo que la gente ve hoy.
 */
export function approvalStatusOf(course: {
  is_published?: boolean
  approval_status?: string | null
}): CourseApprovalStatus {
  const raw = course.approval_status
  if (raw === 'pending' || raw === 'approved' || raw === 'rejected' || raw === 'draft') return raw
  return course.is_published ? 'approved' : 'draft'
}

/**
 * ¿Está la puerta instalada en esta base? Mientras el SQL no se corra, la
 * columna no llega en el `select *` y el editor sigue publicando como antes en
 * vez de bloquear a todo el mundo por una migración pendiente.
 */
export function approvalsReady(course: object): boolean {
  return 'approval_status' in course
}

/** ¿Puede publicarse ya, sin pedirle permiso a nadie? */
export function canPublishNow(
  course: { is_published?: boolean; approval_status?: string | null },
  isApprover: boolean,
): boolean {
  if (!approvalsReady(course)) return true
  if (isApprover) return true
  return approvalStatusOf(course) === 'approved'
}

// ─── Lado del capacitador ────────────────────────────────────────

/**
 * Pide que se publique el curso. Deja el estado en 'pending'; el trigger sella
 * quién y cuándo, y avisa a los aprobadores por la campana.
 */
export async function requestCoursePublication(courseId: string): Promise<void> {
  const { error } = await supabase
    .from('courses')
    // El motivo del rechazo anterior deja de aplicar en cuanto se vuelve a pedir.
    .update({ approval_status: 'pending', approval_note: null } as never)
    .eq('id', courseId)
  if (error) throw error
}

/** Retira una solicitud que aún no han revisado. */
export async function cancelCoursePublicationRequest(courseId: string): Promise<void> {
  const { error } = await supabase
    .from('courses')
    .update({ approval_status: 'draft' } as never)
    .eq('id', courseId)
    .eq('approval_status', 'pending')
  if (error) throw error
}

// ─── Lado del aprobador ──────────────────────────────────────────

/** Aprueba y publica el curso de una vez: el sí y la puesta en aire son lo mismo. */
export async function approveCoursePublication(courseId: string, note?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('approve_course_publication', {
    p_course_id: courseId,
    p_note: note?.trim() || null,
  })
  if (error) throw error
}

/** Devuelve el curso con un motivo. El motivo es obligatorio (lo exige el RPC). */
export async function rejectCoursePublication(courseId: string, note: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('reject_course_publication', {
    p_course_id: courseId,
    p_note: note.trim(),
  })
  if (error) throw error
}

/** Baja un curso aprobado y lo devuelve a borrador: tendrá que pasar otra vez. */
export async function revokeCoursePublication(courseId: string, note?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('revoke_course_publication', {
    p_course_id: courseId,
    p_note: note?.trim() || null,
  })
  if (error) throw error
}

/**
 * Cuántos cursos están esperando aprobación. Solo el número: es lo único que
 * necesitan el globo del menú y la tarjeta del tablero, y pedir la bandeja
 * entera para hacerle `.length` significaba traer título, campaña, quién lo
 * pidió y dos subconsultas por curso cada vez que alguien entra al panel.
 *
 * Si el RPC del conteo todavía no está en la base, cae a contar las filas de la
 * bandeja: más caro, pero el globo sigue funcionando mientras se corre el SQL.
 */
export async function countPendingCoursePublications(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('count_pending_course_publications')
  if (!error) return Number(data) || 0
  if (error.code !== '42883' && error.code !== 'PGRST202') throw error
  const rows = await getCoursePublicationRequests('pending')
  return rows?.length ?? 0
}

/**
 * Cursos por estado de aprobación, para la bandeja. Con el SQL sin correr el RPC
 * no existe (42883/PGRST202): devolvemos vacío para que la página muestre su
 * aviso de "falta correr el SQL" en vez de un error rojo.
 */
export async function getCoursePublicationRequests(
  status: CourseApprovalStatus | 'all' = 'pending',
): Promise<CoursePublicationRequest[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_course_publication_requests', {
    p_status: status,
  })
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') return null
    throw error
  }
  return (data ?? []) as CoursePublicationRequest[]
}
