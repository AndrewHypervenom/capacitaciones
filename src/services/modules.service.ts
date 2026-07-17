import { supabase } from '@/lib/supabase'
import type { LearningModule, ModuleSection, SectionQuiz, VideoMarker, VideoQuizMarker } from '@/data/modules'
import type { ContentBlock } from '@/types/blocks'
import type { GeneratedModule } from '@/services/ai.service'
import { requestDeletion } from '@/services/audit.service'

// ─── Raw DB types for video markers ──────────────────────────
// Definidos en @/types/blocks (para poder embeberlos en el bloque de video sin
// acoplar con servicios); se re-exportan aquí para conservar los imports actuales.
export type { VideoMarkerRaw, VideoQuestionRaw } from '@/types/blocks'
import type { VideoMarkerRaw } from '@/types/blocks'

export function mapVideoMarkersFromDb(raw: unknown): VideoMarker[] {
  if (!raw || !Array.isArray(raw)) return []
  return (raw as VideoMarkerRaw[]).map((m) => {
    const base = {
      id: m.id,
      timeSeconds: m.timeSeconds ?? 0,
      title: { es: m.title_es || '', en: m.title_en || m.title_es || '', pt: m.title_pt || m.title_es || '' },
    }
    if (m.type === 'quiz') {
      const qm: VideoQuizMarker = {
        ...base,
        type: 'quiz',
        questions: (m.questions ?? []).map((q) => ({
          id: q.id,
          question: { es: q.question_es || '', en: q.question_en || q.question_es || '', pt: q.question_pt || q.question_es || '' },
          options: { es: q.options_es || [], en: q.options_en || q.options_es || [], pt: q.options_pt || q.options_es || [] },
          correct: q.correct ?? 0,
          explanation: { es: q.explanation_es || '', en: q.explanation_en || q.explanation_es || '', pt: q.explanation_pt || q.explanation_es || '' },
        })),
      }
      return qm
    }
    return { ...base, type: 'chapter' as const }
  })
}

// ─── Raw DB types for admin editor ───────────────────────────

export interface DbModuleRow {
  id: string
  campaign_id: string
  course_id?: string | null
  course_sort_order?: number
  slug: string
  icon: string
  duration_min: number
  sort_order: number
  title_es: string
  title_en: string | null
  title_pt: string | null
  subtitle_es: string | null
  subtitle_en: string | null
  subtitle_pt: string | null
  objectives_es: string[]
  objectives_en: string[] | null
  objectives_pt: string[] | null
  key_takeaways_es: string[]
  key_takeaways_en: string[] | null
  key_takeaways_pt: string[] | null
  sound_theme: string | null
  is_published: boolean
  /** Módulo del que se clonó este (deep-copy). NULL = original. Ver cloneModule. */
  copied_from?: string | null
  created_at: string
  updated_at: string
  module_sections?: Array<{ id: string; sort_order?: number }>
}

export type DbModuleWithSections = Omit<DbModuleRow, 'module_sections'> & {
  module_sections: DbSectionRow[]
}

export interface DbSectionRow {
  id: string
  module_id: string
  sort_order: number
  heading_es: string
  heading_en: string | null
  heading_pt: string | null
  body_es: string[]
  body_en: string[] | null
  body_pt: string[] | null
  callout_kind: 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note' | null
  callout_es: string | null
  callout_en: string | null
  callout_pt: string | null
  media_type: 'image' | 'youtube' | 'vimeo' | 'video' | null
  media_url: string | null
  media_caption_es: string | null
  media_caption_en: string | null
  media_caption_pt: string | null
  media_size: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
  media_align: 'left' | 'center' | 'right' | null
  media_shadow: boolean
  // ✅ FIX: se agregó 'game-classify' al union type
  section_style: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify' | null
  video_markers: VideoMarkerRaw[] | null
  blocks_data: ContentBlock[] | null
  section_quizzes: DbQuizRow[]
}

export interface DbQuizRow {
  id: string
  section_id: string
  question_es: string
  question_en: string | null
  question_pt: string | null
  options_es: string[]
  options_en: string[] | null
  options_pt: string[] | null
  correct_index: number
  explanation_es: string | null
  explanation_en: string | null
  explanation_pt: string | null
}

