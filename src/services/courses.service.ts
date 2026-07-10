import { supabase } from '@/lib/supabase'
import type { CertConditions, Course } from '@/types/database'
import { DEFAULT_CERT_CONDITIONS } from '@/types/database'

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
}

export type CourseWithModules = Course & { modules: CourseModuleSummary[] }

export interface CourseCampaignRow {
  course_id: string
  campaign_id: string
  is_mandatory: boolean
}

export interface CourseAssignmentRow {
  course_id: string
  user_id: string
  is_mandatory: boolean
  assigned_by?: string | null
}

/** Curso enriquecido para el aprendiz. */
export interface LearnerCourse extends CourseWithModules {
  /** Asignado a su campaña o a él directamente (vs. solo catálogo) */
  isAssigned: boolean
  isMandatory: boolean
  /** Se auto-inscribió él mismo (puede salir del curso). */
  selfEnrolled: boolean
}

// Desambiguamos la relación courses<->modules nombrando la FK modules.course_id.
// Si no, un segundo vínculo courses->modules (p. ej. sim_unlock_module_id) vuelve
// ambiguo el embed y PostgREST responde 400 ("more than one relationship").
const COURSE_MODULES_SELECT =
  'modules!modules_course_id_fkey(id, slug, icon, duration_min, course_sort_order, is_published, title_es, title_en, title_pt, subtitle_es, subtitle_en, subtitle_pt)'

function sortCourseModules<T extends { modules: CourseModuleSummary[] }>(course: T): T {
  course.modules = (course.modules ?? []).sort(
    (a, b) => a.course_sort_order - b.course_sort_order,
  )
  return course
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
): Promise<LearnerCourse[]> {
  const [coursesRes, ccRes, caRes] = await Promise.all([
    supabase
      .from('courses')
      .select(`*, ${COURSE_MODULES_SELECT}`)
      .eq('is_published', true)
      .order('sort_order'),
    campaignId
      ? supabase
          .from('course_campaigns')
          .select('course_id, campaign_id, is_mandatory')
          .eq('campaign_id', campaignId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('course_assignments')
      .select('course_id, user_id, is_mandatory, assigned_by')
      .eq('user_id', userId),
  ])

  if (coursesRes.error) throw coursesRes.error
  const byCampaign = new Map(
    ((ccRes.data ?? []) as CourseCampaignRow[]).map((r) => [r.course_id, r]),
  )
  const byUser = new Map(
    ((caRes.data ?? []) as CourseAssignmentRow[]).map((r) => [r.course_id, r]),
  )

  return ((coursesRes.data ?? []) as unknown as CourseWithModules[])
    .map(sortCourseModules)
    .map((c) => {
      const cc = byCampaign.get(c.id)
      const ca = byUser.get(c.id)
      return {
        ...c,
        modules: c.modules.filter((m) => m.is_published),
        isAssigned: !!cc || !!ca,
        isMandatory: (cc?.is_mandatory ?? false) || (ca?.is_mandatory ?? false),
        // Auto-inscrito: existe asignación directa creada por él mismo.
        selfEnrolled: !!ca && ca.assigned_by === userId,
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
  const { error } = await supabase.from('course_assignments').upsert(
    userIds.map((user_id) => ({ course_id: courseId, user_id, is_mandatory: isMandatory })),
  )
  if (error) throw error
}

/** Aprendices de una campaña (para el selector de inscripción). */
export async function getCampaignLearners(
  campaignId: string,
): Promise<Array<{ id: string; display_name: string | null; campaign_id: string | null }>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, campaign_id')
    .eq('role', 'learner')
    .eq('campaign_id', campaignId)
    .order('display_name')
  if (error) throw error
  return data ?? []
}

/** Auto-inscripción del aprendiz en un curso abierto (catálogo/compartido). */
export async function selfEnroll(courseId: string): Promise<void> {
  const { error } = await supabase.rpc('self_enroll_course', { p_course_id: courseId })
  if (error) throw error
}

/**
 * Auto-inscribe al staff (capacitador/superadmin) en un curso PROPIO ya publicado
 * para poder previsualizarlo "como aprendiz". A diferencia de `selfEnroll` (solo
 * cursos de catálogo), esto acepta cualquier curso publicado que el staff gestione.
 * SECURITY DEFINER en el RPC valida rol, propiedad y publicación.
 */
export async function previewEnrollSelf(courseId: string): Promise<void> {
  const { error } = await supabase.rpc('preview_enroll_self', { p_course_id: courseId })
  if (error) throw error
}

/** Salir de un curso en el que el aprendiz se auto-inscribió. */
export async function unenrollSelf(courseId: string): Promise<void> {
  const { error } = await supabase.rpc('unenroll_self', { p_course_id: courseId })
  if (error) throw error
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
}

/** Métricas agregadas de un curso (solo dueño/superadmin). */
export async function getCourseStats(courseId: string): Promise<CourseStats> {
  const { data, error } = await supabase.rpc('get_course_stats', { p_course_id: courseId })
  if (error) throw error
  return data as unknown as CourseStats
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
  const tryInsert = (slug: string) =>
    supabase
      .from('courses')
      .insert({ campaign_id: campaignId, slug, ...data })
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

export async function updateCourse(
  courseId: string,
  updates: Partial<Omit<Course, 'id' | 'campaign_id' | 'created_at' | 'updated_at' | 'created_by' | 'copied_from'>>,
): Promise<void> {
  const { error } = await supabase.from('courses').update(updates).eq('id', courseId)
  if (error) throw error
}

export async function deleteCourse(courseId: string): Promise<void> {
  // Los módulos no se borran: quedan con course_id NULL (vuelven al plan general)
  const { error } = await supabase.from('courses').delete().eq('id', courseId)
  if (error) throw error
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

export async function uploadCourseCover(file: File, courseId: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `courses/${courseId}/cover-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('module-media')
    .upload(path, file, { contentType: file.type })
  if (error) throw error
  return supabase.storage.from('module-media').getPublicUrl(path).data.publicUrl
}
