import { supabase } from '@/lib/supabase'
import type { LearningModule, ModuleSection, SectionQuiz, VideoMarker, VideoQuizMarker } from '@/data/modules'
import type { ContentBlock } from '@/types/blocks'

// ─── Raw DB types for video markers ──────────────────────────

export interface VideoQuestionRaw {
  id: string
  question_es: string
  question_en: string
  question_pt: string
  options_es: string[]
  options_en: string[]
  options_pt: string[]
  correct: number
  explanation_es: string
  explanation_en: string
  explanation_pt: string
}

export interface VideoMarkerRaw {
  id: string
  timeSeconds: number
  type: 'chapter' | 'quiz'
  title_es: string
  title_en: string
  title_pt: string
  questions?: VideoQuestionRaw[]
}

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
  is_published: boolean
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
  media_type: 'image' | 'youtube' | 'video' | null
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
      media_type: 'image' | 'youtube' | 'video' | null
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

export async function deleteModule(moduleId: string) {
  const { error } = await supabase.from('modules').delete().eq('id', moduleId)
  if (error) throw error
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
  media_type?: 'image' | 'youtube' | 'video' | null
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

export async function deleteSectionMedia(publicUrl: string): Promise<void> {
  const prefix = '/storage/v1/object/public/module-media/'
  const idx = publicUrl.indexOf(prefix)
  if (idx === -1) return
  const path = decodeURIComponent(publicUrl.slice(idx + prefix.length))
  const { error } = await supabase.storage.from('module-media').remove([path])
  if (error) throw error
}