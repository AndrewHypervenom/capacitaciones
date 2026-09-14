import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Upload, FileSpreadsheet, Download, Loader2, Check, AlertCircle, AlertTriangle,
  ArrowLeft, ShieldCheck, Copy, Pencil, RefreshCw, Layers,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFileDrop } from '@/hooks/useFileDrop'
import * as XLSX from 'xlsx'
import { Select } from '@/components/ui/Select'
import { supabase } from '@/lib/supabase'
import { getDefaultPassword } from '@/services/appSettings.service'
import { resolveCreationCampaignId } from '@/stores/campaignScopeStore'
import { toast } from '@/stores/toastStore'
import {
  readGrids, analyzeGrid, extractAllSheets, finalDisplayName,
  type SheetGrid, type ColumnMapping, type ExtractedRow,
} from '@/lib/parseUsersSheet'
import { COUNTRY_OPTIONS, countryLabelWithFlag } from '@/lib/countries'
import { getOrganizations, getOrgUnits, indexUnits, findUnit } from '@/services/org.service'
import type { OrgUnit } from '@/types/database'
import type { Campaign } from '@/types/database'

/**
 * Tope de filas para el capacitador. El superadmin no topa: una nómina completa
 * puede traer cientos de personas y partir el archivo a mano es pedir errores.
 */
const MAX_ROWS = 200
/**
 * Filas por llamada a `create-users-bulk`. La función crea las cuentas una por
 * una, así que un archivo grande se manda en tandas: cada llamada termina
 * cómodamente dentro de su tiempo límite y, si una falla, lo ya creado no se
 * pierde ni se repite. También es lo que deja subir 756 personas sin tocar la
 * función desplegada (que sigue aceptando hasta 200 por llamada).
 */
const BATCH_SIZE = 100
const SITE_URL = 'https://capacitaciones-chi.vercel.app/'
const NONE = -1

/**
 * ¿El servidor rechazó la fila porque esa persona YA tenía cuenta?
 *
 * Importa distinguirlo: cuando `createUser` falla por correo repetido, la
 * función corta ahí mismo y NO toca el perfil, así que a esa persona no se le
 * cambió ni la campaña ni el rol. Es un "ya estaba", no un error que haya que
 * arreglar.
 */
function isAlreadyRegistered(reason?: string): boolean {
  const m = (reason ?? '').toLowerCase()
  return (
    m.includes('already been registered') ||
    m.includes('already registered') ||
    m.includes('already exists') ||
    m.includes('duplicate key value') ||
    m.includes('email_exists')
  )
}

/** Parte una lista en tandas de `size`. */
function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

type Step = 'file' | 'review' | 'result'

/** Lo que se dedujo de UNA hoja del libro, y si entra en la carga. */
interface SheetPlan {
  include: boolean
  hasHeader: boolean
  headerRow: number
  mapping: ColumnMapping
}
type RowStatus = 'new' | 'exists' | 'duplicate' | 'invalid'

interface RowResult {
  email: string
  status: 'created' | 'updated' | 'skipped' | 'error'
  password?: string
  reason?: string
  /** País que el servidor dice haber guardado (ausente en despliegues viejos). */
  country?: string | null
}

/** Fila ya resuelta: exactamente lo que se va a crear (o por qué no). */
interface PreviewRow {
  key: string
  sourceLine: number
  /** Hoja de la que salió: con tres hojas, "fila 12" no identifica nada. */
  sheet: string
  email: string
  raw: string
  name: string
  /** El nombre salió del archivo (false = lo deduce el sistema del correo). */
  nameFromFile: boolean
  role: string
  campaignId: string | null
  /** Código ISO que se va a guardar ('' = sin país). */
  country: string
  /**
   * El archivo traía algo en la columna de país que no se pudo interpretar. Se
   * muestra en ámbar: el alta sigue, pero sin país, y quien carga lo ve.
   */
  countryUnknown: string
  /** Id de la unidad del catálogo que le toca ('' = sin clasificar). */
  operationId: string
  areaId: string
  /** Nombre de la unidad, para pintarlo sin volver a buscar. */
  operationName: string
  areaName: string
  /**
   * El archivo traía una operación/área que NO está en el catálogo. Se muestra
   * en ámbar y el alta sigue sin clasificar: nunca se crea la unidad sola. El
   * catálogo lo abre el superadmin, que es todo el punto del gobierno nuevo.
   */
  operationUnknown: string
  areaUnknown: string
  /**
   * Cargo que trae el archivo ('' si la columna no viene o la celda está vacía).
   *
   * A diferencia de la campaña, el cargo SÍ se pisa: la base de usuarios es su
   * única fuente —en el perfil ni siquiera se puede editar— y una carga nueva
   * es exactamente el momento en que alguien cambió de puesto.
   */
  jobTitle: string
  status: RowStatus
  include: boolean
  /**
   * Qué se le va a hacer a esta persona: crearla, o —si ya existe— actualizarle
   * lo que la base de usuarios manda: la campaña si estaba sin ninguna (nunca se
   * le quita la que ya tenga) y el cargo, que siempre viene de aquí.
   */
  action: 'create' | 'assign'
}

interface BulkImportUsersProps {
  isSuperAdmin: boolean
  campaigns: Campaign[]
  /** La contraseña predeterminada está activada: todos nacerán con la misma. */
  defaultPasswordOn?: boolean
  onClose: () => void
  onImported: () => void | Promise<void>
}

const ROLE_SYNONYMS: Record<string, string> = {
  learner: 'learner', aprendiz: 'learner', alumno: 'learner', estudiante: 'learner',
  capacitador: 'capacitador', trainer: 'capacitador', formador: 'capacitador',
  superadmin: 'superadmin', admin: 'superadmin', administrador: 'superadmin',
}

function normalizeRole(value: string): string | null {
  const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  return ROLE_SYNONYMS[key] ?? null
}

/**
 * Carga masiva de aprendices desde Excel/CSV en tres pasos: **archivo →
 * revisión → resultado**.
 *
 * El paso de revisión es el que importa: antes de tocar producción muestra fila
 * por fila cómo va a quedar cada persona (correo, nombre final, rol, campaña y
 * con qué contraseña nace), marca las que ya tienen cuenta consultando al
 * servidor sin crear nada, y deja corregir a mano el mapeo de columnas cuando el
 * archivo no viene con la plantilla. La creación la hace la Edge Function
 * `create-users-bulk`, que es quien impone la autorización: el superadmin crea
 * cualquier rol en cualquier campaña; el capacitador SOLO aprendices y solo en
 * las campañas que son suyas.
 */
