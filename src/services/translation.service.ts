import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { blankTranslations, deepFillTranslations, translateGenerated } from '@/services/ai.service'
import { detectBaseLang } from '@/lib/detectLang'
import { getModuleWithSectionsRaw, type DbModuleWithSections } from '@/services/modules.service'

/**
 * Traducción DIFERIDA (en/pt) de todo lo que cuelga de un curso.
 *
 * Por qué existe: generar contenido ya traducido gastaba plata en texto que el
 * capacitador reescribe a los cinco minutos. Ahora la IA escribe solo español,
 * el sitio muestra el español en los tres idiomas (nunca un hueco) y la
 * traducción se pide UNA vez, cuando el curso se da por terminado.
 *
 * "Traducir" desde el curso traduce TODO de una vez, que es el atajo para no ir
 * editor por editor:
 *   - la ficha del curso;
 *   - sus módulos, con secciones, bloques y quizzes;
 *   - las simulaciones ligadas al curso (de conversación y de opción múltiple);
 *   - sus mundos, con regiones, niveles y arenas.
 *
 * OJO: conviven dos formas de guardar el idioma, y cada una necesita su propio
 * detector y su propio guardado.
 *   1. `campo_es` / `campo_en` / `campo_pt`  → cursos, módulos, simulaciones.
 *   2. columna base en español + `campo_en` / `campo_pt` → mundos y arenas, que
 *      son tablas viejas donde renombrar `name` habría roto media app.
 *
 * Cómo se sabe si algo está traducido: sin columna de estado en la base. Se
 * comparan los pares es/en/pt; si el inglés es idéntico al español en la mayoría
 * de los textos largos, es que nadie tradujo todavía.
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

/** Simulación (llamada o de opción múltiple) ligada al curso. */
export type SimulationKind = 'dialogue' | 'choice'

export interface SimulationTranslationState {
  kind: SimulationKind
  simId: string
  title: string
  ratio: number
  translated: boolean
  /** Pasos que ocupa en la barra: ficha + un lote por cada N nodos. */
  steps: number
}

export interface WorldTranslationState {
  worldId: string
  name: string
  ratio: number
  translated: boolean
  /** Pasos que ocupa en la barra: ficha + regiones + niveles + sus arenas. */
  steps: number
}

export interface CourseTranslationState {
  courseId: string
  /** La ficha del curso (título + descripción). */
  courseTranslated: boolean
  modules: ModuleTranslationState[]
  /** Simuladores ligados al curso (scenarios + choice_scenarios). */
  simulations: SimulationTranslationState[]
  /** Mundos del curso, con sus regiones, niveles y arenas. */
  worlds: WorldTranslationState[]
  pendingCount: number
  /** Todo el curso, ficha incluida, ya está en los tres idiomas. */
  allTranslated: boolean
}

/** Nodos por llamada al traducir una simulación: acota el JSON de cada respuesta. */
const SIM_NODE_BATCH = 4

/** Columnas con texto multiidioma de cada tipo de simulación. */
const SIM_COLUMNS: Record<SimulationKind, { table: 'scenarios' | 'choice_scenarios'; select: string }> = {
  dialogue: {
    table: 'scenarios',
    select: 'id, title_es, title_en, title_pt, summary_es, summary_en, summary_pt,'
      + ' customer_reason_es, customer_reason_en, customer_reason_pt, checklist_items, nodes',
  },
  choice: {
    table: 'choice_scenarios',
    // description/objective/client_company son de un solo idioma en la base: no hay dónde traducirlas.
    select: 'id, title_es, title_en, title_pt, nodes',
  },
}

function simSteps(nodes: unknown): number {
  const n = nodes && typeof nodes === 'object' ? Object.keys(nodes).length : 0
  return 1 + Math.ceil(n / SIM_NODE_BATCH)
}

/** Simulaciones de ambos tipos ligadas al curso, con su estado de traducción. */
async function getCourseSimulationStates(courseId: string): Promise<SimulationTranslationState[]> {
  const kinds: SimulationKind[] = ['dialogue', 'choice']
  const results = await Promise.all(
    kinds.map(async (kind) => {
      const { table, select } = SIM_COLUMNS[kind]
      const { data, error } = await supabase.from(table).select(select).eq('course_id', courseId)
      // Una simulación ilegible (RLS, tabla vacía) no debe tumbar la vista del curso.
      if (error) return [] as SimulationTranslationState[]
      const rows = (data ?? []) as unknown as Array<{ id: string; title_es: string; nodes: unknown }>
      return rows.map((r) => {
        const ratio = translatedRatio(r)
        return {
          kind,
          simId: r.id,
          title: r.title_es ?? '',
          ratio,
          translated: ratio >= 0.5,
          steps: simSteps(r.nodes),
        }
      })
    }),
  )
  return results.flat()
}

