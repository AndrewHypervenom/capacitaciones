import { supabase } from '@/lib/supabase'
import type { CertConditions, Course } from '@/types/database'
import { DEFAULT_CERT_CONDITIONS } from '@/types/database'
import { requestDeletion, type DeletionResult } from '@/services/audit.service'
import { onlyActive } from '@/lib/activeUsers'
import { getTestCampaignIds, TestScopeError } from '@/services/campaigns.service'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

// ─── Tipos ───────────────────────────────────────────────────────

/** Módulo resumido dentro de un curso (sin secciones). */
export interface CourseModuleSummary {
  id: string
  slug: string
  icon: string
  duration_min: number
  course_sort_order: number
  is_published: boolean
  title_es: string
  title_en: string | null
  title_pt: string | null
  subtitle_es: string | null
  subtitle_en: string | null
  subtitle_pt: string | null
  /** Marca de borrado suave; si no es null el módulo está eliminado. */
  deleted_at: string | null
}

export type CourseWithModules = Course & { modules: CourseModuleSummary[] }

export interface CourseCampaignRow {
  course_id: string
  campaign_id: string
  is_mandatory: boolean
  assigned_at?: string
}

export interface CourseAssignmentRow {
  course_id: string
  user_id: string
  is_mandatory: boolean
  assigned_by?: string | null
  assigned_at?: string
}

/** Curso enriquecido para el aprendiz. */
export interface LearnerCourse extends CourseWithModules {
  /** Asignado a su campaña o a él directamente (vs. solo catálogo) */
  isAssigned: boolean
  isMandatory: boolean
  /** Se auto-inscribió él mismo (puede salir del curso). */
  selfEnrolled: boolean
  /** Nombre de la campaña dueña del curso (para mostrarlo sutilmente). */
  campaign_name: string | null
  /**
   * Desde cuándo lo tiene: la marca de asignación MÁS ANTIGUA que le aplica
   * (la suya directa o la de su campaña). Es el punto de partida del límite de
   * tiempo por días; null si solo lo ve por catálogo y aún no se inscribió.
   */
  assignedAt: string | null
}

// Desambiguamos la relación courses<->modules nombrando la FK modules.course_id.
// Si no, un segundo vínculo courses->modules (p. ej. sim_unlock_module_id) vuelve
// ambiguo el embed y PostgREST responde 400 ("more than one relationship").
const COURSE_MODULES_SELECT =
  'modules!modules_course_id_fkey(id, slug, icon, duration_min, course_sort_order, is_published, title_es, title_en, title_pt, subtitle_es, subtitle_en, subtitle_pt, deleted_at)'

/** La más antigua de dos marcas ISO (ignora las vacías). */
function earliest(a?: string | null, b?: string | null): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return a <= b ? a : b
}

function sortCourseModules<T extends { modules: CourseModuleSummary[] }>(course: T): T {
  // Descartamos los borrados suave: el borrado (request_deletion) solo marca
  // deleted_at, y confiar solo en la RLS para ocultarlos dejaba el conteo de la
  // tarjeta del curso inflado ("dice que hay módulos" cuando ya no los hay).
  course.modules = (course.modules ?? [])
    .filter((m) => !m.deleted_at)
    .sort((a, b) => a.course_sort_order - b.course_sort_order)
  return course
}

/**
 * Nombres de campaña por id, a través de un RPC SECURITY DEFINER.
 *
 * El embed `campaigns!courses_campaign_id_fkey(name)` solo trae el nombre de las
 * campañas que la RLS deja leer, así que en el catálogo compartido —donde hay
 * cursos de otras campañas— casi todas las tarjetas se quedaban sin cápsula.
 * El RPC devuelve únicamente id + nombre (nada sensible) sin abrir la tabla.
 *
 * No es fatal: si el SQL todavía no se corrió, se queda con lo que trajo el
 * embed y las tarjetas ajenas simplemente no muestran cápsula.
 */
async function fetchCampaignNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.rpc('get_campaign_names', { p_ids: ids })
  if (error) {
    // 42883/PGRST202 = la función aún no existe (SQL pendiente).
    if (error.code !== '42883' && error.code !== 'PGRST202') {
      console.warn('[courses] get_campaign_names', error.message)
    }
    return out
  }
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
    out.set(row.id, row.name)
  }
  return out
}