function dbRowToLearningModule(
  row: {
    id: string
    campaign_id: string
    course_id?: string | null
    course_sort_order?: number
    slug: string
    icon: string
    duration_min: number
    sort_order: number
    title_es: string
    title_en: string | null
    title_pt: string | null
    subtitle_es: string | null
    subtitle_en: string | null
    subtitle_pt: string | null
    objectives_es: string[]
    objectives_en: string[] | null
    objectives_pt: string[] | null
    key_takeaways_es: string[]
    key_takeaways_en: string[] | null
    key_takeaways_pt: string[] | null
    sound_theme?: string | null
    module_sections: Array<{
      id: string
      sort_order: number
      heading_es: string
      heading_en: string | null
      heading_pt: string | null
      body_es: string[]
      body_en: string[] | null
      body_pt: string[] | null
      callout_kind: 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note' | null
      callout_es: string | null
      callout_en: string | null
      callout_pt: string | null
      media_type: 'image' | 'youtube' | 'vimeo' | 'video' | null
      media_url: string | null
      media_caption_es: string | null
      media_caption_en: string | null
      media_caption_pt: string | null
      media_size: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
      media_align: 'left' | 'center' | 'right' | null
      media_shadow: boolean
      section_style: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify' | null
      video_markers: unknown
      blocks_data: unknown
      section_quizzes: Array<{
        question_es: string
        question_en: string | null
        question_pt: string | null
        options_es: string[]
        options_en: string[] | null
        options_pt: string[] | null
        correct_index: number
        explanation_es: string | null
        explanation_en: string | null
        explanation_pt: string | null
      }> | null
    }>
  }
): LearningModule {
  const sections: ModuleSection[] = (row.module_sections ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => {
      const rawQ = s.section_quizzes as unknown
      type QuizItem = NonNullable<typeof s.section_quizzes>[number]
      const quizArr: QuizItem[] = !rawQ ? [] : Array.isArray(rawQ) ? (rawQ as QuizItem[]) : [rawQ as QuizItem]
      const quiz = quizArr[0]
      const section: ModuleSection = {
        heading: {
          es: s.heading_es,
          en: s.heading_en ?? s.heading_es,
          pt: s.heading_pt ?? s.heading_es,
        },
        body: {
          es: s.body_es ?? [],
          en: s.body_en ?? s.body_es ?? [],
          pt: s.body_pt ?? s.body_es ?? [],
        },
      }
      if (s.callout_kind && s.callout_es) {
        section.callout = {
          kind: s.callout_kind,
          text: {
            es: s.callout_es,
            en: s.callout_en ?? s.callout_es,
            pt: s.callout_pt ?? s.callout_es,
          },
        }
      }
      if (s.section_style && s.section_style !== 'default') {
        section.style = s.section_style as import('@/data/modules').SectionStyle
      }
      section.id = s.id
      if (s.section_style === 'video-interactive' && s.video_markers) {
        section.videoMarkers = mapVideoMarkersFromDb(s.video_markers)
      }
      if (s.media_type && s.media_url) {
        section.media = {
          type: s.media_type,
          url: s.media_url,
          size: s.media_size ?? 'full',
          align: s.media_align ?? 'center',
          shadow: s.media_shadow ?? false,
          ...(s.media_caption_es && {
            caption: {
              es: s.media_caption_es,
              en: s.media_caption_en ?? s.media_caption_es,
              pt: s.media_caption_pt ?? s.media_caption_es,
            },
          }),
        }
      }
      if (quiz) {
        const sq: SectionQuiz = {
          question: {
            es: quiz.question_es,
            en: quiz.question_en ?? quiz.question_es,
            pt: quiz.question_pt ?? quiz.question_es,
          },
          options: {
            es: quiz.options_es ?? [],
            en: quiz.options_en ?? quiz.options_es ?? [],
            pt: quiz.options_pt ?? quiz.options_es ?? [],
          },
          correct: quiz.correct_index,
          explanation: {
            es: quiz.explanation_es ?? '',
            en: quiz.explanation_en ?? quiz.explanation_es ?? '',
            pt: quiz.explanation_pt ?? quiz.explanation_es ?? '',
          },
        }
        section.quiz = sq
      }
      if (s.blocks_data && Array.isArray(s.blocks_data) && (s.blocks_data as ContentBlock[]).length > 0) {
        section.blocks = s.blocks_data as ContentBlock[]
      }
      return section
    })

  return {
    id: row.slug,
    dbId: row.id,
    campaign_id: row.campaign_id,
    courseId: row.course_id ?? null,
    courseSortOrder: row.course_sort_order ?? 0,
    icon: row.icon,
    duration: row.duration_min,
    title: {
      es: row.title_es,
      en: row.title_en ?? row.title_es,
      pt: row.title_pt ?? row.title_es,
    },
    subtitle: {
      es: row.subtitle_es ?? '',
      en: row.subtitle_en ?? row.subtitle_es ?? '',
      pt: row.subtitle_pt ?? row.subtitle_es ?? '',
    },
    objectives: {
      es: row.objectives_es ?? [],
      en: row.objectives_en ?? row.objectives_es ?? [],
      pt: row.objectives_pt ?? row.objectives_es ?? [],
    },
    keyTakeaways: {
      es: row.key_takeaways_es ?? [],
      en: row.key_takeaways_en ?? row.key_takeaways_es ?? [],
      pt: row.key_takeaways_pt ?? row.key_takeaways_es ?? [],
    },
    soundTheme: row.sound_theme ?? 'chime',
    sections,
  }
}