// ── Mundos, regiones, niveles y arenas ─────────────────────────────────────
//
// Estas tablas guardan el español en la columna base (`name`, `title`) y las
// traducciones en `name_en` / `name_pt`. Es otro modelo que el de los módulos
// (`title_es/_en/_pt`), así que necesitan su propio detector y su propio
// guardado; ver src/lib/lang.ts para el lado de la lectura.

/** Filas por llamada al traducir regiones/niveles: son textos cortos, entran varios. */
const WORLD_ROW_BATCH = 8
/** Preguntas de arena por llamada. Cada una trae su contexto y 3-4 opciones. */
const ARENA_STEP_BATCH = 4

interface WorldPart {
  table: 'worlds' | 'world_regions' | 'world_levels'
  fields: string[]
}
const WORLD_PARTS: Record<'world' | 'region' | 'level', WorldPart> = {
  world: { table: 'worlds', fields: ['name', 'description'] },
  region: { table: 'world_regions', fields: ['name', 'description'] },
  level: { table: 'world_levels', fields: ['name', 'description'] },
}

/**
 * ¿Está traducida una fila del modelo "columna base + _en/_pt"?
 *
 * Mismo criterio que `translatedRatio`: solo cuentan los textos largos, porque
 * un nombre de dos palabras se escribe igual en los tres idiomas sin que eso
 * signifique que alguien lo tradujo.
 */
function baseRatio(rows: Array<Record<string, unknown>>, fields: string[]): number {
  let total = 0
  let done = 0
  for (const r of rows) {
    for (const f of fields) {
      const es = typeof r[f] === 'string' ? (r[f] as string).trim() : ''
      if (es.length < MIN_LEN_FOR_CHECK) continue
      total += 1
      const en = typeof r[`${f}_en`] === 'string' ? (r[`${f}_en`] as string).trim() : ''
      const pt = typeof r[`${f}_pt`] === 'string' ? (r[`${f}_pt`] as string).trim() : ''
      if (en && pt && en !== es && pt !== es) done += 1
    }
  }
  return total === 0 ? 1 : done / total
}

/** Las preguntas de una arena cuentan aparte: viven en un JSON, no en columnas. */
function arenaStepsRatio(row: Record<string, unknown>): { total: number; done: number } {
  const steps = Array.isArray(row.steps) ? row.steps : []
  if (!steps.length) return { total: 0, done: 0 }
  const en = Array.isArray(row.steps_en) ? row.steps_en : []
  const pt = Array.isArray(row.steps_pt) ? row.steps_pt : []
  // Se considera traducida si ambos idiomas cubren todas las preguntas.
  const ok = en.length >= steps.length && pt.length >= steps.length
  return { total: 1, done: ok ? 1 : 0 }
}

const ARENA_SELECT = 'id, world_id, title, title_en, title_pt,'
  + ' description, description_en, description_pt, steps, steps_en, steps_pt'

interface WorldBundle {
  world: Record<string, unknown>
  regions: Array<Record<string, unknown>>
  levels: Array<Record<string, unknown>>
  arenas: Array<Record<string, unknown>>
}

/** Trae un mundo con todo lo que le cuelga. `null` si la migración no está corrida. */
async function loadWorldBundle(worldId: string): Promise<WorldBundle | null> {
  const { data: world, error } = await supabase.from('worlds').select('*').eq('id', worldId).single()
  if (error || !world) return null
  const [{ data: regions }, { data: levels }, { data: arenas }] = await Promise.all([
    supabase.from('world_regions').select('*').eq('world_id', worldId).order('order_index'),
    supabase.from('world_levels').select('*').eq('world_id', worldId).order('order_index'),
    supabase.from('arena_quizzes').select(ARENA_SELECT).eq('world_id', worldId),
  ])
  return {
    world: world as Record<string, unknown>,
    regions: (regions ?? []) as Array<Record<string, unknown>>,
    levels: (levels ?? []) as Array<Record<string, unknown>>,
    arenas: (arenas ?? []) as unknown as Array<Record<string, unknown>>,
  }
}

