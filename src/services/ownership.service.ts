import { supabase } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cambio de dueño del contenido de un capacitador.
 *
 * Para cuando hay que dar de baja una cuenta que alcanzó a crear cosas: primero
 * se le pasa el contenido a quien correspondía, y solo entonces se borra. Al
 * revés, el contenido queda sin dueño (nadie puede administrarlo) o el borrado
 * falla por las claves foráneas que apuntan a esa persona.
 *
 * Los módulos entran desde que `modules.created_by` existe. Los que cuelgan de
 * un curso ya iban con él; los SUELTOS (sin curso) eran justo los que se
 * quedaban sin nadie, y por eso se cuentan aparte.
 */

/**
 * Cliente sin el tipado generado: `admin_user_content` y `admin_transfer_content`
 * son RPC nuevas y `src/types/database.ts` se regenera aparte. Sus formas están
 * modeladas abajo con tipos reales, que es lo que de verdad usa el que llama.
 */
const db = supabase as unknown as SupabaseClient

/** Lo que figura creado por una persona. Las claves son las del RPC. */
export type AuthoredCounts = {
  courses: number
  courses_deleted: number
  courses_approved: number
  modules: number
  /** Subconjunto de `modules`: los que no pertenecen a ningún curso. */
  modules_no_course: number
  exams: number
  exam_questions: number
  scenarios: number
  choice_scenarios: number
  worlds: number
  arena_quizzes: number
  guided_missions: number
  live_quizzes: number
  ai_scenario_drafts: number
}

/** Una referencia que impediría borrar a la persona (FK sin ON DELETE). */
export type BlockingRef = { table: string; column: string; rows: number }

export type UserContent = { authored: AuthoredCounts; blocking: BlockingRef[] }

/** Qué creó esta persona y qué impediría borrarla. Solo superadmin. */
export async function getUserContent(userId: string): Promise<UserContent> {
  const { data, error } = await db.rpc('admin_user_content', { p_user: userId })
  if (error) throw error
  const d = (data ?? {}) as Partial<UserContent>
  return {
    authored: (d.authored ?? {}) as AuthoredCounts,
    blocking: d.blocking ?? [],
  }
}

/**
 * Pasa el contenido de `fromId` a `toId`. Devuelve cuántas filas movió por
 * tipo, para poder decir qué pasó en vez de un "listo" a ciegas.
 */
export async function transferContent(
  fromId: string,
  toId: string,
): Promise<Record<string, number>> {
  const { data, error } = await db.rpc('admin_transfer_content', {
    p_from: fromId,
    p_to: toId,
  })
  if (error) throw error
  return (data ?? {}) as Record<string, number>
}

/**
 * Total de cosas con autoría, para saber si hay algo que transferir.
 * `modules_no_course` NO suma: es un subconjunto de `modules` y contarlo otra
 * vez inflaría el número que se le enseña al superadmin.
 */
export function totalAuthored(a: AuthoredCounts): number {
  return Object.entries(a ?? {})
    .filter(([k]) => k !== 'modules_no_course')
    .reduce((sum, [, n]) => sum + (Number(n) || 0), 0)
}

/**
 * Cambia el dueño de UN curso. Es la vía directa para cuando no se trata de
 * vaciar una cuenta entera sino de poner un curso concreto a nombre de quien
 * corresponde — p. ej. crear un curso "contenedor" y dejárselo a alguien.
 *
 * De `courses.created_by` depende quién puede administrarlo, así que esto NO es
 * un dato informativo: cambia quién manda sobre el curso.
 */
export async function setCourseOwner(courseId: string, ownerId: string): Promise<void> {
  const { error } = await db.rpc('admin_set_course_owner', {
    p_course_id: courseId,
    p_owner: ownerId,
  })
  if (error) throw error
}
