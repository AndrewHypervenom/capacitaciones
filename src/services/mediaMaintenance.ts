/**
 * Optimización masiva de las imágenes que YA estaban subidas.
 *
 * Desde `lib/imageOptimize` toda imagen nueva se reescala y recomprime en el
 * navegador antes de subir. Esto es la otra mitad: lo que lleva meses en los
 * buckets y sigue siendo el PNG original de 6 MB. Barre TODO el sitio:
 *
 *   · portadas de curso        courses.cover_url / _tablet / _mobile
 *   · medios de sección        module_sections.media_url (solo las de tipo imagen)
 *   · imágenes de los bloques  module_sections.blocks_data → image / hotspot
 *                              (incluidas las anidadas dentro de `columns`)
 *   · fotos de perfil          profiles.avatar_url
 *
 * Videos, PDFs y todo lo que no sea imagen se dejan intactos; también las URLs
 * externas (YouTube, Vimeo, logos que no viven en nuestros buckets).
 *
 * ── Por qué va por OBJETO y no por fila ───────────────────────────
 * La misma imagen puede estar en varios sitios a la vez: `cloneModule` copia
 * `media_url` por referencia y "usar el mismo archivo" hace que dos bloques
 * compartan un objeto a propósito. Si recomprimiéramos fila por fila,
 * repuntaríamos una y borraríamos el objeto que las otras siguen usando: fotos
 * rotas en módulos que nadie tocó. Por eso primero se arma el inventario
 * `URL → todos los lugares que la usan`, se procesa cada objeto UNA vez, se
 * actualizan TODAS sus referencias y solo entonces se borra el archivo viejo.
 *
 * Por lo mismo el inventario NO filtra `deleted_at`: un curso en la papelera
 * que comparte imagen con uno vivo también tiene que quedar apuntando bien.
 */
import { supabase } from '@/lib/supabase'
import type { ContentBlock } from '@/types/blocks'
import {
  AVATAR_PRESET, COURSE_MEDIA_PRESET, COVER_MAX_PX,
  isOptimizableImage, optimizeImage, type OptimizeOptions,
} from '@/lib/imageOptimize'

export type MediaScope = 'covers' | 'modules' | 'avatars'
export const ALL_SCOPES: MediaScope[] = ['covers', 'modules', 'avatars']

export interface SiteImageProgress {
  /** Imágenes distintas a revisar (objetos únicos, no filas). */
  total: number
  done: number
  optimized: number
  /** Ya estaba optimizada, no es imagen, o el ahorro era marginal. */
  skipped: number
  failed: number
  bytesSaved: number
  /** Para poder decir en pantalla en qué va. */
  phase: 'scan' | 'work' | 'done'
}

type CoverSlot = keyof typeof COVER_MAX_PX
const COVER_SLOTS: CoverSlot[] = ['cover_url', 'cover_url_tablet', 'cover_url_mobile']

/** Dónde está usada una imagen. Al final hay que repuntar cada uno de estos. */
type Ref =
  | { kind: 'cover'; courseId: string; slot: CoverSlot }
  | { kind: 'section'; sectionId: string }
  | { kind: 'blocks'; sectionId: string }
  | { kind: 'avatar'; profileId: string }

interface Job {
  url: string
  bucket: 'module-media' | 'avatars'
  path: string
  refs: Ref[]
}

// Si el reprocesado no ahorra al menos esto, no vale la pena re-subir ni
// invalidar la caché que el navegador del aprendiz ya tiene.
const MIN_SAVING_BYTES = 20 * 1024

const BUCKETS = ['module-media', 'avatars'] as const