/** Cuántos pasos de barra ocupa traducir el mundo entero. */
function worldSteps(b: WorldBundle): number {
  const arenaSteps = b.arenas.reduce((n, a) => {
    const steps = Array.isArray(a.steps) ? a.steps.length : 0
    return n + 1 + Math.ceil(steps / ARENA_STEP_BATCH)
  }, 0)
  return 1
    + Math.ceil(b.regions.length / WORLD_ROW_BATCH)
    + Math.ceil(b.levels.length / WORLD_ROW_BATCH)
    + arenaSteps
}

/** Mundos del curso con su estado de traducción. Sin llamadas a la IA. */
async function getCourseWorldStates(courseId: string): Promise<WorldTranslationState[]> {
  const { data, error } = await supabase.from('worlds').select('id, name').eq('course_id', courseId)
  // Sin la migración de idiomas corrida el select de abajo falla: se devuelve
  // vacío a propósito, para que el curso siga traduciéndose igual que antes.
  if (error) return []

  const rows = (data ?? []) as Array<{ id: string; name: string }>
  const bundles = await Promise.all(rows.map((r) => loadWorldBundle(r.id)))

  const out: WorldTranslationState[] = []
  for (let i = 0; i < rows.length; i++) {
    const b = bundles[i]
    if (!b) continue

    // Un solo porcentaje para todo el mundo: ficha + regiones + niveles + arenas.
    const parts: Array<{ weight: number; ratio: number }> = [
      { weight: 1, ratio: baseRatio([b.world], WORLD_PARTS.world.fields) },
      { weight: b.regions.length, ratio: baseRatio(b.regions, WORLD_PARTS.region.fields) },
      { weight: b.levels.length, ratio: baseRatio(b.levels, WORLD_PARTS.level.fields) },
      { weight: b.arenas.length, ratio: baseRatio(b.arenas, ['title', 'description']) },
    ]
    const stepTotals = b.arenas.map(arenaStepsRatio)
    const stepsTotal = stepTotals.reduce((n, s) => n + s.total, 0)
    if (stepsTotal) {
      parts.push({
        weight: stepsTotal,
        ratio: stepTotals.reduce((n, s) => n + s.done, 0) / stepsTotal,
      })
    }

    const weight = parts.reduce((n, p) => n + p.weight, 0)
    const ratio = weight === 0 ? 1 : parts.reduce((n, p) => n + p.weight * p.ratio, 0) / weight

    out.push({
      worldId: rows[i].id,
      name: rows[i].name ?? '',
      ratio,
      translated: ratio >= 0.5,
      steps: worldSteps(b),
    })
  }
  return out
}

