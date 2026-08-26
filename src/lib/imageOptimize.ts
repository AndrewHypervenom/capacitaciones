/**
 * Optimización de imágenes en el navegador, ANTES de subirlas.
 *
 * Todo lo que se sube al sitio pasa por aquí: la foto de perfil, las capturas de
 * las opiniones, los medios de una sección, las figuras que la IA saca de un
 * documento y las portadas de los cursos. Antes cada sitio tenía su propio
 * recorte pegado a mano (o ninguno): una captura de pantalla en PNG de 6 MB se
 * guardaba tal cual y luego cada aprendiz que abría el módulo se la descargaba
 * entera para verla a 800px.
 *
 * Dos ideas:
 *  · Nadie ve una imagen más grande que su caja. Reescalamos al lado mayor útil.
 *  · WebP pesa ~30% menos que JPEG a la misma calidad y lo entiende todo
 *    navegador actual; si el `toBlob` no lo produce, caemos a JPEG solo.
 *
 * Si algo falla (HEIC, navegador sin canvas, formato raro) se devuelve el
 * original: una imagen pesada es mejor que una subida rota.
 */

/** Formatos que NO conviene rasterizar: perderían la animación o el vector. */
const PASSTHROUGH = new Set(['image/gif', 'image/svg+xml'])

export interface OptimizeOptions {
  /** Lado mayor resultante, en píxeles. */
  maxPx: number
  /** Calidad del codificador (0–1). */
  quality?: number
  /** `jpeg` fuerza JPEG; `auto` prefiere WebP y cae a JPEG. */
  format?: 'auto' | 'jpeg'
}

export interface OptimizedImage {
  blob: Blob
  /** Ancho final en píxeles (el del original si no se pudo procesar). */
  width: number
  /** Alto final en píxeles. */
  height: number
  /** Extensión que le corresponde al blob resultante (sin punto). */
  ext: string
}

const DEFAULT_QUALITY = 0.82

/** ¿Vale la pena pasar este archivo por el optimizador? */
export function isOptimizableImage(type: string): boolean {
  return type.startsWith('image/') && !PASSTHROUGH.has(type)
}

/** Extensión que le toca a un tipo MIME (con reserva por si viene vacío). */
export function extForType(type: string, fallbackName = ''): string {
  switch (type) {
    case 'image/webp': return 'webp'
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/gif': return 'gif'
    case 'image/svg+xml': return 'svg'
    default: return (fallbackName.split('.').pop() || 'jpg').toLowerCase()
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, quality))
}

/**
 * Reescala al lado mayor pedido y recomprime. Devuelve el original (envuelto en
 * la misma forma) cuando no se puede procesar o cuando comprimir no ahorra nada
 * —el caso de una imagen que ya estaba optimizada, o de un icono diminuto—.
 */
export async function optimizeImage(file: Blob, opts: OptimizeOptions): Promise<OptimizedImage> {
  const { maxPx, quality = DEFAULT_QUALITY, format = 'auto' } = opts
  const name = file instanceof File ? file.name : ''
  const asIs = (w = 0, h = 0): OptimizedImage => ({
    blob: file, width: w, height: h, ext: extForType(file.type, name),
  })

  if (!isOptimizableImage(file.type)) return asIs()

  let bitmap: ImageBitmap | null = null
  try {
    // `from-image` respeta la orientación EXIF: sin esto una foto de celular se
    // sube acostada y ya no hay forma de saber que estaba girada.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return asIs(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, 0, 0, w, h)

    let blob = format === 'auto' ? await encode(canvas, 'image/webp', quality) : null
    // Safari viejo devuelve un PNG cuando no sabe codificar WebP: hay que mirar
    // el tipo del resultado, no fiarse de que no lanzó error.
    if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', quality)

    // Liberamos el lienzo: en una importación con 20 figuras, no hacerlo deja
    // decenas de megas de bitmaps vivos hasta el siguiente barrido del GC.
    canvas.width = 0
    canvas.height = 0

    if (!blob || blob.size >= file.size) return asIs(bitmap.width, bitmap.height)
    return { blob, width: w, height: h, ext: extForType(blob.type, name) }
  } catch {
    return asIs(bitmap?.width ?? 0, bitmap?.height ?? 0)
  } finally {
    bitmap?.close?.()
  }
}

/* ── Medidas de cada uso ──────────────────────────────────────────
 * Salen de la caja real donde se pinta la imagen, con margen para
 * pantallas Retina (2×), no de un número redondo cualquiera.           */

/** Foto de perfil: se ve a ~96px como mucho. JPEG por compatibilidad histórica. */
export const AVATAR_PRESET: OptimizeOptions = { maxPx: 256, quality: 0.82, format: 'jpeg' }

/** Captura de una opinión: tiene que leerse el texto de la pantalla a tamaño completo. */
export const SCREENSHOT_PRESET: OptimizeOptions = { maxPx: 1800, quality: 0.82 }

/**
 * Imagen dentro de un módulo (media de sección, bloque de imagen, hotspot y las
 * figuras que la IA extrae de un PDF/PPTX). El contenedor más ancho es
 * `max-w-4xl` = 896px; 1600 deja el doble para pantallas densas y para el
 * hotspot, donde sí se hace zoom sobre el detalle.
 */
export const COURSE_MEDIA_PRESET: OptimizeOptions = { maxPx: 1600, quality: 0.82 }

/**
 * Portada, por tipo de pantalla. Es exactamente el ancho que pide cada slot en
 * el editor (COVER_SLOTS): subir más grande no se ve, solo se descarga.
 */
export const COVER_MAX_PX: Record<'cover_url' | 'cover_url_mobile' | 'cover_url_tablet', number> = {
  cover_url_mobile: 1200,
  cover_url_tablet: 1680,
  cover_url: 1664,
}
