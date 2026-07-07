/// <reference types="vite/client" />

export interface ExtractedImage {
  /** Tipo MIME soportado por la API de visión de Claude. */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  /** Base64 puro, sin el prefijo `data:...;base64,`. */
  dataBase64: string
}

export interface ExtractedDocument {
  text: string
  fileName: string
  kind: 'word' | 'excel' | 'pdf' | 'text'
  /** Figuras reales del documento (diagramas, fotos): se pueden insertar en las secciones. */
  images: ExtractedImage[]
  /** Imágenes solo para que la IA "lea" el documento (páginas escaneadas): NO se insertan. */
  contextImages: ExtractedImage[]
}

/** Etapa del progreso de lectura, para pintar un estado de carga descriptivo. */
export type ExtractStage = 'reading' | 'extracting' | 'images' | 'done'
export interface ExtractProgress {
  stage: ExtractStage
  /** Avance 0..1 (aproximado para archivos sin paginación). */
  ratio: number
}
export type ExtractProgressFn = (p: ExtractProgress) => void

const WORD_EXT = ['.docx']
const EXCEL_EXT = ['.xlsx', '.xls', '.csv']
const PDF_EXT = ['.pdf']
const TEXT_EXT = ['.txt', '.md']

/** Extensiones aceptadas por el importador (para el atributo `accept` del input). */
export const ACCEPTED_DOC_EXTENSIONS = [...WORD_EXT, ...EXCEL_EXT, ...PDF_EXT, ...TEXT_EXT].join(',')

// Límites para controlar tamaño de la petición y costo de la visión.
const MAX_IMAGES = 20
const MIN_FIGURE_DIM = 160 // descarta logos/íconos diminutos
const FIGURE_MAX_DIM = 1100 // techo de resolución de figuras (controla peso de la petición)
const PDF_RENDER_MAX_DIM = 1500
const PDF_JPEG_QUALITY = 0.72
const FIGURE_JPEG_QUALITY = 0.82
const MIN_EMBEDDED_IMAGE_B64 = 2000 // descarta íconos/viñetas diminutas (Word)

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

/**
 * Aplica `fn` a cada elemento con un máximo de `limit` tareas en vuelo.
 * Mantiene el orden del resultado. Sirve para pipelinear las llamadas al worker
 * de pdf.js (por página) sin esperar una por una ni saturar memoria/CPU.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

// Concurrencia para el trabajo por página. El texto se resuelve en el worker de
// pdf.js (round-trips), así que tolera más paralelismo; las figuras hacen encode
// en canvas en el hilo principal (CPU/memoria), así que van con menos.
const TEXT_CONCURRENCY = Math.min(8, Math.max(2, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4))
const FIGURE_CONCURRENCY = 3

// Redes de seguridad: pdf.js a veces deja una imagen/página sin resolver (el
// callback de `objs.get` nunca dispara), lo que colgaría toda la extracción.
// Con estos límites, una tarea trabada se descarta y el proceso siempre termina.
const PAGE_TIMEOUT_MS = 12000
const IMAGE_OBJ_TIMEOUT_MS = 4000

/** Resuelve `fallback` si `p` no se resuelve/rechaza antes de `ms`. Nunca cuelga. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const done = (v: T) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v) } }
    const timer = setTimeout(() => done(fallback), ms)
    p.then(done, () => done(fallback))
  })
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'))
    reader.readAsText(file)
  })
}

/** Convierte un libro de Excel a texto: una sección por hoja, en formato CSV. */
async function excelToText(buffer: ArrayBuffer): Promise<string> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array' })
  return wb.SheetNames
    .map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false }).trim()
      if (!csv) return ''
      return `## Hoja: ${name}\n${csv}`
    })
    .filter(Boolean)
    .join('\n\n')
}

// ─── PDF ──────────────────────────────────────────────────────

interface PdfImageObject {
  width?: number
  height?: number
  kind?: number // pdfjs ImageKind: 1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP
  bitmap?: CanvasImageSource
  data?: Uint8ClampedArray | Uint8Array | number[]
}

/** Expande los datos crudos de una imagen de PDF a RGBA para pintarla en un canvas. */
function pdfDataToRgba(
  data: Uint8ClampedArray | Uint8Array | number[],
  kind: number | undefined,
  px: number,
): Uint8ClampedArray<ArrayBuffer> | null {
  const out = new Uint8ClampedArray(px * 4)
  if (kind === 3) {
    out.set(data as ArrayLike<number>)
    return out
  }
  if (kind === 2) {
    for (let i = 0, j = 0; i < px; i++) {
      out[j++] = data[i * 3]
      out[j++] = data[i * 3 + 1]
      out[j++] = data[i * 3 + 2]
      out[j++] = 255
    }
    return out
  }
  return null // grayscale u otros formatos: se omiten
}

