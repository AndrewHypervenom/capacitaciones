import { supabase } from '@/lib/supabase'
import {
  deleteModule,
  freeSlugInCampaign,
  getModuleWithSectionsRaw,
  updateModuleMetadata,
  type DbModuleWithSections,
  type DbSectionRow,
} from '@/services/modules.service'
import { moduleAiAssist } from '@/services/ai.service'
import { logActivity } from '@/services/audit.service'
import type { Json } from '@/types/database'
import { pickLang, pickLangList } from '@/lib/contentLang'

/* ═══════════════════════════════════════════════════════════════════════════
   CIRUGÍA DE MÓDULOS — separar uno largo en varios, unir varios en uno.

   Idea central: las secciones NO se copian, se MUEVEN (cambia `module_id`).
   Un deep-copy duplicaría quizzes, bloques, marcadores de video y referencias a
   Storage; moviendo, el contenido llega idéntico al otro lado y la operación es
   reversible fila por fila.

   Por eso todo aquí devuelve un `PendingSurgery` en vez de "hacer y ya":

     • La parte de CONTENIDO se aplica de una (el capacitador ve el resultado).
     • La parte IRREVERSIBLE — migrar el progreso de los aprendices y eliminar el
       módulo absorbido — se aplaza hasta `finalize()`.

   Mientras tanto `undo()` deshace la operación entera sin dejar rastro. Es lo
   que da el botón "Deshacer" de la franja: durante esa ventana nadie perdió
   avance porque el progreso todavía no se ha tocado.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Operación aplicada al contenido y pendiente de confirmar. */
export interface PendingSurgery {
  /** Revierte TODO. Solo válido antes de `finalize()`. */
  undo: () => Promise<void>
  /** Confirma: migra el progreso y consuma los borrados. Devuelve a cuánta gente afectó. */
  finalize: () => Promise<number>
  /**
   * Módulos que siguen en el curso durante la ventana de Deshacer pero ya no
   * cuentan (el absorbido de una unión): el editor los oculta de la lista.
   */
  hiddenModuleIds?: string[]
}

export interface SurgeryImpact {
  /** Personas que ya tienen el módulo completo. */
  completed: number
  /** Personas a mitad del módulo (se les reinician los quizzes de ese módulo). */
  started: number
}

/**
 * Cuánta gente resulta afectada, para avisarlo ANTES de confirmar. Si la RPC no
 * está creada todavía devuelve ceros: el aviso desaparece, la operación no.
 */
export async function getSurgeryImpact(moduleIds: string[]): Promise<Record<string, SurgeryImpact>> {
  if (moduleIds.length === 0) return {}
  const { data, error } = await supabase.rpc('get_module_surgery_impact', { p_module_ids: moduleIds })
  if (error) return {}
  const out: Record<string, SurgeryImpact> = {}
  for (const row of data ?? []) {
    out[row.module_id] = { completed: row.completed_count ?? 0, started: row.started_count ?? 0 }
  }
  return out
}

/* ─── Metadatos que la IA (o el capacitador) puede proponer ────────────────── */

export interface PartMeta {
  title_es: string
  subtitle_es?: string | null
  objectives_es?: string[]
  key_takeaways_es?: string[]
  /**
   * Minutos escritos a mano en el modal. Si no viene (o viene 0) se usa el
   * reparto/suma automático: el capacitador solo manda cuando lo toca.
   */
  duration_min?: number
}

/** Textos de enlace de UNA parte con sus vecinas. Se materializan como secciones. */
export interface SplitBridge {
  /** Cierre que se añade al final de la parte (anticipa la siguiente). */
  closing_es?: string
  /** Entrada que se añade al principio de la parte (retoma la anterior). */
  intro_es?: string
}

/* ─── Helpers de contenido ─────────────────────────────────────────────────── */

const sortSections = (rows: DbSectionRow[]) => [...rows].sort((a, b) => a.sort_order - b.sort_order)

/** Cuerpo de la sección en el idioma que se haya escrito (no siempre el español). */
const sectionBody = (s: DbSectionRow): string[] =>
  pickLangList(s.body_es, s.body_en, s.body_pt, 'es')

