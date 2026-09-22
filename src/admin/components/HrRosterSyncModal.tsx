import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Upload, FileSpreadsheet, Download, Loader2, AlertCircle, AlertTriangle,
  ArrowLeft, UserPlus, UserMinus, UserCheck, CheckCircle2, MinusCircle, Copy, ShieldAlert,
  PencilLine, Lock, Layers,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFileDrop } from '@/hooks/useFileDrop'
import * as XLSX from 'xlsx'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { countryLabelWithFlag } from '@/lib/countries'
import { Select } from '@/components/ui/Select'
import { toast } from '@/stores/toastStore'
import {
  readGrids, analyzeGrid, extractAllSheets,
  type SheetGrid, type ColumnMapping, type ExtractedRow,
} from '@/lib/parseUsersSheet'
import {
  getRoster, diffNovelties, countByAction, applySync, rosterSupportsUpdates,
  guessStatusKinds, distinctStatusValues, normStatus, CONFIRM_DEACTIVATIONS_OVER,
  type RosterPerson, type SyncEntry, type SyncAction, type ApplyResult, type StatusKind,
  type UnitLookup,
} from '@/services/hrSync.service'
import { getActiveOrgId, getAllOrgUnits, indexUnits, findUnit } from '@/services/org.service'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Campaign, OrgUnit } from '@/types/database'
import { resolveCreationCampaignId } from '@/stores/campaignScopeStore'

const NONE = -1
const SITE_URL = 'https://capacitaciones-chi.vercel.app/'
/** Cuántas filas se pintan por pestaña: una nómina puede traer miles. */
const VISIBLE_ROWS = 300

type Step = 'file' | 'review' | 'result'
type Tab = SyncAction

interface HrRosterSyncModalProps {
  campaigns: Campaign[]
  /**
   * Si quien está mirando puede dar de baja. **Solo el superadmin.** Recursos
   * Humanos ve las bajas propuestas y las puede exportar para tramitarlas, pero
   * no las ejecuta: un alta de más se corrige y una baja indebida deja a alguien
   * fuera sin que nadie se entere hasta que reclama. `applySync` vuelve a
   * filtrarlas, así que esto es la puerta y no la pared.
   */
  canDeactivate: boolean
  onClose: () => void
  onApplied: () => void | Promise<void>
}

/** Lo que se dedujo de UNA hoja del libro, y si entra en la carga. */
interface SheetPlan {
  include: boolean
  hasHeader: boolean
  headerRow: number
  mapping: ColumnMapping
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Sincronización de usuarios contra la base de Talento Humano.
 *
 * El superadmin sube el reporte del mes y ve, antes de que se escriba nada, qué
 * va a pasar con **cada fila del archivo**: alta, baja, reactivación o nada. Todo
 * se puede excluir a mano.
 *
 * Lo importante del diseño: **la baja se lee del archivo** (columna de estado),
 * no se deduce de quién falta. Por eso no hay que elegir campañas ni acotar
 * alcance — a quien el archivo no menciona no le pasa nada — y por eso la
 * pantalla muestra y deja corregir cómo se interpretó cada valor de estado antes
 * de aplicar. Ver `diffNovelties`.
 */
export function HrRosterSyncModal({ campaigns, canDeactivate, onClose, onApplied }: HrRosterSyncModalProps) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('file')
  const [period, setPeriod] = useState(currentPeriod())
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  const [grids, setGrids] = useState<SheetGrid[]>([])
  /**
   * Una entrada por hoja del libro. **Se leen TODAS**, no la que parezca mejor:
   * la base maestra viene partida por país y quedarse con una es importar un
   * tercio de la empresa sin que nada lo diga. Cada hoja trae su propio mapeo
   * porque sus encabezados pueden empezar en filas distintas.
   */
  const [plans, setPlans] = useState<Record<string, SheetPlan>>({})
  /** Hoja cuyas columnas se están ajustando a mano. */
  const [tuning, setTuning] = useState('')

  const [roster, setRoster] = useState<RosterPerson[]>([])
  const [rosterError, setRosterError] = useState<string | null>(null)
  /** Catálogo de CR y áreas, para casar lo que dice el archivo. */
  const [units, setUnits] = useState<OrgUnit[]>([])

  /** Correcciones del superadmin a la lectura de un valor de estado. */
  const [statusOverrides, setStatusOverrides] = useState<Record<string, StatusKind>>({})
  /** Las filas con la celda de estado vacía se toman como activas. */
  const [blankAsActive, setBlankAsActive] = useState(false)
  /**
   * Decisión explícita del superadmin por fila (`true` = se aplica). Manda sobre
   * la propuesta: así las bajas se confirman una por una y las altas se pueden
   * dejar para después.
   */
  const [decisions, setDecisions] = useState<Record<string, boolean>>({})
  /** Campaña elegida a mano para un alta concreta. */
  const [campaignOverrides, setCampaignOverrides] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [confirmRisky, setConfirmRisky] = useState(false)
  const [tab, setTab] = useState<Tab>('update')

  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const grid = grids.find((g) => g.name === tuning)
  const plan = plans[tuning]
  const mapping = plan?.mapping ?? { email: NONE, name: NONE, role: NONE, campaign: NONE, nationalId: NONE, status: NONE }
  const hasHeader = plan?.hasHeader ?? true
  const headerRow = plan?.headerRow ?? 0

  const setPlan = useCallback((sheet: string, patch: Partial<SheetPlan>) => {
    setPlans((prev) => (prev[sheet] ? { ...prev, [sheet]: { ...prev[sheet], ...patch } } : prev))
  }, [])
  const setMapping = useCallback(
    (m: ColumnMapping) => setPlan(tuning, { mapping: m }),
    [setPlan, tuning],
  )

