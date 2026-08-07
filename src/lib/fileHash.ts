/**
 * Huella de contenido para los archivos que se suben a `module-media`.
 *
 * El problema que resuelve: dos capacitadores (o el mismo, meses después) suben
 * el MISMO manual en tres módulos del curso sin enterarse. Comparar por nombre
 * no sirve — "manual.pdf", "manual_v2.pdf" y "Manual (1).pdf" pueden ser byte por
 * byte el mismo archivo.
 *
 * Dónde vive la huella: NO en una tabla ni en el JSON del bloque, sino en el
 * propio nombre del objeto en Storage (`...-<12 hex>.pdf`), así que viaja dentro
 * de la URL pública. Eso la hace visible para cualquier cosa que ya guarde una
 * URL de medio — bloques `pdf`, bloques `video`, `module_sections.media_url` —
 * sin cambiar ningún esquema y sin migrar lo existente.
 *
 * Lo ya subido antes de esto no tiene huella: `hashFromMediaUrl` devuelve null y
 * la detección cae al nombre de archivo. Ver `mediaDuplicates.service`.
 */

/** Cuántos hex del SHA-256 viajan en el nombre del archivo. 12 hex = 48 bits:
 *  la colisión accidental entre los archivos de un curso es despreciable y el
 *  nombre no se vuelve ilegible. */
export const SHORT_HASH_LEN = 12

/**
 * SHA-256 del archivo, en hex corto. Devuelve null si el navegador no expone
 * `crypto.subtle` (contexto no seguro) o si el archivo no se puede leer: la
 * huella es una mejora, nunca un requisito para subir.
 */
export async function shortFileHash(file: File): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null
    const buf = await file.arrayBuffer()
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, SHORT_HASH_LEN)
  } catch {
    return null
  }
}

const HASH_IN_NAME = new RegExp(`-([0-9a-f]{${SHORT_HASH_LEN}})\\.[a-z0-9]+$`, 'i')

/** Lee la huella incrustada en la URL pública del medio. null = archivo viejo
 *  (subido antes de este mecanismo) o URL externa (YouTube, Vimeo). */
export function hashFromMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const clean = url.split('?')[0].split('#')[0]
  const m = HASH_IN_NAME.exec(clean)
  return m ? m[1].toLowerCase() : null
}