// ─── Aprendiz ────────────────────────────────────────────────────

/**
 * Todos los cursos visibles para el usuario actual (RLS filtra),
 * clasificados en asignados (campaña o persona) vs. catálogo abierto,
 * con su marca de obligatorio.
 */
export async function getLearnerCourses(
  campaignId: string | null,
  userId: string,
  opts: { preview?: boolean } = {},
): Promise<LearnerCourse[]> {
  // `preview`: vista previa del staff dentro del modal del panel. Ve su curso
  // aunque esté en borrador y sin estar matriculado —así puede revisarlo ANTES
  // de publicarlo—; la RLS sigue mandando sobre qué cursos puede leer.
  const { preview = false } = opts
  const coursesQuery = supabase
    .from('courses')
    // Embed del nombre de la campaña dueña (FK directa courses.campaign_id).
    .select(`*, ${COURSE_MODULES_SELECT}, campaigns!courses_campaign_id_fkey(name)`)
    .order('sort_order')

  const [coursesRes, ccRes, caRes, testIds] = await Promise.all([
    preview ? coursesQuery : coursesQuery.eq('is_published', true),
    campaignId
      ? supabase
          .from('course_campaigns')
          .select('course_id, campaign_id, is_mandatory, assigned_at')
          .eq('campaign_id', campaignId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('course_assignments')
      .select('course_id, user_id, is_mandatory, assigned_by, assigned_at')
      .eq('user_id', userId),
    getTestCampaignIds(),
  ])

  if (coursesRes.error) throw coursesRes.error
  const byCampaign = new Map(
    ((ccRes.data ?? []) as CourseCampaignRow[]).map((r) => [r.course_id, r]),
  )
  const byUser = new Map(
    ((caRes.data ?? []) as CourseAssignmentRow[]).map((r) => [r.course_id, r]),
  )
  // ¿Quien mira vive en el entorno de pruebas? Si la columna `is_test` aún no
  // existe o la RLS no deja leerla, la lista llega vacía y todo cuenta como
  // real: se comporta igual que antes.
  const viewerIsTest = !!campaignId && testIds.includes(campaignId)

  const rows = ((coursesRes.data ?? []) as unknown as (CourseWithModules & {
    campaigns: { name: string } | null
  })[])
    .map(sortCourseModules)
    // El aprendiz solo ve: cursos asignados (a él o a su campaña) o cursos de
    // catálogo abierto. Un curso publicado con visibility='assigned' de otra
    // campaña NO debe aparecer: el RPC self_enroll_course lo rechazaría
    // ("Curso no disponible para auto-inscripción") y el botón Inscribirme
    // fallaría con 400.
    //
    // Al de PRUEBA se le esconde además el catálogo compartido. Un curso de una
    // campaña de prueba nunca llega al catálogo (lo corta un trigger), así que
    // todo lo que hay ahí es del mundo real: si se lo ofrecemos, al pulsar
    // "Inscribirme" la base le responde TEST_SCOPE_MISMATCH. Mejor no
    // ofrecérselo que enseñarle un error. Sus cursos asignados no se tocan.
    .filter((c) => {
      if (preview || byCampaign.has(c.id) || byUser.has(c.id)) return true
      return c.visibility === 'catalog' && !viewerIsTest
    })

  // Completamos los nombres que la RLS no dejó traer en el embed.
  const missing = [...new Set(rows.filter((c) => !c.campaigns?.name).map((c) => c.campaign_id))]
  const names = await fetchCampaignNames(missing)

  return rows.map((c) => {
    const cc = byCampaign.get(c.id)
    const ca = byUser.get(c.id)
    return {
      ...c,
      modules: preview ? c.modules : c.modules.filter((m) => m.is_published),
      isAssigned: !!cc || !!ca,
      isMandatory: (cc?.is_mandatory ?? false) || (ca?.is_mandatory ?? false),
      // Auto-inscrito: existe asignación directa creada por él mismo.
      selfEnrolled: !!ca && ca.assigned_by === userId,
      // Manda la más antigua: el plazo se cuenta desde que de verdad lo tuvo,
      // no desde la última vez que alguien volvió a asignárselo.
      assignedAt: earliest(ca?.assigned_at, cc?.assigned_at),
      campaign_name: c.campaigns?.name ?? names.get(c.campaign_id) ?? null,
    }
  })
}

// ─── Catálogo compartido + matrícula viva ────────────────────────

/**
 * Inscribe (matrícula viva) a varios aprendices de la campaña del capacitador
 * en un curso — típicamente un curso compartido por otra campaña. Escribe
 * `course_assignments`; la RLS valida que los usuarios sean de su campaña y
 * que el curso sea propio o esté publicado al catálogo compartido.
 */
export async function enrollUsers(
  courseId: string,
  userIds: string[],
  isMandatory = false,
): Promise<void> {
  if (userIds.length === 0) return
  await assertCourseScopeMatches(courseId, { userIds })
  const { error } = await supabase.from('course_assignments').upsert(
    userIds.map((user_id) => ({ course_id: courseId, user_id, is_mandatory: isMandatory })),
  )
  if (error) throw error
}

/**
 * Aprendices VIGENTES de una campaña (para el selector de inscripción). A quien
 * Talento Humano ya no reporta no se le asignan cursos nuevos: su cuenta está
 * dada de baja. Ver `src/lib/activeUsers.ts` para por qué se filtra en memoria.
 */
export async function getCampaignLearners(
  campaignId: string,
): Promise<Array<{ id: string; display_name: string | null; campaign_id: string | null }>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'learner')
    .eq('campaign_id', campaignId)
    .order('display_name')
  if (error) throw error
  return onlyActive(data ?? [])
}

