import { supabase } from '@/lib/supabase'
import type { LearningModule, ModuleSection, SectionQuiz, VideoMarker, VideoQuizMarker } from '@/data/modules'
import type { ContentBlock } from '@/types/blocks'
import type { GeneratedModule } from '@/services/ai.service'
import { requestDeletion, type DeletionResult } from '@/services/audit.service'
import { isMediaUrlSharedInCourse } from '@/services/mediaDuplicates.service'
import { shortFileHash } from '@/lib/fileHash'
import { COURSE_MEDIA_PRESET, isOptimizableImage, optimizeImage } from '@/lib/imageOptimize'

// ─── Raw DB types for video markers ──────────────────────────
// Definidos en @/types/blocks (para poder embeberlos en el bloque de video sin
// acoplar con servicios); se re-exportan aquí para conservar los imports actuales.
export type { VideoMarkerRaw, VideoQuestionRaw } from '@/types/blocks'
import { clampQuizTime, type VideoMarkerRaw } from '@/types/blocks'

/** Idiomas en los que puede venir escrito un marcador. */
const MARKER_LANGS = ['es', 'en', 'pt'] as const

/** ¿Cuántas opciones de verdad (no vacías) trae esta lista? */
function realOptionCount(opts?: string[] | null): number {
  return (opts ?? []).filter((o) => (o ?? '').trim().length > 0).length
}

/**
 * Texto de la pregunta/explicación en el idioma pedido, cayendo a CUALQUIER
 * idioma que sí tenga contenido.
 *
 * El contenido ya no se escribe siempre en español (se genera y se edita en el
 * idioma de la interfaz), así que caer solo al campo `_es` dejaba la pregunta en
 * blanco para todos los demás.
 */
function pickText(q: Record<string, unknown>, field: string, lang: string): string {
  const own = (q[`${field}_${lang}`] as string | undefined)?.trim()
  if (own) return own
  for (const l of MARKER_LANGS) {
    const v = (q[`${field}_${l}`] as string | undefined)?.trim()
    if (v) return v
  }
  return ''
}

/** Párrafos en el idioma pedido, cayendo al primer idioma que tenga alguno. */
function pickList(r: Record<string, unknown>, field: string, lang: string): string[] {
  const own = r[`${field}_${lang}`] as string[] | undefined
  if ((own ?? []).some((p) => (p ?? '').trim())) return own as string[]
  for (const l of MARKER_LANGS) {
    const v = r[`${field}_${l}`] as string[] | undefined
    if ((v ?? []).some((p) => (p ?? '').trim())) return v as string[]
  }
  return own ?? []
}

/**
 * Opciones en el idioma pedido, cayendo al primer idioma que tenga al menos dos
 * opciones escritas. El índice de la correcta es el MISMO en los tres idiomas,
 * así que caer de idioma no descuadra la respuesta.
 */
function pickOptions(q: Record<string, unknown>, lang: string): string[] {
  const own = q[`options_${lang}`] as string[] | undefined
  if (realOptionCount(own) >= 2) return own as string[]
  for (const l of MARKER_LANGS) {
    const v = q[`options_${l}`] as string[] | undefined
    if (realOptionCount(v) >= 2) return v as string[]
  }
  // Ninguno llega a dos: se devuelve lo que haya (quien filtra vuelve a contar).
  for (const l of MARKER_LANGS) {
    const v = q[`options_${l}`] as string[] | undefined
    if (realOptionCount(v) > 0) return v as string[]
  }
  return own ?? []
}