/** Revisa curso + módulos + simulaciones + mundos y dice qué falta. Sin IA. */
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

  const [simulations, worlds] = await Promise.all([
    getCourseSimulationStates(courseId),
    getCourseWorldStates(courseId),
  ])

  // La ficha del curso suele ser texto corto; si no hay nada largo, cuenta como lista.
  const courseTranslated = translatedRatio(course) >= 0.5
  const pendingCount = modules.filter((m) => !m.translated).length
    + simulations.filter((s) => !s.translated).length
    + worlds.filter((w) => !w.translated).length
    + (courseTranslated ? 0 : 1)

  return {
    courseId,
    courseTranslated,
    modules,
    simulations,
    worlds,
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

/**
 * Vacía los otros dos idiomas y pide la traducción; si la IA falla, devuelve el original.
 *
 * El idioma de ORIGEN se detecta leyendo el texto, no se supone: desde que el
 * contenido se genera en el idioma de la interfaz, la columna base puede traer
 * portugués o inglés. Traducir "desde el español" un texto en portugués dejaba el
 * español mal para siempre (ver [[detectLang]]).
 */
async function translatePiece<T>(piece: T, signal?: AbortSignal): Promise<T> {
  const from = detectBaseLang(piece)
  const blank = blankTranslations(piece, from) as T
  try {
    const out = await translateGenerated<T>(blank, signal, from)
    return deepFillTranslations(out ?? piece, from) as T
  } catch (e) {
    if (signal?.aborted || (e as Error)?.name === 'AbortError') throw e
    // Red de seguridad: mejor dejar el idioma original que romper el módulo.
    return deepFillTranslations(piece, from) as T
  }
}

/**
 * Devuelve el original con SOLO las versiones en/pt reemplazadas por las traducidas.
 *
 * Por qué hace falta en las simulaciones: su JSON mezcla texto visible con datos
 * que no son texto y que la IA no debe tocar — `keywords` (con esas palabras se
 * puntúa lo que dice el aprendiz), `nextId` (el grafo de la conversación),
 * `points`, `terminal`. Si la traducción devuelve esos campos "mejorados", el
 * simulador queda roto sin que nadie lo note hasta que alguien lo juega.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeTranslatedOnly(original: any, translated: any): any {
  if (Array.isArray(original)) {
    if (!Array.isArray(translated)) return original
    // Se emparejan por posición: la traducción nunca debe cambiar el orden ni el largo.
    return original.map((v, i) => mergeTranslatedOnly(v, translated[i]))
  }
  if (!original || typeof original !== 'object') return original
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) return original

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = { ...original }
  for (const k of Object.keys(original)) {
    const isLangField = k === 'en' || k === 'pt' || k.endsWith('_en') || k.endsWith('_pt')
    if (isLangField) {
      const v = translated[k]
      // Solo se acepta si la IA devolvió algo del mismo tipo y no vacío.
      if (typeof v === 'string' && v.trim()) out[k] = v
      else if (Array.isArray(v) && v.length) out[k] = v
    } else if (original[k] && typeof original[k] === 'object') {
      out[k] = mergeTranslatedOnly(original[k], translated[k])
    }
  }
  return out
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

/**
 * Traduce una simulación entera: su ficha (con el checklist, si es de llamada) y
 * todos sus nodos, por lotes chicos para que Haiku no corte el JSON.
 *
 * Los nodos guardan el texto como tríos `{ es, en, pt }`, la misma forma que ya
 * manejan `blankTranslations` / `deepFillTranslations`, así que no hace falta
 * conocer la estructura del grafo: se traduce el JSON tal cual y se vuelve a guardar.
 */
export async function translateSimulation(
  kind: SimulationKind,
  simId: string,
  opts: { onProgress?: OnProgress; signal?: AbortSignal; startStep?: number; totalSteps?: number } = {},
): Promise<void> {
  const { table, select } = SIM_COLUMNS[kind]
  const { data, error } = await supabase.from(table).select(select).eq('id', simId).single()
  if (error) throw error

  const row = data as unknown as {
    title_es: string
    nodes: Record<string, unknown> | null
    checklist_items?: unknown
  }
  const entries = Object.entries(row.nodes ?? {})

  const total = opts.totalSteps ?? simSteps(row.nodes)
  let step = opts.startStep ?? 0
  const tick = (detail: string) => opts.onProgress?.({ done: Math.min(++step, total), total, detail })

  // 1) Ficha. En las de llamada incluye el checklist, que también es texto visible.
  // Los nodos salen del lote: van aparte, o la llamada se pasaría de largo.
  tick(row.title_es)
  const { nodes: _nodes, id: _id, ...metaPiece } = data as unknown as Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMeta = await translatePiece(metaPiece as any, opts.signal)
  // Del checklist solo se toman las traducciones: sus `keywords` puntúan al aprendiz.
  const meta = mergeTranslatedOnly(metaPiece, rawMeta)
  const metaUpdate = kind === 'dialogue'
    ? {
        title_en: meta.title_en, title_pt: meta.title_pt,
        summary_en: meta.summary_en, summary_pt: meta.summary_pt,
        customer_reason_en: meta.customer_reason_en, customer_reason_pt: meta.customer_reason_pt,
        ...(row.checklist_items ? { checklist_items: meta.checklist_items as Json } : {}),
      }
    : { title_en: meta.title_en, title_pt: meta.title_pt }

  const { error: metaError } = await supabase.from(table).update(metaUpdate).eq('id', simId)
  if (metaError) throw metaError

  if (!entries.length) return

  // 2) Los nodos, de a pocos.
  const nodes: Record<string, unknown> = {}
  for (let i = 0; i < entries.length; i += SIM_NODE_BATCH) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const n = Math.floor(i / SIM_NODE_BATCH) + 1
    const batches = Math.ceil(entries.length / SIM_NODE_BATCH)
    tick(`${row.title_es} (${n}/${batches})`)

    const batch = Object.fromEntries(entries.slice(i, i + SIM_NODE_BATCH))
    const out = await translatePiece(batch, opts.signal)
    // El grafo (`nextId`, `points`, `terminal`) se conserva tal cual: solo entra el texto.
    Object.assign(nodes, mergeTranslatedOnly(batch, out ?? batch))
  }

  const { error: nodesError } = await supabase
    .from(table)
    .update({ nodes: nodes as unknown as Json })
    .eq('id', simId)
  if (nodesError) throw nodesError
}