/** Bucket + ruta interna a partir de una URL pública. null = no es nuestra. */
function locate(url: string | null | undefined): { bucket: Job['bucket']; path: string } | null {
  if (!url || !/^https?:\/\//.test(url)) return null
  for (const bucket of BUCKETS) {
    const marker = `/object/public/${bucket}/`
    const i = url.indexOf(marker)
    if (i !== -1) {
      return { bucket, path: decodeURIComponent(url.slice(i + marker.length).split('?')[0]) }
    }
  }
  return null
}

/**
 * Ruta del objeto optimizado. Se queda en la MISMA carpeta a propósito: la
 * política del bucket `module-media` autoriza la escritura mirando que el
 * primer segmento sea una campaña del usuario, y la de `avatars` que sea su uid.
 *
 * La huella de contenido (`-<12 hex>` justo antes de la extensión, ver
 * `lib/fileHash`) se conserva al final, que es donde `hashFromMediaUrl` la
 * busca: si se moviera, la detección de duplicados dejaría de reconocer el
 * archivo y el capacitador volvería a subir el mismo manual.
 *
 * El nombre cambia siempre (aunque la extensión sea la misma) porque los
 * objetos se sirven con caché de un año: sobrescribir la misma ruta dejaría al
 * CDN entregando los bytes viejos durante meses.
 */
function optimizedPath(path: string, ext: string): string {
  const slash = path.lastIndexOf('/')
  const dir = slash === -1 ? '' : path.slice(0, slash + 1)
  const file = path.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  let stem = dot === -1 ? file : file.slice(0, dot)

  const hashMatch = /-([0-9a-f]{12})$/i.exec(stem)
  const hash = hashMatch ? hashMatch[1] : null
  if (hashMatch) stem = stem.slice(0, hashMatch.index)

  return `${dir}${stem}-opt${Date.now()}${hash ? `-${hash}` : ''}.${ext}`
}

/**
 * Recorre los bloques aplicando `visit` a cada URL de imagen. Entra en
 * `columns`: una imagen dentro de una columna es tan real como las demás, y
 * saltárselas dejaría fuera buena parte del contenido armado a dos columnas.
 * Si `visit` devuelve una URL, la reescribe; devuelve si algo cambió.
 */
function walkImageBlocks(blocks: unknown, visit: (url: string) => string | void): boolean {
  if (!Array.isArray(blocks)) return false
  let changed = false
  for (const b of blocks as ContentBlock[]) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'columns') {
      for (const col of b.columns ?? []) {
        if (walkImageBlocks(col.blocks, visit)) changed = true
      }
      continue
    }
    // Solo `image` y `hotspot` guardan imágenes: `pdf` y `video` guardan
    // documentos y videos, que no se recomprimen.
    if ((b.type === 'image' || b.type === 'hotspot') && typeof b.url === 'string' && b.url) {
      const next = visit(b.url)
      if (typeof next === 'string' && next !== b.url) {
        b.url = next
        changed = true
      }
    }
  }
  return changed
}

/**
 * Trae TODAS las filas de una tabla, por páginas.
 *
 * PostgREST corta en 1000 filas y no avisa: sin esto, en cuanto el sitio pase
 * de mil secciones el barrido se saltaría en silencio todo lo que sobra —y
 * "optimizar todo el sitio" habría optimizado la mitad—. Las páginas van
 * ordenadas por `id` para que ninguna fila salga dos veces ni se pierda.
 */
const PAGE = 500

