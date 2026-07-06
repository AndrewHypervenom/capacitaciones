import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Upload, FileSpreadsheet, Download, Loader2, Check, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { toast } from '@/stores/toastStore'
import type { Campaign } from '@/types/database'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ROWS = 200

interface ParsedRow {
  email: string
  display_name?: string
  role?: string
  campaign?: string
}

interface RowResult {
  email: string
  status: 'created' | 'error'
  password?: string
  reason?: string
}

interface BulkImportUsersProps {
  isSuperAdmin: boolean
  campaigns: Campaign[]
  onClose: () => void
  onImported: () => void | Promise<void>
}

/**
 * Carga masiva de aprendices desde Excel/CSV. Parsea el archivo en el cliente,
 * valida (email/duplicados/tope de filas) y delega la creación a la Edge Function
 * `create-users-bulk`, que impone la autorización (solo superadmin) y crea cada
 * usuario con una contraseña temporal. Devuelve credenciales descargables (.xlsx)
 * para entregarlas; también quedan disponibles luego en la lista de usuarios.
 */
export function BulkImportUsers({ isSuperAdmin, campaigns, onClose, onImported }: BulkImportUsersProps) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState<RowResult[] | null>(null)

  const campaignByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of campaigns) m.set(c.name.trim().toLowerCase(), c.id)
    return m
  }, [campaigns])

  const handleFile = async (file: File) => {
    setParseError(null)
    setResults(null)
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

      const seen = new Set<string>()
      const parsed: ParsedRow[] = []
      for (const r of raw) {
        // Aceptar encabezados case-insensitive
        const lower: Record<string, unknown> = {}
        for (const k of Object.keys(r)) lower[k.trim().toLowerCase()] = r[k]
        const email = String(lower['email'] ?? '').trim().toLowerCase()
        if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue
        seen.add(email)
        const row: ParsedRow = {
          email,
          display_name: String(lower['display_name'] ?? lower['nombre'] ?? '').trim() || undefined,
        }
        if (isSuperAdmin) {
          const role = String(lower['role'] ?? lower['rol'] ?? '').trim().toLowerCase()
          if (role) row.role = role
          const campName = String(lower['campaign'] ?? lower['campaña'] ?? '').trim().toLowerCase()
          if (campName && campaignByName.has(campName)) row.campaign = campaignByName.get(campName)
        }
        parsed.push(row)
      }

      if (parsed.length === 0) {
        setRows([])
        setParseError(t('admin.users.bulk_no_valid'))
        return
      }
      if (parsed.length > MAX_ROWS) {
        setRows([])
        setParseError(t('admin.users.bulk_max_rows', { n: MAX_ROWS }))
        return
      }
      setRows(parsed)
    } catch {
      setRows([])
      setParseError(t('admin.users.bulk_no_valid'))
    }
  }

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
    if (rows.length === 0) return
    setProcessing(true)
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
          body: JSON.stringify({ rows }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      setResults(json.results as RowResult[])
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
    const rowsCsv = [
      ['site', 'email', 'password'],
      ...created.map((r) => ['https://capacitaciones-chi.vercel.app/', r.email, r.password ?? '']),
    ]
    const ws = XLSX.utils.aoa_to_sheet(rowsCsv)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'credenciales')
    XLSX.writeFile(wb, 'credenciales-usuarios.xlsx')
  }

  const createdCount = results?.filter((r) => r.status === 'created').length ?? 0

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
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-lg"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <FileSpreadsheet className="h-4 w-4 text-text-muted" />
                  {t('admin.users.bulk_title')}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {results ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] text-text">
                      {t('admin.users.bulk_done', { created: createdCount, total: results.length })}
                    </p>
                    {createdCount > 0 && (
                      <button
                        onClick={downloadCredentials}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium text-black min-h-[40px]"
                        style={{ background: '#00C228' }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t('admin.users.bulk_download_creds')}
                      </button>
                    )}
                  </div>
                  {createdCount > 0 && (
                    <p className="text-[12px] text-text-muted">{t('admin.users.bulk_creds_hint')}</p>
                  )}
                  <div className="rounded-xl border border-line overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-[11px] uppercase tracking-wider text-text-muted bg-subtle">
                      <span>{t('admin.users.bulk_col_email')}</span>
                      <span>{t('admin.users.bulk_col_status')}</span>
                    </div>
                    <div className="divide-y divide-line max-h-[40vh] overflow-y-auto">
                      {results.map((r, i) => (
                        <div key={i} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 items-center text-[12px]">
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
              ) : (
                <div className="space-y-4">
                  <p className="text-[13px] text-text-muted">{t('admin.users.bulk_help')}</p>

                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleFile(f)
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px]"
                    >
                      <Upload className="h-4 w-4" />
                      {t('admin.users.bulk_choose_file')}
                    </button>
                    <button
                      onClick={downloadTemplate}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] text-text-muted hover:text-text min-h-[44px]"
                    >
                      <Download className="h-4 w-4" />
                      {t('admin.users.bulk_template')}
                    </button>
                  </div>

                  {fileName && !parseError && rows.length > 0 && (
                    <p className="text-[13px] text-text">
                      <span className="font-mono text-text-muted">{fileName}</span> —{' '}
                      {t('admin.users.bulk_rows_detected', { n: rows.length })}
                    </p>
                  )}
                  {parseError && <p className="text-[13px] text-red-500">{parseError}</p>}
                </div>
              )}
            </div>

            {/* Footer */}
            {!results && (
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle min-h-[44px]"
                >
                  {t('admin.courses.cancel')}
                </button>
                <button
                  onClick={process}
                  disabled={processing || rows.length === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black disabled:opacity-50 min-h-[44px]"
                  style={{ background: '#00C228' }}
                >
                  {processing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {processing ? t('admin.users.bulk_processing') : t('admin.users.bulk_process')}
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
