import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Upload, FileSpreadsheet, Download, Loader2, Check, AlertCircle, AlertTriangle,
  ArrowLeft, ShieldCheck, Copy, Pencil, RefreshCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { Select } from '@/components/ui/Select'
import { supabase } from '@/lib/supabase'
import { getDefaultPassword } from '@/services/appSettings.service'
import { resolveCreationCampaignId } from '@/stores/campaignScopeStore'
import { toast } from '@/stores/toastStore'
import {
  readGrids, analyzeGrid, extractRows, finalDisplayName,
  type SheetGrid, type ColumnMapping, type ExtractedRow,
} from '@/lib/parseUsersSheet'
import type { Campaign } from '@/types/database'

const MAX_ROWS = 200
const SITE_URL = 'https://capacitaciones-chi.vercel.app/'
const NONE = -1

type Step = 'file' | 'review' | 'result'
type RowStatus = 'new' | 'exists' | 'duplicate' | 'invalid'

interface RowResult {
  email: string
  status: 'created' | 'error'
  password?: string
  reason?: string
}

/** Fila ya resuelta: exactamente lo que se va a crear (o por qué no). */
interface PreviewRow {
  key: string
  sourceLine: number
  email: string
  raw: string
  name: string
  /** El nombre salió del archivo (false = lo deduce el sistema del correo). */
  nameFromFile: boolean
  role: string
  campaignId: string | null
  status: RowStatus
  include: boolean
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
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  // Archivo interpretado
  const [grids, setGrids] = useState<SheetGrid[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [hasHeader, setHasHeader] = useState(true)
  const [headerRow, setHeaderRow] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping>({ email: NONE, name: NONE, role: NONE, campaign: NONE })

  // Ajustes que aplican a las filas sin valor propio. El capacitador arranca en
  // la campaña donde está parado el panel, y solo puede moverse entre las suyas.
  const [roleDefault, setRoleDefault] = useState('learner')
  const [campaignDefault, setCampaignDefault] = useState(() =>
    isSuperAdmin ? '' : resolveCreationCampaignId(null, campaigns.map((c) => c.id)),
  )

  // Correcciones manuales del usuario en la tabla de revisión
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({})
  const [excluded, setExcluded] = useState<Record<string, boolean>>({})

  // Verificación contra el sitio (no crea nada)
  const [existing, setExisting] = useState<Set<string>>(new Set())
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'done' | 'unavailable'>('idle')

  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState<RowResult[] | null>(null)
  // Lo confirma el servidor: es él quien decide si aplicó la predeterminada.
  const [usedDefaultPwd, setUsedDefaultPwd] = useState(false)
  const [defaultPwdValue, setDefaultPwdValue] = useState('')

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

  const grid = grids[sheetIdx]

  /* ── Verificación contra el sitio (vista previa: no crea nada) ─────────── */

  const verify = useCallback(async (emails: string[]) => {
    if (emails.length === 0) return
    setCheckState('checking')
    try {
      const { data: { session } } = await supabase.auth.getSession()
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
          body: JSON.stringify({ preview: true, emails: emails.slice(0, MAX_ROWS) }),
        },
      )
      const json = await res.json()
      if (!res.ok || json?.preview !== true) {
        setCheckState('unavailable')
        return
      }
      setExisting(new Set((json.existing ?? []) as string[]))
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
    (g: SheetGrid | undefined, hRow: number, m: ColumnMapping) => {
      if (!g || m.email < 0) return
      const emails = extractRows(g.rows, hRow, m)
        .filter((r) => r.issue === 'ok')
        .map((r) => r.email)
      verify(emails)
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
      // Se elige la hoja que sí trae correos; si ninguna, la primera.
      const analyses = parsed.map((g) => analyzeGrid(g.rows))
      let idx = analyses.findIndex((a) => a.emailCount > 0)
      if (idx === -1) idx = 0
      const a = analyses[idx]
      setGrids(parsed)
      setSheetIdx(idx)
      setHasHeader(a.headerRow >= 0)
      setHeaderRow(a.headerRow)
      setMapping(a.mapping)
      setStep('review')
      verifyWith(parsed[idx], a.headerRow, a.mapping)
    } catch {
      setGrids([])
      setFatalError(t('admin.users.bulk_unreadable'))
    } finally {
      setReading(false)
    }
  }, [t, verifyWith])

  /** Al cambiar de hoja se vuelve a deducir todo para esa hoja. */
  const changeSheet = (idx: number) => {
    setSheetIdx(idx)
    const a = analyzeGrid(grids[idx].rows)
    setHasHeader(a.headerRow >= 0)
    setHeaderRow(a.headerRow)
    setMapping(a.mapping)
    setNameEdits({})
    setExcluded({})
    setExisting(new Set())
    verifyWith(grids[idx], a.headerRow, a.mapping)
  }

  /** Cambiar el mapeo cambia qué correos hay: se vuelve a verificar. */
  const changeMapping = (patch: Partial<ColumnMapping>) => {
    const next = { ...mapping, ...patch }
    setMapping(next)
    if (patch.email !== undefined) {
      setExisting(new Set())
      verifyWith(grid, hasHeader ? headerRow : -1, next)
    }
  }

  const changeHasHeader = (checked: boolean) => {
    setHasHeader(checked)
    const nextHeaderRow = checked && headerRow < 0 ? 0 : headerRow
    if (checked && headerRow < 0) setHeaderRow(0)
    setExisting(new Set())
    verifyWith(grid, checked ? nextHeaderRow : -1, mapping)
  }

  /* ── Filas resueltas ───────────────────────────────────────────────────── */

