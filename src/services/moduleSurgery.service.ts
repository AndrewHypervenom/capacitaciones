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
   CIRUGÍA DE MÓDULOS — separar uno largo en dos, unir dos en uno.

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

/** Textos de enlace entre las dos partes. Se materializan como secciones. */
export interface SplitBridge {
  /** Cierre que se añade al final de la parte 1. */
  closing_es?: string
  /** Entrada que se añade al principio de la parte 2. */
  intro_es?: string
}

/* ─── Helpers de contenido ─────────────────────────────────────────────────── */

const sortSections = (rows: DbSectionRow[]) => [...rows].sort((a, b) => a.sort_order - b.sort_order)

/** Cuerpo de la sección en el idioma que se haya escrito (no siempre el español). */
const sectionBody = (s: DbSectionRow): string[] =>
  pickLangList(s.body_es, s.body_en, s.body_pt, 'es')

/** Primeras palabras del cuerpo de una sección, para que la IA sepa de qué va. */
function excerpt(section: DbSectionRow, max = 220): string {
  const text = sectionBody(section).join(' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Resumen de un módulo para el prompt: encabezados y un extracto, no todo. */
function toSurgeryModule(mod: DbModuleWithSections) {
  return {
    title_es: mod.title_es,
    subtitle_es: mod.subtitle_es,
    objectives_es: mod.objectives_es ?? [],
    key_takeaways_es: mod.key_takeaways_es ?? [],
    sections: sortSections(mod.module_sections).map((s) => ({
      heading_es: s.heading_es,
      excerpt_es: excerpt(s),
    })),
  }
}

/** Reparte los minutos según cuánto texto se lleva cada parte (mínimo 1). */
function splitDuration(total: number, sections: DbSectionRow[], cutIndex: number): [number, number] {
  const weight = (s: DbSectionRow) => Math.max(1, sectionBody(s).join(' ').length)
  const all = sections.reduce((sum, s) => sum + weight(s), 0)
  const first = sections.slice(0, cutIndex).reduce((sum, s) => sum + weight(s), 0)
  const a = Math.max(1, Math.round((total * first) / (all || 1)))
  return [a, Math.max(1, total - a)]
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

export interface SplitAiPlan {
  cutIndex?: number
  cutReason?: string
  parts?: [PartMeta & { closing_es?: string }, PartMeta & { intro_es?: string }]
}

export interface MergeAiPlan extends Partial<PartMeta> {
  bridge_es?: { heading_es: string; body_es: string[] }
}

/**
 * Pide a la IA el plan de separación. `want` sale de los interruptores del modal:
 * sin 'cut' respeta el corte que el capacitador arrastró; sin 'meta' no toca los
 * títulos; sin 'bridge' no redacta enlaces.
 */
export async function planSplitWithAi(opts: {
  moduleId: string
  want: SurgeryAiWant[]
  cutIndex?: number
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
      cutIndex: opts.cutIndex,
      instruction: opts.instruction?.trim() || undefined,
      modules: [toSurgeryModule(mod)],
    },
  })
  return data as SplitAiPlan
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
  /** Índice de la sección con la que ARRANCA la parte 2 (1 … nº secciones - 1). */
  cutIndex: number
  /** Metadatos finales de cada parte (ya editados por el capacitador). */
  parts?: [PartMeta, PartMeta]
  /** Textos de enlace, si el capacitador los pidió. */
  bridge?: SplitBridge
}

export interface SplitOutcome extends PendingSurgery {
  /** Id del módulo nuevo (la parte 2). */
  newModuleId: string
}

/**
 * Parte un módulo en dos por `cutIndex`. La parte 1 CONSERVA el id del módulo
 * original — así el avance de quien ya lo terminó sigue en pie y las referencias
 * externas (regla de desbloqueo del curso, región de mundo) no se rompen.
 */
export async function splitModule(opts: SplitOptions): Promise<SplitOutcome> {
  const src = await getModuleWithSectionsRaw(opts.moduleId)
  const sections = sortSections(src.module_sections)
  const cut = opts.cutIndex

  if (cut < 1 || cut >= sections.length) {
    throw new Error('SPLIT_CUT_OUT_OF_RANGE')
  }

  const head = sections.slice(0, cut)
  const tail = sections.slice(cut)

  const metaA = opts.parts?.[0]
  const metaB = opts.parts?.[1]

  // Reparto automático por peso de texto, salvo que el modal traiga minutos
  // escritos a mano — ahí manda lo que escribió el capacitador.
  const [autoA, autoB] = splitDuration(src.duration_min || 1, sections, cut)
  const pickMin = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && v > 0 ? Math.round(v) : fallback
  const durA = pickMin(metaA?.duration_min, autoA)
  const durB = pickMin(metaB?.duration_min, autoB)

  // Sin ayuda de la IA los objetivos se reparten en dos mitades (y los puntos
  // clave se quedan con la parte 2, que es la que cierra el tema). Es un reparto
  // discutible pero editable, y mejor que dejar las dos partes idénticas.
  const objectives = src.objectives_es ?? []
  const half = Math.ceil(objectives.length / 2)

  const newSlug = await freeSlugInCampaign(src.campaign_id, `${src.slug}-2`)

  // 1) Hueco en el orden del curso para que la parte 2 quede justo detrás.
  const shifted: Array<{ id: string; course_sort_order: number }> = []
  if (src.course_id) {
    const { data: siblings } = await supabase
      .from('modules')
      .select('id, course_sort_order')
      .eq('course_id', src.course_id)
      .gt('course_sort_order', src.course_sort_order ?? 0)
    for (const s of (siblings ?? []) as Array<{ id: string; course_sort_order: number }>) {
      shifted.push(s)
      await updateModuleRow(s.id, { course_sort_order: (s.course_sort_order ?? 0) + 1 })
    }
  }

  // 2) El módulo nuevo. Nace con el mismo estado de publicación que el original:
  //    si el original estaba publicado y este naciera en borrador, el curso se
  //    quedaría cojo para el aprendiz justo después de separar.
  const { data: maxRow } = await supabase
    .from('modules')
    .select('sort_order')
    .eq('campaign_id', src.campaign_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: created, error: createErr } = await supabase
    .from('modules')
    .insert({
      campaign_id: src.campaign_id,
      course_id: src.course_id ?? null,
      course_sort_order: (src.course_sort_order ?? 0) + 1,
      slug: newSlug,
      icon: src.icon,
      duration_min: durB,
      sort_order: ((maxRow?.sort_order as number | undefined) ?? 0) + 1,
      title_es: metaB?.title_es || `${src.title_es} (2)`,
      title_en: null,
      title_pt: null,
      subtitle_es: metaB?.subtitle_es ?? src.subtitle_es,
      objectives_es: metaB?.objectives_es ?? objectives.slice(half),
      // La parte 2 nace sin puntos clave salvo que la IA los redacte: los del
      // original resumen el módulo entero y se quedan con la parte 1, que
      // conserva la identidad (mismo id, mismo slug) del módulo de siempre.
      key_takeaways_es: metaB?.key_takeaways_es ?? [],
      sound_theme: src.sound_theme,
      is_published: src.is_published,
    })
    .select('id')
    .single()
  if (createErr) throw createErr
  const newModuleId = (created as { id: string }).id

  // 3) Mover la cola. Nadie más apunta a esas filas, así que no hay colisión de
  //    sort_order: el módulo nuevo está vacío.
  for (let i = 0; i < tail.length; i++) {
    await moveSection(tail[i].id, newModuleId, i)
  }

  // 4) Metadatos de la parte 1. Las traducciones solo se borran si el título
  //    cambió de verdad: separar sin renombrar no debe tirar el trabajo de
  //    traducción de un curso ya publicado en tres idiomas.
  const titleChangedA = !!metaA && metaA.title_es !== src.title_es
  await updateModuleRow(src.id, {
    duration_min: durA,
    objectives_es: metaA?.objectives_es ?? objectives.slice(0, half),
    ...(metaA
      ? {
          title_es: metaA.title_es,
          subtitle_es: metaA.subtitle_es ?? src.subtitle_es,
          ...(metaA.key_takeaways_es ? { key_takeaways_es: metaA.key_takeaways_es } : {}),
        }
      : {}),
    ...(titleChangedA ? { title_en: null, title_pt: null } : {}),
  })

  // 5) Puentes redactados por la IA, como secciones de texto normales (el
  //    capacitador las edita o las borra como cualquier otra).
  const bridgeIds: string[] = []
  if (opts.bridge?.closing_es?.trim()) {
    bridgeIds.push(
      await insertTextSection(src.id, head.length, 'Cierre', [opts.bridge.closing_es.trim()]),
    )
  }
  if (opts.bridge?.intro_es?.trim()) {
    // Entra al principio de la parte 2: hay que correr lo ya movido.
    for (let i = tail.length - 1; i >= 0; i--) await moveSection(tail[i].id, newModuleId, i + 1)
    bridgeIds.push(
      await insertTextSection(newModuleId, 0, 'Retomemos', [opts.bridge.intro_es.trim()]),
    )
  }

  await logActivity({
    action: 'edit_content',
    entityType: 'modules',
    entityId: src.id,
    entityLabel: pickLang(src.title_es, src.title_en, src.title_pt, 'es'),
    campaignId: src.campaign_id,
    detail: { operacion: 'separar', corte: cut, modulo_nuevo: newModuleId, secciones_movidas: tail.length },
  }).catch(() => {})

  return {
    newModuleId,

    async undo() {
      for (const id of bridgeIds) await deleteSectionById(id)
      for (const s of tail) await moveSection(s.id, src.id, s.sort_order)
      await hardDeleteModule(newModuleId)
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
    },

    async finalize() {
      const { data, error } = await supabase.rpc('split_module_progress', {
        p_source: src.id,
        p_new: newModuleId,
        p_new_slug: newSlug,
      })
      // Sin la RPC creada, el contenido queda bien separado y solo se pierde la
      // herencia de avance: preferible a reventar la operación entera.
      if (error) return 0
      return (data as number) ?? 0
    },
  }
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

  // 4) El absorbido sale del curso y deja de estar publicado — vacío y visible
  //    sería un módulo de 0 secciones en la ruta del aprendiz.
  await updateModuleRow(absorbed.id, {
    course_id: null,
    course_sort_order: 0,
    is_published: false,
  })

  // 5) Cerrar el hueco que dejó en el orden del curso.
  const closed: Array<{ id: string; course_sort_order: number }> = []
  if (absorbed.course_id) {
    const { data: siblings } = await supabase
      .from('modules')
      .select('id, course_sort_order')
      .eq('course_id', absorbed.course_id)
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
        course_id: absorbed.course_id ?? null,
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
  }
}

/* Reexport de conveniencia para los modales, que necesitan el módulo con sus
   secciones para dibujar la línea de corte. */
export { getModuleWithSectionsRaw }
export type { DbModuleWithSections, DbSectionRow, Json }