/** Primeras palabras del cuerpo de una sección, para que la IA sepa de qué va. */
function excerpt(section: DbSectionRow, max = 220): string {
  // Las secciones hechas con bloques traen el cuerpo vacío: su texto está en
  // los bloques, y sin él la IA no sabría de qué trata la sección.
  const text = [sectionBody(section).join(' '), blocksText(section.blocks_data ?? [])]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/* ─── Cuánto pesa cada sección ─────────────────────────────────────────────
   Contar solo el texto engaña: una sección con un video de 40 minutos tiene
   tres renglones. Se mira qué trae cada sección (video, quizzes, juegos, PDF)
   y con eso se reparten los minutos del módulo y se le cuenta a la IA. */

/** Claves de un bloque que no son texto que alguien lee. */
const NON_TEXT_KEYS = new Set(['id', 'type', 'kind', 'url', 'src', 'href', 'poster', 'lang', 'layout', 'size', 'align', 'style', 'color', 'icon'])

/** Todo el texto legible de los bloques (párrafos, listas, pestañas…). */
function blocksText(value: unknown, key = ''): string {
  if (NON_TEXT_KEYS.has(key)) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => blocksText(v)).join(' ')
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => blocksText(v, k))
      .join(' ')
  }
  return ''
}

export interface SectionProfile {
  /** Caracteres de texto para leer (cuerpo + bloques). */
  chars: number
  videos: number
  /** Último segundo con marcador dentro de un video: el video dura AL MENOS eso. */
  videoSeconds: number
  quizzes: number
  games: number
  pdfs: number
}

export function sectionProfile(s: DbSectionRow): SectionProfile {
  const blocks = (s.blocks_data ?? []) as Array<{ type?: string; markers?: Array<{ timeSeconds?: number }> }>
  const markers = [
    ...(s.video_markers ?? []),
    ...blocks.flatMap((b) => (b.type === 'video' ? (b.markers ?? []) : [])),
  ]
  const hasSectionVideo =
    s.media_type === 'youtube' || s.media_type === 'vimeo' || s.media_type === 'video' || s.section_style === 'video-interactive'
  return {
    chars: sectionBody(s).join(' ').length + blocksText(blocks).length,
    videos: (hasSectionVideo ? 1 : 0) + blocks.filter((b) => b.type === 'video').length,
    videoSeconds: markers.reduce((max, m) => Math.max(max, m.timeSeconds ?? 0), 0),
    quizzes:
      (s.section_quizzes ?? []).length +
      blocks.filter((b) => b.type === 'quiz').length +
      markers.filter((m) => (m as { type?: string }).type === 'quiz').length,
    games:
      blocks.filter((b) => b.type === 'game-sort' || b.type === 'game-classify').length +
      (s.section_style === 'game-sort' || s.section_style === 'game-classify' ? 1 : 0),
    pdfs: blocks.filter((b) => b.type === 'pdf').length,
  }
}

/**
 * Minutos estimados de cada sección, repartiendo la duración TOTAL del módulo.
 *
 * Primero se estima lo que se puede medir (lectura, quizzes, juegos, lo que se
 * sabe de los videos por sus marcadores). Lo que sobra de la duración declarada
 * se lo llevan las secciones con video — un módulo de 60 min con dos videos y
 * poco texto es casi todo video. Sin videos, se reparte en proporción.
 */
export function estimateSectionMinutes(total: number, sections: DbSectionRow[]): number[] {
  if (sections.length === 0) return []
  const profiles = sections.map(sectionProfile)
  const known = profiles.map(
    (p) => p.chars / 900 + p.quizzes * 0.5 + p.games * 2 + p.pdfs * 3 + p.videoSeconds / 60 + 0.25,
  )
  const knownSum = known.reduce((a, b) => a + b, 0)
  const videoCount = profiles.reduce((sum, p) => sum + p.videos, 0)
  const spare = total - knownSum

  if (spare > 0 && videoCount > 0) {
    return known.map((m, i) => m + (spare * profiles[i].videos) / videoCount)
  }
  // Sin videos (o la duración declarada se queda corta): proporcional.
  return known.map((m) => (m * total) / (knownSum || 1))
}

/** Minutos de cada parte según los cortes (mínimo 1 y suman lo mismo que antes). */
export function splitDuration(total: number, sections: DbSectionRow[], cuts: number[]): number[] {
  const perSection = estimateSectionMinutes(total, sections)
  const bounds = [0, ...cuts, sections.length]
  const raw = bounds.slice(0, -1).map((from, k) => perSection.slice(from, bounds[k + 1]).reduce((a, b) => a + b, 0))
  const rounded = raw.map((m) => Math.max(1, Math.round(m)))
  // El redondeo se descuadra: la diferencia la absorbe la parte más larga.
  const drift = total - rounded.reduce((a, b) => a + b, 0)
  const biggest = rounded.indexOf(Math.max(...rounded))
  rounded[biggest] = Math.max(1, rounded[biggest] + drift)
  return rounded
}

