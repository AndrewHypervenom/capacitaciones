import { supabase } from '@/lib/supabase'
import { normalizeNationalId, type ExtractedRow } from '@/lib/parseUsersSheet'
import { fold } from '@/lib/normalize'
import type { OrgUnit } from '@/types/database'
import { findUnit, type UnitIndex } from '@/services/org.service'
import { updateUserEmail } from '@/services/userEmail.service'

/**
 * Altas y bajas de aprendices contra la base de Talento Humano.
 *
 * **La baja se LEE del archivo, nunca se deduce.** Cada fila trae su estado
 * laboral ("Activo", "Retirado", "Desvinculado"…) y eso es lo único que decide:
 *
 *   · estado retirado + tiene cuenta      → BAJA
 *   · estado activo   + no tiene cuenta   → ALTA
 *   · estado activo   + cuenta de baja    → REACTIVACIÓN
 *   · cualquier otro estado (licencia,
 *     vacaciones, incapacidad…)           → no se toca
 *
 * Deliberadamente NO existe la baja por omisión ("no aparece en el archivo, se
 * apaga"): un reporte incompleto, la hoja equivocada o un filtro mal puesto en
 * Excel apagarían cuentas de gente que sigue trabajando. Como consecuencia
 * tampoco hace falta elegir campañas ni acotar el alcance: quien el archivo no
 * menciona simplemente no se toca, y no existe forma de que salga afectado.
 *
 * La baja tampoco borra: marca `profiles.is_active = false`, bloquea el ingreso
 * y saca a la persona de listados y contadores, conservando su historial. Volver
 * a darla de alta recupera ese historial intacto.
 *
 * Nada se aplica solo: la interfaz muestra el resultado fila por fila —incluida
 * la interpretación de cada valor de estado— y el superadmin confirma.
 */

/* ── Datos ─────────────────────────────────────────────────────────────────── */

/** Persona que ya tiene cuenta en el sitio (aprendiz), según `get_hr_roster`. */
export interface RosterPerson {
  id: string
  email: string | null
  display_name: string | null
  national_id: string | null
  campaign_id: string | null
  is_active: boolean
  deactivated_at: string | null
  hr_last_seen_at: string | null
  created_at: string
  /* ── Lo que la base maestra puede ACTUALIZAR ───────────────────────────────
   * Llegan `undefined` mientras no se haya corrido el SQL que amplía
   * `get_hr_roster`. Es la señal de que todavía no se pueden proponer
   * actualizaciones: sin saber qué dice hoy el perfil, "cambió el cargo" sería
   * una adivinanza. La interfaz lo dice y sigue haciendo altas y bajas. */
  job_title?: string | null
  /**
   * El cargo de esta persona está FIJADO A MANO y la nómina no lo toca.
   *
   * El cargo tiene una sola fuente —la base maestra— y eso es lo correcto para
   * ochocientas personas. Pero hay casos en que el título del contrato no es el
   * trabajo real, y volver a corregirlo a mano después de cada carga no es una
   * solución: es una tarea recurrente que alguien va a olvidar. Se marca el
   * perfil y se acabó, hasta que quien lo fijó lo suelte.
   */
  job_title_locked?: boolean | null
  country?: string | null
  operation_id?: string | null
  area_id?: string | null
  role?: string | null
}

/** ¿El roster viene con los campos que hacen falta para proponer cambios? */
export function rosterSupportsUpdates(roster: RosterPerson[]): boolean {
  return roster.length === 0 || roster.some((p) => p.job_title !== undefined)
}

export type SyncAction =
  | 'create'
  | 'reactivate'
  | 'unchanged'
  | 'deactivate'
  | 'skipped'
  /** La persona ya existe y la base trae algún dato distinto. */
  | 'update'

export type SyncReason =
  /** El archivo la marca como retirada. */
  | 'retired_in_file'
  /** Retirada en el archivo y sin cuenta: no hay nada que hacer. */
  | 'retired_no_account'
  /** Ya estaba de baja. */
  | 'already_inactive'
  /** Sin correo no se puede crear la cuenta. */
  | 'no_email'
  /** La misma persona viene dos veces en el archivo. */
  | 'duplicate'
  /** Estado que no es alta ni baja (licencia, vacaciones, incapacidad…). */
  | 'status_ignored'
  /** El archivo no dice el estado de esta fila: nunca se da de baja a ciegas. */
  | 'status_unknown'
  /**
   * El correo es de alguien que en el sitio se llama de otra forma Y tiene otro
   * cargo. No es "el nombre está mejor escrito": son dos personas distintas
   * compartiendo un correo, o una columna corrida. No se aplica nunca — ni
   * marcándola a mano — porque la corrección es en el archivo, no aquí.
   */
  | 'identity_conflict'

/** Campos del perfil que la base maestra puede corregir. */
export type ProfileField =
  | 'email'
  | 'display_name'
  | 'job_title'
  | 'country'
  | 'national_id'
  | 'operation_id'
  | 'area_id'

/** Un dato que la base dice distinto de lo que hoy tiene el perfil. */
export interface FieldChange {
  field: ProfileField
  /** Lo que hay hoy en el sitio (null = vacío). */
  from: string | null
  /** El valor que se guardaría. Para operación y área es el uuid de la unidad. */
  to: string
  /** Cómo se lee `to` en pantalla: el nombre del CR, no su uuid. */
  toLabel: string
  /** Cómo se lee `from` en pantalla. */
  fromLabel: string
  /**
   * Cambiar el correo no es un UPDATE a `profiles`: hay que mover también la
   * cuenta de autenticación, o la persona seguiría entrando con el viejo.
   * Va por la Edge Function `update-user-email`, y es lo único de esta lista
   * que puede fallar por su cuenta.
   */
  needsAuth?: boolean
}

/**
 * En qué se parecen la fila del archivo y la cuenta que se le asignó.
 *
 * Es la respuesta a "actualízale el dato si los nombres coinciden exactamente y
 * el cargo también": nunca se escribe sobre una cuenta por un solo dato en
 * común. Hacen falta DOS señales de las cuatro (ficha, correo, nombre, cargo), y
 * las que no coinciden quedan a la vista.
 */
export interface IdentityCheck {
  agree: ProfileField[]
  differ: ProfileField[]
  /** Dos o más señales coinciden: se puede escribir sobre esta cuenta. */
  confident: boolean
  /** El nombre no coincide. Se muestra en ámbar aunque haya confianza. */
  nameMismatch: boolean
  /** Ni el nombre ni el cargo coinciden, y los dos están escritos: no se toca. */
  conflict: boolean
}

