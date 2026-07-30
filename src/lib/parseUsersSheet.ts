import * as XLSX from 'xlsx'

/**
 * Lectura tolerante de listas de personas en Excel/CSV.
 *
 * El archivo real que manda un cliente casi nunca es la plantilla: trae un
 * título antes de los encabezados, la columna se llama "Correo electrónico",
 * los correos vienen como hipervínculos (el texto visible es el nombre y el
 * correo vive en el `mailto:` del vínculo), o directamente no hay encabezados.
 * Este módulo normaliza el libro a una rejilla de texto y luego DEDUCE dónde
 * están las columnas, dejando siempre a la vista qué dedujo para que la
 * interfaz permita corregirlo a mano.
 */

/** Encuentra correos dentro de texto libre: "Ana <a@b.com>", "a@b.com; c@d.com". */
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
/** Validación de un valor que ya viene aislado. */
export const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

/** Cuántas filas de arriba se inspeccionan buscando la fila de encabezados. */
const HEADER_SCAN_ROWS = 25

const EMAIL_ALIASES = [
  'email', 'e-mail', 'e mail', 'mail', 'correo', 'correo electronico',
  'correo electrónico', 'e-correo', 'email address', 'emailaddress',
  'direccion de correo', 'dirección de correo', 'usuario', 'user', 'username',
  'cuenta', 'login',
]
const NAME_ALIASES = [
  'display_name', 'display name', 'nombre', 'nombres', 'name', 'full name',
  'nombre completo', 'nombre y apellido', 'nombre y apellidos', 'colaborador',
  'participante', 'persona', 'empleado', 'aprendiz',
]
const ROLE_ALIASES = ['role', 'rol', 'perfil', 'tipo de usuario']
// Cédula / documento: la llave con la que Talento Humano identifica a su gente.
// Sin 'id' a secas: por `includes` pegaría en "apellido".
const NATIONAL_ID_ALIASES = [
  'cedula', 'cédula', 'no cedula', 'nro cedula', 'numero de cedula',
  'documento', 'no documento', 'nro documento', 'numero de documento',
  'num documento', 'doc identidad', 'documento de identidad',
  'identificacion', 'identificación', 'numero de identificacion',
  'national_id', 'dni', 'nit', 'cc',
]
// Estado laboral en el reporte de TH ("Activo", "Retirado", "Baja"…).
const STATUS_ALIASES = [
  'estado', 'estado actual', 'situacion', 'situación', 'novedad', 'status',
  'estado empleado', 'estado del empleado', 'condicion', 'condición',
]
// Deliberadamente cortos: "área" o "proyecto" suelen ser otra cosa y no
// queremos adivinar campañas a partir de columnas que solo se le parecen.
const CAMPAIGN_ALIASES = ['campaign', 'campaña', 'campana', 'cuenta cliente']

/** Normaliza para comparar encabezados: sin tildes, sin dobles espacios, minúsculas. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Limpia una celda: espacios duros, caracteres invisibles, comillas sueltas. */
function cleanCell(v: string): string {
  return v
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .trim()
}

export interface SheetGrid {
  name: string
  /** Filas de texto ya normalizado. Rectangular: todas del mismo ancho. */
  rows: string[][]
}

/** Convierte una hoja en rejilla de texto, rescatando los `mailto:` de hipervínculos. */
function sheetToGrid(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet['!ref']
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)
  const grid: string[][] = []
  for (let R = range.s.r; R <= range.e.r; R++) {
    const row: string[] = []
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })] as
        | (XLSX.CellObject & { l?: { Target?: string } })
        | undefined
      let value = ''
      if (cell) {
        value = cell.w ?? (cell.v == null ? '' : String(cell.v))
        // Correo escondido en el hipervínculo: el texto visible suele ser el nombre.
        const target = cell.l?.Target ?? ''
        if (/^mailto:/i.test(target) && !hasEmail(value)) {
          value = decodeURIComponent(target.replace(/^mailto:/i, '').split('?')[0])
        }
      }
      row.push(cleanCell(value))
    }
    grid.push(row)
  }
  // Quita filas totalmente vacías del final (Excel suele arrastrar cientos).
  while (grid.length && grid[grid.length - 1].every((c) => c === '')) grid.pop()
  return grid
}

function hasEmail(text: string): boolean {
  EMAIL_IN_TEXT.lastIndex = 0
  return EMAIL_IN_TEXT.test(text)
}

/** Extrae todos los correos de una celda (puede traer varios separados por ; o ,). */
export function extractEmails(text: string): string[] {
  const out = String(text).match(EMAIL_IN_TEXT) ?? []
  return out.map((e) => e.trim().toLowerCase().replace(/[.,;]+$/, ''))
}

