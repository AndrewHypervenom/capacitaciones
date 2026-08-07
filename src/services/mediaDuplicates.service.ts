/**
 * ¿Este documento ya está en el curso?
 *
 * Antes de subir un PDF o un video, el editor pregunta acá. El barrido recorre
 * TODOS los módulos del curso al que pertenece el módulo que se está editando
 * (no solo el módulo actual: el punto es enterarse de que el manual ya lo subió
 * otro capacitador en el módulo 3) y arma el inventario de medios subidos.
 *
 * Cómo se comparan dos archivos, en orden de confianza:
 *   1. Huella de contenido (SHA-256 incrustado en la URL, ver `lib/fileHash`).
 *      Es el mismo archivo aunque lo hayan renombrado. Solo con este nivel se
 *      ofrece reusar el archivo existente.
 *   2. Nombre de archivo idéntico, cuando alguno de los dos no tiene huella
 *      (subido antes de este mecanismo). Es una sospecha, no una certeza: se
 *      avisa pero NO se ofrece reusar, porque el contenido podría diferir.
 *
 * También sirve de red de seguridad al borrar: `deleteSectionMedia` pregunta si
 * la URL la usa alguien más del curso antes de borrar el objeto de Storage, que
 * es justo lo que "usar el mismo archivo" vuelve frecuente.
 */
import { supabase } from '@/lib/supabase'
import type { ContentBlock } from '@/types/blocks'
import { hashFromMediaUrl } from '@/lib/fileHash'

export type MediaKind = 'pdf' | 'video'

/** Un archivo subido, con el lugar exacto donde está para poder nombrárselo al
 *  capacitador ("Módulo 3 · Reporte de novedades"). */
export interface MediaUse {
  url: string
  hash: string | null
  kind: MediaKind
  filename: string | null
  moduleId: string
  moduleTitle: string
  sectionId: string
  sectionHeading: string
}

export interface DuplicateMatch {
  use: MediaUse
  /** 'exact' = misma huella de contenido. 'filename' = solo coincide el nombre. */
  confidence: 'exact' | 'filename'
}

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)

/** Nombre visible del archivo dentro de una URL de Storage, sin el sufijo de
 *  huella que le agrega `uploadSectionMedia`. Solo para PDFs viejos sin
 *  `filename` en el bloque. */
function filenameFromUrl(url: string): string | null {
  const last = url.split('?')[0].split('/').pop()
  return last ? decodeURIComponent(last) : null
}

/** Recorre los bloques (incluidos los anidados en `columns`) juntando los medios
 *  subidos. YouTube/Vimeo quedan fuera: no son archivos nuestros. */
function collectFromBlocks(
  blocks: ContentBlock[],
  base: Omit<MediaUse, 'url' | 'hash' | 'kind' | 'filename'>,
  out: MediaUse[],
): void {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'columns') {
      for (const col of b.columns ?? []) collectFromBlocks(col.blocks ?? [], base, out)
      continue
    }
    if (b.type === 'pdf' && isHttp(b.url)) {
      out.push({
        ...base,
        url: b.url,
        hash: hashFromMediaUrl(b.url),
        kind: 'pdf',
        filename: b.filename ?? filenameFromUrl(b.url),
      })
      continue
    }
    // Solo videos subidos por nosotros; los embebidos guardan un id, no una URL.
    if (b.type === 'video' && b.kind !== 'youtube' && b.kind !== 'vimeo' && isHttp(b.url)) {
      out.push({
        ...base,
        url: b.url,
        hash: hashFromMediaUrl(b.url),
        kind: 'video',
        filename: filenameFromUrl(b.url),
      })
    }
  }
}

interface SectionRow {
  id: string
  module_id: string
  heading_es: string | null
  media_type: string | null
  media_url: string | null
  blocks_data: unknown
}

/**
 * Inventario de PDFs y videos subidos en el curso del módulo indicado.
 *
 * Si el módulo todavía no está en ningún curso (`course_id` nulo) el barrido se
 * limita a sus propias secciones: sin curso no hay "ya está en el curso" que
 * avisar, pero repetir el archivo dentro del mismo módulo sí vale la pena.
 */