/** Auto-inscripción del aprendiz en un curso abierto (catálogo/compartido). */
export async function selfEnroll(courseId: string): Promise<void> {
  // En la vista previa el botón "Inscribirme" se ve (es parte de lo que ve el
  // aprendiz) pero no matricula a nadie: si no, cada revisión del capacitador
  // dejaba una matrícula suya inflando el contador del curso.
  if (IS_LEARNER_PREVIEW) return
  const { error } = await supabase.rpc('self_enroll_course', { p_course_id: courseId })
  if (error) throw error
}

// NOTA: aquí vivían `previewEnrollSelf` / `previewUnenrollSelf` y
// `getSelfEnrolledCourseIds`, el andamiaje del viejo "Ver como aprendiz": el
// staff se matriculaba de verdad en su propio curso para verlo, y luego había
// que ofrecerle salir. Todo eso se eliminó (el staff revisa con la vista previa
// en modal, que no toca la base) y los RPC `preview_enroll_self` /
// `preview_unenroll_self` se borran de la BD con
// supabase/sql/quitar-ver-como-aprendiz.sql.

/** Salir de un curso en el que el aprendiz se auto-inscribió. */
export async function unenrollSelf(courseId: string): Promise<void> {
  if (IS_LEARNER_PREVIEW) return
  const { error } = await supabase.rpc('unenroll_self', { p_course_id: courseId })
  if (error) throw error
}

/**
 * Cuántos aprendices tiene cada campaña. Sirve para mostrar el alcance real de
 * un curso: las personas que lo reciben por campaña no aparecen en la lista de
 * asignaciones individuales. Lo que devuelva depende de la RLS de `profiles`
 * (el capacitador solo ve las suyas), así que es una estimación desde su vista.
 */
export async function getLearnerCountsByCampaign(
  campaignIds: string[],
): Promise<Record<string, number>> {
  if (campaignIds.length === 0) return {}
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'learner')
    .in('campaign_id', campaignIds)
  if (error) throw error
  const counts: Record<string, number> = {}
  // Las cuentas dadas de baja no son alcance del curso: ya no entran al sitio.
  for (const row of onlyActive(data ?? [])) {
    if (row.campaign_id) counts[row.campaign_id] = (counts[row.campaign_id] ?? 0) + 1
  }
  return counts
}

