/// <reference types="vite/client" />

export interface ExtractedImage {
  /** Tipo MIME soportado por la API de visión de Claude. */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  /** Base64 puro, sin el prefijo `data:...;base64,`. */
  dataBase64: string
  /** Página del documento (1-based) donde apareció la figura. Ancla la captura a su paso. */
  page?: number
}

export interface ExtractedDocument {
  text: string
  fileName: string
  kind: 'word' | 'excel' | 'pdf' | 'text' | 'powerpoint'
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
const POWERPOINT_EXT = ['.pptx']
const TEXT_EXT = ['.txt', '.md']

/** Extensiones aceptadas por el importador (para el atributo `accept` del input). */
export const ACCEPTED_DOC_EXTENSIONS = [
  ...WORD_EXT, ...EXCEL_EXT, ...PDF_EXT, ...POWERPOINT_EXT, ...TEXT_EXT,
].join(',')

// Límites para controlar tamaño de la petición y costo de la visión.
const MAX_IMAGES = 20
const MIN_FIGURE_DIM = 160 // descarta logos/íconos diminutos
const FIGURE_MAX_DIM = 1100 // techo de resolución de figuras (controla peso de la petición)
const PDF_RENDER_MAX_DIM = 1500
const PDF_JPEG_QUALITY = 0.72
// Modo manual: tope de páginas a rasterizar como contexto de layout (captura+paso juntos).
const MANUAL_PAGE_CAP = 24
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

  // `mapWithConcurrency` preserva el orden de páginas, y dentro de cada página el
  // orden de pintado, así que las figuras quedan en ORDEN DE LECTURA. Eso es clave
  // para anclar cada captura a su paso en un manual paso a paso.
  const perPage = await mapWithConcurrency(pageNums, FIGURE_CONCURRENCY, async (p) => {
    // Toda la página está acotada: si algo se traba, se descarta y seguimos.
    const res = await withTimeout(figuresForPage(p), PAGE_TIMEOUT_MS, [] as string[])
    onPageDone?.()
    return res.map((base64) => ({ base64, page: p }))
  })