export interface SyncEntry {
  /** Clave estable para React y para las exclusiones manuales. */
  key: string
  action: SyncAction
  /** Fila del archivo (1-based). Toda entrada viene de una fila del archivo. */
  sourceLine: number
  email: string
  name: string
  nationalId: string
  nationalIdRaw: string
  /** Estado laboral tal como venía en el archivo. */
  status: string
  /**
   * País en código ISO que trae el archivo ('' si no viene o no se reconoce).
   * Solo se aplica a las altas: a quien ya tiene cuenta no se le pisa el perfil.
   */
  country: string
  /**
   * `twin_account`: una SEGUNDA cuenta de alguien de la base (mismo nombre
   * exacto, otro correo). La fila ya se usó con la cuenta principal; a esta solo
   * se le copia dónde está —país, área y CR— para que no quede sin clasificar.
   */
  matchedBy: 'national_id' | 'email' | 'name_job' | 'twin_account' | null
  /** Cuenta existente que corresponde a esta fila. */
  person?: RosterPerson
  reason?: SyncReason
  /**
   * Campaña donde nacerá la cuenta (solo aplica a las altas). Sale de la columna
   * de campaña del archivo si la hay, o del valor por defecto elegido, y el
   * superadmin la puede cambiar persona por persona.
   */
  campaignId: string | null
  /** Nombre de campaña tal como venía en el archivo ('' si no traía columna). */
  campaignRaw: string
  /** Hoja del libro de la que salió la fila (la base viene partida por país). */
  sheet: string
  /** Cargo, CR y área tal como los escribe el archivo. */
  jobTitleRaw: string
  operationRaw: string
  areaRaw: string
  /** Unidades del catálogo a las que casaron `operationRaw` y `areaRaw`. */
  operation?: OrgUnit
  area?: OrgUnit
  /** Datos que la base dice distinto. Vacío cuando no hay nada que corregir. */
  changes: FieldChange[]
  /** Cuánto se parecen la fila y la cuenta. Solo cuando hay cuenta. */
  identity?: IdentityCheck
  /**
   * Propuesta de si se aplica esta fila. Las **bajas nacen en `false`**: cada una
   * se confirma a mano, porque apagar la cuenta de quien sigue trabajando es el
   * error caro de esta pantalla. El resto nace marcado y se puede desmarcar.
   */
  include: boolean
}

export interface SyncCounts {
  create: number
  reactivate: number
  deactivate: number
  unchanged: number
  skipped: number
  update: number
}

/* ── Estado laboral del archivo ────────────────────────────────────────────── */

/**
 * Qué hace el sistema con un valor de la columna de estado.
 *
 * `unknown` es el default de todo lo que no reconocemos: no hace nada. Solo un
 * `retired` explícito da de baja, y el superadmin ve y puede corregir cómo se
 * interpretó cada valor antes de aplicar.
 */
export type StatusKind = 'active' | 'retired' | 'ignore' | 'unknown'

/** Ya no está en la empresa. */
const RETIRED_WORDS = [
  'retirado', 'retirada', 'retiro', 'baja', 'inactivo', 'inactiva',
  'desvinculado', 'desvinculada', 'desvinculacion', 'terminado', 'terminada',
  'terminacion', 'cesado', 'egresado', 'liquidado', 'liquidada', 'renuncia',
  'renuncio', 'despido', 'despedido', 'finalizado', 'no activo', 'no vigente',
  'no continua', 'retirado voluntario', 'fin de contrato', 'contrato terminado',
]
/** Sigue en la empresa. */
const ACTIVE_WORDS = [
  'activo', 'activa', 'vigente', 'alta', 'contratado', 'contratada', 'nuevo',
  'nueva', 'ingreso', 'trabajando', 'laborando', 'en nomina', 'planta',
]
/**
 * Ausencias TEMPORALES. Cuentan como "no tocar", nunca como baja: quien está de
 * licencia o incapacidad sigue siendo empleado y al volver debe encontrar su
 * cuenta y su progreso donde los dejó.
 */
const IGNORE_WORDS = [
  'licencia', 'incapacidad', 'incapacitado', 'vacaciones', 'suspendido',
  'suspendida', 'suspension', 'permiso', 'maternidad', 'paternidad', 'luto',
  'comision', 'traslado', 'en proceso', 'pendiente',
]

