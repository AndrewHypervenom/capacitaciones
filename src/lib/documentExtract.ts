export interface ExtractedDocument {
  text: string
  fileName: string
  kind: 'word' | 'excel' | 'text'
}

const WORD_EXT = ['.docx']
const EXCEL_EXT = ['.xlsx', '.xls', '.csv']
const TEXT_EXT = ['.txt', '.md']

/** Extensiones aceptadas por el importador (para el atributo `accept` del input). */
export const ACCEPTED_DOC_EXTENSIONS = [...WORD_EXT, ...EXCEL_EXT, ...TEXT_EXT].join(',')

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
 * Extrae el texto de un archivo Word (.docx), Excel (.xlsx/.xls/.csv) o texto (.txt/.md).
 * Lanza un error legible si el formato no está soportado o el archivo está vacío.
 */
export async function extractDocumentText(file: File): Promise<ExtractedDocument> {
  const ext = extOf(file.name)

  let text = ''
  let kind: ExtractedDocument['kind']

  if (WORD_EXT.includes(ext)) {
    kind = 'word'
    const buffer = await readAsArrayBuffer(file)
    const mammoth = await import('mammoth')
    const result = await mammoth.default.extractRawText({ arrayBuffer: buffer })
    text = result.value
  } else if (ext === '.csv') {
    kind = 'excel'
    text = await readAsText(file)
  } else if (EXCEL_EXT.includes(ext)) {
    kind = 'excel'
    const buffer = await readAsArrayBuffer(file)
    text = await excelToText(buffer)
  } else if (TEXT_EXT.includes(ext)) {
    kind = 'text'
    text = await readAsText(file)
  } else if (ext === '.doc') {
    throw new Error('El formato .doc (Word antiguo) no es compatible. Guarda el archivo como .docx e inténtalo de nuevo.')
  } else {
    throw new Error('Formato no soportado. Usa un archivo Word (.docx), Excel (.xlsx) o texto (.txt, .md).')
  }

  text = text.trim()
  if (!text) {
    throw new Error('El archivo no contiene texto extraíble. Verifica que no esté vacío o que no sea solo imágenes.')
  }

  return { text, fileName: file.name, kind }
}
