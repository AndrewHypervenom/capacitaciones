import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { blankTranslations, deepFillTranslations, translateGenerated } from '@/services/ai.service'
import { getModuleWithSectionsRaw, type DbModuleWithSections } from '@/services/modules.service'

/**
 * Traducción DIFERIDA (en/pt) de cursos y módulos.
 *
 * Por qué existe: generar contenido ya traducido gastaba plata en texto que el
 * capacitador reescribe a los cinco minutos. Ahora la IA escribe solo español,
 * el sitio muestra el español en los tres idiomas (nunca un hueco) y la
 * traducción se pide UNA vez, cuando el curso se da por terminado.
 *
 * Cómo se sabe si algo está traducido: sin columna nueva en la base. Se comparan
 * los pares es/en/pt del contenido; si el inglés es idéntico al español en la
 * mayoría de los textos largos, es que nadie tradujo todavía.
 */

// ── Detección de "sin traducir" ────────────────────────────────────────────

/** Un texto y sus tres versiones, ya normalizado a string. */
interface LangTriple { es: string; en: string; pt: string }

function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n')
  return ''
}

/**
 * Recorre cualquier JSON y saca los tríos de idioma que encuentre, en las dos
 * formas que usa el sitio: `{ es, en, pt }` y `campo_es / campo_en / campo_pt`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectTriples(value: any, out: LangTriple[] = []): LangTriple[] {
  if (Array.isArray(value)) {
    for (const v of value) collectTriples(v, out)
    return out
  }
  if (!value || typeof value !== 'object') return out

  if (typeof value.es === 'string') {
    out.push({ es: value.es, en: asText(value.en), pt: asText(value.pt) })
  }
  for (const k of Object.keys(value)) {
    if (k.endsWith('_es')) {
      const base = k.slice(0, -3)
      out.push({
        es: asText(value[k]),
        en: asText(value[`${base}_en`]),
        pt: asText(value[`${base}_pt`]),
      })
    } else if (typeof value[k] === 'object') {
      collectTriples(value[k], out)
    }
  }
  return out
}

/**
 * Textos cortos (un título de dos palabras, un nombre propio) se escriben igual
 * en los tres idiomas sin que eso signifique nada. Solo miramos los largos.
 */
const MIN_LEN_FOR_CHECK = 25

/** Fracción del contenido que sí está traducido (0 = nada, 1 = todo). */
export function translatedRatio(content: unknown): number {
  const triples = collectTriples(content).filter((t) => t.es.trim().length >= MIN_LEN_FOR_CHECK)
  if (!triples.length) return 1 // nada que traducir: cuenta como listo
  const done = triples.filter((t) => {
    const en = t.en.trim()
    const pt = t.pt.trim()
    if (!en || !pt) return false
    return en !== t.es.trim() && pt !== t.es.trim()
  }).length
  return done / triples.length
}

/** ¿Vale la pena ofrecer "traducir" sobre este contenido? */
export function isUntranslated(content: unknown): boolean {
  return translatedRatio(content) < 0.5
}

// ── Estado de un curso ─────────────────────────────────────────────────────

export interface ModuleTranslationState {
  moduleId: string
  title: string
  /** 0 a 1. Por debajo de 0.5 se considera "sin traducir". */
  ratio: number
  translated: boolean
}

export interface CourseTranslationState {
  courseId: string
  /** La ficha del curso (título + descripción). */
  courseTranslated: boolean
  modules: ModuleTranslationState[]
  pendingCount: number
  /** Todo el curso, ficha incluida, ya está en los tres idiomas. */
  allTranslated: boolean
}