/** Normaliza un valor de estado para compararlo y para usarlo como llave. */
export function normStatus(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Interpretación propuesta para un valor de estado. Es solo una propuesta: la
 * interfaz la muestra y deja cambiarla, porque cada empresa nombra distinto sus
 * novedades y adivinar mal una baja es caro.
 */
export function guessStatusKind(value: string): StatusKind {
  const s = normStatus(value)
  if (!s) return 'unknown'
  const hit = (words: string[]) => words.some((w) => s === w || s.includes(w))
  // Las ausencias temporales se revisan primero: "suspensión de contrato" trae
  // la palabra "contrato" y no debe confundirse con "fin de contrato".
  if (hit(IGNORE_WORDS)) return 'ignore'
  if (hit(RETIRED_WORDS)) return 'retired'
  if (hit(ACTIVE_WORDS)) return 'active'
  return 'unknown'
}

/** Valores distintos que trae la columna de estado, con su conteo de filas. */
export function distinctStatusValues(rows: ExtractedRow[]): { value: string; count: number }[] {
  const map = new Map<string, { value: string; count: number }>()
  for (const r of rows) {
    const key = normStatus(r.status)
    if (!key) continue
    const found = map.get(key)
    if (found) found.count++
    else map.set(key, { value: r.status.trim(), count: 1 })
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

/** Interpretación inicial de cada valor del archivo (llave = valor normalizado). */
export function guessStatusKinds(rows: ExtractedRow[]): Record<string, StatusKind> {
  const out: Record<string, StatusKind> = {}
  for (const { value } of distinctStatusValues(rows)) {
    out[normStatus(value)] = guessStatusKind(value)
  }
  return out
}

/* ── ¿Es la misma persona? ─────────────────────────────────────────────────── */

/**
 * Dos nombres que designan a la misma persona.
 *
 * Exacto ignorando tildes y mayúsculas, o **uno contenido en el otro palabra a
 * palabra**: en la base real hay 23 casos de "Javier Alejandro Vega" en el sitio
 * contra "JAVIER ALEJANDRO VEGA FLOREZ" en la nómina — el apellido que faltaba,
 * no otra persona. Un apodo o un apellido MAL ESCRITO ("Cebrera" por "Cabrera")
 * NO pasa por aquí a propósito: sale en ámbar para que alguien lo mire.
 */
export function namesAgree(a: string, b: string): boolean {
  const wa = fold(a).split(/\s+/).filter(Boolean)
  const wb = fold(b).split(/\s+/).filter(Boolean)
  if (wa.length === 0 || wb.length === 0) return false
  if (wa.join(' ') === wb.join(' ')) return true
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  // Al menos dos palabras en común y todas las del corto dentro del largo: con
  // una sola ("Juan") medio directorio sería la misma persona.
  if (short.length < 2) return false
  return short.every((w) => long.includes(w))
}

/** Dos cargos que son el mismo puesto. Comparación simple: el catálogo es de TH. */
function jobsAgree(a: string, b: string): boolean {
  const fa = fold(a).replace(/\s+/g, ' ').trim()
  const fb = fold(b).replace(/\s+/g, ' ').trim()
  return fa !== '' && fa === fb
}

/**
 * Cuánto se parecen la fila del archivo y la cuenta que se le asignó.
 *
 * Una sola columna en común NUNCA basta para escribir sobre un perfil: el correo
 * se reutiliza, la ficha se teclea mal y el nombre se repite. Se exigen DOS
 * señales de las cuatro. Lo que no coincide no se esconde: viaja en `differ` y
 * la interfaz lo enseña al lado del cambio propuesto.
 */
export function checkIdentity(
  row: { email: string; name: string; nationalId: string; jobTitleRaw: string },
  person: RosterPerson,
): IdentityCheck {
  const agree: ProfileField[] = []
  const differ: ProfileField[] = []

  const mailFile = row.email.trim().toLowerCase()
  const mailDb = (person.email ?? '').trim().toLowerCase()
  if (mailFile && mailDb) (mailFile === mailDb ? agree : differ).push('email')

  const nidFile = row.nationalId
  const nidDb = normalizeNationalId(person.national_id ?? '')
  if (nidFile && nidDb) (nidFile === nidDb ? agree : differ).push('national_id')

  const nameDb = person.display_name ?? ''
  const nameOk = namesAgree(row.name, nameDb)
  if (row.name.trim() && nameDb.trim()) (nameOk ? agree : differ).push('display_name')

  // `job_title` llega `undefined` mientras el SQL no esté corrido: entonces no
  // es una señal ni a favor ni en contra, simplemente no se puede consultar.
  const jobDb = person.job_title
  // Un cargo fijado a mano puede diferir del de la nómina a propósito: usarlo
  // para desmentir el nombre convertiría esa decisión en un choque de identidad.
  const jobKnown = jobDb !== undefined && !person.job_title_locked
  const jobOk = jobKnown && jobsAgree(row.jobTitleRaw, jobDb ?? '')
  const jobComparable = jobKnown && row.jobTitleRaw.trim() !== '' && (jobDb ?? '').trim() !== ''
  if (jobComparable) (jobOk ? agree : differ).push('job_title')

  const nameMismatch = differ.includes('display_name')

  /* Cuándo se bloquea del todo. Dos caminos, y el segundo lo encontraron los
   * datos reales:
   *
   *  a) El cargo DESMIENTE al nombre: los dos están escritos y los dos difieren.
   *  b) Los dos nombres no comparten NI UNA palabra. "Cebrera Roble" contra
   *     "CABRERA ROBLES" comparte el nombre de pila: es un apellido mal tecleado
   *     y se revisa a mano. "Javier Ignacio Herrera Padilla" contra "Edier
   *     Heraldo Hernandez Molano" no comparte nada: son dos personas con el
   *     mismo correo, y eso no se corrige aquí sino en el archivo.
   *
   * Hacía falta (b) porque casi ningún perfil tiene cargo todavía — justo el dato
   * que esta carga viene a llenar — y sin él (a) no se disparaba nunca.
   */
  const palabras = (v: string) => new Set(fold(v).split(/\s+/).filter(Boolean))
  const delArchivo = palabras(row.name)
  const delSitio = palabras(person.display_name ?? '')
  const nadaEnComun =
    delArchivo.size > 0 && delSitio.size > 0 && ![...delArchivo].some((w) => delSitio.has(w))
  const conflict = nameMismatch && ((jobComparable && !jobOk) || nadaEnComun)

  return { agree, differ, confident: agree.length >= 2 && !conflict, nameMismatch, conflict }
}

/* ── Qué habría que corregir ───────────────────────────────────────────────── */

/**
 * Catálogo indexado, para traducir "CLARO MILLA" al CR del sitio.
 *
 * Se apoya en `indexUnits`/`findUnit` (org.service) y no en un Map propio: si el
 * asistente casara los nombres con una regla y la carga masiva con otra, un
 * mismo archivo clasificaría a la gente distinto según por dónde entrara.
 */
export interface UnitLookup {
  operations: UnitIndex
  areas: UnitIndex
}

function labelOf(value: string | null | undefined, fallback = '—'): string {
  const v = (value ?? '').trim()
  return v === '' ? fallback : v
}

/**
 * ¿Cambió de verdad, o solo cambió cómo está escrito?
 *
 * La base de Talento Humano exporta TODO EN MAYÚSCULAS y sin tildes fiables.
 * Comparando tal cual, las 726 personas que ya están bien salen como "hay que
 * corregirles el cargo" — y aceptar eso dejaría el sitio entero gritando. Un
 * cambio de mayúsculas, tildes o espacios NO es un cambio.
 */
function reallyDiffers(a: string | null | undefined, b: string | null | undefined): boolean {
  return fold(a ?? '') !== fold(b ?? '')
}

/** Palabras que en un nombre o un cargo van en minúscula salvo al principio. */
const MINUSCULAS = new Set([
  'de', 'del', 'la', 'las', 'lo', 'los', 'y', 'e', 'o', 'u', 'en', 'el',
  'a', 'al', 'con', 'para', 'por', 'da', 'do', 'dos', 'das', 'van', 'von',
])

/**
 * Devuelve el texto con mayúsculas de nombre propio, pero SOLO si venía todo en
 * mayúsculas. Si ya trae mayúsculas y minúsculas, alguien lo escribió así a
 * propósito y no se toca.
 *
 * Las siglas cortas se respetan ("GERENTE DE OPERACIONES PL" → "Gerente de
 * Operaciones PL"): convertirlas en "Pl" es peor que no hacer nada, y en los
 * cargos de esta empresa hay muchas (TI, SST, RH, PL, AMS).
 */
export function titleCaseFromRoster(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text || text !== text.toUpperCase()) return text
  /** Un trozo sin separadores: "sst", "hansen", "de". */
  const trozo = (w: string, first: boolean): string => {
    if (/[0-9]/.test(w)) return w
    const low = w.toLocaleLowerCase('es')
    // El conector va PRIMERO: "DE" y "LA" también son de dos letras, y la regla
    // de siglas los dejaría gritando en mitad del nombre.
    if (!first && MINUSCULAS.has(low)) return low
    const letters = w.replace(/[^A-Za-zÀ-ɏ]/g, '')
    // Sigla corta: TI, SST, PL, J&J. Se queda como está.
    if (letters.length > 0 && letters.length <= 3) return w
    return low.charAt(0).toLocaleUpperCase('es') + low.slice(1)
  }
  /* Los guiones y las barras se tratan trozo a trozo, o "COORDINADOR SG-SST"
   * sale "Sg-Sst": la sigla estaba dentro de la palabra, no al lado. */
  const word = (w: string, first: boolean): string =>
    w
      .split(/([-/.])/)
      .map((part, i) => (/^[-/.]$/.test(part) ? part : trozo(part, first && i === 0)))
      .join('')
  return text.split(' ').map((w, i) => word(w, i === 0)).join(' ')
}

/**
 * Los datos que la base dice distinto de lo que hay hoy en el perfil.
 *
 * Solo se propone lo que la base AFIRMA: una celda vacía nunca borra un dato
 * que ya está. Es la diferencia entre "TH todavía no lo tiene" y "TH dice que
 * está vacío", y confundirlas vacía medio directorio en una sola carga.
 */
export function computeChanges(
  row: {
    email: string; name: string; nationalId: string; nationalIdRaw: string
    jobTitleRaw: string; country: string
  },
  person: RosterPerson,
  units: { operation?: OrgUnit; area?: OrgUnit },
  /** Todas las unidades por id, para poder escribir el CR que tiene HOY. */
  unitNames?: Map<string, OrgUnit>,
): FieldChange[] {
  const out: FieldChange[] = []
  const push = (field: ProfileField, from: string | null, to: string, fromLabel?: string, toLabel?: string, needsAuth = false) => {
    out.push({ field, from, to, fromLabel: fromLabel ?? labelOf(from), toLabel: toLabel ?? to, needsAuth })
  }

  const mailFile = row.email.trim().toLowerCase()
  const mailDb = (person.email ?? '').trim().toLowerCase()
  if (mailFile && mailFile !== mailDb) push('email', person.email, mailFile, undefined, undefined, true)

  /* Nombre y cargo entran con mayúsculas de nombre propio, no como los exporta
   * la nómina. Y solo si el dato cambió de verdad — ver `reallyDiffers`. */
  const nameFile = titleCaseFromRoster(row.name)
  if (nameFile && reallyDiffers(nameFile, person.display_name)) {
    push('display_name', person.display_name, nameFile)
  }

  // El cargo tiene UNA sola fuente: esta base. Por eso se pisa, al revés que la
  // campaña, que solo se completa.
  const jobFile = titleCaseFromRoster(row.jobTitleRaw)
  if (
    person.job_title !== undefined &&
    // Fijado a mano: la nómina ni lo propone. No se enseña como cambio que se
    // puede desmarcar, porque desmarcarlo cada mes es justo lo que se evita.
    !person.job_title_locked &&
    jobFile &&
    reallyDiffers(jobFile, person.job_title)
  ) {
    push('job_title', person.job_title, jobFile)
  }

  if (person.country !== undefined && row.country && row.country !== (person.country ?? '')) {
    push('country', person.country, row.country)
  }

  const nidFile = row.nationalId
  if (nidFile && nidFile !== normalizeNationalId(person.national_id ?? '')) {
    push('national_id', person.national_id, row.nationalIdRaw.trim() || nidFile)
  }

  const nameOfUnit = (id: string | null | undefined) =>
    labelOf(id ? unitNames?.get(id)?.name : null)
  if (units.operation && person.operation_id !== undefined && units.operation.id !== person.operation_id) {
    push('operation_id', person.operation_id, units.operation.id, nameOfUnit(person.operation_id), units.operation.name)
  }
  if (units.area && person.area_id !== undefined && units.area.id !== person.area_id) {
    push('area_id', person.area_id, units.area.id, nameOfUnit(person.area_id), units.area.name)
  }

  return out
}

/* ── Nómina actual del sitio ───────────────────────────────────────────────── */

/**
 * Todos los aprendices con cuenta (activos e inactivos), de todas las campañas.
 * Sirve **solo para reconocer a quién menciona el archivo**: como no hay bajas
 * por omisión, traer a todo el mundo no expone a nadie — al contrario, evita el
 * error de no encontrar a una persona por haber acotado mal el alcance y crearle
 * una cuenta duplicada.
 *
 * El RPC es SECURITY DEFINER y solo responde al superadmin: el correo vive en
 * `auth.users` y no es accesible de otra forma.
 */
export async function getRoster(campaignIds: string[] = []): Promise<RosterPerson[]> {
  const { data, error } = await supabase.rpc('get_hr_roster', {
    p_campaign_ids: campaignIds.length ? campaignIds : null,
  })
  if (error) throw error
  return (data ?? []) as RosterPerson[]
}

/* ── El cruce ──────────────────────────────────────────────────────────────── */

export interface DiffOptions {
  /** Filas del archivo ya interpretadas por `extractRows`. */
  fileRows: ExtractedRow[]
  /** Cuentas que existen hoy, solo para reconocer a quién menciona el archivo. */
  roster: RosterPerson[]
  /**
   * Qué significa cada valor de la columna de estado (llave = valor normalizado
   * con `normStatus`). Lo propone `guessStatusKinds` y lo puede corregir el
   * superadmin. Un valor ausente de este mapa no hace nada.
   */
  statusKinds: Record<string, StatusKind>
  /**
   * Cómo tratar las filas sin estado legible (celda vacía, o archivo sin columna
   * de estado). `'active'` permite altas y reactivaciones; `'unknown'` no hace
   * nada. **Nunca** puede valer `'retired'`: no se da de baja a ciegas.
   */
  missingStatusAs: 'active' | 'unknown'
  /**
   * Campañas por nombre en minúsculas → id, para resolver la columna de campaña
   * del archivo cuando la trae.
   */
  campaignByName?: Map<string, string>
  /** Campaña que reciben las altas cuyo nombre no salió del archivo. */
  defaultCampaignId?: string | null
  /**
   * El catálogo de CR y áreas ya casado por nombre (ver `resolveUnitsFromRoster`).
   * Sin él no se proponen cambios de CR ni de área — nunca se inventa una unidad
   * desde el archivo.
   */
  units?: UnitLookup
  /** Todas las unidades por id, para escribir el CR que la persona tiene hoy. */
  unitNames?: Map<string, OrgUnit>
  /**
   * Si se proponen correcciones de datos. Se apaga solo cuando el roster llega
   * sin los campos nuevos (SQL sin correr): proponer a ciegas sería peor que no
   * proponer.
   */
  allowUpdates?: boolean
}

/**
 * Interpreta el archivo y devuelve **una entrada por fila**, con la acción que
 * le corresponde. No escribe nada.
 *
 * Solo el archivo manda: cada fila se procesa por lo que dice su estado. Nadie
 * que el archivo no mencione aparece aquí, así que es imposible que un reporte
 * incompleto dé de baja a quien sigue trabajando.
 *
 * El cruce con las cuentas existentes es por cédula y, si la fila no la trae, por
 * correo: los reportes de TH identifican por documento y el correo corporativo
 * cambia (matrimonios, homónimos, correcciones), así que cruzar solo por correo
 * crearía una cuenta nueva vacía al lado de la que ya existe.
 */
export function diffNovelties({
  fileRows,
  roster,
  statusKinds,
  missingStatusAs,
  campaignByName,
  defaultCampaignId = null,
  units,
  unitNames,
  allowUpdates = true,
}: DiffOptions): SyncEntry[] {
  const byNationalId = new Map<string, RosterPerson>()
  const byEmail = new Map<string, RosterPerson>()
  /* Nombre + cargo: la tercera llave, y la única que resuelve "esta persona
   * cambió de correo". Sin ella, un correo nuevo para alguien que ya trabaja
   * aquí crea una cuenta duplicada y su progreso se queda en la vieja. Solo se
   * usa cuando las dos partes coinciden exactamente: es una llave débil. */
  const byNameJob = new Map<string, RosterPerson[]>()
  for (const p of roster) {
    const nid = normalizeNationalId(p.national_id ?? '')
    // La primera gana: si dos cuentas comparten cédula (un duplicado viejo), la
    // segunda no se pierde — cae en las bajas por omisión y queda a la vista.
    if (nid && !byNationalId.has(nid)) byNationalId.set(nid, p)
    const mail = (p.email ?? '').trim().toLowerCase()
    if (mail && !byEmail.has(mail)) byEmail.set(mail, p)
    const nj = `${fold(p.display_name ?? '')}|${fold(p.job_title ?? '')}`
    if (p.display_name && p.job_title) byNameJob.set(nj, [...(byNameJob.get(nj) ?? []), p])
  }

  /**
   * Qué se le corrige a una cuenta ya casada con su fila.
   *
   * Con identidad CONFIRMADA (dos señales de cuatro) se corrige todo. Sin ella
   * —casó por correo o ficha, pero el nombre del sitio está incompleto o mal
   * escrito ("isabela", "Ramírez" contra "RAMIRESZ")— solo se copia DÓNDE ESTÁ:
   * país, área y CR. Nombre, cargo, ficha y correo piden las dos señales; la
   * ubicación no, porque dejarla vacía saca a la persona de toda regla de
   * audiencia, y la llave con la que casó (correo o ficha exactos) ya es fuerte.
   * El choque de identidad se descarta antes de llegar aquí.
   */
  const changesFor = (identity: IdentityCheck, row: ExtractedRow, matched: RosterPerson): FieldChange[] => {
    const all = computeChanges(
      { email: row.email.trim().toLowerCase(), name: row.name, nationalId: row.nationalId,
        nationalIdRaw: row.nationalIdRaw, jobTitleRaw: row.jobTitleRaw, country: row.country },
      matched,
      { operation: findUnit(units?.operations, row.operationRaw), area: findUnit(units?.areas, row.areaRaw) },
      unitNames,
    )
    return identity.confident ? all : all.filter((c) => LOCATION_FIELDS.includes(c.field))
  }

  const entries: SyncEntry[] = []
  /** Filas ya vistas (cédula o correo) para detectar repetidos en el archivo. */
  const seenKeys = new Set<string>()

  fileRows.forEach((row, i) => {
    const email = row.email.trim().toLowerCase()
    const nid = row.nationalId
    const dedupeKey = nid ? `n:${nid}` : email ? `e:${email}` : ''
    const key = `f${row.sourceLine}:${i}`
    const campaignRaw = row.campaign.trim()
    const operation = findUnit(units?.operations, row.operationRaw)
    const area = findUnit(units?.areas, row.areaRaw)
    const base = {
      key,
      sourceLine: row.sourceLine,
      sheet: row.sheet,
      email,
      name: row.name.trim(),
      nationalId: nid,
      nationalIdRaw: row.nationalIdRaw,
      status: row.status,
      country: row.country,
      jobTitleRaw: row.jobTitleRaw,
      operationRaw: row.operationRaw,
      areaRaw: row.areaRaw,
      operation,
      area,
      changes: [] as FieldChange[],
      campaignRaw,
      // La campaña del archivo manda sobre el valor por defecto; si el nombre no
      // corresponde a ninguna campaña del sitio se usa el default y la interfaz
      // deja corregirlo fila por fila.
      campaignId:
        (campaignRaw ? campaignByName?.get(campaignRaw.toLowerCase()) : undefined) ?? defaultCampaignId,
    }

    // Fila sin nada con lo que identificar a nadie.
    if (!dedupeKey) {
      entries.push({ ...base, action: 'skipped', matchedBy: null, reason: 'no_email', include: false })
      return
    }
    if (seenKeys.has(dedupeKey)) {
      entries.push({ ...base, action: 'skipped', matchedBy: null, reason: 'duplicate', include: false })
      return
    }
    seenKeys.add(dedupeKey)

    /* Orden de las llaves, de la más fuerte a la más débil: ficha de TH, correo
     * y, por último, nombre + cargo exactos. La última existe solo para el caso
     * de "le cambiaron el correo": si casara con más de una persona no se usa,
     * porque dos homónimos con el mismo puesto son exactamente el escenario en
     * el que escribir sobre el perfil equivocado no se nota nunca. */
    const njKey = `${fold(row.name)}|${fold(row.jobTitleRaw)}`
    const njHits = row.name.trim() && row.jobTitleRaw.trim() ? (byNameJob.get(njKey) ?? []) : []
    const matched =
      (nid ? byNationalId.get(nid) : undefined) ??
      (email ? byEmail.get(email) : undefined) ??
      (njHits.length === 1 ? njHits[0] : undefined)
    const matchedBy: SyncEntry['matchedBy'] = !matched
      ? null
      : nid && byNationalId.get(nid) === matched
        ? 'national_id'
        : email && byEmail.get(email) === matched
          ? 'email'
          : 'name_job'

    // Qué dice el archivo de esta persona. Sin estado legible se usa el default
    // elegido, que jamás puede ser "retirada".
    const statusKey = normStatus(row.status)
    const kind: StatusKind = statusKey ? (statusKinds[statusKey] ?? 'unknown') : missingStatusAs

    if (kind === 'retired') {
      if (!matched) {
        entries.push({ ...base, action: 'skipped', matchedBy: null, reason: 'retired_no_account', include: false })
        return
      }
      entries.push(
        matched.is_active
          // `include: false` a propósito: la baja se confirma una por una.
          ? { ...base, action: 'deactivate', matchedBy, person: matched, reason: 'retired_in_file', include: false }
          : { ...base, action: 'skipped', matchedBy, person: matched, reason: 'already_inactive', include: false },
      )
      /* SUS DATOS SE ACTUALIZAN IGUAL, aparte de la baja. Antes una fila
       * «retirado» solo proponía apagar la cuenta: si nadie confirmaba la baja
       * —y nacen sin marcar— la persona seguía activa y SIN país, área ni CR,
       * fuera de toda regla de audiencia. 64 personas quedaron así (2026-09-16).
       * Van como una corrección más, marcada, en su propia entrada: decidir la
       * baja y completar la ficha son dos decisiones distintas.
       * El correo NO se mueve: a quien se fue no se le cambia la cuenta de ingreso. */
      if (allowUpdates) {
        const identity = checkIdentity(
          { email, name: row.name, nationalId: nid, jobTitleRaw: row.jobTitleRaw },
          matched,
        )
        if (!identity.conflict) {
          const changes = changesFor(identity, row, matched).filter((c) => c.field !== 'email')
          if (changes.length > 0) {
            entries.push({
              ...base, key: `${key}:datos`, action: 'update', matchedBy, person: matched,
              identity, changes, include: true,
            })
          }
        }
      }
      return
    }

    // Novedad que no es alta ni baja (licencia, vacaciones) o estado que no
    // reconocemos: se muestra, pero no se toca nada.
    if (kind === 'ignore' || kind === 'unknown') {
      entries.push({
        ...base,
        action: 'skipped',
        matchedBy,
        person: matched,
        reason: kind === 'ignore' ? 'status_ignored' : 'status_unknown',
        include: false,
      })
      return
    }

    // Activa según el archivo.
    if (matched) {
      const identity = checkIdentity(
        { email, name: row.name, nationalId: nid, jobTitleRaw: row.jobTitleRaw },
        matched,
      )

      /* Mismo correo, otro nombre y otro cargo: no es un dato mal escrito, son
       * dos personas. No se aplica ni marcándolo a mano — la corrección está en
       * el archivo. */
      if (identity.conflict) {
        entries.push({
          ...base, action: 'skipped', matchedBy, person: matched,
          identity, reason: 'identity_conflict', include: false,
        })
        return
      }

      const changes = allowUpdates ? changesFor(identity, row, matched) : []

      if (!matched.is_active) {
        entries.push({ ...base, action: 'reactivate', matchedBy, person: matched, identity, changes, include: true })
        return
      }
      entries.push(
        changes.length > 0
          ? {
              ...base, action: 'update', matchedBy, person: matched, identity, changes,
              /* Nace MARCADA aunque el nombre no case del todo: `confident` ya
               * exige dos señales de cuatro (ficha y correo, casi siempre), y el
               * choque de verdad —nombres sin una palabra en común— se bloqueó
               * arriba. Sin marcar, «Zamundio» contra «ZAMUDIO» dejaba a la
               * persona sin área ni CR carga tras carga. El nombre del sitio se
               * sigue enseñando en ámbar al lado, para quien quiera desmarcarla. */
              include: true,
            }
          : { ...base, action: 'unchanged', matchedBy, person: matched, identity, include: true },
      )
      return
    }

    // Nadie con esa cédula ni ese correo: es un alta. Sin correo no hay cuenta
    // posible, así que queda a la vista como pendiente de completar.
    entries.push(
      email
        ? { ...base, action: 'create', matchedBy: null, include: true }
        : { ...base, action: 'skipped', matchedBy: null, reason: 'no_email', include: false },
    )
  })

  if (allowUpdates) entries.push(...twinAccountEntries(fileRows, roster, entries, units, unitNames))

  return entries
}

/** Dónde está la persona. Lo único que se copia sin identidad confirmada. */
const LOCATION_FIELDS: ProfileField[] = ['country', 'operation_id', 'area_id']

/**
 * SEGUNDAS CUENTAS: gente con dos cuentas (la de @positivosmais y otra de
 * @learningai, o un correo mal tecleado) y una sola fila en la base. La fila se
 * casa con una de las dos y la otra se quedaba sin país, área ni CR para
 * siempre: fuera de las reglas de audiencia y de los paneles por CR.
 *
 * Se casa SOLO por nombre completo idéntico (sin tildes ni mayúsculas), y solo
 * si ese nombre sale una vez en el archivo: dos homónimos son justo el caso en
 * que copiar datos a la cuenta equivocada no se nota nunca. Y solo se copia
 * DÓNDE ESTÁ la persona —país, área, CR—: nunca el correo, la ficha, el nombre
 * ni el cargo, que son de la cuenta principal.
 */
function twinAccountEntries(
  fileRows: ExtractedRow[],
  roster: RosterPerson[],
  entries: SyncEntry[],
  units: UnitLookup | undefined,
  unitNames: Map<string, OrgUnit> | undefined,
): SyncEntry[] {
  const usados = new Set(entries.map((e) => e.person?.id).filter(Boolean))
  const clave = (v: string) => fold(v).replace(/\s+/g, ' ').trim()
  const filasPorNombre = new Map<string, ExtractedRow[]>()
  for (const r of fileRows) {
    const k = clave(r.name)
    if (k.split(' ').length < 2) continue
    filasPorNombre.set(k, [...(filasPorNombre.get(k) ?? []), r])
  }

  const out: SyncEntry[] = []
  for (const person of roster) {
    if (usados.has(person.id)) continue
    const filas = filasPorNombre.get(clave(person.display_name ?? '')) ?? []
    if (filas.length !== 1) continue
    const row = filas[0]
    const operation = findUnit(units?.operations, row.operationRaw)
    const area = findUnit(units?.areas, row.areaRaw)
    const changes = computeChanges(
      { email: '', name: '', nationalId: '', nationalIdRaw: '', jobTitleRaw: '', country: row.country },
      person,
      { operation, area },
      unitNames,
    ).filter((c) => LOCATION_FIELDS.includes(c.field))
    if (changes.length === 0) continue
    out.push({
      key: `twin:${person.id}`,
      action: 'update',
      sourceLine: row.sourceLine,
      sheet: row.sheet,
      // El correo de ESTA cuenta, no el de la fila: es lo que distingue en
      // pantalla la segunda cuenta de la principal.
      email: (person.email ?? '').trim().toLowerCase(),
      name: row.name.trim(),
      nationalId: '',
      nationalIdRaw: '',
      status: row.status,
      country: row.country,
      jobTitleRaw: row.jobTitleRaw,
      operationRaw: row.operationRaw,
      areaRaw: row.areaRaw,
      operation,
      area,
      campaignRaw: '',
      campaignId: null,
      matchedBy: 'twin_account',
      person,
      changes,
      include: true,
    })
  }
  return out
}

export function countByAction(entries: SyncEntry[], onlyIncluded = false): SyncCounts {
  const c: SyncCounts = { create: 0, reactivate: 0, deactivate: 0, unchanged: 0, skipped: 0, update: 0 }
  for (const e of entries) {
    if (onlyIncluded && !e.include) continue
    c[e.action]++
  }
  return c
}

/**
 * A partir de estas bajas en una sola carga, la interfaz pide una confirmación
 * extra. Con las bajas leídas del archivo un número alto puede ser legítimo (un
 * cierre de operación), pero también es la pista de que se mapeó como "estado"
 * una columna que no lo es.
 */
export const CONFIRM_DEACTIVATIONS_OVER = 20

/* ── Aplicar ───────────────────────────────────────────────────────────────── */

const CREATE_CHUNK = 100
const STATUS_CHUNK = 200

export interface ApplyOptions {
  /**
   * Entradas ya resueltas por el superadmin: qué se aplica (`include`) y, en las
   * altas, en qué campaña nace cada persona (`campaignId`).
   */
  entries: SyncEntry[]
  fileName: string
  /** Periodo que representa la nómina, "2026-07". */
  period: string
  reason: string
  /**
   * Si quien aplica puede dar de baja. **Solo el superadmin.** No es cosmético:
   * aunque la interfaz esconda el botón, esta función vuelve a filtrar las
   * bajas, porque un alta de más se corrige y una baja indebida deja a alguien
   * fuera sin que nadie se entere hasta que reclama. Recursos Humanos ve las
   * bajas propuestas y las puede exportar; no las ejecuta.
   */
  canDeactivate: boolean
  onProgress?: (
    done: number,
    total: number,
    phase: 'create' | 'deactivate' | 'reactivate' | 'update' | 'finish',
  ) => void
}

export interface ApplyResult {
  created: { email: string; status: 'created' | 'error'; password?: string; reason?: string }[]
  deactivated: number
  reactivated: number
  unchanged: number
  /** Perfiles corregidos y cuántos campos se tocaron en total. */
  updated: number
  fieldsUpdated: number
  /** Correos movidos también en la cuenta de ingreso. */
  emailsChanged: number
  /** Bajas que se propusieron y NO se aplicaron por no ser superadmin. */
  deactivationsBlocked: number
  errors: string[]
}

/** Campos de `profiles` que se escriben directo; el correo va aparte. */
const DIRECT_FIELDS: Exclude<ProfileField, 'email'>[] = [
  'display_name', 'job_title', 'country', 'national_id', 'operation_id', 'area_id',
]

/**
 * Aplica las correcciones de una entrada. El correo va primero y por su propio
 * camino: si falla (porque otra cuenta ya lo usa) el resto de los datos se
 * guarda igual, en vez de perderse toda la fila por un choque de correo.
 */
async function applyEntryChanges(
  entry: SyncEntry,
): Promise<{ fields: number; emailChanged: boolean; error?: string }> {
  const id = entry.person?.id
  if (!id) return { fields: 0, emailChanged: false }
  let emailChanged = false
  let error: string | undefined

  const mail = entry.changes.find((c) => c.field === 'email')
  if (mail) {
    try {
      await updateUserEmail(id, mail.to)
      emailChanged = true
    } catch (err) {
      error = `${entry.email}: ${(err as Error).message}`
    }
  }

  const patch: Partial<Record<Exclude<ProfileField, 'email'>, string>> = {}
  for (const c of entry.changes) {
    if (c.field === 'email') continue
    if (DIRECT_FIELDS.includes(c.field)) patch[c.field] = c.to
  }
  if (Object.keys(patch).length > 0) {
    const { error: dbError } = await supabase.from('profiles').update(patch).eq('id', id)
    if (dbError) error = `${entry.email}: ${dbError.message}`
  }

  return { fields: Object.keys(patch).length + (emailChanged ? 1 : 0), emailChanged, error }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }
}

/**
 * Da de baja (o vuelve a dar de alta) a un grupo de personas.
 *
 * Vive en una Edge Function porque además de `profiles` hay que tocar la cuenta
 * de autenticación: sin bloquearla ahí, una persona dada de baja seguiría
 * pudiendo iniciar sesión.
 *
 * `allowStaff` decide si la llamada puede tocar capacitadores, Talento Humano y
 * superadmins. Por defecto NO: la sincronización de nómina manda listas largas
 * y un cruce de documentos no puede dejar a un capacitador sin acceso. La baja
 * de staff se hace a mano, persona por persona, desde la pantalla de Usuarios.
 */
export async function setUsersActive(
  userIds: string[],
  active: boolean,
  reason = '',
  allowStaff = false,
): Promise<{ updated: number; skipped: { id: string; reason: string }[] }> {
  if (userIds.length === 0) return { updated: 0, skipped: [] }
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/set-user-status`,
    {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ userIds, active, reason, allowStaff }),
    },
  )
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error ?? 'No se pudo cambiar el estado')
  return { updated: json.updated ?? 0, skipped: json.skipped ?? [] }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Aplica la sincronización en tandas: primero las altas, luego las bajas y
 * reactivaciones. Cada tanda es independiente, así un archivo de miles de
 * personas no depende de que una sola llamada aguante.
 */
export async function applySync(opts: ApplyOptions): Promise<ApplyResult> {
  const { entries, fileName, period, reason, canDeactivate, onProgress } = opts
  const included = entries.filter((e) => e.include)
  const toCreate = included.filter((e) => e.action === 'create')
  const proposedDeactivations = included.filter((e) => e.action === 'deactivate')
  /* El candado real. La interfaz esconde el botón, pero quien llame a esta
   * función sin ser superadmin tampoco da de baja a nadie. */
  const toDeactivate = canDeactivate ? proposedDeactivations : []
  const toReactivate = included.filter((e) => e.action === 'reactivate')
  const unchanged = included.filter((e) => e.action === 'unchanged')
  // Una reactivación también puede traer datos corregidos.
  const toUpdate = included.filter((e) => e.changes.length > 0 && e.action !== 'create')

  const total = toCreate.length + toDeactivate.length + toReactivate.length + toUpdate.length
  let done = 0
  const result: ApplyResult = {
    created: [], deactivated: 0, reactivated: 0, unchanged: unchanged.length,
    updated: 0, fieldsUpdated: 0, emailsChanged: 0,
    deactivationsBlocked: canDeactivate ? 0 : proposedDeactivations.length,
    errors: [],
  }

  /* Altas — agrupadas por campaña, porque cada persona puede ir a la suya. Cada
   * grupo reutiliza la carga masiva ya probada (contraseña inicial, credencial
   * temporal y bitácora incluidas). */
  const createByCampaign = new Map<string, SyncEntry[]>()
  for (const e of toCreate) {
    const k = e.campaignId ?? ''
    const list = createByCampaign.get(k) ?? []
    list.push(e)
    createByCampaign.set(k, list)
  }

  for (const [campaign, list] of createByCampaign) {
    for (const group of chunk(list, CREATE_CHUNK)) {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-users-bulk`,
          {
            method: 'POST',
            headers: await authHeader(),
            body: JSON.stringify({
              rows: group.map((e) => ({
                email: e.email,
                display_name: e.name || undefined,
                role: 'learner',
                campaign: campaign || undefined,
                national_id: e.nationalId || undefined,
                country: e.country || undefined,
                /* El CR y el área van DESDE EL ALTA. Antes no: la cuenta nacía
                 * sin clasificar aunque la nómina dijera su CR en la misma fila,
                 * y hacía falta volver a cargar el archivo para que apareciera
                 * como "corrección". Cuarenta y tres personas entraron así. */
                operation_id: e.operation?.id,
                area_id: e.area?.id,
                job_title: titleCaseFromRoster(e.jobTitleRaw) || undefined,
              })),
            }),
          },
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? 'Error creando usuarios')
        result.created.push(...(json.results ?? []))
      } catch (err) {
        result.errors.push((err as Error).message)
        result.created.push(
          ...group.map((e) => ({ email: e.email, status: 'error' as const, reason: (err as Error).message })),
        )
      }
      done += group.length
      onProgress?.(done, total, 'create')
    }
  }

  /* Bajas */
  for (const group of chunk(toDeactivate, STATUS_CHUNK)) {
    try {
      const { updated } = await setUsersActive(
        group.map((e) => e.person!.id),
        false,
        reason,
      )
      result.deactivated += updated
    } catch (err) {
      result.errors.push((err as Error).message)
    }
    done += group.length
    onProgress?.(done, total, 'deactivate')
  }

  /* Reactivaciones */
  for (const group of chunk(toReactivate, STATUS_CHUNK)) {
    try {
      const { updated } = await setUsersActive(group.map((e) => e.person!.id), true, reason)
      result.reactivated += updated
    } catch (err) {
      result.errors.push((err as Error).message)
    }
    done += group.length
    onProgress?.(done, total, 'reactivate')
  }

  /* Correcciones de datos. De una en una y no en lote: cada persona puede
   * llevar un juego de campos distinto, y el cambio de correo toca la cuenta de
   * ingreso, que no admite tandas. */
  for (const e of toUpdate) {
    const r = await applyEntryChanges(e)
    if (r.fields > 0) {
      result.updated += 1
      result.fieldsUpdated += r.fields
    }
    if (r.emailChanged) result.emailsChanged += 1
    if (r.error) result.errors.push(r.error)
    done += 1
    onProgress?.(done, total, 'update')
  }

  onProgress?.(total, total, 'finish')

  /* Rastro en las cuentas confirmadas: en qué nómina se las vio por última vez,
   * y la cédula del archivo cuando el perfil todavía no la tenía. */
  /* A quién vio esta nómina. Van también los CORREGIDOS: el archivo los nombra
   * igual que a los que no cambiaron, y dejarlos fuera hacía que la persona a la
   * que se le acababa de poner el CR figurara como "no aparece en la nómina" —
   * justo al revés de lo que pasó. */
  const confirmed = [...unchanged, ...toReactivate, ...toUpdate]
  const seenIds = [...new Set(confirmed.map((e) => e.person!.id))]
  const nowIso = new Date().toISOString()
  /* Tandas de 100 y no de 200: `.in()` viaja en la URL y con ochocientas
   * personas doscientos uuid por llamada rozan el límite de longitud. Cuando
   * revienta no dice "URL larga", dice 400 — y parece que no hay filas. */
  for (const group of chunk(seenIds, 100)) {
    await supabase.from('profiles').update({ hr_last_seen_at: nowIso }).in('id', group)
  }
  const missingNid = confirmed.filter((e) => e.nationalId && !e.person!.national_id)
  for (const e of missingNid) {
    await supabase.from('profiles').update({ national_id: e.nationalIdRaw.trim() }).eq('id', e.person!.id)
  }

  /* Historial de la carga: permite reconstruir cualquier mes y explicar por qué
   * una persona quedó inactiva. No es crítico, así que no rompe la operación. */
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
    : { data: null }
  await supabase.from('hr_sync_runs').insert({
    actor_id: user?.id ?? null,
    actor_name: me?.display_name ?? null,
    file_name: fileName,
    // Las campañas donde nacieron las altas. NO es un alcance: esta
    // sincronización no da de baja a nadie por campaña.
    campaign_ids: [...new Set(toCreate.map((e) => e.campaignId).filter((id): id is string => !!id))],
    period,
    created_count: result.created.filter((r) => r.status === 'created').length,
    deactivated_count: result.deactivated,
    reactivated_count: result.reactivated,
    unchanged_count: result.unchanged,
    skipped_count: entries.filter((e) => e.action === 'skipped' || !e.include).length,
    detail: {
      reason,
      updated: toUpdate.map((e) => ({
        id: e.person!.id,
        email: e.email,
        fields: e.changes.map((c) => `${c.field}: ${c.fromLabel} → ${c.toLabel}`),
      })),
      /* Bajas que se propusieron y no se aplicaron por no ser superadmin. Quedan
       * escritas para que se puedan retomar, no para que se pierdan. */
      deactivations_blocked: canDeactivate
        ? []
        : proposedDeactivations.map((e) => ({ id: e.person!.id, email: e.email })),
      created: result.created.map((r) => ({ email: r.email, status: r.status })),
      deactivated: toDeactivate.map((e) => ({
        id: e.person!.id,
        email: e.email,
        national_id: e.nationalIdRaw || null,
        why: e.reason ?? null,
      })),
      reactivated: toReactivate.map((e) => ({ id: e.person!.id, email: e.email })),
      errors: result.errors,
    },
  })

  return result
}

/* ── Historial ─────────────────────────────────────────────────────────────── */

export interface HrSyncRun {
  id: string
  actor_name: string | null
  file_name: string | null
  period: string | null
  campaign_ids: string[]
  created_count: number
  deactivated_count: number
  reactivated_count: number
  unchanged_count: number
  skipped_count: number
  created_at: string
}

/** Últimas sincronizaciones aplicadas (para el panel de superadmin). */
export async function getSyncRuns(limit = 12): Promise<HrSyncRun[]> {
  const { data, error } = await supabase
    .from('hr_sync_runs')
    .select('id, actor_name, file_name, period, campaign_ids, created_count, deactivated_count, reactivated_count, unchanged_count, skipped_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as HrSyncRun[]
}
