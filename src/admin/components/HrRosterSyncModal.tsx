import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Upload, FileSpreadsheet, Download, Loader2, AlertCircle, AlertTriangle,
  ArrowLeft, UserPlus, UserMinus, UserCheck, CheckCircle2, MinusCircle, Copy, ShieldAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Select } from '@/components/ui/Select'
import { toast } from '@/stores/toastStore'
import {
  readGrids, analyzeGrid, extractRows,
  type SheetGrid, type ColumnMapping, type ExtractedRow,
} from '@/lib/parseUsersSheet'
import {
  getRoster, diffNovelties, countByAction, applySync,
  guessStatusKinds, distinctStatusValues, normStatus, CONFIRM_DEACTIVATIONS_OVER,
  type RosterPerson, type SyncEntry, type SyncAction, type ApplyResult, type StatusKind,
} from '@/services/hrSync.service'
import type { Campaign } from '@/types/database'

const NONE = -1
const SITE_URL = 'https://capacitaciones-chi.vercel.app/'
/** Cuántas filas se pintan por pestaña: una nómina puede traer miles. */
const VISIBLE_ROWS = 300

type Step = 'file' | 'review' | 'result'
type Tab = SyncAction

interface HrRosterSyncModalProps {
  campaigns: Campaign[]
  onClose: () => void
  onApplied: () => void | Promise<void>
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
export function HrRosterSyncModal({ campaigns, onClose, onApplied }: HrRosterSyncModalProps) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('file')
  const [period, setPeriod] = useState(currentPeriod())
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  const [grids, setGrids] = useState<SheetGrid[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [hasHeader, setHasHeader] = useState(true)
  const [headerRow, setHeaderRow] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping>({
    email: NONE, name: NONE, role: NONE, campaign: NONE, nationalId: NONE, status: NONE,
  })

  const [roster, setRoster] = useState<RosterPerson[]>([])
  const [rosterError, setRosterError] = useState<string | null>(null)

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
  const [tab, setTab] = useState<Tab>('deactivate')

  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const grid = grids[sheetIdx]

  /** Campañas por nombre, para resolver la columna de campaña del archivo. */
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
      const [parsed, people] = await Promise.all([
        readGrids(file),
        // Todas las cuentas: solo se usan para reconocer a quién nombra el
        // archivo, nunca para deducir bajas.
        getRoster().catch((err) => {
          setRosterError((err as Error).message)
          return [] as RosterPerson[]
        }),
      ])
      if (parsed.length === 0) {
        setGrids([])
        setFatalError(t('admin.users.bulk_empty_file'))
        return
      }
      // La hoja buena es la que trae gente: correos o cédulas.
      const analyses = parsed.map((g) => analyzeGrid(g.rows))
      let idx = analyses.findIndex((a) => a.emailCount > 0 || a.nationalIdCount > 0)
      if (idx === -1) idx = 0
      const a = analyses[idx]
      setGrids(parsed)
      setSheetIdx(idx)
      setHasHeader(a.headerRow >= 0)
      setHeaderRow(a.headerRow)
      setMapping(a.mapping)
      setRoster(people)
      setTab('deactivate')
      setStep('review')
    } catch {
      setGrids([])
      setFatalError(t('admin.users.bulk_unreadable'))
    } finally {
      setReading(false)
    }
  }, [t])

  const changeSheet = (idx: number) => {
    setSheetIdx(idx)
    const a = analyzeGrid(grids[idx].rows)
    setHasHeader(a.headerRow >= 0)
    setHeaderRow(a.headerRow)
    setMapping(a.mapping)
    setStatusOverrides({})
    setDecisions({})
    setCampaignOverrides({})
  }

  const restart = () => {
    setStep('file')
    setGrids([])
    setFileName('')
    setResult(null)
    setDecisions({})
    setCampaignOverrides({})
    setStatusOverrides({})
    setConfirmRisky(false)
  }

  /* ── El cruce ────────────────────────────────────────────────────────────── */

  const extracted: ExtractedRow[] = useMemo(() => {
    if (!grid) return []
    return extractRows(grid.rows, hasHeader ? headerRow : -1, mapping)
  }, [grid, hasHeader, headerRow, mapping])

  const hasStatusColumn = (mapping.status ?? NONE) >= 0

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
    })
    // La decisión del superadmin manda sobre la propuesta, y la campaña elegida a
    // mano sobre la que salió del archivo o del valor por defecto.
    return base.map((e) => ({
      ...e,
      include: decisions[e.key] ?? e.include,
      campaignId: campaignOverrides[e.key] !== undefined
        ? (campaignOverrides[e.key] || null)
        : e.campaignId,
    }))
  }, [extracted, roster, statusKinds, missingStatusAs, campaignByName, decisions, campaignOverrides])

  /** Filas del archivo que corresponden a alguien que ya tiene cuenta. */
  const matchedCount = useMemo(() => entries.filter((e) => e.person).length, [entries])
  const counts = useMemo(() => countByAction(entries), [entries])
  const included = useMemo(() => countByAction(entries, true), [entries])
  const manyDeactivations = included.deactivate > CONFIRM_DEACTIVATIONS_OVER
  /** Bajas que el archivo propone y todavía nadie confirmó. */
  const pendingDeactivations = counts.deactivate - included.deactivate
  /** Altas marcadas que nacerían sin campaña: entrarían sin contenido. */
  const createsWithoutCampaign = useMemo(
    () => entries.filter((e) => e.action === 'create' && e.include && !e.campaignId).length,
    [entries],
  )
  const hasIdentity = (mapping.email ?? NONE) >= 0 || (mapping.nationalId ?? NONE) >= 0
  const nothingToDo = included.create + included.deactivate + included.reactivate === 0
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
    setDecisions((prev) => {
      const next = { ...prev }
      for (const e of entries) {
        if (e.action !== action) continue
        next[e.key] = include
      }
      return next
    })
  }

  /** Pone la misma campaña a todas las altas de un tirón. */
  const applyCampaignToAllCreates = (campaignId: string) => {
    setCampaignOverrides((prev) => {
      const next = { ...prev }
      for (const e of entries) {
        if (e.action === 'create') next[e.key] = campaignId
      }
      return next
    })
  }

  /* ── Aplicar ─────────────────────────────────────────────────────────────── */

  const apply = async () => {
    if (blocked || applying) return
    setApplying(true)
    setProgress({ done: 0, total: included.create + included.deactivate + included.reactivate })
    try {
      const res = await applySync({
        entries,
        fileName,
        period,
        reason: effectiveReason,
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
      ['accion', 'motivo', 'fila', 'correo', 'cedula', 'nombre', 'estado_archivo', 'campana', 'cruce', 'se_aplica'],
      ...entries.map((e) => [
        t(`admin.hr.action_${e.action}`),
        e.reason ? t(`admin.hr.reason_${e.reason}`) : '',
        e.sourceLine,
        e.email,
        e.nationalIdRaw,
        e.name || e.person?.display_name || '',
        e.status,
        e.action === 'create' ? (e.campaignId ? campaignNameById.get(e.campaignId) ?? '' : '') : '',
        e.matchedBy ? t(`admin.hr.matched_${e.matchedBy}`) : '',
        e.include ? t('admin.hr.yes') : t('admin.hr.no'),
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
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragging(false)
                      const f = e.dataTransfer.files?.[0]
                      if (f) handleFile(f)
                    }}
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

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {grids.length > 1 && (
                        <Field label={t('admin.users.bulk_sheet')}>
                          <Select
                            compact
                            value={String(sheetIdx)}
                            onChange={(v) => changeSheet(Number(v))}
                            options={grids.map((g, i) => ({ value: String(i), label: g.name }))}
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
                      <Field label={t('admin.hr.map_campaign')}>
                        <Select
                          compact
                          value={String(mapping.campaign)}
                          onChange={(v) => setMapping({ ...mapping, campaign: Number(v) })}
                          options={columnOptions}
                        />
                      </Field>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
                        <input
                          type="checkbox"
                          checked={hasHeader}
                          onChange={(e) => {
                            setHasHeader(e.target.checked)
                            if (e.target.checked && headerRow < 0) setHeaderRow(0)
                          }}
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

                  {(tab === 'create' || tab === 'deactivate' || tab === 'reactivate') && tabEntries.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-text-muted">
                      <button onClick={() => toggleAll(tab, true)} className="rounded-md px-1.5 py-1 hover:text-text">
                        {t('admin.hr.select_all')}
                      </button>
                      <span className="text-text-subtle">·</span>
                      <button onClick={() => toggleAll(tab, false)} className="rounded-md px-1.5 py-1 hover:text-text">
                        {t('admin.hr.select_none')}
                      </button>
                      {tab === 'deactivate' && (
                        <span className="text-text-subtle">{t('admin.hr.confirm_each_hint')}</span>
                      )}
                      {/* Atajo para no elegir campaña 200 veces cuando todas van al mismo lado. */}
                      {tab === 'create' && (
                        <span className="ml-auto flex items-center gap-2">
                          <span className="text-text-subtle">{t('admin.hr.set_campaign_all')}</span>
                          <Select
                            compact
                            className="w-[200px]"
                            value=""
                            onChange={applyCampaignToAllCreates}
                            options={[
                              { value: '', label: t('admin.users.bulk_campaign_none') },
                              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                            ]}
                          />
                        </span>
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
                            <th className="px-3 py-2 font-normal">
                              {tab === 'create' ? t('admin.users.bulk_col_campaign') : t('admin.hr.col_why')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {tabEntries.slice(0, VISIBLE_ROWS).map((e) => {
                            const selectable = e.action === 'create' || e.action === 'deactivate' || e.action === 'reactivate'
                            return (
                              <tr key={e.key} className={e.include ? '' : 'opacity-55'}>
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-[#10D451]"
                                    checked={e.include}
                                    disabled={!selectable}
                                    onChange={(ev) =>
                                      setDecisions((prev) => ({ ...prev, [e.key]: ev.target.checked }))
                                    }
                                    aria-label={t('admin.users.bulk_include')}
                                  />
                                </td>
                                <td className="px-1 py-2 text-right text-text-subtle">{e.sourceLine ?? '—'}</td>
                                <td className="max-w-[220px] truncate px-3 py-2 text-text">
                                  {e.name || e.person?.display_name || <span className="text-text-subtle">—</span>}
                                </td>
                                <td className="px-3 py-2 font-mono text-text-muted">{e.nationalIdRaw || '—'}</td>
                                <td className="max-w-[220px] truncate px-3 py-2 text-text-muted">{e.email || '—'}</td>
                                <td className="px-3 py-2 text-text-subtle">
                                  {e.matchedBy ? t(`admin.hr.matched_${e.matchedBy}`) : '—'}
                                </td>
                                {e.action === 'create' ? (
                                  <td className="px-3 py-1.5">
                                    <Select
                                      compact
                                      className="w-[190px]"
                                      value={e.campaignId ?? ''}
                                      onChange={(v) =>
                                        setCampaignOverrides((prev) => ({ ...prev, [e.key]: v }))
                                      }
                                      options={[
                                        { value: '', label: t('admin.users.bulk_campaign_none') },
                                        ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                                      ]}
                                    />
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
                              <td colSpan={7} className="py-8 text-center text-text-muted">
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
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Stat label={t('admin.hr.tab_create')} value={result.created.filter((r) => r.status === 'created').length} tone="#10D451" />
                    <Stat label={t('admin.hr.tab_deactivate')} value={result.deactivated} tone="#ef4444" />
                    <Stat label={t('admin.hr.tab_reactivate')} value={result.reactivated} tone="#3b82f6" />
                    <Stat label={t('admin.hr.tab_unchanged')} value={result.unchanged} tone="#64748b" />
                  </div>

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
                      deactivate: included.deactivate,
                      reactivate: included.reactivate,
                    })}
                  </p>
                  {pendingDeactivations > 0 && (
                    <p className="text-[12px] text-amber-500">
                      {t('admin.hr.pending_deactivations', { n: pendingDeactivations })}
                    </p>
                  )}
                  {createsWithoutCampaign > 0 && (
                    <p className="text-[12px] text-amber-500">
                      {t('admin.hr.creates_without_campaign', { n: createsWithoutCampaign })}
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