export async function getModulesForCampaign(campaignId: string): Promise<LearningModule[]> {
  const { data, error } = await supabase
    .from('modules')
    .select(`
      *,
      module_sections (
        *,
        section_quizzes (*)
      )
    `)
    .eq('campaign_id', campaignId)
    .eq('is_published', true)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule(row))
}

/**
 * Módulos visibles para el usuario: los de su campaña + los de cursos
 * visibles (asignados o de catálogo, incluso de otras campañas).
 * RLS se encarga de filtrar los cursos a los que no tiene acceso.
 */
export async function getVisibleModules(campaignId: string): Promise<LearningModule[]> {
  const { data, error } = await supabase
    .from('modules')
    .select(`
      *,
      module_sections (
        *,
        section_quizzes (*)
      )
    `)
    .or(`campaign_id.eq.${campaignId},course_id.not.is.null`)
    .eq('is_published', true)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule(row))
}

/** Todos los módulos publicados de todas las campañas (superadmin ve todo). */
export async function getAllPublishedModules(): Promise<LearningModule[]> {
  const { data, error } = await supabase
    .from('modules')
    .select(`
      *,
      module_sections (
        *,
        section_quizzes (*)
      )
    `)
    .eq('is_published', true)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule(row))
}

export async function getAllModulesForCampaign(campaignId: string): Promise<LearningModule[]> {
  const { data, error } = await supabase
    .from('modules')
    .select(`
      *,
      module_sections (
        *,
        section_quizzes (*)
      )
    `)
    .eq('campaign_id', campaignId)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule(row))
}

