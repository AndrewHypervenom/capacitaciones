/* ────────────────────────────────────────────────────────────────────────────
   El contenido real de un curso, en texto plano.

   Es la "fuente cerrada" del examen: lo mismo que hace el modo documento con un
   PDF, pero con el curso que ya está escrito en la plataforma. Antes al modelo
   solo se le mandaba el índice (títulos, objetivos y encabezados) y se le pedía
   que no se saliera de ahí — con un índice, no salirse es imposible: para
   escribir una pregunta con cuatro opciones tenía que poner de su cosecha.

   Aquí se baja el TEXTO: los párrafos de cada sección, los avisos, y lo que
   traigan los bloques (listas, acordeones, pestañas, tarjetas, líneas de
   tiempo…). Los quizzes de sección NO entran: para eso está "Reutilizar
   quizzes", y colarlos aquí haría que el examen repitiera lo que el módulo ya
   preguntó.
   ──────────────────────────────────────────────────────────────────────────── */

import { supabase } from '@/lib/supabase'

/** Tope de lo que se manda al modelo. Por encima, el costo se dispara. */
export const SOURCE_CHAR_LIMIT = 60_000

export interface CourseSource {
  /** El contenido, ya ordenado y en texto plano. */
  text: string
  chars: number
  modules: number
  sections: number
  /** `true` si el curso no cabía entero y se cortó en SOURCE_CHAR_LIMIT. */
  truncated: boolean
  /** Módulos sin nada escrito: el aviso honesto de que ahí no hay qué evaluar. */
  emptyModules: string[]
}

/** Campos multilenguaje del contenido: `{ es, en, pt }`. Aquí solo interesa `es`. */
function isMultilang(v: unknown): v is { es?: unknown } {
  return typeof v === 'object' && v !== null && 'es' in (v as Record<string, unknown>)
}

/** Claves que llevan rutas o identificadores, no texto que se pueda evaluar. */
const SKIP_KEYS = new Set([
  'url', 'src', 'href', 'poster', 'thumbnail', 'filename', 'id', 'type', 'kind',
  'color', 'icon', 'align', 'size', 'level', 'variant', 'style',
])

/**
 * Saca todo el texto en español de un bloque, sea del tipo que sea.
 *
 * Recorre el objeto en vez de tener un `switch` por tipo de bloque a propósito:
 * cada bloque nuevo (y ya van más de veinte) tendría que acordarse de pasar por
 * aquí, y el que se olvidara desaparecería del examen sin que nadie lo notara.
 */
function blockText(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return []
  if (typeof value === 'string') {
    const s = value.trim()
    // Las URLs sueltas no dicen nada evaluable.
    return s && !/^https?:\/\//i.test(s) ? [s] : []
  }
  if (Array.isArray(value)) return value.flatMap((v) => blockText(v, depth + 1))
  if (isMultilang(value)) return blockText(value.es, depth + 1)
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      SKIP_KEYS.has(k) ? [] : blockText(v, depth + 1),
    )
  }
  return []
}

/** Tope del contenido de UN módulo. Más chico que el del curso: es una parte. */
export const MODULE_SOURCE_CHAR_LIMIT = 40_000

export interface ModuleSource {
  /** El contenido del módulo en texto plano, en el orden en que se lee. */
  text: string
  /** Los encabezados que ya existen, en orden. Sirven para no repetir temas. */
  headings: string[]
  chars: number
  truncated: boolean
}

/**
 * Lo mismo que `getCourseSource` pero de UN módulo, para escribirle una sección
 * nueva con IA: sin este texto, la IA solo vería el índice y tendría que sacarse
 * el contenido de la cabeza (o repetir lo que la sección de al lado ya dice).
 */