async function fetchAllRows<T>(
  table: 'courses' | 'module_sections' | 'profiles',
  columns: string,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** Arma el inventario `imagen → lugares donde se usa`. */
async function scan(scopes: MediaScope[]): Promise<Job[]> {
  const jobs = new Map<string, Job>()
  const add = (url: string | null | undefined, ref: Ref) => {
    const at = locate(url)
    if (!at) return
    const key = url as string
    const job = jobs.get(key) ?? { url: key, bucket: at.bucket, path: at.path, refs: [] }
    job.refs.push(ref)
    jobs.set(key, job)
  }

  if (scopes.includes('covers')) {
    const rows = await fetchAllRows<Record<string, string | null>>(
      'courses', 'id, cover_url, cover_url_tablet, cover_url_mobile',
    )
    for (const row of rows) {
      for (const slot of COVER_SLOTS) add(row[slot], { kind: 'cover', courseId: row.id!, slot })
    }
  }

  if (scopes.includes('modules')) {
    const rows = await fetchAllRows<{
      id: string; media_type: string | null; media_url: string | null; blocks_data: unknown
    }>('module_sections', 'id, media_type, media_url, blocks_data')
    for (const row of rows) {
      // `media_url` también guarda videos subidos: solo la imagen se recomprime.
      if (row.media_type === 'image') add(row.media_url, { kind: 'section', sectionId: row.id })
      walkImageBlocks(row.blocks_data, (url) => { add(url, { kind: 'blocks', sectionId: row.id }) })
    }
  }

  if (scopes.includes('avatars')) {
    // Sin filtrar por `avatar_url is not null`: `locate` descarta sola la fila
    // sin foto, y así la paginación se hace sobre una condición menos.
    const rows = await fetchAllRows<{ id: string; avatar_url: string | null }>(
      'profiles', 'id, avatar_url',
    )
    for (const row of rows) {
      add(row.avatar_url, { kind: 'avatar', profileId: row.id })
    }
  }

  return [...jobs.values()]
}

/**
 * Qué tan grande se deja esta imagen, según dónde se usa. Si un mismo archivo
 * sirve a dos sitios distintos gana el más ancho: recortar al más chico dejaría
 * borroso al otro.
 */
function presetFor(refs: Ref[]): OptimizeOptions {
  if (refs.every((r) => r.kind === 'avatar')) return AVATAR_PRESET
  let maxPx = 0
  for (const ref of refs) {
    if (ref.kind === 'cover') maxPx = Math.max(maxPx, COVER_MAX_PX[ref.slot])
    else maxPx = Math.max(maxPx, COURSE_MEDIA_PRESET.maxPx)
  }
  return { maxPx: maxPx || COURSE_MEDIA_PRESET.maxPx, quality: 0.82 }
}

/** Repunta UNA referencia a la URL nueva. Devuelve false si no se pudo. */
async function repoint(ref: Ref, oldUrl: string, newUrl: string): Promise<boolean> {
  if (ref.kind === 'cover') {
    const patch: Partial<Record<CoverSlot, string>> = { [ref.slot]: newUrl }
    const { error } = await supabase.from('courses').update(patch).eq('id', ref.courseId)
    return !error
  }
  if (ref.kind === 'section') {
    const { error } = await supabase
      .from('module_sections').update({ media_url: newUrl }).eq('id', ref.sectionId)
    return !error
  }
  if (ref.kind === 'avatar') {
    const { error } = await supabase
      .from('profiles').update({ avatar_url: newUrl }).eq('id', ref.profileId)
    return !error
  }
  // Bloques: se relee el JSON justo antes de escribirlo. Una sección puede
  // tener varias imágenes y cada una se procesa por separado; escribir sobre
  // una copia leída al principio desharía el cambio de la anterior.
  const { data, error } = await supabase
    .from('module_sections').select('blocks_data').eq('id', ref.sectionId).maybeSingle()
  if (error || !data) return false
  const blocks = data.blocks_data as unknown
  const changed = walkImageBlocks(blocks, (url) => (url === oldUrl ? newUrl : undefined))
  if (!changed) return true // ya estaba repuntada
  const upd = await supabase
    .from('module_sections')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ blocks_data: blocks as any }).eq('id', ref.sectionId)
  return !upd.error
}

/**
 * Recorre y optimiza las imágenes del sitio. Va de una en una a propósito:
 * rasterizar varias imágenes grandes a la vez es lo que tumba la pestaña, y
 * esto se corre una vez cada mucho.
 */
export async function recompressSiteImages(
  scopes: MediaScope[] = ALL_SCOPES,
  onProgress?: (p: SiteImageProgress) => void,
): Promise<SiteImageProgress> {
  const p: SiteImageProgress = {
    total: 0, done: 0, optimized: 0, skipped: 0, failed: 0, bytesSaved: 0, phase: 'scan',
  }
  onProgress?.({ ...p })

  const jobs = await scan(scopes)
  p.total = jobs.length
  p.phase = 'work'
  onProgress?.({ ...p })

  for (const job of jobs) {
    try {
      const res = await fetch(job.url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const original = await res.blob()

      // El inventario confía en lo que dice la BD; esto lo confirma con el
      // archivo real, que es lo único que no miente sobre su tipo.
      if (!isOptimizableImage(original.type)) { p.skipped++; continue }

      const { blob, ext } = await optimizeImage(original, presetFor(job.refs))
      if (blob.size >= original.size - MIN_SAVING_BYTES) { p.skipped++; continue }

      const newPath = optimizedPath(job.path, ext)
      const up = await supabase.storage.from(job.bucket).upload(newPath, blob, {
        contentType: blob.type || original.type,
        upsert: true,
        cacheControl: '31536000',
      })
      if (up.error) throw up.error
      const newUrl = supabase.storage.from(job.bucket).getPublicUrl(newPath).data.publicUrl

      // TODAS las referencias, no solo la primera. Si alguna no se pudo
      // repuntar, el archivo viejo se queda donde está: gastar cupo de Storage
      // es preferible a dejar una imagen rota en el módulo de otro.
      let allOk = true
      for (const ref of job.refs) {
        if (!(await repoint(ref, job.url, newUrl))) allOk = false
      }
      if (!allOk) { p.failed++; continue }

      if (job.path !== newPath) {
        await supabase.storage.from(job.bucket).remove([job.path]).catch(() => {})
      }
      p.optimized++
      p.bytesSaved += original.size - blob.size
    } catch {
      p.failed++
    } finally {
      p.done++
      onProgress?.({ ...p })
    }
  }

  p.phase = 'done'
  onProgress?.({ ...p })
  return p
}
