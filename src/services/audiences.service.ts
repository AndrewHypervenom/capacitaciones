import { supabase } from '@/lib/supabase'
import type { CourseAudience } from '@/types/database'

/* ─── A quién le llega un curso ────────────────────────────────────────────
 *
 * La regla vive en `course_audiences`: una fila por curso, con tres ejes que
 * apuntan a los atributos de la persona (país, operación, área).
 *
 * Semántica —conviene tenerla clara antes de tocar nada:
 *   · Dentro de un eje se SUMA:   Colombia o México o Argentina.
 *   · Entre ejes se CRUZA:        Colombia Y Talento Humano.
 *   · Un eje vacío no restringe:  "solo Talento Humano" vale en los 3 países.
 *   · Todo vacío y sin `everyone` → NO LE LLEGA A NADIE.
 *
 * Ese último caso es deliberado: un curso a medio definir no debe salir a 800
 * personas por descuido. Falla cerrado.
 *
 * La misma regla se evalúa en dos sitios: en la base (`audience_matches`, que
 * es lo que manda para la RLS) y aquí en el cliente (`matchesAudience`, solo
 * para PREVISUALIZAR a cuánta gente afectaría antes de guardar). Si alguna vez
 * se cambia la semántica, hay que cambiarla en los dos — por eso está escrita
 * igual en ambos lados, y por eso lo dice este comentario.
 *
 * Degradación: mientras el SQL de la fase 4 no se haya corrido, la tabla no
 * existe y todo devuelve "sin regla" en vez de reventar.
 */

/** Lo que la interfaz edita. Es la fila sin los campos de auditoría. */
export interface AudienceRule {
  everyone: boolean
  countries: string[]
  operationIds: string[]
  areaIds: string[]
  isMandatory: boolean
}

export const EMPTY_RULE: AudienceRule = {
  everyone: false,
  countries: [],
  operationIds: [],
  areaIds: [],
  isMandatory: false,
}

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' || // la función RPC no existe todavía
    /does not exist|schema cache/i.test(error.message ?? '')
  )
}

function toRule(row: CourseAudience): AudienceRule {
  return {
    everyone: row.everyone,
    countries: row.countries ?? [],
    operationIds: row.operation_ids ?? [],
    areaIds: row.area_ids ?? [],
    isMandatory: row.is_mandatory,
  }
}

/** ¿La regla no dice nada todavía? Entonces no le llega a nadie. */
export function ruleIsEmpty(r: AudienceRule): boolean {
  return (
    !r.everyone &&
    r.countries.length === 0 &&
    r.operationIds.length === 0 &&
    r.areaIds.length === 0
  )
}

/**
 * ¿A esta persona le toca?
 *
 * Copia exacta de `audience_matches` en la base. Solo para previsualizar: la
 * autoridad es la de la base, que es la que la RLS consulta.
 */
export function matchesAudience(
  rule: AudienceRule,
  person: { country?: string | null; operation_id?: string | null; area_id?: string | null },
): boolean {
  if (rule.everyone) return true
  if (ruleIsEmpty(rule)) return false
  if (rule.countries.length > 0 && !rule.countries.includes(person.country ?? '')) return false
  if (rule.operationIds.length > 0 && !rule.operationIds.includes(person.operation_id ?? '')) return false
  if (rule.areaIds.length > 0 && !rule.areaIds.includes(person.area_id ?? '')) return false
  return true
}

/** La regla de un curso, o `null` si todavía no tiene ninguna. */
export async function getAudience(courseId: string): Promise<AudienceRule | null> {
  const { data, error } = await supabase
    .from('course_audiences')
    .select('*')
    .eq('course_id', courseId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return data ? toRule(data as CourseAudience) : null
}

/** Las reglas de varios cursos de una vez, para pintar un listado. */
export async function getAudiences(courseIds: string[]): Promise<Map<string, AudienceRule>> {
  const out = new Map<string, AudienceRule>()
  if (courseIds.length === 0) return out
  const { data, error } = await supabase
    .from('course_audiences')
    .select('*')
    .in('course_id', courseIds)
  if (error) {
    if (isMissingSchema(error)) return out
    throw error
  }
  for (const row of (data ?? []) as CourseAudience[]) out.set(row.course_id, toRule(row))
  return out
}

export async function saveAudience(courseId: string, rule: AudienceRule): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  const { error } = await supabase.from('course_audiences').upsert(
    {
      course_id: courseId,
      // `everyone` gana sobre los ejes: si va a todo el mundo, guardar además
      // una lista de países sería contradictorio y confundiría al que lo abra
      // después. Se limpia al guardar, no al pintar.
      everyone: rule.everyone,
      countries: rule.everyone ? [] : rule.countries,
      operation_ids: rule.everyone ? [] : rule.operationIds,
      area_ids: rule.everyone ? [] : rule.areaIds,
      is_mandatory: rule.isMandatory,
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'course_id' },
  )
  if (error) throw error
}

/** Quita la regla: el curso vuelve a depender solo de campañas y asignaciones. */
export async function clearAudience(courseId: string): Promise<void> {
  const { error } = await supabase.from('course_audiences').delete().eq('course_id', courseId)
  if (error && !isMissingSchema(error)) throw error
}

/**
 * A cuánta gente le llegaría esta regla, contando de verdad contra los perfiles.
 *
 * Es lo que se enseña ANTES de guardar. Un número concreto —"le llega a 489
 * personas"— es lo único que evita publicar un curso creyendo que va a un área
 * y descubrir después que fue a toda la compañía.
 */
export async function countAudience(
  orgId: string,
  rule: AudienceRule,
): Promise<{ matched: number; total: number } | null> {
  if (!orgId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('country, operation_id, area_id')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .eq('role', 'learner')
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const people = (data ?? []) as Array<{
    country: string | null
    operation_id: string | null
    area_id: string | null
  }>
  return {
    matched: people.filter((p) => matchesAudience(rule, p)).length,
    total: people.length,
  }
}

/**
 * Los cursos que me tocan por regla. Va por RPC a propósito: a quién le llega
 * cada curso es información de gestión, y el aprendiz no tiene por qué poder
 * leer las reglas de todos los cursos para saber cuáles son los suyos.
 */
export async function getMyAudienceCourses(): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const { data, error } = await supabase.rpc('get_my_audience_courses')
  if (error) {
    if (isMissingSchema(error)) return out
    throw error
  }
  for (const r of data ?? []) {
    out.set(r.course_id, r.is_mandatory)
  }
  return out
}