export async function collectCourseMedia(moduleId: string): Promise<MediaUse[]> {
  const { data: mod, error: modErr } = await supabase
    .from('modules')
    .select('id, course_id')
    .eq('id', moduleId)
    .maybeSingle()
  if (modErr) throw modErr
  if (!mod) return []

  let modules: Array<{ id: string; title_es: string | null }> = []
  if (mod.course_id) {
    const { data, error } = await supabase
      .from('modules')
      .select('id, title_es, deleted_at')
      .eq('course_id', mod.course_id)
    if (error) throw error
    // `deleted_at` existe en la tabla pero todavía no en los tipos generados
    // (borrado suave); el cast es solo para eso. Un módulo en la papelera no
    // debe generar avisos: su documento ya no lo ve nadie.
    const rows = (data ?? []) as unknown as Array<{ id: string; title_es: string | null; deleted_at: string | null }>
    modules = rows.filter((m) => !m.deleted_at).map((m) => ({ id: m.id, title_es: m.title_es }))
  } else {
    const { data } = await supabase.from('modules').select('id, title_es').eq('id', moduleId)
    modules = data ?? []
  }
  if (!modules.length) return []

  const titleById = new Map(modules.map((m) => [m.id, m.title_es ?? '']))
  const { data: sections, error: secErr } = await supabase
    .from('module_sections')
    .select('id, module_id, heading_es, media_type, media_url, blocks_data')
    .in('module_id', modules.map((m) => m.id))
  if (secErr) throw secErr

  const out: MediaUse[] = []
  for (const s of (sections ?? []) as SectionRow[]) {
    const base = {
      moduleId: s.module_id,
      moduleTitle: titleById.get(s.module_id) ?? '',
      sectionId: s.id,
      sectionHeading: s.heading_es ?? '',
    }
    // Video a nivel de sección (estilo video-interactivo), fuera de los bloques.
    if (s.media_type === 'video' && isHttp(s.media_url)) {
      out.push({
        ...base,
        url: s.media_url,
        hash: hashFromMediaUrl(s.media_url),
        kind: 'video',
        filename: filenameFromUrl(s.media_url),
      })
    }
    if (Array.isArray(s.blocks_data)) collectFromBlocks(s.blocks_data as ContentBlock[], base, out)
  }
  return out
}

/**
 * Busca en el curso un archivo que sea el que se está por subir.
 *
 * `excludeUrl` deja fuera el archivo que ya ocupa el bloque que se está editando
 * (reemplazarlo por sí mismo no es un duplicado que valga avisar).
 */
export async function findDuplicateMedia(
  moduleId: string,
  candidate: { hash: string | null; filename: string; kind: MediaKind },
  excludeUrl?: string,
): Promise<DuplicateMatch | null> {
  // Un barrido que falla no puede impedir subir el archivo: es un aviso, no una
  // compuerta.
  let uses: MediaUse[]
  try {
    uses = await collectCourseMedia(moduleId)
  } catch {
    return null
  }
  const name = candidate.filename.trim().toLowerCase()

  let byName: MediaUse | null = null
  for (const use of uses) {
    if (use.kind !== candidate.kind) continue
    if (excludeUrl && use.url === excludeUrl) continue
    if (candidate.hash && use.hash && use.hash === candidate.hash) {
      return { use, confidence: 'exact' }
    }
    // Solo cuando a alguno le falta la huella: si ambos la tienen y no coincide,
    // son archivos distintos por más que compartan el nombre.
    if (!byName && (!candidate.hash || !use.hash) && name && use.filename?.trim().toLowerCase() === name) {
      byName = use
    }
  }
  return byName ? { use: byName, confidence: 'filename' } : null
}

/**
 * ¿Otro bloque o sección del curso usa este mismo archivo?
 *
 * Con "usar el mismo archivo" varios bloques comparten un único objeto de
 * Storage: borrar el bloque no puede llevarse el archivo por delante. Si el
 * barrido falla devuelve true — dejar un archivo huérfano cuesta cupo; borrar
 * uno vivo rompe el módulo de otro.
 *
 * El umbral es >1 y no >0 porque la fila del bloque que se está limpiando
 * todavía apunta a la URL (mismo criterio que `deleteSectionMedia`). Cero
 * ocurrencias = el archivo se acaba de subir y nunca se guardó: se borra.
 */
export async function isMediaUrlSharedInCourse(moduleId: string, url: string): Promise<boolean> {
  try {
    const uses = await collectCourseMedia(moduleId)
    return uses.filter((u) => u.url === url).length > 1
  } catch {
    return true
  }
}