/** Revisa curso + módulos y dice qué falta por traducir. Sin llamadas a la IA. */
export async function getCourseTranslationState(courseId: string): Promise<CourseTranslationState> {
  const { data: course, error } = await supabase
    .from('courses')
    .select('id, title_es, title_en, title_pt, description_es, description_en, description_pt')
    .eq('id', courseId)
    .single()
  if (error) throw error

  const { data: mods, error: modsError } = await supabase
    .from('modules')
    .select('id, title_es, title_en, title_pt, subtitle_es, subtitle_en, subtitle_pt,'
      + ' objectives_es, objectives_en, objectives_pt,'
      + ' module_sections(heading_es, heading_en, heading_pt, body_es, body_en, body_pt, blocks_data)')
    .eq('course_id', courseId)
    .order('course_sort_order')
  if (modsError) throw modsError

  // El embed anidado confunde a los tipos generados; el shape real es el del select.
  const rawMods = (mods ?? []) as unknown as Array<{ id: string; title_es: string }>

  const modules: ModuleTranslationState[] = rawMods.map((m) => {
    const ratio = translatedRatio(m)
    return {
      moduleId: m.id,
      title: m.title_es ?? '',
      ratio,
      translated: ratio >= 0.5,
    }
  })

  // La ficha del curso suele ser texto corto; si no hay nada largo, cuenta como lista.
  const courseTranslated = translatedRatio(course) >= 0.5
  const pendingCount = modules.filter((m) => !m.translated).length + (courseTranslated ? 0 : 1)

  return {
    courseId,
    courseTranslated,
    modules,
    pendingCount,
    allTranslated: pendingCount === 0,
  }
}

/** Estado de un módulo suelto (para el botón del editor de módulo). */
export async function getModuleTranslationState(moduleId: string): Promise<ModuleTranslationState> {
  const mod = await getModuleWithSectionsRaw(moduleId)
  const ratio = translatedRatio(mod)
  return { moduleId, title: mod.title_es, ratio, translated: ratio >= 0.5 }
}

// ── Traducir de verdad ─────────────────────────────────────────────────────

export interface TranslateProgress {
  /** Paso actual (1-based) y total, para la barra. */
  done: number
  total: number
  /** Qué se está traduciendo ahora, en texto humano. */
  detail: string
}

type OnProgress = (p: TranslateProgress) => void

/** Vacía en/pt y pide la traducción; si la IA falla, devuelve el original. */
async function translatePiece<T>(piece: T, signal?: AbortSignal): Promise<T> {
  const blank = blankTranslations(piece) as T
  try {
    const out = await translateGenerated<T>(blank, signal)
    return deepFillTranslations(out ?? piece) as T
  } catch (e) {
    if (signal?.aborted || (e as Error)?.name === 'AbortError') throw e
    // Red de seguridad: mejor dejar el español que romper el módulo.
    return deepFillTranslations(piece) as T
  }
}

/**
 * Traduce un módulo completo: ficha, secciones (con sus bloques) y quizzes.
 * Va por piezas para que cada llamada a Haiku sea chica y no se corte el JSON.
 *
 * `startStep` permite encadenar módulos dentro de la barra de un curso.
 */
export async function translateModule(
  moduleId: string,
  opts: { onProgress?: OnProgress; signal?: AbortSignal; startStep?: number; totalSteps?: number } = {},
): Promise<void> {
  const mod: DbModuleWithSections = await getModuleWithSectionsRaw(moduleId)
  const sections = mod.module_sections ?? []

  const localTotal = 1 + sections.length
  const total = opts.totalSteps ?? localTotal
  let step = opts.startStep ?? 0
  const tick = (detail: string) => opts.onProgress?.({ done: Math.min(++step, total), total, detail })

  // 1) Ficha del módulo.
  tick(mod.title_es)
  const meta = await translatePiece({
    title_es: mod.title_es, title_en: mod.title_en, title_pt: mod.title_pt,
    subtitle_es: mod.subtitle_es, subtitle_en: mod.subtitle_en, subtitle_pt: mod.subtitle_pt,
    objectives_es: mod.objectives_es, objectives_en: mod.objectives_en, objectives_pt: mod.objectives_pt,
    key_takeaways_es: mod.key_takeaways_es, key_takeaways_en: mod.key_takeaways_en, key_takeaways_pt: mod.key_takeaways_pt,
  }, opts.signal)

  const { error: metaError } = await supabase.from('modules').update({
    title_en: meta.title_en, title_pt: meta.title_pt,
    subtitle_en: meta.subtitle_en, subtitle_pt: meta.subtitle_pt,
    objectives_en: meta.objectives_en, objectives_pt: meta.objectives_pt,
    key_takeaways_en: meta.key_takeaways_en, key_takeaways_pt: meta.key_takeaways_pt,
  }).eq('id', moduleId)
  if (metaError) throw metaError

  // 2) Cada sección con sus bloques, y los quizzes aparte (van en otra tabla).
  for (const s of sections) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    tick(s.heading_es || mod.title_es)

    const sec = await translatePiece({
      heading_es: s.heading_es, heading_en: s.heading_en, heading_pt: s.heading_pt,
      body_es: s.body_es, body_en: s.body_en, body_pt: s.body_pt,
      callout_es: s.callout_es, callout_en: s.callout_en, callout_pt: s.callout_pt,
      media_caption_es: s.media_caption_es, media_caption_en: s.media_caption_en, media_caption_pt: s.media_caption_pt,
      blocks: s.blocks_data ?? null,
    }, opts.signal)

    const { error: secError } = await supabase.from('module_sections').update({
      heading_en: sec.heading_en, heading_pt: sec.heading_pt,
      body_en: sec.body_en, body_pt: sec.body_pt,
      callout_en: sec.callout_en, callout_pt: sec.callout_pt,
      media_caption_en: sec.media_caption_en, media_caption_pt: sec.media_caption_pt,
      // `blocks_data` es jsonb: los tipos generados lo esperan como Json.
      ...(s.blocks_data ? { blocks_data: sec.blocks as unknown as Json } : {}),
    }).eq('id', s.id)
    if (secError) throw secError

    const quizzes = s.section_quizzes ?? []
    if (quizzes.length) {
      const translated = await translatePiece({ quizzes }, opts.signal)
      for (let i = 0; i < quizzes.length; i++) {
        const q = translated.quizzes?.[i]
        if (!q) continue
        await supabase.from('section_quizzes').update({
          question_en: q.question_en, question_pt: q.question_pt,
          options_en: q.options_en, options_pt: q.options_pt,
          explanation_en: q.explanation_en, explanation_pt: q.explanation_pt,
        }).eq('id', quizzes[i].id)
      }
    }
  }
}