export interface CourseStats {
  /** Aprendices de la campaña del que consulta (superadmin: todas). */
  enrolled: number
  completed: number
  total_modules: number
  completion_pct: number
  avg_progress_pct: number
  /** El que consulta es el dueño del curso. */
  is_owner: boolean
  /** Alcance total en todas las campañas (solo para dueño/superadmin). */
  global_enrolled: number
  /** De `enrolled`, cuántos tienen asignación individual. */
  direct_assigned: number
  /** De `enrolled`, cuántos llegan por campaña asignada (sin fila propia). */
  campaign_reach: number
  /** Filas de staff (previsualizaciones) que NO se cuentan como matrícula. */
  staff_preview: number
}

/** Métricas agregadas de un curso (solo dueño/superadmin). */
export async function getCourseStats(courseId: string): Promise<CourseStats> {
  const { data, error } = await supabase.rpc('get_course_stats', { p_course_id: courseId })
  if (error) throw error
  // Los tres últimos campos los añade la versión de `get_course_stats` que excluye
  // al staff; mientras no se corra ese SQL el RPC viejo no los trae.
  const raw = (data ?? {}) as Partial<CourseStats>
  return {
    enrolled: raw.enrolled ?? 0,
    completed: raw.completed ?? 0,
    total_modules: raw.total_modules ?? 0,
    completion_pct: raw.completion_pct ?? 0,
    avg_progress_pct: raw.avg_progress_pct ?? 0,
    is_owner: raw.is_owner ?? false,
    global_enrolled: raw.global_enrolled ?? 0,
    direct_assigned: raw.direct_assigned ?? 0,
    campaign_reach: raw.campaign_reach ?? 0,
    staff_preview: raw.staff_preview ?? 0,
  }
}

/**
 * Puntaje mínimo (0-100) para aprobar cada módulo del curso. Es la compuerta que
 * define qué significa "completar un módulo" (promedio de sus actividades). Si el
 * curso no existe o no tiene condiciones, devuelve el default.
 */
export async function getCourseModulePassPct(courseId: string): Promise<number> {
  const { data, error } = await supabase
    .from('courses')
    .select('cert_conditions')
    .eq('id', courseId)
    .maybeSingle()
  if (error || !data) return DEFAULT_CERT_CONDITIONS.module_pass_pct
  const cc = data.cert_conditions as CertConditions | null
  return cc?.module_pass_pct ?? DEFAULT_CERT_CONDITIONS.module_pass_pct
}

/** Un curso por slug con sus módulos publicados (para la página de detalle). */
export async function getCourseBySlug(slug: string): Promise<CourseWithModules | null> {
  const { data, error } = await supabase
    .from('courses')
    .select(`*, ${COURSE_MODULES_SELECT}`)
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const course = sortCourseModules(data as unknown as CourseWithModules)
  course.modules = course.modules.filter((m) => m.is_published)
  return course
}

// ─── Admin ───────────────────────────────────────────────────────

/** Cursos de una campaña (dueña) con conteo de módulos, para el CMS. */
export async function getCoursesForCampaign(campaignId: string): Promise<CourseWithModules[]> {
  const { data, error } = await supabase
    .from('courses')
    .select(`*, ${COURSE_MODULES_SELECT}`)
    .eq('campaign_id', campaignId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as unknown as CourseWithModules[]).map(sortCourseModules)
}

/** Curso del CMS con el nombre de su campaña dueña (para la vista "todas"). */
export type AdminCourse = CourseWithModules & { campaign_name: string | null }

/**
 * Todos los cursos de todas las campañas (solo superadmin; la RLS lo permite),
 * con el nombre de la campaña dueña para el CMS.
 */
export async function getAllCourses(): Promise<AdminCourse[]> {
  const { data, error } = await supabase
    .from('courses')
    // Desambiguamos el embed (FK directa vs. puente course_campaigns).
    .select(`*, ${COURSE_MODULES_SELECT}, campaigns!courses_campaign_id_fkey(name)`)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as unknown as (CourseWithModules & { campaigns: { name: string } | null })[])
    .map((c) => ({ ...sortCourseModules(c), campaign_name: c.campaigns?.name ?? null }))
}