  // Dedup global (una misma figura puede repetirse en varias páginas) y tope final.
  // Conservamos la página de la PRIMERA aparición para anclar la captura a su paso.
  const figures: ExtractedImage[] = []
  const seen = new Set<string>()
  for (const list of perPage) {
    for (const { base64, page } of list) {
      if (figures.length >= MAX_IMAGES) break
      const sig = `${base64.length}:${base64.slice(0, 48)}`
      if (seen.has(sig)) continue
      seen.add(sig)
      figures.push({ mediaType: 'image/jpeg', dataBase64: base64, page })
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
async function parsePdf(
  buffer: ArrayBuffer,
  onProgress?: ExtractProgressFn,
  manualMode = false,
): Promise<{
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

  // Renderizamos páginas completas como contexto visual cuando:
  //  - el PDF es escaneado (sin texto): única forma de que la IA lo "lea", o
  //  - modo manual: aunque haya texto, la IA necesita ver el layout de cada página
  //    (texto + captura juntos) para asociar cada captura con su paso exacto.
  const pageImages: ExtractedImage[] = []
  if (!text || manualMode) {
    onProgress?.({ stage: 'images', ratio: 0.9 })
    const cap = manualMode ? MANUAL_PAGE_CAP : MAX_IMAGES
    const maxPages = Math.min(pdf.numPages, cap)
    const nums = Array.from({ length: maxPages }, (_, i) => i + 1)
    const rendered = await mapWithConcurrency(nums, FIGURE_CONCURRENCY, async (n) => {
      const page = await pdf.getPage(n)
      return renderPdfPage(page)
    })
    rendered.forEach((base64, i) => {
      if (base64) pageImages.push({ mediaType: 'image/jpeg', dataBase64: base64, page: i + 1 })
    })
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

// ─── PowerPoint (.pptx) ───────────────────────────────────────

/**
 * Normaliza una imagen embebida (Blob) a JPEG base64: descarta íconos/viñetas
 * diminutas (bajo `MIN_FIGURE_DIM`) y reduce la resolución al techo de figuras.
 * Devuelve null si la imagen no se puede decodificar o es demasiado pequeña.
 */
async function normalizeImageBlob(blob: Blob): Promise<string | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImageEl(url).catch(() => null)
    if (!img) return null
    const W = img.naturalWidth, H = img.naturalHeight
    if (!W || !H || Math.max(W, H) < MIN_FIGURE_DIM) return null

    const scale = Math.min(1, FIGURE_MAX_DIM / Math.max(W, H))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(W * scale)
    canvas.height = Math.round(H * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // Fondo blanco para PNG/GIF con transparencia (capturas con canal alfa).
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const base64 = canvas.toDataURL('image/jpeg', FIGURE_JPEG_QUALITY).split(',')[1] ?? null
    canvas.width = 0
    canvas.height = 0
    return base64
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Extrae el texto de una diapositiva (o nota) de OOXML conservando su estructura:
 * cada párrafo `<a:p>` (título, viñeta) es una línea, y dentro de él los runs `<a:t>`
 * se concatenan en orden de lectura. DOMParser decodifica entidades por sí solo.
 */
function pptxXmlToText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return ''
  const paras = Array.from(doc.getElementsByTagName('a:p'))
  const lines = paras
    // Los runs de un mismo párrafo son texto contiguo → se unen sin espacio.
    .map((p) => Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent ?? '').join('').trim())
    .filter(Boolean)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Número al final del nombre de un XML (`slide12.xml` → 12) para ordenar por posición. */
function trailingNumber(name: string): number {
  const m = name.match(/(\d+)\.xml$/)
  return m ? parseInt(m[1], 10) : 0
}

// ─── Rasterización de diapositivas ────────────────────────────
// PowerPoint mide todo en EMU (English Metric Units): 914400 EMU = 1 pulgada,
// 12700 EMU = 1 punto tipográfico. Reconstruimos cada diapositiva en un <canvas>
// respetando la posición (a:off) y tamaño (a:ext) de cada figura y cuadro de texto,
// para que la IA vea el LAYOUT real (no una lista plana de texto e imágenes sueltas).

const EMU_PER_POINT = 12700
const DEFAULT_SLIDE_CX = 12192000 // 13.333" (16:9)
const DEFAULT_SLIDE_CY = 6858000 // 7.5"
const PPTX_SLIDE_RASTER_CAP = MAX_IMAGES // tope de diapositivas rasterizadas (control de costo)

/** Transformación acumulada: `absEMU = t + local * s` (compone grupos anidados). */
interface SlideXform { tx: number; ty: number; sx: number; sy: number }
const IDENTITY_XFORM: SlideXform = { tx: 0, ty: 0, sx: 1, sy: 1 }

function firstChildByTag(el: Element, tag: string): Element | null {
  return el.getElementsByTagName(tag)[0] ?? null
}

function readOffExt(xfrm: Element | null, offTag: string, extTag: string): { x: number; y: number; cx: number; cy: number } | null {
  if (!xfrm) return null
  const off = firstChildByTag(xfrm, offTag)
  const ext = firstChildByTag(xfrm, extTag)
  if (!off || !ext) return null
  return {
    x: Number(off.getAttribute('x') ?? 0),
    y: Number(off.getAttribute('y') ?? 0),
    cx: Number(ext.getAttribute('cx') ?? 0),
    cy: Number(ext.getAttribute('cy') ?? 0),
  }
}

/** Compone la transformación de un grupo (`p:grpSp`) sobre la del padre. */
function composeGroupXform(parent: SlideXform, xfrm: Element | null): SlideXform {
  const rect = readOffExt(xfrm, 'a:off', 'a:ext')
  const child = readOffExt(xfrm, 'a:chOff', 'a:chExt')
  if (!rect || !child || !child.cx || !child.cy) return parent
  const gsx = rect.cx / child.cx
  const gsy = rect.cy / child.cy
  return {
    tx: parent.tx + (rect.x - child.x * gsx) * parent.sx,
    ty: parent.ty + (rect.y - child.y * gsy) * parent.sy,
    sx: gsx * parent.sx,
    sy: gsy * parent.sy,
  }
}

/** Rectángulo de una figura, ya mapeado a píxeles del canvas. */
function shapeRectPx(xf: SlideXform, off: { x: number; y: number; cx: number; cy: number }, scale: number) {
  return {
    x: (xf.tx + off.x * xf.sx) * scale,
    y: (xf.ty + off.y * xf.sy) * scale,
    w: off.cx * xf.sx * scale,
    h: off.cy * xf.sy * scale,
  }
}

/** Color `a:srgbClr`/`a:schemeClr` más cercano dentro de un elemento (aprox.). */
function firstSolidColor(el: Element, fallback: string): string {
  const srgb = firstChildByTag(el, 'a:srgbClr')
  if (srgb) {
    const v = srgb.getAttribute('val')
    if (v && /^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`
  }
  return fallback
}

/** Dibuja el texto de un `<p:txBody>` dentro del rectángulo de la figura (aprox.). */
function drawShapeText(ctx: CanvasRenderingContext2D, sp: Element, rectPx: { x: number; y: number; w: number; h: number }, scale: number, sy: number) {
  const txBody = firstChildByTag(sp, 'p:txBody')
  if (!txBody) return
  const padX = 6, padY = 4
  let cursorY = rectPx.y + padY
  const maxW = Math.max(20, rectPx.w - padX * 2)

  for (const p of Array.from(txBody.getElementsByTagName('a:p'))) {
    const runs = Array.from(p.getElementsByTagName('a:r'))
    const text = runs.map((r) => firstChildByTag(r, 'a:t')?.textContent ?? '').join('').trim()
    if (!text) { cursorY += 6; continue }

    const firstRpr = runs.length ? firstChildByTag(runs[0], 'a:rPr') : null
    const szAttr = firstRpr?.getAttribute('sz')
    const pts = szAttr ? Number(szAttr) / 100 : 18
    // pt → px: 1 punto = EMU_PER_POINT EMU, y `scale` es px por EMU (× escala del grupo).
    const fontPx = Math.max(8, pts * EMU_PER_POINT * scale * sy)
    const bold = firstRpr?.getAttribute('b') === '1'
    const color = firstRpr ? firstSolidColor(firstRpr, '#1a1a1a') : '#1a1a1a'
    const algn = firstChildByTag(p, 'a:pPr')?.getAttribute('algn') ?? 'l'

    ctx.font = `${bold ? '600 ' : ''}${fontPx}px Inter, Arial, sans-serif`
    ctx.fillStyle = color
    ctx.textBaseline = 'top'

    // Ajuste de línea por palabras dentro del ancho de la figura.
    const words = text.split(/\s+/)
    let line = ''
    const lineH = fontPx * 1.25
    const flush = (s: string) => {
      if (cursorY > rectPx.y + rectPx.h + lineH) return
      let x = rectPx.x + padX
      if (algn === 'ctr') { ctx.textAlign = 'center'; x = rectPx.x + rectPx.w / 2 }
      else if (algn === 'r') { ctx.textAlign = 'right'; x = rectPx.x + rectPx.w - padX }
      else ctx.textAlign = 'left'
      ctx.fillText(s, x, cursorY)
      cursorY += lineH
    }
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (ctx.measureText(test).width > maxW && line) { flush(line); line = w }
      else line = test
    }
    if (line) flush(line)
  }
  ctx.textAlign = 'left'
}

/**
 * Dibuja recursivamente el árbol de figuras de una diapositiva (o de un grupo).
 * Recorre en orden del documento para respetar el z-order (lo de atrás se pinta
 * primero). Resuelve las imágenes por su relación (`r:embed`) con `loadMedia`.
 */
async function drawShapeTree(
  ctx: CanvasRenderingContext2D,
  tree: Element,
  xf: SlideXform,
  scale: number,
  rels: Map<string, string>,
  loadMedia: (path: string) => Promise<HTMLImageElement | null>,
): Promise<void> {
  for (const node of Array.from(tree.children)) {
    const tag = node.tagName
    if (tag === 'p:grpSp') {
      const grpXfrm = firstChildByTag(node, 'a:xfrm')
      await drawShapeTree(ctx, node, composeGroupXform(xf, grpXfrm), scale, rels, loadMedia)
    } else if (tag === 'p:pic') {
      const off = readOffExt(firstChildByTag(node, 'a:xfrm'), 'a:off', 'a:ext')
      const embed = firstChildByTag(node, 'a:blip')?.getAttribute('r:embed')
      const path = embed ? rels.get(embed) : null
      if (!off || !path) continue
      try {
        const img = await loadMedia(path)
        if (!img) continue
        const r = shapeRectPx(xf, off, scale)
        if (r.w > 1 && r.h > 1) ctx.drawImage(img, r.x, r.y, r.w, r.h)
      } catch { /* medio no decodificable (emf/wmf): se omite */ }
    } else if (tag === 'p:sp') {
      const off = readOffExt(firstChildByTag(node, 'a:xfrm'), 'a:off', 'a:ext')
      // Sin xfrm propio (placeholder que hereda del layout) no sabemos su posición:
      // el texto ya se capturó aparte, así que solo omitimos su dibujo.
      if (off) drawShapeText(ctx, node, shapeRectPx(xf, off, scale), scale, xf.sy)
    }
    // p:graphicFrame (tablas/gráficos/SmartArt) y p:cxnSp (conectores) se omiten.
  }
}

/** Normaliza un Target de relaciones (`../media/x.png`) a ruta del paquete. */
function resolveRelTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const stack = baseDir.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') stack.pop()
    else if (seg && seg !== '.') stack.push(seg)
  }
  return stack.join('/')
}

/** Número al final del nombre de un medio (`ppt/media/image12.png` → 12). */
function mediaNumber(path: string): number {
  const m = path.match(/(\d+)\.[a-z]+$/i)
  return m ? parseInt(m[1], 10) : 0
}

/** Lee el tamaño de diapositiva (`<p:sldSz>`) de `presentation.xml`, en EMU. */
async function readSlideSize(presentationXml: string | undefined): Promise<{ cx: number; cy: number }> {
  if (!presentationXml) return { cx: DEFAULT_SLIDE_CX, cy: DEFAULT_SLIDE_CY }
  const doc = new DOMParser().parseFromString(presentationXml, 'application/xml')
  const sz = doc.getElementsByTagName('p:sldSz')[0]
  const cx = Number(sz?.getAttribute('cx')) || DEFAULT_SLIDE_CX
  const cy = Number(sz?.getAttribute('cy')) || DEFAULT_SLIDE_CY
  return { cx, cy }
}

/**
 * Procesa un PowerPoint (.pptx). Devuelve:
 *  - `text`: texto de cada diapositiva (títulos, viñetas) + notas del presentador.
 *  - `figures`: imágenes embebidas (capturas, gráficos, fotos) como figuras INSERTABLES.
 *  - `slideImages`: cada diapositiva RASTERIZADA completa (fondo + imágenes en su
 *    posición + texto), como contexto visual para que la IA lea el layout real.
 */
async function parsePptx(
  buffer: ArrayBuffer,
  onProgress?: ExtractProgressFn,
): Promise<{ text: string; figures: ExtractedImage[]; slideImages: ExtractedImage[] }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  onProgress?.({ stage: 'extracting', ratio: 0.15 })

  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => trailingNumber(a) - trailingNumber(b))

  // Cargador de medios con caché (decodifica cada imagen una sola vez para el raster).
  const mediaElCache = new Map<string, Promise<HTMLImageElement | null>>()
  const objectUrls: string[] = []
  const loadMedia = (path: string): Promise<HTMLImageElement | null> => {
    let p = mediaElCache.get(path)
    if (!p) {
      p = (async () => {
        const file = zip.files[path]
        if (!file) return null
        const blob = await file.async('blob')
        const url = URL.createObjectURL(blob)
        objectUrls.push(url)
        return loadImageEl(url).catch(() => null)
      })()
      mediaElCache.set(path, p)
    }
    return p
  }

  // 1) Texto de las diapositivas y notas, en orden de presentación.
  const parts: string[] = []
  for (let i = 0; i < slidePaths.length; i++) {
    const slideXml = await zip.files[slidePaths[i]].async('string')
    const slideText = pptxXmlToText(slideXml)

    const n = trailingNumber(slidePaths[i])
    const notesFile = zip.files[`ppt/notesSlides/notesSlide${n}.xml`]
    const notesText = notesFile ? pptxXmlToText(await notesFile.async('string')) : ''

    const block = [`## Diapositiva ${i + 1}`, slideText || '(sin texto)']
    if (notesText) block.push(`\n**Notas del presentador:** ${notesText}`)
    parts.push(block.join('\n'))
    onProgress?.({ stage: 'extracting', ratio: 0.15 + 0.35 * ((i + 1) / Math.max(1, slidePaths.length)) })
  }
  const text = parts.join('\n\n').trim()

  // 2) Rasterización de cada diapositiva completa (layout real → contexto visual).
  onProgress?.({ stage: 'images', ratio: 0.5 })
  const { cx, cy } = await readSlideSize(await zip.files['ppt/presentation.xml']?.async('string'))
  const scale = Math.min(2, PDF_RENDER_MAX_DIM / Math.max(cx, cy))
  const rasterCount = Math.min(slidePaths.length, PPTX_SLIDE_RASTER_CAP)
  const slideImages: ExtractedImage[] = []

  for (let i = 0; i < rasterCount; i++) {
    try {
      const slideDoc = new DOMParser().parseFromString(await zip.files[slidePaths[i]].async('string'), 'application/xml')
      const spTree = slideDoc.getElementsByTagName('p:spTree')[0]
      if (!spTree) continue

      // Relaciones de la diapositiva: r:embed → ruta del medio.
      const n = trailingNumber(slidePaths[i])
      const relsFile = zip.files[`ppt/slides/_rels/slide${n}.xml.rels`]
      const rels = new Map<string, string>()
      if (relsFile) {
        const relsDoc = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml')
        for (const rel of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
          const id = rel.getAttribute('Id')
          const target = rel.getAttribute('Target')
          if (id && target && rel.getAttribute('TargetMode') !== 'External') {
            rels.set(id, resolveRelTarget('ppt/slides', target))
          }
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(cx * scale))
      canvas.height = Math.max(1, Math.floor(cy * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      await drawShapeTree(ctx, spTree, IDENTITY_XFORM, scale, rels, loadMedia)

      const base64 = canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY).split(',')[1]
      canvas.width = 0
      canvas.height = 0
      if (base64) slideImages.push({ mediaType: 'image/jpeg', dataBase64: base64, page: i + 1 })
    } catch {
      // diapositiva no rasterizable: se omite (el texto ya se capturó)
    }
    onProgress?.({ stage: 'images', ratio: 0.5 + 0.35 * ((i + 1) / Math.max(1, rasterCount)) })
  }

  // 3) Imágenes embebidas como figuras insertables/referenciables.
  onProgress?.({ stage: 'images', ratio: 0.88 })
  const mediaPaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(p))
    .sort((a, b) => mediaNumber(a) - mediaNumber(b))

  const figures: ExtractedImage[] = []
  const seen = new Set<string>()
  for (const path of mediaPaths) {
    if (figures.length >= MAX_IMAGES) break
    try {
      const blob = await zip.files[path].async('blob')
      const base64 = await normalizeImageBlob(blob)
      if (!base64) continue
      const sig = `${base64.length}:${base64.slice(0, 48)}`
      if (seen.has(sig)) continue // dedup (logos repetidos en varias slides)
      seen.add(sig)
      figures.push({ mediaType: 'image/jpeg', dataBase64: base64 })
    } catch {
      // imagen no decodificable (emf/wmf disfrazado, corrupta): se omite
    }
  }

  objectUrls.forEach((u) => URL.revokeObjectURL(u))
  return { text, figures, slideImages }
}

// ─── Recorte de capturas (modo manual, PDF escaneado) ─────────

/** Recuadro de una captura dentro de una página, en porcentaje (0-100). */
export interface CaptureBox {
  x: number; y: number; w: number; h: number
}
/** Detección de capturas por página, tal como la devuelve la IA (`detectCaptures`). */
export interface CaptureDetection {
  pages?: { page: number; captures?: CaptureBox[] }[]
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar la imagen para recortar'))
    img.src = src
  })
}

const CROP_PAD_PCT = 1.5 // margen extra alrededor del recuadro, para no cortar la captura

/** Recorta una región (en %) de una imagen de página y la devuelve como JPEG base64. */
async function cropRegion(pageImg: ExtractedImage, box: CaptureBox): Promise<ExtractedImage | null> {
  const img = await loadImageEl(`data:${pageImg.mediaType};base64,${pageImg.dataBase64}`)
  const W = img.naturalWidth, H = img.naturalHeight
  if (!W || !H) return null

  const pct = (v: number) => Math.max(0, Math.min(100, v)) / 100
  const x0 = pct(box.x - CROP_PAD_PCT) * W
  const y0 = pct(box.y - CROP_PAD_PCT) * H
  const x1 = pct(box.x + box.w + CROP_PAD_PCT) * W
  const y1 = pct(box.y + box.h + CROP_PAD_PCT) * H
  const cw = Math.round(x1 - x0)
  const ch = Math.round(y1 - y0)
  // Descarta recuadros ínfimos (ruido de detección).
  if (cw < MIN_FIGURE_DIM * 0.6 || ch < MIN_FIGURE_DIM * 0.4) return null

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, Math.round(x0), Math.round(y0), cw, ch, 0, 0, cw, ch)
  const base64 = canvas.toDataURL('image/jpeg', FIGURE_JPEG_QUALITY).split(',')[1] ?? null
  canvas.width = 0
  canvas.height = 0
  if (!base64) return null
  return { mediaType: 'image/jpeg', dataBase64: base64, page: pageImg.page }
}

/**
 * A partir de las páginas renderizadas y la detección de la IA, recorta cada captura
 * relevante y devuelve las figuras insertables (en orden de página). El índice `page`
 * de la detección refiere a la POSICIÓN de la página en `pages`.
 */
export async function cropCaptures(
  pages: ExtractedImage[],
  detection: CaptureDetection,
): Promise<ExtractedImage[]> {
  const out: ExtractedImage[] = []
  for (const p of detection.pages ?? []) {
    const pageImg = pages[p.page]
    if (!pageImg) continue
    for (const box of p.captures ?? []) {
      if (out.length >= MAX_IMAGES) return out
      try {
        const crop = await cropRegion(pageImg, box)
        if (crop) out.push(crop)
      } catch {
        // recorte fallido: se omite y se sigue
      }
    }
  }
  return out
}

// ─── Orquestador ──────────────────────────────────────────────

/**
 * Extrae texto e imágenes de un archivo Word (.docx), Excel (.xlsx/.xls/.csv),
 * PDF (.pdf) o texto (.txt/.md). Devuelve las figuras insertables por separado de
 * las imágenes que solo sirven para que la IA lea el documento. Lanza un error
 * legible si el formato no está soportado o no hay contenido aprovechable.
 */
/**
 * Sugiere cuántas secciones debería tener el módulo, proporcional al tamaño del documento.
 * Un documento largo (p. ej. un manual de ~90 páginas) se divide en MÁS secciones digeribles
 * para no perder información ni empacar demasiado en una sola sección (lo que reventaba el
 * techo de tokens del modelo y hacía que la sección se descartara: por eso antes "solo
 * alcanzaba a crear 2"). El servidor la usa como objetivo aproximado (±2).
 *
 * Señales: caracteres de texto (~1 sección por 11k) y, para PDFs escaneados/manuales sin
 * mucho texto, la página máxima vista (~1 sección por 6 páginas). Se toma la mayor.
 */
export function suggestModuleSectionCount(doc: Pick<ExtractedDocument, 'text' | 'images' | 'contextImages'>): number {
  const MIN = 2
  const MAX = 20
  const chars = (doc.text ?? '').trim().length
  const maxPage = Math.max(
    0,
    ...doc.images.map((i) => i.page ?? 0),
    ...doc.contextImages.map((i) => i.page ?? 0),
    doc.contextImages.length, // fallback: páginas rasterizadas cuando no hay número de página
  )
  const byChars = Math.round(chars / 11000)
  const byPages = Math.round(maxPage / 6)
  return Math.max(MIN, Math.min(MAX, Math.max(byChars, byPages, MIN)))
}

export async function extractDocumentText(
  file: File,
  onProgress?: ExtractProgressFn,
  opts: { manualMode?: boolean } = {},
): Promise<ExtractedDocument> {
  const manualMode = opts.manualMode ?? false
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
    const parsed = await parsePdf(buffer, onProgress, manualMode)
    text = parsed.text
    images = parsed.figures
    contextImages = parsed.pageImages
  } else if (POWERPOINT_EXT.includes(ext)) {
    kind = 'powerpoint'
    const buffer = await readAsArrayBuffer(file)
    const parsed = await parsePptx(buffer, onProgress)
    text = parsed.text
    // Imágenes embebidas = figuras INSERTABLES/referenciables (image_index).
    images = parsed.figures
    // Cada diapositiva rasterizada completa = contexto visual (layout real) para
    // que la IA "lea" el diseño de la slide; NO referenciable, igual que las páginas
    // de un PDF escaneado.
    contextImages = parsed.slideImages
  } else if (TEXT_EXT.includes(ext)) {
    kind = 'text'
    text = await readAsText(file)
  } else if (ext === '.doc') {
    throw new Error('El formato .doc (Word antiguo) no es compatible. Guarda el archivo como .docx e inténtalo de nuevo.')
  } else if (ext === '.ppt') {
    throw new Error('El formato .ppt (PowerPoint antiguo) no es compatible. Guarda el archivo como .pptx e inténtalo de nuevo.')
  } else {
    throw new Error('Formato no soportado. Usa un archivo Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF (.pdf) o texto (.txt, .md).')
  }

  text = text.trim()
  if (!text && images.length === 0 && contextImages.length === 0) {
    throw new Error('El archivo no contiene contenido aprovechable (ni texto ni imágenes legibles).')
  }

  onProgress?.({ stage: 'done', ratio: 1 })
  return { text, fileName: file.name, kind, images, contextImages }
}