  /**
   * El catálogo casado por nombre normalizado. Nunca crea unidades: lo que el
   * archivo trae y el catálogo no tiene sale listado para que el superadmin lo
   * abra en /admin/units. Es lo que impide que cada carga invente sus propios
   * CR, que es exactamente cómo se desordenaron las campañas.
   */
  const unitLookup: UnitLookup = useMemo(
    () => ({ operations: indexUnits(units, 'operation'), areas: indexUnits(units, 'area') }),
    [units],
  )
  const unitNames = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])

  /** Campañas por nombre, para resolver la columna de campaña del archivo. */
  const campaignByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of campaigns) m.set(c.name.trim().toLowerCase(), c.id)
    return m
  }, [campaigns])

  /* El programa se retiró del sitio: ya no se elige ni se enseña. Por dentro
     el progreso todavía necesita un espacio, así que toda alta cae sola en uno. */
  const defaultCampaignId = useMemo(
    () => resolveCreationCampaignId(null, campaigns.map((c) => c.id)) || null,
    [campaigns],
  )

  // Motivo que se guarda: lo que escriba el superadmin o, si lo deja en blanco,
  // el del periodo. Se calcula al aplicar en vez de sembrarse en el estado, así
  // cambiar el mes no pisa un texto escrito a mano.
  const effectiveReason = reason.trim() || t('admin.hr.default_reason', { period })

  /* ── Archivo ─────────────────────────────────────────────────────────────── */

  const handleFile = useCallback(async (file: File) => {
    setFatalError(null)
    setRosterError(null)
    setResult(null)
    setDecisions({})
    setCampaignOverrides({})
    setStatusOverrides({})
    setBlankAsActive(false)
    setConfirmRisky(false)
    setFileName(file.name)
    setReading(true)
    try {
      const [parsed, people, catalog] = await Promise.all([
        readGrids(file),
        // Todas las cuentas: solo se usan para reconocer a quién nombra el
        // archivo, nunca para deducir bajas.
        getRoster().catch((err) => {
          setRosterError((err as Error).message)
          return [] as RosterPerson[]
        }),
        // El catálogo de CR y áreas. Si falla, la carga sigue: simplemente no se
        // proponen cambios de CR.
        getActiveOrgId().then((id) => (id ? getAllOrgUnits(id) : []))
          .catch(() => [] as OrgUnit[]),
      ])
      if (parsed.length === 0) {
        setGrids([])
        setFatalError(t('admin.users.bulk_empty_file'))
        return
      }
      /* TODAS las hojas, cada una con su propio mapeo. Solo se dejan fuera las
       * que no traen a nadie identificable (portadas, resúmenes): esas no son
       * gente, y marcarlas obligaría a desmarcarlas una por una. */
      const next: Record<string, SheetPlan> = {}
      for (const g of parsed) {
        const a = analyzeGrid(g.rows)
        next[g.name] = {
          include: a.emailCount > 0 || a.nationalIdCount > 0,
          hasHeader: a.headerRow >= 0,
          headerRow: a.headerRow,
          mapping: a.mapping,
        }
      }
      // Si ninguna hoja convence, se abre la primera para que se pueda mapear a
      // mano en vez de dejar la pantalla vacía sin explicación.
      if (!Object.values(next).some((x) => x.include) && parsed[0]) {
        next[parsed[0].name].include = true
      }
      setGrids(parsed)
      setPlans(next)
      setTuning(parsed.find((g) => next[g.name].include)?.name ?? parsed[0].name)
      setRoster(people)
      setUnits(catalog)
      setTab('update')
      setStep('review')
    } catch {
      setGrids([])
      setFatalError(t('admin.users.bulk_unreadable'))
    } finally {
      setReading(false)
    }
  }, [t])

  // Arrastrar y soltar: comportamiento único del sitio (sin parpadeo al pasar
  // sobre los hijos y aviso claro si el archivo no es una hoja de cálculo).
  const { dragging, dropProps } = useFileDrop({
    accept: '.xlsx,.xls,.csv',
    disabled: reading,
    onFiles: (files) => void handleFile(files[0]),
    onReject: (name) => toast.error(t('common.drop_invalid', { name })),
  })

  const toggleSheet = (name: string, include: boolean) => {
    setPlan(name, { include })
    setDecisions({})
    setCampaignOverrides({})
    if (include) setTuning(name)
  }

  const restart = () => {
    setStep('file')
    setGrids([])
    setPlans({})
    setTuning('')
    setFileName('')
    setResult(null)
    setDecisions({})
    setCampaignOverrides({})
    setStatusOverrides({})
    setConfirmRisky(false)
  }

  /* ── El cruce ────────────────────────────────────────────────────────────── */

  /** Las hojas que entran en la carga, en el orden del libro. */
  const activeSheets = useMemo(
    () => grids.filter((g) => plans[g.name]?.include).map((g) => g.name),
    [grids, plans],
  )

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
   * Hay columna de estado si la tiene alguna hoja incluida. La base maestra la
   * trae en las tres; un libro donde solo una la tenga se trata como si la
   * tuviera, y las hojas sin ella caen en "no se toca".
   */
  const hasStatusColumn = useMemo(
    () => activeSheets.some((n) => (plans[n]?.mapping.status ?? NONE) >= 0),
    [activeSheets, plans],
  )

  /** ¿El roster trae los campos que hacen falta para proponer correcciones? */
  const canUpdate = useMemo(() => rosterSupportsUpdates(roster), [roster])

  /**
   * CR y áreas que el archivo nombra y el catálogo no tiene. No se crean solas:
   * se listan para que el superadmin las abra en /admin/units. Mientras tanto
   * esa gente se queda sin clasificar, que es visible y reversible — al revés
   * que una unidad inventada, que ya no hay quien la distinga.
   */
  const unmatchedUnits = useMemo(() => {
    const ops = new Map<string, number>()
    const areas = new Map<string, number>()
    for (const r of extracted) {
      const op = r.operationRaw.trim()
      if (op && !findUnit(unitLookup.operations, op)) ops.set(op, (ops.get(op) ?? 0) + 1)
      const ar = r.areaRaw.trim()
      if (ar && !findUnit(unitLookup.areas, ar)) areas.set(ar, (areas.get(ar) ?? 0) + 1)
    }
    const sort = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }))
    return { operations: sort(ops), areas: sort(areas) }
  }, [extracted, unitLookup])

  /** Valores distintos de la columna de estado, con cuántas filas trae cada uno. */
  const statusValues = useMemo(() => distinctStatusValues(extracted), [extracted])

  /** Lectura propuesta de cada valor, con las correcciones del superadmin encima. */
  const statusKinds = useMemo(
    () => ({ ...guessStatusKinds(extracted), ...statusOverrides }),
    [extracted, statusOverrides],
  )

  /**
   * Filas sin estado legible. Sin columna de estado el archivo es una lista de
   * gente presente: sirve para altas. Con columna, una celda vacía es un dato
   * que falta y por defecto no hace nada. En ningún caso da de baja.
   */
  const missingStatusAs: 'active' | 'unknown' =
    !hasStatusColumn || blankAsActive ? 'active' : 'unknown'

  const entries: SyncEntry[] = useMemo(() => {
    const base = diffNovelties({
      fileRows: extracted,
      roster,
      statusKinds,
      missingStatusAs,
      campaignByName,
      // Sin valor global: la campaña sale de la columna del archivo y, si no la
      // trae, se elige persona por persona en la pestaña de altas.
      defaultCampaignId: null,
      units: unitLookup,
      unitNames,
      allowUpdates: canUpdate,
    })
    // La decisión del superadmin manda sobre la propuesta, y la campaña elegida a
    // mano sobre la que salió del archivo o del valor por defecto.
    return base.map((e) => ({
      ...e,
      include: decisions[e.key] ?? e.include,
      campaignId: campaignOverrides[e.key] !== undefined
        ? (campaignOverrides[e.key] || null)
        : (e.campaignId ?? defaultCampaignId),
    }))
  }, [extracted, roster, statusKinds, missingStatusAs, campaignByName, decisions, campaignOverrides, unitLookup, unitNames, canUpdate, defaultCampaignId])

  /** Filas del archivo que corresponden a alguien que ya tiene cuenta. */
  const matchedCount = useMemo(() => entries.filter((e) => e.person).length, [entries])
  const counts = useMemo(() => countByAction(entries), [entries])
  const included = useMemo(() => countByAction(entries, true), [entries])
  const manyDeactivations = included.deactivate > CONFIRM_DEACTIVATIONS_OVER
  /** Bajas que el archivo propone y todavía nadie confirmó. */
  const pendingDeactivations = counts.deactivate - included.deactivate
  const hasIdentity = useMemo(
    () =>
      activeSheets.some(
        (n) => (plans[n]?.mapping.email ?? NONE) >= 0 || (plans[n]?.mapping.nationalId ?? NONE) >= 0,
      ),
    [activeSheets, plans],
  )
  /** Choques duros: el correo es de otra persona. No se aplican nunca. */
  const conflicts = useMemo(
    () => entries.filter((e) => e.reason === 'identity_conflict'),
    [entries],
  )
  /** Correcciones marcadas y cuántos datos moverían en total. */
  const updateFields = useMemo(
    () => entries.filter((e) => e.include && e.changes.length > 0).reduce((n, e) => n + e.changes.length, 0),
    [entries],
  )
  /** Correos de ingreso que cambiarían: es el cambio más delicado de la lista. */
  const emailChanges = useMemo(
    () => entries.filter((e) => e.include && e.changes.some((c) => c.field === 'email')).length,
    [entries],
  )
  const nothingToDo =
    included.create + included.deactivate + included.reactivate + included.update === 0
  const blocked = !hasIdentity || nothingToDo || (manyDeactivations && !confirmRisky)

  const tabEntries = useMemo(() => entries.filter((e) => e.action === tab), [entries, tab])

  const columnOptions = useMemo(() => {
    const cols = grid ? columnNames(grid, hasHeader ? headerRow : -1) : []
    return [
      { value: String(NONE), label: t('admin.users.bulk_col_none') },
      ...cols.map((label, i) => ({ value: String(i), label })),
    ]
  }, [grid, hasHeader, headerRow, t])

  const toggleAll = (action: SyncAction, include: boolean) => {
    // Las bajas no se marcan en bloque si quien mira no puede darlas.
    if (action === 'deactivate' && include && !canDeactivate) return
    setDecisions((prev) => {
      const next = { ...prev }
      for (const e of entries) {
        if (e.action !== action) continue
        next[e.key] = include
      }
      return next
    })
  }

  /* ── Aplicar ─────────────────────────────────────────────────────────────── */

  const apply = async () => {
    if (blocked || applying) return
    setApplying(true)
    setProgress({
      done: 0,
      total: included.create + included.deactivate + included.reactivate + included.update,
    })
    try {
      const res = await applySync({
        entries,
        fileName,
        period,
        reason: effectiveReason,
        canDeactivate,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setResult(res)
      setStep('result')
      toast.success(
        t('admin.hr.applied', {
          created: res.created.filter((r) => r.status === 'created').length,
          deactivated: res.deactivated,
          reactivated: res.reactivated,
        }),
      )
      await onApplied()
    } catch (err) {
      toast.error(t('admin.hr.apply_error'), (err as Error).message)
    } finally {
      setApplying(false)
      setProgress(null)
    }
  }

  const downloadCredentials = () => {
    const created = result?.created.filter((r) => r.status === 'created') ?? []
    if (created.length === 0) return
    const ws = XLSX.utils.aoa_to_sheet([
      ['site', 'email', 'password'],
      ...created.map((r) => [SITE_URL, r.email, r.password ?? '']),
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'credenciales')
    XLSX.writeFile(wb, `altas-${period}.xlsx`)
  }

  const copyCredentials = async () => {
    const created = result?.created.filter((r) => r.status === 'created') ?? []
    await navigator.clipboard.writeText(
      created.map((r) => `${SITE_URL}\t${r.email}\t${r.password ?? ''}`).join('\n'),
    )
    toast.success(t('admin.users.bulk_copied'))
  }

  /** Reporte de lo que se va a hacer (o se hizo), para adjuntar a TH. */
  const downloadReport = () => {
    const aoa: (string | number)[][] = [
      [
        'accion', 'motivo', 'hoja', 'fila', 'correo', 'ficha', 'nombre', 'cargo',
        'cr', 'area', 'estado_archivo', 'cruce', 'cambios', 'se_aplica',
      ],
      ...entries.map((e) => [
        t(`admin.hr.action_${e.action}`),
        e.reason ? t(`admin.hr.reason_${e.reason}`) : '',
        e.sheet,
        e.sourceLine,
        e.email,
        e.nationalIdRaw,
        e.name || e.person?.display_name || '',
        e.jobTitleRaw,
        // El CR del catálogo si casó; si no, lo que decía el archivo con un
        // interrogante, que es información distinta de "no traía nada".
        e.operation?.name ?? (e.operationRaw ? `${e.operationRaw} (?)` : ''),
        e.area?.name ?? (e.areaRaw ? `${e.areaRaw} (?)` : ''),
        e.status,
        e.matchedBy ? t(`admin.hr.matched_${e.matchedBy}`) : '',
        e.changes.map((c) => `${t(`admin.hr.field_${c.field}`)}: ${c.fromLabel} → ${c.toLabel}`).join(' · '),
        // Una baja propuesta que quien mira no puede ejecutar sale marcada como
        // tal: el reporte sirve para tramitarla con el superadmin, no para
        // aparentar que se aplicó.
        e.action === 'deactivate' && !canDeactivate
          ? t('admin.hr.only_superadmin_short')
          : e.include ? t('admin.hr.yes') : t('admin.hr.no'),
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'sincronizacion')
    XLSX.writeFile(wb, `sincronizacion-th-${period}.xlsx`)
  }

  /* ── Interfaz ────────────────────────────────────────────────────────────── */

  const stepper = (
    <div className="flex items-center gap-2 text-[11px] text-text-subtle">
      {(['file', 'review', 'result'] as Step[]).map((s, i) => {
        const active = step === s
        const done = (['file', 'review', 'result'] as Step[]).indexOf(step) > i
        return (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-4 bg-line" />}
            <span className={`flex items-center gap-1.5 ${active ? 'text-text font-medium' : done ? 'text-text-muted' : ''}`}>
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
              {t(`admin.hr.step_${s}`)}
            </span>
          </div>
        )
      })}
    </div>
  )

  const tabs: { id: Tab; label: string; n: number; icon: typeof UserPlus; tone: string }[] = [
    { id: 'update', label: t('admin.hr.tab_update'), n: counts.update, icon: PencilLine, tone: '#B33D9E' },
    { id: 'deactivate', label: t('admin.hr.tab_deactivate'), n: counts.deactivate, icon: UserMinus, tone: '#ef4444' },
    { id: 'create', label: t('admin.hr.tab_create'), n: counts.create, icon: UserPlus, tone: '#10D451' },
    { id: 'reactivate', label: t('admin.hr.tab_reactivate'), n: counts.reactivate, icon: UserCheck, tone: '#3b82f6' },
    { id: 'unchanged', label: t('admin.hr.tab_unchanged'), n: counts.unchanged, icon: CheckCircle2, tone: '#64748b' },
    { id: 'skipped', label: t('admin.hr.tab_skipped'), n: counts.skipped, icon: MinusCircle, tone: '#64748b' },
  ]

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
          className={`relative w-full ${step === 'file' ? 'max-w-xl' : 'max-w-5xl'}`}
        >
          <div className="relative flex max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 space-y-2">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <FileSpreadsheet className="h-4 w-4 text-text-muted" />
                  {t('admin.hr.title')}
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

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* ── Paso 1: alcance + archivo ─────────────────────────────── */}
              {step === 'file' && (
                <div className="space-y-4">
                  <p className="text-[13px] text-text-muted">{t('admin.hr.help')}</p>

                  <div className="grid gap-3 sm:max-w-[240px]">
                    <Field label={t('admin.hr.period')}>
                      <input
                        type="month"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="w-full rounded-xl border border-line bg-subtle px-3 py-2 text-[13px] text-text outline-none min-h-[44px]"
                      />
                    </Field>
                  </div>

                  <p className="rounded-xl border border-line bg-subtle/60 p-3 text-[12px] text-text-muted">
                    {t('admin.hr.no_scope_hint')}
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
                    className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors disabled:opacity-50"
                    style={{
                      borderColor: dragging ? '#10D451' : 'var(--line, rgba(127,127,127,.28))',
                      background: dragging ? 'rgba(16,212,81,.07)' : undefined,
                    }}
                  >
                    {reading
                      ? <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                      : <Upload className="h-6 w-6 text-text-muted" />}
                    <span className="text-[14px] font-medium text-text">
                      {reading ? t('admin.hr.reading') : t('admin.users.bulk_drop_title')}
                    </span>
                    <span className="text-[12px] text-text-subtle">{t('admin.hr.drop_hint')}</span>
                  </button>

                  {fatalError && (
                    <p className="flex items-center gap-2 text-[13px] text-red-500">
                      <AlertCircle className="h-4 w-4 shrink-0" /> {fatalError}
                    </p>
                  )}
                </div>
              )}

              {/* ── Paso 2: revisión ──────────────────────────────────────── */}
              {step === 'review' && grid && (
                <div className="space-y-4">
                  <div className="space-y-3 rounded-xl border border-line bg-subtle/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-[12px] text-text-muted">
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        <span className="font-mono text-text">{fileName}</span>
                        <span className="text-text-subtle">
                          · {t('admin.users.bulk_rows_read', { n: extracted.length })}
                          · {t('admin.hr.matched_count', { n: matchedCount })}
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

                    {/* TODAS las hojas del libro, con lo que trae cada una. La
                        base maestra viene partida por pais: si una hoja se queda
                        fuera hay que verlo aqui, no descubrirlo cuando falte un
                        tercio de la empresa. */}
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
                      <Field label={t('admin.hr.map_national_id')}>
                        <Select
                          compact
                          value={String(mapping.nationalId ?? NONE)}
                          onChange={(v) => setMapping({ ...mapping, nationalId: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      <Field label={t('admin.users.bulk_map_email')}>
                        <Select
                          compact
                          value={String(mapping.email)}
                          onChange={(v) => setMapping({ ...mapping, email: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      <Field label={t('admin.users.bulk_map_name')}>
                        <Select
                          compact
                          value={String(mapping.name)}
                          onChange={(v) => setMapping({ ...mapping, name: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      <Field label={t('admin.hr.map_status')}>
                        <Select
                          compact
                          value={String(mapping.status ?? NONE)}
                          onChange={(v) => setMapping({ ...mapping, status: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      <Field label={t('admin.hr.map_job_title')}>
                        <Select
                          compact
                          value={String(mapping.jobTitle ?? NONE)}
                          onChange={(v) => setMapping({ ...mapping, jobTitle: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      {/* "CR" es como Talento Humano llama a la operacion. La
                          equivalencia se repite en cada sitio donde aparece la
                          sigla: quien lleva anos diciendo "operacion" no tiene
                          por que aprender una sigla nueva para reconocer su
                          propio dato. */}
                      <Field label={t('admin.hr.map_operation')} hint={t('admin.units.cr_equals_operation')}>
                        <Select
                          compact
                          value={String(mapping.operation ?? NONE)}
                          onChange={(v) => setMapping({ ...mapping, operation: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                      <Field label={t('admin.hr.map_area')}>
                        <Select
                          compact
                          value={String(mapping.area ?? NONE)}
                          onChange={(v) => setMapping({ ...mapping, area: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
                        <input
                          type="checkbox"
                          checked={hasHeader}
                          onChange={(e) =>
                            setPlan(tuning, {
                              hasHeader: e.target.checked,
                              headerRow: e.target.checked && headerRow < 0 ? 0 : headerRow,
                            })
                          }
                          className="h-4 w-4 accent-[#10D451]"
                        />
                        {t('admin.users.bulk_has_header')}
                        {hasHeader && headerRow > 0 && (
                          <span className="text-text-subtle">{t('admin.users.bulk_header_at', { n: headerRow + 1 })}</span>
                        )}
                      </label>
                      {hasStatusColumn && (
                        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
                          <input
                            type="checkbox"
                            checked={blankAsActive}
                            onChange={(e) => setBlankAsActive(e.target.checked)}
                            className="h-4 w-4 accent-[#10D451]"
                          />
                          {t('admin.hr.blank_as_active')}
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Cómo se lee cada estado del archivo. Es el corazón del
                      asunto: solo lo marcado como "retirado" da de baja, y aquí
                      se ve y se corrige antes de aplicar. */}
                  {hasStatusColumn ? (
                    <div className="overflow-hidden rounded-xl border border-line">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-subtle px-3 py-2">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">
                          {t('admin.hr.status_map_title')}
                        </span>
                        <span className="text-[11px] text-text-subtle">{t('admin.hr.status_map_hint')}</span>
                      </div>
                      <div className="max-h-[26vh] divide-y divide-line overflow-y-auto">
                        {statusValues.map(({ value, count }) => {
                          const key = normStatus(value)
                          const kind = statusKinds[key] ?? 'unknown'
                          return (
                            <div key={key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">{value}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">
                                {t('admin.hr.status_rows', { n: count })}
                              </span>
                              <Select
                                compact
                                className="w-[190px] shrink-0"
                                value={kind}
                                onChange={(v) =>
                                  setStatusOverrides((prev) => ({ ...prev, [key]: v as StatusKind }))
                                }
                                options={[
                                  { value: 'active', label: t('admin.hr.kind_active') },
                                  { value: 'retired', label: t('admin.hr.kind_retired'), color: '#ef4444' },
                                  { value: 'ignore', label: t('admin.hr.kind_ignore') },
                                  { value: 'unknown', label: t('admin.hr.kind_unknown') },
                                ]}
                              />
                            </div>
                          )
                        })}
                        {statusValues.length === 0 && (
                          <p className="px-3 py-3 text-[12px] text-text-muted">{t('admin.hr.status_empty')}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="flex items-center gap-2 text-[13px] font-medium text-amber-500">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('admin.hr.no_status_title')}
                      </p>
                      <p className="mt-1 text-[12px] text-text-muted">{t('admin.hr.no_status_hint')}</p>
                    </div>
                  )}

                  {!hasIdentity && (
                    <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-500">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {t('admin.hr.need_identity')}
                    </p>
                  )}

                  {/* Choque de identidad: el correo del archivo es de alguien que
                      en el sitio se llama de otra forma Y tiene otro cargo. No se
                      aplica ni marcandolo a mano — la correccion esta en el
                      archivo, no aqui. */}
                  {conflicts.length > 0 && (
                    <div className="space-y-1.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
                      <p className="flex items-center gap-2 text-[13px] font-medium text-red-500">
                        <ShieldAlert className="h-4 w-4 shrink-0" />
                        {t('admin.hr.conflicts_title', { n: conflicts.length })}
                      </p>
                      <p className="text-[12px] text-text-muted">{t('admin.hr.conflicts_hint')}</p>
                      <ul className="space-y-0.5 text-[12px] text-text-muted">
                        {conflicts.slice(0, 4).map((e) => (
                          <li key={e.key}>
                            · <span className="font-mono">{e.email}</span>{' '}
                            {t('admin.hr.conflicts_line', {
                              file: e.name || '—',
                              site: e.person?.display_name || '—',
                            })}
                          </li>
                        ))}
                        {conflicts.length > 4 && (
                          <li className="text-text-subtle">
                            {t('admin.hr.conflicts_more', { n: conflicts.length - 4 })}
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* CR y areas que el archivo nombra y el catalogo no tiene.
                      NUNCA se crean solas desde aqui: el catalogo cerrado es lo
                      que impide repetir el desorden de las campanas. */}
                  {(unmatchedUnits.operations.length > 0 || unmatchedUnits.areas.length > 0) && (
                    <div className="space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="flex items-center gap-2 text-[13px] font-medium text-amber-500">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('admin.hr.unmatched_units_title', {
                          n: unmatchedUnits.operations.length + unmatchedUnits.areas.length,
                        })}
                      </p>
                      <p className="text-[12px] text-text-muted">{t('admin.hr.unmatched_units_hint')}</p>
                      <div className="flex flex-wrap gap-1">
                        {[...unmatchedUnits.operations, ...unmatchedUnits.areas].slice(0, 12).map((u) => (
                          <span
                            key={u.name}
                            className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-muted"
                          >
                            {u.name} <span className="tabular-nums text-text-subtle">{u.n}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* El roster llego sin los campos nuevos: proponer correcciones
                      sin saber que dice hoy el perfil seria adivinar. */}
                  {!canUpdate && (
                    <p className="flex items-center gap-2 rounded-xl border border-line bg-subtle/60 p-3 text-[12px] text-text-muted">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {t('admin.hr.updates_unavailable')}
                    </p>
                  )}

                  {/* Recursos Humanos ve las bajas y las puede exportar; no las
                      ejecuta. El candado de verdad esta en `applySync`. */}
                  {!canDeactivate && counts.deactivate > 0 && (
                    <p className="flex items-center gap-2 rounded-xl border border-line bg-subtle/60 p-3 text-[12px] text-text-muted">
                      <Lock className="h-4 w-4 shrink-0" />
                      {t('admin.hr.deactivate_locked', { n: counts.deactivate })}
                    </p>
                  )}

                  {rosterError && (
                    <p className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[13px] text-red-500">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {t('admin.hr.roster_error')} {rosterError}
                    </p>
                  )}

                  {manyDeactivations && (
                    <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
                      <p className="flex items-center gap-2 text-[13px] font-medium text-red-500">
                        <ShieldAlert className="h-4 w-4 shrink-0" />
                        {t('admin.hr.risky_title', { n: included.deactivate })}
                      </p>
                      <p className="text-[12px] text-text-muted">{t('admin.hr.risky_hint')}</p>
                      <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] font-medium text-text">
                        <input
                          type="checkbox"
                          checked={confirmRisky}
                          onChange={(e) => setConfirmRisky(e.target.checked)}
                          className="h-4 w-4 accent-red-500"
                        />
                        {t('admin.hr.risky_confirm', { n: included.deactivate })}
                      </label>
                    </div>
                  )}

                  {/* Pestañas por grupo */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tabs.map((x) => {
                      const active = tab === x.id
                      const Icon = x.icon
                      return (
                        <button
                          key={x.id}
                          onClick={() => setTab(x.id)}
                          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors"
                          style={
                            active
                              ? { borderColor: x.tone, color: x.tone, background: `${x.tone}1a` }
                              : { borderColor: 'var(--line, rgba(127,127,127,.28))', color: 'var(--text-muted)' }
                          }
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {x.label}
                          <span className="tabular-nums">{x.n}</span>
                        </button>
                      )
                    })}
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        onClick={downloadReport}
                        className="flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-text-muted hover:text-text"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t('admin.hr.download_report')}
                      </button>
                    </span>
                  </div>

                  {(tab === 'create' || tab === 'deactivate' || tab === 'reactivate' || tab === 'update') && tabEntries.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-text-muted">
                      <button onClick={() => toggleAll(tab, true)} className="rounded-md px-1.5 py-1 hover:text-text">
                        {t('admin.hr.select_all')}
                      </button>
                      <span className="text-text-subtle">·</span>
                      <button onClick={() => toggleAll(tab, false)} className="rounded-md px-1.5 py-1 hover:text-text">
                        {t('admin.hr.select_none')}
                      </button>
                      {tab === 'deactivate' && (
                        <span className="text-text-subtle">
                          {canDeactivate ? t('admin.hr.confirm_each_hint') : t('admin.hr.only_superadmin')}
                        </span>
                      )}
                      {tab === 'update' && (
                        <span className="text-text-subtle">{t('admin.hr.update_hint')}</span>
                      )}
                    </div>
                  )}

                  <div className="overflow-hidden rounded-xl border border-line">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-[12px]">
                        <thead>
                          <tr className="bg-subtle text-[11px] uppercase tracking-wider text-text-muted">
                            <th className="w-10 px-3 py-2" />
                            <th className="w-10 px-1 py-2 text-right font-normal">#</th>
                            <th className="px-3 py-2 font-normal">{t('admin.hr.col_person')}</th>
                            <th className="px-3 py-2 font-normal">{t('profile.national_id')}</th>
                            <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_email')}</th>
                            <th className="px-3 py-2 font-normal">{t('admin.hr.col_match')}</th>
                            {/* De que hoja salio la fila: con la base partida por
                                pais es el dato que permite volver al archivo. */}
                            {grids.length > 1 && (
                              <th className="px-3 py-2 font-normal">{t('admin.hr.col_sheet')}</th>
                            )}
                            {/* El país solo se aplica a las altas: a quien ya
                                tiene cuenta no se le pisa el perfil. */}
                            {tab === 'create' && (
                              <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_country')}</th>
                            )}
                            <th className="px-3 py-2 font-normal">
                              {tab === 'create'
                                ? t('admin.users.bulk_col_operation', 'CR')
                                : tab === 'update'
                                  ? t('admin.hr.col_changes')
                                  : t('admin.hr.col_why')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {tabEntries.slice(0, VISIBLE_ROWS).map((e) => {
                            const selectable =
                              e.action === 'create' ||
                              e.action === 'reactivate' ||
                              e.action === 'update' ||
                              (e.action === 'deactivate' && canDeactivate)
                            return (
                              <tr key={e.key} className={e.include ? '' : 'opacity-55'}>
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-[#10D451]"
                                    checked={e.include && !(e.action === 'deactivate' && !canDeactivate)}
                                    disabled={!selectable}
                                    onChange={(ev) =>
                                      setDecisions((prev) => ({ ...prev, [e.key]: ev.target.checked }))
                                    }
                                    aria-label={t('admin.users.bulk_include')}
                                  />
                                </td>
                                <td className="px-1 py-2 text-right text-text-subtle">{e.sourceLine ?? '—'}</td>
                                <td className="max-w-[220px] px-3 py-2 text-text">
                                  <span className="block truncate">
                                    {e.name || e.person?.display_name || <span className="text-text-subtle">—</span>}
                                  </span>
                                  {/* El nombre no casa: se ensena el del sitio al
                                      lado. Es lo unico que permite distinguir
                                      "le faltaba el apellido" de "es otra
                                      persona" sin abrir el perfil. */}
                                  {e.identity?.nameMismatch && e.person?.display_name && (
                                    <span className="block truncate text-[11px] text-amber-500">
                                      {t('admin.hr.name_in_site', { name: e.person.display_name })}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 font-mono text-text-muted">{e.nationalIdRaw || '—'}</td>
                                <td className="max-w-[220px] truncate px-3 py-2 text-text-muted">{e.email || '—'}</td>
                                <td className="px-3 py-2 text-text-subtle">
                                  {e.matchedBy ? t(`admin.hr.matched_${e.matchedBy}`) : '—'}
                                </td>
                                {grids.length > 1 && (
                                  <td className="max-w-[110px] truncate px-3 py-2 text-text-subtle">{e.sheet || '—'}</td>
                                )}
                                {tab === 'create' && (
                                  <td className="max-w-[150px] truncate px-3 py-2 text-text-muted">
                                    {countryLabelWithFlag(e.country) ?? <span className="text-text-subtle">—</span>}
                                  </td>
                                )}
                                {e.action === 'create' ? (
                                  <td className={e.operation ? 'max-w-[190px] truncate px-3 py-2 text-text-muted' : 'max-w-[190px] truncate px-3 py-2 text-amber-500'}>
                                    {e.operation?.name ?? (e.operationRaw ? `${e.operationRaw} (?)` : t('admin.progress_overview.no_cr', 'Sin CR asignado'))}
                                  </td>
                                ) : e.changes.length > 0 ? (
                                  <td className="px-3 py-2">
                                    <div className="flex flex-col gap-0.5">
                                      {e.changes.map((c) => (
                                        <span key={c.field} className="text-[11px] text-text-muted">
                                          <span className="text-text-subtle">{t(`admin.hr.field_${c.field}`)}: </span>
                                          <span className="line-through opacity-70">{c.fromLabel}</span>
                                          {' → '}
                                          <span className="font-medium text-text">{c.toLabel}</span>
                                          {/* El correo no es un UPDATE mas: mueve
                                              la cuenta de ingreso. Se avisa. */}
                                          {c.needsAuth && (
                                            <span className="ml-1 text-[10px] text-amber-500">
                                              {t('admin.hr.field_needs_auth')}
                                            </span>
                                          )}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                ) : (
                                  <td className="px-3 py-2 text-text-muted">
                                    {e.reason ? t(`admin.hr.reason_${e.reason}`) : t(`admin.hr.action_${e.action}`)}
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                          {tabEntries.length === 0 && (
                            <tr>
                              <td colSpan={9} className="py-8 text-center text-text-muted">
                                {t('admin.hr.tab_empty')}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {tabEntries.length > VISIBLE_ROWS && (
                      <p className="border-t border-line px-3 py-2 text-[11px] text-text-subtle">
                        {t('admin.hr.showing_partial', { shown: VISIBLE_ROWS, total: tabEntries.length })}
                      </p>
                    )}
                  </div>

                  <Field label={t('admin.hr.reason')}>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t('admin.hr.default_reason', { period })}
                      className="w-full rounded-xl border border-line bg-subtle px-3 py-2 text-[13px] text-text outline-none min-h-[44px]"
                    />
                  </Field>
                </div>
              )}

              {/* ── Paso 3: resultado ─────────────────────────────────────── */}
              {step === 'result' && result && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <Stat label={t('admin.hr.tab_create')} value={result.created.filter((r) => r.status === 'created').length} tone="#10D451" />
                    <Stat label={t('admin.hr.tab_update')} value={result.updated} tone="#B33D9E" />
                    <Stat label={t('admin.hr.tab_deactivate')} value={result.deactivated} tone="#ef4444" />
                    <Stat label={t('admin.hr.tab_reactivate')} value={result.reactivated} tone="#3b82f6" />
                    <Stat label={t('admin.hr.tab_unchanged')} value={result.unchanged} tone="#64748b" />
                  </div>

                  {result.emailsChanged > 0 && (
                    <p className="rounded-xl border border-line bg-subtle/60 p-3 text-[12px] text-text-muted">
                      {t('admin.hr.emails_changed_result', { n: result.emailsChanged })}
                    </p>
                  )}

                  {/* Bajas que se propusieron y no se aplicaron. Quedan escritas
                      en el historial de la carga para que se puedan tramitar, no
                      para que se pierdan. */}
                  {result.deactivationsBlocked > 0 && (
                    <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-500">
                      <Lock className="h-4 w-4 shrink-0" />
                      {t('admin.hr.deactivations_blocked_result', { n: result.deactivationsBlocked })}
                    </p>
                  )}

                  {result.errors.length > 0 && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3">
                      <p className="mb-1 text-[13px] font-medium text-red-500">{t('admin.hr.with_errors')}</p>
                      <ul className="space-y-0.5 text-[12px] text-text-muted">
                        {result.errors.slice(0, 5).map((e, i) => <li key={i}>· {e}</li>)}
                      </ul>
                    </div>
                  )}

                  {result.created.some((r) => r.status === 'created') && (
                    <div className="space-y-2 rounded-xl border border-line bg-subtle/60 p-3">
                      <p className="text-[13px] text-text">{t('admin.hr.creds_ready')}</p>
                      <p className="text-[12px] text-text-muted">{t('admin.users.bulk_creds_hint')}</p>
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
                    </div>
                  )}

                  <button
                    onClick={downloadReport}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-text-muted hover:text-text"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t('admin.hr.download_report')}
                  </button>

                  {result.created.some((r) => r.status === 'error') && (
                    <div className="overflow-hidden rounded-xl border border-line">
                      <div className="bg-subtle px-3 py-2 text-[11px] uppercase tracking-wider text-text-muted">
                        {t('admin.hr.failed_creates')}
                      </div>
                      <div className="max-h-[30vh] divide-y divide-line overflow-y-auto">
                        {result.created.filter((r) => r.status === 'error').map((r, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                            <span className="truncate text-text">{r.email}</span>
                            <span className="shrink-0 text-red-500">{r.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {step === 'review' && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[12px] text-text-muted">
                    {t('admin.hr.footer_summary', {
                      create: included.create,
                      deactivate: canDeactivate ? included.deactivate : 0,
                      reactivate: included.reactivate,
                    })}
                    {included.update > 0 && (
                      <> · {t('admin.hr.footer_updates', { n: included.update, fields: updateFields })}</>
                    )}
                  </p>
                  {/* El cambio de correo mueve la cuenta de ingreso: se avisa
                      aparte del resto de correcciones, que solo tocan el perfil. */}
                  {emailChanges > 0 && (
                    <p className="text-[12px] text-amber-500">
                      {t('admin.hr.email_changes_warning', { n: emailChanges })}
                    </p>
                  )}
                  {pendingDeactivations > 0 && (
                    <p className="text-[12px] text-amber-500">
                      {t('admin.hr.pending_deactivations', { n: pendingDeactivations })}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="min-h-[44px] rounded-xl bg-subtle px-4 py-2 text-[13px] text-text-muted hover:text-text"
                  >
                    {t('admin.courses.cancel')}
                  </button>
                  <button
                    onClick={apply}
                    disabled={blocked || applying}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50"
                    style={{ background: '#10D451' }}
                  >
                    {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {applying && progress
                      ? t('admin.hr.applying_n', { done: progress.done, total: progress.total })
                      : t('admin.hr.apply')}
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
                  {t('admin.hr.sync_another')}
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

/* ── Auxiliares ──────────────────────────────────────────────────────────────── */

function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-text-subtle">
        {label}
        {required && <span className="ml-0.5 text-[#10D451]">*</span>}
        {/* La pista va en el tooltip del sitio, nunca en `title`: el nativo
            tarda un segundo, no se ve en tactil y no sigue el tema. */}
        {hint && (
          <Tooltip label={hint} maxWidth={260}>
            <span className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-line text-[8px] font-bold normal-case">
              ?
            </span>
          </Tooltip>
        )}
      </span>
      {children}
    </label>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-subtle/60 p-3">
      <div className="text-[20px] font-semibold tabular-nums" style={{ color: tone }}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-text-subtle">{label}</div>
    </div>
  )
}

/** Nombres visibles de columna: el encabezado real, o "Columna A/B/…". */
function columnNames(grid: SheetGrid, headerRow: number): string[] {
  const width = grid.rows.reduce((m, r) => Math.max(m, r.length), 0)
  const header = headerRow >= 0 ? grid.rows[headerRow] ?? [] : []
  return Array.from({ length: width }, (_, i) => header[i] || `Columna ${XLSX.utils.encode_col(i)}`)
}