export function BulkImportUsers({ isSuperAdmin, campaigns, defaultPasswordOn = false, onClose, onImported }: BulkImportUsersProps) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)

  // El rol solo lo elige el superadmin; la campaña la elige cualquiera que
  // tenga más de una, y para el capacitador es obligatoria (el servidor rechaza
  // un alta sin campaña).
  const canChooseRole = isSuperAdmin
  const campaignRequired = !isSuperAdmin

  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  /* Archivo interpretado: TODAS las hojas, cada una con su propio mapeo.
   *
   * Antes se importaba la hoja que el modal eligiera y las demás se quedaban
   * fuera sin que nada lo dijera. Con la base maestra —partida en ARGENTINA,
   * MEXICO y COLOMBIA— eso es cargar un tercio de la empresa y creer que se
   * cargó entera. Cada hoja trae su mapeo porque sus encabezados pueden empezar
   * en filas distintas. */
  const [grids, setGrids] = useState<SheetGrid[]>([])
  const [plans, setPlans] = useState<Record<string, SheetPlan>>({})
  /** Hoja cuyas columnas se están ajustando a mano. */
  const [tuning, setTuning] = useState('')

  // Ajustes que aplican a las filas sin valor propio. El capacitador arranca en
  // la campaña donde está parado el panel, y solo puede moverse entre las suyas.
  const [roleDefault, setRoleDefault] = useState('learner')
  // País para las filas que no traen uno propio (o cuyo valor no se reconoce).
  const [countryDefault, setCountryDefault] = useState('')
  const [campaignDefault, setCampaignDefault] = useState(() =>
    isSuperAdmin ? '' : resolveCreationCampaignId(null, campaigns.map((c) => c.id)),
  )

  // El catálogo cerrado de operaciones y áreas, para casar lo que trae la
  // nómina. Si está vacío (nadie ha creado unidades todavía) las dos columnas
  // simplemente no clasifican a nadie y se avisa: es mejor que fingir que sí.
  const [units, setUnits] = useState<OrgUnit[]>([])

  // Correcciones manuales del usuario en la tabla de revisión
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({})
  const [excluded, setExcluded] = useState<Record<string, boolean>>({})

  // Verificación contra el sitio (no crea nada)
  const [existing, setExisting] = useState<Set<string>>(new Set())
  // De los que ya existen, los que quedaron SIN campaña: son los únicos a los
  // que esta carga puede completarles la campaña.
  const [noCampaign, setNoCampaign] = useState<Set<string>>(new Set())
  // El servidor contestó la vista previa pero sin la lista de "sin campaña":
  // función desplegada anterior a este soporte. Se avisa en vez de ofrecer un
  // botón que no haría nada.
  const [fillUnsupported, setFillUnsupported] = useState(false)
  // Completar la campaña de quienes ya existen y no tienen ninguna.
  const [fillCampaign, setFillCampaign] = useState(false)
  /* Actualizar el cargo de quien ya existe. Nace ENCENDIDO —al revés que
     `fillCampaign`— porque es justo para lo que se recarga la base maestra: la
     gente cambia de puesto y el perfil no deja corregirlo a mano. */
  const [syncJobs, setSyncJobs] = useState(true)
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'done' | 'unavailable'>('idle')

  const [processing, setProcessing] = useState(false)
  /** Avance del alta por tandas: cuántas filas ya contestó el servidor. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<RowResult[] | null>(null)
  // Lo confirma el servidor: es él quien decide si aplicó la predeterminada.
  const [usedDefaultPwd, setUsedDefaultPwd] = useState(false)
  // Se pidió país y el servidor no confirmó ninguno: la función desplegada es
  // anterior a este soporte. Se avisa en vez de dar por hecho que se guardó.
  const [countryIgnored, setCountryIgnored] = useState(false)
  const [defaultPwdValue, setDefaultPwdValue] = useState('')

  // El catálogo se pide una vez al abrir. Si el SQL de la reestructura no se ha
  // corrido, `getOrgUnits` devuelve vacío y todo esto se comporta como antes.
  useEffect(() => {
    let alive = true
    getOrganizations()
      .then((orgs) => (orgs[0] ? getOrgUnits(orgs[0].id) : []))
      .then((list) => { if (alive) setUnits(list) })
      .catch(() => { if (alive) setUnits([]) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!defaultPasswordOn) return
    getDefaultPassword()
      .then((s) => setDefaultPwdValue(s?.enabled ? s.password : ''))
      .catch(() => setDefaultPwdValue(''))
  }, [defaultPasswordOn])

  const campaignByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of campaigns) m.set(c.name.trim().toLowerCase(), c.id)
    return m
  }, [campaigns])

  const campaignNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of campaigns) m.set(c.id, c.name)
    return m
  }, [campaigns])

  const grid = grids.find((g) => g.name === tuning)
  const plan = plans[tuning]
  const mapping = plan?.mapping ?? {
    email: NONE, name: NONE, role: NONE, campaign: NONE, country: NONE,
    operation: NONE, area: NONE,
  }
  const hasHeader = plan?.hasHeader ?? true
  const headerRow = plan?.headerRow ?? 0

  /** Las hojas que entran en la carga, en el orden del libro. */
  const activeSheets = useMemo(
    () => grids.filter((g) => plans[g.name]?.include).map((g) => g.name),
    [grids, plans],
  )

  /* ── Verificación contra el sitio (vista previa: no crea nada) ─────────── */

  const verify = useCallback(async (emails: string[]) => {
    if (emails.length === 0) return
    setCheckState('checking')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const found = new Set<string>()
      const blank = new Set<string>()
      let unsupported = false
      // Igual que el alta: por tandas, porque la función solo mira 200 correos
      // por llamada. Antes se cortaba en 200 y el resto salía como "nuevo"
      // aunque ya tuviera cuenta.
      for (const batch of chunk(emails, MAX_ROWS)) {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-users-bulk`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            // Sin `rows` a propósito: una versión vieja de la función responde 400
            // en vez de crear usuarios sin querer.
            body: JSON.stringify({ preview: true, emails: batch }),
          },
        )
        const json = await res.json()
        if (!res.ok || json?.preview !== true) {
          setCheckState('unavailable')
          return
        }
        for (const mail of (json.existing ?? []) as string[]) found.add(mail)
        if (Array.isArray(json.noCampaign)) {
          for (const mail of json.noCampaign as string[]) blank.add(mail)
        } else {
          unsupported = true
        }
      }
      setExisting(found)
      setNoCampaign(blank)
      setFillUnsupported(unsupported)
      setCheckState('done')
    } catch {
      setCheckState('unavailable')
    }
  }, [])

  /**
   * Verifica usando el mapeo que se acaba de elegir. Se dispara desde los
   * eventos (cargar archivo, cambiar de hoja, corregir columnas) y no desde un
   * efecto: un efecto se lanzaría también con cada tecleo en los nombres.
   */
  const verifyWith = useCallback(
    (gs: SheetGrid[], ps: Record<string, SheetPlan>) => {
      const { rows } = extractAllSheets(gs, {
        only: gs.filter((g) => ps[g.name]?.include).map((g) => g.name),
        mappingBySheet: Object.fromEntries(
          Object.entries(ps).map(([name, pl]) => [
            name,
            { headerRow: pl.hasHeader ? pl.headerRow : -1, mapping: pl.mapping },
          ]),
        ),
      })
      const emails = rows.filter((r) => r.issue === 'ok').map((r) => r.email)
      if (emails.length > 0) verify(emails)
    },
    [verify],
  )

  /* ── Lectura del archivo ───────────────────────────────────────────────── */

  const handleFile = useCallback(async (file: File) => {
    setFatalError(null)
    setResults(null)
    setFileName(file.name)
    setReading(true)
    setNameEdits({})
    setExcluded({})
    setExisting(new Set())
    setCheckState('idle')
    try {
      const parsed = await readGrids(file)
      if (parsed.length === 0) {
        setGrids([])
        setFatalError(t('admin.users.bulk_empty_file'))
        return
      }
      /* TODAS las hojas que traigan correos. Las que no (portadas, resúmenes)
       * entran desmarcadas: no son gente, y marcarlas obligaría a desmarcarlas
       * una por una. */
      const next: Record<string, SheetPlan> = {}
      for (const g of parsed) {
        const a = analyzeGrid(g.rows)
        next[g.name] = {
          include: a.emailCount > 0,
          hasHeader: a.headerRow >= 0,
          headerRow: a.headerRow,
          mapping: a.mapping,
        }
      }
      // Si ninguna convence, se abre la primera para poder mapearla a mano en
      // vez de dejar la pantalla vacía sin explicación.
      if (!Object.values(next).some((x) => x.include) && parsed[0]) {
        next[parsed[0].name].include = true
      }
      setGrids(parsed)
      setPlans(next)
      setTuning(parsed.find((g) => next[g.name].include)?.name ?? parsed[0].name)
      setStep('review')
      verifyWith(parsed, next)
    } catch {
      setGrids([])
      setFatalError(t('admin.users.bulk_unreadable'))
    } finally {
      setReading(false)
    }
  }, [t, verifyWith])

  // Arrastrar y soltar: comportamiento único del sitio (sin parpadeo al pasar
  // sobre los hijos y aviso claro si el archivo no es una hoja de cálculo).
  const { dragging, dropProps } = useFileDrop({
    accept: '.xlsx,.xls,.csv',
    disabled: reading,
    onFiles: (files) => void handleFile(files[0]),
    onReject: (name) => toast.error(t('common.drop_invalid', { name })),
  })

  /** Aplica un cambio al plan de UNA hoja y revalida el conjunto. */
  const patchPlan = (sheet: string, patch: Partial<SheetPlan>, revalidar = false) => {
    const next = plans[sheet] ? { ...plans, [sheet]: { ...plans[sheet], ...patch } } : plans
    setPlans(next)
    if (revalidar) {
      setExisting(new Set())
      verifyWith(grids, next)
    }
  }

  /** Entra o sale una hoja entera de la carga. */
  const toggleSheet = (name: string, include: boolean) => {
    setNameEdits({})
    setExcluded({})
    if (include) setTuning(name)
    patchPlan(name, { include }, true)
  }

  /** Cambiar el mapeo cambia qué correos hay: se vuelve a verificar. */
  const changeMapping = (patch: Partial<ColumnMapping>) => {
    patchPlan(tuning, { mapping: { ...mapping, ...patch } }, patch.email !== undefined)
  }

  const changeHasHeader = (checked: boolean) => {
    patchPlan(
      tuning,
      { hasHeader: checked, headerRow: checked && headerRow < 0 ? 0 : headerRow },
      true,
    )
  }

  /* ── Filas resueltas ───────────────────────────────────────────────────── */

  const { rows: extracted, bySheet } = useMemo(() => {
    if (grids.length === 0) return { rows: [] as ExtractedRow[], bySheet: [] }
    return extractAllSheets(grids, {
      only: activeSheets,
      mappingBySheet: Object.fromEntries(
        Object.entries(plans).map(([name, pl]) => [
          name,
          { headerRow: pl.hasHeader ? pl.headerRow : -1, mapping: pl.mapping },
        ]),
      ),
    })
  }, [grids, plans, activeSheets])

  /**
   * Unidades por nombre plegado (sin tildes ni mayúsculas): "TALENTO HUMANO",
   * "Talento Humano" y "talento humano" son la misma área. Nadie escribe las
   * tildes igual dos veces en un Excel.
   */
  const unitsByName = useMemo(
    () => ({ ops: indexUnits(units, 'operation'), areas: indexUnits(units, 'area') }),
    [units],
  )

  const rows: PreviewRow[] = useMemo(() => {
    return extracted.map((r, i) => {
      // La hoja entra en la clave: con tres hojas, la fila 12 existe tres veces
      // y sin esto React reusaría la misma fila para tres personas distintas.
      const key = `${r.sheet}:${r.sourceLine}:${r.email || `x${i}`}`
      const status: RowStatus =
        r.issue === 'invalid' ? 'invalid'
        : r.issue === 'duplicate' ? 'duplicate'
        : existing.has(r.email) ? 'exists'
        : 'new'
      const editedName = nameEdits[key]
      const nameFromFile = editedName !== undefined ? editedName.trim() !== '' : r.name.trim() !== ''
      const rowRole = canChooseRole ? (normalizeRole(r.role) ?? roleDefault) : 'learner'
      // La campaña del archivo solo vale si es una de las accesibles: para el
      // capacitador, `campaignByName` ya son únicamente las suyas.
      const rowCampaign =
        campaignByName.get(r.campaign.trim().toLowerCase()) ?? (campaignDefault || null)
      // El país del archivo manda; el predeterminado solo rellena lo que falta.
      const rowCountry = r.country || countryDefault
      // Operación y área: se casan contra el catálogo por nombre. Lo que no
      // casa NO crea nada — queda sin clasificar y se muestra en ámbar.
      const opHit = findUnit(unitsByName.ops, r.operationRaw)
      const areaHit = findUnit(unitsByName.areas, r.areaRaw)
      // Ya existe, quedó sin campaña y hay una campaña que darle: en vez de
      // saltarla, esta fila le completa la campaña. Al que ya tiene una no se
      // le toca (ni siquiera aparece como candidato).
      const canFill =
        status === 'exists' && fillCampaign && noCampaign.has(r.email) && !!rowCampaign
      // El cargo del archivo. Es lo único que se actualiza a quien ya existe
      // TENGA O NO campaña: el archivo es la base maestra de cargos.
      const rowJobTitle = syncJobs ? r.jobTitleRaw.trim() : ''
      const canSyncJob = status === 'exists' && !!rowJobTitle
      // Ya existe y hay algo que traerle de la base: en vez de saltarla, esta
      // fila lo actualiza.
      const updatesExisting = canFill || canSyncJob
      const isNew = status === 'new'
      return {
        key,
        sourceLine: r.sourceLine,
        sheet: r.sheet,
        email: r.email,
        raw: r.raw,
        name: finalDisplayName(editedName ?? r.name, r.email),
        nameFromFile,
        role: rowRole,
        campaignId: rowCampaign,
        country: rowCountry,
        countryUnknown: !r.country && r.countryRaw.trim() ? r.countryRaw.trim() : '',
        operationId: opHit?.id ?? '',
        areaId: areaHit?.id ?? '',
        operationName: opHit?.name ?? '',
        areaName: areaHit?.name ?? '',
        operationUnknown: !opHit && r.operationRaw ? r.operationRaw : '',
        areaUnknown: !areaHit && r.areaRaw ? r.areaRaw : '',
        jobTitle: isNew ? r.jobTitleRaw.trim() : rowJobTitle,
        status,
        // Sin campaña, el servidor rechazaría el ALTA del capacitador: se marca
        // como no incluible en vez de dejar que falle fila por fila. A quien ya
        // existe no le hace falta ninguna campaña para corregirle el cargo, así
        // que ese requisito no le aplica.
        include: excluded[key]
          ? false
          : isNew
            ? !(campaignRequired && !rowCampaign)
            : updatesExisting,
        action: isNew ? 'create' : 'assign',
      }
    })
  }, [extracted, existing, noCampaign, fillCampaign, syncJobs, nameEdits, excluded, canChooseRole, campaignRequired, roleDefault, campaignDefault, countryDefault, campaignByName, unitsByName])

  const counts = useMemo(() => {
    const c = { new: 0, exists: 0, duplicate: 0, invalid: 0, excluded: 0 }
    for (const r of rows) {
      c[r.status]++
      if (r.status === 'new' && !r.include) c.excluded++
    }
    return c
  }, [rows])

  // Cuántos de los que ya existen quedaron sin campaña: es el número que decide
  // si vale la pena ofrecer el "completar campaña".
  const fillable = useMemo(
    () => rows.filter((r) => r.status === 'exists' && noCampaign.has(r.email)).length,
    [rows, noCampaign],
  )
  const toAssign = useMemo(() => rows.filter((r) => r.include && r.action === 'assign').length, [rows])
  /** Gente que ya existe y a la que el archivo le trae cargo. */
  const syncableJobs = useMemo(
    () => rows.filter((r) => r.status === 'exists' && r.jobTitle).length,
    [rows],
  )
  const toCreate = useMemo(() => rows.filter((r) => r.include && r.action === 'create').length, [rows])

  const selected = useMemo(() => rows.filter((r) => r.include), [rows])
  // El superadmin no tiene tope: el archivo se manda por tandas.
  const tooMany = !isSuperAdmin && selected.length > MAX_ROWS
  // Filas que se van a crear con un país escrito en el archivo que no se pudo
  // interpretar: se avisa una vez, no fila por fila.
  const unknownCountries = useMemo(
    () => selected.filter((r) => !r.country && r.countryUnknown).length,
    [selected],
  )
  /**
   * Nombres de operación y área que el archivo trae y el catálogo no tiene.
   * Se listan por NOMBRE, no por número de filas: lo accionable es "falta crear
   * el área Calidad", no "hay 37 filas raras". Con el nombre a la vista, el
   * superadmin la crea en /admin/units y se vuelve a cargar.
   */
  const unknownUnits = useMemo(() => {
    const ops = new Set<string>()
    const areas = new Set<string>()
    for (const r of selected) {
      if (r.operationUnknown) ops.add(r.operationUnknown)
      if (r.areaUnknown) areas.add(r.areaUnknown)
    }
    return [...ops, ...areas].sort((a, b) => a.localeCompare(b, 'es'))
  }, [selected])
  // Las columnas solo aparecen si el archivo trae ese eje mapeado. Una columna
  // de guiones no informa: estorba.
  const showOperation = (mapping.operation ?? NONE) >= 0
  const showArea = (mapping.area ?? NONE) >= 0

  /** Cuánta gente de esta carga quedaría sin clasificar del todo. */
  const unclassified = useMemo(
    () => selected.filter((r) => r.action === 'create' && (!r.operationId || !r.areaId)).length,
    [selected],
  )

  /* ── Acciones ──────────────────────────────────────────────────────────── */

  const downloadTemplate = () => {
    // El país acepta el nombre ("Colombia") o el código ISO ("CO"): la plantilla
    // muestra las dos formas para que ninguna parezca la única válida.
    // Operación y área van con ejemplos tomados del catálogo REAL cuando lo hay:
    // así la plantilla enseña los nombres exactos que van a casar, en vez de
    // inventar unos que luego saldrían en ámbar.
    const sampleOp = units.find((u) => u.kind === 'operation')?.name ?? 'Bradescard'
    const sampleArea = units.find((u) => u.kind === 'area')?.name ?? 'Talento Humano'
    const ws = XLSX.utils.aoa_to_sheet([
      ['email', 'display_name', 'cargo', 'pais', 'operacion', 'area'],
      ['ana@ejemplo.com', 'Ana Pérez', 'Asesor comercial', 'Colombia', sampleOp, sampleArea],
      ['juan@ejemplo.com', 'Juan Gómez', 'Coordinador de calidad', 'MX', sampleOp, sampleArea],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'usuarios')
    XLSX.writeFile(wb, 'plantilla-usuarios.xlsx')
  }

  const process = async () => {
    if (selected.length === 0 || tooMany) return
    setProcessing(true)
    setProgress({ done: 0, total: selected.length })
    const payload = selected.map((r) =>
      r.action === 'assign'
        // A quien ya existe solo se le toca lo que la base maestra manda: la
        // campaña (si estaba sin ninguna) y el cargo. Ni el nombre, ni el rol,
        // ni el país, ni la contraseña.
        //
        // `mode` sigue llamándose 'assign_campaign' a propósito: una función de
        // borde todavía sin desplegar ignora `job_title` y se comporta como
        // siempre, en vez de no reconocer el modo y caer al camino de ALTA
        // intentando crear cuentas que ya existen.
        ? {
            email: r.email,
            campaign: r.campaignId ?? undefined,
            job_title: r.jobTitle || undefined,
            mode: 'assign_campaign' as const,
          }
        : {
            email: r.email,
            display_name: r.name,
            role: r.role,
            campaign: r.campaignId ?? undefined,
            country: r.country || undefined,
            operation_id: r.operationId || undefined,
            area_id: r.areaId || undefined,
            job_title: r.jobTitle || undefined,
          },
    )
    // Lo que ya contestó el servidor. Vive fuera del try: si una tanda se cae,
    // igual mostramos (y se pueden descargar) las credenciales de las que sí
    // alcanzaron a crearse. En producción eso es la diferencia entre repetir la
    // carga completa y seguir desde donde iba.
    const rowResults: RowResult[] = []
    let usedDefault = false
    let failure: string | null = null

    try {
      const { data: { session } } = await supabase.auth.getSession()
      for (const batch of chunk(payload, BATCH_SIZE)) {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-users-bulk`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ rows: batch }),
          },
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Error')
        rowResults.push(...((json.results ?? []) as RowResult[]))
        if (json.defaultPassword === true) usedDefault = true
        setProgress({ done: rowResults.length, total: payload.length })
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : t('admin.courses.error_save')
    }

    setProcessing(false)
    setProgress(null)

    if (rowResults.length === 0) {
      toast.error(failure ?? t('admin.courses.error_save'))
      return
    }

    setResults(rowResults)
    setUsedDefaultPwd(usedDefault)
    const wantedCountry = selected.filter((r) => r.action === 'create' && r.country).length
    const appliedCountry = rowResults.filter((r) => r.status === 'created' && r.country).length
    setCountryIgnored(wantedCountry > 0 && appliedCountry === 0)
    setStep('result')
    const created = rowResults.filter((r) => r.status === 'created').length
    if (failure) {
      // Se cortó a mitad de camino: decirlo con el número exacto, no un "listo".
      toast.error(t('admin.users.bulk_partial', {
        done: rowResults.length,
        total: payload.length,
        error: failure,
      }))
    } else {
      const filled = rowResults.filter((r) => r.status === 'updated').length
      toast.success(
        filled > 0
          ? `${t('admin.users.bulk_done', { created, total: rowResults.length })} ${t('admin.users.bulk_done_filled', { n: filled })}`
          : t('admin.users.bulk_done', { created, total: rowResults.length }),
      )
    }
    await onImported()
  }

  const downloadCredentials = () => {
    if (!results) return
    const created = results.filter((r) => r.status === 'created')
    const aoa = [
      ['site', 'email', 'password'],
      ...created.map((r) => [SITE_URL, r.email, r.password ?? '']),
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'credenciales')

    // Segunda hoja con lo que no se creó y por qué. En una carga de cientos de
    // personas es lo que permite rehacer solo las que faltan.
    const failed = results.filter((r) => r.status === 'error')
    if (failed.length > 0) {
      const errAoa = [
        ['email', 'motivo'],
        ...failed.map((r) => [
          r.email,
          isAlreadyRegistered(r.reason) ? t('admin.users.bulk_reason_exists') : (r.reason ?? ''),
        ]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(errAoa), 'no creados')
    }
    XLSX.writeFile(wb, 'credenciales-usuarios.xlsx')
  }

  const copyCredentials = async () => {
    if (!results) return
    const created = results.filter((r) => r.status === 'created')
    const text = created.map((r) => `${SITE_URL}\t${r.email}\t${r.password ?? ''}`).join('\n')
    await navigator.clipboard.writeText(text)
    toast.success(t('admin.users.bulk_copied'))
  }

  const restart = () => {
    setStep('file')
    setGrids([])
    setFileName('')
    setResults(null)
    setNameEdits({})
    setExcluded({})
    setExisting(new Set())
    setNoCampaign(new Set())
    setFillCampaign(false)
    setFillUnsupported(false)
    setCheckState('idle')
  }

  const createdCount = results?.filter((r) => r.status === 'created').length ?? 0
  const updatedCount = results?.filter((r) => r.status === 'updated').length ?? 0

  /* ── Piezas de interfaz ────────────────────────────────────────────────── */

  const columnOptions = useMemo(() => {
    const cols = grid ? analyzeColumns(grid, hasHeader ? headerRow : -1) : []
    return [
      { value: String(NONE), label: t('admin.users.bulk_col_none') },
      ...cols.map((label, i) => ({ value: String(i), label })),
    ]
  }, [grid, hasHeader, headerRow, t])

  const stepper = (
    <div className="flex items-center gap-2 text-[11px] text-text-subtle">
      {(['file', 'review', 'result'] as Step[]).map((s, i) => {
        const active = step === s
        const done = (['file', 'review', 'result'] as Step[]).indexOf(step) > i
        return (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-4 bg-line" />}
            <span
              className={`flex items-center gap-1.5 ${active ? 'text-text font-medium' : done ? 'text-text-muted' : ''}`}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold"
                style={
                  active ? { background: '#10D451', color: '#000' }
                  : done ? { background: 'rgba(16,212,81,.18)', color: '#10D451' }
                  : { background: 'var(--surface-subtle, rgba(127,127,127,.16))' }
                }
              >
                {done ? '✓' : i + 1}
              </span>
              {t(`admin.users.bulk_step_${s}`)}
            </span>
          </div>
        )
      })}
    </div>
  )

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={`relative w-full ${step === 'file' ? 'max-w-lg' : 'max-w-4xl'}`}
        >
          <div className="relative flex max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 space-y-2">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <FileSpreadsheet className="h-4 w-4 text-text-muted" />
                  {t('admin.users.bulk_title')}
                </h3>
                {stepper}
              </div>
              <button
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {step === 'file' && (
                <div className="space-y-4">
                  <p className="text-[13px] text-text-muted">
                    {defaultPasswordOn ? t('admin.users.bulk_help_default_pwd') : t('admin.users.bulk_help')}
                  </p>

                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleFile(f)
                      e.target.value = ''
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    {...dropProps}
                    className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors"
                    style={{
                      borderColor: dragging ? '#10D451' : 'var(--line, rgba(127,127,127,.28))',
                      background: dragging ? 'rgba(16,212,81,.07)' : undefined,
                    }}
                  >
                    {reading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                    ) : (
                      <Upload className="h-6 w-6 text-text-muted" />
                    )}
                    <span className="text-[14px] font-medium text-text">
                      {reading ? t('admin.users.bulk_reading') : t('admin.users.bulk_drop_title')}
                    </span>
                    <span className="text-[12px] text-text-subtle">{t('admin.users.bulk_drop_hint')}</span>
                  </button>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] text-text-subtle">{t('admin.users.bulk_no_write_hint')}</p>
                    <button
                      onClick={downloadTemplate}
                      className="flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-text-muted hover:text-text"
                    >
                      <Download className="h-4 w-4" />
                      {t('admin.users.bulk_template')}
                    </button>
                  </div>

                  {fatalError && (
                    <p className="flex items-center gap-2 text-[13px] text-red-500">
                      <AlertCircle className="h-4 w-4 shrink-0" /> {fatalError}
                    </p>
                  )}
                </div>
              )}

              {step === 'review' && grid && (
                <div className="space-y-4">
                  {/* Archivo + mapeo */}
                  <div className="rounded-xl border border-line bg-subtle/60 p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-[12px] text-text-muted">
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        <span className="font-mono text-text">{fileName}</span>
                        <span className="text-text-subtle">
                          · {t('admin.users.bulk_rows_read', { n: extracted.length })}
                        </span>
                      </p>
                      <button
                        onClick={restart}
                        className="flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-text-muted hover:text-text"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        {t('admin.users.bulk_change_file')}
                      </button>
                    </div>

                    {/* TODAS las hojas del libro. La base maestra viene partida
                        por país: si una se queda fuera hay que verlo aquí, no
                        descubrirlo cuando falte un tercio de la empresa. */}
                    {grids.length > 1 && (
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-subtle">
                          <Layers className="h-3.5 w-3.5" />
                          {t('admin.hr.sheets_title', { n: grids.length })}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {grids.map((g) => {
                            const on = plans[g.name]?.include ?? false
                            const stat = bySheet.find((x) => x.sheet === g.name)
                            return (
                              <label
                                key={g.name}
                                className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors"
                                style={{
                                  borderColor: on ? '#10D451' : 'var(--line, rgba(127,127,127,.28))',
                                  background: on ? 'rgba(16,212,81,.08)' : undefined,
                                  color: on ? 'var(--text)' : 'var(--text-muted)',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(ev) => toggleSheet(g.name, ev.target.checked)}
                                  className="h-4 w-4 accent-[#10D451]"
                                />
                                <span className="font-medium">{g.name}</span>
                                <span className="tabular-nums text-text-subtle">
                                  {on && stat
                                    ? t('admin.hr.sheet_rows', { n: stat.rows })
                                    : t('admin.hr.sheet_off')}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {grids.length > 1 && (
                        <Field label={t('admin.hr.tuning_sheet')}>
                          <Select
                            compact
                            value={tuning}
                            onChange={setTuning}
                            options={grids.map((g) => ({
                              value: g.name,
                              label: plans[g.name]?.include ? g.name : g.name + ' - ' + t('admin.hr.sheet_off'),
                            }))}
                          />
                        </Field>
                      )}
                      <Field label={t('admin.users.bulk_map_email')} required>
                        <Select
                          compact
                          value={String(mapping.email)}
                          onChange={(v) => changeMapping({ email: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      <Field label={t('admin.users.bulk_map_name')}>
                        <Select
                          compact
                          value={String(mapping.name)}
                          onChange={(v) => changeMapping({ name: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      <Field label={t('admin.users.bulk_map_country')}>
                        <Select
                          compact
                          value={String(mapping.country ?? NONE)}
                          onChange={(v) => changeMapping({ country: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      {/* Operación y área solo se ofrecen si hay catálogo: sin
                          unidades creadas, mapear la columna no clasificaría a
                          nadie y sería un control que miente. */}
                      {units.some((u) => u.kind === 'operation') && (
                        <Field label={t('admin.users.bulk_map_operation', 'Operación')}>
                          <Select
                            compact
                            value={String(mapping.operation ?? NONE)}
                            onChange={(v) => changeMapping({ operation: Number(v) })}
                            options={columnOptions}
                          />
                        </Field>
                      )}
                      {units.some((u) => u.kind === 'area') && (
                        <Field label={t('admin.users.bulk_map_area', 'Área')}>
                          <Select
                            compact
                            value={String(mapping.area ?? NONE)}
                            onChange={(v) => changeMapping({ area: Number(v) })}
                            options={columnOptions}
                          />
                        </Field>
                      )}
                      <Field label={t('admin.users.bulk_country_all')}>
                        <Select
                          compact
                          value={countryDefault}
                          onChange={setCountryDefault}
                          placeholder={t('admin.users.bulk_country_none')}
                          options={[
                            { value: '', label: t('admin.users.bulk_country_none') },
                            ...COUNTRY_OPTIONS,
                          ]}
                        />
                      </Field>
                      {canChooseRole && (
                        <Field label={t('admin.users.bulk_role_all')}>
                          <Select
                            compact
                            value={roleDefault}
                            onChange={setRoleDefault}
                            options={[
                              { value: 'learner', label: t('roles.learner') },
                              { value: 'capacitador', label: t('roles.capacitador') },
                              { value: 'superadmin', label: t('roles.superadmin') },
                            ]}
                          />
                        </Field>
                      )}
                      {campaigns.length > 0 && (
                        <Field label={t('admin.users.bulk_campaign_all')} required={campaignRequired}>
                          <Select
                            compact
                            value={campaignDefault}
                            onChange={setCampaignDefault}
                            placeholder={t('admin.users.pick_campaign')}
                            options={[
                              // El capacitador no puede dejarla vacía.
                              ...(campaignRequired
                                ? []
                                : [{ value: '', label: t('admin.users.bulk_campaign_none') }]),
                              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                            ]}
                          />
                        </Field>
                      )}
                    </div>

                    <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] text-text-muted">
                      <input
                        type="checkbox"
                        checked={hasHeader}
                        onChange={(e) => changeHasHeader(e.target.checked)}
                        className="h-4 w-4 accent-[#10D451]"
                      />
                      {t('admin.users.bulk_has_header')}
                      {hasHeader && headerRow > 0 && (
                        <span className="text-text-subtle">
                          {t('admin.users.bulk_header_at', { n: headerRow + 1 })}
                        </span>
                      )}
                    </label>
                  </div>

                  {mapping.email === NONE ? (
                    <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="flex items-center gap-2 text-[13px] text-amber-500">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('admin.users.bulk_pick_email_col')}
                      </p>
                      <RawPreview grid={grid} />
                    </div>
                  ) : (
                    <>
                      {/* Resumen */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone="ok" label={t('admin.users.bulk_sum_new', { n: counts.new - counts.excluded })} />
                        {counts.exists > 0 && (
                          <Chip tone="warn" label={t('admin.users.bulk_sum_exists', { n: counts.exists })} />
                        )}
                        {counts.duplicate > 0 && (
                          <Chip tone="muted" label={t('admin.users.bulk_sum_dup', { n: counts.duplicate })} />
                        )}
                        {counts.invalid > 0 && (
                          <Chip tone="bad" label={t('admin.users.bulk_sum_invalid', { n: counts.invalid })} />
                        )}
                        {counts.excluded > 0 && (
                          <Chip tone="muted" label={t('admin.users.bulk_sum_excluded', { n: counts.excluded })} />
                        )}
                        {toAssign > 0 && (
                          <Chip tone="ok" label={t('admin.users.bulk_sum_fill', { n: toAssign })} />
                        )}
                        <span className="ml-auto flex items-center gap-2 text-[11px] text-text-subtle">
                          {checkState === 'checking' && (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" /> {t('admin.users.bulk_checking')}
                            </>
                          )}
                          {checkState === 'done' && (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5 text-green-500" /> {t('admin.users.bulk_checked')}
                            </>
                          )}
                          {checkState === 'unavailable' && (
                            <span className="text-amber-500">{t('admin.users.bulk_check_unavailable')}</span>
                          )}
                          {checkState !== 'checking' && (
                            <button
                              onClick={() => verify(extracted.filter((r) => r.issue === 'ok').map((r) => r.email))}
                              className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:text-text"
                              title={t('admin.users.bulk_recheck')}
                            >
                              <RefreshCw className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      </div>

                      {/* Completar la campaña de los que ya existen. Solo
                          aparece cuando de verdad hay a quién: gente con cuenta
                          y sin ninguna campaña. Al que ya tiene una NO se le
                          toca, y eso se dice aquí, no en una nota al pie. */}
                      {fillable > 0 && (
                        <div className="rounded-xl border border-[#10D451]/40 bg-[#10D451]/10 p-3">
                          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-text">
                            <input
                              type="checkbox"
                              checked={fillCampaign}
                              onChange={(e) => setFillCampaign(e.target.checked)}
                              disabled={!campaignDefault}
                              className="mt-0.5 h-4 w-4 accent-[#10D451]"
                            />
                            <span>
                              {t('admin.users.bulk_fill_campaign', { n: fillable })}
                              <span className="mt-0.5 block text-[12px] text-text-muted">
                                {campaignDefault
                                  ? t('admin.users.bulk_fill_campaign_hint', {
                                      campaign: campaignNameById.get(campaignDefault) ?? '',
                                    })
                                  : t('admin.users.bulk_fill_campaign_pick')}
                              </span>
                            </span>
                          </label>
                        </div>
                      )}
                      {/* Actualizar el cargo de quien ya existe. Es el motivo
                          por el que se recarga la base maestra: el cargo no se
                          puede editar en el perfil, así que este archivo es la
                          única vía. Nace encendido, pero a la vista y con el
                          número exacto de personas a las que va a cambiar algo:
                          pisar datos en silencio no. */}
                      {syncableJobs > 0 && (
                        <div className="rounded-xl border border-[#10D451]/40 bg-[#10D451]/10 p-3">
                          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-text">
                            <input
                              type="checkbox"
                              checked={syncJobs}
                              onChange={(e) => setSyncJobs(e.target.checked)}
                              className="mt-0.5 h-4 w-4 accent-[#10D451]"
                            />
                            <span>
                              {t('admin.users.bulk_sync_jobs', { n: syncableJobs })}
                              <span className="mt-0.5 block text-[12px] text-text-muted">
                                {t('admin.users.bulk_sync_jobs_hint')}
                              </span>
                            </span>
                          </label>
                        </div>
                      )}

                      {fillUnsupported && counts.exists > 0 && (
                        <p className="flex items-start gap-2 text-[12px] text-amber-500">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {t('admin.users.bulk_fill_unsupported')}
                        </p>
                      )}

                      {/* Tabla de revisión */}
                      <div className="overflow-hidden rounded-xl border border-line">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[840px] text-left text-[12px]">
                            <thead>
                              <tr className="bg-subtle text-[11px] uppercase tracking-wider text-text-muted">
                                <th className="w-10 px-3 py-2" />
                                <th className="w-10 px-1 py-2 text-right font-normal">#</th>
                                {grids.length > 1 && (
                                  <th className="px-3 py-2 font-normal">{t('admin.hr.col_sheet')}</th>
                                )}
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_email')}</th>
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_name')}</th>
                                {canChooseRole && (
                                  <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_role')}</th>
                                )}
                                {campaigns.length > 0 && (
                                  <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_campaign')}</th>
                                )}
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_country')}</th>
                                {showOperation && (
                                  <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_operation', 'Operación')}</th>
                                )}
                                {showArea && (
                                  <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_area', 'Área')}</th>
                                )}
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_password')}</th>
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_status')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {rows.map((r) => (
                                <tr
                                  key={r.key}
                                  className={r.include ? '' : 'opacity-55'}
                                >
                                  <td className="px-3 py-2">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 accent-[#10D451]"
                                      checked={r.include}
                                      disabled={r.status !== 'new' && r.action !== 'assign'}
                                      onChange={(e) =>
                                        setExcluded((prev) => ({ ...prev, [r.key]: !e.target.checked }))
                                      }
                                      aria-label={t('admin.users.bulk_include')}
                                    />
                                  </td>
                                  <td className="px-1 py-2 text-right text-text-subtle">{r.sourceLine}</td>
                                  {grids.length > 1 && (
                                    <td className="max-w-[110px] truncate px-3 py-2 text-text-subtle">
                                      {r.sheet || '—'}
                                    </td>
                                  )}
                                  <td className="max-w-[220px] truncate px-3 py-2 text-text">
                                    {r.email || <span className="text-red-500">{r.raw || '—'}</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    {r.email ? (
                                      <span className="flex items-center gap-1.5">
                                        <input
                                          value={nameEdits[r.key] ?? r.name}
                                          onChange={(e) =>
                                            setNameEdits((prev) => ({ ...prev, [r.key]: e.target.value }))
                                          }
                                          className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-text hover:border-line focus:border-line focus:outline-none"
                                        />
                                        {!r.nameFromFile && (
                                          <span
                                            className="shrink-0 text-text-subtle"
                                            title={t('admin.users.bulk_name_auto')}
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      <span className="text-text-subtle">—</span>
                                    )}
                                  </td>
                                  {canChooseRole && (
                                    <td className="px-3 py-2 text-text-muted">{t(`roles.${r.role}`)}</td>
                                  )}
                                  {campaigns.length > 0 && (
                                    <td className="max-w-[140px] truncate px-3 py-2 text-text-muted">
                                      {r.campaignId ? (
                                        campaignNameById.get(r.campaignId) ?? '—'
                                      ) : campaignRequired ? (
                                        <span className="text-amber-500">
                                          {t('admin.users.bulk_campaign_missing')}
                                        </span>
                                      ) : (
                                        t('admin.users.bulk_campaign_none')
                                      )}
                                    </td>
                                  )}
                                  <td className="max-w-[150px] truncate px-3 py-2 text-text-muted">
                                    {r.country ? (
                                      countryLabelWithFlag(r.country)
                                    ) : r.countryUnknown ? (
                                      <span
                                        className="text-amber-500"
                                        title={t('admin.users.bulk_country_unknown', { value: r.countryUnknown })}
                                      >
                                        {r.countryUnknown}
                                      </span>
                                    ) : (
                                      <span className="text-text-subtle">—</span>
                                    )}
                                  </td>
                                  {showOperation && (
                                    <UnitCell
                                      name={r.operationName}
                                      unknown={r.operationUnknown}
                                      unknownTitle={t('admin.users.bulk_unit_unknown', {
                                        value: r.operationUnknown,
                                        defaultValue: '"{{value}}" no está en el catálogo: la persona quedará sin clasificar.',
                                      })}
                                    />
                                  )}
                                  {showArea && (
                                    <UnitCell
                                      name={r.areaName}
                                      unknown={r.areaUnknown}
                                      unknownTitle={t('admin.users.bulk_unit_unknown', {
                                        value: r.areaUnknown,
                                        defaultValue: '"{{value}}" no está en el catálogo: la persona quedará sin clasificar.',
                                      })}
                                    />
                                  )}
                                  <td className="px-3 py-2 font-mono text-text-muted">
                                    {defaultPasswordOn
                                      ? defaultPwdValue || t('admin.users.bulk_pwd_default')
                                      : t('admin.users.bulk_pwd_temp')}
                                  </td>
                                  <td className="px-3 py-2">
                                    <StatusBadge status={r.status} include={r.include} action={r.action} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {unknownCountries > 0 && (
                        <p className="flex items-center gap-2 text-[12px] text-amber-500">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          {t('admin.users.bulk_country_unknown_hint', { n: unknownCountries })}
                        </p>
                      )}

                      {/* Lo que el catálogo no tiene. Se listan los NOMBRES
                          porque es lo accionable: el superadmin los crea en
                          Operaciones y áreas y se vuelve a cargar el archivo.
                          No se crean solos a propósito — el catálogo cerrado es
                          justo lo que evita que esto se vuelva a desordenar. */}
                      {unknownUnits.length > 0 && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                          <p className="flex items-center gap-2 text-[12px] font-medium text-amber-500">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            {t('admin.users.bulk_units_unknown_title', {
                              n: unknownUnits.length,
                              defaultValue: '{{n}} operación o área del archivo no está en el catálogo',
                            })}
                          </p>
                          <p className="mt-1.5 text-[12px] text-text-muted">
                            {unknownUnits.join(' · ')}
                          </p>
                          <p className="mt-1.5 text-[12px] text-text-muted">
                            {t('admin.users.bulk_units_unknown_hint', {
                              defaultValue: 'Se pueden importar igual, pero esas personas entrarán sin clasificar. Créalas primero en Operaciones y áreas y vuelve a cargar el archivo.',
                            })}
                          </p>
                        </div>
                      )}

                      {/* El número que RH persigue. Solo se muestra cuando el
                          archivo trae al menos un eje: si no, "sin clasificar"
                          sería todo el mundo y el aviso perdería sentido. */}
                      {(showOperation || showArea) && unclassified > 0 && (
                        <p className="flex items-center gap-2 text-[12px] text-text-muted">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                          {t('admin.users.bulk_unclassified_hint', {
                            n: unclassified,
                            defaultValue: '{{n}} persona quedará sin operación o sin área. Se puede corregir después con otra carga.',
                          })}
                        </p>
                      )}

                      {campaignRequired && !campaignDefault && (
                        <p className="flex items-center gap-2 text-[12px] text-amber-500">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          {t('admin.users.bulk_campaign_required')}
                        </p>
                      )}

                      {tooMany && (
                        <p className="flex items-center gap-2 text-[12px] text-red-500">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          {t('admin.users.bulk_max_rows', { n: MAX_ROWS })}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 'result' && results && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-text">
                      {t('admin.users.bulk_done', { created: createdCount, total: results.length })}
                      {updatedCount > 0 && (
                        <span className="block text-[12px] text-text-muted">
                          {t('admin.users.bulk_done_filled', { n: updatedCount })}
                        </span>
                      )}
                    </p>
                    {createdCount > 0 && (
                      <div className="flex gap-2">
                        <button
                          onClick={copyCredentials}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-subtle px-3 py-2 text-[12px] font-medium text-text"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t('admin.users.bulk_copy_creds')}
                        </button>
                        <button
                          onClick={downloadCredentials}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-black"
                          style={{ background: '#10D451' }}
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t('admin.users.bulk_download_creds')}
                        </button>
                      </div>
                    )}
                  </div>
                  {createdCount > 0 && (
                    <p className="text-[12px] text-text-muted">
                      {usedDefaultPwd ? t('admin.users.bulk_creds_hint_default') : t('admin.users.bulk_creds_hint')}
                    </p>
                  )}
                  {/* La vista previa PROMETE la predeterminada (columna de la
                      tabla), así que si el servidor no la aplicó hay que decirlo
                      aquí y ahora: si no, se anuncia una contraseña que ninguna
                      de estas cuentas tiene. */}
                  {createdCount > 0 && defaultPasswordOn && !usedDefaultPwd && (
                    <p className="flex items-start gap-2 text-[12px] text-amber-500">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {t('admin.users.default_pwd_ignored')}
                    </p>
                  )}
                  {countryIgnored && (
                    <p className="flex items-start gap-2 text-[12px] text-amber-500">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {t('admin.users.country_ignored')}
                    </p>
                  )}
                  <div className="overflow-hidden rounded-xl border border-line">
                    <div className="grid grid-cols-[1fr_auto] gap-3 bg-subtle px-3 py-2 text-[11px] uppercase tracking-wider text-text-muted">
                      <span>{t('admin.users.bulk_col_email')}</span>
                      <span>{t('admin.users.bulk_col_status')}</span>
                    </div>
                    <div className="max-h-[40vh] divide-y divide-line overflow-y-auto">
                      {results.map((r, i) => {
                        const existed = r.status === 'error' && isAlreadyRegistered(r.reason)
                        return (
                          <div key={i} className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-2 text-[12px]">
                            <div className="min-w-0">
                              <span className="block truncate text-text">{r.email}</span>
                              {/* El motivo va a la vista, no escondido en un tooltip:
                                  con cientos de filas es la única forma de saber
                                  qué pasó sin ir correo por correo. */}
                              {(r.status === 'error' || r.status === 'skipped') && (
                                <span className="block break-words text-[11px] text-text-subtle">
                                  {existed ? t('admin.users.bulk_reason_exists') : r.reason}
                                </span>
                              )}
                            </div>
                            {r.status === 'created' ? (
                              <span className="flex items-center gap-1 text-green-500">
                                <Check className="h-3.5 w-3.5" /> {t('admin.users.bulk_status_created')}
                              </span>
                            ) : r.status === 'updated' ? (
                              <span className="flex items-center gap-1 text-green-500">
                                <Check className="h-3.5 w-3.5" /> {t('admin.users.bulk_status_filled')}
                              </span>
                            ) : r.status === 'skipped' ? (
                              <span className="flex items-center gap-1 text-text-subtle">
                                {t('admin.users.bulk_status_skipped')}
                              </span>
                            ) : existed ? (
                              <span className="flex items-center gap-1 text-amber-500">
                                <AlertTriangle className="h-3.5 w-3.5" /> {t('admin.users.bulk_status_exists')}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-red-500">
                                <AlertCircle className="h-3.5 w-3.5" /> {t('admin.users.bulk_status_error')}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {step === 'review' && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
                <p className="text-[12px] text-text-muted">
                  {selected.length > 0
                    ? t('admin.users.bulk_footer_summary', { n: selected.length })
                    : t('admin.users.bulk_footer_none')}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="min-h-[44px] rounded-xl bg-subtle px-4 py-2 text-[13px] text-text-muted hover:text-text"
                  >
                    {t('admin.courses.cancel')}
                  </button>
                  <button
                    onClick={process}
                    disabled={processing || selected.length === 0 || tooMany}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50"
                    style={{ background: '#10D451' }}
                  >
                    {processing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {processing
                      ? progress && progress.total > BATCH_SIZE
                        ? t('admin.users.bulk_progress', { done: progress.done, total: progress.total })
                        : t('admin.users.bulk_processing')
                      : toCreate === 0 && toAssign > 0
                        ? t('admin.users.bulk_fill_n', { n: toAssign })
                        : t('admin.users.bulk_create_n', { n: selected.length })}
                  </button>
                </div>
              </div>
            )}

            {step === 'result' && (
              <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
                <button
                  onClick={restart}
                  className="min-h-[44px] rounded-xl bg-subtle px-4 py-2 text-[13px] text-text-muted hover:text-text"
                >
                  {t('admin.users.bulk_import_more')}
                </button>
                <button
                  onClick={onClose}
                  className="min-h-[44px] rounded-xl px-4 py-2 text-[13px] font-medium text-black"
                  style={{ background: '#10D451' }}
                >
                  {t('admin.users.bulk_finish')}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

/* ── Auxiliares de presentación ──────────────────────────────────────────── */

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wider text-text-subtle">
        {label}
        {required && <span className="ml-0.5 text-[#10D451]">*</span>}
      </span>
      {children}
    </label>
  )
}

function Chip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const style =
    tone === 'ok' ? { background: 'rgba(16,212,81,.14)', color: '#10D451' }
    : tone === 'warn' ? { background: 'rgba(245,158,11,.14)', color: '#f59e0b' }
    : tone === 'bad' ? { background: 'rgba(239,68,68,.14)', color: '#ef4444' }
    : undefined
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tone === 'muted' ? 'bg-subtle text-text-muted' : ''}`}
      style={style}
    >
      {label}
    </span>
  )
}

function StatusBadge({
  status,
  include,
  action,
}: { status: RowStatus; include: boolean; action: 'create' | 'assign' }) {
  const { t } = useTranslation()
  // Ya tiene cuenta pero está sin campaña y esta carga se la va a poner: es su
  // propio estado, no un "ya existe" apagado.
  if (action === 'assign') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap" style={{ color: '#10D451' }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
        {t('admin.users.bulk_status_fill')}
      </span>
    )
  }
  if (status === 'new' && !include) {
    return <span className="text-text-subtle">{t('admin.users.bulk_status_skipped')}</span>
  }
  const map = {
    new: { color: '#10D451', label: t('admin.users.bulk_status_new'), cls: '' },
    exists: { color: '#f59e0b', label: t('admin.users.bulk_status_exists'), cls: '' },
    duplicate: { color: undefined, label: t('admin.users.bulk_status_dup'), cls: 'text-text-subtle' },
    invalid: { color: '#ef4444', label: t('admin.users.bulk_status_invalid'), cls: '' },
  } as const
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap ${map[status].cls}`}
      style={map[status].color ? { color: map[status].color } : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {map[status].label}
    </span>
  )
}

/** Rejilla cruda: para que se vea el archivo tal cual y se pueda elegir la columna. */
/**
 * Celda de operación o área en la vista previa.
 *
 * Tres estados, y el del medio es el que importa: si el archivo trae un nombre
 * que el catálogo no tiene, se pinta en ámbar con el valor crudo. El alta sigue
 * adelante —una unidad desconocida no debe bloquear a 800 personas— pero queda
 * a la vista que esa persona entrará sin clasificar.
 */
function UnitCell({
  name, unknown, unknownTitle,
}: { name: string; unknown: string; unknownTitle: string }) {
  return (
    <td className="max-w-[150px] truncate px-3 py-2 text-text-muted">
      {name ? (
        name
      ) : unknown ? (
        <span className="text-amber-500" title={unknownTitle}>{unknown}</span>
      ) : (
        <span className="text-text-subtle">—</span>
      )}
    </td>
  )
}

function RawPreview({ grid }: { grid: SheetGrid }) {
  const rows = grid.rows.slice(0, 8)
  const width = Math.min(rows.reduce((m, r) => Math.max(m, r.length), 0), 8)
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="bg-subtle text-text-subtle">
            <th className="px-2 py-1 font-normal" />
            {Array.from({ length: width }, (_, i) => (
              <th key={i} className="px-2 py-1 font-normal">{XLSX.utils.encode_col(i)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, ri) => (
            <tr key={ri}>
              <td className="px-2 py-1 text-text-subtle">{ri + 1}</td>
              {Array.from({ length: width }, (_, ci) => (
                <td key={ci} className="max-w-[140px] truncate px-2 py-1 text-text-muted">{r[ci] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Nombres visibles de columna: el encabezado real, o "Columna A/B/…". */
function analyzeColumns(grid: SheetGrid, headerRow: number): string[] {
  const width = grid.rows.reduce((m, r) => Math.max(m, r.length), 0)
  const header = headerRow >= 0 ? grid.rows[headerRow] ?? [] : []
  return Array.from({ length: width }, (_, i) => header[i] || `Columna ${XLSX.utils.encode_col(i)}`)
}
