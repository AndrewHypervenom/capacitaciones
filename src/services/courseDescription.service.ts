import { supabase } from '@/lib/supabase'
import { moduleAiAssist } from '@/services/ai.service'
import { blockPlainText } from '@/lib/blockPlainText'

/* ────────────────────────────────────────────────────────────────────────────
   Descripción del curso con IA — "cuaderno de fuentes cerrado"

   La descripción se redacta SOLO con lo que el curso ya tiene: títulos,
   secciones, el texto de sus bloques, objetivos y puntos clave de cada módulo,
   y los datos del curso (nivel, duración, número de módulos). La IA no busca
   en internet ni completa con lo que "sabe" del tema: cada idea que escribe
   trae el número del módulo de donde salió, para que el capacitador lo
   verifique antes de guardar.
   ──────────────────────────────────────────────────────────────────────────── */

type Lang = 'es' | 'en' | 'pt'

export type DescriptionLength = 'short' | 'medium' | 'long'
export type DescriptionInclude = 'audience' | 'outcomes' | 'structure'

export interface CourseSourceModule {
  id: string
  title: string
  subtitle: string | null
  minutes: number
  objectives: string[]
  takeaways: string[]
  sections: Array<{ heading: string; text: string }>
  /** Caracteres de texto real (sin títulos): mide si hay de dónde escribir. */
  chars: number
}

export interface CourseDescriptionResult {
  insufficient: boolean
  reason: string
  description: string
  sources: Array<{ point: string; modules: number[] }>
  removed: string[]
}

/** Primero el idioma pedido y después cualquiera que tenga algo. */
function pick(r: Record<string, unknown>, field: string, lang: Lang): string {
  for (const l of [lang, 'es', 'en', 'pt']) {
    const v = (r[`${field}_${l}`] as string | null | undefined)?.trim()
    if (v) return v
  }
  return ''
}

function pickList(r: Record<string, unknown>, field: string, lang: Lang): string[] {
  for (const l of [lang, 'es', 'en', 'pt']) {
    const v = ((r[`${field}_${l}`] as string[] | null | undefined) ?? []).filter((x) => x?.trim())
    if (v.length) return v
  }
  return []
}

/**
 * El contenido de los módulos vivos del curso, en su orden, listo para
 * mandárselo a la IA. [] si el curso aún no tiene módulos.
 */
export async function loadCourseSources(courseId: string, lang: Lang): Promise<CourseSourceModule[]> {
  const { data: mods, error } = await supabase
    .from('modules')
    .select('id, course_sort_order, duration_min, deleted_at, title_es, title_en, title_pt, subtitle_es, subtitle_en, subtitle_pt, objectives_es, objectives_en, objectives_pt, key_takeaways_es, key_takeaways_en, key_takeaways_pt')
    .eq('course_id', courseId)
    .order('course_sort_order')
  if (error) throw error

  // El borrado suave solo marca `deleted_at`: sin este filtro se describirían
  // módulos que ya nadie ve en el curso.
  const live = (mods ?? []).filter((m) => !m.deleted_at) as Array<Record<string, unknown>>
  if (!live.length) return []

  const { data: secs, error: secErr } = await supabase
    .from('module_sections')
    .select('module_id, sort_order, heading_es, heading_en, heading_pt, body_es, body_en, body_pt, callout_es, callout_en, callout_pt, media_caption_es, media_caption_en, media_caption_pt, blocks_data')
    .in('module_id', live.map((m) => m.id as string))
    .order('sort_order')
  // Un error de lectura NO debe parecer "curso vacío": se propaga.
  if (secErr) throw secErr

  const byModule = new Map<string, Array<Record<string, unknown>>>()
  for (const s of (secs ?? []) as Array<Record<string, unknown>>) {
    const list = byModule.get(s.module_id as string) ?? []
    list.push(s)
    byModule.set(s.module_id as string, list)
  }

  return live.map((m) => {
    const sections = (byModule.get(m.id as string) ?? []).map((s) => {
      const raw = s.blocks_data as unknown
      const blocks = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { blocks?: unknown } | null)?.blocks)
          ? ((raw as { blocks: unknown[] }).blocks)
          : []
      const text = [
        ...pickList(s, 'body', lang),
        pick(s, 'callout', lang),
        pick(s, 'media_caption', lang),
        ...blocks.map((b) => blockPlainText(b, lang) || blockPlainText(b, 'es')),
      ].filter((x) => x?.trim()).join('\n')
      return { heading: pick(s, 'heading', lang), text }
    })
    return {
      id: m.id as string,
      title: pick(m, 'title', lang),
      subtitle: pick(m, 'subtitle', lang) || null,
      minutes: (m.duration_min as number) ?? 0,
      objectives: pickList(m, 'objectives', lang),
      takeaways: pickList(m, 'key_takeaways', lang),
      sections,
      chars: sections.reduce((n, s) => n + s.text.trim().length, 0),
    }
  })
}

/** ¿Hay de dónde escribir? Al menos un módulo con texto de verdad, no solo títulos. */
export function hasEnoughSource(modules: CourseSourceModule[]): boolean {
  return modules.reduce((n, m) => n + m.chars, 0) >= 200
}

/**
 * Redacta (o reescribe) la descripción con el contenido del curso como única
 * fuente. No guarda ni cobra cupo: eso lo decide quien llama.
 */
export async function generateCourseDescription(opts: {
  courseTitle: string
  lang: Lang
  level?: string | null
  languageTarget?: string | null
  modules: CourseSourceModule[]
  length: DescriptionLength
  include: DescriptionInclude[]
  instruction?: string
  /** Descripción actual para reescribirla; vacío = escribir desde cero. */
  current?: string
}): Promise<CourseDescriptionResult> {
  // Los números de módulo de `sources` son posiciones en ESTA lista (base 1).
  const withContent = opts.modules
  const totalMinutes = withContent.reduce((n, m) => n + (m.minutes || 0), 0)
  const { data } = await moduleAiAssist({
    action: 'course_description',
    contentType: 'meta',
    sourceLang: opts.lang,
    fields: {},
    moduleTitle: opts.courseTitle,
    // Se escribe en el idioma de la pestaña que se está editando, no en el del sitio.
    language: opts.lang,
    courseDescription: {
      courseTitle: opts.courseTitle,
      level: opts.level ?? undefined,
      totalMinutes: totalMinutes || undefined,
      languageTarget: opts.languageTarget ?? null,
      length: opts.length,
      include: opts.include,
      instruction: opts.instruction?.trim() || undefined,
      current: opts.current?.trim() || undefined,
      modules: withContent.map((m) => ({
        title: m.title,
        subtitle: m.subtitle,
        minutes: m.minutes || undefined,
        objectives: m.objectives,
        takeaways: m.takeaways,
        sections: m.sections,
      })),
    },
  })

  const d = (data ?? {}) as Partial<CourseDescriptionResult>
  const max = withContent.length
  return {
    insufficient: !!d.insufficient,
    reason: String(d.reason ?? ''),
    description: String(d.description ?? '').trim(),
    // Un número de módulo que no existe sería una fuente inventada: se descarta.
    sources: (Array.isArray(d.sources) ? d.sources : [])
      .map((s) => ({
        point: String(s?.point ?? '').trim(),
        modules: (Array.isArray(s?.modules) ? s.modules : [])
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= max),
      }))
      .filter((s) => s.point),
    removed: (Array.isArray(d.removed) ? d.removed : []).map(String).filter((x) => x.trim() && x !== '...'),
  }
}