export function mapVideoMarkersFromDb(raw: unknown): VideoMarker[] {
  if (!raw || !Array.isArray(raw)) return []
  return (raw as VideoMarkerRaw[]).map((m) => {
    const mr = m as unknown as Record<string, unknown>
    const base = {
      id: m.id,
      timeSeconds: m.timeSeconds ?? 0,
      title: {
        es: pickText(mr, 'title', 'es'),
        en: pickText(mr, 'title', 'en'),
        pt: pickText(mr, 'title', 'pt'),
      },
    }
    if (m.type === 'quiz') {
      // Solo cuentan las preguntas realmente jugables: con enunciado y al menos
      // dos opciones. Una pregunta a medias (IA interrumpida, edición sin guardar)
      // reventaba el overlay al abrirlo y el video se quedaba trancado.
      // OJO: se mira en los TRES idiomas. Mirando solo `_es` —que en una pregunta
      // nueva viene con cuatro cadenas vacías—, un quiz escrito en inglés o en
      // portugués se daba por vacío y se degradaba a capítulo: el capacitador veía
      // "no me guarda las preguntas" cuando en realidad sí estaban guardadas.
      const questions = (m.questions ?? [])
        .map((q) => q as unknown as Record<string, unknown>)
        .filter((q) => pickText(q, 'question', 'es').length > 0 && realOptionCount(pickOptions(q, 'es')) >= 2)
        .map((q) => {
          const correct = (q.correct as number) ?? 0
          const opts = { es: pickOptions(q, 'es'), en: pickOptions(q, 'en'), pt: pickOptions(q, 'pt') }
          // Las opciones se guardan siempre de a cuatro. Si el capacitador solo
          // escribió dos, las otras dos salían como botones en blanco: se recortan
          // las vacías del final (igual en los tres idiomas, para no mover el
          // índice de la correcta).
          const cut = Math.max(
            correct + 1,
            ...MARKER_LANGS.map((l) => {
              const a = opts[l]
              let last = 0
              a.forEach((o, i) => { if ((o ?? '').trim()) last = i + 1 })
              return last
            }),
          )
          return {
            id: q.id as string,
            question: { es: pickText(q, 'question', 'es'), en: pickText(q, 'question', 'en'), pt: pickText(q, 'question', 'pt') },
            options: { es: opts.es.slice(0, cut), en: opts.en.slice(0, cut), pt: opts.pt.slice(0, cut) },
            correct,
            explanation: { es: pickText(q, 'explanation', 'es'), en: pickText(q, 'explanation', 'en'), pt: pickText(q, 'explanation', 'pt') },
          }
        })

      // Un "quiz" sin ninguna pregunta usable no es un quiz: se degrada a capítulo
      // para que no bloquee el avance del video con una compuerta que nunca se
      // puede abrir.
      if (questions.length === 0) return { ...base, type: 'chapter' as const }

      const qm: VideoQuizMarker = {
        ...base,
        // Un quiz guardado en 0:00 (o casi) jamás se dispararía y dejaría el video
        // bloqueado; lo corremos al mínimo para no romper contenido ya publicado.
        timeSeconds: clampQuizTime(base.timeSeconds),
        type: 'quiz',
        questions,
      }
      return qm
    }
    return { ...base, type: 'chapter' as const }
  })
}

/**
 * ¿El error es "esa columna no existe"? Pasa cuando una migración todavía no se
 * corrió en la base. Sirve para reintentar sin el campo opcional en vez de
 * tumbar la operación entera por un adorno.
 */