/** Convierte un objeto de imagen embebida de pdf.js a JPEG base64 (sin prefijo data:). */
function pdfImageToBase64(obj: PdfImageObject): string | null {
  const width = obj.width ?? 0
  const height = obj.height ?? 0
  if (!width || !height || Math.max(width, height) < MIN_FIGURE_DIM) return null

  // Pinta la imagen a su resolución nativa.
  const src = document.createElement('canvas')
  src.width = width
  src.height = height
  const sctx = src.getContext('2d')
  if (!sctx) return null

  if (obj.bitmap) {
    sctx.drawImage(obj.bitmap, 0, 0, width, height)
  } else if (obj.data) {
    const rgba = pdfDataToRgba(obj.data, obj.kind, width * height)
    if (!rgba) return null
    sctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  } else {
    return null
  }

  // Reduce la resolución si supera el techo, para no inflar la petición.
  const scale = Math.min(1, FIGURE_MAX_DIM / Math.max(width, height))
  let out = src
  if (scale < 1) {
    const dst = document.createElement('canvas')
    dst.width = Math.round(width * scale)
    dst.height = Math.round(height * scale)
    const dctx = dst.getContext('2d')
    if (!dctx) return null
    dctx.drawImage(src, 0, 0, dst.width, dst.height)
    out = dst
  }

  const base64 = out.toDataURL('image/jpeg', FIGURE_JPEG_QUALITY).split(',')[1] ?? null
  src.width = 0
  src.height = 0
  return base64
}

/** Extrae las figuras embebidas (diagramas, gráficos, fotos) de un PDF. */
async function extractPdfFigures(
  pdf: import('pdfjs-dist').PDFDocumentProxy,
  pdfjs: typeof import('pdfjs-dist'),
  onPageDone?: () => void,
): Promise<ExtractedImage[]> {
  const maxPages = Math.min(pdf.numPages, 30)
  const pageNums = Array.from({ length: maxPages }, (_, i) => i + 1)

  // Contador compartido para cortar apenas juntamos suficientes figuras, sin
  // seguir decodificando imágenes de las páginas restantes.
  let collected = 0

  const figuresForPage = async (p: number): Promise<string[]> => {
    if (collected >= MAX_IMAGES) return []
    const page = await pdf.getPage(p)
    const ops = await page.getOperatorList()

    const names: string[] = []
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) {
        const arg = ops.argsArray[i][0]
        if (typeof arg === 'string') names.push(arg)
      }
    }

    const out: string[] = []
    for (const name of names) {
      if (collected >= MAX_IMAGES) break
      try {
        // `objs.get` a veces nunca llama de vuelta: lo acotamos para no colgar.
        const obj = await withTimeout(
          new Promise<PdfImageObject | null>((res) => page.objs.get(name, res as () => void)),
          IMAGE_OBJ_TIMEOUT_MS,
          null,
        )
        if (!obj) continue
        const base64 = pdfImageToBase64(obj)
        if (!base64) continue
        out.push(base64)
        collected++
      } catch {
        // imagen no decodificable: se omite
      }
    }
    return out
  }

  const perPage = await mapWithConcurrency(pageNums, FIGURE_CONCURRENCY, async (p) => {
    // Toda la página está acotada: si algo se traba, se descarta y seguimos.
    const res = await withTimeout(figuresForPage(p), PAGE_TIMEOUT_MS, [] as string[])
    onPageDone?.()
    return res
  })

  // Dedup global (una misma figura puede repetirse en varias páginas) y tope final.
  const figures: ExtractedImage[] = []
  const seen = new Set<string>()
  for (const list of perPage) {
    for (const base64 of list) {
      if (figures.length >= MAX_IMAGES) break
      const sig = `${base64.length}:${base64.slice(0, 48)}`
      if (seen.has(sig)) continue
      seen.add(sig)
      figures.push({ mediaType: 'image/jpeg', dataBase64: base64 })
    }
  }
  return figures
}

/** Renderiza una página de PDF a un JPEG en base64 (sin prefijo data:). */
async function renderPdfPage(page: import('pdfjs-dist').PDFPageProxy): Promise<string | null> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, PDF_RENDER_MAX_DIM / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, viewport }).promise
  const dataUrl = canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY)
  canvas.width = 0
  canvas.height = 0
  return dataUrl.split(',')[1] ?? null
}

/**
 * Procesa un PDF: extrae el texto, las figuras embebidas (insertables) y, solo si el PDF
 * no tiene texto (escaneado), renderiza las páginas como imágenes de contexto para la visión.
 */