export async function getModuleSource(moduleId: string): Promise<ModuleSource> {
  const { data: mod, error } = await supabase
    .from('modules')
    .select('title_es, subtitle_es, objectives_es, key_takeaways_es')
    .eq('id', moduleId)
    .maybeSingle()
  if (error) throw error

  const m = (mod ?? null) as {
    title_es?: string
    subtitle_es?: string | null
    objectives_es?: string[] | null
    key_takeaways_es?: string[] | null
  } | null
  if (!m) return { text: '', headings: [], chars: 0, truncated: false }

  const { data: sectionRows } = await supabase
    .from('module_sections')
    .select('heading_es, body_es, callout_es, blocks_data, sort_order')
    .eq('module_id', moduleId)
    .order('sort_order')

  type Sec = {
    heading_es: string
    body_es: string[] | null
    callout_es: string | null
    blocks_data: unknown
  }
  const secs = (sectionRows ?? []) as Sec[]

  const lines: string[] = [`═══ MÓDULO: ${m.title_es ?? ''} ═══`]
  if (m.subtitle_es) lines.push(m.subtitle_es)
  if (m.objectives_es?.length) lines.push(`Objetivos: ${m.objectives_es.join(' · ')}`)
  if (m.key_takeaways_es?.length) lines.push(`Puntos clave: ${m.key_takeaways_es.join(' · ')}`)

  for (const s of secs) {
    const parts: string[] = []
    if (s.body_es?.length) parts.push(...s.body_es.filter(Boolean))
    if (s.callout_es) parts.push(`Nota importante: ${s.callout_es}`)
    parts.push(...blockText(s.blocks_data))
    lines.push(`\n── ${s.heading_es} ──`)
    lines.push(parts.length ? parts.join('\n') : '(sección sin texto)')
  }

  let text = lines.join('\n')
  const truncated = text.length > MODULE_SOURCE_CHAR_LIMIT
  if (truncated) {
    text = `${text.slice(0, MODULE_SOURCE_CHAR_LIMIT)}\n\n[…el módulo sigue, pero se cortó aquí por tamaño…]`
  }

  return {
    text,
    headings: secs.map((s) => s.heading_es).filter(Boolean),
    chars: text.length,
    truncated,
  }
}

/**
 * Arma la fuente cerrada del curso: todo lo que el aprendiz puede leer, en el
 * mismo orden en que lo lee.
 */
export async function getCourseSource(courseId: string): Promise<CourseSource> {
  const { data: modules, error } = await supabase
    .from('modules')
    .select('id, title_es, subtitle_es, objectives_es, key_takeaways_es, course_sort_order')
    .eq('course_id', courseId)
    .is('deleted_at', null)
    .order('course_sort_order')
  if (error) throw error

  type Mod = {
    id: string
    title_es: string
    subtitle_es: string | null
    objectives_es: string[] | null
    key_takeaways_es: string[] | null
  }
  const mods = (modules ?? []) as Mod[]
  const empty: CourseSource = {
    text: '', chars: 0, modules: 0, sections: 0, truncated: false, emptyModules: [],
  }
  if (mods.length === 0) return empty

  const { data: sectionRows } = await supabase
    .from('module_sections')
    .select('module_id, heading_es, body_es, callout_es, blocks_data, sort_order')
    .in('module_id', mods.map((m) => m.id))
    .order('sort_order')

  type Sec = {
    module_id: string
    heading_es: string
    body_es: string[] | null
    callout_es: string | null
    blocks_data: unknown
  }
  const byModule = new Map<string, Sec[]>()
  for (const s of (sectionRows ?? []) as Sec[]) {
    const arr = byModule.get(s.module_id) ?? []
    arr.push(s)
    byModule.set(s.module_id, arr)
  }

  const emptyModules: string[] = []
  let sections = 0
  const chunks: string[] = []

  mods.forEach((m, i) => {
    const lines: string[] = [`\n═══ MÓDULO ${i + 1}: ${m.title_es} ═══`]
    if (m.subtitle_es) lines.push(m.subtitle_es)
    if (m.objectives_es?.length) lines.push(`Objetivos: ${m.objectives_es.join(' · ')}`)
    if (m.key_takeaways_es?.length)
      lines.push(`Puntos clave: ${m.key_takeaways_es.join(' · ')}`)

    let moduleBody = 0
    for (const s of byModule.get(m.id) ?? []) {
      sections += 1
      const parts: string[] = []
      if (s.body_es?.length) parts.push(...s.body_es.filter(Boolean))
      if (s.callout_es) parts.push(`Nota importante: ${s.callout_es}`)
      const fromBlocks = blockText(s.blocks_data)
      if (fromBlocks.length) parts.push(...fromBlocks)

      lines.push(`\n── ${s.heading_es} ──`)
      if (parts.length) {
        lines.push(parts.join('\n'))
        moduleBody += parts.join('\n').length
      } else {
        lines.push('(sección sin texto)')
      }
    }

    // Un módulo de puro video o pura imagen no aporta nada que se pueda
    // preguntar: se avisa en vez de dejar que la IA lo rellene de su cabeza.
    if (moduleBody < 200) emptyModules.push(m.title_es)
    chunks.push(lines.join('\n'))
  })

  let text = chunks.join('\n')
  const truncated = text.length > SOURCE_CHAR_LIMIT
  if (truncated) {
    text = `${text.slice(0, SOURCE_CHAR_LIMIT)}\n\n[…el curso sigue, pero se cortó aquí por tamaño…]`
  }

  return {
    text,
    chars: text.length,
    modules: mods.length,
    sections,
    truncated,
    emptyModules,
  }
}