/** Lee el archivo (xlsx/xls/csv) y devuelve una rejilla por hoja con contenido. */
export async function readGrids(file: File): Promise<SheetGrid[]> {
  const buf = await file.arrayBuffer()
  // `raw:false` no aplica aquí porque construimos la rejilla a mano; sí pedimos
  // que se calculen los textos formateados (`cellText`) para fechas y números.
  const wb = XLSX.read(buf, { type: 'array', cellText: true, cellDates: true })
  const grids: SheetGrid[] = []
  for (const name of wb.SheetNames) {
    const rows = sheetToGrid(wb.Sheets[name])
    if (rows.length) grids.push({ name, rows })
  }
  return grids
}

export interface ColumnMapping {
  email: number
  name: number
  role: number
  campaign: number
  /** Cédula/documento. Opcional: solo la usa la sincronización con Talento Humano. */
  nationalId?: number
  /** Estado laboral del reporte de TH ("Activo"/"Retirado"). Opcional. */
  status?: number
}

/**
 * Deja una cédula comparable: sin puntos, guiones ni espacios, en mayúsculas y
 * sin ceros de relleno cuando es puramente numérica (Excel y los reportes de TH
 * los agregan o los quitan sin criterio). Devuelve '' si no queda nada útil.
 */
export function normalizeNationalId(value: string): string {
  // Primero la cola decimal: Excel entrega la cédula como número y a veces la
  // escribe "1098765432.0". Quitar los separadores antes convertiría ese ".0"
  // en un dígito más.
  const noDecimal = String(value ?? '').trim().replace(/[.,]0+$/, '')
  const clean = noDecimal.replace(/[\s.\-_/]/g, '').toUpperCase()
  if (!clean) return ''
  // Ceros de relleno ("0001098765432") solo cuando es puramente numérica.
  if (/^\d+$/.test(clean)) return clean.replace(/^0+(?=\d)/, '')
  return clean
}

export interface SheetAnalysis {
  /** Índice de la fila de encabezados; -1 cuando el archivo no los trae. */
  headerRow: number
  /** Nombre visible de cada columna ("Correo", o "Columna B" si no hay encabezado). */
  columns: string[]
  mapping: ColumnMapping
  /** Cuántos correos se ven en la columna elegida (para avisar temprano). */
  emailCount: number
  /** Cuántas cédulas se ven en la columna deducida (0 si no hay). */
  nationalIdCount: number
}

const NONE = -1

function matchAlias(header: string, aliases: string[]): boolean {
  const h = norm(header)
  if (!h) return false
  return aliases.some((a) => {
    if (h === a || h.startsWith(`${a} `) || h.startsWith(`${a}.`)) return true
    // Los alias muy cortos ("cc", "dni") solo valen como palabra completa: por
    // `includes` se colarían dentro de cualquier otro encabezado.
    return a.length > 3 && h.includes(a)
  })
}

function columnLabel(index: number): string {
  return XLSX.utils.encode_col(index)
}

/**
 * Deduce fila de encabezados y columnas. Estrategia en dos tiempos:
 * 1) busca en las primeras filas una que tenga un encabezado tipo "email/correo"
 *    o de cédula/documento (los reportes de Talento Humano a veces vienen sin
 *    correo, y con la cédula ya se puede cruzar contra las cuentas existentes);
 * 2) si no hay, elige como columna de correo la que más correos contenga
 *    (archivos sin encabezado, o con encabezados que no reconocemos).
 */
export function analyzeGrid(rows: string[][]): SheetAnalysis {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)

  // 1) Fila de encabezados por alias.
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length)
  for (let r = 0; r < limit; r++) {
    const row = rows[r]
    const emailCol = row.findIndex((c) => matchAlias(c, EMAIL_ALIASES))
    const nidCol = row.findIndex((c) => matchAlias(c, NATIONAL_ID_ALIASES))
    if (emailCol === -1 && nidCol === -1) continue
    // Un encabezado real no debería ser en sí mismo un correo.
    if (emailCol !== -1 && hasEmail(row[emailCol])) continue
    const columns = Array.from({ length: width }, (_, i) => row[i] || `Columna ${columnLabel(i)}`)
    const mapping: ColumnMapping = {
      email: emailCol,
      name: row.findIndex((c) => matchAlias(c, NAME_ALIASES)),
      role: row.findIndex((c) => matchAlias(c, ROLE_ALIASES)),
      campaign: row.findIndex((c) => matchAlias(c, CAMPAIGN_ALIASES)),
      nationalId: nidCol,
      status: row.findIndex((c) => matchAlias(c, STATUS_ALIASES)),
    }
    return {
      headerRow: r,
      columns,
      mapping,
      emailCount: emailCol === -1 ? 0 : countEmails(rows, emailCol, r + 1),
      nationalIdCount: countFilled(rows, nidCol, r + 1),
    }
  }

  // 2) Sin encabezado reconocible: la columna con más correos manda.
  let best = NONE
  let bestCount = 0
  for (let c = 0; c < width; c++) {
    const n = countEmails(rows, c, 0)
    if (n > bestCount) {
      best = c
      bestCount = n
    }
  }
  const columns = Array.from({ length: width }, (_, i) => `Columna ${columnLabel(i)}`)
  // El nombre, si lo hay, suele ser la columna de texto más poblada que no es el correo.
  let nameCol = NONE
  if (best !== NONE) {
    let bestText = 0
    for (let c = 0; c < width; c++) {
      if (c === best) continue
      let filled = 0
      for (const row of rows) if ((row[c] ?? '') !== '' && !hasEmail(row[c] ?? '')) filled++
      if (filled > bestText) {
        bestText = filled
        nameCol = c
      }
    }
    // Solo lo damos por bueno si cubre a la mayoría de las filas con correo.
    if (bestText < bestCount * 0.5) nameCol = NONE
  }
  return {
    headerRow: -1,
    columns,
    mapping: { email: best, name: nameCol, role: NONE, campaign: NONE, nationalId: NONE, status: NONE },
    emailCount: bestCount,
    nationalIdCount: 0,
  }
}