// ── Traducir un mundo ──────────────────────────────────────────────────────

/**
 * Pasa filas del modelo "columna base + _en/_pt" a la forma `campo_es/_en/_pt`
 * que entienden `blankTranslations` y el prompt de traducción, y de vuelta.
 *
 * Es solo un cambio de nombres en memoria: en la base no se toca la columna
 * original, que sigue siendo el español.
 */
function toEsShape(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    out[`${f}_es`] = typeof row[f] === 'string' ? row[f] : ''
    out[`${f}_en`] = typeof row[`${f}_en`] === 'string' ? row[`${f}_en`] : ''
    out[`${f}_pt`] = typeof row[`${f}_pt`] === 'string' ? row[`${f}_pt`] : ''
  }
  return out
}

/**
 * Del resultado se toman solo en/pt: el español nunca se reescribe.
 *
 * Sale como `any` a propósito: las claves se arman en runtime a partir de
 * `fields`, y los tipos generados de Supabase exigen literales conocidos.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromEsShape(translated: Record<string, unknown>, fields: string[]): any {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    for (const lang of ['en', 'pt']) {
      const v = translated[`${f}_${lang}`]
      out[`${f}_${lang}`] = typeof v === 'string' && v.trim() ? v : null
    }
  }
  return out
}

/** Traduce filas de una tabla de mundos por lotes y las guarda. */
async function translateWorldRows(
  part: WorldPart,
  rows: Array<Record<string, unknown>>,
  signal: AbortSignal | undefined,
  tick: (detail: string) => void,
  label: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += WORLD_ROW_BATCH) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const slice = rows.slice(i, i + WORLD_ROW_BATCH)
    const n = Math.floor(i / WORLD_ROW_BATCH) + 1
    const batches = Math.ceil(rows.length / WORLD_ROW_BATCH)
    tick(batches > 1 ? `${label} (${n}/${batches})` : label)

    const payload = { items: slice.map((r) => toEsShape(r, part.fields)) }
    const out = await translatePiece(payload, signal)

    for (let j = 0; j < slice.length; j++) {
      const item = out?.items?.[j]
      if (!item) continue
      await supabase
        .from(part.table)
        .update(fromEsShape(item as Record<string, unknown>, part.fields))
        .eq('id', slice[j].id as string)
    }
  }
}

interface ArenaStep { id?: string; question?: string; context?: string; options?: Array<Record<string, unknown>> }

/**
 * Traduce las preguntas de una arena a `steps_en` / `steps_pt`.
 *
 * Se guarda el arreglo completo con los MISMOS ids de pregunta y de opción,
 * porque la app empareja por id (el player baraja las opciones). Lo que decide
 * la respuesta correcta —`correct`— no viaja a la IA ni vuelve de ella: se lee
 * siempre del `steps` original.
 */
async function translateArenaSteps(
  arenaId: string,
  steps: ArenaStep[],
  signal: AbortSignal | undefined,
  tick: (detail: string) => void,
  label: string,
): Promise<void> {
  const en: ArenaStep[] = []
  const pt: ArenaStep[] = []
  const batches = Math.ceil(steps.length / ARENA_STEP_BATCH)

  for (let i = 0; i < steps.length; i += ARENA_STEP_BATCH) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const n = Math.floor(i / ARENA_STEP_BATCH) + 1
    tick(batches > 1 ? `${label} (${n}/${batches})` : label)

    const slice = steps.slice(i, i + ARENA_STEP_BATCH)
    const payload = {
      items: slice.map((s) => ({
        question_es: s.question ?? '', question_en: '', question_pt: '',
        context_es: s.context ?? '', context_en: '', context_pt: '',
        options: (s.options ?? []).map((o) => ({
          text_es: (o.text as string) ?? '', text_en: '', text_pt: '',
          explanation_es: (o.explanation as string) ?? '', explanation_en: '', explanation_pt: '',
        })),
      })),
    }
    const out = await translatePiece(payload, signal)

    for (let j = 0; j < slice.length; j++) {
      const src = slice[j]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = out?.items?.[j] as any
      for (const [lang, bucket] of [['en', en], ['pt', pt]] as const) {
        bucket.push({
          id: src.id,
          question: t?.[`question_${lang}`] || src.question,
          context: t?.[`context_${lang}`] || src.context,
          options: (src.options ?? []).map((o, k) => ({
            id: o.id,
            text: t?.options?.[k]?.[`text_${lang}`] || o.text,
            explanation: t?.options?.[k]?.[`explanation_${lang}`] || o.explanation,
          })),
        })
      }
    }
  }

  await supabase
    .from('arena_quizzes')
    .update({ steps_en: en as unknown as Json, steps_pt: pt as unknown as Json })
    .eq('id', arenaId)
}