/** Qué trae la sección, en palabras, para que la IA sepa cuánto pesa. */
function describeProfile(s: DbSectionRow, minutes: number): string {
  const p = sectionProfile(s)
  const bits: string[] = []
  if (p.videos) bits.push(p.videos === 1 ? 'video' : `${p.videos} videos`)
  if (p.quizzes) bits.push(p.quizzes === 1 ? '1 pregunta' : `${p.quizzes} preguntas`)
  if (p.games) bits.push(p.games === 1 ? 'juego' : `${p.games} juegos`)
  if (p.pdfs) bits.push(p.pdfs === 1 ? 'PDF' : `${p.pdfs} PDF`)
  if (p.chars > 0) bits.push(`${p.chars} caracteres de texto`)
  bits.push(`~${Math.max(1, Math.round(minutes))} min`)
  return bits.join(' · ')
}

/** Resumen de un módulo para el prompt: encabezados y un extracto, no todo. */
function toSurgeryModule(mod: DbModuleWithSections) {
  const sections = sortSections(mod.module_sections)
  const minutes = estimateSectionMinutes(mod.duration_min || 1, sections)
  return {
    title_es: mod.title_es,
    subtitle_es: mod.subtitle_es,
    duration_min: mod.duration_min || undefined,
    objectives_es: mod.objectives_es ?? [],
    key_takeaways_es: mod.key_takeaways_es ?? [],
    sections: sections.map((s, i) => ({
      heading_es: s.heading_es,
      excerpt_es: excerpt(s),
      profile_es: describeProfile(s, minutes[i]),
    })),
  }
}

/** Une dos listas sin repetidos (comparando sin acentos ni mayúsculas). */
function mergeUnique(a: string[] = [], b: string[] = []): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of [...a, ...b]) {
    const key = item.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item.trim())
  }
  return out
}

async function moveSection(sectionId: string, moduleId: string, sortOrder: number): Promise<void> {
  const { error } = await supabase
    .from('module_sections')
    .update({ module_id: moduleId, sort_order: sortOrder })
    .eq('id', sectionId)
  if (error) throw error
}

type ModulePatch = Parameters<typeof updateModuleMetadata>[1]

async function updateModuleRow(moduleId: string, patch: ModulePatch): Promise<void> {
  await updateModuleMetadata(moduleId, patch)
}