  const extracted: ExtractedRow[] = useMemo(() => {
    if (!grid) return []
    return extractRows(grid.rows, hasHeader ? headerRow : -1, mapping)
  }, [grid, hasHeader, headerRow, mapping])

  const rows: PreviewRow[] = useMemo(() => {
    return extracted.map((r, i) => {
      const key = `${r.sourceLine}:${r.email || `x${i}`}`
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
      return {
        key,
        sourceLine: r.sourceLine,
        email: r.email,
        raw: r.raw,
        name: finalDisplayName(editedName ?? r.name, r.email),
        nameFromFile,
        role: rowRole,
        campaignId: rowCampaign,
        status,
        // Sin campaña, el servidor rechazaría el alta del capacitador: se marca
        // como no incluible en vez de dejar que falle fila por fila.
        include: status === 'new' && !excluded[key] && !(campaignRequired && !rowCampaign),
      }
    })
  }, [extracted, existing, nameEdits, excluded, canChooseRole, campaignRequired, roleDefault, campaignDefault, campaignByName])

  const counts = useMemo(() => {
    const c = { new: 0, exists: 0, duplicate: 0, invalid: 0, excluded: 0 }
    for (const r of rows) {
      c[r.status]++
      if (r.status === 'new' && !r.include) c.excluded++
    }
    return c
  }, [rows])

  const selected = useMemo(() => rows.filter((r) => r.include), [rows])
  const tooMany = selected.length > MAX_ROWS

  /* ── Acciones ──────────────────────────────────────────────────────────── */

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['email', 'display_name'],
      ['ana@ejemplo.com', 'Ana Pérez'],
      ['juan@ejemplo.com', 'Juan Gómez'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'usuarios')
    XLSX.writeFile(wb, 'plantilla-usuarios.xlsx')
  }

  const process = async () => {
    if (selected.length === 0 || tooMany) return
    setProcessing(true)
    try {
      const payload = selected.map((r) => ({
        email: r.email,
        display_name: r.name,
        role: r.role,
        campaign: r.campaignId ?? undefined,
      }))
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-users-bulk`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ rows: payload }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      setResults(json.results as RowResult[])
      setUsedDefaultPwd(json.defaultPassword === true)
      setStep('result')
      toast.success(t('admin.users.bulk_done', { created: json.created, total: json.total }))
      await onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.courses.error_save'))
    } finally {
      setProcessing(false)
    }
  }

  const downloadCredentials = () => {
    if (!results) return
    const created = results.filter((r) => r.status === 'created')
    const aoa = [
      ['site', 'email', 'password'],
      ...created.map((r) => [SITE_URL, r.email, r.password ?? '']),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'credenciales')
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
    setCheckState('idle')
  }

  const createdCount = results?.filter((r) => r.status === 'created').length ?? 0

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
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragging(false)
                      const f = e.dataTransfer.files?.[0]
                      if (f) handleFile(f)
                    }}
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

                      {/* Tabla de revisión */}
                      <div className="overflow-hidden rounded-xl border border-line">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px] text-left text-[12px]">
                            <thead>
                              <tr className="bg-subtle text-[11px] uppercase tracking-wider text-text-muted">
                                <th className="w-10 px-3 py-2" />
                                <th className="w-10 px-1 py-2 text-right font-normal">#</th>
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_email')}</th>
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_name')}</th>
                                {canChooseRole && (
                                  <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_role')}</th>
                                )}
                                {campaigns.length > 0 && (
                                  <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_campaign')}</th>
                                )}
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_password')}</th>
                                <th className="px-3 py-2 font-normal">{t('admin.users.bulk_col_status')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {rows.map((r) => (
                                <tr
                                  key={r.key}
                                  className={r.status === 'new' && r.include ? '' : 'opacity-55'}
                                >
                                  <td className="px-3 py-2">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 accent-[#10D451]"
                                      checked={r.include}
                                      disabled={r.status !== 'new'}
                                      onChange={(e) =>
                                        setExcluded((prev) => ({ ...prev, [r.key]: !e.target.checked }))
                                      }
                                      aria-label={t('admin.users.bulk_include')}
                                    />
                                  </td>
                                  <td className="px-1 py-2 text-right text-text-subtle">{r.sourceLine}</td>
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
                                  <td className="px-3 py-2 font-mono text-text-muted">
                                    {defaultPasswordOn
                                      ? defaultPwdValue || t('admin.users.bulk_pwd_default')
                                      : t('admin.users.bulk_pwd_temp')}
                                  </td>
                                  <td className="px-3 py-2">
                                    <StatusBadge status={r.status} include={r.include} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

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
                  <div className="overflow-hidden rounded-xl border border-line">
                    <div className="grid grid-cols-[1fr_auto] gap-3 bg-subtle px-3 py-2 text-[11px] uppercase tracking-wider text-text-muted">
                      <span>{t('admin.users.bulk_col_email')}</span>
                      <span>{t('admin.users.bulk_col_status')}</span>
                    </div>
                    <div className="max-h-[40vh] divide-y divide-line overflow-y-auto">
                      {results.map((r, i) => (
                        <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-[12px]">
                          <span className="truncate text-text">{r.email}</span>
                          {r.status === 'created' ? (
                            <span className="flex items-center gap-1 text-green-500">
                              <Check className="h-3.5 w-3.5" /> {t('admin.users.bulk_status_created')}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-red-500" title={r.reason}>
                              <AlertCircle className="h-3.5 w-3.5" /> {t('admin.users.bulk_status_error')}
                            </span>
                          )}
                        </div>
                      ))}
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
                      ? t('admin.users.bulk_processing')
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

function StatusBadge({ status, include }: { status: RowStatus; include: boolean }) {
  const { t } = useTranslation()
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