function isMissingColumn(error: unknown, column: string): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null
  if (!e) return false
  // PGRST204: PostgREST no la tiene en su caché de esquema. 42703: Postgres.
  if (e.code !== 'PGRST204' && e.code !== '42703') return false
  return `${e.message ?? ''} ${e.details ?? ''}`.includes(column)
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
  /** Lo generó la IA. Opcional: es `undefined` mientras la columna no exista. */
  ai_generated?: boolean
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
  /** La escribió la IA. Opcional: es `undefined` mientras la columna no exista. */
  ai_generated?: boolean
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
      // Todo cae al primer idioma con contenido, no al español: una sección
      // escrita en portugués (el idioma del sitio de quien la escribió) dejaba
      // `_es` vacío y se veía en blanco para todos los demás.
      const sr = s as unknown as Record<string, unknown>
      const section: ModuleSection = {
        heading: {
          es: pickText(sr, 'heading', 'es'),
          en: pickText(sr, 'heading', 'en'),
          pt: pickText(sr, 'heading', 'pt'),
        },
        body: {
          es: pickList(sr, 'body', 'es'),
          en: pickList(sr, 'body', 'en'),
          pt: pickList(sr, 'body', 'pt'),
        },
      }
      // El aviso se muestra si tiene texto en CUALQUIER idioma (antes exigía el
      // español y uno escrito en otro idioma desaparecía de la vista).
      if (s.callout_kind && pickText(sr, 'callout', 'es')) {
        section.callout = {
          kind: s.callout_kind,
          text: {
            es: pickText(sr, 'callout', 'es'),
            en: pickText(sr, 'callout', 'en'),
            pt: pickText(sr, 'callout', 'pt'),
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
          ...(pickText(sr, 'media_caption', 'es') && {
            caption: {
              es: pickText(sr, 'media_caption', 'es'),
              en: pickText(sr, 'media_caption', 'en'),
              pt: pickText(sr, 'media_caption', 'pt'),
            },
          }),
        }
      }
      if (quiz) {
        // Igual que en los marcadores de video: el quiz pudo escribirse en
        // inglés o portugués (se genera en el idioma de la interfaz). Cayendo
        // solo a `_es` —vacío en ese caso— el aprendiz se encontraba la pregunta
        // o las opciones en blanco.
        const qr = quiz as unknown as Record<string, unknown>
        const sq: SectionQuiz = {
          question: {
            es: pickText(qr, 'question', 'es'),
            en: pickText(qr, 'question', 'en'),
            pt: pickText(qr, 'question', 'pt'),
          },
          options: {
            es: pickOptions(qr, 'es'),
            en: pickOptions(qr, 'en'),
            pt: pickOptions(qr, 'pt'),
          },
          correct: quiz.correct_index,
          explanation: {
            es: pickText(qr, 'explanation', 'es'),
            en: pickText(qr, 'explanation', 'en'),
            pt: pickText(qr, 'explanation', 'pt'),
          },
        }
        section.quiz = sq
      }
      if (s.blocks_data && Array.isArray(s.blocks_data) && (s.blocks_data as ContentBlock[]).length > 0) {
        section.blocks = s.blocks_data as ContentBlock[]
      }
      return section
    })

  const rr = row as unknown as Record<string, unknown>
  return {
    id: row.slug,
    dbId: row.id,
    campaign_id: row.campaign_id,
    courseId: row.course_id ?? null,
    courseSortOrder: row.course_sort_order ?? 0,
    icon: row.icon,
    duration: row.duration_min,
    // Mismo criterio que en las secciones: el módulo pudo escribirse en
    // cualquier idioma, así que cada campo cae al primero que tenga contenido.
    title: {
      es: pickText(rr, 'title', 'es'),
      en: pickText(rr, 'title', 'en'),
      pt: pickText(rr, 'title', 'pt'),
    },
    subtitle: {
      es: pickText(rr, 'subtitle', 'es'),
      en: pickText(rr, 'subtitle', 'en'),
      pt: pickText(rr, 'subtitle', 'pt'),
    },
    objectives: {
      es: pickList(rr, 'objectives', 'es'),
      en: pickList(rr, 'objectives', 'en'),
      pt: pickList(rr, 'objectives', 'pt'),
    },
    keyTakeaways: {
      es: pickList(rr, 'key_takeaways', 'es'),
      en: pickList(rr, 'key_takeaways', 'en'),
      pt: pickList(rr, 'key_takeaways', 'pt'),
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
 *
 * `campaignId` puede venir en null: un aprendiz al que todavía no le asignaron
 * campaña igual debe poder abrir los cursos del catálogo (si no, la lista salía
 * vacía y el módulo respondía "Módulo no encontrado"). En ese caso pedimos solo
 * los módulos que pertenecen a algún curso; cuáles de esos cursos puede leer lo
 * decide la RLS. Ojo: su progreso sí necesita campaña (user_progress.campaign_id
 * es NOT NULL), así que esto es una red de seguridad, no el modo normal.
 */
export async function getVisibleModules(campaignId: string | null): Promise<LearningModule[]> {
  const query = supabase
    .from('modules')
    .select(`
      *,
      module_sections (
        *,
        section_quizzes (*)
      )
    `)

  const { data, error } = await (campaignId
    ? query.or(`campaign_id.eq.${campaignId},course_id.not.is.null`)
    : query.not('course_id', 'is', null))
    .eq('is_published', true)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule(row))
}

/**
 * Módulos para la VISTA PREVIA del staff: sin filtrar por `is_published` y sin
 * filtrar por campaña (manda la RLS). Es lo que permite revisar un módulo que
 * todavía está en borrador exactamente como lo verá el aprendiz.
 * Solo se usa dentro del iframe de vista previa y solo si el rol real es staff.
 */
export async function getPreviewModules(): Promise<LearningModule[]> {
  const { data, error } = await supabase
    .from('modules')
    .select(`
      *,
      module_sections (
        *,
        section_quizzes (*)
      )
    `)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule(row))
}

