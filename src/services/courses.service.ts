import { supabase } from '@/lib/supabase'
import type { Course } from '@/types/database'

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
}

/** Curso enriquecido para el aprendiz. */
export interface LearnerCourse extends CourseWithModules {
  /** Asignado a su campaña o a él directamente (vs. solo catálogo) */
  isAssigned: boolean
  isMandatory: boolean
}

const COURSE_MODULES_SELECT =
  'modules(id, slug, icon, duration_min, course_sort_order, is_published, title_es, title_en, title_pt, subtitle_es, subtitle_en, subtitle_pt)'

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
      .select('course_id, user_id, is_mandatory')
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
      }
    })
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

export async function updateCourse(
  courseId: string,
  updates: Partial<Omit<Course, 'id' | 'campaign_id' | 'created_at' | 'updated_at' | 'created_by'>>,
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