function countEmails(rows: string[][], col: number, from: number): number {
  let n = 0
  for (let r = from; r < rows.length; r++) {
    if (hasEmail(rows[r][col] ?? '')) n++
  }
  return n
}

/** Cuántas filas traen algo en esa columna (para saber si vale la pena usarla). */
function countFilled(rows: string[][], col: number, from: number): number {
  if (col < 0) return 0
  let n = 0
  for (let r = from; r < rows.length; r++) {
    if ((rows[r][col] ?? '') !== '') n++
  }
  return n
}

export type RowIssue = 'ok' | 'invalid' | 'duplicate'

export interface ExtractedRow {
  /** Índice de fila en el archivo (1-based, como lo ve el usuario en Excel). */
  sourceLine: number
  email: string
  /** Valor crudo cuando el correo no se pudo interpretar (para mostrarlo tal cual). */
  raw: string
  name: string
  role: string
  campaign: string
  /** Cédula ya normalizada ('' si el archivo no la trae). */
  nationalId: string
  /** Cédula tal como venía, para mostrarla igual que en el archivo. */
  nationalIdRaw: string
  /** Estado laboral crudo del reporte de TH ('' si no hay columna). */
  status: string
  /**
   * `invalid` significa "sin correo válido". Una fila con cédula pero sin correo
   * llega marcada así a propósito: para la carga masiva sigue siendo inservible
   * (no se puede crear una cuenta sin correo), mientras la sincronización con
   * Talento Humano sí la aprovecha para cruzar por cédula.
   */
  issue: RowIssue
}

/**
 * Aplica el mapeo y devuelve TODAS las filas con contenido, incluidas las que
 * fallan: la interfaz necesita mostrar qué se descarta y por qué, no esconderlo.
 */
export function extractRows(
  rows: string[][],
  headerRow: number,
  mapping: ColumnMapping,
): ExtractedRow[] {
  const out: ExtractedRow[] = []
  const seen = new Set<string>()
  const start = headerRow + 1
  for (let r = start; r < rows.length; r++) {
    const row = rows[r]
    const rawEmailCell = mapping.email >= 0 ? (row[mapping.email] ?? '') : ''
    const name = mapping.name >= 0 ? (row[mapping.name] ?? '') : ''
    const role = mapping.role >= 0 ? (row[mapping.role] ?? '') : ''
    const campaign = mapping.campaign >= 0 ? (row[mapping.campaign] ?? '') : ''
    const nidCol = mapping.nationalId ?? NONE
    const nationalIdRaw = nidCol >= 0 ? (row[nidCol] ?? '') : ''
    const nationalId = normalizeNationalId(nationalIdRaw)
    const statusCol = mapping.status ?? NONE
    const status = statusCol >= 0 ? (row[statusCol] ?? '') : ''
    // Fila en blanco: no es un error, simplemente no existe.
    if (!rawEmailCell && !name && !nationalId) continue

    const found = extractEmails(rawEmailCell)
    if (found.length === 0) {
      out.push({
        sourceLine: r + 1,
        email: '',
        raw: rawEmailCell,
        name,
        role,
        campaign,
        nationalId,
        nationalIdRaw,
        status,
        issue: 'invalid',
      })
      continue
    }
    // Una celda puede traer varios correos: se convierten en varias personas.
    for (const email of found) {
      const issue: RowIssue = seen.has(email) ? 'duplicate' : 'ok'
      if (issue === 'ok') seen.add(email)
      out.push({
        sourceLine: r + 1,
        email,
        raw: rawEmailCell,
        // Con varios correos en la misma celda el nombre solo aplica al primero.
        name: found.length > 1 && email !== found[0] ? '' : name,
        role,
        campaign,
        // La cédula también pertenece solo a la primera persona de la celda.
        nationalId: found.length > 1 && email !== found[0] ? '' : nationalId,
        nationalIdRaw: found.length > 1 && email !== found[0] ? '' : nationalIdRaw,
        status,
        issue,
      })
    }
  }
  return out
}

/** Nombre final tal como lo guardará el servidor (parte local del correo si viene vacío). */
export function finalDisplayName(name: string, email: string): string {
  const clean = name.trim()
  if (clean) return clean
  return email.split('@')[0]
}