async function parsePdf(buffer: ArrayBuffer, onProgress?: ExtractProgressFn): Promise<{
  text: string
  figures: ExtractedImage[]
  pageImages: ExtractedImage[]
}> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ).default

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise

  // Progreso: total = páginas de texto + páginas escaneadas por figuras. La barra
  // va de 0.08 a 0.98 a medida que cada página termina (texto o figuras).
  const figurePages = Math.min(pdf.numPages, 30)
  const totalUnits = pdf.numPages + figurePages
  let doneUnits = 0
  onProgress?.({ stage: 'extracting', ratio: 0.08 })
  const tick = () => {
    doneUnits++
    onProgress?.({ stage: 'extracting', ratio: 0.08 + 0.9 * (doneUnits / totalUnits) })
  }

  // Texto (por página, en paralelo) y figuras embebidas se resuelven a la vez:
  // el texto vive en el worker de pdf.js y las figuras encodean en canvas, así
  // que solapar ambos aprovecha worker y hilo principal en simultáneo.
  const pageNums = Array.from({ length: pdf.numPages }, (_, i) => i + 1)
  const [pagesText, figures] = await Promise.all([
    mapWithConcurrency(pageNums, TEXT_CONCURRENCY, async (n) => {
      const t = await withTimeout(
        (async () => {
          const page = await pdf.getPage(n)
          const content = await page.getTextContent()
          return content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .trim()
        })(),
        PAGE_TIMEOUT_MS,
        '',
      )
      tick()
      return t
    }),
    extractPdfFigures(pdf, pdfjs, tick).catch(() => [] as ExtractedImage[]),
  ])
  const text = pagesText.filter(Boolean).join('\n\n')

  // Solo para PDFs escaneados (sin texto): renderizamos páginas para que la IA pueda leerlas.
  const pageImages: ExtractedImage[] = []
  if (!text) {
    const maxPages = Math.min(pdf.numPages, MAX_IMAGES)
    const nums = Array.from({ length: maxPages }, (_, i) => i + 1)
    const rendered = await mapWithConcurrency(nums, FIGURE_CONCURRENCY, async (n) => {
      const page = await pdf.getPage(n)
      return renderPdfPage(page)
    })
    for (const base64 of rendered) {
      if (base64) pageImages.push({ mediaType: 'image/jpeg', dataBase64: base64 })
    }
  }

  return { text, figures, pageImages }
}

// ─── Word ─────────────────────────────────────────────────────

/** Extrae las imágenes embebidas de un .docx (gráficos, capturas, fotos). */
async function extractDocxImages(buffer: ArrayBuffer): Promise<ExtractedImage[]> {
  const mammoth = await import('mammoth')
  const images: ExtractedImage[] = []

  await mammoth.default.convertToHtml(
    { arrayBuffer: buffer },
    {
      convertImage: mammoth.default.images.imgElement(async (image) => {
        if (images.length < MAX_IMAGES && SUPPORTED_IMAGE_TYPES.has(image.contentType)) {
          const dataBase64 = await image.readAsBase64String()
          if (dataBase64.length >= MIN_EMBEDDED_IMAGE_B64) {
            images.push({ mediaType: image.contentType as ExtractedImage['mediaType'], dataBase64 })
          }
        }
        return { src: '' }
      }),
    },
  )

  return images
}

// ─── Orquestador ──────────────────────────────────────────────

/**
 * Extrae texto e imágenes de un archivo Word (.docx), Excel (.xlsx/.xls/.csv),
 * PDF (.pdf) o texto (.txt/.md). Devuelve las figuras insertables por separado de
 * las imágenes que solo sirven para que la IA lea el documento. Lanza un error
 * legible si el formato no está soportado o no hay contenido aprovechable.
 */
export async function extractDocumentText(
  file: File,
  onProgress?: ExtractProgressFn,
): Promise<ExtractedDocument> {
  const ext = extOf(file.name)
  onProgress?.({ stage: 'reading', ratio: 0.04 })

  let text = ''
  let images: ExtractedImage[] = []
  let contextImages: ExtractedImage[] = []
  let kind: ExtractedDocument['kind']

  if (WORD_EXT.includes(ext)) {
    kind = 'word'
    const buffer = await readAsArrayBuffer(file)
    const mammoth = await import('mammoth')
    onProgress?.({ stage: 'extracting', ratio: 0.3 })
    text = (await mammoth.default.extractRawText({ arrayBuffer: buffer })).value
    onProgress?.({ stage: 'images', ratio: 0.6 })
    images = await extractDocxImages(buffer)
  } else if (ext === '.csv') {
    kind = 'excel'
    text = await readAsText(file)
  } else if (EXCEL_EXT.includes(ext)) {
    kind = 'excel'
    const buffer = await readAsArrayBuffer(file)
    onProgress?.({ stage: 'extracting', ratio: 0.4 })
    text = await excelToText(buffer)
  } else if (PDF_EXT.includes(ext)) {
    kind = 'pdf'
    const buffer = await readAsArrayBuffer(file)
    const parsed = await parsePdf(buffer, onProgress)
    text = parsed.text
    images = parsed.figures
    contextImages = parsed.pageImages
  } else if (TEXT_EXT.includes(ext)) {
    kind = 'text'
    text = await readAsText(file)
  } else if (ext === '.doc') {
    throw new Error('El formato .doc (Word antiguo) no es compatible. Guarda el archivo como .docx e inténtalo de nuevo.')
  } else {
    throw new Error('Formato no soportado. Usa un archivo Word (.docx), Excel (.xlsx), PDF (.pdf) o texto (.txt, .md).')
  }

  text = text.trim()
  if (!text && images.length === 0 && contextImages.length === 0) {
    throw new Error('El archivo no contiene contenido aprovechable (ni texto ni imágenes legibles).')
  }

  onProgress?.({ stage: 'done', ratio: 1 })
  return { text, fileName: file.name, kind, images, contextImages }
}