export async function getCourseById(courseId: string): Promise<CourseWithModules | null> {
  const { data, error } = await supabase
    .from('courses')
    .select(`*, ${COURSE_MODULES_SELECT}`)
    .eq('id', courseId)
    .maybeSingle()
  if (error) throw error
  return data ? sortCourseModules(data as unknown as CourseWithModules) : null
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

export async function createCourse(
  campaignId: string,
  data: { title_es: string; description_es?: string | null; icon?: string; color?: string },
): Promise<Course> {
  const baseSlug = slugify(data.title_es) || `curso-${Date.now().toString(36)}`
  // `created_by` no se estaba escribiendo nunca, así que TODOS los cursos de la
  // base quedaron sin dueño. Eso deja sin efecto cualquier regla que dependa de
  // quién creó el curso (permisos del capacitador, instructor por defecto de la
  // encuesta) y no hay forma de reconstruirlo después: nadie sabe quién lo hizo.
  const { data: userData } = await supabase.auth.getUser()
  const createdBy = userData.user?.id ?? null

  const tryInsert = (slug: string) =>
    supabase
      .from('courses')
      .insert({ campaign_id: campaignId, slug, created_by: createdBy, ...data })
      .select()
      .single()

  let { data: row, error } = await tryInsert(baseSlug)
  if (error?.code === '23505') {
    ;({ data: row, error } = await tryInsert(`${baseSlug}-${Date.now().toString(36)}`))
  }
  if (error) throw error
  return row as Course
}

/** Curso compartido por otro capacitador, con el nombre de su campaña de origen. */
export type ShareableCourse = CourseWithModules & { campaign_name: string | null }

/**
 * Cursos publicados al catálogo compartido por OTRAS campañas. Son cursos
 * canónicos vivos: el capacitador inscribe a sus aprendices en ellos (no copia).
 * La RLS `courses_select_shared_catalog` permite verlos cross-campaña.
 */
export async function getShareableCourses(ownCampaignId: string): Promise<ShareableCourse[]> {
  const { data, error } = await supabase
    .from('courses')
    // Desambiguamos el embed: entre courses y campaigns hay dos relaciones
    // (la FK directa courses.campaign_id y la puente course_campaigns). Nombramos
    // la FK directa para que PostgREST no falle con "more than one relationship".
    .select(`*, ${COURSE_MODULES_SELECT}, campaigns!courses_campaign_id_fkey(name)`)
    .eq('is_shareable', true)
    .eq('is_published', true)
    .neq('campaign_id', ownCampaignId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as (CourseWithModules & { campaigns: { name: string } | null })[])
    .map((c) => ({
      ...sortCourseModules(c),
      campaign_name: c.campaigns?.name ?? null,
    }))
}

/**
 * Solo id + título de los cursos de la campaña. Lo usa la biblioteca de módulos
 * para etiquetar en qué curso vive cada módulo sin traerse los cursos completos.
 */
export async function getCourseTitlesForCampaign(
  campaignId: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('courses')
    .select('id, title_es')
    .eq('campaign_id', campaignId)
  if (error) throw error
  return Object.fromEntries(((data ?? []) as Array<{ id: string; title_es: string }>).map((c) => [c.id, c.title_es]))
}

/**
 * Títulos (id → title_es) de un conjunto de cursos por id, sin importar la
 * campaña. Lo usa la Biblioteca de módulos para etiquetar "en el curso X" cuando
 * los módulos vienen de varias campañas (superadmin / capacitador multi-campaña).
 */
export async function getCourseTitlesByIds(
  courseIds: string[],
): Promise<Record<string, string>> {
  if (courseIds.length === 0) return {}
  const { data, error } = await supabase
    .from('courses')
    .select('id, title_es')
    .in('id', courseIds)
  if (error) throw error
  return Object.fromEntries(((data ?? []) as Array<{ id: string; title_es: string }>).map((c) => [c.id, c.title_es]))
}

/** Marca/desmarca un curso como compartible con otros capacitadores. */
export async function setCourseShareable(courseId: string, value: boolean): Promise<void> {
  const { error } = await supabase.from('courses').update({ is_shareable: value }).eq('id', courseId)
  if (error) throw error
}

/**
 * Clona un curso compartido a la campaña del capacitador actual (deep-copy del
 * curso + sus módulos + secciones + quizzes). El RPC `clone_course` corre con
 * SECURITY DEFINER y valida la autorización server-side. Devuelve el id del clon.
 */
export async function cloneCourse(sourceCourseId: string): Promise<string> {
  const { data, error } = await supabase.rpc('clone_course', { source_course_id: sourceCourseId })
  if (error) throw error
  return data as string
}

/**
 * Mueve un curso (y TODO su contenido ligado: módulos, mundo(s) + arena y
 * simuladores) a otra campaña. El RPC `move_course_to_campaign` corre con
 * SECURITY DEFINER y valida la autorización server-side: superadmin puede mover
 * a cualquier campaña; un capacitador solo entre campañas de las que es miembro.
 */
export async function moveCourseToCampaign(
  courseId: string,
  targetCampaignId: string,
): Promise<void> {
  const { error } = await supabase.rpc('move_course_to_campaign', {
    p_course_id: courseId,
    p_target_campaign_id: targetCampaignId,
  })
  if (error) throw error
}

export async function updateCourse(
  courseId: string,
  updates: Partial<Omit<Course, 'id' | 'campaign_id' | 'created_at' | 'updated_at' | 'created_by' | 'copied_from'>>,
): Promise<void> {
  const { error } = await supabase.from('courses').update(updates).eq('id', courseId)
  if (error) throw error
}

/**
 * "Borra" un curso. Superadmin -> elimina definitivo (los módulos quedan con
 * course_id NULL). Capacitador -> lo oculta y deja una solicitud de eliminación
 * para que el superadmin la apruebe; el superadmin la manda a la papelera.
 */
export async function deleteCourse(courseId: string): Promise<DeletionResult> {
  return requestDeletion('courses', courseId)
}

// ─── Módulos del curso ───────────────────────────────────────────

export async function addModuleToCourse(
  courseId: string,
  moduleId: string,
  sortOrder: number,
): Promise<void> {
  const { error } = await supabase
    .from('modules')
    .update({ course_id: courseId, course_sort_order: sortOrder })
    .eq('id', moduleId)
  if (error) throw error
}

export async function removeModuleFromCourse(moduleId: string): Promise<void> {
  const { error } = await supabase
    .from('modules')
    .update({ course_id: null, course_sort_order: 0 })
    .eq('id', moduleId)
  if (error) throw error
}

export async function reorderCourseModules(
  ordered: Array<{ id: string; course_sort_order: number }>,
): Promise<void> {
  for (const m of ordered) {
    const { error } = await supabase
      .from('modules')
      .update({ course_sort_order: m.course_sort_order })
      .eq('id', m.id)
    if (error) throw error
  }
}

// ─── Asignaciones ────────────────────────────────────────────────

/**
 * Entorno de pruebas y entorno real no se cruzan: un curso de una campaña de
 * prueba solo se asigna a campañas y personas de prueba, y al revés. Si no, el
 * progreso de las cuentas de prueba acabaría en los KPIs, en el Panorama y en
 * los Excel de verdad.
 *
 * La base tiene el mismo candado (triggers `trg_guard_course_*_test`); esto es
 * para poder dar un mensaje entendible antes de intentarlo.
 */
async function assertCourseScopeMatches(
  courseId: string,
  target: { campaignIds?: string[]; userIds?: string[] },
): Promise<void> {
  const testIds = new Set(await getTestCampaignIds())
  if (testIds.size === 0) return // sin campañas de prueba no hay nada que separar

  const { data: course } = await supabase
    .from('courses')
    .select('campaign_id')
    .eq('id', courseId)
    .maybeSingle()
  const courseIsTest = testIds.has((course as { campaign_id: string } | null)?.campaign_id ?? '')

  const campaignIds = [...(target.campaignIds ?? [])]
  if (target.userIds?.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('campaign_id')
      .in('id', target.userIds)
    for (const p of (profiles ?? []) as Array<{ campaign_id: string | null }>) {
      if (p.campaign_id) campaignIds.push(p.campaign_id)
    }
  }

  if (campaignIds.some((id) => testIds.has(id) !== courseIsTest)) throw new TestScopeError()
}


export async function getCourseCampaigns(courseId: string): Promise<CourseCampaignRow[]> {
  const { data, error } = await supabase
    .from('course_campaigns')
    .select('course_id, campaign_id, is_mandatory')
    .eq('course_id', courseId)
  if (error) throw error
  return (data ?? []) as CourseCampaignRow[]
}

export async function setCourseCampaign(
  courseId: string,
  campaignId: string,
  isMandatory: boolean,
): Promise<void> {
  await assertCourseScopeMatches(courseId, { campaignIds: [campaignId] })
  const { error } = await supabase
    .from('course_campaigns')
    .upsert({ course_id: courseId, campaign_id: campaignId, is_mandatory: isMandatory })
  if (error) throw error
}

export async function removeCourseCampaign(courseId: string, campaignId: string): Promise<void> {
  const { error } = await supabase
    .from('course_campaigns')
    .delete()
    .eq('course_id', courseId)
    .eq('campaign_id', campaignId)
  if (error) throw error
}

export async function getCourseAssignments(courseId: string): Promise<CourseAssignmentRow[]> {
  const { data, error } = await supabase
    .from('course_assignments')
    .select('course_id, user_id, is_mandatory')
    .eq('course_id', courseId)
  if (error) throw error
  return (data ?? []) as CourseAssignmentRow[]
}

/** Asignaciones de cursos de una persona (para asignar cursos desde su ficha). */
export async function getUserCourseAssignments(userId: string): Promise<CourseAssignmentRow[]> {
  const { data, error } = await supabase
    .from('course_assignments')
    .select('course_id, user_id, is_mandatory')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as CourseAssignmentRow[]
}

export async function setCourseAssignment(
  courseId: string,
  userId: string,
  isMandatory: boolean,
): Promise<void> {
  await assertCourseScopeMatches(courseId, { userIds: [userId] })
  const { error } = await supabase
    .from('course_assignments')
    .upsert({ course_id: courseId, user_id: userId, is_mandatory: isMandatory })
  if (error) throw error
}

export async function removeCourseAssignment(courseId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('course_assignments')
    .delete()
    .eq('course_id', courseId)
    .eq('user_id', userId)
  if (error) throw error
}

// ─── Superadmin: cursos de un usuario + restablecer ──────────────

/** Resumen de un curso del catálogo para un usuario, con su desempeño (vista superadmin). */
export interface AdminUserCourse {
  course_id: string
  slug: string
  title_es: string
  icon: string | null
  is_mandatory: boolean
  /** El curso está asignado a la persona (directo o por su campaña) vs. solo catálogo. */
  is_assigned: boolean
  total_modules: number
  /** Desempeño 0-100 (promedio del último intento por unidad), o null si no hay actividad. */
  score: number | null
  /** Fecha (ISO) del último quiz/juego resuelto = cuándo terminó, o null. */
  completed_at: string | null
  /** El usuario ya tiene certificado emitido de este curso. */
  certified: boolean
}

/** Estado real de una persona en un curso (ver `courseState`). */
export type CourseState =
  | 'certified'           // certificado y con el temario cubierto
  | 'certified_outdated'  // certificado, pero el curso tiene módulos que no hizo
  | 'completed'
  | 'in_progress'
  | 'not_started'

/**
 * En qué punto está alguien en un curso. ÚNICA fuente de esta regla.
 *
 * OJO con `completed_at`: pese al nombre, es la fecha del ÚLTIMO quiz o juego
 * resuelto, no la de terminar el curso. Usarlo como prueba de finalización daba
 * "Completado" a quien llevaba 1 de 5 módulos —lo dijo el propio panel, en la
 * misma fila donde mostraba "1 de 5"— y de paso inflaba el contador de cursos
 * completados de la ficha. Aquí solo cuenta como señal de que hubo actividad.
 *
 * `modulesDone` es null mientras no ha llegado el detalle del curso: sin el
 * temario delante no se puede afirmar que esté completo, así que como mucho se
 * dice "en curso".
 */
export function courseState(c: AdminUserCourse, modulesDone: number | null): CourseState {
  if (c.certified) {
    // Un certificado se emite contra el temario que había ESE día. Si después
    // se publicaron módulos, sigue siendo válido pero ya no cubre el curso
    // entero: decir solo "Certificado" haría creer que está al día. Es el caso
    // que la plataforma resuelve con la recertificación (pestaña Certificación
    // del curso), y hasta que se pida, la ficha tiene que decirlo.
    if (modulesDone !== null && c.total_modules > 0 && modulesDone < c.total_modules) {
      return 'certified_outdated'
    }
    return 'certified'
  }
  if (modulesDone !== null && c.total_modules > 0 && modulesDone >= c.total_modules) return 'completed'
  if ((modulesDone ?? 0) > 0 || c.score != null || c.completed_at != null) return 'in_progress'
  return 'not_started'
}

/** ¿Terminó el curso? (certificado o temario completo; nada más cuenta) */
export function isCourseFinished(c: AdminUserCourse, modulesDone: number | null): boolean {
  const st = courseState(c, modulesDone)
  // El certificado desactualizado cuenta como terminado: la persona cumplió lo
  // que se le pidió. Lo que cambió fue el curso, no su esfuerzo.
  return st === 'certified' || st === 'certified_outdated' || st === 'completed'
}

/**
 * TODO el catálogo de cursos con el progreso de una persona (asignados o no),
 * con bandera `is_assigned`. Solo superadmin: la RPC corre SECURITY DEFINER y
 * valida el rol server-side.
 */
export async function getUserCoursesAdmin(userId: string): Promise<AdminUserCourse[]> {
  const { data, error } = await supabase.rpc('get_user_courses_admin', { p_user_id: userId })
  if (error) throw error
  return (data ?? []) as unknown as AdminUserCourse[]
}

// ─── Superadmin: panel global (matriz usuarios × cursos) ─────────

export interface AdminOverviewUser {
  id: string
  display_name: string | null
  role: 'superadmin' | 'capacitador' | 'learner'
  campaign_id: string | null
}

export interface AdminOverviewCourse {
  course_id: string
  title_es: string
  icon: string | null
  campaign_id: string | null
  is_published: boolean
}

export interface AdminOverviewCell {
  user_id: string
  course_id: string
  score: number | null
  completed_at: string | null
  certified: boolean
}

export interface AdminOverview {
  users: AdminOverviewUser[]
  courses: AdminOverviewCourse[]
  progress: AdminOverviewCell[]
}

/**
 * Matriz global de TODOS los usuarios × TODOS los cursos con su desempeño y
 * certificación. Solo superadmin (validado server-side en la RPC).
 */
export async function getAllCoursesProgressAdmin(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc('get_all_courses_progress_admin')
  if (error) throw error
  return (data ?? { users: [], courses: [], progress: [] }) as unknown as AdminOverview
}

/**
 * Restablece el progreso de un usuario en un curso para que lo haga de nuevo:
 * borra intentos/completados/respuestas de los módulos del curso y elimina su
 * certificación e intentos de simulador. Solo superadmin (validado en la RPC).
 */
export async function resetUserCourseAdmin(userId: string, courseId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_user_course_admin', {
    p_user_id: userId,
    p_course_id: courseId,
  })
  if (error) throw error
}

// ─── Portada del curso ───────────────────────────────────────────

export async function uploadCourseCover(
  file: File,
  courseId: string,
  campaignId: string,
): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  // La ruta DEBE empezar con el UUID de la campaña: la política RLS del bucket
  // module-media autoriza la escritura según que el primer segmento de la ruta
  // sea una campaña del usuario (o de la que es miembro). Antes empezaba con el
  // literal "courses/", por eso los capacitadores recibían error al subir la
  // portada mientras que sí podían subir media de sección.
  const path = `${campaignId}/covers/${courseId}/cover-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('module-media')
    .upload(path, file, { contentType: file.type })
  if (error) throw error
  return supabase.storage.from('module-media').getPublicUrl(path).data.publicUrl
}