/* ── Variante LIGERA: la misma lista, sin el cuerpo de los módulos ─────────
   El `select` de arriba embebe `module_sections(*, section_quizzes(*))`, y ahí
   viaja `blocks_data`: el contenido completo de cada sección (textos, videos,
   juegos, imágenes). Es lo que hay que traer para PINTAR un módulo, pero la
   mayoría de las pantallas solo necesita la ficha —id, slug, curso, título,
   duración— para contar avance o armar un enlace.

   Para un superadmin la diferencia no es menor: la consulta completa baja el
   contenido de TODA la plataforma. Con esta variante se traen las mismas filas
   sin el embed, y `dbRowToLearningModule` las mapea igual (deja `sections: []`,
   porque hace `row.module_sections ?? []`).

   Regla: si la pantalla no renderiza secciones, pide la ligera. */
const MODULE_LITE_COLUMNS =
  'id, campaign_id, course_id, course_sort_order, slug, icon, duration_min, sort_order, ' +
  'title_es, title_en, title_pt, subtitle_es, subtitle_en, subtitle_pt, ' +
  'objectives_es, objectives_en, objectives_pt, ' +
  'key_takeaways_es, key_takeaways_en, key_takeaways_pt, sound_theme'

/** `getVisibleModules` sin el contenido de las secciones. */
export async function getVisibleModulesLite(campaignId: string | null): Promise<LearningModule[]> {
  const query = supabase.from('modules').select(MODULE_LITE_COLUMNS)

  const { data, error } = await (campaignId
    ? query.or(`campaign_id.eq.${campaignId},course_id.not.is.null`)
    : query.not('course_id', 'is', null))
    .eq('is_published', true)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule({ ...row, module_sections: [] }))
}

/** `getAllPublishedModules` sin el contenido de las secciones. */
export async function getAllPublishedModulesLite(): Promise<LearningModule[]> {
  const { data, error } = await supabase
    .from('modules')
    .select(MODULE_LITE_COLUMNS)
    .eq('is_published', true)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule({ ...row, module_sections: [] }))
}

/** `getPreviewModules` sin el contenido de las secciones. */
export async function getPreviewModulesLite(): Promise<LearningModule[]> {
  const { data, error } = await supabase
    .from('modules')
    .select(MODULE_LITE_COLUMNS)
    .order('sort_order')

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => dbRowToLearningModule({ ...row, module_sections: [] }))
}