/** Traduce la ficha del curso (título + descripción). */
export async function translateCourseMeta(courseId: string, signal?: AbortSignal): Promise<void> {
  const { data, error } = await supabase
    .from('courses')
    .select('title_es, title_en, title_pt, description_es, description_en, description_pt')
    .eq('id', courseId)
    .single()
  if (error) throw error

  const out = await translatePiece(data, signal)
  const { error: upError } = await supabase.from('courses').update({
    title_en: out.title_en, title_pt: out.title_pt,
    description_en: out.description_en, description_pt: out.description_pt,
  }).eq('id', courseId)
  if (upError) throw upError
}

/**
 * Traduce el curso entero: su ficha y todos los módulos que falten.
 * `onlyPending` (por defecto) evita volver a pagar por lo ya traducido.
 */
export async function translateCourse(
  courseId: string,
  opts: { onProgress?: OnProgress; signal?: AbortSignal; onlyPending?: boolean } = {},
): Promise<{ modules: number }> {
  const state = await getCourseTranslationState(courseId)
  const onlyPending = opts.onlyPending ?? true
  const targets = onlyPending ? state.modules.filter((m) => !m.translated) : state.modules

  // Pasos: ficha del curso + una pasada por módulo. Los pasos finos (sección a
  // sección) los reporta translateModule sobre este mismo total.
  const sectionCounts = await sectionCountsFor(targets.map((m) => m.moduleId))
  const total = 1 + targets.reduce((n, m) => n + 1 + (sectionCounts[m.moduleId] ?? 0), 0)

  let step = 0
  const bump = (detail: string) => {
    step += 1
    opts.onProgress?.({ done: Math.min(step, total), total, detail })
  }

  bump('Ficha del curso')
  if (!state.courseTranslated || !onlyPending) {
    await translateCourseMeta(courseId, opts.signal)
  }

  for (const m of targets) {
    await translateModule(m.moduleId, {
      signal: opts.signal,
      startStep: step,
      totalSteps: total,
      onProgress: (p) => { step = p.done; opts.onProgress?.({ ...p, total }) },
    })
  }

  bump('Listo')
  return { modules: targets.length }
}

/** Cuántas secciones tiene cada módulo (para dimensionar la barra de avance). */
async function sectionCountsFor(moduleIds: string[]): Promise<Record<string, number>> {
  if (!moduleIds.length) return {}
  const { data } = await supabase
    .from('module_sections')
    .select('module_id')
    .in('module_id', moduleIds)
  const out: Record<string, number> = {}
  for (const r of data ?? []) {
    const id = r.module_id as string
    out[id] = (out[id] ?? 0) + 1
  }
  return out
}
