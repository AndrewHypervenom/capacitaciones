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
  /** Imágenes/páginas para que la IA las analice visualmente (gráficos, diagramas, fotos). */
  images: ExtractedImage[]
}

const WORD_EXT = ['.docx']
const EXCEL_EXT = ['.xlsx', '.xls', '.csv']
const PDF_EXT = ['.pdf']
const TEXT_EXT = ['.txt', '.md']

/** Extensiones aceptadas por el importador (para el atributo `accept` del input). */
export const ACCEPTED_DOC_EXTENSIONS = [...WORD_EXT, ...EXCEL_EXT, ...PDF_EXT, ...TEXT_EXT].join(',')

// Límites para controlar tamaño de la petición y costo de la visión.
const MAX_IMAGES = 20
const PDF_RENDER_MAX_DIM = 1500
const PDF_JPEG_QUALITY = 0.72
const MIN_EMBEDDED_IMAGE_B64 = 2000 // descarta íconos/viñetas diminutas

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
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

/**
 * Procesa un PDF: extrae el texto de todas las páginas y renderiza las primeras
 * páginas a imagen para que la IA las analice visualmente (gráficos, layout, etc.).
 */
async function parsePdf(buffer: ArrayBuffer): Promise<{ text: string; images: ExtractedImage[] }> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ).default

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  const pages: string[] = []
  const images: ExtractedImage[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)

    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim()
    if (pageText) pages.push(pageText)

    if (images.length < MAX_IMAGES) {
      const base64 = await renderPdfPage(page)
      if (base64) images.push({ mediaType: 'image/jpeg', dataBase64: base64 })
    }
  }

  return { text: pages.join('\n\n'), images }
}

/** Renderiza una página de PDF a un JPEG en base64 (sin prefijo data:). */
async function renderPdfPage(
  page: import('pdfjs-dist').PDFPageProxy,
): Promise<string | null> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, PDF_RENDER_MAX_DIM / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Fondo blanco: evita zonas negras en PDFs con transparencia.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, viewport }).promise
  const dataUrl = canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY)
  canvas.width = 0
  canvas.height = 0
  return dataUrl.split(',')[1] ?? null
}

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

/**
 * Extrae texto e imágenes de un archivo Word (.docx), Excel (.xlsx/.xls/.csv),
 * PDF (.pdf) o texto (.txt/.md). Las imágenes permiten que la IA analice gráficos
 * y diagramas, no solo el texto. Lanza un error legible si el formato no está
 * soportado o no hay contenido aprovechable.
 */
export async function extractDocumentText(file: File): Promise<ExtractedDocument> {
  const ext = extOf(file.name)

  let text = ''
  let images: ExtractedImage[] = []
  let kind: ExtractedDocument['kind']

  if (WORD_EXT.includes(ext)) {
    kind = 'word'
    const buffer = await readAsArrayBuffer(file)
    const mammoth = await import('mammoth')
    text = (await mammoth.default.extractRawText({ arrayBuffer: buffer })).value
    images = await extractDocxImages(buffer)
  } else if (ext === '.csv') {
    kind = 'excel'
    text = await readAsText(file)
  } else if (EXCEL_EXT.includes(ext)) {
    kind = 'excel'
    const buffer = await readAsArrayBuffer(file)
    text = await excelToText(buffer)
  } else if (PDF_EXT.includes(ext)) {
    kind = 'pdf'
    const buffer = await readAsArrayBuffer(file)
    const parsed = await parsePdf(buffer)
    text = parsed.text
    images = parsed.images
  } else if (TEXT_EXT.includes(ext)) {
    kind = 'text'
    text = await readAsText(file)
  } else if (ext === '.doc') {
    throw new Error('El formato .doc (Word antiguo) no es compatible. Guarda el archivo como .docx e inténtalo de nuevo.')
  } else {
    throw new Error('Formato no soportado. Usa un archivo Word (.docx), Excel (.xlsx), PDF (.pdf) o texto (.txt, .md).')
  }

  text = text.trim()
  if (!text && images.length === 0) {
    throw new Error('El archivo no contiene contenido aprovechable (ni texto ni imágenes legibles).')
  }

  return { text, fileName: file.name, kind, images }
}