/**
 * UN módulo por su id, con todo su contenido. Es la contraparte de las consultas
 * ligeras: la pantalla del módulo pide la lista sin cuerpo (para los hermanos y
 * la navegación) y el cuerpo de UNO solo — el que se está leyendo. Antes se
 * traía el contenido de todos los módulos visibles para mostrar uno.
 *
 * Va por `id` y no por `slug` a propósito: el slug NO es único en toda la base
 * (dos campañas pueden tener cada una su "introduccion"), así que buscar por
 * slug podía devolver el módulo de otra campaña. Quien llama ya resolvió el
 * UUID en la lista visible, que es además donde se decide el acceso; la RLS
 * sigue siendo la última palabra.
 *
 * Devuelve null si no existe o si la RLS no lo deja leer.
 */
export async function getModuleById(moduleId: string): Promise<LearningModule | null> {
  const { data, error } = await supabase
    .from('modules')
    .select(`
      *,
      module_sections (
        *,
        section_quizzes (*)
      )
    `)
    .eq('id', moduleId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return dbRowToLearningModule(data as any)
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
 * y deja solicitud de eliminación para aprobación; el superadmin, a la papelera.
 */
export async function deleteModule(moduleId: string): Promise<DeletionResult> {
  return requestDeletion('modules', moduleId)
}

/**
 * Mueve un módulo SUELTO (sin curso) a otra campaña. Los módulos que ya están en
 * un curso se mueven con el curso (moveCourseToCampaign) y el RPC los rechaza. El
 * RPC `move_module_to_campaign` valida la autorización server-side: superadmin a
 * cualquier campaña; capacitador solo entre campañas de las que es miembro.
 */
export async function moveModuleToCampaign(
  moduleId: string,
  targetCampaignId: string,
): Promise<void> {
  const { error } = await supabase.rpc('move_module_to_campaign', {
    p_module_id: moduleId,
    p_target_campaign_id: targetCampaignId,
  })
  if (error) throw error
}

/**
 * Devuelve un slug libre dentro de la campaña. IMPORTANTE: el progreso del
 * aprendiz (`user_progress.completed_modules`) se guarda por SLUG, no por UUID.
 * Si dos módulos de la misma campaña comparten slug, al completar uno el otro
 * aparece "completado" sin que el aprendiz lo haya visto. Por eso el slug se
 * desambigua ANTES de insertar (además del índice único en BD).
 *
 * Cuenta también los módulos BORRADOS: su slug sigue quemado, porque el progreso
 * del aprendiz conserva el slug del módulo eliminado y reutilizarlo le heredaría
 * la completitud. Si la RLS de borrado suave los oculta, el insert choca con el
 * índice único y el reintento 23505 de `createModule` resuelve con sufijo.
 */
export async function freeSlugInCampaign(campaignId: string, base: string): Promise<string> {
  const { data } = await supabase
    .from('modules')
    .select('slug')
    .eq('campaign_id', campaignId)
    .like('slug', `${base}%`)
  const taken = new Set((data ?? []).map((r) => (r as { slug: string }).slug))
  if (!taken.has(base)) return base
  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
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
  const baseSlug = await freeSlugInCampaign(campaignId, data.slug)
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

/**
 * Campaña dueña de un módulo. La usa la lista al seguir a una persona cuya
 * presencia no trajo la campaña (p. ej. viene de una vista que no la publica):
 * sin esto, la lista se queda en la campaña equivocada y el módulo "no aparece".
 * Devuelve null si no se puede leer (un capacitador no ve campañas ajenas).
 */
export async function getModuleCampaignId(moduleId: string): Promise<string | null> {
  const { data } = await supabase
    .from('modules')
    .select('campaign_id')
    .eq('id', moduleId)
    .maybeSingle()
  return (data?.campaign_id as string | undefined) ?? null
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

/**
 * Módulos disponibles para la Biblioteca de módulos: superadmin ve TODOS (para
 * traer cualquier módulo a cualquier curso); el capacitador solo los de las
 * campañas de las que es miembro (casa + colaboraciones). La RLS ya acota, pero
 * acotamos también en el cliente para no traer de más.
 */
export async function getLibraryModules(opts: {
  isSuperAdmin: boolean
  campaignIds: string[]
}): Promise<DbModuleRow[]> {
  let query = supabase.from('modules').select('*, module_sections(id)').order('sort_order')
  if (!opts.isSuperAdmin) {
    if (opts.campaignIds.length === 0) return []
    query = query.in('campaign_id', opts.campaignIds)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as DbModuleRow[]
}

/**
 * Trae un módulo SUELTO a un curso (posiblemente de otra campaña): el mismo
 * módulo cambia de curso y pasa a la campaña del curso destino. RPC SECURITY
 * DEFINER: superadmin cualquier módulo/curso; capacitador solo entre sus campañas.
 */
export async function attachModuleToCourse(moduleId: string, courseId: string): Promise<void> {
  const { error } = await supabase.rpc('attach_module_to_course', {
    p_module_id: moduleId,
    p_course_id: courseId,
  })
  if (error) throw error
}

/**
 * Copia (deep-copy independiente) un módulo a un curso, creándolo en la campaña
 * del curso destino. Devuelve el id del clon. RPC SECURITY DEFINER con la misma
 * autorización que attachModuleToCourse.
 */
export async function cloneModuleToCourse(moduleId: string, courseId: string): Promise<string> {
  const { data, error } = await supabase.rpc('clone_module_to_course', {
    p_module_id: moduleId,
    p_course_id: courseId,
  })
  if (error) throw error
  return data as string
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
  /** Marca de "lo escribió la IA". Se omite si la columna todavía no existe. */
  ai_generated?: boolean
}): Promise<{ id: string }> {
  const { video_markers, blocks_data, media_shadow, ai_generated, ...rest } = section
  const base = {
    ...rest,
    media_shadow: media_shadow ?? false,
    ...(video_markers !== undefined ? { video_markers: video_markers as import('@/types/database').Json | null } : {}),
    ...(blocks_data !== undefined ? { blocks_data: blocks_data as import('@/types/database').Json | null } : {}),
  }

  const save = (payload: typeof base & { ai_generated?: boolean }) =>
    supabase.from('module_sections').upsert(payload).select('id').single()

  let { data, error } = await save(
    ai_generated !== undefined ? { ...base, ai_generated } : base,
  )
  // La marca es un adorno: si el SQL no se ha corrido, se guarda sin ella antes
  // que perder la sección entera.
  if (error && ai_generated !== undefined && isMissingColumn(error, 'ai_generated')) {
    ;({ data, error } = await save(base))
  }
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
                  // Los quiz nunca se guardan en 0:00: ahí no se disparan.
                  timeSeconds: m.type === 'quiz' ? clampQuizTime(m.timeSeconds) : m.timeSeconds,
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
  /** Huella ya calculada por el llamador (la detección de duplicados la calcula
   *  antes de subir); se pasa para no volver a leer el archivo entero. */
  precomputedHash?: string | null,
): Promise<string> {
  // La huella del contenido viaja en el nombre del objeto: así la URL pública
  // basta para reconocer el mismo archivo subido dos veces al curso, sin tabla
  // ni columna extra. Ver `lib/fileHash` y `mediaDuplicates.service`.
  //
  // Se calcula sobre el archivo ORIGINAL, antes de optimizar: dos personas que
  // suben la misma captura tienen que dar la misma huella aunque el navegador
  // de cada una comprima distinto.
  const hash = precomputedHash !== undefined ? precomputedHash : await shortFileHash(file)

  // Las imágenes se reescalan y recomprimen en el navegador. Es la diferencia
  // entre guardar la captura de 6 MB que salió de la tecla ImprPant y guardar
  // los ~180 KB que realmente se ven en el módulo — y esa resta la paga el
  // aprendiz en datos cada vez que abre la sección. Videos, PDFs y GIFs viajan
  // tal cual. Ver `lib/imageOptimize`.
  const payload = isOptimizableImage(file.type)
    ? await optimizeImage(file, COURSE_MEDIA_PRESET)
    : { blob: file as Blob, ext: file.name.split('.').pop() ?? 'bin' }

  const path = `${campaignId}/${moduleId}/${sectionId}/${Date.now()}${hash ? `-${hash}` : ''}.${payload.ext}`
  const { error } = await supabase.storage.from('module-media').upload(path, payload.blob, {
    contentType: payload.blob.type || file.type,
    // El nombre lleva timestamp + huella: el objeto nunca cambia de contenido,
    // así que el navegador puede quedárselo un año en vez de revalidarlo cada
    // hora (que es el defecto de Supabase Storage).
    cacheControl: '31536000',
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
 *
 * `media_url` cubre los medios a nivel de sección, pero los bloques `pdf` y
 * `video` guardan su URL dentro de `blocks_data`, donde ese conteo no llega — y
 * "usar el mismo archivo" (detección de duplicados) hace que varios bloques
 * compartan un objeto a propósito. Por eso, cuando el llamador sabe en qué
 * módulo está, se barre además el curso entero.
 */
export async function deleteSectionMedia(publicUrl: string, moduleId?: string): Promise<void> {
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

  if (moduleId && (await isMediaUrlSharedInCourse(moduleId, publicUrl))) return

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
  'cards', 'stat', 'hotspot', 'pdf',
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
/**
 * Guarda UNA sección generada por IA dentro de un módulo que ya existe (el botón
 * "Crear con IA" del editor). Es el cuerpo del bucle de `saveGeneratedModule`
 * sacado aparte: mismo tratamiento de estilos, bloques y figuras, para que una
 * sección añadida después no salga distinta a las que nacieron con el módulo.
 *
 * Se guarda de una vez, sección por sección: si la tarea se cancela a la mitad,
 * lo ya escrito se queda en el módulo en vez de perderse.
 */
export async function saveGeneratedSection(
  campaignId: string,
  moduleId: string,
  section: GeneratedModule['sections'][number],
  sortOrder: number,
  images: GenSourceImage[] = [],
): Promise<{ id: string }> {
  const sectionStyle = (VALID_SECTION_STYLES.has(section.section_style ?? '')
    ? section.section_style
    : 'default') as DbSectionRow['section_style']

  const headings = {
    heading_es: section.heading_es,
    heading_en: section.heading_en,
    heading_pt: section.heading_pt,
  }

  const { id: sectionId } = await upsertSection({
    module_id: moduleId,
    sort_order: sortOrder,
    ...headings,
    body_es: [],
    section_style: sectionStyle,
    ai_generated: true,
  })

  const blocks = await buildSectionBlocks(section.blocks ?? [], images, campaignId, moduleId, sectionId)
  if (blocks.length) {
    await upsertSection({
      id: sectionId,
      module_id: moduleId,
      sort_order: sortOrder,
      ...headings,
      body_es: [],
      section_style: sectionStyle,
      blocks_data: blocks,
      ai_generated: true,
    })
  }

  return { id: sectionId }
}

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

  const meta = {
    objectives_es: metadata.objectives_es,
    objectives_en: metadata.objectives_en,
    objectives_pt: metadata.objectives_pt,
    key_takeaways_es: metadata.key_takeaways_es,
    key_takeaways_en: metadata.key_takeaways_en,
    key_takeaways_pt: metadata.key_takeaways_pt,
  }
  const { error: metaError } = await supabase
    .from('modules')
    .update({ ...meta, ai_generated: true })
    .eq('id', moduleId)
  // Igual que en las secciones: sin la columna se guarda el resto y la marca
  // se pierde, pero el módulo no.
  if (metaError && isMissingColumn(metaError, 'ai_generated')) {
    await supabase.from('modules').update(meta).eq('id', moduleId)
  }

  for (let i = 0; i < sections.length; i++) {
    await saveGeneratedSection(campaignId, moduleId, sections[i], i + 1, images)
  }

  return moduleId
}