/** Crea una sección de texto suelta (los puentes que redacta la IA). */
async function insertTextSection(
  moduleId: string,
  sortOrder: number,
  heading: string,
  body: string[],
): Promise<string> {
  const { data, error } = await supabase
    .from('module_sections')
    .insert({
      module_id: moduleId,
      sort_order: sortOrder,
      heading_es: heading,
      body_es: body,
      media_shadow: false,
      section_style: 'default',
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function deleteSectionById(sectionId: string): Promise<void> {
  const { error } = await supabase.from('module_sections').delete().eq('id', sectionId)
  if (error) throw error
}

/**
 * Borrado DURO del módulo que acaba de crear una separación. Solo se usa dentro
 * de `undo()`: ese módulo nació hace segundos y nadie lo ha visto, así que no
 * pasa por el borrado suave (que dejaría una solicitud de aprobación colgando).
 *
 * Comprueba el error a propósito: si RLS no deja borrarlo, Deshacer tiene que
 * fallar a la vista y no fingir que revirtió algo que sigue ahí.
 */
async function hardDeleteModule(moduleId: string): Promise<void> {
  const { error } = await supabase.from('modules').delete().eq('id', moduleId)
  if (error) throw error
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLANES DE IA — el capacitador elige con interruptores QUÉ hace la IA.
   ═══════════════════════════════════════════════════════════════════════════ */

export type SurgeryAiWant = 'cut' | 'meta' | 'bridge'

export interface SplitAiPart extends Partial<PartMeta> {
  /** Cierre al final de esta parte (todas menos la última). */
  closing_es?: string
  /** Entrada al principio de esta parte (todas menos la primera). */
  intro_es?: string
}

export interface SplitAiPlan {
  /** Dónde arranca cada parte nueva. Vacío = la IA cree que no conviene separar. */
  cuts?: number[]
  /** Por qué cortó ahí, uno por corte y en el mismo orden. */
  cutReasons?: string[]
  /** El criterio general, en una o dos frases, para el capacitador. */
  summary?: string
  /** Una por parte resultante, en orden. */
  parts?: SplitAiPart[]
}

export interface MergeAiPlan extends Partial<PartMeta> {
  bridge_es?: { heading_es: string; body_es: string[] }
}

/** Lo que devuelve la Edge Function, tal cual (en snake_case). */
interface RawSplitPlan {
  cuts?: unknown
  cut_reasons?: unknown
  summary?: unknown
  /** Forma vieja, de cuando solo había un corte (EF sin redesplegar). */
  cut_index?: unknown
  cut_reason?: unknown
  parts?: unknown
}

const asText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const asTexts = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : [])

/** Pasa la respuesta cruda de la IA a la forma del modal, sin fiarse de su forma. */
function readSplitPlan(raw: RawSplitPlan, sectionCount: number): SplitAiPlan {
  const out: SplitAiPlan = {}
  let cuts: number[] | undefined
  let reasons: string[] = []
  if (Array.isArray(raw.cuts)) {
    cuts = raw.cuts.map(Number)
    reasons = asTexts(raw.cut_reasons)
  } else if (typeof raw.cut_index === 'number') {
    cuts = [raw.cut_index]
    reasons = [asText(raw.cut_reason) ?? '']
  }
  if (cuts) {
    // Las razones siguen a su corte aunque la IA los mande desordenados.
    const pairs = cuts
      .map((c, i) => ({ c: Math.round(c), r: reasons[i] ?? '' }))
      .filter((p) => Number.isFinite(p.c) && p.c >= 1 && p.c <= sectionCount - 1)
      .sort((a, b) => a.c - b.c)
      .filter((p, i, arr) => i === 0 || p.c !== arr[i - 1].c)
    out.cuts = pairs.map((p) => p.c)
    out.cutReasons = pairs.map((p) => p.r)
  }
  out.summary = asText(raw.summary)
  if (Array.isArray(raw.parts)) {
    out.parts = raw.parts.map((p) => {
      const part = (p ?? {}) as Record<string, unknown>
      return {
        title_es: asText(part.title_es),
        subtitle_es: asText(part.subtitle_es),
        objectives_es: Array.isArray(part.objectives_es) ? asTexts(part.objectives_es).filter(Boolean) : undefined,
        key_takeaways_es: Array.isArray(part.key_takeaways_es)
          ? asTexts(part.key_takeaways_es).filter(Boolean)
          : undefined,
        closing_es: asText(part.closing_es),
        intro_es: asText(part.intro_es),
      }
    })
  }
  return out
}

/**
 * Pide a la IA el plan de separación. `want` sale de los interruptores del modal:
 * con 'cut' la IA decide CUÁNTAS partes y dónde; sin 'cut' respeta los cortes que
 * puso el capacitador; sin 'meta' no toca los títulos; sin 'bridge' no redacta
 * enlaces.
 */
export async function planSplitWithAi(opts: {
  moduleId: string
  want: SurgeryAiWant[]
  cuts?: number[]
  /** Qué corregir respecto al intento anterior, escrito por el capacitador. */
  instruction?: string
}): Promise<SplitAiPlan> {
  const mod = await getModuleWithSectionsRaw(opts.moduleId)
  const { data } = await moduleAiAssist({
    action: 'split_plan',
    contentType: 'meta',
    sourceLang: 'es',
    fields: {},
    moduleTitle: pickLang(mod.title_es, mod.title_en, mod.title_pt, 'es'),
    surgery: {
      want: opts.want,
      cuts: opts.cuts,
      // Para una EF sin redesplegar, que solo entiende un corte.
      cutIndex: opts.cuts?.[0],
      instruction: opts.instruction?.trim() || undefined,
      modules: [toSurgeryModule(mod)],
    },
  })
  return readSplitPlan((data ?? {}) as RawSplitPlan, mod.module_sections.length)
}

/** Igual que `planSplitWithAi`, para la unión. `moduleIds` va en orden final. */
export async function planMergeWithAi(opts: {
  moduleIds: string[]
  want: SurgeryAiWant[]
  instruction?: string
}): Promise<MergeAiPlan> {
  const mods = await Promise.all(opts.moduleIds.map((id) => getModuleWithSectionsRaw(id)))
  const { data } = await moduleAiAssist({
    action: 'merge_plan',
    contentType: 'meta',
    sourceLang: 'es',
    fields: {},
    moduleTitle: mods[0] ? pickLang(mods[0].title_es, mods[0].title_en, mods[0].title_pt, 'es') : undefined,
    surgery: {
      want: opts.want,
      instruction: opts.instruction?.trim() || undefined,
      modules: mods.map(toSurgeryModule),
    },
  })
  return data as MergeAiPlan
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEPARAR
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SplitOptions {
  moduleId: string
  /**
   * Dónde arranca cada parte nueva: índices de sección en orden creciente, cada
   * uno entre 1 y nº secciones - 1. Un corte = 2 módulos; tres cortes = 4.
   */
  cuts: number[]
  /** Metadatos finales de cada parte, en orden (ya editados por el capacitador). */
  parts?: PartMeta[]
  /** Textos de enlace de cada parte, en el mismo orden que `parts`. */
  bridges?: SplitBridge[]
}

export interface SplitOutcome extends PendingSurgery {
  /** Ids de los módulos nuevos (de la parte 2 en adelante), en orden. */
  newModuleIds: string[]
}

/** Deja los cortes válidos: enteros, dentro de rango, sin repetir y en orden. */
export function normalizeCuts(cuts: number[], sectionCount: number): number[] {
  const valid = cuts
    .map((c) => Math.round(c))
    .filter((c) => Number.isFinite(c) && c >= 1 && c <= sectionCount - 1)
  return [...new Set(valid)].sort((a, b) => a - b)
}

/** Reparte una lista en `n` tramos seguidos lo más parejos posible. */
export function chunkEven<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  let from = 0
  for (let k = 0; k < n; k++) {
    const size = Math.ceil((list.length - from) / (n - k))
    out.push(list.slice(from, from + size))
    from += size
  }
  return out
}

/**
 * Parte un módulo en tantas partes como cortes + 1. La parte 1 CONSERVA el id
 * del módulo original — así el avance de quien ya lo terminó sigue en pie y las
 * referencias externas (regla de desbloqueo del curso, región de mundo) no se
 * rompen. Las demás nacen como módulos nuevos, seguidos en el orden del curso.
 */
export async function splitModule(opts: SplitOptions): Promise<SplitOutcome> {
  const src = await getModuleWithSectionsRaw(opts.moduleId)
  const sections = sortSections(src.module_sections)
  const cuts = normalizeCuts(opts.cuts, sections.length)

  if (cuts.length === 0 || cuts.length !== opts.cuts.length) {
    throw new Error('SPLIT_CUT_OUT_OF_RANGE')
  }

  const bounds = [0, ...cuts, sections.length]
  const chunks = cuts.map((_, i) => sections.slice(bounds[i + 1], bounds[i + 2]))
  const headLength = cuts[0]
  const extra = chunks.length

  const meta = (k: number) => opts.parts?.[k]

  // Reparto automático por peso de texto, salvo que el modal traiga minutos
  // escritos a mano — ahí manda lo que escribió el capacitador.
  const autoMin = splitDuration(src.duration_min || 1, sections, cuts)
  const pickMin = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && v > 0 ? Math.round(v) : fallback
  const minutes = autoMin.map((auto, k) => pickMin(meta(k)?.duration_min, auto))

  // Sin ayuda de la IA los objetivos se reparten en tramos seguidos, uno por
  // parte. Es un reparto discutible pero editable, y mejor que dejarlas todas
  // con los mismos objetivos.
  const objectiveChunks = chunkEven(src.objectives_es ?? [], cuts.length + 1)

  // 1) Hueco en el orden del curso para que las partes nuevas queden seguidas.
  const shifted: Array<{ id: string; course_sort_order: number }> = []
  if (src.course_id) {
    const { data: siblings } = await supabase
      .from('modules')
      .select('id, course_sort_order')
      .eq('course_id', src.course_id)
      .gt('course_sort_order', src.course_sort_order ?? 0)
    for (const s of (siblings ?? []) as Array<{ id: string; course_sort_order: number }>) {
      shifted.push(s)
      await updateModuleRow(s.id, { course_sort_order: (s.course_sort_order ?? 0) + extra })
    }
  }

  const { data: maxRow } = await supabase
    .from('modules')
    .select('sort_order')
    .eq('campaign_id', src.campaign_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const baseSort = (maxRow?.sort_order as number | undefined) ?? 0

  // 2) Los módulos nuevos. Nacen con el mismo estado de publicación que el
  //    original: si el original estaba publicado y estos nacieran en borrador,
  //    el curso se quedaría cojo para el aprendiz justo después de separar.
  //    Se crean de a uno: cada slug libre se busca después de insertar el
  //    anterior, si no dos partes podrían recibir el mismo.
  const created: CreatedPart[] = []
  const bridgeIds: string[] = []
  try {
    for (let i = 0; i < chunks.length; i++) {
      const k = i + 1
      const m = meta(k)
      const slug = await freeSlugInCampaign(src.campaign_id, `${src.slug}-${k + 1}`)
      const { data: row, error: createErr } = await supabase
        .from('modules')
        .insert({
          campaign_id: src.campaign_id,
          course_id: src.course_id ?? null,
          course_sort_order: (src.course_sort_order ?? 0) + k,
          slug,
          icon: src.icon,
          duration_min: minutes[k],
          sort_order: baseSort + k,
          title_es: m?.title_es || `${src.title_es} (${k + 1})`,
          title_en: null,
          title_pt: null,
          subtitle_es: m?.subtitle_es ?? src.subtitle_es,
          objectives_es: m?.objectives_es ?? objectiveChunks[k],
          // Las partes nuevas nacen sin puntos clave salvo que la IA los redacte:
          // los del original resumen el módulo entero y se quedan con la parte 1,
          // que conserva la identidad (mismo id, mismo slug) del módulo de siempre.
          key_takeaways_es: m?.key_takeaways_es ?? [],
          sound_theme: src.sound_theme,
          is_published: src.is_published,
        })
        .select('id')
        .single()
      if (createErr) throw createErr
      const part: CreatedPart = { id: (row as { id: string }).id, slug, moved: [] }
      created.push(part)

      // 3) Mover su tramo. El módulo está vacío, así que no hay colisión de
      //    sort_order. Si lleva entrada, el contenido arranca en 1.
      const intro = opts.bridges?.[k]?.intro_es?.trim()
      const offset = intro ? 1 : 0
      for (let j = 0; j < chunks[i].length; j++) {
        await moveSection(chunks[i][j].id, part.id, j + offset)
        part.moved.push(chunks[i][j])
      }
      if (intro) bridgeIds.push(await insertTextSection(part.id, 0, 'Retomemos', [intro]))
    }

    // 4) Cierres, al final de cada parte menos la última. Son secciones de
    //    texto normales: el capacitador las edita o las borra como cualquiera.
    const partIds = [src.id, ...created.map((c) => c.id)]
    const partLens = [headLength, ...chunks.map((c) => c.length)]
    for (let k = 0; k < partIds.length - 1; k++) {
      const closing = opts.bridges?.[k]?.closing_es?.trim()
      if (!closing) continue
      const offset = k > 0 && opts.bridges?.[k]?.intro_es?.trim() ? 1 : 0
      bridgeIds.push(await insertTextSection(partIds[k], partLens[k] + offset, 'Cierre', [closing]))
    }
  } catch (e) {
    // A medio camino no se deja un curso roto: se devuelve todo a su sitio.
    await rollbackSplit(src, created, bridgeIds, shifted).catch(() => {})
    throw e
  }

  // 5) Metadatos de la parte 1. Las traducciones solo se borran si el título
  //    cambió de verdad: separar sin renombrar no debe tirar el trabajo de
  //    traducción de un curso ya publicado en tres idiomas.
  const metaA = meta(0)
  const titleChangedA = !!metaA && metaA.title_es !== src.title_es
  await updateModuleRow(src.id, {
    duration_min: minutes[0],
    objectives_es: metaA?.objectives_es ?? objectiveChunks[0],
    ...(metaA
      ? {
          title_es: metaA.title_es,
          subtitle_es: metaA.subtitle_es ?? src.subtitle_es,
          ...(metaA.key_takeaways_es ? { key_takeaways_es: metaA.key_takeaways_es } : {}),
        }
      : {}),
    ...(titleChangedA ? { title_en: null, title_pt: null } : {}),
  })

  await logActivity({
    action: 'edit_content',
    entityType: 'modules',
    entityId: src.id,
    entityLabel: pickLang(src.title_es, src.title_en, src.title_pt, 'es'),
    campaignId: src.campaign_id,
    detail: {
      operacion: 'separar',
      partes: cuts.length + 1,
      cortes: cuts,
      modulos_nuevos: created.map((c) => c.id),
      secciones_movidas: chunks.reduce((sum, c) => sum + c.length, 0),
    },
  }).catch(() => {})

  return {
    newModuleIds: created.map((c) => c.id),

    async undo() {
      await rollbackSplit(src, created, bridgeIds, shifted)
    },

    async finalize() {
      // Cada parte nueva hereda el avance del original por su lado: quien ya
      // lo había terminado queda con TODAS las partes completas.
      let affected = 0
      for (const c of created) {
        const { data, error } = await supabase.rpc('split_module_progress', {
          p_source: src.id,
          p_new: c.id,
          p_new_slug: c.slug,
        })
        // Sin la RPC creada, el contenido queda bien separado y solo se pierde
        // la herencia de avance: preferible a reventar la operación entera.
        if (error) return affected
        affected = Math.max(affected, (data as number) ?? 0)
      }
      return affected
    },
  }
}

interface CreatedPart {
  id: string
  slug: string
  /** Secciones que ya se movieron a esta parte (para devolverlas al deshacer). */
  moved: DbSectionRow[]
}

/** Devuelve el módulo original a como estaba antes de separarlo. */
async function rollbackSplit(
  src: DbModuleWithSections,
  created: CreatedPart[],
  bridgeIds: string[],
  shifted: Array<{ id: string; course_sort_order: number }>,
): Promise<void> {
  for (const id of bridgeIds) await deleteSectionById(id)
  for (const c of created) {
    for (const s of c.moved) await moveSection(s.id, src.id, s.sort_order)
    await hardDeleteModule(c.id)
  }
  await updateModuleRow(src.id, {
    duration_min: src.duration_min,
    title_es: src.title_es,
    title_en: src.title_en,
    title_pt: src.title_pt,
    subtitle_es: src.subtitle_es,
    objectives_es: src.objectives_es ?? [],
    key_takeaways_es: src.key_takeaways_es ?? [],
  })
  for (const s of shifted) await updateModuleRow(s.id, { course_sort_order: s.course_sort_order })
}

/* ═══════════════════════════════════════════════════════════════════════════
   UNIR
   ═══════════════════════════════════════════════════════════════════════════ */

export interface MergeOptions {
  /** Módulo que absorbe: conserva su id, su avance y su lugar en el curso. */
  keepId: string
  /** Módulo que se vacía y se elimina al confirmar. */
  absorbedId: string
  /** Metadatos finales del módulo unido. */
  meta?: PartMeta
  /** Sección puente entre el contenido de uno y otro. */
  bridge?: { heading_es: string; body_es: string[] }
}

/**
 * Funde `absorbedId` dentro de `keepId`: las secciones del segundo se cuelgan
 * detrás de las del primero. El absorbido queda vacío y desenganchado del curso
 * hasta `finalize()`, que es cuando se pide su eliminación de verdad.
 */
export async function mergeModules(opts: MergeOptions): Promise<PendingSurgery> {
  const keep = await getModuleWithSectionsRaw(opts.keepId)
  const absorbed = await getModuleWithSectionsRaw(opts.absorbedId)

  const keepSections = sortSections(keep.module_sections)
  const movedSections = sortSections(absorbed.module_sections)

  let cursor = keepSections.length
  let bridgeId: string | null = null

  // 1) Puente, si se pidió: queda justo en la costura.
  if (opts.bridge?.body_es?.length) {
    bridgeId = await insertTextSection(
      keep.id,
      cursor,
      opts.bridge.heading_es || 'Enlace',
      opts.bridge.body_es,
    )
    cursor += 1
  }

  // 2) Mover el contenido del absorbido detrás del que se queda.
  for (let i = 0; i < movedSections.length; i++) {
    await moveSection(movedSections[i].id, keep.id, cursor + i)
  }

  // 3) Metadatos del módulo unido.
  await updateModuleRow(keep.id, {
    duration_min:
      typeof opts.meta?.duration_min === 'number' && opts.meta.duration_min > 0
        ? Math.round(opts.meta.duration_min)
        : (keep.duration_min || 0) + (absorbed.duration_min || 0),
    title_es: opts.meta?.title_es || keep.title_es,
    subtitle_es: opts.meta?.subtitle_es ?? keep.subtitle_es,
    objectives_es: opts.meta?.objectives_es ?? mergeUnique(keep.objectives_es, absorbed.objectives_es),
    key_takeaways_es:
      opts.meta?.key_takeaways_es ?? mergeUnique(keep.key_takeaways_es, absorbed.key_takeaways_es),
    // Si el título cambió, las traducciones viejas describen otro módulo.
    ...(opts.meta?.title_es && opts.meta.title_es !== keep.title_es
      ? { title_en: null, title_pt: null }
      : {}),
  })

  // 4) El absorbido deja de estar publicado — vacío y visible sería un módulo de
  //    0 secciones en la ruta del aprendiz. NO sale del curso: un módulo ya no
  //    puede quedar suelto (2026-09-18), y si la página se cerraba antes de
  //    `finalize()` quedaba suelto para siempre. Se va al final del orden (el
  //    editor lo oculta con `hiddenModuleIds`) y `finalize()` lo elimina.
  await updateModuleRow(absorbed.id, {
    course_sort_order: 100000 + (absorbed.course_sort_order ?? 0),
    is_published: false,
  })

  // 5) Cerrar el hueco que dejó en el orden del curso.
  const closed: Array<{ id: string; course_sort_order: number }> = []
  if (absorbed.course_id) {
    const { data: siblings } = await supabase
      .from('modules')
      .select('id, course_sort_order')
      .eq('course_id', absorbed.course_id)
      .neq('id', absorbed.id)
      .gt('course_sort_order', absorbed.course_sort_order ?? 0)
    for (const s of (siblings ?? []) as Array<{ id: string; course_sort_order: number }>) {
      closed.push(s)
      await updateModuleRow(s.id, { course_sort_order: Math.max(0, (s.course_sort_order ?? 1) - 1) })
    }
  }

  await logActivity({
    action: 'edit_content',
    entityType: 'modules',
    entityId: keep.id,
    entityLabel: pickLang(keep.title_es, keep.title_en, keep.title_pt, 'es'),
    campaignId: keep.campaign_id,
    detail: {
      operacion: 'unir',
      absorbido: absorbed.id,
      absorbido_titulo: pickLang(absorbed.title_es, absorbed.title_en, absorbed.title_pt, 'es'),
      secciones_movidas: movedSections.length,
    },
  }).catch(() => {})

  return {
    async undo() {
      if (bridgeId) await deleteSectionById(bridgeId)
      for (const s of movedSections) await moveSection(s.id, absorbed.id, s.sort_order)
      await updateModuleRow(keep.id, {
        duration_min: keep.duration_min,
        title_es: keep.title_es,
        title_en: keep.title_en,
        title_pt: keep.title_pt,
        subtitle_es: keep.subtitle_es,
        objectives_es: keep.objectives_es ?? [],
        key_takeaways_es: keep.key_takeaways_es ?? [],
      })
      await updateModuleRow(absorbed.id, {
        course_sort_order: absorbed.course_sort_order ?? 0,
        is_published: absorbed.is_published,
      })
      for (const s of closed) await updateModuleRow(s.id, { course_sort_order: s.course_sort_order })
    },

    async finalize() {
      let affected = 0
      const { data, error } = await supabase.rpc('merge_module_progress', {
        p_keep: keep.id,
        p_absorbed: absorbed.id,
        p_absorbed_slug: absorbed.slug,
      })
      if (!error) affected = (data as number) ?? 0
      // Borrado suave con el flujo de siempre: definitivo para el superadmin,
      // solicitud de aprobación para el capacitador.
      await deleteModule(absorbed.id)
      return affected
    },
    hiddenModuleIds: [absorbed.id],
  }
}

/**
 * Une N módulos (≥2) en el primero de la lista, en ese orden exacto.
 *
 * Se resuelve encadenando uniones de a dos, así que la lógica delicada vive en
 * un solo sitio. `undo()` deshace en orden INVERSO — al revés se pisarían los
 * `sort_order` que la unión anterior ya había corrido.
 */
export async function mergeManyModules(opts: {
  moduleIds: string[]
  meta?: PartMeta
  bridge?: { heading_es: string; body_es: string[] }
}): Promise<PendingSurgery> {
  const [keepId, ...rest] = opts.moduleIds
  if (!keepId || rest.length === 0) throw new Error('MERGE_NEEDS_TWO')

  const steps: PendingSurgery[] = []
  try {
    for (let i = 0; i < rest.length; i++) {
      steps.push(
        await mergeModules({
          keepId,
          absorbedId: rest[i],
          // Los metadatos finales y el puente se aplican en la primera costura;
          // las siguientes solo arrastran contenido.
          meta: i === 0 ? opts.meta : undefined,
          bridge: i === 0 ? opts.bridge : undefined,
        }),
      )
    }
  } catch (e) {
    // Si una costura falla, se deshacen las que sí entraron: mejor no dejar el
    // curso a medio unir.
    for (const s of steps.reverse()) await s.undo().catch(() => {})
    throw e
  }

  // Cada costura recalcula la duración sumando; con tres o más módulos la última
  // pisaría los minutos escritos a mano. Se vuelven a poner al final.
  const manualMin = opts.meta?.duration_min
  if (typeof manualMin === 'number' && manualMin > 0 && rest.length > 1) {
    await updateModuleRow(keepId, { duration_min: Math.round(manualMin) })
  }

  return {
    async undo() {
      for (const s of [...steps].reverse()) await s.undo()
    },
    async finalize() {
      let affected = 0
      for (const s of steps) affected = Math.max(affected, await s.finalize())
      return affected
    },
    hiddenModuleIds: steps.flatMap((s) => s.hiddenModuleIds ?? []),
  }
}

/* Reexport de conveniencia para los modales, que necesitan el módulo con sus
   secciones para dibujar la línea de corte. */
export { getModuleWithSectionsRaw }
export type { DbModuleWithSections, DbSectionRow, Json }