/**
 * Traduce un mundo entero: su ficha, sus regiones, sus niveles y las arenas
 * que cuelgan de él. Todo va a las columnas `_en` / `_pt`; el español no se toca.
 */
export async function translateWorld(
  worldId: string,
  opts: { onProgress?: OnProgress; signal?: AbortSignal; startStep?: number; totalSteps?: number } = {},
): Promise<void> {
  const bundle = await loadWorldBundle(worldId)
  if (!bundle) return

  const total = opts.totalSteps ?? worldSteps(bundle)
  let step = opts.startStep ?? 0
  const tick = (detail: string) => opts.onProgress?.({ done: Math.min(++step, total), total, detail })

  const worldName = (bundle.world.name as string) ?? ''

  // 1) Ficha del mundo.
  tick(worldName)
  const meta = await translatePiece(toEsShape(bundle.world, WORLD_PARTS.world.fields), opts.signal)
  const { error } = await supabase
    .from('worlds')
    .update(fromEsShape(meta, WORLD_PARTS.world.fields))
    .eq('id', worldId)
  if (error) throw error

  // 2) Regiones y niveles.
  await translateWorldRows(WORLD_PARTS.region, bundle.regions, opts.signal, tick, `${worldName} · regiones`)
  await translateWorldRows(WORLD_PARTS.level, bundle.levels, opts.signal, tick, `${worldName} · niveles`)

  // 3) Arenas: primero la ficha, después las preguntas.
  for (const a of bundle.arenas) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const arenaTitle = (a.title as string) ?? worldName
    tick(arenaTitle)

    const aMeta = await translatePiece(toEsShape(a, ['title', 'description']), opts.signal)
    await supabase
      .from('arena_quizzes')
      .update(fromEsShape(aMeta, ['title', 'description']))
      .eq('id', a.id as string)

    const steps = (Array.isArray(a.steps) ? a.steps : []) as ArenaStep[]
    if (steps.length) {
      await translateArenaSteps(a.id as string, steps, opts.signal, tick, `${arenaTitle} · preguntas`)
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
 * Traduce el curso ENTERO: su ficha, todos sus módulos, todas las simulaciones
 * ligadas a él y sus mundos (con regiones, niveles y arenas). Es el atajo para
 * no ir pieza por pieza.
 *
 * `onlyPending` (por defecto) evita volver a pagar por lo ya traducido.
 */
export async function translateCourse(
  courseId: string,
  opts: { onProgress?: OnProgress; signal?: AbortSignal; onlyPending?: boolean } = {},
): Promise<{ modules: number; simulations: number; worlds: number }> {
  const state = await getCourseTranslationState(courseId)
  const onlyPending = opts.onlyPending ?? true
  const targets = onlyPending ? state.modules.filter((m) => !m.translated) : state.modules
  const simTargets = onlyPending ? state.simulations.filter((s) => !s.translated) : state.simulations
  const worldTargets = onlyPending ? state.worlds.filter((w) => !w.translated) : state.worlds

  // Pasos: ficha del curso + una pasada por módulo + los lotes de cada simulación
  // y de cada mundo. Los pasos finos (sección a sección, lote a lote) los reportan
  // translateModule, translateSimulation y translateWorld sobre este mismo total.
  const sectionCounts = await sectionCountsFor(targets.map((m) => m.moduleId))
  const total = 1
    + targets.reduce((n, m) => n + 1 + (sectionCounts[m.moduleId] ?? 0), 0)
    + simTargets.reduce((n, s) => n + s.steps, 0)
    + worldTargets.reduce((n, w) => n + w.steps, 0)

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

  for (const s of simTargets) {
    await translateSimulation(s.kind, s.simId, {
      signal: opts.signal,
      startStep: step,
      totalSteps: total,
      onProgress: (p) => { step = p.done; opts.onProgress?.({ ...p, total }) },
    })
  }

  for (const w of worldTargets) {
    await translateWorld(w.worldId, {
      signal: opts.signal,
      startStep: step,
      totalSteps: total,
      onProgress: (p) => { step = p.done; opts.onProgress?.({ ...p, total }) },
    })
  }

  bump('Listo')
  return { modules: targets.length, simulations: simTargets.length, worlds: worldTargets.length }
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