export async function upsertModule(
  campaignId: string,
  module: Omit<LearningModule, 'sections'> & { id: string },
) {
  const { data, error } = await supabase
    .from('modules')
    .upsert({
      campaign_id: campaignId,
      slug: module.id,
      icon: module.icon,
      duration_min: module.duration,
      title_es: module.title.es,
      title_en: module.title.en,
      title_pt: module.title.pt,
      subtitle_es: module.subtitle.es,
      subtitle_en: module.subtitle.en,
      subtitle_pt: module.subtitle.pt,
      objectives_es: module.objectives.es,
      objectives_en: module.objectives.en,
      objectives_pt: module.objectives.pt,
      key_takeaways_es: module.keyTakeaways.es,
      key_takeaways_en: module.keyTakeaways.en,
      key_takeaways_pt: module.keyTakeaways.pt,
      is_published: true,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function toggleModulePublished(moduleId: string, isPublished: boolean) {
  const { error } = await supabase
    .from('modules')
    .update({ is_published: isPublished })
    .eq('id', moduleId)
  if (error) throw error
}

/**
 * "Borra" un módulo. Superadmin -> elimina definitivo. Capacitador -> lo oculta
 * y deja solicitud de eliminación para aprobación. Devuelve 'deleted' | 'pending'.
 */
export async function deleteModule(moduleId: string): Promise<'deleted' | 'pending'> {
  return requestDeletion('modules', moduleId)
}

export async function createModule(
  campaignId: string,
  data: {
    slug: string
    icon: string
    duration_min: number
    title_es: string
    title_en?: string | null
    title_pt?: string | null
    subtitle_es?: string | null
    subtitle_en?: string | null
    subtitle_pt?: string | null
  },
): Promise<{ id: string }> {
  const { data: maxRow } = await supabase
    .from('modules')
    .select('sort_order')
    .eq('campaign_id', campaignId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const maxOrder = maxRow?.sort_order ?? 0
  const baseSlug = data.slug
  const tryInsert = async (slug: string) => supabase
    .from('modules')
    .insert({
      campaign_id: campaignId,
      sort_order: maxOrder + 1,
      objectives_es: [],
      key_takeaways_es: [],
      is_published: false,
      ...data,
      slug,
    })
    .select('id')
    .single()

  let { data: row, error } = await tryInsert(baseSlug)

  if (error?.code === '23505') {
    const fallbackSlug = `${baseSlug}-${Date.now().toString(36)}`
    ;({ data: row, error } = await tryInsert(fallbackSlug))
  }

  if (error) throw error
  return row as { id: string }
}

/**
 * Copia en profundidad un módulo: `modules` -> `module_sections` -> `section_quizzes`.
 *
 * Existe porque `modules.course_id` es una FK directa: un módulo solo puede vivir
 * en UN curso. Reutilizar contenido en otro curso obliga a duplicar las filas, y
 * eso es justo lo que se quiere aquí — la copia es 100% independiente y se edita
 * sin tocar el original.
 *
 * Los medios (`media_url`) se REUSAN por referencia, no se copian: el bucket
 * `module-media` es compartido y duplicar archivos consumiría el cupo de Storage.
 * `deleteSectionMedia` protege ese archivo mientras alguna sección lo referencie.
 *
 * La copia nace en borrador a propósito: se clona para personalizar, y publicarla
 * antes de editarla expondría contenido a medias al aprendiz.
 *
 * @param onProgress Recibe (secciones copiadas, total) para poder mostrar avance.
 */
export async function cloneModule(
  sourceModuleId: string,
  opts: {
    targetCourseId?: string | null
    courseSortOrder?: number
    /** Sufijo del título, p. ej. " (copia)". Vacío = mismo título que el original. */
    titleSuffix?: string
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<{ id: string }> {
  const src = await getModuleWithSectionsRaw(sourceModuleId)
  const suffix = opts.titleSuffix ?? ''
  const withSuffix = (v: string | null) => (v ? `${v}${suffix}` : v)

  const { data: maxRow } = await supabase
    .from('modules')
    .select('sort_order')
    .eq('campaign_id', src.campaign_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const basePayload = {
    campaign_id: src.campaign_id,
    course_id: opts.targetCourseId ?? null,
    course_sort_order: opts.courseSortOrder ?? 0,
    icon: src.icon,
    duration_min: src.duration_min,
    sort_order: (maxRow?.sort_order ?? 0) + 1,
    title_es: `${src.title_es}${suffix}`,
    title_en: withSuffix(src.title_en),
    title_pt: withSuffix(src.title_pt),
    subtitle_es: src.subtitle_es,
    subtitle_en: src.subtitle_en,
    subtitle_pt: src.subtitle_pt,
    objectives_es: src.objectives_es ?? [],
    objectives_en: src.objectives_en,
    objectives_pt: src.objectives_pt,
    key_takeaways_es: src.key_takeaways_es ?? [],
    key_takeaways_en: src.key_takeaways_en,
    key_takeaways_pt: src.key_takeaways_pt,
    sound_theme: src.sound_theme,
    is_published: false,
    copied_from: sourceModuleId,
  }

  // `slug` es único por campaña, así que el sufijo -copy choca en cuanto se clona
  // dos veces: reintentamos con marca de tiempo (mismo patrón que createModule).
  const { copied_from, ...withoutLineage } = basePayload
  const tryInsert = async (slug: string, lineage: boolean) =>
    supabase
      .from('modules')
      .insert({ ...withoutLineage, slug, ...(lineage ? { copied_from } : {}) })
      .select('id')
      .single()

  const uniqueSlug = () => `${src.slug}-copy-${Date.now().toString(36)}`

  let { data: row, error } = await tryInsert(`${src.slug}-copy`, true)

  // `copied_from` es una columna nueva (SQL 2026-07-16). Mientras no se corra la
  // migración, PostgREST responde PGRST204: clonamos sin linaje en vez de romper
  // la acción entera.
  if (error?.code === 'PGRST204') {
    ;({ data: row, error } = await tryInsert(`${src.slug}-copy`, false))
    if (error?.code === '23505') ({ data: row, error } = await tryInsert(uniqueSlug(), false))
  } else if (error?.code === '23505') {
    ;({ data: row, error } = await tryInsert(uniqueSlug(), true))
  }

  if (error) throw error
  const newModuleId = (row as { id: string }).id

  const sections = src.module_sections ?? []
  opts.onProgress?.(0, sections.length)

  // Secuencial y no en lote: necesitamos el id real de cada sección para colgarle
  // su quiz, y así podemos reportar avance en un contenido que puede ser largo.
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const { id: _sid, module_id: _mid, section_quizzes, video_markers, blocks_data, ...sectionFields } = s
    const { data: newSection, error: sErr } = await supabase
      .from('module_sections')
      .insert({
        ...sectionFields,
        module_id: newModuleId,
        // Los jsonb viajan tipados como su forma de dominio; la BD los ve como Json.
        video_markers: video_markers as import('@/types/database').Json | null,
        blocks_data: blocks_data as import('@/types/database').Json | null,
      })
      .select('id')
      .single()
    if (sErr) throw sErr

    const quizzes = section_quizzes ?? []
    if (quizzes.length) {
      const { error: qErr } = await supabase.from('section_quizzes').insert(
        quizzes.map((q) => {
          const { id: _qid, section_id: _qsid, ...quizFields } = q
          return { ...quizFields, section_id: (newSection as { id: string }).id }
        }),
      )
      if (qErr) throw qErr
    }
    opts.onProgress?.(i + 1, sections.length)
  }

  return { id: newModuleId }
}

export async function getModulesRaw(campaignId: string): Promise<DbModuleRow[]> {
  const { data, error } = await supabase
    .from('modules')
    .select('*, module_sections(id)')
    .eq('campaign_id', campaignId)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as unknown as DbModuleRow[]
}

export async function getModuleWithSectionsRaw(moduleId: string): Promise<DbModuleWithSections> {
  const { data, error } = await supabase
    .from('modules')
    .select('*, module_sections(*, section_quizzes(*))')
    .eq('id', moduleId)
    .single()
  if (error) throw error
  const row = data as unknown as DbModuleWithSections
  row.module_sections = (row.module_sections ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => {
      const rawQ = s.section_quizzes as unknown
      s.section_quizzes = !rawQ ? [] : Array.isArray(rawQ) ? rawQ : [rawQ as DbQuizRow]
      return s
    })
  return row
}

export async function updateModuleMetadata(
  moduleId: string,
  updates: Partial<Omit<DbModuleRow, 'id' | 'campaign_id' | 'created_at' | 'updated_at' | 'module_sections'>>,
) {
  const { error } = await supabase.from('modules').update(updates).eq('id', moduleId)
  if (error) throw error
}

export async function upsertSection(section: {
  id?: string
  module_id: string
  sort_order: number
  heading_es: string
  heading_en?: string | null
  heading_pt?: string | null
  body_es: string[]
  body_en?: string[] | null
  body_pt?: string[] | null
  callout_kind?: 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note' | null
  callout_es?: string | null
  callout_en?: string | null
  callout_pt?: string | null
  media_type?: 'image' | 'youtube' | 'vimeo' | 'video' | null
  media_url?: string | null
  media_caption_es?: string | null
  media_caption_en?: string | null
  media_caption_pt?: string | null
  media_size?: 'sm' | 'md' | 'lg' | 'full' | 'bleed' | null
  media_align?: 'left' | 'center' | 'right' | null
  media_shadow?: boolean | null
  // ✅ ya tenía 'game-classify', sin cambios
  section_style?: 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify' | null
  video_markers?: VideoMarkerRaw[] | null
  blocks_data?: ContentBlock[] | null
}): Promise<{ id: string }> {
  const { video_markers, blocks_data, media_shadow, ...rest } = section
  const payload = {
    ...rest,
    media_shadow: media_shadow ?? false,
    ...(video_markers !== undefined ? { video_markers: video_markers as import('@/types/database').Json | null } : {}),
    ...(blocks_data !== undefined ? { blocks_data: blocks_data as import('@/types/database').Json | null } : {}),
  }
  const { data, error } = await supabase
    .from('module_sections')
    .upsert(payload)
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

export async function deleteSection(sectionId: string) {
  const { error } = await supabase.from('module_sections').delete().eq('id', sectionId)
  if (error) throw error
}

export async function upsertSectionQuiz(quiz: {
  id?: string
  section_id: string
  question_es: string
  question_en?: string | null
  question_pt?: string | null
  options_es: string[]
  options_en?: string[] | null
  options_pt?: string[] | null
  correct_index: number
  explanation_es?: string | null
  explanation_en?: string | null
  explanation_pt?: string | null
}): Promise<{ id: string }> {
  const { id, ...payload } = quiz
  if (id) {
    const { data, error } = await supabase
      .from('section_quizzes')
      .update(payload)
      .eq('id', id)
      .select('id')
      .single()
    if (error) throw error
    return data as { id: string }
  }
  await supabase.from('section_quizzes').delete().eq('section_id', quiz.section_id)
  const { data, error } = await supabase
    .from('section_quizzes')
    .insert(payload)
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

export async function deleteSectionQuiz(sectionId: string) {
  const { error } = await supabase.from('section_quizzes').delete().eq('section_id', sectionId)
  if (error) throw error
}

export async function seedCampaignContent(campaignId: string): Promise<{ modules: number; sections: number }> {
  const { MODULES } = await import('@/data/modules')
  let totalSections = 0

  for (let i = 0; i < MODULES.length; i++) {
    const m = MODULES[i]

    const { data: moduleRow, error: moduleError } = await supabase
      .from('modules')
      .upsert(
        {
          campaign_id: campaignId,
          slug: m.id,
          icon: m.icon,
          duration_min: m.duration,
          sort_order: i,
          title_es: m.title.es,
          title_en: m.title.en,
          title_pt: m.title.pt,
          subtitle_es: m.subtitle.es,
          subtitle_en: m.subtitle.en,
          subtitle_pt: m.subtitle.pt,
          objectives_es: m.objectives.es,
          objectives_en: m.objectives.en,
          objectives_pt: m.objectives.pt,
          key_takeaways_es: m.keyTakeaways.es,
          key_takeaways_en: m.keyTakeaways.en,
          key_takeaways_pt: m.keyTakeaways.pt,
          is_published: true,
        },
        { onConflict: 'campaign_id,slug' },
      )
      .select('id')
      .single()

    if (moduleError || !moduleRow) continue

    await supabase.from('module_sections').delete().eq('module_id', moduleRow.id)

    for (let j = 0; j < m.sections.length; j++) {
      const s = m.sections[j]

      const isVideoInteractive = s.style === 'video-interactive'
      const { data: sectionRow, error: sectionError } = await supabase
        .from('module_sections')
        .insert({
          module_id: moduleRow.id,
          sort_order: j,
          heading_es: s.heading.es,
          heading_en: s.heading.en,
          heading_pt: s.heading.pt,
          body_es: isVideoInteractive ? [] : s.body.es,
          body_en: isVideoInteractive ? null : s.body.en,
          body_pt: isVideoInteractive ? null : s.body.pt,
          callout_kind: isVideoInteractive ? null : (s.callout?.kind ?? null),
          callout_es: isVideoInteractive ? null : (s.callout?.text.es ?? null),
          callout_en: isVideoInteractive ? null : (s.callout?.text.en ?? null),
          callout_pt: isVideoInteractive ? null : (s.callout?.text.pt ?? null),
          section_style: s.style ?? null,
          media_type: s.media?.type ?? null,
          media_url: s.media?.url ?? null,
          media_caption_es: s.media?.caption?.es ?? null,
          media_caption_en: s.media?.caption?.en ?? null,
          media_caption_pt: s.media?.caption?.pt ?? null,
          media_size: s.media?.size ?? null,
          media_align: s.media?.align ?? null,
          media_shadow: s.media?.shadow ?? false,
          video_markers: isVideoInteractive && s.videoMarkers
            ? s.videoMarkers.map((m) => {
                const base = {
                  id: m.id,
                  timeSeconds: m.timeSeconds,
                  type: m.type,
                  title_es: m.title.es,
                  title_en: m.title.en,
                  title_pt: m.title.pt,
                }
                if (m.type === 'quiz') {
                  return {
                    ...base,
                    questions: (m as import('@/data/modules').VideoQuizMarker).questions.map((q) => ({
                      id: q.id,
                      question_es: q.question.es,
                      question_en: q.question.en,
                      question_pt: q.question.pt,
                      options_es: q.options.es,
                      options_en: q.options.en,
                      options_pt: q.options.pt,
                      correct: q.correct,
                      explanation_es: q.explanation.es,
                      explanation_en: q.explanation.en,
                      explanation_pt: q.explanation.pt,
                    })),
                  }
                }
                return base
              })
            : null,
        })
        .select('id')
        .single()

      if (sectionError || !sectionRow) continue
      totalSections++

      if (s.quiz) {
        await supabase.from('section_quizzes').insert({
          section_id: sectionRow.id,
          question_es: s.quiz.question.es,
          question_en: s.quiz.question.en,
          question_pt: s.quiz.question.pt,
          options_es: s.quiz.options.es,
          options_en: s.quiz.options.en,
          options_pt: s.quiz.options.pt,
          correct_index: s.quiz.correct,
          explanation_es: s.quiz.explanation.es,
          explanation_en: s.quiz.explanation.en,
          explanation_pt: s.quiz.explanation.pt,
        })
      }
    }
  }

  return { modules: MODULES.length, sections: totalSections }
}

export async function uploadSectionMedia(
  file: File,
  campaignId: string,
  moduleId: string,
  sectionId: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `${campaignId}/${moduleId}/${sectionId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('module-media').upload(path, file, {
    contentType: file.type,
    // @ts-expect-error onUploadProgress es válido en Supabase Storage JS v2
    onUploadProgress: onProgress
      ? (e: { loaded: number; total: number }) =>
          onProgress(Math.round((e.loaded / e.total) * 100))
      : undefined,
  })
  if (error) throw error
  return supabase.storage.from('module-media').getPublicUrl(path).data.publicUrl
}

/**
 * Quita el archivo del bucket, PERO solo si ninguna otra sección lo usa.
 *
 * `cloneModule` copia `media_url` por referencia (no duplica el archivo), así que
 * el original y sus copias apuntan al mismo objeto de Storage. Sin esta comprobación,
 * cambiar la imagen en una copia dejaría rota la sección del módulo original.
 */
export async function deleteSectionMedia(publicUrl: string): Promise<void> {
  const prefix = '/storage/v1/object/public/module-media/'
  const idx = publicUrl.indexOf(prefix)
  if (idx === -1) return

  // La fila que se está limpiando todavía apunta a la URL, por eso el umbral es >1.
  // Ante un error de conteo no borramos: perder cupo de Storage es preferible a
  // dejar una sección ajena sin su medio.
  const { count, error: countErr } = await supabase
    .from('module_sections')
    .select('id', { count: 'exact', head: true })
    .eq('media_url', publicUrl)
  if (countErr || (count ?? 0) > 1) return

  const path = decodeURIComponent(publicUrl.slice(idx + prefix.length))
  const { error } = await supabase.storage.from('module-media').remove([path])
  if (error) throw error
}

// ─── Guardado de módulos generados por IA (con bloques dinámicos) ─

export interface GenSourceImage {
  mediaType: string
  dataBase64: string
}

const VALID_BLOCK_TYPES = new Set<string>([
  'paragraph', 'heading', 'list', 'image', 'video', 'callout', 'quiz',
  'flashcard', 'accordion', 'tabs', 'code', 'quote', 'divider', 'columns', 'timeline', 'comparison',
  'cards', 'stat', 'hotspot',
  'game-sort', 'game-classify',
])

const CLASSIFY_COLORS = ['purple', 'pink', 'red', 'orange', 'blue', 'green']

/**
 * Sanea un bloque de juego que emite la IA: rellena ids faltantes de forma determinista
 * y descarta el bloque si no tiene la estructura mínima para funcionar (devuelve null).
 * Así un juego mal formado nunca se guarda roto en el módulo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeGameBlock(block: any): ContentBlock | null {
  if (block.type === 'game-sort') {
    // Estandarizamos en el formato plano `steps` (una sola lista ordenada), que es el que
    // entiende tanto el renderer (vía fallback legado) como el editor inline del admin.
    // Si la IA emitiera `processes`, tomamos los pasos del primer proceso.
    const rawSteps = Array.isArray(block.steps) && block.steps.length
      ? block.steps
      : (Array.isArray(block.processes) && block.processes[0]?.steps) || []

    const steps = rawSteps
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((s: any) => s && typeof s === 'object' && s.text)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((s: any, si: number) => ({ id: String(s.id ?? `s${si + 1}`), text: s.text }))

    // Solo aporta como juego si hay al menos 2 pasos que ordenar.
    if (steps.length < 2) return null
    return { type: 'game-sort', title: block.title, instructions: block.instructions, steps } as unknown as ContentBlock
  }

  if (block.type === 'game-classify') {
    const categories = (Array.isArray(block.categories) ? block.categories : [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c && typeof c === 'object' && c.name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any, ci: number) => ({
        ...c,
        id: String(c.id ?? `cat-${ci + 1}`),
        color: CLASSIFY_COLORS.includes(c.color) ? c.color : CLASSIFY_COLORS[ci % CLASSIFY_COLORS.length],
      }))
    const validIds = new Set(categories.map((c: { id: string }) => c.id))

    const cases = (Array.isArray(block.cases) ? block.cases : [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c && typeof c === 'object' && c.text && validIds.has(String(c.correctCategoryId)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any, ci: number) => ({ ...c, id: String(c.id ?? `case-${ci + 1}`), correctCategoryId: String(c.correctCategoryId) }))

    // Necesita al menos 2 categorías y casos válidos que apunten a categorías existentes.
    if (categories.length < 2 || cases.length < 2) return null
    return { ...block, categories, cases } as ContentBlock
  }

  return block as ContentBlock
}

const VALID_SECTION_STYLES = new Set<string>(['default', 'immersive', 'spotlight', 'feature'])

function aiSlugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
}

function base64ToFile(base64: string, mediaType: string, baseName: string): File {
  const ext = (mediaType.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg')
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], `${baseName}.${ext}`, { type: mediaType })
}

/**
 * Convierte los bloques que emite la IA en `ContentBlock[]` reales: valida el tipo y
 * resuelve los bloques de imagen subiendo la figura referenciada (image_index) a storage.
 */
async function buildSectionBlocks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aiBlocks: any[],
  images: GenSourceImage[],
  campaignId: string,
  moduleId: string,
  sectionId: string,
): Promise<ContentBlock[]> {
  const out: ContentBlock[] = []
  const uploaded = new Map<number, string>()

  for (const block of aiBlocks) {
    if (!block || typeof block !== 'object' || !VALID_BLOCK_TYPES.has(block.type)) continue

    if (block.type === 'image' || block.type === 'hotspot') {
      const idx = block.image_index
      if (typeof idx !== 'number' || idx < 0 || idx >= images.length) continue
      try {
        let url = uploaded.get(idx)
        if (!url) {
          const img = images[idx]
          const file = base64ToFile(img.dataBase64, img.mediaType, `bloque-${idx}`)
          url = await uploadSectionMedia(file, campaignId, moduleId, sectionId)
          uploaded.set(idx, url)
        }
        if (block.type === 'hotspot') {
          out.push({
            type: 'hotspot',
            url,
            caption: block.caption,
            points: Array.isArray(block.points) ? block.points : [],
          } as ContentBlock)
        } else {
          out.push({
            type: 'image',
            url,
            caption: block.caption,
            size: 'lg',
            align: 'center',
            shadow: true,
          } as ContentBlock)
        }
      } catch {
        // Si la subida falla, se omite solo ese bloque.
      }
    } else if (block.type === 'game-sort' || block.type === 'game-classify') {
      const normalized = normalizeGameBlock(block)
      if (normalized) out.push(normalized)
    } else {
      out.push(block as ContentBlock)
    }
  }

  return out
}

/**
 * Crea un módulo (como borrador) a partir de un `GeneratedModule` de la IA, con sus
 * secciones de bloques dinámicos. `images` son las figuras del documento que los
 * bloques de imagen pueden referenciar por índice (vacío cuando no hay documento).
 */
export async function saveGeneratedModule(
  campaignId: string,
  generated: GeneratedModule,
  images: GenSourceImage[] = [],
): Promise<string> {
  const { metadata, sections } = generated
  const { id: moduleId } = await createModule(campaignId, {
    slug: metadata.slug || aiSlugify(metadata.title_es),
    icon: metadata.icon,
    duration_min: metadata.duration_min,
    title_es: metadata.title_es,
    title_en: metadata.title_en,
    title_pt: metadata.title_pt,
    subtitle_es: metadata.subtitle_es,
    subtitle_en: metadata.subtitle_en,
    subtitle_pt: metadata.subtitle_pt,
  })

  await supabase.from('modules').update({
    objectives_es: metadata.objectives_es,
    objectives_en: metadata.objectives_en,
    objectives_pt: metadata.objectives_pt,
    key_takeaways_es: metadata.key_takeaways_es,
    key_takeaways_en: metadata.key_takeaways_en,
    key_takeaways_pt: metadata.key_takeaways_pt,
  }).eq('id', moduleId)

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const sectionStyle = (VALID_SECTION_STYLES.has(s.section_style ?? '')
      ? s.section_style
      : 'default') as DbSectionRow['section_style']
    const { id: sectionId } = await upsertSection({
      module_id: moduleId,
      sort_order: i + 1,
      heading_es: s.heading_es,
      heading_en: s.heading_en,
      heading_pt: s.heading_pt,
      body_es: [],
      section_style: sectionStyle,
    })

    const blocks = await buildSectionBlocks(s.blocks ?? [], images, campaignId, moduleId, sectionId)
    if (blocks.length) {
      await upsertSection({
        id: sectionId,
        module_id: moduleId,
        sort_order: i + 1,
        heading_es: s.heading_es,
        heading_en: s.heading_en,
        heading_pt: s.heading_pt,
        body_es: [],
        section_style: sectionStyle,
        blocks_data: blocks,
      })
    }
  }

  return moduleId
}
